// Correction JV (CJV): reclassify a posted entry (owner, 2026-11-07;
// docs/modules/CORRECTION_JV.md, Q415-Q418). A posted GL entry's lines get a
// new account, cost centre, profit centre and / or project through a NEW
// entry: each corrected line's old coding taken out (the opposite side) and
// its new coding, split if wanted, put in (the line's side). The original is
// never changed. New development, hand-written.
//
// A CJV is a journal entry (journalEntries, VoucherType 'CJV') with:
//   CorrectionOfJV, CorrectionOfNumber, CorrectionOfType: the original;
//   Corrections: [{ LineIndex, Parts: [{ AccountCode, CostCenterID,
//     ProfitCenterID, ProjectID, Amount }] }], the user's choice;
//   Lines: the GL lines built from them.
// Its draft is saved here; deleting, posting (with its approval) and
// reversing go through journal.js like a JV's, which calls back here for
// the CJV's own checks under the global lock (assertPostable) and, on any
// reversal, refuses an entry with a live correction (assertNoOpenCorrection).
'use strict';
const { HttpsError } = require('firebase-functions/v2/https');
const { onCallWithMessages } = require('./callable');
const { rtdb, firestore } = require('./firebaseAdmin');
const { requireUser, moduleHasCapability } = require('./auth');
const { userCanAccessCompany, FIRESTORE_JOURNAL_ENTRIES_COLLECTION } = require('./glWriting');

const onCallOptions = { region: 'us-central1' };
const MODULE_ID = 'CJV';
const VOUCHER_TYPE = 'CJV';
const ENTRIES = () => firestore.collection(FIRESTORE_JOURNAL_ENTRIES_COLLECTION);
const round2 = n => Math.round((Number(n) || 0) * 100) / 100;
const text = (v, max) => String(v == null ? '' : v).trim().slice(0, max || 120);
const LIVE = Object.freeze(['Posted', 'PendingApproval']);
const isLive = e => e && LIVE.includes(e.Status) && !e.ReversedByJV;

async function requireCap(user, cap) {
  if (!(await moduleHasCapability(MODULE_ID, cap, user.profile.role))) {
    throw new HttpsError('permission-denied', cap === 'access' ? 'You do not have access to Correction JV.' : 'You do not have permission to create or edit entries in Correction JV.');
  }
}
async function getEntry(id) {
  if (!id) return null;
  const s = await ENTRIES().doc(String(id)).get();
  return s.exists ? Object.assign({ _id: s.id }, s.data()) : null;
}

// The corrections (posted or awaiting approval, not reversed) of an entry.
async function liveCorrectionsOf(originalId) {
  const snap = await ENTRIES().where('CorrectionOfJV', '==', String(originalId)).get();
  return snap.docs.map(d => Object.assign({ _id: d.id }, d.data())).filter(isLive);
}

// For every reversal (journal.js, glWriting): an entry with a live
// correction is reversed only after the correction (Q418), else the
// reversal would take out the old coding a second time.
async function assertNoOpenCorrection(originalId) {
  if (!originalId) return;
  const live = await liveCorrectionsOf(originalId);
  if (live.length) {
    const n = live.map(c => c.JVNumber || 'a correction awaiting approval').join(', ');
    throw new Error('This entry was corrected by ' + n + ': reverse the correction first, then this entry.');
  }
}
// A document's reversal (ReversalOfDocument): its GL entries are the ones
// whose SourceTransactionID is the document.
async function assertDocumentNotCorrected(documentId) {
  if (!documentId) return;
  const snap = await ENTRIES().where('SourceTransactionID', '==', String(documentId)).get();
  for (const d of snap.docs) await assertNoOpenCorrection(d.id);
}

// The accounts whose lines keep their account (the dimensions may change):
// inventory (the stock ledger's value) and tax (the tax reports, from the
// documents). Lines on control accounts and fixed-asset accounts are not
// corrected at all; no line moves to any of these.
async function accountRoles(companyId) {
  const partyLedger = require('./partyLedger');
  const [items, parties, taxDoc, fa] = await Promise.all([
    rtdb.ref('items').get().then(s => s.val() || {}),
    partyLedger.loadParties(),
    firestore.collection('taxConfig').doc(String(companyId)).get(),
    require('./fixedAssetsCommon').controlledAccountIds()
  ]);
  const roles = new Map();
  const set = (id, role) => { if (id && !roles.has(id)) roles.set(id, role); };
  // Every customer's receivables, vendor's payables and the reps' Rep Cash Clearing.
  Object.keys(partyLedger.PARTY_TYPES).forEach(pt => Object.values(parties[pt] || {}).forEach(p => set(p && p[partyLedger.PARTY_TYPES[pt].accountField], 'control')));
  fa.forEach(id => set(id, 'fixedAsset'));
  Object.values(items).forEach(i => set(i && i.InventoryAccountID, 'inventory'));
  const cfg = taxDoc.exists ? taxDoc.data() : null;
  ((cfg && cfg.Components) || []).forEach(c => { set(c.OutputAccountID, 'tax'); set(c.InputAccountID, 'tax'); });
  return roles;
}
const ROLE_TEXT = { control: 'a customer\'s, vendor\'s or sales rep\'s control account', fixedAsset: 'kept by the Fixed Assets module', inventory: 'an inventory account', tax: 'a tax account' };

// Whether a line of the original can be corrected, and how.
function lineRule(line, roles) {
  if (line.PartyType) return { correctable: false, why: 'A customer\'s, vendor\'s or sales rep\'s line is not corrected (a wrong party is fixed with a JV).' };
  const role = roles.get(line.AccountID);
  if (role === 'control' || role === 'fixedAsset') return { correctable: false, why: 'Account ' + line.AccountCode + ' is ' + ROLE_TEXT[role] + '.' };
  if (role) return { correctable: true, accountFixed: true, why: 'Account ' + line.AccountCode + ' is ' + ROLE_TEXT[role] + ': only its cost centre, profit centre and project can change.' };
  return { correctable: true, accountFixed: false };
}

const coding = l => [String(l.AccountCode || ''), l.CostCenterID || '', l.ProfitCenterID || '', l.ProjectID || ''].join('|');

async function originalFor(user, originalId) {
  const o = await getEntry(originalId);
  if (!o) throw new HttpsError('not-found', 'Entry not found.');
  if (!userCanAccessCompany(user.profile, o.CompanyID)) throw new HttpsError('permission-denied', 'You do not have access to that company.');
  if (o.Status !== 'Posted') throw new HttpsError('failed-precondition', o.JVNumber + ' is not posted: only a posted entry is corrected.');
  if (o.ReversedByJV) throw new HttpsError('failed-precondition', o.JVNumber + ' has been reversed.');
  if (o.ReversalOfJV) throw new HttpsError('failed-precondition', o.JVNumber + ' is a reversal: correct the entry it reverses, or post a JV.');
  return o;
}

// The lines already corrected by another live CJV: LineIndex -> its number.
async function takenLines(originalId, exceptId) {
  const out = new Map();
  (await liveCorrectionsOf(originalId)).forEach(c => {
    if (c._id === exceptId) return;
    (c.Corrections || []).forEach(k => out.set(k.LineIndex, c.JVNumber || 'a correction awaiting approval'));
  });
  return out;
}

// The GL lines of a CJV from its corrections, every rule checked.
async function buildLines(original, corrections, exceptId) {
  const roles = await accountRoles(original.CompanyID);
  const taken = await takenLines(original._id, exceptId);
  const coa = (await rtdb.ref('coa').get()).val() || {};
  const byCode = new Map(Object.keys(coa).map(id => [String(coa[id].AccountCode), Object.assign({ AccountID: id }, coa[id])]));
  const seen = new Set();
  const lines = [];
  const clean = [];
  if (!Array.isArray(corrections) || !corrections.length) throw new HttpsError('invalid-argument', 'Choose at least one line to correct.');
  corrections.forEach(k => {
    const idx = Number(k && k.LineIndex);
    const line = (original.Lines || [])[idx];
    const n = 'Line ' + (idx + 1) + ': ';
    if (!line) throw new HttpsError('invalid-argument', 'Line ' + (idx + 1) + ' is not on ' + original.JVNumber + '.');
    if (seen.has(idx)) throw new HttpsError('invalid-argument', n + 'chosen twice.');
    seen.add(idx);
    if (taken.has(idx)) throw new HttpsError('failed-precondition', n + 'already corrected by ' + taken.get(idx) + '. Correct that CJV instead, or reverse it first.');
    const rule = lineRule(line, roles);
    if (!rule.correctable) throw new HttpsError('failed-precondition', n + rule.why);
    const side = Number(line.Debit) > 0 ? 'Debit' : 'Credit';
    const amount = round2(line[side]);
    const parts = (Array.isArray(k.Parts) ? k.Parts : []).map(p => ({
      AccountCode: text(p && p.AccountCode, 40) || String(line.AccountCode),
      CostCenterID: text(p && p.CostCenterID, 80), ProfitCenterID: text(p && p.ProfitCenterID, 80), ProjectID: text(p && p.ProjectID, 80),
      Amount: round2(p && p.Amount)
    }));
    if (!parts.length) throw new HttpsError('invalid-argument', n + 'give its new coding.');
    parts.forEach((p, i) => {
      if (!(p.Amount > 0)) throw new HttpsError('invalid-argument', n + 'part ' + (i + 1) + ' needs an amount above zero.');
      if (rule.accountFixed && p.AccountCode !== String(line.AccountCode)) throw new HttpsError('failed-precondition', n + rule.why);
      const acc = byCode.get(p.AccountCode);
      if (!acc) throw new HttpsError('invalid-argument', n + 'account ' + p.AccountCode + ' not found.');
      const role = roles.get(acc.AccountID);
      if (role && acc.AccountID !== line.AccountID) throw new HttpsError('failed-precondition', n + 'account ' + p.AccountCode + ' is ' + ROLE_TEXT[role] + ': nothing is moved to it.');
    });
    const total = round2(parts.reduce((s, p) => s + p.Amount, 0));
    if (Math.abs(total - amount) > 0.005) throw new HttpsError('invalid-argument', n + 'the parts total ' + total.toFixed(2) + ', the line is ' + amount.toFixed(2) + '.');
    if (parts.every(p => coding(p) === coding(line))) throw new HttpsError('invalid-argument', n + 'its new coding is the same as before.');

    const desc = 'Correction of ' + original.JVNumber + ' line ' + (idx + 1) + (line.Description ? ': ' + line.Description : '');
    const fx = require('./fx');
    lines.push(Object.assign({ AccountCode: line.AccountCode, Debit: line.Credit || 0, Credit: line.Debit || 0, Description: desc,
      CostCenterID: line.CostCenterID || '', ProfitCenterID: line.ProfitCenterID || '', ProjectID: line.ProjectID || '' }, fx.mirrorFc(line)));
    const fcTotal = line.FcCurrency ? round2(line.FcDebit || line.FcCredit) : 0;
    let fcLeft = fcTotal;
    parts.forEach((p, i) => {
      const out = { AccountCode: p.AccountCode, Debit: side === 'Debit' ? p.Amount : 0, Credit: side === 'Credit' ? p.Amount : 0, Description: desc,
        CostCenterID: p.CostCenterID, ProfitCenterID: p.ProfitCenterID, ProjectID: p.ProjectID };
      if (line.FcCurrency) {
        const fc = i === parts.length - 1 ? round2(fcLeft) : round2(fcTotal * p.Amount / amount);
        fcLeft = round2(fcLeft - fc);
        Object.assign(out, { FcCurrency: line.FcCurrency, FcDebit: side === 'Debit' ? fc : 0, FcCredit: side === 'Credit' ? fc : 0, FcRate: Number(line.FcRate) || 0 });
      }
      lines.push(out);
    });
    clean.push({ LineIndex: idx, Parts: parts });
  });
  return { lines, corrections: clean.sort((a, b) => a.LineIndex - b.LineIndex) };
}

// Called by journal.js under the global lock when a CJV is posted or
// approved: the original still posted and unreversed, its lines not
// corrected meanwhile by another CJV, the lines rebuilt the same.
async function assertPostable(cjv, cjvId) {
  const o = await getEntry(cjv.CorrectionOfJV);
  if (!o || o.Status !== 'Posted' || o.ReversedByJV) throw new Error('The entry this corrects (' + (cjv.CorrectionOfNumber || '') + ') is no longer posted.');
  const taken = await takenLines(o._id, cjvId);
  (cjv.Corrections || []).forEach(k => {
    if (taken.has(k.LineIndex)) throw new Error('Line ' + (k.LineIndex + 1) + ' of ' + o.JVNumber + ' was corrected meanwhile by ' + taken.get(k.LineIndex) + '.');
  });
}

// ---------- callables ----------

// The company's CJVs, newest first.
exports.getCorrectionJvs = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  await requireCap(user, 'access');
  const snap = await ENTRIES().where('VoucherType', '==', VOUCHER_TYPE).get();
  const rows = snap.docs.map(d => Object.assign({ _id: d.id }, d.data()))
    .filter(e => userCanAccessCompany(user.profile, e.CompanyID))
    .map(e => ({ _id: e._id, JVNumber: e.JVNumber || '', JVDate: e.JVDate, Description: e.Description, Status: e.Status, CompanyID: e.CompanyID,
      CorrectionOfJV: e.CorrectionOfJV || '', CorrectionOfNumber: e.CorrectionOfNumber || '', TotalDebit: e.TotalDebit || 0,
      ReversedByJV: e.ReversedByJV || '', ReversalOfJV: e.ReversalOfJV || '', CreatedAt: e.CreatedAt || '' }))
    .sort((a, b) => (b.JVDate + b.CreatedAt).localeCompare(a.JVDate + a.CreatedAt));
  return { rows, canDraft: await moduleHasCapability(MODULE_ID, 'draft', user.profile.role), canPost: await moduleHasCapability(MODULE_ID, 'post', user.profile.role) };
});

// A posted entry to correct, by its voucher number in a company: its lines,
// each with whether (and how) it can be corrected.
exports.getEntryForCorrection = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  await requireCap(user, 'access');
  const d = request.data || {};
  let id = text(d.jvId, 80);
  if (!id) {
    const companyId = text(d.companyId, 80);
    const number = text(d.voucherNumber, 60).toUpperCase();
    if (!companyId || !number) throw new HttpsError('invalid-argument', 'Choose the company and type the voucher number.');
    if (!userCanAccessCompany(user.profile, companyId)) throw new HttpsError('permission-denied', 'You do not have access to that company.');
    const snap = await ENTRIES().where('JVNumber', '==', number).get();
    const hits = snap.docs.filter(x => x.data().CompanyID === companyId && !x.data().ReversalOfJV);
    if (!hits.length) throw new HttpsError('not-found', 'No posted entry ' + number + ' in that company.');
    id = hits[0].id;
  }
  const o = await originalFor(user, id);
  const [roles, taken] = await Promise.all([accountRoles(o.CompanyID), takenLines(o._id, text(d.exceptCjvId, 80))]);
  return {
    entry: { _id: o._id, JVNumber: o.JVNumber, JVDate: o.JVDate, Description: o.Description, VoucherType: o.VoucherType || 'JV', CompanyID: o.CompanyID,
      CurrencyCode: o.CurrencyCode || '' },
    lines: (o.Lines || []).map((l, i) => {
      const r = lineRule(l, roles);
      return { LineIndex: i, AccountCode: l.AccountCode, AccountName: l.AccountName || '', Description: l.Description || '', Debit: l.Debit || 0, Credit: l.Credit || 0,
        CostCenterID: l.CostCenterID || '', ProfitCenterID: l.ProfitCenterID || '', ProjectID: l.ProjectID || '', PartyType: l.PartyType || '', PartyName: l.PartyName || '',
        FcCurrency: l.FcCurrency || '', Correctable: r.correctable && !taken.has(i), AccountFixed: !!r.accountFixed,
        Why: taken.has(i) ? 'Already corrected by ' + taken.get(i) + '.' : (r.why || '') };
    })
  };
});

// One CJV with its original's number, for its view.
exports.getCorrectionJv = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  await requireCap(user, 'access');
  const e = await getEntry(text(request.data && request.data.cjvId, 80));
  if (!e || e.VoucherType !== VOUCHER_TYPE) throw new HttpsError('not-found', 'Correction not found.');
  if (!userCanAccessCompany(user.profile, e.CompanyID)) throw new HttpsError('permission-denied', 'You do not have access to that company.');
  return { cjv: e };
});

// Save (create or edit) a CJV draft from an original and its corrections.
exports.saveCorrectionJvDraft = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  await requireCap(user, 'draft');
  const d = request.data || {};
  const cjvId = text(d.cjvId, 80);
  if (cjvId) {
    const ex = await getEntry(cjvId);
    if (!ex || ex.VoucherType !== VOUCHER_TYPE) throw new HttpsError('not-found', 'Correction not found.');
    if (ex.CorrectionOfJV !== text(d.originalId, 80)) throw new HttpsError('invalid-argument', 'A saved correction keeps its original entry.');
  }
  const o = await originalFor(user, text(d.originalId, 80));
  const date = text(d.date, 10) || o.JVDate;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new HttpsError('invalid-argument', 'Give the correction\'s date.');
  const built = await buildLines(o, d.corrections, cjvId);
  const description = text(d.description, 300) || ('Correction of ' + o.JVNumber);
  const journal = require('./journal');
  const r = await journal.saveCorrectionRecord(request, {
    jvId: cjvId, date, description, reference: o.JVNumber, lines: built.lines,
    dimensions: { CurrencyCode: o.CurrencyCode || '', CompanyID: o.CompanyID, DivisionID: o.DivisionID || '', BranchID: o.BranchID || '',
      CostCenterID: o.CostCenterID || '', ProfitCenterID: o.ProfitCenterID || '' },
    extraFields: { VoucherType: VOUCHER_TYPE, CorrectionOfJV: o._id, CorrectionOfNumber: o.JVNumber, CorrectionOfType: o.VoucherType || 'JV', Corrections: built.corrections }
  });
  if (!r || r.success === false) throw new HttpsError('failed-precondition', (r && r.error) || 'The correction could not be saved.');
  return { success: true, cjvId: r.jvId };
});

module.exports.MODULE_ID = MODULE_ID;
module.exports.VOUCHER_TYPE = VOUCHER_TYPE;
module.exports.assertPostable = assertPostable;
module.exports.assertNoOpenCorrection = assertNoOpenCorrection;
module.exports.assertDocumentNotCorrected = assertDocumentNotCorrected;
module.exports.lineRule = lineRule;
