// Moodle dans le Hub : accueil « Moodle » (cours du moment, mes cours, autres cours ISIS) et page
// d'un cours (sections repliables, fichiers, dossiers, devoirs, QCM, liens), plein écran.
//
// Lecture seule, sauf l'inscription libre (le formulaire « M'inscrire » de Moodle). Déposer un devoir,
// passer un QCM, écrire dans un forum : sur Moodle, dans un nouvel onglet. Fichiers et images : lus par
// le tunnel chiffré, affichés seulement s'ils sont reconnus (PDF, images), sinon téléchargés.

import { $, $$, h, icon, toast, restartClass, clipFrom, lockScroll, motionOK, isTyping, EASE, EASE_IO } from '../core/dom.js';
import * as moodle from '../portals/moodle.js';
import * as MC from '../portals/moodle-course.js';
import { semestersOf } from '../portals/moodle-course.js';
import { HOSTS, NotSignedIn } from '../portals/config.js';
import { normalize, codeOfCourse } from '../portals/match.js';
import { rich, loadImages, linksOnly, plainText } from './moodle-rich.js';
import { createAttachmentViewer } from './attachments.js';
import { rendusList, onRendus } from '../core/rendus.js';
import * as UD from '../core/userdata.js';

const DAY = 864e5;
const JOURS = ['dim.', 'lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.'];
const MOIS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
const PREVIEW = new Set(['pdf', 'png', 'jpg', 'jpeg', 'gif', 'webp']);
const HEAVY = new Set(['mp4', 'mov', 'avi', 'mkv', 'webm', 'mp3', 'wav', 'm4a', 'video', 'audio']);
const KIND = { pdf: 'pdf', zip: 'zip', rar: 'zip', '7z': 'zip', gz: 'zip', tar: 'zip', ipynb: 'code', py: 'code', r: 'code', sql: 'code', js: 'code', html: 'code', htm: 'code', java: 'code', c: 'code', cpp: 'code', code: 'code', csv: 'data', json: 'data', xlsx: 'data', xls: 'data', ods: 'data', xml: 'data', hl7: 'data', txt: 'doc', md: 'doc', doc: 'doc', docx: 'doc', odt: 'doc', rtf: 'doc', ppt: 'slide', pptx: 'slide', odp: 'slide', png: 'img', jpg: 'img', jpeg: 'img', svg: 'img', gif: 'img', webp: 'img', mp4: 'img', mp3: 'img' };
const OTHER = { forum: ['Forum', 'chat'], quiz: ['QCM', 'quiz'], lesson: ['Leçon', 'book'], choice: ['Sondage', 'quiz'], feedback: ['Questionnaire', 'quiz'], questionnaire: ['Questionnaire', 'quiz'], h5pactivity: ['Activité interactive', 'spark'], hvp: ['Activité interactive', 'spark'], workshop: ['Atelier', 'pen'], scorm: ['Module SCORM', 'book'], wiki: ['Wiki', 'doc'], glossary: ['Glossaire', 'book'], page: ['Page', 'doc'], book: ['Livre', 'book'], url: ['Lien', 'link'], lti: ['Outil externe', 'ext'], data: ['Base de données', 'doc'], chat: ['Chat', 'chat'], bigbluebuttonbn: ['Classe virtuelle', 'chat'], attendance: ['Présences', 'check'], assign: ['Devoir', 'upload'], resource: ['Fichier', 'doc'], folder: ['Dossier', 'folder'], label: ['Texte', 'doc'] };
const SEEN_MAX = 20; // cours retenus pour « nouveau depuis ta dernière visite »

const extOf = (n) => ((/\.([a-z0-9]{1,6})(?:[?#]|$)/i.exec(n || '') || [])[1] || '').toLowerCase();
const fSize = (b) => (!b ? '' : b < 1024 ? `${b} o` : b < 1048576 ? `${Math.round(b / 1024)} Ko` : `${(b / 1048576).toFixed(1).replace('.', ',')} Mo`);
const day0 = (t) => {
  const d = new Date(t);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
};
const fDate = (t) => {
  const d = new Date(t);
  return `${JOURS[d.getDay()]} ${d.getDate()} ${MOIS[d.getMonth()]}${d.getFullYear() !== new Date().getFullYear() ? ` ${d.getFullYear()}` : ''}`;
};
const fTime = (t) => {
  const d = new Date(t);
  return `${d.getHours()} h ${String(d.getMinutes()).padStart(2, '0')}`.replace(' h 00', ' h');
};
const hourOf = (min) => `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, '0')}`.replace(' h 00', ' h');

/** Libellé d'échéance, le même partout (tuile, accueil, page du cours). */
export function relLabel(t, now = Date.now()) {
  const days = Math.round((day0(t) - day0(now)) / DAY);
  if (t < now) return days === 0 ? 'En retard' : `En retard · ${-days} j`;
  if (days === 0) return 'Aujourd’hui';
  if (days === 1) return 'Demain';
  if (days < 14) return `Dans ${days} j`;
  return days < 60 ? `Dans ${Math.round(days / 7)} sem.` : `Dans ${Math.round(days / 30)} mois`;
}

/** « FIA4-1-ISI-3 - Développement mobile » → « Développement mobile ». */
export const cleanName = (n) =>
  String(n || '')
    .replace(/^(?:[A-Z0-9][\w.]*(?:-[\w.]+)*|FI[AE]\s?\d)\s+-\s+|^[A-Z]{1,5}\d[\w.]*(?:-[\w.]+){2,}\s+(?=\S)/, '')
    .trim() || String(n || '');
// Code du cours (« FIA4-1-ISI-3 »), seulement s'il a la forme d'un code.
const CODE_RE = /^[A-Z]{1,5}\d[\w.]*(?:-[\w.]+){1,5}$/i;
const codeOf = (c) => [c?.shortname, c?.fullname].map((x) => String(x || '').split(' - ')[0].trim()).find((x) => CODE_RE.test(x)) ?? '';
const semOf = (cat) => {
  const m = /semestre\s*(\d+)/i.exec(cat || '');
  return m ? `Semestre ${m[1]}` : '';
};
const avatarText = (c) => {
  const code = codeOf(c);
  const part = code.split('-').filter((x) => x && !/^(FI[AE]\d|E\d|\d+|ISIS|LANG)$/i.test(x))[0];
  if (part) return part.slice(0, 3).toUpperCase();
  return cleanName(c?.fullname).split(/\s+/).filter((w) => w.length > 2).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || 'M';
};
const pat = (id) => `pat-${Number(id) % 6}`;
const pill = (kind, text) => h('span.npill', { class: `npill--${kind}`, text });
const splitTitle = (t) => {
  const m = /^(.{2,28}?)\s*:\s*(.+)$/.exec(t || '');
  return m ? [m[1], m[2]] : [null, t];
};

/** État d'un devoir d'après la page du cours, le calendrier et (quand elle est lue) sa page. */
export function assignState(it, det, dl, now = Date.now()) {
  const dates = det?.dates?.length ? det.dates : it.dates;
  const due = MC.dueOf(dates);
  const open = MC.openOf(dates);
  const sub = det ? det.submitted : dl?.status === 'done';
  const graded = Boolean(det?.graded);
  let kind = 'todo';
  if (sub) kind = graded ? 'graded' : 'done';
  else if (open && open > now) kind = 'soon';
  else if (due && due < now) kind = 'late';
  else if (due && due - now < 4 * DAY) kind = 'urgent';
  return { due, open, sub, graded, kind, known: Boolean(det) || Boolean(dl) };
}

export function quizState(it, det, now = Date.now()) {
  const dates = det?.dates?.length ? det.dates : it.dates;
  const open = MC.openOf(dates);
  const close = MC.dueOf(dates);
  const allowedTxt = Object.entries(det?.settings ?? {}).find(([k]) => /tentatives autoris|attempts allowed/i.test(k))?.[1] ?? '';
  const allowed = /^\d+$/.test(allowedTxt) ? Number(allowedTxt) : null;
  const tries = det?.attempts?.length ?? 0;
  let kind = 'todo';
  if (close && close < now) kind = 'closed';
  else if (open && open > now) kind = 'soon';
  else if (tries) kind = 'done';
  else if (close && close - now < 4 * DAY) kind = 'urgent';
  return { open, due: close, allowed, tries, kind, left: allowed ? Math.max(0, allowed - tries) : null };
}

const STATE_PILL = { done: 'ok', graded: 'ok', soon: 'none', late: 'fail', urgent: 'warn', todo: 'none', closed: 'none' };

// ------------------------------------------------------------------ « vu » (nouveautés)

function seenAll() {
  const s = UD.get('cours');
  return s && typeof s === 'object' && !Array.isArray(s) ? s : {};
}
function setSeen(courseId, ids) {
  const all = { ...seenAll(), [courseId]: { at: Date.now(), ids: [...ids].slice(0, 300) } };
  const keys = Object.keys(all).sort((a, b) => (all[b]?.at ?? 0) - (all[a]?.at ?? 0));
  for (const k of keys.slice(SEEN_MAX)) delete all[k];
  UD.set('cours', all);
}

// ------------------------------------------------------------------ vue

export function createMoodleView({ app, schedule, matcher, notes, promo, isSignedIn, onSessionLost, onEnrolled, onWrite, beforeOpen }) {
  const viewer = createAttachmentViewer();
  const bento = $('.bento');

  // ---- squelette (construit ici : aucune chaîne HTML)
  const searchInput = h('input', { type: 'search', placeholder: 'Chercher un cours, un fichier, un devoir…', autocomplete: 'off', attrs: { role: 'combobox', 'aria-expanded': 'false', 'aria-controls': 'mc-results', 'aria-autocomplete': 'list', enterkeyhint: 'search' } });
  const results = h('div.mc-results', { id: 'mc-results', hidden: true, attrs: { role: 'listbox', 'aria-label': 'Résultats' } });
  const searchBox = h('div.mc-searchbox', {}, h('label.search.mc-search', {}, icon('search', 'ic ic--sm'), h('span.sr-only', { text: 'Chercher un cours, un fichier, un devoir' }), searchInput, h('span.kbd', { text: '/', attrs: { 'aria-hidden': 'true' } })), results);
  const pop = h('div.mc-pop', { hidden: true });
  const title = h('h1.nv-title.mc-title', { id: 'mc-title', text: 'Moodle' });
  const moodleLink = h('a.btn.btn--sm.mc-moodle', { href: `${HOSTS.moodle}/my/courses.php`, target: '_blank', rel: 'noopener', attrs: { 'aria-label': 'Ouvrir Moodle (nouvel onglet)' } }, icon('ext', 'ic ic--sm'), h('span.label-md', { text: 'Ouvrir dans Moodle' }));
  const closeBtn = h('button.btn.btn--sm.fs-x', { type: 'button', attrs: { 'aria-label': 'Fermer Moodle et revenir au tableau de bord' } }, icon('x', 'ic ic--sm'), h('span.fs-x-l', { text: 'Fermer' }));
  const backBtn = h('button.icon-btn.mc-back', { type: 'button', attrs: { 'aria-label': 'Revenir à mes cours' } }, icon('back', 'ic ic--sm'));
  const chips = h('nav.mc-chips', { attrs: { 'aria-label': 'Sections du cours' } });
  const homeBody = h('div.mc-home');
  const main = h('div.mc-main');
  const courseBody = h('div.mc-page', { hidden: true }, main);
  const scroll = h('div.mc-scroll', {}, homeBody, courseBody);
  const view = h(
    'section.mcourse',
    { hidden: true, attrs: { 'aria-labelledby': 'mc-title' } },
    h('header.nv-bar.mc-bar', {}, backBtn, h('span.tile-icon.mc-bar-ic', {}, icon('book', 'ic ic--sm')), h('div.mc-titlewrap', {}, title, pop), h('span.spacer'), moodleLink, closeBtn),
    chips,
    scroll,
  );
  ($('[data-notes-view]') ?? $('.toast')).after(view);

  // ---- état
  let enrolled = []; // cours suivis (portals/moodle.js)
  let enrolledById = new Map();
  const contents = new Map(); // id → contenu lu
  const details = new Map(); // cmid → détails d'un devoir / QCM
  let catalogList = null;
  let catalogLoading = null;
  let isOpen = false;
  let mode = 'home';
  let curId = null;
  let opener = null;
  let depth = 0;
  let skipPop = false;
  let spy = null;
  let catFilter = 'Tous';
  let homeOtherOpen = false;
  let semShown = null; // semestre affiché dans « Ma classe »
  let token = 0;

  const now = () => Date.now();
  const enrolledIds = () => enrolled.map((c) => c.id);
  const isEnrolled = (id) => enrolledById.has(Number(id));
  const nameOf = (id) => cleanName(enrolledById.get(Number(id))?.fullname || contents.get(Number(id))?.fullname || catalogList?.find((c) => c.id === Number(id))?.fullname || '');
  const sorted = () => [...enrolled].sort((a, b) => normalize(cleanName(a.fullname)).localeCompare(normalize(cleanName(b.fullname)), 'fr'));

  // ---- rendus du calendrier, par cours (tuile « Prochains rendus »)
  const deadlinesOf = (id) => rendusList().filter((r) => MC.courseIdOf(r.courseUrl) === Number(id));
  const deadlineOfCm = (cmid) => rendusList().find((r) => MC.cmIdOf(r.url) === Number(cmid));
  const lateOf = (id) => deadlinesOf(id).filter((r) => r.status === 'late').length;

  // ---- nouveautés
  const visible = (S) => S.items.filter((it) => !it.hidden && !(it.type === 'label' && !it.html));
  function itemIds(d) {
    return d.sections.flatMap((S) => S.items.map((it) => it.id));
  }
  function isNew(id, it) {
    const s = seenAll()[id];
    return Boolean(s) && !s.ids.includes(it.id) && it.type !== 'label';
  }
  function newCount(id) {
    const d = contents.get(Number(id));
    return d ? d.sections.flatMap(visible).filter((it) => isNew(id, it)).length : 0;
  }
  function baseline(id, d) {
    if (!seenAll()[id]) setSeen(id, itemIds(d)); // première lecture : rien n'est « nouveau »
  }
  function markSeen(id) {
    const d = contents.get(Number(id));
    if (d && isEnrolled(id)) setSeen(id, itemIds(d));
  }

  // ---- emploi du temps : séance liée à un cours
  function linkedSessions() {
    if (!schedule) return [];
    return schedule
      .upcoming(new Date(), 21)
      .map((ev) => ({ ev, found: matcher.get(ev) }))
      .filter((x) => x.found);
  }
  function sessionText(ev) {
    const t = now();
    const live = ev.start <= t && t < ev.end;
    const room = ev.room ? ` · ${ev.room}` : '';
    if (live) return { live, txt: `En cours${room} · jusqu’à ${hourOf(ev.endMin)}` };
    const today = day0(t) === day0(ev.start);
    return { live, txt: `${today ? 'Aujourd’hui' : fDate(ev.start)} à ${hourOf(ev.startMin)}${room}` };
  }
  function nextSession(id) {
    const x = linkedSessions().find(({ found }) => found.course.id === Number(id));
    return x ? sessionText(x.ev) : null;
  }
  function courseNow() {
    const list = linkedSessions();
    const t = now();
    const x = list.find(({ ev }) => ev.start <= t && t < ev.end) || list.find(({ ev }) => ev.start > t);
    return x ? { id: x.found.course.id, ev: x.ev, approx: x.found.approx, ...sessionText(x.ev) } : null;
  }

  // ------------------------------------------------------------------ chargements

  async function loadEnrolled(force = false) {
    enrolled = await moodle.enrolledCourses({ force });
    enrolledById = new Map(enrolled.map((c) => [c.id, c]));
    return enrolled;
  }

  async function loadContent(id, force = false) {
    const d = await MC.courseContent(Number(id), { force });
    contents.set(Number(id), d);
    if (isEnrolled(id)) baseline(Number(id), d);
    INDEX = null;
    return d;
  }

  /** Tous les cours suivis, en arrière-plan (nouveautés, recherche) : 3 à la fois. */
  let warming = null;
  function warmAll() {
    warming ??= (async () => {
      const ids = enrolledIds().filter((id) => !contents.has(id));
      let i = 0;
      const worker = async () => {
        while (i < ids.length) {
          const id = ids[i++];
          try {
            await loadContent(id);
            if (isOpen && mode === 'home') refreshHomeRow(id);
          } catch (err) {
            if (err instanceof NotSignedIn) throw err;
          }
        }
      };
      await Promise.all([worker(), worker(), worker()]);
      if (isOpen && mode === 'home') renderNowCard();
      if (!results.hidden) renderResults();
      renderTileBadges();
    })()
      .catch((err) => err instanceof NotSignedIn && onSessionLost('moodle'))
      .finally(() => (warming = null));
    return warming;
  }

  function loadCatalog() {
    if (catalogList) return Promise.resolve(catalogList);
    catalogLoading ??= MC.catalog()
      .then((list) => (catalogList = list))
      .catch((err) => {
        if (err instanceof NotSignedIn) onSessionLost('moodle');
        catalogList = null;
        throw err;
      })
      .finally(() => (catalogLoading = null));
    return catalogLoading;
  }
  const others = () => (catalogList ?? []).filter((c) => !isEnrolled(c.id)).sort((a, b) => normalize(cleanName(a.fullname)).localeCompare(normalize(cleanName(b.fullname)), 'fr'));
  const catLabel = (c) => [c.promo, c.semester && `Semestre ${c.semester}`].filter(Boolean).join(' · ');

  // ------------------------------------------------------------------ fichiers

  const refs = new WeakMap(); // bouton → { name, ext, size, load }
  const fxBadge = (ext) => h('span.fx', { class: `fx--${KIND[ext] || 'doc'}`, text: (ext || 'fic').slice(0, 4).toUpperCase(), attrs: { 'aria-hidden': 'true' } });

  function fileRow({ name, ext, size, load, sub }, small = false, fresh = false) {
    const e = ext || extOf(name);
    const canView = PREVIEW.has(e);
    const t = h('span.mc-it-t', {}, h('b', {}, name, fresh ? newTag() : null));
    const meta = sub ?? [e ? e.toUpperCase() : 'Fichier', fSize(size)].filter(Boolean).join(' · ');
    if (!small || meta) t.append(h('span', { text: meta }));
    const main = h('button.mc-file', { type: 'button', class: small ? 'mc-file--sm' : '', attrs: { 'aria-label': `${canView ? 'Ouvrir' : 'Télécharger'} ${name}${size ? `, ${fSize(size)}` : ''}` } }, fxBadge(e), t, icon(canView ? 'eye' : 'download', 'ic ic--sm mc-dl'));
    refs.set(main, { name, ext: e, size, load, view: canView });
    if (!canView) return main;
    const dl = h('button.icon-btn.mc-dlbtn', { type: 'button', attrs: { 'aria-label': `Télécharger ${name}` } }, icon('download', 'ic ic--sm'));
    refs.set(dl, { name, ext: e, size, load, view: false });
    return h('div.mc-filewrap', {}, main, dl);
  }

  function openFile(btn) {
    const ref = refs.get(btn);
    if (!ref) return;
    if (ref.view) viewer.viewFile({ name: ref.name, size: ref.size, load: ref.load });
    else viewer.downloadFile({ name: ref.name, load: ref.load }, btn);
  }

  const newTag = () => h('span.mc-new', { text: 'Nouveau' });

  // ------------------------------------------------------------------ éléments d'un cours

  function itemEl(it, cid, { guest = false } = {}) {
    const li = h('li.mc-it', { class: `mc-it--${it.type}`, id: `mc-i-${it.id}` });
    const fresh = cid && !guest && isNew(cid, it);
    if (it.restricted) {
      li.classList.add('mc-locked');
      li.append(icon('lock', 'ic ic--sm'), h('span.mc-it-t', {}, h('b', { text: it.name || OTHER[it.type]?.[0] || 'Activité' }), h('span', { text: it.restriction || 'Pas encore disponible' })));
      return li;
    }
    if (it.type === 'label') {
      const links = linksOnly(it.html);
      if (links?.length) {
        li.append(
          h('div.mc-links', { attrs: { role: 'list' } }, ...links.map((l) => {
            const a = h('a.mc-linkchip', { href: MC.moodleUrl(l.url) || MC.webUrl(l.url), target: '_blank', rel: 'noopener noreferrer', attrs: { role: 'listitem' } }, l.name, icon('ext', 'ic ic--xs'));
            return a;
          })),
        );
      } else {
        const r = rich(it.html);
        if (!r) return null;
        li.append(h('div.mc-label.mc-rich', {}, r));
      }
      return li;
    }
    if (it.type === 'resource') {
      const ext = it.file?.ext || '';
      if (HEAVY.has(ext)) return otherEl(it, li, fresh);
      li.append(fileRow({ name: it.name || 'Fichier', ext, size: it.file?.size, load: () => MC.fetchFile({ cmid: it.id }) }, false, fresh));
      const r = rich(it.html);
      if (r) li.append(h('div.mc-desc.mc-rich', {}, r));
      return li;
    }
    if (it.type === 'folder') return folderEl(it, li, fresh);
    if (it.type === 'assign' && !guest) return assignEl(it, li, fresh, cid);
    if (it.type === 'quiz' && !guest) return quizEl(it, li, fresh);
    return otherEl(it, li, fresh);
  }

  function folderEl(it, li, fresh) {
    const det = h('details.mc-folder');
    const files = it.folder?.files;
    if ((it.folder?.inline && (files?.length ?? 0) <= 3) || fresh) det.open = true;
    const count = h('span', { text: files ? `Dossier · ${files.length} fichier${files.length > 1 ? 's' : ''}` : 'Dossier' });
    det.append(h('summary.mc-folder-h', {}, h('span.fx.fx--folder', {}, icon('folder', 'ic ic--sm')), h('span.mc-it-t', {}, h('b', {}, it.name || 'Dossier', fresh ? newTag() : null), count), icon('chevDown', 'ic ic--sm mc-chev')));
    const ul = h('ul.mc-tree');
    det.append(ul);
    const fill = (list) => {
      ul.replaceChildren(
        ...[
          ...list.map((f) => h('li', {}, fileRow({ name: f.name, load: () => MC.fetchFile({ url: f.url, name: f.name }) }, true))),
          list.length > 1 && h('li', {}, zipBtn(it)),
          !list.length && h('li.mc-meta.mc-tree-none', { text: 'Dossier vide.' }),
        ].filter(Boolean),
      );
      count.textContent = `Dossier · ${list.length} fichier${list.length > 1 ? 's' : ''}`;
    };
    if (files) fill(files);
    else {
      const load = () => {
        if (ul.dataset.loaded) return;
        ul.dataset.loaded = '1';
        ul.replaceChildren(h('li.mc-meta.mc-tree-none', {}, h('span.spinner'), ' Lecture du dossier…'));
        MC.folderContent(it.id)
          .then(fill)
          .catch((err) => {
            delete ul.dataset.loaded;
            if (err instanceof NotSignedIn) return onSessionLost('moodle');
            ul.replaceChildren(h('li', {}, zipBtn(it)), h('li.mc-meta.mc-tree-none', { text: `Liste indisponible : ${err.message}` }));
          });
      };
      det.addEventListener('toggle', () => det.open && load());
      if (det.open) load();
    }
    li.append(det);
    return li;
  }

  function zipBtn(it) {
    const b = h('button.mc-zip', { type: 'button' }, icon('download', 'ic ic--sm'), 'Tout télécharger (.zip)');
    refs.set(b, { name: `${it.name || 'dossier'}.zip`, load: () => MC.fetchFile({ folderZip: it.id, name: `${it.name || 'dossier'}.zip` }), view: false });
    return b;
  }

  function otherEl(it, li, fresh) {
    const [lab, ic] = OTHER[it.type] ?? [it.type === 'unknown' ? 'Activité' : it.type, 'ext'];
    const due = MC.dueOf(it.dates);
    const closed = (it.type === 'feedback' || it.type === 'questionnaire' || it.type === 'choice') && due && due < now();
    const isUrl = it.type === 'url';
    const href = isUrl && it.url ? `${it.url}${it.url.includes('?') ? '&' : '?'}redirect=1` : it.url || moodleLink.href;
    const sub = h('span', { text: [lab, closed ? `fermé le ${fDate(due)}` : due ? `jusqu’au ${fDate(due)}` : isUrl ? 'site externe' : 's’ouvre dans Moodle'].join(' · ') });
    const a = closed ? h('div.mc-ext.is-closed') : h('a.mc-ext', { href, target: '_blank', rel: isUrl ? 'noopener noreferrer' : 'noopener' });
    a.append(h('span.mc-ext-ic', { class: `mc-ext-ic--${it.type}` }, icon(ic, 'ic ic--sm')), h('span.mc-it-t', {}, h('b', {}, it.name || lab, fresh ? newTag() : null), sub), icon(closed ? 'lock' : 'ext', 'ic ic--sm mc-dl'));
    if (!closed) a.setAttribute('aria-label', `${it.name || lab}, ${lab} : ${isUrl ? 'ouvrir le site' : 'ouvrir dans Moodle'} (nouvel onglet)`);
    li.append(a);
    const r = rich(it.html);
    if (r && it.type !== 'url') li.append(h('div.mc-desc.mc-rich', {}, r));
    if (isUrl && it.id) {
      // Adresse réelle lue en arrière-plan : le lien va alors directement au site.
      MC.urlTarget(it.id)
        .then((target) => {
          if (!target || !a.isConnected) return;
          a.href = target;
          const host = new URL(target).hostname.replace(/^www\./, '');
          sub.textContent = `Lien · ${host}`;
          a.setAttribute('aria-label', `${it.name || 'Lien'} : ouvrir ${host} (nouvel onglet)`);
        })
        .catch(() => {});
    }
    return li;
  }

  function cardHead(li, kicker, icn, name, dueTxt, pillKind, pillTxt, fresh) {
    li.append(
      h(
        'div.mc-asg-h',
        {},
        h('span.mc-asg-ic', {}, icon(icn, 'ic ic--sm')),
        h('div.mc-asg-t', {}, h('p.mc-asg-k', { text: kicker }), h('h4', {}, name, fresh ? newTag() : null), dueTxt ? h('p.mc-due', { text: dueTxt }) : null),
        pillTxt ? pill(pillKind, pillTxt) : h('span.spinner.mc-asg-spin', { attrs: { 'aria-label': 'Lecture…' } }),
      ),
    );
  }

  function disclose(label, content, open, extra) {
    const d = h('details.mc-dd', { open });
    d.append(h('summary', {}, icon('chevDown', 'ic ic--sm mc-chev'), h('span.mc-dd-l', { text: label }), extra), h('div.mc-dd-b', {}, ...content));
    return d;
  }

  function needDetails(it) {
    if (details.has(it.id) || details.get(`p${it.id}`)) return;
    details.set(`p${it.id}`, true);
    const get = it.type === 'quiz' ? MC.quizDetails(it.id) : MC.assignDetails(it.id);
    get
      .then((det) => {
        details.set(it.id, det);
        const old = document.getElementById(`mc-i-${it.id}`);
        if (!old || !curId) return;
        const fresh = old.querySelector('.mc-new') !== null;
        const li = h('li.mc-it', { class: `mc-it--${it.type}`, id: `mc-i-${it.id}` });
        const el = it.type === 'quiz' ? quizEl(it, li, fresh) : assignEl(it, li, fresh, curId);
        old.replaceWith(el);
        loadImages(el);
        refreshTodo();
      })
      .catch((err) => {
        details.delete(`p${it.id}`);
        if (err instanceof NotSignedIn) onSessionLost('moodle');
        const old = document.getElementById(`mc-i-${it.id}`);
        const spin = old?.querySelector('.mc-asg-spin');
        if (spin) spin.replaceWith(pill('none', 'Détails indisponibles'));
      });
  }

  function assignEl(it, li, fresh, cid) {
    const det = details.get(it.id);
    const s = assignState(it, det, deadlineOfCm(it.id));
    li.classList.add('mc-asg', `is-${s.kind}`);
    const dueTxt = [s.due && `À rendre le ${fDate(s.due)} à ${fTime(s.due)}`, s.kind === 'soon' && s.open && `ouvre le ${fDate(s.open)}`].filter(Boolean).join(' · ');
    const pillTxt = !s.known ? '' : s.sub ? (s.graded ? (/^[\d.,]+\s*(\/\s*[\d.,]+)?$/.test(det?.grade ?? '') ? `Noté · ${det.grade.replace(/\s+/g, '')}` : 'Noté') : 'Rendu') : s.kind === 'soon' ? 'Pas encore ouvert' : s.due ? relLabel(s.due) : 'À rendre';
    cardHead(li, 'Devoir', s.sub ? 'check' : 'upload', it.name, dueTxt, STATE_PILL[s.kind], pillTxt, fresh);
    if (!det) {
      needDetails(it);
      return li;
    }
    const parts = [];
    const cons = rich(det.html);
    if (cons || det.introFiles.length) {
      const box = [];
      if (cons) box.push(h('div.mc-rich', {}, cons));
      if (det.introFiles.length) box.push(h('ul.mc-tree.mc-tree--flat', {}, ...det.introFiles.map((f) => h('li', {}, fileRow({ name: f.name, load: () => MC.fetchFile({ url: f.url, name: f.name }) }, true)))));
      const short = plainText(det.html).length < 260 && !det.introFiles.length;
      parts.push(disclose('Consignes', box, !s.sub && short, det.introFiles.length ? h('span.mc-dd-n', { text: `${det.introFiles.length} fichier${det.introFiles.length > 1 ? 's' : ''}` }) : null));
    }
    if (s.sub || det.submittedFiles.length || det.onlineHtml) {
      const box = [];
      if (det.submittedFiles.length) {
        box.push(h('ul.mc-tree.mc-tree--flat', {}, ...det.submittedFiles.map((f) => h('li', {}, fileRow({ name: f.name, load: () => MC.fetchFile({ url: f.url, name: f.name }), sub: f.at ? `${fDate(f.at)}, ${fTime(f.at)}` : '' }, true)))));
      }
      const online = rich(det.onlineHtml, { headings: false });
      if (online) box.push(h('blockquote.mc-online', {}, h('span.mc-lab', { text: 'Texte en ligne' }), h('div.mc-rich', {}, online)));
      if (det.grade) {
        box.push(h('div.mc-grade', {}, h('span.mc-lab', { text: 'Note' }), h('b', { text: det.grade }), det.gradedOn ? h('span.mc-meta', { text: det.gradedOn }) : null));
      } else if (s.graded) box.push(h('p.mc-meta', { text: 'Noté : la note se consulte sur Moodle.' }));
      const comment = rich(det.comment, { headings: false });
      if (comment) box.push(h('div.mc-feedback.mc-rich', {}, comment));
      if (!box.length) box.push(h('p.mc-meta', { text: det.submission || 'Rendu enregistré.' }));
      const last = det.submittedFiles.at(-1)?.at;
      const label = `Ton rendu${det.submittedFiles.length ? ` · ${det.submittedFiles.length} fichier${det.submittedFiles.length > 1 ? 's' : ''}` : det.onlineHtml ? ' · texte en ligne' : ''}${last ? ` · ${fDate(last)}` : ''}`;
      parts.push(disclose(s.sub ? label : 'Brouillon', box, Boolean(det.grade && det.comment)));
    } else if (det.timeLeft && det.timeLeft !== '-' && s.kind !== 'soon') {
      parts.push(h('p.mc-meta', { text: det.timeLeft }));
    }
    if (parts.length) li.append(h('div.mc-asg-b', {}, ...parts));
    const closedEdit = s.sub && s.due && s.due < now();
    const lab = s.sub ? (closedEdit || !det.action ? 'Voir dans Moodle' : 'Modifier mon rendu') : s.kind === 'soon' ? 'Voir sur Moodle' : 'Déposer sur Moodle';
    const btn = h('a.btn.btn--sm', { class: s.sub || s.kind === 'soon' ? '' : 'btn--primary', href: it.url, target: '_blank', rel: 'noopener', attrs: { 'aria-label': `${lab} : ${it.name} (nouvel onglet)` } }, icon(s.sub ? (closedEdit ? 'eye' : 'pen') : 'upload', 'ic ic--sm'), lab, icon('ext', 'ic ic--xs btn-arrow'));
    li.append(h('div.mc-asg-f', {}, btn));
    return li;
  }

  function quizEl(it, li, fresh) {
    const det = details.get(it.id);
    const s = quizState(it, det);
    li.classList.add('mc-asg', 'mc-quiz', `is-${s.kind}`);
    const dueTxt = s.kind === 'soon' && s.open ? `Ouvre le ${fDate(s.open)} à ${fTime(s.open)}` : s.due ? `${s.kind === 'closed' ? 'Fermé le' : 'Ouvert jusqu’au'} ${fDate(s.due)} à ${fTime(s.due)}` : '';
    const grade = /(\d[\d,.]*\d|\d)\s*\/\s*(\d[\d,.]*\d|\d)/.exec(det?.finalGrade ?? '');
    const pillTxt = !det ? '' : s.kind === 'done' ? (grade ? `Fait · ${grade[1]}/${grade[2]}` : 'Fait') : s.kind === 'closed' ? 'Fermé' : s.kind === 'soon' ? 'Pas encore ouvert' : s.due ? relLabel(s.due) : 'À faire';
    cardHead(li, 'QCM', 'quiz', it.name, dueTxt, STATE_PILL[s.kind], pillTxt, fresh);
    if (!det) {
      needDetails(it);
      return li;
    }
    const set = det.settings;
    const facts = [Object.entries(set).find(([k]) => /temps|time limit/i.test(k))?.[1], s.allowed && (s.tries ? `${s.left} tentative${s.left > 1 ? 's' : ''} restante${s.left > 1 ? 's' : ''}` : `${s.allowed} tentative${s.allowed > 1 ? 's' : ''}`), Object.entries(set).find(([k]) => /méthode|grading method/i.test(k))?.[1]].filter(Boolean);
    const parts = [];
    if (facts.length) parts.push(h('p.mc-qline', {}, ...facts.flatMap((x, i) => (i ? [h('span.mc-sep', { text: '·' }), x] : [x]))));
    const det2 = [];
    const desc = rich(det.html);
    if (desc) det2.push(h('div.mc-rich', {}, desc));
    if (s.tries) {
      det2.push(
        h('p.mc-lab', { text: 'Tes tentatives' }),
        h('ul.mc-attempts', {}, ...det.attempts.map((a, i) => {
          const gk = Object.keys(a).find((k) => /^note|^grade/i.test(k));
          const state = Object.entries(a).find(([k]) => /état|state/i.test(k))?.[1] ?? '';
          const at = MC.parseFrDate(state);
          return h('li', {}, h('span', { text: `Tentative ${a.Tentative || a.Attempt || i + 1}` }), h('span.mc-meta', { text: at ? `${fDate(at)}, ${fTime(at)}` : state }), h('b', { text: gk ? a[gk] : '—' }));
        })),
      );
      if (det.finalGrade) det2.push(h('p.mc-meta', { text: det.finalGrade }));
    }
    if (det2.length) parts.push(disclose(s.tries ? 'Détails et tentatives' : 'Détails', det2, false));
    if (det.notice && s.kind !== 'todo') parts.push(h('p.mc-meta', { text: det.notice }));
    if (parts.length) li.append(h('div.mc-asg-b', {}, ...parts));
    if (s.kind !== 'closed' && s.left !== 0) {
      const lab = s.kind === 'soon' ? 'Voir sur Moodle' : det.button || 'Commencer le test';
      li.append(h('div.mc-asg-f', {}, h('a.btn.btn--sm', { class: s.kind === 'soon' || s.kind === 'done' ? '' : 'btn--primary', href: it.url, target: '_blank', rel: 'noopener', attrs: { 'aria-label': `${lab} : ${it.name}, sur Moodle (nouvel onglet)` } }, icon('quiz', 'ic ic--sm'), lab, icon('ext', 'ic ic--xs btn-arrow'))));
    }
    return li;
  }

  // ------------------------------------------------------------------ page d'un cours

  function todosOf(id) {
    const d = contents.get(Number(id));
    const items = new Map((d?.sections ?? []).flatMap((S) => S.items).map((it) => [it.id, it]));
    return deadlinesOf(id)
      .filter((r) => r.status !== 'done')
      .map((r) => ({ r, it: items.get(MC.cmIdOf(r.url)) ?? null }))
      .sort((a, b) => a.r.at - b.r.at);
  }

  // À l'ouverture d'un cours, toutes les sections sont dépliées (« Tout replier » au besoin).
  function sectionsToOpen(id, secs) {
    return new Set(secs.filter(({ S }) => !S.restricted).map(({ S }) => S.id));
  }

  function sectionsOf(d) {
    return d.sections
      .map((S) => ({ S, items: visible(S), summary: rich(S.summary) }))
      .filter((x) => x.items.length || x.summary || x.S.restricted);
  }

  function heroFor(id, d) {
    const c = enrolledById.get(Number(id)) ?? {};
    const name = cleanName(c.fullname || d.fullname);
    const hero = h('header.mc-hero', { class: pat(id) }, h('p.mc-kicker', { text: [semOf(c.category), codeOf(c)].filter(Boolean).join(' · ') || 'Moodle' }), h('h2', { text: name }));
    const facts = h('div.mc-facts');
    const ns = nextSession(id);
    if (ns) facts.append(h('span.mc-fact', { class: ns.live ? 'is-live' : '' }, ns.live ? h('span.live-dot') : icon('clock', 'ic ic--xs'), ns.live ? ns.txt : `Prochaine séance · ${ns.txt}`));
    const code = codeOfCourse(c);
    const mine = code && notes?.course(code);
    if (mine && Number.isFinite(mine.avg)) {
      facts.append(h('button.mc-fact.mc-fact--btn', { type: 'button', data: { mcNotes: '' } }, icon('chart', 'ic ic--xs'), `Ma moyenne ${String(Math.round(mine.avg * 100) / 100).replace('.', ',')}`, icon('chevRight', 'ic ic--xs')));
    }
    if (facts.childNodes.length) hero.append(facts);
    return hero;
  }

  function todoBox(id) {
    const todo = todosOf(id).slice(0, 3);
    if (!todo.length) return null;
    return h(
      'section.mc-todo1',
      { attrs: { 'aria-label': 'À rendre dans ce cours' } },
      ...todo.map(({ r, it }) => {
        const bucket = r.status === 'late' ? 'late' : r.at - now() <= 7 * DAY ? 'week' : 'soon';
        const b = h('button.mc-todo1-i', { type: 'button', class: `is-${bucket}`, data: { jump: it ? `mc-i-${it.id}` : '' } }, h('span.mc-due-dot'), h('span.mc-todo1-n', { text: r.name }), h('span.mc-todo1-k', { text: r.kind === 'quiz' ? 'QCM' : r.kind === 'assign' ? 'Devoir' : OTHER[r.kind]?.[0] ?? 'Activité' }), pill(bucket === 'late' ? 'fail' : bucket === 'week' ? 'warn' : 'none', relLabel(r.at)));
        if (!it && r.url) b.dataset.href = r.url;
        return b;
      }),
    );
  }
  function refreshTodo() {
    if (mode !== 'course' || !curId) return;
    const old = $('.mc-todo1', main);
    const box = todoBox(curId);
    if (old && box) old.replaceWith(box);
    else if (old) old.remove();
    else if (box) $('.mc-hero', main)?.after(box);
  }

  let openSecs = new Set();
  function renderCourse(id, d, itemId) {
    const secs = sectionsOf(d);
    openSecs = sectionsToOpen(id, secs);
    if (itemId) secs.forEach(({ S, items }) => items.some((it) => `mc-i-${it.id}` === itemId) && openSecs.add(S.id));
    const out = [heroFor(id, d)];
    const todo = todoBox(id);
    if (todo) out.push(todo);
    if (secs.length > 2) {
      out.push(h('div.mc-tools', {}, h('span.mc-meta', { text: `${secs.length} sections` }), h('button.mc-link', { type: 'button', data: { mcToggleAll: '' }, text: openSecs.size >= secs.length ? 'Tout replier' : 'Tout déplier' })));
    }
    if (!secs.length) out.push(h('p.mc-none.mc-emptycourse', { text: 'Ce cours est encore vide : l’enseignant n’a rien déposé pour l’instant.' }));
    for (const { S, items, summary } of secs) {
      const [k, ttl] = splitTitle(S.title);
      const open = openSecs.has(S.id) && !S.restricted;
      const nFiles = items.reduce((a, it) => a + (it.type === 'resource' ? 1 : it.type === 'folder' ? it.folder?.files?.length ?? 1 : 0), 0);
      const nWork = items.filter((it) => it.type === 'assign' || it.type === 'quiz').length;
      const nOther = items.filter((it) => !['label', 'resource', 'folder', 'assign', 'quiz'].includes(it.type)).length;
      const nNew = items.filter((it) => isNew(id, it)).length;
      const meta = h('span.mc-sec-m');
      if (S.restricted) meta.append(icon('lock', 'ic ic--xs'), S.restriction || 'Verrouillée');
      else meta.append([nFiles && `${nFiles} fichier${nFiles > 1 ? 's' : ''}`, nWork && `${nWork} devoir${nWork > 1 ? 's' : ''} ou QCM`, nOther && `${nOther} lien${nOther > 1 ? 's' : ''} ou activité${nOther > 1 ? 's' : ''}`].filter(Boolean).join(' · ') || 'Texte');
      if (nNew) meta.append(h('span.mc-new', { text: `${nNew} nouveau${nNew > 1 ? 'x' : ''}` }));
      const head = h('button.mc-sec-h', { type: 'button', data: { secToggle: S.id }, attrs: { 'aria-expanded': String(open), 'aria-controls': `mc-sb-${S.id}` } }, h('span.mc-sec-t', {}, k ? h('span.mc-sec-k', { text: k }) : null, h('span.mc-sec-n', { text: ttl }), meta), S.current ? pill('ok', 'En ce moment') : null, icon('chevDown', 'ic ic--sm mc-chev'));
      const sec = h('section.mc-sec', { id: `mc-s-${S.id}`, data: { sec: S.id }, class: [S.current && 'is-current', S.restricted && 'is-locked', open && 'is-open'].filter(Boolean).join(' ') }, head);
      if (!S.restricted) {
        const body = h('div.mc-sec-b', { id: `mc-sb-${S.id}`, hidden: !open });
        if (summary) body.append(h('div.mc-sum.mc-rich', {}, summary));
        if (open) fillSection(body, items, id);
        else body.dataset.lazy = '1';
        sec.append(body);
      }
      out.push(sec);
    }
    out.push(h('p.nv-priv.mc-priv', {}, icon('check', 'ic ic--xs'), 'Lu en direct sur Moodle, à travers le tunnel chiffré. Rien n’est copié chez ISIS Hub.'));
    main.replaceChildren(...out);
    chips.replaceChildren(
      ...(secs.length > 2
        ? secs.map(({ S }) => {
            const [k, ttl] = splitTitle(S.title);
            return h('button.mc-chip', { type: 'button', data: { jump: `mc-s-${S.id}`, toc: S.id }, text: k || ttl });
          })
        : []),
    );
    loadImages(main);
    setupSpy();
  }

  function fillSection(body, items, id) {
    const ul = h('ul.mc-items', {}, ...items.map((it) => itemEl(it, id)).filter(Boolean));
    body.append(ul);
    delete body.dataset.lazy;
    loadImages(body);
  }

  function toggleSec(sid, force) {
    const sec = document.getElementById(`mc-s-${sid}`);
    const body = sec && $('.mc-sec-b', sec);
    if (!body) return;
    const open = force ?? body.hidden;
    if (open && body.dataset.lazy) {
      const d = contents.get(Number(curId));
      const S = d?.sections.find((x) => String(x.id) === String(sid));
      if (S) fillSection(body, visible(S), curId);
    }
    body.hidden = !open;
    sec.classList.toggle('is-open', open);
    $('.mc-sec-h', sec).setAttribute('aria-expanded', String(open));
    if (open) {
      openSecs.add(Number(sid));
      if (motionOK()) body.animate([{ opacity: 0, transform: 'translateY(-4px)' }, { opacity: 1, transform: 'none' }], { duration: 220, easing: EASE });
    } else openSecs.delete(Number(sid));
    const ta = $('[data-mc-toggle-all]', main);
    if (ta) ta.textContent = $$('.mc-sec-b[hidden]', main).length ? 'Tout déplier' : 'Tout replier';
  }

  function setupSpy() {
    spy?.disconnect();
    if (!('IntersectionObserver' in window) || !chips.childNodes.length) return;
    const mark = (id) =>
      $$('[data-toc]', chips).forEach((b) => {
        const on = b.dataset.toc === String(id);
        b.classList.toggle('is-on', on);
        if (on) b.setAttribute('aria-current', 'true');
        else b.removeAttribute('aria-current');
      });
    spy = new IntersectionObserver(
      (es) => {
        const v = es.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        if (!v) return;
        mark(v.target.dataset.sec);
        const chip = $(`.mc-chip[data-toc="${v.target.dataset.sec}"]`, chips);
        if (chip && chips.scrollWidth > chips.clientWidth) chips.scrollTo({ left: chip.offsetLeft - 16, behavior: motionOK() ? 'smooth' : 'auto' });
      },
      { root: scroll, rootMargin: '-10% 0px -70% 0px' },
    );
    $$('.mc-sec', main).forEach((s) => spy.observe(s));
  }

  function loadingCourse(name) {
    main.replaceChildren(
      h('header.mc-hero.mc-hero--skel', { class: pat(curId) }, h('p.mc-kicker', { text: 'Moodle' }), h('h2', { text: name || 'Chargement du cours…' })),
      ...[0, 1, 2].map(() => h('div.mc-sec.mc-sec--skel', {}, h('span.skel.skel--line.w-40'), h('span.skel.skel--line.w-70'))),
    );
    chips.replaceChildren();
  }

  function errorCourse(err, retry) {
    main.replaceChildren(
      h('div.empty.empty--err.mc-error', {}, h('span.empty-ic', {}, icon('offline', 'ic ic--lg')), h('h3', { text: 'Ce cours ne s’affiche pas' }), h('p', { text: `${err.message}. Tu peux réessayer, ou l’ouvrir directement sur Moodle.` }), h('div.mc-enrol-row', {}, h('button.btn.btn--sm', { type: 'button', on: { click: retry } }, icon('retry', 'ic ic--sm'), 'Réessayer'), h('a.btn.btn--sm.btn--ghost', { href: moodleLink.href, target: '_blank', rel: 'noopener' }, 'Ouvrir sur Moodle', icon('ext', 'ic ic--xs btn-arrow')))),
    );
  }

  // ------------------------------------------------------------------ cours non suivi : inscription

  async function renderPreview(id, { guest = false } = {}) {
    const my = ++token;
    const cat = catalogList?.find((c) => c.id === Number(id));
    loadingCourse(cleanName(cat?.fullname));
    let info;
    try {
      info = await MC.enrolInfo(Number(id));
    } catch (err) {
      if (my !== token) return;
      if (err instanceof NotSignedIn) return onSessionLost('moodle');
      return errorCourse(err, () => renderPreview(id, { guest }));
    }
    if (my !== token) return;
    const name = cleanName(info.fullname || cat?.fullname);
    setSwitchLabel(name);
    const teachers = info.teachers.length ? info.teachers.map((t) => t.name) : cat?.teachers ?? [];
    const hero = h('header.mc-hero.mc-hero--other', { class: pat(id) }, h('p.mc-kicker', { text: (cat && catLabel(cat)) || 'Autre cours' }), h('h2', { text: name }));
    const facts = h('div.mc-facts');
    if (teachers.length) facts.append(h('span.mc-fact', {}, icon('user', 'ic ic--xs'), teachers.slice(0, 3).join(', ') + (teachers.length > 3 ? ` +${teachers.length - 3}` : '')));
    facts.append(h('span.mc-fact', {}, icon('lock', 'ic ic--xs'), 'Tu n’es pas inscrit'));
    hero.append(facts);
    const out = [hero];
    const about = rich(info.summary);
    if (about) out.push(h('div.mc-sum.mc-about.mc-rich', {}, about));
    const box = h('section.mc-enrol', { class: info.self ? (info.self.key ? 'is-key' : 'is-self') : 'is-closed', attrs: { 'aria-labelledby': 'mc-enrol-t' } }, h('h3', { id: 'mc-enrol-t', text: info.self ? 'T’inscrire à ce cours' : 'Inscription sur demande' }));
    if (info.self && !info.self.key) {
      box.append(h('p.mc-text', { text: 'Inscription libre : le cours rejoint « Mes cours » tout de suite, avec ses fichiers, devoirs et nouveautés. C’est la même inscription que sur Moodle (tu pourras t’en désinscrire depuis Moodle).' }));
      box.append(h('button.btn.btn--primary.mc-enrol-btn', { type: 'button', data: { mcEnrol: id } }, icon('plus', 'ic ic--sm'), 'M’inscrire'));
    } else if (info.self?.key) {
      box.append(h('p.mc-text', { text: 'L’enseignant demande une clé d’inscription. Elle est donnée en cours ou par mail.' }));
      const input = h('input.input.mc-key-in', { id: 'mc-key-in', type: 'text', autocomplete: 'off', placeholder: 'Clé d’inscription', attrs: { autocapitalize: 'off', spellcheck: 'false' } });
      const err = h('p.alert.alert--error.mc-key-err', { hidden: true, attrs: { role: 'alert' } });
      const form = h('form.mc-keyform', { data: { mcKey: id }, noValidate: true }, h('label.sr-only', { htmlFor: 'mc-key-in', text: 'Clé d’inscription' }), input, h('button.btn.btn--primary', { type: 'submit' }, icon('key', 'ic ic--sm'), 'M’inscrire'));
      box.append(form, err);
    } else {
      const who = teachers[0];
      box.append(h('p.mc-text', { text: info.message && /pouvez pas/i.test(info.message) ? `Ce cours n’accepte pas l’auto-inscription. ${who ? `Demande à ${who} de t’ajouter` : 'Demande à l’enseignant de t’ajouter'}, ou à la scolarité.` : info.message || 'Ce cours n’accepte pas l’auto-inscription.' }));
      const row = h('div.mc-enrol-row');
      if (who && onWrite) row.append(h('button.btn', { type: 'button', on: { click: () => onWrite({ name: who, subject: `Inscription au cours ${name}` }) } }, icon('pen', 'ic ic--sm'), `Écrire à ${who}`));
      row.append(h('a.btn.btn--ghost', { href: `${HOSTS.moodle}/course/view.php?id=${Number(id)}`, target: '_blank', rel: 'noopener' }, 'Voir sur Moodle', icon('ext', 'ic ic--xs btn-arrow')));
      box.append(row);
    }
    if (cat?.guest && !guest) box.append(h('button.mc-link.mc-guest', { type: 'button', data: { mcGuest: id }, text: 'Voir le contenu sans m’inscrire (accès invité)' }));
    out.push(box);
    if (guest) {
      out.push(h('p.mc-guestbar', {}, icon('eye', 'ic ic--sm'), 'Accès invité : tu vois les fichiers et les liens, mais pas les devoirs ni les nouveautés.'));
      try {
        const d = await loadContent(id);
        if (my !== token) return;
        for (const { S, items, summary } of sectionsOf(d)) {
          const [k, ttl] = splitTitle(S.title);
          const body = h('div.mc-sec-b');
          if (summary) body.append(h('div.mc-sum.mc-rich', {}, summary));
          body.append(h('ul.mc-items', {}, ...items.filter((it) => it.type !== 'assign' && it.type !== 'quiz').map((it) => itemEl(it, null, { guest: true })).filter(Boolean)));
          out.push(h('section.mc-sec.is-open', { id: `mc-s-${S.id}`, data: { sec: S.id } }, h('div.mc-sec-h.mc-sec-h--static', {}, h('span.mc-sec-t', {}, k ? h('span.mc-sec-k', { text: k }) : null, h('span.mc-sec-n', { text: ttl }))), body));
        }
      } catch (err) {
        if (my !== token) return;
        out.push(h('p.mc-none', { text: err instanceof MC.NotEnrolled ? 'Ce cours n’ouvre pas son contenu aux invités.' : `Contenu indisponible : ${err.message}` }));
      }
    }
    main.replaceChildren(...out);
    loadImages(main);
  }

  async function enrol(id, key, button) {
    if (button) {
      button.disabled = true;
      button.classList.add('is-busy');
    }
    try {
      await MC.selfEnrol(Number(id), key);
      await loadEnrolled(true);
      toast(`Inscrit à « ${nameOf(id)} ». Il est dans Mes cours.`, 'check');
      onEnrolled?.();
      INDEX = null;
      await openCourse(Number(id), { hist: false, animate: false });
      try {
        history.replaceState({ mc: 'course', id: Number(id) }, '', `#moodle/${id}`);
      } catch {}
      return true;
    } catch (err) {
      if (err instanceof NotSignedIn) onSessionLost('moodle');
      else toast(`Inscription impossible : ${err.message}`, 'alert');
      return err;
    } finally {
      if (button?.isConnected) {
        button.disabled = false;
        button.classList.remove('is-busy');
      }
    }
  }

  // ------------------------------------------------------------------ accueil

  function shortRow(cid, it) {
    const det = details.get(it.id);
    const isQuiz = it.type === 'quiz';
    const s = isQuiz ? quizState(it, det) : assignState(it, det, deadlineOfCm(it.id));
    const sub = isQuiz ? `QCM${s.due ? ` · ouvert jusqu’au ${fDate(s.due)}` : ''}` : s.sub ? 'Devoir · rendu' : `Devoir${s.due ? ` · à rendre le ${fDate(s.due)} à ${fTime(s.due)}` : ''}`;
    const p = isQuiz ? (s.kind === 'done' ? 'Fait' : s.due ? relLabel(s.due) : 'À faire') : s.sub ? 'Rendu' : s.due ? relLabel(s.due) : 'À rendre';
    return h('li.mc-it', {}, h('button.mc-ext', { type: 'button', data: { mcCourse: cid, mcItem: `mc-i-${it.id}` } }, h('span.mc-ext-ic', {}, icon(isQuiz ? 'quiz' : 'upload', 'ic ic--sm')), h('span.mc-it-t', {}, h('b', {}, it.name, isNew(cid, it) ? newTag() : null), h('span', { text: sub })), pill(STATE_PILL[s.kind], p)));
  }

  function nowCard() {
    const n = courseNow();
    if (!n) return null;
    const name = nameOf(n.id) || cleanName(matcher.get(n.ev)?.course.fullname);
    const head = h('div.mh-now-h', { class: pat(n.id) }, h('p.mh-now-k', {}, n.live ? h('span.live-dot') : icon('clock', 'ic ic--xs'), n.live ? n.txt : `Prochain cours · ${n.txt}`), h('h2', { id: 'mh-now-t', text: name }), h('button.btn.btn--sm.mh-now-open', { type: 'button', data: { mcCourse: n.id } }, 'Ouvrir le cours', icon('arrRight', 'ic ic--sm')));
    const card = h('section.mh-now', { attrs: { 'aria-labelledby': 'mh-now-t' } }, head);
    const body = h('div.mh-now-b');
    const d = contents.get(Number(n.id));
    if (!isEnrolled(n.id)) {
      body.append(h('p.mh-now-calm', {}, icon('lock', 'ic ic--sm'), 'Tu n’es pas inscrit à ce cours sur Moodle. Ouvre-le pour t’inscrire.'));
    } else if (!d) {
      body.append(h('p.mh-now-calm', {}, h('span.spinner'), 'Lecture du cours…'));
    } else {
      const maxN = matchMedia('(max-width: 640px)').matches ? 3 : 4;
      const fresh = d.sections.flatMap(visible).filter((it) => it.type !== 'label' && isNew(n.id, it));
      const next = todosOf(n.id).find((t) => t.it)?.it;
      const ul = h('ul.mc-items.mh-now-items');
      const add = (it) => {
        if (it.type === 'assign' || it.type === 'quiz') ul.append(shortRow(n.id, it));
        else {
          const li = itemEl(it, n.id);
          li?.querySelector('details')?.removeAttribute('open');
          if (li) ul.append(li);
        }
      };
      if (fresh.length) {
        body.append(h('p.mh-now-sec', {}, h('span', { text: 'Nouveau depuis ta dernière visite' }), h('b', { text: `${fresh.length} élément${fresh.length > 1 ? 's' : ''}` })));
        fresh.slice(0, maxN).forEach(add);
        if (next && !fresh.includes(next) && fresh.length < maxN) add(next);
        body.append(ul);
        if (fresh.length > maxN) body.append(h('button.mc-link.mh-now-more', { type: 'button', data: { mcCourse: n.id }, text: `${fresh.length - maxN} autre${fresh.length - maxN > 1 ? 's' : ''} nouveauté${fresh.length - maxN > 1 ? 's' : ''}` }));
      } else if (next) {
        body.append(h('p.mh-now-sec', {}, h('span', { text: 'À rendre' }), h('b', { text: 'Rien de nouveau depuis ta dernière visite' })));
        add(next);
        body.append(ul);
      } else body.append(h('p.mh-now-calm', {}, icon('check', 'ic ic--sm'), 'Rien de nouveau depuis ta dernière visite, rien à rendre.'));
    }
    card.append(body);
    return card;
  }
  function renderNowCard() {
    const old = $('.mh-now', homeBody);
    const card = nowCard();
    if (old && card) old.replaceWith(card);
    else if (card) $('.mh-search', homeBody)?.after(card);
    else old?.remove();
    if (card) loadImages(card);
  }

  function homeRow(c, inClass = false) {
    const ns = nextSession(c.id);
    const nn = newCount(c.id);
    const late = lateOf(c.id);
    const sub = h('span.mh-row-s');
    if (ns) sub.append(ns.live ? h('span.live-dot') : icon('clock', 'ic ic--xs'), ns.live ? ns.txt : ns.txt.split(' · ')[0]);
    else sub.append(codeOf(c) || semOf(c.category) || c.category || 'Moodle');
    const sig = h('span.mh-sig', {}, late ? pill('fail', `${late} en retard`) : null, nn ? h('span.mh-newdot', {}, h('span.mh-newdot-d'), `${nn} nouveau${nn > 1 ? 'x' : ''}`) : null);
    const name = cleanName(c.fullname);
    return h(
      'li',
      { data: inClass ? {} : { row: c.id } },
      h('button.mh-row', { type: 'button', data: { mcCourse: c.id }, attrs: { 'aria-label': `${name}${ns ? `, ${ns.live ? 'en cours' : `prochaine séance ${ns.txt}`}` : ''}${late ? `, ${late} en retard` : ''}${nn ? `, ${nn} nouveautés` : ''}` } }, h('span.mh-av', { class: pat(c.id), text: avatarText(c), attrs: { 'aria-hidden': 'true' } }), h('span.mc-it-t', {}, h('b', { text: name }), sub), sig, icon('chevRight', 'ic ic--sm mh-chev')),
    );
  }
  function refreshHomeRow(id) {
    const li = $(`[data-row="${id}"]`, homeBody);
    const c = enrolledById.get(Number(id));
    if (li && c) li.replaceWith(homeRow(c));
  }

  function catRow(c, inClass = false) {
    const name = cleanName(c.fullname);
    const [k, lab] = c.self ? ['ok', 'Inscription libre'] : ['none', 'Sur demande'];
    return h('li', {}, h('button.mh-row.mh-row--other', { type: 'button', data: { mcCourse: c.id }, attrs: { 'aria-label': `${name}, ${catLabel(c)}, pas inscrit, ${lab}${c.guest ? ', accès invité possible' : ''}` } }, h('span.mh-av.mh-av--ghost', { class: pat(c.id), text: avatarText(c), attrs: { 'aria-hidden': 'true' } }), h('span.mc-it-t', {}, h('b', { text: name }), h('span.mh-row-s', { text: `${inClass ? [lab, ...(c.teachers ?? []).slice(0, 2)].join(' · ') : catLabel(c)}${c.guest ? ' · accès invité' : ''}` })), h('span.mh-sig', {}, inClass ? pill('warn', 'Pas inscrit') : pill(k, lab)), icon('chevRight', 'ic ic--sm mh-chev')));
  }

  /** « Ma classe » : tous les cours du semestre de la classe, suivis ou non (pour s'y inscrire). */
  function classSection() {
    const myPromo = promo?.();
    const sems = semestersOf(myPromo);
    if (!sems) return null;
    if (!sems.list.includes(semShown)) semShown = sems.current;
    const body = h('div.mh-class-b');
    const box = h(
      'section.mh-class',
      { id: 'mh-class', attrs: { 'aria-labelledby': 'mh-class-t' } },
      h(
        'header.mh-list-h',
        {},
        h('h2', { id: 'mh-class-t', text: `Ma classe · ${myPromo}` }),
        h('div.mh-sems', { attrs: { role: 'group', 'aria-label': 'Semestre' } }, ...sems.list.map((n) => h('button.mc-chip', { type: 'button', class: n === semShown ? 'is-on' : '', data: { semPick: n }, text: `Semestre ${n}${n === sems.current ? ' · en cours' : ''}`, attrs: { 'aria-pressed': String(n === semShown) } }))),
      ),
      body,
    );
    const fill = () => {
      const list = (catalogList ?? [])
        .filter((c) => c.promo === myPromo && c.semester === semShown)
        .sort((a, b) => isEnrolled(b.id) - isEnrolled(a.id) || normalize(cleanName(a.fullname)).localeCompare(normalize(cleanName(b.fullname)), 'fr'));
      const mine = list.filter((c) => isEnrolled(c.id)).length;
      body.replaceChildren(
        h('p.mh-class-sum', { text: list.length ? `${list.length} cours · ${mine ? `inscrit à ${mine}` : 'inscrit à aucun'}${list.length - mine ? ` · ${list.length - mine} où tu peux demander ou faire ton inscription` : ''}` : `Aucun cours trouvé sur Moodle pour le semestre ${semShown}.` }),
        list.length ? h('ul.mh-rows', {}, ...list.map((c) => (isEnrolled(c.id) ? homeRow(enrolledById.get(c.id), true) : catRow(c, true)))) : null,
      );
    };
    if (catalogList) fill();
    else {
      body.replaceChildren(h('p.mh-now-calm.mh-other-load', {}, h('span.spinner'), 'Lecture des cours de ta classe sur Moodle…'));
      loadCatalog().then(() => box.isConnected && fill(), (err) => box.isConnected && body.replaceChildren(h('p.mh-now-calm.mh-other-load', {}, icon('alert', 'ic ic--sm'), `Liste indisponible : ${err.message}`)));
    }
    return box;
  }

  function catalogSection() {
    const det = h('details.mh-other', { id: 'mh-other', open: homeOtherOpen });
    const count = h('span.mc-count', { text: catalogList ? String(others().length) : '…' });
    det.append(h('summary.mh-other-s', {}, h('span.mh-other-t', {}, h('b', { text: 'Autres cours ISIS' }), h('span', { text: 'Autres promos, années précédentes, options : tu peux t’y inscrire.' })), count, icon('chevDown', 'ic ic--sm mc-chev')));
    const body = h('div.mh-other-b');
    det.append(body);
    const fill = () => {
      const list = others();
      count.textContent = String(list.length);
      const promos = ['Tous', ...[...new Set(list.map((c) => c.promo))].sort((a, b) => (a === 'Transversal') - (b === 'Transversal') || a.localeCompare(b, 'fr', { numeric: true }))];
      if (!promos.includes(catFilter)) catFilter = 'Tous';
      body.replaceChildren(
        h('div.mh-filters', { attrs: { role: 'group', 'aria-label': 'Filtrer par promotion' } }, ...promos.map((p) => h('button.mc-chip', { type: 'button', class: p === catFilter ? 'is-on' : '', data: { catFilter: p }, text: p, attrs: { 'aria-pressed': String(p === catFilter) } }))),
        h('ul.mh-rows.mh-rows--other', {}, ...list.filter((c) => catFilter === 'Tous' || c.promo === catFilter).map(catRow)),
      );
    };
    const load = () => {
      if (catalogList) return fill();
      body.replaceChildren(h('p.mh-now-calm.mh-other-load', {}, h('span.spinner'), 'Lecture des cours ISIS sur Moodle…'));
      loadCatalog().then(fill, (err) => body.replaceChildren(h('p.mh-now-calm.mh-other-load', {}, icon('alert', 'ic ic--sm'), `Liste indisponible : ${err.message}`)));
    };
    det.addEventListener('toggle', () => {
      homeOtherOpen = det.open;
      if (det.open) load();
    });
    if (det.open) load();
    return det;
  }

  function renderHome() {
    const slot = h('div.mh-search');
    slot.append(searchBox);
    searchBox.classList.add('is-big');
    const out = [slot];
    const nc = nowCard();
    if (nc) out.push(nc);
    const list = sorted();
    out.push(
      h(
        'section.mh-list',
        { attrs: { 'aria-labelledby': 'mh-list-t' } },
        h('header.mh-list-h', {}, h('h2', { id: 'mh-list-t', text: 'Mes cours' }), h('span.mc-count', { text: String(list.length) })),
        list.length ? h('ul.mh-rows', {}, ...list.map(homeRow)) : h('p.mh-now-calm', { text: 'Tu n’es inscrit à aucun cours pour l’instant.' }),
      ),
    );
    const cls = classSection();
    if (cls) out.push(cls);
    out.push(catalogSection());
    out.push(h('p.nv-priv.mc-priv', {}, icon('check', 'ic ic--xs'), 'Lu en direct sur Moodle, à travers le tunnel chiffré. Rien n’est copié chez ISIS Hub.'));
    homeBody.replaceChildren(...out);
    loadImages(homeBody);
  }

  // ------------------------------------------------------------------ recherche

  let INDEX = null;
  let active = -1;
  function buildIndex() {
    INDEX = [];
    for (const c of enrolled) {
      const d = contents.get(c.id);
      if (!d) continue;
      for (const S of d.sections) {
        const sec = splitTitle(S.title)[0] || S.title;
        for (const it of visible(S)) {
          if (it.restricted) continue;
          const kind = OTHER[it.type]?.[0] ?? 'Activité';
          const name = it.type === 'label' ? plainText(it.html).slice(0, 80) : it.name;
          if (!name) continue;
          INDEX.push({ id: c.id, item: `mc-i-${it.id}`, name, kind, ext: it.type === 'resource' ? it.file?.ext : '', sec, type: it.type });
          for (const f of it.folder?.files ?? []) INDEX.push({ id: c.id, item: `mc-i-${it.id}`, name: f.name, kind: 'Fichier', ext: extOf(f.name), sec: `${sec} › ${it.name}`, type: 'file' });
        }
      }
    }
  }
  function hl(text, q) {
    const span = h('span.mc-r-t');
    const n = normalize(text);
    const i = q ? n.indexOf(q) : -1;
    // normalize() garde la longueur pour les lettres accentuées, mais pas pour la ponctuation :
    // on ne surligne que si les deux textes sont alignés.
    if (i < 0 || n.length !== text.length) span.textContent = text;
    else span.append(text.slice(0, i), h('mark', { text: text.slice(i, i + q.length) }), text.slice(i + q.length));
    return span;
  }
  const lower = (s) => String(s || '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
  function option(o, i, q) {
    const b = h('button.mc-r', { type: 'button', id: `mc-r-${i}`, attrs: { role: 'option' }, data: { mcCourse: o.id } });
    if (o.item) b.dataset.mcItem = o.item;
    let ico;
    if (o.course) ico = h('span.mh-av.mh-av--sm', { class: `${pat(o.id)}${o.other ? ' mh-av--ghost' : ''}`, text: avatarText(o.course) });
    else if (o.type === 'file' || o.type === 'resource') ico = fxBadge(o.ext);
    else ico = h('span.fx.fx--folder', {}, icon(OTHER[o.type]?.[1] ?? 'folder', 'ic ic--sm'));
    b.append(ico, h('span.mc-it-t', {}, hl(o.name, q), h('span', { text: o.sub })));
    if (o.current) b.append(h('span.mc-meta', { text: 'ouvert' }));
    if (o.other) b.append(pill(o.other.self ? 'ok' : 'none', o.other.self ? 'Inscription libre' : 'Sur demande'));
    return b;
  }
  function renderResults() {
    const raw = searchInput.value.trim();
    const q = lower(raw);
    if (!INDEX) buildIndex();
    const courseHits = sorted()
      .filter((c) => !q || lower(`${c.fullname} ${c.shortname}`).includes(q))
      .map((c) => ({ id: c.id, course: c, name: cleanName(c.fullname), sub: codeOf(c) || semOf(c.category), current: mode === 'course' && c.id === curId }));
    let hits = [];
    if (q.length >= 2) {
      const seen = new Set();
      hits = INDEX.filter((x) => lower(x.name).includes(q))
        .filter((x) => {
          const k = `${x.id}|${x.name}|${x.item}`;
          if (seen.has(k)) return false;
          seen.add(k);
          return true;
        })
        .slice(0, 8)
        .map((x) => ({ ...x, sub: `${x.kind} · ${nameOf(x.id)} · ${x.sec}` }));
    }
    const list = h('div.mc-r-list');
    let i = 0;
    if (!q) list.append(h('p.mc-r-h', { text: 'Aller à un cours' }));
    else if (courseHits.length) list.append(h('p.mc-r-h', { text: 'Cours' }));
    (q ? courseHits.slice(0, 5) : courseHits).forEach((o) => list.append(option(o, i++, q)));
    if (hits.length) {
      list.append(h('p.mc-r-h', { text: 'Dans tes cours' }));
      hits.forEach((o) => list.append(option(o, i++, q)));
    }
    if (q.length >= 2 && warming) list.append(h('p.mc-r-none', {}, h('span.spinner'), ' Lecture de tes cours…'));
    if (q.length >= 2) {
      if (!catalogList) {
        loadCatalog().then(() => !results.hidden && renderResults(), () => {});
        list.append(h('p.mc-r-none', {}, h('span.spinner'), ' Recherche dans les autres cours ISIS…'));
      } else {
        const oth = others().filter((c) => lower(`${c.fullname} ${catLabel(c)}`).includes(q)).slice(0, 6);
        if (oth.length) {
          list.append(h('p.mc-r-h', { text: 'Autres cours ISIS · pas inscrit' }));
          oth.forEach((c) => list.append(option({ id: c.id, course: c, other: c, name: cleanName(c.fullname), sub: `${catLabel(c)}${c.guest ? ' · accès invité' : ''}` }, i++, q)));
        }
      }
    }
    if (!q) {
      list.append(h('button.mc-r.mc-r--browse', { type: 'button', id: `mc-r-${i++}`, attrs: { role: 'option' }, data: { mcBrowse: '' } }, h('span.fx.fx--folder', {}, icon('search', 'ic ic--sm')), h('span.mc-it-t', {}, h('span.mc-r-t', { text: 'Parcourir les autres cours ISIS' }), h('span', { text: catalogList ? `${others().length} cours d’autres promos et années` : 'Autres promos, années précédentes, options' }))));
    }
    if (!i) list.append(h('p.mc-r-none', { text: q.length < 2 ? 'Continue à taper…' : `Rien ne correspond à « ${raw} » dans tes cours.` }));
    const foot = h('p.mc-r-foot', {}, h('span.kbd', { text: '↑' }), h('span.kbd', { text: '↓' }), ' choisir · ', h('span.kbd', { text: 'Entrée' }), ' ouvrir · ', h('span.kbd', { text: 'Échap' }), ' fermer');
    results.replaceChildren(list, foot);
    setActive(q && i ? 0 : -1);
  }
  function setActive(i) {
    const all = $$('.mc-r', results);
    active = Math.max(-1, Math.min(i, all.length - 1));
    all.forEach((b, k) => b.classList.toggle('is-active', k === active));
    if (active >= 0) {
      searchInput.setAttribute('aria-activedescendant', all[active].id);
      all[active].scrollIntoView({ block: 'nearest' });
    } else searchInput.removeAttribute('aria-activedescendant');
  }
  function openResults() {
    renderResults();
    results.hidden = false;
    searchInput.setAttribute('aria-expanded', 'true');
    warmAll();
  }
  function closeResults(clear) {
    results.hidden = true;
    searchInput.setAttribute('aria-expanded', 'false');
    if (clear) searchInput.value = '';
    if (mode === 'course' && !pop.hidden) {
      pop.hidden = true;
      $('.mc-switch', title)?.setAttribute('aria-expanded', 'false');
    }
  }
  function openSwitcher() {
    pop.append(searchBox);
    searchBox.classList.remove('is-big');
    pop.hidden = false;
    $('.mc-switch', title)?.setAttribute('aria-expanded', 'true');
    searchInput.focus();
    openResults();
  }
  searchInput.addEventListener('focus', () => results.hidden && openResults());
  searchInput.addEventListener('input', () => (results.hidden ? openResults() : renderResults()));
  searchInput.addEventListener('keydown', (e) => {
    const n = $$('.mc-r', results).length;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive(active + 1 >= n ? 0 : active + 1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive(active <= 0 ? n - 1 : active - 1);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      $$('.mc-r', results)[active >= 0 ? active : 0]?.click();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      const sw = mode === 'course' ? $('.mc-switch', title) : null;
      closeResults(true);
      searchInput.blur();
      sw?.focus();
    }
  });
  document.addEventListener('pointerdown', (e) => {
    if (!results.hidden && !e.target.closest('.mc-searchbox, .mc-switch')) closeResults(false);
  });
  document.addEventListener('keydown', (e) => {
    if (!isOpen || e.key !== '/' || isTyping(e.target) || document.querySelector('dialog[open]')) return;
    e.preventDefault();
    if (mode === 'course') openSwitcher();
    else searchInput.focus();
  });

  // ------------------------------------------------------------------ navigation

  function push(st) {
    try {
      history.pushState(st, '', st.mc === 'course' ? `#moodle/${st.id}` : '#moodle');
      depth += 1;
    } catch {}
  }
  function setSwitchLabel(name) {
    const span = $('.mc-switch > span', title);
    if (span) span.textContent = name;
    $('.mc-switch', title)?.setAttribute('aria-label', `${name} : changer de cours ou chercher`);
  }
  function setMode(m, name = '') {
    mode = m;
    view.classList.toggle('is-home', m === 'home');
    view.classList.toggle('is-course', m === 'course');
    courseBody.hidden = m !== 'course';
    homeBody.hidden = m !== 'home';
    pop.hidden = true;
    if (m === 'home') {
      title.replaceChildren('Moodle');
      moodleLink.href = `${HOSTS.moodle}/my/courses.php`;
      moodleLink.setAttribute('aria-label', 'Ouvrir Moodle (nouvel onglet)');
      spy?.disconnect();
      chips.replaceChildren();
    } else {
      title.replaceChildren(h('button.mc-switch', { type: 'button', attrs: { 'aria-haspopup': 'listbox', 'aria-expanded': 'false', 'aria-label': `${name} : changer de cours ou chercher` } }, h('span', { text: name }), icon('chevDown', 'ic ic--sm')));
      moodleLink.href = `${HOSTS.moodle}/course/view.php?id=${Number(curId)}`;
      moodleLink.setAttribute('aria-label', 'Ouvrir ce cours dans Moodle (nouvel onglet)');
    }
  }

  function show(from, animate) {
    const first = !isOpen;
    closeResults(true);
    if (first) beforeOpen?.();
    isOpen = true;
    view.hidden = false;
    app.classList.add('has-overlay', 'course-open');
    if (bento) bento.inert = true;
    lockScroll(true);
    if (first) opener = from?.nodeType ? from : null;
    if (first && animate && motionOK() && opener?.getBoundingClientRect().width) {
      const a = opener.getBoundingClientRect();
      const b = view.getBoundingClientRect();
      view.animate([{ clipPath: clipFrom(a, b, 22), opacity: 0.85 }, { clipPath: 'inset(0px 0px 0px 0px round 22px)', opacity: 1 }], { duration: 520, easing: EASE });
    } else if (first && animate) view.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 200 });
    if (animate && motionOK()) restartClass(view, 'mc-anim');
  }

  const leaveCourse = () => mode === 'course' && curId && markSeen(curId);

  async function openHome(from = null, { animate = true, hist = true, query = '' } = {}) {
    if (!isSignedIn()) return false;
    leaveCourse();
    token++;
    curId = null;
    view.classList.remove('is-preview');
    setMode('home');
    show(from, animate);
    scroll.scrollTop = 0;
    if (hist) push({ mc: 'home' });
    homeBody.replaceChildren(h('div.mh-search', {}, searchBox), h('div.mh-now.mh-now--skel', {}, h('span.skel.skel--block.skel-h180')));
    searchBox.classList.add('is-big');
    closeBtn.focus({ preventScroll: true });
    try {
      if (!enrolled.length) await loadEnrolled();
    } catch (err) {
      if (err instanceof NotSignedIn) return onSessionLost('moodle');
      homeBody.replaceChildren(h('div.empty.empty--err', {}, h('span.empty-ic', {}, icon('offline', 'ic ic--lg')), h('h3', { text: 'Moodle ne répond pas' }), h('p', { text: err.message })));
      return true;
    }
    if (mode !== 'home') return true;
    renderHome();
    warmAll();
    if (query) {
      searchInput.value = query;
      searchInput.focus();
      openResults();
    }
    return true;
  }

  async function openCourse(id, { from = null, animate = true, itemId = null, hist = true, guest = false } = {}) {
    id = Number(id);
    if (!id || !isSignedIn()) return false;
    leaveCourse();
    const my = ++token;
    curId = id;
    if (!enrolled.length) await loadEnrolled().catch(() => {});
    const known = isEnrolled(id);
    setMode('course', nameOf(id) || 'Cours');
    view.classList.toggle('is-preview', !known);
    show(from, animate);
    scroll.scrollTop = 0;
    if (hist) push({ mc: 'course', id });
    $('.mc-switch', title)?.focus({ preventScroll: true });
    if (!known) {
      loadCatalog().catch(() => {});
      renderPreview(id, { guest });
      return true;
    }
    const cachedContent = contents.get(id);
    if (cachedContent) renderCourse(id, cachedContent, itemId);
    else loadingCourse(nameOf(id));
    try {
      const d = await loadContent(id);
      if (my !== token) return true;
      if (d !== cachedContent) renderCourse(id, d, itemId);
    } catch (err) {
      if (my !== token) return true;
      if (err instanceof NotSignedIn) {
        onSessionLost('moodle');
        return true;
      }
      if (err instanceof MC.NotEnrolled) {
        view.classList.add('is-preview');
        renderPreview(id, { guest });
        return true;
      }
      if (!cachedContent) errorCourse(err, () => openCourse(id, { hist: false, animate: false, itemId }));
      return true;
    }
    if (itemId) requestAnimationFrame(() => jumpTo(itemId));
    return true;
  }

  function jumpTo(targetId) {
    let target = document.getElementById(targetId);
    if (!target && targetId.startsWith('mc-i-')) {
      // Élément d'une section repliée pas encore construite : on la déplie d'abord.
      const d = contents.get(Number(curId));
      const S = d?.sections.find((x) => x.items.some((it) => `mc-i-${it.id}` === targetId));
      if (S) toggleSec(S.id, true);
      target = document.getElementById(targetId);
    }
    if (!target) return;
    const sec = target.closest('.mc-sec') ?? target;
    if (sec.dataset.sec && !sec.classList.contains('is-open')) toggleSec(sec.dataset.sec, true);
    target.querySelectorAll(':scope > details, .mc-dd').forEach((det) => (det.open = true));
    target.scrollIntoView({ behavior: motionOK() ? 'smooth' : 'auto', block: target.classList.contains('mc-sec') ? 'start' : 'center' });
    restartClass(target, 'is-flash');
  }

  function close(fromPop = false) {
    if (!isOpen) return;
    leaveCourse();
    token++;
    isOpen = false;
    closeResults(true);
    if (!fromPop && depth) {
      skipPop = true;
      try {
        history.go(-depth);
      } catch {
        skipPop = false;
      }
    }
    depth = 0;
    spy?.disconnect();
    app.classList.remove('has-overlay');
    if (bento) bento.inert = false;
    renderTileBadges();
    const back = opener?.isConnected && opener.offsetParent ? opener : null;
    const done = () => {
      view.hidden = true;
      app.classList.remove('course-open');
      lockScroll(false);
      main.replaceChildren();
      back?.focus({ preventScroll: true });
    };
    if (motionOK() && back) {
      const a = back.getBoundingClientRect();
      const b = view.getBoundingClientRect();
      view.animate([{ clipPath: 'inset(0px 0px 0px 0px round 22px)', opacity: 1 }, { clipPath: clipFrom(a, b, 22), opacity: 0.2 }], { duration: 380, easing: EASE_IO }).onfinish = done;
    } else if (motionOK()) view.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 160 }).onfinish = done;
    else done();
  }

  window.addEventListener('popstate', (e) => {
    if (skipPop) {
      skipPop = false;
      return;
    }
    if (!isOpen) return;
    depth = Math.max(0, depth - 1);
    const st = e.state;
    if (st?.mc === 'course') openCourse(st.id, { hist: false });
    else if (st?.mc === 'home') openHome(null, { hist: false });
    else close(true);
  });
  // Adresse « #moodle… » restée d'une visite précédente : on repart du tableau de bord.
  if (/^#moodle/.test(location.hash)) {
    try {
      history.replaceState(null, '', location.pathname + location.search);
    } catch {}
  }

  /** Pastille « nouveau » sur les cours de la tuile Moodle. */
  function renderTileBadges() {
    for (const a of $$('.tile--moodle [data-course] .course')) {
      const id = Number(a.closest('[data-course]').dataset.course);
      const n = newCount(id);
      let dot = $('.course-new', a);
      if (n && !dot) {
        dot = h('span.course-new', { title: `${n} nouveauté${n > 1 ? 's' : ''}`, attrs: { 'aria-label': `${n} nouveauté${n > 1 ? 's' : ''}` } });
        $('.course-ic', a)?.append(dot);
      }
      if (!n && dot) dot.remove();
    }
  }

  // ------------------------------------------------------------------ clics dans la vue

  view.addEventListener('click', (e) => {
    const t = e.target;
    if (t.closest('.fs-x') === closeBtn) return close();
    if (t.closest('.mc-back')) return openHome(null);
    if (t.closest('.mc-switch')) return pop.hidden ? openSwitcher() : closeResults(false);
    const file = t.closest('.mc-file, .mc-dlbtn, .mc-zip');
    if (file) return openFile(file);
    const rf = t.closest('a[data-mc-file]');
    if (rf && !e.metaKey && !e.ctrlKey && !e.shiftKey) {
      e.preventDefault();
      const name = rf.dataset.mcFileName || 'fichier';
      const load = () => MC.fetchFile({ url: rf.dataset.mcFile, name });
      if (PREVIEW.has(extOf(name))) viewer.viewFile({ name, load });
      else viewer.downloadFile({ name, load }, rf);
      return;
    }
    const rc = t.closest('a[data-mc-cm]');
    if (rc && !e.metaKey && !e.ctrlKey && !e.shiftKey && document.getElementById(`mc-i-${rc.dataset.mcCm}`)) {
      e.preventDefault();
      return jumpTo(`mc-i-${rc.dataset.mcCm}`);
    }
    const cc = t.closest('[data-mc-course]');
    if (cc && !(cc.tagName === 'A' && (e.metaKey || e.ctrlKey || e.shiftKey))) {
      e.preventDefault();
      closeResults(true);
      return openCourse(cc.dataset.mcCourse, { itemId: cc.dataset.mcItem || null });
    }
    const sh = t.closest('[data-sec-toggle]');
    if (sh) return toggleSec(sh.dataset.secToggle);
    const en = t.closest('[data-mc-enrol]');
    if (en) return enrol(en.dataset.mcEnrol, '', en);
    const gu = t.closest('[data-mc-guest]');
    if (gu) return renderPreview(gu.dataset.mcGuest, { guest: true });
    const sp = t.closest('[data-sem-pick]');
    if (sp) {
      semShown = Number(sp.dataset.semPick);
      $('#mh-class', homeBody)?.replaceWith(classSection());
      $(`#mh-class [data-sem-pick="${semShown}"]`, homeBody)?.focus();
      return;
    }
    const cf = t.closest('[data-cat-filter]');
    if (cf) {
      catFilter = cf.dataset.catFilter;
      homeOtherOpen = true;
      const det = $('#mh-other', homeBody);
      det?.replaceWith(catalogSection());
      $(`#mh-other [data-cat-filter="${CSS.escape(catFilter)}"]`, homeBody)?.focus();
      return;
    }
    if (t.closest('[data-mc-browse]')) {
      closeResults(true);
      homeOtherOpen = true;
      const go = () =>
        requestAnimationFrame(() => {
          const o = $('#mh-other', homeBody);
          if (o) {
            o.open = true;
            o.scrollIntoView({ block: 'start', behavior: motionOK() ? 'smooth' : 'auto' });
          }
        });
      if (mode !== 'home') openHome(null).then(go);
      else {
        $('#mh-other', homeBody)?.replaceWith(catalogSection());
        go();
      }
      return;
    }
    if (t.closest('[data-mc-toggle-all]')) {
      const anyClosed = $$('.mc-sec-b[hidden]', main).length > 0;
      $$('[data-sec-toggle]', main).forEach((b) => toggleSec(b.dataset.secToggle, anyClosed));
      return;
    }
    const j = t.closest('[data-jump]');
    if (j) {
      if (j.dataset.jump) jumpTo(j.dataset.jump);
      else if (j.dataset.href) window.open(j.dataset.href, '_blank', 'noopener');
      return;
    }
    if (t.closest('[data-mc-notes]') && notes) {
      close();
      setTimeout(() => notes.open(), 260);
    }
  });
  view.addEventListener('submit', async (e) => {
    const f = e.target.closest('[data-mc-key]');
    if (!f) return;
    e.preventDefault();
    const input = $('input', f);
    const err = f.nextElementSibling;
    const v = input.value.trim();
    const say = (msg) => {
      err.replaceChildren(icon('alert', 'ic ic--sm'), h('span', { text: msg }));
      err.hidden = false;
      input.setAttribute('aria-invalid', 'true');
      input.focus();
    };
    if (!v) return say('Entre la clé donnée par l’enseignant.');
    err.hidden = true;
    input.removeAttribute('aria-invalid');
    const res = await enrol(f.dataset.mcKey, v, $('button', f));
    if (res instanceof Error && !(res instanceof NotSignedIn)) say(res.message);
  });

  // Liens « Moodle » du reste de la page (tuile Moodle, cours du moment, emploi du temps, fiche d'un
  // cours, prochains rendus) : ouverts ici. Ctrl/Cmd/Maj + clic garde le lien vers Moodle.
  document.addEventListener('click', (e) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const el = e.target.closest('[data-moodle-course], [data-moodle-home]');
    if (!el || view.contains(el) || !isSignedIn()) return;
    if (app.classList.contains('is-editing')) return;
    e.preventDefault();
    const dlg = el.closest('dialog[open]');
    const from = el.closest('.course, .spotlight, .ev, .dl-item, .tile') ?? el;
    dlg?.close();
    if (el.dataset.moodleCourse) openCourse(el.dataset.moodleCourse, { from: dlg ? null : from, itemId: el.dataset.moodleItem || null });
    else openHome(dlg ? null : el.closest('.tile') ?? el, { query: el.dataset.moodleQuery || '' });
  });

  onRendus(() => {
    if (!isOpen) return renderTileBadges();
    if (mode === 'course') refreshTodo();
    else if (mode === 'home') {
      renderNowCard();
      enrolled.forEach((c) => refreshHomeRow(c.id));
    }
  });
  UD.onUserData((touched) => touched.includes('cours') && renderTileBadges());

  return {
    isOpen: () => isOpen,
    close: () => close(),
    openHome: (from, opts) => openHome(from, opts),
    openCourse: (id, opts) => openCourse(id, opts),
    /** Cours suivis connus de la tuile : évite une deuxième lecture, et prépare les nouveautés. */
    setEnrolled(list) {
      enrolled = list;
      enrolledById = new Map(list.map((c) => [c.id, c]));
      INDEX = null;
      warmAll().then(renderTileBadges);
    },
    renderTileBadges,
    reset() {
      close();
      enrolled = [];
      enrolledById = new Map();
      contents.clear();
      details.clear();
      catalogList = null;
      INDEX = null;
    },
  };
}
