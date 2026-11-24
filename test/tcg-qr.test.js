// QR code des échanges du TCG : chaque code produit est relu par un petit décodeur écrit ici
// (format BCH, démasquage, lecture en zigzag, blocs, syndromes Reed-Solomon nuls, données).

import test from 'node:test';
import assert from 'node:assert/strict';
import { qrMatrix } from '../web/js/tcg/qr.js';

const ECC_M = [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26];
const BLOCKS_M = [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5];

const EXP = new Array(512);
const LOG = new Array(256);
{
  let x = 1;
  for (let i = 0; i < 255; i++) {
    EXP[i] = x;
    LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
}
const mul = (a, b) => (a && b ? EXP[LOG[a] + LOG[b]] : 0);

function decode(m) {
  const size = m.length;
  const v = (size - 17) / 4;
  assert.ok(Number.isInteger(v) && v >= 1 && v <= 10, 'taille');
  // Format (première copie), vérifié par son code BCH.
  const bits = [];
  for (let i = 0; i <= 5; i++) bits.push(m[i][8]);
  bits.push(m[7][8], m[8][8], m[8][7]);
  for (let i = 9; i < 15; i++) bits.push(m[8][14 - i]);
  let f = 0;
  bits.forEach((b, i) => (f |= (b ? 1 : 0) << i));
  f ^= 0x5412;
  const data = f >>> 10;
  let rem = data;
  for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
  assert.equal(((data << 10) | rem) & 0x7fff, f, 'format BCH');
  assert.equal(data >>> 3, 0, 'correction M');
  const mask = data & 7;
  // Seconde copie identique.
  const bits2 = [];
  for (let i = 0; i < 8; i++) bits2.push(m[8][size - 1 - i]);
  for (let i = 8; i < 15; i++) bits2.push(m[size - 15 + i][8]);
  assert.deepEqual(bits2, bits, 'deux copies du format');

  // Modules réservés (même géométrie que l'encodeur, recalculée ici).
  const fn = Array.from({ length: size }, () => new Array(size).fill(false));
  const res = (x, y) => x >= 0 && y >= 0 && x < size && y < size && (fn[y][x] = true);
  for (let i = 0; i < size; i++) res(6, i), res(i, 6);
  for (const [cx, cy] of [[3, 3], [size - 4, 3], [3, size - 4]]) for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) res(cx + dx, cy + dy);
  if (v > 1) {
    const n = Math.floor(v / 7) + 2;
    const step = Math.ceil((v * 4 + 4) / (n * 2 - 2)) * 2;
    const al = [6];
    for (let p = size - 7; al.length < n; p -= step) al.splice(1, 0, p);
    al.forEach((ax, i) => al.forEach((ay, j) => {
      if ((i === 0 && j === 0) || (i === 0 && j === al.length - 1) || (i === al.length - 1 && j === 0)) return;
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) res(ax + dx, ay + dy);
    }));
  }
  for (let i = 0; i < 9; i++) res(8, i), res(i, 8);
  for (let i = 0; i < 8; i++) res(size - 1 - i, 8), res(8, size - 1 - i);
  if (v >= 7) for (let i = 0; i < 18; i++) res(size - 11 + (i % 3), Math.floor(i / 3)), res(Math.floor(i / 3), size - 11 + (i % 3));

  // Motifs de repérage.
  for (const [cx, cy] of [[3, 3], [size - 4, 3], [3, size - 4]]) {
    assert.equal(m[cy][cx], true);
    assert.equal(m[cy - 2][cx], false);
    assert.equal(m[cy - 3][cx], true);
  }

  const masks = [
    (x, y) => (x + y) % 2 === 0, (x, y) => y % 2 === 0, (x) => x % 3 === 0, (x, y) => (x + y) % 3 === 0,
    (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0, (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
    (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0, (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
  ];
  const stream = [];
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert++)
      for (let j = 0; j < 2; j++) {
        const x = right - j;
        const y = ((right + 1) & 2) === 0 ? size - 1 - vert : vert;
        if (!fn[y][x]) stream.push(m[y][x] !== masks[mask](x, y));
      }
  }
  const raw = [];
  for (let i = 0; i + 8 <= stream.length; i += 8) raw.push(stream.slice(i, i + 8).reduce((a, b) => (a << 1) | (b ? 1 : 0), 0));

  // Désentrelacement et syndromes.
  const nb = BLOCKS_M[v];
  const ecc = ECC_M[v];
  const total = raw.length;
  const nShort = nb - (total % nb);
  const shortLen = Math.floor(total / nb);
  // Blocs complétés à la même longueur (un octet fictif dans les blocs courts, avant la correction).
  const padded = Array.from({ length: nb }, () => new Array(shortLen + 1).fill(0));
  let k = 0;
  for (let i = 0; i <= shortLen; i++)
    for (let j = 0; j < nb; j++) {
      if (i === shortLen - ecc && j < nShort) continue;
      padded[j][i] = raw[k++];
    }
  assert.equal(k, total, 'tous les octets lus');
  const blocks = padded.map((b, j) => (j < nShort ? [...b.slice(0, shortLen - ecc), ...b.slice(shortLen - ecc + 1)] : b));
  const dataBytes = [];
  for (const b of blocks) {
    for (let s = 0; s < ecc; s++) {
      let syn = 0;
      for (const c of b) syn = mul(syn, EXP[s]) ^ c;
      assert.equal(syn, 0, 'syndrome Reed-Solomon');
    }
    dataBytes.push(...b.slice(0, b.length - ecc));
  }
  // Données : mode octet.
  const bitsData = dataBytes.flatMap((x) => [7, 6, 5, 4, 3, 2, 1, 0].map((i) => (x >>> i) & 1));
  let p = 0;
  const read = (n) => {
    let val = 0;
    for (let i = 0; i < n; i++) val = (val << 1) | bitsData[p++];
    return val;
  };
  assert.equal(read(4), 0b0100, 'mode octet');
  const len = read(v <= 9 ? 8 : 16);
  const out = new Uint8Array(len);
  for (let i = 0; i < len; i++) out[i] = read(8);
  return new TextDecoder().decode(out);
}

test('QR : relu à l’identique, pour des liens d’échange de toutes longueurs', () => {
  const urls = ['https://isis-hub.baudrysouvignet.fr/#echange=K7Q2', 'http://localhost:8083/#echange=AB23', 'https://hub.exemple.fr/#echange=ZZ99'];
  for (let n = 1; n < 150; n += 7) urls.push(`https://h.fr/${'x'.repeat(n)}#echange=K7Q2`);
  for (const u of urls) assert.equal(decode(qrMatrix(u)), u);
});

test('QR : trop long pour la version 10 → erreur claire', () => {
  assert.throws(() => qrMatrix('x'.repeat(400)), /trop long/);
});
