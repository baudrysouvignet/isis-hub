import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { compute, serialize, OUTPUT } from '../tools/checksums.mjs';

test('app/checksums.json est à jour (sinon : npm run checksums)', async () => {
  assert.equal(await readFile(OUTPUT, 'utf8'), serialize(await compute()));
});

test('la brique de chiffrement est bien la copie figée de libcurl.js 0.7.5', async () => {
  const { files } = await compute();
  assert.equal(files['vendor/libcurl/libcurl.mjs'], '8ff1f9b4e722086308569613acb2817e763f730e53fd7712cf2bb1868f731eaf');
  assert.equal(files['vendor/libcurl/libcurl.wasm'], '6a7d769e903e65d93d0f6103fd4632a11368d3ab1868aa3d0abcef47a117030a');
});
