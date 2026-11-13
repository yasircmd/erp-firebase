// Each module's short code (owner, 2026-11-13; docs/modules/UX4.md item 8,
// Q504): 2 to 4 capital letters, fixed by the firm, the same in every
// corporate, unique (unit/moduleShortCodes checks it against the registry).
// Shown beside the module in the menu; typed in the menu search, Enter opens
// it however many other modules match. A built module (X_...) takes the first
// letters of its id after X_ (up to 4), unless that is another module's code.
// New development, hand-written.
'use strict';

const SHORT = Object.freeze({
  USERMGMT: 'USR', COA: 'COA', JV: 'JV', CBT: 'CBT', CJV: 'CJV', TREEMGMT: 'TREE', ROLES: 'ROLE',
  COMPANYMASTER: 'COMP', VENDORMASTER: 'VEND', CUSTOMERMASTER: 'CUST', PROCUREMENTSETUP: 'PSET', SALESINVOICESETUP: 'SSET',
  APPROVALCONFIG: 'APC', APPROVALTRACKER: 'APT', PURCHASEREQUISITION: 'PR', INVENTORYPURCHASEREQUISITION: 'IPR',
  PURCHASEORDER: 'PO', JOBORDERREQUEST: 'JOR', PRICELISTING: 'PL', SALESORDER: 'SO', CURRENCYCONFIG: 'CUR',
  ORGUNITS: 'ORG', UOM: 'UOM', ITEMSUBCAT: 'ISC', ITEMMASTER: 'ITEM', GLREPORT: 'GL', STOCKAVAILABILITY: 'STA',
  INVENTORYVALUATION: 'IVL', STOCKLEDGER: 'STL', PRODCONSUMPTION: 'PCR', STOCKVALUATION: 'STV', TRIALBALANCE: 'TB',
  PROFITLOSS: 'PNL', PROJECTREPORT: 'PRJ', BALANCESHEET: 'BS', CASHFLOW: 'CFS', GRN: 'GRN', MATERIALISSUE: 'MI',
  PRODUCTION: 'PRD', WAREHOUSEMOVEMENT: 'WM', STOCKADJUSTMENT: 'SA', PHYSICALCOUNT: 'PC', BOM: 'BOM',
  MATERIALVARIANCE: 'MV', VENDORINVOICE: 'VI', PURCHASERETURN: 'PRT', DELIVERYNOTE: 'DN', CUSTOMERINVOICE: 'CI',
  SALESRETURN: 'SR', VENDORSOA: 'VSOA', CUSTOMERSOA: 'CSOA', CUSTOMERAGING: 'CAG', VENDORAGING: 'VAG',
  INVENTORYAGING: 'IAG', BATCHEXPIRY: 'EXP', REORDER: 'ROL', PERIODCLOSE: 'PCL', PDCRECEIVED: 'PDCR', PDCISSUED: 'PDCI',
  FACONFIG: 'FAC', FAASSET: 'FAM', FAACQ: 'FACQ', FADEPRUN: 'FADR', FAADDDEP: 'FAAD', FAREGISTER: 'FAR',
  FARETIRE: 'FART', FAAUC: 'CWIP', RECURRINGJV: 'RJV', DATARESET: 'DRS', MASTERIMPORT: 'IMP', OPENINGBALANCES: 'OB',
  DOCUMENTSTORAGE: 'DOCS', COMPANYDOCS: 'CDOC', HRSETUP: 'HRS', EMPLOYEES: 'EMP', EMPCHANGE: 'EMPC', LEAVE: 'LV',
  LEAVEREPORTS: 'LVR', PAYROLL: 'PAY', PAYROLLSETUP: 'PAYS', PAYROLLLOAN: 'LOAN', PAYROLLFS: 'FS', PAYROLLIP: 'IP',
  PAYROLLED: 'ED', PROVISIONS: 'PROV', RETAILSALES: 'RS', NUMBERING: 'NUM', EMPREQUESTS: 'EREQ', CLEARANCE: 'CLR',
  TAXCONFIG: 'TAXC', TAXREPORTS: 'TAXR', BUDGET: 'BUD', CREDITCONTROL: 'CRC', CRM: 'CRM', QUOTATION: 'QT',
  BANKREC: 'BRC', GLREC: 'GLR', MIS: 'MIS', MISDASHBOARD: 'MISD', DEVELOPER: 'CLM', TECHREF: 'TREF',
  BUILDER: 'MB', PACKSETUP: 'PKS', SUPPORT: 'SUP'
});

// A module's code, or '' (a built module whose letters are taken has none).
function codeFor(moduleId) {
  const id = String(moduleId || '');
  if (SHORT[id]) return SHORT[id];
  const m = /^X_([A-Z][A-Z0-9_]*)$/.exec(id);
  if (!m) return '';
  const c = m[1].replace(/[^A-Z0-9]/g, '').slice(0, 4);
  return c.length >= 2 && !Object.values(SHORT).includes(c) ? c : '';
}

module.exports = { SHORT, codeFor };
