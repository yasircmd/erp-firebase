// Gmail-style list paging (owner, 2026-10-02; docs/modules/LIST_PAGING.md):
// the document lists return 100 at a time after a marker, and search and
// filters run on the server over every entry the user can see, 100
// matches at a time. JV / CBT (Firestore) and the stock and Purchase
// Order lists (RTDB) all go through it.
const test = require('node:test');
const assert = require('node:assert/strict');
const { app, rtdb, firestore, call, reset, baseFixture } = require('./_helpers');

test.after(async () => { await app.delete(); });

const pad = (n, w) => String(n).padStart(w || 3, '0');
// Entry i was created i minutes after the start: a higher i is newer.
const at = i => new Date(Date.UTC(2026, 0, 1) + i * 60000).toISOString();
const dateOf = i => '2026-0' + (1 + (i % 9)) + '-' + pad(1 + (i % 28), 2);

// Every page after the first, until `next` runs out.
async function allPages(uid, fn, page, extra) {
  const pages = [];
  let after = '';
  for (let guard = 0; guard < 20; guard++) {
    const r = await call(uid, fn, Object.assign({ page: Object.assign({}, page, after ? { after } : {}) }, extra || {}));
    pages.push(r);
    if (!r.next) break;
    after = r.next;
  }
  return pages;
}
const ids = (pages, idField) => pages.flatMap(p => p.entries.map(e => e[idField]));

// 250 JVs in C1 (the oldest five about insurance; 30 created in the same
// millisecond), 10 in C2, and 15 Cash / Bank vouchers in C1.
const JV_COUNT = 250;
function jvDoc(i, over) {
  return Object.assign({
    VoucherType: 'JV', CompanyID: 'C1', JVNumber: 'JV-' + pad(i), JVDate: dateOf(i),
    Description: i < 5 ? 'Insurance premium' : (i % 2 ? 'Rent' : 'Salary accrual'),
    Status: i % 3 ? 'Posted' : 'Draft', TotalDebit: 10, TotalCredit: 10,
    CreatedAt: i >= 140 && i < 170 ? at(140) : at(i) // newest-first positions 80-109: across page 1's end
  }, over || {});
}
async function seedJournal() {
  const batch = firestore.batch();
  const col = firestore.collection('journalEntries');
  for (let i = 0; i < JV_COUNT; i++) batch.set(col.doc('jv' + pad(i)), jvDoc(i));
  for (let i = 0; i < 10; i++) batch.set(col.doc('c2jv' + pad(i)), jvDoc(i, { CompanyID: 'C2', JVNumber: 'JV-C2-' + pad(i) }));
  for (let i = 0; i < 15; i++) {
    batch.set(col.doc('cbt' + pad(i)), jvDoc(i, { VoucherType: i % 2 ? 'Cash Receipt' : 'Bank Payment', JVNumber: (i % 2 ? 'CR-' : 'BP-') + pad(i), CreatedAt: at(1000 + i) }));
  }
  await batch.commit();
}

// The stock lists and Purchase Orders, in the Realtime Database.
function fixture() {
  const f = baseFixture();
  const tx = {};
  for (let i = 0; i < 230; i++) {
    tx['grn' + pad(i)] = { TransactionType: 'GRN', CompanyID: 'C1', TransactionNumber: 'GRN-' + pad(i), TransactionDate: dateOf(i),
      Description: i < 3 ? 'Old steel delivery' : 'Delivery', Status: 'Posted', CreatedAt: at(i), LinkedJVID: 'gl-grn' + pad(i),
      MatchedToInvoiceID: i < 10 ? '' : 'VI1' };
  }
  tx.grnC2 = { TransactionType: 'GRN', CompanyID: 'C2', TransactionNumber: 'GRN-C2', TransactionDate: '2026-01-01', Status: 'Posted', CreatedAt: at(999) };
  for (let i = 0; i < 105; i++) {
    tx['prd' + pad(i)] = { TransactionType: 'Production', CompanyID: 'C1', TransactionNumber: 'PRD-' + pad(i), TransactionDate: dateOf(i),
      Description: 'Batch ' + i, Status: 'Posted', CreatedAt: at(i), LinkedJVID: 'gl-prd' + pad(i) };
    tx['pc' + pad(i)] = { TransactionType: 'PhysicalCount', CompanyID: 'C1', TransactionNumber: 'PC-' + pad(i), TransactionDate: dateOf(i),
      Description: 'Count ' + i, Status: 'Posted', CreatedAt: at(i) };
    for (const [t, p] of [['MaterialIssue', 'mi'], ['WarehouseMovement', 'wm'], ['StockAdjustment', 'adj']]) {
      tx[p + pad(i)] = { TransactionType: t, CompanyID: 'C1', TransactionNumber: p.toUpperCase() + '-' + pad(i), TransactionDate: dateOf(i),
        Description: 'Doc ' + i, Status: i % 2 ? 'Posted' : 'Draft', CreatedAt: at(i) };
    }
  }
  f.stock = { transactions: tx };
  f.vendorInvoices = { VI1: { TransactionNumber: 'VI-1', Status: 'Posted' } };
  f.vendors.V2 = { VendorCode: 'V002', VendorName: 'Bolt Supplies', Status: 'Active', CompanyID: 'C1', TradePayablesAccountID: 'A-AP' };
  f.purchaseOrders = {};
  for (let i = 0; i < 120; i++) {
    f.purchaseOrders['po' + pad(i)] = { CompanyID: 'C1', PONumber: 'PO-' + pad(i), VendorID: i < 4 ? 'V2' : 'V1', Status: 'Approved', CreatedAt: at(i) };
  }
  return f;
}

test.before(async () => { await reset(fixture()); await seedJournal(); });

test('JV: 100 at a time, newest first, with no gaps or repeats (30 created in the same millisecond)', async () => {
  const pages = await allPages('u-admin', 'getJournalEntries', {});
  assert.deepEqual(pages.map(p => p.entries.length), [100, 100, 50]);
  assert.ok(pages.every(p => p.total === JV_COUNT && p.filtered === false));
  const got = ids(pages, 'JVID');
  assert.equal(new Set(got).size, JV_COUNT, 'no repeats');
  const expected = Array.from({ length: JV_COUNT }, (_, i) => i).map(i => jvDoc(i)).map((d, i) => ({ id: 'jv' + pad(i), c: d.CreatedAt }))
    .sort((a, b) => b.c.localeCompare(a.c) || (b.id < a.id ? -1 : 1)).map(x => x.id);
  assert.deepEqual(got, expected, 'newest created first, then by id');
  assert.equal(pages[2].next, '');
});

test('JV: search and filters cover every entry, not just the newest 100', async () => {
  const ins = await call('u-admin', 'getJournalEntries', { page: { search: 'INSURANCE' } });
  assert.deepEqual(ins.entries.map(e => e.JVNumber).sort(), ['JV-000', 'JV-001', 'JV-002', 'JV-003', 'JV-004']);
  assert.equal(ins.total, 5); assert.equal(ins.next, ''); assert.equal(ins.filtered, true);

  // More than 100 matches: 100, then the rest.
  const all = Array.from({ length: JV_COUNT }, (_, i) => jvDoc(i));
  const want = all.filter(d => d.Status === 'Posted' && d.JVDate >= '2026-02-01' && d.JVDate <= '2026-08-31' && /rent/i.test(d.Description));
  assert.ok(want.length > 0 && want.length < 100);
  const f = await allPages('u-admin', 'getJournalEntries', { search: 'rent', Status: 'Posted', from: '2026-02-01', to: '2026-08-31' });
  assert.deepEqual(ids(f, 'JVNumber').sort(), want.map(d => d.JVNumber).sort());
  assert.equal(f[0].total, want.length);

  const salary = await allPages('u-admin', 'getJournalEntries', { search: 'salary' });
  const salaryCount = all.filter(d => /salary/i.test(d.Description)).length;
  assert.ok(salaryCount > 100);
  assert.deepEqual(salary.map(p => p.entries.length), [100, salaryCount - 100]);
  assert.equal(new Set(ids(salary, 'JVID')).size, salaryCount);
  assert.ok(salary.every(p => p.total === salaryCount && p.filtered));
});

test('JV: only the user\'s companies, and only JVs', async () => {
  assert.equal((await call('u-admin', 'getJournalEntries', { page: { CompanyID: 'C2' } })).total, 0, 'not their company');
  const other = await call('u-other', 'getJournalEntries', { page: {} });
  assert.equal(other.total, 10);
  assert.ok(other.entries.every(e => e.CompanyID === 'C2'));
  const cr = await call('u-admin', 'getJournalEntries', { page: { search: 'CR-' } });
  assert.equal(cr.total, 0, 'Cash / Bank vouchers are not JVs');
});

test('JV: the next page is unaffected by an entry added meanwhile', async () => {
  const first = await call('u-admin', 'getJournalEntries', { page: {} });
  const expectedSecond = (await call('u-admin', 'getJournalEntries', { page: { after: first.next } })).entries.map(e => e.JVID);
  await firestore.collection('journalEntries').doc('jvNEW').set(jvDoc(999, { JVNumber: 'JV-NEW', CreatedAt: at(5000) }));
  try {
    const second = await call('u-admin', 'getJournalEntries', { page: { after: first.next } });
    assert.deepEqual(second.entries.map(e => e.JVID), expectedSecond);
    assert.equal(second.total, JV_COUNT + 1);
  } finally {
    await firestore.collection('journalEntries').doc('jvNEW').delete();
  }
});

test('JV: a drill-down fetches one entry by id, however old, and only if the user may see it', async () => {
  const one = await call('u-admin', 'getJournalEntries', { page: { id: 'jv000' } });
  assert.deepEqual(one.entries.map(e => e.JVNumber), ['JV-000']);
  assert.equal((await call('u-admin', 'getJournalEntries', { page: { id: 'c2jv000' } })).entries.length, 0, 'other company');
  assert.equal((await call('u-admin', 'getJournalEntries', { page: { id: 'cbt001' } })).entries.length, 0, 'a CBT voucher');
  assert.equal((await call('u-admin', 'getCbtEntries', { page: { id: 'cbt001' } })).entries.length, 1);
});

test('JV: the old limit still works as before', async () => {
  const r = await call('u-admin', 'getJournalEntries', { limit: 100 });
  assert.equal(r.entries.length, 100); assert.equal(r.total, JV_COUNT); assert.equal(r.next, undefined);
});

test('CBT: paging, and the voucher type filter', async () => {
  const r = await call('u-admin', 'getCbtEntries', { page: {} });
  assert.equal(r.total, 15); assert.equal(r.entries.length, 15); assert.equal(r.next, '');
  const cash = await call('u-admin', 'getCbtEntries', { page: { VoucherType: 'Cash Receipt' } });
  assert.equal(cash.total, 7);
  assert.ok(cash.entries.every(e => e.VoucherType === 'Cash Receipt'));
  assert.equal((await call('u-admin', 'getCbtEntries', { page: { VoucherType: 'JV' } })).total, 0, 'not a CBT type');
  const day = jvDoc(3).JVDate;
  const onDay = await call('u-admin', 'getCbtEntries', { page: { from: day, to: day } });
  assert.ok(onDay.total >= 1 && onDay.entries.every(e => e.JVDate === day));
});

test('GRN: paging, search and the invoice filter reach older GRNs; a drill-down by GL entry id', async () => {
  const pages = await allPages('u-admin', 'getGrnEntries', {});
  assert.deepEqual(pages.map(p => p.entries.length), [100, 100, 30]);
  assert.equal(new Set(ids(pages, 'GRNID')).size, 230, 'no repeats, and not the other company\'s');
  const old = await call('u-admin', 'getGrnEntries', { page: { search: 'old steel' } });
  assert.deepEqual(old.entries.map(e => e.TransactionNumber), ['GRN-002', 'GRN-001', 'GRN-000']);
  const pending = await call('u-admin', 'getGrnEntries', { page: { InvoiceStatus: 'Pending' } });
  assert.equal(pending.total, 10, 'the ten oldest are not invoiced');
  assert.ok(pending.entries.every(e => e.InvoiceStatus === 'Pending'));
  const byGl = await call('u-admin', 'getGrnEntries', { page: { id: 'gl-grn005' } });
  assert.deepEqual(byGl.entries.map(e => e.GRNID), ['grn005']);
});

test('Purchase Order: search matches the vendor\'s name, across every PO', async () => {
  const pages = await allPages('u-admin', 'getPurchaseOrderEntries', {});
  assert.deepEqual(pages.map(p => p.entries.length), [100, 20]);
  const bolt = await call('u-admin', 'getPurchaseOrderEntries', { page: { search: 'bolt' } });
  assert.deepEqual(bolt.entries.map(e => e.PONumber), ['PO-003', 'PO-002', 'PO-001', 'PO-000']);
  assert.equal((await call('u-admin', 'getPurchaseOrderEntries', { page: { search: 'PO-007' } })).total, 1);
});

test('Production, Physical Count, Material Issue, Warehouse Movement, Stock Adjustment: paging and search', async () => {
  for (const [fn, idField, prefix] of [['getProductionEntries', 'ProductionID', 'PRD'], ['getPhysicalCountEntries', 'CountID', 'PC'],
    ['getMaterialIssueEntries', 'MIID', 'MI'], ['getWarehouseMovementEntries', 'MoveID', 'WM'], ['getStockAdjustmentEntries', 'AdjustmentID', 'ADJ']]) {
    const pages = await allPages('u-admin', fn, {});
    assert.deepEqual(pages.map(p => p.entries.length), [100, 5], fn);
    assert.equal(new Set(ids(pages, idField)).size, 105, fn);
    const old = await call('u-admin', fn, { page: { search: prefix + '-001' } });
    assert.deepEqual(old.entries.map(e => e.TransactionNumber), [prefix + '-001'], fn);
  }
  const drafts = await call('u-admin', 'getMaterialIssueEntries', { page: { Status: 'Draft' } });
  assert.equal(drafts.total, 53);
  assert.deepEqual((await call('u-admin', 'getProductionEntries', { page: { id: 'gl-prd004' } })).entries.map(e => e.ProductionID), ['prd004']);
  assert.equal((await call('u-admin', 'getProductionEntries', { limit: 'all' })).entries.length, 105, 'the old limit still works');
});

test('a company filter that narrows nothing (the single-company default) still reads as the plain list', async () => {
  const jv = await call('u-admin', 'getJournalEntries', { page: { CompanyID: 'C1' } });
  assert.equal(jv.filtered, false); assert.equal(jv.total, JV_COUNT); assert.ok(jv.next);
  const grn = await call('u-admin', 'getGrnEntries', { page: { CompanyID: 'C1' } });
  assert.equal(grn.filtered, false); assert.equal(grn.total, 230);
  const narrowing = await call('u-admin', 'getJournalEntries', { page: { CompanyID: 'C1', Status: 'Draft' } });
  assert.equal(narrowing.filtered, true);
});

test('rows per page (owner, 2026-10-14): 25 or 50 on request, never more than 100', async () => {
  // JV unfiltered (Firestore's own paging), JV searched, and a stock list.
  const jv25 = await allPages('u-admin', 'getJournalEntries', { size: 25 });
  assert.deepEqual(jv25.map(p => p.entries.length), Array(JV_COUNT / 25).fill(25));
  assert.equal(new Set(ids(jv25, 'JVID')).size, JV_COUNT, 'every entry once');
  const jv50 = await allPages('u-admin', 'getJournalEntries', { size: '50' });
  assert.deepEqual(jv50.map(p => p.entries.length), Array(JV_COUNT / 50).fill(50));
  assert.equal((await call('u-admin', 'getJournalEntries', { page: { search: 'JV-', size: 25 } })).entries.length, 25);
  assert.deepEqual((await allPages('u-admin', 'getProductionEntries', { size: 50 })).map(p => p.entries.length), [50, 50, 5]);
  // Anything else is the default 100.
  for (const size of [500, 1000, 0, -5, 'all', 30]) {
    assert.equal((await call('u-admin', 'getJournalEntries', { page: { size } })).entries.length, 100, String(size));
    assert.equal((await call('u-admin', 'getProductionEntries', { page: { size } })).entries.length, 100, String(size));
  }
});
