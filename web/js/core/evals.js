// Évaluations marquées à la main par l'étudiant sur une séance de son emploi du temps.
// Repère purement personnel : gardé sur cet appareil seulement, jamais envoyé nulle part.

import { prefs } from './store.js';
import * as D from './dates.js';

const KEY = 'evals';
const MAX = 400;

function load() {
  const v = prefs.get(KEY, {});
  return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
}

export const isEval = (ev) => Boolean(ev?.uid && load()[ev.uid]);

/** Bascule le repère ; renvoie le nouvel état. Les repères de plus d'un an sont oubliés. */
export function toggleEval(ev) {
  const all = load();
  const on = !all[ev.uid];
  if (on) all[ev.uid] = ev.day;
  else delete all[ev.uid];
  const limit = D.addDays(D.todayKey(), -365);
  const kept = Object.entries(all)
    .filter(([, day]) => typeof day === 'string' && day >= limit)
    .sort((a, b) => (a[1] < b[1] ? 1 : -1))
    .slice(0, MAX);
  prefs.set(KEY, Object.fromEntries(kept));
  return on;
}
