// Barcodes drawn as SVG for printed labels (docs/modules/ITEM_BARCODES.md,
// step 3): EAN-13 for 13-digit numbers (the retail standard), Code 128 for
// anything else (an item code like FG-000001). No outside library: the
// encodings are the published ones, and the unit tests decode the output
// with an independent reader.
'use strict';

// ---------- EAN-13 ----------
const L = ['0001101', '0011001', '0010011', '0111101', '0100011', '0110001', '0101111', '0111011', '0110111', '0001011'];
const R = L.map(p => p.replace(/./g, c => (c === '0' ? '1' : '0')));
const G = R.map(p => p.split('').reverse().join(''));
const PARITY = ['LLLLLL', 'LLGLGG', 'LLGGLG', 'LLGGGL', 'LGLLGG', 'LGGLLG', 'LGGGLL', 'LGLGLG', 'LGLGGL', 'LGGLGL'];

function ean13Check(twelve) {
  const sum = twelve.split('').reduce((t, d, i) => t + Number(d) * (i % 2 ? 3 : 1), 0);
  return String((10 - (sum % 10)) % 10);
}
function ean13Modules(code) {
  const d = code.split('').map(Number);
  const parity = PARITY[d[0]];
  let bits = '101';
  for (let i = 1; i <= 6; i++) bits += (parity[i - 1] === 'L' ? L : G)[d[i]];
  bits += '01010';
  for (let i = 7; i <= 12; i++) bits += R[d[i]];
  return bits + '101';
}

// ---------- Code 128 ----------
// Bar/space widths of each symbol value 0-106 (106 = stop, 7 elements).
const C128 = ('212222 222122 222221 121223 121322 131222 122213 122312 132212 221213 221312 231212 112232 122132 122231 113222 ' +
  '123122 123221 223211 221132 221231 213212 223112 312131 311222 321122 321221 312212 322112 322211 212123 212321 232121 ' +
  '111323 131123 131321 112313 132113 132311 211313 231113 231311 112133 112331 132131 113123 113321 133121 313121 211331 ' +
  '231131 213113 213311 213131 311123 311321 331121 312113 312311 332111 314111 221411 431111 111224 111422 121124 121421 ' +
  '141122 141221 112214 112412 122114 122411 142112 142211 241211 221114 413111 241112 134111 111242 121142 121241 114212 ' +
  '124112 124211 411212 421112 421211 212141 214121 412121 111143 111341 131141 114113 114311 411113 411311 113141 114131 ' +
  '311141 411131 211412 211214 211232 2331112').split(' ');
const START_B = 104, START_C = 105;

function code128Values(text) {
  // All digits, even length: set C (two digits a symbol); else set B.
  if (/^\d+$/.test(text) && text.length % 2 === 0 && text.length >= 4) {
    const vals = [START_C];
    for (let i = 0; i < text.length; i += 2) vals.push(Number(text.slice(i, i + 2)));
    return vals;
  }
  return [START_B].concat(text.split('').map(ch => {
    const c = ch.charCodeAt(0);
    if (c < 32 || c > 126) throw new Error('Code 128 (set B) cannot hold "' + ch + '".');
    return c - 32;
  }));
}
function code128Modules(text) {
  const vals = code128Values(text);
  const check = vals.reduce((t, v, i) => t + v * (i || 1), 0) % 103;
  return vals.concat([check, 106]).map(v => C128[v].split('').map((w, i) => (i % 2 ? '0' : '1').repeat(Number(w))).join('')).join('');
}

// The symbol for a barcode text: EAN-13 when it is one (13 digits, right
// check digit), else Code 128.
function encode(text) {
  const t = String(text || '').trim();
  if (/^\d{13}$/.test(t) && ean13Check(t.slice(0, 12)) === t[12]) return { type: 'EAN-13', text: t, bits: ean13Modules(t) };
  return { type: 'Code 128', text: t, bits: code128Modules(t) };
}

const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
// An SVG of the barcode, scaled to its box (CSS sizes it), with quiet
// zones and the human-readable text under the bars.
function svg(text) {
  const { bits, text: t } = encode(text);
  const quiet = 10, w = bits.length + 2 * quiet, barH = 50, h = barH + 14;
  let rects = '', x = 0;
  while (x < bits.length) {
    if (bits[x] === '1') { let n = 1; while (bits[x + n] === '1') n++; rects += '<rect x="' + (x + quiet) + '" y="0" width="' + n + '" height="' + barH + '"/>'; x += n; } else x++;
  }
  return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + w + ' ' + h + '" preserveAspectRatio="none" shape-rendering="crispEdges">' +
    '<rect width="' + w + '" height="' + h + '" fill="#fff"/><g fill="#000">' + rects + '</g>' +
    '<text x="' + (w / 2) + '" y="' + (h - 2) + '" text-anchor="middle" font-family="monospace" font-size="11">' + esc(t) + '</text></svg>';
}

module.exports = { encode, svg, ean13Check, ean13Modules, code128Modules };
