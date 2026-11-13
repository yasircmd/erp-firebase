// The shell's APPROVAL BAR (UX4.md item 10, owner 2026-11-13): every entry
// screen with an approval banner shows it through approvalBar.show, which
// waits for the module's rights itself and puts it at the foot of the
// entry. A screen asking getMyPendingApprovalLevel itself (gated on its own
// canPost, loaded in parallel) is what missed the IPR approval from a task.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const dir = path.join(__dirname, '../../../screens');
const screens = fs.readdirSync(dir).filter(f => f.endsWith('.html')).map(f => ({ id: f.slice(0, -5), html: fs.readFileSync(path.join(dir, f), 'utf8') }));

test('no screen asks getMyPendingApprovalLevel itself', () => {
  assert.deepEqual(screens.filter(s => /getMyPendingApprovalLevel/.test(s.html)).map(s => s.id), []);
});

test('each approval banner (Approve and Reject in it) is shown through approvalBar.show, with the module whose rights it needs', () => {
  const withBanner = screens.filter(s => /id="[\w-]*approval-banner"/.test(s.html) && /approve-btn/.test(s.html));
  assert.ok(withBanner.length >= 23, 'the 23 entry screens with approvals: ' + withBanner.length);
  const missing = [];
  withBanner.forEach(s => {
    const ids = [...s.html.matchAll(/id="([\w-]*(?:my-)?approval-banner)"/g)].map(m => m[1]);
    ids.forEach(id => {
      const shown = new RegExp("approvalBar\\.show\\((?:document\\.getElementById|\\$)\\('" + id + "'\\), \\{ instanceId: [^}]*, rights: [^}]+ \\}\\)").test(s.html);
      if (!shown) missing.push(s.id + ' #' + id);
    });
  });
  assert.deepEqual(missing, []);
});

test('the shell has the block, and it waits for rights and ignores a late answer', () => {
  const idx = fs.readFileSync(path.join(__dirname, '../../../public/index.html'), 'utf8');
  const block = idx.slice(idx.indexOf('// ---------- APPROVAL BAR ----------'), idx.indexOf('// ---------- END APPROVAL BAR ----------'));
  assert.ok(block.length > 100);
  assert.match(block, /getApprovalBarInfo/);
  assert.match(block, /getModulePermissionsForUser/);
  assert.match(block, /__barToken !== token/);
});
