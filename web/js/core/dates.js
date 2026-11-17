// Dates civiles à l'heure de Paris, quel que soit le fuseau de l'appareil.
// Un jour est représenté par sa clé « AAAA-MM-JJ » ; l'arithmétique se fait en UTC sur ces clés.

export const TZ = 'Europe/Paris';

const partsFmt = new Intl.DateTimeFormat('en-CA', {
  timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});

/** { key: 'AAAA-MM-JJ', minutes: minutes depuis minuit } à Paris. */
export function paris(date) {
  const p = Object.fromEntries(partsFmt.formatToParts(date).map((x) => [x.type, x.value]));
  return { key: `${p.year}-${p.month}-${p.day}`, minutes: Number(p.hour) * 60 + Number(p.minute) };
}

export const dayKey = (date) => paris(date).key;
export const todayKey = () => dayKey(new Date());

const utc = (key) => {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
};
const keyOf = (u) => u.toISOString().slice(0, 10);

export const addDays = (key, n) => {
  const u = utc(key);
  u.setUTCDate(u.getUTCDate() + n);
  return keyOf(u);
};
/** 0 = lundi … 6 = dimanche. */
export const weekday = (key) => (utc(key).getUTCDay() + 6) % 7;
export const mondayOf = (key) => addDays(key, -weekday(key));
export const daysBetween = (a, b) => Math.round((utc(b) - utc(a)) / 864e5);

export function isoWeek(key) {
  const thursday = utc(addDays(mondayOf(key), 3));
  const jan1 = Date.UTC(thursday.getUTCFullYear(), 0, 1);
  return Math.floor((thursday - jan1) / 864e5 / 7) + 1;
}

export const DAYS = ['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche'];
export const MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
export const MONTHS_SHORT = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

const ymd = (key) => key.split('-').map(Number);
export const dayNumber = (key) => ymd(key)[2];
/** « Lundi 16 novembre » */
export const dayTitle = (key) => `${cap(DAYS[weekday(key)])} ${dayNumber(key)} ${MONTHS[ymd(key)[1] - 1]}`;
/** « jeudi 26 nov. » */
export const dayShort = (key) => `${DAYS[weekday(key)]} ${dayNumber(key)} ${MONTHS_SHORT[ymd(key)[1] - 1]}`;
/** « 16 – 20 novembre 2026 » ou « 30 nov. – 4 déc. 2026 » */
export function weekRange(monday) {
  const friday = addDays(monday, 4);
  const [y1, m1, d1] = ymd(monday);
  const [y2, m2, d2] = ymd(friday);
  if (m1 === m2) return `${d1} – ${d2} ${MONTHS[m2 - 1]} ${y2}`;
  return `${d1} ${MONTHS_SHORT[m1 - 1]}${y1 !== y2 ? ` ${y1}` : ''} – ${d2} ${MONTHS_SHORT[m2 - 1]} ${y2}`;
}

export const hhmm = (minutes) => `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
/** « 8 h 15 », « 14 h » */
export const hourLabel = (minutes) => {
  const m = minutes % 60;
  return `${Math.floor(minutes / 60)} h${m ? ` ${String(m).padStart(2, '0')}` : ''}`;
};

const fullFmt = new Intl.DateTimeFormat('fr-FR', {
  timeZone: TZ, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit',
});
/** « lundi 16 novembre 2026 à 09:14 » */
export const fullDate = (date) => fullFmt.format(date);

/** Heure relative d'un mail : « 18 min », « 2 h », « Hier », « ven. », « 10 nov. », « 3 mars 2025 ». */
export function relative(date, now = new Date()) {
  const diff = (now - date) / 60000;
  const a = paris(date);
  const b = paris(now);
  if (a.key === b.key) {
    if (diff < 1) return 'à l’instant';
    if (diff < 60) return `${Math.floor(diff)} min`;
    return `${Math.floor(diff / 60)} h`;
  }
  const days = daysBetween(a.key, b.key);
  if (days === 1) return 'Hier';
  if (days > 1 && days < 7) return DAYS[weekday(a.key)].slice(0, 3) + '.';
  const [y, m, d] = ymd(a.key);
  return y === ymd(b.key)[0] ? `${d} ${MONTHS_SHORT[m - 1]}` : `${d} ${MONTHS_SHORT[m - 1]} ${y}`;
}

/** « novembre 2026 » : séparateur de mois dans la liste des mails. */
export const monthLabel = (date) => {
  const [y, m] = ymd(dayKey(date));
  return `${MONTHS[m - 1]} ${y}`;
};

/** Durée écoulée depuis `t` : « 2 min », « 1 h » ; avec `long` : « à l’instant », « il y a 2 min ». */
export function ago(t, long = false) {
  const min = Math.floor((Date.now() - t) / 60000);
  const text = min < 1 ? (long ? 'à l’instant' : 'moins d’1 min') : min < 60 ? `${min} min` : `${Math.floor(min / 60)} h`;
  return long && min >= 1 ? `il y a ${text}` : text;
}
