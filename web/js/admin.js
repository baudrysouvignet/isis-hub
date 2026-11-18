// Administration : retours des étudiants, répartition des emplois du temps par classe, raccourcis.
//
// Cette page n'est servie qu'avec une session administrateur, ouverte par le CAS de l'université
// pour un identifiant de ADMIN_USERS (voir internal/feedback/cas.go). La session est un cookie
// HttpOnly (SameSite=Strict, 8 h) ; chaque appel porte en plus l'en-tête X-Hub-Admin, qu'un autre
// site ne peut pas ajouter. Tout ce qui vient des étudiants est affiché comme du texte.

import { $, $$, h, toast, motionOK, EASE } from './core/dom.js';
import { setupGradesAdmin } from './admin-grades.js';

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

// ------------------------------------------------------------ fréquentation

const WEEK = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];
const nf = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 });

function bars(box, rows) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  box.replaceChildren(
    ...rows.map((r) => {
      const bar = h('i', { attrs: { 'aria-hidden': 'true' } });
      bar.style.setProperty('--v', String(r.value / max));
      return h('div.adm-bar', { title: `${r.title} : ${nf.format(r.value)}` }, h('b', { text: nf.format(r.value) }), bar, h('span', { text: r.label }));
    }),
  );
}

// Filtres et graphiques faits ici, à partir des compteurs par jour (api/admin/stats).
const METRICS = {
  visitors: { unit: 'visiteurs distincts', get: (d) => (d.accounts ?? 0) + (d.guests ?? 0) },
  accounts: { unit: 'comptes connectés', get: (d) => d.accounts ?? 0 },
  guests: { unit: 'visiteurs sans connexion', get: (d) => d.guests ?? 0 },
  unique: { unit: 'appareils distincts', get: (d) => d.unique ?? 0 },
  visits: { unit: 'ouvertures', get: (d) => d.visits ?? 0 },
};
const DEVICES = { phone: 'Téléphone', tablet: 'Tablette', desktop: 'Ordinateur' };
const APP_MODES = { app: 'Application installée', browser: 'Navigateur' };
const dayFmt = new Intl.DateTimeFormat('fr-FR', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
const atNoon = (iso) => new Date(`${iso}T12:00:00Z`);
const SVG = 'http://www.w3.org/2000/svg';
const svg = (tag, attrs = {}, ...kids) => {
  const el = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  el.append(...kids.filter(Boolean));
  return el;
};
const st = { data: null, period: '30', metric: 'visitors', cls: '' };

function hbars(box, entries, labels = {}) {
  const total = entries.reduce((n, [, v]) => n + v, 0);
  if (!total) return box.replaceChildren(h('p.hint', { text: 'Pas encore de données sur la période.' }));
  const max = Math.max(...entries.map(([, v]) => v));
  box.replaceChildren(
    ...entries
      .sort((x, y) => y[1] - x[1])
      .map(([k, v]) => {
        const bar = h('i', { attrs: { 'aria-hidden': 'true' } });
        bar.style.setProperty('--v', String(v / max));
        return h(
          'div.st-hbar',
          { title: `${labels[k] ?? k} : ${nf.format(v)}` },
          h('span', { text: labels[k] ?? k }),
          h('span.st-track', {}, bar),
          h('b', { text: `${nf.format(v)} · ${Math.round((v / total) * 100)} %` }),
        );
      }),
  );
}

/** Pas de graduation lisible (1, 2, 5, 10…) pour 4 lignes environ. */
function niceStep(max) {
  const raw = max / 4;
  const p = 10 ** Math.floor(Math.log10(raw));
  const m = raw / p;
  return Math.max(1, (m <= 1 ? 1 : m <= 2 ? 2 : m <= 5 ? 5 : 10) * p);
}

function lineChart(box, rows, unit, markDate) {
  const W = 720;
  const H = 220;
  const L = 34;
  const R = 10;
  const T = 12;
  const B = 26;
  // r.v === null : pas encore compté ce jour-là (trou, pas zéro). r.ref : appareils distincts, en fond.
  const max = Math.max(1, ...rows.map((r) => Math.max(r.v ?? 0, r.ref ?? 0)));
  const step = niceStep(max);
  const top = Math.ceil(max / step) * step;
  const x = (i) => L + (rows.length > 1 ? (i * (W - L - R)) / (rows.length - 1) : (W - L - R) / 2);
  const y = (v) => T + (H - T - B) * (1 - v / top);
  const grid = [];
  for (let v = 0; v <= top + 1e-9; v += step) {
    grid.push(svg('line', { x1: L, x2: W - R, y1: y(v), y2: y(v), class: 'st-grid-line' }));
    grid.push(svg('text', { x: L - 6, y: y(v) + 4, class: 'st-axis', 'text-anchor': 'end' }, nf.format(v)));
  }
  const shown = rows.map((r, i) => [r, i]).filter(([r]) => r.v !== null);
  const pts = shown.map(([r, i]) => `${x(i).toFixed(1)},${y(r.v).toFixed(1)}`);
  const area = shown.length ? `M${x(shown[0][1]).toFixed(1)},${y(0)} L${pts.join(' L')} L${x(shown.at(-1)[1]).toFixed(1)},${y(0)} Z` : '';
  const ref = rows.some((r) => r.ref !== undefined) ? rows.map((r, i) => `${x(i).toFixed(1)},${y(r.ref ?? 0).toFixed(1)}`).join(' ') : '';
  const every = Math.ceil(rows.length / 8);
  const labels = rows
    .map((r, i) => (i % every === 0 || i === rows.length - 1 ? svg('text', { x: x(i), y: H - 6, class: 'st-axis', 'text-anchor': 'middle' }, String(atNoon(r.date).getUTCDate())) : null))
    .filter(Boolean);
  const mark = markDate ? rows.findIndex((r) => r.date === markDate) : -1;
  const tip = (r) =>
    svg('title', {}, `${dayFmt.format(atNoon(r.date))} : ${r.v === null ? 'pas encore compté' : `${nf.format(r.v)} ${unit}`}${r.ref !== undefined ? ` · ${nf.format(r.ref)} appareils distincts` : ''}`);
  const dots = shown.length > 60 ? [] : shown.map(([r, i]) => svg('circle', { cx: x(i), cy: y(r.v), r: 3, class: 'st-dot' }));
  // Une zone de survol par jour : la valeur se lit à la souris comme au doigt.
  const slot = (W - L - R) / Math.max(1, rows.length - 1);
  const hits = rows.map((r, i) => svg('rect', { x: x(i) - slot / 2, y: T, width: Math.max(2, slot), height: H - T - B, class: 'st-hit' }, tip(r)));
  box.replaceChildren(
    svg(
      'svg',
      { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': `${unit} par jour` },
      ...grid,
      mark > 0 ? svg('line', { x1: x(mark), x2: x(mark), y1: T, y2: H - B, class: 'st-mark' }) : null,
      ref ? svg('polyline', { points: ref, class: 'st-ref' }) : null,
      area ? svg('path', { d: area, class: 'st-area' }) : null,
      pts.length ? svg('polyline', { points: pts.join(' '), class: 'st-line' }) : null,
      ...dots,
      ...labels,
      ...hits,
    ),
  );
}

function renderStats() {
  const all = st.data?.days ?? [];
  const today = all.at(-1)?.date;
  const since = st.data?.accountsSince ?? '';
  const firstUsed = Math.max(0, all.findIndex((d) => d.visits > 0 || d.unique > 0));
  let days = st.period === 'all' ? all.slice(firstUsed) : all.slice(-Number(st.period));
  if (days.length < 2) days = all.slice(-7);
  const metric = METRICS[st.metric];
  const get = st.cls ? (d) => d.classes?.[st.cls] ?? 0 : metric.get;
  const unit = st.cls ? `visiteurs de ${st.cls}` : metric.unit;
  const rows = days.map((d) => ({ date: d.date, v: get(d) }));
  // Mesures par compte, classe ou appareil : rien avant le premier jour compté ainsi.
  const byAccount = Boolean(st.cls) || ['visitors', 'accounts', 'guests'].includes(st.metric);
  const counted = byAccount ? rows.filter((r) => r.date >= since) : rows;
  const sum = counted.reduce((n, r) => n + r.v, 0);
  const peak = counted.reduce((m, r) => (r.v > m.v ? r : m), { v: 0, date: '' });
  $('[data-st="today"]').textContent = nf.format(rows.at(-1)?.v ?? 0);
  $('[data-st-unit]').textContent = unit;
  $('[data-st="avg"]').textContent = counted.length ? nf.format(sum / counted.length) : '–';
  $('[data-st-range]').textContent = counted.length ? `sur ${counted.length} jour${counted.length > 1 ? 's' : ''}` : 'pas encore de données';
  $('[data-st="peak"]').textContent = peak.date ? nf.format(peak.v) : '–';
  $('[data-st="peakday"]').textContent = peak.date ? dayFmt.format(atNoon(peak.date)) : '';
  $('[data-st="total"]').textContent = nf.format(days.reduce((n, d) => n + (d.visits ?? 0), 0));
  $('[data-st-chart-title]').textContent = `${unit[0].toUpperCase()}${unit.slice(1)}, par jour`;
  const before = byAccount && rows[0]?.date < since;
  // Avant le comptage par compte : un trou (pas un zéro), avec les appareils distincts en fond.
  const drawn = byAccount
    ? rows.map((r, i) => ({ ...r, v: r.date >= since ? r.v : null, ref: st.cls ? undefined : days[i].unique ?? 0 }))
    : rows;
  lineChart($('[data-st-chart]'), drawn, unit, before ? since : '');
  const note = $('[data-st-note]');
  note.hidden = !byAccount;
  note.textContent = before
    ? `Comptage par compte, classe et appareil depuis le ${dayFmt.format(atNoon(since))} (trait pointillé) : avant, seuls les appareils et les ouvertures étaient comptés.${st.cls ? '' : ' En gris : appareils distincts, pour comparer.'}`
    : st.cls ? '' : 'En gris : appareils distincts, pour comparer.';
  note.hidden = !note.textContent;
  // Jours de la semaine : moyenne de la mesure sur les jours comptés de la période.
  const wsum = Array(7).fill(0);
  const wn = Array(7).fill(0);
  for (const r of counted) {
    const wd = (atNoon(r.date).getUTCDay() + 6) % 7;
    wsum[wd] += r.v;
    wn[wd] += 1;
  }
  bars($('[data-st-week]'), WEEK.map((label, i) => ({ value: wn[i] ? wsum[i] / wn[i] : 0, label, title: `Moyenne du ${label.toLowerCase()}.` })));
  const add = (key) => {
    const out = {};
    for (const d of days) for (const [k, v] of Object.entries(d[key] ?? {})) out[k] = (out[k] ?? 0) + v;
    return Object.entries(out);
  };
  hbars($('[data-st-classes]'), st.cls ? add('classes').filter(([k]) => k === st.cls) : add('classes'));
  hbars($('[data-st-devices]'), add('devices'), DEVICES);
  hbars($('[data-st-modes]'), add('modes'), APP_MODES);
  $('[data-st-since]').textContent =
    `Répartitions : visiteurs distincts de chaque jour, additionnés sur la période${st.cls ? ' ; appareils et modes restent toutes classes confondues (jamais croisés avec la classe)' : ''}. Dernier jour : ${today ? dayFmt.format(atNoon(today)) : '–'}.`;
  $('[data-st-metric]').disabled = Boolean(st.cls);
}

async function loadStats() {
  st.data = await api('stats');
  const found = new Set();
  for (const d of st.data.days ?? []) Object.keys(d.classes ?? {}).forEach((k) => found.add(k));
  Object.keys(classes?.classes ?? {}).forEach((k) => found.add(k));
  const sel = $('[data-st-class]');
  sel.replaceChildren(h('option', { value: '', text: 'Toutes les classes' }), ...[...found].sort().map((k) => h('option', { value: k, text: k })));
  sel.value = st.cls;
  renderStats();
}

$$('[data-st-period] [data-p]').forEach((b) =>
  b.addEventListener('click', () => {
    st.period = b.dataset.p;
    $$('[data-st-period] [data-p]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    renderStats();
  }),
);
$('[data-st-metric]').addEventListener('change', (e) => {
  st.metric = e.target.value;
  renderStats();
});
$('[data-st-class]').addEventListener('change', (e) => {
  st.cls = e.target.value;
  renderStats();
});

const gradesAdmin = setupGradesAdmin({ api, getClasses: () => classes });

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
  await gradesAdmin.load().catch((err) => toast(`Maquettes de notes indisponibles : ${err.message}`));
  await loadStats().catch((err) => toast(`Fréquentation indisponible : ${err.message}`));
}

load().catch((err) => toast(`Chargement impossible : ${err.message}`));
