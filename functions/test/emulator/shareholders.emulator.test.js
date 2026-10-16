// Shareholders in Company Master (owner, 2026-10-16; docs/modules/UX_TIER3.md,
// F, decisions 162-163): their own right to see them, Company Master write
// to change them; the % of the issued shares, a total other than 100%
// warned, not refused; history kept (a to date), a mistaken record removed
// with a reason; every change logged; not in the company record.
const test = require('node:test');
const assert = require('node:assert/strict');
const { app, call, reset, baseFixture, rtdb } = require('./_helpers');

test.after(async () => { await app.delete(); });
const err = async p => (await p.catch(e => e)).message;
const get = (uid, co) => call(uid || 'u-admin', 'getCompanyShareholders', { companyId: co || 'C1' });
const save = (h, uid) => call(uid || 'u-admin', 'saveCompanyShareholder', { companyId: 'C1', shareholder: Object.assign({ Nationality: 'Exampleland', IDNumber: 'P0000001', FromDate: '2020-01-01' }, h) });

test('rights: the shareholders right to see them, with write to change them; company access', async () => {
  const f = baseFixture();
  f.roles.Clerk = { Name: 'Clerk', Status: 'Active' };
  f.users['u-clerk'] = { status: 'Active', role: 'Clerk', username: 'clerk', fullName: 'Clerk', AssignedCompanies: ['C1'] };
  f.permissions.COMPANYMASTER.access.push('Clerk');
  f.permissions.COMPANYMASTER.shareholders.push('Clerk'); // sees them, cannot change them
  await reset(f);
  assert.deepEqual(await call('u-admin', 'getCompanyShareholders', { rightsOnly: true }), { CanView: true, CanEdit: true });
  assert.deepEqual(await call('u-viewer', 'getCompanyShareholders', { rightsOnly: true }), { CanView: false, CanEdit: false });
  assert.deepEqual(await call('u-clerk', 'getCompanyShareholders', { rightsOnly: true }), { CanView: true, CanEdit: false });
  assert.match(await err(get('u-viewer')), /permission to see shareholders/);
  assert.match(await err(save({ Name: 'A', Shares: 1 }, 'u-clerk')), /permission to change shareholders/);
  assert.match(await err(get('u-admin', 'C2')), /access to that company/);
  assert.equal((await get('u-clerk')).CanEdit, false);
});

test('the % of the issued shares; not forced to 100% but warned; history kept; removal with a reason; logged; not in the company record', async () => {
  await reset(baseFixture());
  let r = await get();
  assert.deepEqual([r.IssuedShares, r.Holders, r.Warning], [0, [], '']);
  assert.match(await err(save({ Name: '', Shares: 10 })), /shareholder's name/);
  assert.match(await err(save({ Name: 'Alex Example', Shares: 0 })), /above zero/);
  assert.match(await err(save({ Name: 'Alex Example', Shares: 10, FromDate: '2020-02-30' })), /date the shares were held from/);
  assert.match(await err(save({ Name: 'Alex Example', Shares: 10, ToDate: '2019-01-01' })), /before the from date/);

  r = await save({ Name: 'Alex Example', Shares: 600 });
  assert.match(r.Warning, /Enter the issued shares/);
  assert.equal(r.Holders[0].Percent, null);
  r = await call('u-admin', 'saveCompanyIssuedShares', { companyId: 'C1', issuedShares: 1000 });
  assert.deepEqual([r.Holders[0].Percent, r.Current.Percent], [60, 60]);
  assert.match(r.Warning, /hold 600 of the 1000 issued shares \(60%\), not 100%/);
  const bee = (await save({ Name: 'Bee Sample', Shares: 400 })).shareholderId;
  r = await get();
  assert.deepEqual([r.Current.Shares, r.Current.Percent, r.Warning], [1000, 100, '']);
  assert.deepEqual(r.Holders.map(h => [h.Name, h.Percent, h.State]), [['Alex Example', 60, 'Current'], ['Bee Sample', 40, 'Current']]);

  // Bee sells to Cy: a to date for Bee (kept as a past shareholder), Cy from the next day.
  await save({ ShareholderID: bee, Name: 'Bee Sample', Shares: 400, ToDate: '2024-06-30' });
  r = await save({ Name: 'Cy Placeholder', Shares: 400, FromDate: '2024-07-01' });
  assert.deepEqual(r.Holders.map(h => [h.Name, h.State]), [['Alex Example', 'Current'], ['Cy Placeholder', 'Current'], ['Bee Sample', 'Past']]);
  assert.deepEqual([r.Current.Count, r.Current.Percent, r.Warning], [2, 100, '']);
  // A future holder is not counted yet; over 100% is warned too.
  r = await save({ Name: 'Dee Later', Shares: 100, FromDate: '2099-01-01' });
  assert.equal(r.Holders.find(h => h.Name === 'Dee Later').State, 'Future');
  assert.equal(r.Warning, '');
  r = await save({ Name: 'Eve Extra', Shares: 50 });
  assert.match(r.Warning, /hold 1050 of the 1000 issued shares \(105%\)/);
  // Entered by mistake: removed, with a reason.
  const eve = r.Holders.find(h => h.Name === 'Eve Extra').ShareholderID;
  assert.match(await err(call('u-admin', 'removeCompanyShareholder', { companyId: 'C1', shareholderId: eve, reason: ' ' })), /reason/);
  r = await call('u-admin', 'removeCompanyShareholder', { companyId: 'C1', shareholderId: eve, reason: 'Entered twice' });
  assert.ok(!r.Holders.some(h => h.Name === 'Eve Extra'));
  assert.deepEqual(r.Log.slice(0, 2).map(l => [l.Action, l.Name]), [['Removed', 'Eve Extra'], ['Add', 'Eve Extra']]);
  assert.match(r.Log[0].Text, /Entered twice/);
  assert.ok(r.Log.some(l => l.Action === 'Left' && l.Name === 'Bee Sample' && /to 2024-06-30/.test(l.Text)), JSON.stringify(r.Log));
  assert.ok(r.Log.some(l => l.Action === 'Issued shares' && l.Text === '0 → 1000'));
  assert.equal(r.Log[0].ByName, 'Admin User');
  // Personal data stays out of the company record every Company Master user reads.
  const companies = await call('u-viewer', 'getCompanies');
  assert.ok(!JSON.stringify(companies).includes('Alex Example'));
  assert.equal((await rtdb.ref('companies/C1/Shareholders').get()).val(), null);
});
