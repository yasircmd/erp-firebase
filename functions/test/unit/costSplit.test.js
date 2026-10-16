// The cost split shared by payroll, the final settlement and interim
// payments (docs/modules/PAYROLL_COST_SPLIT.md):
//   node --test functions/test/unit/costSplit.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { shares, clean, describe } = require('../../src/costSplit');

test('no split: the whole amount on the main cost centre', () => {
  assert.deepEqual(shares(100, 'CC1', []), [{ CostCenterID: 'CC1', Amount: 100 }]);
  assert.deepEqual(shares(100, 'CC1', undefined), [{ CostCenterID: 'CC1', Amount: 100 }]);
});

test('shared by %; the rounding remainder to the largest share; the shares add up to the cent', () => {
  assert.deepEqual(shares(100, 'CC1', [{ CostCenterID: 'CC1', Percent: 33.33 }, { CostCenterID: 'CC2', Percent: 33.33 }, { CostCenterID: 'CC3', Percent: 33.34 }]),
    [{ CostCenterID: 'CC1', Amount: 33.33 }, { CostCenterID: 'CC2', Amount: 33.33 }, { CostCenterID: 'CC3', Amount: 33.34 }]);
  const s = shares(0.05, 'CC1', [{ CostCenterID: 'CC1', Percent: 50 }, { CostCenterID: 'CC2', Percent: 50 }]);
  assert.equal(Math.round(s.reduce((t, x) => t + x.Amount, 0) * 100) / 100, 0.05);
  assert.deepEqual(shares(3001, 'CC1', [{ CostCenterID: 'CC1', Percent: 60 }, { CostCenterID: 'CC2', Percent: 40 }]).map(x => x.Amount), [1800.6, 1200.4]);
});

test('clean: 100%, at least two, the main one in it, the company\'s cost centres, no repeats', () => {
  const units = { CC1: { Type: 'CostCenter', Code: 'CC1', CompanyID: 'C1' }, CC2: { Type: 'CostCenter', Code: 'CC2', CompanyID: '' }, CCX: { Type: 'CostCenter', Code: 'CCX', CompanyID: 'C2' }, B1: { Type: 'Branch' } };
  assert.deepEqual(clean([], 'CC1', units, 'C1'), []);
  assert.deepEqual(clean([{ CostCenterID: 'CC1', Percent: '70' }, { CostCenterID: 'CC2', Percent: 30 }], 'CC1', units, 'C1'), [{ CostCenterID: 'CC1', Percent: 70 }, { CostCenterID: 'CC2', Percent: 30 }]);
  assert.throws(() => clean([{ CostCenterID: 'CC1', Percent: 70 }, { CostCenterID: 'CC2', Percent: 20 }], 'CC1', units, 'C1'), /90%, not 100%/);
  assert.throws(() => clean([{ CostCenterID: 'CC1', Percent: 50 }, { CostCenterID: 'B1', Percent: 50 }], 'CC1', units, 'C1'), /choose a cost center/);
  assert.throws(() => clean([{ CostCenterID: 'CC1', Percent: 50 }, { CostCenterID: 'CCX', Percent: 50 }], 'CC1', units, 'C1'), /another company/);
  assert.throws(() => clean([{ CostCenterID: 'CC2', Percent: 100 }], 'CC1', units, 'C1'), /at least two/);
  assert.equal(describe([{ CostCenterID: 'CC1', Percent: 60 }], { CC1: { Name: 'Workshop' } }), 'Workshop 60%');
});
