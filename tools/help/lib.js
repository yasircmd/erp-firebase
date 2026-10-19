// Help (docs/modules/HELP.md, decisions 148-151): the pages in help/pages/*.md
// built into public/help/, and the checks that keep them current with the
// ERP. Used by tools/help/build.js, tools/help/stamp.js and
// functions/test/unit/help.test.js (the Deploy workflow's "Check help" step).
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { render, esc } = require('./markdown');

const REPO = path.join(__dirname, '..', '..');
const PAGES_DIR = path.join(REPO, 'help', 'pages');
const OUT_DIR = 'public/help';

// The modules that have Help: an internal module (the firm's own Developer
// screen; MULTI_CORPORATE.md, M2) has none, and is in no area.
function allModules() { return require(path.join(REPO, 'functions/src/moduleRegistry.js')).MODULE_REGISTRY; }
function registry() { return allModules().filter(m => !m.internal); }
function areasFile() { return JSON.parse(fs.readFileSync(path.join(REPO, 'help', 'areas.json'), 'utf8')); }

// "---\nkey: value\nlist: [A, B]\n---\nbody"
function parsePage(file) {
  const text = fs.readFileSync(path.join(PAGES_DIR, file), 'utf8').replace(/\r\n/g, '\n');
  const m = text.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!m) throw new Error('help/pages/' + file + ': no front matter (--- ... ---) at the top');
  const meta = {};
  m[1].split('\n').forEach(l => {
    const kv = l.match(/^(\w+):\s*(.*)$/);
    if (!kv) return;
    const v = kv[2].trim();
    meta[kv[1]] = /^\[.*\]$/.test(v) ? v.slice(1, -1).split(',').map(x => x.trim()).filter(Boolean) : v;
  });
  return { file, slug: file.replace(/\.md$/, ''), meta, body: m[2], modules: meta.modules || [], sources: meta.sources || [] };
}
function pages() { return fs.readdirSync(PAGES_DIR).filter(f => f.endsWith('.md')).sort().map(parsePage); }

// What a page covers: each module's screen plus the files the page names.
function coveredFiles(page) {
  const files = page.modules.map(id => 'screens/' + id + '.html').filter(f => fs.existsSync(path.join(REPO, f))).concat(page.sources);
  return [...new Set(files)].sort();
}
function fingerprint(page) {
  const h = crypto.createHash('sha256');
  coveredFiles(page).forEach(f => {
    const p = path.join(REPO, f);
    if (!fs.existsSync(p)) throw new Error('help/pages/' + page.file + ': source ' + f + ' does not exist');
    h.update(f + '\n').update(fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n')).update('\n');
  });
  return h.digest('hex').slice(0, 16);
}

const ddmmyyyy = d => d.slice(8, 10) + '/' + d.slice(5, 7) + '/' + d.slice(0, 4); // help is static: no shell to format dates

// ---------- checks (decision 149) ----------
function check() {
  const problems = [];
  const reg = registry(), regIds = new Set(reg.map(m => m.id));
  const { areas } = areasFile();
  const all = pages();
  const bySlug = Object.fromEntries(all.map(p => [p.slug, p]));
  const areaOf = {};
  const internal = new Set(allModules().filter(m => m.internal).map(m => m.id));
  areas.forEach(a => (a.modules || []).forEach(id => {
    if (internal.has(id)) problems.push('help/areas.json: ' + a.id + ' lists ' + id + ', an internal module: it has no Help');
    else if (!regIds.has(id)) problems.push('help/areas.json: ' + a.id + ' lists ' + id + ', which is not in the module registry');
    if (areaOf[id]) problems.push('help/areas.json: ' + id + ' is in both ' + areaOf[id] + ' and ' + a.id);
    areaOf[id] = a.id;
  }));
  reg.forEach(m => { if (!areaOf[m.id]) problems.push('help/areas.json: module ' + m.id + ' (' + m.label + ') is in no area — add it to one, and write its page when that area is written'); });
  const covered = {};
  all.forEach(p => {
    const where = 'help/pages/' + p.file;
    const area = areas.find(a => a.id === p.meta.area);
    if (!p.meta.title) problems.push(where + ': no title');
    if (!area) problems.push(where + ': area "' + (p.meta.area || '') + '" is not in help/areas.json');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(p.meta.reviewed || '')) problems.push(where + ': "reviewed" must be a date, yyyy-mm-dd');
    p.modules.forEach(id => {
      if (!regIds.has(id)) problems.push(where + ': module ' + id + ' is not in the registry');
      else if (area && areaOf[id] !== area.id) problems.push(where + ': module ' + id + ' belongs to area ' + areaOf[id] + ', not ' + area.id);
      if (covered[id]) problems.push(where + ': module ' + id + ' already has a page (' + covered[id] + ')');
      covered[id] = p.slug;
    });
    if (p.modules.length) ['What it is for', 'Step by step'].forEach(h => {
      if (!new RegExp('^## ' + h + '\\s*$', 'm').test(p.body)) problems.push(where + ': a module page needs a "## ' + h + '" section');
    });
    let fp = '';
    try { fp = fingerprint(p); } catch (e) { problems.push(e.message); }
    if (fp && p.meta.fingerprint !== fp) {
      problems.push(where + ': ' + coveredFiles(p).join(', ') + ' changed since this page was last reviewed. Update the page for the change ' +
        '(or confirm nothing in it needs to change), then run: node tools/help/stamp.js ' + p.slug);
    }
    const { links, headings } = render(p.body);
    links.forEach(href => {
      if (/^(https?:|mailto:)/.test(href)) return;
      const [file, anchor] = href.split('#');
      const target = file ? bySlug[file.replace(/\.html$/, '')] : p;
      if (!target || (file && !/\.html$/.test(file))) { problems.push(where + ': link "' + href + '" goes to no help page'); return; }
      if (anchor && !render(target.body).headings.some(h => h.id === anchor)) problems.push(where + ': link "' + href + '" names a section that does not exist');
    });
    void headings;
  });
  areas.filter(a => a.written).forEach(a => (a.modules || []).forEach(id => {
    if (!covered[id]) problems.push('help: the ' + a.title + ' area is written, but ' + id + ' (' + (reg.find(m => m.id === id) || {}).label + ') has no page — write help/pages/<page>.md with "modules: [' + id + ']"');
  }));
  return problems;
}

// ---------- the site ----------
const CSS = `:root{--bg:#f8fafc;--panel:#fff;--text:#0f172a;--muted:#475569;--line:#e2e8f0;--accent:#2563eb;--note:#eff6ff;--code:#f1f5f9}
@media (prefers-color-scheme:dark){:root:not([data-theme=light]){--bg:#0f172a;--panel:#1e293b;--text:#e2e8f0;--muted:#94a3b8;--line:#334155;--accent:#60a5fa;--note:#172554;--code:#0f172a}}
:root[data-theme=dark]{--bg:#0f172a;--panel:#1e293b;--text:#e2e8f0;--muted:#94a3b8;--line:#334155;--accent:#60a5fa;--note:#172554;--code:#0f172a}
#theme{margin-left:auto;padding:6px 10px;border:1px solid var(--line);border-radius:8px;background:var(--bg);color:var(--text);font:inherit;font-size:13px;cursor:pointer}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:15px/1.6 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
a{color:var(--accent)}header{background:var(--panel);border-bottom:1px solid var(--line);padding:12px 16px;display:flex;gap:16px;align-items:center;flex-wrap:wrap}
header .brand{font-weight:700;text-decoration:none;color:var(--text);font-size:17px}header input{flex:1;min-width:180px;max-width:360px;padding:7px 10px;border:1px solid var(--line);border-radius:8px;background:var(--bg);color:var(--text);font:inherit}
.wrap{max-width:1100px;margin:0 auto;display:flex;gap:28px;padding:20px 16px}nav{width:240px;flex:none;font-size:14px}nav h4{margin:14px 0 4px;font-size:12px;text-transform:uppercase;color:var(--muted);letter-spacing:.04em}
nav ul{list-style:none;margin:0;padding:0}nav li a{display:block;padding:3px 0;text-decoration:none;color:var(--text)}nav li a.here{color:var(--accent);font-weight:600}nav .soon{color:var(--muted);font-size:13px}
main{flex:1;min-width:0;background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:24px 28px}main h1{margin-top:0;font-size:26px}main h2{margin-top:28px;font-size:20px;border-bottom:1px solid var(--line);padding-bottom:4px}
.lead{color:var(--muted);font-size:16px}.crumb{font-size:13px;color:var(--muted);margin-bottom:6px}.note{background:var(--note);border-left:4px solid var(--accent);padding:2px 14px;border-radius:6px;margin:14px 0}
code{background:var(--code);padding:1px 5px;border-radius:4px;font-size:13px}table{border-collapse:collapse;width:100%;margin:12px 0;font-size:14px}th,td{border:1px solid var(--line);padding:6px 9px;text-align:left;vertical-align:top}th{background:var(--bg)}
.cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:14px}.card{border:1px solid var(--line);border-radius:10px;padding:12px 14px;background:var(--bg)}.card h3{margin:0 0 6px;font-size:16px}.card ul{margin:0;padding-left:18px;font-size:14px}
footer{max-width:1100px;margin:0 auto;padding:4px 16px 30px;font-size:12px;color:var(--muted)}#results{list-style:none;padding:0}#results li{margin:8px 0}#results small{color:var(--muted)}
#notice{display:none}@media (max-width:760px){.wrap{flex-direction:column}nav{width:auto}main{padding:18px}}
@media print{header,nav,footer{display:none}main{border:0;padding:0}body{background:#fff;color:#000}}`;

// Search and "?m=MODULE" (the ERP's Help button): plain JavaScript, no data from the ERP.
const JS = `(function(){var q=document.getElementById('q'),main=document.querySelector('main'),orig=main.innerHTML,idx=null;
function esc(s){return String(s).replace(/[&<>"]/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]})}
function load(cb){if(idx)return cb();fetch('search.json').then(function(r){return r.json()}).then(function(j){idx=j;cb()})}
function search(t){t=t.trim().toLowerCase();if(!t){main.innerHTML=orig;return}load(function(){var w=t.split(/\\s+/),hits=idx.pages.filter(function(p){var s=(p.title+' '+p.text).toLowerCase();return w.every(function(x){return s.indexOf(x)>=0})});
main.innerHTML='<h1>Search: '+esc(t)+'</h1>'+(hits.length?'<ul id="results">'+hits.map(function(p){return '<li><a href="'+p.slug+'.html">'+esc(p.title)+'</a><br><small>'+esc(p.summary||'')+'</small></li>'}).join('')+'</ul>':'<p>Nothing found. Try fewer or other words.</p>')})}
if(q){q.addEventListener('input',function(){search(q.value)});}
var m=new URLSearchParams(location.search).get('m');if(m){load(function(){var s=idx.modules[m];if(s){location.replace(s+'.html')}else{var n=document.getElementById('notice');if(n){n.style.display='block'}}})}})();`;

// Light / dark (owner, 2026-10-14): the ERP's saved theme (erp-theme, the
// same site, so one setting for both), else the device's. Set in <head>,
// before the page paints; the header button switches and saves it.
const THEME_HEAD = "<script>try{var t=localStorage.getItem('erp-theme');if(t==='light'||t==='dark')document.documentElement.setAttribute('data-theme',t)}catch(e){}</script>";
const THEME_JS = `(function(){var b=document.getElementById('theme');if(!b)return;var r=document.documentElement;
function dark(){var t=r.getAttribute('data-theme');return t?t==='dark':window.matchMedia('(prefers-color-scheme: dark)').matches}
function label(){b.textContent=dark()?'Light mode':'Dark mode'}
b.addEventListener('click',function(){var t=dark()?'light':'dark';r.setAttribute('data-theme',t);try{localStorage.setItem('erp-theme',t)}catch(e){}label()});label()})();`;

function layout({ title, description, body, nav, canonical, crumb }) {
  return '<!DOCTYPE html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n' +
    '<title>' + esc(title) + '</title>\n<meta name="description" content="' + esc(description || '') + '">\n' +
    '<link rel="canonical" href="' + esc(canonical) + '">\n' + THEME_HEAD + '\n<link rel="stylesheet" href="help.css">\n</head>\n<body>\n' +
    '<header><a class="brand" href="index.html">ERP Help</a><input id="q" type="search" placeholder="Search help" aria-label="Search help"><button id="theme" type="button" title="Switch between light and dark"></button></header>\n' +
    '<div class="wrap">\n<nav>' + nav + '</nav>\n<main>' + (crumb ? '<div class="crumb">' + crumb + '</div>' : '') + body + '</main>\n</div>\n' +
    '<footer>Free to read and share. © Yasir AV. All rights reserved.</footer>\n<script src="help.js"></script>\n</body>\n</html>\n';
}

// Every file of the site: { 'public/help/x.html': content, ... }.
function build() {
  const { site, areas } = areasFile();
  const reg = registry(), label = Object.fromEntries(reg.map(m => [m.id, m.label]));
  const all = pages();
  const order = p => [areas.findIndex(a => a.id === p.meta.area), Number(p.meta.order || 99), p.meta.title];
  all.sort((a, b) => { const x = order(a), y = order(b); return x[0] - y[0] || x[1] - y[1] || String(x[2]).localeCompare(String(y[2])); });
  const files = {};
  const url = slug => site + '/help/' + (slug === 'index' ? '' : slug + '.html');
  const navFor = here => areas.map(a => {
    const list = all.filter(p => p.meta.area === a.id);
    if (!list.length && !a.written) return '';
    return '<h4>' + esc(a.title) + '</h4><ul>' + list.map(p => '<li><a href="' + p.slug + '.html"' + (p.slug === here ? ' class="here"' : '') + '>' + esc(p.meta.title) + '</a></li>').join('') + '</ul>';
  }).join('') + (areas.some(a => !a.written) ? '<p class="soon">More areas are being written.</p>' : '');

  all.forEach(p => {
    const area = areas.find(a => a.id === p.meta.area) || {};
    const covers = p.modules.length ? '<p class="lead">Screen' + (p.modules.length > 1 ? 's' : '') + ': ' + p.modules.map(id => esc(label[id] || id)).join(', ') + '</p>' : '';
    const body = '<h1>' + esc(p.meta.title) + '</h1>' + (p.meta.summary ? '<p class="lead">' + esc(p.meta.summary) + '</p>' : '') + covers +
      render(p.body).html + '<p class="crumb">Last reviewed ' + ddmmyyyy(p.meta.reviewed) + '</p>';
    files[OUT_DIR + '/' + p.slug + '.html'] = layout({ title: p.meta.title + ' — ERP Help', description: p.meta.summary, body, nav: navFor(p.slug),
      canonical: url(p.slug), crumb: '<a href="index.html">Help</a> › ' + esc(area.title || '') });
  });

  const home = '<h1>ERP Help</h1><p class="lead">How to use the ERP: what each screen is for, how to do the common tasks, and what happens in the books. Free to read, no sign-in needed.</p>' +
    '<div id="notice" class="note"><p>There is no help page for that screen yet. Its area is still being written; start with <a href="getting-started.html">Getting started</a>.</p></div>' +
    '<div class="cards">' + areas.map(a => {
      const list = all.filter(p => p.meta.area === a.id);
      const soon = (a.modules || []).filter(id => !all.some(p => p.modules.includes(id)));
      return '<div class="card"><h3>' + esc(a.title) + '</h3>' + (a.intro ? '<p>' + esc(a.intro) + '</p>' : '') +
        (list.length ? '<ul>' + list.map(p => '<li><a href="' + p.slug + '.html">' + esc(p.meta.title) + '</a></li>').join('') + '</ul>' : '') +
        (soon.length ? '<p class="soon">Coming: ' + soon.map(id => esc(label[id] || id)).join(', ') + '.</p>' : '') + '</div>';
    }).join('') + '</div>';
  files[OUT_DIR + '/index.html'] = layout({ title: 'ERP Help', description: 'How to use the ERP, screen by screen.', body: home, nav: navFor('index'), canonical: url('index') });

  const modules = {};
  all.forEach(p => p.modules.forEach(id => { modules[id] = p.slug; }));
  const text = md => md.replace(/[#>*`|_[\]()-]/g, ' ').replace(/\s+/g, ' ').trim();
  files[OUT_DIR + '/search.json'] = JSON.stringify({ modules, pages: all.map(p => ({ slug: p.slug, title: p.meta.title, summary: p.meta.summary || '',
    text: (p.modules.map(id => label[id] || '').join(' ') + ' ' + text(p.body)).slice(0, 20000) })) }) + '\n';
  files[OUT_DIR + '/help.css'] = CSS + '\n';
  files[OUT_DIR + '/help.js'] = JS + '\n' + THEME_JS + '\n';
  files[OUT_DIR + '/sitemap.xml'] = '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
    ['index'].concat(all.map(p => p.slug)).map(s => {
      const p = all.find(x => x.slug === s);
      return '  <url><loc>' + url(s) + '</loc>' + (p ? '<lastmod>' + p.meta.reviewed + '</lastmod>' : '') + '</url>';
    }).join('\n') + '\n</urlset>\n';
  // Listed by search engines (decision 148): help only; the sign-in page and the portal are not for search results.
  files['public/robots.txt'] = 'User-agent: *\nAllow: /help/\nDisallow: /\n\nSitemap: ' + site + '/help/sitemap.xml\n';
  return files;
}

// The built files on disk that differ from build() (or are left over).
function staleOutput() {
  const want = build(), stale = [];
  Object.entries(want).forEach(([f, c]) => { const p = path.join(REPO, f); if (!fs.existsSync(p) || fs.readFileSync(p, 'utf8') !== c) stale.push(f); });
  const dir = path.join(REPO, OUT_DIR);
  if (fs.existsSync(dir)) fs.readdirSync(dir).forEach(n => { if (!want[OUT_DIR + '/' + n]) stale.push(OUT_DIR + '/' + n + ' (not built from help/pages)'); });
  return stale;
}

module.exports = { REPO, OUT_DIR, pages, parsePage, fingerprint, coveredFiles, check, build, staleOutput, ddmmyyyy };
