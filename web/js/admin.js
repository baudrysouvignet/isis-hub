// Administration d'ISIS Hub, par rubrique : Vue d'ensemble (fréquentation, parcours, à traiter),
// Retours des étudiants, Contenu du Hub (raccourcis, ambiance, emplois du temps, notes), Carrière
// (Stages, simulateur de salaire) et TCG.
//
// Cette page n'est servie qu'avec une session administrateur, ouverte par le CAS de l'université
// pour un identifiant de ADMIN_USERS (voir internal/feedback/cas.go). La session est un cookie
// HttpOnly (SameSite=Strict) ; chaque appel porte en plus l'en-tête X-Hub-Admin, qu'un autre site ne
// peut pas ajouter. Tout ce qui vient des étudiants ou des fichiers est affiché comme du texte.
//
// Design : maquette « Admin ISIS Hub · maquette ».

import { $, $$, h, icon, toast, motionOK, EASE } from './core/dom.js';
import { setupGradesAdmin } from './admin-grades.js';
import { setupTcgAdmin } from './admin-tcg.js';
import { setupCareer } from './admin-career.js';
import { setupOverview } from './admin-overview.js';
import { setupFeedback } from './admin-feedback.js';
import { applyTheme } from './core/theme.js';
import { prefs } from './core/store.js';

applyTheme(); // même thème que le Hub (choisi dans le menu du compte)

if (window.top !== window.self) throw new Error('Refus d’affichage dans un cadre.');

const app = $('.app');

/** Session absente ou expirée : la page d'administration n'existe plus, retour à l'accueil. */
const leave = () => location.assign('./#admin');

async function api(path, body) {
  const res = await fetch(`api/admin/${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'X-Hub-Admin': '1', ...(body !== undefined && { 'Content-Type': 'application/json' }) },
    body: body === undefined ? undefined : JSON.stringify(body),
    credentials: 'same-origin',
    cache: 'no-store',
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 || res.status === 404) {
    leave();
    throw new Error('session terminée');
  }
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

// ------------------------------------------------------------ cadre : rubriques

const NS = 'http://www.w3.org/2000/svg';
const IC = {
  overview: ['M4 13.5h4V20H4zM10 9h4v11h-4zM16 4h4v16h-4z'],
  inbox: ['M3 13l3-8h12l3 8v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z', 'M3 13h5l1.5 2.5h5L16 13h5'],
  grid: ['M3.5 3.5h7v9h-7zM13.5 3.5h7v5h-7zM3.5 15.5h7v5h-7zM13.5 11.5h7v9h-7z'],
  career: ['M3 7h18v13H3z', 'M8.5 7V5.5a2 2 0 0 1 2-2h3a2 2 0 0 1 2 2V7M3 12.5h18'],
  cards: ['M4.5 7.5l9-2.5 3.5 13-9 2.5z', 'M15 4.5l4.5 1.2-2.6 9.8'],
  arrowUp: ['M12 19V5M6 11l6-6 6 6'],
  arrowDown: ['M12 5v14M6 13l6 6 6-6'],
};
function ic(name, cls = 'ic') {
  const s = document.createElementNS(NS, 'svg');
  s.setAttribute('class', cls);
  s.setAttribute('viewBox', '0 0 24 24');
  s.setAttribute('aria-hidden', 'true');
  for (const d of IC[name]) {
    const p = document.createElementNS(NS, 'path');
    p.setAttribute('d', d);
    s.append(p);
  }
  return s;
}

const RUBRIQUES = [
  { id: 'vue', name: 'Vue d’ensemble', short: 'Accueil', icon: 'overview' },
  { id: 'retours', name: 'Retours des étudiants', nav: 'Retours', short: 'Retours', icon: 'inbox' },
  { id: 'hub', name: 'Contenu du Hub', short: 'Hub', icon: 'grid' },
  { id: 'carriere', name: 'Carrière', short: 'Carrière', icon: 'career' },
  { id: 'tcg', name: 'TCG', short: 'TCG', icon: 'cards' },
];
// Anciennes adresses (onglets jusqu'à la 3.0) : la rubrique qui les contient désormais.
const OLD = { feedback: ['retours'], stats: ['vue'], stages: ['carriere'], links: ['hub', 'links'], ambiance: ['hub', 'amb'], classes: ['hub', 'tt'], grades: ['hub', 'gr'] };

const badges = {};
for (const nav of $$('[data-adm-nav]'))
  for (const r of RUBRIQUES) {
    const b = h('span.adm-badge', { hidden: true });
    (badges[r.id] ??= []).push(b);
    nav.append(h('a.adm-nav-a', { href: `#${r.id}`, data: { r: r.id } }, ic(r.icon), h('span.adm-nav-l', {}, h('span.adm-nav-full', { text: r.nav || r.name }), h('span.adm-nav-short', { text: r.short })), b));
  }

/** Pastille « à traiter » d'une rubrique (0 : cachée). */
function setBadge(id, n, hot = false) {
  for (const b of badges[id] ?? []) {
    b.hidden = !n;
    b.textContent = n > 99 ? '99+' : String(n);
    b.classList.toggle('is-hot', hot);
    b.setAttribute('aria-label', `${n} à traiter`);
  }
}

const shown = new Set();
function go(first = false) {
  let id = location.hash.slice(1);
  let acc = null;
  if (OLD[id]) {
    [id, acc] = OLD[id];
    history.replaceState(null, '', `#${id}`);
  }
  if (!RUBRIQUES.some((r) => r.id === id)) id = 'vue';
  for (const a of $$('.adm-nav-a')) a.dataset.r === id ? a.setAttribute('aria-current', 'page') : a.removeAttribute('aria-current');
  let page;
  for (const p of $$('[data-adm-page]')) {
    p.hidden = p.dataset.admPage !== id;
    if (!p.hidden) page = p;
  }
  document.title = `${RUBRIQUES.find((r) => r.id === id).name} · Admin ISIS Hub`;
  onShow(id, !shown.has(id));
  shown.add(id);
  if (acc) {
    const d = $(`[data-acc="${acc}"]`);
    if (d) {
      d.open = true;
      setTimeout(() => d.scrollIntoView({ block: 'start', behavior: motionOK() ? 'smooth' : 'auto' }), 50);
    }
  }
  if (first) return;
  app.classList.remove('rt-open');
  window.scrollTo(0, 0);
  $('h1', page)?.focus({ preventScroll: true });
  if (motionOK()) page.animate({ opacity: [0, 1], transform: ['translateY(6px)', 'none'] }, { duration: 240, easing: EASE });
}
addEventListener('hashchange', () => go());

function onShow(id, firstTime) {
  if (id === 'vue' && !firstTime) overview.load();
  if (id === 'tcg') tcgAdmin.show();
  if (id === 'carriere') career.show();
}

$('[data-adm-logout]').addEventListener('click', async () => {
  await api('logout', {}).catch(() => {});
  location.assign('./');
});

// ------------------------------------------------------------ à traiter (vue d'ensemble, pastilles)

const todo = { retours: 0, tcg: 0, stages: 0, salaires: 0 };
function syncTodo() {
  setBadge('retours', todo.retours);
  setBadge('tcg', todo.tcg, true);
  setBadge('carriere', todo.stages + todo.salaires);
  overview.setTodo([
    { n: todo.retours, title: `${todo.retours} ${todo.retours > 1 ? 'retours nouveaux' : 'retour nouveau'}`, sub: 'Lire et répondre', href: '#retours', icon: 'inbox' },
    { n: todo.tcg, title: `${todo.tcg} ${todo.tcg > 1 ? 'éléments' : 'élément'} du TCG à traiter`, sub: 'Cartes à valider, signalements', href: '#tcg', icon: 'spark' },
    { n: todo.stages, title: `${todo.stages} ${todo.stages > 1 ? 'fiches de stage incomplètes' : 'fiche de stage incomplète'}`, sub: 'Compléter', href: '#carriere', icon: 'briefcase' },
    { n: todo.salaires, title: `${todo.salaires} ${todo.salaires > 1 ? 'éléments' : 'élément'} du sondage à vérifier`, sub: 'Réponses imprécises, conseils à relire', href: '#carriere', icon: 'chart' },
  ]);
}

// ------------------------------------------------------------ rubriques

const overview = setupOverview({ root: $('[data-ov]'), api, onError: (err) => toast(`Fréquentation indisponible : ${err.message}`, 'alert') });
const feedback = setupFeedback({
  root: $('[data-fb]'),
  app,
  api,
  onCount: (n) => {
    todo.retours = n;
    syncTodo();
  },
});
const career = setupCareer({
  root: $('[data-career]'),
  onLeave: leave,
  onCounts: (_, c) => {
    todo.stages = c.stages;
    todo.salaires = c.salaires;
    syncTodo();
  },
});
// TCG : lancement, vagues, modération des cartes (admin-tcg.js).
const tcgAdmin = setupTcgAdmin({
  root: $('[data-tcg-admin]'),
  onCount: (n) => {
    todo.tcg = n;
    syncTodo();
  },
  onLeave: leave,
});

// ------------------------------------------------------------ contenu du Hub : répartition des emplois du temps

const MODES = {
  all: 'Toutes les séances (pas de choix)',
  groupLanguage: 'Groupe (et langue)',
  fie4: 'Parcours et groupe (codes de la maquette)',
  fie5: 'Parcours (codes de la maquette)',
};
let classes = null; // répartition en vigueur (api/classes)
const lines = (text) => text.split(/[\n,;]+/).map((x) => x.trim().toUpperCase()).filter(Boolean);
const input = (value, attrs = {}) => h('input.input', { type: 'text', value: value ?? '', attrs });
const field = (label, control, hint) => h('label.adm-field', {}, h('span.label', { text: label }), control, hint ? h('small', { text: hint }) : '');

function trackRow(key = '', label = '', codes = []) {
  const row = h(
    'div.adm-track',
    {},
    field('Parcours (identifiant)', input(key, { 'data-track-key': '', placeholder: 'ia', maxlength: '24' })),
    field('Nom affiché', input(label, { 'data-track-label': '', placeholder: 'Données de santé & IA', maxlength: '40' })),
    field('Codes des matières du parcours', h('textarea.input.textarea', { rows: 4, value: codes.join('\n'), data: { trackCodes: '' }, attrs: { placeholder: 'E4-1-DI-1\nE4-1-DI-2' } }), 'Un code par ligne, comme dans la maquette.'),
    h('button.btn.btn--sm.btn--ghost', { type: 'button', text: 'Retirer le parcours', on: { click: () => row.remove() } }),
  );
  return row;
}

function classCard(key, c) {
  const mode = h('select.input.select', { data: { mode: '' } }, ...Object.entries(MODES).map(([v, l]) => h('option', { value: v, text: l, selected: v === c.filter })));
  const tracks = h('div.adm-tracks', {}, ...Object.entries(c.tracks ?? {}).map(([t, codes]) => trackRow(t, classes.trackLabels?.[t] ?? '', codes)));
  const aliases = Object.entries(c.aliases ?? {}).map(([a, b]) => `${a} = ${b}`).join('\n');
  const extra = {
    groupLanguage: h(
      'div.adm-mode',
      {},
      h('label.check', {}, h('input', { type: 'checkbox', checked: Boolean(c.linkedLanguage), data: { linked: '' } }), h('span.check-box', { attrs: { 'aria-hidden': 'true' } }), h('span.check-text', { text: 'Langue liée au groupe (groupe 1 = chinois, groupe 2 = espagnol)' })),
    ),
    tracks: h(
      'div.adm-mode',
      {},
      h(
        'div.adm-grid3',
        {},
        field('Année dans les codes', input(c.codeYear ?? '', { 'data-code-year': '', inputmode: 'numeric', maxlength: '1', placeholder: '4' }), 'E4-1-… → 4'),
        field('Repère des événements communs', input(c.common ?? '', { 'data-common': '', placeholder: 'ISIS-FIE4-SEMESTRE7', maxlength: '60' }), 'Mode « parcours et groupe » seulement.'),
        field('Alias de codes', h('textarea.input.textarea', { rows: 3, value: aliases, data: { aliases: '' }, attrs: { placeholder: 'E4-1-PROJET = E4-1-PRJ-1' } }), 'Un par ligne : code ADE = code de la maquette.'),
      ),
      tracks,
      h('button.btn.btn--sm', { type: 'button', text: 'Ajouter un parcours', on: { click: () => tracks.append(trackRow()) } }),
    ),
  };
  const modeBox = h('div');
  const showMode = () => modeBox.replaceChildren(mode.value === 'groupLanguage' ? extra.groupLanguage : mode.value === 'fie4' || mode.value === 'fie5' ? extra.tracks : '');
  mode.addEventListener('change', showMode);
  showMode();
  const card = h(
    'details.adm-class',
    { data: { classKey: key } },
    h('summary', {}, h('b', { text: key || 'Nouvelle classe' }), h('span', { text: ` · ${c.label ?? ''} · ${MODES[c.filter] ?? ''}` })),
    h(
      'div.adm-grid3',
      {},
      field('Classe', input(key, { 'data-key': '', placeholder: 'FIE4', maxlength: '7' }), 'Lettres puis chiffre, ex. FIE4.'),
      field('Description', input(c.label, { 'data-label': '', placeholder: '4e année · cycle ingénieur', maxlength: '60' })),
      field('Ressources ADE', input((c.resources ?? []).join(', '), { 'data-resources': '', placeholder: '2732, 2733' }), 'Numéros des ressources (semestres) dans ADE.'),
    ),
    field('Répartition', mode),
    modeBox,
    h('button.btn.btn--sm.btn--ghost', { type: 'button', text: `Retirer ${key || 'cette classe'}`, on: { click: () => confirm(`Retirer la classe ${key} ?`) && card.remove() } }),
  );
  return card;
}

function renderClasses() {
  $('[data-adm-season]').replaceChildren(
    h(
      'div.adm-grid3',
      {},
      field('Projet ADE de l’année', input(classes.projectId, { 'data-project': '', inputmode: 'numeric' }), '10 pour 2026-2027.'),
      field('Début de l’année', input(classes.season?.first, { 'data-first': '', placeholder: 'AAAA-MM-JJ' }), 'Période des abonnements d’agenda.'),
      field('Fin de l’année', input(classes.season?.last, { 'data-last': '', placeholder: 'AAAA-MM-JJ' })),
    ),
  );
  $('[data-adm-classes]').replaceChildren(...Object.entries(classes.classes).map(([k, c]) => classCard(k, c)));
  const n = Object.keys(classes.classes).length;
  $('[data-acc-sub="tt"]').textContent = `${n} ${n > 1 ? 'classes' : 'classe'} · ressources ADE et répartition des séances`;
}

/** Relit le formulaire ; les erreurs de fond sont vérifiées par le serveur. */
function readClasses() {
  const out = {
    projectId: Number($('[data-project]').value),
    season: { first: $('[data-first]').value.trim(), last: $('[data-last]').value.trim() },
    trackLabels: { ...classes.trackLabels },
    classes: {},
  };
  for (const card of $$('.adm-class')) {
    const key = $('[data-key]', card).value.trim().toUpperCase();
    if (!key) throw new Error('une classe n’a pas de nom');
    if (out.classes[key]) throw new Error(`la classe ${key} apparaît deux fois`);
    const c = {
      label: $('[data-label]', card).value.trim(),
      resources: $('[data-resources]', card).value.split(/[\s,;]+/).filter(Boolean).map(Number),
      filter: $('[data-mode]', card).value,
    };
    if (c.filter === 'groupLanguage' && $('[data-linked]', card)?.checked) c.linkedLanguage = true;
    if (c.filter === 'fie4' || c.filter === 'fie5') {
      c.codeYear = Number($('[data-code-year]', card).value);
      if (c.filter === 'fie4') c.common = $('[data-common]', card).value.trim().toUpperCase();
      c.aliases = {};
      for (const line of $('[data-aliases]', card).value.split('\n')) {
        if (!line.trim()) continue;
        const [a, b] = line.split(/=|→/).map((x) => x?.trim().toUpperCase());
        if (!a || !b) throw new Error(`${key} : alias « ${line} » à écrire « ANCIEN = NOUVEAU »`);
        c.aliases[a] = b;
      }
      c.tracks = {};
      for (const row of $$('.adm-track', card)) {
        const t = $('[data-track-key]', row).value.trim().toLowerCase();
        if (!t) continue;
        c.tracks[t] = lines($('[data-track-codes]', row).value);
        const label = $('[data-track-label]', row).value.trim();
        if (label) out.trackLabels[t] = label;
      }
    }
    out.classes[key] = c;
  }
  return out;
}

$('[data-adm-classes-save]').addEventListener('click', async () => {
  let data;
  try {
    data = readClasses();
  } catch (err) {
    return toast(`À corriger : ${err.message}`, 'alert');
  }
  try {
    classes = await api('classes', data);
    renderClasses();
    toast('Répartition enregistrée : elle s’applique dès maintenant aux emplois du temps', 'check');
  } catch (err) {
    toast(`Refusée : ${err.message}`, 'alert');
  }
});
$('[data-adm-classes-reset]').addEventListener('click', () => renderClasses());
$('[data-adm-class-add]').addEventListener('click', () => {
  const card = classCard('', { label: '', resources: [], filter: 'all' });
  card.open = true;
  $('[data-adm-classes]').append(card);
  $('[data-key]', card).focus();
});

// ------------------------------------------------------------ contenu du Hub : raccourcis

let content = { links: [] };
let links = [];

function renderLinks() {
  const box = $('[data-adm-links]');
  box.replaceChildren(
    ...links.map((l, i) => {
      const f = (name, placeholder, max) =>
        h('input.input', { type: name === 'url' ? 'url' : 'text', placeholder, value: l[name] ?? '', attrs: { maxlength: String(max), 'aria-label': `${placeholder}, raccourci ${i + 1}` }, on: { input: (e) => (l[name] = e.target.value) } });
      const mv = (d) => {
        const j = i + d;
        if (j < 0 || j >= links.length) return;
        [links[i], links[j]] = [links[j], links[i]];
        renderLinks();
        $$('.adm-link')[j]?.querySelector(d < 0 ? '[data-up]' : '[data-down]')?.focus();
      };
      return h(
        'li.adm-link',
        {},
        h('span.adm-link-n', { text: String(i + 1) }),
        f('title', 'Titre (ex. Izly)', 40),
        f('subtitle', 'Sous-titre (facultatif)', 80),
        f('url', 'https://…', 500),
        h(
          'span.adm-link-a',
          {},
          h('button.icon-btn', { type: 'button', disabled: i === 0, data: { up: '' }, attrs: { 'aria-label': `Monter ${l.title || 'ce raccourci'}` }, on: { click: () => mv(-1) } }, ic('arrowUp', 'ic ic--sm')),
          h('button.icon-btn', { type: 'button', disabled: i === links.length - 1, data: { down: '' }, attrs: { 'aria-label': `Descendre ${l.title || 'ce raccourci'}` }, on: { click: () => mv(1) } }, ic('arrowDown', 'ic ic--sm')),
          h('button.icon-btn', { type: 'button', attrs: { 'aria-label': `Retirer ${l.title || 'ce raccourci'}` }, on: { click: () => (links.splice(i, 1), renderLinks()) } }, icon('trash', 'ic ic--sm')),
        ),
      );
    }),
  );
  $('[data-acc-sub="links"]').textContent = `${links.length} ${links.length > 1 ? 'liens' : 'lien'} · barre du bas du tableau de bord`;
}

$('[data-adm-link-add]').addEventListener('click', () => {
  if (links.length >= 12) return toast('12 raccourcis au maximum.', 'alert');
  links.push({ title: '', subtitle: '', url: 'https://' });
  renderLinks();
  $$('.adm-link').at(-1)?.querySelector('input')?.focus();
});
$('[data-adm-links-save]').addEventListener('click', async () => {
  const out = links.map((l) => ({ title: (l.title ?? '').trim(), subtitle: (l.subtitle ?? '').trim(), url: (l.url ?? '').trim() }));
  try {
    content = await api('links', { links: out });
    links = (content.links ?? []).map((l) => ({ ...l }));
    renderLinks();
    toast('Raccourcis enregistrés : les étudiants les voient au prochain chargement', 'check');
  } catch (err) {
    toast(`Refusés : ${err.message}`, 'alert');
  }
});

// ------------------------------------------------------------ contenu du Hub : ambiance (décor de saison)
// Activée : tout le monde la voit au prochain chargement, sans annonce. Aperçu : sur cet appareil
// seulement (préférence locale, rien n'est envoyé).

const AMB = 'noel';
const previewing = () => prefs.get('ambiance-apercu') === AMB;
function renderAmbiance() {
  const on = content.ambiance === AMB;
  const state = $('[data-amb-state]');
  state.textContent = on ? 'Visible par tout le monde' : 'Coupée';
  state.classList.toggle('is-on', on);
  const toggle = $('[data-amb-toggle]');
  toggle.textContent = on ? 'Couper' : 'Activer pour tout le monde';
  toggle.classList.toggle('btn--primary', !on);
  $('[data-amb-preview]').textContent = previewing() ? 'Arrêter l’aperçu' : 'Aperçu sur cet appareil';
  $('[data-amb-note]').textContent = on
    ? 'Les étudiants la voient au prochain chargement du Hub.'
    : previewing()
      ? 'Aperçu actif : le Hub l’affiche sur cet appareil seulement, avec une étiquette « Aperçu ». Personne d’autre ne la voit.'
      : 'L’aperçu ne se voit que sur cet appareil et ne change rien pour les étudiants.';
  $('[data-acc-sub="amb"]').textContent = on ? 'Noël · visible par tout le monde' : previewing() ? 'Noël · coupée (aperçu sur cet appareil)' : 'Noël · coupée';
}
$('[data-amb-preview]').addEventListener('click', () => {
  if (previewing()) {
    prefs.set('ambiance-apercu', null);
    return renderAmbiance();
  }
  prefs.set('ambiance-apercu', AMB);
  renderAmbiance();
  window.open('./', '_blank', 'noopener');
});
$('[data-amb-toggle]').addEventListener('click', async (e) => {
  const btn = e.currentTarget;
  const on = content.ambiance === AMB;
  if (!on && !confirm('Activer l’ambiance de Noël pour tout le monde ? Les étudiants la verront au prochain chargement du Hub, sans aucune annonce.')) return;
  btn.disabled = true;
  try {
    content = await api('ambiance', { ambiance: on ? '' : AMB });
    renderAmbiance();
    toast(on ? 'Ambiance coupée.' : 'Ambiance activée pour tout le monde.', 'check');
  } catch (err) {
    toast(`Refusé : ${err.message}`, 'alert');
  } finally {
    btn.disabled = false;
  }
});

const gradesAdmin = setupGradesAdmin({ api, getClasses: () => classes });

// ------------------------------------------------------------ départ

go(true);

async function load() {
  const me = await api('me');
  $('[data-adm-user]').textContent = me.user;
  // Sur cet appareil, le Hub montrera « Accéder à l'administration » dans le menu de ce compte.
  if (me.user) prefs.set('admin-of', me.user.toLowerCase());
  tcgAdmin.counts();
  career.counts();
  syncTodo();
  await feedback.load().catch((err) => toast(`Retours indisponibles : ${err.message}`, 'alert'));
  overview.load();
  [classes, content] = await Promise.all([fetch('api/classes', { cache: 'no-store' }).then((r) => r.json()), fetch('api/content', { cache: 'no-store' }).then((r) => r.json())]);
  links = (content.links ?? []).map((l) => ({ ...l }));
  renderClasses();
  renderLinks();
  renderAmbiance();
  await gradesAdmin.load().catch((err) => toast(`Maquettes de notes indisponibles : ${err.message}`, 'alert'));
}

load().catch((err) => toast(`Chargement impossible : ${err.message}`, 'alert'));
