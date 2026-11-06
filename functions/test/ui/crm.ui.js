// The CRM screen, step C1 (owner, 2026-11-05; docs/modules/CRM.md): a lead
// saved (the duplicate warning answered), an opportunity from it dragged on
// the stage board and lost with a reason, an activity done with the next one
// scheduled, Convert to Customer, CRM Setup for a manager; a Viewer sees no
// New buttons and no Setup.
// Seeds its own data (it WIPES the emulator database, like the suites):
//   node functions/test/ui/crm.ui.js
const http = require('http');
const fs = require('fs');
const assert = require('assert/strict');
const { chromium } = require('playwright');
const { onAppDialog } = require('./_appDialogs');
const { app, reset, baseFixture, call } = require('../emulator/_helpers');

// The shell's light theme (public/index.html, LIGHT THEME), applied to a harness page.
function lightThemeCss() {
  const html = fs.readFileSync(__dirname + '/../../../public/index.html', 'utf8');
  const a = html.indexOf('LIGHT THEME'), b = html.indexOf('/* =====', html.indexOf('=====', a + 20) + 70);
  return html.slice(html.lastIndexOf('/*', a), b);
}
async function inLight(page) {
  await page.addStyleTag({ content: lightThemeCss() });
  await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'light'));
}
const DARK = ['rgb(15, 23, 42)', 'rgba(30, 41, 59, 0.5)'];

const results = [];
function check(name, fn) { return fn().then(() => { results.push(['PASS', name]); }, e => { results.push(['FAIL', name, e.message.replace(/\s+/g, ' ').slice(0, 300)]); }); }
const T = { timeout: 30000 };

(async () => {
  const f = baseFixture();
  f.customers = { CU1: { CustomerCode: 'C001', CustomerName: 'Retail Co', Status: 'Active', CompanyID: 'C1', Phone: '+971 50 111 2222', TradeReceivablesAccountID: 'A-AR' } };
  await reset(f);
  const harness = (require('./buildHarness'), fs.readFileSync(__dirname + '/harness.html'));
  const server = http.createServer((q, r) => { r.writeHead(200, { 'Content-Type': 'text/html' }); r.end(harness); }).listen(8211);
  const browser = await chromium.launch();
  const dialogs = [];
  async function open(uid) {
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    page.__errors = [];
    page.on('pageerror', e => page.__errors.push(e.message));
    await onAppDialog(page, d => { dialogs.push(d.message()); d.accept(d.type() === 'prompt' ? 'Not a fit' : undefined); });
    await page.goto('http://127.0.0.1:8211/?module=CRM&uid=' + uid);
    await page.waitForFunction(() => window.__moduleReady === true, null, T);
    await page.waitForSelector('#crm-leads-body tr', T);
    return page;
  }
  const page = await open('u-admin');

  await check('a lead: saved; a second one with a customer\'s phone warns of the match and is saved anyway', async () => {
    await page.click('#crm-lead-new');
    await page.fill('#crm-lead-org', 'Gulf Trading'); await page.fill('#crm-lead-name', 'Sara');
    await page.fill('#crm-lead-phone', '050 999 8888'); await page.fill('#crm-lead-email', 'sara@gulf.example');
    await page.selectOption('#crm-lead-source', 'Website');
    await page.click('#crm-lead-save');
    await page.waitForFunction(() => document.getElementById('crm-lead-title').textContent === 'Gulf Trading (Sara)', null, T);
    await page.click('#crm-lead-back');
    await page.click('#crm-lead-new');
    await page.fill('#crm-lead-org', 'Other Co'); await page.fill('#crm-lead-phone', '00971501112222');
    await page.click('#crm-lead-save');
    await page.waitForFunction(() => document.getElementById('crm-lead-title').textContent === 'Other Co', null, T);
    assert.ok(dialogs.some(m => /This looks like:\n• Customer: Retail Co \(C001\) \(the same phone\)/.test(m)), dialogs.join(' | '));
    await page.click('#crm-lead-back');
    assert.deepEqual(await page.$$eval('#crm-leads-body tr td:first-child', t => t.map(x => x.textContent).sort()), ['Gulf Trading (Sara)', 'Other Co']);
  });

  await check('an opportunity from the lead: on the board under New; dragged to Proposal; Lost asks the reason from the list', async () => {
    await page.click('#crm-leads-body tr:has-text("Gulf Trading")');
    await page.click('#crm-lead-newopp');
    assert.equal(await page.inputValue('#crm-opp-party').then(v => v.slice(0, 2)), 'L:', 'the lead chosen');
    await page.fill('#crm-opp-title', 'Warehouse racks'); await page.fill('#crm-opp-value', '5000'); await page.fill('#crm-opp-currency', 'AED');
    await page.click('#crm-opp-save');
    await page.waitForFunction(() => document.getElementById('crm-opp-heading').textContent === 'Warehouse racks', null, T);
    await page.click('#crm-opp-back');
    await page.waitForSelector('#crm-board .crm-col[data-stage="New"] .crm-card', T);
    assert.match(await page.textContent('#crm-opp-totals'), /1 · total 5,000\.00 · weighted 500\.00/);
    await page.dragAndDrop('#crm-board .crm-col[data-stage="New"] .crm-card', '#crm-board .crm-col[data-stage="Proposal"]');
    await page.waitForSelector('#crm-board .crm-col[data-stage="Proposal"] .crm-card', T);
    assert.match(await page.textContent('#crm-opp-totals'), /weighted 2,500\.00/);
    // The light theme (owner, 2026-11-06): the board's columns light too.
    await inLight(page);
    const col = await page.$eval('#crm-board .crm-col[data-stage="Proposal"]', el => getComputedStyle(el).backgroundColor);
    assert.ok(!DARK.includes(col), 'the column is ' + col);
    await page.evaluate(() => document.documentElement.removeAttribute('data-theme'));
    await page.click('#crm-board .crm-card');
    await page.click('#crm-opp-lost');
    await page.waitForSelector('#crm-lost-modal:not(.hidden)', T);
    assert.deepEqual(await page.$$eval('#crm-lost-reason option', o => o.map(x => x.value)), ['Price', 'Competitor', 'No budget', 'No response', 'Other']);
    await page.selectOption('#crm-lost-reason', 'Competitor');
    await page.click('#crm-lost-ok');
    await page.waitForFunction(() => /Lost: Competitor/.test(document.getElementById('crm-opp-info').textContent), null, T);
    assert.ok(await page.isHidden('#crm-opp-save'), 'a lost one is read-only');
  });

  await check('an activity for the lead: Done asks the outcome and schedules the next one', async () => {
    await page.click('.crm-tab[data-tab="leads"]');
    await page.click('#crm-leads-body tr:has-text("Gulf Trading")');
    await page.click('#crm-lead-newact');
    await page.fill('#crm-act-subject', 'Intro call');
    await page.click('#crm-act-save');
    await page.waitForSelector('#crm-act-done:not(.hidden)', T);
    await page.click('#crm-act-done');
    await page.fill('#crm-done-outcome', 'Interested, wants a visit');
    await page.selectOption('#crm-done-next-type', 'Visit');
    await page.click('#crm-done-ok');
    await page.waitForFunction(() => /Done: Interested/.test(document.getElementById('crm-act-info').textContent), null, T);
    await page.click('#crm-act-back');
    const rows = await page.$$eval('#crm-acts-body tr', t => t.map(x => x.textContent));
    assert.equal(rows.length, 1, 'the open one: the next');
    assert.match(rows[0], /Visit.*Follow up: Intro call.*Lead: Gulf Trading/);
  });

  await check('Convert to Customer: the customer saved through Customer Master, the lead Converted', async () => {
    await page.click('.crm-tab[data-tab="leads"]');
    await page.click('#crm-leads-body tr:has-text("Gulf Trading")');
    await page.click('#crm-lead-convert');
    await page.waitForSelector('#crm-convert-modal:not(.hidden)', T);
    assert.equal(await page.inputValue('#crm-cv-name'), 'Gulf Trading');
    assert.equal(await page.inputValue('#crm-cv-phone'), '050 999 8888');
    await page.selectOption('#crm-cv-class', 'Local');
    await page.selectOption('#crm-cv-ar', 'A-AR');
    await page.click('#crm-cv-ok');
    await page.waitForFunction(() => /Converted to customer Gulf Trading/.test(document.getElementById('crm-lead-info').textContent), null, T);
    const customers = await call('u-admin', 'getCustomers', {});
    assert.ok((customers || []).some(c => c.CustomerName === 'Gulf Trading' && c.Phone === '050 999 8888'), 'in Customer Master');
    assert.deepEqual(page.__errors, []);
  });

  await check('Setup (a manager): a stage added shows on the board', async () => {
    await page.click('.crm-tab[data-tab="setup"]');
    await page.click('#crm-stage-add');
    await page.fill('#crm-stages-body tr:last-child .crm-st-name', 'Demo');
    await page.fill('#crm-stages-body tr:last-child .crm-st-prob', '60');
    await page.click('#crm-setup-save');
    await page.waitForFunction(() => Boolean(document.querySelector('#crm-board .crm-col[data-stage="Demo"]')), null, T);
    assert.ok(dialogs.includes('CRM Setup saved.'));
  });

  await check('a Viewer: no New buttons, no Setup', async () => {
    const v = await open('u-viewer');
    assert.ok(await v.isHidden('#crm-lead-new') && await v.isHidden('#crm-tab-setup'));
    assert.deepEqual(v.__errors, []);
    await v.close();
  });

  await browser.close(); server.close(); await app.delete();
  results.forEach(r => console.log(r.join('  ')));
  const failed = results.filter(r => r[0] === 'FAIL').length;
  console.log((results.length - failed) + '/' + results.length + ' passed');
  process.exitCode = failed ? 1 : 0;
})();
