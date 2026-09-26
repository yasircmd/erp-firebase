// Purchase Return / Debit Note (roadmap #1, docs/modules/PURCHASE_RETURN.md).
// New development, hand-written on grn.js's model.
//
// A return is raised against one posted, live Vendor Invoice and sends
// back part or all of the quantity on the invoice's GRN lines. Stored in
// stock/transactions (TransactionType 'PurchaseReturn'), so the stock
// ledger, its rebuild and the stock reports read it like any other Out
// movement. Posting writes one GL entry (prefix DBN):
//   Dr Trade Payables (vendor's account)   Total, tagged with the vendor
//   Dr Discount Received                   the invoice discount's share
//   Cr Inventory                           current WAC value
//   Cr Input Tax                           the invoice tax's share
//   Dr/Cr Purchase Return Variance         invoice price − WAC value
// Values at the invoice price: ReturnValue = qty × the GRN line's unit
// cost (the invoice clears each GRN at exactly that), and the discount
// and tax follow the invoice's own formula (tax on the net of discount).
//
// The payables line settles its own invoice (Against, up to what's still
// outstanding on it); any remainder is a New Ref, an open debit item for
// the vendor that a later JV/CBT settles. partyLedger derives both from
// the GL entry like any JV line, so nothing else is stored.
const { randomUUID } = require('crypto');
const { HttpsError } = require('firebase-functions/v2/https');
const { onCallWithMessages } = require('./callable');
const { rtdb, firestore } = require('./firebaseAdmin');
const { requireUser, moduleHasCapability } = require('./auth');
const { userCanAccessCompany, writeStockGlEntry, FIRESTORE_JOURNAL_ENTRIES_COLLECTION } = require('./glWriting');
const { computeStockMovement, commitStockLedgerUpdates } = require('./stockMovement');
const { beginCommitAttempt, abandonCommitAttempt, finalizeCommitAttempt } = require('./commitAttempt');
const { resolveApprovalScopeKeyForDocument, beginApprovalInstance, recordApprovalDecision } = require('./approvals');
const { withGlobalLock } = require('./lock');
const { getOpenItemsForParty, assertEntryReversible, annotateInvoiceOutstanding } = require('./partyLedger');

const onCallOptions = { region: 'us-central1' };
const MODULE_ID = 'PURCHASERETURN';
const TYPE = 'PurchaseReturn';
const TX = 'stock/transactions/';

const round2 = n => Math.round(n * 100) / 100;
const round6 = n => Math.round(n * 1e6) / 1e6;
const fmt = n => round2(n).toFixed(2);

async function requireAccess(role) {
  if (!(await moduleHasCapability(MODULE_ID, 'access', role))) throw new HttpsError('permission-denied', 'You do not have access to Purchase Return.');
}
async function requireDraftAccess(role) {
  if (!(await moduleHasCapability(MODULE_ID, 'draft', role))) throw new Error('You do not have permission to create or edit entries in ' + MODULE_ID + '.');
}
async function requirePostAccess(role) {
  if (!(await moduleHasCapability(MODULE_ID, 'post', role))) throw new Error('You do not have permission to post or reverse entries in ' + MODULE_ID + '.');
}

async function loadReturn(returnId) {
  const rec = (await rtdb.ref(TX + returnId).get()).val();
  if (!rec || rec.TransactionType !== TYPE) throw new HttpsError('not-found', 'Purchase Return not found.');
  return rec;
}

// A GRN line's identity within its GRN. Every GRN saved through saveGrnDraft
// carries LineNo; the position is only a fallback for older records.
const grnLineNo = (line, idx) => Number(line.LineNo) || (idx + 1);
const grnLineKey = (grnId, lineNo) => grnId + '#' + lineNo;

// A posted return that still counts: not reversed, not itself a reversal.
// 'Committing' counts too — its stock may already be out.
function isLiveReturn(t) {
  return t && t.TransactionType === TYPE && (t.Status === 'Posted' || t.Status === 'Committing') &&
    !t.ReversedByReturnID && !t.ReversalOfReturnID;
}

// Quantity already returned per GRN line (key → qty) for one invoice,
// across live returns, leaving out excludeId (the return being posted).
async function returnedQuantities(invoiceId, excludeId, allTx) {
  const txs = allTx || (await rtdb.ref('stock/transactions').get()).val() || {};
  const used = new Map();
  Object.keys(txs).forEach(id => {
    const t = txs[id];
    if (id === excludeId || !isLiveReturn(t) || t.SourceInvoiceID !== invoiceId) return;
    (t.Lines || []).forEach(l => {
      const key = grnLineKey(l.SourceGRNID, l.SourceGRNLineNo);
      used.set(key, round6((used.get(key) || 0) + (Number(l.Quantity) || 0)));
    });
  });
  return used;
}

// Refuses a Vendor Invoice reversal while a live return exists against it
// (owner decision 9). Called from invoiceAllocations' reversal guard.
async function assertInvoiceHasNoLiveReturns(invoiceId) {
  const txs = (await rtdb.ref('stock/transactions').get()).val() || {};
  const live = Object.keys(txs).map(id => txs[id]).filter(t => isLiveReturn(t) && t.SourceInvoiceID === invoiceId);
  if (live.length) {
    throw new Error('This invoice has Purchase Returns posted against it (' + live.map(t => t.TransactionNumber || '').join(', ') + ') — reverse those first.');
  }
}

// The invoice must be a posted, live one of this company and vendor.
function assertInvoiceReturnable(inv, companyId, vendorId) {
  if (!inv || inv.Status !== 'Posted' || inv.ReversedByInvoiceID || inv.ReversalOfInvoiceID) {
    throw new Error('The Vendor Invoice is no longer a posted, unreversed invoice.');
  }
  if (inv.CompanyID !== companyId || inv.VendorID !== vendorId) throw new Error('The Vendor Invoice belongs to a different company or vendor.');
}

// Every item line on the invoice's GRNs, with what's left to return.
async function invoiceGrnLines(invoiceId, inv, excludeReturnId, allTx) {
  const txs = allTx || (await rtdb.ref('stock/transactions').get()).val() || {};
  const returned = await returnedQuantities(invoiceId, excludeReturnId, txs);
  const out = [];
  (inv.SourceGRNs || []).forEach(g => {
    const grn = txs[g.GRNID];
    if (!grn) return;
    (grn.Lines || []).forEach((l, idx) => {
      const lineNo = grnLineNo(l, idx);
      const qty = Number(l.Quantity) || 0;
      const done = returned.get(grnLineKey(g.GRNID, lineNo)) || 0;
      out.push({
        SourceGRNID: g.GRNID, SourceGRNNumber: grn.TransactionNumber || g.GRNNumber || '', SourceGRNLineNo: lineNo,
        ItemID: l.ItemID, ItemCode: l.ItemCode || '', ItemName: l.ItemName || '', WarehouseID: l.WarehouseID,
        BatchNumber: l.BatchNumber || '', UnitCost: Number(l.UnitCost) || 0,
        // The cost center the goods were received under: the GRN line's,
        // else the GRN's own.
        CostCenterID: l.CostCenterID || grn.CostCenterID || '', ProfitCenterID: l.ProfitCenterID || grn.ProfitCenterID || '',
        Quantity: qty, ReturnedQuantity: done, ReturnableQuantity: Math.max(0, round6(qty - done))
      });
    });
  });
  return out;
}

// The invoice's own formula (saveVendorInvoiceDraft): discount on the
// subtotal, tax on the net of discount. A return takes the discount in
// proportion to its value and recomputes tax on its own net.
function computeValues(lines, inv) {
  const returnValue = round2(lines.reduce((s, l) => s + l.ReturnValue, 0));
  const subtotal = Number(inv.Subtotal) || 0;
  const discount = subtotal > 0 ? round2((Number(inv.Discount) || 0) * returnValue / subtotal) : 0;
  const tax = round2((returnValue - discount) * (Number(inv.TaxPercent) || 0) / 100);
  return { ReturnValue: returnValue, DiscountAmount: discount, TaxPercent: Number(inv.TaxPercent) || 0, TaxAmount: tax, Total: round2(returnValue - discount + tax) };
}

// Builds the stored lines from requested { SourceGRNID, SourceGRNLineNo,
// Quantity } rows against what's returnable now. Used at save and again
// at commit (under the global lock — the authoritative check).
async function buildLines(rawLines, invoiceId, inv, excludeReturnId) {
  const [available, itemsSnap, uomsSnap] = await Promise.all([
    invoiceGrnLines(invoiceId, inv, excludeReturnId), rtdb.ref('items').get(), rtdb.ref('uoms').get()
  ]);
  const items = itemsSnap.val() || {};
  const uoms = uomsSnap.val() || {};
  const byKey = new Map(available.map(a => [grnLineKey(a.SourceGRNID, a.SourceGRNLineNo), a]));
  const seen = new Set();
  const lines = [];
  (rawLines || []).forEach((raw, idx) => {
    const qty = Number(raw.Quantity) || 0;
    if (!qty) return; // lines left at zero aren't being returned
    const n = 'Line ' + (idx + 1) + ': ';
    const key = grnLineKey(String(raw.SourceGRNID || ''), Number(raw.SourceGRNLineNo));
    const src = byKey.get(key);
    if (!src) throw new Error(n + 'that GRN line is not on this invoice.');
    if (seen.has(key)) throw new Error(n + src.ItemCode + ' from ' + src.SourceGRNNumber + ' is listed twice.');
    seen.add(key);
    if (qty < 0) throw new Error(n + 'quantity cannot be negative.');
    const item = items[src.ItemID];
    const uom = item && uoms[item.UOMID];
    if (uom && !uom.AllowDecimals && Math.abs(qty - Math.round(qty)) > 0.0001) {
      throw new Error(n + (uom.Code || 'this unit') + ' does not allow decimal quantities.');
    }
    if (qty > src.ReturnableQuantity + 0.000001) {
      throw new Error(n + src.ItemCode + ' from ' + src.SourceGRNNumber + ': only ' + src.ReturnableQuantity + ' left to return (received ' +
        src.Quantity + ', already returned ' + src.ReturnedQuantity + ').');
    }
    lines.push({
      LineNo: lines.length + 1,
      SourceGRNID: src.SourceGRNID, SourceGRNNumber: src.SourceGRNNumber, SourceGRNLineNo: src.SourceGRNLineNo,
      ItemID: src.ItemID, ItemCode: src.ItemCode || (item && item.ItemCode) || '', ItemName: src.ItemName || (item && item.ItemName) || '',
      WarehouseID: src.WarehouseID, BatchNumber: src.BatchNumber,
      CostCenterID: src.CostCenterID || inv.CostCenterID || '', ProfitCenterID: src.ProfitCenterID || inv.ProfitCenterID || '',
      Quantity: round6(qty), InvoiceUnitCost: src.UnitCost, ReturnValue: round2(qty * src.UnitCost),
      Description: String(raw.Description || '').trim() || ('Return ' + (src.ItemCode || '') + ' — ' + src.SourceGRNNumber)
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

// ---------- callables ----------

// Posted, live invoices of this company and vendor with something left to
// return, each with its GRN lines. includeInvoiceId keeps a draft's own
// invoice in the list even when nothing more is returnable.
exports.getReturnableVendorInvoices = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  await requireAccess(user.profile.role);
  const d = request.data || {};
  const companyId = String(d.companyId || '').trim();
  const vendorId = String(d.vendorId || '').trim();
  const excludeReturnId = String(d.excludeReturnId || '').trim();
  if (!companyId || !vendorId) return [];
  if (!userCanAccessCompany(user.profile, companyId)) throw new HttpsError('permission-denied', 'You do not have access to that company.');

  const [invSnap, txSnap] = await Promise.all([rtdb.ref('vendorInvoices').get(), rtdb.ref('stock/transactions').get()]);
  const invoices = invSnap.val() || {};
  const txs = txSnap.val() || {};
  const out = [];
  for (const id of Object.keys(invoices)) {
    const inv = invoices[id];
    if (inv.CompanyID !== companyId || inv.VendorID !== vendorId) continue;
    if (inv.Status !== 'Posted' || inv.ReversedByInvoiceID || inv.ReversalOfInvoiceID || !(inv.SourceGRNs || []).length) continue;
    const lines = await invoiceGrnLines(id, inv, excludeReturnId, txs);
    if (!lines.some(l => l.ReturnableQuantity > 0) && id !== d.includeInvoiceId) continue;
    out.push({
      VendorInvoiceID: id, TransactionNumber: inv.TransactionNumber || '', InvoiceDate: inv.InvoiceDate || '',
      VendorRefNumber: inv.VendorRefNumber || '', Description: inv.Description || '', Status: inv.Status,
      Subtotal: inv.Subtotal, Discount: inv.Discount || 0, TaxPercent: inv.TaxPercent || 0, Total: inv.Total, Lines: lines
    });
  }
  await annotateInvoiceOutstanding('VendorInvoice', out);
  return out.sort((a, b) => (b.InvoiceDate + b.TransactionNumber).localeCompare(a.InvoiceDate + a.TransactionNumber));
});

exports.savePurchaseReturnDraft = onCallWithMessages(onCallOptions, async (request) => {
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
  const vendorId = String(data.VendorID || '').trim();
  if (!vendorId) throw new HttpsError('invalid-argument', 'Select a Vendor for this return.');
  const invoiceId = String(data.SourceInvoiceID || '').trim();
  if (!invoiceId) throw new HttpsError('invalid-argument', 'Select the Vendor Invoice the goods are being returned against.');

  const inv = (await rtdb.ref('vendorInvoices/' + invoiceId).get()).val();
  assertInvoiceReturnable(inv, companyId, vendorId);
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
    VendorID: vendorId, SourceInvoiceID: invoiceId, SourceInvoiceNumber: inv.TransactionNumber || '',
    Lines: lines, Status: 'Draft', UpdatedAt: now, UpdatedBy: actor
  }, computeValues(lines, inv));

  if (returnId) {
    await rtdb.ref(TX + returnId).update(fields);
    return { success: true, returnId: returnId };
  }
  const newId = 'PRTD-' + randomUUID().split('-')[0].toUpperCase();
  await rtdb.ref(TX + newId).set(Object.assign({}, fields, { CreatedAt: now, CreatedBy: actor }));
  return { success: true, returnId: newId };
});

exports.postPurchaseReturn = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  const returnId = String(request.data && request.data.returnId || '').trim();

  return withGlobalLock(user.uid, async () => {
    const existing = await loadReturn(returnId);
    if (!userCanAccessCompany(user.profile, existing.CompanyID)) throw new HttpsError('permission-denied', 'You do not have access to that company.');
    await requirePostAccess(user.profile.role);
    if (existing.Status !== 'Draft' && existing.Status !== 'Rejected') throw new HttpsError('failed-precondition', 'Only draft or rejected returns can be posted.');

    // Re-validated now, so a stale draft is refused before an approval
    // instance is started for it.
    const inv = (await rtdb.ref('vendorInvoices/' + existing.SourceInvoiceID).get()).val();
    assertInvoiceReturnable(inv, existing.CompanyID, existing.VendorID);
    const lines = await buildLines(existing.Lines, existing.SourceInvoiceID, inv, returnId);
    const values = computeValues(lines, inv);

    const now = new Date().toISOString();
    const actor = user.profile.username || user.uid;
    const scopeKey = await resolveApprovalScopeKeyForDocument(MODULE_ID, {
      CompanyID: existing.CompanyID, DivisionID: existing.DivisionID, BranchID: existing.BranchID, CostCenterID: existing.CostCenterID
    });
    const approval = await beginApprovalInstance(MODULE_ID, returnId, '', scopeKey, values.Total, user.uid);
    if (approval.required) {
      await rtdb.ref(TX + returnId).update(Object.assign({
        Lines: lines, Status: 'PendingApproval', ApprovalInstanceID: approval.instanceId,
        RejectionReason: '', SubmittedAt: now, SubmittedBy: actor, UpdatedAt: now, UpdatedBy: actor
      }, values));
      return { success: true, status: 'PendingApproval' };
    }

    const result = await commitPurchaseReturnPosting(user, existing, returnId);
    return { success: true, returnId: returnId, returnNumber: result.returnNumber, status: 'Posted' };
  });
});

// Caller holds the global lock. Everything is re-checked from live data:
// the invoice, what's left to return, the invoice's outstanding.
async function commitPurchaseReturnPosting(user, existing, returnId) {
  const inv = (await rtdb.ref('vendorInvoices/' + existing.SourceInvoiceID).get()).val();
  assertInvoiceReturnable(inv, existing.CompanyID, existing.VendorID);
  const lines = await buildLines(existing.Lines, existing.SourceInvoiceID, inv, returnId);
  const values = computeValues(lines, inv);

  const [itemsSnap, coaSnap, vendorSnap] = await Promise.all([
    rtdb.ref('items').get(), rtdb.ref('coa').get(), rtdb.ref('vendors/' + existing.VendorID).get()
  ]);
  const itemsData = itemsSnap.val() || {};
  const coaData = coaSnap.val() || {};
  const vendor = vendorSnap.val();
  if (!vendor || !vendor.TradePayablesAccountID) throw new Error('This Vendor has no Trade Payables Account configured. Set one in Vendor Master Data before posting.');
  const apAccount = coaData[vendor.TradePayablesAccountID];
  if (!apAccount || !apAccount.IsPostable) throw new Error('This Vendor\'s Trade Payables Account is no longer valid.');

  const movementLines = lines.map(l => Object.assign({ Direction: 'Out' }, l));
  const movement = await computeStockMovement(itemsData, coaData, movementLines);
  const wacValue = round2(movement.inventoryGlLines.reduce((s, l) => s + l.Credit, 0));
  const variance = round2(values.ReturnValue - wacValue);

  const dims = { CostCenterID: existing.CostCenterID || '', ProfitCenterID: existing.ProfitCenterID || '' };
  const label = 'Purchase return — ' + existing.Description;

  // Settle the invoice first; any remainder is an open debit item.
  const items = await getOpenItemsForParty('Vendor', existing.VendorID, vendor);
  const invoiceRef = 'VendorInvoice:' + existing.SourceInvoiceID;
  const openItem = items.get(invoiceRef);
  const against = round2(Math.min(values.Total, Math.max(0, openItem ? openItem.Outstanding : 0)));
  const allocations = [];
  if (against > 0) allocations.push({ RefType: 'Against', RefID: invoiceRef, Amount: against, RefNumber: inv.TransactionNumber || '' });
  if (values.Total - against > 0.005) allocations.push({ RefType: 'New', RefID: '', Amount: round2(values.Total - against) });

  const glLines = [Object.assign({
    AccountCode: apAccount.AccountCode, Debit: values.Total, Credit: 0, Description: label,
    PartyType: 'Vendor', PartyID: existing.VendorID, PartyName: vendor.VendorName || vendor.VendorCode || '', Allocations: allocations
  }, dims)];
  if (values.DiscountAmount > 0) {
    const acc = await resolveCompanyAccount(existing.CompanyID, 'DiscountReceivedAccountID', 'Discount Received Account', coaData);
    glLines.push(Object.assign({ AccountCode: acc.AccountCode, Debit: values.DiscountAmount, Credit: 0, Description: 'Discount received reversed — ' + existing.Description }, dims));
  }
  glLines.push(...movement.inventoryGlLines);
  if (values.TaxAmount > 0) {
    const acc = await resolveCompanyAccount(existing.CompanyID, 'InputTaxAccountID', 'Input Tax Account', coaData);
    glLines.push(Object.assign({ AccountCode: acc.AccountCode, Debit: 0, Credit: values.TaxAmount, Description: 'Input tax reversed — ' + existing.Description }, dims));
  }
  if (variance !== 0) {
    const acc = await resolveCompanyAccount(existing.CompanyID, 'PurchaseReturnVarianceAccountID', 'Purchase Return Variance Account', coaData);
    // One variance line per cost center the goods were received under, so
    // the variance lands where the original purchase did.
    const byCenter = new Map();
    movementLines.forEach(l => {
      const key = l.CostCenterID + '|' + l.ProfitCenterID;
      const v = byCenter.get(key) || { CostCenterID: l.CostCenterID, ProfitCenterID: l.ProfitCenterID, Amount: 0 };
      v.Amount = round2(v.Amount + l.ReturnValue - l.TotalValue);
      byCenter.set(key, v);
    });
    byCenter.forEach(v => {
      if (v.Amount === 0) return;
      glLines.push({
        AccountCode: acc.AccountCode, Debit: v.Amount < 0 ? -v.Amount : 0, Credit: v.Amount > 0 ? v.Amount : 0,
        Description: 'Return at invoice price vs stock value — ' + existing.Description,
        CostCenterID: v.CostCenterID, ProfitCenterID: v.ProfitCenterID
      });
    });
  }

  const actor = user.profile.username || user.uid;
  const attemptId = await beginCommitAttempt(returnId, actor);
  let glResult;
  try {
    glResult = await writeStockGlEntry(user, TYPE, existing.TransactionDate, existing.Description, existing.Reference || existing.SourceInvoiceNumber || '',
      glLines,
      { CompanyID: existing.CompanyID, DivisionID: existing.DivisionID, BranchID: existing.BranchID, CostCenterID: existing.CostCenterID, ProfitCenterID: existing.ProfitCenterID },
      {
        CommitAttemptID: attemptId, SourceTransactionID: returnId, ReversalOfJV: '',
        PartyKeys: ['Vendor:' + existing.VendorID],
        AllocatedRefs: against > 0 ? [invoiceRef] : [], AllocatedRefTypes: against > 0 ? ['VendorInvoice'] : []
      });
  } catch (err) {
    await abandonCommitAttempt(returnId, existing.Status, actor);
    throw err;
  }

  // A GL entry genuinely exists from here on — no more reverting.
  await commitStockLedgerUpdates(movement.ledgerUpdates);
  await finalizeCommitAttempt(returnId, glResult, Object.assign({
    Lines: movementLines, StockValue: wacValue, VarianceAmount: variance, AllocatedToInvoice: against
  }, values), actor);
  return { returnNumber: glResult.jvNumber };
}

exports.decidePurchaseReturnApproval = onCallWithMessages(onCallOptions, async (request) => {
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
        const commit = await commitPurchaseReturnPosting(user, existing, returnId);
        return { success: true, status: 'Approved', returnNumber: commit.returnNumber, selfApproved: result.selfApproved };
      } catch (err) {
        // As Vendor Invoice: the decision is already recorded, so undo it
        // and hand the return back for editing rather than leave it stuck.
        const instance = (await rtdb.ref('approvalInstances/' + existing.ApprovalInstanceID).get()).val();
        if (instance) {
          await rtdb.ref('approvalInstances/' + existing.ApprovalInstanceID).update({
            Decisions: (instance.Decisions || []).filter(d => d.LevelNumber !== levelNumber), Status: 'Pending', UpdatedAt: now
          });
        }
        await rtdb.ref(TX + returnId).update({
          Status: 'Rejected', RejectionReason: 'Posting failed and could not be completed: ' + err.message + ' — please fix and resubmit.',
          UpdatedAt: now, UpdatedBy: actor
        });
        throw new Error('Posting failed: ' + err.message + ' The return has been returned to an editable state — fix the issue and resubmit.');
      }
    }
    if (result.status === 'Rejected') {
      await rtdb.ref(TX + returnId).update({ Status: 'Rejected', RejectionReason: String(reason || '').trim(), UpdatedAt: now, UpdatedBy: actor });
    }
    return { success: true, status: result.status, selfApproved: result.selfApproved };
  });
});

exports.deletePurchaseReturnDraft = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  const returnId = String(request.data && request.data.returnId || '').trim();
  const existing = await loadReturn(returnId);
  if (!userCanAccessCompany(user.profile, existing.CompanyID)) throw new HttpsError('permission-denied', 'You do not have access to that company.');
  await requireDraftAccess(user.profile.role);
  if (existing.Status !== 'Draft') throw new HttpsError('failed-precondition', 'Only draft returns can be deleted. Posted returns must be reversed instead.');
  await rtdb.ref(TX + returnId).set(null);
  return { success: true };
});

exports.getPurchaseReturnEntries = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  await requireAccess(user.profile.role);
  const data = (await rtdb.ref('stock/transactions').get()).val() || {};
  const all = Object.keys(data)
    .map(id => Object.assign({ ReturnID: id }, data[id]))
    .filter(e => e.TransactionType === TYPE && userCanAccessCompany(user.profile, e.CompanyID))
    .sort((a, b) => (b.CreatedAt || '').localeCompare(a.CreatedAt || ''));
  const limit = request.data && request.data.limit;
  return { entries: limit === 'all' ? all : all.slice(0, 100), total: all.length };
});

// Whole return only (owner decision 9). Stock comes back In at the cost it
// went out at, and the GL entry is mirrored line for line. Refused while
// the return's open remainder (its New Ref) has been settled by a JV/CBT —
// same rule as reversing a JV/CBT entry.
exports.reversePurchaseReturn = onCallWithMessages(onCallOptions, async (request) => {
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
    // In at the unit cost each line went out at (stored by the posting).
    const movementLines = existing.Lines.map(l => Object.assign({}, l, { Direction: 'In' }));
    const movement = await computeStockMovement(itemsSnap.val() || {}, coaSnap.val() || {}, movementLines);

    // Mirror of the original: every line swapped, the vendor tag kept (so
    // the vendor's statement shows the reversal) but with no allocations —
    // both entries stop counting once they're marked reversed/reversal.
    const glLines = (glEntry.Lines || []).map(l => {
      const out = {
        AccountCode: l.AccountCode, Debit: l.Credit || 0, Credit: l.Debit || 0, Description: 'Reversal — ' + (l.Description || ''),
        CostCenterID: l.CostCenterID || '', ProfitCenterID: l.ProfitCenterID || ''
      };
      if (l.PartyType) Object.assign(out, { PartyType: l.PartyType, PartyID: l.PartyID, PartyName: l.PartyName || '', Allocations: [] });
      return out;
    });

    const now = new Date().toISOString();
    const actor = user.profile.username || user.uid;
    const newId = 'PRTD-' + randomUUID().split('-')[0].toUpperCase();
    const attemptId = randomUUID();
    const reversalDescription = 'Reversal of ' + existing.TransactionNumber + ' — ' + existing.Description;
    await rtdb.ref(TX + newId).set({
      TransactionType: TYPE, Status: 'Committing', CommitAttemptID: attemptId, CommitAttemptStartedAt: now,
      TransactionDate: date, Description: reversalDescription, Reference: existing.TransactionNumber,
      CompanyID: existing.CompanyID, DivisionID: existing.DivisionID || '', BranchID: existing.BranchID || '',
      CostCenterID: existing.CostCenterID || '', ProfitCenterID: existing.ProfitCenterID || '',
      VendorID: existing.VendorID, SourceInvoiceID: existing.SourceInvoiceID, SourceInvoiceNumber: existing.SourceInvoiceNumber || '',
      ReturnValue: existing.ReturnValue, DiscountAmount: existing.DiscountAmount, TaxPercent: existing.TaxPercent,
      TaxAmount: existing.TaxAmount, Total: existing.Total,
      Lines: movementLines, ReversalOfReturnID: returnId, ReversedByReturnID: '',
      CreatedAt: now, CreatedBy: actor, UpdatedAt: now, UpdatedBy: actor
    });

    let glResult;
    try {
      glResult = await writeStockGlEntry(user, TYPE, date, reversalDescription, existing.TransactionNumber, glLines,
        { CompanyID: existing.CompanyID, DivisionID: existing.DivisionID, BranchID: existing.BranchID, CostCenterID: existing.CostCenterID, ProfitCenterID: existing.ProfitCenterID },
        { CommitAttemptID: attemptId, SourceTransactionID: newId, ReversalOfJV: existing.LinkedJVID, PartyKeys: glEntry.PartyKeys || [], AllocatedRefs: [], AllocatedRefTypes: [] });
    } catch (err) {
      await rtdb.ref(TX + newId).set(null);
      throw err;
    }

    // A GL entry genuinely exists from here on — no more reverting.
    await commitStockLedgerUpdates(movement.ledgerUpdates);
    // The original is marked first (as reverseGrn does), so a second
    // reversal can't start even if something fails between these writes.
    await glRef.update({ ReversedByJV: glResult.jvId, UpdatedAt: now, UpdatedBy: actor });
    await rtdb.ref(TX + returnId).update({ ReversedByReturnID: newId, UpdatedAt: now, UpdatedBy: actor });
    await finalizeCommitAttempt(newId, glResult, { Lines: movementLines }, actor);
    return { success: true, returnId: newId, returnNumber: glResult.jvNumber };
  });
});

exports.assertInvoiceHasNoLiveReturns = assertInvoiceHasNoLiveReturns;
