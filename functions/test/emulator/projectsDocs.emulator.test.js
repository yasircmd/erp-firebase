// Projects on documents, step 1 (owner, 2026-11-03; docs/modules/
// PROJECTS_DIMENSIONS.md, Q387-Q392): a Vendor Invoice's header project is
// its lines' default and a direct line may have its own (posted, reversed);
// a Sales Order keeps its project; a JV keeps its lines' default project;
// each document's project is checked when saved (the company's or shared,
// and Active).
const test = require('node:test');
const assert = require('node:assert/strict');
const { app, firestore, call, reset, baseFixture, val } = require('./_helpers');

test.after(async () => { await app.delete(); });
const D = '2026-10-10';
const ok = r => { assert.equal(r && r.success, true, r && r.error); return r; };
const err = async p => { const r = await p.catch(e => ({ success: false, error: e.message })); assert.equal(r.success, false, 'expected a refusal: ' + JSON.stringify(r)); return r.error; };
const jv = async id => (await firestore.collection('journalEntries').doc(id).get()).data();
const P = { mine: 'PRJ-A', other: 'PRJ-B', theirs: 'PRJ-X', closed: 'PRJ-C' };

test.before(async () => {
  const f = baseFixture();
  Object.assign(f.orgUnits, {
    [P.mine]: { Type: 'Project', Code: 'P-100', Name: 'Tower A', CompanyID: 'C1', Status: 'Active' },
    [P.other]: { Type: 'Project', Code: 'P-200', Name: 'Tower B', CompanyID: '', Status: 'Active' },
    [P.theirs]: { Type: 'Project', Code: 'P-900', Name: 'Elsewhere', CompanyID: 'C2', Status: 'Active' },
    [P.closed]: { Type: 'Project', Code: 'P-050', Name: 'Done', CompanyID: 'C1', Status: 'Closed' }
  });
  f.customers = { CU1: { CustomerCode: 'C001', CustomerName: 'Retail Co', Status: 'Active', CompanyID: 'C1', Classification: 'Retail' } };
  await reset(f);
});

const vi = (projectId, lines) => call('u-admin', 'saveVendorInvoiceDraft', { invoiceData: { InvoiceDate: D, Description: 'Site bill', VendorRefNumber: 'B-' + Math.random().toString(36).slice(2, 7),
  CompanyID: 'C1', VendorID: 'V1', CostCenterID: 'CC1', ProjectID: projectId, SourceGRNs: [],
  DirectLines: lines.map(([amount, project]) => ({ AccountCode: '5100', Amount: amount, Description: 'Labour', CostCenterID: 'CC1', ProjectID: project })) } });

test('Vendor Invoice: the header project is the lines\' default, a direct line may have its own; posted and reversed so', async () => {
  const s = ok(await vi(P.mine, [[100, ''], [40, P.other]]));
  assert.deepEqual((await val('vendorInvoices/' + s.invoiceId)).DirectLines.map(l => l.ProjectID), ['', P.other], 'saved as entered');
  ok(await call('u-admin', 'postVendorInvoice', { invoiceId: s.invoiceId }));
  const posted = await val('vendorInvoices/' + s.invoiceId);
  const lines = (await jv(posted.LinkedJVID)).Lines.map(l => [l.AccountCode, l.Debit, l.Credit, l.ProjectID]).sort((a, b) => (a[0] + a[1]).localeCompare(b[0] + b[1]));
  assert.deepEqual(lines, [['2000', 0, 140, P.mine], ['5100', 100, 0, P.mine], ['5100', 40, 0, P.other]]);
  ok(await call('u-admin', 'requestReverseVendorInvoice', { invoiceId: s.invoiceId, reversalDate: D }));
  const rev = await val('vendorInvoices/' + s.invoiceId);
  const mirror = await val('vendorInvoices/' + rev.ReversedByInvoiceID); // the reversal is its own (mirror) invoice
  const back = (await jv(mirror.LinkedJVID)).Lines.filter(l => l.AccountCode === '5100').map(l => [l.Credit, l.ProjectID]).sort((a, b) => a[0] - b[0]);
  assert.deepEqual(back, [[40, P.other], [100, P.mine]], 'the reversal mirrors each line\'s project');
});

test('Vendor Invoice: a line\'s project of another company, or closed, is refused when posting', async () => {
  const a = ok(await vi('', [[10, P.theirs]]));
  assert.match(await err(call('u-admin', 'postVendorInvoice', { invoiceId: a.invoiceId })), /project P-900 belongs to another company/);
  const b = ok(await vi('', [[10, P.closed]]));
  assert.match(await err(call('u-admin', 'postVendorInvoice', { invoiceId: b.invoiceId })), /project P-050 is closed: it takes no new postings/);
});

const so = projectId => call('u-admin', 'saveDraftSalesOrder', { header: { SODate: D, CompanyID: 'C1', CostCenterID: 'CC1', CustomerID: 'CU1', ProjectID: projectId,
  Lines: [{ ItemCode: 'RM-001', WarehouseID: 'WH1', OrderedQuantity: 1, UnitPrice: 20 }] } });

test('Sales Order: its project is kept; one of another company, closed or unknown is refused', async () => {
  const s = ok(await so(P.mine));
  assert.equal((await val('salesOrders/' + s.soId)).ProjectID, P.mine);
  assert.equal((await val('salesOrders/' + ok(await so('')).soId)).ProjectID, '', 'none is fine');
  assert.equal((await val('salesOrders/' + ok(await so(P.other)).soId)).ProjectID, P.other, 'a shared one');
  assert.match(await err(so(P.theirs)), /^Project P-900 belongs to another company/);
  assert.match(await err(so(P.closed)), /^Project P-050 is closed/);
  assert.match(await err(so('NOPE')), /^The project is not found/);
});

test('JV: the header project (the lines\' default) is kept and checked', async () => {
  const journal = projectId => call('u-admin', 'saveJournalDraft', { jvData: { JVDate: D, Description: 'Site', CompanyID: 'C1', ProjectID: projectId,
    Lines: [{ AccountCode: '5100', Debit: 10, Credit: 0, Description: 'x', CostCenterID: 'CC1', ProjectID: projectId }, { AccountCode: '1100', Debit: 0, Credit: 10, Description: 'x' }] } });
  const s = ok(await journal(P.mine));
  assert.equal((await jv(s.jvId)).ProjectID, P.mine);
  assert.match(await err(journal(P.closed)), /P-050 is closed/);
});
