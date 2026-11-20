// Connexion infinie : le mot de passe universitaire, chiffré sur CET appareil par une clé que seule
// sa passkey sait produire (extension WebAuthn « prf »), après Face ID, empreinte ou code.
//
// Garanties :
//   - le serveur ISIS Hub ne participe pas : il ne reçoit, ne voit ni ne garde rien de tout ceci
//     (ni mot de passe, ni copie chiffrée, ni clé, ni passkey). Un vol complet du serveur ne donne
//     rien qui mène au mot de passe ;
//   - la copie chiffrée ne quitte pas l'appareil et y est chiffrée deux fois : par la clé tirée de
//     la passkey (AES-GCM 256, ici), puis par la clé non exportable du coffre de l'appareil
//     (net/vault.js). Copier le stockage du navigateur ne suffit pas, il faut aussi la passkey ;
//   - la passkey ne rend son secret qu'après vérification de l'utilisateur : le drapeau
//     « utilisateur vérifié », l'empreinte du site et l'identifiant de la clé sont contrôlés dans
//     la réponse de l'appareil, pas seulement demandés ;
//   - le mot de passe n'existe en clair que dans la mémoire de la page, le temps d'être envoyé au
//     CAS dans le tunnel TLS (portals/cas.js). Il n'est jamais affiché, exporté ni journalisé ;
//   - chaque déverrouillage part d'un geste de l'étudiant, jamais d'un automatisme.
// Limites, expliquées à l'activation : quiconque sait déverrouiller l'appareil peut se reconnecter ;
// une page piégée (site compromis) pourrait demander la passkey puis lire le mot de passe.
//
// Ce fichier ne touche pas au stockage ni à l'interface : il est testé tel quel sous Node avec un
// faux authentificateur (test/passkey.test.js).

const enc = new TextEncoder();
const dec = new TextDecoder();

export const VERSION = 1;
const INFO = 'isis-hub/infinite/v1';
const TIMEOUT = 60_000;
/** Sans déverrouillage pendant ce temps, la connexion infinie s'efface d'elle-même. */
export const MAX_IDLE_MS = 90 * 24 * 3600 * 1000;
const MAX_FIELD = 512; // identifiant ou mot de passe plus long : refusé

const FLAG_UP = 0x01; // utilisateur présent
const FLAG_UV = 0x04; // utilisateur vérifié (visage, empreinte, code)

export class InfiniteError extends Error {
  /**
   * code : unsupported (appareil ou navigateur incapable), cancelled (annulé, refusé, délai),
   * not-verified, wrong-key, wrong-site, damaged (copie illisible), expired, invalid.
   */
  constructor(code, message) {
    super(message ?? code);
    this.name = 'InfiniteError';
    this.code = code;
  }
}

const b64u = (bytes) => {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
const unb64u = (text) => {
  if (typeof text !== 'string' || !/^[A-Za-z0-9_-]*$/.test(text)) throw new InfiniteError('damaged');
  try {
    const s = atob(text.replace(/-/g, '+').replace(/_/g, '/'));
    return Uint8Array.from(s, (c) => c.charCodeAt(0));
  } catch {
    throw new InfiniteError('damaged'); // longueur impossible en base64
  }
};
const bytes = (buf) => (buf instanceof Uint8Array ? new Uint8Array(buf) : new Uint8Array(buf ?? []));
const same = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);

/** Erreurs du navigateur traduites ; le message d'origine n'est jamais montré tel quel. */
function translate(err) {
  if (err instanceof InfiniteError) return err;
  switch (err?.name) {
    case 'NotAllowedError':
    case 'AbortError':
      return new InfiniteError('cancelled');
    case 'NotSupportedError':
    case 'SecurityError':
    case 'InvalidStateError':
    case 'ConstraintError':
      return new InfiniteError('unsupported');
    default:
      return new InfiniteError('unsupported');
  }
}

/** Nom affiché dans le gestionnaire de passkeys : le type d'appareil, rien de personnel. */
export function deviceLabel(ua = globalThis.navigator?.userAgent ?? '', touch = globalThis.navigator?.maxTouchPoints ?? 0) {
  if (/iPhone|iPod/.test(ua)) return 'iPhone';
  if (/iPad/.test(ua) || (/Macintosh/.test(ua) && touch > 1)) return 'iPad';
  if (/Android/.test(ua)) return 'Android';
  if (/Macintosh/.test(ua)) return 'Mac';
  if (/Windows/.test(ua)) return 'Windows';
  if (/Linux|CrOS/.test(ua)) return 'Linux';
  return 'cet appareil';
}

/** Ce que l'étudiant voit pour se déverrouiller, selon l'appareil. */
export function unlockName(label = deviceLabel()) {
  return { iPhone: 'Face ID', iPad: 'Face ID ou Touch ID', Mac: 'Touch ID', Android: 'ton empreinte ou ton code', Windows: 'Windows Hello' }[label] ?? 'ta passkey';
}

/** Premier tri, avant d'essayer : « non » est sûr, « peut-être » se prouve à l'activation. */
export async function availability({ win = globalThis } = {}) {
  try {
    if (!win.isSecureContext || !win.PublicKeyCredential || !win.navigator?.credentials?.create) return 'unsupported';
    if (win.top && win.top !== win) return 'unsupported'; // jamais dans un cadre
    const caps = await win.PublicKeyCredential.getClientCapabilities?.().catch(() => null);
    if (caps && caps['extension:prf'] === false) return 'unsupported';
    return 'maybe';
  } catch {
    return 'unsupported';
  }
}

/**
 * Outils de la connexion infinie. Tout est injectable pour les tests :
 * credentials (navigator.credentials), rpId (domaine du site), crypto, now.
 */
export function createPasskeys({
  credentials = globalThis.navigator?.credentials,
  rpId = globalThis.location?.hostname,
  crypto = globalThis.crypto,
  now = () => Date.now(),
  label = deviceLabel(),
} = {}) {
  const subtle = crypto.subtle;
  const random = (n) => crypto.getRandomValues(new Uint8Array(n));
  const aad = (id) => enc.encode(`${INFO}|${rpId}|${b64u(id)}`);

  /**
   * 1re étape de l'activation : crée une passkey pour ce site, vérification de l'utilisateur
   * exigée, extension prf demandée. Rend son identifiant et un sel neuf (32 octets).
   */
  async function createKey() {
    let cred;
    try {
      cred = await credentials.create({
        publicKey: {
          rp: { id: rpId, name: 'ISIS Hub' },
          // Identifiant aléatoire : ni nom, ni identifiant universitaire chez Apple, Google…
          user: { id: random(16), name: `Connexion infinie (${label})`, displayName: `Connexion infinie (${label})` },
          challenge: random(32),
          pubKeyCredParams: [
            { type: 'public-key', alg: -7 },
            { type: 'public-key', alg: -8 },
            { type: 'public-key', alg: -257 },
          ],
          authenticatorSelection: { residentKey: 'preferred', userVerification: 'required' },
          attestation: 'none',
          timeout: TIMEOUT,
          extensions: { prf: {} },
        },
      });
    } catch (err) {
      throw translate(err);
    }
    if (!cred || cred.type !== 'public-key') throw new InfiniteError('cancelled');
    const prf = cred.getClientExtensionResults?.()?.prf;
    if (!prf || prf.enabled === false) {
      forget(bytes(cred.rawId)); // clé inutilisable : on demande à l'appareil de l'oublier
      throw new InfiniteError('unsupported');
    }
    return { id: bytes(cred.rawId), salt: random(32) };
  }

  /**
   * Demande la passkey (geste de l'étudiant) et en tire la clé de chiffrement, non exportable.
   * Contrôle la réponse : même clé, même site, utilisateur présent ET vérifié, secret de 32 octets.
   */
  async function unlockKey({ id, salt }) {
    let cred;
    try {
      cred = await credentials.get({
        publicKey: {
          challenge: random(32),
          rpId,
          allowCredentials: [{ type: 'public-key', id }],
          userVerification: 'required',
          timeout: TIMEOUT,
          extensions: { prf: { eval: { first: salt } } },
        },
      });
    } catch (err) {
      throw translate(err);
    }
    if (!cred || !same(bytes(cred.rawId), id)) throw new InfiniteError('wrong-key');
    const auth = bytes(cred.response?.authenticatorData);
    const site = new Uint8Array(await subtle.digest('SHA-256', enc.encode(rpId)));
    if (auth.length < 37 || !same(auth.slice(0, 32), site)) throw new InfiniteError('wrong-site');
    if ((auth[32] & (FLAG_UP | FLAG_UV)) !== (FLAG_UP | FLAG_UV)) throw new InfiniteError('not-verified');
    const first = cred.getClientExtensionResults?.()?.prf?.results?.first;
    const secret = bytes(first);
    if (secret.length !== 32) throw new InfiniteError('unsupported');
    try {
      const base = await subtle.importKey('raw', secret, 'HKDF', false, ['deriveKey']);
      return await subtle.deriveKey(
        { name: 'HKDF', hash: 'SHA-256', salt, info: enc.encode(`${INFO}/key`) },
        base,
        { name: 'AES-GCM', length: 256 },
        false,
        ['encrypt', 'decrypt'],
      );
    } finally {
      secret.fill(0);
    }
  }

  /** Chiffre identifiant et mot de passe ; rend la copie à garder (sans rien en clair). */
  async function seal(key, { id, salt }, { username, password }) {
    const u = enc.encode(String(username ?? ''));
    const p = enc.encode(String(password ?? ''));
    if (!u.length || !p.length || u.length > MAX_FIELD || p.length > MAX_FIELD) throw new InfiniteError('invalid');
    // Octets plutôt que JSON : pas de copie du mot de passe dans une chaîne de plus.
    const plain = new Uint8Array(2 + u.length + p.length);
    plain[0] = u.length >> 8;
    plain[1] = u.length & 255;
    plain.set(u, 2);
    plain.set(p, 2 + u.length);
    const iv = random(12);
    try {
      const ct = new Uint8Array(await subtle.encrypt({ name: 'AES-GCM', iv, additionalData: aad(id) }, key, plain));
      const t = now();
      return { v: VERSION, id: b64u(id), salt: b64u(salt), iv: b64u(iv), ct: b64u(ct), since: t, last: t };
    } finally {
      plain.fill(0);
      p.fill(0);
    }
  }

  /** Relit une copie gardée : format strict, sinon « damaged » (à effacer). */
  function parse(blob) {
    const ok =
      blob &&
      blob.v === VERSION &&
      Number.isFinite(blob.since) &&
      Number.isFinite(blob.last) &&
      ['id', 'salt', 'iv', 'ct'].every((k) => typeof blob[k] === 'string' && blob[k].length <= 4096);
    if (!ok) throw new InfiniteError('damaged');
    const out = { id: unb64u(blob.id), salt: unb64u(blob.salt), iv: unb64u(blob.iv), ct: unb64u(blob.ct), since: blob.since, last: blob.last };
    if (out.id.length < 16 || out.id.length > 1023 || out.salt.length !== 32 || out.iv.length !== 12 || out.ct.length < 19) throw new InfiniteError('damaged');
    return out;
  }

  const expired = (blob) => now() - blob.last > MAX_IDLE_MS || blob.last > now() + 86_400_000;

  /** Déchiffre : rend { username, password }. Toute anomalie → erreur (la copie est à effacer). */
  async function open(key, blob) {
    const b = parse(blob);
    if (expired(b)) throw new InfiniteError('expired');
    let plain;
    try {
      plain = new Uint8Array(await subtle.decrypt({ name: 'AES-GCM', iv: b.iv, additionalData: aad(b.id) }, key, b.ct));
    } catch {
      throw new InfiniteError('damaged');
    }
    try {
      const n = (plain[0] << 8) | plain[1];
      if (plain.length < 2 + n + 1 || n < 1) throw new InfiniteError('damaged');
      return { username: dec.decode(plain.subarray(2, 2 + n)), password: dec.decode(plain.subarray(2 + n)) };
    } finally {
      plain.fill(0);
    }
  }

  /** Déverrouillage complet : passkey → clé → identifiants. */
  async function unlock(blob) {
    const b = parse(blob);
    if (expired(b)) throw new InfiniteError('expired');
    const key = await unlockKey(b);
    return open(key, blob);
  }

  /** Demande à l'appareil d'oublier la passkey (API « Signal », si le navigateur la connaît). */
  function forget(id) {
    try {
      const signal = globalThis.PublicKeyCredential?.signalUnknownCredential;
      if (signal && id?.length) signal.call(globalThis.PublicKeyCredential, { rpId, credentialId: b64u(id) }).catch(() => {});
    } catch {}
  }

  return { createKey, unlockKey, seal, open, unlock, parse, expired, forget, idOf: (blob) => parse(blob).id };
}
