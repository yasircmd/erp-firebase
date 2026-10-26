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
// Sub-Category, Items, Vendors, Customers, Currencies. Part 2: Customer
// Classifications, Sales Types, Requisition Categories, Fixed Asset Classes
// and Master, Bill of Materials, Inventory Valuation List, Price Lists and
// Users. Employees (docs/modules/HR_EMPLOYEES.md): its columns include the
// extra fields HR Setup defines. A BOM (its components) and a price list (its lines) take several
// rows, one per component or line, with the BOM's or list's own columns
// repeated.
const { HttpsError } = require('firebase-functions/v2/https');
const { onCallWithMessages } = require('./callable');
const { rtdb } = require('./firebaseAdmin');
const { requireUser, moduleHasCapability } = require('./auth');
const { userCanAccessCompany } = require('./glWriting');
const { firestore, admin } = require('./firebaseAdmin');
const L = require('./legacy/codegs');
const { run } = require('./legacy/runtime');
const { saveFaClassFor } = require('./fixedAssetsConfig');
const { saveFaAssetFor } = require('./fixedAssetsMaster');
const { validateValuation } = require('./faDepreciation');
const { saveEmployeeFor } = require('./hrEmployees');
const { loadSetup: loadHrSetup } = require('./hrSetup');
const { saveOpening: saveLeaveOpening } = require('./hrLeave');
const { saveProvisionOpening } = require('./payrollProvisions');
const { saveImportedBarcode, checkBarcode, checkPack } = require('./itemBarcodes');
const { leaveTypes: loadLeaveTypes } = require('./hrLeaveSetup');

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
// A date as shown everywhere (dd/mm/yyyy; also d/m/yyyy, dd-mm-yyyy,
// dd.mm.yyyy) or as stored (yyyy-mm-dd). Returns yyyy-mm-dd, '' or null.
function dateValue(v) {
  const s = String(v == null ? '' : v).trim();
  if (!s) return '';
  let y, m, d;
  let x = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (x) { y = +x[1]; m = +x[2]; d = +x[3]; } else {
    x = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);
    if (!x) return null;
    d = +x[1]; m = +x[2]; y = +x[3];
  }
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return y + '-' + String(m).padStart(2, '0') + '-' + String(d).padStart(2, '0');
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
const FA_KINDS = [{ value: 'Tangible', label: 'Tangible' }, { value: 'Land', label: 'Land' }, { value: 'Intangible', label: 'Intangible' },
  { value: 'AuC', label: 'Capital Work in Progress' }];
const FA_METHODS = [{ value: 'SL', label: 'Straight Line' }, { value: 'WDV', label: 'Written Down Value' }, { value: 'None', label: 'None' }];
const REQ_TYPES = [{ value: 'FixedAsset', label: 'Fixed Asset' }, { value: 'DirectExpense', label: 'Direct Expense' }];
const PRICE_MAPPINGS = labelled(['Local', 'Export']);

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
      C('Parent Category', 'ParentCategory', { req: true, type: 'enum', values: ITEM_CATEGORIES }),
      companyCol // shared or one company's (owner, 2026-10-14)
    ],
    sample: ['Steel Sheets', 'Raw Material', ''],
    toData: r => ({ Name: r.Name, ParentCategory: r.ParentCategory, CompanyID: r.CompanyID || '' })
  },
  ITEM: {
    label: 'Items', module: 'ITEMMASTER', save: 'saveItem', idKey: 'itemId', path: 'items', nameKey: 'ItemName',
    note: 'The item code is given by the system from the category.',
    columns: [
      C('Item Name', 'ItemName', { req: true }),
      C('Category', 'Category', { req: true, type: 'enum', values: ITEM_CATEGORIES }),
      // docs/modules/ITEM_USER_CODE.md: shown in place of the item code; unique.
      C('User Code', 'UserCode', { note: 'Optional: your own code, shown in place of the item code; unique.' }),
      C('Sub-Category', 'SubCategoryID', { type: 'ref', ref: 'subCategory', note: 'Name of a sub-category of that category.' }),
      C('UOM', 'UOMID', { req: true, type: 'ref', ref: 'uom', note: 'UOM code, e.g. PCS.' }),
      C('Alternate UOM', 'AltUOMID', { type: 'ref', ref: 'uom' }),
      C('Conversion Factor', 'ConversionFactor', { type: 'number', note: 'Alternate UOM to base, with an Alternate UOM.' }),
      companyCol,
      C('Default Warehouse', 'DefaultWarehouseID', { type: 'ref', ref: 'warehouse', note: 'Warehouse code or name.' }),
      C('Inventory Account', 'InventoryAccountID', { req: true, type: 'ref', ref: 'account', note: 'Code or name; postable Asset.' }),
      C('Consumption Account', 'ConsumptionAccountID', { req: true, type: 'ref', ref: 'account', note: 'Postable; any type (debited on a Material Issue, credited back on a Production Entry).' }),
      C('Sales COGS Account', 'SalesCogsAccountID', { type: 'ref', ref: 'account', note: 'Postable Expense or COGS.' }),
      C('Write-off Account', 'WriteOffAccountID', { type: 'ref', ref: 'account', note: 'Postable Expense or COGS.' }),
      C('Batch Tracked', 'BatchTracked', { type: 'yesno' }),
      C('Reorder Level', 'ReorderLevel', { type: 'number' }),
      // docs/modules/TAX_ENGINE.md: the item's tax code (Tax Configuration's) and India's HSN / SAC.
      C('Tax Code', 'TaxCode', { note: 'Optional: a code of Tax Configuration, e.g. SR or GST18.' }),
      C('HSN / SAC', 'HSNCode', { note: 'Optional: HSN 4, 6 or 8 digits; a service\'s SAC 6 digits starting 99.' })
    ],
    sample: ['Steel Sheet 2mm', 'Raw Material', 'SS-2MM', 'Steel Sheets', 'PCS', '', '', '01', 'WH-MAIN', '130100', '510100', '', '', 'No', '0'],
    toData: r => ({ ItemName: r.ItemName, Category: r.Category, UserCode: r.UserCode, SubCategoryID: r.SubCategoryID, UOMID: r.UOMID, AltUOMID: r.AltUOMID,
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
      // docs/modules/TAX_ENGINE.md: the registration type and the state or emirate (a GSTIN is checked against it).
      C('Tax Registration Type', 'TaxRegistrationType', { type: 'enum', values: ['Registered', 'Unregistered', 'Composition', 'SEZ', 'Overseas', 'Consumer'] }),
      C('State / Emirate', 'TaxState', { note: 'GST state code (e.g. 27) or emirate code (e.g. DXB).' }),
      C('City', 'City'), C('PIN / Postal Code', 'PostalCode', { note: 'India: the 6-digit PIN code (for e-invoices).' }),
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
      // docs/modules/TAX_ENGINE.md: the registration type and the state or emirate (a GSTIN is checked against it).
      C('Tax Registration Type', 'TaxRegistrationType', { type: 'enum', values: ['Registered', 'Unregistered', 'Composition', 'SEZ', 'Overseas', 'Consumer'] }),
      C('State / Emirate', 'TaxState', { note: 'GST state code (e.g. 27) or emirate code (e.g. DXB).' }),
      C('City', 'City'), C('PIN / Postal Code', 'PostalCode', { note: 'India: the 6-digit PIN code (for e-invoices).' }),
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
  },

  // ---------- Part 2 ----------
  CLASSIFICATION: {
    label: 'Customer Classifications', module: 'SALESINVOICESETUP', save: 'saveCustomerClassification', idKey: 'classificationId',
    path: 'customerClassifications', nameKey: 'Name',
    columns: [
      C('Name', 'Name', { req: true }),
      C('Export', 'IsExport', { type: 'yesno', note: 'Yes for export customers (their country is then required).' }),
      companyCol
    ],
    sample: ['GCC', 'Yes', ''],
    toData: r => ({ Name: r.Name, IsExport: r.IsExport, CompanyID: r.CompanyID })
  },
  SALESTYPE: {
    label: 'Sales Types', module: 'SALESINVOICESETUP', save: 'saveSalesType', idKey: 'salesTypeId', path: 'salesTypes', nameKey: 'Name',
    columns: [
      C('Name', 'Name', { req: true }),
      companyCol,
      C('Sales Revenue Account', 'GLAccountID', { req: true, type: 'ref', ref: 'account', note: 'Code or name; postable Revenue.' }),
      C('Sales Returns Account', 'SalesReturnsAccountID', { req: true, type: 'ref', ref: 'account', note: 'Code or name; postable Revenue.' }),
      C('Restricted to Classification', 'RestrictedToClassificationID', { type: 'ref', ref: 'classification', note: 'Empty: any customer.' })
    ],
    sample: ['Trading Sales', '01', '410100', '410900', ''],
    toData: r => ({ Name: r.Name, CompanyID: r.CompanyID, GLAccountID: r.GLAccountID, SalesReturnsAccountID: r.SalesReturnsAccountID,
      RestrictedToClassificationID: r.RestrictedToClassificationID })
  },
  REQCATEGORY: {
    label: 'Requisition Categories', module: 'PROCUREMENTSETUP', save: 'saveRequisitionCategory', idKey: 'categoryId',
    path: 'requisitionCategories', nameKey: 'Name',
    columns: [
      C('Name', 'Name', { req: true }),
      C('Type', 'Type', { req: true, type: 'enum', values: REQ_TYPES }),
      companyCol,
      C('GL Account', 'GLAccountID', { req: true, type: 'ref', ref: 'account', note: 'Postable Asset for Fixed Asset, Expense for Direct Expense.' })
    ],
    sample: ['Printing & Stationery', 'Direct Expense', '01', '620100'],
    toData: r => ({ Name: r.Name, Type: r.Type, CompanyID: r.CompanyID, GLAccountID: r.GLAccountID })
  },
  FACLASS: {
    label: 'Fixed Asset Classes', module: 'FACONFIG', nameKey: 'Name', store: { firestore: 'faClasses' },
    saveFn: async (ctx, user, data) => { const res = await saveFaClassFor(user, data); return { id: res.classId }; },
    note: 'Depreciating kinds (Tangible, Intangible) need a method and useful life; Land and Capital Work in Progress are not depreciated.',
    columns: [
      C('Code', 'Code', { req: true, note: 'As on the form; must be unique.' }),
      C('Name', 'Name', { req: true }),
      C('Kind', 'Kind', { req: true, type: 'enum', values: FA_KINDS }),
      companyCol,
      C('Default Method', 'DefaultMethod', { type: 'enum', values: FA_METHODS }),
      C('Default Useful Life (months)', 'DefaultUsefulLifeMonths', { type: 'number' }),
      C('Default WDV Rate %', 'DefaultWdvRate', { type: 'number', note: 'With Written Down Value.' }),
      C('Default Residual %', 'DefaultResidualPercent', { type: 'number' }),
      C('Account Determination', 'AccountDeterminationID', { req: true, type: 'ref', ref: 'faDetermination', note: 'Code or name, from Fixed Asset Configuration.' })
    ],
    sample: ['VEH', 'Vehicles', 'Tangible', '', 'Straight Line', '60', '', '10', 'VEHICLES'],
    toData: r => ({ Code: r.Code, Name: r.Name, Kind: r.Kind, CompanyID: r.CompanyID, DefaultMethod: r.DefaultMethod,
      DefaultUsefulLifeMonths: r.DefaultUsefulLifeMonths, DefaultWdvRate: r.DefaultWdvRate, DefaultResidualPercent: r.DefaultResidualPercent,
      AccountDeterminationID: r.AccountDeterminationID })
  },
  FAASSET: {
    label: 'Fixed Asset Master', module: 'FAASSET', capability: 'draft', nameKey: 'Description', noNameDup: true, store: { firestore: 'faAssets' },
    saveFn: async (ctx, user, data) => { const res = await saveFaAssetFor(user, data); return { id: res.assetId, code: res.assetNumber }; },
    note: 'Creates the asset cards (Planned). Cost and depreciation start with Fixed Asset Capitalization. The asset number is given by the system. Empty method or life: the class\'s default.',
    columns: [
      Object.assign({}, companyCol, { req: true, note: 'Ref Code or legal name.' }),
      C('Class', 'ClassID', { req: true, type: 'ref', ref: 'faClass', note: 'Class code or name.' }),
      C('Description', 'Description', { req: true }),
      C('Serial Number', 'SerialNumber'), C('Tag Number', 'TagNumber'),
      C('Quantity', 'Quantity', { type: 'number', note: 'Empty: 1.' }),
      C('Purchase Date', 'PurchaseDate', { type: 'date' }),
      C('Purchase Invoice Ref', 'PurchaseInvoiceRef'),
      C('Supplier', 'SupplierID', { type: 'ref', ref: 'vendor', note: 'Vendor code or name.' }),
      C('Division', 'DivisionID', { type: 'ref', ref: 'division' }),
      C('Branch', 'BranchID', { type: 'ref', ref: 'branch' }),
      C('Cost Center', 'CostCenterID', { type: 'ref', ref: 'costCenter', note: 'Required for a depreciating class.' }),
      C('Profit Center', 'ProfitCenterID', { type: 'ref', ref: 'profitCenter' }),
      C('Method', 'Method', { type: 'enum', values: FA_METHODS }),
      C('Useful Life (months)', 'UsefulLifeMonths', { type: 'number' }),
      C('WDV Rate %', 'WdvRate', { type: 'number' }),
      C('Residual Value', 'ResidualValue', { type: 'number' }),
      C('Depreciation Start Date', 'DepStartDate', { type: 'date' }),
      C('Notes', 'Notes')
    ],
    sample: ['01', 'VEH', 'Toyota Hilux', 'SN-1234', 'TAG-0001', '1', '15/01/2026', 'INV-889', '', '', '', 'CC1', '', '', '', '', '0', '', ''],
    toData: r => Object.assign({}, r, { Quantity: r.Quantity === '' ? 1 : r.Quantity })
  },
  BOM: {
    label: 'Bill of Materials', module: 'BOM', save: 'saveBom', idKey: 'bomId', path: 'boms', nameKey: null,
    note: 'One row per component; the parent item\'s columns repeat on each row of its BOM. A parent that already has an active BOM is edited on the BOM screen.',
    group: { key: r => (typeof r.ParentItemID === 'string' ? r.ParentItemID : ''), header: ['ParentItemID', 'BOMVersion', 'EffectiveFrom', 'Notes'] },
    columns: [
      C('Parent Item', 'ParentItemID', { req: true, type: 'ref', ref: 'item', note: 'Item code or name; a Finished or Semi-Finished Good.' }),
      C('BOM Version', 'BOMVersion', { note: 'Empty: 1.0.' }),
      C('Effective From', 'EffectiveFrom', { type: 'date', note: 'Empty: today.' }),
      C('Notes', 'Notes'),
      C('Component Item', 'ComponentItemID', { req: true, type: 'ref', ref: 'item', note: 'Raw Material, Semi-Finished Good or Consumable.' }),
      C('Quantity', 'Quantity', { req: true, type: 'number' }),
      C('Scrap %', 'ScrapPercent', { type: 'number' })
    ],
    sample: ['FG-000001', '1.0', '', '', 'RM-000001', '2', '0'],
    toGroupData: rows => ({ ParentItemID: rows[0].ParentItemID, BOMVersion: rows[0].BOMVersion, EffectiveFrom: rows[0].EffectiveFrom,
      Notes: rows[0].Notes, Status: 'Active',
      Components: rows.map(r => ({ ComponentItemID: r.ComponentItemID, Quantity: r.Quantity, ScrapPercent: r.ScrapPercent === '' ? 0 : r.ScrapPercent })) })
  },
  VALUATION: {
    label: 'Inventory Valuation List', module: 'INVENTORYVALUATION', save: 'saveInventoryValuationLine', idKey: 'lineId',
    path: 'inventoryValuationLines', nameKey: null,
    note: 'Only items that can be produced: Finished or Semi-Finished Goods with an active BOM, in that company.',
    columns: [
      Object.assign({}, companyCol, { req: true, note: 'Ref Code or legal name.' }),
      C('Item', 'ItemID', { req: true, type: 'ref', ref: 'item', note: 'Item code or name.' }),
      C('Unit Cost', 'UnitCost', { req: true, type: 'number' }),
      C('Effective From', 'EffectiveFrom', { req: true, type: 'date' })
    ],
    sample: ['01', 'FG-000001', '125.50', '01/01/2026'],
    toData: (r, ex) => ({ CompanyID: r.CompanyID, ItemCode: (ex.raw.items[r.ItemID] || {}).ItemCode, UnitCost: r.UnitCost, EffectiveFrom: r.EffectiveFrom })
  },
  PRICELIST: {
    label: 'Price Lists', module: 'PRICELISTING', nameKey: null,
    note: 'One row per item; the price list\'s columns repeat on each row. A list that already exists gets the lines added (its currency and mapping stay as they are).',
    group: { key: r => (typeof r.CompanyID === 'string' ? r.CompanyID : '') + '|' + norm(r.Name), header: ['CompanyID', 'Name', 'CurrencyID', 'CustomerClassificationMapping'] },
    columns: [
      Object.assign({}, companyCol, { req: true, note: 'Ref Code or legal name.' }),
      C('Price List', 'Name', { req: true, note: 'An existing list\'s name, or a new one.' }),
      C('Currency', 'CurrencyID', { type: 'ref', ref: 'currency', note: 'Currency code; required for a new list.' }),
      C('Classification Mapping', 'CustomerClassificationMapping', { type: 'enum', values: PRICE_MAPPINGS, note: 'Local or Export, to apply automatically; or empty.' }),
      C('Item', 'ItemID', { req: true, type: 'ref', ref: 'item', note: 'Item code or name.' }),
      C('Unit Price', 'UnitPrice', { req: true, type: 'number' }),
      C('Effective From', 'EffectiveFrom', { req: true, type: 'date' })
    ],
    sample: ['01', 'Retail 2026', 'AED', 'Local', 'FG-000001', '199.00', '01/01/2026'],
    // Saved by saveUnit below: the list (unless it exists), then its lines.
  },
  EMPLOYEE: {
    label: 'Employees', module: 'EMPLOYEES', nameKey: 'FullName', noNameDup: true, store: { firestore: 'employees', history: 'employeeHistory' },
    flexi: true, // + a column per active extra field from HR Setup
    saveFn: async (ctx, user, data) => { const res = await saveEmployeeFor(user, data, { source: 'Import' }); return { id: res.employeeId, code: res.employeeNo }; },
    note: 'The employee number is given by the system (EMP-0001, ...). List managers above the people who report to them (or leave Line Manager empty and set it later). Bank columns need the Employees "sensitive" right.',
    columns: [
      C('Full Name', 'FullName', { req: true }),
      Object.assign({}, companyCol, { req: true, note: 'Ref Code or legal name.' }),
      C('Date of Joining', 'JoinDate', { req: true, type: 'date' }),
      C('Designation', 'DesignationID', { req: true, type: 'ref', ref: 'designation', note: 'As in HR Setup.' }),
      C('Grade', 'GradeID', { req: true, type: 'ref', ref: 'grade', note: 'Grade code, as in HR Setup.' }),
      C('Line Manager', 'ManagerID', { type: 'ref', ref: 'employee', self: true, note: 'Employee no. or full name of an existing employee, or of one above in this paste.' }),
      C('Division', 'DivisionID', { type: 'ref', ref: 'division' }),
      C('Branch', 'BranchID', { type: 'ref', ref: 'branch' }),
      C('Cost Center (Department)', 'CostCenterID', { type: 'ref', ref: 'costCenter' }),
      C('Work Location', 'WorkLocation'),
      C('Location', 'LocationID', { type: 'ref', ref: 'location', note: 'A Location in Organizational Units (of the company, or shared).' }),
      C('Work Schedule', 'ScheduleID', { type: 'ref', ref: 'workSchedule', note: 'As in HR Setup; empty: the company\'s weekend and hours.' }),
      C('Employment Type', 'EmploymentType', { type: 'enum', values: labelled(['Permanent', 'Contract', 'Part-time', 'Temporary']), note: 'Empty: Permanent.' }),
      C('Probation End', 'ProbationEndDate', { type: 'date' }),
      C('Name as in Passport', 'PassportName'),
      C('Gender', 'Gender', { type: 'enum', values: labelled(['Male', 'Female']) }),
      C('Date of Birth', 'DateOfBirth', { type: 'date' }),
      C('Nationality', 'Nationality'),
      C('Marital Status', 'MaritalStatus', { type: 'enum', values: labelled(['Single', 'Married', 'Divorced', 'Widowed']) }),
      C('Mobile', 'Mobile'), C('Personal Email', 'PersonalEmail', { type: 'email' }), C('Work Email', 'WorkEmail', { type: 'email' }),
      C('Address', 'Address'),
      C('Emergency Contact', 'EmergencyName'), C('Emergency Relation', 'EmergencyRelation'), C('Emergency Phone', 'EmergencyPhone'),
      C('Bank', 'BankName', { sensitive: true }), C('Account No. / IBAN', 'IBAN', { sensitive: true }),
      C('Bank Routing Code', 'BankRoutingCode', { sensitive: true }), C('WPS Person ID', 'WpsPersonID', { sensitive: true })
    ],
    sample: ['Ali Hassan', '01', '01/03/2024', 'Accountant', 'G5', '', '', '', 'CC1', 'Dubai office', '', '', 'Permanent', '31/08/2024', 'ALI HASSAN', 'Male',
      '15/06/1990', 'India', 'Married', '+971 50 000 0000', '', 'ali.hassan@example.com', '', '', '', '', '', '', '', ''],
    toData: r => {
      const out = { Custom: {} };
      Object.keys(r).forEach(k => { if (k.startsWith('cf_')) { if (r[k] !== '') out.Custom[k.slice(3)] = r[k]; } else out[k] = r[k]; });
      out.Status = 'Active';
      return out;
    }
  },
  // Leave balances at go-live (docs/modules/HR_LEAVE.md, step 2): accrual
  // continues from the day after the balance date.
  LEAVEBAL: {
    label: 'Leave Opening Balances', module: 'LEAVE', capability: 'post', nameKey: null, store: { firestore: 'leaveOpenings' },
    saveFn: async (ctx, user, data) => saveLeaveOpening(user, data),
    note: 'One row per employee and leave type that uses a balance (e.g. Annual): the days left on the balance date. From the next day the entitlement accrues monthly. A balance already entered is corrected with an adjustment on the employee\'s leave card.',
    columns: [
      C('Employee', 'EmployeeID', { req: true, type: 'ref', ref: 'employee', note: 'Employee no. or full name.' }),
      C('Leave Type', 'LeaveTypeID', { req: true, type: 'ref', ref: 'leaveType', note: 'Code or name, of a type that uses a balance.' }),
      C('Days', 'Days', { req: true, type: 'number', note: '0 or more, in half days.' }),
      C('Balance Date', 'AsOf', { req: true, type: 'date' })
    ],
    sample: ['EMP-0001', 'ANNUAL', '12.5', '30/09/2026'],
    toData: r => ({ EmployeeID: r.EmployeeID, LeaveTypeID: r.LeaveTypeID, Days: r.Days, AsOf: r.AsOf })
  },
  // Provisions at go-live (docs/modules/HR_PAYROLL.md, step 5a): already in
  // the GL from the opening balances, so nothing is posted; the first run
  // provides only the change from them.
  PROVOPEN: {
    label: 'Payroll Provision Opening Balances', module: 'PAYROLLSETUP', capability: 'write', nameKey: null, store: { firestore: 'payrollProvisionOpenings' },
    saveFn: async (ctx, user, data) => saveProvisionOpening(user, data),
    note: 'One row per employee and provision: Gratuity, Leave salary, or an accrual (its code or name, as in Payroll Setup → Provisions), with the amount provided up to the date. The runs after that month provide only the change.',
    columns: [
      C('Employee', 'EmployeeID', { req: true, type: 'ref', ref: 'employee', note: 'Employee no. or full name.' }),
      C('Provision', 'Provision', { req: true, note: 'Gratuity, Leave salary, or an accrual\'s code or name.' }),
      C('Amount', 'Amount', { req: true, type: 'number', note: '0 or more.' }),
      C('Provided To', 'AsOf', { req: true, type: 'date', note: 'The last day it was provided to, e.g. the go-live month\'s end.' })
    ],
    sample: ['EMP-0001', 'Gratuity', '24500', '30/09/2026'],
    toData: r => ({ EmployeeID: r.EmployeeID, Provision: r.Provision, Amount: r.Amount, AsOf: r.AsOf })
  },
  // Item barcodes (docs/modules/ITEM_BARCODES.md): the barcodes already on
  // products, added to their items; changed or removed in Item Master.
  BARCODE: {
    label: 'Item Barcodes', module: 'ITEMMASTER', capability: 'write', nameKey: null, path: 'itemBarcodes',
    saveFn: async (ctx, user, data) => saveImportedBarcode(user, data),
    note: 'One row per barcode: the item it is on and, for a pack (e.g. a carton of 12), how many units it holds. An item can have several. A barcode already on an item is changed or removed in Item Master.',
    columns: [
      C('Item', 'ItemID', { req: true, type: 'ref', ref: 'item', note: 'Item code or name.' }),
      C('Barcode', 'Barcode', { req: true, note: 'As printed: letters and digits, 4 to 30; an EAN/UPC\'s check digit is verified.' }),
      C('Pack Qty', 'PackQty', { type: 'number', note: 'Units the barcode stands for; empty for 1.' })
    ],
    sample: ['FG-000001', '6291041500213', ''],
    toData: r => ({ ItemID: r.ItemID, Barcode: r.Barcode, PackQty: r.PackQty })
  },
  USER: {
    label: 'Users', module: 'USERMGMT', save: 'saveFirebaseUser', idKey: 'userId', path: 'users', nameKey: 'username', authUser: true,
    note: 'Each user signs in with their email and the temporary password typed on this screen, then changes it (user menu → Change Password).',
    columns: [
      C('Username', 'username', { req: true }),
      C('Full Name', 'fullName', { req: true }),
      C('Email', 'email', { req: true, type: 'email' }),
      C('Role', 'role', { req: true, type: 'ref', ref: 'role', note: 'Role name, as in Roles & Permissions.' }),
      C('Companies', 'assignedCompanies', { type: 'refs', ref: 'company', note: 'Ref Codes or names, separated by commas.' })
    ],
    sample: ['ali.hassan', 'Ali Hassan', 'ali.hassan@example.com', 'Accountant', '01'],
    toData: (r, ex, opts) => ({ username: r.username, fullName: r.fullName, email: r.email.toLowerCase(), role: r.role, status: 'Active',
      password: opts.tempPassword, assignedCompanies: r.assignedCompanies })
  }
};
const ORDER = ['COMPANY', 'ORGUNIT', 'ACCOUNT', 'CURRENCY', 'UOM', 'SUBCATEGORY', 'ITEM', 'VENDOR', 'CLASSIFICATION', 'CUSTOMER',
  'SALESTYPE', 'REQCATEGORY', 'FACLASS', 'FAASSET', 'BOM', 'VALUATION', 'PRICELIST', 'USER', 'EMPLOYEE', 'LEAVEBAL', 'PROVOPEN', 'BARCODE'];

// A master with its columns for now: Employees adds a column per active
// extra field from HR Setup (key cf_<field id>), compulsory ones required.
async function masterFor(k) {
  const m = MASTERS[k];
  if (!m || !m.flexi) return m;
  const fields = (await loadHrSetup()).fields.filter(f => f.Active);
  const type = f => (f.Type === 'date' ? 'date' : f.Type === 'amount' ? 'number' : 'text');
  return Object.assign({}, m, {
    columns: m.columns.concat(fields.map(f => C(f.Label, 'cf_' + f.FieldID, { req: f.Required, type: type(f), sensitive: f.Sensitive,
      note: 'Extra field (' + f.Type + (f.Required ? ', compulsory' : '') + ').' }))),
    sample: (m.sample || []).concat(fields.map(() => ''))
  });
}

// ---------- references ----------

// Existing records each reference kind can point to: { id, code, name, rec }.
async function loadExisting() {
  const paths = ['companies', 'orgUnits', 'coa', 'uoms', 'itemSubCategories', 'customerClassifications', 'items', 'vendors', 'customers',
    'currencies', 'salesTypes', 'requisitionCategories', 'boms', 'inventoryValuationLines', 'priceLists', 'priceListLines', 'users', 'roles', 'itemBarcodes'];
  const vals = (await Promise.all(paths.map(p => rtdb.ref(p).get()))).map(s => s.val() || {});
  const data = {};
  paths.forEach((p, i) => { data[p] = vals[i]; });
  const fsDocs = async col => { const o = {}; (await firestore.collection(col).get()).docs.forEach(d => { o[d.id] = d.data(); }); return o; };
  data.faClasses = await fsDocs('faClasses');
  data.faAccountDetermination = await fsDocs('faAccountDetermination');
  data.faAssets = await fsDocs('faAssets');
  data.hrGrades = await fsDocs('hrGrades');
  data.hrDesignations = await fsDocs('hrDesignations');
  data.hrWorkSchedules = await fsDocs('hrWorkSchedules');
  data.employees = await fsDocs('employees');
  data.leaveTypes = Object.fromEntries((await loadLeaveTypes()).map(t => [t.LeaveTypeID, t]));
  data.leaveOpenings = await fsDocs('leaveOpenings');
  const list = (obj, code, name) => Object.keys(obj).map(id => ({ id, code: code === '#id' ? id : (obj[id][code] || ''), name: obj[id][name] || '', rec: obj[id] }));
  const units = list(data.orgUnits, 'Code', 'Name');
  return {
    raw: data,
    company: list(data.companies, 'CompanyRefCode', 'LegalName'),
    orgUnit: units,
    warehouse: units.filter(x => x.rec.Type === 'Warehouse'),
    division: units.filter(x => x.rec.Type === 'Division'),
    branch: units.filter(x => x.rec.Type === 'Branch'),
    costCenter: units.filter(x => x.rec.Type === 'CostCenter'),
    profitCenter: units.filter(x => x.rec.Type === 'ProfitCenter'),
    location: units.filter(x => x.rec.Type === 'Location'),
    account: list(data.coa, 'AccountCode', 'AccountName'),
    uom: list(data.uoms, 'Code', 'Name'),
    subCategory: list(data.itemSubCategories, '', 'Name'),
    classification: list(data.customerClassifications, '', 'Name').filter(x => x.rec.Status !== 'Inactive'),
    item: list(data.items, 'ItemCode', 'ItemName'),
    vendor: list(data.vendors, 'VendorCode', 'VendorName'),
    currency: list(data.currencies, 'Code', 'Name'),
    role: list(data.roles, '#id', 'Name'),
    faClass: list(data.faClasses, 'Code', 'Name'),
    faDetermination: list(data.faAccountDetermination, 'Code', 'Name'),
    grade: list(data.hrGrades, 'Code', 'Name').filter(x => x.rec.Active !== false),
    designation: list(data.hrDesignations, '', 'Title').filter(x => x.rec.Active !== false),
    workSchedule: list(data.hrWorkSchedules, '', 'Name').filter(x => x.rec.Active !== false),
    employee: list(data.employees, 'EmployeeNo', 'FullName'),
    customer: list(data.customers, 'CustomerCode', 'CustomerName'),
    user: list(data.users, 'username', 'fullName'),
    faAsset: list(data.faAssets, 'AssetNumber', 'Description'),
    leaveType: list(data.leaveTypes, 'Code', 'Name').filter(x => x.rec.UsesBalance && x.rec.Kind === 'Leave')
  };
}

// The kind a master's own records are, for references within one paste.
const SELF_KIND = { COMPANY: 'company', ORGUNIT: 'orgUnit', ACCOUNT: 'account' };

// ---------- checking ----------

// Checks a paste without writing anything. Returns the table, the
// resolved rows (references as ids, or { row } for one created earlier in
// this paste) and the issues, each { row, column, message } (row 0 = the
// header row).
async function checkPaste(user, masterKey, text, opts) {
  opts = opts || {};
  const m = await masterFor(masterKey);
  if (!m) throw new HttpsError('invalid-argument', 'Choose what to import.');
  const issues = [];
  const add = (row, column, message) => issues.push({ row, column: column || '', message });
  if (!(await moduleHasCapability(m.module, m.capability || 'write', user.profile.role))) {
    add(0, '', 'You do not have permission to change ' + m.label + ' (the import needs the same right as entering it by hand).');
  }
  const seesSensitive = !m.columns.some(c => c.sensitive) || await moduleHasCapability(m.module, 'sensitive', user.profile.role);
  if (m.authUser && String(opts.tempPassword || '').length < 6) {
    add(0, 'Temporary password', 'Type a temporary password of at least 6 characters for these users.');
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
      } else if (col.type === 'date') {
        const v = dateValue(raw); if (v === null) issue(col, '"' + raw + '" is not a date (dd/mm/yyyy).'); r[col.key] = v || '';
      } else if (col.type === 'ref' || col.type === 'refs') {
        r[col.key] = raw; // resolved below, once the row's own values are known
      } else {
        r[col.key] = raw;
      }
    }
    // References: by code, or by exact name; the master's own kind may also
    // point to a row above in this paste (by name).
    // The company first: an account named in the row is looked for among
    // that company's accounts (and those for all companies).
    const refCols = m.columns.filter(c => c.type === 'ref' || c.type === 'refs').sort((a, b) => (b.ref === 'company') - (a.ref === 'company'));
    const resolveOne = (col, raw) => {
      let pool = ex[col.ref];
      const co = typeof r.CompanyID === 'string' ? r.CompanyID : '';
      if (col.ref === 'subCategory') pool = pool.filter(x => x.rec.ParentCategory === r.Category && (!x.rec.CompanyID || x.rec.CompanyID === co));
      if (['account', 'faClass', 'division', 'branch', 'costCenter', 'profitCenter', 'location'].includes(col.ref) && masterKey !== 'ACCOUNT' && co) {
        pool = pool.filter(x => !x.rec.CompanyID || x.rec.CompanyID === co);
      }
      const byCode = pool.filter(x => x.code && norm(x.code) === norm(raw));
      const hits = byCode.length ? byCode : pool.filter(x => norm(x.name) === norm(raw));
      let above = [];
      if (col.self && !byCode.length) {
        above = resolved.map((o, i) => ({ o, i })).filter(({ o }) => o && norm(o.values[m.nameKey]) === norm(raw)).map(({ i }) => i + 1);
      }
      if (hits.length + above.length > 1) return { error: '"' + raw + '" matches more than one record; use its code.' };
      if (hits.length) return { id: hits[0].id };
      if (above.length) return { id: { row: above[0] } };
      return { error: '"' + raw + '" not found' + (col.self ? ' (nor in a row above)' : '') + '.' };
    };
    for (const col of refCols) {
      const raw = r[col.key];
      if (col.type === 'refs') {
        const ids = [];
        String(raw || '').split(',').map(x => x.trim()).filter(Boolean).forEach(one => {
          const res = resolveOne(col, one);
          if (res.error) issue(col, res.error); else if (!ids.includes(res.id)) ids.push(res.id);
        });
        r[col.key] = ids;
        continue;
      }
      if (!raw) { r[col.key] = ''; continue; }
      const res = resolveOne(col, raw);
      if (res.error) issue(col, res.error);
      r[col.key] = res.error ? '' : res.id;
    }
    if (Array.isArray(r.assignedCompanies)) {
      r.assignedCompanies.forEach(c => { if (!userCanAccessCompany(user.profile, c)) add(rowNo, 'Companies', 'You do not have access to company ' + ((ex.raw.companies[c] || {}).LegalName || c) + '.'); });
    }
    const values = Object.assign({}, r);

    // The company, where a row names one: the user must have access to it.
    if (typeof r.CompanyID === 'string' && r.CompanyID && !userCanAccessCompany(user.profile, r.CompanyID)) {
      add(rowNo, 'Company', 'You do not have access to that company.');
    }
    // An employee's row (leave balances): the employee's company.
    if (masterKey === 'LEAVEBAL' && typeof r.EmployeeID === 'string' && ex.raw.employees[r.EmployeeID] && !userCanAccessCompany(user.profile, ex.raw.employees[r.EmployeeID].CompanyID)) {
      add(rowNo, 'Employee', 'You do not have access to that employee\'s company.');
    }
    masterRules(masterKey, r, ex, resolved, (h, msg) => add(rowNo, h, msg));
    if (!seesSensitive) m.columns.filter(c => c.sensitive && r[c.key] !== '' && r[c.key] != null).forEach(c => add(rowNo, c.h, 'You do not have the right to enter ' + c.h + ' (Employees: sensitive).'));

    // The same name twice (in the paste, or already existing) is an issue,
    // so a list pasted twice can't create everything twice.
    const name = m.nameKey && !m.noNameDup ? norm(r[m.nameKey]) : '';
    if (name) {
      const scope = dupScope(masterKey, r);
      const key = scope + '|' + name;
      if (namesInPaste[key]) add(rowNo, headerOf(m, m.nameKey), 'Same as row ' + namesInPaste[key] + '.');
      else namesInPaste[key] = rowNo;
      if (existingSameName(masterKey, r, ex)) add(rowNo, headerOf(m, m.nameKey), '"' + r[m.nameKey] + '" already exists.');
    }
    resolved.push({ values, data: r });
  });
  if (m.group) groupRules(masterKey, resolved, ex, add);
  return { headers, rows: body, resolved, issues };
}

// The rows of one BOM / price list: in first-appearance order, each
// { key, rows: [index] }. Rows whose key couldn't be worked out are left
// out (they already have an issue).
function groupsOf(m, resolved) {
  const groups = [];
  const at = {};
  resolved.forEach((o, i) => {
    const key = m.group.key(o.data);
    if (!key || key === '|') return;
    if (!(key in at)) { at[key] = groups.length; groups.push({ key, rows: [] }); }
    groups[at[key]].rows.push(i);
  });
  return groups;
}

// A BOM's or price list's own columns must be the same on each of its rows
// (or empty after the first); then the rules for the whole BOM / list.
function groupRules(k, resolved, ex, add) {
  const m = MASTERS[k];
  const groups = groupsOf(m, resolved);
  const what = k === 'BOM' ? 'this BOM' : 'this price list';
  groups.forEach(g => {
    const first = resolved[g.rows[0]].data;
    g.rows.slice(1).forEach(i => {
      const r = resolved[i].data;
      m.group.header.forEach(key => {
        const v = r[key];
        if (v !== '' && v != null && String(v) !== String(first[key] == null ? '' : first[key])) {
          add(i + 1, headerOf(m, key), 'Differs from row ' + (g.rows[0] + 1) + ', the first row of ' + what + '.');
        }
      });
    });
    const row1 = g.rows[0] + 1;
    if (k === 'BOM') {
      const active = Object.values(ex.raw.boms).some(b => b.ParentItemID === first.ParentItemID && b.Status === 'Active');
      if (active) add(row1, 'Parent Item', 'This item already has an active BOM; change it on the Bill of Materials screen.');
    }
    if (k === 'PRICELIST') {
      const existing = Object.values(ex.raw.priceLists).some(l => l.CompanyID === first.CompanyID && norm(l.Name) === norm(first.Name));
      if (!existing) {
        const cur = typeof first.CurrencyID === 'string' && first.CurrencyID ? ex.raw.currencies[first.CurrencyID] : null;
        if (!first.CurrencyID) add(row1, 'Currency', 'A new price list needs its currency.');
        else if (cur && cur.Status !== 'Active') add(row1, 'Currency', 'That currency is not active.');
        const mp = first.CustomerClassificationMapping;
        if (mp) {
          const taken = Object.values(ex.raw.priceLists).find(l => l.CompanyID === first.CompanyID && l.Status !== 'Inactive' && l.CustomerClassificationMapping === mp);
          if (taken) add(row1, 'Classification Mapping', '"' + taken.Name + '" is already mapped to ' + mp + ' for this company.');
          const twin = groups.find(o => o !== g && o.rows[0] < g.rows[0] && resolved[o.rows[0]].data.CompanyID === first.CompanyID &&
            resolved[o.rows[0]].data.CustomerClassificationMapping === mp);
          if (twin) add(row1, 'Classification Mapping', 'Row ' + (twin.rows[0] + 1) + ' already maps a new list to ' + mp + ' for this company.');
        }
      }
      // The same item and date twice in one list.
      const seen = {};
      g.rows.forEach(i => {
        const r = resolved[i].data;
        const key = r.ItemID + '|' + r.EffectiveFrom;
        if (r.ItemID && seen[key]) add(i + 1, 'Item', 'Same item and date as row ' + seen[key] + '.');
        else seen[key] = i + 1;
      });
    }
  });
}

const headerOf = (m, key) => (m.columns.find(c => c.key === key) || {}).h || key;
const companyOf = v => (typeof v === 'string' ? v : '');
function dupScope(k, r) {
  if (k === 'ORGUNIT') return r.Type + '|' + companyOf(r.CompanyID);
  if (k === 'SUBCATEGORY') return r.ParentCategory + '|' + companyOf(r.CompanyID);
  if (['ACCOUNT', 'ITEM', 'VENDOR', 'CUSTOMER', 'CLASSIFICATION', 'SALESTYPE', 'REQCATEGORY'].includes(k)) return companyOf(r.CompanyID);
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
    case 'SUBCATEGORY': return same(ex.raw.itemSubCategories, 'Name', x => x.ParentCategory === r.ParentCategory && (x.CompanyID || '') === co);
    case 'ITEM': return same(ex.raw.items, 'ItemName', x => (x.CompanyID || '') === co);
    case 'VENDOR': return same(ex.raw.vendors, 'VendorName', x => (x.CompanyID || '') === co);
    case 'CUSTOMER': return same(ex.raw.customers, 'CustomerName', x => (x.CompanyID || '') === co);
    case 'CURRENCY': return same(ex.raw.currencies, 'Name');
    case 'CLASSIFICATION': return same(ex.raw.customerClassifications, 'Name', x => (x.CompanyID || '') === co);
    case 'SALESTYPE': return same(ex.raw.salesTypes, 'Name', x => (x.CompanyID || '') === co);
    case 'REQCATEGORY': return same(ex.raw.requisitionCategories, 'Name', x => (x.CompanyID || '') === co);
    case 'FACLASS': return same(ex.raw.faClasses, 'Name');
    case 'USER': return same(ex.raw.users, 'username');
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
      // As Item Master's own save: Consumption is debited on a Material
      // Issue and credited back on a Production Entry, so any postable
      // account will do (an Asset or Liability clearing account is as valid
      // as an Expense); Sales COGS and Write-off are expenses.
      postable(r.ConsumptionAccountID, 'Consumption Account');
      postable(r.SalesCogsAccountID, 'Sales COGS Account', ['Expense', 'COGS']);
      postable(r.WriteOffAccountID, 'Write-off Account', ['Expense', 'COGS']);
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
    case 'SALESTYPE': {
      postable(r.GLAccountID, 'Sales Revenue Account', ['Revenue']);
      postable(r.SalesReturnsAccountID, 'Sales Returns Account', ['Revenue']);
      break;
    }
    case 'REQCATEGORY': {
      if (r.Type) postable(r.GLAccountID, 'GL Account', [r.Type === 'FixedAsset' ? 'Asset' : 'Expense']);
      break;
    }
    case 'FACLASS': {
      if (r.Code && (codeTaken(ex.raw.faClasses, r.Code) || codeAbove(r.Code))) issue('Code', 'Class code "' + norm(r.Code) + '" is already in use.');
      if (r.Kind) {
        const dep = r.Kind === 'Tangible' || r.Kind === 'Intangible';
        const method = dep ? r.DefaultMethod : 'None';
        const err = validateValuation({ Method: method, UsefulLifeMonths: dep ? r.DefaultUsefulLifeMonths : 0,
          WdvRate: method === 'WDV' ? r.DefaultWdvRate : 0, ResidualValue: 0 }, r.Kind);
        if (err) issue(dep && !method ? 'Default Method' : 'Default Useful Life (months)', 'Default: ' + err);
      }
      if (r.DefaultResidualPercent !== '' && (r.DefaultResidualPercent < 0 || r.DefaultResidualPercent >= 100)) {
        issue('Default Residual %', 'Default residual must be from 0% to less than 100%.');
      }
      break;
    }
    case 'FAASSET': {
      const cls = typeof r.ClassID === 'string' && r.ClassID ? ex.raw.faClasses[r.ClassID] : null;
      if (cls) {
        if (cls.Status !== 'Active') issue('Class', 'That asset class is inactive.');
        if (cls.CompanyID && cls.CompanyID !== r.CompanyID) issue('Class', 'That asset class belongs to a different company.');
        const dep = cls.Kind === 'Tangible' || cls.Kind === 'Intangible';
        if (dep && !r.CostCenterID) issue('Cost Center', 'Select a Cost Center: depreciation expense is posted to it.');
        const method = dep ? (r.Method || cls.DefaultMethod) : 'None';
        const err = validateValuation({ Method: method, UsefulLifeMonths: dep ? Number(r.UsefulLifeMonths || cls.DefaultUsefulLifeMonths) : 0,
          WdvRate: method === 'WDV' ? Number(r.WdvRate || cls.DefaultWdvRate) : 0, ResidualValue: dep ? Number(r.ResidualValue) || 0 : 0,
          DepStartDate: dep ? r.DepStartDate : '' }, cls.Kind);
        if (err) issue('Method', err);
      }
      if (r.Quantity !== '' && !(r.Quantity > 0)) issue('Quantity', 'Quantity must be more than zero.');
      // A serial or tag number names one asset: twice is an issue.
      for (const [key, label] of [['SerialNumber', 'Serial Number'], ['TagNumber', 'Tag Number']]) {
        if (!r[key]) continue;
        const taken = Object.values(ex.raw.faAssets).some(a => a.CompanyID === r.CompanyID && norm(a[key]) === norm(r[key]));
        const above = resolvedAbove.findIndex(o => o && o.data.CompanyID === r.CompanyID && norm(o.data[key]) === norm(r[key]));
        if (taken) issue(label, label + ' "' + r[key] + '" is already used by another asset.');
        else if (above >= 0) issue(label, 'Same ' + label.toLowerCase() + ' as row ' + (above + 1) + '.');
      }
      break;
    }
    case 'BOM': {
      const item = id => (typeof id === 'string' && id ? ex.raw.items[id] : null);
      const parent = item(r.ParentItemID);
      const comp = item(r.ComponentItemID);
      if (parent && !['FinishedGood', 'SemiFinishedGood'].includes(parent.Category)) issue('Parent Item', 'The parent must be a Finished Good or Semi-Finished Good.');
      if (comp && !['RawMaterial', 'SemiFinishedGood', 'Consumable'].includes(comp.Category)) issue('Component Item', 'A component must be a Raw Material, Semi-Finished Good or Consumable.');
      if (comp && r.ComponentItemID === r.ParentItemID) issue('Component Item', 'An item cannot be a component of its own BOM.');
      if (parent && comp && parent.CompanyID && comp.CompanyID && parent.CompanyID !== comp.CompanyID) issue('Component Item', 'The component belongs to a different company than the parent item.');
      if (r.Quantity !== '' && !(r.Quantity > 0)) issue('Quantity', 'Enter a quantity greater than zero.');
      if (r.ScrapPercent !== '' && (r.ScrapPercent < 0 || r.ScrapPercent >= 100)) issue('Scrap %', 'Scrap % must be from 0 to less than 100.');
      break;
    }
    case 'VALUATION': {
      const it = typeof r.ItemID === 'string' && r.ItemID ? ex.raw.items[r.ItemID] : null;
      if (it) {
        const hasBom = Object.values(ex.raw.boms).some(b => b.ParentItemID === r.ItemID && b.Status === 'Active');
        if (it.Status !== 'Active' || !['FinishedGood', 'SemiFinishedGood'].includes(it.Category) || !hasBom || (it.CompanyID || '') !== companyOf(r.CompanyID)) {
          issue('Item', 'Only an active Finished or Semi-Finished Good of this company with an active BOM can have a valuation line.');
        }
        const dup = Object.values(ex.raw.inventoryValuationLines).some(l => l.CompanyID === r.CompanyID && l.ItemCode === it.ItemCode && l.EffectiveFrom === r.EffectiveFrom);
        const above = resolvedAbove.findIndex(o => o && o.data.CompanyID === r.CompanyID && o.data.ItemID === r.ItemID && o.data.EffectiveFrom === r.EffectiveFrom);
        if (dup) issue('Item', 'This item already has a valuation line from ' + r.EffectiveFrom + '.');
        else if (above >= 0) issue('Item', 'Same item and date as row ' + (above + 1) + '.');
      }
      if (r.UnitCost !== '' && !(r.UnitCost > 0)) issue('Unit Cost', 'Unit cost must be greater than zero.');
      break;
    }
    case 'PRICELIST': {
      const it = typeof r.ItemID === 'string' && r.ItemID ? ex.raw.items[r.ItemID] : null;
      if (it && it.Status !== 'Active') issue('Item', 'That item is inactive.');
      if (r.UnitPrice !== '' && !(r.UnitPrice > 0)) issue('Unit Price', 'Unit price must be greater than zero.');
      const listId = Object.keys(ex.raw.priceLists).find(id => ex.raw.priceLists[id].CompanyID === r.CompanyID && norm(ex.raw.priceLists[id].Name) === norm(r.Name));
      if (it && listId && Object.values(ex.raw.priceListLines).some(l => l.PriceListID === listId && l.ItemCode === it.ItemCode && l.EffectiveFrom === r.EffectiveFrom)) {
        issue('Item', 'This list already has this item from ' + r.EffectiveFrom + '.');
      }
      break;
    }
    case 'EMPLOYEE': {
      // The same person twice: same name and date of joining.
      if (r.FullName && r.JoinDate) {
        const twin = Object.values(ex.raw.employees).find(e => norm(e.FullName) === norm(r.FullName) && e.JoinDate === r.JoinDate);
        const above = resolvedAbove.findIndex(o => o && norm(o.data.FullName) === norm(r.FullName) && o.data.JoinDate === r.JoinDate);
        if (twin) issue('Full Name', '"' + r.FullName + '" joining ' + r.JoinDate + ' already exists (' + twin.EmployeeNo + ').');
        else if (above >= 0) issue('Full Name', 'Same name and date of joining as row ' + (above + 1) + '.');
      }
      const mgr = typeof r.ManagerID === 'string' && r.ManagerID ? ex.raw.employees[r.ManagerID] : null;
      if (mgr && mgr.Status === 'Left') issue('Line Manager', mgr.FullName + ' has left.');
      break;
    }
    case 'BARCODE': {
      const c = checkBarcode(r.Barcode);
      if (r.Barcode && c.error) issue('Barcode', c.error.replace(/^Barcode [^:]*: /, ''));
      else if (c.code) {
        const on = ex.raw.itemBarcodes[c.code];
        const above = resolvedAbove.findIndex(o => o && checkBarcode(o.data.Barcode).code === c.code);
        if (on) issue('Barcode', 'Already on item ' + ((ex.raw.items[on.ItemID] || {}).ItemCode || on.ItemID) + ': change it in Item Master.');
        else if (above >= 0) issue('Barcode', 'Same barcode as row ' + (above + 1) + '.');
      }
      if (r.PackQty !== '' && r.PackQty != null && checkPack(r.PackQty) == null) issue('Pack Qty', 'More than 0, or empty for 1.');
      break;
    }
    case 'LEAVEBAL': {
      const emp = typeof r.EmployeeID === 'string' && r.EmployeeID ? ex.raw.employees[r.EmployeeID] : null;
      const type = typeof r.LeaveTypeID === 'string' && r.LeaveTypeID ? ex.raw.leaveTypes[r.LeaveTypeID] : null;
      if (emp && emp.Status === 'Left') issue('Employee', emp.FullName + ' has left.');
      if (emp && r.AsOf && r.AsOf < emp.JoinDate) issue('Balance Date', 'Before the date of joining (' + emp.JoinDate + ').');
      if (r.Days !== '' && (!(r.Days >= 0) || Math.round(r.Days * 2) !== r.Days * 2)) issue('Days', 'Days are 0 or more, in half days.');
      if (emp && type) {
        if (Object.values(ex.raw.leaveOpenings).some(o => o.EmployeeID === r.EmployeeID && o.LeaveTypeID === r.LeaveTypeID)) {
          issue('Leave Type', emp.FullName + ' already has an opening ' + type.Name + ' balance: correct it with an adjustment.');
        } else {
          const above = resolvedAbove.findIndex(o => o && o.data.EmployeeID === r.EmployeeID && o.data.LeaveTypeID === r.LeaveTypeID);
          if (above >= 0) issue('Leave Type', 'Same employee and leave type as row ' + (above + 1) + '.');
        }
      }
      break;
    }
    case 'USER': {
      const email = norm(r.email);
      if (email) {
        if (Object.values(ex.raw.users).some(u => norm(u.email) === email)) issue('Email', '"' + r.email + '" already has a user.');
        else {
          const above = resolvedAbove.findIndex(o => o && norm(o.data.email) === email);
          if (above >= 0) issue('Email', 'Same email as row ' + (above + 1) + '.');
        }
      }
      break;
    }
    default:
  }
}

// ---------- importing ----------

// Counters a save may advance (item, vendor, customer, employee codes;
// asset numbers): all made by the Numbering module now
// (docs/modules/NUMBERING.md), which finds a code's counter from its format.
const COUNTER_ROOTS = ['itemCounters', 'vendorCounters', 'customerCounters', 'fa/counters', 'hrCounters'];
const codeOfResult = res => res.itemCode || res.vendorCode || res.customerCode || '';
const counterOfCode = code => require('./numbering').counterPathOfCode(code);

// What to save, unit by unit: a row, or the rows of one BOM / price list.
function unitsOf(m, resolved) {
  return m.group ? groupsOf(m, resolved).map(g => g.rows) : resolved.map((o, i) => [i]);
}

// Puts the ids of records created earlier in this run into a row ({ row }).
function withIds(data, idOfRow) {
  const out = Object.assign({}, data);
  Object.keys(out).forEach(k => { if (out[k] && typeof out[k] === 'object' && !Array.isArray(out[k]) && out[k].row) out[k] = idOfRow[out[k].row]; });
  return out;
}

// Saves one unit through the master's own save; returns what it created,
// each { row, id, code, undo }.
async function saveUnit(m, ctx, user, rows, ex, opts) {
  const legacy = async (name, data, idKey) => {
    const res = await L[name](ctx, data);
    if (!res || !res.success) throw new Error((res && res.error) || 'The record could not be saved.');
    if (!res[idKey]) throw new Error('The record was saved without an id.');
    return res;
  };
  const row1 = rows[0].row;
  if (m === MASTERS.PRICELIST) {
    const first = rows[0].data;
    const out = [];
    let listId = Object.keys(ex.raw.priceLists).find(id => ex.raw.priceLists[id].CompanyID === first.CompanyID && norm(ex.raw.priceLists[id].Name) === norm(first.Name));
    if (!listId) {
      const res = await legacy('savePriceList', { CompanyID: first.CompanyID, Name: first.Name, CurrencyID: first.CurrencyID,
        CustomerClassificationMapping: first.CustomerClassificationMapping }, 'priceListId');
      listId = res.priceListId;
      out.push({ row: row1, id: listId, code: '', undo: { rtdb: 'priceLists/' + listId } });
    }
    for (const r of rows) {
      try {
        const res = await legacy('savePriceListLine', { PriceListID: listId, ItemCode: (ex.raw.items[r.data.ItemID] || {}).ItemCode,
          UnitPrice: r.data.UnitPrice, EffectiveFrom: r.data.EffectiveFrom }, 'lineId');
        out.push({ row: r.row, id: res.lineId, code: '', undo: { rtdb: 'priceListLines/' + res.lineId } });
      } catch (e) { e.created = out; e.row = r.row; throw e; }
    }
    return out;
  }
  const data = m.group ? m.toGroupData(rows.map(r => r.data)) : m.toData(rows[0].data, ex, opts);
  let id, code;
  if (m.saveFn) ({ id, code } = await m.saveFn(ctx, user, data));
  else { const res = await legacy(m.save, data, m.idKey); id = res[m.idKey]; code = codeOfResult(res); }
  const undo = m.store && m.store.firestore ? { firestore: m.store.firestore, id, history: m.store.history } : { rtdb: m.path + '/' + id };
  if (m.authUser) undo.authUid = id;
  return [{ row: row1, id, code: code || '', undo }];
}

async function undoOne(u) {
  if (u.rtdb) await rtdb.ref(u.rtdb).remove();
  if (u.firestore) await firestore.collection(u.firestore).doc(u.id).delete();
  if (u.history) for (const d of (await firestore.collection(u.history).where('EmployeeID', '==', u.id).get()).docs) await d.ref.delete();
  if (u.authUid) { try { await admin.auth().deleteUser(u.authUid); } catch (e) { /* already gone */ } }
}

// Saves every unit through the master's own save function, in order.
// On a failure, removes what this run created and puts the code counters
// back (unless someone else used them meanwhile), then reports the row.
async function importRows(request, user, masterKey, resolved, opts) {
  opts = opts || {};
  const m = await masterFor(masterKey);
  const ex = await loadExisting();
  const snapshot = {};
  for (const c of COUNTER_ROOTS) snapshot[c] = (await rtdb.ref(c).get()).val() || {};
  const created = [];
  const idOfRow = {};
  let failure = null;
  await run(request, async (ctx) => {
    for (const idxs of unitsOf(m, resolved)) {
      const rows = idxs.map(i => ({ row: i + 1, data: withIds(resolved[i].data, idOfRow) }));
      try {
        const made = await saveUnit(m, ctx, user, rows, ex, opts);
        made.forEach(c => { created.push(c); });
        rows.forEach(r => { idOfRow[r.row] = made[0].id; });
      } catch (e) {
        (e.created || []).forEach(c => created.push(c));
        failure = { row: e.row || rows[0].row, message: e.message || 'The record could not be saved.' };
        break;
      }
    }
  });
  if (!failure) return { created };

  for (const c of created.slice().reverse()) await undoOne(c.undo);
  const used = {};
  for (const c of created) { const p = c.code && (await counterOfCode(c.code)); if (p) used[p] = (used[p] || 0) + 1; }
  for (const p of Object.keys(used)) {
    const root = COUNTER_ROOTS.find(r => p.startsWith(r + '/'));
    const before = root ? Number(p.slice(root.length + 1).split('/').reduce((o, k) => (o && typeof o === 'object' ? o[k] : undefined), snapshot[root])) || 0 : 0;
    // A transaction's first try sees the local cache (null): answering null
    // makes it retry with the server's value instead of giving up.
    const back = await rtdb.ref(p).transaction(cur => (cur === null ? null : (Number(cur) === before + used[p] ? before : undefined)));
    // A customized code given back is free again (docs/modules/NUMBERING.md).
    if (back.committed) {
      for (const c of created) {
        if (c.code && (await counterOfCode(c.code)) === p) {
          const issued = await require('./numbering').issuedPathOfCode(c.code);
          if (issued) await rtdb.ref(issued).remove();
        }
      }
    }
  }
  return { created: [], failure };
}

// ---------- updating existing records (Part 3; owner 2026-10-05) ----------
// "Update existing" mode (docs/modules/MASTER_IMPORT.md, decisions 8-11):
// the key column (the record's code) finds the record; only the columns
// pasted change; a blank cell keeps the value and "-" clears it. Each row
// is saved through the master's own save, with its id, so the screen's
// rules apply. All or nothing: a failed save puts back the rows already
// saved in that run. Step 3a: Employees; the other masters follow (3b).

const CLEAR = '-';
// A master saved through its own save with the record's id (Part 3b): the
// row's values are the record's, the pasted ones laid over them, made into
// the form's data by the master's toData; fields the sheet doesn't hold
// (and `keep`) stay as stored.
function legacyUpdate(masterKey, x) {
  return Object.assign({
    companyOf: rec => rec.CompanyID || '',
    valueOf: (rec, key) => rec[key],
    save: async (ctx, user, id, rec, set, u) => {
      const m = await masterFor(masterKey);
      const r = {};
      m.columns.forEach(c => { r[c.key] = u.valueOf(rec, c.key); });
      Object.assign(r, set);
      const data = Object.assign({}, rec, m.toData(r, null, {}), { [x.idField]: id });
      (x.keep || []).forEach(k => { data[k] = rec[k]; });
      if (m.saveFn) { await m.saveFn(ctx, user, data); return; }
      const res = await L[m.save](ctx, data);
      if (!res || !res.success) throw new Error((res && res.error) || 'The record could not be saved.');
    },
    store: m0 => (m0.store && m0.store.firestore ? { firestore: m0.store.firestore } : { rtdb: m0.path })
  }, x);
}
const NOTE = what => 'Only the columns you paste change. A blank cell keeps the value; type - to clear it.' + (what ? ' ' + what : '');
const UPDATES = {
  COMPANY: legacyUpdate('COMPANY', { key: { h: 'Ref Code', kind: 'company' }, idField: 'CompanyID', records: ex => ex.raw.companies, companyOf: (rec, id) => id,
    locked: ['TaxType', 'TaxNumber'], keep: ['TaxNumbers'], lockedWhy: 'a company can hold several tax numbers: change them on Company Master',
    note: NOTE('Tax numbers change on Company Master.') }),
  ORGUNIT: legacyUpdate('ORGUNIT', { key: { h: 'Code', kind: 'orgUnit' }, idField: 'UnitID', records: ex => ex.raw.orgUnits,
    locked: ['Code', 'Type', 'CompanyID'], lockedWhy: 'units are referenced by their code, type and company: change them on Organizational Units',
    note: NOTE('The code, type and company stay as they are.') }),
  ACCOUNT: legacyUpdate('ACCOUNT', { key: { h: 'Account Code', kind: 'account' }, idField: 'AccountID', records: ex => ex.raw.coa,
    locked: ['AccountType', 'ParentAccountID', 'IsPostable', 'CompanyID'], lockedWhy: 'the code is built from the type and parent, and postings depend on them: change it on COA Master',
    note: NOTE('Account type, parent, postable and company stay as they are.') }),
  CURRENCY: legacyUpdate('CURRENCY', { key: { h: 'Code', kind: 'currency' }, idField: 'CurrencyID', records: ex => ex.raw.currencies,
    locked: ['Code'], lockedWhy: 'it is the key', note: NOTE('') }),
  UOM: legacyUpdate('UOM', { key: { h: 'Code', kind: 'uom' }, idField: 'UOMID', records: ex => ex.raw.uoms,
    locked: ['Code'], lockedWhy: 'it is the key', note: NOTE('') }),
  ITEM: legacyUpdate('ITEM', { key: { h: 'Item Code', kind: 'item' }, idField: 'ItemID', records: ex => ex.raw.items,
    locked: ['Category', 'CompanyID'], lockedWhy: 'the item code is built from the category, and the item belongs to its company: change it on Item Master',
    note: NOTE('Category and company stay as they are.') }),
  VENDOR: legacyUpdate('VENDOR', { key: { h: 'Vendor Code', kind: 'vendor' }, idField: 'VendorID', records: ex => ex.raw.vendors,
    locked: ['CompanyID'], lockedWhy: 'a vendor belongs to its company: change it on Vendor Master', note: NOTE('The company stays as it is.') }),
  CUSTOMER: legacyUpdate('CUSTOMER', { key: { h: 'Customer Code', kind: 'customer' }, idField: 'CustomerID', records: ex => ex.raw.customers,
    locked: ['CompanyID'], lockedWhy: 'a customer belongs to its company: change it on Customer Master', note: NOTE('The company stays as it is.') }),
  FACLASS: legacyUpdate('FACLASS', { key: { h: 'Code', kind: 'faClass' }, idField: 'ClassID', records: ex => ex.raw.faClasses,
    locked: ['Code', 'Kind'], lockedWhy: 'the assets of a class follow its kind: change it on Fixed Asset Configuration', note: NOTE('The code and kind stay as they are.') }),
  FAASSET: legacyUpdate('FAASSET', { key: { h: 'Asset No.', kind: 'faAsset' }, idField: 'AssetID', records: ex => ex.raw.faAssets,
    locked: ['CompanyID', 'ClassID'], lockedWhy: 'an asset keeps its company and class: change it on Fixed Asset Master',
    note: NOTE('Company and class stay as they are; a capitalized asset keeps the rules of Fixed Asset Master.') }),
  USER: legacyUpdate('USER', { key: { h: 'Username', kind: 'user' }, idField: 'id', records: ex => ex.raw.users, companyOf: () => '',
    valueOf: (rec, key) => (key === 'assignedCompanies' ? rec.AssignedCompanies || [] : key === 'email' ? rec.email || '' : rec[key]),
    keep: ['status'], // a disabled user stays disabled
    locked: ['username', 'email'], lockedWhy: 'the username is the key and the email is the sign-in: change them on User Management',
    note: NOTE('The username and email stay as they are; passwords are not in the sheet.') }),
  EMPLOYEE: {
    key: { h: 'Employee No.', kind: 'employee' },
    // As the record's own screen: job and organization change through an
    // Employee Change (dated, approved), never by an edit.
    locked: ['CompanyID', 'DivisionID', 'BranchID', 'CostCenterID', 'DesignationID', 'GradeID', 'ScheduleID'],
    lockedWhy: 'changes through an Employee Change (it carries the date and the approval)',
    note: 'Only the columns you paste change. A blank cell keeps the value; type - to clear it. Company, division, branch, cost center, designation, grade and work schedule change through an Employee Change.',
    records: ex => ex.raw.employees,
    companyOf: rec => rec.CompanyID,
    valueOf: (rec, key) => (key.startsWith('cf_') ? (rec.Custom || {})[key.slice(3)] : rec[key]),
    save: async (ctx, user, id, rec, set) => {
      const data = Object.assign({}, rec, { EmployeeID: id, Custom: Object.assign({}, rec.Custom || {}) });
      Object.keys(set).forEach(k => { if (k.startsWith('cf_')) data.Custom[k.slice(3)] = set[k]; else data[k] = set[k]; });
      await saveEmployeeFor(user, data, { source: 'Import (update)' });
    },
    store: () => ({ firestore: 'employees', history: 'employeeHistory', reason: 'Import (update)' })
  }
};
const updateColumns = (m, u) => m.columns.filter(c => !u.locked.includes(c.key));

// A stored value as the sheet shows it (and as it is pasted back).
function shownValue(col, v, ex, forExport) {
  if (v == null || v === '') return '';
  if (col.type === 'date') { const x = String(v).match(/^(\d{4})-(\d{2})-(\d{2})$/); return x ? x[3] + '/' + x[2] + '/' + x[1] : String(v); }
  if (col.type === 'yesno') return v ? 'Yes' : 'No';
  if (col.type === 'enum') { const hit = col.values.find(x => x.value === v); return hit ? hit.label : String(v); }
  if (col.type === 'refs') return (Array.isArray(v) ? v : [v]).map(id => shownValue(Object.assign({}, col, { type: 'ref' }), id, ex, forExport)).join(', ');
  if (col.type === 'ref') {
    const hit = (ex[col.ref] || []).find(x => x.id === v);
    if (!hit) return String(v);
    if (forExport) return hit.code || hit.name;
    return [hit.code, hit.name].filter(Boolean).join(' ');
  }
  return String(v);
}

// Checks an update paste (nothing is written). Each resolved row is
// { id, set, changes: [{ column, from, to }] }.
async function checkUpdate(user, masterKey, text) {
  const m = await masterFor(masterKey);
  const u = UPDATES[masterKey];
  if (!m) throw new HttpsError('invalid-argument', 'Choose what to import.');
  const issues = [];
  const add = (row, column, message) => issues.push({ row, column: column || '', message });
  if (!u) return { headers: [], rows: [], resolved: [], issues: [{ row: 0, column: '', message: m.label + ' can\'t be updated by import yet: edit them on their own screen.' }] };
  if (!(await moduleHasCapability(m.module, m.capability || 'write', user.profile.role))) {
    add(0, '', 'You do not have permission to change ' + m.label + ' (the import needs the same right as editing it by hand).');
  }
  const seesSensitive = !m.columns.some(c => c.sensitive) || await moduleHasCapability(m.module, 'sensitive', user.profile.role);
  const table = parseSheet(text);
  if (!table.length) return { headers: [], rows: [], resolved: [], issues: [{ row: 0, column: '', message: 'Paste the header row and at least one row.' }] };
  if (table.length - 1 > MAX_ROWS) add(0, '', 'At most ' + MAX_ROWS + ' rows in one paste.');
  const headers = table[0];
  const cols = updateColumns(m, u);
  let keyAt = -1;
  const colAt = {};
  headers.forEach((h, i) => {
    const name = squash(h.replace(/\*$/, ''));
    if (name === squash(u.key.h)) { if (keyAt >= 0) add(0, h, 'Column "' + h + '" appears twice.'); keyAt = i; return; }
    const col = cols.find(c => squash(c.h) === name);
    const locked = m.columns.find(c => u.locked.includes(c.key) && squash(c.h) === name);
    if (locked) add(0, h, locked.h + ' can\'t be changed here: it ' + u.lockedWhy + '.');
    else if (!col) add(0, h, 'Unknown column "' + h + '". Copy the headers again from this screen.');
    else if (col.key in colAt) add(0, h, 'Column "' + h + '" appears twice.');
    else colAt[col.key] = i;
  });
  if (keyAt < 0) add(0, u.key.h, 'The key column "' + u.key.h + '" is missing: it says which record each row changes.');
  if (!Object.keys(colAt).length) add(0, '', 'Paste at least one column to change besides ' + u.key.h + '.');
  const body = table.slice(1);
  if (!body.length) add(0, '', 'There are no rows under the headers.');

  const ex = await loadExisting();
  const recs = u.records(ex);
  const seen = {};
  const resolved = [];
  body.forEach((cells, idx) => {
    const rowNo = idx + 1;
    const keyRaw = keyAt >= 0 ? String(cells[keyAt] || '').trim() : '';
    const hit = keyRaw ? (ex[u.key.kind] || []).find(x => x.code && norm(x.code) === norm(keyRaw)) : null;
    if (keyAt >= 0 && !keyRaw) add(rowNo, u.key.h, u.key.h + ' is required.');
    else if (keyAt >= 0 && !hit) add(rowNo, u.key.h, '"' + keyRaw + '" not found.');
    if (hit && seen[hit.id]) add(rowNo, u.key.h, 'Same ' + u.key.h + ' as row ' + seen[hit.id] + '.');
    if (hit) seen[hit.id] = seen[hit.id] || rowNo;
    const rec = hit ? recs[hit.id] : null;
    if (rec && !userCanAccessCompany(user.profile, u.companyOf(rec, hit.id))) add(rowNo, u.key.h, 'You do not have access to that record\'s company.');
    const co = rec ? u.companyOf(rec, hit.id) : '';
    const set = {};
    const issue = (col, msg) => add(rowNo, col.h, msg);
    for (const col of cols) {
      if (!(col.key in colAt)) continue;
      const raw = String(cells[colAt[col.key]] == null ? '' : cells[colAt[col.key]]).trim();
      if (raw === '') continue; // blank keeps the value (decision 8)
      if (raw === CLEAR) { if (col.req) issue(col, col.h + ' can\'t be cleared.'); else set[col.key] = col.type === 'refs' ? [] : (col.type === 'yesno' ? false : ''); continue; }
      if (col.sensitive && !seesSensitive) { issue(col, 'You do not have the right to change ' + col.h + ' (' + m.label + ': sensitive).'); continue; }
      let v = raw;
      if (col.type === 'yesno') { v = yesNo(raw); if (v === null) { issue(col, 'Enter Yes or No.'); continue; } } else if (col.type === 'number') { v = number(raw); if (v === null) { issue(col, '"' + raw + '" is not a number.'); continue; } } else if (col.type === 'enum') { v = enumValue(raw, col.values); if (v === null) { issue(col, '"' + raw + '" is not one of: ' + col.values.map(x => x.label).join(', ') + '.'); continue; } } else if (col.type === 'email') { if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw)) { issue(col, 'Enter a valid email address.'); continue; } } else if (col.type === 'date') { v = dateValue(raw); if (v === null) { issue(col, '"' + raw + '" is not a date (dd/mm/yyyy).'); continue; } } else if (col.type === 'ref' || col.type === 'refs') {
        // As when adding: by code or exact name; accounts, classes and units
        // of the record's company (or for all); sub-categories of its category.
        let pool = ex[col.ref] || [];
        if (['account', 'faClass', 'division', 'branch', 'costCenter', 'profitCenter', 'warehouse', 'location'].includes(col.ref) && co && masterKey !== 'COMPANY') pool = pool.filter(x => !x.rec.CompanyID || x.rec.CompanyID === co);
        if (col.ref === 'subCategory' && rec) pool = pool.filter(x => x.rec.ParentCategory === rec.Category && (!x.rec.CompanyID || x.rec.CompanyID === (co || rec.CompanyID || '')));
        const one = txt => {
          const byCode = pool.filter(x => x.code && norm(x.code) === norm(txt));
          const hits = byCode.length ? byCode : pool.filter(x => norm(x.name) === norm(txt));
          if (hits.length > 1) return { error: '"' + txt + '" matches more than one record; use its code.' };
          if (!hits.length) return { error: '"' + txt + '" not found.' };
          return { id: hits[0].id };
        };
        if (col.type === 'refs') {
          const ids = [];
          let bad = false;
          raw.split(',').map(x => x.trim()).filter(Boolean).forEach(t => { const res = one(t); if (res.error) { issue(col, res.error); bad = true; } else if (!ids.includes(res.id)) ids.push(res.id); });
          if (bad) continue;
          // Companies being added need the importer's access; ones the record already has may stay.
          const had = rec ? (u.valueOf(rec, col.key) || []) : [];
          if (col.ref === 'company') { const no = ids.find(c => !had.includes(c) && !userCanAccessCompany(user.profile, c)); if (no) { issue(col, 'You do not have access to company ' + ((ex.raw.companies[no] || {}).LegalName || no) + '.'); continue; } }
          v = ids;
        } else {
          const res = one(raw);
          if (res.error) { issue(col, res.error); continue; }
          v = res.id;
        }
      }
      set[col.key] = v;
    }
    const changes = [];
    if (rec) {
      Object.keys(set).forEach(k => {
        const col = cols.find(c => c.key === k);
        const from = u.valueOf(rec, k);
        const same = Array.isArray(set[k]) ? JSON.stringify((from || []).slice().sort()) === JSON.stringify(set[k].slice().sort())
          : col.type === 'yesno' ? Boolean(from) === Boolean(set[k]) : String(from == null ? '' : from) === String(set[k] == null ? '' : set[k]);
        if (same) { delete set[k]; return; }
        changes.push({ column: col.h, from: shownValue(col, from, ex), to: shownValue(col, set[k], ex) });
      });
    }
    resolved.push({ id: hit ? hit.id : '', set, changes, row: rowNo });
  });
  if (masterKey === 'EMPLOYEE') employeeUpdateRules(resolved, ex, add);
  return { headers, rows: body, resolved, issues };
}

// Line managers after the whole paste: not themselves, not someone who
// has left, and no loop (A reports to B who reports to A).
function employeeUpdateRules(resolved, ex, add) {
  const emps = ex.raw.employees;
  const mgr = {};
  Object.keys(emps).forEach(id => { mgr[id] = emps[id].ManagerID || ''; });
  resolved.forEach(o => { if (o.id && 'ManagerID' in o.set) mgr[o.id] = o.set.ManagerID; });
  resolved.forEach(o => {
    if (!o.id || !('ManagerID' in o.set) || !o.set.ManagerID) return;
    const m = o.set.ManagerID;
    if (m === o.id) { add(o.row, 'Line Manager', 'An employee can\'t be their own line manager.'); return; }
    if (emps[m] && emps[m].Status === 'Left') add(o.row, 'Line Manager', emps[m].FullName + ' has left.');
    const seen = new Set([o.id]);
    for (let at = m; at; at = mgr[at]) {
      if (seen.has(at)) { add(o.row, 'Line Manager', (emps[m] || {}).FullName + ' reports to ' + (emps[o.id] || {}).FullName + ' (directly or further down) after this paste: that would be a loop.'); break; }
      seen.add(at);
    }
  });
}

// Saves each changed row through the master's own save; on a failure,
// puts back the records saved in this run and removes their history.
async function updateRows(request, user, masterKey, resolved) {
  const u = UPDATES[masterKey];
  const m = await masterFor(masterKey);
  const store = u.store(m);
  const ex = await loadExisting();
  const recs = u.records(ex);
  const read = async id => (store.firestore ? (await firestore.collection(store.firestore).doc(id).get()).data() : (await rtdb.ref(store.rtdb + '/' + id).get()).val());
  const started = new Date().toISOString();
  const done = [];
  let failure = null;
  await run(request, async (ctx) => {
    for (const o of resolved.filter(x => Object.keys(x.set).length)) {
      try {
        const before = await read(o.id);
        await u.save(ctx, user, o.id, recs[o.id], o.set, u);
        done.push({ id: o.id, before });
      } catch (e) { failure = { row: o.row, message: e.message || 'The record could not be saved.' }; break; }
    }
  });
  if (!failure) return { updated: done.length };
  for (const d of done.slice().reverse()) {
    if (store.firestore) await firestore.collection(store.firestore).doc(d.id).set(d.before);
    else await rtdb.ref(store.rtdb + '/' + d.id).set(d.before);
    if (store.history) {
      const h = await firestore.collection(store.history).where('EmployeeID', '==', d.id).get();
      for (const x of h.docs) { const v = x.data(); if (v.Reason === store.reason && v.At >= started) await x.ref.delete(); }
    }
  }
  return { updated: 0, failure };
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
  const masters = await Promise.all(ORDER.map(masterFor));
  return ORDER.map((k, i) => {
    const m = masters[i];
    return {
      key: k, label: m.label, note: m.note || '', sample: m.sample || [], needsPassword: Boolean(m.authUser),
      columns: m.columns.map(c => ({ header: c.h, required: Boolean(c.req), note: c.note || '',
        values: c.values ? c.values.map(v => v.label) : (c.type === 'yesno' ? ['Yes', 'No'] : []) })),
      // Update existing (Part 3): the key column, then the columns that can change.
      update: UPDATES[k] ? { key: UPDATES[k].key.h, note: UPDATES[k].note,
        columns: updateColumns(m, UPDATES[k]).map(c => ({ header: c.h, note: c.note || '', values: c.values ? c.values.map(v => v.label) : (c.type === 'yesno' ? ['Yes', 'No'] : []) })) } : null
    };
  });
});

// Checks a paste (nothing is written).
exports.checkMasterImport = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  await requireImportAccess(user);
  const d = request.data || {};
  if (d.mode === 'update') {
    const c = await checkUpdate(user, String(d.master || ''), d.text);
    return { headers: c.headers, rows: c.rows, issues: c.issues, changes: c.resolved.map(o => o.changes) };
  }
  const c = await checkPaste(user, String(d.master || ''), d.text, { tempPassword: d.tempPassword });
  return { headers: c.headers, rows: c.rows, issues: c.issues };
});

// Checks again, then imports, all or nothing.
exports.runMasterImport = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  await requireImportAccess(user);
  const d = request.data || {};
  const masterKey = String(d.master || '');
  if (d.mode === 'update') {
    const c = await checkUpdate(user, masterKey, d.text);
    if (c.issues.length) return { success: false, issues: c.issues, updated: 0 };
    const result = await updateRows(request, user, masterKey, c.resolved);
    await rtdb.ref('masterImports').push({ Master: masterKey, Mode: 'Update', Rows: c.resolved.length, By: user.uid,
      ByName: user.profile.fullName || user.profile.username || user.uid, At: new Date().toISOString(), Status: result.failure ? 'Undone' : 'Updated',
      Updated: result.updated, Error: result.failure ? 'Row ' + result.failure.row + ': ' + result.failure.message : '' });
    if (result.failure) return { success: false, updated: 0, issues: [{ row: result.failure.row, column: '', message: result.failure.message + ' Nothing was changed.' }] };
    return { success: true, rows: c.resolved.length, updated: result.updated };
  }
  const opts = { tempPassword: String(d.tempPassword || '') };
  const c = await checkPaste(user, masterKey, d.text, opts);
  if (c.issues.length) return { success: false, issues: c.issues, created: 0 };
  const result = await importRows(request, user, masterKey, c.resolved, opts);
  const log = {
    Master: masterKey, Rows: c.resolved.length, By: user.uid, ByName: user.profile.fullName || user.profile.username || user.uid,
    At: new Date().toISOString(), Status: result.failure ? 'Undone' : 'Imported',
    Created: result.created.map(x => x.id), Error: result.failure ? 'Row ' + result.failure.row + ': ' + result.failure.message : ''
  };
  await rtdb.ref('masterImports').push(log);
  if (result.failure) {
    return { success: false, created: 0, issues: [{ row: result.failure.row, column: '', message: result.failure.message + ' Nothing was imported.' }] };
  }
  return { success: true, rows: c.resolved.length, created: result.created.length, codes: result.created.map(x => x.code).filter(Boolean) };
});

// Copy current records (decision 10): the master's records in the user's
// companies as a sheet (the key, then the columns that can change), to
// edit in Excel and paste back in Update mode.
exports.getMasterImportRecords = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  await requireImportAccess(user);
  const masterKey = String((request.data || {}).master || '');
  const m = await masterFor(masterKey);
  const u = UPDATES[masterKey];
  if (!m || !u) throw new HttpsError('invalid-argument', 'Those records can\'t be updated by import yet.');
  if (!(await moduleHasCapability(m.module, 'access', user.profile.role)) && !(await moduleHasCapability(m.module, m.capability || 'write', user.profile.role))) {
    throw new HttpsError('permission-denied', 'You do not have access to ' + m.label + '.');
  }
  const seesSensitive = await moduleHasCapability(m.module, 'sensitive', user.profile.role);
  const cols = updateColumns(m, u).filter(c => !c.sensitive || seesSensitive);
  const ex = await loadExisting();
  const recs = u.records(ex);
  const keys = (ex[u.key.kind] || []).filter(x => recs[x.id] && userCanAccessCompany(user.profile, u.companyOf(recs[x.id], x.id)))
    .sort((a, b) => String(a.code).localeCompare(String(b.code)));
  const cell = v => String(v).replace(/[\t\n\r]+/g, ' ');
  const lines = [[u.key.h].concat(cols.map(c => c.h)).join('\t')]
    .concat(keys.map(k => [k.code].concat(cols.map(c => shownValue(c, u.valueOf(recs[k.id], c.key), ex, true))).map(cell).join('\t')));
  return { text: lines.join('\n'), count: keys.length, sensitiveLeftOut: !seesSensitive && m.columns.some(c => c.sensitive) };
});

module.exports.parseSheet = parseSheet;
module.exports.MASTERS = MASTERS;
module.exports._importRows = importRows; // for the tests: the undo path, without a failing row having to pass the check
module.exports._updateRows = updateRows; // the same for an update
