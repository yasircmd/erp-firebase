// CRM step C4 (docs/modules/CRM.md, Q402, Q407): the four reports from the
// records, worked out without the emulators: base-currency totals at the
// given rates (a currency with no rate shown, left out of the totals), the
// pipeline by stage / owner / month, win / loss in the period with the win
// rate, activities done / open / overdue, and lead sources with conversions
// and the won value of their opportunities.
const test = require('node:test');
const assert = require('node:assert/strict');
const { crmReports } = require('../../src/crm');

const setup = { Stages: [{ Name: 'New', Probability: 10 }, { Name: 'Proposal', Probability: 50 }] };
const opp = (id, o) => Object.assign({ ID: id, Title: id, CustomerID: 'CU1', OwnerKey: 'U:a', Status: 'Open', Stage: 'New', Probability: 10, ExpectedValue: 1000, Currency: 'AED' }, o);
const base = { setup, base: 'AED', rates: { USD: 3.6725, EUR: null }, from: '2026-10-01', to: '2026-10-31', today: '2026-10-20' };

test('pipeline: open only, in base at the rate, weighted by probability; by stage in the setup order, owner and month', () => {
  const r = crmReports(Object.assign({}, base, {
    leads: [], activities: [],
    opportunities: [
      opp('o1', { ExpectedValue: 1000, ExpectedClose: '2026-11-15' }),
      opp('o2', { Stage: 'Proposal', Probability: 50, ExpectedValue: 100, Currency: 'USD', OwnerKey: 'E:rep', ExpectedClose: '2026-11-02' }),
      opp('o3', { Stage: 'Proposal', Probability: 50, ExpectedValue: 500, Currency: 'EUR' }),
      opp('o4', { Status: 'Won', Stage: 'Won', Probability: 100, ClosedAt: '2026-10-05T10:00:00Z' })
    ]
  }));
  assert.deepEqual(r.pipeline.byStage.map(g => [g.Key, g.Count, g.Value, g.Weighted]), [['New', 1, 1000, 100], ['Proposal', 2, 367.25, 183.63]]);
  assert.deepEqual(r.pipeline.total, { Count: 3, Value: 1367.25, Weighted: 283.63 });
  assert.deepEqual(r.missingRates, ['EUR'], 'EUR has no rate');
  const eur = r.pipeline.lines.find(l => l.ID === 'o3');
  assert.equal(eur.BaseValue, null); assert.equal(eur.Value, 500); assert.equal(eur.Currency, 'EUR');
  assert.deepEqual(r.pipeline.byOwner.map(g => [g.Key, g.Count, g.Value]).sort(), [['E:rep', 1, 367.25], ['U:a', 2, 1000]]);
  assert.deepEqual(r.pipeline.byMonth.map(g => [g.Key, g.Count]), [['2026-11', 2], ['', 1]], 'by month, no date last');
});

test('win / loss: closed in the period only; the win rate by count; lost reasons; months', () => {
  const r = crmReports(Object.assign({}, base, {
    leads: [], activities: [],
    opportunities: [
      opp('w1', { Status: 'Won', ClosedAt: '2026-10-03T08:00:00Z', ExpectedValue: 2000 }),
      opp('w2', { Status: 'Won', ClosedAt: '2026-10-30T08:00:00Z', ExpectedValue: 10, Currency: 'USD', OwnerKey: 'U:b' }),
      opp('l1', { Status: 'Lost', ClosedAt: '2026-10-10T08:00:00Z', LostReason: 'Price', ExpectedValue: 300 }),
      opp('old', { Status: 'Won', ClosedAt: '2026-09-30T23:00:00Z', ExpectedValue: 99999 })
    ]
  }));
  assert.deepEqual(r.winLoss.total, { Key: '', Won: 2, WonValue: 2036.73, Lost: 1, LostValue: 300, WinRate: 66.7 });
  assert.deepEqual(r.winLoss.byReason.map(g => [g.Key, g.Count, g.Value]), [['Price', 1, 300]]);
  assert.deepEqual(r.winLoss.byOwner.find(g => g.Key === 'U:a'), { Key: 'U:a', Won: 1, WonValue: 2000, Lost: 1, LostValue: 300, WinRate: 50 });
  assert.deepEqual(r.winLoss.byMonth.map(g => g.Key), ['2026-10']);
  assert.equal(crmReports(Object.assign({}, base, { leads: [], activities: [], opportunities: [] })).winLoss.total.WinRate, null, 'no closed: no rate');
});

test('activities: done in the period, open and overdue (before today), by owner and type', () => {
  const r = crmReports(Object.assign({}, base, {
    leads: [], opportunities: [],
    activities: [
      { OwnerKey: 'U:a', Type: 'Call', Status: 'Done', DoneAt: '2026-10-12T09:00:00Z', Due: '2026-10-12' },
      { OwnerKey: 'U:a', Type: 'Call', Status: 'Done', DoneAt: '2026-09-12T09:00:00Z', Due: '2026-09-12' },
      { OwnerKey: 'U:a', Type: 'Call', Status: 'Open', Due: '2026-10-19' },
      { OwnerKey: 'U:a', Type: 'Visit', Status: 'Open', Due: '2026-10-20' },
      { OwnerKey: 'U:b', Type: 'Call', Status: 'Cancelled', Due: '2026-10-01' }
    ]
  }));
  assert.deepEqual(r.activities.rows.map(g => [g.OwnerKey, g.Type, g.Done, g.Open, g.Overdue]), [['U:a', 'Call', 1, 1, 1], ['U:a', 'Visit', 0, 1, 0]]);
  assert.deepEqual(r.activities.total, { Done: 1, Open: 2, Overdue: 1 });
});

test('lead sources: created in the period; converted; the won value of their opportunities, a converted lead\'s too', () => {
  const r = crmReports(Object.assign({}, base, {
    activities: [],
    leads: [
      { ID: 'L1', Source: 'Website', Status: 'Converted', CreatedAt: '2026-10-02T08:00:00Z' },
      { ID: 'L2', Source: 'Website', Status: 'Open', CreatedAt: '2026-10-03T08:00:00Z' },
      { ID: 'L3', Source: '', Status: 'Open', CreatedAt: '2026-10-04T08:00:00Z' },
      { ID: 'L4', Source: 'Exhibition', Status: 'Converted', CreatedAt: '2026-08-01T08:00:00Z' }
    ],
    opportunities: [
      opp('o1', { CustomerID: 'CU9', FromLeadID: 'L1', Status: 'Won', ClosedAt: '2026-10-20T08:00:00Z', ExpectedValue: 5000 }),
      opp('o2', { LeadID: 'L2', CustomerID: '', Status: 'Open', ExpectedValue: 700 }),
      opp('o3', { FromLeadID: 'L4', Status: 'Won', ClosedAt: '2026-10-20T08:00:00Z', ExpectedValue: 800 })
    ]
  }));
  assert.deepEqual(r.sources.rows.map(g => [g.Key, g.Leads, g.Converted, g.Conversion, g.Won, g.WonValue]),
    [['Website', 2, 1, 50, 1, 5000], ['Not given', 1, 0, 0, 0, 0]], 'L4 was created before the period');
  assert.deepEqual(r.sources.total, { Leads: 3, Converted: 1, Won: 1, WonValue: 5000, Conversion: 33.3 });
});
