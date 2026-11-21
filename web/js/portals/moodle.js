// Moodle : la session s'ouvre par le bouton CAS officiel de Moodle (SSO), puis on lit la clé
// `sesskey` dans /my/ et on appelle l'API AJAX, exactement comme le fait le site de Moodle.

import { HOSTS, PortalDown, notSignedInOrDown } from './config.js';
import { http } from '../net/http.js';
import { casSessionAlive } from './cas.js';

// « Session expirée » seulement si le CAS le confirme ; sinon Moodle est en panne (voir config.js).
const lost = (detail) => notSignedInOrDown('Moodle', detail, casSessionAlive);
import { cached } from '../net/cache.js';
import { parse } from './sanitize.js';

const HOUR = 3600e3;

let session = null; // { sesskey, userId }, en mémoire seulement

// Change à chaque reset : une ouverture de session lancée avant ne remplace plus rien.
let epoch = 0;

export const reset = () => {
  epoch++;
  session = null;
};

const page = async (path) => (await http(HOSTS.moodle + path)).text();

function readSession(html) {
  const sesskey = /"sesskey":"([^"]+)"/.exec(html)?.[1];
  const userId = Number(/"userId":(\d+)/.exec(html)?.[1] ?? 0);
  return sesskey && userId > 1 ? { sesskey, userId } : null; // 0 = anonyme, 1 = invité
}

// Connexions Moodle ouvertes par ISIS Hub : Moodle envoie alors une alerte « Nouvelle connexion »
// par mail (voir core/loginalerts.js). L'instant est pris AVANT la demande.
const loginListeners = new Set();
export const onLogin = (fn) => loginListeners.add(fn);
const loggedIn = (at) => loginListeners.forEach((fn) => {
  try {
    fn(at);
  } catch {}
});

// Une seule ouverture de session à la fois : les tuiles Moodle et Rendus démarrent ensemble, et deux
// passages par le CAS donneraient deux alertes « Nouvelle connexion ».
let connecting = null;
export function connect() {
  connecting ??= openSession().finally(() => (connecting = null));
  return connecting;
}

async function openSession() {
  const at = Date.now();
  const mine = epoch;
  const first = await http(`${HOSTS.moodle}/my/`);
  if (first.status >= 500) throw new PortalDown('Moodle', `HTTP ${first.status}`); // maintenance, panne
  let found = readSession(await first.text());
  if (found && first.redirected) loggedIn(at); // Moodle est passé par le CAS : c'est une connexion
  if (!found) {
    const afterSso = await page('/login/index.php?authCAS=CAS').catch(() => '');
    found = readSession(afterSso) || readSession(await page('/my/'));
    if (found) loggedIn(at);
  }
  if (!found) throw await lost('');
  if (mine === epoch) session = found; // ouverte avant une déconnexion : ne remplace rien
  return found;
}

async function call(methodname, args, retry = true) {
  if (!session) await connect();
  // Demande partie avant une déconnexion : elle s'arrête là, sans déclarer la session perdue.
  if (!session) throw new Error('session Moodle renouvelée entre-temps');
  const res = await http(`${HOSTS.moodle}/lib/ajax/service.php?sesskey=${session.sesskey}&info=${methodname}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify([{ index: 0, methodname, args }]),
  });
  let out;
  try {
    [out] = await res.json();
  } catch {
    out = { error: true, exception: { errorcode: res.status === 303 || res.redirected ? 'requirelogin' : '' } };
  }
  if (!out.error) return out.data;
  const code = out.exception?.errorcode ?? '';
  if (/invalidsesskey|requirelogin|servicerequireslogin/.test(code)) {
    session = null;
    if (retry) return call(methodname, args, false);
    throw await lost(code);
  }
  throw new Error(out.exception?.message || `Moodle : ${methodname} a échoué`);
}

const decode = (s = '') => s.replace(/&amp;/g, '&').replace(/&#39;|&#039;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>');

const toCourse = (c) => ({
  id: c.id,
  fullname: decode(c.fullname ?? c.displayname ?? ''),
  shortname: decode(c.shortname ?? ''),
  idnumber: c.idnumber || '',
  category: decode(c.coursecategory || c.categoryname || ''),
  url: `${HOSTS.moodle}/course/view.php?id=${c.id}`,
});

/** Cours suivis (cache 6 h ; `force` pour relire). */
export function enrolledCourses({ force = false } = {}) {
  return cached('moodle:enrolled', 6 * HOUR, async () => {
    const data = await call('core_course_get_enrolled_courses_by_timeline_classification', {
      offset: 0,
      limit: 0,
      classification: 'all',
      sort: 'fullname',
    });
    return data.courses.map(toCourse);
  }, { force });
}

/** Recherche dans tout Moodle, une fois par matière et par semaine. */
export function searchCourses(query) {
  return cached(`moodle:search:${query.toLowerCase()}`, 7 * 24 * HOUR, async () => {
    const data = await call('core_course_search_courses', {
      criterianame: 'search',
      criteriavalue: query,
      page: 0,
      perpage: 10,
    });
    return data.courses.map(toCourse);
  });
}

const text = (el) => (el?.textContent ?? '').replace(/\s+/g, ' ').trim();

/**
 * Notes d'un cours, lues dans le carnet de notes de Moodle (rapport « utilisateur »), comme
 * l'étudiant les voit. Cache 30 min par matière. Rend [{ name, grade, range, average, percentage }].
 */
export function grades(courseId, { force = false } = {}) {
  return cached(`moodle:grades:${courseId}`, HOUR / 2, async () => {
    if (!session) await connect();
    const res = await http(`${HOSTS.moodle}/grade/report/user/index.php?id=${encodeURIComponent(courseId)}`);
    if (new URL(res.url).pathname.startsWith('/login')) throw await lost('');
    const doc = parse(await res.text());
    const out = [];
    for (const row of doc.querySelectorAll('table.user-grade tr')) {
      const name = text(row.querySelector('.column-itemname'));
      const grade = text(row.querySelector('.column-grade'));
      if (!name || !grade || grade === '-') continue;
      out.push({
        name,
        grade,
        range: text(row.querySelector('.column-range')),
        average: text(row.querySelector('.column-average')),
        percentage: text(row.querySelector('.column-percentage')),
        total: row.querySelector('.column-itemname')?.closest('tr')?.className.includes('total') ?? false,
      });
    }
    return out;
  }, { force });
}

export const gradesUrl = (courseId) => `${HOSTS.moodle}/grade/report/user/index.php?id=${courseId}`;

export const searchUrl = (query) => `${HOSTS.moodle}/course/search.php?search=${encodeURIComponent(query)}`;

// ------------------------------------------------------------------ rendus (devoirs, tests…)

const SAFE_URL = (u) => (typeof u === 'string' && u.startsWith(`${HOSTS.moodle}/`) ? u : '');
const LATE_KEPT = 7 * 864e5; // retards gardés une semaine
const DONE_TYPES = new Set(['due']); // échéance d'un devoir : sans action, c'est qu'il est rendu

/**
 * Fusionne les deux lectures du calendrier Moodle en une liste d'échéances :
 * - `todo` : les événements « à faire » (le calendrier n'y met que ce qui reste à rendre, retards compris) ;
 * - `upcoming` : les prochains événements, rendus compris. Un devoir (assign, « due ») présent ici
 *   mais sans action est déjà rendu : Moodle retire l'action dès la remise.
 * Les retards de plus d'une semaine sont écartés : passé ce délai, ce n'est plus « à rendre ».
 * Rend [{ id, name, course, courseUrl, at (ms), url, kind, status: 'todo' | 'late' | 'done', actionable }].
 */
export function toDeadlines(todo = [], upcoming = [], now = Date.now()) {
  const out = new Map();
  const add = (e, status) => {
    if (!e?.id || !e.modulename || out.has(e.id)) return;
    const at = Number(e.timesort ?? e.timestart) * 1000;
    if (!Number.isFinite(at) || at <= 0) return;
    const late = status !== 'done' && at < now;
    out.set(e.id, {
      id: e.id,
      name: decode(e.activityname || e.name || ''),
      course: decode(e.course?.fullnamedisplay || e.course?.fullname || ''),
      courseUrl: SAFE_URL(e.course?.viewurl),
      at,
      url: SAFE_URL(e.action?.url) || SAFE_URL(e.url) || SAFE_URL(e.viewurl),
      kind: e.modulename,
      status: status === 'done' ? 'done' : late ? 'late' : 'todo',
      actionable: e.action ? e.action.actionable !== false : false,
    });
  };
  for (const e of todo) if (e?.action) add(e, 'todo');
  for (const e of upcoming) {
    if (!e?.modulename) continue;
    if (e.action && e.isactionevent !== false) add(e, 'todo');
    else if (e.modulename === 'assign' && DONE_TYPES.has(e.eventtype)) add(e, 'done');
  }
  return [...out.values()].filter((d) => d.status !== 'late' || now - d.at <= LATE_KEPT).sort((a, b) => a.at - b.at);
}

/**
 * Prochains rendus : ce qui reste à rendre (jusqu'à une semaine de retard) et les devoirs déjà rendus
 * des prochaines semaines. Deux lectures du calendrier, comme le tableau de bord de Moodle.
 * Cache 10 min ; `force` pour relire.
 */
export function deadlines({ force = false } = {}) {
  return cached('moodle:deadlines', HOUR / 6, async () => {
    const now = Date.now();
    const from = Math.floor((now - LATE_KEPT) / 1000);
    const [todo, upcoming] = await Promise.all([
      call('core_calendar_get_action_events_by_timesort', { timesortfrom: from, limitnum: 50, limittononsuspendedevents: true }),
      call('core_calendar_get_calendar_upcoming_view', { courseid: 1 }).catch(() => ({ events: [] })),
    ]);
    return toDeadlines(todo?.events, upcoming?.events, now);
  }, { force });
}
