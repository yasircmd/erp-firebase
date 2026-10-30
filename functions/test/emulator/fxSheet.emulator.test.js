// Exchange rates from the firm's Google Sheet (docs/modules/FX_SHEET.md,
// Q281, Q329-Q331), the sheet served here on a local address (allowed on
// the emulator only): the firm saves its link in the Developer screen (a
// link that isn't a published CSV refused); a corporate reads its base
// currency's rows beside its last rates, a move over 5% marked; nothing
// applies until confirmed; Apply adds ordinary rates, refused if the sheet
// changed since; the "rates" right checked.
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const { app, call, reset, baseFixture, val } = require('./_helpers');

let csv = '';
const server = http.createServer((req, res) => { res.writeHead(200, { 'Content-Type': 'text/csv' }); res.end(csv); }).listen(8191, '127.0.0.1');
test.after(async () => { server.close(); await app.delete(); });
const URL = 'http://127.0.0.1:8191/rates.csv';
const err = p => p.then(() => 'no error', e => e.message);

async function ready() {
  const f = baseFixture();
  f.currencies = {
    CUR1: { Code: 'AED', Name: 'UAE Dirham', IsDefault: true, Status: 'Active' }, CUR2: { Code: 'USD', Name: 'US Dollar', Status: 'Active' },
    CUR3: { Code: 'EUR', Name: 'Euro', Status: 'Active' }, CUR4: { Code: 'GBP', Name: 'Pound', Status: 'Active' }, CUR5: { Code: 'JPY', Name: 'Yen', Status: 'Inactive' }
  };
  f.exchangeRates = { USD: { r1: { EffectiveDate: '2026-10-01', Rate: 3.6725, Note: '', By: 'admin', ByName: 'Admin', At: '2026-10-01T08:00:00Z' } },
    EUR: { r1: { EffectiveDate: '2026-10-01', Rate: 3.9, Note: '', By: 'admin', ByName: 'Admin', At: '2026-10-01T08:00:00Z' } } };
  await reset(f);
  csv = 'Currency,Base,Rate\nUSD,AED,3.6730\nEUR,AED,4.2\nGBP,AED,"4,8"\nUSD,INR,84.1\nCHF,AED,4.5\n';
}

test('the firm\'s link saved in the Developer screen; only a published CSV link', async () => {
  await ready();
  assert.match(await err(call('u-admin', 'saveDeveloperFxSheet', { url: 'https://example.com/rates.csv' })), /published CSV link/);
  assert.match(await err(call('u-viewer', 'saveDeveloperFxSheet', { url: URL })), /permission to change the corporates/);
  assert.equal((await call('u-admin', 'saveDeveloperFxSheet', { url: URL })).success, true);
  assert.equal((await call('u-admin', 'getDeveloperCorporates', {})).fxSheetUrl, URL);
});

test('read on a click: the base currency\'s rows beside the last rates, a big move marked, what can\'t be used said', async () => {
  await ready();
  await call('u-admin', 'saveDeveloperFxSheet', { url: URL });
  const r = await call('u-admin', 'getSheetRates', {});
  assert.equal(r.base, 'AED');
  assert.deepEqual(r.rows.map(x => [x.Code, x.SheetRate, x.LastRate, x.ChangePct, x.Big]), [['EUR', 4.2, 3.9, 7.69, true], ['USD', 3.673, 3.6725, 0.01, false]]);
  assert.ok(r.problems.some(p => /CHF: in the sheet, but not an active currency here/.test(p)), r.problems.join(' | '));
  assert.ok(r.problems.some(p => /GBP in AED: the rate "4,8" has a comma/.test(p)), 'a comma decimal never read as 48');
  assert.equal((await val('exchangeRates/USD/r1')).Rate, 3.6725, 'nothing applied by reading');
  assert.equal(Object.keys(await val('exchangeRates/USD')).length, 1);
  assert.match(await err(call('u-viewer', 'getSheetRates', {})), /permission to enter exchange rates/);
});

test('Apply adds ordinary rates at the sheet\'s value, all or none; refused once the sheet changed', async () => {
  await ready();
  await call('u-admin', 'saveDeveloperFxSheet', { url: URL });
  const a = await call('u-admin', 'applySheetRates', { effectiveDate: '2026-10-30', rates: [{ code: 'USD', rate: 3.673 }, { code: 'EUR', rate: 4.2 }] });
  assert.equal(a.applied, 2);
  const usd = Object.values(await val('exchangeRates/USD')).find(x => x.EffectiveDate === '2026-10-30');
  assert.deepEqual([usd.Rate, usd.Note, usd.By], [3.673, 'From the sheet', 'admin']);
  assert.equal((await call('u-admin', 'getExchangeRateOn', { code: 'USD', date: '2026-10-30' })).Rate, 3.673, 'a document takes it like any rate');
  csv = csv.replace('3.6730', '3.6800').replace('"4,8"', '4.8');
  assert.match(await err(call('u-admin', 'applySheetRates', { effectiveDate: '2026-10-31', rates: [{ code: 'GBP', rate: 4.8 }, { code: 'USD', rate: 3.673 }] })), /USD rate has changed since \(now 3\.68\)/);
  assert.equal(await val('exchangeRates/GBP'), null, 'all or none: GBP not applied either');
  assert.match(await err(call('u-admin', 'applySheetRates', { effectiveDate: '2026-10-31', rates: [{ code: 'JPY', rate: 1 }] })), /JPY is not an active currency/);
  assert.match(await err(call('u-admin', 'applySheetRates', { effectiveDate: '', rates: [{ code: 'GBP', rate: 4.8 }] })), /Enter the date/);
});
