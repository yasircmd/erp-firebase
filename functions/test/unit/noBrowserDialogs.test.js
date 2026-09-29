// No browser popups, now or later (owner, 2026-09-29): every message,
// confirmation and question is shown in the app (public/index.html, APP
// DIALOGS). A screen or the shell calling confirm() or prompt() fails here,
// and the Deploy workflow runs this before deploying anything.
//   node --test functions/test/unit/noBrowserDialogs.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { findNativeDialogs, toAppDialogs } = require('../../../tools/legacy-port/appDialogs');

const REPO = path.join(__dirname, '../../..');
const pages = [...fs.readdirSync(path.join(REPO, 'screens')).filter(f => f.endsWith('.html')).map(f => 'screens/' + f), 'public/index.html'];
const read = f => fs.readFileSync(path.join(REPO, f), 'utf8');

test('no screen, and not the shell, uses a browser confirm / prompt', () => {
  assert.ok(pages.length > 50, 'found the screens');
  const found = pages.flatMap(f => findNativeDialogs(read(f), f).map(d => f + ':' + d.line + ' ' + d.kind + '()'));
  assert.deepEqual(found, [], 'use await appConfirm(…) / appPrompt(…) — see APP DIALOGS in public/index.html');
});

test('the shell shows every alert() in the app and offers appAlert / appConfirm / appPrompt', () => {
  const shell = read('public/index.html');
  const block = shell.slice(shell.indexOf('---------- APP DIALOGS ----------'), shell.indexOf('---------- END APP DIALOGS ----------'));
  assert.ok(block.length > 0, 'the APP DIALOGS block');
  for (const name of ['appAlert', 'appConfirm', 'appPrompt']) assert.match(block, new RegExp('window\\.' + name + ' = '));
  assert.match(block, /window\.alert = message => \{ window\.appAlert\(message\); \};/);
  // Before any other script of the shell runs.
  assert.ok(shell.indexOf('---------- APP DIALOGS ----------') < shell.indexOf('</head>'), 'in <head>');
});

test('the detector finds each form a popup can take', () => {
  const page = s => '<div></div><script>\n' + s + '\n</script>';
  const kinds = s => findNativeDialogs(s, 'screens/X.html').map(d => d.kind);
  assert.deepEqual(kinds(page('function f(){ if (!confirm("x")) return; }')), ['confirm']);
  assert.deepEqual(kinds(page('const r = window.prompt("r");')), ['prompt']);
  assert.deepEqual(kinds('<script type="module">if (!window.confirm("x")) {}</script>'), ['confirm']);
  assert.deepEqual(kinds('<button onclick="if (confirm(&quot;x&quot;)) go()">'), ['confirm']);
  assert.deepEqual(kinds(page('// confirm("in a comment")\nconst s = "prompt(1)"; showConfirm("x"); obj.confirm(1); valueOf(2);')), [], 'comments, strings, other names');
  assert.deepEqual(kinds(page('alert("x")')), [], 'the shell catches alert() in screens');
  assert.deepEqual(findNativeDialogs('<head><script>alert(1)</script><script>// ---------- APP DIALOGS ----------\n</script></head>', 'public/index.html').map(d => d.kind),
    ['alert'], 'but not in the shell before its dialogs exist');
});

test('the converter: confirm / prompt awaited in-app, the function made async, nothing else touched', () => {
  const src = '<script>\nfunction a(t){ if (x && !window.confirm("y")) return; const r = prompt("r", t); obj.valueOf(); valueOf(t); }\n' +
    'list.forEach(b => b.onclick = e => { if (!confirm("z")) return; });\np.catch(() => window.prompt("Copy", text));\n</script>';
  const r = toAppDialogs(src, 't');
  assert.equal(r.html, '<script>\nasync function a(t){ if (x && !(await appConfirm("y"))) return; const r = (await appPrompt("r", t)); obj.valueOf(); valueOf(t); }\n' +
    'list.forEach(b => b.onclick = async e => { if (!(await appConfirm("z"))) return; });\np.catch(async () => (await appPrompt("Copy", text)));\n</script>');
  assert.deepEqual(r.changed.map(c => c.name), ['a', 'b.onclick', '(anonymous)']);
  assert.equal(toAppDialogs(r.html, 't').html, r.html, 'running it again changes nothing');
  assert.deepEqual(findNativeDialogs(r.html, 't'), []);
});
