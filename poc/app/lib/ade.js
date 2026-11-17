import { HOSTS, ADE } from './config.js';
import { http } from './http.js';
import { courseCode } from './match.js';

const unescapeText = (s = '') =>
  s.replace(/\\n/gi, '\n').replace(/\\([,;\\])/g, '$1');

const squash = (s) => s.replace(/\s+/g, ' ').trim();

function parseDate(v) {
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?/.exec(v || '');
  if (!m) return null;
  const [, y, mo, d, h = '0', mi = '0', s = '0'] = m;
  return new Date(Date.UTC(+y, +mo - 1, +d, +h, +mi, +s));
}

function toEvent(raw) {
  const start = parseDate(raw.DTSTART);
  const end = parseDate(raw.DTEND);
  if (!start || !end) return null;

  const summary = squash(unescapeText(raw.SUMMARY));
  const code = courseCode(summary);
  const kind = /^(CM|TD|TP)\b/i.exec(summary)?.[1].toUpperCase() ?? null;

  // DESCRIPTION = nom complet du module, remarque, groupes (dont SUMMARY), enseignant, promos concernées.
  let lines = unescapeText(raw.DESCRIPTION)
    .split('\n')
    .map(squash)
    .filter(
      (l) =>
        l &&
        l !== summary &&
        !/^\(Export/i.test(l) &&
        !/^ISIS-FI[AE]\d/i.test(l) &&
        !/^(?:CM|TD|TP)-[AE]\d-\d-\S+$/i.test(l),
    );

  let title = summary.replace(/^(?:CM|TD|TP)-\S+\s+/i, '');
  if (code) {
    const [year, semester, module, index] = code.split('-');
    const startsWith = (line, prefix) => line.toUpperCase().startsWith(`${prefix} `);
    // « ISI-2 Aide à la décision » ou « A3-1-SF-3 Fondamentaux… » : le titre non abrégé.
    const i = lines.findIndex((l) => startsWith(l, `${module}-${index}`) || startsWith(l, code));
    if (i >= 0) title = lines.splice(i, 1)[0].replace(/^\S+\s+/, '');
    // « A5-1-GPD Gestion des processus… » : nom de l'UE parente, gardé comme simple remarque.
    const parent = `${year}-${semester}-${module}`;
    lines = lines.map((l) => (startsWith(l, parent) ? l.slice(parent.length + 1) : l));
  }

  return {
    uid: raw.UID || `${raw.DTSTART}-${summary}`,
    start,
    end,
    summary,
    title,
    code,
    kind,
    exam: lines.some((l) => /^examen/i.test(l)),
    room: squash(unescapeText(raw.LOCATION)).replace(/^ISIS - /, ''),
    notes: lines,
  };
}

export function parseIcal(text) {
  const lines = text.replace(/\r\n?/g, '\n').replace(/\n[ \t]/g, '').split('\n');
  const events = [];
  let cur = null;
  for (const line of lines) {
    if (line === 'BEGIN:VEVENT') cur = {};
    else if (line === 'END:VEVENT') {
      const ev = cur && toEvent(cur);
      if (ev) events.push(ev);
      cur = null;
    } else if (cur) {
      const i = line.indexOf(':');
      if (i > 0) cur[line.slice(0, i).split(';')[0]] = line.slice(i + 1);
    }
  }
  return events.sort((a, b) => a.start - b.start || a.end - b.end);
}

/** Export iCal anonyme d'ADE. `first` et `last` sont des dates civiles « AAAA-MM-JJ ». */
export async function fetchSchedule(promo, first, last) {
  const resources = ADE.promos[promo];
  if (!resources) throw new Error(`Promo inconnue : ${promo}`);
  const url =
    `${HOSTS.ade}/jsp/custom/modules/plannings/anonymous_cal.jsp` +
    `?resources=${resources.join(',')}&projectId=${ADE.projectId}&calType=ical` +
    `&firstDate=${first}&lastDate=${last}`;
  const res = await http(url);
  const text = await res.text();
  if (!res.ok || !text.startsWith('BEGIN:VCALENDAR')) {
    throw new Error(`ADE a répondu de façon inattendue (HTTP ${res.status})`);
  }
  return parseIcal(text);
}
