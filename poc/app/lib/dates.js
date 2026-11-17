import { TIMEZONE } from './config.js';

// Les jours sont manipulés sous forme de clés civiles « AAAA-MM-JJ » (heure de Paris),
// ce qui évite tout décalage si le navigateur est réglé sur un autre fuseau.
const keyFmt = new Intl.DateTimeFormat('en-CA', {
  timeZone: TIMEZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});
const timeFmt = new Intl.DateTimeFormat('fr-FR', { timeZone: TIMEZONE, hour: '2-digit', minute: '2-digit' });

const civil = (key) => new Date(`${key}T12:00:00Z`);
const civilFmt = (options) => {
  const fmt = new Intl.DateTimeFormat('fr-FR', { timeZone: 'UTC', ...options });
  return (key) => fmt.format(civil(key));
};

export const dayKey = (date) => keyFmt.format(date);
export const today = () => dayKey(new Date());
export const time = (date) => timeFmt.format(date);

export function addDays(key, n) {
  const d = civil(key);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export const mondayOf = (key) => addDays(key, -((civil(key).getUTCDay() + 6) % 7));

export function isoWeek(key) {
  const d = civil(key);
  d.setUTCDate(d.getUTCDate() + 3 - ((d.getUTCDay() + 6) % 7)); // jeudi de la semaine
  const dayOfYear = (d - Date.UTC(d.getUTCFullYear(), 0, 1, 12)) / 864e5;
  return Math.floor(dayOfYear / 7) + 1;
}

export const weekdayShort = civilFmt({ weekday: 'short' });
export const dayNumber = civilFmt({ day: 'numeric' });
export const dayMonth = civilFmt({ day: 'numeric', month: 'short' });
export const dayLong = civilFmt({ weekday: 'long', day: 'numeric', month: 'long' });

export function weekLabel(monday) {
  const sunday = addDays(monday, 6);
  const sameMonth = monday.slice(0, 7) === sunday.slice(0, 7);
  const from = sameMonth ? dayNumber(monday) : dayMonth(monday);
  return `Semaine du ${from} au ${civilFmt({ day: 'numeric', month: 'long' })(sunday)}`;
}

/** « 14:32 » aujourd'hui, « hier », sinon « 12 nov. ». */
export function relativeDay(date) {
  const key = dayKey(date);
  const now = today();
  if (key === now) return time(date);
  if (key === addDays(now, -1)) return 'hier';
  return dayMonth(key);
}

/** « dans 25 min », « dans 3 h », ou le jour et l'heure si c'est plus loin. */
export function untilLabel(date, now = new Date()) {
  const minutes = Math.round((date - now) / 60000);
  if (minutes < 60) return `dans ${Math.max(minutes, 1)} min`;
  const key = dayKey(date);
  if (key === dayKey(now)) return `à ${time(date)}`;
  if (key === addDays(dayKey(now), 1)) return `demain à ${time(date)}`;
  return `${dayLong(key)} à ${time(date)}`;
}
