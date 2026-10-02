// Master Data Import (owner, 2026-10-02; docs/modules/MASTER_IMPORT.md).
// Pick a master, copy its headers into Excel, fill it, paste it back:
// every row is checked (issues listed row by row) and imported only when
// none has an issue (all or nothing). Each row is saved through the
// master's own save function, so the rules are the same as entering it by
// hand, and codes the system makes (account, item, vendor, customer, a
// company's Ref Code) are never in the sheet. Rows point to other records
// by code or exact name, including a record created earlier in the same
// paste (by name). If a save still fails during the import, the records
// created in that run are removed again and the code counters put back.
// Part 1: Company, Organizational Units, Chart of Accounts, UOM, Item
// Sub-Category, Items, Vendors, Customers, Currencies.
const { HttpsError } = require('firebase-functions/v2/https');
const { onCallWithMessages } = require('./callable');
const { rtdb } = require('./firebaseAdmin');
const { requireUser, moduleHasCapability } = require('./auth');
const { userCanAccessCompany } = require('./glWriting');
const L = require('./legacy/codegs');
const { run } = require('./legacy/runtime');

const onCallOptions = { region: 'us-central1', timeoutSeconds: 540, memory: '512MiB' };
const MAX_ROWS = 2000;

// ---------- parsing ----------

// Text copied from Excel: tab-separated, a row per line; a cell holding a
// tab, a newline or a quote comes quoted ("..." with "" for a quote).
function parseSheet(text) {
  const rows = [];
  let row = [], cell = '', i = 0, quoted = false;
  const s = String(text || '').replace(/\r\n?/g, '\n');
  while (i < s.length) {
    const c = s[i];
    if (quoted) {
      if (c === '"' && s[i + 1] === '"') { cell += '"'; i += 2; continue; }
      if (c === '"') { quoted = false; i++; continue; }
      cell += c; i++; continue;
    }
    if (c === '"' && cell === '') { quoted = true; i++; continue; }
    if (c === '\t') { row.push(cell); cell = ''; i++; continue; }
    if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; i++; continue; }
    cell += c; i++;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows.map(r => r.map(v => v.trim())).filter(r => r.some(v => v !== ''));
}

const norm = v => String(v == null ? '' : v).trim().toUpperCase();
const squash = v => norm(v).replace(/[\s_\-/&]+/g, '');

// ---------- column types ----------

function yesNo(v) {
  const s = norm(v);
  if (['YES', 'Y', 'TRUE', '1'].includes(s)) return true;
  if (['NO', 'N', 'FALSE', '0', ''].includes(s)) return false;
  return null;
}
function number(v) {
  const s = String(v == null ? '' : v).trim().replace(/,/g, '');
  if (s === '') return '';
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}
// An allowed value by its stored form or its label, ignoring case and
// spacing ("Raw Material" = "RawMaterial").
function enumValue(v, values) {
  const s = squash(v);
  if (!s) return '';
  const hit = values.find(x => squash(x.value) === s || squash(x.label) === s);
  return hit ? hit.value : null;
}
const labelled = list => list.map(v => ({ value: v, label: v.replace(/([a-z])([A-Z])/g, '$1 $2') }));

const ITEM_CATEGORIES = labelled(['RawMaterial', 'SemiFinishedGood', 'FinishedGood', 'Consumable', 'Scrap']);
const ORG_UNIT_TYPES = labelled(['Division', 'Branch', 'Warehouse', 'Rack', 'CostCenter', 'ProfitCenter']);
const ACCOUNT_TYPES = labelled(['Asset', 'Liability', 'Equity', 'Revenue', 'COGS', 'Expense']);
const CASH_FLOW = labelled(['Operating', 'Investing', 'Financing']);
const VENDOR_CATEGORIES = labelled(['RawMaterialSupplier', 'ServiceProvider', 'Contractor', 'Utility', 'Other']);
const CUSTOMER_CATEGORIES = labelled(['Retailer', 'Wholesaler', 'Distributor', 'Government', 'Individual', 'Other']);
const VENDOR_CLASSES = labelled(['Local', 'Foreign']);

// ---------- the masters (Part 1) ----------
// columns: { h: header, key, req, type: text|yesno|number|enum|ref|email,
//   values (enum), ref (kind), note }. `save` is the master's own Code.gs
// save; `idKey` is where its result carries the new id; `path` is where
// the record lives (for undoing a failed import).
const C = (h, key, extra) => Object.assign({ h, key, type: 'text' }, extra || {});
const companyCol = C('Company', 'CompanyID', { type: 'ref', ref: 'company', note: 'Ref Code (e.g. 01) or the company\'s legal name. Empty: all companies.' });

const MASTERS = {
  COMPANY: {
    label: 'Company', module: 'COMPANYMASTER', save: 'saveCompany', idKey: 'companyId', path: 'companies', nameKey: 'LegalName',
    note: 'The Ref Code is given by the system. Accounts (GRN clearing, tax, etc.) are set on Company Master after the Chart of Accounts exists.',
    columns: [
      C('Legal Name', 'LegalName', { req: true }),
      C('Parent Company', 'ParentCompanyID', { type: 'ref', ref: 'company', self: true, note: 'Ref Code or legal name of an existing company, or of one above in this paste.' }),
      C('Address Line 1', 'AddressLine1'), C('Address Line 2', 'AddressLine2'), C('City', 'City'),
      C('State / Emirate', 'StateOrEmirate'), C('Country', 'Country'), C('Postal Code', 'PostalCode'),
      C('Tax Type', 'TaxType', { note: 'e.g. TRN' }), C('Tax Number', 'TaxNumber')
    ],
    sample: ['Acme Trading LLC', '', 'Office 101, Business Bay', '', 'Dubai', 'Dubai', 'United Arab Emirates', '', 'TRN', '100123456700003'],
    toData: r => ({ LegalName: r.LegalName, ParentCompanyID: r.ParentCompanyID, AddressLine1: r.AddressLine1, AddressLine2: r.AddressLine2,
      City: r.City, StateOrEmirate: r.StateOrEmirate, Country: r.Country, PostalCode: r.PostalCode,
      TaxNumbers: r.TaxType || r.TaxNumber ? [{ Type: r.TaxType, Number: r.TaxNumber }] : [] })
  },
  ORGUNIT: {
    label: 'Organizational Units', module: 'ORGUNITS', save: 'saveOrgUnit', idKey: 'unitId', path: 'orgUnits', nameKey: 'Name',
    note: 'A Rack\'s parent must be a Warehouse.',
    columns: [
      C('Type', 'Type', { req: true, type: 'enum', values: ORG_UNIT_TYPES }),
      C('Code', 'Code', { req: true, note: 'As on the form; must be unique.' }),
      C('Name', 'Name', { req: true }),
      companyCol,
      C('Parent', 'ParentUnitID', { type: 'ref', ref: 'orgUnit', self: true, note: 'Code or name of an existing unit, or of one above in this paste.' })
    ],
    sample: ['Warehouse', 'WH-MAIN', 'Main Store', '01', ''],
    toData: r => ({ Type: r.Type, Code: r.Code, Name: r.Name, CompanyID: r.CompanyID, ParentUnitID: r.ParentUnitID })
  },
  ACCOUNT: {
    label: 'Chart of Accounts', module: 'COA', save: 'saveAccount', idKey: 'accountId', path: 'coa', nameKey: 'AccountName',
    note: 'The account code is given by the system from the type and parent. A parent must be a header (Postable = No) of the same type.',
    columns: [
      C('Account Name', 'AccountName', { req: true }),
      C('Account Type', 'AccountType', { req: true, type: 'enum', values: ACCOUNT_TYPES }),
      C('Sub Type', 'AccountSubType', { note: 'Optional, e.g. Cash, Bank.' }),
      C('Postable', 'IsPostable', { req: true, type: 'yesno', note: 'Yes for an account entries post to; No for a header.' }),
      C('Parent Account', 'ParentAccountID', { type: 'ref', ref: 'account', self: true, note: 'Code or name of an existing header, or of one above in this paste.' }),
      companyCol,
      C('Cash Flow Category', 'CashFlowCategory', { type: 'enum', values: CASH_FLOW, note: 'Headers only: Operating, Investing or Financing.' })
    ],
    sample: ['Petty Cash', 'Asset', 'Cash', 'Yes', '100000', '', ''],
    toData: r => ({ AccountName: r.AccountName, AccountType: r.AccountType, AccountSubType: r.AccountSubType, IsPostable: r.IsPostable,
      ParentAccountID: r.ParentAccountID, CompanyID: r.CompanyID, CashFlowCategory: r.IsPostable ? '' : r.CashFlowCategory })
  },
  UOM: {
    label: 'Unit of Measure', module: 'UOM', save: 'saveUOM', idKey: 'uomId', path: 'uoms', nameKey: 'Name',
    columns: [
      C('Code', 'Code', { req: true, note: 'As on the form, e.g. PCS; must be unique.' }),
      C('Name', 'Name', { req: true }),
      C('Allow Decimals', 'AllowDecimals', { type: 'yesno' }),
      C('Decimal Places', 'DecimalPlaces', { type: 'number', note: '0 to 6, with Allow Decimals = Yes.' })
    ],
    sample: ['KG', 'Kilogram', 'Yes', '3'],
    toData: r => ({ Code: r.Code, Name: r.Name, AllowDecimals: r.AllowDecimals, DecimalPlaces: r.DecimalPlaces === '' ? 0 : r.DecimalPlaces })
  },
  SUBCATEGORY: {
    label: 'Item Sub-Category', module: 'ITEMSUBCAT', save: 'saveItemSubCategory', idKey: 'subCategoryId', path: 'itemSubCategories', nameKey: 'Name',
    columns: [
      C('Name', 'Name', { req: true }),
      C('Parent Category', 'ParentCategory', { req: true, type: 'enum', values: ITEM_CATEGORIES })
    ],
    sample: ['Steel Sheets', 'Raw Material'],
    toData: r => ({ Name: r.Name, ParentCategory: r.ParentCategory })
  },
  ITEM: {
    label: 'Items', module: 'ITEMMASTER', save: 'saveItem', idKey: 'itemId', path: 'items', nameKey: 'ItemName',
    note: 'The item code is given by the system from the category.',
    columns: [
      C('Item Name', 'ItemName', { req: true }),
      C('Category', 'Category', { req: true, type: 'enum', values: ITEM_CATEGORIES }),
      C('Sub-Category', 'SubCategoryID', { type: 'ref', ref: 'subCategory', note: 'Name of a sub-category of that category.' }),
      C('UOM', 'UOMID', { req: true, type: 'ref', ref: 'uom', note: 'UOM code, e.g. PCS.' }),
      C('Alternate UOM', 'AltUOMID', { type: 'ref', ref: 'uom' }),
      C('Conversion Factor', 'ConversionFactor', { type: 'number', note: 'Alternate UOM to base, with an Alternate UOM.' }),
      companyCol,
      C('Default Warehouse', 'DefaultWarehouseID', { type: 'ref', ref: 'warehouse', note: 'Warehouse code or name.' }),
      C('Inventory Account', 'InventoryAccountID', { req: true, type: 'ref', ref: 'account', note: 'Code or name; postable Asset.' }),
      C('Consumption Account', 'ConsumptionAccountID', { req: true, type: 'ref', ref: 'account', note: 'Postable Expense or COGS.' }),
      C('Sales COGS Account', 'SalesCogsAccountID', { type: 'ref', ref: 'account', note: 'Postable Expense or COGS.' }),
      C('Write-off Account', 'WriteOffAccountID', { type: 'ref', ref: 'account', note: 'Postable.' }),
      C('Batch Tracked', 'BatchTracked', { type: 'yesno' }),
      C('Reorder Level', 'ReorderLevel', { type: 'number' })
    ],
    sample: ['Steel Sheet 2mm', 'Raw Material', 'Steel Sheets', 'PCS', '', '', '01', 'WH-MAIN', '130100', '510100', '', '', 'No', '0'],
    toData: r => ({ ItemName: r.ItemName, Category: r.Category, SubCategoryID: r.SubCategoryID, UOMID: r.UOMID, AltUOMID: r.AltUOMID,
      ConversionFactor: r.AltUOMID ? r.ConversionFactor : '', CompanyID: r.CompanyID, DefaultWarehouseID: r.DefaultWarehouseID,
      InventoryAccountID: r.InventoryAccountID, ConsumptionAccountID: r.ConsumptionAccountID, SalesCogsAccountID: r.SalesCogsAccountID,
      WriteOffAccountID: r.WriteOffAccountID, BatchTracked: r.BatchTracked, ReorderLevel: r.ReorderLevel === '' ? 0 : r.ReorderLevel })
  },
  VENDOR: {
    label: 'Vendors', module: 'VENDORMASTER', save: 'saveVendor', idKey: 'vendorId', path: 'vendors', nameKey: 'VendorName',
    note: 'The vendor code is given by the system.',
    columns: [
      C('Vendor Name', 'VendorName', { req: true }),
      C('Category', 'Category', { type: 'enum', values: VENDOR_CATEGORIES }),
      companyCol,
      C('Classification', 'Classification', { req: true, type: 'enum', values: VENDOR_CLASSES }),
      C('Country', 'Country', { note: 'Required for a Foreign vendor.' }),
      C('Trade Payables Account', 'TradePayablesAccountID', { req: true, type: 'ref', ref: 'account', note: 'Code or name; postable Liability.' }),
      C('Payment Terms (days)', 'PaymentTermsDays', { type: 'number' }),
      C('Contact Person', 'ContactPerson'), C('Phone', 'Phone'), C('Email', 'Email', { type: 'email' }),
      C('Address Line 1', 'AddressLine1'), C('Address Line 2', 'AddressLine2'),
      C('Tax Registration Number', 'TaxRegistrationNumber'), C('Default Currency', 'DefaultCurrency', { note: 'Currency code, e.g. AED.' }),
      C('Bank Name', 'BankName'), C('Bank Account Number', 'BankAccountNumber'), C('IBAN', 'BankIBAN'), C('SWIFT', 'BankSwift'),
      C('Notes', 'Notes')
    ],
    sample: ['Acme Metals', 'Raw Material Supplier', '01', 'Local', '', '210100', '30', 'Ali', '+971 4 000 0000', 'ali@acme.example', '', '', '', 'AED', '', '', '', '', ''],
    toData: r => Object.assign({}, r, { PaymentTermsDays: r.PaymentTermsDays === '' ? 0 : r.PaymentTermsDays })
  },
  CUSTOMER: {
    label: 'Customers', module: 'CUSTOMERMASTER', save: 'saveCustomer', idKey: 'customerId', path: 'customers', nameKey: 'CustomerName',
    note: 'The customer code is given by the system.',
    columns: [
      C('Customer Name', 'CustomerName', { req: true }),
      C('Category', 'Category', { type: 'enum', values: CUSTOMER_CATEGORIES }),
      companyCol,
      C('Classification', 'Classification', { req: true, type: 'ref', ref: 'classification', note: 'Name of an active classification, e.g. Local or Export.' }),
      C('Country', 'Country', { note: 'Required for an export classification.' }),
      C('Trade Receivables Account', 'TradeReceivablesAccountID', { req: true, type: 'ref', ref: 'account', note: 'Code or name; postable Asset.' }),
      C('Payment Terms (days)', 'PaymentTermsDays', { type: 'number' }),
      C('Contact Person', 'ContactPerson'), C('Phone', 'Phone'), C('Email', 'Email', { type: 'email' }),
      C('Address Line 1', 'AddressLine1'), C('Address Line 2', 'AddressLine2'),
      C('Tax Registration Number', 'TaxRegistrationNumber'), C('Default Currency', 'DefaultCurrency', { note: 'Currency code, e.g. AED.' }),
      C('Bank Name', 'BankName'), C('Bank Account Number', 'BankAccountNumber'), C('IBAN', 'BankIBAN'), C('SWIFT', 'BankSwift'),
      C('Notes', 'Notes')
    ],
    sample: ['Gulf Retail LLC', 'Retailer', '01', 'Local', '', '120100', '30', 'Sara', '+971 4 000 0001', 'sara@gulf.example', '', '', '', 'AED', '', '', '', '', ''],
    toData: r => Object.assign({}, r, { PaymentTermsDays: r.PaymentTermsDays === '' ? 0 : r.PaymentTermsDays })
  },
  CURRENCY: {
    label: 'Currencies', module: 'CURRENCYCONFIG', save: 'saveCurrency', idKey: 'currencyId', path: 'currencies', nameKey: 'Name',
    note: 'The default currency is chosen on Currency Configuration.',
    columns: [
      C('Code', 'Code', { req: true, note: '3-letter ISO code, e.g. USD.' }),
      C('Name', 'Name', { req: true }),
      C('Symbol', 'Symbol')
    ],
    sample: ['USD', 'US Dollar', '$'],
    toData: r => ({ Code: r.Code, Name: r.Name, Symbol: r.Symbol })
  }
};
const ORDER = ['COMPANY', 'ORGUNIT', 'ACCOUNT', 'UOM', 'SUBCATEGORY', 'ITEM', 'VENDOR', 'CUSTOMER', 'CURRENCY'];

// ---------- references ----------

// Existing records each reference kind can point to: { id, code, name, rec }.
async function loadExisting() {
  const paths = ['companies', 'orgUnits', 'coa', 'uoms', 'itemSubCategories', 'customerClassifications', 'items', 'vendors', 'customers', 'currencies'];
  const vals = (await Promise.all(paths.map(p => rtdb.ref(p).get()))).map(s => s.val() || {});
  const data = {};
  paths.forEach((p, i) => { data[p] = vals[i]; });
  const list = (obj, code, name) => Object.keys(obj).map(id => ({ id, code: obj[id][code] || '', name: obj[id][name] || '', rec: obj[id] }));
  return {
    raw: data,
    company: list(data.companies, 'CompanyRefCode', 'LegalName'),
    orgUnit: list(data.orgUnits, 'Code', 'Name'),
    warehouse: list(data.orgUnits, 'Code', 'Name').filter(x => x.rec.Type === 'Warehouse'),
    account: list(data.coa, 'AccountCode', 'AccountName'),
    uom: list(data.uoms, 'Code', 'Name'),
    subCategory: list(data.itemSubCategories, '', 'Name'),
    classification: list(data.customerClassifications, '', 'Name').filter(x => x.rec.Status !== 'Inactive')
  };
}

// The kind a master's own records are, for references within one paste.
const SELF_KIND = { COMPANY: 'company', ORGUNIT: 'orgUnit', ACCOUNT: 'account' };

// ---------- checking ----------

// Checks a paste without writing anything. Returns the table, the
// resolved rows (references as ids, or { row } for one created earlier in
// this paste) and the issues, each { row, column, message } (row 0 = the
// header row).
async function checkPaste(user, masterKey, text) {
  const m = MASTERS[masterKey];
  if (!m) throw new HttpsError('invalid-argument', 'Choose what to import.');
  const issues = [];
  const add = (row, column, message) => issues.push({ row, column: column || '', message });
  if (!(await moduleHasCapability(m.module, 'write', user.profile.role))) {
    add(0, '', 'You do not have permission to change ' + m.label + ' (the import needs the same right as entering it by hand).');
  }
  const table = parseSheet(text);
  if (!table.length) return { headers: [], rows: [], resolved: [], issues: [{ row: 0, column: '', message: 'Paste the header row and at least one row.' }] };
  if (table.length - 1 > MAX_ROWS) add(0, '', 'At most ' + MAX_ROWS + ' rows in one paste.');

  // Headers: in any order; unknown or repeated ones are issues.
  const headers = table[0];
  const colAt = {};
  headers.forEach((h, i) => {
    const col = m.columns.find(c => squash(c.h) === squash(h.replace(/\*$/, '')));
    if (!col) add(0, h, 'Unknown column "' + h + '". Copy the headers again from this screen.');
    else if (col.key in colAt) add(0, h, 'Column "' + h + '" appears twice.');
    else colAt[col.key] = i;
  });
  m.columns.filter(c => c.req && !(c.key in colAt)).forEach(c => add(0, c.h, 'Required column "' + c.h + '" is missing.'));
  const body = table.slice(1);
  if (!body.length) add(0, '', 'There are no rows under the headers.');

  const ex = await loadExisting();
  const resolved = [];
  const namesInPaste = {}; // normalized name (+ scope) -> first row
  body.forEach((cells, idx) => {
    const rowNo = idx + 1;
    const r = {};
    const issue = (col, msg) => add(rowNo, col.h, msg);
    for (const col of m.columns) {
      const raw = col.key in colAt ? String(cells[colAt[col.key]] == null ? '' : cells[colAt[col.key]]).trim() : '';
      if (col.req && !raw) { issue(col, col.h + ' is required.'); r[col.key] = ''; continue; }
      if (col.type === 'yesno') {
        const v = yesNo(raw); if (v === null) issue(col, 'Enter Yes or No.'); r[col.key] = Boolean(v);
      } else if (col.type === 'number') {
        const v = number(raw); if (v === null) issue(col, '"' + raw + '" is not a number.'); r[col.key] = v === null ? '' : v;
      } else if (col.type === 'enum') {
        const v = enumValue(raw, col.values);
        if (v === null) issue(col, '"' + raw + '" is not one of: ' + col.values.map(x => x.label).join(', ') + '.');
        r[col.key] = v || '';
      } else if (col.type === 'email') {
        if (raw && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw)) issue(col, 'Enter a valid email address.');
        r[col.key] = raw;
      } else if (col.type === 'ref') {
        r[col.key] = raw; // resolved below, once the row's own values are known
      } else {
        r[col.key] = raw;
      }
    }
    // References: by code, or by exact name; the master's own kind may also
    // point to a row above in this paste (by name).
    // The company first: an account named in the row is looked for among
    // that company's accounts (and those for all companies).
    const refCols = m.columns.filter(c => c.type === 'ref').sort((a, b) => (b.ref === 'company') - (a.ref === 'company'));
    const refs = r; // resolved in place, so later references see the company's id
    for (const col of refCols) {
      const raw = r[col.key];
      if (!raw) { refs[col.key] = ''; continue; }
      let pool = ex[col.ref];
      if (col.ref === 'subCategory') pool = pool.filter(x => x.rec.ParentCategory === r.Category);
      if (col.ref === 'account' && masterKey !== 'ACCOUNT' && typeof r.CompanyID === 'string' && r.CompanyID) {
        pool = pool.filter(x => !x.rec.CompanyID || x.rec.CompanyID === r.CompanyID);
      }
      const byCode = pool.filter(x => x.code && norm(x.code) === norm(raw));
      let hits = byCode.length ? byCode : pool.filter(x => norm(x.name) === norm(raw));
      let above = [];
      if (col.self && !byCode.length) {
        above = resolved.map((o, i) => ({ o, i })).filter(({ o }) => o && norm(o.values[m.nameKey]) === norm(raw)).map(({ i }) => i + 1);
      }
      if (hits.length + above.length > 1) { issue(col, '"' + raw + '" matches more than one record; use its code.'); refs[col.key] = ''; continue; }
      if (hits.length) { refs[col.key] = hits[0].id; continue; }
      if (above.length) { refs[col.key] = { row: above[0] }; continue; }
      issue(col, '"' + raw + '" not found' + (col.self ? ' (nor in a row above)' : '') + '.');
      refs[col.key] = '';
    }
    const values = Object.assign({}, r);

    // The company, where a row names one: the user must have access to it.
    if (typeof r.CompanyID === 'string' && r.CompanyID && !userCanAccessCompany(user.profile, r.CompanyID)) {
      add(rowNo, 'Company', 'You do not have access to that company.');
    }
    masterRules(masterKey, r, ex, resolved, (h, msg) => add(rowNo, h, msg));

    // The same name twice (in the paste, or already existing) is an issue,
    // so a list pasted twice can't create everything twice.
    const name = norm(r[m.nameKey]);
    if (name) {
      const scope = dupScope(masterKey, r);
      const key = scope + '|' + name;
      if (namesInPaste[key]) add(rowNo, headerOf(m, m.nameKey), 'Same as row ' + namesInPaste[key] + '.');
      else namesInPaste[key] = rowNo;
      if (existingSameName(masterKey, r, ex)) add(rowNo, headerOf(m, m.nameKey), '"' + r[m.nameKey] + '" already exists.');
    }
    resolved.push({ values, data: r });
  });
  return { headers, rows: body, resolved, issues };
}

const headerOf = (m, key) => (m.columns.find(c => c.key === key) || {}).h || key;
const companyOf = v => (typeof v === 'string' ? v : '');
function dupScope(k, r) {
  if (k === 'ORGUNIT') return r.Type + '|' + companyOf(r.CompanyID);
  if (k === 'SUBCATEGORY') return r.ParentCategory;
  if (['ACCOUNT', 'ITEM', 'VENDOR', 'CUSTOMER'].includes(k)) return companyOf(r.CompanyID);
  return '';
}
function existingSameName(k, r, ex) {
  const n = norm(r[MASTERS[k].nameKey]);
  const same = (list, name, extra) => Object.values(list).some(x => norm(x[name]) === n && (!extra || extra(x)));
  const co = companyOf(r.CompanyID);
  switch (k) {
    case 'COMPANY': return same(ex.raw.companies, 'LegalName');
    case 'ORGUNIT': return same(ex.raw.orgUnits, 'Name', x => x.Type === r.Type && (x.CompanyID || '') === co);
    case 'ACCOUNT': return same(ex.raw.coa, 'AccountName', x => (x.CompanyID || '') === co);
    case 'UOM': return same(ex.raw.uoms, 'Name');
    case 'SUBCATEGORY': return same(ex.raw.itemSubCategories, 'Name', x => x.ParentCategory === r.ParentCategory);
    case 'ITEM': return same(ex.raw.items, 'ItemName', x => (x.CompanyID || '') === co);
    case 'VENDOR': return same(ex.raw.vendors, 'VendorName', x => (x.CompanyID || '') === co);
    case 'CUSTOMER': return same(ex.raw.customers, 'CustomerName', x => (x.CompanyID || '') === co);
    case 'CURRENCY': return same(ex.raw.currencies, 'Name');
    default: return false;
  }
}

// The master's own rules that can be checked before saving (the same as
// its save function's; the save checks them again).
function masterRules(k, r, ex, resolvedAbove, issue) {
  const acct = id => (typeof id === 'string' && id ? ex.raw.coa[id] : null);
  const postable = (id, label, types) => {
    const a = acct(id);
    if (!a) return;
    if (!a.IsPostable || a.Status !== 'Active') issue(label, label + ' must be an active, postable account.');
    else if (types && !types.includes(a.AccountType)) issue(label, label + ' must be ' + types.join(' or ') + '.');
    else if (a.CompanyID && companyOf(r.CompanyID) && a.CompanyID !== r.CompanyID) issue(label, label + ' belongs to a different company.');
  };
  const codeTaken = (list, code) => Object.values(list).some(x => norm(x.Code) === norm(code));
  const codeAbove = code => resolvedAbove.some(o => o && norm(o.data.Code) === norm(code));
  switch (k) {
    case 'ORGUNIT': {
      if (r.Code && (codeTaken(ex.raw.orgUnits, r.Code) || codeAbove(r.Code))) issue('Code', 'Code "' + r.Code + '" is already in use.');
      if (r.Type === 'Rack') {
        const p = r.ParentUnitID;
        const parentType = p && typeof p === 'object' ? (resolvedAbove[p.row - 1] || { data: {} }).data.Type : (ex.raw.orgUnits[p] || {}).Type;
        if (!p) issue('Parent', 'A Rack must have a Warehouse as its parent.');
        else if (parentType !== 'Warehouse') issue('Parent', 'A Rack\'s parent must be a Warehouse.');
      }
      break;
    }
    case 'ACCOUNT': {
      const p = r.ParentAccountID;
      const parent = p && typeof p === 'object' ? (resolvedAbove[p.row - 1] || { data: {} }).data : acct(p);
      if (parent) {
        if (parent.AccountType !== r.AccountType) issue('Parent Account', 'The parent must be the same account type.');
        if (parent.IsPostable === true) issue('Parent Account', 'The parent must be a header (Postable = No).');
        const pc = companyOf(parent.CompanyID);
        if (pc && pc !== companyOf(r.CompanyID)) issue('Parent Account', 'The parent belongs to a specific company; this account must be in the same one.');
      }
      if (r.IsPostable && r.CashFlowCategory) issue('Cash Flow Category', 'A cash flow category is for headers only.');
      break;
    }
    case 'UOM': {
      if (r.Code && (codeTaken(ex.raw.uoms, r.Code) || codeAbove(r.Code))) issue('Code', 'UOM code "' + norm(r.Code) + '" is already in use.');
      if (r.DecimalPlaces !== '' && (r.DecimalPlaces < 0 || r.DecimalPlaces > 6)) issue('Decimal Places', 'Decimal places must be 0 to 6.');
      break;
    }
    case 'ITEM': {
      if (r.AltUOMID) {
        if (r.AltUOMID === r.UOMID) issue('Alternate UOM', 'The alternate UOM must differ from the UOM.');
        if (!(r.ConversionFactor > 0)) issue('Conversion Factor', 'Enter a conversion factor greater than zero for the alternate UOM.');
      }
      postable(r.InventoryAccountID, 'Inventory Account', ['Asset']);
      postable(r.ConsumptionAccountID, 'Consumption Account', ['Expense', 'COGS']);
      postable(r.SalesCogsAccountID, 'Sales COGS Account', ['Expense', 'COGS']);
      postable(r.WriteOffAccountID, 'Write-off Account');
      break;
    }
    case 'VENDOR': {
      if (r.Classification === 'Foreign' && !r.Country) issue('Country', 'Enter the country of a Foreign vendor.');
      postable(r.TradePayablesAccountID, 'Trade Payables Account', ['Liability']);
      if (r.PaymentTermsDays !== '' && r.PaymentTermsDays < 0) issue('Payment Terms (days)', 'Payment terms must be zero or more.');
      break;
    }
    case 'CUSTOMER': {
      const cls = typeof r.Classification === 'string' ? ex.raw.customerClassifications[r.Classification] : null;
      if (cls && cls.IsExport && !r.Country) issue('Country', 'Enter the country of an export customer.');
      postable(r.TradeReceivablesAccountID, 'Trade Receivables Account', ['Asset']);
      if (r.PaymentTermsDays !== '' && r.PaymentTermsDays < 0) issue('Payment Terms (days)', 'Payment terms must be zero or more.');
      break;
    }
    case 'CURRENCY': {
      if (r.Code && !/^[A-Za-z]{3}$/.test(r.Code)) issue('Code', 'A currency code is 3 letters (e.g. USD).');
      else if (r.Code && (codeTaken(ex.raw.currencies, r.Code) || codeAbove(r.Code))) issue('Code', 'Currency code "' + norm(r.Code) + '" is already in use.');
      break;
    }
    default:
  }
}

// ---------- importing ----------

const COUNTERS = ['itemCounters', 'vendorCounters', 'customerCounters'];
const codeOfResult = res => res.itemCode || res.vendorCode || res.customerCode || '';
const counterOfCode = code => {
  const prefix = String(code).split('-')[0];
  if (!prefix) return '';
  if (prefix === 'VEN') return 'vendorCounters/VEN';
  if (prefix === 'CL' || prefix === 'CE') return 'customerCounters/' + prefix;
  return 'itemCounters/' + prefix;
};

// Saves every row through the master's own save function, in order.
// On a failure, removes what this run created and puts the code counters
// back (unless someone else used them meanwhile), then reports the row.
async function importRows(request, user, masterKey, resolved) {
  const m = MASTERS[masterKey];
  const snapshot = {};
  for (const c of COUNTERS) snapshot[c] = (await rtdb.ref(c).get()).val() || {};
  const created = []; // { row, id, code }
  let failure = null;
  await run(request, async (ctx) => {
    for (let i = 0; i < resolved.length; i++) {
      const data = m.toData(Object.assign({}, resolved[i].data));
      for (const k of Object.keys(data)) {
        if (data[k] && typeof data[k] === 'object' && !Array.isArray(data[k]) && data[k].row) data[k] = created[data[k].row - 1].id;
      }
      let res;
      try { res = await L[m.save](ctx, data); } catch (e) { res = { success: false, error: e.message }; }
      if (!res || !res.success || !res[m.idKey]) { failure = { row: i + 1, message: (res && res.error) || 'The record could not be saved.' }; break; }
      created.push({ row: i + 1, id: res[m.idKey], code: codeOfResult(res) });
    }
  });
  if (!failure) return { created };

  for (const c of created.slice().reverse()) await rtdb.ref(m.path + '/' + c.id).remove();
  const used = {};
  created.forEach(c => { const p = c.code && counterOfCode(c.code); if (p) used[p] = (used[p] || 0) + 1; });
  for (const p of Object.keys(used)) {
    const [root, key] = p.split('/');
    const before = Number(snapshot[root][key]) || 0;
    // A transaction's first try sees the local cache (null): answering null
    // makes it retry with the server's value instead of giving up.
    await rtdb.ref(p).transaction(cur => (cur === null ? null : (Number(cur) === before + used[p] ? before : undefined)));
  }
  return { created: [], failure };
}

// ---------- callables ----------

async function requireImportAccess(user) {
  if (!(await moduleHasCapability('MASTERIMPORT', 'access', user.profile.role))) {
    throw new HttpsError('permission-denied', 'You do not have access to Master Data Import.');
  }
}

// What can be imported, in the order to import it, with each one's columns.
exports.getMasterImportSpecs = onCallWithMessages({ region: 'us-central1' }, async (request) => {
  const user = await requireUser(request);
  await requireImportAccess(user);
  return ORDER.map(k => {
    const m = MASTERS[k];
    return {
      key: k, label: m.label, note: m.note || '', sample: m.sample || [],
      columns: m.columns.map(c => ({ header: c.h, required: Boolean(c.req), note: c.note || '',
        values: c.values ? c.values.map(v => v.label) : (c.type === 'yesno' ? ['Yes', 'No'] : []) }))
    };
  });
});

// Checks a paste (nothing is written).
exports.checkMasterImport = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  await requireImportAccess(user);
  const d = request.data || {};
  const c = await checkPaste(user, String(d.master || ''), d.text);
  return { headers: c.headers, rows: c.rows, issues: c.issues };
});

// Checks again, then imports, all or nothing.
exports.runMasterImport = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  await requireImportAccess(user);
  const d = request.data || {};
  const masterKey = String(d.master || '');
  const c = await checkPaste(user, masterKey, d.text);
  if (c.issues.length) return { success: false, issues: c.issues, created: 0 };
  const result = await importRows(request, user, masterKey, c.resolved);
  const log = {
    Master: masterKey, Rows: c.resolved.length, By: user.uid, ByName: user.profile.fullName || user.profile.username || user.uid,
    At: new Date().toISOString(), Status: result.failure ? 'Undone' : 'Imported',
    Created: result.created.map(x => x.id), Error: result.failure ? 'Row ' + result.failure.row + ': ' + result.failure.message : ''
  };
  await rtdb.ref('masterImports').push(log);
  if (result.failure) {
    return { success: false, created: 0, issues: [{ row: result.failure.row, column: '', message: result.failure.message + ' Nothing was imported.' }] };
  }
  return { success: true, created: result.created.length, codes: result.created.map(x => x.code).filter(Boolean) };
});

module.exports.parseSheet = parseSheet;
module.exports.MASTERS = MASTERS;
module.exports._importRows = importRows; // for the tests: the undo path, without a failing row having to pass the check
