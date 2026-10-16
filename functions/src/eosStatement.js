// The end-of-service statement: a final settlement printed for the employee
// (owner, 2026-10-16; docs/modules/EOS_STATEMENT.md, decisions 179-184).
// One layout for the Final Settlements screen's print and the Employee
// Portal's view and download, as the payslip (payslipDocument.js). Change
// the statement here, and both follow.
//
// The UAE standard layout (179), English only (181), sent outside: it prints
// without the ERP title bar (180). A settlement not yet posted prints marked
// DRAFT (182). The net in words is in the system currency: the one marked
// Default in Currency Configuration (184).
//
// Dates stay yyyy-mm-dd: the ERP shell's DATE FORMAT block shows them as
// dd/mm/yyyy, and the portal formats the same text.
'use strict';
const { HttpsError } = require('firebase-functions/v2/https');
const { onCallWithMessages } = require('./callable');
const { rtdb, firestore } = require('./firebaseAdmin');
const { requireUser, moduleHasCapability } = require('./auth');
const { userCanAccessCompany } = require('./glWriting');
const { loadSetup } = require('./hrSetup');

const onCallOptions = { region: 'us-central1' };
const esc = v => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', '\'': '&#39;' })[c]);
const round2 = n => Math.round((Number(n) || 0) * 100) / 100;
const money = n => round2(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const trim = n => String(round2(n)).replace(/\.0+$/, '');
const trim3 = n => String(Math.round((Number(n) || 0) * 1000) / 1000);

// ---------- the amount in words ----------

const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
const SCALES = ['', ' Thousand', ' Million', ' Billion'];
function underThousand(n) {
  const h = Math.floor(n / 100), r = n % 100;
  const rest = r < 20 ? ONES[r] : TENS[Math.floor(r / 10)] + (r % 10 ? '-' + ONES[r % 10] : '');
  return [h ? ONES[h] + ' Hundred' : '', rest].filter(Boolean).join(' ');
}
function integerWords(n) {
  if (!n) return 'Zero';
  const parts = [];
  for (let i = 0; n > 0; i++, n = Math.floor(n / 1000)) {
    const chunk = n % 1000;
    if (chunk) parts.unshift(underThousand(chunk) + SCALES[i]);
  }
  return parts.join(' ');
}
// "AED Twelve Thousand Three Hundred Forty-Five and 50/100 only": the
// currency's code (the system currency), the whole units in words, the
// hundredths as a fraction, as on a cheque.
function amountInWords(amount, currencyCode) {
  const cents = Math.round(Math.abs(Number(amount) || 0) * 100);
  const whole = Math.floor(cents / 100), frac = cents % 100;
  return (currencyCode ? currencyCode + ' ' : '') + integerWords(whole) + (frac ? ' and ' + String(frac).padStart(2, '0') + '/100' : '') + ' only';
}

// Service from the joining date to the last working day, both counted:
// whole years, months and days, as on a UAE statement.
function serviceLength(from, to) {
  if (!from || !to || to < from) return { years: 0, months: 0, days: 0 };
  const day = 86400000, ms = v => Date.parse(v + 'T00:00:00Z');
  const [y1, m1, d1] = from.split('-').map(Number);
  // n months on from the joining date (the 31st on to a shorter month's last day).
  const monthsOn = n => { const last = new Date(Date.UTC(y1, m1 - 1 + n + 1, 0)).getUTCDate(); return Date.UTC(y1, m1 - 1 + n, Math.min(d1, last)); };
  const end = ms(to) + day; // the day after the last working day
  const e = new Date(end);
  let months = (e.getUTCFullYear() - y1) * 12 + e.getUTCMonth() - (m1 - 1);
  while (months > 0 && monthsOn(months) > end) months--;
  return { years: Math.floor(months / 12), months: months % 12, days: Math.round((end - monthsOn(months)) / day) };
}
const serviceText = x => [[x.years, 'year'], [x.months, 'month'], [x.days, 'day']].filter(p => p[0]).map(p => p[0] + ' ' + p[1] + (p[0] === 1 ? '' : 's')).join(', ') || '0 days';

// ---------- the data ----------

async function systemCurrency() {
  const data = (await rtdb.ref('currencies').get()).val() || {};
  const id = Object.keys(data).find(k => data[k].IsDefault && data[k].Status === 'Active');
  return id ? { Code: data[id].Code || '', Name: data[id].Name || '' } : { Code: '', Name: '' };
}
// The employee's identity documents on file (Employee Documents): the
// active Passport and Emirates ID numbers (a renewed one is Superseded).
async function identityOf(employeeId) {
  const docs = (await firestore.collection('employeeDocuments').where('EmployeeID', '==', employeeId).get()).docs.map(d => d.data())
    .filter(d => d.Status === 'Active' && d.DocNumber);
  const latest = name => (docs.filter(d => d.DocTypeName === name).sort((a, b) => String(b.IssueDate || '').localeCompare(String(a.IssueDate || '')))[0] || {}).DocNumber || '';
  return { Passport: latest('Passport'), EmiratesID: latest('Emirates ID') };
}
const lastBy = (s, re) => ((s.History || []).filter(h => re.test(h.Event)).pop() || {}).By || '';

// The statement's facts from a saved settlement.
async function statementData(s) {
  const [empSnap, coSnap, unitsSnap, hr, currency, ids] = await Promise.all([firestore.collection('employees').doc(s.EmployeeID).get(), rtdb.ref('companies/' + s.CompanyID).get(),
    rtdb.ref('orgUnits').get(), loadSetup(), systemCurrency(), identityOf(s.EmployeeID)]);
  const emp = empSnap.data() || {}, co = coSnap.val() || {}, units = unitsSnap.val() || {};
  const des = hr.designations.find(x => x.DesignationID === emp.DesignationID);
  const lines = s.Lines || [];
  const gratuity = lines.find(l => l.Key === 'Gratuity') || null;
  // The salary lines, one entitlement (and one deduction) a month.
  const salary = [], other = [], deductions = [];
  (s.Salary || []).filter(m => m.Pay).forEach(m => {
    const mine = lines.filter(l => l.Salary && l.Month === m.Month);
    const sum = kind => round2(mine.filter(l => l.Kind === kind).reduce((t, l) => t + l.Amount, 0));
    if (sum('Earning')) salary.push({ Name: 'Salary for ' + m.Month + (m.Month === String(s.LeavingDate).slice(0, 7) ? ' (to the last working day)' : ''), Text: mine.filter(l => l.Kind === 'Earning').map(l => l.Name).join(', '), Amount: sum('Earning') });
    if (sum('Deduction')) deductions.push({ Name: 'Salary deductions for ' + m.Month, Text: mine.filter(l => l.Kind === 'Deduction').map(l => l.Name).join(', '), Amount: sum('Deduction') });
  });
  lines.filter(l => !l.Salary && l.Key !== 'Gratuity' && l.Amount).forEach(l => {
    const row = { Name: l.Name, Text: l.Text || '', Amount: l.Amount, Reason: l.Reason || '' };
    if (l.Kind === 'Earning') other.push(row); else if (l.Kind === 'Deduction') deductions.push(row);
  });
  return {
    Company: { Name: co.LegalName || s.CompanyID, Address: co.Address || co.RegisteredAddress || '' },
    Number: s.Number || '', Status: s.Status, Draft: s.Status !== 'Posted', PaidAt: s.PaidAt || '', PaymentDate: s.PaymentDate || '',
    Employee: { No: s.EmployeeNo || emp.EmployeeNo || '', Name: s.EmployeeName || emp.FullName || '', PassportName: emp.PassportName || '', Nationality: emp.Nationality || '',
      Passport: ids.Passport, EmiratesID: ids.EmiratesID, Designation: des ? des.Title : '', Department: (units[s.CostCenterID || emp.CostCenterID] || {}).Name || '',
      JoinDate: s.JoinDate || emp.JoinDate || '', LeavingDate: s.LeavingDate || '', LeavingReason: s.LeavingReason || emp.LeavingReason || '' },
    Service: serviceLength(s.JoinDate || emp.JoinDate, s.LeavingDate), UnpaidDays: round2(s.UnpaidDays || 0),
    Basic: round2(s.Basic), Gross: round2(s.Gross), Gratuity: gratuity, Salary: salary, Other: other, Deductions: deductions,
    Earnings: round2(s.Earnings), DeductionsTotal: round2(s.Deductions), Net: round2(s.Net),
    Currency: currency, Words: amountInWords(s.Net, currency.Code),
    PreparedBy: s.SubmittedByName || '', ApprovedBy: s.Status === 'Posted' ? lastBy(s, /^Approved/) || s.PostedByName || '' : ''
  };
}

// ---------- the layout ----------

// Black on white, one A4 page as far as it goes; scoped to .eos-doc.
const EOS_CSS = [
  '.eos-doc { color: #000; background: #fff; font-size: 11px; font-family: Arial, Helvetica, sans-serif; position: relative; }',
  '.eos-doc h1 { font-size: 16px; font-weight: bold; margin: 0; }',
  '.eos-doc h2 { font-size: 14px; font-weight: bold; margin: 10px 0 2px; text-align: center; text-transform: uppercase; letter-spacing: 1px; }',
  '.eos-doc h3 { font-size: 12px; font-weight: bold; margin: 10px 0 0; }',
  '.eos-doc .eos-head { display: flex; align-items: center; gap: 12px; border-bottom: 2px solid #000; padding-bottom: 6px; }',
  '.eos-doc table { border-collapse: collapse; width: 100%; margin-top: 4px; }',
  '.eos-doc th, .eos-doc td { border: 1px solid #333; padding: 3px 6px; text-align: left; vertical-align: top; }',
  '.eos-doc td.r, .eos-doc th.r { text-align: right; white-space: nowrap; }',
  '.eos-doc thead, .eos-doc .eos-total { background: #eee; -webkit-print-color-adjust: exact; print-color-adjust: exact; }',
  '.eos-doc .eos-words { margin-top: 4px; font-style: italic; }',
  '.eos-doc .eos-sign { display: flex; gap: 24px; margin-top: 36px; }',
  '.eos-doc .eos-sign div { flex: 1; border-top: 1px solid #000; padding-top: 4px; }',
  '.eos-doc .eos-ack { margin-top: 24px; border: 1px solid #333; padding: 8px; }',
  '.eos-doc .eos-draft { position: absolute; top: 40%; left: 0; right: 0; text-align: center; font-size: 90px; font-weight: bold; color: rgba(200, 0, 0, 0.15); transform: rotate(-30deg); pointer-events: none; }',
  '.eos-doc .eos-draft-note { color: #b00; font-weight: bold; text-align: center; }'
].join('\n');

function statementHtml(x) {
  const info = (k, v) => '<th>' + k + '</th><td>' + esc(v || '—') + '</td>';
  const rows = list => list.map(l => '<tr><td>' + esc(l.Name) + (l.Reason ? '<br><i>Changed by HR: ' + esc(l.Reason) + '</i>' : '') + '</td><td>' + esc(l.Text) + '</td><td class="r">' + money(l.Amount) + '</td></tr>').join('') || '<tr><td colspan="3">—</td></tr>';
  const e = x.Employee, g = x.Gratuity, w = (g && g.Working) || {};
  const slabs = (w.Slabs || []).map(sl => '<tr><td>' + esc(sl.ToYear == null ? 'Over ' + trim(sl.FromYear) + ' years' : 'Year ' + trim(sl.FromYear) + ' to ' + trim(sl.ToYear)) + '</td><td class="r">' + trim3(sl.Years) +
    '</td><td class="r">' + trim(sl.DaysPerYear) + '</td><td class="r">' + trim3(sl.Days) + '</td><td class="r">' + money(sl.Amount != null ? sl.Amount : sl.Days * (w.Daily || 0)) + '</td></tr>').join('');
  const gratuityTable = !g ? '' : '<h3>End-of-service gratuity</h3>' + (slabs
    ? '<table><tbody><tr>' + info('Basic salary (a month)', money(w.Base)) + info('A day\'s pay', money(w.Daily)) + '</tr><tr>' + info('Service counted', trim(w.Years) + ' years (' + w.ServiceDays + ' days)') +
      info('Unpaid leave left out', trim(x.UnpaidDays) + ' days') + '</tr></tbody></table>' +
      '<table><thead><tr><th>Slab</th><th class="r">Years</th><th class="r">Days a year</th><th class="r">Days</th><th class="r">Amount</th></tr></thead><tbody>' + slabs +
      (w.Capped ? '<tr><td colspan="4">Capped at ' + esc(w.CapYears) + ' years\' pay</td><td class="r">' + money(w.Cap) + '</td></tr>' : '') +
      '<tr class="eos-total"><th colspan="4">Gratuity worked out</th><th class="r">' + money(g.Worked) + '</th></tr>' +
      (g.Reason ? '<tr><td colspan="4">Changed by HR: ' + esc(g.Reason) + '</td><td class="r">' + money(g.Signed) + '</td></tr>' : '') + '</tbody></table>'
    : '<table><tbody><tr><td>' + esc(g.Text) + (g.Reason ? '<br><i>Changed by HR: ' + esc(g.Reason) + '</i>' : '') + '</td><td class="r">' + money(g.Signed) + '</td></tr></tbody></table>');
  const entitlements = (g ? [{ Name: 'End-of-service gratuity', Text: g.Reason ? 'as changed by HR' : 'as worked out above', Amount: g.Amount }] : []).concat(x.Salary, x.Other);
  const owes = x.Net < 0;
  return '<div class="eos-doc">' + (x.Draft ? '<div class="eos-draft">DRAFT</div>' : '') +
    '<div class="eos-head"><div><h1>' + esc(x.Company.Name) + '</h1>' + (x.Company.Address ? '<div>' + esc(x.Company.Address) + '</div>' : '') + '</div></div>' +
    '<h2>End-of-Service Settlement Statement</h2>' +
    (x.Draft ? '<div class="eos-draft-note">DRAFT: not final, for checking only</div>' : '') +
    '<div style="text-align:center">' + (x.Number ? 'No. ' + esc(x.Number) : '') + '</div>' +
    '<h3>Employee</h3><table><tbody>' +
    '<tr>' + info('Name', e.Name) + info('Employee no.', e.No) + '</tr>' +
    '<tr>' + info('Name as in passport', e.PassportName) + info('Nationality', e.Nationality) + '</tr>' +
    '<tr>' + info('Passport no.', e.Passport) + info('Emirates ID', e.EmiratesID) + '</tr>' +
    '<tr>' + info('Designation', e.Designation) + info('Department', e.Department) + '</tr>' +
    '<tr><th>Date of joining</th><td>' + esc(e.JoinDate) + '</td><th>Last working day</th><td>' + esc(e.LeavingDate) + '</td></tr>' +
    '<tr>' + info('Reason for leaving', e.LeavingReason) + info('Length of service', serviceText(x.Service) + (x.UnpaidDays ? ' (' + trim(x.UnpaidDays) + ' unpaid leave days not counted for gratuity)' : '')) + '</tr>' +
    '<tr><th>Basic salary</th><td>' + money(x.Basic) + '</td><th>Gross salary</th><td>' + money(x.Gross) + '</td></tr>' +
    '</tbody></table>' + gratuityTable +
    '<h3>Entitlements</h3><table><thead><tr><th>Item</th><th>Details</th><th class="r">Amount</th></tr></thead><tbody>' + rows(entitlements) +
    '<tr class="eos-total"><th colspan="2">Total entitlements</th><th class="r">' + money(x.Earnings) + '</th></tr></tbody></table>' +
    '<h3>Deductions</h3><table><thead><tr><th>Item</th><th>Details</th><th class="r">Amount</th></tr></thead><tbody>' + rows(x.Deductions) +
    '<tr class="eos-total"><th colspan="2">Total deductions</th><th class="r">' + money(x.DeductionsTotal) + '</th></tr></tbody></table>' +
    '<table><tbody><tr class="eos-total"><th>' + (owes ? 'Net owed by the employee' : 'Net payable to the employee') + (x.Currency.Code ? ' (' + esc(x.Currency.Code) + ')' : '') + '</th><th class="r">' + money(Math.abs(x.Net)) + '</th></tr></tbody></table>' +
    '<div class="eos-words">Amount in words: ' + esc(x.Words) + '</div>' +
    (x.PaymentDate ? '<div>Paid on ' + esc(x.PaymentDate) + '.</div>' : '') +
    '<div class="eos-sign"><div>Prepared by' + (x.PreparedBy ? ': ' + esc(x.PreparedBy) : '') + '<br>Date:</div><div>Approved by' + (x.ApprovedBy ? ': ' + esc(x.ApprovedBy) : '') + '<br>Date:</div></div>' +
    '<div class="eos-ack"><b>Employee\'s acknowledgement</b><br>I, ' + esc(e.Name) + ', confirm that I have received the amount above in full and final settlement of all my dues and entitlements from ' + esc(x.Company.Name) +
    ', and that I have no further claim against the company.<div class="eos-sign"><div>Employee\'s signature</div><div>Date</div></div></div>' +
    '</div>';
}

async function statementOf(s) {
  const data = await statementData(s);
  return { html: statementHtml(data), css: EOS_CSS, draft: data.Draft, number: data.Number };
}

// The Final Settlements screen's print: a saved settlement, any status.
exports.getSettlementStatement = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  if (!(await moduleHasCapability('PAYROLLFS', 'access', user.profile.role))) throw new HttpsError('permission-denied', 'You do not have access to Final Settlements.');
  const id = String((request.data || {}).settlementId || '').trim().slice(0, 120);
  const snap = await firestore.collection('payrollSettlements').doc(id || '-').get();
  if (!snap.exists) throw new HttpsError('not-found', 'Final settlement not found: save it first.');
  let s = Object.assign({ SettlementID: snap.id }, snap.data());
  if (!userCanAccessCompany(user.profile, s.CompanyID)) throw new HttpsError('permission-denied', 'You do not have access to that company.');
  if (s.Status === 'Draft') {
    // A draft follows the employee record and the balances, as on the screen (getSettlement).
    const emp = await firestore.collection('employees').doc(s.EmployeeID).get();
    try { s = Object.assign({}, s, await require('./payrollSettlement').draftFields(Object.assign({ EmployeeID: emp.id }, emp.data()), s)); } catch (e) { /* the saved figures */ }
  }
  return statementOf(s);
});

// The Employee Portal's: the employee's own, once paid (decision 183).
async function paidSettlementOf(employeeId) {
  const snap = await firestore.collection('payrollSettlements').where('EmployeeID', '==', employeeId).get();
  return snap.docs.map(d => Object.assign({ SettlementID: d.id }, d.data())).find(x => x.Status === 'Posted' && x.PaidAt) || null;
}
async function portalStatement(employeeId) {
  const s = await paidSettlementOf(employeeId);
  if (!s) throw new HttpsError('not-found', 'Your end-of-service statement is shown here once your final settlement is paid.');
  return Object.assign(await statementOf(s), { paymentDate: s.PaymentDate || '', employeeNo: s.EmployeeNo || '' });
}

module.exports = Object.assign(module.exports, { amountInWords, serviceLength, statementData, statementHtml, statementOf, paidSettlementOf, portalStatement, EOS_CSS });
