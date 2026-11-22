// Rendus Moodle partagés entre la tuile « Prochains rendus » (qui les lit) et l'emploi du temps
// (qui les signale sur les jours concernés). En mémoire seulement : la liste vient de la tuile, déjà
// sans les rendus masqués ni les retards de plus d'une semaine.

import * as D from './dates.js';

let list = [];
const changeListeners = new Set();
const openListeners = new Set();

export function setRendus(items) {
  list = Array.isArray(items) ? items : [];
  changeListeners.forEach((fn) => fn());
}
export const onRendus = (fn) => changeListeners.add(fn);
/** Tous les rendus connus (déjà sans les masqués ni les vieux retards). */
export const rendusList = () => list;

/** Rendus d'un jour (« AAAA-MM-JJ ») : { open, done, items }. */
export function rendusOn(day) {
  const items = list.filter((i) => D.dayKey(new Date(i.at)) === day);
  const done = items.filter((i) => i.status === 'done').length;
  return { open: items.length - done, done, items };
}

/** Rendus d'une semaine (lundi → dimanche). */
export function rendusWeek(monday) {
  const out = { open: 0, done: 0, items: [] };
  for (let i = 0; i < 7; i++) {
    const r = rendusOn(D.addDays(monday, i));
    out.open += r.open;
    out.done += r.done;
    out.items.push(...r.items);
  }
  return out;
}

/** Demande à la tuile de montrer les rendus d'un jour (ou d'une semaine, `days` = 7). */
export const openRendus = (day, days = 1) => openListeners.forEach((fn) => fn(day, days));
export const onOpenRendus = (fn) => openListeners.add(fn);
