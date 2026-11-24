// ISIS · TCG : reconnaître les gens d'ISIS (toutes les classes) dans l'annuaire de l'université.
//
// L'annuaire ne dit pas qui est à ISIS. Deux sources, lues dans la page comme l'utilisateur les voit :
//  1. les listes de diffusion de l'annuaire dont le nom ou l'adresse parle d'ISIS ou d'une classe
//     d'ISIS (FIE1 à FIE5, FIA3 à FIA5…) : leurs membres, adresse par adresse, toutes classes ;
//  2. les participants des cours Moodle « ISIS-… » suivis (sa propre classe surtout), par le nom :
//     « SOUVIGNET Baudry » dans l'annuaire = « Baudry Souvignet » dans Moodle.
// Aucun nom ni adresse n'est envoyé au serveur d'ISIS Hub.

const MAX_COURSES = 20;
const MAX_LISTS = 40; // listes dépliées au plus
const MAX_DEPTH = 2; // listes incluses dans des listes

const words = (s) =>
  s
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 1);

/** Cours d'ISIS parmi les cours suivis (catégorie « ISIS-… »). */
export const isisCourses = (courses) => courses.filter((c) => /(^|[^a-z])isis([^a-z]|$)/i.test(c.category || ''));

/** Une liste de diffusion d'ISIS : « isis », ou un code de classe (fia4, fie2…) dans son nom ou son adresse. */
export function isIsisList(entry, codes) {
  const w = new Set([...words(entry.name || ''), ...words((entry.email || '').split('@')[0])]);
  if (w.has('isis')) return true;
  return codes.some((c) => w.has(c.toLowerCase()));
}

/** Adresses des membres des listes ISIS de l'annuaire (listes incluses dépliées). */
export async function isisFromDirectory(mail, codes) {
  const queries = ['isis', ...codes];
  const lists = new Map(); // clé de fiche → { name, email, ref }
  const found = await Promise.allSettled(queries.map((q) => mail.searchContacts(q, 50)));
  for (const r of found) {
    for (const e of r.status === 'fulfilled' ? r.value : []) {
      if (e.cat === 'liste' && e.ref && isIsisList(e, codes)) lists.set(`${e.ref.container}/${e.ref.uid}`, e);
    }
  }
  const emails = new Set();
  const used = [];
  const seen = new Set();
  let todo = [...lists.values()].slice(0, MAX_LISTS).map((l) => ({ ...l, depth: 0 }));
  while (todo.length) {
    const batch = todo;
    todo = [];
    const res = await Promise.allSettled(batch.map((l) => mail.groupMembers(l.ref)));
    res.forEach((r, i) => {
      const l = batch[i];
      seen.add(`${l.ref.container}/${l.ref.uid}`);
      if (r.status !== 'fulfilled') return;
      let n = 0;
      for (const m of r.value) {
        const key = m.ref && `${m.ref.container}/${m.ref.uid}`;
        // Membre qui est lui-même une liste d'ISIS : déplié aussi (une fois).
        if (key && !seen.has(key) && l.depth + 1 < MAX_DEPTH && isIsisList(m, codes) && seen.size + todo.length < MAX_LISTS) {
          todo.push({ ...m, depth: l.depth + 1 });
          seen.add(key);
          continue;
        }
        if (m.email && /@/.test(m.email)) {
          emails.add(m.email);
          n++;
        }
      }
      used.push({ name: l.name || l.email, count: n });
    });
  }
  return { emails, lists: used };
}

/** Noms des participants des cours Moodle « ISIS-… » suivis (listes de mots). */
export async function isisFromMoodle(moodle) {
  const courses = isisCourses(await moodle.enrolledCourses()).slice(0, MAX_COURSES);
  const lists = await Promise.allSettled(courses.map((c) => moodle.participants(c.id)));
  const names = [];
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
  return { names, courses: courses.length };
}

/**
 * { moodle, mail, codes } (chacun facultatif). Rend une fonction p → booléen (personne d'ISIS ?),
 * qui répond « non » tant que rien n'est chargé ou si une source est indisponible.
 * test.ready : chargement fini ; test.info() : ce qui a été trouvé (pour l'administrateur).
 */
export function isisMatcher({ moodle, mail, codes = [] } = {}) {
  let emails = new Set();
  let names = [];
  let info = { lists: [], emails: 0, names: 0, courses: 0, ready: false };
  const ready = Promise.allSettled([
    mail ? isisFromDirectory(mail, codes) : Promise.resolve(null),
    moodle ? isisFromMoodle(moodle) : Promise.resolve(null),
  ]).then(([d, m]) => {
    if (d.status === 'fulfilled' && d.value) emails = d.value.emails;
    if (m.status === 'fulfilled' && m.value) names = m.value.names;
    info = {
      lists: d.status === 'fulfilled' && d.value ? d.value.lists : [],
      emails: emails.size,
      names: names.length,
      courses: m.status === 'fulfilled' && m.value ? m.value.courses : 0,
      ready: true,
    };
  });
  const test = (p) => {
    if (!p) return false;
    if (p.email && emails.has(p.email.toLowerCase())) return true;
    if (!names.length || !p.name) return false;
    const have = new Set(words(p.name));
    return names.some((w) => w.every((x) => have.has(x)));
  };
  test.ready = ready;
  test.info = () => info;
  return test;
}
