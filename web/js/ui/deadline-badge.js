// Pastille d'une échéance Moodle (« Demain, 23 h 59 », « En retard · 2 j », « Rendu »), sans DOM :
// testable seule.

import * as D from '../core/dates.js';

/** Heure de l’échéance à Paris : « 23 h 59 ». */
export const timeOf = (at) => D.hourLabel(D.paris(new Date(at)).minutes);

/** Ce que dit la pastille de droite, et sa couleur. */
export function badge(item, now = Date.now()) {
  if (item.status === 'done') return { tone: 'done', text: 'Rendu' };
  const today = D.dayKey(new Date(now));
  const day = D.dayKey(new Date(item.at));
  const days = D.daysBetween(today, day);
  if (item.at < now) {
    const late = D.daysBetween(day, today);
    return { tone: 'late', text: late < 1 ? 'En retard' : `En retard · ${late} j` };
  }
  const hours = (item.at - now) / 36e5;
  if (hours < 1) return { tone: 'soon', text: `Dans ${Math.max(1, Math.round(hours * 60))} min` };
  if (days === 0) return { tone: 'soon', text: hours < 6 ? `Dans ${Math.round(hours)} h` : `Aujourd’hui, ${timeOf(item.at)}` };
  if (days === 1) return { tone: 'soon', text: `Demain, ${timeOf(item.at)}` };
  if (days < 7) return { tone: days <= 3 ? 'near' : 'later', text: `Dans ${days} j` };
  return { tone: 'later', text: `Dans ${Math.round(days / 7)} sem.` };
}
