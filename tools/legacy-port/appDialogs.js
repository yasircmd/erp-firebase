// Browser popups → in-app dialogs (owner, 2026-09-29; see the APP DIALOGS
// block in public/index.html). Rewrites every confirm(…) / prompt(…) in a
// screen's scripts (bare or window.-prefixed) to
//   (await appConfirm(…)) / (await appPrompt(…))
// and makes the function that holds it async. The shell answers alert()
// itself, so alerts are left as they are.
//
// Used by generate.js for generated screens, and from the command line
// for hand-maintained ones:
//   node tools/legacy-port/appDialogs.js screens/FOO.html [...]
// It prints each function it made async: check that nothing uses its
// return value (it's now a Promise). Running it again changes nothing.
const acorn = require('acorn');
const walk = require('acorn-walk');

const NATIVE = new Map([['confirm', 'appConfirm'], ['prompt', 'appPrompt']]);
const FUNCTION = new Set(['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression']);

function nativeDialog(callee) {
  if (callee.type === 'Identifier' && NATIVE.has(callee.name)) return callee.name;
  if (callee.type === 'MemberExpression' && !callee.computed && callee.object.type === 'Identifier' &&
      callee.object.name === 'window' && NATIVE.has(callee.property.name)) return callee.property.name;
  return null;
}

function nameOf(fn, parent) {
  if (fn.id) return fn.id.name;
  if (parent && parent.type === 'VariableDeclarator' && parent.id.type === 'Identifier') return parent.id.name;
  if (parent && (parent.type === 'Property' || parent.type === 'MethodDefinition') && parent.key.type === 'Identifier') return parent.key.name;
  if (parent && parent.type === 'AssignmentExpression' && parent.left.type === 'MemberExpression') {
    const l = parent.left;
    return (l.object.type === 'Identifier' ? l.object.name + '.' : '') + (l.property.name || '?');
  }
  return '(anonymous)';
}

// Returns { code, changed: [{ name, line }] } for one script's source.
function transformScript(src, where) {
  let ast;
  try { ast = acorn.parse(src, { ecmaVersion: 'latest', sourceType: 'script', allowReturnOutsideFunction: true, locations: true }); }
  catch (e) { throw new Error(where + ': cannot parse a script (' + e.message + ')'); }
  const edits = []; // [position, deleteCount, text]
  const madeAsync = new Map();
  walk.ancestor(ast, {
    CallExpression(node, _state, ancestors) {
      const kind = nativeDialog(node.callee);
      if (!kind) return;
      edits.push([node.start, 0, '(']);
      edits.push([node.callee.start, node.callee.end - node.callee.start, 'await ' + NATIVE.get(kind)]);
      edits.push([node.end, 0, ')']);
      let i = ancestors.length - 2;
      while (i >= 0 && !FUNCTION.has(ancestors[i].type)) i--;
      if (i < 0) throw new Error(where + ':' + node.loc.start.line + ': ' + kind + '() outside any function');
      const fn = ancestors[i], parent = ancestors[i - 1];
      if (fn.async || madeAsync.has(fn)) return;
      const isMethod = parent && (parent.type === 'MethodDefinition' || (parent.type === 'Property' && (parent.method || parent.kind !== 'init')));
      if (isMethod) throw new Error(where + ':' + node.loc.start.line + ': ' + kind + '() inside a method — convert it by hand');
      madeAsync.set(fn, { name: nameOf(fn, parent), line: fn.loc.start.line });
      edits.push([fn.start, 0, 'async ']);
    }
  });
  // Apply from the end, so earlier positions stay valid. At one position
  // the callee's replacement goes first, then the "(" / "async " before it.
  edits.sort((a, b) => b[0] - a[0] || b[1] - a[1]);
  let code = src;
  for (const [pos, del, text] of edits) code = code.slice(0, pos) + text + code.slice(pos + del);
  return { code, changed: [...madeAsync.values()] };
}

// Transforms every inline classic script in an HTML screen.
function toAppDialogs(html, where) {
  const changed = [];
  const out = html.replace(/(<script\b([^>]*)>)([\s\S]*?)(<\/script>)/g, (m, open, attrs, body, close) => {
    const type = (attrs.match(/\btype\s*=\s*["']?([^"'\s>]+)/) || [])[1];
    if (/\bsrc\s*=/.test(attrs) || (type && !/javascript/i.test(type))) return m;
    const lineOffset = html.slice(0, html.indexOf(m)).split('\n').length - 1;
    const r = transformScript(body, where);
    r.changed.forEach(c => changed.push({ name: c.name, line: c.line + lineOffset }));
    return open + r.code + close;
  });
  return { html: out, changed };
}

// Every browser popup left in an HTML page: confirm / prompt anywhere, and
// alert where the shell can't catch it (see below). Scans all inline scripts,
// module ones included, and inline on…="…" handlers. For the guard test.
function findNativeDialogs(html, where) {
  const found = [];
  const lineAt = pos => html.slice(0, pos).split('\n').length;
  const scan = (src, offset, sourceType, { alert }) => {
    let ast;
    try { ast = acorn.parse(src, { ecmaVersion: 'latest', sourceType, allowReturnOutsideFunction: true, allowAwaitOutsideFunction: true }); }
    catch (e) { throw new Error(where + ':' + lineAt(offset) + ': cannot parse (' + e.message + ')'); }
    walk.simple(ast, { CallExpression(node) {
      const c = node.callee;
      const kind = nativeDialog(c) || (alert && ((c.type === 'Identifier' && c.name === 'alert') ||
        (c.type === 'MemberExpression' && !c.computed && c.object.name === 'window' && c.property.name === 'alert')) ? 'alert' : null);
      if (kind) found.push({ kind, line: lineAt(offset + node.start) });
    } });
  };
  for (const m of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)) {
    if (/\bsrc\s*=/.test(m[1])) continue;
    const type = (m[1].match(/\btype\s*=\s*["']?([^"'\s>]+)/) || [])[1];
    if (type && !/javascript|module/i.test(type)) continue;
    const offset = m.index + m[0].indexOf('>') + 1;
    // An alert() that runs before the shell's APP DIALOGS block (in a
    // script above it) would still be the browser's.
    const beforeShell = where.endsWith('index.html') && m.index < html.indexOf('---------- APP DIALOGS ----------');
    scan(m[2], offset, type === 'module' ? 'module' : 'script', { alert: beforeShell });
  }
  for (const m of html.matchAll(/\son[a-z]+\s*=\s*"([^"]*)"/g)) scan(m[1].replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&'), m.index, 'script', { alert: false });
  return found;
}

module.exports = { toAppDialogs, transformScript, findNativeDialogs };

if (require.main === module) {
  const fs = require('fs');
  for (const file of process.argv.slice(2)) {
    const src = fs.readFileSync(file, 'utf8');
    const r = toAppDialogs(src, file);
    if (r.html !== src) fs.writeFileSync(file, r.html);
    r.changed.forEach(c => console.log(file + ':' + c.line + '  async ' + c.name));
  }
}
