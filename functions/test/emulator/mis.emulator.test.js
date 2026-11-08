// MIS, phase 1, the engine (owner, 2026-11-08; docs/modules/MIS.md): real
// postings in two months, then each report type: the key figures, P&L and
// its comparisons (previous month, budget), the Balance Sheet that
// balances, bank and cash, expenses, cash flow, ratios, the 12-month trend,
// sales by customer (invoices less nothing), stock in hand and stock cover;
// the setup's checks; access by company and right.
const test = require('node:test');
const assert = require('node:assert/strict');
const { app, firestore, call, reset, baseFixture, rtdb } = require('./_helpers');

test.after(async () => { await app.delete(); });
const ok = r => { assert.equal(r && r.success !== false, true, r && r.error); return r; };
const err = async p => { const r = await p.catch(e => ({ error: e.message })); assert.ok(r && r.error, 'expected a refusal: ' + JSON.stringify(r)); return r.error; };
const run = (type, month, mode, extra) => call('u-admin', 'runMisReport', Object.assign({ type, companyId: 'C1', month, mode: mode || 'prevMonth' }, extra || {}));
const byKey = r => Object.fromEntries(r.rows.map(x => [x.key, x]));
const NOW = new Date();
const M0 = NOW.toISOString().slice(0, 7);                    // this month
const M1 = new Date(Date.UTC(NOW.getUTCFullYear(), NOW.getUTCMonth() - 1, 15)).toISOString().slice(0, 7); // last month
async function jv(date, lines) {
  const s = ok(await call('u-admin', 'saveJournalDraft', { jvData: { JVDate: date, Description: 'MIS test', CompanyID: 'C1', Lines: lines.map(([a, d, c]) => ({ AccountCode: a, Debit: d, Credit: c, Description: 'x', CostCenterID: 'CC1' })) } }));
  ok(await call('u-admin', 'postJournalEntry', { jvId: s.jvId }));
}
function fixture() {
  const f = baseFixture();
  f.coa['A-RENT'] = { AccountCode: '6000', AccountName: 'Rent', AccountType: 'Expense', Status: 'Active', IsPostable: true };
  f.customers = { CU1: { CustomerCode: 'C001', CustomerName: 'Retail Co', Status: 'Active', CompanyID: 'C1', Classification: 'Retail', TradeReceivablesAccountID: 'A-AR' } };
  f.salesTypes = { ST1: { Name: 'Goods', GLAccountID: 'A-REV', Status: 'Active', CompanyID: 'C1' } };
  return f;
}

test('the reports, their comparisons and the access rules', async () => {
  await reset(fixture());
  await jv(M1 + '-02', [['1000', 10000, 0], ['3000', 0, 10000]]);          // capital in cash
  await jv(M1 + '-05', [['1000', 2000, 0], ['4000', 0, 2000]]);            // cash sales last month
  await jv(M1 + '-06', [['6000', 500, 0], ['1000', 0, 500]]);              // rent last month
  await jv(M0 + '-01', [['1000', 3000, 0], ['4000', 0, 3000]]);            // cash sales this month
  await jv(M0 + '-01', [['6000', 400, 0], ['1000', 0, 400]]);              // rent this month
  const inv = ok(await call('u-admin', 'saveCustomerInvoiceDraft', { invoiceData: { InvoiceDate: M0 + '-01', Description: 'Services', CompanyID: 'C1', CustomerID: 'CU1', CostCenterID: 'CC1',
    DirectLines: [{ AccountCode: '4000', Amount: 1000, Description: 'Service', SalesTypeID: 'ST1' }], Discount: 0, TaxPercent: 0 } }));
  ok(await call('u-admin', 'postCustomerInvoice', { invoiceId: inv.invoiceId }));

  const cat = await call('u-admin', 'getMisCatalogue', {});
  assert.ok(cat.catalogue.length >= 13 && cat.rights.design && cat.rights.publish);

  const pl = byKey(await run('profitLoss', M0));
  assert.deepEqual([pl.revenue.current, pl.revenue.compare, pl.revenue.abs, pl.revenue.pct, pl.revenue.good], [4000, 2000, 2000, 100, true]);
  assert.deepEqual([pl.expenses.current, pl.expenses.compare, pl.expenses.good], [400, 500, true], 'expenses down is good');
  assert.equal(pl.netProfit.current, 3600);

  // Vs budget: an approved, current budget of the year with this month's revenue at 5,000.
  const months = Array.from({ length: 12 }, (_, i) => i);
  const yearStart = M0.slice(0, 4) + '-01';
  const amounts = months.map(i => (yearStart.slice(0, 5) + String(i + 1).padStart(2, '0') === M0 ? 5000 : 0));
  await firestore.collection('budgets').doc('B1').set({ CompanyID: 'C1', YearStart: yearStart, Status: 'Approved', Current: true, Kind: 'Year', Lines: [{ AccountID: 'A-REV', Amounts: amounts }] });
  const vb = byKey(await run('profitLoss', M0, 'budget'));
  assert.deepEqual([vb.revenue.current, vb.revenue.compare, vb.revenue.abs, vb.revenue.good], [4000, 5000, -1000, false]);

  const bs = byKey(await run('balanceSheet', M0));
  assert.equal(bs.check.current, 0, 'it balances');
  assert.equal(bs.assets.current, 10000 + 2000 - 500 + 3000 - 400 + 1000, 'cash and the invoice\'s receivable');
  assert.match(await err(run('balanceSheet', M0, 'budget')), /not a budget/);

  const bank = byKey(await run('bankBalances', M0));
  assert.deepEqual([bank.total.current, bank.total.compare], [14100, 11500]);

  const k = byKey(await run('kpis', M0));
  assert.deepEqual([k.sales.current, k.netProfit.current, k.bank.current, k.receivables.current], [4000, 3600, 14100, 1000]);

  const cf = byKey(await run('cashFlow', M0));
  assert.deepEqual([cf.operating.current, cf.net.current], [2600, 2600], 'this month: 3,000 in, 400 out');
  assert.equal(byKey(await run('cashFlow', M1)).financing.current, 10000, 'last month: the capital');

  const ex = await run('expenses', M0);
  assert.equal(ex.rows[0].label, '6000 Rent');

  const ratios = byKey(await run('ratios', M0));
  assert.equal(ratios.netMargin.current, 90, '3,600 ÷ 4,000');

  const trend = await run('trend', M0);
  assert.equal(trend.rows.length, 12);
  assert.deepEqual(trend.rows.slice(-2).map(r => r.revenue), [2000, 4000]);

  const sales = byKey(await run('salesByCustomer', M0));
  assert.deepEqual([sales.CU1.current, sales.CU1.label, sales.total.current], [1000, 'Retail Co', 1000]);

  const stock = byKey(await run('stockInHand', M0));
  assert.ok(stock.total.current >= 0);
  const cover = await run('stockCover', M0);
  assert.ok(Array.isArray(cover.classes) && cover.thresholds.fastDays === 30);

  // The setup: the seed, then saved; its checks.
  const setup = await call('u-admin', 'getMisSetup', { companyId: 'C1' });
  assert.ok(setup.Seeded && setup.RatioMap.cash.includes('A-CASH') && setup.RatioMap.receivables.includes('A-AR'));
  assert.match(await err(call('u-admin', 'saveMisSetup', { companyId: 'C1', RatioMap: { currentAssets: ['A-AP'] }, StockCover: { fastDays: 30, slowDays: 90, days: 90 } })), /Not an asset account/);
  assert.match(await err(call('u-admin', 'saveMisSetup', { companyId: 'C1', RatioMap: {}, StockCover: { fastDays: 90, slowDays: 30, days: 90 } })), /fast under slow/);
  ok(await call('u-admin', 'saveMisSetup', { companyId: 'C1', RatioMap: Object.assign({}, setup.RatioMap), StockCover: { fastDays: 15, slowDays: 60, days: 60 } }));
  assert.equal((await run('stockCover', M0)).thresholds.fastDays, 15);

  // Access: another company, no right, a viewer can't change the setup.
  assert.match(await err(call('u-other', 'runMisReport', { type: 'kpis', companyId: 'C1', month: M0 })), /access to that company/);
  await rtdb.ref('permissions/MIS').set({ access: ['Admin'], design: ['Admin'], publish: ['Admin'] });
  assert.match(await err(call('u-viewer', 'runMisReport', { type: 'kpis', companyId: 'C1', month: M0 })), /access to MIS/);
  assert.match(await err(call('u-admin', 'runMisReport', { type: 'nope', companyId: 'C1', month: M0 })), /Unknown report/);
});
