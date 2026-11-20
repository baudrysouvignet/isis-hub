// Connexion infinie (web/js/net/passkey.js), avec un faux authentificateur qui se comporte comme un
// vrai : un secret par clé, PRF = HMAC(secret, sel), drapeaux et empreinte du site dans authData.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPasskeys, InfiniteError, MAX_IDLE_MS, deviceLabel, unlockName } from '../web/js/net/passkey.js';

const enc = new TextEncoder();
const hex = (b) => Buffer.from(b).toString('hex');

function authenticator({ uv = true, prfAtCreate = true, prfAtGet = true, site = null, swapId = false, refuse = false } = {}) {
  const secrets = new Map();
  const seen = { create: [], get: [] };
  return {
    seen,
    async create({ publicKey }) {
      seen.create.push(publicKey);
      if (refuse) throw Object.assign(new Error('annulé'), { name: 'NotAllowedError' });
      const id = crypto.getRandomValues(new Uint8Array(32));
      secrets.set(hex(id), crypto.getRandomValues(new Uint8Array(32)));
      return { type: 'public-key', rawId: id.buffer, getClientExtensionResults: () => (prfAtCreate ? { prf: { enabled: true } } : {}) };
    },
    async get({ publicKey }) {
      seen.get.push(publicKey);
      if (refuse) throw Object.assign(new Error('annulé'), { name: 'NotAllowedError' });
      const id = new Uint8Array(publicKey.allowCredentials[0].id);
      const secret = secrets.get(hex(id));
      if (!secret) throw Object.assign(new Error('inconnue'), { name: 'NotAllowedError' });
      const k = await crypto.subtle.importKey('raw', secret, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
      const out = await crypto.subtle.sign('HMAC', k, publicKey.extensions.prf.eval.first);
      const auth = new Uint8Array(37);
      auth.set(new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(site ?? publicKey.rpId))));
      auth[32] = 0x01 | (uv ? 0x04 : 0);
      return {
        type: 'public-key',
        rawId: (swapId ? crypto.getRandomValues(new Uint8Array(32)) : id).buffer,
        response: { authenticatorData: auth.buffer },
        getClientExtensionResults: () => (prfAtGet ? { prf: { results: { first: out } } } : {}),
      };
    },
  };
}

const CREDS = { username: 'lmartin', password: 'Un-mot-de-passe-très-secret 42' };

async function enroll(device, opts = {}) {
  const pk = createPasskeys({ credentials: device, rpId: 'hub.test', label: 'iPhone', ...opts });
  const meta = await pk.createKey();
  const key = await pk.unlockKey(meta);
  const blob = await pk.seal(key, meta, CREDS);
  return { pk, meta, blob };
}

const rejects = (p, code) => assert.rejects(p, (e) => e instanceof InfiniteError && e.code === code);

test('connexion infinie : chiffrer puis rouvrir rend les mêmes identifiants, rien en clair dans la copie', async () => {
  const device = authenticator();
  const { pk, blob } = await enroll(device);
  const saved = JSON.stringify(blob);
  for (const secret of [CREDS.password, CREDS.username, Buffer.from(CREDS.password).toString('base64')]) {
    assert.ok(!saved.includes(secret), 'la copie gardée ne doit rien contenir en clair');
  }
  assert.deepEqual(await pk.unlock(blob), CREDS);
  assert.deepEqual(await pk.unlock(JSON.parse(saved)), CREDS); // après passage par le stockage
});

test('connexion infinie : la passkey exige la vérification de l’utilisateur et ne dit rien de lui', async () => {
  const device = authenticator();
  await enroll(device);
  const [created] = device.seen.create;
  assert.equal(created.authenticatorSelection.userVerification, 'required');
  assert.equal(created.attestation, 'none');
  assert.equal(created.rp.id, 'hub.test');
  assert.ok(!JSON.stringify(created.user.name + created.user.displayName).includes(CREDS.username));
  assert.equal(device.seen.get[0].userVerification, 'required');
  assert.equal(device.seen.get[0].allowCredentials.length, 1);
});

test('connexion infinie : refusée sans vérification, sur un autre site, avec une autre clé', async () => {
  await rejects(enroll(authenticator({ uv: false })), 'not-verified');
  await rejects(enroll(authenticator({ site: 'evil.test' })), 'wrong-site');
  await rejects(enroll(authenticator({ swapId: true })), 'wrong-key');
  // Une copie faite sur un appareil ne s'ouvre pas avec la passkey d'un autre.
  const { blob } = await enroll(authenticator());
  const other = await enroll(authenticator());
  await rejects(other.pk.unlock(blob), 'cancelled');
});

test('connexion infinie : copie modifiée, abîmée ou trop ancienne → refusée', async () => {
  const device = authenticator();
  let t = Date.UTC(2026, 10, 20);
  const { pk, meta, blob } = await enroll(device, { now: () => t });
  const key = await pk.unlockKey(meta);
  const flip = (s) => (s[5] === 'A' ? `${s.slice(0, 5)}B${s.slice(6)}` : `${s.slice(0, 5)}A${s.slice(6)}`);
  await rejects(pk.open(key, { ...blob, ct: flip(blob.ct) }), 'damaged');
  await rejects(pk.open(key, { ...blob, iv: flip(blob.iv) }), 'damaged');
  await rejects(pk.open(key, { ...blob, v: 2 }), 'damaged');
  await rejects(pk.open(key, { ...blob, salt: 'court' }), 'damaged');
  await rejects(pk.open(key, null), 'damaged');
  // Copie déplacée sous une autre clé : les données associées ne correspondent plus.
  const moved = { ...blob, id: Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64url') };
  await rejects(pk.open(key, moved), 'damaged');
  assert.deepEqual(await pk.open(key, blob), CREDS);
  t += MAX_IDLE_MS + 1; // 90 jours sans s'en servir
  await rejects(pk.unlock(blob), 'expired');
  await rejects(pk.open(key, blob), 'expired');
  t = blob.last - 2 * 86_400_000; // horloge remontée : date de dernier usage dans le futur
  await rejects(pk.open(key, blob), 'expired');
});

test('connexion infinie : appareil sans PRF, annulation → rien n’est activé', async () => {
  await rejects(enroll(authenticator({ prfAtCreate: false })), 'unsupported');
  await rejects(enroll(authenticator({ prfAtGet: false })), 'unsupported');
  await rejects(enroll(authenticator({ refuse: true })), 'cancelled');
});

test('connexion infinie : identifiant ou mot de passe vide ou démesuré refusé', async () => {
  const device = authenticator();
  const pk = createPasskeys({ credentials: device, rpId: 'hub.test' });
  const meta = await pk.createKey();
  const key = await pk.unlockKey(meta);
  await rejects(pk.seal(key, meta, { username: 'lmartin', password: '' }), 'invalid');
  await rejects(pk.seal(key, meta, { username: '', password: 'x' }), 'invalid');
  await rejects(pk.seal(key, meta, { username: 'lmartin', password: 'x'.repeat(513) }), 'invalid');
  assert.deepEqual(await pk.open(key, await pk.seal(key, meta, { username: 'é', password: 'ü ✓ 😀' })), { username: 'é', password: 'ü ✓ 😀' });
});

test('connexion infinie : nom d’appareil sans rien de personnel', () => {
  assert.equal(deviceLabel('Mozilla/5.0 (iPhone; CPU iPhone OS 18_4 like Mac OS X)'), 'iPhone');
  assert.equal(deviceLabel('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', 5), 'iPad');
  assert.equal(deviceLabel('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', 0), 'Mac');
  assert.equal(deviceLabel('Mozilla/5.0 (Linux; Android 15; Pixel 9)'), 'Android');
  assert.equal(deviceLabel('Mozilla/5.0 (Windows NT 10.0; Win64; x64)'), 'Windows');
  assert.equal(unlockName('iPhone'), 'Face ID');
  assert.equal(unlockName('autre'), 'ta passkey');
});
