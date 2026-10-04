// The working calendar's day count (docs/modules/HR_LEAVE.md), kept free
// of Firebase so the Leave Register and the tests share it.
//   cal: { Weekend: [day numbers, 0 = Sunday], Holidays: [{ From, To, Name }],
//          Schedules: [{ From, Weekend }] (optional: an employee's work
//          schedules by date, docs/modules/HR_PAYROLL.md step 0; a null
//          Weekend is the company's) }
'use strict';
const addDay = (d, n) => new Date(Date.parse(d + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10);
// The weekend on a date: the employee's schedule in force, else the company's.
function weekendOn(cal, d) {
  let w = null;
  (cal.Schedules || []).forEach(s => { if (s.From <= d) w = s.Weekend; });
  return w || cal.Weekend;
}
// The days from..to (inclusive) that count: every day (Calendar), or
// (Working) those that are neither a weekend day nor in a public holiday.
function countedDays(cal, from, to, counts) {
  const out = [];
  for (let d = from; d <= to; d = addDay(d, 1)) {
    if (counts === 'Working') {
      if (weekendOn(cal, d).includes(new Date(d + 'T00:00:00Z').getUTCDay())) continue;
      if (cal.Holidays.some(h => h.From <= d && d <= h.To)) continue;
    }
    out.push(d);
  }
  return out;
}
module.exports = { addDay, countedDays, weekendOn };
