// Payroll payment files (owner, 2026-10-04; docs/modules/HR_PAYROLL.md,
// step 4): the file built from each company's own format, delimited or
// fixed width, with the UAE WPS SIF as a starting point. No emulator.
const test = require('node:test');
const assert = require('node:assert/strict');
const files = require('../../src/payrollFiles');

const bad = m => { throw new Error(m); };
const created = new Date(Date.UTC(2026, 7, 3, 9, 5, 7)); // 03/08/2026 09:05:07 (the company's time)
const rows = [
  { EMP_NO: 'EMP-0001', EMP_NAME: 'Ali Hassan', WPS_ID: '10012345678901', ROUTING: '803320101', IBAN: 'AE070331234567890123456', BANK: 'ENBD', NET: 8700, FIXED: 8200, VARIABLE: 500, DAYS: 31, UNPAID_DAYS: 1 },
  { EMP_NO: 'EMP-0002', EMP_NAME: 'Ben Okafor', WPS_ID: '10012345678902', ROUTING: '803320101', IBAN: 'AE070331234567890123457', BANK: 'ENBD', NET: 1500.5, FIXED: 1500.5, VARIABLE: 0, DAYS: 31, UNPAID_DAYS: 0 }
];

test('the UAE WPS SIF starter: an EDR per employee and the SCR trailer, named by the employer and the creation time', () => {
  const fmt = files.cleanFormat(Object.assign({}, files.WPS_SIF, { Values: { EmployerID: '0000123456789', BankCode: '803320101', Currency: 'AED', Reference: 'JUL' } }), bad);
  const f = files.buildFile({ format: fmt, month: '2026-07', payDate: '2026-08-03', created, rows });
  assert.equal(f.fileName, '0000123456789260803090507.SIF');
  assert.equal(f.content, [
    'EDR,10012345678901,803320101,AE070331234567890123456,2026-07-01,2026-07-31,31,8200.00,500.00,1',
    'EDR,10012345678902,803320101,AE070331234567890123457,2026-07-01,2026-07-31,31,1500.50,0.00,0',
    'SCR,0000123456789,803320101,2026-08-03,0905,072026,2,10200.50,AED,JUL', ''].join('\r\n'));
  assert.deepEqual([f.count, f.total], [2, 10200.5]);
});

test('a bank\'s own layout: fixed width with a header, padding, upper case, LF', () => {
  const fmt = files.cleanFormat({ Name: 'Bank X', Type: 'Fixed', Extension: 'txt', FileName: 'SAL{MONTH:yyyyMM}', LineEnd: 'LF', Values: { EmployerID: 'E77' },
    Records: {
      Header: [{ Source: 'TEXT', Text: 'H', Width: 1 }, { Source: 'EMPLOYER', Width: 6, Pad: 'Left', PadChar: '0' }, { Source: 'PAY_DATE', Format: 'ddMMyyyy', Width: 8 }],
      Employee: [{ Source: 'TEXT', Text: 'D', Width: 1 }, { Source: 'EMP_NAME', Width: 8, Upper: true }, { Source: 'NET', Decimals: 2, Width: 10, Pad: 'Left', PadChar: '0' }],
      Trailer: [{ Source: 'TEXT', Text: 'T', Width: 1 }, { Source: 'COUNT', Width: 3, Pad: 'Left', PadChar: '0' }, { Source: 'TOTAL', Decimals: 0, Width: 8, Pad: 'Left' }]
    } }, bad);
  const f = files.buildFile({ format: fmt, month: '2026-07', payDate: '2026-08-03', created, rows });
  assert.equal(f.fileName, 'SAL202607.txt');
  assert.equal(f.content, 'H000E7703082026\nDALI HASS0008700.00\nDBEN OKAF0001500.50\nT002   10201\n');
});

test('delimited: a tab, or a value with the delimiter in it quoted', () => {
  const fmt = files.cleanFormat({ Name: 'CSV', Type: 'Delimited', Delimiter: ',', Records: { Employee: [{ Source: 'TEXT', Text: 'Okafor, Ben' }, { Source: 'NET', Decimals: 0 }] } }, bad);
  assert.equal(files.buildFile({ format: fmt, month: '2026-07', payDate: '2026-08-03', created, rows: rows.slice(1) }).content, '"Okafor, Ben",1501\r\n');
  const tab = files.cleanFormat({ Name: 'TSV', Delimiter: 'TAB', Records: { Employee: [{ Source: 'EMP_NO' }, { Source: 'IBAN' }] } }, bad);
  assert.equal(files.buildFile({ format: tab, month: '2026-07', payDate: '2026-08-03', created, rows: rows.slice(0, 1) }).content, 'EMP-0001\tAE070331234567890123456\r\n');
});

test('a format is checked: a name, the employee record, known values in the right record, widths when fixed', () => {
  assert.throws(() => files.cleanFormat({ Records: { Employee: [{ Source: 'NET' }] } }, bad), /Name the format/);
  assert.throws(() => files.cleanFormat({ Name: 'X', Records: {} }, bad), /employee record needs at least one field/);
  assert.throws(() => files.cleanFormat({ Name: 'X', Records: { Employee: [{ Source: 'SALARY' }] } }, bad), /Employee record, field 1: choose what it holds/);
  assert.throws(() => files.cleanFormat({ Name: 'X', Records: { Employee: [{ Source: 'NET' }], Trailer: [{ Source: 'IBAN' }] } }, bad), /Trailer record, field 1: employee values go in the employee record/);
  assert.throws(() => files.cleanFormat({ Name: 'X', Type: 'Fixed', Records: { Employee: [{ Source: 'NET' }] } }, bad), /needs its width/);
  assert.throws(() => files.cleanFormat({ Name: 'X', Records: { Employee: [{ Source: 'PAY_DATE', Format: 'dd-MM-YYYY' }] } }, bad), /date pattern uses yyyy/);
  assert.throws(() => files.cleanFormat({ Name: 'X', Delimiter: ';;', Records: { Employee: [{ Source: 'NET' }] } }, bad), /delimiter is one character/);
});

test('an employee\'s values from the payslip: the variable part is the inputs and arrears, never above the net', () => {
  const slip = { EmployeeNo: 'E1', EmployeeName: 'A', Net: 1000, UnpaidDays: 2, Lines: [
    { Kind: 'Earning', Source: 'Fixed', Amount: 900 }, { Kind: 'Earning', Source: 'Input', Amount: 300 }, { Kind: 'Earning', Source: 'Arrears', Amount: 50 }, { Kind: 'Deduction', Source: 'Leave', Amount: 250 }] };
  const v = files.employeeValues(slip, { IBAN: 'AE1', WpsPersonID: 'W1', BankRoutingCode: 'R1', BankName: 'B' }, 31);
  assert.deepEqual([v.NET, v.VARIABLE, v.FIXED, v.UNPAID_DAYS, v.WPS_ID, v.ROUTING], [1000, 350, 650, 2, 'W1', 'R1']);
  assert.equal(files.employeeValues(Object.assign({}, slip, { Net: 200 }), {}, 31).VARIABLE, 200);
  assert.equal(files.employeeValues(Object.assign({}, slip, { Net: -50 }), {}, 31).NET, 0);
});
