// Exchange rates from a Google Sheet (owner, 2026-10-26/30; docs/modules/
// FX_SHEET.md, Q281, Q329-Q331). New development, hand-written.
//
// One sheet of the firm's serves every corporate (Q330): published to the
// web as CSV, its columns Currency, Base, Rate (1 Currency = Rate Base,
// e.g. =GOOGLEFINANCE("CURRENCY:USDAED")). Its link is the firm's
// (firebaseAdmin.firm, firmSettings/fxSheet), set in the Developer screen.
// A corporate reads it when someone clicks (Q329), takes the rows of its
// own base currency, and applies only what a user with Currency
// Configuration's "rates" right confirms (Q281); a rate more than 5% from
// the last one is marked and left unticked (Q331). An applied rate is an
// ordinary exchangeRates entry (exchangeRates.js), its Note "From the
// sheet".
'use strict';
const { HttpsError } = require('firebase-functions/v2/https');
const { onCallWithMessages } = require('./callable');
const { rtdb, firm } = require('./firebaseAdmin');
const { requireUser, moduleHasCapability } = require('./auth');
const { baseCurrency, sorted } = require('./exchangeRates');

const onCallOptions = { region: 'us-central1' };
const SETTINGS_DOC = 'firmSettings/fxSheet';
const BIG_MOVE = 5; // % (Q331)
const NOTE = 'From the sheet';
const text = (v, max) => String(v == null ? '' : v).trim().slice(0, max || 300);
const isDate = v => /^\d{4}-\d{2}-\d{2}$/.test(v) && new Date(v + 'T00:00:00Z').toISOString().slice(0, 10) === v;
const round6 = n => Math.round(n * 1e6) / 1e6;
const onEmulator = () => process.env.FUNCTIONS_EMULATOR === 'true' || Boolean(process.env.FIRESTORE_EMULATOR_HOST);

// Only a sheet published to the web as CSV is ever fetched (no other
// address); on the emulator, the suites' own local server too.
const PUBLISHED = /^https:\/\/docs\.google\.com\/spreadsheets\/d\/e\/[A-Za-z0-9_-]+\/pub\?([A-Za-z0-9_=&.-]*&)?output=csv(&[A-Za-z0-9_=&.-]*)?$/;
const LOCAL = /^http:\/\/127\.0\.0\.1:\d{2,5}\/[A-Za-z0-9_./-]*$/;
function urlProblem(url) {
  if (!url) return '';
  if (PUBLISHED.test(url) || (onEmulator() && LOCAL.test(url))) return '';
  return 'Give the sheet\'s published CSV link: in Google Sheets, File → Share → Publish to web, the sheet, Comma-separated values (.csv); it starts https://docs.google.com/spreadsheets/d/e/ and ends output=csv.';
}

// The CSV's rows: Currency, Base, Rate (a heading row names them, in any
// order; without one, that order). Quoted fields and thousands commas are
// read; anything else is said, never guessed.
function parse(csv) {
  const lines = String(csv || '').replace(/^﻿/, '').split(/\r?\n/).filter(l => l.trim());
  const cells = l => {
    const out = []; let cur = '', q = false;
    for (let i = 0; i < l.length; i++) {
      const ch = l[i];
      if (q) { if (ch === '"' && l[i + 1] === '"') { cur += '"'; i++; } else if (ch === '"') q = false; else cur += ch; }
      else if (ch === '"') q = true; else if (ch === ',') { out.push(cur); cur = ''; } else cur += ch;
    }
    out.push(cur);
    return out.map(c => c.trim());
  };
  const rows = lines.map(cells);
  let col = { Currency: 0, Base: 1, Rate: 2 };
  // A first row with no number in it is the heading row.
  if (rows.length && !rows[0].some(c => c !== '' && isFinite(Number(c.replace(/,/g, ''))))) {
    const head = rows.shift().map(c => c.toLowerCase());
    col = { Currency: head.indexOf('currency'), Base: head.indexOf('base'), Rate: head.indexOf('rate') };
    if (Object.values(col).some(i => i < 0)) return { rates: [], problems: ['The sheet\'s heading row needs the columns Currency, Base and Rate.'] };
  }
  const rates = [], problems = [];
  rows.forEach((r, i) => {
    const code = String(r[col.Currency] || '').toUpperCase(), base = String(r[col.Base] || '').toUpperCase();
    // Commas only as thousands separators (1,234.56): "4,8" is a comma decimal, never read as 48.
    const cell = String(r[col.Rate] == null ? '' : r[col.Rate]);
    if (/,/.test(cell) && !/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(cell)) { problems.push(code + ' in ' + base + ': the rate "' + text(cell, 30) + '" has a comma; the sheet must show decimals with a dot (File → Settings → Locale, e.g. United States).'); return; }
    const raw = cell.replace(/,/g, '');
    const rate = Number(raw);
    if (!/^[A-Z]{3}$/.test(code) || !/^[A-Z]{3}$/.test(base)) { problems.push('Row ' + (i + 2) + ': Currency and Base are three-letter codes (e.g. USD, AED).'); return; }
    if (!raw || !(rate > 0) || !isFinite(rate)) { problems.push(code + ' in ' + base + ': the rate "' + text(r[col.Rate], 30) + '" is not a number above 0 (has the sheet finished calculating?).'); return; }
    rates.push({ Code: code, Base: base, Rate: round6(rate) });
  });
  return { rates, problems };
}

async function sheetUrl() {
  const s = await firm.firestore.doc(SETTINGS_DOC).get();
  return s.exists ? text(s.get('Url'), 600) : '';
}
// The sheet's rates for one base currency.
async function readSheet(baseCode) {
  const url = await sheetUrl();
  if (!url) throw new HttpsError('failed-precondition', 'No rates sheet is set up yet: the firm sets its link in the Developer screen.');
  if (urlProblem(url)) throw new HttpsError('failed-precondition', 'The rates sheet\'s link is not a published CSV link: the firm corrects it in the Developer screen.');
  let body;
  try {
    const res = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(15000) });
    if (!res.ok) throw new Error('the sheet answered ' + res.status);
    body = await res.text();
  } catch (e) {
    throw new HttpsError('unavailable', 'The rates sheet could not be read (' + text(e.message, 120) + '): try again in a minute.');
  }
  if (body.length > 200000) throw new HttpsError('failed-precondition', 'The rates sheet is too large: keep only the Currency, Base and Rate columns.');
  const { rates, problems } = parse(body);
  return { rates: rates.filter(r => r.Base === baseCode), problems };
}

async function requireRates(user) {
  if (!(await moduleHasCapability('CURRENCYCONFIG', 'rates', user.profile.role))) throw new HttpsError('permission-denied', 'You do not have permission to enter exchange rates.');
}
// The active foreign currencies and each one's last rate.
async function current(base) {
  const [currencies, all] = await Promise.all([rtdb.ref('currencies').get().then(s => s.val() || {}), rtdb.ref('exchangeRates').get().then(s => s.val() || {})]);
  return Object.values(currencies).filter(c => c.Status === 'Active' && c.Code && c.Code !== base.Code)
    .map(c => ({ Code: c.Code, Name: c.Name || '', last: sorted(all[c.Code])[0] || null }))
    .sort((a, b) => a.Code.localeCompare(b.Code));
}

// getSheetRates() -> each active currency: the sheet's rate beside the last
// one entered, the change, a big move marked; what couldn't be used.
exports.getSheetRates = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  await requireRates(user);
  const base = await baseCurrency();
  if (!base.Code) throw new HttpsError('failed-precondition', 'Set the default (base) currency in Currency Configuration first.');
  const [sheet, list] = await Promise.all([readSheet(base.Code), current(base)]);
  const byCode = new Map(sheet.rates.map(r => [r.Code, r]));
  const problems = sheet.problems.slice();
  const rows = list.map(c => {
    const s = byCode.get(c.Code);
    if (!s) { problems.push(c.Code + ': not in the sheet against ' + base.Code + '.'); return null; }
    const last = c.last ? Number(c.last.Rate) : null;
    const change = last ? Math.round((s.Rate - last) / last * 10000) / 100 : null;
    return { Code: c.Code, Name: c.Name, SheetRate: s.Rate, LastRate: last, LastDate: c.last ? c.last.EffectiveDate : '', ChangePct: change, Big: change !== null && Math.abs(change) > BIG_MOVE };
  }).filter(Boolean);
  const known = new Set(list.map(c => c.Code));
  sheet.rates.filter(r => !known.has(r.Code)).forEach(r => problems.push(r.Code + ': in the sheet, but not an active currency here (Currency Configuration).'));
  return { base: base.Code, rows, problems, bigMove: BIG_MOVE };
});

// applySheetRates({ effectiveDate, rates: [{ code, rate }] }): the sheet is
// read again and each chosen rate applied at the sheet's value, which must
// still be the one shown; all or none.
exports.applySheetRates = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  await requireRates(user);
  const d = request.data || {};
  const date = text(d.effectiveDate, 10);
  if (!isDate(date)) throw new HttpsError('invalid-argument', 'Enter the date the rates take effect.');
  const asked = (Array.isArray(d.rates) ? d.rates : []).slice(0, 100).map(x => ({ code: text(x && x.code, 3).toUpperCase(), rate: Number(x && x.rate) }));
  if (!asked.length) throw new HttpsError('invalid-argument', 'Tick the rates to apply.');
  const base = await baseCurrency();
  if (!base.Code) throw new HttpsError('failed-precondition', 'Set the default (base) currency in Currency Configuration first.');
  const [sheet, list] = await Promise.all([readSheet(base.Code), current(base)]);
  const byCode = new Map(sheet.rates.map(r => [r.Code, r]));
  const active = new Set(list.map(c => c.Code));
  const now = new Date().toISOString();
  const updates = {};
  asked.forEach(a => {
    if (!active.has(a.code)) throw new HttpsError('invalid-argument', a.code + ' is not an active currency here.');
    const s = byCode.get(a.code);
    if (!s) throw new HttpsError('failed-precondition', a.code + ' is no longer in the sheet: get the rates again.');
    if (Math.abs(s.Rate - a.rate) > 1e-9) throw new HttpsError('failed-precondition', 'The sheet\'s ' + a.code + ' rate has changed since (now ' + s.Rate + '): get the rates again.');
    const key = rtdb.ref('exchangeRates/' + a.code).push().key;
    updates['exchangeRates/' + a.code + '/' + key] = { EffectiveDate: date, Rate: s.Rate, Note: NOTE, By: user.profile.username || user.uid, ByName: user.profile.fullName || user.profile.username || user.uid, At: now };
  });
  await rtdb.ref().update(updates);
  return { success: true, applied: Object.keys(updates).length };
});

module.exports = Object.assign(exports, { parse, urlProblem, sheetUrl, SETTINGS_DOC, BIG_MOVE });
