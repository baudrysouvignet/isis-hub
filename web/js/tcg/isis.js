// ISIS · TCG : reconnaître les gens d'ISIS dans l'annuaire de l'université.
//
// L'annuaire de la messagerie ne dit pas qui est à ISIS. Moodle, lui, range les cours d'ISIS dans
// des catégories « ISIS-… » : les participants de ces cours (étudiants et enseignants), lus comme
// l'utilisateur les voit, donnent les noms des gens d'ISIS. Un nom de l'annuaire qui contient tous
// les mots d'un de ces noms (« SOUVIGNET Baudry » / « Baudry Souvignet ») est marqué « ISIS ».
// Tout se passe dans la page : aucun nom n'est envoyé au serveur d'ISIS Hub.

const MAX_COURSES = 20;
const words = (s) =>
  s
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .split(/[^a-z]+/)
    .filter((w) => w.length > 1);

/** Cours d'ISIS parmi les cours suivis (catégorie « ISIS-… »). */
export const isisCourses = (courses) => courses.filter((c) => /(^|[^a-z])isis([^a-z]|$)/i.test(c.category || ''));

/**
 * moodle : module portals/moodle.js (session ouverte). Rend une fonction p → booléen (personne
 * d'ISIS ?), qui répond « non » tant que rien n'est chargé ou si Moodle est indisponible.
 */
export function isisMatcher(moodle) {
  let names = []; // listes de mots, une par participant
  const ready = (async () => {
    const courses = isisCourses(await moodle.enrolledCourses()).slice(0, MAX_COURSES);
    const lists = await Promise.allSettled(courses.map((c) => moodle.participants(c.id)));
    const seen = new Set();
    for (const r of lists) {
      for (const n of r.status === 'fulfilled' ? r.value : []) {
        const w = words(n);
        const k = [...w].sort().join(' ');
        if (w.length >= 2 && !seen.has(k)) {
          seen.add(k);
          names.push(w);
        }
      }
    }
  })().catch(() => {
    names = [];
  });
  const test = (p) => {
    if (!names.length || !p?.name) return false;
    const have = new Set(words(p.name));
    return names.some((w) => w.every((x) => have.has(x)));
  };
  test.ready = ready;
  test.count = () => names.length;
  return test;
}
