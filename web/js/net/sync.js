// Sauvegarde anonyme et chiffrée (voir internal/feedback/vault.go pour le principe).
//
// À la connexion, la page dérive du mot de passe et de l'identifiant un secret de 96 octets
// (PBKDF2-SHA-256, 600 000 tours) :
//   - id   = SHA-256(secret[0:32]) en hexadécimal : le nom de l'enregistrement sur le serveur ;
//   - auth = secret[32:64] : la preuve demandée pour lire ou écrire ;
//   - clé  = secret[64:96] : chiffre les données (AES-GCM 256) avant qu'elles quittent l'appareil.
// Le serveur ne voit jamais l'identifiant, le mot de passe ni la clé : il ne peut ni lire les
// données ni savoir à qui elles appartiennent. Le secret dérivé est gardé chiffré sur l'appareil
// (coffre local) pour les ouvertures suivantes ; le mot de passe, lui, n'est jamais gardé.

const ITERATIONS = 600_000;
const enc = new TextEncoder();
const dec = new TextDecoder();

const hex = (b) => Array.from(new Uint8Array(b), (x) => x.toString(16).padStart(2, '0')).join('');
const b64url = (b) => btoa(String.fromCharCode(...new Uint8Array(b))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
export const b64 = (b) => {
  const u = new Uint8Array(b);
  let s = '';
  for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000));
  return btoa(s);
};
export const unb64 = (t) => Uint8Array.from(atob(t), (c) => c.charCodeAt(0));

/** Secret de 96 octets dérivé de l'identifiant et du mot de passe (à la connexion seulement). */
export async function deriveSecret(username, password, iterations = ITERATIONS) {
  const base = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const salt = enc.encode(`isis-hub/sync/v1:${username.trim().toLowerCase()}`);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, base, 768);
  return new Uint8Array(bits);
}

/** Identifiants publics et clé non exportable tirés du secret. */
export async function credentials(secret) {
  const s = new Uint8Array(secret);
  const id = hex(await crypto.subtle.digest('SHA-256', s.slice(0, 32)));
  const auth = b64url(s.slice(32, 64));
  const key = await crypto.subtle.importKey('raw', s.slice(64, 96), { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
  return { id, auth, key };
}

/**
 * Clé des jetons de fréquentation (HKDF du secret, séparée des trois autres usages) : le jeton du
 * jour = HMAC(clé, jour), tronqué à 16 octets. Même compte → même jeton toute la journée sur tous
 * ses appareils ; d'un jour à l'autre, rien ne relie deux jetons ; le serveur ne peut le recalculer.
 */
export async function visitKey(secret) {
  const base = await crypto.subtle.importKey('raw', new Uint8Array(secret), 'HKDF', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(32), info: enc.encode('isis-hub/visit/v1') },
    base,
    { name: 'HMAC', hash: 'SHA-256', length: 256 },
    false,
    ['sign'],
  );
}

export async function visitToken(key, day) {
  const mac = await crypto.subtle.sign('HMAC', key, enc.encode(`isis-hub/visit/v1:${day}`));
  return b64url(new Uint8Array(mac).slice(0, 16));
}

/** Chiffre un objet : IV aléatoire + AES-GCM, lié à l'identifiant de l'enregistrement. */
export async function seal(cred, value) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: enc.encode(cred.id) }, cred.key, enc.encode(JSON.stringify(value))));
  const out = new Uint8Array(12 + ct.length);
  out.set(iv);
  out.set(ct, 12);
  return b64(out);
}

export async function open(cred, data) {
  const raw = unb64(data);
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: raw.slice(0, 12), additionalData: enc.encode(cred.id) }, cred.key, raw.slice(12));
  return JSON.parse(dec.decode(pt));
}

async function call(cred, op, extra = {}) {
  const res = await fetch('api/vault', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ op, id: cred.id, auth: cred.auth, ...extra }),
    credentials: 'omit',
    cache: 'no-store',
  });
  const body = res.status === 204 ? null : await res.json().catch(() => null);
  return { status: res.status, body };
}

/** Lit la sauvegarde : { v, value } ou null s'il n'y en a pas encore. */
export async function pull(cred) {
  const { status, body } = await call(cred, 'read');
  if (status === 404) return null;
  if (status !== 200) throw new Error(body?.error || `HTTP ${status}`);
  return { v: body.v, value: await open(cred, body.data) };
}

/** Écrit la sauvegarde si la version attendue est la bonne ; sinon rend la version du serveur. */
export async function push(cred, v, value) {
  const { status, body } = await call(cred, 'write', { v, data: await seal(cred, value) });
  if (status === 200) return { ok: true, v: body.v };
  // Conflit : version du serveur à fusionner (vide si la sauvegarde n'existe plus, ex. effacée
  // depuis un autre appareil : la page la recrée en version 0).
  if (status === 409) return { ok: false, v: body.v, value: body.data ? await open(cred, body.data) : null };
  throw new Error(body?.error || `HTTP ${status}`);
}

export async function erase(cred) {
  const { status, body } = await call(cred, 'delete');
  if (status !== 204 && status !== 404) throw new Error(body?.error || `HTTP ${status}`);
}
