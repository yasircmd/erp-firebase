// One employee's cost split across cost centres by % (owner, 2026-10-16;
// docs/modules/PAYROLL_COST_SPLIT.md, decisions 173-178). Shared by the
// payroll run, the final settlement and the interim payments: an expense
// line is shared across the split; the rounding remainder goes to the
// largest share, so the shares add up to the amount to the cent.
// A split: [{ CostCenterID, Percent }], adding up to 100, including the
// employee's main cost centre (the one approvals and reports use). Empty
// or missing: the whole amount on the main cost centre, as before.
'use strict';

const round2 = n => Math.round(n * 100) / 100;
const MAX_SHARES = 10;

// The amount by cost centre: [{ CostCenterID, Amount }].
function shares(amount, mainCostCenterId, split) {
  const list = (split || []).filter(x => x && x.CostCenterID && Number(x.Percent) > 0);
  if (!list.length) return [{ CostCenterID: mainCostCenterId || '', Amount: round2(amount) }];
  const out = list.map(x => ({ CostCenterID: x.CostCenterID, Amount: round2(amount * Number(x.Percent) / 100) }));
  const rest = round2(amount - out.reduce((s, x) => s + x.Amount, 0));
  if (rest) {
    const big = out.reduce((b, x, i) => (Number(list[i].Percent) > Number(list[b].Percent) ? i : b), 0);
    out[big].Amount = round2(out[big].Amount + rest);
  }
  return out.filter(x => x.Amount);
}

// A split as entered, checked; returns it cleaned ([] for none) or throws
// with the reason. units: orgUnits; companyId: the employee's company.
function clean(split, mainCostCenterId, units, companyId) {
  const list = (Array.isArray(split) ? split : []).filter(x => x && (x.CostCenterID || x.Percent));
  if (!list.length) return [];
  if (list.length === 1) throw new Error('A cost split needs at least two cost centers (one is just the cost center).');
  if (list.length > MAX_SHARES) throw new Error('A cost split has at most ' + MAX_SHARES + ' cost centers.');
  const seen = new Set();
  const out = list.map(x => {
    const id = String(x.CostCenterID || '').trim();
    const u = (units || {})[id];
    if (!u || u.Type !== 'CostCenter') throw new Error('Cost split: choose a cost center on every line.');
    if (u.CompanyID && u.CompanyID !== companyId) throw new Error('Cost split: ' + (u.Code || id) + ' belongs to another company.');
    if (seen.has(id)) throw new Error('Cost split: ' + (u.Code || id) + ' is listed twice.');
    seen.add(id);
    const p = round2(Number(x.Percent));
    if (!(p > 0) || p > 100) throw new Error('Cost split: each share is a % above 0, up to 100.');
    return { CostCenterID: id, Percent: p };
  });
  const total = round2(out.reduce((s, x) => s + x.Percent, 0));
  if (total !== 100) throw new Error('Cost split: the shares add up to ' + total + '%, not 100%.');
  if (!seen.has(mainCostCenterId)) throw new Error('Cost split: include the main cost center (the department).');
  return out;
}

// "Workshop 60%, Store 40%" for screens and the payslip.
const describe = (split, units) => (split || []).map(x => (((units || {})[x.CostCenterID] || {}).Name || x.CostCenterID) + ' ' + x.Percent + '%').join(', ');

module.exports = { shares, clean, describe };
