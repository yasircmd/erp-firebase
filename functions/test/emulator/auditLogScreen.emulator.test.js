// The Audit Log module, step 3 (owner, 2026-11-13; docs/modules/AUDIT_LOG.md,
// Q509, QA9): Admin only; filtered by user, module, action, record and
// dates, newest first; every corporate has it; entries over 7 years old
// are swept; Data Reset clears the log, and the reset is its first entry.
const test = require('node:test');
const assert = require('node:assert/strict');
const { app, firestore, call, reset, baseFixture } = require('./_helpers');

test.after(async () => { await app.delete(); });
const ago = (days) => new Date(Date.now() - days * 86400000).toISOString();
const entry = (id, o) => firestore.doc('auditLog/' + id).set(Object.assign({ At: ago(1), UserID: 'u-admin', UserName: 'Admin User', Role: 'Admin', Action: 'save', Function: 'saveVendor',
  ModuleID: 'VENDORMASTER', RecordID: 'V1', RecordLabel: '', CompanyID: 'C1', Totals: null, Changes: null, Outcome: 'done' }, o));

async function seed() {
  const f = baseFixture();
  f.permissions.AUDITLOG = { access: ['Admin'] }; // as its default: Admin only
  await reset(f);
  await entry('a1', { At: ago(3) });
  await entry('a2', { At: ago(2), UserID: 'u-approver', UserName: 'Approver', Action: 'post', Function: 'postGrn', ModuleID: 'GRN', RecordID: 'G1', RecordLabel: 'GRN-26-000001' });
  await entry('a3', { At: ago(1), Action: 'change', Function: 'saveVendor', Changes: [{ Field: 'Email', From: 'a@x.test', To: 'b@x.test' }] });
  await entry('a4', { At: ago(10), Action: 'signin', Function: 'completeLogin', ModuleID: '', RecordID: 'u-admin', RecordLabel: 'ERP' });
}

test('Admin only: a viewer is refused; reading the log is not itself recorded', async () => {
  await seed();
  await assert.rejects(call('u-viewer', 'getAuditLog', {}), /You do not have access to the Audit Log/);
  await assert.rejects(call('u-viewer', 'getAuditLogFilters', {}), /You do not have access to the Audit Log/);
  const f = await call('u-admin', 'getAuditLogFilters', {});
  assert.ok(f.users.some(u => u.UserID === 'u-approver' && u.Name === 'Approver'));
  assert.ok(f.modules.some(m => m.id === 'AUDITLOG' && m.label === 'Audit Log'));
  assert.equal(f.keepYears, 7);
  const all = await call('u-admin', 'getAuditLog', {});
  assert.deepEqual(all.rows.map(r => r.id), ['a3', 'a2', 'a1', 'a4'], 'newest first');
  assert.equal(all.more, false);
  const ids = (await firestore.collection('auditLog').get()).docs.map(d => d.id).sort();
  assert.deepEqual(ids, ['a1', 'a2', 'a3', 'a4'], 'reading is not an action, nor is a refused read (QA1)');
});

test('the filters: user, module, action, a record by number or id, and the dates', async () => {
  await seed();
  const q = async d => (await call('u-admin', 'getAuditLog', d)).rows.map(r => r.id);
  assert.deepEqual(await q({ userId: 'u-approver' }), ['a2']);
  assert.deepEqual(await q({ moduleId: 'VENDORMASTER' }), ['a3', 'a1']);
  assert.deepEqual(await q({ action: 'signin' }), ['a4']);
  assert.deepEqual(await q({ record: 'GRN-26-000001' }), ['a2'], 'by its number');
  assert.deepEqual(await q({ record: 'V1' }), ['a3', 'a1'], 'by its id');
  assert.deepEqual(await q({ moduleId: 'VENDORMASTER', action: 'change' }), ['a3'], 'two filters');
  assert.deepEqual(await q({ fromAt: ago(5), toAt: ago(1.5) }), ['a2', 'a1'], 'the dates');
  await assert.rejects(call('u-admin', 'getAuditLog', { fromAt: ago(1), toAt: ago(5) }), /The From date is after the To date/);
  await assert.rejects(call('u-admin', 'getAuditLog', { fromAt: '13/11/2026' }), /Enter valid dates/);
});

test('every corporate has it, whatever the firm ticked (QA9)', async () => {
  const { availableIn } = require('../../src/entitlements');
  assert.equal(availableIn('200', { Modules: {} }, 'AUDITLOG'), true);
  assert.equal(availableIn('200', { Modules: { AUDITLOG: false } }, 'AUDITLOG'), true, 'not even switched off');
  assert.equal(availableIn('200', { Modules: {} }, 'CRM'), false, 'a later module as before');
});

test('the 7-year sweep removes only older entries', async () => {
  await seed();
  const years = n => { const d = new Date(); d.setUTCFullYear(d.getUTCFullYear() - n); return d.toISOString(); };
  await entry('old1', { At: years(8) });
  await entry('old2', { At: years(7.1) });
  await entry('keep', { At: years(6) });
  const removed = await require('../../src/audit').sweepExpired(new Date());
  assert.equal(removed, 2);
  const left = (await firestore.collection('auditLog').get()).docs.map(d => d.id).sort();
  assert.deepEqual(left, ['a1', 'a2', 'a3', 'a4', 'keep']);
});

test('Data Reset clears the log; the reset is then its first entry', async () => {
  await seed();
  const { rtdb } = require('./_helpers');
  await rtdb.ref('users/u-root').set({ status: 'Active', role: 'ADMIN', username: 'root', fullName: 'Root', AssignedCompanies: ['C1'] });
  const r = await call('u-root', 'clearDataCategories', { categoryKeys: ['auditLog'], confirmPhrase: 'DELETE' });
  assert.notEqual(r && r.success, false, JSON.stringify(r));
  const left = (await firestore.collection('auditLog').get()).docs.map(d => d.data());
  assert.deepEqual(left.map(e => [e.Action, e.Function, e.UserID]), [['reset', 'clearDataCategories', 'u-root']]);
});
