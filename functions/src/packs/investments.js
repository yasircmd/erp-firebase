// The Investments pack (MODULE_BUILDER.md, phase 6, Q494): the investments
// held, with their expected income worked out, and the documents that move
// them in the books, each by its own Journal through the Journal Entry's own
// save: a purchase, a sale (its cost, and the gain over it), income received,
// and a revaluation up or down. The accounts are each company's, in each
// document's Setup.
'use strict';
const ST = [{ name: 'Draft' }, { name: 'Confirmed' }, { name: 'Cancelled', final: true }];
const inv = { key: 'investment', label: 'Investment', type: 'link', target: 'X_IINV', required: true };
const jv = (key, label, amount, extra) => Object.assign({ key, label, target: 'JV', statuses: ['Confirmed'], amount, description: label + ' {investment} {number}' }, extra || {});

const definitions = [
  { id: 'X_IINV', label: 'Investment', kind: 'master', description: 'Something the company holds as an investment.',
    fields: [
      { key: 'instrument', label: 'Instrument', type: 'choice', options: ['Deposit', 'Bond', 'Shares', 'Fund', 'Property', 'Other'], required: true },
      { key: 'counterparty', label: 'Counterparty', type: 'text' },
      { key: 'starts', label: 'Bought on', type: 'date' },
      { key: 'matures', label: 'Matures', type: 'date' },
      { key: 'cost', label: 'Cost', type: 'amount' },
      { key: 'rate', label: 'Expected return % a year', type: 'number' },
      { key: 'income', label: 'Expected income a year', type: 'calc', op: 'percent', of: ['cost', 'rate'] },
      { key: 'term', label: 'Term (days)', type: 'calc', op: 'days', of: ['starts', 'matures'] }],
    listColumns: ['instrument', 'cost', 'matures'] },
  { id: 'X_IBUY', label: 'Investment purchase', kind: 'document', numbering: { prefix: 'IB' },
    fields: [inv, { key: 'amount', label: 'Amount paid', type: 'amount', required: true }, { key: 'reference', label: 'Reference', type: 'text' }],
    statuses: ST, actions: [jv('book', 'Investment purchase', 'amount', { reference: 'reference' })], listColumns: ['investment', 'amount'] },
  { id: 'X_ISELL', label: 'Investment sale', kind: 'document', numbering: { prefix: 'IS' },
    fields: [inv, { key: 'proceeds', label: 'Proceeds', type: 'amount', required: true }, { key: 'cost', label: 'Cost of what was sold', type: 'amount', required: true },
      { key: 'gain', label: 'Gain (proceeds − cost)', type: 'calc', op: 'difference', of: ['proceeds', 'cost'] },
      { key: 'loss', label: 'Loss (cost − proceeds)', type: 'calc', op: 'difference', of: ['cost', 'proceeds'] }],
    statuses: ST,
    actions: [jv('cost', 'Investment sold at cost', 'cost'), jv('gain', 'Gain on investment', 'gain'), jv('loss', 'Loss on investment', 'loss')],
    listColumns: ['investment', 'proceeds', 'gain'] },
  { id: 'X_IINC', label: 'Investment income', kind: 'document', numbering: { prefix: 'II' },
    fields: [inv, { key: 'kind', label: 'Income', type: 'choice', options: ['Interest', 'Dividend', 'Rent', 'Other'] }, { key: 'amount', label: 'Amount received', type: 'amount', required: true }],
    statuses: ST, actions: [jv('book', 'Investment income', 'amount')], listColumns: ['investment', 'kind', 'amount'] },
  { id: 'X_IREV', label: 'Investment revaluation', kind: 'document', numbering: { prefix: 'IR' },
    fields: [inv, { key: 'was', label: 'Value before', type: 'amount', required: true }, { key: 'now', label: 'Value now', type: 'amount', required: true },
      { key: 'up', label: 'Increase', type: 'calc', op: 'difference', of: ['now', 'was'] },
      { key: 'down', label: 'Decrease', type: 'calc', op: 'difference', of: ['was', 'now'] }],
    statuses: ST, actions: [jv('up', 'Revaluation up', 'up'), jv('down', 'Revaluation down', 'down')], listColumns: ['investment', 'was', 'now'] }
];

const pack = {
  id: 'P_INVEST', label: 'Investments', help: 'pack-investments',
  description: 'The investments held with their expected income; purchases, sales, income and revaluations, each journaled through the Journal Entry.',
  modules: ['X_IINV', 'X_IBUY', 'X_ISELL', 'X_IINC', 'X_IREV'],
  menu: { folder: 'Investments', items: [{ module: 'X_IINV', text: 'Investments' }, { module: 'X_IBUY', text: 'Purchases' }, { module: 'X_ISELL', text: 'Sales' }, { module: 'X_IINC', text: 'Income received' }, { module: 'X_IREV', text: 'Revaluations' }] },
  reports: [
    { key: 'holdings', name: 'Holdings by instrument', dataset: 'x:X_IINV', months: 1, spec: { view: 'group', groupBy: ['f_instrument'], measures: [{ field: 'f_cost', agg: 'sum' }, { field: 'f_income', agg: 'sum' }] }, tile: 'chart' },
    { key: 'income', name: 'Income received by investment', dataset: 'x:X_IINC', months: 12, spec: { view: 'group', groupBy: ['f_investment'], measures: [{ field: 'f_amount', agg: 'sum' }] }, tile: 'top' },
    { key: 'maturing', name: 'Investments by maturity', dataset: 'x:X_IINV', months: 1, spec: { view: 'list', columns: ['code', 'name', 'f_instrument', 'f_cost', 'f_matures'], sort: { by: 4, dir: 'asc' } } }],
  checklist: [
    { key: 'list', kind: 'manual', text: 'Add the investments you hold, with their cost and expected return (Investments → Investments).' },
    { key: 'buy', kind: 'setup', module: 'X_IBUY', text: 'Purchases: the investment account (debit) and the bank (credit) in Purchases → Setup.' },
    { key: 'sell', kind: 'setup', module: 'X_ISELL', text: 'Sales: the bank and the investment account (at cost), the gain and the loss accounts, in Sales → Setup.' },
    { key: 'income', kind: 'setup', module: 'X_IINC', text: 'Income: the bank (debit) and the income account (credit) in Income received → Setup.' },
    { key: 'reval', kind: 'setup', module: 'X_IREV', text: 'Revaluations: the investment account and the revaluation reserve, both ways, in Revaluations → Setup.' },
    { key: 'roles', kind: 'rights', text: 'Give the treasury team its rights in Roles & Permissions.' }]
};

module.exports = { pack, definitions };
