// ADE nomme ses séances « TD-A4-1-ISI-2 Aide à la décision », Moodle ses cours
// « FIA4-1-ISI-2 - Aide à la décision » (ou idnumber « A4-1-SES-1 », ou « … (E3-1-ID-3) »).
// Le code commun, une fois le préfixe « FI » retiré, est « A4-1-ISI-2 ».
const CODE_RE = /(?<![A-Z0-9])(?:FI)?([AE]\d)-(\d)-([A-Z]{2,8})-(\d{1,2})(?!\d)/i;

export function courseCode(text) {
  const m = CODE_RE.exec(text || '');
  return m ? `${m[1]}-${m[2]}-${m[3]}-${m[4]}`.toUpperCase() : null;
}

/** Code d'un cours Moodle : l'idnumber fait foi, puis le nom abrégé, puis le nom complet. */
export function moodleCourseCode(course) {
  return courseCode(course.idnumber) || courseCode(course.shortname) || courseCode(course.fullname);
}

const words = (text) =>
  text
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/&/g, ' et ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

/** « FIA4-1-LA-1 - Anglais » ou « Anglais (E3-1-ID-3) » → « anglais ». */
const courseTitle = (course) =>
  words(course.fullname.replace(/^[A-Z]+\d[\w-]*\s*(?:[-–:]\s*)?/i, '').replace(/\s*\([^)]*\d[^)]*\)\s*$/, ''));

/**
 * Associe les séances ADE à des cours Moodle, par ordre de confiance :
 *   1. même code, parmi les cours où l'on est inscrit puis via la recherche Moodle ;
 *   2. même intitulé dans la même promo (les codes divergent parfois : « A4-1-LSS-1 » côté ADE,
 *      « FIA4-1-LA-1 » côté Moodle), signalé par `approx`.
 * Les résultats, y compris négatifs, sont mémorisés par code le temps de la page.
 */
export function createMatcher({ search }) {
  const byCode = new Map(); // code -> { course, enrolled, approx } | null
  let enrolled = [];

  function sameTitleInPromo(courses, { code, title }) {
    const promo = new RegExp(`(?<![A-Z0-9])(?:FI)?${code.slice(0, 2)}(?!\\d)`, 'i');
    const wanted = words(title);
    return courses.find((c) => promo.test(`${c.shortname} ${c.category}`) && courseTitle(c) === wanted);
  }

  async function lookup(event) {
    const { code, title } = event;
    const exact = (await search(code)).find((c) => moodleCourseCode(c) === code);
    if (exact) return { course: exact, enrolled: false, approx: false };

    const own = sameTitleInPromo(enrolled, event);
    if (own) return { course: own, enrolled: true, approx: true };

    const query = `${title.replace(/[^\p{L}\p{N}]+/gu, ' ').trim()} FI${code.slice(0, 2)}`;
    const similar = sameTitleInPromo(await search(query), event);
    return similar ? { course: similar, enrolled: false, approx: true } : null;
  }

  return {
    setEnrolled(courses) {
      enrolled = courses;
      for (const course of courses) {
        const code = moodleCourseCode(course);
        if (code) byCode.set(code, { course, enrolled: true, approx: false });
      }
    },
    get(code) {
      return byCode.get(code);
    },
    /** Cherche sur Moodle les séances dont le code est encore inconnu. Renvoie true si du nouveau. */
    async resolve(events) {
      const todo = new Map();
      for (const event of events) {
        if (event.code && !byCode.has(event.code)) todo.set(event.code, event);
      }
      await Promise.all(
        [...todo.values()].map(async (event) => byCode.set(event.code, await lookup(event))),
      );
      return todo.size > 0;
    },
  };
}
