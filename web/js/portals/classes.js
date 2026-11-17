// Classes d'ISIS et filtrage de leur emploi du temps par groupe, langue et parcours.
//
// Les règles reprennent EXACTEMENT celles du projet « Calendriers ISIS » (FIE1 à FIE5, FIA3 à FIA5),
// vérifiées séance par séance contre sa sortie (test/page.test.js). Les données (ressources ADE,
// codes de chaque parcours, alias) sont dans data/classes.json, partagé avec le serveur, qui
// produit les mêmes calendriers pour l'abonnement des agendas (internal/calendar).

let data = null;

/**
 * Répartition en vigueur : celle de l'administration (api/classes), ou à défaut celle livrée avec
 * le code (data/classes.json).
 */
export async function loadClasses(fetcher = (url) => fetch(url, { cache: 'no-cache' }).then((r) => (r.ok ? r.json() : Promise.reject(r.status)))) {
  if (data) return data;
  try {
    data = await fetcher(new URL('../../api/classes', import.meta.url).href);
  } catch {
    data = await fetcher(new URL('../../data/classes.json', import.meta.url).href);
  }
  return data;
}
export const setClasses = (d) => {
  data = d;
};
export const classes = () => data.classes;
export const classOf = (promo) => data?.classes[promo] ?? null;
export const projectId = () => data.projectId;
export const trackLabel = (t) => data.trackLabels[t] ?? t;
export const LANGUAGES = { chinois: 'Chinois', espagnol: 'Espagnol' };

// ------------------------------------------------------------ choix à faire

/** Choix demandés pour une classe : parcours, groupe, langue. */
export function choicesFor(promo) {
  const c = classOf(promo);
  if (!c) return [];
  switch (c.filter) {
    case 'groupLanguage':
      return c.linkedLanguage ? ['group'] : ['group', 'language'];
    case 'fie4':
      return ['track', 'group'];
    case 'fie5':
      return ['track'];
    default:
      return [];
  }
}

/** Le choix est-il complet et valide pour cette classe ? */
export function isComplete(promo, choice = {}) {
  const c = classOf(promo);
  if (!c) return false;
  return choicesFor(promo).every((k) => {
    if (k === 'group') return choice.group === 1 || choice.group === 2;
    if (k === 'language') return choice.language in LANGUAGES;
    if (k === 'track') return Object.hasOwn(c.tracks, choice.track);
    return false;
  });
}

/** « IA · G1 », « G2 · Espagnol »… */
export function choiceLabel(promo, choice = {}) {
  const c = classOf(promo);
  const parts = [];
  for (const k of choicesFor(promo)) {
    if (k === 'track') parts.push(trackLabel(choice.track));
    if (k === 'group') parts.push(`G${choice.group}${c.linkedLanguage ? ` · ${choice.group === 1 ? 'Chinois' : 'Espagnol'}` : ''}`);
    if (k === 'language') parts.push(LANGUAGES[choice.language]);
  }
  return parts.join(' · ');
}

/** Chemin du calendrier filtré servi par ISIS Hub (null : le lien ADE direct suffit). */
export function feedPath(promo, choice = {}) {
  const c = classOf(promo);
  const p = promo.toLowerCase();
  switch (c?.filter) {
    case 'groupLanguage':
      return c.linkedLanguage ? `calendar/${p}/${choice.group}.ics` : `calendar/${p}/${choice.group}/${choice.language}.ics`;
    case 'fie4':
      return `calendar/${p}/${choice.track}/${choice.group}.ics`;
    case 'fie5':
      return `calendar/${p}/${choice.track}.ics`;
    default:
      return null;
  }
}

// ------------------------------------------------------------ règles

const normalize = (text) => String(text).normalize('NFKC').replace(/[‐‑–—−]/g, '-').toUpperCase();

/** Groupes explicites (G1, GROUPE 2, GR 1 ET 2…) ; un suffixe de code, une salle ou G10 ne sont pas G1. */
export function groupsIn(text) {
  const result = new Set();
  const pattern =
    /\b(?:GROUPES?|GRP|GR|G)[\s:._-]*0?([12])(?!\d)(?:\s*(?:ET|OU|\/|&|,|\+)\s*(?:(?:GROUPES?|GRP|GR|G)[\s:._-]*)?0?([12])(?!\d))?/g;
  for (const m of normalize(text).matchAll(pattern)) {
    result.add(Number(m[1]));
    if (m[2]) result.add(Number(m[2]));
  }
  return [...result].sort();
}

const withoutExport = (description) =>
  description
    .split('\n')
    .filter((l) => !/^\(?Exporté le:/i.test(l.trim()))
    .join('\n');
const firstLine = (description) => description.split('\n').find((l) => l.trim()) ?? '';

// Codes de matières de l'année de la classe (codeYear : 4 pour « E4-1-… », 5 pour « E5/A5-1-… »).
const codeRegexps = new Map();
function codePattern(c) {
  const key = `${c.filter}:${c.codeYear}`;
  if (!codeRegexps.has(key)) {
    const y = Number(c.codeYear);
    codeRegexps.set(
      key,
      c.filter === 'fie5' ? new RegExp(`\\b[EA]${y}-[12]-[A-Z]+(?:-\\d+)*`, 'g') : new RegExp(`(?<![A-Z0-9])E${y}-[12]-(?:[A-Z]+)(?:-\\d+)*`, 'g'),
    );
  }
  return codeRegexps.get(key);
}

function fie4Codes(c, text) {
  const found = normalize(text).match(codePattern(c)) ?? [];
  return [...new Set(found.map((x) => c.aliases?.[x] ?? x))];
}

function fie5Codes(c, text) {
  return [...new Set((text.toUpperCase().match(codePattern(c)) || []).map((x) => c.aliases?.[x] || x))];
}

/**
 * La séance fait-elle partie de l'emploi du temps de cet étudiant ?
 * `ev.rawSummary` et `ev.rawDescription` sont les champs ADE bruts (déséchappés).
 */
export function keep(promo, choice, ev) {
  const c = classOf(promo);
  if (!c) return true;
  const summary = ev.rawSummary ?? '';
  const description = ev.rawDescription ?? '';
  switch (c.filter) {
    case 'groupLanguage': {
      const g = choice.group;
      const language = c.linkedLanguage ? (g === 1 ? 'chinois' : 'espagnol') : choice.language;
      const groups = groupsIn(`${summary}\n${withoutExport(description)}`);
      const lang = /\bchinois\b/i.test(summary) ? 'chinois' : /\bespagnol\b/i.test(summary) ? 'espagnol' : null;
      return (!groups.length || groups.includes(g)) && (!lang || lang === language);
    }
    case 'fie4': {
      const title = fie4Codes(c, summary);
      const codes = title.length ? title : fie4Codes(c, firstLine(description));
      const common = !codes.length && description.includes(c.common);
      const allowed = c.tracks[choice.track] ?? [];
      if (!common && !codes.some((x) => allowed.includes(x))) return false;
      const groups = groupsIn(`${summary}\n${withoutExport(description)}`);
      return !groups.length || groups.includes(choice.group);
    }
    case 'fie5': {
      const title = fie5Codes(c, summary);
      const codes = title.length ? title : fie5Codes(c, firstLine(description));
      const allowed = c.tracks[choice.track] ?? [];
      return codes.length === 0 || codes.some((x) => allowed.includes(x));
    }
    default:
      return true;
  }
}
