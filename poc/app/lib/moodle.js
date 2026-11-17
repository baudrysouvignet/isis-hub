import { HOSTS, NotLoggedIn } from './config.js';
import { http } from './http.js';

// Clé de session Moodle, gardée uniquement en mémoire le temps de la page.
let session = null;

export const reset = () => {
  session = null;
};

async function page(path) {
  const res = await http(HOSTS.moodle + path);
  return res.text();
}

function readSession(html) {
  const sesskey = /"sesskey":"([^"]+)"/.exec(html)?.[1];
  const userId = Number(/"userId":(\d+)/.exec(html)?.[1] ?? 0);
  return sesskey && userId > 1 ? { sesskey, userId } : null; // 0 = anonyme, 1 = invité
}

/**
 * Récupère la session Moodle. Sans session, on passe par le bouton « CAS » officiel de Moodle :
 * si le navigateur est déjà connecté au CAS, Moodle ouvre la session tout seul (SSO).
 */
export async function connect() {
  session = readSession(await page('/my/'));
  if (!session) {
    const afterSso = await page('/login/index.php?authCAS=CAS').catch(() => '');
    session = readSession(afterSso) || readSession(await page('/my/'));
  }
  if (!session) throw new NotLoggedIn('Moodle');
  return session;
}

async function call(methodname, args, retry = true) {
  if (!session) await connect();
  const res = await http(
    `${HOSTS.moodle}/lib/ajax/service.php?sesskey=${session.sesskey}&info=${methodname}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify([{ index: 0, methodname, args }]),
    },
  );
  const [out] = await res.json();
  if (!out.error) return out.data;

  const code = out.exception?.errorcode ?? '';
  if (/invalidsesskey|requirelogin|servicerequireslogin/.test(code)) {
    session = null;
    if (retry) return call(methodname, args, false);
    throw new NotLoggedIn('Moodle');
  }
  throw new Error(out.exception?.message || `Moodle : ${methodname} a échoué`);
}

const toCourse = (c) => ({
  id: c.id,
  fullname: c.fullname,
  shortname: c.shortname,
  idnumber: c.idnumber || '',
  category: c.coursecategory || c.categoryname || '',
  url: `${HOSTS.moodle}/course/view.php?id=${c.id}`,
});

export async function enrolledCourses() {
  const data = await call('core_course_get_enrolled_courses_by_timeline_classification', {
    offset: 0,
    limit: 0,
    classification: 'all',
    sort: 'fullname',
  });
  return data.courses.map(toCourse);
}

export async function searchCourses(query) {
  const data = await call('core_course_search_courses', {
    criterianame: 'search',
    criteriavalue: query,
    page: 0,
    perpage: 10,
  });
  return data.courses.map(toCourse);
}

export const searchUrl = (query) =>
  `${HOSTS.moodle}/course/search.php?search=${encodeURIComponent(query)}`;
