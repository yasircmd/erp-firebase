// HR: Attendance and Leave Register, step 1 (owner, 2026-10-03;
// docs/modules/HR_LEAVE.md): HR Setup's Leave Types tab (the nine to
// start, the owner's example "basic only at lower grades, full salary
// above", gaps shown, a new type with selected elements) and the Working
// Calendar tab (weekend, a holiday, copy last year's); view-only users.
// Seeds its own data (it WIPES the emulator database, like the suites):
//   node functions/test/ui/hrLeaveSetup.ui.js
const http = require('http');
const fs = require('fs');
const assert = require('assert/strict');
const { chromium } = require('playwright');
const { onAppDialog } = require('./_appDialogs');
const { app, call, reset, baseFixture } = require('../emulator/_helpers');
const { countedDays } = require('../../src/workCalendar');

const results = [];
function check(name, fn) { return fn().then(() => { results.push(['PASS', name]); }, e => { results.push(['FAIL', name, e.message.replace(/\s+/g, ' ').slice(0, 300)]); }); }
const Y = new Date().getFullYear();
// The first Wednesday of June: a working day under a Sat-Sun weekend.
const WED = countedDays({ Weekend: [], Holidays: [] }, Y + '-06-01', Y + '-06-07', 'Calendar').find(d => new Date(d + 'T00:00:00Z').getUTCDay() === 3);

(async () => {
  await reset(baseFixture());
  for (const [code, level] of [['G3', 3], ['G5', 5], ['G7', 7]]) await call('u-admin', 'saveHrGrade', { grade: { Code: code, Level: level } });
  await call('u-admin', 'saveWorkCalendar', { companyId: 'C1', year: Y - 1, weekend: [0, 6], holidays: [{ From: (Y - 1) + '-12-02', To: (Y - 1) + '-12-03', Name: 'National Day' }] });
  const harness = (require('./buildHarness'), fs.readFileSync(__dirname + '/harness.html'));
  const server = http.createServer((req, res) => { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(harness); }).listen(8168);
  const browser = await chromium.launch();
  async function open(uid) {
    const page = await browser.newPage();
    page.__errors = []; page.__dialogs = [];
    page.on('pageerror', e => page.__errors.push(e.message));
    await onAppDialog(page, d => { page.__dialogs.push(d.message()); d.accept(); });
    await page.goto('http://127.0.0.1:8168/?module=HRSETUP&uid=' + uid);
    await page.waitForFunction(() => window.__moduleReady === true, null, { timeout: 30000 });
    await page.waitForFunction(() => document.querySelectorAll('#hs-lt-body tr').length > 0, null, { timeout: 30000 });
    return page;
  }
  const row = (p, code) => p.textContent('#hs-lt-body tr:has-text("' + code + '")');
  const p = await open('u-admin');

  await check('Leave Types: nine to start and the absence type, with their entitlement and pay shown', async () => {
    await p.click('.hs-tab[data-tab="leavetypes"]');
    assert.equal(await p.$$eval('#hs-lt-body tr', r => r.length), 10);
    assert.match(await row(p, 'ANNUAL'), /Annual Leave\s*Working days\s*All grades: 30 days\s*Carry up to 30\s*All grades: Full salary\s*In use/);
    assert.match(await row(p, 'SICK'), /No balance \(up to 90 a year\)[\s\S]*All grades, days 1–15: Full salary\s*All grades, days 16–45: Full salary at 50%\s*All grades, days 46\+: Unpaid/);
    assert.match(await row(p, 'TRAVEL'), /Duty: paid as working/);
  });

  await check('Annual leave pay by grade (the owner\'s example); a gap is shown until fixed; the entitlement by grade', async () => {
    await p.click('#hs-lt-body tr:has-text("ANNUAL")');
    await p.waitForSelector('#hs-pr-wrap:not(.hidden)');
    await p.fill('.hs-pr-row .hs-pr-lt', '4');
    await p.selectOption('.hs-pr-row .hs-pr-pay', 'Basic');
    await p.click('#hs-pr-add');
    await p.fill('.hs-pr-row:nth-child(2) .hs-pr-lf', '6');
    await p.click('#hs-pr-save');
    await p.waitForFunction(() => /G5 \(level 5\): no rule\./.test(document.getElementById('hs-pr-warn').textContent), null, { timeout: 15000 });
    assert.match(await row(p, 'ANNUAL'), /Annual Leave \(1 to check\)[\s\S]*Levels 1–4: Basic only\s*Levels 6–99: Full salary/);
    await p.fill('.hs-pr-row:nth-child(2) .hs-pr-lf', '5');
    await p.click('#hs-pr-save');
    await p.waitForFunction(() => document.getElementById('hs-pr-warn').textContent === '' && /Levels 5–99: Full salary/.test(document.getElementById('hs-lt-body').textContent), null, { timeout: 15000 });
    // Entitlement: 22 days below level 5, 30 from 5; carry 10.
    await p.fill('.hs-ent-row .hs-ent-lt', '4');
    await p.fill('.hs-ent-row .hs-ent-d', '22');
    await p.click('#hs-ent-add');
    await p.fill('.hs-ent-row:nth-child(2) .hs-ent-lf', '5');
    await p.fill('.hs-ent-row:nth-child(2) .hs-ent-d', '30');
    await p.fill('#hs-ent-cap', '10');
    await p.click('#hs-ent-save');
    await p.waitForFunction(() => /Levels 1–4: 22 days\s*Levels 5–99: 30 days\s*Carry up to 10/.test(document.getElementById('hs-lt-body').textContent), null, { timeout: 15000 });
    // An overlap is refused, in-app.
    await p.fill('.hs-ent-row:nth-child(2) .hs-ent-lf', '4');
    p.__dialogs.length = 0;
    await p.click('#hs-ent-save');
    await new Promise(ok => setTimeout(ok, 1500));
    assert.deepEqual(p.__dialogs, ['Rows 1 and 2 overlap: a grade level and service year can match only one row.']);
    const a = (await call('u-admin', 'getLeaveSetup', {})).leaveTypes.find(t => t.Code === 'ANNUAL');
    assert.deepEqual(a.PayRules.map(r => [r.LevelFrom, r.LevelTo, r.Pay]), [[1, 4, 'Basic'], [5, 99, 'Full']]);
    assert.deepEqual(a.Entitlements.map(r => [r.LevelFrom, r.LevelTo, r.DaysPerYear]), [[1, 4, 22], [5, 99, 30]]);
  });

  await check('a new leave type: saved, then its pay rules (selected elements) with no gap left', async () => {
    await p.click('#hs-lt-new');
    assert.equal(await p.isVisible('#hs-pr-wrap'), false, 'rules come after the type is saved');
    await p.fill('#hs-lt-code', 'marriage');
    await p.fill('#hs-lt-name', 'Marriage Leave');
    await p.fill('#hs-lt-maxinst', '5');
    await p.click('#hs-lt-save');
    await p.waitForFunction(() => document.getElementById('hs-lt-heading').textContent === 'Marriage Leave' && !document.getElementById('hs-pr-wrap').classList.contains('hidden'), null, { timeout: 15000 });
    assert.match(await p.textContent('#hs-pr-warn'), /G3 \(level 3\): no rule\.\s*G5 \(level 5\): no rule\.\s*G7 \(level 7\): no rule\./);
    assert.equal(await p.isVisible('#hs-ent-wrap'), false, 'no balance, no entitlement');
    await p.click('#hs-pr-add');
    await p.selectOption('.hs-pr-row .hs-pr-pay', 'Elements');
    await p.check('.hs-pr-row .hs-pr-el >> nth=0');
    await p.check('.hs-pr-row .hs-pr-el >> nth=1');
    await p.click('#hs-pr-save');
    await p.waitForFunction(() => /MARRIAGE\s*Marriage Leave\s*Working days\s*No balance\s*All grades: Basic Salary \+ Housing Allowance/.test(document.getElementById('hs-lt-body').textContent), null, { timeout: 15000 });
    assert.equal(await p.textContent('#hs-pr-warn'), '');
  });

  await check('Working Calendar: Sat-Sun to start; a holiday on a weekday; last year\'s copied; Friday-only weekend', async () => {
    await p.click('.hs-tab[data-tab="calendar"]');
    await p.waitForFunction(y => new RegExp('Working days in ' + y + ': \\d+').test(document.getElementById('hs-cal-days').textContent), Y, { timeout: 15000 });
    const before = Number((await p.textContent('#hs-cal-days')).split(': ')[1]);
    assert.equal(before, countedDays({ Weekend: [0, 6], Holidays: [] }, Y + '-01-01', Y + '-12-31', 'Working').length);
    assert.deepEqual(await p.$$eval('.hs-cal-wd:checked', c => c.map(x => x.value)), ['0', '6']);
    await p.click('#hs-cal-add');
    await p.fill('.hs-cal-row .hs-cal-from', WED);
    await p.fill('.hs-cal-row .hs-cal-name', 'Company Day');
    await p.click('#hs-cal-copy');
    assert.equal(await p.$$eval('.hs-cal-row', r => r.length), 2);
    assert.equal(await p.inputValue('.hs-cal-row:nth-child(2) .hs-cal-from'), Y + '-12-02');
    assert.equal(await p.inputValue('.hs-cal-row:nth-child(2) .hs-cal-to'), Y + '-12-03');
    await p.click('#hs-cal-save');
    const expected = countedDays({ Weekend: [0, 6], Holidays: [{ From: WED, To: WED }, { From: Y + '-12-02', To: Y + '-12-03' }] }, Y + '-01-01', Y + '-12-31', 'Working').length;
    await p.waitForFunction(n => document.getElementById('hs-cal-days').textContent.endsWith(': ' + n), expected, { timeout: 15000 });
    // Friday only.
    await p.uncheck('.hs-cal-wd[value="0"]'); await p.uncheck('.hs-cal-wd[value="6"]'); await p.check('.hs-cal-wd[value="5"]');
    await p.click('#hs-cal-save');
    const fri = countedDays({ Weekend: [5], Holidays: [{ From: WED, To: WED }, { From: Y + '-12-02', To: Y + '-12-03' }] }, Y + '-01-01', Y + '-12-31', 'Working').length;
    await p.waitForFunction(n => document.getElementById('hs-cal-days').textContent.endsWith(': ' + n), fri, { timeout: 15000 });
    const c = await call('u-admin', 'getWorkCalendar', { companyId: 'C1', year: Y });
    assert.deepEqual([c.weekend, c.holidays.map(h => h.Name)], [[5], ['Company Day', 'National Day']]);
    assert.deepEqual(p.__errors, []);
  });

  await check('a view-only user sees the rules and the calendar, changes nothing', async () => {
    const v = await open('u-viewer');
    await v.click('.hs-tab[data-tab="leavetypes"]');
    assert.equal(await v.isVisible('#hs-lt-new'), false);
    await v.click('#hs-lt-body tr:has-text("ANNUAL")');
    assert.equal(await v.isVisible('#hs-lt-form'), false);
    assert.match(await v.textContent('#hs-lt-body'), /Levels 1–4: Basic only/);
    await v.click('.hs-tab[data-tab="calendar"]');
    await v.waitForFunction(() => /Working days in/.test(document.getElementById('hs-cal-days').textContent), null, { timeout: 15000 });
    assert.equal(await v.isVisible('#hs-cal-save'), false);
    assert.equal(await v.isDisabled('.hs-cal-row .hs-cal-name'), true);
    assert.deepEqual(v.__errors, []);
    await v.close();
  });

  await browser.close(); server.close(); await app.delete();
  results.forEach(r => console.log(r.join('  ')));
  const failed = results.filter(r => r[0] === 'FAIL').length;
  console.log((results.length - failed) + '/' + results.length + ' passed');
  process.exitCode = failed ? 1 : 0;
})();
