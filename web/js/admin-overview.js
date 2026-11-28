// Administration · Vue d'ensemble : la fréquentation de tout le Hub, rubrique par rubrique, les
// parcours du jour (Hub → Stages → simulateur, Hub → TCG…) et ce qui attend une action.
//
// Tout vient des compteurs anonymes par jour (internal/feedback/stats.go) : comptes distincts par
// rubrique, et nombre de comptes par combinaison de rubriques ouvertes le même jour, grâce au jeton
// du jour (oublié le lendemain). Rien ne relie ces chiffres à une personne.
//
// Design : maquette « Admin ISIS Hub · maquette » (Vue d'ensemble). Graphiques en SVG construit ici,
// largeurs par propriété personnalisée (--w) posée au CSSOM, jamais d'attribut style.

import { $$, h, icon } from './core/dom.js';

const NS = 'http://www.w3.org/2000/svg';
const nf = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 });
const fmt = (n) => nf.format(Math.round(n * 10) / 10);
const pct = (v) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(Math.round(v * 100))} %`;
const share = (a, b) => (b ? `${Math.round((a / b) * 100)} %` : '—');
const atNoon = (iso) => new Date(`${iso}T12:00:00Z`);
const dfmt = (iso, o = { day: 'numeric', month: 'short' }) => atNoon(iso).toLocaleDateString('fr-FR', { ...o, timeZone: 'UTC' });

function svg(name, attrs = {}, ...kids) {
  const e = document.createElementNS(NS, name);
  for (const [k, v] of Object.entries(attrs)) if (v != null && v !== false) e.setAttribute(k, v);
  for (const c of kids.flat()) if (c != null && c !== false) e.append(typeof c === 'string' ? document.createTextNode(c) : c);
  return e;
}

// Rubriques comptées. « all » : le tableau de bord (toute visite du Hub commence là).
export const MODULES = [
  { id: 'all', name: 'Tout le Hub', hint: 'Tableau de bord ouvert', icon: 'inbox', get: (d, m) => (m === 'accounts' ? (d.accounts ?? 0) : (d.visits ?? 0)) },
  { id: 'stages', name: 'Stages', hint: 'Carte et fiches des stages', icon: 'briefcase' },
  { id: 'salaires', name: 'Simulateur de salaire', hint: 'Depuis la barre des raccourcis', icon: 'chart' },
  { id: 'tcg', name: 'TCG', hint: 'Le jeu de cartes, lien de l’en-tête', icon: 'spark' },
  { id: 'notes', name: 'Notes', hint: 'Calcul des moyennes', icon: 'task' },
  { id: 'mails', name: 'Mails', hint: 'Lecture en grand', icon: 'send' },
];
const modValue = (mod, d, m) => (mod.get ? mod.get(d, m) : m === 'accounts' ? (d.mods?.[mod.id]?.a ?? 0) : (d.mods?.[mod.id]?.o ?? 0));
const DEVICES = { phone: 'Téléphone', tablet: 'Tablette', desktop: 'Ordinateur' };
const APP_MODES = { app: 'Application installée', browser: 'Navigateur' };
const WEEK = ['Lun.', 'Mar.', 'Mer.', 'Jeu.', 'Ven.', 'Sam.', 'Dim.'];

/** Comptes du jour qui ont ouvert toutes les rubriques de `need` (combinaisons du jour). */
function withAll(d, need) {
  let n = 0;
  for (const [k, c] of Object.entries(d.combos ?? {})) {
    const set = k.split('+');
    if (need.every((x) => set.includes(x))) n += c;
  }
  return n;
}

function seg(options, value, onChange, label) {
  const el = h('div.adm-seg', { role: 'group', attrs: { 'aria-label': label } });
  const paint = () => $$('button', el).forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.v === String(value))));
  for (const [v, lab] of options)
    el.append(
      h('button', {
        type: 'button',
        data: { v: String(v) },
        text: lab,
        on: {
          click: () => {
            value = v;
            paint();
            onChange(v);
          },
        },
      }),
    );
  paint();
  return el;
}

function spark(values) {
  const max = Math.max(...values, 1);
  const pts = values.map((v, i) => `${((i / Math.max(values.length - 1, 1)) * 120).toFixed(1)},${(30 - (v / max) * 28).toFixed(1)}`);
  return svg('svg', { class: 'adm-spark', viewBox: '0 0 120 32', preserveAspectRatio: 'none', 'aria-hidden': 'true' }, svg('polyline', { points: pts.join(' ') }));
}

function hbars(list, unit = '%') {
  const total = list.reduce((s, [, v]) => s + v, 0);
  if (!total) return h('p.adm-hint', { text: 'Pas encore de données sur la période.' });
  const max = Math.max(...list.map(([, v]) => v), 1e-9);
  return h(
    'ul.adm-hbars',
    {},
    list.map(([k, v]) =>
      h('li', {}, h('span.adm-hb-k', { text: k }), h('span.adm-hb-b', { attrs: { 'aria-hidden': 'true' } }, h('span', { style: { '--w': `${((v / max) * 100).toFixed(1)}%` } })), h('span.adm-hb-v', { text: unit === '%' ? share(v, total) : fmt(v) })),
    ),
  );
}

function kpi(label, value, sub, good) {
  return h('div.adm-kpi', {}, h('span', { text: label }), h('b', { text: value }), sub ? h(`small${good === true ? '.is-up' : good === false ? '.is-down' : ''}`, { text: sub }) : null);
}

export function setupOverview({ root, api, onError }) {
  const st = { days: 30, mod: 'all', metric: 'accounts', day: '' };
  let data = null;
  let todo = [];
  const kpis = h('div.adm-kpis');
  const table = h('ol.adm-mods');
  const chartT = h('h3.adm-h3');
  const chart = h('div.adm-chart');
  const dayBar = h('p.adm-day');
  const todoList = h('ul.adm-todo');
  const funnel = h('div.adm-funnel');
  const split = h('div.adm-split');
  const period = seg(
    [
      [7, '7 j'],
      [30, '30 j'],
      [90, '90 j'],
    ],
    st.days,
    (v) => ((st.days = v), (st.day = ''), render()),
    'Période',
  );
  const metric = seg(
    [
      ['accounts', 'Étudiants'],
      ['visits', 'Ouvertures'],
    ],
    st.metric,
    (v) => ((st.metric = v), render()),
    'Mesure',
  );
  const card = (title, ic, ...kids) => h('section.adm-card', {}, title ? h('h2.adm-h2', {}, ic ? icon(ic, 'ic ic--sm') : null, title) : null, ...kids);
  root.replaceChildren(
    h('div.adm-toolbar', {}, period, metric),
    kpis,
    h(
      'div.adm-ov',
      {},
      card('Par rubrique', 'chart', h('p.adm-hint', { text: 'Touche une ligne pour voir sa courbe. Un étudiant compte une fois par jour et par rubrique, sur tous ses appareils.' }), table),
      card('À traiter', 'flag', todoList),
    ),
    card(null, null, chartT, chart, dayBar),
    card(
      'Parcours',
      'arrRight',
      h('p.adm-hint', { text: 'Parmi les étudiants venus sur le Hub, combien ont ouvert chaque rubrique le même jour, et dans quel enchaînement. Un compte n’est qu’un jeton du jour : personne n’est suivi d’un jour à l’autre.' }),
      funnel,
    ),
    card('Qui vient', 'user', split),
    h('p.adm-foot', {}, icon('lock', 'ic ic--sm'), 'Compteurs anonymes, par jour : ni identifiant, ni adresse IP, ni navigateur précis. Classe, appareil et mode sont comptés à part, jamais croisés ; les parcours ne gardent que des totaux.'),
  );

  /** Jours de la période (offset : la période d'avant). */
  function slice(days, offset = 0) {
    const all = data?.days ?? [];
    return all.slice(Math.max(0, all.length - days - offset), all.length - offset);
  }

  function render() {
    if (!data) return;
    const m = st.metric;
    const cur = slice(st.days);
    const prev = slice(st.days, st.days);
    const since = data.accountsSince || '';
    const counted = (list) => (m === 'accounts' ? list.filter((d) => d.date >= since) : list);
    const all = MODULES[0];
    const sumOf = (list, mod) => list.reduce((s, d) => s + modValue(mod, d, m), 0);
    const cc = counted(cur);
    const pc = counted(prev);
    const avg = cc.length ? sumOf(cc, all) / cc.length : 0;
    const pavg = pc.length ? sumOf(pc, all) / pc.length : 0;
    const peak = cc.reduce((a, b) => (modValue(all, b, m) > modValue(all, a, m) ? b : a), cc[0] ?? cur[0]);
    const today = cur.at(-1);
    const guests = cur.reduce((s, d) => s + (d.guests ?? 0), 0);
    const accounts = cur.reduce((s, d) => s + (d.accounts ?? 0), 0);
    kpis.replaceChildren(
      kpi(m === 'accounts' ? 'Étudiants par jour' : 'Ouvertures par jour', fmt(avg), pavg ? `${pct(avg / pavg - 1)} vs les ${st.days} j d’avant` : `sur ${cc.length} j`, pavg ? avg >= pavg : undefined),
      kpi('Aujourd’hui', fmt(today ? modValue(all, today, m) : 0), today ? dfmt(today.date, { weekday: 'long', day: 'numeric', month: 'long' }) : ''),
      kpi('Pic', fmt(peak ? modValue(all, peak, m) : 0), peak ? dfmt(peak.date, { weekday: 'short', day: 'numeric', month: 'short' }) : ''),
      kpi('Sans connexion', share(guests, guests + accounts), 'des visiteurs distincts'),
    );

    table.replaceChildren(
      ...MODULES.map((mod) => {
        const first = data.days.findIndex((d) => (mod.id === 'all' ? d.visits > 0 : d.mods?.[mod.id]));
        const firstDate = first >= 0 ? data.days[first].date : null;
        const c = cur.filter((d) => firstDate && d.date >= firstDate);
        const p = prev.filter((d) => firstDate && d.date >= firstDate);
        const cs = counted(c);
        const ps = counted(p);
        const tot = sumOf(cs, mod);
        const ptot = sumOf(ps, mod);
        const val = m === 'accounts' ? (cs.length ? tot / cs.length : 0) : tot;
        const pval = m === 'accounts' ? (ps.length ? ptot / ps.length : 0) : ptot;
        const trend = ps.length && pval ? val / pval - 1 : null;
        const on = st.mod === mod.id;
        return h(
          'li',
          {},
          h(
            `button.adm-mod${on ? '.is-on' : ''}${mod.id === 'all' ? '.is-all' : ''}`,
            { type: 'button', attrs: { 'aria-pressed': String(on) }, on: { click: () => ((st.mod = mod.id), render()) } },
            h('span.adm-mod-ic', {}, icon(mod.icon, 'ic ic--sm')),
            h('span.adm-mod-t', {}, h('b', { text: mod.name }), h('span', { text: firstDate ? mod.hint : `${mod.hint} · pas encore compté` })),
            spark(cur.map((d) => modValue(mod, d, m))),
            h('span.adm-mod-v', {}, h('b', { text: fmt(val) }), h('span', { text: m === 'accounts' ? 'par jour' : 'sur la période' })),
            h(`span.adm-trend${trend == null ? '.is-new' : trend >= 0 ? '.is-up' : '.is-down'}`, { text: trend == null ? (firstDate ? 'Nouveau' : '—') : pct(trend) }),
          ),
        );
      }),
    );

    const mod = MODULES.find((x) => x.id === st.mod);
    chartT.textContent = `${mod.name} · ${m === 'accounts' ? 'étudiants' : 'ouvertures'} par jour`;
    drawChart(
      cur.map((d) => [d.date, m === 'accounts' && d.date < since ? null : modValue(mod, d, m)]),
      prev.map((d) => modValue(mod, d, m)),
    );
    if (st.day && !cur.some((d) => d.date === st.day)) st.day = '';
    dayBar.replaceChildren(
      st.day
        ? h('span', {}, 'Parcours et répartitions du ', h('b', { text: dfmt(st.day, { weekday: 'long', day: 'numeric', month: 'long' }) }), ' ')
        : h('span', { text: 'Parcours et répartitions sur toute la période. Touche un jour de la courbe pour voir le sien.' }),
      ...(st.day ? [h('button.btn.btn--sm.btn--ghost', { type: 'button', text: 'Toute la période', on: { click: () => ((st.day = ''), render()) } })] : []),
    );
    const scope = st.day ? cur.filter((d) => d.date === st.day) : cur;
    renderFunnel(scope);
    renderSplit(scope, cur);
    renderTodo();
  }

  function drawChart(points, prev) {
    const W = Math.max(300, chart.clientWidth || 700);
    const H = W < 500 ? 170 : 210;
    const L = 34;
    const R = 8;
    const T = 10;
    const B = 24;
    const vals = points.map((p) => p[1] ?? 0);
    const max = Math.max(...vals, ...prev, 1) * 1.08;
    const X = (i) => L + ((W - L - R) * i) / Math.max(points.length - 1, 1);
    const Y = (v) => T + (H - T - B) * (1 - v / max);
    const step = max > 400 ? 100 : max > 150 ? 50 : max > 40 ? 10 : max > 12 ? 5 : 2;
    const s = svg('svg', { class: 'adm-svg', viewBox: `0 0 ${W} ${H}`, width: W, height: H, role: 'img', 'aria-label': `Courbe sur ${points.length} jours, de ${fmt(Math.min(...vals))} à ${fmt(Math.max(...vals))} par jour.` });
    for (let v = 0; v <= max; v += step) s.append(svg('line', { class: 'adm-gl', x1: L, x2: W - R, y1: Y(v), y2: Y(v) }), svg('text', { class: 'adm-ax', x: L - 6, y: Y(v) + 4, 'text-anchor': 'end' }, fmt(v)));
    if (prev.length === points.length) s.append(svg('polyline', { class: 'adm-prev', points: prev.map((v, i) => `${X(i).toFixed(1)},${Y(v).toFixed(1)}`).join(' ') }));
    const shown = points.map((p, i) => [p, i]).filter(([p]) => p[1] != null);
    const pts = shown.map(([p, i]) => `${X(i).toFixed(1)},${Y(p[1]).toFixed(1)}`);
    if (shown.length) {
      s.append(
        svg('polygon', { class: 'adm-area', points: `${X(shown[0][1]).toFixed(1)},${Y(0)} ${pts.join(' ')} ${X(shown.at(-1)[1]).toFixed(1)},${Y(0)}` }),
        svg('polyline', { class: 'adm-line', points: pts.join(' ') }),
      );
    }
    const sel = points.findIndex((p) => p[0] === st.day);
    if (sel >= 0) s.append(svg('line', { class: 'adm-sel', x1: X(sel), x2: X(sel), y1: T, y2: H - B }));
    const every = Math.ceil(points.length / (W < 500 ? 4 : 7));
    points.forEach((p, i) => i % every === 0 && s.append(svg('text', { class: 'adm-ax', x: X(i), y: H - 6, 'text-anchor': 'middle' }, dfmt(p[0]))));
    // Un jour se touche : parcours et répartitions de ce jour-là.
    const slot = (W - L - R) / Math.max(points.length - 1, 1);
    points.forEach((p, i) => {
      const hit = svg(
        'rect',
        { class: `adm-hit${p[0] === st.day ? ' is-sel' : ''}`, x: X(i) - slot / 2, y: T, width: Math.max(2, slot), height: H - T - B, tabindex: 0, role: 'button', 'aria-label': `${dfmt(p[0], { weekday: 'long', day: 'numeric', month: 'long' })} : ${p[1] == null ? 'pas encore compté' : fmt(p[1])}` },
        svg('title', {}, `${dfmt(p[0], { weekday: 'short', day: 'numeric', month: 'short' })} : ${p[1] == null ? 'pas encore compté' : fmt(p[1])}`),
      );
      const pick = () => {
        st.day = st.day === p[0] ? '' : p[0];
        render();
      };
      hit.addEventListener('click', pick);
      hit.addEventListener('keydown', (e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), pick()));
      s.append(hit);
    });
    chart.replaceChildren(s, h('p.adm-chart-k', { attrs: { 'aria-hidden': 'true' } }, h('span', {}, h('i.adm-key'), 'Cette période'), h('span', {}, h('i.adm-key.adm-key--prev'), 'Période d’avant')));
  }

  function renderFunnel(scope) {
    const days = scope.filter((d) => d.combos && Object.keys(d.combos).length);
    if (!days.length) {
      funnel.replaceChildren(h('p.adm-hint', { text: 'Les parcours sont comptés depuis la version 3.1.0 : pas encore de données sur cette période.' }));
      return;
    }
    const sum = (need) => days.reduce((s, d) => s + withAll(d, need), 0);
    const per = (n) => (days.length > 1 ? `${fmt(n / days.length)} par jour` : `${fmt(n)} ${n > 1 ? 'étudiants' : 'étudiant'}`);
    const hub = sum(['hub']);
    const step = (name, n, of, ofName, depth = 1) =>
      h(
        `li.adm-fn${depth > 1 ? '.is-sub' : ''}`,
        {},
        h('span.adm-fn-k', {}, h('b', { text: name }), h('span', { text: of != null ? `${share(n, of)} ${ofName}` : 'point de départ' })),
        h('span.adm-fn-b', { attrs: { 'aria-hidden': 'true' } }, h('span', { style: { '--w': `${hub ? ((n / hub) * 100).toFixed(1) : 0}%` } })),
        h('span.adm-fn-v', { text: per(n) }),
      );
    const stg = sum(['hub', 'stages']);
    const chains = h(
      'ol.adm-fns',
      {},
      step('Tableau de bord', hub, null),
      step('puis Stages', stg, hub, 'du Hub'),
      step('puis le simulateur', sum(['hub', 'stages', 'salaires']), stg, 'de ceux de Stages', 2),
      step('le simulateur', sum(['hub', 'salaires']), hub, 'du Hub'),
      step('le TCG', sum(['hub', 'tcg']), hub, 'du Hub'),
      step('les notes', sum(['hub', 'notes']), hub, 'du Hub'),
      step('les mails en grand', sum(['hub', 'mails']), hub, 'du Hub'),
    );
    const NAMES = { hub: 'Hub', stages: 'Stages', salaires: 'Simulateur', tcg: 'TCG', notes: 'Notes', mails: 'Mails' };
    const combos = {};
    for (const d of days) for (const [k, c] of Object.entries(d.combos)) combos[k] = (combos[k] ?? 0) + c;
    const total = Object.values(combos).reduce((s, c) => s + c, 0);
    const top = Object.entries(combos)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6);
    funnel.replaceChildren(
      chains,
      h('h3.adm-h3', { text: 'Rubriques ouvertes ensemble, le même jour' }),
      h(
        'ul.adm-combos',
        {},
        top.map(([k, c]) => h('li', {}, h('span.adm-combo-k', {}, ...k.split('+').map((x) => h('span.chip', { text: NAMES[x] ?? x }))), h('span.adm-hb-v', { text: share(c, total) }))),
      ),
    );
  }

  function renderSplit(scope, cur) {
    const add = (key, labels = {}) => {
      const out = {};
      for (const d of scope) for (const [k, v] of Object.entries(d[key] ?? {})) out[labels[k] ?? k] = (out[labels[k] ?? k] ?? 0) + v;
      return Object.entries(out).sort((a, b) => b[1] - a[1]);
    };
    const acc = WEEK.map(() => [0, 0]);
    for (const d of cur) {
      const i = (atNoon(d.date).getUTCDay() + 6) % 7;
      acc[i][0] += modValue(MODULES[0], d, st.metric);
      acc[i][1]++;
    }
    split.replaceChildren(
      h('div', {}, h('h3.adm-h3', { text: 'Par classe' }), hbars(add('classes'))),
      h('div', {}, h('h3.adm-h3', { text: 'Appareil' }), hbars(add('devices', DEVICES))),
      h('div', {}, h('h3.adm-h3', { text: 'Application ou navigateur' }), hbars(add('modes', APP_MODES))),
      h('div', {}, h('h3.adm-h3', { text: 'Jour de la semaine' }), hbars(WEEK.map((n, i) => [n, acc[i][1] ? acc[i][0] / acc[i][1] : 0]), 'n')),
    );
  }

  function renderTodo() {
    const items = todo.filter((x) => x.n > 0);
    todoList.replaceChildren(
      ...(items.length
        ? items.map((x) => h('li', {}, h('a.adm-todo-a', { href: x.href }, h('span.adm-mod-ic', {}, icon(x.icon, 'ic ic--sm')), h('span.adm-mod-t', {}, h('b', { text: x.title }), h('span', { text: x.sub })), icon('chevRight', 'ic ic--sm'))))
        : [h('li.ed-empty', { text: 'Rien à traiter. 🎉' })]),
    );
  }

  let rt;
  new ResizeObserver(() => {
    clearTimeout(rt);
    rt = setTimeout(() => root.isConnected && data && render(), 150);
  }).observe(root);

  return {
    async load() {
      try {
        data = await api('stats');
      } catch (err) {
        return onError?.(err);
      }
      render();
    },
    /** Ce qui attend une action : [{ n, title, sub, href, icon }]. */
    setTodo(list) {
      todo = list;
      if (data) renderTodo();
    },
  };
}
