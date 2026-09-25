// Purchase Return / Debit Note and Sales Return / Credit Note
// (docs/modules/PURCHASE_RETURN.md, SALES_RETURN.md). One engine, two
// configurations: the two documents are mirror images.
//
// A note is raised against one posted Vendor/Customer Invoice. Its goods
// lines return part of the quantity on the invoice's GRN / Delivery Note
// lines, at the invoiced price, with the invoice's discount share and tax
// %. Value lines adjust value only. It is stored in stock/transactions
// (TransactionType PurchaseReturn / SalesReturn) so its stock lines count
// in the stock ledger report and Data Reset's ledger rebuild, and posts one
// GL entry (DBN / CRN) whose payables/receivables line is party-tagged
// and settles its own invoice first (partyLedger.js); anything beyond the
// invoice's outstanding is a New Ref.
//
// Structure follows grn.js (global lock, commit-attempt markers, approval
// gate) and the invoices' reversal-with-approval flow.
const { randomUUID } = require('crypto');
const { HttpsError } = require('firebase-functions/v2/https');
const { onCallWithMessages } = require('./callable');
const { rtdb, firestore } = require('./firebaseAdmin');
const { requireUser, moduleHasCapability } = require('./auth');
const {
  userCanAccessCompany, writeStockGlEntry, parseAmountServer, COST_CENTER_REQUIRED_TYPES, FIRESTORE_JOURNAL_ENTRIES_COLLECTION
} = require('./glWriting');
const { computeStockMovement, commitStockLedgerUpdates } = require('./stockMovement');
const { beginCommitAttempt, abandonCommitAttempt, finalizeCommitAttempt } = require('./commitAttempt');
const { resolveApprovalScopeKeyForDocument, beginApprovalInstance, recordApprovalDecision } = require('./approvals');
const { withGlobalLock } = require('./lock');
const { PARTY_TYPES, getOpenItemsForParty, assertEntryReversible } = require('./partyLedger');

const onCallOptions = { region: 'us-central1' };
const r2 = n => Math.round(n * 100) / 100;
const r6 = n => Math.round(n * 1e6) / 1e6;
const fmt = n => r2(n).toFixed(2);
const bad = (msg) => new HttpsError('failed-precondition', msg);

const KINDS = {
  PurchaseReturn: {
    kind: 'PurchaseReturn', moduleId: 'PURCHASERETURN', label: 'Purchase Return', idPrefix: 'DBND-',
    partyType: 'Vendor', partyField: 'VendorID', invoicePath: 'vendorInvoices', invoiceType: 'VendorInvoice',
    invoiceLabel: 'Vendor Invoice', sourceDocs: 'SourceGRNs', sourceDocId: 'GRNID', sourceLabel: 'GRN',
    // Returned goods leave stock; the payable is debited.
    stockDirection: 'Out', partySide: 'Dr'
  },
  SalesReturn: {
    kind: 'SalesReturn', moduleId: 'SALESRETURN', label: 'Sales Return', idPrefix: 'CRND-',
    partyType: 'Customer', partyField: 'CustomerID', invoicePath: 'customerInvoices', invoiceType: 'CustomerInvoice',
    invoiceLabel: 'Customer Invoice', sourceDocs: 'SourceDeliveryNotes', sourceDocId: 'DeliveryNoteID', sourceLabel: 'Delivery Note',
    // Returned goods come back into stock; the receivable is credited.
    stockDirection: 'In', partySide: 'Cr'
  }
};

async function requireCapability(moduleId, capability, role, what) {
  if (!(await moduleHasCapability(moduleId, capability, role))) {
    throw new HttpsError('permission-denied', 'You do not have permission to ' + what + ' in ' + moduleId + '.');
  }
}

const val = async (path) => (await rtdb.ref(path).get()).val();

// A document counts toward "already returned" once posted, until reversed.
function isLiveReturn(t, cfg) {
  return t.TransactionType === cfg.kind && t.Status === 'Posted' && !t.ReversedByReturnID && !t.ReversalOfReturnID;
}

function assertInvoiceOpen(cfg, invoice) {
  if (!invoice) throw bad(cfg.invoiceLabel + ' not found.');
  if (invoice.ReversalOfInvoiceID) throw bad('A reversal entry cannot be returned against.');
  if (invoice.ReversedByInvoiceID) throw bad('This ' + cfg.invoiceLabel + ' has been reversed.');
  if (invoice.Status === 'PendingReversalApproval') throw bad('This ' + cfg.invoiceLabel + ' is pending reversal approval.');
  if (invoice.Status !== 'Posted') throw bad('Only a posted ' + cfg.invoiceLabel + ' can be returned against.');
}

// The invoice's returnable goods lines: every GRN / Delivery Note line
// behind it, less what other live returns already took. SourceKey is
// '<docId>:<lineNo>'.
async function loadReturnSource(cfg, invoiceId, invoice, excludeReturnId) {
  const transactions = (await val('stock/transactions')) || {};
  const returned = {};
  let priorNotesTotal = 0;
  Object.keys(transactions).forEach(id => {
    const t = transactions[id];
    if (id === excludeReturnId || t.SourceInvoiceID !== invoiceId || !isLiveReturn(t, cfg)) return;
    priorNotesTotal = r2(priorNotesTotal + (Number(t.Total) || 0));
    (t.Lines || []).forEach(l => { returned[l.SourceKey] = r6((returned[l.SourceKey] || 0) + (Number(l.Quantity) || 0)); });
  });

  const lines = [];
  (invoice[cfg.sourceDocs] || []).forEach(src => {
    const docId = src[cfg.sourceDocId];
    const doc = transactions[docId];
    if (!doc) return;
    (doc.Lines || []).forEach((l, i) => {
      const lineNo = l.LineNo || (i + 1);
      const key = docId + ':' + lineNo;
      // Sales: the invoice priced each DN line (same order as the DN's own
      // lines); purchases: the GRN line's own unit cost is what was billed.
      const invoiced = cfg.kind === 'SalesReturn' ? ((src.Lines || [])[i] || {}).UnitPrice : l.UnitCost;
      const qty = Number(l.Quantity) || 0;
      lines.push({
        SourceKey: key, SourceDocID: docId, SourceDocNumber: doc.TransactionNumber || src.GRNNumber || src.DeliveryNoteNumber || '',
        SourceLineNo: lineNo, ItemID: l.ItemID, ItemCode: l.ItemCode || '', ItemName: l.ItemName || '',
        WarehouseID: l.WarehouseID, Quantity: qty, Returned: returned[key] || 0,
        Returnable: r6(Math.max(0, qty - (returned[key] || 0))),
        UnitPrice: Number(invoiced) || 0,
        // Sales only: the cost the Delivery Note took out, which the
        // return puts back.
        UnitCost: Number(l.UnitCost) || 0,
        CostCenterID: l.CostCenterID || '', ProfitCenterID: l.ProfitCenterID || ''
      });
    });
  });
  return { lines, priorNotesTotal };
}

// Validates a draft against the invoice as it stands now and computes
// every amount. Used at save and again under the lock at commit.
async function buildReturn(cfg, data, excludeReturnId) {
  const companyId = String(data.CompanyID || '').trim();
  const invoiceId = String(data.SourceInvoiceID || '').trim();
  if (!invoiceId) throw bad('Select the ' + cfg.invoiceLabel + ' this note is against.');
  const invoice = await val(cfg.invoicePath + '/' + invoiceId);
  assertInvoiceOpen(cfg, invoice);
  if (invoice.CompanyID !== companyId) throw bad('The ' + cfg.invoiceLabel + ' belongs to a different company.');
  const partyId = invoice[cfg.partyField];

  const source = await loadReturnSource(cfg, invoiceId, invoice, excludeReturnId);
  const byKey = new Map(source.lines.map(l => [l.SourceKey, l]));
  const orgUnits = (await val('orgUnits')) || {};

  const lines = [];
  const seen = new Set();
  (data.Lines || []).forEach((raw, idx) => {
    const qty = r6(Number(raw.Quantity) || 0);
    if (!qty) return; // lines left at zero aren't returned
    const n = 'Line ' + (idx + 1) + ': ';
    const src = byKey.get(String(raw.SourceKey || ''));
    if (!src) throw bad(n + 'not a line of this invoice.');
    if (seen.has(src.SourceKey)) throw bad(n + 'the same invoice line appears twice.');
    seen.add(src.SourceKey);
    if (qty < 0) throw bad(n + 'quantity cannot be negative.');
    if (qty > src.Returnable + 0.000001) {
      throw bad(n + (src.ItemCode || 'this line') + ' has only ' + src.Returnable + ' left to return (' + src.Quantity + ' on ' + src.SourceDocNumber + ', ' + src.Returned + ' already returned).');
    }
    let warehouseId = src.WarehouseID;
    if (cfg.kind === 'SalesReturn' && String(raw.WarehouseID || '').trim()) {
      warehouseId = String(raw.WarehouseID).trim();
      const wh = orgUnits[warehouseId];
      if (!wh || wh.Type !== 'Warehouse' || wh.Status === 'Inactive') throw bad(n + 'warehouse not found.');
      if (wh.CompanyID && wh.CompanyID !== companyId) throw bad(n + 'that warehouse belongs to a different company.');
    }
    lines.push({
      LineNo: lines.length + 1, SourceKey: src.SourceKey, SourceDocID: src.SourceDocID, SourceDocNumber: src.SourceDocNumber,
      ItemID: src.ItemID, ItemCode: src.ItemCode, ItemName: src.ItemName, WarehouseID: warehouseId,
      Quantity: qty, UnitPrice: src.UnitPrice, Amount: r2(qty * src.UnitPrice),
      SourceUnitCost: src.UnitCost,
      CostCenterID: src.CostCenterID || String(data.CostCenterID || ''), ProfitCenterID: src.ProfitCenterID || String(data.ProfitCenterID || ''),
      Description: String(raw.Description || '').trim() || ((src.ItemCode ? src.ItemCode + ' — ' : '') + 'return from ' + src.SourceDocNumber)
    });
  });

  const coa = (await val('coa')) || {};
  const accounts = Object.keys(coa).map(id => Object.assign({ AccountID: id }, coa[id]));
  const valueLines = [];
  (data.ValueLines || []).forEach((raw, idx) => {
    const code = String(raw.AccountCode || '').trim();
    if (!code) return;
    const n = 'Value line ' + (idx + 1) + ': ';
    const account = accounts.find(a => String(a.AccountCode) === code);
    if (!account) throw bad(n + 'account ' + code + ' not found.');
    if (account.Status !== 'Active' || account.IsPostable !== true) throw bad(n + 'account ' + code + ' must be active and postable.');
    if (account.CompanyID && account.CompanyID !== companyId) throw bad(n + 'account ' + code + ' is restricted to a different company.');
    const amount = r2(parseAmountServer(raw.Amount));
    if (!(amount > 0)) throw bad(n + 'enter an amount greater than zero.');
    const description = String(raw.Description || '').trim();
    if (!description) throw bad(n + 'description is required.');
    const costCenterId = String(raw.CostCenterID || data.CostCenterID || '').trim();
    if (COST_CENTER_REQUIRED_TYPES.includes(account.AccountType) && !costCenterId) throw bad(n + 'account ' + code + ' (' + account.AccountType + ') requires a Cost Center.');
    valueLines.push({ LineNo: valueLines.length + 1, AccountID: account.AccountID, AccountCode: account.AccountCode, AccountName: account.AccountName,
      Description: description, Amount: amount, CostCenterID: costCenterId, ProfitCenterID: String(raw.ProfitCenterID || data.ProfitCenterID || '') });
  });

  if (!lines.length && !valueLines.length) throw bad('Enter a return quantity on at least one line, or a value line.');

  // Amounts (see the design doc): the returned goods' share of the
  // invoice discount, then tax at the invoice's rate.
  const goodsValue = r2(lines.reduce((s, l) => s + l.Amount, 0));
  const valueTotal = r2(valueLines.reduce((s, l) => s + l.Amount, 0));
  const invoiceSubtotal = Number(invoice.Subtotal) || 0;
  const discount = invoiceSubtotal > 0 ? r2((Number(invoice.Discount) || 0) * goodsValue / invoiceSubtotal) : 0;
  const taxPercent = Number(invoice.TaxPercent) || 0;
  const taxAmount = r2((goodsValue - discount + valueTotal) * taxPercent / 100);
  const total = r2(goodsValue - discount + valueTotal + taxAmount);
  const invoiceTotal = r2(Number(invoice.Total) || 0);
  if (total + source.priorNotesTotal > invoiceTotal + 0.005) {
    throw bad('This note (' + fmt(total) + ') plus earlier notes on the invoice (' + fmt(source.priorNotesTotal) + ') would exceed the invoice total ' + fmt(invoiceTotal) + '.');
  }

  return {
    invoice, invoiceId, partyId,
    doc: {
      [cfg.partyField]: partyId, SourceInvoiceID: invoiceId, SourceInvoiceNumber: invoice.TransactionNumber || '',
      Lines: lines, ValueLines: valueLines, GoodsValue: goodsValue, ValueTotal: valueTotal,
      Discount: discount, TaxPercent: taxPercent, TaxAmount: taxAmount, Total: total
    }
  };
}

async function companyAccount(companyId, field, label, coa) {
  const company = await val('companies/' + companyId);
  if (!company) throw new Error('Company not found.');
  const account = coa[company[field]];
  if (!company[field] || !account || !account.IsPostable || account.Status !== 'Active') {
    throw new Error('This company has no valid ' + label + ' configured.');
  }
  return account;
}

function itemExpenseAccount(item, cfg) {
  // Same resolution the Delivery Note used for COGS (resolveItemExpenseAccount_
  // 'Sales'); purchases use Material Consumption (owner decision 3).
  if (cfg.kind === 'SalesReturn' && item.SalesCogsAccountID) return item.SalesCogsAccountID;
  return item.ConsumptionAccountID;
}

// The note's GL lines. stockLines carry each goods line's stock value
// (TotalValue) from computeStockMovement. reverse swaps every side.
async function buildGlLines(cfg, doc, stockLines, party, allocations, coa, items, reverse) {
  const gl = [];
  const hdr = { CostCenterID: doc.CostCenterID || '', ProfitCenterID: doc.ProfitCenterID || '' };
  const push = (account, dr, cr, description, dims) => {
    const d = r2(dr), c = r2(cr);
    if (d <= 0 && c <= 0) return;
    gl.push(Object.assign({ AccountCode: account.AccountCode, Debit: reverse ? c : d, Credit: reverse ? d : c, Description: description }, hdr, dims || {}));
  };
  const text = (reverse ? 'Reversal of ' + (doc.TransactionNumber || '') + ' — ' : '') + doc.Description;
  const purchase = cfg.kind === 'PurchaseReturn';

  // Party line first: settles the invoice (allocations decided under the lock).
  const partyAccount = coa[party[PARTY_TYPES[cfg.partyType].accountField]];
  if (!partyAccount || !partyAccount.IsPostable) throw new Error('The ' + cfg.partyType.toLowerCase() + '\'s ' + PARTY_TYPES[cfg.partyType].accountLabel + ' account is not valid.');
  const partyLine = Object.assign({
    AccountCode: partyAccount.AccountCode, Description: text,
    Debit: 0, Credit: 0, PartyType: cfg.partyType, PartyID: doc[cfg.partyField], PartyName: party[PARTY_TYPES[cfg.partyType].nameField] || ''
  }, hdr);
  const partyDr = cfg.partySide === 'Dr';
  partyLine.Debit = (partyDr !== Boolean(reverse)) ? doc.Total : 0;
  partyLine.Credit = (partyDr !== Boolean(reverse)) ? 0 : doc.Total;
  if (allocations) partyLine.Allocations = allocations;
  gl.push(partyLine);

  // Goods: stock value at WAC (purchase) or at the DN's cost (sales).
  stockLines.forEach(l => {
    const item = items[l.ItemID];
    const inventory = coa[item.InventoryAccountID];
    const expense = coa[itemExpenseAccount(item, cfg)];
    if (!inventory) throw new Error(item.ItemCode + ' has no valid Inventory account.');
    if (!expense || !expense.IsPostable) throw new Error(item.ItemCode + ' has no valid ' + (purchase ? 'Material Consumption' : 'Sales COGS') + ' account.');
    const dims = { CostCenterID: l.CostCenterID || hdr.CostCenterID, ProfitCenterID: l.ProfitCenterID || hdr.ProfitCenterID };
    const stockValue = Number(l.TotalValue) || 0;
    if (purchase) {
      push(inventory, 0, stockValue, l.Description, dims);
      // Invoiced cost vs the WAC that left: difference to Material Consumption.
      const diff = r2(l.Amount - stockValue);
      if (diff > 0) push(expense, 0, diff, 'Return cost difference — ' + l.Description, dims);
      if (diff < 0) push(expense, -diff, 0, 'Return cost difference — ' + l.Description, dims);
    } else {
      push(inventory, stockValue, 0, l.Description, dims);
      push(expense, 0, stockValue, l.Description, dims);
    }
  });

  const companyId = doc.CompanyID;
  if (purchase) {
    if (doc.Discount > 0) push(await companyAccount(companyId, 'DiscountReceivedAccountID', 'Discount Received Account', coa), doc.Discount, 0, 'Discount share — ' + text);
    if (doc.TaxAmount > 0) push(await companyAccount(companyId, 'InputTaxAccountID', 'Input Tax Account', coa), 0, doc.TaxAmount, 'Input tax — ' + text);
    (doc.ValueLines || []).forEach(v => push(coa[v.AccountID] || { AccountCode: v.AccountCode }, 0, v.Amount, v.Description, { CostCenterID: v.CostCenterID, ProfitCenterID: v.ProfitCenterID }));
  } else {
    if (doc.GoodsValue > 0) push(await companyAccount(companyId, 'SalesReturnsAccountID', 'Sales Returns account (set it at the top of the Sales Return screen)', coa), doc.GoodsValue, 0, 'Sales return — ' + text);
    if (doc.Discount > 0) push(await companyAccount(companyId, 'DiscountGivenAccountID', 'Discount Given Account', coa), 0, doc.Discount, 'Discount share — ' + text);
    if (doc.TaxAmount > 0) push(await companyAccount(companyId, 'OutputTaxAccountID', 'Output Tax Account', coa), doc.TaxAmount, 0, 'Output tax — ' + text);
    (doc.ValueLines || []).forEach(v => push(coa[v.AccountID] || { AccountCode: v.AccountCode }, v.Amount, 0, v.Description, { CostCenterID: v.CostCenterID, ProfitCenterID: v.ProfitCenterID }));
  }
  return gl;
}

// Posts a (re-validated) note. Caller holds the global lock.
async function commitReturn(cfg, user, existing, returnId) {
  const built = await buildReturn(cfg, existing, returnId);
  const doc = Object.assign({}, existing, built.doc);
  const [items, coa, party] = await Promise.all([val('items'), val('coa'), val(PARTY_TYPES[cfg.partyType].path + '/' + built.partyId)]);
  if (!party) throw new Error(cfg.partyType + ' not found.');

  const movementLines = doc.Lines.map(l => Object.assign({}, l, { Direction: cfg.stockDirection },
    cfg.stockDirection === 'In' ? { UnitCost: l.SourceUnitCost } : {}));
  const movement = movementLines.length ? await computeStockMovement(items || {}, coa || {}, movementLines) : { ledgerUpdates: {} };

  // Settle the invoice first, up to what it has outstanding right now.
  const refId = cfg.invoiceType + ':' + built.invoiceId;
  const item = (await getOpenItemsForParty(cfg.partyType, built.partyId, party)).get(refId);
  const against = r2(Math.min(doc.Total, item ? Math.max(0, item.Outstanding) : 0));
  const allocations = [];
  if (against > 0) allocations.push({ RefType: 'Against', RefID: refId, RefNumber: doc.SourceInvoiceNumber, Amount: against });
  if (doc.Total - against > 0.005) allocations.push({ RefType: 'New', RefID: '', Amount: r2(doc.Total - against) });

  const glLines = await buildGlLines(cfg, doc, movementLines, party, allocations, coa || {}, items || {}, false);

  const actor = user.profile.username || user.uid;
  const attemptId = await beginCommitAttempt(returnId, actor);
  let glResult;
  try {
    glResult = await writeStockGlEntry(user, cfg.kind, doc.TransactionDate, doc.Description, doc.Reference || doc.SourceInvoiceNumber, glLines,
      { CompanyID: doc.CompanyID, DivisionID: doc.DivisionID, BranchID: doc.BranchID, CostCenterID: doc.CostCenterID, ProfitCenterID: doc.ProfitCenterID },
      {
        CommitAttemptID: attemptId, SourceTransactionID: returnId,
        PartyKeys: [cfg.partyType + ':' + built.partyId], AllocatedRefs: against > 0 ? [refId] : [], AllocatedRefTypes: against > 0 ? [cfg.invoiceType] : []
      });
  } catch (err) {
    await abandonCommitAttempt(returnId, existing.Status, actor);
    throw err;
  }
  await commitStockLedgerUpdates(movement.ledgerUpdates);
  await finalizeCommitAttempt(returnId, glResult, Object.assign({}, built.doc, { Lines: movementLines, SettledAgainstInvoice: against }), actor);
  return { number: glResult.jvNumber, settled: against };
}

// Reverses a posted note. Caller holds the global lock.
async function executeReversal(cfg, user, existing, returnId, date) {
  // RTDB drops empty arrays, so a note with no goods or no value lines
  // comes back without that field.
  const glSnap = await firestore.collection(FIRESTORE_JOURNAL_ENTRIES_COLLECTION).doc(existing.LinkedJVID).get();
  if (!glSnap.exists) throw new Error('This note\'s GL entry was not found.');
  const glEntry = glSnap.data();
  // Refused while its New Ref (credit beyond the invoice) is used elsewhere.
  await assertEntryReversible(existing.LinkedJVID, glEntry);

  const [items, coa, party] = await Promise.all([val('items'), val('coa'), val(PARTY_TYPES[cfg.partyType].path + '/' + existing[cfg.partyField])]);
  if (!party) throw new Error(cfg.partyType + ' not found.');
  // Stock goes the other way: a purchase return's goods come back at the
  // value that left; a sales return's goods leave again at current WAC.
  const back = cfg.stockDirection === 'Out' ? 'In' : 'Out';
  const movementLines = (existing.Lines || []).map(l => Object.assign({}, l, { Direction: back }));
  const movement = movementLines.length ? await computeStockMovement(items || {}, coa || {}, movementLines) : { ledgerUpdates: {} };
  // Sales: the goods leave at today's WAC, and the COGS line is built from
  // that same value (buildGlLines), so the entry balances.
  const glLines = await buildGlLines(cfg, existing, movementLines, party, null, coa || {}, items || {}, true);

  const now = new Date().toISOString();
  const actor = user.profile.username || user.uid;
  const newId = cfg.idPrefix + randomUUID().split('-')[0].toUpperCase();
  const attemptId = randomUUID();
  const reversal = {
    TransactionType: cfg.kind, Status: 'Committing', CommitAttemptID: attemptId, CommitAttemptStartedAt: now,
    TransactionDate: date, Description: 'Reversal of ' + existing.TransactionNumber + ' — ' + existing.Description,
    Reference: existing.TransactionNumber, CompanyID: existing.CompanyID, DivisionID: existing.DivisionID || '', BranchID: existing.BranchID || '',
    CostCenterID: existing.CostCenterID || '', ProfitCenterID: existing.ProfitCenterID || '',
    [cfg.partyField]: existing[cfg.partyField], SourceInvoiceID: existing.SourceInvoiceID, SourceInvoiceNumber: existing.SourceInvoiceNumber,
    Lines: movementLines, ValueLines: existing.ValueLines || [], GoodsValue: existing.GoodsValue, ValueTotal: existing.ValueTotal,
    Discount: existing.Discount, TaxPercent: existing.TaxPercent, TaxAmount: existing.TaxAmount, Total: existing.Total,
    CreatedAt: now, CreatedBy: actor, UpdatedAt: now, UpdatedBy: actor, ReversalOfReturnID: returnId, ReversedByReturnID: ''
  };
  await rtdb.ref('stock/transactions/' + newId).set(reversal);
  let glResult;
  try {
    glResult = await writeStockGlEntry(user, cfg.kind, date, reversal.Description, existing.TransactionNumber, glLines,
      { CompanyID: existing.CompanyID, DivisionID: existing.DivisionID, BranchID: existing.BranchID, CostCenterID: existing.CostCenterID, ProfitCenterID: existing.ProfitCenterID },
      { CommitAttemptID: attemptId, SourceTransactionID: newId, ReversalOfJV: existing.LinkedJVID, PartyKeys: glEntry.PartyKeys || [], AllocatedRefs: [], AllocatedRefTypes: [] });
  } catch (err) {
    await rtdb.ref('stock/transactions/' + newId).set(null);
    throw err;
  }
  await commitStockLedgerUpdates(movement.ledgerUpdates);
  // The original GL entry stops being live, which releases its settlement.
  await firestore.collection(FIRESTORE_JOURNAL_ENTRIES_COLLECTION).doc(existing.LinkedJVID).update({ ReversedByJV: glResult.jvId });
  await rtdb.ref('stock/transactions/' + returnId).update({
    Status: 'Posted', ReversalApprovalInstanceID: '', PendingReversalDate: '', ReversedByReturnID: newId, UpdatedAt: now, UpdatedBy: actor
  });
  await finalizeCommitAttempt(newId, glResult, { Lines: movementLines }, actor);
  return { returnId: newId, number: glResult.jvNumber };
}

function createCallables(cfg) {
  const noun = cfg.label;
  const load = async (id) => {
    const t = await val('stock/transactions/' + id);
    if (!t || t.TransactionType !== cfg.kind) throw new HttpsError('not-found', noun + ' not found.');
    return t;
  };
  const scopeFor = (t) => resolveApprovalScopeKeyForDocument(cfg.moduleId, {
    CompanyID: t.CompanyID, DivisionID: t.DivisionID, BranchID: t.BranchID, CostCenterID: t.CostCenterID
  });
  const api = {};

  api.entries = onCallWithMessages(onCallOptions, async (request) => {
    const user = await requireUser(request);
    await requireCapability(cfg.moduleId, 'access', user.profile.role, 'view entries');
    const data = (await val('stock/transactions')) || {};
    const all = Object.keys(data).map(id => Object.assign({ ReturnID: id }, data[id]))
      .filter(t => t.TransactionType === cfg.kind && userCanAccessCompany(user.profile, t.CompanyID))
      .sort((a, b) => (b.CreatedAt || '').localeCompare(a.CreatedAt || ''));
    const limit = request.data && request.data.limit;
    return { entries: limit === 'all' ? all : all.slice(0, 100), total: all.length };
  });

  // Posted invoices of one party and company that can still be returned against.
  api.invoices = onCallWithMessages(onCallOptions, async (request) => {
    const user = await requireUser(request);
    await requireCapability(cfg.moduleId, 'access', user.profile.role, 'view entries');
    const companyId = String(request.data && request.data.companyId || '').trim();
    const partyId = String(request.data && request.data.partyId || '').trim();
    if (!companyId || !partyId) return [];
    if (!userCanAccessCompany(user.profile, companyId)) throw new HttpsError('permission-denied', 'You do not have access to that company.');
    const data = (await val(cfg.invoicePath)) || {};
    return Object.keys(data).map(id => Object.assign({ InvoiceID: id }, data[id]))
      .filter(i => i.CompanyID === companyId && i[cfg.partyField] === partyId && i.Status === 'Posted' && !i.ReversedByInvoiceID && !i.ReversalOfInvoiceID)
      .sort((a, b) => (b.InvoiceDate || '').localeCompare(a.InvoiceDate || ''))
      .map(i => ({ InvoiceID: i.InvoiceID, Number: i.TransactionNumber || '', InvoiceDate: i.InvoiceDate || '', Total: i.Total, Description: i.Description || '' }));
  });

  // The chosen invoice's returnable lines and terms, for the screen.
  api.source = onCallWithMessages(onCallOptions, async (request) => {
    const user = await requireUser(request);
    await requireCapability(cfg.moduleId, 'access', user.profile.role, 'view entries');
    const invoiceId = String(request.data && request.data.invoiceId || '').trim();
    const invoice = await val(cfg.invoicePath + '/' + invoiceId);
    assertInvoiceOpen(cfg, invoice);
    if (!userCanAccessCompany(user.profile, invoice.CompanyID)) throw new HttpsError('permission-denied', 'You do not have access to that company.');
    const source = await loadReturnSource(cfg, invoiceId, invoice, String(request.data && request.data.excludeReturnId || ''));
    return {
      InvoiceID: invoiceId, Number: invoice.TransactionNumber || '', InvoiceDate: invoice.InvoiceDate || '', PartyID: invoice[cfg.partyField],
      Subtotal: invoice.Subtotal, Discount: invoice.Discount || 0, TaxPercent: invoice.TaxPercent || 0, Total: invoice.Total,
      PriorNotesTotal: source.priorNotesTotal, Lines: source.lines
    };
  });

  api.save = onCallWithMessages(onCallOptions, async (request) => {
    const user = await requireUser(request);
    await requireCapability(cfg.moduleId, 'draft', user.profile.role, 'create or edit entries');
    const d = request.data || {};
    const returnId = String(d.ReturnID || '').trim();
    const transactionDate = String(d.TransactionDate || '').trim();
    if (!transactionDate) throw bad('Date is required.');
    const description = String(d.Description || '').trim();
    if (!description) throw bad('Description is required.');
    const companyId = String(d.CompanyID || '').trim();
    if (!companyId) throw bad('Select a Company for this note.');
    if (!userCanAccessCompany(user.profile, companyId)) throw new HttpsError('permission-denied', 'You do not have access to that company.');
    const costCenterId = String(d.CostCenterID || '').trim();
    if (!costCenterId) throw bad('Select a Cost Center for this note.');
    if (returnId) {
      const existing = await load(returnId);
      if (existing.Status !== 'Draft' && existing.Status !== 'Rejected') throw bad('Only draft or rejected notes can be edited.');
      if (!userCanAccessCompany(user.profile, existing.CompanyID)) throw new HttpsError('permission-denied', 'You do not have access to that company.');
    }
    const header = {
      TransactionType: cfg.kind, TransactionDate: transactionDate, Description: description,
      Reference: String(d.Reference || '').trim(), CompanyID: companyId,
      DivisionID: String(d.DivisionID || '').trim(), BranchID: String(d.BranchID || '').trim(),
      CostCenterID: costCenterId, ProfitCenterID: String(d.ProfitCenterID || '').trim()
    };
    const built = await buildReturn(cfg, Object.assign({}, d, header), returnId);
    const now = new Date().toISOString();
    const actor = user.profile.username || user.uid;
    const fields = Object.assign({}, header, built.doc, { Status: 'Draft', UpdatedAt: now, UpdatedBy: actor });
    if (returnId) {
      await rtdb.ref('stock/transactions/' + returnId).update(fields);
      return { success: true, returnId: returnId, total: built.doc.Total };
    }
    const newId = cfg.idPrefix + randomUUID().split('-')[0].toUpperCase();
    await rtdb.ref('stock/transactions/' + newId).set(Object.assign(fields, { CreatedAt: now, CreatedBy: actor }));
    return { success: true, returnId: newId, total: built.doc.Total };
  });

  api.post = onCallWithMessages(onCallOptions, async (request) => {
    const user = await requireUser(request);
    const returnId = String(request.data && request.data.returnId || '').trim();
    return withGlobalLock(user.uid, async () => {
      const existing = await load(returnId);
      if (!userCanAccessCompany(user.profile, existing.CompanyID)) throw new HttpsError('permission-denied', 'You do not have access to that company.');
      await requireCapability(cfg.moduleId, 'post', user.profile.role, 'post or reverse entries');
      if (existing.Status !== 'Draft' && existing.Status !== 'Rejected') throw bad('Only draft or rejected notes can be posted.');
      // Validate now so a gated note isn't sent for approval in a state it can't post in.
      const built = await buildReturn(cfg, existing, returnId);
      const now = new Date().toISOString();
      const actor = user.profile.username || user.uid;
      const approval = await beginApprovalInstance(cfg.moduleId, returnId, '', await scopeFor(existing), built.doc.Total, user.uid);
      if (approval.required) {
        await rtdb.ref('stock/transactions/' + returnId).update({
          Status: 'PendingApproval', ApprovalInstanceID: approval.instanceId, RejectionReason: '',
          SubmittedAt: now, SubmittedBy: actor, UpdatedAt: now, UpdatedBy: actor
        });
        return { success: true, status: 'PendingApproval' };
      }
      const result = await commitReturn(cfg, user, existing, returnId);
      return { success: true, returnId, number: result.number, settled: result.settled, status: 'Posted' };
    });
  });

  // An Approve is checked against the invoice as it stands first, so an
  // approval can't be recorded for a note that can no longer post. If the
  // final commit still fails, the note goes back to Rejected with the
  // reason, as Vendor/Customer Invoice do.
  api.decide = onCallWithMessages(onCallOptions, async (request) => {
    const user = await requireUser(request);
    await requireCapability(cfg.moduleId, 'post', user.profile.role, 'post or reverse entries');
    const d = request.data || {};
    const returnId = String(d.returnId || '').trim();
    return withGlobalLock(user.uid, async () => {
      const existing = await load(returnId);
      if (!userCanAccessCompany(user.profile, existing.CompanyID)) throw new HttpsError('permission-denied', 'You do not have access to that company.');
      if (existing.Status !== 'PendingApproval') throw bad('This note is not awaiting approval.');
      if (d.decision === 'Approved') await buildReturn(cfg, existing, returnId);
      const result = await recordApprovalDecision(user, existing.ApprovalInstanceID, d.levelNumber, d.decision, d.reason);
      const now = new Date().toISOString();
      const actor = user.profile.username || user.uid;
      if (result.status === 'Approved') {
        try {
          await commitReturn(cfg, user, existing, returnId);
        } catch (err) {
          await rtdb.ref('stock/transactions/' + returnId).update({ Status: 'Rejected', RejectionReason: 'Could not post after approval: ' + err.message, UpdatedAt: now, UpdatedBy: actor });
          throw err;
        }
      } else if (result.status === 'Rejected') {
        await rtdb.ref('stock/transactions/' + returnId).update({ Status: 'Rejected', RejectionReason: String(d.reason || '').trim(), UpdatedAt: now, UpdatedBy: actor });
      }
      return { success: true, status: result.status, selfApproved: result.selfApproved };
    });
  });

  api.remove = onCallWithMessages(onCallOptions, async (request) => {
    const user = await requireUser(request);
    const returnId = String(request.data && request.data.returnId || '').trim();
    const existing = await load(returnId);
    if (!userCanAccessCompany(user.profile, existing.CompanyID)) throw new HttpsError('permission-denied', 'You do not have access to that company.');
    await requireCapability(cfg.moduleId, 'draft', user.profile.role, 'create or edit entries');
    if (existing.Status !== 'Draft') throw bad('Only draft notes can be deleted. Posted notes must be reversed instead.');
    await rtdb.ref('stock/transactions/' + returnId).set(null);
    return { success: true };
  });

  // Reversal takes the same approval as posting when a gate is configured,
  // like the invoices.
  api.requestReverse = onCallWithMessages(onCallOptions, async (request) => {
    const user = await requireUser(request);
    const returnId = String(request.data && request.data.returnId || '').trim();
    return withGlobalLock(user.uid, async () => {
      const existing = await load(returnId);
      if (!userCanAccessCompany(user.profile, existing.CompanyID)) throw new HttpsError('permission-denied', 'You do not have access to that company.');
      await requireCapability(cfg.moduleId, 'post', user.profile.role, 'post or reverse entries');
      if (existing.Status !== 'Posted') throw bad('Only posted notes can be reversed.');
      if (existing.ReversedByReturnID) throw bad('This note has already been reversed.');
      if (existing.ReversalOfReturnID) throw bad('A reversal entry cannot itself be reversed.');
      const date = String(request.data && request.data.reversalDate || '').trim() || new Date().toISOString().substring(0, 10);
      const approval = await beginApprovalInstance(cfg.moduleId, returnId, (existing.TransactionNumber || '') + ' (Reversal)', await scopeFor(existing), existing.Total, user.uid);
      if (approval.required) {
        const now = new Date().toISOString();
        await rtdb.ref('stock/transactions/' + returnId).update({
          Status: 'PendingReversalApproval', ReversalApprovalInstanceID: approval.instanceId, PendingReversalDate: date,
          UpdatedAt: now, UpdatedBy: user.profile.username || user.uid
        });
        return { success: true, status: 'PendingReversalApproval' };
      }
      const result = await executeReversal(cfg, user, existing, returnId, date);
      return { success: true, returnId: result.returnId, number: result.number, status: 'Posted' };
    });
  });

  api.decideReverse = onCallWithMessages(onCallOptions, async (request) => {
    const user = await requireUser(request);
    await requireCapability(cfg.moduleId, 'post', user.profile.role, 'post or reverse entries');
    const d = request.data || {};
    const returnId = String(d.returnId || '').trim();
    return withGlobalLock(user.uid, async () => {
      const existing = await load(returnId);
      if (!userCanAccessCompany(user.profile, existing.CompanyID)) throw new HttpsError('permission-denied', 'You do not have access to that company.');
      if (existing.Status !== 'PendingReversalApproval') throw bad('This note has no reversal awaiting approval.');
      if (d.decision === 'Approved') {
        const gl = (await firestore.collection(FIRESTORE_JOURNAL_ENTRIES_COLLECTION).doc(existing.LinkedJVID).get()).data() || {};
        await assertEntryReversible(existing.LinkedJVID, gl);
      }
      const result = await recordApprovalDecision(user, existing.ReversalApprovalInstanceID, d.levelNumber, d.decision, d.reason);
      if (result.status === 'Approved') {
        await executeReversal(cfg, user, existing, returnId, existing.PendingReversalDate || new Date().toISOString().substring(0, 10));
      } else if (result.status === 'Rejected') {
        const now = new Date().toISOString();
        await rtdb.ref('stock/transactions/' + returnId).update({
          Status: 'Posted', ReversalApprovalInstanceID: '', PendingReversalDate: '', UpdatedAt: now, UpdatedBy: user.profile.username || user.uid
        });
      }
      return { success: true, status: result.status, selfApproved: result.selfApproved };
    });
  });

  return api;
}

const P = createCallables(KINDS.PurchaseReturn);
const S = createCallables(KINDS.SalesReturn);

exports.getPurchaseReturnEntries = P.entries;
exports.getVendorInvoicesForReturn = P.invoices;
exports.getPurchaseReturnSource = P.source;
exports.savePurchaseReturnDraft = P.save;
exports.postPurchaseReturn = P.post;
exports.decidePurchaseReturnApproval = P.decide;
exports.deletePurchaseReturnDraft = P.remove;
exports.requestReversePurchaseReturn = P.requestReverse;
exports.decidePurchaseReturnReversalApproval = P.decideReverse;

exports.getSalesReturnEntries = S.entries;
exports.getCustomerInvoicesForReturn = S.invoices;
exports.getSalesReturnSource = S.source;
exports.saveSalesReturnDraft = S.save;
exports.postSalesReturn = S.post;
exports.decideSalesReturnApproval = S.decide;
exports.deleteSalesReturnDraft = S.remove;
exports.requestReverseSalesReturn = S.requestReverse;
exports.decideSalesReturnReversalApproval = S.decideReverse;

// The company's Sales Returns account (owner decision 8): shown and
// edited on the Sales Return screen, stored on the company record. Editing
// takes Company Master Data write access.
exports.getSalesReturnSettings = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  await requireCapability('SALESRETURN', 'access', user.profile.role, 'view entries');
  const companyId = String(request.data && request.data.companyId || '').trim();
  if (!companyId) return { SalesReturnsAccountID: '', canEdit: false };
  if (!userCanAccessCompany(user.profile, companyId)) throw new HttpsError('permission-denied', 'You do not have access to that company.');
  const company = (await val('companies/' + companyId)) || {};
  return { SalesReturnsAccountID: company.SalesReturnsAccountID || '', canEdit: await moduleHasCapability('COMPANYMASTER', 'write', user.profile.role) };
});

exports.setSalesReturnsAccount = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  await requireCapability('COMPANYMASTER', 'write', user.profile.role, 'change company settings');
  const companyId = String(request.data && request.data.companyId || '').trim();
  const accountId = String(request.data && request.data.accountId || '').trim();
  if (!companyId || !(await val('companies/' + companyId))) throw bad('Company not found.');
  if (!userCanAccessCompany(user.profile, companyId)) throw new HttpsError('permission-denied', 'You do not have access to that company.');
  const account = await val('coa/' + accountId);
  if (!account || account.Status !== 'Active' || account.IsPostable !== true) throw bad('Sales Returns account must be an active, postable account.');
  if (account.AccountType !== 'Revenue') throw bad('Sales Returns account must be a Revenue-type account (e.g. 410000 Sales Returns & Discounts).');
  if (account.CompanyID && account.CompanyID !== companyId) throw bad('That account is restricted to a different company.');
  await rtdb.ref('companies/' + companyId).update({ SalesReturnsAccountID: accountId });
  return { success: true };
});

// For the invoice reversal guard (invoiceAllocations.js).
async function hasLiveReturns(invoiceType, invoiceId) {
  const cfg = Object.values(KINDS).find(k => k.invoiceType === invoiceType);
  const data = (await val('stock/transactions')) || {};
  return Object.values(data).some(t => t.SourceInvoiceID === invoiceId && isLiveReturn(t, cfg));
}
exports.hasLiveReturns = hasLiveReturns;
