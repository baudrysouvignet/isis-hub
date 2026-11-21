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

export async function connect() {
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
