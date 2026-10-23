// Support (docs/modules/MULTI_CORPORATE.md, M3; owner, 2026-10-19,
// decisions 252-257): a client corporate's Admin sends issues to the firm,
// and the firm answers them from the Developer screen. New development,
// hand-written.
//
// Where it is kept (decision 252): in the FIRM's project, not the client's.
// So the Support screen says, before anything is sent, that what is written
// and attached is shared with the firm and leaves the client's account; the
// user confirms it each time (shareConfirmed, checked here too).
//   Firestore supportIssues/{id}            the issue (CorporateID, Number, Type,
//                                           Title, Status, Screen, Context, ...)
//   supportIssues/{id}/messages/{id}        what each side wrote, with its files
//   supportCounters/{Corporate ID}          the next issue number
//   Cloud Storage support/<corp>/<issue>/   the attachments (decision 253:
//                                           up to 5 files of 10 MB a message)
//
// Who:
// - a client corporate: those with Support's access right (decision 254:
//   its Admin; others will send theirs from the Employee Portal, later).
//   They see their corporate's issues, the firm's replies, and answer them;
// - Corporate 100: the Developer module (access sees the queue of every
//   corporate's issues, decision 257; write answers them and sets their
//   status). Support itself is not Corporate 100's (entitlements.js).
'use strict';
const { randomUUID } = require('crypto');
const { HttpsError } = require('firebase-functions/v2/https');
const { onCallWithMessages } = require('./callable');
const { firm, HOME_ID, corporateId, corporateEntry } = require('./firebaseAdmin');
const { requireUser, moduleHasCapability } = require('./auth');
const { availableModules } = require('./entitlements');
const { checkFile } = require('./attachments');

const onCallOptions = { region: 'us-central1' };
const ISSUES = 'supportIssues';
const TYPES = ['Bug', 'Question', 'Change request'];
const STATUSES = ['New', 'In progress', 'Waiting for you', 'Resolved', 'Closed'];
const OPEN = ['New', 'In progress', 'Waiting for you'];
const FIRM_SETS = ['In progress', 'Waiting for you', 'Resolved', 'Closed'];
const MAX_FILES = 5;
// Files go with the message they belong to, sent just after it.
const FILE_WINDOW_MS = 30 * 60 * 1000;

const str = (v, max) => String(v == null ? '' : v).trim().slice(0, max || 200);
const nameOf = user => user.profile.fullName || user.profile.username || user.uid;
const issueRef = id => firm.firestore.collection(ISSUES).doc(str(id, 64) || '-');

// The caller's side: { side: 'client' | 'firm', user, canWrite }.
async function caller(request, needWrite) {
  const user = await requireUser(request);
  if (corporateId() === HOME_ID) {
    const canWrite = await moduleHasCapability('DEVELOPER', 'write', user.profile.role);
    if (!(await moduleHasCapability('DEVELOPER', 'access', user.profile.role))) throw new HttpsError('permission-denied', 'You do not have access to the support queue.');
    if (needWrite && !canWrite) throw new HttpsError('permission-denied', 'You do not have permission to answer support issues.');
    return { side: 'firm', user, canWrite };
  }
  if (!(await moduleHasCapability('SUPPORT', 'access', user.profile.role))) throw new HttpsError('permission-denied', 'You do not have access to Support.');
  return { side: 'client', user, canWrite: true };
}

// The issue, if the caller may see it: the firm sees every corporate's, a
// client only its own corporate's.
async function issueFor(c, id) {
  const snap = await issueRef(id).get();
  if (!snap.exists) throw new HttpsError('not-found', 'That issue is not there any more.');
  const issue = snap.data();
  if (c.side === 'client' && issue.CorporateID !== corporateId()) throw new HttpsError('not-found', 'That issue is not there any more.');
  return { ref: snap.ref, issue };
}

function requireShared(d) {
  if (d.shareConfirmed !== true) {
    throw new HttpsError('failed-precondition', 'Confirm first that what you send is shared with the support team and leaves your organisation\'s account.');
  }
}

const listed = (id, i) => ({
  IssueID: id, CorporateID: i.CorporateID, CorporateName: i.CorporateName || '', Number: i.Number, Type: i.Type, Title: i.Title,
  Status: i.Status, Screen: i.Screen || null, CreatedByName: i.CreatedByName, CreatedAt: i.CreatedAt, UpdatedAt: i.UpdatedAt, LastFrom: i.LastFrom
});

// The issues: a client's corporate's, or the firm's queue (open, or all).
exports.getSupportIssues = onCallWithMessages(onCallOptions, async (request) => {
  const c = await caller(request, false);
  const d = request.data || {};
  let snap;
  if (c.side === 'client') snap = await firm.firestore.collection(ISSUES).where('CorporateID', '==', corporateId()).get();
  else if (d.filter === 'all') snap = await firm.firestore.collection(ISSUES).orderBy('UpdatedAt', 'desc').limit(300).get();
  else snap = await firm.firestore.collection(ISSUES).where('Status', 'in', OPEN).get();
  const issues = snap.docs.map(x => listed(x.id, x.data())).sort((a, b) => String(b.UpdatedAt).localeCompare(String(a.UpdatedAt)));
  const out = { side: c.side, canWrite: c.canWrite, issues, types: TYPES, statuses: STATUSES, maxFiles: MAX_FILES };
  if (c.side === 'client') {
    // The screens an issue can be about: the corporate's own.
    out.screens = availableModules().filter(m => !m.internal && m.id !== 'SUPPORT').map(m => ({ id: m.id, label: m.label }));
  } else {
    out.firmStatuses = FIRM_SETS;
  }
  return out;
});

exports.getSupportIssue = onCallWithMessages(onCallOptions, async (request) => {
  const c = await caller(request, false);
  const { ref, issue } = await issueFor(c, (request.data || {}).IssueID);
  const msgs = await ref.collection('messages').get();
  const messages = msgs.docs.map(m => Object.assign({ MessageID: m.id }, m.data())).sort((a, b) => String(a.At).localeCompare(String(b.At)));
  return Object.assign(listed(ref.id, issue), { Context: issue.Context || {}, messages, side: c.side, canWrite: c.canWrite });
});

// A client's new issue: its first message is what happened. Its files are
// sent next, one call each (addSupportFile).
exports.submitSupportIssue = onCallWithMessages(onCallOptions, async (request) => {
  const c = await caller(request, true);
  if (c.side !== 'client') throw new HttpsError('failed-precondition', 'Support issues are sent from a client corporate.');
  const d = request.data || {};
  requireShared(d);
  const type = TYPES.includes(d.Type) ? d.Type : null;
  if (!type) throw new HttpsError('invalid-argument', 'Choose what it is: ' + TYPES.join(', ') + '.');
  const title = str(d.Title, 150), text = str(d.Text, 10000);
  if (!title) throw new HttpsError('invalid-argument', 'Give the issue a short title.');
  if (!text) throw new HttpsError('invalid-argument', 'Say what happened (or what you need).');
  const screen = availableModules().find(m => m.id === str(d.Screen, 40));
  const corp = corporateId();
  const now = new Date().toISOString();
  const release = await firm.firestore.doc('system/screens').get().then(s => (s.exists ? s.get('activeRelease') : '') || '', () => '');
  const ua = request.rawRequest && request.rawRequest.headers ? str(request.rawRequest.headers['user-agent'], 300) : '';
  const issue = firm.firestore.collection(ISSUES).doc();
  const message = issue.collection('messages').doc();
  const counter = firm.firestore.doc('supportCounters/' + corp);
  let number = '';
  await firm.firestore.runTransaction(async tx => {
    const n = ((await tx.get(counter)).get('next') || 1);
    number = corp + '-' + String(n).padStart(5, '0');
    tx.set(counter, { next: n + 1 }, { merge: true });
    tx.set(issue, {
      CorporateID: corp, CorporateName: (corporateEntry() || {}).Name || '', Number: number, Type: type, Title: title, Status: 'New',
      Screen: screen ? { id: screen.id, label: screen.label } : null,
      Context: { At: now, AppVersion: release, UserAgent: ua },
      CreatedByUID: c.user.uid, CreatedByName: nameOf(c.user), CreatedAt: now, UpdatedAt: now, LastFrom: 'client', Shared: true
    });
    tx.set(message, { From: 'client', ByUID: c.user.uid, ByName: nameOf(c.user), Text: text, At: now, Files: [], Shared: true });
  });
  return { success: true, IssueID: issue.id, MessageID: message.id, Number: number };
});

// A reply, from either side. The firm's also sets the status (by default
// "Waiting for you"); a client's reopens a resolved or waiting issue.
exports.replySupportIssue = onCallWithMessages(onCallOptions, async (request) => {
  const c = await caller(request, true);
  const d = request.data || {};
  if (c.side === 'client') requireShared(d);
  const { ref, issue } = await issueFor(c, d.IssueID);
  const text = str(d.Text, 10000);
  if (!text) throw new HttpsError('invalid-argument', 'Write the reply first.');
  if (issue.Status === 'Closed' && c.side === 'client') throw new HttpsError('failed-precondition', 'This issue is closed: send a new one.');
  let status = issue.Status;
  if (c.side === 'firm') {
    status = d.Status === undefined || d.Status === '' ? 'Waiting for you' : d.Status;
    if (!FIRM_SETS.includes(status)) throw new HttpsError('invalid-argument', 'Unknown status.');
  } else if (['Waiting for you', 'Resolved'].includes(issue.Status)) {
    status = 'In progress';
  }
  const now = new Date().toISOString();
  const message = ref.collection('messages').doc();
  const batch = firm.firestore.batch();
  batch.set(message, Object.assign({ From: c.side, ByUID: c.user.uid, ByName: nameOf(c.user), Text: text, At: now, Files: [] }, c.side === 'client' ? { Shared: true } : {}));
  batch.update(ref, { Status: status, UpdatedAt: now, LastFrom: c.side });
  await batch.commit();
  return { success: true, MessageID: message.id, Status: status };
});

// One file of a message just sent, by its author (decision 253).
exports.addSupportFile = onCallWithMessages(onCallOptions, async (request) => {
  const c = await caller(request, true);
  const d = request.data || {};
  const { ref, issue } = await issueFor(c, d.IssueID);
  const mref = ref.collection('messages').doc(str(d.MessageID, 64) || '-');
  const file = checkFile(d.fileName, d.data);
  const fileId = randomUUID();
  const path = 'support/' + issue.CorporateID + '/' + ref.id + '/' + fileId;
  await firm.firestore.runTransaction(async tx => {
    const m = await tx.get(mref);
    if (!m.exists) throw new HttpsError('not-found', 'That message is not there any more.');
    const msg = m.data();
    if (msg.ByUID !== c.user.uid || msg.From !== c.side) throw new HttpsError('permission-denied', 'Files go with your own message.');
    if (Date.now() - Date.parse(msg.At) > FILE_WINDOW_MS) throw new HttpsError('failed-precondition', 'Files are added with the message, when it is sent: send a new reply to add more.');
    if ((msg.Files || []).length >= MAX_FILES) throw new HttpsError('invalid-argument', 'Up to ' + MAX_FILES + ' files a message.');
    tx.update(mref, { Files: (msg.Files || []).concat([{ FileID: fileId, Name: file.name, Mime: file.mime, Size: file.data.length, Path: path }]) });
  });
  // The record first, then the file: a file without its record is never
  // shown; a record whose upload failed says so when opened.
  await firm.bucket().file(path).save(file.data, { contentType: file.mime, resumable: false, metadata: { metadata: { corporate: issue.CorporateID, issue: ref.id } } });
  return { success: true, file: { FileID: fileId, Name: file.name, Size: file.data.length } };
});

exports.openSupportFile = onCallWithMessages(onCallOptions, async (request) => {
  const c = await caller(request, false);
  const d = request.data || {};
  const { ref } = await issueFor(c, d.IssueID);
  const m = await ref.collection('messages').doc(str(d.MessageID, 64) || '-').get();
  const f = m.exists && (m.get('Files') || []).find(x => x.FileID === d.FileID);
  if (!f) throw new HttpsError('not-found', 'That file is not there any more.');
  let data;
  try { [data] = await firm.bucket().file(f.Path).download(); } catch (err) {
    throw new HttpsError('not-found', '"' + f.Name + '" did not finish uploading: ask for it again.');
  }
  return { fileName: f.Name, mimeType: f.Mime, data: data.toString('base64') };
});

// The firm sets any status; a client can only close its issue.
exports.setSupportIssueStatus = onCallWithMessages(onCallOptions, async (request) => {
  const c = await caller(request, true);
  const d = request.data || {};
  const { ref } = await issueFor(c, d.IssueID);
  const allowed = c.side === 'firm' ? FIRM_SETS : ['Closed'];
  if (!allowed.includes(d.Status)) throw new HttpsError('invalid-argument', c.side === 'firm' ? 'Unknown status.' : 'You can close the issue; the support team sets the other states.');
  await ref.update({ Status: d.Status, UpdatedAt: new Date().toISOString() });
  return { success: true, Status: d.Status };
});

module.exports._limits = { MAX_FILES, FILE_WINDOW_MS, TYPES, STATUSES };
