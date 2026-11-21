// Données personnelles créées dans ISIS Hub : notes saisies, examens marqués, étiquettes et règles
// des mails. Rangées par rubrique ({ ts, data }), gardées chiffrées sur l'appareil et, une fois
// connecté, synchronisées dans la sauvegarde anonyme (net/sync.js) : retrouvées sur tous les
// appareils, illisibles et impossibles à relier à quelqu'un côté serveur.
//
// Fusion : chaque rubrique garde la version la plus récente (horodatage de la dernière
// modification). Une rubrique touchée sur deux appareils hors ligne garde la dernière.

import * as sync from '../net/sync.js';

// profile : classe et options (groupe, langue, parcours), pour ne plus les redemander sur un autre appareil.
// memos : notes personnelles sur les cours (fiche d'une séance).
// seen : déjà vu (visite guidée, installation, dernière version présentée), une fois par étudiant.
// feedback : jetons « Mes propositions » (suivi des retours envoyés).
// rendus : échéances Moodle masquées à la main (identifiant de l'événement → jour du masquage).
export const SECTIONS = ['notes', 'evals', 'mail', 'profile', 'memos', 'seen', 'feedback', 'rendus'];

let local = { sections: {} };
let vault = null;
let cred = null;
let visitKey = null; // jetons de fréquentation (net/sync.js)
let examKey = null; // votes anonymes « examen » (net/sync.js)
let remoteV = 0;
let pushTimer = null;
let pushing = null;
let status = 'off'; // 'off' | 'syncing' | 'ok' | 'error'
let pulled = false; // la sauvegarde du serveur a été lue au moins une fois depuis la connexion
const listeners = new Set();
const statusListeners = new Set();

const setStatus = (s) => {
  status = s;
  statusListeners.forEach((fn) => fn(s));
};
export const syncStatus = () => status;
export const onSyncStatus = (fn) => statusListeners.add(fn);
/** Appelé quand une rubrique change depuis un autre appareil (après synchronisation). */
export const onUserData = (fn) => listeners.add(fn);

function sanitizeLocal(raw) {
  const out = { sections: {} };
  for (const k of SECTIONS) {
    const s = raw?.sections?.[k];
    if (s && typeof s === 'object' && Number.isFinite(s.ts)) out.sections[k] = { ts: s.ts, data: s.data ?? null };
  }
  return out;
}

const persist = () => vault?.saveUserData(local);

/** Charge la copie de l'appareil. `migrate` : données anciennes à reprendre si la rubrique est vide. */
export async function initUserData(v, migrate = {}) {
  vault = v;
  local = sanitizeLocal(await v.loadUserData().catch(() => null));
  let changed = false;
  for (const [k, data] of Object.entries(migrate)) {
    if (!local.sections[k] && data !== null && data !== undefined) {
      local.sections[k] = { ts: 1, data }; // ancien : perd face à toute modification récente
      changed = true;
    }
  }
  if (changed) persist();
}

export const get = (section) => local.sections[section]?.data ?? null;

export function set(section, data) {
  local.sections[section] = { ts: Date.now(), data };
  persist();
  schedulePush();
}

// ------------------------------------------------------------ synchronisation

function merge(remote) {
  const touched = [];
  for (const k of SECTIONS) {
    const r = remote?.sections?.[k];
    const l = local.sections[k];
    if (r && Number.isFinite(r.ts) && (!l || r.ts > l.ts)) {
      local.sections[k] = { ts: r.ts, data: r.data ?? null };
      touched.push(k);
    }
  }
  return touched;
}
const needsPush = (remote) => SECTIONS.some((k) => local.sections[k] && (!remote?.sections?.[k] || local.sections[k].ts > remote.sections[k].ts));

function schedulePush() {
  if (!cred) return;
  clearTimeout(pushTimer);
  pushTimer = setTimeout(() => pushNow().catch(() => {}), 1500);
}

async function pushNow() {
  if (!cred) return;
  if (pushing) return pushing;
  pushing = (async () => {
    setStatus('syncing');
    try {
      for (let attempt = 0; attempt < 4; attempt++) {
        const res = await sync.push(cred, remoteV, local);
        if (res.ok) {
          remoteV = res.v;
          setStatus('ok');
          return;
        }
        // Un autre appareil a écrit entre-temps : on fusionne puis on réessaie.
        remoteV = res.v;
        const touched = merge(sanitizeLocal(res.value));
        persist();
        if (touched.length) listeners.forEach((fn) => fn(touched));
      }
      throw new Error('conflits répétés');
    } catch (err) {
      setStatus('error');
      throw err;
    } finally {
      pushing = null;
    }
  })();
  return pushing;
}

/** Branche la sauvegarde avec le secret de l'appareil ; `previous` : ancien secret (mot de passe changé). */
export async function connect(secret, previous = null) {
  cred = await sync.credentials(secret);
  visitKey = await sync.visitKey(secret).catch(() => null);
  examKey = await sync.examKey(secret).catch(() => null);
  setStatus('syncing');
  try {
    let remote = await sync.pull(cred);
    // Mot de passe changé : la sauvegarde de l'ancien secret est reprise puis effacée.
    if (previous) {
      const old = await sync.credentials(previous).catch(() => null);
      if (old && old.id !== cred.id) {
        const prev = await sync.pull(old).catch(() => null);
        if (prev) {
          merge(sanitizeLocal(prev.value));
          await sync.erase(old).catch(() => {});
        }
      }
    }
    remoteV = remote?.v ?? 0;
    const touched = merge(sanitizeLocal(remote?.value));
    pulled = true;
    persist();
    if (touched.length) listeners.forEach((fn) => fn(touched));
    if (!remote || needsPush(sanitizeLocal(remote.value)) || previous) await pushNow();
    else setStatus('ok');
  } catch (err) {
    setStatus('error');
    throw err;
  }
}

/** Relit la sauvegarde (retour sur l'onglet) pour voir ce qu'un autre appareil a changé. */
export async function refresh() {
  if (!cred || pushing) return;
  try {
    const remote = await sync.pull(cred);
    if (!remote || remote.v === remoteV) return;
    remoteV = remote.v;
    const touched = merge(sanitizeLocal(remote.value));
    persist();
    if (touched.length) listeners.forEach((fn) => fn(touched));
    if (needsPush(sanitizeLocal(remote.value))) await pushNow();
  } catch {
    setStatus('error');
  }
}

/** Déconnexion : la copie de l'appareil est effacée ; la sauvegarde reste (chiffrée) sur le serveur. */
export function disconnect({ wipeLocal = true } = {}) {
  clearTimeout(pushTimer);
  cred = null;
  visitKey = null;
  examKey = null;
  remoteV = 0;
  pulled = false;
  setStatus('off');
  if (wipeLocal) {
    local = { sections: {} };
    vault?.saveUserData(null);
    listeners.forEach((fn) => fn([...SECTIONS]));
  }
}

/** « Supprimer mes données » : efface la sauvegarde du serveur et la copie de l'appareil. */
export async function eraseEverywhere() {
  if (cred) await sync.erase(cred);
  disconnect();
}

export const isConnected = () => Boolean(cred);
/** Sauvegarde branchée ET lue : les données affichées sont celles du serveur. */
export const isReady = () => Boolean(cred) && pulled;
/** Identifiant anonyme de la sauvegarde (affiché dans Transparence). */
export const syncId = () => cred?.id ?? null;

/** Jeton de fréquentation du jour (compte connecté seulement), sinon null. */
export const visitToken = async (day) => (cred && visitKey ? sync.visitToken(visitKey, day).catch(() => null) : null);

/** Jeton de vote « examen » pour une séance (compte connecté seulement), sinon null. */
export const examToken = async (uid) => (cred && examKey ? sync.examToken(examKey, uid).catch(() => null) : null);
