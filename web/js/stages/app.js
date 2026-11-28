// Rubrique Stages d'ISIS Hub : tous les stages des étudiants d'ISIS, sur une carte de France (région,
// département, ville), en liste, avec une recherche et des filtres. Une fiche par structure : les
// étudiants passés là et leurs sujets, les maîtres de stage et les contacts RH, avec leurs adresses.
//
// Fermée tant que l'administration ne l'ouvre pas. Les données ne viennent que du serveur, à une
// session ouverte par un ticket CAS : l'index (recherche, carte) n'a aucune adresse e-mail, les
// contacts d'une structure se lisent fiche par fiche (chaque ouverture est inscrite au journal du
// serveur, 90 jours). Rien n'est gardé sur l'appareil.

import { $, $$, h, icon, toast, motionOK, EASE } from '../core/dom.js';
import { prefs } from '../core/store.js';
import { modal, copyButton } from '../ui/layout.js';
import { api, StagesError } from './api.js';
import { createModel, blank, yearLabel, DURATIONS, STATUTS } from './model.js';

const NS = 'http://www.w3.org/2000/svg';
// Pictogrammes propres à la rubrique (secteurs, lieux, contacts) : « C… » trace un cercle.
const ICONS = {
  Santé: ['M9.5 4.5h5v5h5v5h-5v5h-5v-5h-5v-5h5z'],
  Pharmacie: ['M9 3.5h6M10 3.5v5.2L5.6 17a2.5 2.5 0 0 0 2.2 3.5h8.4a2.5 2.5 0 0 0 2.2-3.5L14 8.7V3.5', 'M7.5 14h9'],
  Numérique: ['M8.5 8l-4 4 4 4M15.5 8l4 4-4 4M13.5 5.5l-3 13'],
  Recherche: ['M10.5 17a6.5 6.5 0 1 1 0-13 6.5 6.5 0 0 1 0 13z', 'M15.5 15.5L20 20'],
  Enseignement: ['M2.5 9.5L12 5l9.5 4.5L12 14z', 'M6.5 11.5V16c1.5 1.6 3.4 2.5 5.5 2.5s4-.9 5.5-2.5v-4.5'],
  Industrie: ['M3.5 20.5v-9l5 3v-3l5 3v-3l5 3v6z', 'M16.5 9V3.5h3v7'],
  Public: ['M3.5 9.5L12 4.5l8.5 5', 'M5.5 10v8M10 10v8M14 10v8M18.5 10v8M3.5 20.5h17'],
  Commerce: ['M5 8h14l-1 12.5H6z', 'M9 8V6.5a3 3 0 0 1 6 0V8'],
  Social: ['M12 20s-7.5-4.5-7.5-10A4.3 4.3 0 0 1 12 7.4 4.3 4.3 0 0 1 19.5 10c0 5.5-7.5 10-7.5 10z'],
  Services: ['M3.5 8h17v11.5h-17z', 'M9 8V5.5h6V8M3.5 13h17'],
  'Sport & culture': ['M12 4l2.4 5 5.4.6-4 3.7 1.1 5.4L12 16l-4.9 2.7 1.1-5.4-4-3.7 5.4-.6z'],
  Autre: ['M6 12h.01M12 12h.01M18 12h.01'],
  map: ['M9 4.5l-5.5 2v13l5.5-2 6 2 5.5-2v-13l-5.5 2z', 'M9 4.5v13M15 6.5v13'],
  globe: ['M3.5 12h17', 'M12 3.5c2.4 2.5 3.6 5.3 3.6 8.5s-1.2 6-3.6 8.5c-2.4-2.5-3.6-5.3-3.6-8.5s1.2-6 3.6-8.5z', 'C12 12 8.5'],
  island: ['M4 18.5c2.5-1.5 5-1.5 8 0s5.5 1.5 8 0', 'M12 15.5V9M12 9C10 6 7 6 5.5 7.5M12 9c2-3 5-3 6.5-1.5M12 9c-1-2.5-.5-4.5 1-5.5'],
  question: ['M9.5 9a2.5 2.5 0 1 1 3.6 2.2c-.7.4-1.1 1-1.1 1.8v.5M12 16.5v.1', 'C12 12 8.5'],
  mail: ['M3.5 6.5h17v11h-17z', 'M3.5 7l8.5 6.5L20.5 7'],
  phone: ['M8 3.5H5.5a1.5 1.5 0 0 0-1.5 1.6C4.6 13.4 10.6 19.4 18.9 20a1.5 1.5 0 0 0 1.6-1.5V16l-4-1.5-2 2a12 12 0 0 1-5.5-5.5l2-2z'],
  web: ['C12 12 8.5', 'M3.5 12h17M12 3.5c2.4 2.5 3.6 5.3 3.6 8.5s-1.2 6-3.6 8.5c-2.4-2.5-3.6-5.3-3.6-8.5s1.2-6 3.6-8.5z'],
  coin: ['C12 12 8.5', 'M14.5 9.5c-.5-1-1.5-1.5-2.5-1.5-1.5 0-2.5.8-2.5 2s1 1.6 2.5 2 2.5.9 2.5 2-1 2-2.5 2c-1.1 0-2.1-.5-2.6-1.5M12 6.5V8M12 16v1.5'],
  shield: ['M12 3.5l7 2.5v5.5c0 4.5-3 8-7 9.5-4-1.5-7-5-7-9.5V6z', 'M9 12l2 2 4-4'],
  people: ['C9 8.5 3', 'M3.5 19.5a5.5 5.5 0 0 1 11 0M15.5 5.8a3 3 0 0 1 0 5.4M17.5 14.5a5.5 5.5 0 0 1 3 5'],
  clock: ['C12 12 8.5', 'M12 7.5V12l3 2'],
  cal: ['M4.5 6.5h15v13h-15z', 'M4.5 10.5h15M8.5 4v4M15.5 4v4'],
  layers: ['M12 4l8.5 4.5L12 13 3.5 8.5z', 'M3.5 12.5L12 17l8.5-4.5M3.5 16.5L12 21l8.5-4.5'],
};
function sic(name, cls = 'ic ic--sm') {
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('class', cls);
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  for (const d of ICONS[name] || ICONS.Autre) {
    let e;
    if (d.startsWith('C')) {
      const [cx, cy, r] = d.slice(1).trim().split(' ');
      e = document.createElementNS(NS, 'circle');
      e.setAttribute('cx', cx);
      e.setAttribute('cy', cy);
      e.setAttribute('r', r);
    } else {
      e = document.createElementNS(NS, 'path');
      e.setAttribute('d', d);
    }
    svg.append(e);
  }
  return svg;
}

/** Logo d'une structure : monogramme sur une des 12 couleurs, pictogramme du secteur en coin. */
function logo(c, size = '') {
  const mono = c.mono ?? c.m;
  return h(
    `span.stg-logo.lg-${c.color ?? c.c}${size ? `.stg-logo--${size}` : ''}`,
    { attrs: { 'aria-hidden': 'true' } },
    h('span.stg-logo-m', { text: mono, class: mono.length > 2 ? 'is-long' : '' }),
    h('span.stg-logo-s', {}, sic(c.sector ?? c.s, 'ic')),
  );
}

const MONTHS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
const MONTHS_LONG = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
const DAYS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
const monthLabel = (ym) => (ym ? `${MONTHS[Number(ym.slice(5, 7)) - 1]} ${ym.slice(0, 4)}` : '');
const plural = (n, one, many = `${one}s`) => `${n} ${n > 1 ? many : one}`;
const levelsLabel = (ls) => (ls.length ? `FIE ${ls.join(' · ')}` : '');
const span = (a, b) => (a == null ? '' : a === b ? yearLabel(a) : `${yearLabel(a)} → ${yearLabel(b)}`);
const dayLabel = (iso) => {
  if (!iso) return '';
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return `${DAYS[dt.getUTCDay()]} ${d === 1 ? '1er' : d} ${MONTHS_LONG[m - 1]} ${y}`;
};
const initials = (name) =>
  (name || '?')
    .split(/[\s-]+/)
    .filter(Boolean)
    .map((w) => w[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
/** Première phrase de la mission (150 caractères au plus). */
const subject = (mi) => {
  if (!mi) return '';
  const first = mi.split(/(?<=[.!?;])\s+|\n+/)[0].trim();
  return first.length > 150 ? `${first.slice(0, 147).replace(/\s+\S*$/, '')}…` : first;
};
/** Site saisi sans protocole : https:// (le serveur n'accepte que http(s) ou un nom de domaine). */
const webHref = (w) => (/^https?:\/\//i.test(w) ? w : `https://${w}`);

const AWAY = {
  om: { label: 'Outre-mer', icon: 'island' },
  monde: { label: 'À l’étranger', icon: 'globe' },
  inconnu: { label: 'Lieu non renseigné', icon: 'question' },
};

/**
 * o : { app, modes, isSignedIn(), onLogin(), getTicket(), promo(), beforeOpen(), onAvailable(on) }
 */
export function createStages(o) {
  const page = $('#stages');
  const els = {
    q: $('[data-stg-q]', page),
    view: $('[data-stg-view]', page),
    filters: $('[data-stg-filters]', page),
    ftoggle: $('[data-stg-ftoggle]', page),
    fcount: $('[data-stg-fcount]', page),
    crumbs: $('[data-stg-crumbs]', page),
    map: $('[data-stg-map]', page),
    legend: $('[data-stg-legend]', page),
    away: $('[data-stg-away]', page),
    title: $('[data-stg-res-title]', page),
    sub: $('[data-stg-res-sub]', page),
    sort: $('[data-stg-sort]', page),
    cards: $('[data-stg-cards]', page),
    pager: $('[data-stg-pager]', page),
    foot: $('[data-stg-foot]', page),
  };
  const tile = $('[data-tile="stages"]');

  let available = false; // rubrique ouverte (ou aperçu de l'administration sur cet appareil)
  let open = false;
  let built = false;
  let geo = null;
  let model = null;
  let ix = null;
  let loading = null;
  let failed = null; // dernière erreur de chargement
  let map = null;
  const contacts = new Map(); // structure → Map(contact → { mail, old, chk }), lue fiche par fiche
  const st = { f: blank(), zone: { kind: 'fr' }, view: 'map', page: 0, sort: 'count' };

  // ---------------------------------------------------------------- données
  /** Session (ticket CAS si besoin), index, puis géométrie de la carte. */
  function ensureData() {
    if (model) return Promise.resolve(model);
    loading ??= (async () => {
      try {
        try {
          ix = await api.index();
        } catch (err) {
          if (!(err instanceof StagesError) || err.status !== 401) throw err;
          await api.join(await o.getTicket());
          ix = await api.index();
        }
        geo ??= await import('./geo.js');
        model = createModel(ix, geo);
        failed = null;
        return model;
      } catch (err) {
        failed = err;
        throw err;
      } finally {
        loading = null;
      }
    })();
    return loading;
  }

  async function structureContacts(id) {
    if (contacts.has(id)) return contacts.get(id);
    const res = await api.structure(id);
    const m = new Map((res.contacts ?? []).map((c) => [c.id, c]));
    contacts.set(id, m);
    return m;
  }

  // ---------------------------------------------------------------- rubrique
  o.modes.register('stages', {
    el: page,
    onEnter() {
      open = true;
      history.replaceState(null, '', `${location.pathname}${location.search}#stages`);
      if (motionOK()) page.animate({ opacity: [0, 1], transform: ['translateY(8px)', 'none'] }, { duration: 300, easing: EASE });
      show();
    },
    onLeave() {
      open = false;
      if (location.hash === '#stages') history.replaceState(null, '', location.pathname + location.search);
    },
  });
  o.modes.onTab('stages', enter);

  function enter() {
    if (!available) return;
    if (!o.isSignedIn()) {
      toast('Connecte-toi pour voir les stages : ils sont réservés aux étudiants d’ISIS.', 'lock');
      history.replaceState(null, '', `${location.pathname}${location.search}#stages`);
      return o.onLogin();
    }
    o.beforeOpen?.();
    o.modes.set('stages');
  }
  $$('[data-open-stages]').forEach((b) => b.addEventListener('click', enter));

  /** Affiche la page (chargement, erreur ou résultats). */
  async function show() {
    if (!model) {
      els.title.textContent = 'Stages';
      els.sub.textContent = '';
      els.cards.replaceChildren(h('li.stg-empty', {}, h('span.spinner'), h('p', { text: 'Chargement des stages…' })));
      try {
        await ensureData();
      } catch (err) {
        return showError(err);
      }
    }
    build();
    render({ instant: true });
  }

  function showError(err) {
    const closed = err instanceof StagesError && err.status === 404;
    els.title.textContent = closed ? 'Rubrique fermée' : 'Stages indisponibles';
    els.sub.textContent = '';
    els.cards.replaceChildren(
      h(
        'li.stg-empty',
        {},
        h('p', { text: closed ? 'La rubrique Stages n’est pas ouverte pour l’instant.' : err?.message || 'Les stages n’ont pas pu être chargés.' }),
        closed ? null : h('button.btn.btn--sm', { type: 'button', text: 'Réessayer', on: { click: show } }),
      ),
    );
  }

  // ---------------------------------------------------------------- page
  const myLevel = () => Number(String(o.promo?.() || '').match(/FI[AE]\s*(\d)/i)?.[1]) || null;
  const GROUPS = () => [
    { key: 'level', label: 'Niveau', opts: model.levels.map((v) => [v, `FIE ${v}`]), hint: 'FIE 1 et 2 : stages de découverte, FIE 3 à 5 : stages d’ingénieur' },
    { key: 'year', label: 'Année', opts: model.years.map((v) => [v, yearLabel(v)]) },
    { key: 'promo', label: 'Promo', opts: model.promos.map((v) => [v, `Promo ${v}`]) },
    { key: 'sector', label: 'Secteur', opts: model.sectors.map((v) => [v, v]) },
    { key: 'statut', label: 'Structure', opts: [...STATUTS.map((v) => [v, v]), ['Autre', 'Non précisée']] },
    { key: 'dur', label: 'Durée', opts: DURATIONS.map((d) => [d.id, d.label]) },
  ];

  function mountMap() {
    import('./map.js').then(({ createFranceMap }) => {
      els.map.replaceChildren();
      map = createFranceMap(els.map, geo, { onPick: pick });
      render({ instant: true });
    });
  }

  let wired = false;
  function build() {
    if (built) return;
    built = true;
    buildFilters();
    mountMap();
    renderFoot();
    if (wired) return;
    wired = true;
    let qTimer;
    els.q.addEventListener('input', () => {
      clearTimeout(qTimer);
      qTimer = setTimeout(() => {
        st.f.q = els.q.value;
        st.page = 0;
        render();
      }, 160);
    });
    $$('[data-stg-view-btn]', els.view).forEach((b) =>
      b.addEventListener('click', () => {
        st.view = b.dataset.stgViewBtn;
        render();
      }),
    );
    els.sort.addEventListener('change', () => {
      st.sort = els.sort.value;
      st.page = 0;
      render();
    });
    els.ftoggle.addEventListener('click', () => {
      const on = els.ftoggle.getAttribute('aria-expanded') !== 'true';
      els.ftoggle.setAttribute('aria-expanded', String(on));
      els.filters.classList.toggle('is-open', on);
    });
  }

  function renderFoot() {
    const m = ix.meta ?? {};
    const builtOn = ix.built ? new Date(`${ix.built}T12:00:00`).toLocaleDateString('fr-FR') : '';
    els.foot.replaceChildren(
      sic('shield'),
      h(
        'span',
        {},
        `Données : ${plural(model.count, 'stage')}${ix.source ? ` (${ix.source})` : ''}, nettoyées le ${builtOn}${m.merged ? ` : ${m.merged} doublons réunis` : ''}${m.mergedContacts ? `, ${m.mergedContacts} contacts saisis deux fois réunis` : ''}. Seules les informations utiles pour chercher un stage sont gardées. Pas d’export : 12 structures par page, contacts lisibles fiche par fiche, chaque fiche ouverte est notée (90 jours). Carte : Natural Earth (domaine public), communes INSEE, coordonnées GeoNames (CC BY 4.0).`,
      ),
    );
  }

  let filtersWired = false;
  function buildFilters() {
    const row = [];
    const ml = myLevel();
    if (ml) row.push(h('button.stg-chip.stg-chip--me', { type: 'button', attrs: { 'aria-pressed': 'false' }, data: { stgMe: ml }, on: { click: () => toggleMe(ml) } }, sic('people'), `Comme moi : FIE ${ml}`));
    for (const g of GROUPS()) {
      const pop = h('div.stg-pop', { attrs: { role: 'group', 'aria-label': g.label } });
      if (g.hint) pop.append(h('p.stg-pop-hint', { text: g.hint }));
      for (const [v, label] of g.opts) {
        const input = h('input', { type: 'checkbox', value: String(v), on: { change: () => setOpt(g.key, v, input.checked) } });
        pop.append(h('label.stg-opt', {}, input, h('span', { text: label })));
      }
      pop.append(h('button.linklike.stg-pop-clear', { type: 'button', text: 'Effacer', on: { click: () => clearKey(g.key) } }));
      const d = h('details.stg-f', { data: { stgF: g.key } }, h('summary.stg-chip', {}, h('span.stg-chip-l', { text: g.label }), h('span.stg-chip-n', { data: { n: '' } }), icon('chevDown', 'ic ic--xs')), pop);
      d.addEventListener('toggle', () => d.open && $$('details.stg-f[open]', els.filters).forEach((x) => x !== d && (x.open = false)));
      row.push(d);
    }
    const sw = (key, label, iconName) =>
      h('button.stg-chip', { type: 'button', attrs: { 'aria-pressed': 'false' }, data: { stgSw: key }, on: { click: () => ((st.f[key] = !st.f[key]), (st.page = 0), render()) } }, sic(iconName), label);
    row.push(sw('paid', 'Gratifiés', 'coin'), sw('contact', 'Avec contact', 'mail'));
    row.push(h('button.linklike.stg-reset', { type: 'button', text: 'Tout effacer', data: { stgReset: '' }, hidden: true, on: { click: resetAll } }));
    els.filters.replaceChildren(...row);
    if (filtersWired) return;
    filtersWired = true;
    document.addEventListener('click', (e) => e.target.closest?.('details.stg-f') || $$('details.stg-f[open]', els.filters).forEach((x) => (x.open = false)));
    els.filters.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      const d = e.target.closest('details.stg-f');
      if (d?.open) {
        e.stopPropagation();
        d.open = false;
        $('summary', d).focus();
      }
    });
  }
  function toggleMe(level) {
    const on = !(st.f.level.size === 1 && st.f.level.has(level));
    st.f.level = new Set(on ? [level] : []);
    st.page = 0;
    render();
  }
  function setOpt(key, v, on) {
    st.f[key][on ? 'add' : 'delete'](v);
    st.page = 0;
    render();
  }
  function clearKey(key) {
    st.f[key].clear();
    st.page = 0;
    render();
  }
  function resetAll() {
    const q = st.f.q;
    st.f = blank();
    st.f.q = q;
    st.page = 0;
    render();
  }
  function syncFilters() {
    let n = 0;
    for (const g of GROUPS()) {
      const d = $(`[data-stg-f="${g.key}"]`, els.filters);
      const set = st.f[g.key];
      n += set.size ? 1 : 0;
      d.classList.toggle('is-on', set.size > 0);
      $$('input', d).forEach((i) => (i.checked = set.has(g.key === 'sector' || g.key === 'statut' || g.key === 'dur' ? i.value : Number(i.value))));
      const first = g.opts.find(([v]) => set.has(v));
      $('[data-n]', d).textContent = set.size === 0 ? '' : set.size === 1 ? `: ${first?.[1] ?? ''}` : ` · ${set.size}`;
    }
    for (const b of $$('[data-stg-sw]', els.filters)) {
      const on = st.f[b.dataset.stgSw];
      b.setAttribute('aria-pressed', String(on));
      n += on ? 1 : 0;
    }
    const me = $('[data-stg-me]', els.filters);
    me?.setAttribute('aria-pressed', String(st.f.level.size === 1 && st.f.level.has(Number(me.dataset.stgMe))));
    $('[data-stg-reset]', els.filters).hidden = n === 0;
    els.fcount.hidden = n === 0;
    els.fcount.textContent = String(n);
  }

  const DEP = () => new Map(geo.DEPTS.map((d) => [d.c, d]));
  const REG = () => new Map(geo.REGIONS.map((r) => [r.c, r]));
  function pick(sel) {
    if (sel.kind === 'place') {
      const p = model.place(sel.id);
      st.zone = { kind: 'place', id: p.id, dep: p.dep, reg: p.reg };
    } else st.zone = sel;
    st.page = 0;
    render();
    if (matchMedia('(max-width: 899.98px)').matches && sel.kind === 'place') els.title.scrollIntoView({ behavior: motionOK() ? 'smooth' : 'auto', block: 'start' });
  }
  const mapLevel = (z) => (z.kind === 'place' ? { kind: 'dep', code: z.dep } : z.kind === 'away' ? { kind: 'fr' } : z);
  function zoneName(z) {
    if (z.kind === 'reg') return REG().get(z.code).n;
    if (z.kind === 'dep') return `${DEP().get(z.code).n} (${z.code})`;
    if (z.kind === 'place') return model.place(z.id).n;
    if (z.kind === 'away') return AWAY[z.code].label;
    return 'Toute la France';
  }
  const placeLine = (p) =>
    !p ? '' : p.zone === 'monde' || p.zone === 'om' ? `${p.n} · ${p.pays}` : p.zone === 'inconnu' ? 'Lieu non renseigné' : `${p.n} · ${DEP().get(p.dep)?.n ?? ''} (${p.dep})`;

  /** Remonter d'un niveau (ville → département → région → France). */
  function up() {
    const z = st.zone;
    if (z.kind === 'place') st.zone = { kind: 'dep', code: z.dep };
    else if (z.kind === 'dep') st.zone = { kind: 'reg', code: DEP().get(z.code).r };
    else if (z.kind === 'reg' || z.kind === 'away') st.zone = { kind: 'fr' };
    else return false;
    st.page = 0;
    render();
    return true;
  }

  function renderCrumbs() {
    const z = st.zone;
    const trail = [{ label: 'France', zone: { kind: 'fr' } }];
    if (z.kind === 'away') trail.push({ label: AWAY[z.code].label, zone: z });
    const reg = z.kind === 'reg' ? z.code : z.kind === 'dep' ? DEP().get(z.code).r : z.kind === 'place' ? z.reg : null;
    const dep = z.kind === 'dep' ? z.code : z.kind === 'place' ? z.dep : null;
    if (reg) trail.push({ label: REG().get(reg).n, zone: { kind: 'reg', code: reg } });
    if (dep) trail.push({ label: DEP().get(dep).n, zone: { kind: 'dep', code: dep } });
    if (z.kind === 'place') trail.push({ label: model.place(z.id).n, zone: z });
    const list = h('ol.stg-crumbs-l');
    trail.forEach((t, i) => {
      const here = i === trail.length - 1;
      list.append(
        h(
          'li',
          {},
          here
            ? h('span.stg-crumb.is-here', { text: t.label, attrs: { 'aria-current': 'location' } })
            : h('button.stg-crumb', { type: 'button', text: t.label, on: { click: () => ((st.zone = t.zone), (st.page = 0), render()) } }),
        ),
      );
    });
    els.crumbs.replaceChildren(trail.length > 1 ? h('button.icon-btn.stg-crumbs-back', { type: 'button', attrs: { 'aria-label': 'Remonter d’un niveau' }, on: { click: up } }, icon('back', 'ic ic--sm')) : sic('map'), list);
  }

  function renderAway(counts) {
    els.away.replaceChildren(
      ...['om', 'monde', 'inconnu']
        .filter((k) => counts.away[k] > 0)
        .map((k) =>
          h(
            'button.stg-away-b',
            { type: 'button', attrs: { 'aria-pressed': String(st.zone.kind === 'away' && st.zone.code === k), 'aria-label': `${AWAY[k].label} : ${plural(counts.away[k], 'stage')}` }, on: { click: () => pick({ kind: 'away', code: k }) } },
            sic(AWAY[k].icon),
            h('span', { text: AWAY[k].label }),
            h('b', { text: String(counts.away[k]) }),
          ),
        ),
    );
  }

  function renderLegend(counts) {
    const lv = mapLevel(st.zone);
    const dep = DEP();
    const vals =
      lv.kind === 'fr'
        ? Object.values(counts.reg)
        : Object.entries(counts.dep)
            .filter(([d]) => (lv.kind === 'reg' ? dep.get(d)?.r === lv.code : dep.get(d)?.r === dep.get(lv.code).r))
            .map(([, n]) => n);
    const max = Math.max(0, ...vals);
    if (!max) return els.legend.replaceChildren();
    els.legend.replaceChildren(
      h('span.stg-legend-l', { text: lv.kind === 'fr' ? 'Stages par région' : 'Stages par département' }),
      h('span.stg-legend-bar', {}, ...[1, 2, 3, 4, 5].map((q) => h(`i.q${q}`))),
      h('span.stg-legend-n', { text: '1' }),
      h('span.stg-legend-n', { text: String(max) }),
      h('span.stg-legend-dot', {}, h('i'), 'une ville'),
    );
  }

  function cardEl(it) {
    const chips = [
      h('span.stg-c-n', { text: it.n === it.total ? plural(it.n, 'stage') : `${it.n} sur ${plural(it.total, 'stage')}` }),
      it.levels.length ? h('span.stg-c-chip', { text: levelsLabel(it.levels) }) : null,
      it.from ? h('span.stg-c-chip', { text: span(it.from, it.to) }) : null,
    ];
    return h(
      'li.stg-card-li',
      {},
      h(
        'button.stg-card',
        { type: 'button', on: { click: () => openSheet(it.id, it.stageIds) }, attrs: { 'aria-label': `${it.name}, ${placeLine(it.place)}, ${plural(it.n, 'stage')}` } },
        logo(it),
        h(
          'span.stg-c-main',
          {},
          h('span.stg-c-name', { text: it.name }),
          h('span.stg-c-place', {}, icon('pin', 'ic ic--xs'), placeLine(it.place)),
          h('span.stg-c-chips', {}, ...chips),
          it.mission ? h('span.stg-c-mission', { text: it.mission }) : h('span.stg-c-mission.is-empty', { text: 'Mission non décrite dans la fiche' }),
        ),
        h('span.stg-c-side', {}, h('span.stg-c-sector', { text: it.sector }), it.paid ? h('span.stg-c-paid', { attrs: { title: 'Au moins un stage gratifié' } }, sic('coin', 'ic ic--xs'), 'Gratifié') : null),
      ),
    );
  }

  function renderPager(res) {
    if (res.pages <= 1) return els.pager.replaceChildren();
    const go = (p) => {
      st.page = p;
      render();
      els.title.scrollIntoView({ behavior: motionOK() ? 'smooth' : 'auto', block: 'start' });
    };
    els.pager.replaceChildren(
      h('button.btn.btn--ghost.btn--sm', { type: 'button', disabled: res.page === 0, on: { click: () => go(res.page - 1) } }, icon('back', 'ic ic--sm'), 'Précédent'),
      h('span.stg-pager-l', { text: `Page ${res.page + 1} sur ${res.pages}`, attrs: { 'aria-live': 'polite' } }),
      h('button.btn.btn--ghost.btn--sm', { type: 'button', disabled: res.page >= res.pages - 1, on: { click: () => go(res.page + 1) } }, 'Suivant', icon('arrRight', 'ic ic--sm')),
    );
  }

  function render({ instant = false } = {}) {
    if (!built || !model) return;
    const res = model.search(st.f, st.zone, { page: st.page, sort: st.sort });
    st.page = res.page;
    syncFilters();
    page.dataset.view = st.view;
    els.view.dataset.active = st.view;
    $$('[data-stg-view-btn]', els.view).forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.stgViewBtn === st.view)));
    map?.update(res.counts, mapLevel(st.zone), { place: st.zone.kind === 'place' ? st.zone.id : null, instant });
    renderCrumbs();
    renderAway(res.counts);
    renderLegend(res.counts);
    els.title.textContent = zoneName(st.zone);
    els.sub.textContent = res.zone.companies
      ? `${plural(res.zone.companies, 'structure')} · ${plural(res.zone.stages, 'stage')}${st.zone.kind === 'fr' && res.counts.total > res.zone.stages ? ` (et ${res.counts.total - res.zone.stages} hors métropole)` : ''}`
      : 'Aucun stage avec ces critères.';
    els.cards.replaceChildren(...res.items.map(cardEl));
    if (!res.items.length) {
      els.cards.append(
        h(
          'li.stg-empty',
          {},
          h('p', { text: 'Rien ici avec ces filtres.' }),
          h('button.btn.btn--sm', { type: 'button', text: st.zone.kind !== 'fr' ? 'Chercher dans toute la France' : 'Effacer les filtres', on: { click: () => (st.zone.kind !== 'fr' ? ((st.zone = { kind: 'fr' }), (st.page = 0), render()) : resetAll()) } }),
        ),
      );
    }
    renderPager(res);
    renderTile();
  }

  // ---------------------------------------------------------------- fiche d'une structure
  const dlg = $('[data-stg-sheet]');
  const sheet = modal(dlg);
  const fBody = $('[data-stg-f-body]', dlg);
  let current = null; // { id, matchIds }

  /** Une personne (maître de stage, RH), avec son adresse, de quoi la copier et lui écrire. */
  function personEl(p, metaText, pending) {
    let mailRow;
    if (pending && p.hasMail) mailRow = h('p.stg-p-mail.is-none', {}, h('span.spinner'), 'Adresse en cours de lecture…');
    else if (!p.mail) mailRow = h('p.stg-p-mail.is-none', { text: p.hasMail ? 'Adresse indisponible pour l’instant' : 'Pas d’e-mail dans la fiche' });
    else {
      const copy = h('button.icon-btn.icon-btn--sm', { type: 'button', attrs: { 'aria-label': `Copier l’e-mail de ${p.name}` } }, icon('link', 'ic ic--sm'));
      copy.addEventListener('click', () => copyButton(copy, p.mail));
      mailRow = h(
        'p.stg-p-mail',
        {},
        sic('mail', 'ic ic--xs'),
        h('span.stg-p-addr', { text: p.mail }),
        copy,
        h('a.icon-btn.icon-btn--sm', { href: `mailto:${p.mail}`, attrs: { 'aria-label': `Écrire à ${p.name}` } }, icon('send', 'ic ic--sm')),
      );
    }
    const flags = [];
    if (p.mail && p.generic) flags.push(h('span.stg-flag', { text: 'Boîte de service' }));
    if (p.mail && p.chk) flags.push(h('span.stg-flag.stg-flag--warn', { text: 'Adresse qui ne porte pas son nom' }));
    if (p.old?.length) flags.push(h('span.stg-flag', { text: `Ancienne adresse : ${p.old.join(', ')}` }));
    if (p.last && p.last < '2025-01') flags.push(h('span.stg-flag', { text: `Dernier stage en ${monthLabel(p.last)} : a pu changer de poste` }));
    return h(
      'li.stg-person',
      {},
      h('span.avatar.stg-p-av', { text: initials(p.name), attrs: { 'aria-hidden': 'true' } }),
      h(
        'div.stg-p-main',
        {},
        h('p.stg-p-name', {}, h('b', { text: [p.civ, p.name].filter(Boolean).join(' ') || 'Nom non renseigné' })),
        p.role ? h('p.stg-p-role', { text: p.role }) : null,
        metaText ? h('p.stg-p-meta', { text: metaText }) : null,
        mailRow,
        flags.length ? h('p.stg-p-flags', {}, ...flags) : null,
      ),
    );
  }

  function contactsSection(d, full) {
    const people = d.people.map((p) => {
      const role = [...p.kinds].map((k) => (k === 'maitre' ? 'Maître de stage' : 'Responsable / RH')).join(' et ');
      const years = [...p.years].sort();
      const meta = [role, p.n > 1 ? `${p.n} stagiaires encadrés` : null, years.length ? (years.length > 1 ? `${yearLabel(years[0])} → ${yearLabel(years.at(-1))}` : yearLabel(years[0])) : null].filter(Boolean).join(' · ');
      return personEl(model.contact(p.id, full), meta, !full);
    });
    return h(
      'section.sheet-section.stg-s-contacts',
      { data: { stgContacts: '' } },
      h('div.sheet-section-head', {}, h('h3', { text: `Contacts (${people.length})` })),
      people.length ? h('ul.stg-people', {}, ...people) : h('p.hint', { text: 'Aucun contact dans les fiches de cette structure.' }),
      people.length ? h('p.hint.stg-contact-note', {}, sic('shield', 'ic ic--xs'), 'Écris au nom d’ISIS avec ta boîte de l’université, en citant l’étudiant qui t’a précédé.') : null,
    );
  }

  function stageEl(s, d) {
    const head = [s.au ? yearLabel(s.au) : null, s.f ? `FIE ${s.f}` : null, s.wk ? `${s.wk} sem.` : null, s.d ? `dès ${monthLabel(s.d)}` : null].filter(Boolean).join(' · ');
    const sub = subject(s.mi);
    return h(
      'li',
      { class: s.match ? '' : 'is-dim' },
      h(
        'button.stg-stage',
        { type: 'button', data: { stgStage: s.id }, on: { click: () => openStage(s.id, d) } },
        h('span.avatar.stg-st-av', { text: initials(s.et), attrs: { 'aria-hidden': 'true' } }),
        h(
          'span.stg-st-main',
          {},
          h('span.stg-st-who', {}, h('b', { text: s.et || 'Étudiant non renseigné' }), h('span.stg-st-head', { text: head })),
          sub ? h('span.stg-st-mi', { text: sub }) : h('span.stg-st-mi.is-empty', { text: 'Sujet non décrit' }),
          s.tutor ? h('span.stg-st-tut', {}, icon('user', 'ic ic--xs'), `Maître de stage : ${s.tutor}`) : null,
        ),
        icon('chevRight', 'ic ic--sm stg-st-go'),
      ),
    );
  }

  function setHead(d) {
    const lg = logo(d, 'lg');
    lg.setAttribute('data-stg-f-logo', '');
    $('[data-stg-f-logo]', dlg).replaceWith(lg);
    $('[data-stg-f-title]', dlg).textContent = d.n;
    $('[data-stg-f-sub]', dlg).textContent = [placeLine(d.place), d.s, d.st].filter(Boolean).join(' · ');
  }

  async function openSheet(id, matchIds) {
    const d = model?.detail(id, matchIds);
    if (!d) return;
    current = { id, matchIds };
    setHead(d);
    const matched = d.stages.filter((s) => s.match);
    const others = d.stages.filter((s) => !s.match);
    const info = [];
    const addr = [d.a, [d.cp, d.place?.n].filter(Boolean).join(' ')].filter(Boolean).join(', ');
    if (addr) info.push(h('li', {}, icon('pin', 'ic ic--sm'), h('span', { text: addr })));
    if (d.w) info.push(h('li', {}, sic('web'), h('a', { href: webHref(d.w), target: '_blank', rel: 'noopener noreferrer', text: d.w })));
    if (d.t) info.push(h('li', {}, sic('phone'), h('a', { href: `tel:${d.t.replace(/[^\d+]/g, '')}`, text: `${d.t} (standard)` })));
    if (d.naf) info.push(h('li', {}, sic('layers'), h('span', { text: `Activité : ${d.naf}` })));
    info.push(h('li', {}, sic('coin'), h('span', { text: d.paid ? `${d.paid} stage${d.paid > 1 ? 's' : ''} gratifié${d.paid > 1 ? 's' : ''} sur ${d.k.length}` : `Aucun des ${plural(d.k.length, 'stage')} n’indique de gratification` })));
    const full = contacts.get(id) ?? null;
    const body = [
      h(
        'section.sheet-section',
        {},
        h('div.sheet-section-head', {}, h('h3', { text: `Étudiants passés ici (${d.k.length})` })),
        h('p.hint', { text: matched.length < d.stages.length ? `${plural(matched.length, 'stage correspond', 'stages correspondent')} à ta recherche, les autres sont plus bas. Clique sur un sujet pour la fiche complète.` : 'Clique sur un sujet pour la fiche complète : maître de stage, dates, missions.' }),
        h('ol.stg-stages', {}, ...matched.map((s) => stageEl(s, d))),
        others.length ? h('details.stg-more', {}, h('summary', { text: `Les ${plural(others.length, 'autre stage', 'autres stages')} de cette structure` }), h('ol.stg-stages', {}, ...others.map((s) => stageEl(s, d)))) : null,
      ),
      contactsSection(d, full),
      h('section.sheet-section', {}, h('div.sheet-section-head', {}, h('h3', { text: 'La structure' })), h('ul.stg-info', {}, ...info)),
    ];
    if (d.variants?.length > 1) body.push(h('section.sheet-section.stg-s-variants', {}, h('h3', { text: 'Fiches réunies ici' }), h('p.hint', { text: `Saisie sous ${d.variants.length} noms dans le logiciel de stages : ${d.variants.join(' · ')}.` })));
    if (d.also.length) body.push(h('section.sheet-section', {}, h('h3', { text: 'Aussi ailleurs' }), h('div.stg-also', {}, ...d.also.map((a) => h('button.stg-chip', { type: 'button', on: { click: () => openSheet(a.id) } }, icon('pin', 'ic ic--xs'), `${a.place} · ${plural(a.n, 'stage')}`)))));
    fBody.replaceChildren(...body);
    fBody.scrollTop = 0;
    if (!dlg.open) sheet.open();
    if (full) return;
    // Contacts de la structure : un appel par fiche ouverte (adresses comprises).
    try {
      const got = await structureContacts(id);
      if (current?.id !== id || !dlg.open) return;
      $('[data-stg-contacts]', fBody)?.replaceWith(contactsSection(d, got));
    } catch (err) {
      if (current?.id !== id) return;
      $('[data-stg-contacts]', fBody)?.replaceWith(contactsSection(d, new Map()));
      toast(err.message || 'Contacts indisponibles pour l’instant.', 'alert');
    }
  }

  function openStage(sid, d) {
    const full = contacts.get(d.id) ?? new Map();
    const s = model.stage(sid, full);
    if (!s) return;
    const back = h('button.btn.btn--ghost.btn--sm.stg-back', { type: 'button' }, icon('back', 'ic ic--sm'), `Retour aux ${plural(d.k.length, 'stage')} de la structure`);
    back.addEventListener('click', () => {
      openSheet(current.id, current.matchIds);
      requestAnimationFrame(() => fBody.querySelector(`[data-stg-stage="${sid}"]`)?.focus());
    });
    const facts = [];
    const fact = (label, value, iconName, wide) => value && facts.push(h(`div.stg-fact${wide ? '.stg-fact--wide' : ''}`, {}, h('dt', {}, sic(iconName, 'ic ic--xs'), label), h('dd', { text: value })));
    fact('Dates', s.db && s.df ? `Du ${dayLabel(s.db)} au ${dayLabel(s.df)}` : s.db ? `À partir du ${dayLabel(s.db)}` : s.d ? `À partir de ${monthLabel(s.d)}` : '', 'cal', true);
    fact('Durée', s.wk ? plural(s.wk, 'semaine') : '', 'clock');
    fact('Année', [s.au ? yearLabel(s.au) : null, s.f ? `FIE ${s.f}` : null, s.pr ? `promo ${s.pr}` : null].filter(Boolean).join(' · '), 'people');
    fact('Gratification', s.g ? 'Oui' : 'Non indiquée', 'coin');
    if (s.ob === false) fact('Type', 'Stage facultatif', 'layers');
    const addr = [s.company.a, [s.company.cp, s.place?.n].filter(Boolean).join(' ')].filter(Boolean).join(', ');
    fact('Lieu', addr, 'map', true);
    const team = [];
    if (s.tutor) team.push(personEl(s.tutor, 'Maître de stage'));
    if (s.hr) team.push(personEl(s.hr, 'Responsable / RH'));
    const body = [
      back,
      h(
        'section.sheet-section.stg-s-stage',
        {},
        h('div.stg-stage-who', {}, h('span.avatar', { text: initials(s.et), attrs: { 'aria-hidden': 'true' } }), h('div', {}, h('h3', { text: s.et || 'Étudiant non renseigné', attrs: { tabindex: '-1' } }), h('p.hint', { text: `Stagiaire chez ${d.n}` }))),
        h('dl.stg-facts', {}, ...facts),
      ),
      h(
        'section.sheet-section',
        {},
        h('div.sheet-section-head', {}, h('h3', { text: 'Missions' })),
        s.mi ? h('p.stg-st-full', { text: s.mi }) : h('p.hint', { text: 'Mission non décrite dans la fiche.' }),
        s.th ? h('p.stg-st-th', {}, h('b', { text: 'Thèmes : ' }), s.th) : null,
      ),
      h('section.sheet-section.stg-s-contacts', {}, h('div.sheet-section-head', {}, h('h3', { text: 'Encadrement' })), team.length ? h('ul.stg-people', {}, ...team) : h('p.hint', { text: 'Ni maître de stage ni responsable dans la fiche.' })),
    ];
    fBody.replaceChildren(...body);
    fBody.scrollTop = 0;
    fBody.querySelector('h3[tabindex]')?.focus({ preventScroll: true });
  }

  // ---------------------------------------------------------------- tuile du tableau de bord
  function renderTile() {
    const body = $('[data-stgt-body]');
    const count = $('[data-stgt-count]');
    if (!body || !available) return;
    if (!o.isSignedIn()) {
      count.textContent = '';
      body.replaceChildren(h('p.stgt-sub.stgt-out', { text: 'Les stages des étudiants d’ISIS, sur une carte, avec les missions et les contacts. Connecte-toi pour les voir.' }));
      return;
    }
    if (!model) {
      count.textContent = '';
      body.replaceChildren(
        failed
          ? h('p.stgt-sub.stgt-out', {}, failed instanceof StagesError && failed.status === 404 ? 'La rubrique Stages n’est pas ouverte pour l’instant.' : 'Stages indisponibles pour l’instant. ', failed?.status === 404 ? null : h('button.linklike', { type: 'button', text: 'Réessayer', on: { click: () => loadTile(true) } }))
          : h('span.skel.skel--line.w-40'),
      );
      return;
    }
    const ml = myLevel();
    const r = model.forLevel(ml);
    count.textContent = plural(model.count, 'stage');
    const track = h(
      'ul.stgt-track',
      { attrs: { 'aria-label': ml ? `Où sont allés les FIE ${ml}` : 'Structures qui accueillent le plus' } },
      ...r.top.map((it) => h('li', {}, h('button.stgt-co', { type: 'button', on: { click: () => (enter(), setTimeout(() => openSheet(it.id, it.stageIds), 60)) } }, logo(it, 'sm'), h('span.stgt-co-n', { text: it.name }), h('span.stgt-co-p', { text: `${it.place?.n ?? ''} · ${plural(it.n, 'stage')}` })))),
    );
    body.replaceChildren(
      h(
        'div.stgt-sum',
        {},
        h('p.stgt-big', {}, h('b', { text: String(r.stages) }), ml ? ` stages de FIE ${ml} avant toi` : ' stages'),
        h('p.stgt-sub', { text: `dans ${plural(r.companies, 'structure')} et ${plural(r.cities, 'ville')}. Missions, maîtres de stage et contacts RH, par région, département et ville.` }),
        h(
          'button.btn.btn--primary.btn--sm.stgt-cta',
          {
            type: 'button',
            on: {
              click: () => {
                if (ml) st.f.level = new Set([ml]);
                st.page = 0;
                enter();
                render();
              },
            },
          },
          sic('map'),
          ml ? `Voir les stages de FIE ${ml}` : 'Voir la carte',
        ),
      ),
      track,
    );
  }

  /** La tuile charge les données quand elle devient visible (une fois). */
  let tileWatch = null;
  function loadTile(force = false) {
    if (!available || !o.isSignedIn() || (model && !force)) return renderTile();
    if (force) failed = null;
    renderTile();
    ensureData().then(renderTile, () => renderTile());
  }
  function watchTile() {
    if (tileWatch || !tile || !('IntersectionObserver' in window)) return loadTile();
    tileWatch = new IntersectionObserver((entries) => {
      if (!entries.some((e) => e.isIntersecting)) return;
      tileWatch.disconnect();
      tileWatch = null;
      loadTile();
    });
    tileWatch.observe(tile);
  }

  // ---------------------------------------------------------------- ouverture par l'administration
  function setAvailable(on) {
    available = on;
    o.modes.setTab('stages', on);
    if (tile) tile.toggleAttribute('data-off', !on);
    $$('[data-stg-only]').forEach((el) => (el.hidden = !on));
    o.onAvailable?.(on);
    if (on) {
      renderTile();
      if (o.isSignedIn()) watchTile();
    }
  }

  let statusReady = null;
  function checkStatus() {
    statusReady = (async () => {
      // Aperçu (appareil de l'administrateur, choisi depuis l'administration) : la rubrique se montre
      // ici avant d'être ouverte à tous ; le serveur ne la sert qu'aux identifiants de l'administration.
      const preview = prefs.get('stages-apercu') === true;
      let enabled = false;
      try {
        enabled = Boolean((await api.status()).enabled);
      } catch {
        enabled = false;
      }
      setAvailable(enabled || preview);
      if (location.hash === '#stages' && available && o.isSignedIn()) setTimeout(enter, 50);
    })();
    return statusReady;
  }

  return {
    checkStatus,
    /** État de la rubrique connu (ouverte ou non), 3 s au plus. */
    whenReady: () => Promise.race([statusReady ?? Promise.resolve(), new Promise((r) => setTimeout(r, 3000))]),
    enter,
    isOpen: () => open,
    available: () => available,
    /** Échap : remonter d'un niveau sur la carte, puis revenir au Hub. */
    escape() {
      if (!up()) o.modes.set('hub');
    },
    /** Connexion au Hub : la tuile se remplit. */
    signedIn() {
      if (available) watchTile();
      renderTile();
    },
    /** Déconnexion : session et données oubliées, retour au Hub. */
    async signedOut() {
      if (open) o.modes.set('hub');
      if (ix || model) await api.leave().catch(() => {});
      model = ix = null;
      contacts.clear();
      failed = null;
      built = false;
      map = null;
      els.map.replaceChildren();
      st.f = blank();
      st.zone = { kind: 'fr' };
      renderTile();
    },
    /** Classe changée : « Comme moi » et la tuile suivent. */
    refresh() {
      if (built) {
        buildFilters();
        render();
      } else renderTile();
    },
  };
}
