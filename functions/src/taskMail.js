// Task emails (owner, 2026-11-08; docs/modules/TASK_EMAILS.md, Q450-Q456):
// a user's tasks sent to their email. New development, hand-written.
//
// The one place that sends. The places that create a task (an approval
// reaching an approver, a rejection, an Employee Portal request's update)
// put an email in their corporate's queue; one scheduled function
// (sweepTaskMail, every 5 minutes) serves every corporate: it sends the
// queue, checking each task is still open, and each user's summary when
// their own time and day come (Q455-Q456). So "at once" is within about
// 5 minutes. It sends through the firm's Google Workspace mailbox (Q450,
// Q454), whose address and app password are one Secret Manager secret,
// TASK_MAIL_ACCOUNT ("address app-password"); until it is set (or while it
// is "none") every email is logged "not sent: no mail account set".
//
//   Firestore userEmailSettings/{uid}  { Timing, SummaryTime 'HH:MM', SummaryDays ['Mon', ...], UpdatedAt }
//   Firestore employeeEmailSettings/{EmployeeID}  { Off: true|false, UpdatedAt }   (the portal's on/off)
//   Firestore mailQueue/{auto}  { Kind, ToUid | EmployeeID, Subject, Lines, Link, Check, Status 'Queued'|'Sending', CreatedAt }
//   Firestore mailLog/{auto}    { To, Uid, EmployeeID, Kind, Subject, Result, Error, At }
//   Firestore mailSummaries/{uid}_{yyyy-mm-dd}  { At }   (a summary is sent once a day, Q455)
//
// Timing (Q451): 'instant' approvals and rejections at once; 'approvals-
// instant' (the default) approvals at once; 'daily' the summary only; 'off'
// nothing. Every choice but Off also gets the summary, on the days chosen.
// A failure is logged and never stops the posting or approval that caused it.
'use strict';
const { HttpsError } = require('firebase-functions/v2/https');
const { onCallWithMessages } = require('./callable');
const { rtdb, firestore, runInCorporate } = require('./firebaseAdmin');
const { requireUser } = require('./auth');

const onCallOptions = { region: 'us-central1' };
const TIME_ZONE = 'Asia/Dubai'; // the corporates' time zone (Q455)
const ERP_LINK = 'https://erp1-8f4cd.web.app/';
const PORTAL_LINK = 'https://erp1-8f4cd.web.app/ess.html';
const TIMINGS = Object.freeze(['instant', 'approvals-instant', 'daily', 'off']);
const DAYS = Object.freeze(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']);
const DEFAULTS = Object.freeze({ Timing: 'approvals-instant', SummaryTime: '07:00', SummaryDays: Object.freeze(['Mon', 'Tue', 'Wed', 'Thu', 'Fri']) });
const SUMMARY_WINDOW_MIN = 60; // a summary missed by a late run still goes within the hour
const QUEUE_BATCH = 200;
const SUMMARY_PARALLEL = 5;
const NO_ACCOUNT = 'not sent: no mail account set';

const QUEUE = () => firestore.collection('mailQueue');
const LOG = () => firestore.collection('mailLog');
const SETTINGS = uid => firestore.collection('userEmailSettings').doc(uid);
const EMP_SETTINGS = id => firestore.collection('employeeEmailSettings').doc(id);
const SUMMARY_SENT = (uid, day) => firestore.collection('mailSummaries').doc(uid + '_' + day);
const text = (v, max) => String(v == null ? '' : v).trim().slice(0, max || 200);
const bad = msg => { throw new HttpsError('invalid-argument', msg); };

// ---------- pure: the setting, the clock, the email ----------

function cleanSettings(d) {
  const x = d || {};
  if (!TIMINGS.includes(x.Timing)) bad('Choose when you are emailed.');
  const time = text(x.SummaryTime, 5);
  if (!/^([01]\d|2[0-3]):(00|30)$/.test(time)) bad('Choose the summary\'s time, on the hour or half hour.');
  const days = Array.isArray(x.SummaryDays) ? x.SummaryDays : [];
  if (days.some(day => !DAYS.includes(day))) bad('Unknown day.');
  return { Timing: x.Timing, SummaryTime: time, SummaryDays: DAYS.filter(day => days.includes(day)) };
}
const settingsOf = saved => Object.assign({}, DEFAULTS, { SummaryDays: DEFAULTS.SummaryDays.slice() }, saved && TIMINGS.includes(saved.Timing) ? {
  Timing: saved.Timing, SummaryTime: /^\d\d:\d\d$/.test(saved.SummaryTime) ? saved.SummaryTime : DEFAULTS.SummaryTime,
  SummaryDays: Array.isArray(saved.SummaryDays) ? saved.SummaryDays.filter(day => DAYS.includes(day)) : DEFAULTS.SummaryDays.slice()
} : {});

// Whether an email of this kind goes at once under the timing (Q451).
function sendsAtOnce(timing, kind) {
  if (kind === 'approval') return timing === 'instant' || timing === 'approvals-instant';
  if (kind === 'rejected') return timing === 'instant';
  return false;
}

// The corporate's clock: { date 'yyyy-mm-dd', day 'Mon', minutes since midnight }.
function localClock(now, timeZone) {
  const parts = {};
  new Intl.DateTimeFormat('en-GB', { timeZone: timeZone || TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    .formatToParts(now).forEach(p => { parts[p.type] = p.value; });
  return { date: parts.year + '-' + parts.month + '-' + parts.day, day: parts.weekday, minutes: Number(parts.hour) * 60 + Number(parts.minute) };
}
const minutesOf = hhmm => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

// Whether the user's summary is due at this clock (once sent, the day's record stops it).
function summaryDue(settings, clock) {
  if (settings.Timing === 'off' || !settings.SummaryDays.includes(clock.day)) return false;
  const from = minutesOf(settings.SummaryTime);
  return clock.minutes >= from && clock.minutes < from + SUMMARY_WINDOW_MIN;
}

// Dates in an email read dd/mm/yyyy, as everywhere the ERP shows one (owner, 2026-09-29).
const showDate = v => String(v == null ? '' : v).replace(/\b(\d{4})-(\d{2})-(\d{2})\b/g, '$3/$2/$1');
const money = n => (Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// { subject, text, html } of one email: a heading, sections of lines, the link.
function composeEmail(subject, sections, link) {
  const tail = 'Open the ERP: ' + link + '\n\nThis is an automatic email: please do not reply. Change when you are emailed in the ERP: your name, Email settings.';
  const plain = sections.map(s => (s.title ? s.title + '\n' : '') + s.lines.map(l => '- ' + showDate(l)).join('\n')).join('\n\n') + '\n\n' + tail;
  const html = '<div style="font-family:Arial,sans-serif;font-size:14px;color:#1f2937">' +
    sections.map(s => (s.title ? '<h3 style="margin:16px 0 6px;font-size:15px">' + esc(s.title) + '</h3>' : '') +
      '<ul style="margin:0;padding-left:20px">' + s.lines.map(l => '<li>' + esc(showDate(l)) + '</li>').join('') + '</ul>').join('') +
    '<p style="margin-top:18px"><a href="' + esc(link) + '">Open the ERP</a></p>' +
    '<p style="color:#6b7280;font-size:12px">This is an automatic email: please do not reply. Change when you are emailed in the ERP: your name, Email settings.</p></div>';
  return { subject: showDate(subject), text: plain, html };
}

// The secret "address app-password" (spaces in the password are Google's display only).
function parseAccount(value) {
  const v = String(value || '').trim();
  if (!v || v.toLowerCase() === 'none') return null;
  const at = v.search(/\s/);
  if (at < 0) return null;
  const user = v.slice(0, at), pass = v.slice(at).replace(/\s+/g, '');
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(user) && pass ? { user, pass } : null;
}

// ---------- the settings (the user menu's Email settings, Q453) ----------

exports.getMyEmailSettings = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  const s = await SETTINGS(user.uid).get();
  return Object.assign(settingsOf(s.exists ? s.data() : null), { email: user.profile.email || '', timeZone: TIME_ZONE, days: DAYS, saved: s.exists });
});

exports.saveMyEmailSettings = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  const clean = cleanSettings(request.data || {});
  await SETTINGS(user.uid).set(Object.assign(clean, { UpdatedAt: new Date().toISOString() }));
  return { success: true };
});

// The portal's on/off (an employee, through essPortal).
async function employeeSetting(employeeId) {
  const s = await EMP_SETTINGS(employeeId).get();
  return { on: !(s.exists && s.data().Off === true) };
}
async function saveEmployeeSetting(employeeId, on) {
  await EMP_SETTINGS(employeeId).set({ Off: on !== true, UpdatedAt: new Date().toISOString() });
  return { success: true, on: on === true };
}

// ---------- queueing (never throws: a task is never stopped by its email) ----------

async function safely(what, fn) {
  try { await fn(); } catch (err) { console.error('taskMail: ' + what + ' not queued', err); }
}
const enqueue = item => QUEUE().add(Object.assign({ Status: 'Queued', CreatedAt: new Date().toISOString() }, item));

// Who has an approval's task now (as Home shows it, homeTasks.js): a Job
// Order request level by level, any other document every undecided level.
function approversWithTask(inst) {
  const decided = new Set((inst.Decisions || []).map(d => d.LevelNumber));
  const open = (inst.RequiredLevels || []).filter(l => !decided.has(l.LevelNumber)).sort((a, b) => a.LevelNumber - b.LevelNumber);
  return inst.ModuleID === 'JOBORDERREQUEST' ? open.slice(0, 1) : open;
}
const docName = inst => require('./approvalRegistry').approvalLabelOf(inst) + ' ' + (inst.DocumentNumber || inst.DocumentID);

// What an approval's write gives to whom (pure): the levels whose approver has
// the task now but did not before (sent for approval, a Job Order request's
// next level, a delegation), and whether it has just been rejected.
function approvalNews(before, after) {
  if (!after) return { waiting: [], rejected: false };
  const key = l => l.LevelNumber + '/' + l.ApproverUserID;
  const had = new Set(before && before.Status === 'Pending' ? approversWithTask(before).map(key) : []);
  return {
    waiting: after.Status === 'Pending' ? approversWithTask(after).filter(l => l.ApproverUserID && !had.has(key(l))) : [],
    rejected: after.Status === 'Rejected' && !(before && before.Status === 'Rejected') && Boolean(after.CreatedBy)
  };
}

// Every write of an approval (approvalStore.js afterWrite): its news queued.
function approvalChanged(instanceId, before, after) {
  return safely('approval ' + instanceId, async () => {
    const news = approvalNews(before, after);
    const seen = new Set();
    for (const l of news.waiting) {
      if (seen.has(l.ApproverUserID)) continue;
      seen.add(l.ApproverUserID);
      await enqueue({ Kind: 'approval', ToUid: l.ApproverUserID, Subject: 'Waiting for your approval: ' + docName(after),
        Lines: [docName(after) + (after.Amount ? ', ' + money(after.Amount) : '') + ', waiting for your approval (level ' + l.LevelNumber + ').'],
        Link: ERP_LINK, Check: { InstanceID: instanceId, LevelNumber: l.LevelNumber, Status: 'Pending' } });
    }
    if (news.rejected) {
      const r = (after.Decisions || []).slice().reverse().find(d => d.Decision === 'Rejected') || {};
      await enqueue({ Kind: 'rejected', ToUid: after.CreatedBy, Subject: 'Rejected: ' + docName(after),
        Lines: [docName(after) + ' was rejected by ' + (r.ApproverName || 'the approver') + (r.Reason ? ': ' + r.Reason : '') + '.'],
        Link: ERP_LINK, Check: { InstanceID: instanceId, Status: 'Rejected' } });
    }
  });
}

// An Employee Portal update for the employee (Q452): what changed, and its page.
function portalUpdate(employeeId, subject, line, hash) {
  return safely('portal ' + employeeId, async () => {
    if (!employeeId) return;
    await enqueue({ Kind: 'portal', EmployeeID: String(employeeId), Subject: text(subject, 150), Lines: [text(line, 600)], Link: PORTAL_LINK + (hash ? '#' + hash : '') });
  });
}

// ---------- sending ----------

async function writeLog(entry) {
  await LOG().add(Object.assign({ At: new Date().toISOString() }, entry));
}

// Sends one email (or logs why not). transport: nodemailer's, or null when no account.
async function deliver(transport, from, to, mail, logBase) {
  if (!to) return writeLog(Object.assign({}, logBase, { Subject: mail.subject, Result: 'not sent: no email address' }));
  if (!transport) return writeLog(Object.assign({}, logBase, { To: to, Subject: mail.subject, Result: NO_ACCOUNT }));
  try {
    await transport.sendMail({ from: '"ERP tasks" <' + from + '>', to, subject: mail.subject, text: mail.text, html: mail.html });
    await writeLog(Object.assign({}, logBase, { To: to, Subject: mail.subject, Result: 'sent' }));
    return true;
  } catch (err) {
    await writeLog(Object.assign({}, logBase, { To: to, Subject: mail.subject, Result: 'failed', Error: text(err && err.message, 300) }));
    return false;
  }
}

// Whether a queued approval or rejection is still the user's task.
async function stillOpen(check) {
  if (!check || !check.InstanceID) return true;
  const inst = await require('./approvalStore').approvalInstances.get(check.InstanceID);
  if (!inst || inst.Status !== check.Status) return false;
  if (check.Status !== 'Pending') return true;
  return approversWithTask(inst).some(l => l.LevelNumber === check.LevelNumber);
}

async function recipient(item, users) {
  if (item.Kind === 'portal') {
    const e = (await firestore.collection('employees').doc(item.EmployeeID).get()).data();
    if (!e || !(await employeeSetting(item.EmployeeID)).on) return null;
    return { to: text(e.WorkEmail, 200) || text(e.PersonalEmail, 200), log: { EmployeeID: item.EmployeeID } };
  }
  const u = users[item.ToUid];
  if (!u || u.status !== 'Active') return null;
  const s = await SETTINGS(item.ToUid).get();
  if (!sendsAtOnce(settingsOf(s.exists ? s.data() : null).Timing, item.Kind)) return null;
  return { to: text(u.email, 200), log: { Uid: item.ToUid } };
}

// The queue: each item claimed (so a second run never sends it), checked, sent, removed.
async function sendQueue(account, transport, users) {
  const snap = await QUEUE().where('Status', '==', 'Queued').limit(QUEUE_BATCH).get();
  let sent = 0;
  for (const doc of snap.docs) {
    try { await doc.ref.update({ Status: 'Sending' }, { lastUpdateTime: doc.updateTime }); } catch (err) { continue; }
    const item = doc.data();
    try {
      const who = (await stillOpen(item.Check)) ? await recipient(item, users) : null;
      if (who) {
        const mail = composeEmail(item.Subject, [{ title: '', lines: item.Lines || [] }], item.Link || ERP_LINK);
        if (await deliver(transport, account && account.user, who.to, mail, Object.assign({ Kind: item.Kind }, who.log))) sent++;
      }
    } catch (err) {
      await writeLog({ Kind: item.Kind, Subject: text(item.Subject, 150), Result: 'failed', Error: text(err && err.message, 300) });
    }
    await doc.ref.delete();
  }
  return sent;
}

// Home's tasks, through Home's own readers (each limits itself to what the user may see).
const fmt = (...parts) => parts.filter(p => p != null && p !== '').join(' ');
const READERS = [
  { title: 'Waiting for your approval', mod: './homeTasks', fn: 'getPendingApprovalsForUser', line: x => fmt(x.ModuleLabel, x.DocumentNumber || x.DocumentID) + (x.Amount ? ', ' + money(x.Amount) : '') },
  { title: 'Your rejected items', mod: './homeTasks', fn: 'getMyRejectedSubmissions', line: x => fmt(x.ModuleLabel, x.DocumentNumber || x.DocumentID) + ': ' + (x.RejectionReason || '') },
  { title: 'Follow-ups', mod: './followUps', fn: 'getMyFollowUpTasksForUser', line: x => fmt(x.ModuleLabel, x.DocumentNumber) + (x.Description ? ', ' + x.Description : '') },
  { title: 'Post-dated cheques due', mod: './pdc', fn: 'getPdcsDueForUser', today: true, line: x => fmt(x.ModuleLabel, x.DocumentNumber) + ', cheque ' + (x.ChequeNumber || '') + ' dated ' + (x.ChequeDate || '') + (x.PartyName ? ', ' + x.PartyName : '') + ', ' + money(x.Amount) },
  { title: 'Recurring journals due', mod: './recurringJournal', fn: 'getRecurringJournalsDueForUser', line: x => fmt(x.DocumentNumber, x.Description) + ': ' + x.DueCount + ' due since ' + (x.OldestDueDate || '') },
  { title: 'CRM activities due', mod: './crm', fn: 'getCrmActivitiesDueForUser', today: true, line: x => fmt(x.Type) + ': ' + (x.Subject || '') + ', due ' + (x.Due || '') + (x.Overdue ? ' (overdue)' : '') },
  { title: 'Company documents expiring', mod: './companyDocuments', fn: 'getDocumentsExpiringForUser', line: x => fmt(x.Title, x.CategoryName ? '(' + x.CategoryName + ')' : '') + ', expires ' + (x.ExpiryDate || '') },
  { title: 'Employee documents expiring', mod: './hrDocuments', fn: 'getEmployeeDocumentsExpiringForUser', line: x => fmt(x.EmployeeName) + ': ' + (x.DocTypeName || '') + ', expires ' + (x.ExpiryDate || '') },
  { title: 'Employee requests', mod: './employeeRequests', fn: 'employeeRequests', data: { action: 'tasks' }, pick: r => (r && r.items) || [], line: x => fmt(x.Number, x.What) + (x.EmployeeName ? ', ' + x.EmployeeName : '') },
  { title: 'Leaver clearance steps', mod: './clearance', fn: 'getClearanceTasksForUser', line: x => fmt(x.EmployeeName) + ' (leaving ' + (x.LeavingDate || '') + '): ' + (x.Step || '') },
  { title: 'Leave returns to record', mod: './hrLeaveReports', fn: 'getLeaveTasksForUser', pick: r => (r && r.returnsToRecord) || [], line: x => fmt(x.EmployeeName, x.LeaveNumber) + ': back from ' + (x.LeaveTypeName || 'leave') + ' since ' + (x.ExpectedReturn || '') }
];
const MAX_LINES = 50; // per section; the rest is "and n more"

async function tasksOf(uid, today) {
  const sections = [];
  for (const r of READERS) {
    let rows;
    try {
      const data = r.data ? Object.assign({}, r.data) : r.today ? { today } : {};
      const out = await require(r.mod)[r.fn].inCorporate({ auth: { uid }, data });
      rows = r.pick ? r.pick(out) : Array.isArray(out) ? out : [];
    } catch (err) {
      continue; // a reader the user has no right to, or a failure: the rest still goes
    }
    if (!rows.length) continue;
    const lines = rows.slice(0, MAX_LINES).map(r.line);
    if (rows.length > MAX_LINES) lines.push('and ' + (rows.length - MAX_LINES) + ' more');
    sections.push({ title: r.title + ' (' + rows.length + ')', lines });
  }
  return sections;
}

// The summaries due now (Q455-Q456): one email per user, none when nothing is open.
async function sendSummaries(account, transport, users, now) {
  const clock = localClock(now);
  const saved = {};
  (await firestore.collection('userEmailSettings').get()).docs.forEach(d => { saved[d.id] = d.data(); });
  const due = Object.keys(users).filter(uid => users[uid] && users[uid].status === 'Active' && summaryDue(settingsOf(saved[uid]), clock));
  let sent = 0;
  const one = async uid => {
    // Claimed for the day first: a retried or overlapping run never sends it twice.
    try { await SUMMARY_SENT(uid, clock.date).create({ At: now.toISOString() }); } catch (err) { return; }
    try {
      const sections = await tasksOf(uid, clock.date);
      if (!sections.length) return;
      const count = sections.reduce((n, s) => n + Number((/\((\d+)\)$/.exec(s.title) || [0, 0])[1]), 0);
      const mail = composeEmail('Your ERP tasks, ' + clock.date + ': ' + count + ' open', sections, ERP_LINK);
      if (await deliver(transport, account && account.user, text(users[uid].email, 200), mail, { Kind: 'summary', Uid: uid })) sent++;
    } catch (err) {
      await writeLog({ Kind: 'summary', Uid: uid, Result: 'failed', Error: text(err && err.message, 300) });
    }
  };
  // A few users at a time: many share 07:00, and each runs Home's readers.
  for (let i = 0; i < due.length; i += SUMMARY_PARALLEL) await Promise.all(due.slice(i, i + SUMMARY_PARALLEL).map(one));
  return sent;
}

// One corporate's run: the queue, then the summaries due. Called inside runInCorporate.
async function sweepCorporate(opts) {
  const o = opts || {};
  const users = (await rtdb.ref('users').get()).val() || {};
  const queued = await sendQueue(o.account || null, o.transport || null, users);
  const summaries = await sendSummaries(o.account || null, o.transport || null, users, o.now || new Date());
  return { queued, summaries };
}

// Every corporate; one that fails or is out of reach never stops the others.
async function sweepAll(account, transport, now) {
  const out = {};
  for (const c of await require('./corporates').activeCorporates()) {
    try {
      out[c.id] = await runInCorporate(c, () => sweepCorporate({ account, transport, now }));
    } catch (err) {
      console.error('taskMail: Corporate ' + c.id + ' not swept', err);
      out[c.id] = { error: err.message };
    }
  }
  return out;
}

function transportFor(account) {
  if (!account) return null;
  return require('nodemailer').createTransport({ host: 'smtp.gmail.com', port: 465, secure: true, auth: { user: account.user, pass: account.pass } });
}

// The scheduled function (not a callable: no public access, tools/deploy-lib.sh).
const { onSchedule } = require('firebase-functions/v2/scheduler');
const { defineSecret } = require('firebase-functions/params');
const MAIL_ACCOUNT = defineSecret('TASK_MAIL_ACCOUNT');
exports.sweepTaskMail = onSchedule({ schedule: 'every 5 minutes', region: 'us-central1', timeZone: 'UTC', secrets: [MAIL_ACCOUNT], timeoutSeconds: 540, memory: '512MiB' }, async () => {
  const account = parseAccount(MAIL_ACCOUNT.value());
  const out = await sweepAll(account, transportFor(account), new Date());
  console.log(JSON.stringify({ message: 'taskMail', account: Boolean(account), corporates: out }));
});

module.exports = Object.assign(exports, {
  TIMINGS, DAYS, DEFAULTS, NO_ACCOUNT, cleanSettings, settingsOf, sendsAtOnce, localClock, summaryDue, composeEmail, parseAccount, showDate,
  approvalNews, approvalChanged, portalUpdate, employeeSetting, saveEmployeeSetting, sweepCorporate, approversWithTask
});
