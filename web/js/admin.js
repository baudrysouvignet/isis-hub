// Administration : retours des étudiants, répartition des emplois du temps par classe, raccourcis.
//
// Cette page n'est servie qu'avec une session administrateur, ouverte par le CAS de l'université
// pour un identifiant de ADMIN_USERS (voir internal/feedback/cas.go). La session est un cookie
// HttpOnly (SameSite=Strict, 8 h) ; chaque appel porte en plus l'en-tête X-Hub-Admin, qu'un autre
// site ne peut pas ajouter. Tout ce qui vient des étudiants est affiché comme du texte.

import { $, $$, h, toast, motionOK, EASE } from './core/dom.js';

if (window.top !== window.self) throw new Error('Refus d’affichage dans un cadre.');

const LAB = { new: 'Nouveau', review: 'À l’étude', planned: 'Planifié', done: 'Fait', declined: 'Refusé' };
const TYP = { idea: 'Idée', better: 'Amélioration', bug: 'Bug', other: 'Autre' };
const MODES = {
  all: 'Toutes les séances (pas de choix)',
  groupLanguage: 'Groupe (et langue)',
  fie4: 'Parcours et groupe (codes de la maquette)',
  fie5: 'Parcours (codes de la maquette)',
};
const dateFmt = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Paris' });
const shortFmt = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', timeZone: 'Europe/Paris' });
const norm = (t) => t.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

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

// ------------------------------------------------------------ onglets, compte

$$('[data-adm-tab]').forEach((r) =>
  r.addEventListener('change', () => {
    for (const p of $$('[data-adm-panel]')) p.hidden = p.dataset.admPanel !== r.value;
  }),
);
$('[data-adm-logout]').addEventListener('click', async () => {
  await api('logout', {}).catch(() => {});
  location.assign('./');
});

// ------------------------------------------------------------ retours

const list = $('[data-adm-list]');
const empty = $('[data-adm-empty]');
const detail = $('[data-adm-detail]');
const search = $('[data-adm-search]');
const fStatus = $('[data-adm-status]');
const fType = $('[data-adm-type]');
let items = [];
let current = null;

function counts() {
  for (const k of Object.keys(LAB)) $(`[data-kpi-n="${k}"]`).textContent = String(items.filter((f) => f.status === k).length);
}

function filter() {
  const q = norm(search.value.trim());
  let n = 0;
  for (const li of $$('li[data-id]', list)) {
    const f = items.find((x) => String(x.id) === li.dataset.id);
    const ok = (!fStatus.value || f.status === fStatus.value) && (!fType.value || f.type === fType.value) && (!q || norm(`${f.title} ${f.desc} ${f.zone} ${f.author ?? ''} ${f.id}`).includes(q));
    li.hidden = !ok;
    if (ok) n++;
  }
  empty.hidden = n > 0;
  $$('[data-kpi]').forEach((k) => k.classList.toggle('is-on', k.dataset.kpi === fStatus.value));
}

function renderList() {
  $$('li[data-id]', list).forEach((li) => li.remove());
  for (const f of items) {
    list.insertBefore(
      h(
        'li',
        { data: { id: f.id, status: f.status, type: f.type } },
        h(
          'button.adm-item',
          { type: 'button', class: current === f.id ? 'is-on' : '', data: { admItem: f.id } },
          h('span.adm-votes', {}, h('b', { text: `#${f.id}` })),
          h('span.adm-main', {}, h('b', { text: f.title }), h('span', { text: `${TYP[f.type]} · ${f.zone} · ${shortFmt.format(new Date(f.created))} · ${f.author || 'Anonyme'}` })),
          h('span.status', { class: `status--${f.status}`, text: LAB[f.status], data: { admPill: '' } }),
        ),
      ),
      empty,
    );
  }
  counts();
  filter();
}

function select(id) {
  current = id;
  const f = items.find((x) => x.id === id);
  $$('[data-adm-item]', list).forEach((b) => b.classList.toggle('is-on', b.dataset.admItem === String(id)));
  $('[data-adm-type-lab]').textContent = TYP[f.type];
  $('[data-adm-ref]').textContent = `#${f.id} · ${f.zone}`;
  $('[data-adm-title]').textContent = f.title;
  $('[data-adm-desc]').textContent = f.desc;
  $('[data-adm-author]').textContent = f.author ? `${f.author} (déclaré par la page, non vérifié)` : 'Anonyme';
  $('[data-adm-dates]').textContent = `Reçu le ${dateFmt.format(new Date(f.created))}${f.updated !== f.created ? ` · modifié le ${dateFmt.format(new Date(f.updated))}` : ''}`;
  $('[data-adm-tech]').textContent = f.tech || 'Non jointes';
  $('[data-adm-set]').value = f.status;
  $('[data-adm-reply]').value = f.reply ?? '';
  $('[data-adm-note]').value = f.note ?? '';
  detail.hidden = false;
  if (motionOK()) detail.animate([{ opacity: 0, transform: 'translateY(6px)' }, { opacity: 1, transform: 'none' }], { duration: 260, easing: EASE });
  if (matchMedia('(max-width: 759.98px)').matches) detail.scrollIntoView({ behavior: motionOK() ? 'smooth' : 'auto' });
}

list.addEventListener('click', (e) => {
  const b = e.target.closest('[data-adm-item]');
  if (b) select(Number(b.dataset.admItem));
});
[search, fStatus, fType].forEach((x) => x.addEventListener('input', filter));
$$('[data-kpi]').forEach((k) =>
  k.addEventListener('click', () => {
    fStatus.value = fStatus.value === k.dataset.kpi ? '' : k.dataset.kpi;
    filter();
  }),
);
$('[data-adm-close]').addEventListener('click', () => {
  detail.hidden = true;
  $(`[data-adm-item="${current}"]`)?.focus();
});
$('[data-adm-save]').addEventListener('click', async () => {
  try {
    const saved = await api(`feedback/${current}`, {
      status: $('[data-adm-set]').value,
      reply: $('[data-adm-reply]').value,
      note: $('[data-adm-note]').value,
    });
    items = items.map((f) => (f.id === saved.id ? saved : f));
    renderList();
    select(saved.id);
    toast(`#${saved.id} enregistré · ${LAB[saved.status]}${saved.reply ? ', réponse visible par l’étudiant' : ''}`, 'check');
  } catch (err) {
    toast(`Enregistrement impossible : ${err.message}`);
  }
});

// ------------------------------------------------------------ répartition des emplois du temps

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
  const season = $('[data-adm-season]');
  season.replaceChildren(
    h(
      'div.adm-grid3',
      {},
      field('Projet ADE de l’année', input(classes.projectId, { 'data-project': '', inputmode: 'numeric' }), '10 pour 2026-2027.'),
      field('Début de l’année', input(classes.season?.first, { 'data-first': '', placeholder: 'AAAA-MM-JJ' }), 'Période des abonnements d’agenda.'),
      field('Fin de l’année', input(classes.season?.last, { 'data-last': '', placeholder: 'AAAA-MM-JJ' })),
    ),
  );
  $('[data-adm-classes]').replaceChildren(...Object.entries(classes.classes).map(([k, c]) => classCard(k, c)));
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
    return toast(`À corriger : ${err.message}`);
  }
  try {
    classes = await api('classes', data);
    renderClasses();
    toast('Répartition enregistrée : elle s’applique dès maintenant aux emplois du temps', 'check');
  } catch (err) {
    toast(`Refusée : ${err.message}`);
  }
});
$('[data-adm-classes-reset]').addEventListener('click', () => renderClasses());
$('[data-adm-class-add]').addEventListener('click', () => {
  const card = classCard('', { label: '', resources: [], filter: 'all' });
  card.open = true;
  $('[data-adm-classes]').append(card);
  $('[data-key]', card).focus();
});

// ------------------------------------------------------------ raccourcis

let content = { links: [] };

function linkRow(l = {}) {
  const f = (name, placeholder, value, max) => h('input.input', { type: name === 'url' ? 'url' : 'text', placeholder, value: value ?? '', data: { field: name }, attrs: { maxlength: String(max), 'aria-label': placeholder } });
  const row = h(
    'div.adm-link',
    {},
    f('title', 'Titre (ex. Izly)', l.title, 40),
    f('subtitle', 'Sous-titre (facultatif)', l.subtitle, 80),
    f('url', 'https://…', l.url, 500),
    h('button.btn.btn--sm.btn--ghost', { type: 'button', text: 'Retirer', on: { click: () => row.remove() } }),
  );
  return row;
}

const renderLinks = () => $('[data-adm-links]').replaceChildren(...(content.links ?? []).map(linkRow));

$('[data-adm-link-add]').addEventListener('click', () => {
  const box = $('[data-adm-links]');
  if (box.children.length >= 12) return toast('12 raccourcis au maximum.');
  box.append(linkRow());
  box.lastElementChild.querySelector('input').focus();
});
$('[data-adm-links-save]').addEventListener('click', async () => {
  const links = $$('.adm-link').map((row) => Object.fromEntries($$('input', row).map((i) => [i.dataset.field, i.value.trim()])));
  try {
    content = await api('links', { links });
    renderLinks();
    toast('Raccourcis enregistrés : les étudiants les voient au prochain chargement', 'check');
  } catch (err) {
    toast(`Refusés : ${err.message}`);
  }
});

// ------------------------------------------------------------ départ

async function load() {
  const me = await api('me');
  $('[data-adm-user]').textContent = `Connecté : ${me.user}`;
  items = await api('feedback');
  renderList();
  if (items.length) select(items[0].id);
  else detail.hidden = true;
  [classes, content] = await Promise.all([
    fetch('api/classes', { cache: 'no-store' }).then((r) => r.json()),
    fetch('api/content', { cache: 'no-store' }).then((r) => r.json()),
  ]);
  renderClasses();
  renderLinks();
}

load().catch((err) => toast(`Chargement impossible : ${err.message}`));
