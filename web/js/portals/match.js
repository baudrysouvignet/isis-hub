// Lien entre un cours d'ADE et son espace Moodle.
//
// Règle de l'école : le code d'ADE préfixé par « FI » donne le cours Moodle.
//   ADE    « TD-A4-1-ISI-2 Aide à la décision »
//   Moodle « FIA4-1-ISI-2 - Aide à la décision »      A4-1-ISI-2 → FIA4-1-ISI-2
// On cherche d'abord ce code parmi les cours suivis, puis dans tout Moodle ; à défaut, un cours
// suivi de la même classe avec le même intitulé (lien marqué « ≈ »).

import { courseCode } from './ade.js';

const MOODLE_CODE_RE = /(?<![A-Z0-9])FI([AE]\d)-(\d)-([A-Z]{2,8})-(\d{1,2})(?!\d)/i;

/** « FIA4-1-ISI-2 » → « A4-1-ISI-2 » (ou null). */
export function moodleCode(text = '') {
  const m = MOODLE_CODE_RE.exec(text);
  return m ? `${m[1]}-${m[2]}-${m[3]}-${m[4]}`.toUpperCase() : null;
}

/** « A4-1-ISI-2 » → « FIA4-1-ISI-2 » */
export const toMoodleCode = (code) => `FI${code}`;

export const codeOfCourse = (c) =>
  moodleCode(c.shortname) || moodleCode(c.fullname) || moodleCode(c.idnumber) || courseCode(c.idnumber);

export const normalize = (s = '') =>
  s
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/&/g, ' et ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

const stripCode = (s) => normalize(s.replace(MOODLE_CODE_RE, '').replace(/^[\s:–—-]+/, ''));
const promoOf = (code) => code?.split('-')[0]; // « A4 »
const inPromo = (course, year) => new RegExp(`FI${year}(?![0-9])`, 'i').test(`${course.shortname} ${course.fullname} ${course.category}`);

/**
 * `search(query)` interroge Moodle (cours non suivis compris). Résultat de `get` :
 * { course, approx } | null (aucun) | undefined (pas encore cherché).
 */
export function createMatcher({ search, enabled = () => true }) {
  const byCode = new Map();
  let enrolled = [];
  const results = new Map();
  const pending = new Map();
  let loaded = false; // les cours suivis sont connus : on peut chercher

  function setEnrolled(courses, isLoaded = true) {
    loaded = isLoaded;
    enrolled = courses;
    byCode.clear();
    for (const c of courses) {
      const code = codeOfCourse(c);
      if (code && !byCode.has(code)) byCode.set(code, c);
    }
    results.clear();
  }

  const key = (ev) => ev.code ?? `titre:${normalize(ev.title)}`;

  function sameTitle(courses, ev, year) {
    const title = normalize(ev.title);
    if (title.length < 4) return null;
    return (
      courses.find((c) => (!year || inPromo(c, year)) && stripCode(c.fullname) === title) ||
      courses.find((c) => (!year || inPromo(c, year)) && stripCode(c.fullname).includes(title)) ||
      null
    );
  }

  async function lookup(ev) {
    if (ev.code && byCode.has(ev.code)) return { course: byCode.get(ev.code), approx: false };
    const year = promoOf(ev.code);
    if (ev.code) {
      const wanted = toMoodleCode(ev.code);
      const found = (await search(wanted).catch(() => [])).find((c) => codeOfCourse(c) === ev.code);
      if (found) return { course: found, approx: false };
    }
    const local = sameTitle(enrolled, ev, year);
    if (local) return { course: local, approx: true };
    return null;
  }

  return {
    setEnrolled,
    /** Oublie tout (déconnexion). */
    clear: () => setEnrolled([], false),
    /** Cours lié à une séance, si déjà connu. */
    get: (ev) => results.get(key(ev)),
    /** Cherche les cours de toutes les séances données ; `onFound` est appelé à chaque nouveauté. */
    async resolve(events, onFound) {
      if (!enabled() || !loaded) return; // sans session ni liste de cours, on n'interroge pas Moodle
      const todo = [];
      for (const ev of events) {
        const k = key(ev);
        if (results.has(k)) continue;
        if (ev.code && byCode.has(ev.code)) {
          results.set(k, { course: byCode.get(ev.code), approx: false });
          continue;
        }
        if (!pending.has(k)) {
          pending.set(
            k,
            lookup(ev)
              .catch(() => null)
              .then((r) => {
                results.set(k, r);
                pending.delete(k);
                return r;
              }),
          );
          todo.push(pending.get(k));
        }
      }
      if (todo.length) {
        await Promise.all(todo);
        onFound?.();
      }
    },
  };
}
