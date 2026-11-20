// Coffre de l'appareil : la session (cookies des portails) et le cache (cours Moodle, notes) sont
// gardés CHIFFRÉS.
//
// La clé AES-GCM 256 bits est créée par le navigateur avec `extractable: false` et rangée dans
// IndexedDB : aucun script, pas même celui de cette page, ne peut en lire la valeur ; il peut
// seulement demander au navigateur de chiffrer ou déchiffrer avec. Une copie de localStorage ou de
// sessionStorage seule (sauvegarde, outil qui ne lit que ce stockage) ne donne que des octets
// illisibles. Limite : la clé reste dans le profil du navigateur ; un logiciel ou une extension qui
// accède à tout le profil (IndexedDB compris) ou à la page elle-même peut aussi déchiffrer.
//
// Une connexion range la session dans localStorage : l'étudiant reste connecté sur l'appareil
// jusqu'à la fin de sa session universitaire (fixée par le CAS) ou « Se déconnecter », qui efface
// tout. Une session ouverte avant (case « Rester connecté » décochée) reste dans sessionStorage
// jusqu'à la fermeture de l'onglet. Le mot de passe, lui, n'est jamais stocké nulle part.

export const SESSION_KEY = 'hub.session';
export const CACHE_KEY = 'hub.cache';
export const MAILPREFS_KEY = 'hub.mailprefs'; // ancien emplacement des règles (repris une fois)
export const USERDATA_KEY = 'hub.userdata';
export const SYNC_KEY = 'hub.sync';
const SEALED = [SESSION_KEY, CACHE_KEY];
const DB = 'isis-hub';
const STORE = 'keys';

const storages = () => {
  const get = (name) => {
    try {
      return window[name];
    } catch {
      return null;
    }
  };
  return { tab: get('sessionStorage'), device: get('localStorage') };
};

function idb(mode, fn) {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open(DB, 1);
    open.onupgradeneeded = () => open.result.createObjectStore(STORE);
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result;
      const tx = db.transaction(STORE, mode);
      const req = fn(tx.objectStore(STORE));
      tx.oncomplete = () => {
        db.close();
        resolve(req?.result);
      };
      tx.onerror = () => {
        db.close();
        reject(tx.error);
      };
    };
  });
}

async function deviceKey() {
  let key = await idb('readonly', (s) => s.get('session'));
  if (!key) {
    key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
    await idb('readwrite', (s) => s.put(key, 'session'));
  }
  return key;
}

function b64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
const unb64 = (text) => Uint8Array.from(atob(text), (c) => c.charCodeAt(0));

/** Ouvre le coffre. Sans IndexedDB ou WebCrypto, tout reste seulement en mémoire. */
export async function openVault() {
  const { tab, device } = storages();
  let key = null;
  try {
    key = await deviceKey();
  } catch {
    key = null;
  }
  let where = device?.getItem(SESSION_KEY) ? device : tab;
  let pending = Promise.resolve();

  async function read(name, store = where) {
    const raw = store?.getItem(name);
    if (!key || !raw) return null;
    try {
      const data = unb64(raw);
      const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: data.slice(0, 12) }, key, data.slice(12));
      return JSON.parse(new TextDecoder().decode(plain));
    } catch {
      store?.removeItem(name); // clé changée ou donnée abîmée : on repart de zéro
      return null;
    }
  }

  function write(name, value, store) {
    // Les écritures sont mises en file pour garder l'ordre (chiffrement asynchrone).
    pending = pending.then(async () => {
      const where_ = store ?? where;
      try {
        if (value === null) return where_?.removeItem(name);
        if (!key) return;
        const iv = crypto.getRandomValues(new Uint8Array(12));
        const data = new TextEncoder().encode(JSON.stringify(value));
        const sealed = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, data));
        const out = new Uint8Array(12 + sealed.length);
        out.set(iv);
        out.set(sealed, 12);
        where_?.setItem(name, b64(out));
      } catch {
        // stockage plein ou refusé : la donnée reste en mémoire
      }
    });
    return pending;
  }

  return {
    available: Boolean(key),
    /** Où est la session : 'device', 'tab' ou 'memory'. */
    get place() {
      return !key ? 'memory' : where === device ? 'device' : 'tab';
    },
    load: async () => (await read(SESSION_KEY)) ?? [],
    save: (cookies) => write(SESSION_KEY, cookies.length ? cookies : null),
    loadCache: async () => (await read(CACHE_KEY)) ?? {},
    saveCache: (entries) => write(CACHE_KEY, Object.keys(entries).length ? entries : null),
    // Étiquettes et règles des mails : sur l'appareil, chiffrées, gardées quand la session
    // universitaire expire ; effacées par « Se déconnecter ».
    loadMailPrefs: async () => (await read(MAILPREFS_KEY, device)) ?? null,
    forgetMailPrefs: () => {
      try {
        device?.removeItem(MAILPREFS_KEY);
      } catch {}
    },
    // Données personnelles (notes, examens marqués, règles de mails) : sur l'appareil, chiffrées.
    loadUserData: async () => (await read(USERDATA_KEY, device)) ?? null,
    saveUserData: (data) => write(USERDATA_KEY, data, device),
    // Secret de la sauvegarde anonyme, dérivé à la connexion : rangé comme la session, mais gardé
    // quand la session universitaire expire.
    loadSync: async () => {
      const v = (await read(SYNC_KEY, device)) ?? (await read(SYNC_KEY, tab));
      return Array.isArray(v) && v.length === 96 ? Uint8Array.from(v) : null;
    },
    saveSync: (bits) => {
      try {
        (where === device ? tab : device)?.removeItem(SYNC_KEY);
      } catch {}
      return write(SYNC_KEY, Array.from(bits));
    },
    forgetSync: () => {
      try {
        tab?.removeItem(SYNC_KEY);
        device?.removeItem(SYNC_KEY);
      } catch {}
    },

    /** À la connexion : la session va sur l'appareil (l'ancien emplacement est effacé). */
    keepOnDevice() {
      const next = device ?? tab;
      if (next !== where) {
        try {
          for (const name of SEALED) where?.removeItem(name);
        } catch {}
        where = next;
      }
    },

    clear() {
      try {
        for (const name of SEALED) {
          tab?.removeItem(name);
          device?.removeItem(name);
        }
      } catch {}
    },
  };
}
