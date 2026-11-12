// The Subscriptions pack (MODULE_BUILDER.md, phase 6, Q494): plans, each
// customer's subscriptions with their fee worked out, and the billing run:
// every subscription due, one invoice per customer, next due moved on.
'use strict';
const PERIODS = ['Monthly', 'Quarterly', 'Half-yearly', 'Yearly'];

const definitions = [
  { id: 'X_SPLAN', label: 'Plan', kind: 'master', description: 'What is sold by subscription, and its price.',
    fields: [
      { key: 'price', label: 'Price per period', type: 'amount', required: true },
      { key: 'billed', label: 'Billed', type: 'choice', options: PERIODS },
      { key: 'details', label: 'Details', type: 'longtext' }],
    listColumns: ['price', 'billed'] },
  { id: 'X_SUBSCR', label: 'Subscription', kind: 'master', description: 'A customer\'s subscription to a plan.',
    fields: [
      { key: 'customer', label: 'Customer', type: 'link', target: 'CUSTOMER', required: true },
      { key: 'plan', label: 'Plan', type: 'link', target: 'X_SPLAN', required: true },
      { key: 'quantity', label: 'Quantity', type: 'number', required: true },
      { key: 'price', label: 'Price per period', type: 'amount', required: true },
      { key: 'fee', label: 'Fee per period', type: 'calc', op: 'product', of: ['quantity', 'price'] },
      { key: 'every', label: 'Billed', type: 'choice', options: PERIODS, required: true },
      { key: 'starts', label: 'Starts', type: 'date' },
      { key: 'nextDue', label: 'Next due', type: 'date', required: true }],
    actions: [{ key: 'bill', label: 'Bill subscriptions', target: 'CUSTOMERINVOICE', party: 'customer', amount: 'fee', description: '{plan} × {quantity}, {period}',
      bulk: { enabled: true, nextDue: 'nextDue', periodField: 'every', group: 'party' } }],
    listColumns: ['customer', 'plan', 'fee', 'nextDue'] }
];

const pack = {
  id: 'P_SUBS', label: 'Subscriptions', help: 'pack-subscriptions',
  description: 'Plans and customers\' subscriptions, billed in one run: every subscription due, one invoice per customer.',
  modules: ['X_SPLAN', 'X_SUBSCR'],
  menu: { folder: 'Subscriptions', items: [{ module: 'X_SUBSCR', text: 'Subscriptions' }, { module: 'X_SPLAN', text: 'Plans' }] },
  reports: [
    { key: 'byPlan', name: 'Recurring fees by plan', dataset: 'x:X_SUBSCR', months: 1, spec: { view: 'group', groupBy: ['f_plan'], measures: [{ field: 'f_fee', agg: 'sum' }, { field: 'code', agg: 'count' }] }, tile: 'chart' },
    { key: 'byCustomer', name: 'Recurring fees by customer', dataset: 'x:X_SUBSCR', months: 1, spec: { view: 'group', groupBy: ['f_customer'], measures: [{ field: 'f_fee', agg: 'sum' }] }, tile: 'top' },
    { key: 'due', name: 'Subscriptions by next due date', dataset: 'x:X_SUBSCR', months: 1, spec: { view: 'list', columns: ['code', 'f_customer', 'f_plan', 'f_fee', 'f_nextDue'], sort: { by: 4, dir: 'asc' } } }],
  checklist: [
    { key: 'plans', kind: 'manual', text: 'Add your plans with their prices (Subscriptions → Plans).' },
    { key: 'books', kind: 'setup', module: 'X_SUBSCR', text: 'Set the sales type and the revenue account for the billing run (Subscriptions → Setup).' },
    { key: 'tax', kind: 'tax', text: 'Check the tax code the subscription revenue takes in Tax Configuration.' },
    { key: 'roles', kind: 'rights', text: 'Give the team that bills subscriptions its rights in Roles & Permissions.' }]
};

module.exports = { pack, definitions };
