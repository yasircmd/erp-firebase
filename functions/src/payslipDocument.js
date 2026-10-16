// The payslip as a document: one layout for the Payroll screen's print and
// the Employee Portal's view and PDF (owner, 2026-10-10: "keep the same
// format as the Payroll module; any future update should change both").
// Change the payslip here, and both follow.
//
// Built from payrollPost.payslipsOf's data. Dates and months stay
// yyyy-mm-dd / yyyy-mm: the ERP shell's DATE FORMAT block shows them as
// dd/mm/yyyy and Sep-2026, and the portal formats the same text.
'use strict';

const esc = v => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', '\'': '&#39;' })[c]);
const money = n => (Math.round((Number(n) || 0) * 100) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const STATUS = { Draft: 'Draft', PendingApproval: 'Pending approval', Approved: 'Approved, waiting to post', Posted: 'Posted' };

// Black on white, one payslip a page when printed; scoped to .payslip-doc.
const PAYSLIP_CSS = [
  '.payslip-doc { color: #000; background: #fff; font-size: 11px; font-family: Arial, Helvetica, sans-serif; page-break-after: always; }',
  '.payslip-doc:last-child { page-break-after: auto; }',
  '.payslip-doc h1 { font-size: 16px; font-weight: bold; margin: 0; }',
  '.payslip-doc h2 { font-size: 13px; font-weight: bold; margin: 6px 0 0; }',
  '.payslip-doc table { border-collapse: collapse; width: 100%; margin-top: 6px; }',
  '.payslip-doc th, .payslip-doc td { border: 1px solid #333; padding: 3px 6px; text-align: left; vertical-align: top; }',
  '.payslip-doc td.r, .payslip-doc th.r { text-align: right; white-space: nowrap; }',
  '.payslip-doc thead { background: #eee; -webkit-print-color-adjust: exact; print-color-adjust: exact; }'
].join('\n');

// p: { company: { Name, Address }, month, monthEnd, status }; s: one slip.
function payslipHtml(p, s) {
  const rows = kind => (s.Lines || []).filter(l => l.Kind === kind).map(l => '<tr><td>' + esc(l.Name) + '</td><td>' + esc(l.Text) + '</td><td class="r">' + money(l.Amount) + '</td></tr>').join('') || '<tr><td colspan="3">—</td></tr>';
  const info = (k, v) => '<tr><th>' + k + '</th><td>' + esc(v) + '</td></tr>';
  const ytd = s.YTD || { Earnings: 0, Deductions: 0, Net: 0 };
  return '<div class="payslip-doc"><h1>' + esc(p.company.Name) + '</h1>' + (p.company.Address ? '<div>' + esc(p.company.Address) + '</div>' : '') +
    '<h2>Payslip — ' + esc(p.month) + (p.status && p.status !== 'Posted' ? ' (' + esc(STATUS[p.status] || p.status) + ', not final)' : '') + '</h2>' +
    '<table><tbody>' + info('Employee', s.EmployeeNo + ' · ' + s.EmployeeName) + info('Designation', s.Designation) + info('Cost center', (s.CostCenterName || '') + (s.CostSplitText ? ' (split: ' + s.CostSplitText + ')' : '')) + info('Joined', s.JoinDate) +
    info('Bank', [s.BankName, s.IBAN].filter(Boolean).join(' · ')) + '</tbody></table>' +
    '<table><thead><tr><th>Earnings</th><th>How</th><th class="r">Amount</th></tr></thead><tbody>' + rows('Earning') + '<tr><th colspan="2">Total earnings</th><th class="r">' + money(s.Earnings) + '</th></tr></tbody></table>' +
    '<table><thead><tr><th>Deductions</th><th>How</th><th class="r">Amount</th></tr></thead><tbody>' + rows('Deduction') + '<tr><th colspan="2">Total deductions</th><th class="r">' + money(s.Deductions) + '</th></tr></tbody></table>' +
    '<table><tbody><tr><th>Net pay</th><th class="r">' + money(Math.max(0, s.Net)) + '</th></tr>' + (s.Net < 0 ? '<tr><td>Shortfall recovered next month</td><td class="r">' + money(-s.Net) + '</td></tr>' : '') + '</tbody></table>' +
    '<table><thead><tr><th>Year to date</th><th class="r">Earnings</th><th class="r">Deductions</th><th class="r">Net</th></tr></thead><tbody><tr><td>' + esc(String(p.month).slice(0, 4)) + '</td><td class="r">' + money(ytd.Earnings) +
    '</td><td class="r">' + money(ytd.Deductions) + '</td><td class="r">' + money(ytd.Net) + '</td></tr></tbody></table>' +
    ((s.Loans || []).length ? '<table><thead><tr><th>Loan balance after this month</th><th class="r">Amount</th></tr></thead><tbody>' + s.Loans.map(l => '<tr><td>' + esc(l.TypeName + ' ' + l.LoanNumber) + '</td><td class="r">' + money(l.Balance) + '</td></tr>').join('') + '</tbody></table>' : '') +
    ((s.Leave || []).length ? '<table><thead><tr><th>Leave balance at ' + esc(p.monthEnd) + '</th><th class="r">Days</th></tr></thead><tbody>' + s.Leave.map(l => '<tr><td>' + esc(l.Name) + '</td><td class="r">' + esc(l.Balance) + '</td></tr>').join('') + '</tbody></table>' : '') +
    '</div>';
}

module.exports = { payslipHtml, PAYSLIP_CSS };
