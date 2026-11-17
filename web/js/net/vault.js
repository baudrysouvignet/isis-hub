// Coffre de l'appareil : la session (cookies des portails) et le cache (cours Moodle, notes) sont
// gardés CHIFFRÉS.
//
// La clé AES-GCM 256 bits est créée par le navigateur avec `extractable: false` et rangée dans
// IndexedDB : aucun script, pas même celui de cette page, ne peut en lire la valeur ; il peut
// seulement demander au navigateur de chiffrer ou déchiffrer avec. Une copie du stockage (sauvegarde,
// extension de navigateur qui lit localStorage, accès au disque) ne donne que des octets illisibles.
//
// Par défaut tout est dans sessionStorage (effacé à la fermeture de l'onglet) ; avec « Rester
// connecté », dans localStorage. Le mot de passe, lui, n'est jamais stocké nulle part.

export const SESSION_KEY = 'hub.session';
export const CACHE_KEY = 'hub.cache';
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

  async function read(name) {
    const raw = where?.getItem(name);
    if (!key || !raw) return null;
    try {
      const data = unb64(raw);
      const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: data.slice(0, 12) }, key, data.slice(12));
      return JSON.parse(new TextDecoder().decode(plain));
    } catch {
      where?.removeItem(name); // clé changée ou donnée abîmée : on repart de zéro
      return null;
    }
  }

  function write(name, value) {
    // Les écritures sont mises en file pour garder l'ordre (chiffrement asynchrone).
    pending = pending.then(async () => {
      try {
        if (value === null) return where?.removeItem(name);
        if (!key) return;
        const iv = crypto.getRandomValues(new Uint8Array(12));
        const data = new TextEncoder().encode(JSON.stringify(value));
        const sealed = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, data));
        const out = new Uint8Array(12 + sealed.length);
        out.set(iv);
        out.set(sealed, 12);
        where?.setItem(name, b64(out));
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

    /** Change d'emplacement (case « Rester connecté »), en effaçant l'ancien. */
    choose(remember) {
      const next = remember && device ? device : tab;
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
