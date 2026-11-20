// Examens marqués à la main par l'étudiant sur une séance de son emploi du temps.
// Gardés dans ses données personnelles (core/userdata.js) : chiffrés sur l'appareil et dans la
// sauvegarde anonyme, jamais lisibles par le serveur.
//
// Examens signalés par la classe (voir internal/feedback/exams.go) : marquer une séance envoie en
// plus un vote anonyme (classe, séance, jour, jeton propre à cette séance). Quand assez de camarades
// ont voté (20 % des membres actifs récemment, 3 au moins), la séance apparaît chez toute la classe
// comme « Examen ? ». Le serveur ne peut pas vérifier les votants : ce n'est qu'un signal, que
// chacun peut masquer. Les repères posés avant cette fonction ne sont pas envoyés.

import * as UD from './userdata.js';
import * as D from './dates.js';

const MAX = 400;
const CLASS_RE = /^[A-Z]{2,5}[0-9]{1,2}$/;
const UID_RE = /^[\x21-\x7E]{1,160}$/; // identifiant ADE : ASCII visible, sans espace
const HIDDEN = '!'; // préfixe des signaux de classe masqués, dans la même section chiffrée

function load() {
  const v = UD.get('evals');
  return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
}

export const isEval = (ev) => Boolean(ev?.uid && load()[ev.uid]);

/** Repères et masques de plus d'un an oubliés ; au plus MAX, les plus récents. */
function save(all) {
  const limit = D.addDays(D.todayKey(), -365);
  const kept = Object.entries(all)
    .filter(([k, day]) => typeof k === 'string' && k.length <= 200 && typeof day === 'string' && day >= limit)
    .sort((a, b) => (a[1] < b[1] ? 1 : -1))
    .slice(0, MAX);
  UD.set('evals', Object.fromEntries(kept));
}

/** Bascule le repère ; renvoie le nouvel état. Le vote de la classe suit (anonyme). */
export function toggleEval(ev, promo) {
  const all = { ...load() };
  const on = !all[ev.uid];
  if (on) all[ev.uid] = ev.day;
  else delete all[ev.uid];
  save(all);
  vote(ev, on, promo);
  return on;
}

// ------------------------------------------------------------ signal de la classe

let signals = new Map(); // uid → { day, votes }
let loadedFor = '';
let loadedAt = 0;
const listeners = new Set();
export const onSignals = (fn) => listeners.add(fn);

/** Signal de la classe pour une séance, ou null (examen d'après ADE, séance déplacée, masqué). */
export function signalOf(ev) {
  if (!ev?.uid || ev.exam) return null;
  const s = signals.get(ev.uid);
  if (!s || s.day !== ev.day) return null; // séance déplacée depuis les votes : plus rien à signaler
  return load()[HIDDEN + ev.uid] ? null : s;
}

/** « Masquer ce signal » : gardé dans la section chiffrée, retrouvé sur tous les appareils. */
export function hideSignal(ev) {
  if (!ev?.uid) return;
  save({ ...load(), [HIDDEN + ev.uid]: ev.day });
  listeners.forEach((fn) => fn());
}

/** Lit les séances signalées de la classe (au plus toutes les 2 minutes, sauf `force`). */
export async function loadSignals(promo, { force = false } = {}) {
  if (!CLASS_RE.test(promo ?? '')) return;
  if (!force && promo === loadedFor && Date.now() - loadedAt < 120_000) return;
  loadedAt = Date.now();
  try {
    const res = await fetch(`api/exams?class=${encodeURIComponent(promo)}`, { credentials: 'omit', cache: 'no-store' });
    if (!res.ok) return;
    const data = await res.json();
    const next = new Map();
    for (const [uid, s] of Object.entries(data?.signals ?? {})) {
      if (UID_RE.test(uid) && Number.isInteger(s?.votes) && /^\d{4}-\d{2}-\d{2}$/.test(s?.day ?? '')) next.set(uid, { day: s.day, votes: s.votes });
    }
    const changed = promo !== loadedFor || JSON.stringify([...next]) !== JSON.stringify([...signals]);
    loadedFor = promo;
    signals = next;
    if (changed) listeners.forEach((fn) => fn());
  } catch {
    // hors ligne : on garde ce qu'on avait
  }
}

/** Vote anonyme d'un étudiant connecté (sinon rien n'est envoyé). */
async function vote(ev, on, promo) {
  if (!CLASS_RE.test(promo ?? '') || !UID_RE.test(ev?.uid ?? '') || !/^\d{4}-\d{2}-\d{2}$/.test(ev?.day ?? '')) return;
  const token = await UD.examToken(ev.uid);
  if (!token) return;
  try {
    const res = await fetch('api/exams/vote', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ class: promo, uid: ev.uid, day: ev.day, token, on }),
      credentials: 'omit',
      keepalive: true,
    });
    if (res.ok && promo === loadedFor) loadSignals(promo, { force: true });
  } catch {
    // le repère personnel reste ; seul le vote est perdu
  }
}

/** « Supprimer mes données » : retire aussi les votes encore utiles (séances à venir). */
export async function withdrawVotes(promo) {
  const limit = D.addDays(D.todayKey(), -2);
  const mine = Object.entries(load()).filter(([k, day]) => !k.startsWith(HIDDEN) && day >= limit);
  await Promise.all(mine.map(([uid, day]) => vote({ uid, day }, false, promo)));
}
