// Cache des réponses des portails, pour ne pas les solliciter plus que nécessaire.
//
// - Une même demande en cours n'est jamais envoyée deux fois (les appels se partagent la réponse).
// - Chaque entrée a une durée de vie : cours suivis 6 h, correspondance d'une matière 7 jours,
//   notes d'une matière 30 min.
// - Le cache est gardé chiffré sur l'appareil (vault.js) et vidé à la déconnexion.

const MAX_ENTRIES = 400;
let entries = {}; // clé → { t: date d'écriture, v: valeur }
const inflight = new Map();
let persist = () => {};
let timer = null;

export function initCache(saved, save) {
  entries = saved && typeof saved === 'object' ? saved : {};
  persist = save;
}

function scheduleSave() {
  clearTimeout(timer);
  timer = setTimeout(() => {
    const keys = Object.keys(entries);
    if (keys.length > MAX_ENTRIES) {
      keys.sort((a, b) => entries[a].t - entries[b].t);
      for (const k of keys.slice(0, keys.length - MAX_ENTRIES)) delete entries[k];
    }
    persist?.(entries); // page /admin : cache en mémoire seulement
  }, 400);
}

/** Valeur en cache si elle a moins de `ttl` ms, sinon appelle `fetcher` (une seule fois à la fois). */
export async function cached(key, ttl, fetcher, { force = false } = {}) {
  const hit = entries[key];
  if (!force && hit && Date.now() - hit.t < ttl) return hit.v;
  if (inflight.has(key)) return inflight.get(key);
  const p = (async () => {
    try {
      const v = await fetcher();
      entries[key] = { t: Date.now(), v };
      scheduleSave();
      return v;
    } finally {
      inflight.delete(key);
    }
  })();
  inflight.set(key, p);
  return p;
}

/** Date de la dernière mise à jour d'une entrée (ou null). */
export const cachedAt = (key) => entries[key]?.t ?? null;

export function forget(prefix = '') {
  for (const k of Object.keys(entries)) if (k.startsWith(prefix)) delete entries[k];
  scheduleSave();
}

export function clearCache() {
  entries = {};
  inflight.clear();
  clearTimeout(timer);
  persist({});
}
