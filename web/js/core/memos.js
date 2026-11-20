// Notes personnelles sur un cours (« ce qu'on a fait, ce qui reste à revoir… »), écrites depuis la
// fiche d'une séance. Rangées dans les données personnelles (core/userdata.js) : chiffrées, dans la
// sauvegarde anonyme, retrouvées sur tous les appareils. Taille bornée pour ne pas charger le serveur.

import * as UD from './userdata.js';
import * as D from './dates.js';

export const MAX_CHARS = 1000; // par cours
const MAX_MEMOS = 150; // au-delà, les plus anciennes notes partent

/** Clé d'un cours : son code ADE, sinon son intitulé (sans accents ni casse). */
export const memoKey = (ev) =>
  (ev.code || ev.title || '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toUpperCase()
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);

const all = () => {
  const v = UD.get('memos');
  return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
};

export const getMemo = (ev) => all()[memoKey(ev)]?.t ?? '';
/** Le cours a-t-il une note (repère 📝 sur ses séances dans l'emploi du temps) ? */
export const hasMemo = (ev) => Boolean(getMemo(ev).trim());

// Prévenus quand un cours gagne ou perd sa note (ici, ou sur un autre appareil).
const listeners = new Set();
export const onMemosChange = (fn) => listeners.add(fn);
UD.onUserData((touched) => touched.includes('memos') && listeners.forEach((fn) => fn()));
export const memoDate = (ev) => all()[memoKey(ev)]?.d ?? '';

/** Enregistre (ou efface si vide) la note d'un cours. */
export function setMemo(ev, text) {
  const k = memoKey(ev);
  if (!k) return;
  const t = String(text ?? '').replace(/\r\n?/g, '\n').slice(0, MAX_CHARS);
  const had = Boolean(all()[k]?.t?.trim());
  const next = { ...all() };
  if (t.trim()) next[k] = { t, d: D.todayKey() };
  else delete next[k];
  const kept = Object.entries(next)
    .filter(([key, m]) => key.length <= 120 && typeof m?.t === 'string')
    .sort((a, b) => String(b[1].d).localeCompare(String(a[1].d)))
    .slice(0, MAX_MEMOS);
  UD.set('memos', Object.fromEntries(kept));
  if (had !== Boolean(t.trim())) listeners.forEach((fn) => fn());
}
