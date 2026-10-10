// Employee Portal (docs/modules/EMPLOYEE_PORTAL.md): the default password
// by the owner's rule (decision 92), the hidden sign-in email made from the
// Employee Code (the same in the portal page, public/ess.html), and the
// new password's rules.
//   node --test functions/test/unit/essPortal.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { defaultPassword, essEmail, checkNewPassword } = require('../../src/essPortal');

test('the default password: the first 4 letters of the name, lowercase, plus the last 4 digits of the code', () => {
  assert.equal(defaultPassword({ FullName: 'Ali Hassan', EmployeeNo: 'EMP-0007' }), 'alih0007');
  assert.equal(defaultPassword({ FullName: 'Al Ain', EmployeeNo: 'E-123' }), 'alai123'); // spaces skipped; fewer digits: all of them
  assert.equal(defaultPassword({ FullName: 'Jo', EmployeeNo: 'EMP-2026-00451' }), 'jo0451'); // a short name whole; the last 4 digits
  assert.equal(defaultPassword({ FullName: 'Zoë O\'Brien', EmployeeNo: 'EMP-0012' }), 'zoeo0012'); // accents removed, letters only
});

test('the hidden email, the same in the portal page', () => {
  const page = fs.readFileSync(path.join(__dirname, '../../../public/ess.html'), 'utf8');
  const src = page.match(/function essEmail\(code\) \{[\s\S]*?\n\s*\}/);
  assert.ok(src, 'essEmail in public/ess.html');
  const ctx = vm.createContext({});
  vm.runInContext(src[0] + '\nthis.essEmail = essEmail;', ctx);
  for (const code of ['EMP-0007', ' emp-0007 ', 'BP/01 26', '..X.1', 'Ab_C-9.z', '']) assert.equal(ctx.essEmail(code), essEmail(code), code);
  assert.equal(essEmail('EMP-0007'), 'emp-0007@ess.invalid');
  assert.equal(essEmail(' BP/01 26 '), 'bp_01_26@ess.invalid');
});

test('the new password: 8 characters or more, not the default, not containing the Employee Code', () => {
  const e = { FullName: 'Ali Hassan', EmployeeNo: 'EMP-0007' };
  assert.throws(() => checkNewPassword(e, 'short'), /at least 8/);
  assert.throws(() => checkNewPassword(e, 'Xemp-0007!'), /can't contain your Employee Code/);
  assert.throws(() => checkNewPassword(e, 'xx EMP0007 x'), /can't contain your Employee Code/);
  checkNewPassword(e, 'Sunrise#2026');
});

test('the portal shows dates and months as the ERP does (dd/mm/yyyy, Sep-2026)', () => {
  const page = fs.readFileSync(path.join(__dirname, '../../../public/ess.html'), 'utf8');
  const part = page.slice(page.indexOf('const MONTHS = '), page.indexOf('const money = '));
  const ctx = vm.createContext({});
  vm.runInContext(part + '\nthis.showDate = showDate; this.showMonth = showMonth; this.showTime = showTime;', ctx);
  const shell = fs.readFileSync(path.join(__dirname, '../../../public/index.html'), 'utf8');
  const block = shell.slice(shell.indexOf('// ---------- DATE FORMAT ----------'), shell.indexOf('// ---------- END DATE FORMAT ----------'));
  const sctx = vm.createContext({});
  vm.runInContext(block.slice(block.indexOf('const MONTH_NAMES'), block.indexOf('window.isoLocalDateTime = ')) + '\nthis.f = formatDatesInText;', sctx);
  for (const d of ['2026-09-29', '2026-01-01', '2027-12-31']) assert.equal(ctx.showDate(d), sctx.f(d), d);
  for (const m of ['2026-09', '2026-01', '2027-12']) assert.equal(ctx.showMonth(m), sctx.f(m), m);
  const t = '2026-09-20T08:03:11.512Z';
  assert.equal(ctx.showTime(t), sctx.f(new Date(t).getFullYear() + '-' + String(new Date(t).getMonth() + 1).padStart(2, '0') + '-' + String(new Date(t).getDate()).padStart(2, '0') + ' ' +
    String(new Date(t).getHours()).padStart(2, '0') + ':' + String(new Date(t).getMinutes()).padStart(2, '0')));
});
