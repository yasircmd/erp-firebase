// Which accounts need a cost center, profit center or project
// (docs/modules/PROJECTS_DIMENSIONS.md, decisions 219-224): the rule is
// set on a heading and its accounts follow it, an account may differ, and
// with no rule anywhere today's rule applies (Expense, Revenue and COGS
// need a cost center).
const test = require('node:test');
const assert = require('node:assert/strict');
const { ruleOf, rulesOf, applyRules, cleanRules } = require('../../src/dimensionRules');

const coa = {
  G6: { AccountCode: '600000', AccountType: 'Expense', IsPostable: false },
  G61: { AccountCode: '610000', AccountType: 'Expense', IsPostable: false, ParentAccountID: 'G6', DimensionRules: { CostCenter: 'Optional', ProfitCenter: 'NotUsed', Project: '' } },
  RENT: { AccountCode: '610001', AccountName: 'Rent', AccountType: 'Expense', IsPostable: true, ParentAccountID: 'G61' },
  SITE: { AccountCode: '610002', AccountName: 'Site expenses', AccountType: 'Expense', IsPostable: true, ParentAccountID: 'G61', DimensionRules: { Project: 'Required', CostCenter: 'Required' } },
  SAL: { AccountCode: '620001', AccountName: 'Salaries', AccountType: 'Expense', IsPostable: true, ParentAccountID: 'G6' },
  BANK: { AccountCode: '120001', AccountName: 'Bank', AccountType: 'Asset', IsPostable: true }
};

test('no rule anywhere: today\'s rule (an expense needs a cost center; the rest optional)', () => {
  assert.deepEqual(rulesOf(coa.SAL, coa), { CostCenter: 'Required', ProfitCenter: 'Optional', Project: 'Optional' });
  assert.deepEqual(rulesOf(coa.BANK, coa), { CostCenter: 'Optional', ProfitCenter: 'Optional', Project: 'Optional' });
  assert.equal(ruleOf(coa.SAL, coa, 'CostCenter').from, 'default');
});

test('the heading\'s rule, followed by its accounts; an account\'s own wins; blank follows the heading', () => {
  assert.deepEqual(rulesOf(coa.RENT, coa), { CostCenter: 'Optional', ProfitCenter: 'NotUsed', Project: 'Optional' });
  assert.equal(ruleOf(coa.RENT, coa, 'CostCenter').from, '610000');
  assert.deepEqual(rulesOf(coa.SITE, coa), { CostCenter: 'Required', ProfitCenter: 'NotUsed', Project: 'Required' });
  assert.equal(ruleOf(coa.SITE, coa, 'Project').from, 'account');
});

test('a line: a required one missing is refused (the cost center message as before); a not-used one is dropped', () => {
  assert.throws(() => applyRules({}, coa.SAL, coa, 'Line 1: '), /^Error: Line 1: account 620001 \(Expense\) requires a Cost Center\.$/);
  assert.throws(() => applyRules({ CostCenterID: 'CC1' }, coa.SITE, coa, 'Line 2: '), /Line 2: account 610002 requires a Project\./);
  assert.deepEqual(applyRules({ ProfitCenterID: 'PC1', ProjectID: ' P1 ' }, coa.RENT, coa), { CostCenterID: '', ProfitCenterID: '', ProjectID: 'P1' });
  assert.deepEqual(applyRules({ CostCenterID: 'CC1', ProfitCenterID: 'PC1' }, coa.BANK, coa), { CostCenterID: 'CC1', ProfitCenterID: 'PC1', ProjectID: '' });
});

test('rules as sent by a screen: each Required, Optional, NotUsed or blank', () => {
  assert.deepEqual(cleanRules({ CostCenter: 'Required', Project: 'NotUsed' }), { CostCenter: 'Required', ProfitCenter: '', Project: 'NotUsed' });
  assert.throws(() => cleanRules({ Project: 'Sometimes' }), /Project must be Required, Optional or Not used/);
});
