// The working calendar's day count (docs/modules/HR_LEAVE.md), kept free
// of Firebase so the Leave Register and the tests share it.
//   cal: { Weekend: [day numbers, 0 = Sunday], Holidays: [{ From, To, Name }] }
'use strict';
const addDay = (d, n) => new Date(Date.parse(d + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10);
// The days from..to (inclusive) that count: every day (Calendar), or
// (Working) those that are neither a weekend day nor in a public holiday.
function countedDays(cal, from, to, counts) {
  const out = [];
  for (let d = from; d <= to; d = addDay(d, 1)) {
    if (counts === 'Working') {
      if (cal.Weekend.includes(new Date(d + 'T00:00:00Z').getUTCDay())) continue;
      if (cal.Holidays.some(h => h.From <= d && d <= h.To)) continue;
    }
    out.push(d);
  }
  return out;
}
module.exports = { addDay, countedDays };
