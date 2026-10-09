// Barcodes drawn for labels (docs/modules/ITEM_BARCODES.md, step 3). The
// expected bit patterns below were decoded by an independent reader (ZXing,
// 2026-10-09: every EAN-13 first digit, every printable Code 128 set B
// character, every set C pair) before being pinned here.
const test = require('node:test');
const assert = require('node:assert/strict');
const B = require('../../src/barcodeSvg');

const GOLDEN = {"12345678":"1101001110010110011100100010110001110001011011000010100100011101101100011101011","6291041500213":"10100100110010111011001101001110100011001100101010100111011100101110010110110011001101000010101","1234567890128":"10100100110111101001110101100010000101001000101010100100011101001110010110011011011001001000101","FG-000001":"11010010000100011000101101000100010011011100100111011001001110110010011101100100111011001001110110010011100110100001001101100011101011"};

test('the bit patterns match the ones an independent reader decoded', () => {
  for (const [text, bits] of Object.entries(GOLDEN)) assert.equal(B.encode(text).bits, bits, text);
});

test('EAN-13 for a 13-digit number with the right check digit, else Code 128', () => {
  assert.deepEqual([B.encode('6291041500213').type, B.encode('6291041500214').type, B.encode('FG-000001').type, B.encode('12345678').type],
    ['EAN-13', 'Code 128', 'Code 128', 'Code 128']);
  assert.equal(B.ean13Check('629104150021'), '3');
  assert.equal(B.ean13Check('200000000001'), '5');
  // EAN-13: 95 modules (guards, 12 digits of 7); Code 128: 11 a symbol, 13 for the stop.
  assert.equal(B.encode('6291041500213').bits.length, 95);
  assert.equal(B.encode('FG-000001').bits.length, 11 * (1 + 9 + 1) + 13);
  assert.equal(B.encode('12345678').bits.length, 11 * (1 + 4 + 1) + 13, 'all digits, even length: two digits a symbol');
  assert.throws(() => B.encode('é'), /cannot hold/);
});

test('the SVG: bars as rectangles, quiet zones, the text under them', () => {
  const s = B.svg('FG-000001');
  assert.match(s, /^<svg xmlns="http:\/\/www.w3.org\/2000\/svg" viewBox="0 0 154 64"/);
  assert.match(s, /<text [^>]*>FG-000001<\/text><\/svg>$/);
  assert.equal((s.match(/<rect x=/g) || []).length, B.encode('FG-000001').bits.match(/1+/g).length);
  assert.match(B.svg('<b>'), /&lt;b&gt;/);
});
