// Screen releases (docs/modules/SCREENS_ON_HOSTING.md): writes every
// screen in screens/ to Firestore as one release, verifies it, then
// switches every user to it with a single write. getModuleFragment serves
// the active release after its access check.
//
//   screenReleases/{releaseId}               { commit, createdAt, createdBy, count }
//   screenReleases/{releaseId}/screens/{ID}  { html, sha256 }
//   system/screens                           { activeRelease }
//
// The logic takes a Firestore instance, so the emulator tests call it
// directly. Run it through tools/release-screens.sh (clean-copy check),
// or: node tools/screen-release.js <release|list|rollback ID> --project P
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const SCREENS_DIR = path.join(__dirname, '..', 'screens');
const KEEP = 10;
const POINTER = 'system/screens';
const sha256 = s => crypto.createHash('sha256').update(s, 'utf8').digest('hex');

// { ID: html } for every screens/<ID>.html.
function loadScreens(dir = SCREENS_DIR) {
  const out = {};
  for (const f of fs.readdirSync(dir)) if (f.endsWith('.html')) out[f.slice(0, -5)] = fs.readFileSync(path.join(dir, f), 'utf8');
  return out;
}

// Every registry module needs a screen, every screen a registry module,
// and no screen may still call Apps Script.
function checkScreens(screens, registryIds) {
  const ids = Object.keys(screens);
  const problems = [
    ...registryIds.filter(id => !ids.includes(id)).map(id => 'no screen for module ' + id),
    ...ids.filter(id => !registryIds.includes(id)).map(id => 'screen ' + id + ' is not in MODULE_REGISTRY'),
    ...ids.filter(id => screens[id].includes('google.script.run')).map(id => 'screen ' + id + ' still calls google.script.run')
  ];
  if (problems.length) throw new Error('Screens not released: ' + problems.join('; '));
}

// 20260926T103015Z-4063763
function releaseIdFor(commit, now) {
  return now.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z') + '-' + commit;
}

async function activeRelease(db) {
  const snap = await db.doc(POINTER).get();
  return snap.exists ? snap.get('activeRelease') : null;
}

// Writes, verifies and activates a release; returns its id. The pointer
// only moves after every screen has been read back with a matching hash,
// so a failed or partial write leaves users on the previous release.
// hooks.afterWrite(releaseRef) exists for the tests.
async function releaseScreens(db, { screens, registryIds, commit, createdBy = '', now = new Date(), keep = KEEP, hooks = {} }) {
  checkScreens(screens, registryIds);
  const id = releaseIdFor(commit, now);
  const ref = db.collection('screenReleases').doc(id);
  if ((await ref.get()).exists) throw new Error('Release ' + id + ' already exists.');
  const ids = Object.keys(screens).sort();
  for (let i = 0; i < ids.length; i += 20) {
    const batch = db.batch();
    ids.slice(i, i + 20).forEach(s => batch.set(ref.collection('screens').doc(s), { html: screens[s], sha256: sha256(screens[s]) }));
    await batch.commit();
  }
  if (hooks.afterWrite) await hooks.afterWrite(ref);
  const stored = await ref.collection('screens').get();
  const bad = ids.filter(s => {
    const d = stored.docs.find(x => x.id === s);
    return !d || d.get('sha256') !== sha256(screens[s]) || sha256(d.get('html')) !== sha256(screens[s]);
  });
  if (stored.size !== ids.length || bad.length) {
    throw new Error('Release ' + id + ' failed verification (' + (bad.join(', ') || 'unexpected screens') + '); the active release is unchanged.');
  }
  await ref.set({ commit, createdAt: now.toISOString(), createdBy, count: ids.length });
  await db.doc(POINTER).set({ activeRelease: id });
  await prune(db, keep);
  return id;
}

// Newest first, the active one marked. A release without its record (an
// interrupted run) is listed as incomplete and can't be rolled back to.
async function listReleases(db) {
  const active = await activeRelease(db);
  const refs = await db.collection('screenReleases').listDocuments();
  const rows = await Promise.all(refs.map(async r => {
    const s = await r.get();
    return { id: r.id, active: r.id === active, complete: s.exists, ...(s.exists ? s.data() : {}) };
  }));
  return rows.sort((a, b) => (a.id < b.id ? 1 : -1));
}

async function rollback(db, releaseId) {
  const ref = db.collection('screenReleases').doc(releaseId);
  const snap = await ref.get();
  if (!snap.exists) throw new Error('No complete release ' + releaseId + '.');
  const n = (await ref.collection('screens').get()).size;
  if (n !== snap.get('count')) throw new Error('Release ' + releaseId + ' has ' + n + ' of its ' + snap.get('count') + ' screens.');
  await db.doc(POINTER).set({ activeRelease: releaseId });
}

// Keeps the newest `keep` releases, and always the active one.
async function prune(db, keep = KEEP) {
  const rows = await listReleases(db);
  for (const r of rows.slice(keep)) {
    if (r.active) continue;
    await db.recursiveDelete(db.collection('screenReleases').doc(r.id));
  }
}

module.exports = { loadScreens, checkScreens, releaseScreens, listReleases, rollback, prune, activeRelease, releaseIdFor, KEEP, POINTER, SCREENS_DIR };

// ---- command line ----
if (require.main === module) {
  const args = process.argv.slice(2);
  const pi = args.indexOf('--project');
  const project = pi >= 0 ? args.splice(pi, 2)[1] : null;
  const emulator = process.env.FIRESTORE_EMULATOR_HOST;
  // Never guess the target: production and the emulator both need --project.
  if (!project) {
    console.error('usage: node tools/screen-release.js <release|list|rollback ID> --project PROJECT_ID');
    process.exit(1);
  }
  const fromFunctions = m => require(require.resolve(m, { paths: [path.join(__dirname, '..', 'functions')] }));
  const admin = fromFunctions('firebase-admin');
  const db = admin.initializeApp({ projectId: project }).firestore();
  const { execSync } = require('child_process');
  const git = c => execSync('git ' + c, { cwd: path.join(__dirname, '..') }).toString().trim();
  (async () => {
    const [cmd, arg] = args;
    console.log('Target: ' + (emulator ? 'EMULATOR ' + emulator : 'PRODUCTION') + ' Firestore, project ' + project);
    if (cmd === 'release') {
      const { MODULE_REGISTRY } = require('../functions/src/moduleRegistry');
      const id = await releaseScreens(db, {
        screens: loadScreens(), registryIds: MODULE_REGISTRY.map(m => m.id),
        commit: git('rev-parse --short HEAD'), createdBy: git('config user.name')
      });
      console.log('Released and active: ' + id);
    } else if (cmd === 'list') {
      for (const r of await listReleases(db)) {
        console.log((r.active ? '* ' : '  ') + r.id + (r.complete ? '  ' + r.count + ' screens, ' + r.createdBy : '  INCOMPLETE'));
      }
    } else if (cmd === 'rollback' && arg) {
      await rollback(db, arg);
      console.log('Active release is now ' + arg);
    } else {
      console.error('unknown command: ' + args.join(' ')); process.exitCode = 1;
    }
  })().catch(e => { console.error(e.message); process.exitCode = 1; });
}
