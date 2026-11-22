// Moodle dans le Hub : le contenu d'un cours, lu dans les pages de Moodle, comme le navigateur
// les affiche à l'étudiant (l'API mobile n'est pas ouverte, et l'API AJAX du site ne donne ni les
// textes ni les fichiers). Tout passe par le tunnel chiffré ; rien n'est copié chez ISIS Hub.
//
// Sécurité :
// - seules des adresses de Moodle (HOSTS.moodle) sont demandées, construites à partir d'identifiants
//   numériques ou relues dans la page puis vérifiées ;
// - le HTML des enseignants est gardé tel quel en mémoire, et il n'est JAMAIS inséré dans la page :
//   l'affichage le reconstruit balise par balise (ui/moodle-rich.js) ;
// - un fichier téléchargé n'est jamais interprété : affiché seulement si c'est une image ou un PDF
//   reconnu à ses premiers octets, sinon proposé au téléchargement sous un type neutre.

import { HOSTS, NotSignedIn } from './config.js';
import { http } from '../net/http.js';
import { cached, forget } from '../net/cache.js';
import { parse } from './sanitize.js';
import { casSessionAlive } from './cas.js';
import { notSignedInOrDown } from './config.js';
import { ensureSession, reset as resetSession } from './moodle.js';

const MIN = 60e3;
const HOUR = 60 * MIN;
const BASE = HOSTS.moodle;

/** Adresse de Moodle (et seulement de Moodle), absolue. */
export function moodleUrl(href) {
  try {
    const u = new URL(href, `${BASE}/`);
    return u.origin === BASE ? u.href : '';
  } catch {
    return '';
  }
}

/** Adresse web ordinaire (lien externe), sinon ''. */
export function webUrl(href) {
  try {
    const u = new URL(href);
    return /^https?:$/.test(u.protocol) ? u.href : '';
  } catch {
    return '';
  }
}

const idOf = (href, key = 'id') => {
  try {
    const v = new URL(href, `${BASE}/`).searchParams.get(key);
    return /^\d+$/.test(v ?? '') ? Number(v) : null;
  } catch {
    return null;
  }
};
export const courseIdOf = (href) => (/\/course\/view\.php/.test(href ?? '') ? idOf(href) : null);
export const cmIdOf = (href) => (/\/mod\/[a-z0-9_]+\/view\.php/.test(href ?? '') ? idOf(href) : null);

const clean = (s) => (s ?? '').replace(/\s+/g, ' ').trim();
// Moodle échappe deux fois certains attributs (« -&gt; ») : on retire la seconde couche.
const unescape = (s) => s.replace(/&gt;/g, '>').replace(/&lt;/g, '<').replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&amp;/g, '&');
const textOf = (el) => clean(el?.textContent);

/** Texte sans les mentions réservées aux lecteurs d'écran (« Fichier », « URL »…). */
function visibleText(el) {
  if (!el) return '';
  const c = el.cloneNode(true);
  c.querySelectorAll('.accesshide, .sr-only, .visually-hidden').forEach((x) => x.remove());
  return textOf(c);
}

const inner = (el) => (el ? el.innerHTML.trim() : '');

/**
 * Retire styles et attributs style avant l'analyse : ils ne seraient jamais recopiés, et le navigateur
 * signalerait chacun comme bloqué par la politique de sécurité (style-src 'self').
 */
export const stripStyles = (html) =>
  String(html ?? '')
    .replace(/<style\b[\s\S]*?<\/style\s*>/gi, '')
    .replace(/\sstyle\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '');

// ------------------------------------------------------------------ dates en français

const MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];

/** « mardi 18 novembre 2025, 17:09 » → horodatage (ms, heure locale), sinon null. */
export function parseFrDate(s) {
  const m = /(\d{1,2})\s+([a-zéû]+)\s+(\d{4})(?:,?\s*(\d{1,2})[:h](\d{2}))?/i.exec(s ?? '');
  if (!m) return null;
  const month = MOIS.indexOf(m[2].toLowerCase());
  if (month < 0) return null;
  return new Date(Number(m[3]), month, Number(m[1]), Number(m[4] ?? 0), Number(m[5] ?? 0)).getTime();
}

/** « Ouvert le : mardi 18 novembre 2025, 17:09 » → { label: 'Ouvert le', at }. */
export function parseDateLine(line) {
  const t = clean(line);
  const i = t.indexOf(':');
  const label = clean(i > 0 ? t.slice(0, i) : t);
  return { label, text: t, at: parseFrDate(t) };
}

const OPEN_RE = /^(ouvert|ouverture|début|disponible|s'ouvre|ouvre)/i;
const DUE_RE = /^(à rendre|date limite|date de remise|ferm|clôtur|échéance|attendu)/i;
export const openOf = (dates = []) => dates.find((d) => OPEN_RE.test(d.label))?.at ?? null;
export const dueOf = (dates = []) => dates.find((d) => DUE_RE.test(d.label))?.at ?? null;

/** « 3.8 Mo » → octets (approximatif), sinon null. */
export function sizeOf(text) {
  const m = /([\d.,]+)\s*(octets?|o|Ko|Mo|Go|KB|MB|GB|bytes?)\b/i.exec(text ?? '');
  if (!m) return null;
  const n = Number(m[1].replace(',', '.'));
  const u = m[2].toLowerCase();
  const k = u.startsWith('k') ? 1024 : u.startsWith('m') ? 1048576 : u.startsWith('g') ? 1073741824 : 1;
  return Number.isFinite(n) ? Math.round(n * k) : null;
}

// Icône de Moodle (« f/pdf ») → extension probable, en attendant le vrai nom du fichier.
const ICON_EXT = { pdf: 'pdf', archive: 'zip', spreadsheet: 'xlsx', writer: 'docx', document: 'docx', markup: 'html', powerpoint: 'pptx', presentation: 'pptx', image: 'png', text: 'txt', sourcecode: 'code', video: 'mp4', audio: 'mp3', calc: 'ods', impress: 'odp', mpeg: 'mp4', avi: 'avi', quicktime: 'mov', jpeg: 'jpg', png: 'png' };
function iconExt(m) {
  const src = m.querySelector('img.activityicon, .activityiconcontainer img')?.getAttribute('src') ?? '';
  const k = /\/f\/([a-z0-9]+)/i.exec(src)?.[1]?.toLowerCase();
  return k ? ICON_EXT[k] ?? k : '';
}

// ------------------------------------------------------------------ page d'un cours

const typeOf = (li) => [...li.classList].find((c) => c.startsWith('modtype_'))?.slice(8) ?? 'unknown';

function folderFiles(root) {
  const seen = new Set();
  const out = [];
  for (const a of root.querySelectorAll('a[href*="/pluginfile.php/"]')) {
    const url = moodleUrl(a.getAttribute('href'));
    if (!url || seen.has(url)) continue;
    seen.add(url);
    const name = textOf(a.querySelector('.fp-filename')) || textOf(a) || decodeURIComponent(new URL(url).pathname.split('/').pop());
    out.push({ name, url });
  }
  return out;
}

function parseItem(li) {
  const id = Number(li.dataset.id || /module-(\d+)/.exec(li.id)?.[1] || 0);
  const type = typeOf(li);
  const link = li.querySelector('a.aalink, .activityname a, .activity-instance a');
  const url = moodleUrl(link?.getAttribute('href') ?? '');
  const name = unescape(clean(li.querySelector('[data-activityname]')?.dataset.activityname)) || visibleText(li.querySelector('.instancename, .activityname')) || null;
  const dates = [...li.querySelectorAll('[data-region="activity-dates"] > div, [data-region="activity-dates"] .description-inner > div')]
    .map((d) => parseDateLine(d.textContent))
    .filter((d) => d.label);
  const avail = li.querySelector('.availabilityinfo');
  const restriction = avail ? clean(visibleText(avail)).replace(/^Non disponible\s*(sauf si|à moins que)?\s*:?\s*/i, '') : '';
  const restricted = Boolean(avail) && !url && type !== 'label';
  const alt = li.querySelector('.activity-altcontent, .contentwithoutlink, .description .no-overflow');
  const item = { id, type, name, url, dates, restricted, restriction: restricted || avail ? restriction || 'Pas encore disponible' : '' };
  item.hidden = li.classList.contains('dimmed') || Boolean(li.querySelector('.badge.bg-secondary, .badge-secondary') && /cach/i.test(textOf(li.querySelector('.badge'))));

  if (type === 'folder') {
    const tree = li.querySelector('.foldertree');
    item.folder = { inline: Boolean(tree), files: tree ? folderFiles(tree) : null };
    if (alt) {
      const c = alt.cloneNode(true);
      c.querySelectorAll('.foldertree, form, .navitem').forEach((x) => x.remove());
      item.html = inner(c);
    }
  } else if (alt) item.html = inner(alt);

  if (type === 'resource') {
    const badge = textOf(li.querySelector('.activity-badges, .resourcelinkdetails'));
    item.file = { ext: iconExt(li), size: sizeOf(badge), label: badge };
  }
  if (type === 'url') item.ext = iconExt(li);
  return item;
}

/** Analyse la page /course/view.php (format « thématique », toutes les sections sur une page). */
export function parseCourse(doc, id) {
  const sections = [];
  for (const s of doc.querySelectorAll('li.section[data-for="section"], li.section.main')) {
    const sid = Number(s.dataset.id || s.getAttribute('data-sectionid') || 0);
    const number = Number(s.dataset.number ?? s.getAttribute('data-sectionid') ?? sections.length);
    const title = unescape(clean(s.dataset.sectionname)) || visibleText(s.querySelector('.sectionname')) || (number ? `Section ${number}` : 'Généralités');
    const avail = s.querySelector('.section_availability .availabilityinfo, :scope > .content > .availabilityinfo');
    const items = [...s.querySelectorAll('li.activity')].map(parseItem).filter((it) => it.id);
    sections.push({
      id: sid || number,
      number,
      title,
      summary: inner(s.querySelector('.summarytext .no-overflow, .summarytext')) || null,
      current: s.classList.contains('current'),
      restricted: Boolean(avail) && !items.length,
      restriction: avail ? visibleText(avail).replace(/^Non disponible\s*(sauf si|à moins que)?\s*:?\s*/i, '') : '',
      items,
    });
  }
  const heading = visibleText(doc.querySelector('.page-header-headings h1, header h1, #page-header h1'));
  return { id, fullname: heading, sections, guest: /guest/i.test(doc.body?.className ?? '') && !doc.querySelector('.usermenu .userbutton') };
}

/** La page demandée a mené à la connexion : session perdue (si le CAS le confirme). */
async function loginCheck(res) {
  const path = new URL(res.url).pathname;
  if (path.startsWith('/login')) {
    resetSession();
    throw await notSignedInOrDown('Moodle', '', casSessionAlive);
  }
  return path;
}

/** Le cours n'est pas ouvert à l'étudiant (pas inscrit, pas d'accès invité). */
export class NotEnrolled extends Error {
  constructor(id) {
    super('Tu n’es pas inscrit à ce cours');
    this.name = 'NotEnrolled';
    this.courseId = id;
  }
}

async function page(path, retry = true) {
  await ensureSession();
  const res = await http(`${BASE}${path}`);
  if (res.status >= 500) throw new Error(`Moodle répond ${res.status}`);
  // Session Moodle expirée alors que le CAS est encore valable : une nouvelle ouverture suffit.
  if (retry && new URL(res.url).pathname.startsWith('/login')) {
    resetSession();
    return page(path, false);
  }
  const finalPath = await loginCheck(res);
  return { res, finalPath, doc: parse(stripStyles(await res.text())) };
}

/** Contenu d'un cours (cache 10 min ; `force` pour relire). */
export function courseContent(id, { force = false } = {}) {
  if (!Number.isInteger(id) || id <= 0) return Promise.reject(new Error('cours inconnu'));
  return cached(`moodle:course:${id}`, 10 * MIN, async () => {
    const { finalPath, doc } = await page(`/course/view.php?id=${id}`);
    if (finalPath.startsWith('/enrol/')) throw new NotEnrolled(id);
    return parseCourse(doc, id);
  }, { force });
}

// ------------------------------------------------------------------ devoir

function tableRows(root, sel) {
  const out = {};
  for (const tr of root.querySelectorAll(sel)) {
    const k = textOf(tr.querySelector('th'));
    const td = tr.querySelector('td');
    if (k && td) out[k] = { text: visibleText(td), cls: td.className, el: td };
  }
  return out;
}

/** Analyse /mod/assign/view.php : consignes, dates, état, ton rendu, note. */
export function parseAssign(doc) {
  const descEl = doc.querySelector('.activity-description');
  const intro = descEl?.querySelector('.no-overflow') ?? descEl;
  const introFiles = [];
  if (descEl) {
    for (const a of descEl.querySelectorAll('a[href*="/pluginfile.php/"]')) {
      if (a.closest('.no-overflow') && intro !== descEl) continue; // lien dans le texte : affiché avec lui
      const url = moodleUrl(a.getAttribute('href'));
      if (url) introFiles.push({ name: textOf(a) || decodeURIComponent(new URL(url).pathname.split('/').pop()), url });
    }
  }
  const dates = [...doc.querySelectorAll('[data-region="activity-dates"] > div, [data-region="activity-dates"] .description-inner > div')]
    .map((d) => parseDateLine(d.textContent))
    .filter((d) => d.label);
  const rows = tableRows(doc, '.submissionstatustable tr, .submissionsummarytable tr');
  const fb = tableRows(doc, '.feedback tr, table.feedbacktable tr');
  const st = (re) => Object.entries(rows).find(([k]) => re.test(k))?.[1];
  const subRow = st(/statut des travaux|submission status/i);
  const gradeRow = st(/statut de l.évaluation|grading status/i);
  const timeRow = st(/temps restant|time remaining/i);
  const lastRow = st(/dernière modification|last modified/i);
  const filesRow = st(/remises de fichiers|file submissions/i);
  const onlineRow = st(/texte en ligne|online text/i);
  const submittedFiles = filesRow
    ? [...filesRow.el.querySelectorAll('a[href*="/pluginfile.php/"]')].map((a) => {
        const url = moodleUrl(a.getAttribute('href'));
        const box = a.closest('.fileuploadsubmission')?.parentElement ?? a.parentElement;
        const time = textOf(box?.querySelector('.fileuploadsubmissiontime'));
        return url ? { name: textOf(a), url, at: parseFrDate(time) } : null;
      }).filter(Boolean)
    : [];
  const onlineEl = onlineRow?.el.querySelector('.no-overflow') ?? onlineRow?.el;
  const fbOf = (re) => Object.entries(fb).find(([k]) => re.test(k))?.[1];
  const grade = fbOf(/^note$|^grade$/i);
  const comment = fbOf(/commentaire|feedback comments/i);
  const actions = [...doc.querySelectorAll('[role="main"] .submissionaction button, [role="main"] .submissionaction input[type="submit"], [role="main"] form button[type="submit"]')]
    .map((b) => clean(b.textContent || b.value))
    .filter((t) => t && !/supprimer|remove/i.test(t));
  return {
    html: intro ? inner(intro) : '',
    introFiles,
    dates,
    submission: subRow?.text ?? '',
    submitted: /submitted|submissionstatussubmitted/.test(subRow?.cls ?? '') || (/remis/i.test(subRow?.text ?? '') && !/aucun|brouillon|draft|no attempt/i.test(subRow?.text ?? '')),
    draft: /brouillon|draft/i.test(subRow?.text ?? ''),
    gradingStatus: gradeRow?.text ?? '',
    graded: /submissiongraded/.test(gradeRow?.cls ?? '') || (/^noté|^graded/i.test(gradeRow?.text ?? '')),
    timeLeft: timeRow?.text ?? '',
    lastModified: lastRow?.text && lastRow.text !== '-' ? lastRow.text : '',
    submittedFiles,
    onlineHtml: onlineEl ? inner(onlineEl) : '',
    grade: grade?.text ?? '',
    gradedOn: fbOf(/évalué le|graded on/i)?.text ?? '',
    comment: comment ? inner(comment.el) : '',
    action: actions[0] ?? '',
  };
}

/** Détails d'un devoir (cache 5 min). */
export function assignDetails(cmid, { force = false } = {}) {
  return cached(`moodle:assign:${cmid}`, 5 * MIN, async () => parseAssign((await page(`/mod/assign/view.php?id=${Number(cmid)}`)).doc), { force });
}

// ------------------------------------------------------------------ test (QCM)

/** Analyse /mod/quiz/view.php (modèle standard de Moodle 4.5). */
export function parseQuiz(doc) {
  const descEl = doc.querySelector('.activity-description');
  const dates = [...doc.querySelectorAll('[data-region="activity-dates"] > div, [data-region="activity-dates"] .description-inner > div')]
    .map((d) => parseDateLine(d.textContent))
    .filter((d) => d.label);
  const settings = {};
  for (const p of doc.querySelectorAll('.quizinfo p, .quizinfo li')) {
    const t = textOf(p);
    const i = t.indexOf(':');
    if (i > 0) settings[clean(t.slice(0, i))] = clean(t.slice(i + 1));
  }
  const attempts = [];
  const table = doc.querySelector('table.quizattemptsummary');
  if (table) {
    const heads = [...table.querySelectorAll('thead th')].map(textOf);
    for (const tr of table.querySelectorAll('tbody tr')) {
      const row = {};
      [...tr.querySelectorAll('td, th')].forEach((td, i) => heads[i] && (row[heads[i]] = textOf(td)));
      if (Object.keys(row).length) attempts.push(row);
    }
  }
  const finalGrade = textOf(doc.querySelector('#feedback h3, .quizgradefeedback, #feedback'));
  const buttons = [...doc.querySelectorAll('.quizstartbuttondiv button, .quizstartbuttondiv input[type="submit"], .quizattempt button, .quizattempt input[type="submit"]')].map((b) => clean(b.textContent || b.value)).filter(Boolean);
  const notice = textOf(doc.querySelector('.quizattempt p, .quizattempt .alert'));
  return { html: inner(descEl?.querySelector('.no-overflow') ?? descEl), dates, settings, attempts, finalGrade, button: buttons[0] ?? '', notice };
}

export function quizDetails(cmid, { force = false } = {}) {
  return cached(`moodle:quiz:${cmid}`, 5 * MIN, async () => parseQuiz((await page(`/mod/quiz/view.php?id=${Number(cmid)}`)).doc), { force });
}

// ------------------------------------------------------------------ dossier, lien, fichier

/** Fichiers d'un dossier affiché sur sa propre page (cache 30 min). */
export function folderContent(cmid) {
  return cached(`moodle:folder:${cmid}`, 30 * MIN, async () => {
    const { doc } = await page(`/mod/folder/view.php?id=${Number(cmid)}`);
    return folderFiles(doc.querySelector('.foldertree, [role="main"]') ?? doc);
  });
}

/**
 * Adresse réelle d'un lien (ressource « URL ») : Moodle la donne en redirection avec `redirect=1`,
 * sinon dans sa page intermédiaire. Jamais suivie par le tunnel : seulement affichée (cache 1 j).
 */
export function urlTarget(cmid) {
  return cached(`moodle:url:${cmid}`, 24 * HOUR, async () => {
    await ensureSession();
    const res = await http(`${BASE}/mod/url/view.php?id=${Number(cmid)}&redirect=1`, { redirect: 'manual' });
    if (res.location) {
      const target = webUrl(new URL(res.location, `${BASE}/`).href);
      if (target && !new URL(target).pathname.startsWith('/login')) return target;
    }
    const res2 = await http(`${BASE}/mod/url/view.php?id=${Number(cmid)}`);
    await loginCheck(res2);
    const doc = parse(stripStyles(await res2.text()));
    return webUrl(doc.querySelector('.urlworkaround a')?.getAttribute('href') ?? '') || '';
  });
}

const nameFromUrl = (u) => {
  try {
    return decodeURIComponent(new URL(u).pathname.split('/').pop() || '');
  } catch {
    return '';
  }
};

const MAX_FILE = 150 * 1024 * 1024;

/**
 * Télécharge un fichier de Moodle par le tunnel. `ref` : { cmid } (ressource « Fichier »),
 * { folderZip: cmid } (dossier entier en .zip) ou { url } (fichier de Moodle). Rend { bytes, name }.
 */
export async function fetchFile(ref) {
  let url;
  if (ref.cmid) url = `${BASE}/mod/resource/view.php?id=${Number(ref.cmid)}&redirect=1`;
  else if (ref.folderZip) url = `${BASE}/mod/folder/download_folder.php?id=${Number(ref.folderZip)}`;
  else url = moodleUrl(ref.url);
  if (!url) throw new Error('adresse refusée');
  await ensureSession();
  const res = await http(url);
  const path = await loginCheck(res);
  if (!res.ok) throw new Error(`Moodle répond ${res.status}`);
  if (!path.startsWith('/pluginfile.php') && !path.startsWith('/mod/folder/download_folder.php') && !path.startsWith('/draftfile.php')) {
    throw new Error('ce fichier ne s’ouvre que sur Moodle');
  }
  const bytes = res.bytes();
  if (bytes.length > MAX_FILE) throw new Error('fichier trop lourd');
  return { bytes, name: ref.name || nameFromUrl(res.url) || 'fichier' };
}

// ------------------------------------------------------------------ catalogue et inscription

/**
 * Semestres d'une classe (deux par année : FIE1 → S1 et S2, FIA4 → S7 et S8) et celui en cours
 * (août → janvier : impair ; février → juillet : pair).
 */
export function semestersOf(promo, date = new Date()) {
  const n = Number(/(\d)/.exec(promo ?? '')?.[1]);
  if (!n) return null;
  const m = date.getMonth();
  const odd = m >= 7 || m === 0;
  return { list: [2 * n - 1, 2 * n], current: odd ? 2 * n - 1 : 2 * n };
}

const CAT_ROOT_RE = /informatique pour la sant/i;

/** « cycle Ingénieur FIE3, 1ère année, semestre 5 », « ISIS-FIA4-SEMESTRE7 » → { promo, semester }. */
export function promoOfCategory(path = '') {
  const p = /\b(FI[AE]\d)\b/i.exec(path)?.[1]?.toUpperCase() ?? (/\bE(\d)-/.exec(path) ? `FIE${/\bE(\d)-/.exec(path)[1]}` : '');
  const s = /semestre\s*(\d+)/i.exec(path)?.[1] ?? '';
  return { promo: p || 'Transversal', semester: s ? Number(s) : null };
}

/**
 * Cours ISIS visibles sur Moodle (catégorie « Informatique pour la santé » et ses sous-catégories),
 * avec leurs modes d'inscription tels que Moodle les annonce (cache 24 h).
 */
export function catalog({ force = false } = {}) {
  return cached('moodle:catalog', 24 * HOUR, async () => {
    const root = await page('/course/index.php');
    const rootLink = [...root.doc.querySelectorAll('a[href*="categoryid="]')].find((a) => CAT_ROOT_RE.test(textOf(a)));
    const rootId = idOf(rootLink?.getAttribute('href') ?? '', 'categoryid') ?? 3;
    const out = new Map();
    const queue = [{ id: rootId, path: [] }];
    let guard = 0;
    while (queue.length && guard++ < 60) {
      const batch = queue.splice(0, 6);
      const pages = await Promise.all(batch.map((c) => page(`/course/index.php?categoryid=${c.id}&perpage=all`).then((p) => ({ c, doc: p.doc }))));
      for (const { c, doc } of pages) {
        for (const sub of doc.querySelectorAll('.subcategories .category')) {
          const sid = Number(sub.dataset.categoryid);
          if (sid) queue.push({ id: sid, path: [...c.path, textOf(sub.querySelector('.categoryname'))] });
        }
        for (const box of doc.querySelectorAll('.courses .coursebox')) {
          const id = Number(box.dataset.courseid);
          if (!id || out.has(id)) continue;
          const icons = [...box.querySelectorAll('.enrolmenticons img, .enrolmenticons i, .enrolmenticons [title]')].map((i) => i.getAttribute('title') || i.getAttribute('aria-label') || '').join(' ');
          const category = c.path.at(-1) ?? '';
          out.set(id, {
            id,
            fullname: visibleText(box.querySelector('.coursename')),
            category,
            path: c.path.join(' › '),
            ...promoOfCategory(c.path.join(' ')),
            self: /auto-inscription|self/i.test(icons),
            guest: /anonyme|invité|guest/i.test(icons),
            teachers: [...box.querySelectorAll('.teachers li')].map((li) => clean(textOf(li).replace(/^[^:]*:\s*/, ''))).slice(0, 4),
            url: `${BASE}/course/view.php?id=${id}`,
          });
        }
      }
    }
    return [...out.values()];
  }, { force });
}

/** Page d'inscription d'un cours : résumé, enseignants, et ce que Moodle permet (cache 10 min). */
export function parseEnrol(doc) {
  const box = doc.querySelector('.coursebox');
  const forms = [...doc.querySelectorAll('[role="main"] form')];
  const self = forms.find((f) => f.querySelector('input[name^="_qf__"][name$="_enrol_self_enrol_form"]'));
  const guest = forms.find((f) => f.querySelector('input[name^="_qf__"][name$="_enrol_guest_enrol_form"]'));
  const teachers = [...(box?.querySelectorAll('.teachers li') ?? [])].map((li) => ({ role: clean(textOf(li).split(':')[0]), name: clean(textOf(li).replace(/^[^:]*:\s*/, '')) }));
  const notices = [...doc.querySelectorAll('[role="main"] .box.generalbox, [role="main"] .alert')].map(textOf).filter((t) => t && t.length < 300);
  return {
    fullname: visibleText(box?.querySelector('.coursename')) || clean(doc.title.replace(/\s*\|\s*Moodle\s*$/i, '')),
    summary: inner(box?.querySelector('.summary .no-overflow, .summary')) || '',
    teachers,
    self: self ? { instance: Number(self.querySelector('input[name="instance"]')?.value) || null, key: Boolean(self.querySelector('input[name="enrolpassword"]')), label: textOf(self.querySelector('legend, .fheader, h3')) } : null,
    guestKey: Boolean(guest),
    message: notices.find((t) => /inscri|enrol/i.test(t)) ?? '',
  };
}

export function enrolInfo(courseId, { force = false } = {}) {
  return cached(`moodle:enrol:${courseId}`, 10 * MIN, async () => parseEnrol((await page(`/enrol/index.php?id=${Number(courseId)}`)).doc), { force });
}

/**
 * Inscription libre (avec la clé si l'enseignant en demande une), par le formulaire de Moodle,
 * exactement comme le bouton « M'inscrire ». Rend true, ou lève une erreur avec le message de Moodle.
 */
export async function selfEnrol(courseId, key = '') {
  const id = Number(courseId);
  const { doc } = await page(`/enrol/index.php?id=${id}`);
  const form = [...doc.querySelectorAll('[role="main"] form')].find((f) => f.querySelector('input[name$="_enrol_self_enrol_form"]'));
  if (!form) throw new Error('ce cours n’accepte pas l’auto-inscription');
  const body = new URLSearchParams();
  for (const input of form.querySelectorAll('input[type="hidden"]')) body.append(input.name, input.value);
  if (form.querySelector('input[name="enrolpassword"]')) body.append('enrolpassword', key);
  const submit = form.querySelector('input[type="submit"][name], button[type="submit"][name]');
  body.append(submit?.getAttribute('name') || 'submitbutton', submit?.value || 'M’inscrire');
  if (Number(body.get('id')) !== id) throw new Error('formulaire inattendu');
  const res = await http(`${BASE}/enrol/index.php`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  const path = await loginCheck(res);
  if (path.startsWith('/course/view.php')) {
    forget('moodle:enrolled');
    forget(`moodle:course:${id}`);
    forget(`moodle:enrol:${id}`);
    forget('moodle:deadlines');
    return true;
  }
  const after = parse(stripStyles(await res.text()));
  const err = textOf(after.querySelector('#id_error_enrolpassword, .form-control-feedback.invalid-feedback, .error, .alert-danger'));
  throw new Error(err || 'Moodle a refusé l’inscription');
}

export { NotSignedIn };
