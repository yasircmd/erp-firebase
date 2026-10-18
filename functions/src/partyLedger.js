// Party tagging and bill-wise allocation on JV/CBT lines (roadmap #0,
// docs/modules/PARTY_PAYMENTS.md).
//
// A line on a vendor's payables or customer's receivables account names
// its party (PartyType + PartyID) and says how its amount is allocated:
//   { RefType: 'New', Amount }             — a new open item (e.g. an advance)
//   { RefType: 'Against', RefID, Amount }  — settles an existing open item
//
// Open items and their outstanding amounts are DERIVED, never stored:
//   - a posted Vendor/Customer Invoice (not a reversal, not reversed, not
//     pending reversal approval): RefID 'VendorInvoice:<id>' /
//     'CustomerInvoice:<id>', amount Total, side Cr (vendor) / Dr (customer)
//   - each New allocation on a live entry's line: RefID
//     'NewRef:<jvId>:<LineNo>', amount and side from the line
// outstanding = amount − Against allocations on live entries, where live
// means Posted, not reversed and not itself a reversal. So the journal
// entries are the single source of truth: reversal, Data Reset and
// record clearing stay consistent with no second store to sync.
//
// Each entry also carries PartyKeys ('Vendor:V1'), AllocatedRefs (the
// Against RefIDs) and AllocatedRefTypes, so these lookups are single-field
// array-contains queries (no composite index needed).
const { rtdb, firestore } = require('./firebaseAdmin');
const { parseAmountServer, FIRESTORE_JOURNAL_ENTRIES_COLLECTION } = require('./glWriting');
const movedPaths = require('./movedPaths');

const PARTY_TYPES = {
  Vendor: {
    path: 'vendors', accountField: 'TradePayablesAccountID', accountLabel: 'Trade Payables',
    codeField: 'VendorCode', nameField: 'VendorName',
    invoicePath: 'vendorInvoices', invoiceType: 'VendorInvoice', invoicePartyField: 'VendorID', invoiceSide: 'Cr'
  },
  Customer: {
    path: 'customers', accountField: 'TradeReceivablesAccountID', accountLabel: 'Trade Receivables',
    codeField: 'CustomerCode', nameField: 'CustomerName',
    invoicePath: 'customerInvoices', invoiceType: 'CustomerInvoice', invoicePartyField: 'CustomerID', invoiceSide: 'Dr'
  }
};
const INVOICE_TYPES = { VendorInvoice: 'Vendor', CustomerInvoice: 'Customer' };

const round2 = n => Math.round(n * 100) / 100;
const fmt = n => round2(n).toFixed(2);
const sideLabel = s => (s === 'Dr' ? 'debit' : 'credit');

function isLive(entry) {
  return entry.Status === 'Posted' && !entry.ReversedByJV && !entry.ReversalOfJV;
}

function lineSide(line) { return Number(line.Debit) > 0 ? 'Dr' : 'Cr'; }
// In the party's terms: a foreign line's own amount (docs/modules/MULTI_CURRENCY.md), else the base amount.
function lineAmount(line) {
  if (line.FcCurrency) return round2(Number(line.FcDebit) > 0 ? Number(line.FcDebit) : Number(line.FcCredit) || 0);
  return round2(Number(line.Debit) > 0 ? Number(line.Debit) : Number(line.Credit));
}

function addDays(dateStr, days) {
  const d = new Date(String(dateStr || '').substring(0, 10) + 'T00:00:00Z');
  if (isNaN(d.getTime())) return '';
  d.setUTCDate(d.getUTCDate() + (Number(days) || 0));
  return d.toISOString().substring(0, 10);
}

async function loadParties() {
  const [vendors, customers] = await Promise.all([rtdb.ref('vendors').get(), rtdb.ref('customers').get()]);
  return { Vendor: vendors.val() || {}, Customer: customers.val() || {} };
}

// AccountID -> true for every account that is some vendor's payables or
// some customer's receivables account.
function controlAccountIds(parties) {
  const ids = new Set();
  Object.keys(PARTY_TYPES).forEach(pt => {
    const f = PARTY_TYPES[pt].accountField;
    Object.values(parties[pt]).forEach(p => { if (p && p[f]) ids.add(p[f]); });
  });
  return ids;
}

function partyLabel(partyType, party) {
  const cfg = PARTY_TYPES[partyType];
  return (party[cfg.nameField] || party[cfg.codeField] || partyType);
}

async function queryEntries(field, op, value) {
  const snap = await firestore.collection(FIRESTORE_JOURNAL_ENTRIES_COLLECTION).where(field, op, value).get();
  return snap.docs.map(d => Object.assign({ _id: d.id }, d.data()));
}

// Every open item of one party (outstanding may be zero), keyed by RefID.
// asOf (optional, 'YYYY-MM-DD', the party statements): only invoices and
// entries dated on or before it count — both the items and the Against
// allocations reducing them. Omitted, everything counts (as before).
// excludeEntryId (optional): leave that journal entry out, as if it were
// not posted (a re-match replaces its allocations; docs/modules/UX_TIER3.md G).
async function getOpenItemsForParty(partyType, partyId, party, asOf, excludeEntryId) {
  const cfg = PARTY_TYPES[partyType];
  // The party's invoices (Customer Invoices are a Firestore query, movedPaths.js).
  const invoices = await movedPaths.where(cfg.invoicePath, { [cfg.invoicePartyField]: partyId });
  const entries = (await queryEntries('PartyKeys', 'array-contains', partyType + ':' + partyId)).filter(e => !excludeEntryId || e._id !== excludeEntryId);
  return openItemsFrom(partyType, partyId, party, asOf, invoices, entries);
}
// The same from data already read: the invoices of the party type (RTDB)
// and the journal entries tagged with this party (the aging reports read
// them once for every party, docs/modules/AGING_REPORTS.md).
function openItemsFrom(partyType, partyId, party, asOf, invoices, partyEntries) {
  const dated = d => !asOf || String(d || '') <= asOf;
  const cfg = PARTY_TYPES[partyType];
  const items = new Map();

  Object.keys(invoices).forEach(id => {
    const inv = invoices[id];
    if (inv[cfg.invoicePartyField] !== partyId) return;
    if (inv.Status !== 'Posted' || inv.ReversedByInvoiceID || inv.ReversalOfInvoiceID) return;
    if (!dated(inv.InvoiceDate)) return;
    items.set(cfg.invoiceType + ':' + id, {
      RefID: cfg.invoiceType + ':' + id, ItemType: cfg.invoiceType, Number: inv.TransactionNumber || '',
      Date: inv.InvoiceDate || '', DueDate: addDays(inv.InvoiceDate, party ? party.PaymentTermsDays : 0),
      CompanyID: inv.CompanyID || '', Side: cfg.invoiceSide, Amount: round2(Number(inv.Total) || 0),
      Currency: inv.CurrencyCode || '', Rate: Number(inv.ExchangeRate) || 1, // its own currency and rate (MULTI_CURRENCY.md)
      Description: inv.Description || '', Allocated: 0
    });
  });

  const entries = partyEntries.filter(e => isLive(e) && dated(e.JVDate));
  const against = [];
  entries.forEach(e => (e.Lines || []).forEach(l => {
    if (l.PartyType !== partyType || l.PartyID !== partyId || l.FxAdjustment) return; // an exchange difference settles nothing
    (l.Allocations || []).forEach(a => {
      if (a.RefType === 'New') {
        const refId = 'NewRef:' + e._id + ':' + l.LineNo;
        // An opening document (docs/modules/OPENING_BALANCES.md) carries its
        // own number, date and due date.
        items.set(refId, {
          RefID: refId, ItemType: 'NewRef', Number: a.DocumentNo || e.JVNumber || '', Date: a.DocumentDate || e.JVDate || '',
          DueDate: a.DueDate || a.DocumentDate || e.JVDate || '', DocumentType: a.DocumentType || '',
          CompanyID: e.CompanyID || '', Side: lineSide(l), Amount: round2(Number(a.Amount) || 0),
          Currency: l.FcCurrency || '', Rate: l.FcCurrency ? Number(l.FcRate) || 1 : 1,
          Description: l.Description || e.Description || '', Allocated: 0
        });
      } else if (a.RefType === 'Against') {
        against.push(a);
      }
    });
  }));
  against.forEach(a => {
    const item = items.get(a.RefID);
    if (item) item.Allocated = round2(item.Allocated + (Number(a.Amount) || 0));
  });
  items.forEach(item => { item.Outstanding = round2(item.Amount - item.Allocated); });
  return items;
}

// Takes the raw lines a screen sent (with any party fields) and the
// lines validateAndNormalizeLines returned from them, which dropped
// those fields. Normalization skips blank-account lines and otherwise
// keeps order, so the non-blank raw lines line up one-to-one.
function attachPartyFields(rawLines, normalizedLines) {
  const raw = (rawLines || []).filter(l => String(l.AccountCode || '').trim());
  return normalizedLines.map((l, i) => {
    const r = raw[i] || {};
    const out = Object.assign({}, l);
    if (r.PartyType !== undefined) out.PartyType = r.PartyType;
    if (r.PartyID !== undefined) out.PartyID = r.PartyID;
    if (r.Allocations !== undefined) out.Allocations = r.Allocations;
    return out;
  });
}

// The realized exchange differences (docs/modules/MULTI_CURRENCY.md): for a
// foreign line settling items made at another rate, one line on the party's
// control account (no foreign amount: the foreign balance is settled, only
// the base differs) and one on the company's Exchange Gain / Loss account.
// d > 0: the base settled is more than the item's base, so the control
// account takes d on the item's side.
async function appendExchangeDifferences(out, diffs, companyId) {
  if (!diffs.length) return;
  const settings = (await rtdb.ref('fxSettings/' + companyId).get()).val() || {};
  const coa = (await rtdb.ref('coa').get()).val() || {};
  const fxAcc = coa[settings.GainLossAccountID];
  if (!fxAcc) throw new Error('This entry settles foreign-currency items at another rate: set the company\'s Exchange Gain / Loss account in Currency Configuration first.');
  const byLine = new Map();
  diffs.forEach(x => {
    const k = out.indexOf(x.line);
    const cur = byLine.get(k) || { line: x.line, dr: 0, labels: [] };
    cur.dr = round2(cur.dr + (x.itemSide === 'Dr' ? x.d : -x.d));
    cur.labels.push(x.label);
    byLine.set(k, cur);
  });
  byLine.forEach(({ line, dr, labels }) => {
    if (!dr) return;
    const desc = 'Exchange difference — ' + labels.join(', ');
    const amt = Math.abs(dr);
    out.push({ LineNo: out.length + 1, AccountID: line.AccountID, AccountCode: line.AccountCode, AccountName: line.AccountName, Description: desc,
      Debit: dr > 0 ? amt : 0, Credit: dr > 0 ? 0 : amt, CostCenterID: line.CostCenterID || '', ProfitCenterID: line.ProfitCenterID || '',
      FcCurrency: line.FcCurrency, FcDebit: 0, FcCredit: 0, FcRate: Number(line.FcRate), FxAdjustment: true,
      PartyType: line.PartyType, PartyID: line.PartyID, PartyName: line.PartyName, Allocations: [] });
    out.push({ LineNo: out.length + 1, AccountID: settings.GainLossAccountID, AccountCode: fxAcc.AccountCode, AccountName: fxAcc.AccountName, Description: desc,
      Debit: dr > 0 ? 0 : amt, Credit: dr > 0 ? amt : 0, CostCenterID: line.CostCenterID || settings.CostCenterID || '', ProfitCenterID: line.ProfitCenterID || '', FxAdjustment: true });
  });
}

// Validates and normalizes the party fields on already-normalized GL
// lines. Run at save, at post (under the global lock — the outstanding
// check is authoritative only there) and again at final approval.
// Returns the lines to store plus the entry-level lookup arrays.
// opts.excludeEntryId: validate as if that entry's own allocations were not
// there (a re-match of it).
async function resolvePartyLines(lines, companyId, opts) {
  const parties = await loadParties();
  const controlIds = controlAccountIds(parties);
  const base = await require('./exchangeRates').baseCurrency();
  const out = [];
  const againstByParty = new Map(); // 'Vendor:V1' -> [{ lineNo, side, alloc }]

  // Exchange differences are worked out again each time (MULTI_CURRENCY.md).
  (lines || []).filter(l => !l.FxAdjustment).forEach((line, idx) => {
    const n = 'Line ' + (idx + 1) + ': ';
    const clean = Object.assign({}, line);
    delete clean.PartyType; delete clean.PartyID; delete clean.PartyName; delete clean.Allocations;
    const partyType = String(line.PartyType || '').trim();
    const partyId = String(line.PartyID || '').trim();

    if (!partyType && !partyId) {
      if (controlIds.has(line.AccountID)) {
        throw new Error(n + 'account ' + line.AccountCode + ' is a vendor or customer control account — select the Vendor or Customer this line belongs to.');
      }
      if ((line.Allocations || []).length) throw new Error(n + 'allocations need a Vendor or Customer on the line.');
      out.push(clean);
      return;
    }

    const cfg = PARTY_TYPES[partyType];
    if (!cfg) throw new Error(n + 'party type must be Vendor or Customer.');
    const party = parties[partyType][partyId];
    if (!party) throw new Error(n + partyType + ' not found.');
    const name = partyLabel(partyType, party);
    if (party.CompanyID && party.CompanyID !== companyId) throw new Error(n + name + ' belongs to a different company.');
    if (party[cfg.accountField] !== line.AccountID) {
      throw new Error(n + 'a line tagged with ' + name + ' must be on ' + name + '\'s own ' + cfg.accountLabel + ' account, not ' + line.AccountCode + '.');
    }

    // A foreign party's lines are in its currency (decision 211); a base party's are not.
    const cur = require('./fx').partyCurrency(party, base.Code);
    if (cur && line.FcCurrency !== cur) throw new Error(n + name + ' is invoiced in ' + cur + ': enter the line\'s ' + cur + ' amount beside its amount.');
    if (!cur && line.FcCurrency) throw new Error(n + name + ' is in ' + (base.Code || 'the base currency') + ', not ' + line.FcCurrency + '.');
    const amount = lineAmount(line);
    const side = lineSide(line);
    let allocations = (line.Allocations || []).map(a => ({
      RefType: String(a.RefType || '').trim(), RefID: String(a.RefID || '').trim(), Amount: round2(parseAmountServer(a.Amount))
    }));
    if (!allocations.length) allocations = [{ RefType: 'New', RefID: '', Amount: amount }];

    let newCount = 0;
    const seen = new Set();
    allocations.forEach(a => {
      if (!(a.Amount > 0)) throw new Error(n + 'every allocation needs an amount greater than zero.');
      if (a.RefType === 'New') { newCount++; a.RefID = ''; return; }
      if (a.RefType !== 'Against') throw new Error(n + 'allocation type must be New Ref or Against Ref.');
      if (!a.RefID) throw new Error(n + 'an Against Ref allocation must name the item it settles.');
      if (seen.has(a.RefID)) throw new Error(n + 'the same item is allocated twice on this line.');
      seen.add(a.RefID);
    });
    if (newCount > 1) throw new Error(n + 'only one New Ref per line.');
    const total = round2(allocations.reduce((s, a) => s + a.Amount, 0));
    if (Math.abs(total - amount) > 0.005) {
      throw new Error(n + 'allocations total ' + fmt(total) + ' but the line is ' + fmt(amount) + '.');
    }

    const key = partyType + ':' + partyId;
    allocations.filter(a => a.RefType === 'Against').forEach(a => {
      if (!againstByParty.has(key)) againstByParty.set(key, []);
      againstByParty.get(key).push({ n: n, side: side, alloc: a, line: out.length });
    });
    out.push(Object.assign(clean, { PartyType: partyType, PartyID: partyId, PartyName: name, Allocations: allocations }));
  });

  const fxDiffs = [];
  // Against refs: each must be an open item of that same party, in this
  // company, on the opposite side, and — summed across every line of this
  // entry — no more than its outstanding right now.
  for (const [key, list] of againstByParty) {
    const [partyType, partyId] = key.split(':');
    const party = parties[partyType][partyId];
    const items = await getOpenItemsForParty(partyType, partyId, party, undefined, opts && opts.excludeEntryId);
    const used = new Map();
    list.forEach(({ n, side, alloc, line }) => {
      const item = items.get(alloc.RefID);
      if (!item) throw new Error(n + 'the item being settled is not an open item of ' + partyLabel(partyType, party) + ' (it may have been reversed).');
      const label = item.Number || alloc.RefID;
      if (item.CompanyID && item.CompanyID !== companyId) throw new Error(n + label + ' belongs to a different company.');
      if (item.Side === side) {
        throw new Error(n + label + ' is a ' + sideLabel(item.Side) + ' item — only a ' + sideLabel(item.Side === 'Dr' ? 'Cr' : 'Dr') + ' line can settle it.');
      }
      const total = round2((used.get(alloc.RefID) || 0) + alloc.Amount);
      if (total > item.Outstanding + 0.005) {
        throw new Error(n + label + ' has only ' + fmt(item.Outstanding) + ' outstanding' + (total > alloc.Amount ? ' (this entry allocates ' + fmt(total) + ' to it in total)' : '') + '.');
      }
      used.set(alloc.RefID, total);
      alloc.RefNumber = item.Number || '';
      // A foreign item settled at another rate: its base difference (realized exchange gain or loss).
      const l = out[line];
      if (l.FcCurrency) {
        const d = round2(round2(alloc.Amount * Number(l.FcRate)) - round2(alloc.Amount * (Number(item.Rate) || 1)));
        if (d) fxDiffs.push({ line: l, itemSide: item.Side, d, label });
      }
    });
  }
  await appendExchangeDifferences(out, fxDiffs, companyId);

  const partyKeys = [...new Set(out.filter(l => l.PartyType).map(l => l.PartyType + ':' + l.PartyID))];
  const totalDebit = round2(out.reduce((t, l) => t + (Number(l.Debit) || 0), 0)), totalCredit = round2(out.reduce((t, l) => t + (Number(l.Credit) || 0), 0));
  const refs = [...new Set(out.flatMap(l => (l.Allocations || []).filter(a => a.RefType === 'Against').map(a => a.RefID)))];
  return {
    lines: out, totalDebit, totalCredit,
    fields: { PartyKeys: partyKeys, AllocatedRefs: refs, AllocatedRefTypes: [...new Set(refs.map(r => r.split(':')[0]))] }
  };
}

// Live entries that allocate against any of these RefIDs.
async function liveEntriesAllocating(refIds) {
  const ids = [...new Set(refIds)];
  const found = new Map();
  for (let i = 0; i < ids.length; i += 30) {
    (await queryEntries('AllocatedRefs', 'array-contains-any', ids.slice(i, i + 30)))
      .filter(isLive).forEach(e => found.set(e._id, e));
  }
  return [...found.values()];
}

// Refuses a JV/CBT reversal that would orphan allocations (see
// reverseJournalEntry).
async function assertEntryReversible(jvId, entry) {
  if (entry.ReversalOfJV && (entry.PartyKeys || []).length) {
    throw new Error('This reversal has vendor/customer lines and cannot itself be reversed — reversing it would re-post the payment without its allocations. Post a new entry instead.');
  }
  const newRefs = (entry.Lines || [])
    .filter(l => (l.Allocations || []).some(a => a.RefType === 'New'))
    .map(l => 'NewRef:' + jvId + ':' + l.LineNo);
  if (!newRefs.length) return;
  const users = (await liveEntriesAllocating(newRefs)).filter(e => e._id !== jvId);
  if (users.length) {
    throw new Error('A New Ref on this entry has been settled by ' + users.map(e => e.JVNumber || e._id).join(', ') + ' — reverse that first.');
  }
}

// Refuses an invoice reversal while payments are allocated to it
// (owner decision 5).
async function assertInvoiceHasNoAllocations(invoiceType, invoiceId) {
  const users = await liveEntriesAllocating([invoiceType + ':' + invoiceId]);
  if (users.length) {
    throw new Error('This invoice has payments or adjustments allocated to it (' + users.map(e => e.JVNumber || e._id).join(', ') + ') — reverse those first.');
  }
}

// Adds Outstanding, PaymentStatus and DueDate to each open invoice in a
// Vendor/Customer Invoice list. PdcPending is the part settled by
// post-dated cheques that haven't cleared yet (docs/modules/PDC.md,
// decision 10); the invoice lists then add "(PDC pending)".
async function annotateInvoiceOutstanding(invoiceType, invoices) {
  const partyType = INVOICE_TYPES[invoiceType];
  const cfg = PARTY_TYPES[partyType];
  const allocated = new Map();
  const byPdc = new Map();
  const pdcs = await movedPaths.where('pdcCheques', { Status: 'Pending' }); // the pending ones (jobStore.js)
  const pendingPdcJvIds = new Set(Object.values(pdcs).filter(p => p.Status === 'Pending' && p.LinkedJVID).map(p => p.LinkedJVID));
  (await queryEntries('AllocatedRefTypes', 'array-contains', invoiceType)).filter(isLive).forEach(e => {
    (e.Lines || []).forEach(l => (l.Allocations || []).forEach(a => {
      if (a.RefType === 'Against' && String(a.RefID).startsWith(invoiceType + ':')) {
        allocated.set(a.RefID, round2((allocated.get(a.RefID) || 0) + (Number(a.Amount) || 0)));
        if (pendingPdcJvIds.has(e._id)) byPdc.set(a.RefID, round2((byPdc.get(a.RefID) || 0) + (Number(a.Amount) || 0)));
      }
    }));
  });
  const parties = (await rtdb.ref(cfg.path).get()).val() || {};
  const idField = invoiceType + 'ID';
  (invoices || []).forEach(inv => {
    const open = (inv.Status === 'Posted' || inv.Status === 'PendingReversalApproval') && !inv.ReversedByInvoiceID && !inv.ReversalOfInvoiceID;
    if (!open) return;
    const total = round2(Number(inv.Total) || 0);
    const outstanding = round2(total - (allocated.get(invoiceType + ':' + inv[idField]) || 0));
    inv.Outstanding = outstanding;
    inv.PaymentStatus = outstanding <= 0.005 ? 'Paid' : (outstanding < total - 0.005 ? 'Partly paid' : 'Unpaid');
    inv.PdcPending = byPdc.get(invoiceType + ':' + inv[idField]) || 0;
    const party = parties[inv[cfg.invoicePartyField]];
    inv.DueDate = addDays(inv.InvoiceDate, party ? party.PaymentTermsDays : 0);
  });
  return invoices;
}

// For the JV/CBT screens: every vendor and customer usable in this
// company, with its control account.
async function listPartyAccounts(companyId) {
  const parties = await loadParties();
  const baseCode = (await require('./exchangeRates').baseCurrency()).Code;
  const coa = (await rtdb.ref('coa').get()).val() || {};
  const out = [];
  Object.keys(PARTY_TYPES).forEach(pt => {
    const cfg = PARTY_TYPES[pt];
    Object.keys(parties[pt]).forEach(id => {
      const p = parties[pt][id];
      if (p.CompanyID && p.CompanyID !== companyId) return;
      const account = coa[p[cfg.accountField]];
      if (!account) return;
      out.push({
        PartyType: pt, PartyID: id, Code: p[cfg.codeField] || '', Name: p[cfg.nameField] || '', Status: p.Status || '',
        AccountID: p[cfg.accountField], AccountCode: String(account.AccountCode),
        Currency: require('./fx').partyCurrency(p, baseCode) // a foreign party's lines carry its amount (MULTI_CURRENCY.md)
      });
    });
  });
  return out.sort((a, b) => (a.PartyType + a.Name).localeCompare(b.PartyType + b.Name));
}

async function listOpenItems(partyType, partyId, companyId, excludeEntryId) {
  const cfg = PARTY_TYPES[partyType];
  if (!cfg) throw new Error('Party type must be Vendor or Customer.');
  const party = (await rtdb.ref(cfg.path + '/' + partyId).get()).val();
  if (!party) throw new Error(partyType + ' not found.');
  const items = await getOpenItemsForParty(partyType, partyId, party, undefined, excludeEntryId);
  return [...items.values()]
    .filter(i => i.Outstanding > 0.005 && (!companyId || !i.CompanyID || i.CompanyID === companyId))
    .sort((a, b) => (a.Date + a.Number).localeCompare(b.Date + b.Number));
}

module.exports = {
  PARTY_TYPES, isLive, addDays, queryEntries, attachPartyFields, resolvePartyLines, getOpenItemsForParty, openItemsFrom,
  assertEntryReversible, assertInvoiceHasNoAllocations, liveEntriesAllocating, lineSide, lineAmount, annotateInvoiceOutstanding, listPartyAccounts, listOpenItems
};
