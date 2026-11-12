// The Real estate pack (MODULE_BUILDER.md, phase 6, Q494): properties and
// their units on a let/vacant board, leases holding a unit from start to end
// (no unit let twice), rent billed by a run as Lease Invoices (a variant of
// Customer Invoice), one invoice per tenant.
'use strict';
const PERIODS = ['Monthly', 'Quarterly', 'Half-yearly', 'Yearly'];

const definitions = [
  { id: 'X_RPROP', label: 'Property', kind: 'master', description: 'A building or plot the company lets.',
    fields: [
      { key: 'address', label: 'Address', type: 'text' },
      { key: 'use', label: 'Use', type: 'choice', options: ['Residential', 'Commercial', 'Mixed'] },
      { key: 'project', label: 'Project', type: 'link', target: 'PROJECT' }],
    listColumns: ['address', 'use'] },
  { id: 'X_RUNIT', label: 'Unit', kind: 'master', description: 'A unit of a property: its type, area and asking rent.',
    fields: [
      { key: 'property', label: 'Property', type: 'link', target: 'X_RPROP', required: true },
      { key: 'unitType', label: 'Unit type', type: 'choice', options: ['Studio', '1 bedroom', '2 bedrooms', '3 bedrooms', 'Shop', 'Office', 'Warehouse'], required: true },
      { key: 'area', label: 'Area (sq m)', type: 'number' },
      { key: 'rent', label: 'Asking rent per month', type: 'amount' },
      { key: 'condition', label: 'Condition', type: 'choice', options: ['Ready', 'Under repair'] }],
    board: { enabled: true, stateField: 'condition' }, listColumns: ['property', 'unitType', 'rent'] },
  { id: 'X_RLINV', label: 'Lease Invoice', kind: 'variant', base: 'CUSTOMERINVOICE', numbering: { prefix: 'LINV' },
    labels: { customer: 'Tenant' }, defaults: { description: 'Rent' },
    fields: [{ key: 'unit', label: 'Unit', type: 'text' }] },
  { id: 'X_RLEASE', label: 'Lease', kind: 'document', numbering: { prefix: 'LSE' }, description: 'A tenant\'s lease of a unit.',
    fields: [
      { key: 'tenant', label: 'Tenant', type: 'link', target: 'CUSTOMER', required: true },
      { key: 'unit', label: 'Unit', type: 'link', target: 'X_RUNIT', required: true },
      { key: 'starts', label: 'Starts', type: 'date', required: true },
      { key: 'ends', label: 'Ends', type: 'date', required: true },
      { key: 'rent', label: 'Rent per period', type: 'amount', required: true },
      { key: 'every', label: 'Billed', type: 'choice', options: PERIODS, required: true },
      { key: 'nextDue', label: 'Next rent due', type: 'date', required: true },
      { key: 'deposit', label: 'Security deposit', type: 'amount' },
      { key: 'term', label: 'Term (days)', type: 'calc', op: 'days', of: ['starts', 'ends'] }],
    statuses: [{ name: 'Draft' }, { name: 'Active' }, { name: 'Ended', final: true }, { name: 'Cancelled', final: true }],
    schedule: { enabled: true, resourceField: 'unit', startField: 'starts', endField: 'ends', endIsFree: false, holds: [{ status: 'Active', state: 'Let' }] },
    actions: [{ key: 'rent', label: 'Bill rent', target: 'CUSTOMERINVOICE', statuses: ['Active'], party: 'tenant', amount: 'rent', description: 'Rent {unit}, {period}',
      variant: 'X_RLINV', variantFields: { unit: 'unit' }, bulk: { enabled: true, nextDue: 'nextDue', periodField: 'every', group: 'party' } }],
    listColumns: ['tenant', 'unit', 'ends', 'rent'] }
];

const pack = {
  id: 'P_REALTY', label: 'Real estate', help: 'pack-real-estate',
  description: 'Properties and units on a let/vacant board, leases with no unit let twice, rent billed in one run as Lease Invoices.',
  modules: ['X_RPROP', 'X_RUNIT', 'X_RLEASE', 'X_RLINV'],
  menu: { folder: 'Real estate', items: [{ module: 'X_RLEASE', text: 'Leases' }, { module: 'X_RUNIT', text: 'Units' }, { module: 'X_RPROP', text: 'Properties' }, { module: 'X_RLINV', text: 'Lease Invoices' }] },
  reports: [
    { key: 'rentRoll', name: 'Rent roll by property', dataset: 'x:X_RLEASE', months: 12, spec: { view: 'group', groupBy: ['f_unit__property'], measures: [{ field: 'f_rent', agg: 'sum' }, { field: 'number', agg: 'count' }] }, tile: 'chart' },
    { key: 'units', name: 'Units by type', dataset: 'x:X_RUNIT', months: 1, spec: { view: 'group', groupBy: ['f_unitType'], measures: [{ field: 'code', agg: 'count' }, { field: 'f_rent', agg: 'sum' }] } },
    { key: 'ending', name: 'Leases by end date', dataset: 'x:X_RLEASE', months: 24, spec: { view: 'list', columns: ['number', 'status', 'f_tenant', 'f_unit', 'f_ends', 'f_rent'], sort: { by: 4, dir: 'asc' } } },
    { key: 'billed', name: 'Rent billed by tenant', dataset: 'sales', months: 1, spec: { view: 'group', groupBy: ['customer'], measures: [{ field: 'amount', agg: 'sum' }], filters: [{ field: 'variant', op: 'eq', value: 'Lease Invoice' }] }, tile: 'top' }],
  checklist: [
    { key: 'units', kind: 'manual', text: 'Add your properties and their units (Real estate → Properties, Units).' },
    { key: 'books', kind: 'setup', module: 'X_RLEASE', text: 'Set the sales type and the rent revenue account for Lease Invoices (Leases → Setup).' },
    { key: 'tax', kind: 'tax', text: 'Check which rents are taxed (for example commercial rent) and their tax codes in Tax Configuration.' },
    { key: 'roles', kind: 'rights', text: 'Give the leasing team its rights in Roles & Permissions.' }]
};

module.exports = { pack, definitions };
