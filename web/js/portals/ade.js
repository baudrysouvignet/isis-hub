// Emploi du temps : export iCal anonyme d'ADE (aucune connexion nécessaire).

import { HOSTS } from './config.js';
import { classOf, projectId, keep } from './classes.js';
import { http } from '../net/http.js';
import { paris, hhmm } from '../core/dates.js';

/** Code de module d'ADE : « TD-A4-1-ISI-2 … » → « A4-1-ISI-2 ». */
const CODE_RE = /(?<![A-Z0-9])(?:FI)?([AE]\d)-(\d)-([A-Z]{2,8})-(\d{1,2})(?!\d)/i;
export function courseCode(text = '') {
  const m = CODE_RE.exec(text);
  return m ? `${m[1]}-${m[2]}-${m[3]}-${m[4]}`.toUpperCase() : null;
}

const unescapeText = (s = '') => s.replace(/\\n/gi, '\n').replace(/\\([,;\\])/g, '$1');
const squash = (s) => s.replace(/\s+/g, ' ').trim();

function parseDate(v) {
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?/.exec(v || '');
  if (!m) return null;
  const [, y, mo, d, h = '0', mi = '0', s = '0'] = m;
  return new Date(Date.UTC(+y, +mo - 1, +d, +h, +mi, +s));
}

const PROMO_RE = /^ISIS-(FI[AE]\d)/i;
// « WARTELLE Adrien », « MEGDICHE BOUSARSAR Imen » : NOM(S) en capitales puis prénom.
const TEACHER_RE = /^([A-ZÀ-ÖØ-Þ][A-ZÀ-ÖØ-Þ'’-]+(?: [A-ZÀ-ÖØ-Þ][A-ZÀ-ÖØ-Þ'’-]+)*) ([A-ZÀ-ÖØ-Þ][a-zà-öø-ÿ'’-]+(?:[ -][A-ZÀ-ÖØ-Þ]?[a-zà-öø-ÿ'’-]+)*)$/;

// « Sylvain PLACE » : prénom puis NOM en capitales.
const FIRST_LAST_RE = /^([A-ZÀ-ÖØ-Þ][a-zà-öø-ÿ'’-]+(?:[ -][A-ZÀ-ÖØ-Þ][a-zà-öø-ÿ'’-]+)?) ([A-ZÀ-ÖØ-Þ]{2}[A-ZÀ-ÖØ-Þ'’-]*(?: [A-ZÀ-ÖØ-Þ]{2}[A-ZÀ-ÖØ-Þ'’-]*)*)$/;

/** « WARTELLE Adrien » → « A. Wartelle » */
function shortName(last, first) {
  const nice = last.toLowerCase().replace(/(^|[\s'’-])(\p{L})/gu, (_, sep, c) => sep + c.toUpperCase());
  return `${first.charAt(0)}. ${nice}`;
}

// Mots qui ressemblent à « Prénom NOM » sans en être (« Présence OBLIGATOIRE »).
const NOT_NAMES = /^(présence|presence|cours|offert|parking|examen|salle|rendez|réunion|reunion)\b/i;

/** Nom d'enseignant reconnu dans une ligne, mis en forme « A. Nom » ; null sinon. */
function personName(line) {
  if (NOT_NAMES.test(line)) return null;
  const t = TEACHER_RE.exec(line);
  if (t) return shortName(t[1], t[2]);
  const f = FIRST_LAST_RE.exec(line);
  if (f) return shortName(f[2], f[1]);
  const i = /^([A-ZÀ-Þ])\.\s*([A-ZÀ-Þa-zà-ÿ'’-]{2,})$/.exec(line); // « A.PAREDES »
  if (i) return shortName(i[2].toUpperCase(), i[1]);
  const fl = /^([A-ZÀ-Þ][a-zà-ÿ'’-]+) ([A-ZÀ-Þ][a-zà-ÿ'’-]+)$/.exec(line); // « Sylvain Place »
  if (fl) return shortName(fl[2].toUpperCase(), fl[1]);
  return null;
}

function toEvent(raw) {
  const start = parseDate(raw.DTSTART);
  const end = parseDate(raw.DTEND);
  if (!start || !end) return null;

  const summary = squash(unescapeText(raw.SUMMARY));
  const code = courseCode(summary);
  const kind = /^(CM|TD|TP)\b/i.exec(summary)?.[1].toUpperCase() ?? null;

  // DESCRIPTION : intitulé complet du module, remarque (« Examen », « Intervenant : … »),
  // rappel du SUMMARY ou de la promo, enseignant, date d'export.
  const lines = unescapeText(raw.DESCRIPTION).split('\n').map(squash).filter(Boolean);
  let title = summary.replace(/^(?:CM|TD|TP)-\S+\s+/i, '');
  let teacher = '';
  const groups = new Set();
  const notes = [];
  let exam = false;

  for (const line of lines) {
    if (/^\(Export/i.test(line) || squash(line) === summary) continue;
    const promo = PROMO_RE.exec(line);
    if (promo) {
      groups.add(promo[1].toUpperCase());
      continue;
    }
    if (/^(CM|TD|TP)-[AE]\d-\d-\S+/i.test(line)) continue; // rappel du code
    if (/^examen/i.test(line)) {
      exam = true;
      continue;
    }
    const intervenant = /^intervenante?s?\s*:\s*(.+?)(?:\s+-\s+\S+)?$/i.exec(line);
    if (intervenant) {
      teacher ||= personName(intervenant[1]) ?? intervenant[1];
      continue;
    }
    if (code) {
      const [year, semester, module, index] = code.split('-');
      const upper = line.toUpperCase();
      // « ISI-2 Aide à la décision » ou « A4-1-ISI-2 … » : le titre non abrégé.
      if (upper.startsWith(`${module}-${index} `) || upper.startsWith(`${code} `)) {
        title = line.replace(/^\S+\s+/, '');
        continue;
      }
      // « A5-1-GPD Gestion des processus… » : nom de l'UE parente, simple remarque.
      if (upper.startsWith(`${year}-${semester}-${module} `)) {
        notes.push(line.slice(`${year}-${semester}-${module} `.length));
        continue;
      }
    }
    const who = personName(line);
    if (who && !teacher) {
      teacher = who;
      continue;
    }
    if (/^(?:G|GR|GROUPE)\s?\d+$/i.test(line)) {
      groups.add(line.toUpperCase().replace(/^GROUPE\s?/, 'G'));
      continue;
    }
    notes.push(line);
  }

  const a = paris(start);
  const b = paris(end);
  return {
    uid: raw.UID || `${raw.DTSTART}-${summary}`,
    // Champs bruts, tels que les règles de filtrage par groupe et parcours les attendent.
    rawSummary: fieldValue(raw.SUMMARY),
    rawDescription: fieldValue(raw.DESCRIPTION),
    day: a.key,
    startMin: a.minutes,
    endMin: b.key === a.key ? b.minutes : 24 * 60,
    start,
    end,
    summary,
    title,
    code,
    kind,
    exam,
    room: squash(unescapeText(raw.LOCATION)).replace(/^ISIS\s*-\s*/i, '').replace(/\s*,\s*ISIS\s*-\s*/gi, ', '),
    teacher,
    groups: [...groups],
    notes,
    get time() {
      return `${hhmm(this.startMin)} – ${hhmm(this.endMin)}`;
    },
  };
}

/** Valeur d'un champ iCalendar déséchappée (\\n, \\, \\; \\\\), comme le projet de référence. */
const fieldValue = (v) => (v ?? '').replace(/\\([nN,;\\])/g, (_, x) => (x.toLowerCase() === 'n' ? '\n' : x));

export function parseIcal(text) {
  const lines = text.replace(/\r\n?/g, '\n').replace(/\n[ \t]/g, '').split('\n');
  const events = [];
  const seen = new Set();
  let cur = null;
  let depth = 0; // les alarmes (VALARM) imbriquées ne doivent pas écraser les champs de la séance
  for (const line of lines) {
    if (line === 'BEGIN:VEVENT') {
      cur = {};
      depth = 1;
    } else if (line === 'END:VEVENT') {
      const ev = cur && toEvent(cur);
      if (ev && !seen.has(ev.uid)) {
        seen.add(ev.uid); // un même identifiant n'apparaît qu'une fois
        events.push(ev);
      }
      cur = null;
      depth = 0;
    } else if (cur && line.startsWith('BEGIN:')) depth++;
    else if (cur && line.startsWith('END:')) depth--;
    else if (cur && depth === 1) {
      const i = line.indexOf(':');
      if (i > 0) cur[line.slice(0, i).split(';')[0].toUpperCase()] = line.slice(i + 1);
    }
  }
  return events.sort((a, b) => a.start - b.start || a.end - b.end);
}

const calendarUrl = (promo, query) =>
  `${HOSTS.ade}/jsp/custom/modules/plannings/anonymous_cal.jsp` +
  `?resources=${classOf(promo).resources.join(',')}&projectId=${projectId()}&calType=ical&${query}`;

/** Abonnement d'agenda (lien public d'ADE, lu directement par l'agenda, sans ISIS Hub). */
export const subscriptionUrl = (promo) => calendarUrl(promo, 'nbWeeks=40');

/**
 * Cours d'une classe entre deux jours civils « AAAA-MM-JJ » inclus, filtrés selon les choix de
 * l'étudiant (groupe, langue, parcours).
 */
export async function fetchSchedule(promo, first, last, choice = {}) {
  if (!classOf(promo)) throw new Error(`Classe inconnue : ${promo}`);
  const res = await http(calendarUrl(promo, `firstDate=${first}&lastDate=${last}`));
  const text = await res.text();
  if (!res.ok || !text.startsWith('BEGIN:VCALENDAR')) {
    throw new Error(`ADE a répondu de façon inattendue (HTTP ${res.status})`);
  }
  return parseIcal(text).filter((ev) => keep(promo, choice, ev));
}
