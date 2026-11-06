// CRM step C4 (owner, 2026-11-06; docs/modules/CRM.md, Q402, Q407-Q410):
// the reports through getCrmReports (the base currency at the latest rate;
// a user's own records, a CRM Manager's every owner with the owner filter)
// and CRM Leads in Master Import (the form's checks, the Owner column and who
// may name someone else, a match warned and left out unless Import matches
// too, a match within the paste, the import saved as the form saves).
const test = require('node:test');
const assert = require('node:assert/strict');
const { app, firestore, call, reset, baseFixture } = require('./_helpers');

test.after(async () => { await app.delete(); });
const ok = r => { assert.equal(r && r.success, true, JSON.stringify(r)); return r; };
const err = async p => { const r = await p.then(x => ({ ok: true, x }), e => ({ ok: false, error: e.message })); assert.equal(r.ok, false, 'expected a refusal: ' + JSON.stringify(r.x)); return r.error; };
const today = new Date().toISOString().slice(0, 10);
const tsv = rows => rows.map(r => r.join('\t')).join('\n');

function fixture() {
  const f = baseFixture();
  Object.assign(f.users, {
    'u-rep1': { status: 'Active', role: 'Sales', username: 'rep1', fullName: 'Rep One', AssignedCompanies: ['C1'] },
    'u-rep2': { status: 'Active', role: 'Sales', username: 'rep2', fullName: 'Rep Two', AssignedCompanies: ['C1'] }
  });
  f.roles.Sales = { Name: 'Sales', Status: 'Active' };
  f.permissions.CRM.access.push('Sales');
  f.permissions.CRM.write.push('Sales');
  f.permissions.MASTERIMPORT.access.push('Sales');
  f.customers = { CU1: { CustomerCode: 'C001', CustomerName: 'Retail Co', Status: 'Active', CompanyID: 'C1', Phone: '+971 50 111 2222', Email: 'buy@retail.example', TradeReceivablesAccountID: 'A-AR' } };
  f.currencies = { AED: { Code: 'AED', Name: 'UAE Dirham', Status: 'Active', IsDefault: true }, USD: { Code: 'USD', Name: 'US Dollar', Status: 'Active' }, EUR: { Code: 'EUR', Name: 'Euro', Status: 'Active' } };
  // USD: an older rate and the latest (Q407 takes the latest); EUR has none.
  f.exchangeRates = { USD: { r1: { EffectiveDate: '2026-01-01', Rate: 3.6, At: '2026-01-01T00:00:00Z' }, r2: { EffectiveDate: '2026-06-01', Rate: 3.6725, At: '2026-06-01T00:00:00Z' } } };
  f.salesReps = { E1: { CompanyID: 'C1', Active: true, IsManager: false } };
  return f;
}
async function seed() {
  await firestore.collection('employees').doc('E1').set({ EmployeeNo: 'EMP-0001', FullName: 'Field Rep', CompanyID: 'C1', Status: 'Active', UserUID: '', CostCenterID: 'CC1' });
  const o = (id, x) => firestore.collection('crmOpportunities').doc(id).set(Object.assign({ CompanyID: 'C1', CustomerID: 'CU1', LeadID: '', Title: id, Stage: 'New', Probability: 10, Status: 'Open', OwnerKey: 'U:u-rep1', ExpectedValue: 1000, Currency: 'AED', ExpectedClose: '' }, x));
  await Promise.all([
    o('o1', {}),
    o('o2', { OwnerKey: 'U:u-rep2', Stage: 'Proposal', Probability: 50, ExpectedValue: 100, Currency: 'USD' }),
    o('o3', { OwnerKey: 'U:u-rep2', ExpectedValue: 50, Currency: 'EUR' }),
    o('o4', { OwnerKey: 'U:u-rep1', Status: 'Won', Stage: 'Won', Probability: 100, ExpectedValue: 400, ClosedAt: today + 'T08:00:00Z' }),
    o('o5', { OwnerKey: 'U:u-rep2', Status: 'Lost', Stage: 'Lost', Probability: 0, ExpectedValue: 300, LostReason: 'Price', ClosedAt: today + 'T08:00:00Z' }),
    o('other', { CompanyID: 'C2', OwnerKey: 'U:u-other', ExpectedValue: 99999 }),
    firestore.collection('crmActivities').doc('a1').set({ CompanyID: 'C1', Type: 'Call', Subject: 'x', Due: '2020-01-01', Status: 'Open', OwnerKey: 'U:u-rep1', About: { Kind: 'Customer', ID: 'CU1' } }),
    firestore.collection('crmLeads').doc('L1').set({ CompanyID: 'C1', Name: 'Sara', Organisation: 'Gulf Trading', Phone: '050 999 8888', Email: 'sara@gulf.example', Source: 'Website', Status: 'Open', OwnerKey: 'U:u-rep1', CreatedAt: today + 'T07:00:00Z' })
  ]);
}
const reports = (uid, extra) => call(uid, 'getCrmReports', Object.assign({ companyId: 'C1', from: today.slice(0, 4) + '-01-01', to: today, today }, extra || {}));

test('reports: base currency at the latest rate; a currency with no rate shown and left out; the other company never', async () => {
  await reset(fixture()); await seed();
  const r = await reports('u-admin');
  assert.equal(r.base, 'AED');
  assert.deepEqual(r.missingRates, ['EUR']);
  assert.deepEqual(r.pipeline.total, { Count: 3, Value: 1367.25, Weighted: 283.63 }, 'USD 100 at 3.6725, not the older 3.6; EUR out; C2 never');
  assert.deepEqual(r.winLoss.total, { Key: '', Won: 1, WonValue: 400, Lost: 1, LostValue: 300, WinRate: 50 });
  assert.deepEqual(r.activities.total, { Done: 0, Open: 1, Overdue: 1 });
  assert.deepEqual(r.sources.rows.map(g => [g.Key, g.Leads]), [['Website', 1]]);
  assert.match(await err(reports('u-admin', { from: today, to: '2020-01-01' })), /ends before it starts/);
});

test('reports: a user sees their own; their owner filter is ignored; a CRM Manager filters by owner; the Viewer may look, another company may not', async () => {
  await reset(fixture()); await seed();
  const mine = await reports('u-rep1', { ownerKey: 'U:u-rep2' });
  assert.equal(mine.manager, false);
  assert.deepEqual(mine.pipeline.lines.map(l => l.ID), ['o1'], 'rep1 sees only theirs, whatever the filter');
  assert.deepEqual(mine.winLoss.total.Won + '/' + mine.winLoss.total.Lost, '1/0');
  const rep2 = await reports('u-admin', { ownerKey: 'U:u-rep2' });
  assert.deepEqual(rep2.pipeline.lines.map(l => l.ID).sort(), ['o2', 'o3']);
  assert.equal(rep2.winLoss.total.Lost, 1);
  assert.equal((await reports('u-viewer')).pipeline.total.Count, 0, 'the Viewer owns nothing');
  assert.match(await err(call('u-other', 'getCrmReports', { companyId: 'C1' })), /access to that company/);
});

const HEAD = ['Company', 'Organisation', 'Contact Name', 'Phone', 'Email', 'Source', 'Owner'];
const check = (uid, rows, extra) => call(uid, 'checkMasterImport', Object.assign({ master: 'LEAD', text: tsv([HEAD].concat(rows)) }, extra || {}));
const run = (uid, rows, extra) => call(uid, 'runMasterImport', Object.assign({ master: 'LEAD', text: tsv([HEAD].concat(rows)) }, extra || {}));
const leadsNow = async () => (await firestore.collection('crmLeads').where('CompanyID', '==', 'C1').get()).docs.map(d => d.data());
const msgs = r => r.issues.map(i => 'R' + i.row + ' ' + i.column + ': ' + i.message);

test('lead import: the form\'s checks, the source from CRM Setup, the Owner (user ID or rep\'s employee no.; only a manager names another)', async () => {
  await reset(fixture()); await seed();
  const specs = await call('u-rep1', 'getMasterImportSpecs', {});
  assert.ok(specs.some(s => s.key === 'LEAD'), 'listed for a CRM user');
  const bad = await check('u-rep1', [
    ['01', '', '', '055 000 0001', '', 'Website', ''],
    ['01', 'No Contact Co', '', '', '', 'Website', ''],
    ['01', 'Pigeon Co', '', '055 000 0003', '', 'Carrier pigeon', ''],
    ['01', 'Given Co', '', '055 000 0004', '', 'website', 'rep2'],
    ['01', 'Nobody Co', '', '055 000 0005', '', '', 'ghost']
  ]);
  assert.deepEqual(msgs(bad), [
    'R1 Organisation: Give the organisation or the contact name.',
    'R2 Phone: Give a phone or an email, so the lead can be reached.',
    'R3 Source: "Carrier pigeon" is not a lead source of this company (CRM Setup): Website, Referral, Exhibition, Walk-in, Phone, Social media, Other.',
    'R4 Owner: Only a CRM Manager can give a lead to someone else.',
    'R5 Owner: "ghost" is not a user or sales rep who can hold CRM records in this company.'
  ]);
  ok(await run('u-admin', [['01', 'Given Co', '', '055 000 0004', '', 'website', 'rep2'], ['01', 'Rep Co', '', '055 000 0006', '', '', 'EMP-0001'], ['Test Co One', 'Mine Co', '', '055 000 0007', '', '', '']]));
  const byOrg = Object.fromEntries((await leadsNow()).map(l => [l.Organisation, l]));
  assert.equal(byOrg['Given Co'].OwnerKey, 'U:u-rep2');
  assert.equal(byOrg['Given Co'].Source, 'Website', 'the source as CRM Setup writes it');
  assert.equal(byOrg['Rep Co'].OwnerKey, 'E:E1', 'a sales rep by employee no.');
  assert.equal(byOrg['Mine Co'].OwnerKey, 'U:u-admin', 'empty: the importer');
  assert.equal(byOrg['Mine Co'].Status, 'Open');
  assert.match(byOrg['Mine Co'].History[0].What, /Created/);
});

test('lead import: a match is a warning and left out, unless Import matches too; a match within the paste counts', async () => {
  await reset(fixture()); await seed();
  const rows = [
    ['01', 'New Co', 'Ali', '056 123 4567', '', '', ''],
    ['01', 'Phone Twin', '', '00971501112222', '', '', ''],    // the customer's phone, written differently
    ['01', 'Other', '', '', 'SARA@gulf.example', '', ''],      // lead L1's email
    ['01', 'new co', '', '057 000 0000', '', '', '']           // row 1's name
  ];
  const c = await check('u-rep1', rows);
  assert.deepEqual(c.issues, []);
  assert.equal(c.skipped, 3);
  assert.deepEqual(c.warnings.map(w => [w.row, w.message]), [
    [2, 'Matches customer Retail Co (C001) (phone). Left out.'],
    [3, 'Matches lead Gulf Trading (email). Left out.'],
    [4, 'Matches row 1 (name). Left out.']
  ]);
  const r = ok(await run('u-rep1', rows));
  assert.equal(r.created, 1); assert.equal(r.skipped, 3);
  assert.deepEqual((await leadsNow()).map(l => l.Organisation).sort(), ['Gulf Trading', 'New Co']);
  // Ticked: every row imports (row 1 now matches the lead just made, so it is warned too).
  const again = await check('u-rep1', rows, { importMatches: true });
  assert.equal(again.skipped, 0);
  assert.ok(again.warnings.every(w => /Imported anyway\.$/.test(w.message)), JSON.stringify(again.warnings));
  const r2 = ok(await run('u-rep1', rows, { importMatches: true }));
  assert.equal(r2.created, 4);
  assert.equal((await leadsNow()).length, 6);
});

test('lead import: the Viewer cannot import; a corporate user without CRM does not see it listed', async () => {
  await reset(fixture()); await seed();
  const v = await check('u-viewer', [['01', 'V Co', '', '055 111 0000', '', '', '']]);
  assert.match(msgs(v)[0], /permission to change CRM Leads/);
  const f = fixture();
  f.permissions.CRM.access = ['Admin']; f.permissions.CRM.write = ['Admin'];
  await reset(f);
  assert.ok(!(await call('u-rep1', 'getMasterImportSpecs', {})).some(s => s.key === 'LEAD'));
});
