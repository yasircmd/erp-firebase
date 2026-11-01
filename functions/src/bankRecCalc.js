// Bank reconciliation, the pure parts (docs/modules/RECONCILIATION.md,
// Q367-Q368). New development, hand-written; no Firebase here.
//
// Signs: an amount is positive for money in. A GL line on the bank account
// is in when it is a debit; a statement line is in when it is a credit (the
// bank's own view). So a GL line and a statement line match when their
// signed amounts are equal.
'use strict';

const round2 = n => Math.round((Number(n) || 0) * 100) / 100;
const DAY = 86400000;
const days = (a, b) => Math.round(Math.abs(Date.parse(a + 'T00:00:00Z') - Date.parse(b + 'T00:00:00Z')) / DAY);

// A GL line's signed amount on the bank account: its own currency where the account has one.
function glAmount(line, fc) {
  const dr = fc ? Number(line.FcDebit) || 0 : Number(line.Debit) || 0;
  const cr = fc ? Number(line.FcCredit) || 0 : Number(line.Credit) || 0;
  return round2(dr - cr);
}
const stAmount = s => round2((Number(s.Credit) || 0) - (Number(s.Debit) || 0));

// Pasted statement rows (tab separated, from Excel): date, description,
// reference, withdrawal (debit), deposit (credit). A header row, blank rows
// and rows with no amount are skipped; dates as yyyy-mm-dd, dd/mm/yyyy or
// dd-mm-yyyy; amounts may carry thousands separators. A row with one signed
// amount column (negative = withdrawal) is also read.
function parseDate(v) {
  const s = String(v || '').trim();
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
  if (m) return m[1] + '-' + m[2].padStart(2, '0') + '-' + m[3].padStart(2, '0');
  m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(s);
  if (m) return m[3] + '-' + m[2].padStart(2, '0') + '-' + m[1].padStart(2, '0');
  return '';
}
const num = v => { const s = String(v == null ? '' : v).replace(/[,\s]/g, '').replace(/^\((.*)\)$/, '-$1'); return s === '' ? null : (Number.isFinite(Number(s)) ? Number(s) : NaN); };
function parseStatement(text) {
  const rows = [], bad = [];
  String(text || '').split(/\r?\n/).forEach((raw, i) => {
    if (!raw.trim()) return;
    const c = raw.split('\t').map(x => x.trim());
    const date = parseDate(c[0]);
    if (!date) { if (i > 0 || !/date/i.test(c[0])) bad.push(i + 1); return; }
    let debit = 0, credit = 0;
    if (c.length >= 5) {
      const d = num(c[3]), k = num(c[4]);
      if (Number.isNaN(d) || Number.isNaN(k)) { bad.push(i + 1); return; }
      debit = Math.abs(d || 0); credit = Math.abs(k || 0);
    } else if (c.length === 4) {
      const a = num(c[3]);
      if (a === null || Number.isNaN(a)) { bad.push(i + 1); return; }
      if (a < 0) debit = -a; else credit = a;
    } else { bad.push(i + 1); return; }
    if (!debit && !credit) { bad.push(i + 1); return; }
    rows.push({ Date: date, Description: String(c[1] || '').slice(0, 300), Reference: String(c[2] || '').slice(0, 120), Debit: round2(debit), Credit: round2(credit) });
  });
  return { rows, bad };
}

// Suggested pairs (Q368): one GL line to one statement line, the same signed
// amount, dates within `window` days. Best first: the GL line's reference,
// document number or cheque number found in the statement's text, then the
// closer date. Each line is used once.
function suggest(glLines, stLines, window) {
  const w = window == null ? 7 : window;
  const words = s => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const cand = [];
  stLines.forEach(s => {
    const amt = stAmount(s), text = ' ' + words(s.Description + ' ' + s.Reference) + ' ';
    glLines.forEach(g => {
      if (Math.abs(g.Amount - amt) > 0.005) return;
      const d = days(g.Date, s.Date);
      if (d > w) return;
      const refs = [g.Reference, g.Number, g.Cheque].map(words).filter(r => r.length >= 3);
      const hit = refs.some(r => text.includes(' ' + r + ' ') || text.replace(/ /g, '').includes(r.replace(/ /g, '')));
      cand.push({ gl: g.Key, st: s.LineID, score: (hit ? 0 : 100) + d });
    });
  });
  cand.sort((a, b) => a.score - b.score);
  const usedG = new Set(), usedS = new Set(), out = [];
  cand.forEach(c => {
    if (usedG.has(c.gl) || usedS.has(c.st)) return;
    usedG.add(c.gl); usedS.add(c.st);
    out.push({ GL: [c.gl], ST: [c.st], ByReference: c.score < 100 });
  });
  return out;
}

// A match is sound when its GL lines and statement lines total the same
// (or, GL lines alone, net to nothing: an entry and its reversal).
function checkMatch(match, glByKey, stById) {
  const g = (match.GL || []).map(k => glByKey[k]), s = (match.ST || []).map(id => stById[id]);
  if (g.some(x => !x)) return 'a GL line is not one of this account\'s, or is matched already';
  if (s.some(x => !x)) return 'a statement line is not on this statement';
  if (!g.length) return 'a match needs at least one GL line';
  const gt = round2(g.reduce((t, x) => t + x.Amount, 0)), st = round2(s.reduce((t, x) => t + stAmount(x), 0));
  if (Math.abs(gt - st) > 0.005) return 'its GL lines (' + gt.toFixed(2) + ') and statement lines (' + st.toFixed(2) + ') differ';
  return '';
}

// The report: the GL balance at the month's end, less what has not yet
// cleared the bank, against the statement's closing balance.
function report(glLines, clearedKeys, closing, monthEnd) {
  const upTo = glLines.filter(g => g.Date <= monthEnd);
  const balance = round2(upTo.reduce((t, g) => t + g.Amount, 0));
  const open = upTo.filter(g => !clearedKeys.has(g.Key));
  const payments = round2(-open.filter(g => g.Amount < 0).reduce((t, g) => t + g.Amount, 0));
  const deposits = round2(open.filter(g => g.Amount > 0).reduce((t, g) => t + g.Amount, 0));
  const perBank = round2(balance + payments - deposits);
  const stated = closing === null || closing === undefined || closing === '' ? null : round2(closing);
  return { GLBalance: balance, PaymentsNotPresented: payments, DepositsNotCredited: deposits, PerBank: perBank,
    StatementClosing: stated, Difference: stated === null ? null : round2(stated - perBank), Uncleared: open.map(g => g.Key) };
}

module.exports = { round2, glAmount, stAmount, parseDate, parseStatement, suggest, checkMatch, report, days };
