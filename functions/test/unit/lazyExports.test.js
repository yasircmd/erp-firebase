// Lazy loading (docs/modules/PERFORMANCE.md, P2): the deploy-time map from
// each function to its module, and index.js loading only that module in a
// deployed instance, everything otherwise.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const FUNCTIONS = path.join(__dirname, '../..');
const { buildMap } = require('../../../tools/build-lazy-exports');

const built = buildMap();
const index = require('../../index.js');

test('every function is in the map, and the map names the very same function', () => {
  assert.deepEqual(built.missing, []);
  assert.equal(Object.keys(built.map).length, Object.keys(index).length);
  assert.ok(Object.keys(index).length > 500, 'the whole list: ' + Object.keys(index).length);
  const wrong = Object.keys(built.map).filter(name => {
    const [file, key] = built.map[name];
    return require(path.join(FUNCTIONS, file))[key] !== index[name];
  });
  assert.deepEqual(wrong, []);
});

// A fresh process, as an instance starts: what index.js exports, how many of
// the source modules it loaded, and whether the generated port came in.
const mapFile = path.join(os.tmpdir(), 'lazy-exports-' + process.pid + '.json');
fs.writeFileSync(mapFile, JSON.stringify(built.map));
test.after(() => { try { fs.unlinkSync(mapFile); } catch (e) { /* gone */ } });
function start(env) {
  const out = execFileSync(process.execPath, ['-e', `
    const t = Date.now();
    const ex = require('./index.js');
    const src = Object.keys(require.cache).filter(f => f.startsWith(require('path').join(process.cwd(), 'src') + require('path').sep));
    console.log(JSON.stringify({ names: Object.keys(ex).length, first: Object.keys(ex)[0], kind: typeof ex[Object.keys(ex)[0]],
      modules: src.length, legacy: src.some(f => /legacy.codegs\\.js$/.test(f)), lazy: process.env.ERP_LAZY === '1', ms: Date.now() - t }));`],
  { cwd: FUNCTIONS, env: Object.assign({}, process.env, { GCLOUD_PROJECT: 'lazy-test', ERP_LAZY_EXPORTS: mapFile, FUNCTION_TARGET: '', K_SERVICE: '', FUNCTIONS_EMULATOR: '' }, env) });
  return JSON.parse(out.toString().trim().split('\n').pop());
}

test('a deployed instance loads only its own function\'s module', () => {
  const full = start({});
  const own = start({ FUNCTION_TARGET: 'getModuleFragment', K_SERVICE: 'getmodulefragment' });
  assert.deepEqual([own.names, own.first, own.kind, own.legacy, own.lazy], [1, 'getModuleFragment', 'function', false, true]);
  assert.ok(own.modules <= 10 && full.modules > 100, 'modules loaded: ' + own.modules + ' of ' + full.modules);
  // A generated-port function brings in the port, and only that.
  const legacyName = Object.keys(built.map).find(n => built.map[n][0] === './src/legacy/callables.js');
  const legacy = start({ FUNCTION_TARGET: legacyName, K_SERVICE: legacyName.toLowerCase() });
  assert.deepEqual([legacy.names, legacy.first, legacy.legacy], [1, legacyName, true]);
  console.log('# load: everything ' + full.ms + ' ms, ' + full.modules + ' modules; getModuleFragment alone ' + own.ms + ' ms, ' + own.modules + ' modules');
});

test('everything loads where the whole list is needed: the CLI, the emulators, no map, a function not in it', () => {
  const all = Object.keys(index).length;
  assert.equal(start({}).names, all, 'the Firebase CLI reading the list: no FUNCTION_TARGET');
  assert.equal(start({ FUNCTION_TARGET: 'getModuleFragment' }).names, all, 'FUNCTION_TARGET without K_SERVICE is not a deployed instance');
  assert.equal(start({ FUNCTION_TARGET: 'getModuleFragment', K_SERVICE: 'x', FUNCTIONS_EMULATOR: 'true' }).names, all, 'the emulators');
  assert.equal(start({ FUNCTION_TARGET: 'getModuleFragment', K_SERVICE: 'x', ERP_LAZY_EXPORTS: '/no/such/map.json' }).names, all, 'no map');
  const notMapped = start({ FUNCTION_TARGET: 'noSuchFunction', K_SERVICE: 'x' });
  assert.deepEqual([notMapped.names, notMapped.lazy], [all, false], 'not in the map');
});

test('the map is built at every functions deploy, and never committed', () => {
  const fb = JSON.parse(fs.readFileSync(path.join(FUNCTIONS, '../firebase.json'), 'utf8'));
  assert.deepEqual(fb.functions.predeploy, ['node "$PROJECT_DIR/tools/build-lazy-exports.js"']);
  assert.match(fs.readFileSync(path.join(FUNCTIONS, '../.gitignore'), 'utf8'), /^functions\/lazy-exports\.json$/m);
});
