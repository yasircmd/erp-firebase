#!/usr/bin/env node
// Each release, for every client corporate (docs/modules/MULTI_CORPORATE.md,
// §5 and M4; decisions 246, 263, 265). Run by tools/deploy-rules.sh (the
// Deploy workflow's "database rules" task) after this project's own rules:
//   1. deploys the rules (database.rules.json, with its RTDB indexes, and
//      firestore.rules) to each Active corporate's own project, one by one,
//      and records the result in its directory entry (Rules). A corporate
//      it cannot reach (grant withdrawn) is reported, and the others go on;
//   2. brings the corporates that follow the main tree up to date, and
//      offers the new modules to those with their own layout (as the
//      Developer screen's button);
//   3. deletes what the firm holds about a corporate set Inactive more than
//      90 days ago (Support issues and files, internal notes).
// Runs with the deploy account's credentials (GOOGLE_APPLICATION_CREDENTIALS
// in the workflow); each client grants it Firebase Rules Admin and Firebase
// Realtime Database Admin (docs/ONBOARDING.md).
//   node tools/release-corporates.js [--only rules|tree|purge] [--dry-run]
'use strict';
const path = require('path');
const { execFileSync } = require('child_process');

const REPO = path.join(__dirname, '..');
const args = process.argv.slice(2);
const only = args.includes('--only') ? args[args.indexOf('--only') + 1] : '';
const dryRun = args.includes('--dry-run');
const FIREBASE = process.env.FIREBASE || 'firebase';

const firebaseAdmin = require(path.join(REPO, 'functions/src/firebaseAdmin'));
const { DIRECTORY } = require(path.join(REPO, 'functions/src/corporates'));
const developer = require(path.join(REPO, 'functions/src/developer'));
// A tool, not a request: it works in Corporate 100, the firm's own project.
firebaseAdmin.useCorporateOutsideRequests({ id: firebaseAdmin.HOME_ID });

const commit = () => { try { return execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: REPO }).toString().trim(); } catch (e) { return ''; } };
const SYSTEM = { uid: 'release', profile: { fullName: 'Release ' + commit() } };

// deploy(projectId) -> throws on failure (the CLI's last lines).
function deployRules(projectId) {
  const out = execFileSync(FIREBASE, ['deploy', '--project', projectId, '--only', 'database,firestore:rules', '--non-interactive'], { cwd: REPO, stdio: ['ignore', 'pipe', 'pipe'] });
  return out.toString().trim().split('\n').slice(-1)[0];
}

async function rules(deploy) {
  const dir = await firebaseAdmin.firm.firestore.collection(DIRECTORY).where('Status', '==', 'Active').get();
  const done = [], failed = [];
  for (const d of dir.docs) {
    const p = d.get('ProjectID');
    const at = new Date().toISOString();
    try {
      if (!dryRun) (deploy || deployRules)(p);
      if (!dryRun) await d.ref.update({ Rules: { Ok: true, Commit: commit(), At: at } });
      done.push(d.id + ' (' + p + ')');
    } catch (err) {
      const why = String((err && (err.stderr || err.stdout || err.message)) || err).trim().split('\n').slice(-3).join(' ').slice(0, 500);
      if (!dryRun) await d.ref.update({ Rules: { Ok: false, Commit: commit(), At: at, Error: why } });
      failed.push(d.id + ' (' + p + '): ' + why);
    }
  }
  return { done, failed };
}

async function main(opts) {
  const o = opts || {};
  const report = {};
  if (!only || only === 'rules') report.rules = await rules(o.deploy);
  if ((!only || only === 'tree') && !dryRun) report.tree = await developer._release.updateFollowers(SYSTEM);
  if ((!only || only === 'purge') && !dryRun) report.purged = await developer._release.purgeLeavers(o.now);
  return report;
}

if (require.main === module) {
  main().then(r => {
    if (r.rules) {
      console.log('Rules deployed to: ' + (r.rules.done.join(', ') || 'no client corporate'));
      r.rules.failed.forEach(f => console.log('RULES NOT DEPLOYED: ' + f));
    }
    if (r.tree) console.log('Tree: brought up to date ' + (r.tree.updated.join(', ') || 'none') + '; new modules offered to ' + (r.tree.offered.map(x => x.CorporateID).join(', ') || 'none') +
      (r.tree.failed.length ? '; NOT REACHED ' + r.tree.failed.map(f => f.CorporateID + ' (' + f.error + ')').join(', ') : ''));
    if (r.purged) console.log('Deleted what the firm held about: ' + (r.purged.join(', ') || 'none'));
    // A corporate not reached is reported, not a failed release.
    return Promise.all(require('firebase-admin').apps.map(a => a.delete()));
  }).catch(err => { console.error('RELEASE TO CORPORATES FAILED: ' + (err && err.message)); process.exit(1); });
}

module.exports = { main };
