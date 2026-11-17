// Examens marqués à la main par l'étudiant sur une séance de son emploi du temps.
// Gardés dans ses données personnelles (core/userdata.js) : chiffrés sur l'appareil et dans la
// sauvegarde anonyme, jamais lisibles par le serveur.

import * as UD from './userdata.js';
import * as D from './dates.js';

const MAX = 400;

function load() {
  const v = UD.get('evals');
  return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
}

export const isEval = (ev) => Boolean(ev?.uid && load()[ev.uid]);

/** Bascule le repère ; renvoie le nouvel état. Les repères de plus d'un an sont oubliés. */
export function toggleEval(ev) {
  const all = { ...load() };
  const on = !all[ev.uid];
  if (on) all[ev.uid] = ev.day;
  else delete all[ev.uid];
  const limit = D.addDays(D.todayKey(), -365);
  const kept = Object.entries(all)
    .filter(([k, day]) => typeof k === 'string' && k.length <= 200 && typeof day === 'string' && day >= limit)
    .sort((a, b) => (a[1] < b[1] ? 1 : -1))
    .slice(0, MAX);
  UD.set('evals', Object.fromEntries(kept));
  return on;
}
