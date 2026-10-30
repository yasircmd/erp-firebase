// The installable app (docs/modules/PWA.md, Q332-Q334): each manifest names
// its app, starts on its page and has its icons at their sizes; every file
// the service worker keeps exists (or is built: the styles); the shell links
// the built styles, its manifest and the worker, and no page compiles
// Tailwind in the browser any more.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const PUB = path.join(__dirname, '../../../public');
const read = f => fs.readFileSync(path.join(PUB, f), 'utf8');
// A PNG's width and height, from its IHDR.
const size = f => { const b = fs.readFileSync(path.join(PUB, f)); return [b.readUInt32BE(16), b.readUInt32BE(20)]; };

test('the two manifests: name, start page, scope, standalone, icons at their sizes', () => {
  for (const [file, name, start] of [['manifest.webmanifest', 'ERP', '/'], ['ess.webmanifest', 'Employee Portal', '/ess.html']]) {
    const m = JSON.parse(read(file));
    assert.deepEqual([m.name, m.start_url, m.scope, m.display], [name, start, start, 'standalone'], file);
    assert.ok(m.icons.some(i => i.purpose === 'maskable'), file + ': a maskable icon');
    m.icons.forEach(i => assert.deepEqual(size(i.src.slice(1)).join('x'), i.sizes, i.src));
    assert.ok(['192x192', '512x512'].every(s => m.icons.some(i => i.sizes === s && i.purpose === 'any')), file + ': 192 and 512');
  }
});

test('the pages link the built styles, their manifest and the worker; no Tailwind compiled in the browser', () => {
  for (const [page, css, manifest] of [['index.html', '/css/erp.css', '/manifest.webmanifest'], ['ess.html', '/css/ess.css', '/ess.webmanifest']]) {
    const s = read(page);
    assert.ok(s.includes('<link href="' + css + '" rel="stylesheet">'), page + ': ' + css);
    assert.ok(s.includes('<link rel="manifest" href="' + manifest + '">'), page + ': ' + manifest);
    assert.match(s, /navigator\.serviceWorker\.register\('\/sw\.js'\)/, page + ': the worker');
    assert.doesNotMatch(s, /cdn\.tailwindcss\.com|tailwind\.config/, page);
  }
  for (const f of fs.readdirSync(path.join(PUB, '../screens')).filter(f => f.endsWith('.html'))) {
    assert.doesNotMatch(fs.readFileSync(path.join(PUB, '../screens', f), 'utf8'), /cdn\.tailwindcss\.com/, f);
  }
});

test('every file the worker keeps exists or is built; it never touches a non-GET request', () => {
  const sw = read('sw.js');
  const list = JSON.parse(sw.match(/const SHELL = (\[[^\]]*\])/)[1].replace(/'/g, '"'));
  list.filter(u => u !== '/' && !u.startsWith('/css/')).forEach(u => assert.ok(fs.existsSync(path.join(PUB, u)), u));
  assert.match(sw, /if \(req\.method !== 'GET'\) return;/);
  assert.match(fs.readFileSync(path.join(PUB, '../tools/build-styles.sh'), 'utf8'), /public\/css\/erp\.css[\s\S]*public\/css\/ess\.css/);
});
