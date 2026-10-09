// Direct Retail Sales (owner, 2026-10-09; docs/modules/RETAIL_SALES.md,
// decisions 52-55). New development, hand-written.
//
// A counter sale: customer, items, payments, Confirm. No Sales Order or
// Delivery Note; the sale is its own invoice. Stored in stock/transactions
// (TransactionType 'RetailSale', its lines Direction 'Out'), so the stock
// ledger, its rebuild and the stock reports read it like a Delivery Note.
// Confirming writes one GL entry (prefix RS, the finance sequence TXN-):
//   Dr each payment method's account     what it took (cash less change)
//   Dr Trade Receivables                 a balance left on account (an
//                                        existing customer only, decision 52)
//   Dr Discount Given                    the line discounts, net of tax
//   Cr the Sales Type's revenue account  the goods, net of tax
//   Cr Output Tax                        worked out of the tax-inclusive
//                                        prices (decision 53)
//   Dr Sales COGS / Cr Inventory         at cost, per line
// A Promotion method is a payment method like any other (decision 54): its
// account is an expense, so the promotion is a cost, not cash.
// A sale is reversed whole (decision 55): the stock comes back at the cost
// it left at and every GL line is mirrored.
// Partial returns (decisions 76-79): part of a sale comes back (TransactionType
// 'RetailReturn', prefix RR), found by its invoice number. One GL entry:
//   Dr Sales Returns (the Sales Type's)  the goods, net of tax
//   Cr Discount Given                    the returned share of the discount
//   Dr Output Tax                        the returned share of the tax
//   Cr Trade Receivables                 the sale's open on-account balance,
//                                        reduced first; any rest an open credit
//   Cr each payment method's account     the refund, the original way pro rata
//                                        (a promotion's share is reversed, not
//                                        paid out; card or QR may go to cash)
//   Dr Inventory / Cr Sales COGS         at the cost each line left at
// A return is reversed whole; the stock leaves again at that cost.
//
// Setup per company: retailSales/settings/{companyId}; payment methods:
// retailSales/paymentMethods/{id}.
const { randomUUID } = require('crypto');
const { HttpsError } = require('firebase-functions/v2/https');
const { onCallWithMessages } = require('./callable');
const { rtdb, firestore } = require('./firebaseAdmin');
const { requireUser, moduleHasCapability } = require('./auth');
const { userCanAccessCompany, writeStockGlEntry, FIRESTORE_JOURNAL_ENTRIES_COLLECTION } = require('./glWriting');
const { computeStockMovement, commitStockLedgerUpdates } = require('./stockMovement');
const { beginCommitAttempt, abandonCommitAttempt, finalizeCommitAttempt } = require('./commitAttempt');
const { withGlobalLock } = require('./lock');
const { assertEntryReversible, getOpenItemsForParty } = require('./partyLedger');
const Barcodes = require('./itemBarcodes');
const BarcodeSvg = require('./barcodeSvg');

const onCallOptions = { region: 'us-central1' };
const MODULE_ID = 'RETAILSALES';
const TYPE = 'RetailSale';
const RTYPE = 'RetailReturn';
const TX = 'stock/transactions/';
const SETTINGS = 'retailSales/settings/';
const METHODS = 'retailSales/paymentMethods';
const KINDS = { Cash: 'Cash', Card: 'Card', QR: 'QR code / scan', Promotion: 'Promotion', Other: 'Other' };
const RETAIL_CUSTOMER = 'Retail Customer';

const round2 = n => Math.round(n * 100) / 100;
const round6 = n => Math.round(n * 1e6) / 1e6;
const actorOf = user => user.profile.username || user.uid;

async function requireCap(user, cap) {
  if (!(await moduleHasCapability(MODULE_ID, cap, user.profile.role))) {
    if (cap === 'access') throw new HttpsError('permission-denied', 'You do not have access to Retail Sales.');
    throw new HttpsError('permission-denied', cap === 'write' ? 'You do not have permission to change the Retail Sales setup.'
      : 'You do not have permission to sell or reverse in Retail Sales.');
  }
}
function requireCompany(user, companyId) {
  if (!companyId) throw new HttpsError('invalid-argument', 'Select a company.');
  if (!userCanAccessCompany(user.profile, companyId)) throw new HttpsError('permission-denied', 'You do not have access to that company.');
}
const val = async path => (await rtdb.ref(path).get()).val();
const ofCompany = (rec, co) => rec && (!rec.CompanyID || rec.CompanyID === co);
const postable = (a, co) => a && a.IsPostable && a.Status === 'Active' && ofCompany(a, co);

// ---------- tax-inclusive arithmetic (decision 53) ----------

// Lines carry tax-inclusive prices and discounts. The goods and the
// discount are posted net of tax; the tax is worked out of the total.
function computeTotals(lines, taxPercent) {
  const rate = Number(taxPercent) || 0;
  const listAmount = round2(lines.reduce((s, l) => s + l.ListAmount, 0));
  const discount = round2(lines.reduce((s, l) => s + l.Discount, 0));
  const total = round2(listAmount - discount);
  const taxAmount = round2(total * rate / (100 + rate));
  const discountNet = round2(discount * 100 / (100 + rate));
  return {
    TaxPercent: rate, ListAmount: listAmount, Discount: discount, Total: total, TaxAmount: taxAmount,
    DiscountNet: discountNet, Revenue: round2(total - taxAmount + discountNet)
  };
}

// The payments: each method's amount; cash may be over-tendered, the change
// coming out of the cash rows. Returns what each row posts, the change and
// what's left on account.
function settlePayments(rows, total) {
  const paid = round2(rows.reduce((s, r) => s + r.Amount, 0));
  let change = round2(Math.max(0, paid - total));
  const cash = round2(rows.filter(r => r.Kind === 'Cash').reduce((s, r) => s + r.Amount, 0));
  if (change > 0.005 && change > cash + 0.005) {
    throw new Error('The payments come to ' + paid.toFixed(2) + ', more than the total ' + total.toFixed(2) + '; only cash can be over-tendered (change is given from cash).');
  }
  const posted = rows.map(r => Object.assign({}, r, { Posted: r.Amount }));
  for (let i = posted.length - 1; i >= 0 && change > 0.005; i--) {
    if (posted[i].Kind !== 'Cash') continue;
    const take = Math.min(posted[i].Posted, change);
    posted[i].Posted = round2(posted[i].Posted - take);
    change = round2(change - take);
  }
  return { rows: posted, paid, change: round2(Math.max(0, paid - total)), onAccount: round2(Math.max(0, total - paid)) };
}

// ---------- setup ----------

async function loadSettings(companyId) {
  return (await val(SETTINGS + companyId)) || null;
}

async function methodsOf(companyId) {
  const all = (await val(METHODS)) || {};
  return Object.entries(all).filter(([, m]) => m.CompanyID === companyId)
    .map(([id, m]) => Object.assign({ MethodID: id }, m))
    .sort((a, b) => (Number(a.Sort) || 0) - (Number(b.Sort) || 0) || String(a.Name).localeCompare(String(b.Name)));
}

// Customer classifications, seeded with Local / Export when empty (as
// Sales Invoice Configuration does).
async function classifications() {
  let data = (await val('customerClassifications')) || {};
  if (!Object.keys(data).length) {
    const now = new Date().toISOString();
    data = {};
    [{ Name: 'Local', IsExport: false }, { Name: 'Export', IsExport: true }].forEach(c => {
      data['CCLS-' + randomUUID().split('-')[0].toUpperCase()] = { Name: c.Name, IsExport: c.IsExport, CompanyID: '', Status: 'Active', CreatedAt: now, CreatedBy: 'system', UpdatedAt: now, UpdatedBy: 'system' };
    });
    await rtdb.ref('customerClassifications').update(data);
  }
  return data;
}

// A Sales Type restricted to a classification fits only its customers (as
// on the Customer Invoice, resolveAndValidateSalesType_).
async function salesTypeFor(salesTypeId, customer, companyId, label) {
  const st = salesTypeId && (await val('salesTypes/' + salesTypeId));
  if (!st || st.Status !== 'Active' || !ofCompany(st, companyId)) throw new Error(label + ': choose an active Sales Type of this company.');
  if (st.RestrictedToClassificationID) {
    const cls = await classifications();
    const own = Object.keys(cls).find(id => cls[id].Name === customer.Classification || id === customer.Classification);
    if (own !== st.RestrictedToClassificationID) {
      throw new Error(label + ': Sales Type "' + st.Name + '" is restricted to ' + ((cls[st.RestrictedToClassificationID] || {}).Name || 'other') +
        ' customers; ' + (customer.CustomerName || 'this customer') + ' is ' + (customer.Classification || 'unclassified') + '.');
    }
  }
  return st;
}

// The price of each item on the price list on a date (its latest version
// effective by then), as Price Listing resolves it.
async function pricesOn(priceListId, date) {
  if (!priceListId) return {};
  const lines = (await val('priceListLines')) || {};
  const out = {};
  Object.values(lines).forEach(l => {
    if (l.PriceListID !== priceListId || l.Status !== 'Active' || !l.EffectiveFrom || l.EffectiveFrom > date) return;
    const cur = out[l.ItemCode];
    if (!cur || l.EffectiveFrom > cur.EffectiveFrom) out[l.ItemCode] = l;
  });
  return Object.fromEntries(Object.entries(out).map(([code, l]) => [code, Number(l.UnitPrice) || 0]));
}

exports.getRetailSalesSetup = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  await requireCap(user, 'access');
  const companyId = String((request.data || {}).companyId || '').trim();
  requireCompany(user, companyId);
  const [settings, methods, coa, units, salesTypes, priceLists, customers, canSell, canSetup, canReport, canReturn] = await Promise.all([
    loadSettings(companyId), methodsOf(companyId), val('coa'), val('orgUnits'), val('salesTypes'), val('priceLists'), val('customers'),
    moduleHasCapability(MODULE_ID, 'post', user.profile.role), moduleHasCapability(MODULE_ID, 'write', user.profile.role),
    moduleHasCapability(MODULE_ID, 'report', user.profile.role), moduleHasCapability(MODULE_ID, 'return', user.profile.role)
  ]);
  const list = (obj, keep, map) => Object.entries(obj || {}).filter(([, r]) => keep(r)).map(([id, r]) => map(id, r));
  const unit = type => list(units, u => u.Type === type && u.Status === 'Active' && ofCompany(u, companyId), (id, u) => ({ ID: id, Label: (u.Code ? u.Code + ' — ' : '') + (u.Name || '') }));
  return {
    settings,
    methods,
    kinds: Object.entries(KINDS).map(([key, label]) => ({ key, label })),
    accounts: list(coa, a => postable(a, companyId), (id, a) => ({ AccountID: id, Label: a.AccountCode + ' — ' + a.AccountName, AccountType: a.AccountType }))
      .sort((a, b) => a.Label.localeCompare(b.Label)),
    warehouses: unit('Warehouse'),
    costCenters: unit('CostCenter'),
    salesTypes: list(salesTypes, s => s.Status === 'Active' && ofCompany(s, companyId), (id, s) => ({ SalesTypeID: id, Name: s.Name, RestrictedToClassificationID: s.RestrictedToClassificationID || '' })),
    priceLists: list(priceLists, p => p.Status === 'Active' && ofCompany(p, companyId), (id, p) => ({ PriceListID: id, Name: p.Name })),
    retailCustomer: settings && settings.RetailCustomerID && customers && customers[settings.RetailCustomerID]
      ? { CustomerID: settings.RetailCustomerID, CustomerCode: customers[settings.RetailCustomerID].CustomerCode, CustomerName: customers[settings.RetailCustomerID].CustomerName } : null,
    canSell, canSetup, canReport, canReturn
  };
});

exports.saveRetailSalesSettings = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  await requireCap(user, 'write');
  const d = request.data || {};
  const companyId = String(d.companyId || '').trim();
  requireCompany(user, companyId);
  const [coa, units, existing] = await Promise.all([val('coa'), val('orgUnits'), loadSettings(companyId)]);
  const pick = (k, label, ok) => {
    const id = String(d[k] || '').trim();
    if (!id || !ok(id)) throw new HttpsError('invalid-argument', 'Choose the ' + label + '.');
    return id;
  };
  const unitOk = type => id => units && units[id] && units[id].Type === type && units[id].Status === 'Active' && ofCompany(units[id], companyId);
  const warehouseId = pick('warehouseId', 'default warehouse (the store)', unitOk('Warehouse'));
  const costCenterId = pick('costCenterId', 'cost center for the sales', unitOk('CostCenter'));
  const receivablesId = pick('receivablesAccountId', 'Retail Customer\'s receivables account (an asset account)', id => postable(coa[id], companyId) && coa[id].AccountType === 'Asset');
  const salesTypeId = String(d.salesTypeId || '').trim();
  const st = salesTypeId && (await val('salesTypes/' + salesTypeId));
  if (!st || st.Status !== 'Active' || !ofCompany(st, companyId)) throw new HttpsError('invalid-argument', 'Choose the default Sales Type.');
  if (st.RestrictedToClassificationID) {
    const cls = await classifications();
    if ((cls[st.RestrictedToClassificationID] || {}).Name !== 'Local') {
      throw new HttpsError('invalid-argument', 'The default Sales Type must fit the Retail Customer (Local); "' + st.Name + '" is restricted to other customers.');
    }
  }
  const priceListId = String(d.priceListId || '').trim();
  if (priceListId) {
    const pl = await val('priceLists/' + priceListId);
    if (!pl || pl.Status !== 'Active' || !ofCompany(pl, companyId)) throw new HttpsError('invalid-argument', 'Choose an active price list of this company, or none.');
  }
  const taxPercent = Number(d.taxPercent);
  if (!(taxPercent >= 0 && taxPercent <= 100)) throw new HttpsError('invalid-argument', 'Enter the tax % (0 to 100).');
  // The return period (decision 78): days after the sale a return is taken; 0 = no limit.
  const returnDays = d.returnDays === undefined || d.returnDays === '' || d.returnDays === null ? 0 : Number(d.returnDays);
  if (!(Number.isInteger(returnDays) && returnDays >= 0 && returnDays <= 3650)) throw new HttpsError('invalid-argument', 'Enter the return period in whole days (0 = no limit).');

  const now = new Date().toISOString();
  const actor = actorOf(user);
  // The Retail Customer: one per company, in Customer Master, made here once.
  let retailCustomerId = existing && existing.RetailCustomerID;
  if (retailCustomerId && !(await val('customers/' + retailCustomerId))) retailCustomerId = '';
  if (!retailCustomerId) {
    await classifications();
    const counter = await rtdb.ref('customerCounters/CL').transaction(c => (Number(c) || 0) + 1);
    retailCustomerId = 'CST-' + randomUUID().split('-')[0].toUpperCase();
    await rtdb.ref('customers/' + retailCustomerId).set({
      CustomerName: RETAIL_CUSTOMER, CustomerCode: 'CL-' + String(counter.snapshot.val()).padStart(6, '0'), Category: '',
      Classification: 'Local', Country: '', TradeReceivablesAccountID: receivablesId, CompanyID: companyId,
      ContactPerson: '', Phone: '', Email: '', AddressLine1: '', AddressLine2: '', TaxRegistrationNumber: '', PaymentTermsDays: 0,
      DefaultCurrency: '', BankName: '', BankAccountNumber: '', BankIBAN: '', BankSwift: '',
      Notes: 'Default customer of Retail Sales (counter sales).', RetailCustomer: true,
      Status: 'Active', CreatedAt: now, CreatedBy: actor, UpdatedAt: now, UpdatedBy: actor
    });
  } else {
    await rtdb.ref('customers/' + retailCustomerId).update({ TradeReceivablesAccountID: receivablesId, UpdatedAt: now, UpdatedBy: actor });
  }
  await rtdb.ref(SETTINGS + companyId).set({
    RetailCustomerID: retailCustomerId, SalesTypeID: salesTypeId, WarehouseID: warehouseId, CostCenterID: costCenterId,
    ReceivablesAccountID: receivablesId, PriceListID: priceListId, TaxPercent: taxPercent,
    AllowPriceChange: d.allowPriceChange === true, ReturnDays: returnDays,
    CreatedAt: (existing && existing.CreatedAt) || now, UpdatedAt: now, UpdatedBy: actor
  });
  return { success: true, retailCustomerId };
});

exports.saveRetailPaymentMethod = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  await requireCap(user, 'write');
  const d = request.data || {};
  const companyId = String(d.companyId || '').trim();
  requireCompany(user, companyId);
  const m = d.method || {};
  const name = String(m.Name || '').trim();
  if (!name) throw new HttpsError('invalid-argument', 'Enter the payment method\'s name.');
  if (!KINDS[m.Kind]) throw new HttpsError('invalid-argument', 'Choose what kind of payment it is.');
  const coa = (await val('coa')) || {};
  const accountId = String(m.AccountID || '').trim();
  if (!postable(coa[accountId], companyId)) throw new HttpsError('invalid-argument', name + ': choose the ledger account it posts to.');
  if (m.Kind === 'Promotion' && coa[accountId].AccountType !== 'Expense') {
    throw new HttpsError('invalid-argument', name + ': a promotion posts to an expense account (e.g. Promotional Discounts).');
  }
  if (m.Kind !== 'Promotion' && coa[accountId].AccountType !== 'Asset') {
    throw new HttpsError('invalid-argument', name + ': ' + KINDS[m.Kind].toLowerCase() + ' posts to an asset account (cash, bank or card clearing).');
  }
  const methods = await methodsOf(companyId);
  const id = String(m.MethodID || '').trim();
  if (id && !methods.some(x => x.MethodID === id)) throw new HttpsError('not-found', 'Payment method not found.');
  if (methods.some(x => x.MethodID !== id && String(x.Name).toLowerCase() === name.toLowerCase())) throw new HttpsError('already-exists', 'There is already a payment method "' + name + '".');
  const now = new Date().toISOString();
  const rec = {
    CompanyID: companyId, Name: name, Kind: m.Kind, AccountID: accountId,
    NeedsReference: m.Kind === 'Promotion' ? true : m.NeedsReference === true,
    Status: m.Status === 'Inactive' ? 'Inactive' : 'Active', Sort: Number(m.Sort) || 0, UpdatedAt: now, UpdatedBy: actorOf(user)
  };
  const methodId = id || 'RPM-' + randomUUID().split('-')[0].toUpperCase();
  await rtdb.ref(METHODS + '/' + methodId).update(id ? rec : Object.assign(rec, { CreatedAt: now, CreatedBy: actorOf(user) }));
  return { success: true, methodId };
});

// ---------- the counter ----------

// What the counter needs for a company: the setup, active methods, its
// customers, and its items with their price and the stock at a warehouse.
exports.getRetailCounter = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  await requireCap(user, 'access');
  const d = request.data || {};
  const companyId = String(d.companyId || '').trim();
  requireCompany(user, companyId);
  const settings = await loadSettings(companyId);
  if (!settings) return { settings: null };
  const warehouseId = String(d.warehouseId || '').trim() || settings.WarehouseID;
  const date = String(d.date || '').trim() || new Date().toISOString().substring(0, 10);
  const [methods, customers, items, uoms, ledger, prices, barcodes] = await Promise.all([
    methodsOf(companyId), val('customers'), val('items'), val('uoms'), val('stock/ledger'), pricesOn(settings.PriceListID, date), Barcodes.all()
  ]);
  const codesOf = Barcodes.byItem(barcodes); // the products' own barcodes (docs/modules/ITEM_BARCODES.md)
  return {
    settings, warehouseId, date,
    methods: methods.filter(m => m.Status === 'Active'),
    customers: Object.entries(customers || {}).filter(([, c]) => c.Status === 'Active' && c.CompanyID === companyId)
      .map(([id, c]) => ({
        CustomerID: id, CustomerCode: c.CustomerCode || '', CustomerName: c.CustomerName || '', Classification: c.Classification || '',
        Address: [c.AddressLine1, c.AddressLine2].filter(Boolean).join(', '), TaxRegistrationNumber: c.TaxRegistrationNumber || '',
        Retail: id === settings.RetailCustomerID
      })).sort((a, b) => (b.Retail - a.Retail) || a.CustomerName.localeCompare(b.CustomerName)),
    items: Object.entries(items || {}).filter(([, i]) => i.Status === 'Active' && ofCompany(i, companyId) && i.InventoryAccountID)
      .map(([id, i]) => {
        const l = ((ledger || {})[id] || {})[warehouseId] || {};
        const u = (uoms || {})[i.UOMID] || {};
        return {
          ItemID: id, ItemCode: i.ItemCode, ItemName: i.ItemName || '', UOM: u.Code || '', AllowDecimals: !!u.AllowDecimals,
          Price: prices[i.ItemCode] === undefined ? null : prices[i.ItemCode], InStock: Number(l.Quantity) || 0,
          Barcodes: codesOf[id] || []
        };
      }).sort((a, b) => a.ItemCode.localeCompare(b.ItemCode))
  };
});

// The sale, built and checked from live data: used by Confirm only (the
// counter has no drafts). Throws on anything wrong.
async function buildSale(user, d) {
  const companyId = String(d.CompanyID || '').trim();
  requireCompany(user, companyId);
  const settings = await loadSettings(companyId);
  if (!settings) throw new Error('Set up Retail Sales for this company first (Setup tab).');
  const date = String(d.SaleDate || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('Enter the sale date.');

  const [customers, items, uoms, units, coa, methods] = await Promise.all([
    val('customers'), val('items'), val('uoms'), val('orgUnits'), val('coa'), methodsOf(companyId)
  ]);
  const customerId = String(d.CustomerID || '').trim() || settings.RetailCustomerID;
  const customer = (customers || {})[customerId];
  if (!customer || customer.Status !== 'Active' || customer.CompanyID !== companyId) throw new Error('Choose an active customer of this company.');
  const retail = customerId === settings.RetailCustomerID;
  const salesType = await salesTypeFor(String(d.SalesTypeID || '').trim() || settings.SalesTypeID, customer, companyId, 'Sales Type');
  const salesTypeId = String(d.SalesTypeID || '').trim() || settings.SalesTypeID;
  const revenue = coa[salesType.GLAccountID];
  if (!postable(revenue, companyId)) throw new Error('Sales Type "' + salesType.Name + '": its revenue account is not valid — check Sales Invoice Configuration.');

  const warehouseId = String(d.WarehouseID || '').trim() || settings.WarehouseID;
  const wh = (units || {})[warehouseId];
  if (!wh || wh.Type !== 'Warehouse' || wh.Status !== 'Active' || !ofCompany(wh, companyId)) throw new Error('Choose a warehouse of this company.');
  const costCenterId = settings.CostCenterID;

  const prices = settings.AllowPriceChange ? null : await pricesOn(settings.PriceListID, date);
  const lines = [];
  (d.Lines || []).forEach((raw, idx) => {
    const n = 'Line ' + (idx + 1) + ': ';
    const item = (items || {})[raw.ItemID];
    if (!item || item.Status !== 'Active' || !ofCompany(item, companyId)) throw new Error(n + 'choose an active item of this company.');
    const qty = Number(raw.Quantity);
    if (!(qty > 0)) throw new Error(n + item.ItemCode + ': enter a quantity greater than zero.');
    const uom = (uoms || {})[item.UOMID];
    if (uom && !uom.AllowDecimals && Math.abs(qty - Math.round(qty)) > 0.0001) throw new Error(n + (uom.Code || 'this unit') + ' does not allow decimal quantities.');
    let price = Number(raw.UnitPrice);
    if (prices) {
      // Prices can't be changed at the counter: the price list's, always.
      if (prices[item.ItemCode] === undefined) throw new Error(n + item.ItemCode + ' has no price on the retail price list for ' + date + '.');
      price = prices[item.ItemCode];
    }
    if (!(price >= 0)) throw new Error(n + item.ItemCode + ': enter the price.');
    const listAmount = round2(qty * price);
    const discount = round2(Number(raw.Discount) || 0);
    if (discount < 0 || discount > listAmount) throw new Error(n + item.ItemCode + ': the discount must be between 0 and ' + listAmount.toFixed(2) + '.');
    lines.push({
      LineNo: lines.length + 1, Direction: 'Out', ItemID: raw.ItemID, ItemCode: item.ItemCode, ItemName: item.ItemName || '',
      WarehouseID: warehouseId, Quantity: round6(qty), UnitPrice: price, ListAmount: listAmount, Discount: discount,
      Amount: round2(listAmount - discount), CostCenterID: costCenterId, ProfitCenterID: '',
      Description: item.ItemCode + ' — ' + (item.ItemName || '')
    });
  });
  if (!lines.length) throw new Error('Add at least one item.');
  const totals = computeTotals(lines, settings.TaxPercent);

  const rows = (d.Payments || []).filter(p => Number(p.Amount)).map((p, idx) => {
    const m = methods.find(x => x.MethodID === p.MethodID);
    const n = 'Payment ' + (idx + 1) + ': ';
    if (!m || m.Status !== 'Active') throw new Error(n + 'choose an active payment method.');
    const amount = round2(Number(p.Amount));
    if (!(amount > 0)) throw new Error(n + m.Name + ': the amount must be greater than zero.');
    const reference = String(p.Reference || '').trim();
    if (m.NeedsReference && !reference) throw new Error(n + m.Name + ': enter its reference' + (m.Kind === 'Promotion' ? ' (the promotion code).' : ' (slip or transaction number).'));
    if (!postable(coa[m.AccountID], companyId)) throw new Error(n + m.Name + ': its ledger account is no longer valid — check the Retail Sales setup.');
    return { MethodID: m.MethodID, Name: m.Name, Kind: m.Kind, AccountID: m.AccountID, Amount: amount, Reference: reference };
  });
  const pay = settlePayments(rows, totals.Total);
  if (pay.onAccount > 0.005 && retail) {
    throw new Error('The payments come to ' + pay.paid.toFixed(2) + ', short of the total ' + totals.Total.toFixed(2) + ': the Retail Customer pays in full.');
  }
  if (pay.onAccount > 0.005 && !customer.TradeReceivablesAccountID) throw new Error(customer.CustomerName + ' has no Trade Receivables account, so nothing can be left on account.');

  const text = k => String(d[k] || '').trim();
  return {
    settings, customer, customerId, retail, salesType, salesTypeId, revenue, costCenterId, warehouseId, lines, totals, pay, coa,
    header: {
      TransactionType: TYPE, TransactionDate: date, CompanyID: companyId, DivisionID: '', BranchID: '',
      CostCenterID: costCenterId, ProfitCenterID: '',
      CustomerID: customerId, RetailCustomer: retail,
      // Printed only when entered (blank = no customer block on the invoice).
      BillToName: text('BillToName'), BillToAddress: text('BillToAddress'), BillToTaxNumber: text('BillToTaxNumber'),
      SalesTypeID: salesTypeId, SalesTypeName: salesType.Name, WarehouseID: warehouseId,
      Description: 'Retail sale — ' + (text('BillToName') || customer.CustomerName), Notes: text('Notes')
    }
  };
}

async function companyAccount(companyId, field, label, coa) {
  const company = (await val('companies/' + companyId)) || {};
  const a = company[field] && coa[company[field]];
  if (!a || !a.IsPostable) throw new Error('This company has no valid ' + label + '. Set it in Company Master Data.');
  return a;
}

exports.confirmRetailSale = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  await requireCap(user, 'post');
  const d = request.data || {};

  return withGlobalLock(user.uid, async () => {
    const s = await buildSale(user, d);
    const companyId = s.header.CompanyID;
    const items = (await val('items')) || {};
    // Out at the average cost, as a Delivery Note; refused when short.
    const movement = await computeStockMovement(items, s.coa, s.lines);
    const dims = { CostCenterID: s.costCenterId, ProfitCenterID: '' };
    const label = s.header.Description;
    const glLines = [];
    s.pay.rows.filter(r => r.Posted > 0.005).forEach(r => glLines.push(Object.assign({
      AccountCode: s.coa[r.AccountID].AccountCode, Debit: r.Posted, Credit: 0, Description: r.Name + (r.Reference ? ' ' + r.Reference : '') + ' — ' + label
    }, dims)));
    if (s.pay.onAccount > 0.005) {
      const ar = s.coa[s.customer.TradeReceivablesAccountID];
      if (!ar || !ar.IsPostable) throw new Error(s.customer.CustomerName + '\'s Trade Receivables account is no longer valid.');
      glLines.push(Object.assign({
        AccountCode: ar.AccountCode, Debit: s.pay.onAccount, Credit: 0, Description: 'On account — ' + label,
        PartyType: 'Customer', PartyID: s.customerId, PartyName: s.customer.CustomerName || s.customer.CustomerCode || '',
        Allocations: [{ RefType: 'New', RefID: '', Amount: s.pay.onAccount }]
      }, dims));
    }
    if (s.totals.DiscountNet > 0) {
      const acc = await companyAccount(companyId, 'DiscountGivenAccountID', 'Discount Given Account', s.coa);
      glLines.push(Object.assign({ AccountCode: acc.AccountCode, Debit: s.totals.DiscountNet, Credit: 0, Description: 'Discount given — ' + label }, dims));
    }
    glLines.push(Object.assign({ AccountCode: s.revenue.AccountCode, Debit: 0, Credit: s.totals.Revenue, Description: label }, dims));
    if (s.totals.TaxAmount > 0) {
      const acc = await companyAccount(companyId, 'OutputTaxAccountID', 'Output Tax Account', s.coa);
      glLines.push(Object.assign({ AccountCode: acc.AccountCode, Debit: 0, Credit: s.totals.TaxAmount, Description: 'Output tax — ' + label }, dims));
    }
    const cogs = s.lines.map((l, idx) => {
      const item = items[l.ItemID];
      const acc = s.coa[item.SalesCogsAccountID || item.ConsumptionAccountID];
      if (!acc || !acc.IsPostable) throw new Error('Line ' + (idx + 1) + ': Sales COGS account for ' + item.ItemCode + ' is not valid — check Item Master.');
      return { AccountCode: acc.AccountCode, Debit: l.TotalValue, Credit: 0, Description: l.Description, CostCenterID: l.CostCenterID, ProfitCenterID: '' };
    });
    glLines.push(...movement.inventoryGlLines, ...cogs);

    const now = new Date().toISOString();
    const actor = actorOf(user);
    const saleId = 'RS-' + randomUUID().split('-')[0].toUpperCase();
    const record = Object.assign({}, s.header, s.totals, {
      Lines: s.lines, Payments: s.pay.rows, Paid: s.pay.paid, Change: s.pay.change, OnAccount: s.pay.onAccount,
      CostValue: round2(s.lines.reduce((t, l) => t + l.TotalValue, 0)),
      Status: 'Draft', CreatedAt: now, CreatedBy: actor, UpdatedAt: now, UpdatedBy: actor
    });
    await rtdb.ref(TX + saleId).set(record);
    const attemptId = await beginCommitAttempt(saleId, actor);
    let glResult;
    try {
      glResult = await writeStockGlEntry(user, TYPE, s.header.TransactionDate, label, '', glLines,
        { CompanyID: companyId, DivisionID: '', BranchID: '', CostCenterID: s.costCenterId, ProfitCenterID: '' },
        {
          CommitAttemptID: attemptId, SourceTransactionID: saleId, ReversalOfJV: '',
          PartyKeys: s.pay.onAccount > 0.005 ? ['Customer:' + s.customerId] : [], AllocatedRefs: [], AllocatedRefTypes: []
        });
    } catch (err) {
      await rtdb.ref(TX + saleId).set(null);
      throw err;
    }
    // A GL entry genuinely exists from here on — no more reverting.
    await commitStockLedgerUpdates(movement.ledgerUpdates);
    await finalizeCommitAttempt(saleId, glResult, { Lines: s.lines, CostValue: record.CostValue }, actor);
    return { success: true, saleId, saleNumber: glResult.jvNumber, total: s.totals.Total, change: s.pay.change, onAccount: s.pay.onAccount };
  });
});

// The register: a company's sales (newest first), with totals per payment
// method for the day's cash-up.
// Who sees which sales (owner, 2026-10-09): the "report" right shows every
// user's sales (with a filter by who billed them); without it, a user sees
// only the sales they billed themselves, in the list, the invoice and the
// reversal alike.
const canSeeAll = user => moduleHasCapability(MODULE_ID, 'report', user.profile.role);
const isOwn = (user, t) => (t.CreatedBy || '') === actorOf(user);

// The register: a company's sales (newest first), with totals per payment
// method for the day's cash-up, and the payment-wise report: each payment
// of the live sales (neither reversed nor a reversal).
exports.getRetailSales = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  await requireCap(user, 'access');
  const d = request.data || {};
  const companyId = String(d.companyId || '').trim();
  requireCompany(user, companyId);
  const from = String(d.from || '').trim();
  const to = String(d.to || '').trim();
  const all = await canSeeAll(user);
  const billedBy = all ? String(d.billedBy || '').trim() : '';
  const txs = (await val('stock/transactions')) || {};
  const inRange = Object.entries(txs)
    .filter(([, t]) => (t.TransactionType === TYPE || t.TransactionType === RTYPE) && t.CompanyID === companyId && t.Status === 'Posted' &&
      (!from || t.TransactionDate >= from) && (!to || t.TransactionDate <= to) && (all || isOwn(user, t)));
  const billers = [...new Set(inRange.map(([, t]) => t.CreatedBy || ''))].filter(Boolean).sort();
  // A return (decisions 76-79) shows as negative: its refunds by the method
  // paid out, and what it took off the customer's account.
  const sales = inRange.filter(([, t]) => !billedBy || t.CreatedBy === billedBy)
    .map(([id, t]) => {
      const ret = t.TransactionType === RTYPE;
      return {
        SaleID: id, TransactionNumber: t.TransactionNumber || '', TransactionDate: t.TransactionDate, CreatedBy: t.CreatedBy || '',
        CustomerName: t.BillToName || (t.RetailCustomer ? RETAIL_CUSTOMER : ret ? '' : t.Description.replace(/^Retail sale — /, '')),
        Total: ret ? -t.Total : t.Total, Paid: ret ? 0 : t.Paid, Change: ret ? 0 : t.Change,
        OnAccount: ret ? -round2((t.OnAccountReduced || 0) + (t.CreditOnAccount || 0)) : (t.OnAccount || 0),
        Payments: ret ? (t.Refunds || []).map(f => ({ Name: f.Name, Kind: f.Kind, Reference: f.Reference || '', Posted: -f.Amount }))
          : (t.Payments || []).map(p => ({ Name: p.Name, Kind: p.Kind, Reference: p.Reference || '', Posted: p.Posted })),
        Return: ret, ReturnOf: ret ? t.ReturnOfSaleNumber || '' : '',
        Reversal: !!(t.ReversalOfSaleID || t.ReversalOfReturnID), ReversedBy: t.ReversedBySaleID || t.ReversedByReturnID || '',
        ReversalOf: t.ReversalOfSaleID || t.ReversalOfReturnID || ''
      };
    })
    .sort((a, b) => (b.TransactionDate + b.TransactionNumber).localeCompare(a.TransactionDate + a.TransactionNumber));
  const live = sales.filter(x => !x.Reversal && !x.ReversedBy);
  const payments = [];
  live.forEach(x => x.Payments.filter(p => Math.abs(p.Posted) > 0.005).forEach(p => payments.push({
    Method: p.Name, TransactionDate: x.TransactionDate, TransactionNumber: x.TransactionNumber, SaleID: x.SaleID,
    CustomerName: x.CustomerName, Reference: p.Reference, Amount: p.Posted, CreatedBy: x.CreatedBy, Return: x.Return
  })));
  payments.sort((a, b) => a.Method.localeCompare(b.Method) || (a.TransactionDate + a.TransactionNumber).localeCompare(b.TransactionDate + b.TransactionNumber));
  const byMethod = {};
  payments.forEach(p => {
    const m = byMethod[p.Method] || (byMethod[p.Method] = { Name: p.Method, Count: 0, Amount: 0 });
    m.Count += 1; m.Amount = round2(m.Amount + p.Amount);
  });
  return {
    sales, payments, byMethod: Object.values(byMethod).sort((a, b) => a.Name.localeCompare(b.Name)),
    onAccount: round2(live.reduce((t, x) => t + (x.OnAccount || 0), 0)),
    total: round2(live.reduce((t, x) => t + x.Total, 0)),
    returns: round2(-live.filter(x => x.Return).reduce((t, x) => t + x.Total, 0)),
    all, billers: all ? billers : [], billedBy
  };
});

async function loadSale(user, saleId) {
  const t = saleId && (await val(TX + saleId));
  if (!t || (t.TransactionType !== TYPE && t.TransactionType !== RTYPE)) throw new HttpsError('not-found', 'Retail sale not found.');
  if (!userCanAccessCompany(user.profile, t.CompanyID)) throw new HttpsError('permission-denied', 'You do not have access to that company.');
  if (!isOwn(user, t) && !(await canSeeAll(user))) throw new HttpsError('permission-denied', 'You can open only the sales you billed yourself.');
  return t;
}

exports.getRetailSale = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  await requireCap(user, 'access');
  const d = request.data || {};
  let saleId = String(d.saleId || '').trim();
  // Opened from the GL report: the journal's sale.
  if (!saleId && d.jvId) {
    const e = (await firestore.collection(FIRESTORE_JOURNAL_ENTRIES_COLLECTION).doc(String(d.jvId)).get()).data();
    if (!e || (e.VoucherType !== TYPE && e.VoucherType !== RTYPE)) throw new HttpsError('not-found', 'That journal was not posted by Retail Sales.');
    saleId = e.SourceTransactionID;
  }
  const t = await loadSale(user, saleId);
  const company = (await val('companies/' + t.CompanyID)) || {};
  // A sale's returns, and the barcode of its number for the receipt (a
  // return scans it, decision 76).
  const returns = t.TransactionType === TYPE ? returnsOf(await val('stock/transactions'), saleId)
    .map(r => ({ ReturnID: r.ReturnID, TransactionNumber: r.TransactionNumber, TransactionDate: r.TransactionDate, Total: r.Total })) : [];
  return {
    sale: Object.assign({ SaleID: saleId }, t),
    returns,
    numberBarcode: t.TransactionType === TYPE && t.TransactionNumber && !t.ReversalOfSaleID ? BarcodeSvg.svg(t.TransactionNumber) : '',
    company: { LegalName: company.LegalName || '', Address: [company.AddressLine1, company.AddressLine2, company.City].filter(Boolean).join(', '), TaxNumbers: (company.TaxNumbers || []).filter(x => x.Number) }
  };
});

// Whole sale only (decision 55): the stock comes back In at the cost it left
// at, every GL line is mirrored. Refused while a balance it left on account
// has been settled (reverse that payment first).
exports.reverseRetailSale = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  await requireCap(user, 'post');
  const d = request.data || {};
  const saleId = String(d.saleId || '').trim();
  const reason = String(d.reason || '').trim();
  if (!reason) throw new HttpsError('invalid-argument', 'Enter the reason for reversing the sale.');

  return withGlobalLock(user.uid, async () => {
    const t = await loadSale(user, saleId);
    if (t.Status !== 'Posted') throw new HttpsError('failed-precondition', 'Only a confirmed sale can be reversed.');
    if (t.ReversedBySaleID) throw new HttpsError('failed-precondition', 'This sale has already been reversed.');
    if (t.ReversalOfSaleID) throw new HttpsError('failed-precondition', 'A reversal cannot itself be reversed.');
    if (t.TransactionType !== TYPE) throw new HttpsError('failed-precondition', 'A return is reversed from the return itself.');
    // Partial returns (decisions 76-79): once part of it has come back, what
    // is left is returned instead.
    const returned = returnsOf(await val('stock/transactions'), saleId);
    if (returned.length) throw new HttpsError('failed-precondition', 'Part of this sale has been returned (' + returned.map(r => r.TransactionNumber).join(', ') + '); return the rest instead of reversing it.');
    const glRef = firestore.collection(FIRESTORE_JOURNAL_ENTRIES_COLLECTION).doc(t.LinkedJVID);
    const glDoc = await glRef.get();
    if (!glDoc.exists) throw new Error('The GL entry of this sale was not found.');
    const glEntry = glDoc.data();
    await assertEntryReversible(t.LinkedJVID, Object.assign({}, glEntry, { ReversalOfJV: '' }));

    const date = String(d.reversalDate || '').trim() || new Date().toISOString().substring(0, 10);
    if (date < t.TransactionDate) throw new HttpsError('invalid-argument', 'The reversal date can\'t be before the sale (' + t.TransactionDate + ').');
    const [items, coa] = await Promise.all([val('items'), val('coa')]);
    const movementLines = (t.Lines || []).map(l => Object.assign({}, l, { Direction: 'In' }));
    const movement = await computeStockMovement(items || {}, coa || {}, movementLines);
    const glLines = (glEntry.Lines || []).map(l => {
      const out = {
        AccountCode: l.AccountCode, Debit: l.Credit || 0, Credit: l.Debit || 0, Description: 'Reversal — ' + (l.Description || ''),
        CostCenterID: l.CostCenterID || '', ProfitCenterID: l.ProfitCenterID || ''
      };
      if (l.PartyType) Object.assign(out, { PartyType: l.PartyType, PartyID: l.PartyID, PartyName: l.PartyName || '', Allocations: [] });
      return out;
    });

    const now = new Date().toISOString();
    const actor = actorOf(user);
    const newId = 'RS-' + randomUUID().split('-')[0].toUpperCase();
    const attemptId = randomUUID();
    const description = 'Reversal of ' + t.TransactionNumber + ' — ' + reason;
    await rtdb.ref(TX + newId).set(Object.assign({}, t, {
      Status: 'Committing', CommitAttemptID: attemptId, CommitAttemptStartedAt: now, TransactionDate: date, Description: description,
      Reference: t.TransactionNumber, Lines: movementLines, ReversalOfSaleID: saleId, ReversedBySaleID: '', ReversalReason: reason,
      TransactionNumber: '', TransactionRef: '', LinkedJVID: '', CreatedAt: now, CreatedBy: actor, UpdatedAt: now, UpdatedBy: actor
    }));
    let glResult;
    try {
      glResult = await writeStockGlEntry(user, TYPE, date, description, t.TransactionNumber, glLines,
        { CompanyID: t.CompanyID, DivisionID: '', BranchID: '', CostCenterID: t.CostCenterID || '', ProfitCenterID: '' },
        { CommitAttemptID: attemptId, SourceTransactionID: newId, ReversalOfJV: t.LinkedJVID, PartyKeys: glEntry.PartyKeys || [], AllocatedRefs: [], AllocatedRefTypes: [] });
    } catch (err) {
      await rtdb.ref(TX + newId).set(null);
      throw err;
    }
    // A GL entry genuinely exists from here on — no more reverting.
    await commitStockLedgerUpdates(movement.ledgerUpdates);
    await glRef.update({ ReversedByJV: glResult.jvId, UpdatedAt: now, UpdatedBy: actor });
    await rtdb.ref(TX + saleId).update({ ReversedBySaleID: newId, ReversalReason: reason, UpdatedAt: now, UpdatedBy: actor });
    await finalizeCommitAttempt(newId, glResult, { Lines: movementLines }, actor);
    return { success: true, saleId: newId, saleNumber: glResult.jvNumber };
  });
});

// ---------- partial returns (decisions 76-79) ----------

const liveTx = t => t.Status === 'Posted' && !t.ReversedBySaleID && !t.ReversalOfSaleID && !t.ReversedByReturnID && !t.ReversalOfReturnID;
// A sale's live returns (neither reversed nor a reversal).
const returnsOf = (txs, saleId) => Object.entries(txs || {})
  .filter(([, t]) => t.TransactionType === RTYPE && t.ReturnOfSaleID === saleId && liveTx(t))
  .map(([id, t]) => Object.assign({ ReturnID: id }, t));

// What the live returns have taken so far: per sale line (quantity, list,
// discount), per original payment row (refund), and the totals.
function returnedSoFar(returns) {
  const lines = {}, refunds = {};
  let tax = 0, discountNet = 0, total = 0, onAccount = 0;
  returns.forEach(r => {
    (r.Lines || []).forEach(l => {
      const x = lines[l.SaleLineNo] || (lines[l.SaleLineNo] = { Quantity: 0, ListAmount: 0, Discount: 0 });
      x.Quantity = round6(x.Quantity + l.Quantity); x.ListAmount = round2(x.ListAmount + l.ListAmount); x.Discount = round2(x.Discount + l.Discount);
    });
    (r.Refunds || []).forEach(f => { refunds[f.FromRow] = round2((refunds[f.FromRow] || 0) + f.Amount); });
    tax = round2(tax + (r.TaxAmount || 0)); discountNet = round2(discountNet + (r.DiscountNet || 0));
    total = round2(total + (r.Total || 0)); onAccount = round2(onAccount + (r.OnAccountReduced || 0));
  });
  return { lines, refunds, tax, discountNet, total, onAccount };
}

// The returned lines' values: what the customer paid for each unit (its
// price less its share of the line's discount, pro rata by quantity); the
// last unit of a line takes the exact remainder, and a return that
// completes the sale takes what is left of its tax and discount, so the
// returns add up to the sale to the cent.
function computeReturn(sale, prior, wanted, uoms) {
  const lines = [];
  const seen = new Set();
  (wanted || []).forEach(w => {
    const qty = round6(Number(w.Quantity) || 0);
    if (!qty) return;
    if (seen.has(Number(w.SaleLineNo))) throw new Error('Each line of the sale can be given once.');
    seen.add(Number(w.SaleLineNo));
    const l = (sale.Lines || []).find(x => x.LineNo === Number(w.SaleLineNo));
    if (!l) throw new Error('That line is not on the sale.');
    const n = l.ItemCode + ': ';
    if (qty < 0) throw new Error(n + 'the quantity to return must be greater than zero.');
    const done = prior.lines[l.LineNo] || { Quantity: 0, ListAmount: 0, Discount: 0 };
    const left = round6(l.Quantity - done.Quantity);
    if (qty > left + 0.000001) throw new Error(n + (left > 0 ? 'only ' + left + ' left to return (sold ' + l.Quantity + ', returned ' + done.Quantity + ').' : 'everything sold has been returned.'));
    const uom = uoms && uoms[l.UOMID];
    if (uom && !uom.AllowDecimals && Math.abs(qty - Math.round(qty)) > 0.0001) throw new Error(n + (uom.Code || 'this unit') + ' does not allow decimal quantities.');
    const last = Math.abs(qty - left) < 0.000001;
    const listAmount = last ? round2(l.ListAmount - done.ListAmount) : round2(l.ListAmount * qty / l.Quantity);
    const discount = last ? round2(l.Discount - done.Discount) : round2(l.Discount * qty / l.Quantity);
    if (!(Number(l.UnitCost) > 0)) throw new Error(n + 'it left the store at no recorded cost, so it cannot be returned into stock.');
    lines.push({
      LineNo: lines.length + 1, SaleLineNo: l.LineNo, Direction: 'In', ItemID: l.ItemID, ItemCode: l.ItemCode, ItemName: l.ItemName,
      WarehouseID: l.WarehouseID, Quantity: qty, UnitPrice: l.UnitPrice, ListAmount: listAmount, Discount: discount,
      Amount: round2(listAmount - discount), UnitCost: Number(l.UnitCost), CostCenterID: l.CostCenterID || '', ProfitCenterID: '',
      Description: l.Description
    });
  });
  if (!lines.length) throw new Error('Enter the quantity to return on at least one line.');
  const rate = Number(sale.TaxPercent) || 0;
  const completes = (sale.Lines || []).every(l => {
    const done = (prior.lines[l.LineNo] || {}).Quantity || 0;
    const now = lines.filter(x => x.SaleLineNo === l.LineNo).reduce((t, x) => t + x.Quantity, 0);
    return Math.abs(l.Quantity - done - now) < 0.000001;
  });
  const listAmount = round2(lines.reduce((t, l) => t + l.ListAmount, 0));
  const discount = round2(lines.reduce((t, l) => t + l.Discount, 0));
  const total = round2(listAmount - discount);
  const taxAmount = completes ? round2((sale.TaxAmount || 0) - prior.tax) : round2(total * rate / (100 + rate));
  const discountNet = completes ? round2((sale.DiscountNet || 0) - prior.discountNet) : round2(discount * 100 / (100 + rate));
  return {
    lines, completes,
    totals: { TaxPercent: rate, ListAmount: listAmount, Discount: discount, Total: total, TaxAmount: taxAmount, DiscountNet: discountNet, Revenue: round2(total - taxAmount + discountNet) }
  };
}

// The refund (decision 77): an open on-account balance of the sale is
// reduced first; the rest goes back the way it was paid, pro rata over
// what each payment row still has to give back (a row's last refund takes
// its exact remainder). More than the payments can give (the balance was
// settled meanwhile) is left as a credit on the customer's account.
function splitRefund(sale, prior, total, openOnAccount) {
  const reduce = round2(Math.max(0, Math.min(total, openOnAccount)));
  const rest = round2(total - reduce);
  const rows = (sale.Payments || []).map((p, i) => ({ row: i, p, avail: round2((p.Posted || 0) - (prior.refunds[i] || 0)) })).filter(x => x.avail > 0.005);
  const sumAvail = round2(rows.reduce((t, x) => t + x.avail, 0));
  const toMethods = round2(Math.min(rest, sumAvail));
  const shares = rows.map(x => ({ row: x.row, p: x.p, amount: toMethods >= sumAvail - 0.005 ? x.avail : round2(toMethods * x.avail / sumAvail) }));
  const diff = round2(toMethods - shares.reduce((t, x) => t + x.amount, 0));
  if (Math.abs(diff) > 0.001 && shares.length) {
    const big = shares.reduce((a, b) => (b.amount > a.amount ? b : a));
    big.amount = round2(big.amount + diff);
  }
  return { reduce, credit: round2(rest - toMethods), shares: shares.filter(x => x.amount > 0.005) };
}

const today = () => new Date().toISOString().substring(0, 10);
const addDays = (date, n) => { const d = new Date(date + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().substring(0, 10); };

async function requireReturnRight(user) {
  if (!(await moduleHasCapability(MODULE_ID, 'return', user.profile.role))) {
    throw new HttpsError('permission-denied', 'You do not have the right to take returns in Retail Sales.');
  }
}

// The sale by its invoice number (decision 76): typed, or scanned from the
// barcode on the receipt. Any cashier with the return right finds it by
// its exact number, whoever billed it.
async function saleByNumber(user, companyId, number) {
  requireCompany(user, companyId);
  const key = String(number || '').trim().toUpperCase();
  if (!key) throw new HttpsError('invalid-argument', 'Enter or scan the invoice number.');
  const txs = (await val('stock/transactions')) || {};
  const hit = Object.entries(txs).find(([, t]) => t.TransactionType === TYPE && t.CompanyID === companyId && t.Status === 'Posted' &&
    (String(t.TransactionNumber || '').toUpperCase() === key || String(t.TransactionRef || '').toUpperCase() === key));
  if (!hit) throw new HttpsError('not-found', 'No retail sale ' + key + ' in this company.');
  const [saleId, t] = hit;
  if (t.ReversalOfSaleID) throw new HttpsError('failed-precondition', key + ' is the reversal of a sale, not a sale.');
  if (t.ReversedBySaleID) throw new HttpsError('failed-precondition', 'Sale ' + key + ' has been reversed; there is nothing to return.');
  return { saleId, sale: t, txs };
}

// The sale's open on-account balance, from its receivables line.
async function openOnAccountOf(sale, customer) {
  if (!(sale.OnAccount > 0.005) || !sale.LinkedJVID) return { open: 0, refId: '' };
  const e = (await firestore.collection(FIRESTORE_JOURNAL_ENTRIES_COLLECTION).doc(sale.LinkedJVID).get()).data() || {};
  const line = (e.Lines || []).find(l => l.PartyType === 'Customer' && (l.Allocations || []).some(a => a.RefType === 'New'));
  if (!line) return { open: 0, refId: '' };
  const refId = 'NewRef:' + sale.LinkedJVID + ':' + line.LineNo;
  const item = (await getOpenItemsForParty('Customer', sale.CustomerID, customer)).get(refId);
  return { open: round2(Math.max(0, item ? item.Outstanding : 0)), refId };
}

function returnView(saleId, t, prior, settings) {
  return {
    SaleID: saleId, TransactionNumber: t.TransactionNumber, TransactionDate: t.TransactionDate, CompanyID: t.CompanyID,
    CustomerName: t.BillToName || (t.RetailCustomer ? RETAIL_CUSTOMER : t.Description.replace(/^Retail sale — /, '')),
    Total: t.Total, OnAccount: t.OnAccount || 0, CreatedBy: t.CreatedBy || '',
    Payments: (t.Payments || []).map((p, i) => ({ Row: i, MethodID: p.MethodID, Name: p.Name, Kind: p.Kind, Posted: p.Posted, Refunded: prior.refunds[i] || 0 })),
    Lines: (t.Lines || []).map(l => {
      const done = (prior.lines[l.LineNo] || {}).Quantity || 0;
      return { SaleLineNo: l.LineNo, ItemID: l.ItemID, ItemCode: l.ItemCode, ItemName: l.ItemName, Quantity: l.Quantity, UnitPrice: l.UnitPrice, Amount: l.Amount, Returned: done, Left: round6(l.Quantity - done) };
    }),
    ReturnBy: settings && settings.ReturnDays ? addDays(t.TransactionDate, settings.ReturnDays) : ''
  };
}

exports.findRetailSaleForReturn = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  await requireReturnRight(user);
  const d = request.data || {};
  const companyId = String(d.companyId || '').trim();
  const { saleId, sale, txs } = await saleByNumber(user, companyId, d.number);
  const returns = returnsOf(txs, saleId);
  const settings = await loadSettings(companyId);
  return {
    sale: returnView(saleId, sale, returnedSoFar(returns), settings),
    returns: returns.map(r => ({ ReturnID: r.ReturnID, TransactionNumber: r.TransactionNumber, TransactionDate: r.TransactionDate, Total: r.Total, CreatedBy: r.CreatedBy || '' }))
  };
});

// Builds the return from live data: the lines, totals, the refund rows (and
// the cashier's moves of a card or QR share to cash), the GL lines. Used by
// the preview and by Confirm alike.
async function buildReturn(user, d) {
  const saleId = String(d.saleId || '').trim();
  const sale = saleId && (await val(TX + saleId));
  if (!sale || sale.TransactionType !== TYPE) throw new HttpsError('not-found', 'Retail sale not found.');
  requireCompany(user, sale.CompanyID);
  if (sale.Status !== 'Posted' || sale.ReversalOfSaleID) throw new HttpsError('failed-precondition', 'Only a confirmed sale can be returned.');
  if (sale.ReversedBySaleID) throw new HttpsError('failed-precondition', 'This sale has been reversed; there is nothing to return.');
  const settings = (await loadSettings(sale.CompanyID)) || {};
  const date = today();
  if (settings.ReturnDays && date > addDays(sale.TransactionDate, settings.ReturnDays)) {
    throw new HttpsError('failed-precondition', 'Sale ' + sale.TransactionNumber + ' of ' + sale.TransactionDate + ' is past the return period of ' + settings.ReturnDays + ' days (until ' + addDays(sale.TransactionDate, settings.ReturnDays) + ').');
  }
  const reason = String(d.reason || '').trim();
  const [txs, items, uoms, coa, customers, salesTypes, methods] = await Promise.all([
    val('stock/transactions'), val('items'), val('uoms'), val('coa'), val('customers'), val('salesTypes'), methodsOf(sale.CompanyID)
  ]);
  const prior = returnedSoFar(returnsOf(txs, saleId));
  const itemUoms = {};
  Object.values(sale.Lines || {}).forEach(l => { const it = (items || {})[l.ItemID]; if (it) itemUoms[l.ItemID] = it.UOMID; });
  const ret = computeReturn(Object.assign({}, sale, { Lines: (sale.Lines || []).map(l => Object.assign({ UOMID: itemUoms[l.ItemID] }, l)) }), prior, d.Lines, uoms);
  const customer = (customers || {})[sale.CustomerID] || {};
  const { open, refId } = await openOnAccountOf(sale, customer);
  const split = splitRefund(sale, prior, ret.totals.Total, open);
  if (split.credit > 0.005 && (sale.RetailCustomer || !customer.TradeReceivablesAccountID)) {
    throw new Error('The refund ' + ret.totals.Total.toFixed(2) + ' is more than the payments can give back.');
  }

  // Decision 77: a card, QR or other share may be paid out as cash; a
  // promotion is always reversed to its own account.
  const payAs = d.PayAs || {};
  const refs = d.References || {};
  const refunds = split.shares.map(x => {
    const from = x.p;
    const wantId = String(payAs[x.row] || '').trim() || from.MethodID;
    let m = methods.find(z => z.MethodID === wantId);
    if (wantId !== from.MethodID) {
      if (from.Kind === 'Promotion') throw new Error(from.Name + ': a promotion is reversed, not paid out.');
      if (!m || m.Status !== 'Active' || m.Kind !== 'Cash') throw new Error(from.Name + ': its refund can be paid back the same way or in cash only.');
    }
    if (!m) m = { MethodID: from.MethodID, Name: from.Name, Kind: from.Kind, AccountID: from.AccountID };
    if (!postable(coa[m.AccountID], sale.CompanyID)) throw new Error(m.Name + ': its ledger account is no longer valid — check the Retail Sales setup.');
    return { FromRow: x.row, FromName: from.Name, FromKind: from.Kind, MethodID: m.MethodID, Name: m.Name, Kind: m.Kind, AccountID: m.AccountID, Amount: x.amount, Reference: String(refs[x.row] || '').trim() };
  });

  const st = (salesTypes || {})[sale.SalesTypeID] || {};
  const returnsAcc = st.SalesReturnsAccountID && coa[st.SalesReturnsAccountID];
  if (!postable(returnsAcc, sale.CompanyID)) throw new Error('Sales Type "' + (st.Name || sale.SalesTypeName || '') + '" has no valid Sales Returns account — set it in Sales Invoice Configuration.');
  return { saleId, sale, settings, reason, date, ret, split, refunds, refId, customer, coa, items: items || {}, returnsAcc };
}

async function returnGlLines(b) {
  const { sale, ret, split, refunds, coa, items, returnsAcc } = b;
  const dims = { CostCenterID: sale.CostCenterID || '', ProfitCenterID: '' };
  const label = 'Return of ' + sale.TransactionNumber;
  const gl = [Object.assign({ AccountCode: returnsAcc.AccountCode, Debit: ret.totals.Revenue, Credit: 0, Description: label }, dims)];
  if (ret.totals.DiscountNet > 0) {
    const acc = await companyAccount(sale.CompanyID, 'DiscountGivenAccountID', 'Discount Given Account', coa);
    gl.push(Object.assign({ AccountCode: acc.AccountCode, Debit: 0, Credit: ret.totals.DiscountNet, Description: 'Discount given reversed — ' + label }, dims));
  }
  if (ret.totals.TaxAmount > 0) {
    const acc = await companyAccount(sale.CompanyID, 'OutputTaxAccountID', 'Output Tax Account', coa);
    gl.push(Object.assign({ AccountCode: acc.AccountCode, Debit: ret.totals.TaxAmount, Credit: 0, Description: 'Output tax reversed — ' + label }, dims));
  }
  refunds.forEach(f => gl.push(Object.assign({
    AccountCode: coa[f.AccountID].AccountCode, Debit: 0, Credit: f.Amount,
    Description: (f.FromKind === 'Promotion' ? 'Promotion reversed' : 'Refund') + ' — ' + f.Name + (f.Reference ? ' ' + f.Reference : '') + ' — ' + label
  }, dims)));
  if (split.reduce > 0.005 || split.credit > 0.005) {
    const ar = coa[b.customer.TradeReceivablesAccountID];
    if (!ar || !ar.IsPostable) throw new Error((b.customer.CustomerName || 'The customer') + '\'s Trade Receivables account is no longer valid.');
    const allocations = [];
    if (split.reduce > 0.005) allocations.push({ RefType: 'Against', RefID: b.refId, Amount: split.reduce, RefNumber: sale.TransactionNumber || '' });
    if (split.credit > 0.005) allocations.push({ RefType: 'New', RefID: '', Amount: split.credit });
    gl.push(Object.assign({
      AccountCode: ar.AccountCode, Debit: 0, Credit: round2(split.reduce + split.credit), Description: 'On account — ' + label,
      PartyType: 'Customer', PartyID: sale.CustomerID, PartyName: b.customer.CustomerName || b.customer.CustomerCode || '', Allocations: allocations
    }, dims));
  }
  return gl;
}

// Preview (preview: true) shows the values and the refund without writing;
// otherwise the return is confirmed under the global lock.
exports.confirmRetailReturn = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  await requireReturnRight(user);
  const d = request.data || {};
  const summary = b => ({
    total: b.ret.totals.Total, tax: b.ret.totals.TaxAmount, onAccountReduced: b.split.reduce, creditOnAccount: b.split.credit,
    refunds: b.refunds.map(f => ({ FromRow: f.FromRow, FromName: f.FromName, FromKind: f.FromKind, MethodID: f.MethodID, Name: f.Name, Amount: f.Amount }))
  });
  if (d.preview === true) return Object.assign({ success: true, preview: true }, summary(await buildReturn(user, d)));
  if (!String(d.reason || '').trim()) throw new HttpsError('invalid-argument', 'Enter the reason for the return.');

  return withGlobalLock(user.uid, async () => {
    const b = await buildReturn(user, d);
    const { sale } = b;
    const movement = await computeStockMovement(b.items, b.coa, b.ret.lines);
    const cogs = b.ret.lines.map((l, idx) => {
      const item = b.items[l.ItemID];
      const acc = b.coa[item.SalesCogsAccountID || item.ConsumptionAccountID];
      if (!acc || !acc.IsPostable) throw new Error('Line ' + (idx + 1) + ': Sales COGS account for ' + item.ItemCode + ' is not valid — check Item Master.');
      return { AccountCode: acc.AccountCode, Debit: 0, Credit: l.TotalValue, Description: l.Description, CostCenterID: l.CostCenterID, ProfitCenterID: '' };
    });
    const glLines = (await returnGlLines(b)).concat(movement.inventoryGlLines, cogs);

    const now = new Date().toISOString();
    const actor = actorOf(user);
    const returnId = 'RR-' + randomUUID().split('-')[0].toUpperCase();
    const description = 'Return of ' + sale.TransactionNumber + ' — ' + b.reason;
    const record = Object.assign({
      TransactionType: RTYPE, TransactionDate: b.date, CompanyID: sale.CompanyID, DivisionID: '', BranchID: '',
      CostCenterID: sale.CostCenterID || '', ProfitCenterID: '', CustomerID: sale.CustomerID, RetailCustomer: !!sale.RetailCustomer,
      BillToName: sale.BillToName || '', BillToAddress: sale.BillToAddress || '', BillToTaxNumber: sale.BillToTaxNumber || '',
      SalesTypeID: sale.SalesTypeID, SalesTypeName: sale.SalesTypeName || '', WarehouseID: sale.WarehouseID,
      Description: description, Reason: b.reason, Reference: sale.TransactionNumber,
      ReturnOfSaleID: b.saleId, ReturnOfSaleNumber: sale.TransactionNumber
    }, b.ret.totals, {
      Lines: b.ret.lines, Refunds: b.refunds, OnAccountReduced: b.split.reduce, CreditOnAccount: b.split.credit,
      CostValue: round2(b.ret.lines.reduce((t, l) => t + l.TotalValue, 0)),
      Status: 'Draft', CreatedAt: now, CreatedBy: actor, UpdatedAt: now, UpdatedBy: actor
    });
    await rtdb.ref(TX + returnId).set(record);
    const attemptId = await beginCommitAttempt(returnId, actor);
    const party = b.split.reduce > 0.005 || b.split.credit > 0.005;
    let glResult;
    try {
      glResult = await writeStockGlEntry(user, RTYPE, b.date, description, sale.TransactionNumber, glLines,
        { CompanyID: sale.CompanyID, DivisionID: '', BranchID: '', CostCenterID: sale.CostCenterID || '', ProfitCenterID: '' },
        {
          CommitAttemptID: attemptId, SourceTransactionID: returnId, ReversalOfJV: '',
          PartyKeys: party ? ['Customer:' + sale.CustomerID] : [],
          AllocatedRefs: b.split.reduce > 0.005 ? [b.refId] : [], AllocatedRefTypes: b.split.reduce > 0.005 ? ['NewRef'] : []
        });
    } catch (err) {
      await rtdb.ref(TX + returnId).set(null);
      throw err;
    }
    // A GL entry genuinely exists from here on — no more reverting.
    await commitStockLedgerUpdates(movement.ledgerUpdates);
    await finalizeCommitAttempt(returnId, glResult, { Lines: b.ret.lines, CostValue: record.CostValue }, actor);
    return Object.assign({ success: true, returnId, returnNumber: glResult.jvNumber }, summary(b));
  });
});

// A mistaken return, reversed whole: the stock leaves again at the cost it
// came back at (refused when short), every GL line mirrored.
exports.reverseRetailReturn = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  await requireReturnRight(user);
  const d = request.data || {};
  const returnId = String(d.returnId || '').trim();
  const reason = String(d.reason || '').trim();
  if (!reason) throw new HttpsError('invalid-argument', 'Enter the reason for reversing the return.');

  return withGlobalLock(user.uid, async () => {
    const t = returnId && (await val(TX + returnId));
    if (!t || t.TransactionType !== RTYPE) throw new HttpsError('not-found', 'Return not found.');
    if (!userCanAccessCompany(user.profile, t.CompanyID)) throw new HttpsError('permission-denied', 'You do not have access to that company.');
    if (!isOwn(user, t) && !(await canSeeAll(user))) throw new HttpsError('permission-denied', 'You can reverse only the returns you took yourself.');
    if (t.Status !== 'Posted') throw new HttpsError('failed-precondition', 'Only a confirmed return can be reversed.');
    if (t.ReversedByReturnID) throw new HttpsError('failed-precondition', 'This return has already been reversed.');
    if (t.ReversalOfReturnID) throw new HttpsError('failed-precondition', 'A reversal cannot itself be reversed.');
    const glRef = firestore.collection(FIRESTORE_JOURNAL_ENTRIES_COLLECTION).doc(t.LinkedJVID);
    const glDoc = await glRef.get();
    if (!glDoc.exists) throw new Error('The GL entry of this return was not found.');
    const glEntry = glDoc.data();
    await assertEntryReversible(t.LinkedJVID, Object.assign({}, glEntry, { ReversalOfJV: '' }));

    const date = today() < t.TransactionDate ? t.TransactionDate : today();
    const [items, coa] = await Promise.all([val('items'), val('coa')]);
    const movementLines = (t.Lines || []).map(l => Object.assign({}, l, { Direction: 'Out', AtCost: true }));
    const movement = await computeStockMovement(items || {}, coa || {}, movementLines);
    const glLines = (glEntry.Lines || []).map(l => {
      const out = {
        AccountCode: l.AccountCode, Debit: l.Credit || 0, Credit: l.Debit || 0, Description: 'Reversal — ' + (l.Description || ''),
        CostCenterID: l.CostCenterID || '', ProfitCenterID: l.ProfitCenterID || ''
      };
      if (l.PartyType) Object.assign(out, { PartyType: l.PartyType, PartyID: l.PartyID, PartyName: l.PartyName || '', Allocations: [] });
      return out;
    });

    const now = new Date().toISOString();
    const actor = actorOf(user);
    const newId = 'RR-' + randomUUID().split('-')[0].toUpperCase();
    const attemptId = randomUUID();
    const description = 'Reversal of ' + t.TransactionNumber + ' — ' + reason;
    await rtdb.ref(TX + newId).set(Object.assign({}, t, {
      Status: 'Committing', CommitAttemptID: attemptId, CommitAttemptStartedAt: now, TransactionDate: date, Description: description,
      Reference: t.TransactionNumber, Lines: movementLines, ReversalOfReturnID: returnId, ReversedByReturnID: '', ReversalReason: reason,
      TransactionNumber: '', TransactionRef: '', LinkedJVID: '', CreatedAt: now, CreatedBy: actor, UpdatedAt: now, UpdatedBy: actor
    }));
    let glResult;
    try {
      glResult = await writeStockGlEntry(user, RTYPE, date, description, t.TransactionNumber, glLines,
        { CompanyID: t.CompanyID, DivisionID: '', BranchID: '', CostCenterID: t.CostCenterID || '', ProfitCenterID: '' },
        { CommitAttemptID: attemptId, SourceTransactionID: newId, ReversalOfJV: t.LinkedJVID, PartyKeys: glEntry.PartyKeys || [], AllocatedRefs: [], AllocatedRefTypes: [] });
    } catch (err) {
      await rtdb.ref(TX + newId).set(null);
      throw err;
    }
    // A GL entry genuinely exists from here on — no more reverting.
    await commitStockLedgerUpdates(movement.ledgerUpdates);
    await glRef.update({ ReversedByJV: glResult.jvId, UpdatedAt: now, UpdatedBy: actor });
    await rtdb.ref(TX + returnId).update({ ReversedByReturnID: newId, ReversalReason: reason, UpdatedAt: now, UpdatedBy: actor });
    await finalizeCommitAttempt(newId, glResult, { Lines: movementLines }, actor);
    return { success: true, returnId: newId, returnNumber: glResult.jvNumber };
  });
});

exports._test = { computeTotals, settlePayments, computeReturn, splitRefund, returnedSoFar };
// For label prices (docs/modules/ITEM_BARCODES.md, step 3).
Object.assign(module.exports, { pricesOn, loadSettings });
