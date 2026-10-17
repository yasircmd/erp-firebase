// Sales Return / Credit Note (roadmap #2, docs/modules/SALES_RETURN.md).
// New development, hand-written; the mirror image of purchaseReturn.js.
//
// A return is raised against one posted, live Customer Invoice and takes
// back part or all of the quantity on the invoice's Delivery Note lines.
// Stored in stock/transactions (TransactionType 'SalesReturn'), so the
// stock ledger, its rebuild and the stock reports read it like any other
// In movement. Posting writes one GL entry (prefix CRN):
//   Dr Sales Returns (Sales Type's)      goods at the DN price, one line per
//                                        Sales Returns account
//   Cr Discount Given                    the invoice discount's share
//   Dr Output Tax                        the invoice tax's share
//   Cr Trade Receivables                 Total, tagged with the customer
//   Dr Inventory / Cr Sales COGS         at the cost each DN line left at
// The receivables line settles its own invoice (Against, up to what's
// still outstanding); any remainder is a New Ref, an open credit for the
// customer that a later JV/CBT settles (a refund, or a later invoice).
const { randomUUID } = require('crypto');
const { HttpsError } = require('firebase-functions/v2/https');
const { onCallWithMessages } = require('./callable');
const { rtdb, firestore } = require('./firebaseAdmin');
const stockStore = require('./stockStore');
const { postStock, postedFields } = require('./stockPosting');
const { requireUser, moduleHasCapability } = require('./auth');
const { userCanAccessCompany, FIRESTORE_JOURNAL_ENTRIES_COLLECTION } = require('./glWriting');
const { computeStockMovement } = require('./stockMovement');
const { resolveApprovalScopeKeyForDocument, beginApprovalInstance, recordApprovalDecision } = require('./approvals');
const { withGlobalLock } = require('./lock');
const { getOpenItemsForParty, assertEntryReversible, annotateInvoiceOutstanding } = require('./partyLedger');

const onCallOptions = { region: 'us-central1' };
const MODULE_ID = 'SALESRETURN';
const TYPE = 'SalesReturn';

const round2 = n => Math.round(n * 100) / 100;
const round6 = n => Math.round(n * 1e6) / 1e6;

async function requireAccess(role) {
  if (!(await moduleHasCapability(MODULE_ID, 'access', role))) throw new HttpsError('permission-denied', 'You do not have access to Sales Return.');
}
async function requireDraftAccess(role) {
  if (!(await moduleHasCapability(MODULE_ID, 'draft', role))) throw new Error('You do not have permission to create or edit entries in ' + MODULE_ID + '.');
}
async function requirePostAccess(role) {
  if (!(await moduleHasCapability(MODULE_ID, 'post', role))) throw new Error('You do not have permission to post or reverse entries in ' + MODULE_ID + '.');
}

async function loadReturn(returnId) {
  const rec = (await stockStore.getTx(returnId));
  if (!rec || rec.TransactionType !== TYPE) throw new HttpsError('not-found', 'Sales Return not found.');
  return rec;
}

const dnLineNo = (line, idx) => Number(line.LineNo) || (idx + 1);
const dnLineKey = (dnId, lineNo) => dnId + '#' + lineNo;

// Same as the Delivery Note's own COGS account (resolveItemExpenseAccount_).
const salesCogsAccountId = item => item.SalesCogsAccountID || item.ConsumptionAccountID;

// A posted return that still counts ('Committing' too — its stock may
// already be in).
function isLiveReturn(t) {
  return t && t.TransactionType === TYPE && (t.Status === 'Posted' || t.Status === 'Committing') &&
    !t.ReversedByReturnID && !t.ReversalOfReturnID;
}

async function returnedQuantities(invoiceId, excludeId, txs) {
  const used = new Map();
  Object.keys(txs).forEach(id => {
    const t = txs[id];
    if (id === excludeId || !isLiveReturn(t) || t.SourceInvoiceID !== invoiceId) return;
    (t.Lines || []).forEach(l => {
      const key = dnLineKey(l.SourceDNID, l.SourceDNLineNo);
      used.set(key, round6((used.get(key) || 0) + (Number(l.Quantity) || 0)));
    });
  });
  return used;
}

// Refuses a Customer Invoice reversal while a live return exists against
// it (owner decision 8). Called from invoiceAllocations' reversal guard.
async function assertInvoiceHasNoLiveSalesReturns(invoiceId) {
  const txs = await stockStore.queryTx({ SourceInvoiceID: invoiceId, TransactionType: TYPE });
  const live = Object.keys(txs).map(id => txs[id]).filter(t => isLiveReturn(t) && t.SourceInvoiceID === invoiceId);
  if (live.length) {
    throw new Error('This invoice has Sales Returns posted against it (' + live.map(t => t.TransactionNumber || '').join(', ') + ') — reverse those first.');
  }
}

function assertInvoiceReturnable(inv, companyId, customerId) {
  if (!inv || inv.Status !== 'Posted' || inv.ReversedByInvoiceID || inv.ReversalOfInvoiceID) {
    throw new Error('The Customer Invoice is no longer a posted, unreversed invoice.');
  }
  if (inv.CompanyID !== companyId || inv.CustomerID !== customerId) throw new Error('The Customer Invoice belongs to a different company or customer.');
}

// The stock documents an invoice's return lines need: its Delivery Notes,
// by id, and the returns against it (stockStore.js).
async function invoiceDocs(invoiceId, inv) {
  const [dns, returns] = await Promise.all([
    stockStore.getTxs((inv.SourceDeliveryNotes || []).map(d => d.DeliveryNoteID)),
    stockStore.queryTx({ SourceInvoiceID: invoiceId, TransactionType: TYPE })
  ]);
  return Object.assign({}, dns, returns);
}

// Every item line on the invoice's Delivery Notes, with what's left to return.
async function invoiceDnLines(invoiceId, inv, excludeReturnId, allTx) {
  const txs = allTx || (await invoiceDocs(invoiceId, inv));
  const returned = await returnedQuantities(invoiceId, excludeReturnId, txs);
  const out = [];
  (inv.SourceDeliveryNotes || []).forEach(d => {
    const dn = txs[d.DeliveryNoteID];
    if (!dn) return;
    (dn.Lines || []).forEach((l, idx) => {
      const lineNo = dnLineNo(l, idx);
      const qty = Number(l.Quantity) || 0;
      const done = returned.get(dnLineKey(d.DeliveryNoteID, lineNo)) || 0;
      out.push({
        SourceDNID: d.DeliveryNoteID, SourceDNNumber: dn.TransactionNumber || d.DeliveryNoteNumber || '', SourceDNLineNo: lineNo,
        SalesTypeID: d.SalesTypeID || '',
        ItemID: l.ItemID, ItemCode: l.ItemCode || '', ItemName: l.ItemName || '', WarehouseID: l.WarehouseID,
        BatchNumber: l.BatchNumber || '', CostCenterID: l.CostCenterID || '', ProfitCenterID: l.ProfitCenterID || '',
        UnitPrice: Number(l.UnitPrice) || 0, UnitCost: Number(l.UnitCost) || 0,
        Quantity: qty, ReturnedQuantity: done, ReturnableQuantity: Math.max(0, round6(qty - done))
      });
    });
  });
  return out;
}

// The invoice's own formula (saveCustomerInvoiceDraft): discount on the
// subtotal, tax on the net of discount.
function computeValues(lines, inv) {
  const returnValue = round2(lines.reduce((s, l) => s + l.ReturnValue, 0));
  const subtotal = Number(inv.Subtotal) || 0;
  const discount = subtotal > 0 ? round2((Number(inv.Discount) || 0) * returnValue / subtotal) : 0;
  const tax = round2((returnValue - discount) * (Number(inv.TaxPercent) || 0) / 100);
  return {
    ReturnValue: returnValue, DiscountAmount: discount, TaxPercent: Number(inv.TaxPercent) || 0, TaxAmount: tax,
    Total: round2(returnValue - discount + tax), CostValue: round2(lines.reduce((s, l) => s + l.CostValue, 0))
  };
}

// Builds the stored lines from requested { SourceDNID, SourceDNLineNo,
// Quantity, WarehouseID } rows against what's returnable now. Used at save
// and again at commit (under the global lock — the authoritative check).
async function buildLines(rawLines, invoiceId, inv, excludeReturnId) {
  const [available, itemsSnap, uomsSnap, unitsSnap] = await Promise.all([
    invoiceDnLines(invoiceId, inv, excludeReturnId), rtdb.ref('items').get(), rtdb.ref('uoms').get(), rtdb.ref('orgUnits').get()
  ]);
  const items = itemsSnap.val() || {};
  const uoms = uomsSnap.val() || {};
  const units = unitsSnap.val() || {};
  const byKey = new Map(available.map(a => [dnLineKey(a.SourceDNID, a.SourceDNLineNo), a]));
  const seen = new Set();
  const lines = [];
  (rawLines || []).forEach((raw, idx) => {
    const qty = Number(raw.Quantity) || 0;
    if (!qty) return; // lines left at zero aren't being returned
    const n = 'Line ' + (idx + 1) + ': ';
    const key = dnLineKey(String(raw.SourceDNID || ''), Number(raw.SourceDNLineNo));
    const src = byKey.get(key);
    if (!src) throw new Error(n + 'that Delivery Note line is not on this invoice.');
    if (seen.has(key)) throw new Error(n + src.ItemCode + ' from ' + src.SourceDNNumber + ' is listed twice.');
    seen.add(key);
    if (qty < 0) throw new Error(n + 'quantity cannot be negative.');
    const item = items[src.ItemID];
    const uom = item && uoms[item.UOMID];
    if (uom && !uom.AllowDecimals && Math.abs(qty - Math.round(qty)) > 0.0001) {
      throw new Error(n + (uom.Code || 'this unit') + ' does not allow decimal quantities.');
    }
    if (qty > src.ReturnableQuantity + 0.000001) {
      throw new Error(n + src.ItemCode + ' from ' + src.SourceDNNumber + ': only ' + src.ReturnableQuantity + ' left to return (delivered ' +
        src.Quantity + ', already returned ' + src.ReturnedQuantity + ').');
    }
    const warehouseId = String(raw.WarehouseID || '').trim() || src.WarehouseID;
    const wh = units[warehouseId];
    if (!wh || wh.Type !== 'Warehouse') throw new Error(n + 'warehouse not found.');
    if (wh.CompanyID && wh.CompanyID !== inv.CompanyID) throw new Error(n + 'that warehouse belongs to a different company.');
    if (!(src.UnitCost > 0)) throw new Error(n + src.ItemCode + ' left ' + src.SourceDNNumber + ' at no recorded cost, so it cannot be returned into stock.');
    lines.push({
      LineNo: lines.length + 1,
      SourceDNID: src.SourceDNID, SourceDNNumber: src.SourceDNNumber, SourceDNLineNo: src.SourceDNLineNo, SalesTypeID: src.SalesTypeID,
      ItemID: src.ItemID, ItemCode: src.ItemCode || (item && item.ItemCode) || '', ItemName: src.ItemName || (item && item.ItemName) || '',
      WarehouseID: warehouseId, BatchNumber: src.BatchNumber, CostCenterID: src.CostCenterID, ProfitCenterID: src.ProfitCenterID,
      Quantity: round6(qty), UnitPrice: src.UnitPrice, ReturnValue: round2(qty * src.UnitPrice),
      UnitCost: src.UnitCost, CostValue: round2(qty * src.UnitCost),
      Description: String(raw.Description || '').trim() || ('Return ' + (src.ItemCode || '') + ' — ' + src.SourceDNNumber)
    });
  });
  if (!lines.length) throw new Error('Enter a quantity to return on at least one line.');
  return lines;
}

async function resolveCompanyAccount(companyId, field, label, coaData) {
  const company = ((await rtdb.ref('companies/' + companyId).get()).val()) || {};
  const id = company[field];
  if (!id) throw new Error('This company has no ' + label + ' configured. Set one in Company Master Data before posting this return.');
  const account = coaData[id];
  if (!account || !account.IsPostable) throw new Error('This company\'s ' + label + ' is no longer valid — check it in Company Master Data.');
  return account;
}

// The goods' debit, per Sales Returns account: each line goes to the
// account of the Sales Type it was invoiced under (its Delivery Note's on
// the invoice), because sales under different tax treatments are returned
// to different accounts.
function salesReturnsDebits(lines, salesTypes, coaData) {
  const byAccount = new Map();
  lines.forEach((l, idx) => {
    const st = salesTypes[l.SalesTypeID];
    if (!st) throw new Error('Line ' + (idx + 1) + ': its Sales Type on the invoice no longer exists.');
    if (!st.SalesReturnsAccountID) {
      throw new Error('Sales Type "' + (st.Name || l.SalesTypeID) + '" has no Sales Returns Account. Set one in Sales Invoice Configuration before posting this return.');
    }
    const account = coaData[st.SalesReturnsAccountID];
    if (!account || !account.IsPostable || account.Status !== 'Active') {
      throw new Error('Sales Type "' + (st.Name || l.SalesTypeID) + '": its Sales Returns Account is no longer valid. Check it in Sales Invoice Configuration.');
    }
    const d = byAccount.get(account.AccountCode) || { AccountCode: account.AccountCode, Amount: 0 };
    d.Amount = round2(d.Amount + l.ReturnValue);
    byAccount.set(account.AccountCode, d);
  });
  return [...byAccount.values()];
}

// COGS credit per returned line, at the value its stock came back in at.
function cogsLines(movementLines, itemsData, coaData, dims, reverse) {
  return movementLines.map((l, idx) => {
    const item = itemsData[l.ItemID];
    const account = item && coaData[salesCogsAccountId(item)];
    if (!account || !account.IsPostable) throw new Error('Line ' + (idx + 1) + ': Sales COGS account for ' + (item ? item.ItemCode : l.ItemID) + ' is not valid — check Item Master.');
    return {
      AccountCode: account.AccountCode, Debit: reverse ? l.TotalValue : 0, Credit: reverse ? 0 : l.TotalValue,
      Description: (reverse ? 'Reversal — ' : '') + l.Description,
      CostCenterID: l.CostCenterID || dims.CostCenterID, ProfitCenterID: l.ProfitCenterID || dims.ProfitCenterID
    };
  });
}

// ---------- callables ----------

exports.getReturnableCustomerInvoices = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  await requireAccess(user.profile.role);
  const d = request.data || {};
  const companyId = String(d.companyId || '').trim();
  const customerId = String(d.customerId || '').trim();
  const excludeReturnId = String(d.excludeReturnId || '').trim();
  if (!companyId || !customerId) return [];
  if (!userCanAccessCompany(user.profile, companyId)) throw new HttpsError('permission-denied', 'You do not have access to that company.');

  const invoices = (await rtdb.ref('customerInvoices').get()).val() || {};
  // The Delivery Notes of this customer's invoices, by id, and this
  // company's returns (stockStore.js), not every stock transaction.
  const dnIds = [];
  Object.values(invoices).forEach(inv => { if (inv && inv.CompanyID === companyId && inv.CustomerID === customerId) (inv.SourceDeliveryNotes || []).forEach(x => dnIds.push(x.DeliveryNoteID)); });
  const [dns, returns] = await Promise.all([stockStore.getTxs(dnIds), stockStore.queryTx({ TransactionType: TYPE, CompanyID: companyId })]);
  const txs = Object.assign({}, dns, returns);
  const out = [];
  for (const id of Object.keys(invoices)) {
    const inv = invoices[id];
    if (inv.CompanyID !== companyId || inv.CustomerID !== customerId) continue;
    if (inv.Status !== 'Posted' || inv.ReversedByInvoiceID || inv.ReversalOfInvoiceID || !(inv.SourceDeliveryNotes || []).length) continue;
    const lines = await invoiceDnLines(id, inv, excludeReturnId, txs);
    if (!lines.some(l => l.ReturnableQuantity > 0) && id !== d.includeInvoiceId) continue;
    out.push({
      CustomerInvoiceID: id, TransactionNumber: inv.TransactionNumber || '', InvoiceDate: inv.InvoiceDate || '',
      Description: inv.Description || '', Status: inv.Status,
      Subtotal: inv.Subtotal, Discount: inv.Discount || 0, TaxPercent: inv.TaxPercent || 0, Total: inv.Total, Lines: lines
    });
  }
  await annotateInvoiceOutstanding('CustomerInvoice', out);
  return out.sort((a, b) => (b.InvoiceDate + b.TransactionNumber).localeCompare(a.InvoiceDate + a.TransactionNumber));
});

exports.saveSalesReturnDraft = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  await requireDraftAccess(user.profile.role);
  const data = request.data || {};
  const returnId = String(data.ReturnID || '').trim();
  const transactionDate = String(data.TransactionDate || '').trim();
  if (!transactionDate) throw new HttpsError('invalid-argument', 'Return date is required.');
  const description = String(data.Description || '').trim();
  if (!description) throw new HttpsError('invalid-argument', 'Description is required.');
  const companyId = String(data.CompanyID || '').trim();
  if (!companyId) throw new HttpsError('invalid-argument', 'Select a Company for this return.');
  if (!userCanAccessCompany(user.profile, companyId)) throw new HttpsError('permission-denied', 'You do not have access to that company.');
  const customerId = String(data.CustomerID || '').trim();
  if (!customerId) throw new HttpsError('invalid-argument', 'Select a Customer for this return.');
  const invoiceId = String(data.SourceInvoiceID || '').trim();
  if (!invoiceId) throw new HttpsError('invalid-argument', 'Select the Customer Invoice the goods are being returned against.');

  const inv = (await rtdb.ref('customerInvoices/' + invoiceId).get()).val();
  assertInvoiceReturnable(inv, companyId, customerId);
  if (returnId) {
    const existing = await loadReturn(returnId);
    if (!userCanAccessCompany(user.profile, existing.CompanyID)) throw new HttpsError('permission-denied', 'You do not have access to that company.');
    if (existing.Status !== 'Draft' && existing.Status !== 'Rejected') throw new HttpsError('failed-precondition', 'Only draft or rejected returns can be edited.');
  }
  const lines = await buildLines(data.Lines, invoiceId, inv, returnId);

  const now = new Date().toISOString();
  const actor = user.profile.username || user.uid;
  // Dimensions come from the invoice: the return undoes part of it.
  const fields = Object.assign({
    TransactionType: TYPE, TransactionDate: transactionDate, Description: description,
    Reference: String(data.Reference || '').trim(),
    CompanyID: companyId, DivisionID: inv.DivisionID || '', BranchID: inv.BranchID || '',
    CostCenterID: inv.CostCenterID || '', ProfitCenterID: inv.ProfitCenterID || '',
    CustomerID: customerId, SourceInvoiceID: invoiceId, SourceInvoiceNumber: inv.TransactionNumber || '',
    Lines: lines, Status: 'Draft', UpdatedAt: now, UpdatedBy: actor
  }, computeValues(lines, inv));

  if (returnId) {
    await stockStore.updateTx(returnId, fields);
    return { success: true, returnId: returnId };
  }
  const newId = 'SRTD-' + randomUUID().split('-')[0].toUpperCase();
  await stockStore.setTx(newId, Object.assign({}, fields, { CreatedAt: now, CreatedBy: actor }));
  return { success: true, returnId: newId };
});

exports.postSalesReturn = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  const returnId = String(request.data && request.data.returnId || '').trim();

  return withGlobalLock(user.uid, async () => {
    const existing = await loadReturn(returnId);
    if (!userCanAccessCompany(user.profile, existing.CompanyID)) throw new HttpsError('permission-denied', 'You do not have access to that company.');
    await requirePostAccess(user.profile.role);
    if (existing.Status !== 'Draft' && existing.Status !== 'Rejected') throw new HttpsError('failed-precondition', 'Only draft or rejected returns can be posted.');

    const inv = (await rtdb.ref('customerInvoices/' + existing.SourceInvoiceID).get()).val();
    assertInvoiceReturnable(inv, existing.CompanyID, existing.CustomerID);
    const lines = await buildLines(existing.Lines, existing.SourceInvoiceID, inv, returnId);
    const values = computeValues(lines, inv);

    const now = new Date().toISOString();
    const actor = user.profile.username || user.uid;
    const scopeKey = await resolveApprovalScopeKeyForDocument(MODULE_ID, {
      CompanyID: existing.CompanyID, DivisionID: existing.DivisionID, BranchID: existing.BranchID, CostCenterID: existing.CostCenterID
    });
    const approval = await beginApprovalInstance(MODULE_ID, returnId, '', scopeKey, values.Total, user.uid);
    if (approval.required) {
      await stockStore.updateTx(returnId, Object.assign({
        Lines: lines, Status: 'PendingApproval', ApprovalInstanceID: approval.instanceId,
        RejectionReason: '', SubmittedAt: now, SubmittedBy: actor, UpdatedAt: now, UpdatedBy: actor
      }, values));
      return { success: true, status: 'PendingApproval' };
    }

    const result = await commitSalesReturnPosting(user, existing, returnId);
    return { success: true, returnId: returnId, returnNumber: result.returnNumber, status: 'Posted' };
  });
});

// Caller holds the global lock. Everything is re-checked from live data.
async function commitSalesReturnPosting(user, existing, returnId) {
  const inv = (await rtdb.ref('customerInvoices/' + existing.SourceInvoiceID).get()).val();
  assertInvoiceReturnable(inv, existing.CompanyID, existing.CustomerID);
  const lines = await buildLines(existing.Lines, existing.SourceInvoiceID, inv, returnId);
  const values = computeValues(lines, inv);

  const [itemsSnap, coaSnap, customerSnap, salesTypesSnap] = await Promise.all([
    rtdb.ref('items').get(), rtdb.ref('coa').get(), rtdb.ref('customers/' + existing.CustomerID).get(), rtdb.ref('salesTypes').get()
  ]);
  const itemsData = itemsSnap.val() || {};
  const coaData = coaSnap.val() || {};
  const customer = customerSnap.val();
  if (!customer || !customer.TradeReceivablesAccountID) throw new Error('This Customer has no Trade Receivables Account configured. Set one in Customer Master Data before posting.');
  const arAccount = coaData[customer.TradeReceivablesAccountID];
  if (!arAccount || !arAccount.IsPostable) throw new Error('This Customer\'s Trade Receivables Account is no longer valid.');
  const returnsDebits = salesReturnsDebits(lines, salesTypesSnap.val() || {}, coaData);

  // In at the cost each line left at (the DN line's UnitCost).
  const movementLines = lines.map(l => Object.assign({ Direction: 'In' }, l));
  const movement = await computeStockMovement(itemsData, coaData, movementLines);

  const dims = { CostCenterID: existing.CostCenterID || '', ProfitCenterID: existing.ProfitCenterID || '' };
  const label = 'Sales return — ' + existing.Description;

  const items = await getOpenItemsForParty('Customer', existing.CustomerID, customer);
  const invoiceRef = 'CustomerInvoice:' + existing.SourceInvoiceID;
  const openItem = items.get(invoiceRef);
  const against = round2(Math.min(values.Total, Math.max(0, openItem ? openItem.Outstanding : 0)));
  const allocations = [];
  if (against > 0) allocations.push({ RefType: 'Against', RefID: invoiceRef, Amount: against, RefNumber: inv.TransactionNumber || '' });
  if (values.Total - against > 0.005) allocations.push({ RefType: 'New', RefID: '', Amount: round2(values.Total - against) });

  const glLines = [
    ...returnsDebits.map(d => Object.assign({ AccountCode: d.AccountCode, Debit: d.Amount, Credit: 0, Description: label }, dims)),
    Object.assign({
      AccountCode: arAccount.AccountCode, Debit: 0, Credit: values.Total, Description: label,
      PartyType: 'Customer', PartyID: existing.CustomerID, PartyName: customer.CustomerName || customer.CustomerCode || '', Allocations: allocations
    }, dims)
  ];
  if (values.DiscountAmount > 0) {
    const acc = await resolveCompanyAccount(existing.CompanyID, 'DiscountGivenAccountID', 'Discount Given Account', coaData);
    glLines.push(Object.assign({ AccountCode: acc.AccountCode, Debit: 0, Credit: values.DiscountAmount, Description: 'Discount given reversed — ' + existing.Description }, dims));
  }
  if (values.TaxAmount > 0) {
    const acc = await resolveCompanyAccount(existing.CompanyID, 'OutputTaxAccountID', 'Output Tax Account', coaData);
    glLines.push(Object.assign({ AccountCode: acc.AccountCode, Debit: values.TaxAmount, Credit: 0, Description: 'Output tax reversed — ' + existing.Description }, dims));
  }
  // In the invoice's currency and at its rate (docs/modules/MULTI_CURRENCY.md); the stock lines are in base already.
  const priced = require('./fx').documentBaseLines(glLines, inv).slice(); // the same array when in base
  glLines.length = 0;
  glLines.push(...priced, ...movement.inventoryGlLines, ...cogsLines(movementLines, itemsData, coaData, dims, false));

  const actor = user.profile.username || user.uid;
  // The GL entry, the balances and the return in one batch: all or none
  // (stockPosting.js, TRANSACTIONS_FIRESTORE.md T1b).
  const glResult = await postStock(user, {
    type: TYPE, date: existing.TransactionDate, description: existing.Description, reference: existing.Reference || existing.SourceInvoiceNumber || '',
    lines: glLines,
    dimensions: { CompanyID: existing.CompanyID, DivisionID: existing.DivisionID, BranchID: existing.BranchID, CostCenterID: existing.CostCenterID, ProfitCenterID: existing.ProfitCenterID },
    extra: {
      CommitAttemptID: randomUUID(), SourceTransactionID: returnId, ReversalOfJV: '',
      PartyKeys: ['Customer:' + existing.CustomerID],
      AllocatedRefs: against > 0 ? [invoiceRef] : [], AllocatedRefTypes: against > 0 ? ['CustomerInvoice'] : []
    }
  }, movement.ledgerUpdates, (gl, now) => ({
    [returnId]: stockStore.applyUpdate(existing, Object.assign(postedFields(gl, actor, now), { Lines: movementLines, AllocatedToInvoice: against }, values))
  }));
  await require('./eInvoicing').recordEInvoice('CreditNote', returnId); // its e-invoice credit note, if the company e-invoices (E_INVOICING.md)
  return { returnNumber: glResult.jvNumber };
}

exports.decideSalesReturnApproval = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  await requirePostAccess(user.profile.role);
  const data = request.data || {};
  const returnId = String(data.returnId || '').trim();
  const levelNumber = data.levelNumber;
  const decision = data.decision;
  const reason = data.reason;

  return withGlobalLock(user.uid, async () => {
    const existing = await loadReturn(returnId);
    if (!userCanAccessCompany(user.profile, existing.CompanyID)) throw new HttpsError('permission-denied', 'You do not have access to that company.');
    if (existing.Status !== 'PendingApproval') throw new HttpsError('failed-precondition', 'This return is not awaiting approval.');
    if (!existing.ApprovalInstanceID) throw new HttpsError('failed-precondition', 'No approval record found for this return.');

    const result = await recordApprovalDecision(user, existing.ApprovalInstanceID, levelNumber, decision, reason);
    const now = new Date().toISOString();
    const actor = user.profile.username || user.uid;
    if (result.status === 'Approved') {
      try {
        const commit = await commitSalesReturnPosting(user, existing, returnId);
        return { success: true, status: 'Approved', returnNumber: commit.returnNumber, selfApproved: result.selfApproved };
      } catch (err) {
        // As Customer Invoice: undo the recorded decision and hand the
        // return back for editing rather than leave it stuck.
        const instance = (await rtdb.ref('approvalInstances/' + existing.ApprovalInstanceID).get()).val();
        if (instance) {
          await rtdb.ref('approvalInstances/' + existing.ApprovalInstanceID).update({
            Decisions: (instance.Decisions || []).filter(d => d.LevelNumber !== levelNumber), Status: 'Pending', UpdatedAt: now
          });
        }
        await stockStore.updateTx(returnId, {
          Status: 'Rejected', RejectionReason: 'Posting failed and could not be completed: ' + err.message + ' — please fix and resubmit.',
          UpdatedAt: now, UpdatedBy: actor
        });
        throw new Error('Posting failed: ' + err.message + ' The return has been returned to an editable state — fix the issue and resubmit.');
      }
    }
    if (result.status === 'Rejected') {
      await stockStore.updateTx(returnId, { Status: 'Rejected', RejectionReason: String(reason || '').trim(), UpdatedAt: now, UpdatedBy: actor });
    }
    return { success: true, status: result.status, selfApproved: result.selfApproved };
  });
});

exports.deleteSalesReturnDraft = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  const returnId = String(request.data && request.data.returnId || '').trim();
  const existing = await loadReturn(returnId);
  if (!userCanAccessCompany(user.profile, existing.CompanyID)) throw new HttpsError('permission-denied', 'You do not have access to that company.');
  await requireDraftAccess(user.profile.role);
  if (existing.Status !== 'Draft') throw new HttpsError('failed-precondition', 'Only draft returns can be deleted. Posted returns must be reversed instead.');
  await stockStore.deleteTx(returnId);
  return { success: true };
});

exports.getSalesReturnEntries = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  await requireAccess(user.profile.role);
  const data = await stockStore.queryTx({ TransactionType: TYPE });
  const all = Object.keys(data)
    .map(id => Object.assign({ ReturnID: id }, data[id]))
    .filter(e => e.TransactionType === TYPE && userCanAccessCompany(user.profile, e.CompanyID))
    .sort((a, b) => (b.CreatedAt || '').localeCompare(a.CreatedAt || ''));
  const limit = request.data && request.data.limit;
  return { entries: limit === 'all' ? all : all.slice(0, 100), total: all.length };
});

// Whole return only (owner decision 8). The goods go back Out of the
// warehouse they came into — at the CURRENT average cost, the only cost
// stock can leave at — so the stock side is booked afresh like a
// delivery (Dr Sales COGS / Cr Inventory at that value), while the
// revenue, discount, tax and receivables lines mirror the original
// exactly. Refused while the return's open credit (its New Ref) has been
// settled by a JV/CBT, and when the goods are no longer in stock.
exports.reverseSalesReturn = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  const data = request.data || {};
  const returnId = String(data.returnId || '').trim();

  return withGlobalLock(user.uid, async () => {
    const existing = await loadReturn(returnId);
    if (!userCanAccessCompany(user.profile, existing.CompanyID)) throw new HttpsError('permission-denied', 'You do not have access to that company.');
    await requirePostAccess(user.profile.role);
    if (existing.Status !== 'Posted') throw new HttpsError('failed-precondition', 'Only posted returns can be reversed.');
    if (existing.ReversedByReturnID) throw new HttpsError('failed-precondition', 'This return has already been reversed.');
    if (existing.ReversalOfReturnID) throw new HttpsError('failed-precondition', 'A reversal entry cannot itself be reversed.');

    const glRef = firestore.collection(FIRESTORE_JOURNAL_ENTRIES_COLLECTION).doc(existing.LinkedJVID);
    const glDoc = await glRef.get();
    if (!glDoc.exists) throw new Error('The GL entry of this return was not found.');
    const glEntry = glDoc.data();
    await assertEntryReversible(existing.LinkedJVID, Object.assign({}, glEntry, { ReversalOfJV: '' }));

    const date = String(data.reversalDate || '').trim() || new Date().toISOString().substring(0, 10);
    const [itemsSnap, coaSnap] = await Promise.all([rtdb.ref('items').get(), rtdb.ref('coa').get()]);
    const itemsData = itemsSnap.val() || {};
    const coaData = coaSnap.val() || {};
    const movementLines = existing.Lines.map(l => Object.assign({}, l, { Direction: 'Out' }));
    const movement = await computeStockMovement(itemsData, coaData, movementLines);

    // The non-stock lines of the original: everything but its inventory
    // and COGS lines, which are the last 2 × line-count lines it wrote.
    const nonStock = (glEntry.Lines || []).slice(0, (glEntry.Lines || []).length - 2 * existing.Lines.length);
    const dims = { CostCenterID: existing.CostCenterID || '', ProfitCenterID: existing.ProfitCenterID || '' };
    const glLines = nonStock.map(l => {
      const out = {
        AccountCode: l.AccountCode, Debit: l.Credit || 0, Credit: l.Debit || 0, Description: 'Reversal — ' + (l.Description || ''),
        CostCenterID: l.CostCenterID || '', ProfitCenterID: l.ProfitCenterID || '', ProjectID: l.ProjectID || ''
      };
      if (l.PartyType) Object.assign(out, { PartyType: l.PartyType, PartyID: l.PartyID, PartyName: l.PartyName || '', Allocations: [] });
    Object.assign(out, require('./fx').mirrorFc(l), l.FxAdjustment ? { FxAdjustment: true } : {}); // foreign amounts swap too (MULTI_CURRENCY.md)
      return out;
    }).concat(movement.inventoryGlLines, cogsLines(movementLines, itemsData, coaData, dims, true));

    const now = new Date().toISOString();
    const actor = user.profile.username || user.uid;
    const newId = 'SRTD-' + randomUUID().split('-')[0].toUpperCase();
    const attemptId = randomUUID();
    const reversalDescription = 'Reversal of ' + existing.TransactionNumber + ' — ' + existing.Description;
    const reversal = {
      TransactionType: TYPE, Status: 'Committing', CommitAttemptID: attemptId, CommitAttemptStartedAt: now,
      TransactionDate: date, Description: reversalDescription, Reference: existing.TransactionNumber,
      CompanyID: existing.CompanyID, DivisionID: existing.DivisionID || '', BranchID: existing.BranchID || '',
      CostCenterID: existing.CostCenterID || '', ProfitCenterID: existing.ProfitCenterID || '',
      CustomerID: existing.CustomerID, SourceInvoiceID: existing.SourceInvoiceID, SourceInvoiceNumber: existing.SourceInvoiceNumber || '',
      ReturnValue: existing.ReturnValue, DiscountAmount: existing.DiscountAmount, TaxPercent: existing.TaxPercent,
      TaxAmount: existing.TaxAmount, Total: existing.Total,
      Lines: movementLines, ReversalOfReturnID: returnId, ReversedByReturnID: '',
      CreatedAt: now, CreatedBy: actor, UpdatedAt: now, UpdatedBy: actor
    };

    // The GL entry, the balances, the reversal, the original and its GL
    // entry's mark in one batch: all or none (stockPosting.js, T1b).
    const glResult = await postStock(user, {
      type: TYPE, date, description: reversalDescription, reference: existing.TransactionNumber, lines: glLines,
      dimensions: { CompanyID: existing.CompanyID, DivisionID: existing.DivisionID, BranchID: existing.BranchID, CostCenterID: existing.CostCenterID, ProfitCenterID: existing.ProfitCenterID },
      extra: { CommitAttemptID: attemptId, SourceTransactionID: newId, ReversalOfJV: existing.LinkedJVID, PartyKeys: glEntry.PartyKeys || [], AllocatedRefs: [], AllocatedRefTypes: [] }
    }, movement.ledgerUpdates, (gl, posted) => ({
      [returnId]: stockStore.applyUpdate(existing, { ReversedByReturnID: newId, UpdatedAt: now, UpdatedBy: actor }),
      [newId]: stockStore.applyUpdate(reversal, Object.assign(postedFields(gl, actor, posted), { Lines: movementLines, CostValue: round2(movementLines.reduce((s, l) => s + l.TotalValue, 0)) }))
    }), (batch, gl) => batch.update(glRef, { ReversedByJV: gl.jvId, UpdatedAt: now, UpdatedBy: actor }));
    return { success: true, returnId: newId, returnNumber: glResult.jvNumber };
  });
});

exports.assertInvoiceHasNoLiveSalesReturns = assertInvoiceHasNoLiveSalesReturns;
