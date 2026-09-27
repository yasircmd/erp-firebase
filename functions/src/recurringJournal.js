// Recurring Journal Entries (roadmap #7, docs/modules/RECURRING_JOURNAL.md).
// New development, hand-written on the PDC model.
//
// A template holds JV-style lines, a schedule (monthly on a day, month
// end, weekly on a weekday, or the Nth weekday of the month, every N) and
// a period (end date or number of runs). Each run date becomes one normal
// GL entry in journalEntries, voucher type RecurringJV (RJV-…), dated the
// run date. Owner's decision: runs are posted by a user ("Post due runs"
// here, or from the Home task), not by a scheduler; "today" is Asia/Dubai.
//
// Amounts: Fixed (the lines, every run) or Spread (the lines are totals;
// what's still unreleased is shared over the open dates, the last one
// taking the rounding — recurringSchedule.installments).
//
// Storage: RTDB recurringJournals/{id}. Status: Draft → PendingApproval /
// Rejected → Active ⇄ Paused (Pause, edit, Resume = activate again, so an
// edit goes through approval too) → Completed (no open dates left) or
// Ended (stopped by a user). Runs/{date} is the run log: Committing →
// Posted / Failed / Skipped / Reversed. History keeps every event.
const { randomUUID } = require('crypto');
const { HttpsError } = require('firebase-functions/v2/https');
const { onCallWithMessages } = require('./callable');
const { rtdb, firestore } = require('./firebaseAdmin');
const { requireUser, moduleHasCapability } = require('./auth');
const {
  userCanAccessCompany, validateAndNormalizeLines, writeStockGlEntry, generateStockVoucherNumber, FIRESTORE_JOURNAL_ENTRIES_COLLECTION
} = require('./glWriting');
const { resolveApprovalScopeKeyForDocument, beginApprovalInstance, recordApprovalDecision } = require('./approvals');
const { withGlobalLock } = require('./lock');
const { attachPartyFields, resolvePartyLines, assertEntryReversible, listPartyAccounts } = require('./partyLedger');
const { assertNoFaControlledAccounts, assertEntryNotCapitalized } = require('./fixedAssetsCommon');
const S = require('./recurringSchedule');

const onCallOptions = { region: 'us-central1' };
const MODULE_ID = 'RECURRINGJV';
const LABEL = 'Recurring Journal Entries';
const PATH = 'recurringJournals';
const VOUCHER_TYPE = 'RecurringJV';
const EDITABLE = ['Draft', 'Rejected', 'Paused'];
const ACTIVATABLE = ['Draft', 'Rejected', 'Paused'];
// Run statuses that close a date: nothing more to post on it.
const CLOSED_RUN = ['Posted', 'Skipped'];
// Most runs one "Post due runs" call posts; the rest wait for the next click.
const MAX_RUNS_PER_CALL = 60;

const round2 = S.round2;
const actorOf = user => user.profile.username || user.uid;
const today = () => S.todayIn(S.TIME_ZONE);

async function requireCap(cap, role) {
  if (await moduleHasCapability(MODULE_ID, cap, role)) return;
  if (cap === 'access') throw new HttpsError('permission-denied', 'You do not have access to ' + LABEL + '.');
  if (cap === 'draft') throw new Error('You do not have permission to create or edit entries in ' + MODULE_ID + '.');
  throw new Error('You do not have permission to activate, post or reverse entries in ' + MODULE_ID + '.');
}

function requireCompany(user, companyId) {
  if (!userCanAccessCompany(user.profile, companyId)) throw new HttpsError('permission-denied', 'You do not have access to that company.');
}

async function load(id) {
  const rec = (await rtdb.ref(PATH + '/' + id).get()).val();
  if (!rec) throw new HttpsError('not-found', 'Recurring entry not found.');
  return rec;
}

async function defaultCurrencyCode() {
  const data = (await rtdb.ref('currencies').get()).val() || {};
  const id = Object.keys(data).find(k => data[k].IsDefault && data[k].Status === 'Active');
  return id ? data[id].Code || '' : '';
}

const runsOf = t => t.Runs || {};

// Every date in the plan: the schedule's, plus any logged date (a date
// posted before an edit stays in the log).
function planDates(t) {
  const set = new Set(S.scheduleDates(t.Schedule));
  Object.keys(runsOf(t)).forEach(d => set.add(d));
  return [...set].sort();
}

function openDates(t) {
  const runs = runsOf(t);
  return planDates(t).filter(d => !CLOSED_RUN.includes((runs[d] || {}).Status));
}

// Per line, what live (Posted) runs have released.
function releasedPerLine(t) {
  const out = (t.Lines || []).map(() => 0);
  Object.values(runsOf(t)).forEach(r => {
    if (r.Status !== 'Posted') return;
    (r.Amounts || []).forEach((a, i) => { if (i < out.length) out[i] = round2(out[i] + (Number(a) || 0)); });
  });
  return out;
}

function runTotal(lines, amounts) {
  return round2((amounts || []).reduce((s, a, i) => s + ((Number(lines[i].Debit) || 0) > 0 ? a : 0), 0));
}

// This template's per-line amounts for each open date.
function amountsOf(t) {
  return S.installments(t.AmountMode, t.Lines || [], releasedPerLine(t), openDates(t), t.SpreadBase);
}
// The spread installment to store after a save, activation or skip.
function baseFor(t) {
  return t.AmountMode === 'Spread' ? S.spreadBase(t.Lines || [], releasedPerLine(t), openDates(t).length) : [];
}

// A date is due when it's open, not waiting for a deliberate re-post
// (Reversed), up to asOf, and the template is Active.
function isDue(t, date, asOf) {
  const r = runsOf(t)[date] || {};
  return t.Status === 'Active' && date <= asOf && !CLOSED_RUN.includes(r.Status) && r.Status !== 'Reversed';
}

// The full plan: one row per date with its status and amount.
function planOf(t, asOf) {
  const runs = runsOf(t);
  const open = openDates(t);
  let amounts = {};
  let planError = '';
  try {
    amounts = amountsOf(t);
  } catch (err) {
    planError = err.message;
  }
  const rows = planDates(t).map(d => {
    const r = runs[d] || {};
    const row = {
      Date: d, Status: r.Status || 'Scheduled', Due: isDue(t, d, asOf),
      Amount: r.Status === 'Posted' || r.Status === 'Committing' ? round2(r.Amount || 0) : (amounts[d] ? runTotal(t.Lines, amounts[d]) : 0),
      JVID: r.JVID || '', JVNumber: r.JVNumber || '', ReversalJVID: r.ReversalJVID || '', ReversalJVNumber: r.ReversalJVNumber || '',
      Error: r.Error || '', Reason: r.Reason || '', By: r.By || '', At: r.At || ''
    };
    if (amounts[d]) row.Amounts = amounts[d];
    return row;
  });
  const due = rows.filter(r => r.Due);
  const next = rows.find(r => r.Status === 'Scheduled' || r.Status === 'Failed');
  return {
    rows: rows, planError: planError,
    summary: {
      RunCount: rows.length, PostedCount: rows.filter(r => r.Status === 'Posted').length,
      DueCount: due.length, FailedCount: rows.filter(r => r.Status === 'Failed').length,
      NextRunDate: t.Status === 'Active' || t.Status === 'Paused' ? (next ? next.Date : '') : '',
      OldestDueDate: due.length ? due[0].Date : '',
      PostedTotal: round2(rows.filter(r => r.Status === 'Posted').reduce((s, r) => s + r.Amount, 0)),
      OpenTotal: round2(rows.filter(r => r.Status !== 'Posted' && r.Status !== 'Skipped').reduce((s, r) => s + r.Amount, 0))
    }
  };
}

// Checks a template's content against live data. Returns the stored lines.
// Used at save, at activation (under the lock) and on final approval.
async function validateTemplate(t, coa) {
  if (!t.CompanyID) throw new HttpsError('invalid-argument', 'Select a Company for this entry.');
  if (!t.Description) throw new HttpsError('invalid-argument', 'Description is required.');
  if (!['Fixed', 'Spread'].includes(t.AmountMode)) throw new HttpsError('invalid-argument', 'Choose the amount mode: fixed per run, or spread a total.');
  t.Schedule = S.normalizeSchedule(t.Schedule);

  const raw = (t.Lines || []).map(l => Object.assign({}, l, {
    CostCenterID: l.CostCenterID || t.CostCenterID || '', ProfitCenterID: l.ProfitCenterID || t.ProfitCenterID || ''
  }));
  raw.forEach(l => { delete l.Allocations; });
  const normalized = validateAndNormalizeLines(raw, coa, t.CompanyID);
  if (normalized.lines.length < 2) throw new Error('A journal entry needs at least two lines.');
  if (normalized.totalDebit === 0) throw new Error('Entry has no amounts.');
  if (Math.abs(normalized.totalDebit - normalized.totalCredit) > 0.005) {
    throw new Error('Entry is not balanced: total debit ' + normalized.totalDebit.toFixed(2) + ' vs total credit ' + normalized.totalCredit.toFixed(2) + '.');
  }
  await assertNoFaControlledAccounts(normalized.lines);
  // Vendor/customer lines: tagged, and posted as a New Ref each run (owner).
  const party = await resolvePartyLines(attachPartyFields(raw, normalized.lines), t.CompanyID);
  const lines = party.lines.map(l => {
    const out = {
      LineNo: l.LineNo, AccountID: l.AccountID, AccountCode: String(l.AccountCode), AccountName: l.AccountName || '',
      Description: l.Description, Debit: l.Debit, Credit: l.Credit, CostCenterID: l.CostCenterID || '', ProfitCenterID: l.ProfitCenterID || ''
    };
    if (l.PartyType) Object.assign(out, { PartyType: l.PartyType, PartyID: l.PartyID, PartyName: l.PartyName || '' });
    return out;
  });

  // What the log already holds must survive the edit.
  const runs = runsOf(t);
  const logged = Object.keys(runs).filter(d => ['Posted', 'Skipped', 'Reversed', 'Committing'].includes(runs[d].Status));
  const inSchedule = new Set(S.scheduleDates(t.Schedule));
  const lost = logged.filter(d => !inSchedule.has(d)).sort();
  if (lost.length) {
    throw new Error('The schedule no longer includes ' + lost[0] + ', which is already ' + runs[lost[0]].Status.toLowerCase() + ' — keep it in the period.');
  }
  if (t.AmountMode === 'Spread' && Object.values(runs).some(r => r.Status === 'Posted' || r.Status === 'Committing')) {
    const before = lineKeys(t.PreviousLines || []);
    const after = lineKeys(lines);
    if (before.length && before.join('\n') !== after.join('\n')) {
      throw new Error('Runs of this spread entry have been posted: its lines\' accounts and sides can no longer change (the amounts and the period can).');
    }
  }
  const check = Object.assign({}, t, { Lines: lines, SpreadBase: null });
  amountsOf(check);
  return { lines: lines, totalDebit: normalized.totalDebit, totalCredit: normalized.totalCredit };
}

// A line's identity for a spread entry: account, side and party.
function lineKeys(lines) {
  return lines.map(l => [l.AccountID, (Number(l.Debit) || 0) > 0 ? 'Dr' : 'Cr', l.PartyType || '', l.PartyID || ''].join('|'));
}
const lineText = lines => (lines || []).map(l => [l.AccountCode, Number(l.Debit) || 0, Number(l.Credit) || 0, l.Description || '',
  l.CostCenterID || '', l.ProfitCenterID || '', l.PartyID || ''].join('|')).join('\n');

function historyWith(t, event, user, extra) {
  return (t.History || []).concat([Object.assign({ Event: event, At: new Date().toISOString(), By: actorOf(user) }, extra || {})]);
}

// ---------- callables ----------

// What the entry screen needs for one company: its postable accounts and
// the vendor/customer control accounts (a line on one names its party).
exports.getRecurringJournalSetup = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  await requireCap('access', user.profile.role);
  const companyId = String(request.data && request.data.companyId || '').trim();
  if (!companyId) return { accounts: [], parties: [] };
  requireCompany(user, companyId);
  const coa = (await rtdb.ref('coa').get()).val() || {};
  return {
    accounts: Object.keys(coa)
      .filter(id => coa[id].Status === 'Active' && coa[id].IsPostable === true && (!coa[id].CompanyID || coa[id].CompanyID === companyId))
      .map(id => ({ AccountID: id, AccountCode: String(coa[id].AccountCode), AccountName: coa[id].AccountName || '', AccountType: coa[id].AccountType || '' }))
      .sort((a, b) => a.AccountCode.localeCompare(b.AccountCode, undefined, { numeric: true })),
    parties: (await listPartyAccounts(companyId)).filter(p => p.Status === 'Active')
  };
});

exports.getRecurringJournals = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  await requireCap('access', user.profile.role);
  const data = (await rtdb.ref(PATH).get()).val() || {};
  const asOf = today();
  const entries = Object.keys(data)
    .map(id => Object.assign({ TemplateID: id }, data[id]))
    .filter(t => userCanAccessCompany(user.profile, t.CompanyID))
    .map(t => {
      let summary = {};
      try { summary = planOf(t, asOf).summary; } catch (err) { summary = { PlanError: err.message }; }
      const out = Object.assign({}, t, summary);
      delete out.Runs; delete out.History;
      return out;
    })
    .sort((a, b) => (b.CreatedAt || '').localeCompare(a.CreatedAt || ''));
  return { entries: entries, today: asOf };
});

// One template with its full plan and history (the entry screen). Also
// takes the GL entry ID of a run or its reversal (GL Report drill-through).
exports.getRecurringJournal = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  await requireCap('access', user.profile.role);
  let id = String(request.data && request.data.templateId || '').trim();
  if (id && !(await rtdb.ref(PATH + '/' + id).get()).exists()) {
    const gl = await firestore.collection(FIRESTORE_JOURNAL_ENTRIES_COLLECTION).doc(id).get();
    if (gl.exists && gl.data().RecurringTemplateID) id = gl.data().RecurringTemplateID;
  }
  const t = await load(id);
  requireCompany(user, t.CompanyID);
  const plan = planOf(t, today());
  return Object.assign({}, t, { TemplateID: id, Plan: plan.rows, PlanError: plan.planError, today: today() }, plan.summary);
});

// The screen's live preview: the plan of what's in the form (merged with
// the saved template's run log when editing one). Validates the schedule
// and amounts only, not the accounts.
exports.previewRecurringJournal = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  await requireCap('access', user.profile.role);
  const d = request.data || {};
  const id = String(d.TemplateID || '').trim();
  const saved = id ? await load(id) : {};
  if (id) requireCompany(user, saved.CompanyID);
  const lines = (d.Lines || []).map(l => ({ Debit: round2(Number(l.Debit) || 0), Credit: round2(Number(l.Credit) || 0) }))
    .filter(l => l.Debit > 0 || l.Credit > 0);
  const t = {
    Status: saved.Status || 'Draft', AmountMode: d.AmountMode === 'Spread' ? 'Spread' : 'Fixed',
    Schedule: S.normalizeSchedule(d.Schedule), Lines: lines, Runs: saved.Runs || {}
  };
  t.SpreadBase = baseFor(t); // as it would be stored on save
  const plan = planOf(t, today());
  return {
    rows: plan.rows.map(r => ({ Date: r.Date, Status: r.Status, Amount: r.Amount, JVNumber: r.JVNumber })),
    planError: plan.planError, scheduleText: S.describeSchedule(t.Schedule), today: today(), summary: plan.summary
  };
});

exports.saveRecurringJournalDraft = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  await requireCap('draft', user.profile.role);
  const d = request.data || {};
  const id = String(d.TemplateID || '').trim();
  let existing = null;
  if (id) {
    existing = await load(id);
    requireCompany(user, existing.CompanyID);
    if (!EDITABLE.includes(existing.Status)) {
      throw new HttpsError('failed-precondition', existing.Status === 'Active'
        ? 'Pause this recurring entry before editing it.' : 'Only draft, rejected or paused recurring entries can be edited.');
    }
  }
  const companyId = String(d.CompanyID || '').trim();
  if (!companyId) throw new HttpsError('invalid-argument', 'Select a Company for this entry.');
  requireCompany(user, companyId);
  if (existing && existing.TemplateNumber && existing.CompanyID !== companyId) {
    throw new HttpsError('failed-precondition', 'The company of an activated recurring entry can\'t change.');
  }
  const t = {
    CompanyID: companyId,
    DivisionID: String(d.DivisionID || '').trim(), BranchID: String(d.BranchID || '').trim(),
    CostCenterID: String(d.CostCenterID || '').trim(), ProfitCenterID: String(d.ProfitCenterID || '').trim(),
    Description: String(d.Description || '').trim(), Reference: String(d.Reference || '').trim(),
    AmountMode: String(d.AmountMode || '').trim(), Schedule: d.Schedule || {},
    Lines: (d.Lines || []).map(l => ({
      AccountCode: String(l.AccountCode || '').trim(), Description: String(l.Description || '').trim(),
      Debit: l.Debit, Credit: l.Credit, CostCenterID: String(l.CostCenterID || '').trim(), ProfitCenterID: String(l.ProfitCenterID || '').trim(),
      PartyType: String(l.PartyType || '').trim(), PartyID: String(l.PartyID || '').trim()
    })).filter(l => l.AccountCode),
    Runs: existing ? existing.Runs || {} : {}, PreviousLines: existing ? existing.Lines || [] : []
  };
  if (!t.Lines.length) throw new HttpsError('invalid-argument', 'Add the entry\'s lines.');
  const coa = (await rtdb.ref('coa').get()).val() || {};
  const v = await validateTemplate(t, coa);

  const now = new Date().toISOString();
  const fields = {
    CompanyID: t.CompanyID, DivisionID: t.DivisionID, BranchID: t.BranchID, CostCenterID: t.CostCenterID, ProfitCenterID: t.ProfitCenterID,
    Description: t.Description, Reference: t.Reference, AmountMode: t.AmountMode, Schedule: t.Schedule,
    ScheduleText: S.describeSchedule(t.Schedule), Lines: v.lines, TotalDebit: v.totalDebit, TotalCredit: v.totalCredit,
    SpreadBase: baseFor(Object.assign({}, t, { Lines: v.lines })),
    CurrencyCode: (existing && existing.CurrencyCode) || await defaultCurrencyCode(),
    UpdatedAt: now, UpdatedBy: actorOf(user)
  };
  if (existing) {
    // Changes to a template that has run are logged (owner).
    if (existing.TemplateNumber) {
      const changed = ['Description', 'Reference', 'AmountMode', 'ScheduleText', 'TotalDebit', 'CostCenterID', 'ProfitCenterID', 'DivisionID', 'BranchID']
        .filter(k => String(existing[k] || '') !== String(fields[k] || ''))
        .map(k => k + ': ' + (existing[k] || '—') + ' → ' + (fields[k] || '—'));
      if (lineText(existing.Lines) !== lineText(v.lines)) changed.push('lines changed');
      if (changed.length) fields.History = historyWith(existing, 'Edited', user, { Note: changed.join('; ') });
    }
    await rtdb.ref(PATH + '/' + id).update(fields);
    return { success: true, templateId: id };
  }
  const newId = 'RJ-' + randomUUID().split('-')[0].toUpperCase();
  await rtdb.ref(PATH + '/' + newId).set(Object.assign(fields, {
    Status: 'Draft', TemplateNumber: '', Runs: {}, History: [], CreatedAt: now, CreatedBy: actorOf(user)
  }));
  return { success: true, templateId: newId };
});

exports.deleteRecurringJournalDraft = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  await requireCap('draft', user.profile.role);
  const id = String(request.data && request.data.templateId || '').trim();
  const t = await load(id);
  requireCompany(user, t.CompanyID);
  if (t.Status !== 'Draft' || t.TemplateNumber) throw new HttpsError('failed-precondition', 'Only a draft that was never activated can be deleted. End it instead.');
  await rtdb.ref(PATH + '/' + id).set(null);
  return { success: true };
});

// Re-checks everything from live data and makes the template Active.
// Caller holds the global lock.
async function commitActivation(user, id, t, event) {
  const coa = (await rtdb.ref('coa').get()).val() || {};
  const v = await validateTemplate(Object.assign(t, { PreviousLines: t.Lines }), coa);
  const now = new Date().toISOString();
  const open = openDates(Object.assign({}, t, { Lines: v.lines }));
  const status = open.length ? 'Active' : 'Completed';
  await rtdb.ref(PATH + '/' + id).update({
    Status: status, Lines: v.lines, Schedule: t.Schedule, RejectionReason: '',
    SpreadBase: baseFor(Object.assign({}, t, { Lines: v.lines })),
    ActivatedAt: now, ActivatedBy: actorOf(user), UpdatedAt: now, UpdatedBy: actorOf(user),
    History: historyWith(t, event, user)
  });
  return status;
}

// Activate a draft, resubmit a rejected one, or resume a paused one. The
// optional approval gate (Approval Config) applies to each.
exports.activateRecurringJournal = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  const id = String(request.data && request.data.templateId || '').trim();
  return withGlobalLock(user.uid, async () => {
    const t = await load(id);
    requireCompany(user, t.CompanyID);
    await requireCap('post', user.profile.role);
    if (!ACTIVATABLE.includes(t.Status)) throw new HttpsError('failed-precondition', 'Only a draft, rejected or paused recurring entry can be activated.');
    const coa = (await rtdb.ref('coa').get()).val() || {};
    const v = await validateTemplate(Object.assign(t, { PreviousLines: t.Lines }), coa);
    const lines = v.lines;
    const probe = Object.assign({}, t, { Lines: lines });
    if (!openDates(probe).length) throw new Error('This recurring entry has no dates left to post.');

    const now = new Date().toISOString();
    let number = t.TemplateNumber || '';
    if (!number) number = await generateStockVoucherNumber('RJT', Number(t.Schedule.StartDate.substring(0, 4)), t.CompanyID);
    const event = t.Status === 'Paused' ? 'Resumed' : 'Activated';
    const plan = planOf(Object.assign({}, probe, { Status: 'Active' }), today());
    const scopeKey = await resolveApprovalScopeKeyForDocument(MODULE_ID, {
      CompanyID: t.CompanyID, DivisionID: t.DivisionID, BranchID: t.BranchID, CostCenterID: t.CostCenterID
    });
    const approval = await beginApprovalInstance(MODULE_ID, id, number, scopeKey, plan.summary.OpenTotal, user.uid);
    await rtdb.ref(PATH + '/' + id).update({ TemplateNumber: number });
    if (approval.required) {
      await rtdb.ref(PATH + '/' + id).update({
        Status: 'PendingApproval', ApprovalInstanceID: approval.instanceId, RejectionReason: '', PendingEvent: event,
        SubmittedAt: now, SubmittedBy: actorOf(user), UpdatedAt: now, UpdatedBy: actorOf(user),
        History: historyWith(t, 'Submitted for approval', user)
      });
      return { success: true, status: 'PendingApproval', templateNumber: number };
    }
    const status = await commitActivation(user, id, Object.assign({}, t, { TemplateNumber: number }), event);
    return { success: true, status: status, templateNumber: number };
  });
});

exports.decideRecurringJournalApproval = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  const d = request.data || {};
  const id = String(d.templateId || '').trim();
  return withGlobalLock(user.uid, async () => {
    const t = await load(id);
    await requireCap('post', user.profile.role);
    requireCompany(user, t.CompanyID);
    if (t.Status !== 'PendingApproval') throw new HttpsError('failed-precondition', 'This recurring entry is not awaiting approval.');
    if (!t.ApprovalInstanceID) throw new HttpsError('failed-precondition', 'No approval record found for this recurring entry.');
    const result = await recordApprovalDecision(user, t.ApprovalInstanceID, d.levelNumber, d.decision, d.reason);
    const now = new Date().toISOString();
    if (result.status === 'Approved') {
      try {
        const status = await commitActivation(user, id, t, (t.PendingEvent || 'Activated') + ' (approved)');
        return { success: true, status: 'Approved', templateStatus: status, selfApproved: result.selfApproved };
      } catch (err) {
        // As PDC: undo the decision and hand the template back for editing.
        const instance = (await rtdb.ref('approvalInstances/' + t.ApprovalInstanceID).get()).val();
        if (instance) {
          await rtdb.ref('approvalInstances/' + t.ApprovalInstanceID).update({
            Decisions: (instance.Decisions || []).filter(x => x.LevelNumber !== d.levelNumber), Status: 'Pending', UpdatedAt: now
          });
        }
        await rtdb.ref(PATH + '/' + id).update({
          Status: 'Rejected', RejectionReason: 'Activation failed: ' + err.message + ' — please fix and resubmit.', UpdatedAt: now, UpdatedBy: actorOf(user)
        });
        throw new Error('Activation failed: ' + err.message + ' The recurring entry has been returned to an editable state — fix the issue and resubmit.');
      }
    }
    if (result.status === 'Rejected') {
      await rtdb.ref(PATH + '/' + id).update({
        Status: 'Rejected', RejectionReason: String(d.reason || '').trim(), UpdatedAt: now, UpdatedBy: actorOf(user),
        History: historyWith(t, 'Rejected', user, { Note: String(d.reason || '').trim() })
      });
    }
    return { success: true, status: result.status, selfApproved: result.selfApproved };
  });
});

async function setStatus(request, from, to, event, needReason) {
  const user = await requireUser(request);
  const d = request.data || {};
  const id = String(d.templateId || '').trim();
  const reason = String(d.reason || '').trim();
  if (needReason && !reason) throw new HttpsError('invalid-argument', 'A reason is required.');
  return withGlobalLock(user.uid, async () => {
    const t = await load(id);
    requireCompany(user, t.CompanyID);
    await requireCap('post', user.profile.role);
    if (!from.includes(t.Status)) throw new HttpsError('failed-precondition', 'This recurring entry is ' + t.Status + ': it can\'t be ' + event.toLowerCase() + '.');
    const now = new Date().toISOString();
    const fields = { Status: to, UpdatedAt: now, UpdatedBy: actorOf(user), History: historyWith(t, event, user, reason ? { Note: reason } : {}) };
    if (to === 'Ended') Object.assign(fields, { EndedAt: now, EndedBy: actorOf(user), EndReason: reason });
    await rtdb.ref(PATH + '/' + id).update(fields);
    return { success: true, status: to };
  });
}

exports.pauseRecurringJournal = onCallWithMessages(onCallOptions, request => setStatus(request, ['Active'], 'Paused', 'Paused', false));
// Ending stops the template for good; posted runs stay (reverse them if needed).
exports.endRecurringJournal = onCallWithMessages(onCallOptions, request => setStatus(request, ['Active', 'Paused', 'Rejected'], 'Ended', 'Ended', true));

// ---------- runs ----------

function dimsOf(t) {
  return {
    CurrencyCode: t.CurrencyCode || '', CompanyID: t.CompanyID, DivisionID: t.DivisionID || '', BranchID: t.BranchID || '',
    CostCenterID: t.CostCenterID || '', ProfitCenterID: t.ProfitCenterID || ''
  };
}

// The live GL entry a run posted, if any (finds one whose marker was left
// at Committing by a call that died after writing it).
async function findRunEntry(id, date) {
  const snap = await firestore.collection(FIRESTORE_JOURNAL_ENTRIES_COLLECTION).where('SourceTransactionID', '==', id).get();
  const hit = snap.docs.find(doc => {
    const e = doc.data();
    return e.VoucherType === VOUCHER_TYPE && e.RecurringRunDate === date && !e.ReversalOfJV && !e.ReversedByJV;
  });
  return hit ? Object.assign({ _id: hit.id }, hit.data()) : null;
}

// Posts one run date. Takes the global lock itself (one run per
// acquisition, so a long catch-up never holds it for long). mode 'due'
// posts a due date; 'repost' posts a Reversed one again. Returns
// { Status, JVNumber, Error }; a validation failure is logged on the run
// as Failed, not thrown.
async function postRun(user, id, date, mode) {
  return withGlobalLock(user.uid, async () => {
    const t = await load(id);
    requireCompany(user, t.CompanyID);
    const runRef = rtdb.ref(PATH + '/' + id + '/Runs/' + date);
    const prior = runsOf(t)[date] || {};
    const actor = actorOf(user);
    if (prior.Status === 'Posted') {
      if (mode === 'repost') throw new HttpsError('failed-precondition', 'The run of ' + date + ' is Posted.');
      return { Status: 'Posted', JVNumber: prior.JVNumber, Already: true };
    }
    if (prior.Status === 'Committing') {
      const entry = await findRunEntry(id, date);
      if (entry) {
        await runRef.set({ Status: 'Posted', JVID: entry._id, JVNumber: entry.JVNumber, Amount: entry.TotalDebit, Amounts: prior.Amounts || [], At: new Date().toISOString(), By: actor });
        await completeIfDone(id, user);
        return { Status: 'Posted', JVNumber: entry.JVNumber, JVID: entry._id, Recovered: true };
      }
    }
    if (t.Status !== 'Active') throw new HttpsError('failed-precondition', 'This recurring entry is ' + t.Status + ': only an Active one posts runs.');
    if (date > today()) throw new HttpsError('failed-precondition', date + ' is in the future: a run is posted on or after its date.');
    if (!planDates(t).includes(date)) throw new HttpsError('failed-precondition', date + ' is not a run date of this recurring entry.');
    const allowed = mode === 'repost' ? prior.Status === 'Reversed' : (isDue(t, date, today()) || prior.Status === 'Committing');
    if (!allowed) throw new HttpsError('failed-precondition', 'The run of ' + date + ' is ' + (prior.Status || 'not due') + '.');

    const fail = async (message) => {
      await runRef.set(Object.assign({}, prior, { Status: 'Failed', Error: message, At: new Date().toISOString(), By: actor, AttemptID: '' }));
      return { Status: 'Failed', Error: message };
    };
    let amounts;
    let glLines;
    let partyFields;
    try {
      amounts = amountsOf(t)[date];
      if (!amounts || amounts.every(a => !(a > 0))) {
        await runRef.set({ Status: 'Skipped', Reason: 'Nothing left to post on this date.', At: new Date().toISOString(), By: actor });
        await completeIfDone(id, user);
        return { Status: 'Skipped' };
      }
      const raw = t.Lines.map((l, i) => ({ l: l, a: amounts[i] })).filter(x => x.a > 0).map(({ l, a }) => {
        const out = {
          AccountCode: l.AccountCode, Debit: (l.Debit || 0) > 0 ? a : 0, Credit: (l.Debit || 0) > 0 ? 0 : a,
          Description: S.expandText(l.Description, date), CostCenterID: l.CostCenterID || '', ProfitCenterID: l.ProfitCenterID || ''
        };
        if (l.PartyType) Object.assign(out, { PartyType: l.PartyType, PartyID: l.PartyID });
        return out;
      });
      // The same checks as posting a JV, against live data.
      const coa = (await rtdb.ref('coa').get()).val() || {};
      const normalized = validateAndNormalizeLines(raw, coa, t.CompanyID);
      await assertNoFaControlledAccounts(normalized.lines);
      const party = await resolvePartyLines(attachPartyFields(raw, normalized.lines), t.CompanyID);
      glLines = party.lines;
      partyFields = party.fields;
    } catch (err) {
      return fail(String(err.message || err));
    }

    const attemptId = randomUUID();
    await runRef.set({ Status: 'Committing', AttemptID: attemptId, Amounts: amounts, At: new Date().toISOString(), By: actor });
    let gl;
    try {
      gl = await writeStockGlEntry(user, VOUCHER_TYPE, date, S.expandText(t.Description, date), t.Reference || t.TemplateNumber, glLines, dimsOf(t),
        Object.assign({
          SourceTransactionID: id, RecurringTemplateID: id, RecurringTemplateNumber: t.TemplateNumber || '', RecurringRunDate: date,
          CommitAttemptID: attemptId, ReversalOfJV: ''
        }, partyFields));
    } catch (err) {
      return fail(String(err.message || err));
    }
    const now = new Date().toISOString();
    await runRef.set({ Status: 'Posted', JVID: gl.jvId, JVNumber: gl.jvNumber, Amount: runTotal(t.Lines, amounts), Amounts: amounts, At: now, By: actor });
    await rtdb.ref(PATH + '/' + id + '/History').set(historyWith(t, mode === 'repost' ? 'Run posted again' : 'Run posted', user, { Date: date, JVID: gl.jvId, JVNumber: gl.jvNumber }));
    await completeIfDone(id, user);
    return { Status: 'Posted', JVNumber: gl.jvNumber, JVID: gl.jvId };
  });
}

// An Active template with no open dates left is Completed.
async function completeIfDone(id, user) {
  const t = await load(id);
  if (t.Status === 'Active' && !openDates(t).length) {
    const now = new Date().toISOString();
    await rtdb.ref(PATH + '/' + id).update({ Status: 'Completed', UpdatedAt: now, UpdatedBy: actorOf(user), History: historyWith(t, 'Completed', user) });
  }
}

// "Post due runs": every due date up to upTo (default and maximum: today
// in Asia/Dubai) of the given templates, or of every Active template in
// the user's companies. Oldest first; a failed run doesn't stop the rest.
exports.postRecurringJournalRuns = onCallWithMessages(Object.assign({ timeoutSeconds: 300 }, onCallOptions), async (request) => {
  const user = await requireUser(request);
  await requireCap('post', user.profile.role);
  const d = request.data || {};
  const now = today();
  const upTo = String(d.upTo || '').trim() || now;
  if (!S.isDate(upTo)) throw new HttpsError('invalid-argument', 'Post up to: enter a valid date.');
  if (upTo > now) throw new HttpsError('invalid-argument', 'Runs can\'t be posted ahead of their date (today is ' + now + ').');
  const ids = (d.templateIds || []).map(x => String(x || '').trim()).filter(Boolean);
  const all = (await rtdb.ref(PATH).get()).val() || {};
  const templates = (ids.length ? ids : Object.keys(all))
    .filter(id => all[id] && all[id].Status === 'Active' && userCanAccessCompany(user.profile, all[id].CompanyID));
  if (ids.length && !templates.length) throw new HttpsError('failed-precondition', 'Only an Active recurring entry posts runs.');

  const queue = [];
  templates.forEach(id => {
    const t = all[id];
    planDates(t).filter(date => isDue(t, date, upTo) || ((runsOf(t)[date] || {}).Status === 'Committing' && date <= upTo))
      .forEach(date => queue.push({ id: id, date: date, number: t.TemplateNumber || '' }));
  });
  queue.sort((a, b) => (a.date + a.number).localeCompare(b.date + b.number));
  const results = [];
  for (const q of queue.slice(0, MAX_RUNS_PER_CALL)) {
    let r;
    try {
      r = await postRun(user, q.id, q.date, 'due');
    } catch (err) {
      r = { Status: 'Failed', Error: String(err.message || err) };
    }
    results.push(Object.assign({ TemplateID: q.id, TemplateNumber: q.number, Date: q.date }, r));
  }
  return {
    success: true, results: results, remaining: Math.max(0, queue.length - MAX_RUNS_PER_CALL),
    posted: results.filter(r => r.Status === 'Posted').length, failed: results.filter(r => r.Status === 'Failed').length
  };
});

// Post one Reversed run again.
exports.repostRecurringJournalRun = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  await requireCap('post', user.profile.role);
  const d = request.data || {};
  const r = await postRun(user, String(d.templateId || '').trim(), String(d.date || '').trim(), 'repost');
  if (r.Status === 'Failed') throw new Error(r.Error);
  return Object.assign({ success: true }, r);
});

// Skip one open date (it won't be posted). A spread entry's amount moves
// to its other open dates, so its last open date can't be skipped.
exports.skipRecurringJournalRun = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  const d = request.data || {};
  const id = String(d.templateId || '').trim();
  const date = String(d.date || '').trim();
  const reason = String(d.reason || '').trim();
  if (!reason) throw new HttpsError('invalid-argument', 'A reason is required.');
  return withGlobalLock(user.uid, async () => {
    const t = await load(id);
    requireCompany(user, t.CompanyID);
    await requireCap('post', user.profile.role);
    if (!['Active', 'Paused'].includes(t.Status)) throw new HttpsError('failed-precondition', 'Only an Active or Paused recurring entry can skip a run.');
    const open = openDates(t);
    if (!open.includes(date) || (runsOf(t)[date] || {}).Status === 'Committing') throw new HttpsError('failed-precondition', 'The run of ' + date + ' is not open.');
    if (t.AmountMode === 'Spread' && open.length === 1) {
      const left = releasedPerLine(t).some((r, i) => S.lineAmount(t.Lines[i]) - r > 0.005);
      if (left) throw new Error('This is the last open date of a spread entry: skipping it would leave part of the total unposted. End the entry instead.');
    }
    const now = new Date().toISOString();
    const prior = runsOf(t)[date] || {};
    await rtdb.ref(PATH + '/' + id + '/Runs/' + date).set(Object.assign({}, prior, { Status: 'Skipped', Reason: reason, Error: '', At: now, By: actorOf(user) }));
    await rtdb.ref(PATH + '/' + id + '/History').set(historyWith(t, 'Run skipped', user, { Date: date, Note: reason }));
    // A spread entry's skipped amount is re-spread over its other open dates.
    const runs = Object.assign({}, runsOf(t), { [date]: { Status: 'Skipped' } });
    await rtdb.ref(PATH + '/' + id + '/SpreadBase').set(baseFor(Object.assign({}, t, { Runs: runs })));
    await completeIfDone(id, user);
    return { success: true };
  });
});

// Reverse a posted run (a mirror entry, as the JV reversal). The date
// then waits for a deliberate re-post, or a skip.
exports.reverseRecurringJournalRun = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  const d = request.data || {};
  const id = String(d.templateId || '').trim();
  const date = String(d.date || '').trim();
  const reason = String(d.reason || '').trim();
  const reversalDate = String(d.reversalDate || '').trim();
  if (!reason) throw new HttpsError('invalid-argument', 'A reason is required.');
  if (!S.isDate(reversalDate)) throw new HttpsError('invalid-argument', 'Reversal date is required.');
  return withGlobalLock(user.uid, async () => {
    const t = await load(id);
    requireCompany(user, t.CompanyID);
    await requireCap('post', user.profile.role);
    const run = runsOf(t)[date] || {};
    if (run.Status !== 'Posted' || !run.JVID) throw new HttpsError('failed-precondition', 'Only a posted run can be reversed.');
    if (reversalDate < date) throw new Error('The reversal date is before the run date ' + date + '.');
    const glRef = firestore.collection(FIRESTORE_JOURNAL_ENTRIES_COLLECTION).doc(run.JVID);
    const glDoc = await glRef.get();
    if (!glDoc.exists) throw new Error('The GL entry of this run was not found.');
    const entry = glDoc.data();
    if (entry.ReversedByJV) throw new Error('That GL entry has already been reversed.');
    await assertEntryReversible(run.JVID, entry);
    await assertEntryNotCapitalized(run.JVID);

    const description = 'Reversal of ' + entry.JVNumber + ' — ' + reason;
    const lines = (entry.Lines || []).map(l => {
      const out = {
        AccountCode: l.AccountCode, Debit: l.Credit || 0, Credit: l.Debit || 0, Description: l.Description || description,
        CostCenterID: l.CostCenterID || '', ProfitCenterID: l.ProfitCenterID || ''
      };
      if (l.PartyType) Object.assign(out, { PartyType: l.PartyType, PartyID: l.PartyID, PartyName: l.PartyName || '', Allocations: [] });
      return out;
    });
    const gl = await writeStockGlEntry(user, VOUCHER_TYPE, reversalDate, description, entry.JVNumber, lines, dimsOf(t), {
      SourceTransactionID: id, RecurringTemplateID: id, RecurringTemplateNumber: t.TemplateNumber || '', RecurringRunDate: date,
      ReversalOfJV: run.JVID, PartyKeys: entry.PartyKeys || [], AllocatedRefs: [], AllocatedRefTypes: []
    });
    const now = new Date().toISOString();
    await glRef.update({ ReversedByJV: gl.jvId, UpdatedAt: now, UpdatedBy: actorOf(user) });
    await rtdb.ref(PATH + '/' + id + '/Runs/' + date).set(Object.assign({}, run, {
      Status: 'Reversed', ReversalJVID: gl.jvId, ReversalJVNumber: gl.jvNumber, ReversalDate: reversalDate, Reason: reason, At: now, By: actorOf(user)
    }));
    const fields = { History: historyWith(t, 'Run reversed', user, { Date: date, JVID: gl.jvId, JVNumber: gl.jvNumber, Note: reason }), UpdatedAt: now, UpdatedBy: actorOf(user) };
    // A Completed entry has an open date again.
    if (t.Status === 'Completed') fields.Status = 'Active';
    await rtdb.ref(PATH + '/' + id).update(fields);
    return { success: true, reversalNumber: gl.jvNumber };
  });
});

// Home: Active templates with runs due today (Asia/Dubai), for users who
// can post them.
exports.getRecurringJournalsDueForUser = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  if (!(await moduleHasCapability(MODULE_ID, 'post', user.profile.role))) return [];
  const data = (await rtdb.ref(PATH).get()).val() || {};
  const asOf = today();
  const out = [];
  Object.keys(data).forEach(id => {
    const t = data[id];
    if (t.Status !== 'Active' || !userCanAccessCompany(user.profile, t.CompanyID)) return;
    let s;
    try { s = planOf(t, asOf).summary; } catch (err) { return; }
    if (!s.DueCount) return;
    out.push({
      ModuleID: MODULE_ID, ModuleLabel: LABEL, DocumentID: id, DocumentNumber: t.TemplateNumber || '', Description: t.Description || '',
      DueCount: s.DueCount, FailedCount: s.FailedCount, OldestDueDate: s.OldestDueDate
    });
  });
  return out.sort((a, b) => (a.OldestDueDate + a.DocumentNumber).localeCompare(b.OldestDueDate + b.DocumentNumber));
});
