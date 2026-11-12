// The Construction pack (MODULE_BUILDER.md, phase 6, Q494, Q499): contracts
// on the ERP's projects with their bill of quantities; monthly progress
// claims (work to date less earlier claims, retention and advance recovery
// worked out); retention released and advances billed; subcontracts and
// their claims; daily site reports.
//
// To the books (Q462): a Customer Invoice takes no line below zero, so a
// claim's invoice is its gross amount, and its retention and the advance it
// recovers are moved off the customer by their own Journals (retention
// receivable, advances received). The same in the books, in three documents.
'use strict';
const ST = [{ name: 'Draft' }, { name: 'Certified' }, { name: 'Cancelled', final: true }];
const contract = { key: 'contract', label: 'Contract', type: 'link', target: 'X_CCONTR', required: true };
const customer = { key: 'customer', label: 'Customer', type: 'link', target: 'CUSTOMER', required: true };
const project = { key: 'project', label: 'Project', type: 'link', target: 'PROJECT', required: true };

const definitions = [
  { id: 'X_CCONTR', label: 'Contract', kind: 'master', description: 'A contract with a customer, on one of the company\'s projects.',
    fields: [customer, project,
      { key: 'value', label: 'Contract value', type: 'amount', required: true },
      { key: 'retPct', label: 'Retention %', type: 'number' },
      { key: 'advPct', label: 'Advance recovery %', type: 'number' },
      { key: 'advance', label: 'Advance', type: 'amount' },
      { key: 'starts', label: 'Starts', type: 'date' },
      { key: 'completes', label: 'Completion', type: 'date' }],
    listColumns: ['customer', 'project', 'value'] },
  { id: 'X_CBOQ', label: 'BOQ item', kind: 'master', description: 'A line of a contract\'s bill of quantities.',
    fields: [contract,
      { key: 'section', label: 'Section', type: 'text' },
      { key: 'unit', label: 'Unit', type: 'text' },
      { key: 'qty', label: 'Quantity', type: 'number', required: true },
      { key: 'rate', label: 'Rate', type: 'amount', required: true },
      { key: 'amount', label: 'Amount', type: 'calc', op: 'product', of: ['qty', 'rate'] }],
    listColumns: ['contract', 'section', 'qty', 'rate', 'amount'] },
  { id: 'X_CCLAIM', label: 'Progress claim', kind: 'document', numbering: { prefix: 'PC' }, description: 'A monthly claim for the work done to date.',
    fields: [contract, customer, project,
      { key: 'retPct', label: 'Retention %', type: 'number' },
      { key: 'advPct', label: 'Advance recovery %', type: 'number' },
      { key: 'variations', label: 'Variations this claim', type: 'amount' },
      { key: 'thisClaim', label: 'This claim', type: 'calc', op: 'sum', of: ['t:thisAmount', 'variations'] },
      { key: 'retention', label: 'Retention held', type: 'calc', op: 'percent', of: ['thisClaim', 'retPct'] },
      { key: 'recovered', label: 'Advance recovered', type: 'calc', op: 'percent', of: ['thisClaim', 'advPct'] },
      { key: 'afterRetention', label: 'After retention', type: 'calc', op: 'difference', of: ['thisClaim', 'retention'] },
      { key: 'net', label: 'Net due', type: 'calc', op: 'difference', of: ['afterRetention', 'recovered'] },
      { key: 'claimedBefore', label: 'Claimed before', type: 'calc', op: 'previous', of: ['thisClaim'], by: 'contract', skip: ['Cancelled'] },
      { key: 'toDate', label: 'Claimed to date', type: 'calc', op: 'sum', of: ['claimedBefore', 'thisClaim'] }],
    lines: { enabled: true, label: 'Work done', fields: [
      { key: 'boq', label: 'BOQ item', type: 'link', target: 'X_CBOQ', required: true },
      { key: 'qtyToDate', label: 'Quantity to date', type: 'number', required: true },
      { key: 'rate', label: 'Rate', type: 'amount', required: true },
      { key: 'valueToDate', label: 'Value to date', type: 'calc', op: 'product', of: ['qtyToDate', 'rate'] },
      { key: 'before', label: 'Claimed before', type: 'calc', op: 'previous', of: ['thisAmount'], by: 'contract', match: 'boq', skip: ['Cancelled'] },
      { key: 'thisAmount', label: 'This claim', type: 'calc', op: 'difference', of: ['valueToDate', 'before'] }] },
    statuses: ST,
    actions: [
      { key: 'invoice', label: 'Invoice the claim', target: 'CUSTOMERINVOICE', statuses: ['Certified'], party: 'customer', amount: 'thisClaim', project: 'project', description: 'Progress claim {number}' },
      { key: 'retain', label: 'Hold retention', target: 'JV', statuses: ['Certified'], party: 'customer', partySide: 'credit', amount: 'retention', project: 'project', description: 'Retention on {number}' },
      { key: 'recover', label: 'Recover advance', target: 'JV', statuses: ['Certified'], party: 'customer', partySide: 'credit', amount: 'recovered', project: 'project', description: 'Advance recovered on {number}' }],
    listColumns: ['contract', 'thisClaim', 'retention', 'net'] },
  { id: 'X_CADV', label: 'Advance billed', kind: 'document', numbering: { prefix: 'ADV' }, description: 'An advance billed to the customer under a contract.',
    fields: [contract, customer, project, { key: 'amount', label: 'Advance', type: 'amount', required: true }],
    statuses: ST,
    actions: [{ key: 'bill', label: 'Bill the advance', target: 'JV', statuses: ['Certified'], party: 'customer', partySide: 'debit', amount: 'amount', project: 'project', description: 'Advance {number}' }],
    listColumns: ['contract', 'amount'] },
  { id: 'X_CRREL', label: 'Retention release', kind: 'document', numbering: { prefix: 'RR' }, description: 'Retention held on a contract, released to be paid.',
    fields: [contract, customer, project, { key: 'amount', label: 'Released', type: 'amount', required: true }],
    statuses: ST,
    actions: [{ key: 'release', label: 'Release retention', target: 'JV', statuses: ['Certified'], party: 'customer', partySide: 'debit', amount: 'amount', project: 'project', description: 'Retention released {number}' }],
    listColumns: ['contract', 'amount'] },
  { id: 'X_CSUB', label: 'Subcontract', kind: 'master', description: 'Work given to a subcontractor on a project.',
    fields: [{ key: 'vendor', label: 'Subcontractor', type: 'link', target: 'VENDOR', required: true }, project,
      { key: 'scope', label: 'Scope', type: 'longtext' }, { key: 'value', label: 'Subcontract value', type: 'amount' }, { key: 'retPct', label: 'Retention %', type: 'number' }],
    listColumns: ['vendor', 'project', 'value'] },
  { id: 'X_CSCLAIM', label: 'Subcontractor claim', kind: 'document', numbering: { prefix: 'SCC' }, description: 'A subcontractor\'s claim for its work.',
    fields: [{ key: 'subcontract', label: 'Subcontract', type: 'link', target: 'X_CSUB', required: true }, { key: 'vendor', label: 'Subcontractor', type: 'link', target: 'VENDOR', required: true }, project,
      { key: 'vendorRef', label: 'Their invoice no', type: 'text' },
      { key: 'amount', label: 'Claimed', type: 'amount', required: true }, { key: 'retPct', label: 'Retention %', type: 'number' },
      { key: 'retention', label: 'Retention held', type: 'calc', op: 'percent', of: ['amount', 'retPct'] },
      { key: 'net', label: 'Net to pay', type: 'calc', op: 'difference', of: ['amount', 'retention'] },
      { key: 'claimedBefore', label: 'Claimed before', type: 'calc', op: 'previous', of: ['amount'], by: 'subcontract', skip: ['Cancelled'] }],
    statuses: ST,
    actions: [
      { key: 'invoice', label: 'Vendor invoice', target: 'VENDORINVOICE', statuses: ['Certified'], party: 'vendor', amount: 'amount', reference: 'vendorRef', project: 'project', description: 'Subcontract claim {number}' },
      { key: 'retain', label: 'Hold retention', target: 'JV', statuses: ['Certified'], party: 'vendor', partySide: 'debit', amount: 'retention', project: 'project', description: 'Retention on {number}' }],
    listColumns: ['subcontract', 'amount', 'net'] },
  { id: 'X_CSITE', label: 'Site report', kind: 'document', numbering: { prefix: 'SR' }, description: 'The day on site: people, equipment, progress and issues.',
    fields: [project, { key: 'contract', label: 'Contract', type: 'link', target: 'X_CCONTR' },
      { key: 'weather', label: 'Weather', type: 'choice', options: ['Clear', 'Hot', 'Rain', 'Wind', 'Other'] },
      { key: 'labour', label: 'Workers on site', type: 'number' },
      { key: 'hours', label: 'Hours worked', type: 'number' },
      { key: 'manHours', label: 'Man-hours', type: 'calc', op: 'product', of: ['labour', 'hours'] },
      { key: 'equipment', label: 'Equipment', type: 'longtext' },
      { key: 'progress', label: 'Progress', type: 'longtext' },
      { key: 'issues', label: 'Issues and delays', type: 'longtext' }],
    statuses: [{ name: 'Draft' }, { name: 'Submitted' }],
    listColumns: ['project', 'labour', 'manHours'] }
];

const pack = {
  id: 'P_CONSTR', label: 'Construction', help: 'pack-construction',
  description: 'Contracts with their bill of quantities, progress claims with retention and advance recovery, retention releases, subcontracts and their claims, site reports.',
  modules: ['X_CCONTR', 'X_CBOQ', 'X_CCLAIM', 'X_CADV', 'X_CRREL', 'X_CSUB', 'X_CSCLAIM', 'X_CSITE'],
  menu: { folder: 'Construction', items: [{ module: 'X_CCONTR', text: 'Contracts' }, { module: 'X_CBOQ', text: 'Bill of quantities' }, { module: 'X_CCLAIM', text: 'Progress claims' },
    { module: 'X_CADV', text: 'Advances billed' }, { module: 'X_CRREL', text: 'Retention releases' }, { module: 'X_CSUB', text: 'Subcontracts' }, { module: 'X_CSCLAIM', text: 'Subcontractor claims' }, { module: 'X_CSITE', text: 'Site reports' }] },
  reports: [
    { key: 'claimed', name: 'Claimed by contract', dataset: 'x:X_CCLAIM', months: 12, spec: { view: 'group', groupBy: ['f_contract'], measures: [{ field: 'f_thisClaim', agg: 'sum' }, { field: 'f_retention', agg: 'sum' }, { field: 'f_recovered', agg: 'sum' }] }, tile: 'chart' },
    { key: 'retention', name: 'Retention held by customer', dataset: 'x:X_CCLAIM', months: 24, spec: { view: 'group', groupBy: ['f_customer'], measures: [{ field: 'f_retention', agg: 'sum' }], filters: [{ field: 'status', op: 'eq', value: 'Certified' }] }, tile: 'top' },
    { key: 'boq', name: 'Work done by BOQ item', dataset: 'xl:X_CCLAIM', months: 12, spec: { view: 'group', groupBy: ['l_boq__contract', 'l_boq'], measures: [{ field: 'l_thisAmount', agg: 'sum' }] } },
    { key: 'subs', name: 'Subcontractor claims by project', dataset: 'x:X_CSCLAIM', months: 12, spec: { view: 'group', groupBy: ['f_project'], measures: [{ field: 'f_amount', agg: 'sum' }, { field: 'f_retention', agg: 'sum' }] } },
    { key: 'site', name: 'Man-hours by project', dataset: 'x:X_CSITE', months: 1, spec: { view: 'group', groupBy: ['f_project'], measures: [{ field: 'f_manHours', agg: 'sum' }] } }],
  checklist: [
    { key: 'projects', kind: 'manual', text: 'Make sure each contract\'s project is in Projects, then add the contracts and their BOQ items (Construction → Contracts, Bill of quantities).' },
    { key: 'claims', kind: 'setup', module: 'X_CCLAIM', text: 'Progress claims: the sales type and revenue account, the retention receivable account and the advances received account (Progress claims → Setup).' },
    { key: 'advances', kind: 'setup', module: 'X_CADV', text: 'Advances billed: the advances received account (Advances billed → Setup).' },
    { key: 'releases', kind: 'setup', module: 'X_CRREL', text: 'Retention releases: the retention receivable account (Retention releases → Setup).' },
    { key: 'subs', kind: 'setup', module: 'X_CSCLAIM', text: 'Subcontractor claims: the subcontract cost account and the retention payable account (Subcontractor claims → Setup).' },
    { key: 'tax', kind: 'tax', text: 'Check the tax codes your contract revenue and subcontract costs take in Tax Configuration.' },
    { key: 'roles', kind: 'rights', text: 'Give the commercial team and the site engineers their rights in Roles & Permissions.' }]
};

module.exports = { pack, definitions };
