// Builds harness.html: the shell's REAL rpc bridge + fragment injector
// (sliced verbatim from public/index.html), with only the Firebase SDK
// httpsCallable swapped for a direct HTTP call to the functions emulator.
const fs = require('fs');
const idx = fs.readFileSync(require('path').join(__dirname, '../../../public/index.html'), 'utf8').split('\n');
const slice = (from, to) => idx.slice(from - 1, to).join('\n');
const find = re => idx.findIndex(l => re.test(l)) + 1;

const rpcStart = find(/let __rpcPendingCount = 0;/);
const rpcEnd = find(/const rpc = new Proxy\(\{\}/);
const escStart = find(/function escapeHtml\(value\)/);
const injStart = find(/function injectHtmlWithScripts\(container, html\)/);
const scStart = find(/---------- SINGLE-COMPANY DEFAULT ----------/);
const scEnd = find(/---------- END SINGLE-COMPANY DEFAULT ----------/);
if (!rpcStart || !rpcEnd || !escStart || !injStart || !scStart || !scEnd) throw new Error('could not locate shell code');

const html = `<!doctype html><html><head><meta charset="utf-8">
<script src="https://cdn.tailwindcss.com"></script>
<link href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0/css/all.min.css" rel="stylesheet">
<style>.hidden{display:none!important}</style></head>
<body class="bg-slate-900 text-slate-100">
<div id="global-loading-bar"></div><div id="app-title"></div>
<div id="module-container"></div>
<script>
  const UID = new URLSearchParams(location.search).get('uid');
  const b64 = o => btoa(JSON.stringify(o)).replace(/=+$/, '').replace(/\\+/g, '-').replace(/\\//g, '_');
  const now = Math.floor(Date.now() / 1000);
  const TOKEN = b64({ alg: 'none', typ: 'JWT' }) + '.' + b64({ iss: 'https://securetoken.google.com/erp1-8f4cd', aud: 'erp1-8f4cd', sub: UID, user_id: UID, auth_time: now, iat: now, exp: now + 3600 }) + '.';
  window.__rpcLog = [];
  window.__firebaseSdk = {
    functionsInstance: {},
    httpsCallable: (_inst, name) => async (arg) => {
      const res = await fetch('http://127.0.0.1:5001/erp1-8f4cd/us-central1/' + name, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + TOKEN },
        body: JSON.stringify({ data: arg === undefined ? null : arg })
      });
      const body = await res.json();
      window.__rpcLog.push({ name, arg, ok: !body.error, error: body.error && body.error.message });
      if (body.error) throw new Error(body.error.message);
      return { data: body.result };
    }
  };
${slice(rpcStart, rpcEnd)}
${slice(escStart, escStart + 4)}
${slice(injStart, injStart + 9)}
${slice(scStart, scEnd)}
  // Same drill-through contract as the shell's openModule: the target
  // reads window.__pendingModuleParams / __pendingReturnChain in initModule.
  window.openModule = function (moduleId, drillParams, returnChain) {
    window.__pendingModuleParams = drillParams || null;
    window.__pendingReturnChain = returnChain || [];
    const container = document.getElementById('module-container');
    rpc.withSuccessHandler(result => {
      injectHtmlWithScripts(container, result.html);
      if (typeof window.initModule === 'function') window.initModule(null, result.canWrite);
      window.__moduleReady = true;
    }).withFailureHandler(err => { container.textContent = 'LOAD FAILED: ' + err.message; })
      .getModuleFragment({ moduleId });
  };
  // As at the shell's login: the user's companies first (a user with
  // exactly one gets it filled into every company dropdown), then the module.
  rpc.withSuccessHandler(companies => {
    setSingleCompany(companies);
    openModule(new URLSearchParams(location.search).get('module'));
  }).withFailureHandler(err => { document.getElementById('module-container').textContent = 'LOAD FAILED: ' + err.message; })
    .getActiveCompanies();
</script></body></html>`;
fs.writeFileSync(__dirname + '/harness.html', html);
console.log('harness.html written');

// getModuleFragment serves the active screen release, and the emulator
// suites wipe it, so release the working copy's screens/ into the
// EMULATOR (the variable is forced, never inherited) before any check.
require('child_process').execSync('node ' + require('path').join(__dirname, '../../../tools/screen-release.js') + ' release --project erp1-8f4cd',
  { env: { ...process.env, FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080' }, stdio: 'inherit' });
