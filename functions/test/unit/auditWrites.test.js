// The audit log, step 2 (docs/modules/AUDIT_LOG.md, QA2, QA3, QA8): which
// records a write touches, what counts as a change, and what is never
// recorded by value.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const W = require('../../src/auditWrites');
const A = require('../../src/audit');

test('the records a Realtime Database write touches', () => {
  assert.deepEqual(W.rtdbRecords('vendors/V1', 'set', {}).list, ['vendors/V1']);
  assert.deepEqual(W.rtdbRecords('vendors/V1/Email', 'set', 'x').list, ['vendors/V1'], 'a field: its record');
  assert.deepEqual(W.rtdbRecords('exchangeRates/USD/-Nk1', 'set', {}).list, ['exchangeRates/USD/-Nk1'], 'a rate: depth 3');
  assert.deepEqual(W.rtdbRecords('stock/X', 'set', {}).list, [], 'not a master');
  assert.deepEqual(W.rtdbRecords('', 'update', { 'vendors/V1/Name': 'a', 'vendors/V2': {}, 'gl/J1': {} }).list.sort(), ['vendors/V1', 'vendors/V2'], 'a multi-path update: by record, masters only');
  assert.deepEqual(W.rtdbRecords('roles', 'update', { R1: { Name: 'a' }, R2: null }).list.sort(), ['roles/R1', 'roles/R2']);
  assert.equal(W.rtdbRecords('permissions', 'set', {}).whole, 'permissions', 'a small list set whole: read whole');
  const big = W.rtdbRecords('customers', 'set', { C1: {}, C2: {} });
  assert.deepEqual([big.many, big.count], [true, 2], 'a large list set whole: a summary, unread');
  const many = {}; for (let i = 0; i <= W.MANY; i++) many['vendors/V' + i + '/Name'] = 'x';
  assert.equal(W.rtdbRecords('', 'update', many).many, true, 'more than MANY records: a summary');
});

test('what counts as a change: noise fields are not; a posting\'s balances are not; at most 100', () => {
  assert.deepEqual(A.fieldChanges({ Name: 'a', UpdatedAt: '1', lastLogin: 'x' }, { Name: 'b', UpdatedAt: '2', lastLogin: 'y' }),
    [{ Field: 'Name', From: 'a', To: 'b' }]);
  assert.deepEqual(A.fieldChanges({ Bands: { C1: { Min: 1 } } }, { Bands: { C1: { Min: 2 } } }), [{ Field: 'Bands.C1.Min', From: 1, To: 2 }], 'nested: dotted');
  assert.deepEqual(A.fieldChanges({ write: ['A'] }, { write: ['A', 'B'] }), [{ Field: 'write', From: '["A"]', To: '["A","B"]' }], 'a list: as a whole');
  assert.deepEqual(A.fieldChanges(null, { Name: 'n' }), [{ Field: 'Name', From: null, To: 'n' }]);
  const ignore = /^Areas\.[^.]+\.(AccDep)$/;
  assert.deepEqual(A.fieldChanges({ Areas: { BOOK: { AccDep: 1, Life: 5 } } }, { Areas: { BOOK: { AccDep: 2, Life: 5 } } }, ignore), []);
  const a = {}, b = {}; for (let i = 0; i < 130; i++) { a['f' + i] = 1; b['f' + i] = 2; }
  const out = A.fieldChanges(a, b);
  assert.equal(out.length, 101);
  assert.deepEqual(out[100], { Field: '…', More: 30 });
});

test('sensitive fields (QA3): only that they changed, never their values', () => {
  const out = A.fieldChanges({ IBAN: 'AE07', BankAccountNo: '123', Password: 'p', smtpToken: 't', Salary: 1, BankName: 'X' },
    { IBAN: 'AE46', BankAccountNo: '456', Password: 'q', smtpToken: 'u', Salary: 2, BankName: 'Y' });
  assert.deepEqual(out, [
    { Field: 'BankAccountNo', Changed: true }, { Field: 'BankName', From: 'X', To: 'Y' }, { Field: 'IBAN', Changed: true },
    { Field: 'Password', Changed: true }, { Field: 'Salary', Changed: true }, { Field: 'smtpToken', Changed: true }]);
  const pay = A.masterEntry({ key: 'fs:employeeCompensation/E1', module: 'EMPLOYEES', before: null, after: { Lines: [{ Amount: 3000 }], Currency: 'AED' } });
  assert.ok(pay.Changes.every(c => c.Changed === true), 'a pay record: every field');
  assert.equal(JSON.stringify(pay).includes('3000'), false);
});

test('the entry for a record: create, change, delete, nothing, many', () => {
  const e = A.masterEntry({ key: 'rtdb:vendors/V1', module: 'VENDORMASTER', before: { VendorName: 'Acme', Days: 30, CompanyID: 'C1' }, after: { VendorName: 'Acme', Days: 45, CompanyID: 'C1' } });
  assert.deepEqual([e.Action, e.ModuleID, e.RecordID, e.RecordLabel, e.Source, e.CompanyID], ['change', 'VENDORMASTER', 'V1', 'Acme', 'rtdb:vendors', 'C1']);
  assert.equal(A.masterEntry({ key: 'rtdb:vendors/V1', before: { A: 1, UpdatedAt: 'x' }, after: { A: 1, UpdatedAt: 'y' } }), null, 'only noise: nothing');
  assert.equal(A.masterEntry({ key: 'fs:hrGrades/G1', before: { Name: 'g' }, after: null }).Action, 'delete');
  assert.equal(A.masterEntry({ key: 'fs:hrGrades/G1', before: null, after: { Name: 'g' } }).Source, 'hrGrades');
  assert.equal(A.masterEntry({ key: 'rtdb:approvalFollowUpSettings/PDC', before: { DaysBefore: 3 }, after: { DaysBefore: 5 } }).Changes[0].Field, 'DaysBefore');
  assert.equal(A.masterEntry({ key: 'rtdb:items', module: 'ITEMMASTER', many: 2, ids: ['I1', 'I2'] }).RecordID, '(2 records)');
  assert.equal(A.masterEntry({ key: 'rtdb:items', many: 1 }).RecordID, '(1 record)');
  assert.equal(A.masterEntry({ key: 'rtdb:items', many: 'all' }).RecordID, '(the whole list)');
});

test('the handles go through the wrapper; only audit.js writes the log', () => {
  const src = fs.readFileSync(path.join(__dirname, '../../src/firebaseAdmin.js'), 'utf8');
  assert.match(src, /rtdb: auditedRtdb, firestore: auditedFirestore/);
  assert.match(src, /firestore: require\('\.\/auditWrites'\)\.firestoreHandle\(homeApp\.firestore\(\), 'provider'\)/);
  assert.equal(/auditLog/.test(fs.readFileSync(path.join(__dirname, '../../src/auditWrites.js'), 'utf8')), false);
  // Every listed module id is a real module.
  const ids = new Set(require('../../src/moduleRegistry').MODULE_REGISTRY.map(m => m.id));
  const used = Object.values(W.RTDB).map(x => x[0]).concat(Object.values(W.FIRESTORE), Object.values(W.PROVIDER));
  assert.deepEqual(used.filter(m => !ids.has(m)), []);
});
