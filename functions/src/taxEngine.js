// Sales tax of any kind: VAT, GST and others (UX round 2, item 32, widened;
// owner, 2026-10-26; docs/modules/TAX_ENGINE.md, decisions Q311-Q322).
// New development, hand-written. Pure: no database, so the documents (later
// parts), the legacy port's patches (items, customers, vendors) and the
// tests call it alike.
//
// A company's tax configuration (taxConfig.js keeps it, taxConfig/{company}):
//   { Regime: 'AE_VAT' | 'IN_GST' | 'OWN', Name, StateCode (the company's
//     emirate or GST state), Rounding: 'document' | 'line',
//     Components: [{ Code, Name, OutputAccountID, InputAccountID }],
//     Codes: [{ Code, Name, Category, RecoverablePercent, Active,
//               Rates: [{ From, Percent, Cess, Parts }] }] }
// A code's rate is the row with the latest From on or before the document's
// date, so a rate change needs only a new row. GST splits the rate by the
// place of supply: within the company's state CGST + SGST (UTGST in a union
// territory without a legislature), half each; another state, an SEZ or
// abroad IGST. An own regime gives each rate row its Parts by component.
'use strict';

const round2 = n => Math.round((Number(n) || 0) * 100) / 100;
const isDate = v => /^\d{4}-\d{2}-\d{2}$/.test(v || '') && new Date(v + 'T00:00:00Z').toISOString().slice(0, 10) === v;

// What a code is; which carry tax; the UAE e-invoice (PINT AE) category.
const CATEGORIES = {
  STANDARD: { label: 'Standard rated', taxed: true, einvoice: 'S' },
  ZERO: { label: 'Zero rated', taxed: false, einvoice: 'Z' },
  EXEMPT: { label: 'Exempt', taxed: false, einvoice: 'E' },
  OUT_OF_SCOPE: { label: 'Out of scope', taxed: false, einvoice: 'O' },
  REVERSE_CHARGE: { label: 'Reverse charge', taxed: true, reverse: true, einvoice: 'AE' },
  NIL: { label: 'Nil rated', taxed: false, einvoice: 'Z' },
  NON_GST: { label: 'Non-GST supply', taxed: false, einvoice: 'O' }
};

// The UAE's emirates (the VAT return's boxes 1a-1g).
const EMIRATES = { AUH: 'Abu Dhabi', DXB: 'Dubai', SHJ: 'Sharjah', AJM: 'Ajman', UAQ: 'Umm Al Quwain', RAK: 'Ras Al Khaimah', FUJ: 'Fujairah' };
// India's GST state codes (the GSTIN's first two digits).
const GST_STATES = {
  '01': 'Jammu and Kashmir', '02': 'Himachal Pradesh', '03': 'Punjab', '04': 'Chandigarh', '05': 'Uttarakhand', '06': 'Haryana', '07': 'Delhi',
  '08': 'Rajasthan', '09': 'Uttar Pradesh', '10': 'Bihar', '11': 'Sikkim', '12': 'Arunachal Pradesh', '13': 'Nagaland', '14': 'Manipur',
  '15': 'Mizoram', '16': 'Tripura', '17': 'Meghalaya', '18': 'Assam', '19': 'West Bengal', '20': 'Jharkhand', '21': 'Odisha', '22': 'Chhattisgarh',
  '23': 'Madhya Pradesh', '24': 'Gujarat', '26': 'Dadra and Nagar Haveli and Daman and Diu', '27': 'Maharashtra', '29': 'Karnataka', '30': 'Goa',
  '31': 'Lakshadweep', '32': 'Kerala', '33': 'Tamil Nadu', '34': 'Puducherry', '35': 'Andaman and Nicobar Islands', '36': 'Telangana',
  '37': 'Andhra Pradesh', '38': 'Ladakh', '97': 'Other Territory'
};
// Union territories without a legislature: UTGST in place of SGST.
const UT_STATES = Object.freeze(['04', '26', '31', '35', '38']);

// A party's tax registration (customers and vendors).
const REGISTRATION_TYPES = ['', 'Registered', 'Unregistered', 'Composition', 'SEZ', 'Overseas', 'Consumer'];

// ---------- the presets (Q311) ----------

const rate = (From, Percent, Cess) => Object.assign({ From, Percent }, Cess ? { Cess } : {});
const code = (Code, Name, Category, rates, extra) => Object.assign({ Code, Name, Category, RecoverablePercent: 100, Active: true, Rates: rates }, extra || {});
const PRESETS = {
  AE_VAT: {
    Name: 'UAE VAT', Rounding: 'document',
    Components: [{ Code: 'VAT', Name: 'VAT' }],
    Codes: [
      code('SR', 'Standard rated 5%', 'STANDARD', [rate('2018-01-01', 5)]),
      code('ZR', 'Zero rated', 'ZERO', [rate('2018-01-01', 0)]),
      code('EX', 'Exempt', 'EXEMPT', [rate('2018-01-01', 0)]),
      code('OS', 'Out of scope', 'OUT_OF_SCOPE', [rate('2018-01-01', 0)]),
      code('RC', 'Reverse charge 5%', 'REVERSE_CHARGE', [rate('2018-01-01', 5)])
    ]
  },
  // The rates as revised from 22/09/2025 (5% and 18%, 40% for the few
  // demerit goods; 0.25% and 3% for stones and gold). 12% and 28% stay for
  // documents dated before, inactive for new items. Each company checks them
  // against its own items and adjusts (Tax Configuration).
  IN_GST: {
    Name: 'India GST', Rounding: 'line',
    Components: [{ Code: 'CGST', Name: 'Central GST' }, { Code: 'SGST', Name: 'State GST' }, { Code: 'UTGST', Name: 'Union Territory GST' },
      { Code: 'IGST', Name: 'Integrated GST' }, { Code: 'CESS', Name: 'Compensation cess' }],
    Codes: [
      code('GST5', 'GST 5%', 'STANDARD', [rate('2017-07-01', 5)]),
      code('GST18', 'GST 18%', 'STANDARD', [rate('2017-07-01', 18)]),
      code('GST40', 'GST 40%', 'STANDARD', [rate('2025-09-22', 40)]),
      code('GST3', 'GST 3% (gold, silver)', 'STANDARD', [rate('2017-07-01', 3)]),
      code('GST0_25', 'GST 0.25% (rough stones)', 'STANDARD', [rate('2017-07-01', 0.25)]),
      code('GST12', 'GST 12% (before 22/09/2025)', 'STANDARD', [rate('2017-07-01', 12)], { Active: false }),
      code('GST28', 'GST 28% (before 22/09/2025)', 'STANDARD', [rate('2017-07-01', 28)], { Active: false }),
      code('ZERO', 'Zero rated (export, SEZ)', 'ZERO', [rate('2017-07-01', 0)]),
      code('NIL', 'Nil rated', 'NIL', [rate('2017-07-01', 0)]),
      code('EXEMPT', 'Exempt', 'EXEMPT', [rate('2017-07-01', 0)]),
      code('NONGST', 'Non-GST supply', 'NON_GST', [rate('2017-07-01', 0)]),
      code('RCM5', 'Reverse charge 5%', 'REVERSE_CHARGE', [rate('2017-07-01', 5)]),
      code('RCM18', 'Reverse charge 18%', 'REVERSE_CHARGE', [rate('2017-07-01', 18)])
    ]
  },
  OWN: { Name: 'Own tax', Rounding: 'document', Components: [{ Code: 'TAX', Name: 'Tax' }], Codes: [] }
};
const preset = regime => {
  const p = PRESETS[regime];
  if (!p) throw new Error('Choose UAE VAT, India GST or an own regime.');
  return JSON.parse(JSON.stringify(Object.assign({ Regime: regime, StateCode: '' }, p)));
};

// ---------- tax numbers, HSN and SAC ----------

const GSTIN_RE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
const B36 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
// The GSTIN's 15th character: a mod-36 check over the first 14.
function gstinCheckChar(first14) {
  let sum = 0;
  for (let i = 0; i < 14; i++) {
    const p = B36.indexOf(first14[i]) * (i % 2 ? 2 : 1);
    sum += Math.floor(p / 36) + (p % 36);
  }
  return B36[(36 - (sum % 36)) % 36];
}
function gstinProblem(gstin) {
  const g = String(gstin || '').toUpperCase();
  if (!GSTIN_RE.test(g)) return 'A GSTIN is 15 characters: the 2-digit state code, the 10-character PAN, then 3 more (e.g. 27ABCDE1234F1Z0).';
  if (!GST_STATES[g.slice(0, 2)]) return 'The GSTIN starts with ' + g.slice(0, 2) + ', which is not a GST state code.';
  if (gstinCheckChar(g.slice(0, 14)) !== g[14]) return 'The GSTIN ' + g + ' fails its check character: check it was typed correctly.';
  return '';
}
const UAE_TRN_RE = /^100\d{12}$/;
// HSN: 4, 6 or 8 digits (goods). SAC: 6 digits starting 99 (services).
function hsnProblem(v) {
  const s = String(v || '').trim();
  if (!s) return '';
  if (/^99\d{4}$/.test(s)) return '';
  if (/^\d{4}$|^\d{6}$|^\d{8}$/.test(s)) return '';
  return 'The HSN code is 4, 6 or 8 digits (goods); a SAC code is 6 digits starting 99 (services).';
}

// A customer's or vendor's tax fields, checked (the legacy port's patches
// tax-party-*). Returns the fields to store; throws a plain message.
function partyTaxFields(data) {
  const d = data || {};
  const type = String(d.TaxRegistrationType || '').trim();
  if (!REGISTRATION_TYPES.includes(type)) throw new Error('Choose the tax registration type.');
  const state = String(d.TaxState || '').trim().toUpperCase();
  if (state && !GST_STATES[state] && !EMIRATES[state]) throw new Error('Choose the state or emirate from the list.');
  let trn = String(d.TaxRegistrationNumber || '').trim().replace(/\s+/g, '').toUpperCase();
  const indian = Boolean(GST_STATES[state]);
  if (indian && ['Registered', 'Composition', 'SEZ'].includes(type)) {
    if (!trn) throw new Error('A registered party in India needs its GSTIN.');
    const why = gstinProblem(trn);
    if (why) throw new Error(why);
    if (trn.slice(0, 2) !== state) throw new Error('The GSTIN ' + trn + ' is of state ' + trn.slice(0, 2) + ' (' + GST_STATES[trn.slice(0, 2)] + '), not the state chosen.');
  } else if (EMIRATES[state] && type === 'Registered') {
    if (!UAE_TRN_RE.test(trn)) throw new Error('A UAE TRN is 15 digits starting 100.');
  } else {
    trn = String(d.TaxRegistrationNumber || '').trim(); // as typed, where there is no rule to check it by
  }
  return { TaxRegistrationNumber: trn, TaxRegistrationType: type, TaxState: state };
}
// An item's tax fields (patch tax-item-*): its default tax code and HSN / SAC.
function itemTaxFields(data) {
  const d = data || {};
  const taxCode = String(d.TaxCode || '').trim().toUpperCase();
  if (taxCode && !/^[A-Z0-9_]{1,12}$/.test(taxCode)) throw new Error('The tax code is up to 12 letters, digits or _ (e.g. SR, GST18).');
  const hsn = String(d.HSNCode || '').trim();
  const why = hsnProblem(hsn);
  if (why) throw new Error(why);
  return { TaxCode: taxCode, HSNCode: hsn };
}

// ---------- a configuration, checked ----------

// coaOk(accountId) -> '' or why the account can't be used (taxConfig.js).
function validateConfig(raw, coaOk) {
  const r = raw || {};
  const regime = String(r.Regime || '').trim();
  if (!PRESETS[regime]) throw new Error('Choose UAE VAT, India GST or an own regime.');
  const name = String(r.Name || '').trim().slice(0, 60) || PRESETS[regime].Name;
  const rounding = r.Rounding === 'line' ? 'line' : 'document';
  const stateCode = String(r.StateCode || '').trim().toUpperCase();
  if (regime === 'IN_GST' && !GST_STATES[stateCode]) throw new Error('Choose the company\'s GST state (the first two digits of its GSTIN).');
  if (regime === 'AE_VAT' && stateCode && !EMIRATES[stateCode]) throw new Error('Choose the company\'s emirate.');

  const comps = (Array.isArray(r.Components) ? r.Components : []).map(c => ({
    Code: String(c.Code || '').trim().toUpperCase(), Name: String(c.Name || '').trim().slice(0, 40),
    OutputAccountID: String(c.OutputAccountID || '').trim(), InputAccountID: String(c.InputAccountID || '').trim()
  }));
  const fixed = PRESETS[regime].Components.map(c => c.Code);
  if (regime !== 'OWN') {
    const got = comps.map(c => c.Code).sort().join(','), want = fixed.slice().sort().join(',');
    if (got !== want) throw new Error(PRESETS[regime].Name + '\'s components are ' + fixed.join(', ') + '.');
  } else {
    if (!comps.length || comps.length > 6) throw new Error('An own regime has 1 to 6 components.');
    comps.forEach(c => { if (!/^[A-Z][A-Z0-9_]{0,9}$/.test(c.Code)) throw new Error('A component code is up to 10 letters, digits or _ (e.g. TAX).'); });
    if (new Set(comps.map(c => c.Code)).size !== comps.length) throw new Error('Each component needs its own code.');
  }
  comps.forEach(c => {
    if (!c.Name) c.Name = c.Code;
    ['OutputAccountID', 'InputAccountID'].forEach(f => {
      if (!c[f]) return; // chosen before a document posts tax on it (later parts)
      const why = coaOk(c[f]);
      if (why) throw new Error(c.Code + ' ' + (f === 'OutputAccountID' ? 'output' : 'input') + ' account: ' + why);
    });
  });

  const seen = new Set();
  const codes = (Array.isArray(r.Codes) ? r.Codes : []).map((c, i) => {
    const codeId = String(c.Code || '').trim().toUpperCase();
    const n = 'Tax code ' + (codeId || i + 1) + ': ';
    if (!/^[A-Z0-9_]{1,12}$/.test(codeId)) throw new Error(n + 'the code is up to 12 letters, digits or _.');
    if (seen.has(codeId)) throw new Error(n + 'appears twice.');
    seen.add(codeId);
    const category = String(c.Category || '').trim();
    const cat = CATEGORIES[category];
    if (!cat) throw new Error(n + 'choose what kind of code it is.');
    if (regime !== 'IN_GST' && ['NIL', 'NON_GST'].includes(category)) throw new Error(n + cat.label + ' is a GST category.');
    const recoverable = c.RecoverablePercent === '' || c.RecoverablePercent == null ? 100 : Number(c.RecoverablePercent);
    if (!(recoverable >= 0 && recoverable <= 100)) throw new Error(n + 'the recoverable input tax is 0 to 100%.');
    const dates = new Set();
    const rates = (Array.isArray(c.Rates) ? c.Rates : []).map(x => {
      const from = String(x.From || '').trim();
      if (!isDate(from)) throw new Error(n + 'each rate needs the date it applies from.');
      if (dates.has(from)) throw new Error(n + 'two rates from ' + from + '.');
      dates.add(from);
      let percent = Number(x.Percent) || 0;
      const out = { From: from };
      if (regime === 'OWN' && cat.taxed) {
        const parts = {};
        Object.keys(x.Parts || {}).forEach(k => {
          const p = Number(x.Parts[k]) || 0;
          if (!comps.some(cc => cc.Code === k)) throw new Error(n + k + ' is not one of the components.');
          if (p < 0 || p > 100) throw new Error(n + 'a rate is 0 to 100%.');
          if (p) parts[k] = p;
        });
        percent = round4(Object.values(parts).reduce((t, p) => t + p, 0));
        out.Parts = parts;
      }
      if (!cat.taxed) percent = 0;
      if (percent < 0 || percent > 100) throw new Error(n + 'a rate is 0 to 100%.');
      out.Percent = percent;
      const cess = Number(x.Cess) || 0;
      if (cess) {
        if (regime !== 'IN_GST') throw new Error(n + 'a cess is for GST only.');
        if (cess < 0 || cess > 400) throw new Error(n + 'the cess is 0 to 400%.');
        out.Cess = cess;
      }
      return out;
    }).sort((a, b) => a.From.localeCompare(b.From));
    if (!rates.length) throw new Error(n + 'give it a rate and the date it applies from.');
    return { Code: codeId, Name: String(c.Name || '').trim().slice(0, 60) || codeId, Category: category, RecoverablePercent: recoverable, Active: c.Active !== false, Rates: rates };
  });
  if (!codes.length) throw new Error('Add at least one tax code.');
  return { Regime: regime, Name: name, StateCode: stateCode, Rounding: rounding, Components: comps, Codes: codes };
}
const round4 = n => Math.round((Number(n) || 0) * 10000) / 10000;

// ---------- a line's tax ----------

// The rate row in force on the date (null before the code's first rate).
function rateOn(taxCode, date) {
  const rows = (taxCode && taxCode.Rates) || [];
  let hit = null;
  rows.forEach(r => { if (r.From <= date && (!hit || r.From > hit.From)) hit = r; });
  return hit;
}
// GST: within the company's state, or across (another state, an SEZ, abroad).
function isInterState(config, placeOfSupply, partyType) {
  if (config.Regime !== 'IN_GST') return false;
  if (partyType === 'SEZ' || partyType === 'Overseas') return true;
  const place = String(placeOfSupply || '').trim();
  return !place || place !== config.StateCode;
}
// The components a code charges on a date: [{ Component, Percent }].
// opts: { placeOfSupply, partyType } (GST).
function componentsOf(config, codeId, date, opts) {
  const c = (config.Codes || []).find(x => x.Code === codeId);
  if (!c) throw new Error('Tax code ' + codeId + ' is not set up for this company (Tax Configuration).');
  const row = rateOn(c, date);
  if (!row) throw new Error('Tax code ' + codeId + ' has no rate on ' + date + '.');
  const cat = CATEGORIES[c.Category];
  if (!cat.taxed) return [];
  const out = [];
  if (config.Regime === 'IN_GST') {
    if (isInterState(config, (opts || {}).placeOfSupply, (opts || {}).partyType)) out.push({ Component: 'IGST', Percent: row.Percent });
    else {
      const half = round4(row.Percent / 2);
      out.push({ Component: 'CGST', Percent: half }, { Component: UT_STATES.includes(config.StateCode) ? 'UTGST' : 'SGST', Percent: half });
    }
    if (row.Cess) out.push({ Component: 'CESS', Percent: row.Cess });
  } else if (config.Regime === 'OWN') {
    Object.keys(row.Parts || {}).forEach(k => out.push({ Component: k, Percent: row.Parts[k] }));
  } else {
    out.push({ Component: 'VAT', Percent: row.Percent });
  }
  return out.filter(x => x.Percent > 0);
}

module.exports = {
  CATEGORIES, EMIRATES, GST_STATES, UT_STATES, REGISTRATION_TYPES, PRESETS, preset,
  gstinProblem, gstinCheckChar, hsnProblem, partyTaxFields, itemTaxFields, validateConfig, rateOn, isInterState, componentsOf, round2
};
