// Re-match on screen (owner, 2026-10-16; docs/modules/UX_TIER3.md, G): a
// posted CBT payment matched to the wrong bill is re-matched from its own
// view (Re-match references → Allocate… → Save re-match, with a reason); the
// open items follow; a user without the "rematch" right has no button; a JV
// with a party line offers it too.
// Seeds its own data (it WIPES the emulator database, like the suites):
//   node functions/test/ui/rematch.ui.js
const http = require('http');
const fs = require('fs');
const assert = require('assert/strict');
const { chromium } = require('playwright');
const { onAppDialog } = require('./_appDialogs');
const { app, call, reset, baseFixture, firestore } = require('../emulator/_helpers');

const results = [];
function check(name, fn) { return fn().then(() => { results.push(['PASS', name]); }, e => { results.push(['FAIL', name, e.message.replace(/\s+/g, ' ').slice(0, 300)]); }); }
const ok = r => { if (!r.success) throw new Error(r.error); return r; };
const D = '2026-09-10';

(async () => {
  const f = baseFixture();
  f.coa['A-FRT'] = { AccountCode: '6100', AccountName: 'Freight', AccountType: 'Expense', Status: 'Active', IsPostable: true };
  // A poster without the rematch right.
  f.roles.Poster = { Name: 'Poster', Status: 'Active' };
  f.users['u-poster'] = { status: 'Active', role: 'Poster', username: 'poster', fullName: 'Poster', AssignedCompanies: ['C1'] };
  ['CBT', 'JV'].forEach(m => ['access', 'draft', 'post'].forEach(c => f.permissions[m][c].push('Poster')));
  await reset(f);
  const bill = async total => {
    const s = ok(await call('u-admin', 'saveVendorInvoiceDraft', { invoiceData: { InvoiceDate: '2026-09-01', Description: 'Bill ' + total, VendorRefNumber: 'B' + total, CompanyID: 'C1', VendorID: 'V1',
      CostCenterID: 'CC1', SourceGRNs: [], DirectLines: [{ AccountCode: '6100', Amount: total, Description: 'Freight', CostCenterID: 'CC1' }] } }));
    const p = ok(await call('u-admin', 'postVendorInvoice', { invoiceId: s.invoiceId }));
    return { ref: 'VendorInvoice:' + s.invoiceId, number: p.invoiceNumber };
  };
  const b1 = await bill(300), b2 = await bill(200);
  const pay = ok(await call('u-admin', 'saveCbtDraft', { cbtData: { VoucherType: 'Bank Payment', SelectedAccountCode: '1100', JVDate: D, Description: 'Pay Acme', CompanyID: 'C1', CostCenterID: 'CC1',
    OppositeLines: [{ AccountCode: '2000', Amount: 200, Description: 'Payment', PartyType: 'Vendor', PartyID: 'V1', Allocations: [{ RefType: 'Against', RefID: b1.ref, Amount: 200 }] }] } })).jvId;
  ok(await call('u-admin', 'postJournalEntry', { jvId: pay }));
  const jv = ok(await call('u-admin', 'saveJournalDraft', { jvData: { JVDate: D, Description: 'Advance', CompanyID: 'C1', CurrencyCode: 'AED', Lines: [
    { AccountCode: '2000', Debit: 50, Description: 'Advance', PartyType: 'Vendor', PartyID: 'V1', Allocations: [{ RefType: 'New', Amount: 50 }] },
    { AccountCode: '1100', Credit: 50, Description: 'Bank' }] } })).jvId;
  ok(await call('u-admin', 'postJournalEntry', { jvId: jv }));

  const harness = (require('./buildHarness'), fs.readFileSync(__dirname + '/harness.html'));
  const server = http.createServer((req, res) => { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(harness); }).listen(8164);
  const browser = await chromium.launch();
  const T = { timeout: 30000 };
  async function open(module, uid, answer) {
    const page = await browser.newPage();
    page.__errors = []; page.__dialogs = [];
    page.on('pageerror', e => page.__errors.push(e.message));
    await onAppDialog(page, d => { page.__dialogs.push(d.message()); d.accept(answer && d.type() === 'prompt' ? answer : undefined); });
    await page.goto('http://127.0.0.1:8164/?module=' + module + '&uid=' + uid);
    await page.waitForFunction(() => window.__moduleReady === true, null, T);
    await page.waitForLoadState('networkidle');
    return page;
  }
  const openFirst = async (page, p) => {
    await page.waitForSelector('.' + p + '-open', T);
    await page.locator('.' + p + '-open').first().click();
    await page.waitForSelector('.' + p + '-party-row', T);
    await page.waitForLoadState('networkidle');
  };

  await check('CBT: Re-match references → Allocate… the other bill → Save re-match, with a reason; the books stay, the open items follow', async () => {
    const page = await open('CBT', 'u-admin', 'Wrong bill picked');
    await openFirst(page, 'cbt');
    await page.waitForSelector('#cbt-rematch-btn:not(.hidden)', T);
    assert.ok(await page.isHidden('#cbt-rematch-save-btn'));
    await page.click('#cbt-rematch-btn');
    assert.ok(await page.isHidden('#cbt-reverse-btn'), 'no Reverse while re-matching');
    await page.click('.cbt-allocate-btn');
    await page.waitForSelector('#cbt-alloc-modal input[data-ref="' + b2.ref + '"]', T);
    // This entry's own 200 counts back in: B1 shows 300 outstanding, with its 200 filled in.
    assert.equal(await page.inputValue('#cbt-alloc-modal input[data-ref="' + b1.ref + '"]'), '200');
    assert.equal((await page.textContent('#cbt-alloc-modal tr:has(input[data-ref="' + b1.ref + '"]) td:nth-child(5)')).trim(), '300.00');
    await page.click('.cbt-alloc-clear');
    await page.fill('#cbt-alloc-modal input[data-ref="' + b2.ref + '"]', '200');
    await page.click('.cbt-alloc-ok');
    assert.match(await page.textContent('.cbt-party-row'), new RegExp('Against ' + b2.number + ' 200.00'));
    await page.click('#cbt-rematch-save-btn');
    await page.waitForSelector('#cbt-list-view', { state: 'visible', ...T });
    assert.ok(page.__dialogs.some(m => /^Re-match .*\? Only which items it settles changes/.test(m)), page.__dialogs.join(' | '));
    assert.ok(page.__dialogs.some(m => /^Re-matched/.test(m)), page.__dialogs.join(' | '));
    const e = (await firestore.collection('journalEntries').doc(pay).get()).data();
    const line = e.Lines.find(l => l.PartyType === 'Vendor');
    assert.deepEqual([line.Credit || line.Debit, line.Allocations.map(a => a.RefID)], [200, [b2.ref]]);
    assert.equal(e.Rematches[0].Reason, 'Wrong bill picked');
    const items = (await call('u-admin', 'getPartyOpenItems', { partyType: 'Vendor', partyId: 'V1', companyId: 'C1' })).map(i => [i.Number, i.Outstanding]);
    assert.deepEqual(items.filter(i => i[0] === b1.number || i[0] === b2.number), [[b1.number, 300]]);
    assert.deepEqual(page.__errors, []);
    await page.close();
  });

  await check('Cancel re-match puts the entry back as it was', async () => {
    const page = await open('CBT', 'u-admin');
    await openFirst(page, 'cbt');
    await page.click('#cbt-rematch-btn');
    await page.click('.cbt-allocate-btn');
    await page.waitForSelector('#cbt-alloc-modal input[data-ref]', T);
    await page.click('.cbt-alloc-clear');
    await page.click('.cbt-alloc-ok');
    assert.doesNotMatch(await page.textContent('.cbt-party-row'), new RegExp('Against ' + b2.number));
    await page.click('#cbt-rematch-cancel-btn');
    await page.waitForSelector('#cbt-rematch-btn:not(.hidden)', T);
    assert.match(await page.textContent('.cbt-party-row'), new RegExp('Against ' + b2.number + ' 200.00'));
    assert.equal(await page.locator('.cbt-allocate-btn').count(), 0, 'read-only again');
    await page.close();
  });

  await check('JV: a posted entry with a party line offers Re-match; a poster without the right does not see it', async () => {
    const page = await open('JV', 'u-admin');
    await openFirst(page, 'jv');
    await page.waitForSelector('#jv-rematch-btn:not(.hidden)', T);
    await page.close();
    for (const [m, p] of [['JV', 'jv'], ['CBT', 'cbt']]) {
      const q = await open(m, 'u-poster');
      await openFirst(q, p);
      await q.waitForTimeout(500);
      assert.ok(await q.isHidden('#' + p + '-rematch-btn'), m);
      assert.ok(await q.isVisible('#' + p + '-reverse-btn'), m + ': the poster still reverses');
      await q.close();
    }
  });

  await browser.close(); server.close(); await app.delete();
  results.forEach(r => console.log(r.join('  ')));
  const failed = results.filter(r => r[0] === 'FAIL').length;
  console.log((results.length - failed) + '/' + results.length + ' passed');
  process.exitCode = failed ? 1 : 0;
})();
