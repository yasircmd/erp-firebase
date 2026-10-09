// HR Payroll, step 7c: the Provisions module (owner, 2026-10-09;
// docs/modules/HR_PAYROLL.md, step 7, point 9 and decisions 58, 60-63).
//   - A statement for a company and a period: each employee's gratuity,
//     leave salary and accruals: opening, accrued, released, utilised,
//     closing; each row's movements; the provision accounts' GL balances.
//   - Openings entered on screen as well as imported; claims (moved from
//     Payroll, same callables in payrollProvisions.js).
// Payroll's rights (decision 60): Payroll access sees it, Payroll's "pay"
// records claims, Payroll Setup's "write" the openings. The module itself
// has only "access", for its menu entry.
'use strict';

const { HttpsError } = require('firebase-functions/v2/https');
const { onCallWithMessages } = require('./callable');
const { rtdb, firestore } = require('./firebaseAdmin');
const { requireUser, moduleHasCapability } = require('./auth');
const { userCanAccessCompany, FIRESTORE_JOURNAL_ENTRIES_COLLECTION } = require('./glWriting');
const P = require('./payrollProvisions');

const onCallOptions = { region: 'us-central1' };
const { text, bad, round2, isMonth, docs, keyOf } = P;
const RUNS = () => firestore.collection('payrollRuns');
const SETTLEMENTS = () => firestore.collection('payrollSettlements');
const monthEnd = m => { const [y, mo] = m.split('-').map(Number); return m + '-' + String(new Date(Date.UTC(y, mo, 0)).getUTCDate()).padStart(2, '0'); };

async function requireAccess(user, companyId) {
  if (!(await moduleHasCapability('PAYROLL', 'access', user.profile.role))) throw new HttpsError('permission-denied', 'You do not have access to Payroll.');
  const co = text(companyId, 80);
  if (!co || !userCanAccessCompany(user.profile, co)) throw new HttpsError('permission-denied', 'You do not have access to that company.');
  return co;
}

// Every movement of a company's employee provisions, oldest first. The
// same rules as providedBefore (payrollProvisions.js): an opening replaces
// the runs up to its month for that employee and provision; a reversed
// claim, or a run or settlement not posted, is not a movement.
// Column: Accrued (a run's increase, an opening imported), Released (a
// run's decrease, a lapse at leaving), Utilised (a claim, a payout with the
// salary, a final settlement). Amount is signed: what it does to the balance.
async function movements(co) {
  const [openings, runs, claims, settlements] = await Promise.all([
    P.OPENINGS().where('CompanyID', '==', co).get(), RUNS().where('CompanyID', '==', co).get(),
    P.CLAIMS().where('CompanyID', '==', co).get(), SETTLEMENTS().where('CompanyID', '==', co).get()]);
  const out = [];
  const push = (m, amount) => { if (round2(amount)) out.push(Object.assign(m, { Amount: round2(amount) })); };
  const openFrom = {};
  docs(openings, 'OpeningID').forEach(o => {
    const k = keyOf(o.Kind, o.AccrualTypeID);
    openFrom[o.EmployeeID + '|' + k] = o.Month;
    push({ EmployeeID: o.EmployeeID, Key: k, Month: o.Month, Date: o.AsOf, Column: 'Accrued', What: 'Opening (provided to ' + o.AsOf + ')',
      Doc: { ModuleID: 'PROVISIONS', ID: o.OpeningID, Number: 'Opening' }, JVNumber: '' }, o.Amount);
  });
  for (const r of docs(runs, 'RunID').filter(x => x.Status === 'Posted')) {
    const doc = { ModuleID: 'PAYROLL', ID: r.RunID, Number: r.RunNumber || r.Month };
    (await RUNS().doc(r.RunID).collection('slips').get()).docs.forEach(x => {
      const s = x.data();
      (s.Provisions || []).forEach(p => {
        const k = keyOf(p.Kind, p.AccrualTypeID);
        if (openFrom[s.EmployeeID + '|' + k] >= r.Month) return;
        push({ EmployeeID: s.EmployeeID, Key: k, Month: r.Month, Date: monthEnd(r.Month), Column: p.Amount < 0 ? 'Released' : 'Accrued', What: 'Run ' + doc.Number, Doc: doc, JVNumber: r.JVNumber || '' }, p.Amount);
      });
      (s.Lines || []).filter(l => l.Source === 'AccrualPayout').forEach(l => push({ EmployeeID: s.EmployeeID, Key: keyOf('Accrual', l.AccrualTypeID), Month: r.Month, Date: monthEnd(r.Month),
        Column: 'Utilised', What: 'Paid with the salary, run ' + doc.Number, Doc: doc, JVNumber: r.JVNumber || '' }, -l.Amount));
    });
  }
  docs(claims, 'ClaimID').filter(c => !c.ReversedAt).forEach(c => push({ EmployeeID: c.EmployeeID, Key: keyOf('Accrual', c.AccrualTypeID), Month: c.Date.slice(0, 7), Date: c.Date,
    Column: 'Utilised', What: 'Claim' + (c.Note ? ' — ' + c.Note : ''), Doc: { ModuleID: 'PROVISIONS', ID: c.ClaimID, Number: c.JVNumber }, JVNumber: c.JVNumber }, -c.Amount));
  docs(settlements, 'SettlementID').filter(s => s.Status === 'Posted').forEach(s => (s.Lines || []).filter(l => l.Provided).forEach(l => push({
    EmployeeID: s.EmployeeID, Key: l.Key, Month: s.LeavingDate.slice(0, 7), Date: s.LeavingDate, Column: l.Kind === 'Lapse' ? 'Released' : 'Utilised',
    What: (l.Kind === 'Lapse' ? 'Lapsed at leaving' : 'Final settlement') + ' ' + (s.Number || ''), Doc: { ModuleID: 'PAYROLLFS', ID: s.SettlementID, Number: s.Number || '' }, JVNumber: s.JVNumber || '' }, -l.Provided)));
  return out.sort((a, b) => a.Date.localeCompare(b.Date) || a.Column.localeCompare(b.Column));
}

function period(d) {
  const from = text(d.from, 7), to = text(d.to, 7);
  if (!isMonth(from) || !isMonth(to)) bad('Choose the period: from a month to a month.');
  if (from > to) bad('The period ends before it starts.');
  return { from, to };
}

// The provisions of a company (gratuity and leave salary when on or used,
// each accrual type), with their provision accounts.
async function provisionsOf(co) {
  const [prov, types] = await Promise.all([P.provisionSettings(co), P.accrualTypes()]);
  return [{ Key: 'Gratuity', Name: 'Gratuity', On: prov.Gratuity.Enabled, AccountID: prov.Gratuity.ProvisionAccountID || '' },
    { Key: 'LeaveSalary', Name: 'Leave salary', On: prov.LeaveSalary.Enabled, AccountID: prov.LeaveSalary.ProvisionAccountID || '' }]
    .concat(types.map(t => ({ Key: keyOf('Accrual', t.AccrualTypeID), Name: t.Name, Code: t.Code, AccrualTypeID: t.AccrualTypeID, On: t.Active !== false, AccountID: P.accrualAccount(t, 'Provision', co) })));
}

// An account's GL balance (credit less debit: a provision) for a company up
// to a date.
function glBalances(entries, coa, accountIds, toDate) {
  const out = Object.fromEntries(accountIds.map(id => [id, 0]));
  const byCode = Object.fromEntries(accountIds.map(id => [String((coa[id] || {}).AccountCode), id]));
  entries.forEach(e => {
    if (e.Status !== 'Posted' || !(String(e.JVDate || '') <= toDate)) return;
    (e.Lines || []).forEach(l => {
      const id = l.AccountID && out[l.AccountID] != null ? l.AccountID : byCode[String(l.AccountCode)];
      if (id) out[id] = round2(out[id] + (Number(l.Credit) || 0) - (Number(l.Debit) || 0));
    });
  });
  return out;
}

exports.getProvisionStatement = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  const d = request.data || {};
  const co = await requireAccess(user, d.companyId);
  const { from, to } = period(d);
  const [all, provs, empsSnap, claimsSnap, openingsSnap, coa] = await Promise.all([movements(co), provisionsOf(co), firestore.collection('employees').where('CompanyID', '==', co).get(),
    P.CLAIMS().where('CompanyID', '==', co).get(), P.OPENINGS().where('CompanyID', '==', co).get(), rtdb.ref('coa').get().then(s => s.val() || {})]);
  const emps = Object.fromEntries(docs(empsSnap, 'EmployeeID').map(e => [e.EmployeeID, e]));
  const rows = {};
  all.filter(m => m.Month <= to).forEach(m => {
    const r = rows[m.EmployeeID + '|' + m.Key] = rows[m.EmployeeID + '|' + m.Key] || { EmployeeID: m.EmployeeID, Key: m.Key, Opening: 0, Accrued: 0, Released: 0, Utilised: 0, Closing: 0 };
    if (m.Month < from) r.Opening = round2(r.Opening + m.Amount);
    else r[m.Column] = round2(r[m.Column] + (m.Column === 'Accrued' ? m.Amount : -m.Amount));
    r.Closing = round2(r.Closing + m.Amount);
  });
  const order = Object.fromEntries(provs.map((p, i) => [p.Key, i]));
  const out = Object.values(rows).filter(r => r.Opening || r.Accrued || r.Released || r.Utilised || r.Closing).map(r => {
    const e = emps[r.EmployeeID] || {};
    return Object.assign(r, { EmployeeNo: e.EmployeeNo || '', FullName: e.FullName || r.EmployeeID, Status: e.Status || '' });
  }).sort((a, b) => (order[a.Key] ?? 99) - (order[b.Key] ?? 99) || String(a.EmployeeNo).localeCompare(String(b.EmployeeNo)));
  const columns = provs.filter(p => p.On || out.some(r => r.Key === p.Key));
  // The GL check (decision 63): each provision account at the period's end,
  // against the statement's closing for the provisions that use it.
  const accounts = [...new Set(columns.map(p => p.AccountID).filter(id => coa[id]))];
  const entries = accounts.length ? (await firestore.collection(FIRESTORE_JOURNAL_ENTRIES_COLLECTION).where('CompanyID', '==', co).get()).docs.map(x => x.data()) : [];
  const gl = glBalances(entries, coa, accounts, monthEnd(to));
  const glChecks = accounts.map(id => {
    const keys = columns.filter(p => p.AccountID === id).map(p => p.Key);
    const statement = round2(out.filter(r => keys.includes(r.Key)).reduce((t, r) => t + r.Closing, 0));
    return { AccountID: id, AccountCode: coa[id].AccountCode, AccountName: coa[id].AccountName, Keys: keys, Statement: statement, GL: gl[id], Difference: round2(gl[id] - statement) };
  });
  const cash = Object.entries(coa).filter(([, a]) => a.Status === 'Active' && a.IsPostable && P.isCashOrBank(a) && (!a.CompanyID || a.CompanyID === co))
    .map(([id, a]) => ({ AccountID: id, AccountCode: a.AccountCode, AccountName: a.AccountName })).sort((a, b) => String(a.AccountCode).localeCompare(String(b.AccountCode)));
  const name = Object.fromEntries(provs.map(p => [p.Key, p.Name]));
  return {
    from, to, columns: columns.map(p => ({ Key: p.Key, Name: p.Name, AccrualTypeID: p.AccrualTypeID || '', Code: p.Code || '' })), rows: out, glChecks,
    // Today's balances, for the claim form (the same as the run uses next).
    balances: all.reduce((t, m) => { const k = m.EmployeeID + '|' + m.Key; t[k] = round2((t[k] || 0) + m.Amount); return t; }, {}),
    employees: Object.values(emps).filter(e => e.Status !== 'Left').map(e => ({ EmployeeID: e.EmployeeID, EmployeeNo: e.EmployeeNo, FullName: e.FullName }))
      .sort((a, b) => String(a.EmployeeNo).localeCompare(String(b.EmployeeNo))),
    types: provs.filter(p => p.AccrualTypeID && p.On).map(p => ({ AccrualTypeID: p.AccrualTypeID, Name: p.Name, Code: p.Code })),
    provisions: provs.filter(p => p.On).map(p => ({ Key: p.Key, Name: p.Name, Code: p.Code || '' })),
    accounts: cash,
    claims: docs(claimsSnap, 'ClaimID').sort((a, b) => String(b.Date).localeCompare(String(a.Date))),
    openings: docs(openingsSnap, 'OpeningID').map(o => {
      const e = emps[o.EmployeeID] || {}, k = keyOf(o.Kind, o.AccrualTypeID);
      return { OpeningID: o.OpeningID, EmployeeID: o.EmployeeID, EmployeeNo: e.EmployeeNo || '', FullName: e.FullName || o.EmployeeID, Key: k, Provision: name[k] || k, Amount: o.Amount, AsOf: o.AsOf };
    }).sort((a, b) => String(a.EmployeeNo).localeCompare(String(b.EmployeeNo)) || a.Provision.localeCompare(b.Provision)),
    canPay: await moduleHasCapability('PAYROLL', 'pay', user.profile.role),
    canWriteOpenings: await moduleHasCapability('PAYROLLSETUP', 'write', user.profile.role)
  };
});

// One row's movements in the period, with its opening and closing.
exports.getProvisionMovements = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  const d = request.data || {};
  const co = await requireAccess(user, d.companyId);
  const { from, to } = period(d);
  const emp = text(d.employeeId, 80), key = text(d.key, 120);
  const mine = (await movements(co)).filter(m => m.EmployeeID === emp && m.Key === key && m.Month <= to);
  const opening = round2(mine.filter(m => m.Month < from).reduce((t, m) => t + m.Amount, 0));
  let running = opening;
  const rows = mine.filter(m => m.Month >= from).map(m => { running = round2(running + m.Amount); return Object.assign({}, m, { Balance: running }); });
  return { opening, movements: rows, closing: running };
});

// Openings on screen (decision 62): the import's row, one at a time.
exports.saveProvisionOpeningEntry = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  const d = request.data || {};
  return P.saveProvisionOpening(user, { EmployeeID: d.employeeId, Provision: d.provision, Amount: d.amount, AsOf: d.asOf });
});

exports.deleteProvisionOpening = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  if (!(await moduleHasCapability('PAYROLLSETUP', 'write', user.profile.role))) throw new HttpsError('permission-denied', 'You do not have permission to change Payroll Setup.');
  const snap = await P.OPENINGS().doc(text((request.data || {}).openingId, 200) || '-').get();
  if (!snap.exists) throw new HttpsError('not-found', 'Opening not found.');
  const o = snap.data();
  if (!userCanAccessCompany(user.profile, o.CompanyID)) throw new HttpsError('permission-denied', 'You do not have access to that company.');
  const emp = (await firestore.collection('employees').doc(o.EmployeeID).get()).data() || {};
  await P.requireNoSettlement(o.EmployeeID, emp.FullName || o.EmployeeID);
  await snap.ref.delete();
  return { success: true };
});

Object.assign(module.exports, { movements, monthEnd });
