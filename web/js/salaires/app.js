// Simulateur de salaire, d'après le sondage des alumni d'ISIS : une page à part entière du Hub, à la
// place du tableau de bord (l'en-tête reste). Entrée : un bouton à gauche de la barre des
// raccourcis, et « #salaires » ; « Hub », l'onglet Hub ou Échap ramènent au tableau de bord.
//
// Les réponses ne viennent jamais sur l'appareil : la page envoie le profil coché et reçoit des
// groupes déjà calculés par le serveur (internal/salaires) — médiane à partir de 5 réponses,
// quartiles à partir de 10, cases qui ne se cochent que si elles gardent 5 réponses. Le profil
// n'est ni gardé ni noté. Rien n'est enregistré sur l'appareil non plus.
//
// Design : maquette « ISIS Hub · maquette Salaires ». Positions et tailles dynamiques par
// propriétés personnalisées posées au CSSOM (--a, --b, --w, --h), jamais d'attribut style.

import { $, $$, h, icon, toast, motionOK, EASE } from '../core/dom.js';
import { prefs } from '../core/store.js';
import { api, SalairesError } from './api.js';

const NS = 'http://www.w3.org/2000/svg';
const FACTORS = ['xp', 'poste', 'secteur', 'structure', 'region'];
const LABEL = { xp: 'Expérience', poste: 'Poste', secteur: 'Secteur', structure: 'Structure', region: 'Région', sexe: 'Sexe' };
const ANY = { xp: 'Toutes', poste: 'Tous les postes', secteur: 'Tous les secteurs', structure: 'Toutes les structures', region: 'Toutes les régions' };
const XP_SHORT = ['0–1 an', '2–3 ans', '4–5 ans', '6–9 ans', '10 ans et +'];
const BIN_LABEL = ['< 30', '30–35', '35–40', '40–45', '45–50', '50–60', '60–70', '70–80', '80–90', '90–100', '100 +'];
const SHORT = {
  'Product Owner / Product Manager': 'Product Owner / Manager',
  'Autres régions et outre-mer': 'Autres régions, outre-mer',
  'Freelance / Indépendant': 'Freelance',
  'Tech / Industrie / Autre': 'Tech, industrie, autres',
};
const NET = 0.75;
// Téléphone : chaque critère est une ligne repliable (le choix en cours dans la ligne).
const PHONE = matchMedia('(max-width: 760px)');
const GOOD = 10; // à partir de là, le profil exact est assez fourni pour s'y fier

const nf = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 });
const euro = (v) => `${nf.format(Math.round(v / 100) * 100)} €`;
const round500 = (v) => Math.round(v / 500) * 500;
const kE = (v) => `${new Intl.NumberFormat('fr-FR', { maximumFractionDigits: v < 1e5 ? 1 : 0 }).format(Math.round(v / 500) / 2)} k€`;
const pct = (v) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(Math.round(v * 100))} %`;
const plural = (n, w, ws = `${w}s`) => `${nf.format(n)} ${n > 1 ? ws : w}`;

function svg(name, attrs = {}, ...kids) {
  const e = document.createElementNS(NS, name);
  for (const [k, v] of Object.entries(attrs)) if (v != null && v !== false) e.setAttribute(k, v);
  for (const c of kids.flat()) if (c != null && c !== false) e.append(typeof c === 'string' ? document.createTextNode(c) : c);
  return e;
}

const ICONS = {
  coin: [['c', 12, 12, 8.5], ['p', 'M14.5 9.5c-.5-1-1.5-1.5-2.5-1.5-1.5 0-2.5.8-2.5 2s1 1.6 2.5 2 2.5.9 2.5 2-1 2-2.5 2c-1.1 0-2.1-.5-2.6-1.5M12 6.5V8M12 16v1.5']],
  map: [['p', 'M9 4.5l-5.5 2v13l5.5-2 6 2 5.5-2v-13l-5.5 2z'], ['p', 'M9 4.5v13M15 6.5v13']],
  trend: [['p', 'M3.5 17.5l6-6 4 4 7-7.5'], ['p', 'M15.5 8h5v5']],
  bars: [['p', 'M4 20V10M10 20V4M16 20v-7M22 20H2']],
  gift: [['p', 'M4 10.5h16V20H4z'], ['p', 'M3 7h18v3.5H3zM12 7v13M12 7c-1.5-3-5-3.5-5-1.2C7 7 9.5 7 12 7zM12 7c1.5-3 5-3.5 5-1.2C17 7 14.5 7 12 7z']],
  quote: [['p', 'M9.5 7.5H6a1.5 1.5 0 0 0-1.5 1.5v3A1.5 1.5 0 0 0 6 13.5h2.5V15a2.5 2.5 0 0 1-2.5 2.5M19.5 7.5H16a1.5 1.5 0 0 0-1.5 1.5v3a1.5 1.5 0 0 0 1.5 1.5h2.5V15a2.5 2.5 0 0 1-2.5 2.5']],
  info: [['c', 12, 12, 8.5], ['p', 'M12 11v5.5M12 8v.1']],
  shield: [['p', 'M12 3.5l7 2.5v5.5c0 4.5-3 8-7 9.5-4-1.5-7-5-7-9.5V6z'], ['p', 'M9 12l2 2 4-4']],
  people: [['c', 9, 8.5, 3], ['p', 'M3.5 19.5a5.5 5.5 0 0 1 11 0M15.5 5.8a3 3 0 0 1 0 5.4M17.5 14.5a5.5 5.5 0 0 1 3 5']],
  globe: [['c', 12, 12, 8.5], ['p', 'M3.5 12h17M12 3.5c2.4 2.5 3.6 5.3 3.6 8.5s-1.2 6-3.6 8.5c-2.4-2.5-3.6-5.3-3.6-8.5s1.2-6 3.6-8.5z']],
  home: [['p', 'M4 11l8-6.5 8 6.5M6 9.5V19.5h12V9.5']],
  dots: [['p', 'M6 12h.01M12 12h.01M18 12h.01']],
  close: [['p', 'M6.5 6.5l11 11M17.5 6.5l-11 11']],
};
function ic(name, cls = 'ic ic--sm') {
  const e = svg('svg', { class: cls, viewBox: '0 0 24 24', 'aria-hidden': 'true' });
  for (const [t, ...a] of ICONS[name]) e.append(t === 'c' ? svg('circle', { cx: a[0], cy: a[1], r: a[2] }) : svg('path', { d: a[0] }));
  return e;
}

const blank = () => ({ xp: [0], poste: [], secteur: [], structure: [], region: [] });

export function createSalaires(o) {
  const page = $('[data-sal-page]');
  const body = page;
  const goBtns = $$('[data-open-salaires]');

  let available = false;
  let info = null; // catégories, chiffres du sondage, conseils
  let est = null; // dernier calcul reçu
  let built = false;
  let loading = null;
  let failed = null;
  let geo = null;
  let lastFocus = null;
  let open = false;
  let reqId = 0;
  let ctl = null;
  let timer = 0;
  const cache = new Map(); // profil → calcul (cette ouverture de la page seulement)
  const st = { f: blank(), target: 'base', cmp: 'poste' };
  const els = {};

  const names = (k) => (k === 'xp' ? XP_SHORT : info.dims[k]);
  const nameOf = (k, v) => names(k)[v];
  const short = (n) => SHORT[n] || n;
  const has = (k, v) => (st.f[k] || []).includes(v);
  const what = () => (st.target === 'base' ? 'fixe' : 'avec primes');
  const MIN = () => info?.min ?? 5;

  // ---------------------------------------------------------------- données
  /** Session (ticket CAS si besoin), puis catégories et géométrie de la carte. */
  function ensureInfo() {
    if (info) return Promise.resolve(info);
    loading ??= (async () => {
      try {
        try {
          info = await api.info();
        } catch (err) {
          if (!(err instanceof SalairesError) || err.status !== 401) throw err;
          await api.join(await o.getTicket());
          info = await api.info();
        }
        geo ??= await import('../stages/geo.js');
        failed = null;
        return info;
      } catch (err) {
        failed = err;
        throw err;
      } finally {
        loading = null;
      }
    })();
    return loading;
  }

  /** Calcul pour le profil courant (léger délai : plusieurs cases cochées d'affilée = un appel). */
  function request(delay = 90) {
    clearTimeout(timer);
    const key = JSON.stringify([st.f, st.target]);
    const want = structuredClone(st.f);
    if (cache.has(key)) return apply(cache.get(key), want);
    els.result?.setAttribute('aria-busy', 'true');
    timer = setTimeout(async () => {
      const id = ++reqId;
      ctl?.abort();
      ctl = new AbortController();
      try {
        const res = await api.estimate(st.f, st.target, ctl.signal);
        if (cache.size > 60) cache.delete(cache.keys().next().value);
        cache.set(key, res);
        cache.set(JSON.stringify([res.f, st.target]), res);
        if (id === reqId) apply(res, want);
      } catch (err) {
        if (err?.name === 'AbortError' || id !== reqId) return;
        els.result?.removeAttribute('aria-busy');
        if (err instanceof SalairesError && err.status === 401) {
          info = null;
          return show();
        }
        toast(err?.message || 'Calcul impossible pour l’instant.', 'alert');
      }
    }, delay);
  }

  function apply(res, want) {
    est = res;
    st.f = { ...blank(), ...res.f };
    // Une case devenue trop rare (une autre a été cochée) a été décochée par le serveur : on le dit.
    const dropped = want ? FACTORS.flatMap((k) => (want[k] || []).filter((v) => !st.f[k].includes(v)).map((v) => short(nameOf(k, v)))) : [];
    if (dropped.length) toast(`${dropped.join(', ')} : décoché, moins de ${MIN()} réponses avec le reste de ton profil.`, 'alert');
    els.result?.removeAttribute('aria-busy');
    render();
  }

  // ---------------------------------------------------------------- page
  // Une rubrique du contrôleur de l'en-tête (ui/modes.js), sans onglet : l'onglet Hub reste choisi.
  o.modes.register('salaires', {
    el: page,
    onEnter() {
      open = true;
      history.replaceState(null, '', `${location.pathname}${location.search}#salaires`);
      if (motionOK()) page.animate({ opacity: [0, 1], transform: ['translateY(8px)', 'none'] }, { duration: 300, easing: EASE });
      o.onVisit?.();
      show();
    },
    onLeave(to) {
      open = false;
      if (location.hash === '#salaires') history.replaceState(null, '', location.pathname + location.search);
      if (to === 'hub') requestAnimationFrame(() => lastFocus?.focus?.({ preventScroll: true }));
    },
  });

  function enter(e) {
    e?.preventDefault?.();
    if (!available) return;
    if (!o.isSignedIn()) {
      toast('Connecte-toi pour ouvrir le simulateur : les réponses des alumni sont réservées aux étudiants d’ISIS.', 'lock');
      history.replaceState(null, '', `${location.pathname}${location.search}#salaires`);
      return o.onLogin();
    }
    if (open) return;
    lastFocus = document.activeElement;
    o.beforeOpen?.();
    o.modes.set('salaires');
  }

  function close() {
    if (open) o.modes.set('hub');
  }
  goBtns.forEach((b) => b.addEventListener('click', enter));

  async function show() {
    if (!info) {
      body.replaceChildren(head(), h('div.sal-wait', {}, h('span.spinner'), h('p', { text: 'Chargement du simulateur…' })));
      try {
        await ensureInfo();
      } catch (err) {
        return showError(err);
      }
    }
    build();
    if (est) render();
    request(0);
    els.title?.focus({ preventScroll: true });
  }

  function showError(err) {
    const closed = err instanceof SalairesError && err.status === 404;
    body.replaceChildren(
      head(),
      h(
        'div.sal-wait',
        {},
        h('p', { text: closed ? 'Le simulateur n’est pas ouvert pour l’instant.' : err?.message || 'Le simulateur n’a pas pu être chargé.' }),
        closed ? null : h('button.btn.btn--sm', { type: 'button', text: 'Réessayer', on: { click: show } }),
      ),
    );
  }

  function head() {
    els.title = h('h1.sal-title', { id: 'sal-title', tabIndex: -1, text: 'Simulateur de salaire' });
    els.seg = h(
      'div.seg.sal-target',
      { role: 'group', attrs: { 'aria-label': 'Montant affiché' }, data: { active: st.target } },
      h('button.seg-btn', { type: 'button', attrs: { 'aria-pressed': String(st.target === 'base') }, data: { target: 'base' }, text: 'Fixe' }),
      h('button.seg-btn', { type: 'button', attrs: { 'aria-pressed': String(st.target === 'total') }, data: { target: 'total' }, text: 'Avec primes' }),
      h('span.seg-thumb', { attrs: { 'aria-hidden': 'true' } }),
    );
    for (const b of $$('[data-target]', els.seg))
      b.addEventListener('click', () => {
        if (st.target === b.dataset.target || !info) return;
        st.target = b.dataset.target;
        syncSeg();
        request(0);
      });
    if (!info) els.seg.hidden = true;
    const lead = info
      ? `Ce que gagnent vraiment les ISIS, d’après ${info.n} alumni${info.promos?.[0] ? ` (promos ${info.promos[0]} à ${info.promos[1]})` : ''}. Salaires bruts annuels.`
      : 'D’après le sondage des alumni d’ISIS.';
    const back = h('button.btn.btn--ghost.btn--sm.sal-back', { type: 'button', attrs: { 'aria-label': 'Retour au tableau de bord' }, on: { click: close } }, icon('back', 'ic ic--sm'), h('span', { text: 'Hub' }));
    return h('header.sal-head', {}, h('div.sal-head-l', {}, back, h('div', {}, els.title, h('p.sal-lead', { text: lead }))), els.seg);
  }

  function syncSeg() {
    els.seg.dataset.active = st.target;
    for (const b of $$('[data-target]', els.seg)) b.setAttribute('aria-pressed', String(b.dataset.target === st.target));
  }

  // ---------------------------------------------------------------- construction

  function listOf(k, s) {
    if (s.length > 2) return `${s.length} ${{ xp: 'tranches', poste: 'postes', region: 'lieux', secteur: 'secteurs', structure: 'structures' }[k]}`;
    return s.map((v) => short(nameOf(k, v))).join(' ou ');
  }

  function scopeText(g, except) {
    const parts = [];
    for (const k of ['xp', 'poste', 'region', 'secteur', 'structure']) {
      const s = g?.[k] || [];
      if (k === except || !s.length) continue;
      const txt = listOf(k, s);
      parts.push(k === 'xp' ? `${txt} d’expérience` : txt);
    }
    return parts.length ? parts.join(' · ') : 'Tous les alumni';
  }

  function build() {
    if (built) return;
    built = true;
    els.chips = {};
    els.crit = {};
    // Un critère par ligne : son nom à gauche, ses cases à droite, sur toute la largeur. Sur
    // téléphone, la ligne se replie et montre le choix en cours (« Expérience · 0–1 an »).
    const group = (k, title) => {
      const id = `sal-${k}-l`;
      const any = h('button.sal-chip.sal-chip--any', { type: 'button', on: { click: () => setAll(k) } }, ANY[k] || 'Toutes');
      const list = h('div.sal-chips', { role: 'group', attrs: { 'aria-labelledby': id } }, any);
      els.chips[k] = { any, items: [] };
      names(k).forEach((n, v) => {
        const c = h('span.sal-chip-n');
        const b = h('button.sal-chip', { type: 'button', data: { k, v: String(v) }, on: { click: () => toggle(k, v) } }, h('span', { text: short(n) }), c);
        els.chips[k].items.push({ b, c, v });
        list.append(b);
      });
      const val = h('span.sal-crit-v');
      const head = h(
        'button.sal-crit-h',
        { type: 'button', id, attrs: { 'aria-controls': `sal-${k}-b` }, on: { click: () => fold(k) } },
        h('span.sal-crit-k', { text: title }),
        val,
        icon('chevDown', 'ic ic--sm sal-crit-chev'),
      );
      const row = h('div.sal-crit', { data: { k } }, head, h('div.sal-crit-b', { id: `sal-${k}-b` }, list));
      els.crit[k] = { row, head, val };
      return row;
    };
    els.reset = h('button.btn.btn--ghost.btn--sm.sal-reset', { type: 'button', hidden: true, on: { click: reset } }, icon('restore', 'ic ic--sm'), 'Tout effacer');
    els.moreRows = h('div.sal-crits.sal-crits--more', {}, group('secteur', 'Secteur'), group('structure', 'Type de structure'));
    els.moreBtn = h('button.sal-more-t', { type: 'button', attrs: { 'aria-expanded': 'false' }, on: { click: () => showMore(!els.moreRows.classList.contains('is-shown')) } }, 'Plus de critères');
    const form = h(
      'section.sal-card.sal-form',
      { attrs: { 'aria-labelledby': 'sal-form-t' } },
      h(
        'div.sal-card-h',
        {},
        h('div.sal-form-t', {}, h('h2.sal-h2', { id: 'sal-form-t', text: 'Ton profil' }), h('p.sal-hint', { text: `Coche autant de cases que tu veux, ou aucune. Une case qui n’aurait pas ${MIN()} réponses avec le reste de ton profil est grisée.` })),
        els.reset,
      ),
      h('div.sal-crits', {}, group('xp', 'Expérience après le diplôme'), group('poste', 'Poste'), group('region', 'Lieu de travail')),
      els.moreRows,
      els.moreBtn,
    );
    PHONE.addEventListener('change', syncFold);
    els.result = h('section.sal-card.sal-result', { attrs: { 'aria-labelledby': 'sal-res-t', 'aria-live': 'polite' } });
    const card = (id, iconName, title, ...kids) => h('section.sal-card', { attrs: { 'aria-labelledby': id } }, h('div.sal-card-h', {}, h('h2.sal-h2', { id }, ic(iconName), title)), ...kids);
    els.xpScope = h('p.sal-scope');
    els.xpChart = h('div.sal-chart');
    els.xpNote = h('p.sal-note');
    els.mapScope = h('p.sal-scope');
    els.map = h('div.sal-map');
    els.away = h('ul.sal-away');
    els.mapLegend = h('div.sal-legend', { attrs: { 'aria-hidden': 'true' } });
    els.cmpSeg = h('div.sal-tabs', { role: 'tablist', attrs: { 'aria-label': 'Comparer par' } });
    for (const k of ['poste', 'secteur', 'structure', 'sexe']) {
      const b = h('button.sal-tab', {
        type: 'button',
        role: 'tab',
        id: `sal-tab-${k}`,
        attrs: { 'aria-controls': 'sal-cmp-p', 'aria-selected': String(k === st.cmp) },
        tabIndex: k === st.cmp ? 0 : -1,
        data: { cmp: k },
        text: k === 'sexe' ? 'Femmes / hommes' : LABEL[k],
      });
      b.addEventListener('click', () => {
        st.cmp = k;
        renderCompare();
      });
      b.addEventListener('keydown', (e) => {
        if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
        e.preventDefault();
        const tabs = $$('.sal-tab', els.cmpSeg);
        const i = (tabs.indexOf(b) + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length;
        tabs[i].focus();
        tabs[i].click();
      });
      els.cmpSeg.append(b);
    }
    els.cmpScope = h('p.sal-scope');
    els.cmp = h('div.sal-cmp', { id: 'sal-cmp-p', role: 'tabpanel' });
    els.cmpNote = h('p.sal-note');
    els.perksScope = h('p.sal-scope');
    els.perks = h('div.sal-perks');
    els.histScope = h('p.sal-scope');
    els.hist = h('div.sal-hist');

    const tips = (info.tips || []).map((t) => h('li.sal-tip', {}, h('p', { text: t })));
    const tipsList = h('ul.sal-tips', {}, tips);
    let more = null;
    if (tips.length > 6) {
      more = h('button.btn.btn--sm.sal-more', { type: 'button', attrs: { 'aria-expanded': 'false' }, text: `Voir les ${tips.length} conseils` });
      tipsList.classList.add('is-short');
      more.addEventListener('click', () => {
        const on = more.getAttribute('aria-expanded') !== 'true';
        more.setAttribute('aria-expanded', String(on));
        tipsList.classList.toggle('is-short', !on);
        more.textContent = on ? 'Voir moins' : `Voir les ${tips.length} conseils`;
      });
    }
    const promos = info.promos?.[0] ? ` (promos ${info.promos[0]} à ${info.promos[1]})` : '';
    const method = h(
      'details.sal-method',
      {},
      h('summary', {}, ic('info'), 'Comment c’est calculé, et jusqu’où s’y fier'),
      h(
        'div.sal-method-b',
        {},
        h(
          'p',
          {},
          h('b', { text: 'Les réponses. ' }),
          `${info.n} alumni ont répondu au sondage « Panorama des Carrières »${promos}. Le salaire était demandé par tranche (par exemple 40 à 45 k€) : chaque réponse compte pour le milieu de sa tranche, et « plus de 100 k€ » pour 101 k€. L’expérience aussi est par tranche.${info.grouped ? ` ${info.grouped} réponses ont été reconstituées comme moyenne de 2 ou 3 profils identiques.` : ''}`,
        ),
        h(
          'p',
          {},
          h('b', { text: 'L’estimation. ' }),
          `Un modèle appris sur toutes les réponses (régression sur le logarithme du salaire) donne l’effet de chaque critère en pourcentage. Les critères peu représentés sont volontairement tirés vers zéro : 6 réponses ne suffisent pas à dire qu’un secteur paie 20 % de plus. Testé en mettant chaque réponse de côté, il tombe à moins de ±${Math.round((info.mdae || 0) * 100)} % du vrai salaire une fois sur deux. Le sexe n’entre pas dans l’estimation ; l’écart femmes / hommes est montré à part, tel quel.`,
        ),
        h(
          'p',
          {},
          h('b', { text: 'Les limites. ' }),
          'Les alumni qui répondent ne sont pas tous les alumni : ceux qui sont contents de leur salaire répondent peut-être plus volontiers. Les primes et l’intéressement varient d’une année à l’autre. L’équivalent net est un ordre de grandeur pour un cadre du privé (environ 25 % de cotisations), avant impôt.',
        ),
        h(
          'p',
          {},
          h('b', { text: 'La discrétion. ' }),
          `Les réponses restent sur le serveur du Hub : ton appareil n’en reçoit aucune, seulement des groupes. Un groupe de moins de ${info.min} réponses est masqué, ses quartiles n’apparaissent qu’à partir de ${info.spread} réponses, et une case ne se coche que si elle garde ${info.min} réponses à elle seule : impossible d’isoler quelqu’un. Les catégories trop rares sont fusionnées ; l’année de diplôme, les anecdotes et les détails des conseils ne sont jamais gardés. Ton profil part au serveur le temps du calcul, il n’est ni gardé ni relié à toi.`,
        ),
      ),
    );
    const extracted = info.extracted ? new Date(`${info.extracted}T12:00:00`).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' }) : '';
    body.replaceChildren(
      head(),
      h('div.sal-top', {}, form, els.result),
      h(
        'div.sal-grid',
        {},
        card('sal-xp-t', 'trend', 'Avec les années', els.xpScope, els.xpChart, els.xpNote),
        card('sal-map-t', 'map', 'Selon la région', els.mapScope, h('div.sal-map-w', {}, els.map, h('div.sal-map-side', {}, els.away, els.mapLegend))),
        h('section.sal-card.sal-wide', { attrs: { 'aria-labelledby': 'sal-cmp-t' } }, h('div.sal-card-h', {}, h('h2.sal-h2', { id: 'sal-cmp-t' }, ic('bars'), 'Comparer'), els.cmpSeg), els.cmpScope, els.cmp, els.cmpNote),
        card('sal-hist-t', 'people', 'Comment ça se répartit', els.histScope, els.hist),
        card('sal-perks-t', 'gift', 'Primes et avantages', els.perksScope, els.perks),
        tips.length ? h('section.sal-card.sal-wide', { attrs: { 'aria-labelledby': 'sal-tips-t' } }, h('div.sal-card-h', {}, h('h2.sal-h2', { id: 'sal-tips-t' }, ic('quote'), 'Les conseils des alumni')), tipsList, more) : null,
      ),
      method,
      h(
        'p.sal-foot',
        {},
        ic('shield'),
        h('span', {}, `Données : ${info.source}, ${info.n} réponses${extracted ? `, extraites le ${extracted}` : ''}. Les réponses restent sur le serveur ; ton profil n’est ni gardé ni relié à toi. Carte : Natural Earth (domaine public), régions INSEE.`),
      ),
    );
    buildMap();
    new ResizeObserver(() => open && est && renderXp()).observe(els.xpChart);
  }

  // ---------------------------------------------------------------- profil
  /** Téléphone : déplier ou replier un critère (sur ordinateur, tout reste ouvert). */
  function fold(k) {
    if (!PHONE.matches) return;
    els.crit[k].row.classList.toggle('is-open');
    syncFold();
  }
  function showMore(on) {
    els.moreRows.classList.toggle('is-shown', on);
    els.moreBtn.setAttribute('aria-expanded', String(on));
    els.moreBtn.textContent = on ? 'Moins de critères' : 'Plus de critères';
  }
  function syncFold() {
    for (const { row, head } of Object.values(els.crit)) {
      head.setAttribute('aria-expanded', String(!PHONE.matches || row.classList.contains('is-open')));
      head.tabIndex = PHONE.matches ? 0 : -1;
    }
  }

  function toggle(k, v) {
    const s = st.f[k] || [];
    st.f[k] = s.includes(v) ? s.filter((x) => x !== v) : [...s, v].sort((a, b) => a - b);
    syncForm();
    request();
  }
  function setAll(k) {
    st.f[k] = [];
    syncForm();
    request();
  }
  function reset() {
    st.f = { xp: [], poste: [], secteur: [], structure: [], region: [] };
    syncForm();
    request(0);
    els.title.focus();
  }

  function chip(k, v) {
    return est?.chips?.[k]?.[v] ?? { ok: true };
  }

  function syncForm() {
    for (const [k, g] of Object.entries(els.chips)) {
      g.any.setAttribute('aria-pressed', String(!(st.f[k] || []).length));
      for (const { b, c, v } of g.items) {
        const on = has(k, v);
        const ch = chip(k, v);
        b.setAttribute('aria-pressed', String(on));
        b.disabled = !on && !ch.ok;
        c.textContent = ch.n ? String(ch.n) : '';
        b.title = ch.n ? plural(ch.n, 'réponse') : on ? 'Dans ton profil' : `Moins de ${MIN()} réponses avec ton profil`;
      }
    }
    for (const [k, c] of Object.entries(els.crit)) {
      const s = st.f[k] || [];
      c.val.textContent = s.length ? listOf(k, s) : ANY[k];
      c.row.classList.toggle('is-set', s.length > 0);
    }
    // Secteur ou structure choisis : leurs lignes restent visibles.
    if (['secteur', 'structure'].some((k) => (st.f[k] || []).length)) showMore(true);
    els.reset.hidden = !FACTORS.some((k) => (st.f[k] || []).length);
    syncFold();
    syncSeg();
  }

  function render() {
    if (!built || !est) return;
    syncForm();
    renderResult();
    renderXp();
    renderMap();
    renderCompare();
    renderHist();
    renderPerks();
  }

  // ---------------------------------------------------------------- résultat
  function renderResult() {
    const p = est.result;
    const ex = p.exact;
    const lo = 25e3;
    const hi = Math.max(11e4, p.p90 * 1.05);
    const x = (v) => `${(((Math.min(Math.max(v, lo), hi) - lo) / (hi - lo)) * 100).toFixed(2)}%`;
    const bar = h(
      'div.sal-range',
      { attrs: { 'aria-hidden': 'true' } },
      h('span.sal-range-80', { style: { '--a': x(p.p10), '--b': x(p.p90) } }),
      h('span.sal-range-50', { style: { '--a': x(p.q1), '--b': x(p.q3) } }),
      h('span.sal-range-m', { style: { '--a': x(p.value) } }),
      h('span.sal-range-avg', { style: { '--a': x(p.average) }, attrs: { title: 'Moyenne des alumni' } }),
    );
    const effects = FACTORS.filter((k) => p.effects?.[k] != null && (st.f[k] || []).length).map((k) => {
      const e = p.effects[k];
      const w = Math.min(Math.abs(e) / 0.3, 1) * 50;
      return h(
        'li.sal-eff',
        {},
        h('span.sal-eff-k', {}, h('b', { text: LABEL[k] }), h('span', { text: listOf(k, st.f[k]) })),
        h('span.sal-eff-bar', { attrs: { 'aria-hidden': 'true' } }, h(`span.sal-eff-fill${e < 0 ? '.is-neg' : ''}`, { style: { '--w': `${w.toFixed(1)}%` } })),
        h(`span.sal-eff-v${Math.abs(e) < 0.02 ? '.is-flat' : e < 0 ? '.is-neg' : ''}`, { text: Math.abs(e) < 0.01 ? '≈ 0 %' : pct(e) }),
      );
    });
    let conf;
    if (ex.median != null && ex.n >= GOOD)
      conf = h(
        'p.sal-conf.is-good',
        {},
        ic('people'),
        h(
          'span',
          {},
          h('b', { text: `${ex.n} alumni` }),
          ` ont exactement ce profil : médiane ${euro(ex.median)}${ex.q1 != null ? (ex.q1 === ex.q3 ? ', la moitié d’entre eux pile sur ce montant (même tranche du sondage)' : `, la moitié entre ${kE(ex.q1)} et ${kE(ex.q3)}`) : ''}.`,
        ),
      );
    else if (ex.median != null) conf = h('p.sal-conf', {}, ic('people'), h('span', {}, h('b', { text: `${ex.n} alumni` }), ` ont exactement ce profil (médiane ${euro(ex.median)}). C’est peu : fie-toi plutôt à la fourchette.`));
    else conf = h('p.sal-conf.is-warn', {}, ic('info'), h('span', {}, `Moins de ${MIN()} alumni ont exactement ce profil : leurs réponses restent cachées. L’estimation s’appuie sur les `, h('b', { text: `${info.n} réponses` }), ', critère par critère.'));
    // Deux colonnes sur grand écran : le montant et sa fourchette, puis ce qui joue.
    els.result.replaceChildren(
      h(
        'div.sal-res-main',
        {},
        h('h2.sal-res-k', { id: 'sal-res-t', text: `Salaire estimé, ${what()}` }),
        h('p.sal-res-v', {}, h('span.sal-res-n', { text: euro(round500(p.value)) }), h('span.sal-res-u', { text: 'brut / an' })),
        h(
          'p.sal-res-net',
          {},
          h('span', {}, 'Net cadre : environ ', h('b', { text: `${euro(round500(p.value * NET))} par an` })),
          h('span', {}, 'environ ', h('b', { text: `${euro((p.value * NET) / 12)} par mois` })),
          h('span.sal-res-net-k', { text: 'avant impôt' }),
        ),
        bar,
        h('p.sal-range-l', {}, h('span', {}, h('i.sal-key.sal-key--50'), `1 sur 2 entre ${kE(p.q1)} et ${kE(p.q3)}`), h('span', {}, h('i.sal-key.sal-key--80'), `8 sur 10 entre ${kE(p.p10)} et ${kE(p.p90)}`)),
      ),
      h(
        'div.sal-res-side',
        {},
        conf,
        ...(effects.length
          ? [h('div.sal-effs', {}, h('p.sal-effs-t', {}, 'Ce qui joue, par rapport à la moyenne des alumni (', h('b', { text: euro(round500(p.average)) }), ')'), h('ul.sal-eff-l', {}, effects))]
          : []),
      ),
    );
  }

  // ---------------------------------------------------------------- avec les années
  function renderXp() {
    if (!els.xpChart.isConnected || !est) return;
    const g = est.xp.scope;
    els.xpScope.textContent = `Profil : ${scopeText(st.f, 'xp')}${g.dropped.length ? `. Points mesurés : ${scopeText(g.f, 'xp')} (élargi, trop peu de réponses)` : ''}.`;
    const pts = est.xp.pts.map((d, v) => ({ v, p: d.p, obs: d.obs }));
    const W = Math.max(300, els.xpChart.clientWidth || 560);
    const H = W < 420 ? 220 : 250;
    const L = 46;
    const R = 12;
    const T = 14;
    const B = 40;
    const vals = pts.flatMap((d) => [d.p.p10, d.p.p90, d.obs.q3 ?? d.obs.median ?? d.p.q3]);
    const y0 = Math.floor(Math.min(...vals) / 1e4) * 1e4;
    const y1 = Math.ceil(Math.max(...vals) / 1e4) * 1e4;
    const X = (v) => L + ((W - L - R) * (v + 0.5)) / XP_SHORT.length;
    const Y = (v) => T + (H - T - B) * (1 - (v - y0) / (y1 - y0 || 1));
    const s = svg('svg', { class: 'sal-svg', viewBox: `0 0 ${W} ${H}`, width: W, height: H, role: 'img', 'aria-labelledby': 'sal-xp-desc' });
    const step = y1 - y0 > 6e4 ? 2e4 : 1e4;
    for (let v = y0; v <= y1; v += step) s.append(svg('line', { class: 'sal-grid-l', x1: L, x2: W - R, y1: Y(v), y2: Y(v) }), svg('text', { class: 'sal-ax', x: L - 8, y: Y(v) + 4, 'text-anchor': 'end' }, `${v / 1e3} k`));
    const band = (a, b, cls) => {
      const top = pts.map((d) => `${X(d.v).toFixed(1)},${Y(d.p[a]).toFixed(1)}`);
      const bot = pts.map((d) => `${X(d.v).toFixed(1)},${Y(d.p[b]).toFixed(1)}`).reverse();
      s.append(svg('polygon', { class: cls, points: [...top, ...bot].join(' ') }));
    };
    band('p90', 'p10', 'sal-band-80');
    band('q3', 'q1', 'sal-band-50');
    s.append(svg('polyline', { class: 'sal-line', points: pts.map((d) => `${X(d.v).toFixed(1)},${Y(d.p.value).toFixed(1)}`).join(' ') }));
    const sel = (v) => (st.f.xp || []).includes(v);
    for (const v of st.f.xp || []) s.append(svg('line', { class: 'sal-sel-l', x1: X(v), x2: X(v), y1: T, y2: H - B }));
    for (const d of pts) {
      const on = sel(d.v);
      if (d.obs.q1 != null) s.append(svg('line', { class: 'sal-obs-r', x1: X(d.v) + 14, x2: X(d.v) + 14, y1: Y(d.obs.q1), y2: Y(d.obs.q3) }));
      if (d.obs.median != null) s.append(svg('rect', { class: 'sal-obs', x: X(d.v) + 10.5, y: Y(d.obs.median) - 3.5, width: 7, height: 7, rx: 1.5 }));
      s.append(svg('circle', { class: `sal-pt${on ? ' is-sel' : ''}`, cx: X(d.v), cy: Y(d.p.value), r: on ? 6 : 4 }));
      if (on || W >= 480) s.append(svg('text', { class: `sal-pt-l${on ? ' is-sel' : ''}`, x: X(d.v), y: Y(d.p.value) - 12, 'text-anchor': 'middle' }, kE(d.p.value)));
      const lab = W < 420 ? XP_SHORT[d.v].replace(' ans', ' a').replace(' an', ' a').replace(' et +', '+') : XP_SHORT[d.v];
      s.append(
        svg('text', { class: `sal-ax sal-ax-x${on ? ' is-sel' : ''}`, x: X(d.v), y: H - B + 18, 'text-anchor': 'middle' }, lab),
        svg('text', { class: 'sal-ax sal-ax-n', x: X(d.v), y: H - B + 32, 'text-anchor': 'middle' }, d.obs.n ? `n = ${d.obs.n}` : d.obs.few ? `< ${MIN()}` : '—'),
      );
    }
    const desc = pts.map((d) => `${XP_SHORT[d.v]} : ${euro(round500(d.p.value))} estimés${d.obs.median != null ? `, médiane mesurée ${euro(d.obs.median)} sur ${d.obs.n} réponses` : ''}`).join(' ; ');
    s.prepend(svg('desc', { id: 'sal-xp-desc' }, `Salaire ${what()} selon l’expérience. ${desc}.`));
    const legend = h(
      'p.sal-chart-k',
      { attrs: { 'aria-hidden': 'true' } },
      h('span', {}, h('i.sal-key.sal-key--line'), 'Estimation'),
      h('span', {}, h('i.sal-key.sal-key--50'), '1 sur 2'),
      h('span', {}, h('i.sal-key.sal-key--80'), '8 sur 10'),
      h('span', {}, h('i.sal-key.sal-key--obs'), `Médiane mesurée (n ≥ ${MIN()})`),
    );
    els.xpChart.replaceChildren(s, legend);
    const gain = pts[4].p.value / pts[0].p.value - 1;
    let jump = 1;
    for (let i = 1; i < pts.length; i++) if (pts[i].p.value / pts[i - 1].p.value > pts[jump].p.value / pts[jump - 1].p.value) jump = i;
    els.xpNote.textContent = `Du premier emploi à 10 ans et plus : ${pct(gain)} (${kE(pts[0].p.value)} → ${kE(pts[4].p.value)}). Le plus gros saut : entre ${XP_SHORT[jump - 1]} et ${XP_SHORT[jump]}.`;
  }

  // ---------------------------------------------------------------- carte
  let regG = new Map();
  let regLab = new Map();
  function buildMap() {
    const [bx0, by0, bx1, by1] = geo.BOUNDS;
    const mapSvg = svg('svg', { class: 'sal-fr', viewBox: `${bx0 - 10} ${by0 - 10} ${bx1 - bx0 + 20} ${by1 - by0 + 20}`, role: 'group', 'aria-label': 'Carte des régions : salaire médian' });
    const gR = svg('g');
    const gL = svg('g', { 'aria-hidden': 'true' }, svg('path', { class: 'sal-fr-coast', d: geo.COAST }), svg('path', { class: 'sal-fr-rb', d: geo.REGION_BORDERS }));
    const gT = svg('g', { class: 'sal-fr-labs', 'aria-hidden': 'true' });
    regG = new Map();
    regLab = new Map();
    const codeToV = new Map(Object.entries(info.regions || {}).map(([n, c]) => [c, info.dims.region.indexOf(n)]));
    for (const r of geo.REGIONS) {
      const v = codeToV.get(r.c);
      const g = svg('g', { class: 'sal-fr-r', 'data-reg': r.c });
      for (const d of geo.DEPTS) if (d.r === r.c) g.append(svg('path', { d: d.d }));
      if (v != null && v >= 0) {
        g.setAttribute('role', 'button');
        g.setAttribute('tabindex', '0');
        g.classList.add('is-data');
        const go = () => {
          if (g.classList.contains('is-locked')) return;
          toggle('region', v);
        };
        g.addEventListener('click', go);
        g.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            go();
          }
        });
        regG.set(v, g);
        const t = svg('text', { class: 'sal-fr-t', x: r.x, y: r.c === '11' ? r.y - 78 : r.y, 'text-anchor': 'middle' });
        regLab.set(v, t);
        gT.append(t);
      } else g.append(svg('title', {}, `${r.n} : aucune réponse`));
      gR.append(g);
    }
    mapSvg.append(gR, gL, gT);
    els.map.replaceChildren(mapSvg);
  }

  function renderMap() {
    const g = est.map.scope;
    els.mapScope.textContent = `Salaire médian ${what()}, ${scopeText(g.f, 'region').replace('Tous les alumni', 'tous profils')}${g.dropped.length ? ' (élargi : trop peu de réponses par région)' : ''}. Touche une région pour l’ajouter à ton profil (possible dès ${MIN()} réponses).`;
    const by = est.map.groups;
    const shown = by.filter((d) => d.median != null).map((d) => d.median);
    const lo = Math.min(...shown);
    const hi = Math.max(...shown);
    const q = (m) => (hi === lo ? 3 : 1 + Math.round(((m - lo) / (hi - lo)) * 4));
    for (const [v, el] of regG) {
      const d = by[v] ?? {};
      el.classList.remove('q1', 'q2', 'q3', 'q4', 'q5', 'is-few');
      const mine = has('region', v);
      const locked = !mine && !chip('region', v).ok;
      el.classList.toggle('is-sel', mine);
      el.classList.toggle('is-locked', locked);
      el.setAttribute('aria-disabled', String(locked));
      el.setAttribute('aria-pressed', String(mine));
      const t = regLab.get(v);
      t.replaceChildren();
      const name = info.dims.region[v];
      if (d.median != null) {
        el.classList.add(`q${q(d.median)}`);
        t.append(svg('tspan', { x: t.getAttribute('x'), dy: 0, class: 'sal-fr-v' }, kE(d.median)), svg('tspan', { x: t.getAttribute('x'), dy: 30, class: 'sal-fr-n' }, `n = ${d.n}`));
        el.setAttribute('aria-label', `${name} : médiane ${euro(d.median)}, ${plural(d.n, 'réponse')}${mine ? ', dans ton profil' : locked ? `, moins de ${MIN()} réponses avec ton profil` : ''}`);
      } else {
        el.classList.add('is-few');
        t.append(svg('tspan', { x: t.getAttribute('x'), dy: 0, class: 'sal-fr-n' }, d.few ? `< ${MIN()}` : '—'));
        el.setAttribute('aria-label', `${name} : ${d.few ? `moins de ${MIN()} réponses, masqué` : 'aucune réponse'} pour ce profil`);
      }
    }
    const off = info.dims.region.map((n, v) => [n, v]).filter(([n]) => !info.regions?.[n]);
    els.away.replaceChildren(
      ...off.map(([n, v]) => {
        const d = by[v] ?? {};
        const on = has('region', v);
        return h(
          'li',
          {},
          h(
            `button.sal-away-b${on ? '.is-sel' : ''}`,
            { type: 'button', disabled: !on && !chip('region', v).ok, attrs: { 'aria-pressed': String(on) }, on: { click: () => toggle('region', v) } },
            ic(n === 'International' ? 'globe' : n === 'Full Télétravail' ? 'home' : 'dots'),
            h('span.sal-away-n', { text: n === 'Full Télétravail' ? 'Télétravail complet' : n === 'International' ? 'À l’étranger' : short(n) }),
            h('span.sal-away-v', { text: d.median != null ? kE(d.median) : d.few ? `< ${MIN()} rép.` : '—' }),
            d.median != null ? h('span.sal-away-c', { text: `n = ${d.n}` }) : null,
          ),
        );
      }),
    );
    els.mapLegend.replaceChildren(
      h('span.sal-legend-t', { text: 'Médiane' }),
      h('span.sal-legend-s', {}, ...[1, 2, 3, 4, 5].map((i) => h(`i.q${i}`))),
      h('span.sal-legend-r', {}, h('span', { text: shown.length ? kE(lo) : '' }), h('span', { text: shown.length ? kE(hi) : '' })),
      h('span.sal-legend-few', {}, h('i'), `Moins de ${MIN()} réponses`),
    );
  }

  // ---------------------------------------------------------------- comparer
  function renderCompare() {
    if (!est) return;
    for (const b of $$('.sal-tab', els.cmpSeg)) {
      const on = b.dataset.cmp === st.cmp;
      b.setAttribute('aria-selected', String(on));
      b.tabIndex = on ? 0 : -1;
      if (on) els.cmp.setAttribute('aria-labelledby', b.id);
    }
    const k = st.cmp;
    const panel = est.cmp[k];
    const g = panel.scope;
    els.cmpScope.textContent = `Salaire ${what()} · ${scopeText(g.f, k)}${g.dropped.length ? ' (élargi pour avoir assez de réponses)' : ''}. Le point est la médiane ; la barre va du premier au troisième quart, à partir de ${info.spread} réponses.`;
    const list = info.dims[k].map((n, v) => ({ n, v, d: panel.groups[v] ?? {} })).filter((x) => x.d.n || x.d.few);
    const shown = list.filter((x) => x.d.median != null).sort((a, b) => b.d.median - a.d.median || b.d.n - a.d.n);
    const hidden = list.filter((x) => x.d.median == null);
    const lo = 25e3;
    const hi = Math.max(8e4, ...shown.map((x) => x.d.q3 ?? x.d.median)) * 1.02;
    const x = (v) => `${(((Math.min(Math.max(v, lo), hi) - lo) / (hi - lo)) * 100).toFixed(2)}%`;
    const mine = k !== 'sexe' ? st.f[k] || [] : [];
    els.cmp.replaceChildren(
      h(
        'ol.sal-rows',
        {},
        shown.map((it) =>
          h(
            `li.sal-row${mine.includes(it.v) ? '.is-mine' : ''}`,
            {},
            h('span.sal-row-k', {}, h('b', { text: short(it.n) }), h('span', { text: `n = ${it.d.n}` })),
            h(
              'span.sal-row-bar',
              { attrs: { 'aria-hidden': 'true' } },
              it.d.q1 != null ? h('span.sal-row-iqr', { style: { '--a': x(it.d.q1), '--b': x(it.d.q3) } }) : null,
              h('span.sal-row-m', { style: { '--a': x(it.d.median) } }),
            ),
            h('span.sal-row-v', {}, h('b', { text: kE(it.d.median) }), h('span', { text: it.d.q1 != null ? `${kE(it.d.q1)} – ${kE(it.d.q3)}` : 'médiane seule' })),
            h('span.sr-only', { text: `${it.n} : médiane ${euro(it.d.median)}${it.d.q1 != null ? `, la moitié entre ${euro(it.d.q1)} et ${euro(it.d.q3)}` : ''}, ${plural(it.d.n, 'réponse')}.` }),
          ),
        ),
      ),
      ...(hidden.length ? [h('p.sal-hidden', {}, ic('shield'), `${hidden.map((h2) => short(h2.n)).join(', ')} : moins de ${MIN()} réponses ici, masqué.`)] : []),
    );
    if (k === 'sexe') {
      const [hm, fm] = [0, 1].map((v) => panel.groups[v]);
      els.cmpNote.textContent =
        hm?.median != null && fm?.median != null && info.dims.sexe[0] === 'Homme' && info.dims.sexe[1] === 'Femme'
          ? `Écart brut des médianes : ${pct(fm.median / hm.median - 1)} pour les femmes. Il mélange plusieurs choses (postes, régions, expérience) et repose sur des tranches de salaire : c’est un constat, pas une mesure de discrimination.`
          : '';
    } else els.cmpNote.textContent = shown.length < 2 ? 'Trop peu de réponses pour comparer ici : retire un critère de ton profil.' : '';
  }

  // ---------------------------------------------------------------- répartition
  function renderHist() {
    const hs = est.hist;
    els.histScope.textContent = `${scopeText(hs.scope.f)}${hs.scope.dropped.length ? ' (élargi)' : ''} · ${plural(hs.n, 'réponse')}, salaire ${what()} en k€.`;
    const counts = hs.bins.map((c) => (c == null ? null : c));
    const max = Math.max(...counts.map((c) => c ?? MIN()), 1);
    els.hist.replaceChildren(
      h(
        'ol.sal-bins',
        { attrs: { 'aria-label': 'Répartition des salaires par tranche' } },
        counts.map((c, i) =>
          h(
            `li.sal-bin${i === hs.est ? '.is-est' : ''}${c == null ? '.is-few' : ''}`,
            {},
            h('span.sal-bin-v', { text: c == null ? `<${MIN()}` : c ? `${Math.round((c / hs.n) * 100)} %` : '' }),
            h('span.sal-bin-b', { style: { '--h': `${(((c ?? MIN() / 2) / max) * 100).toFixed(1)}%` }, attrs: { 'aria-hidden': 'true' } }),
            h('span.sal-bin-k', { text: BIN_LABEL[i] }),
            h('span.sr-only', { text: ` k€ : ${c == null ? `moins de ${MIN()} réponses` : c ? `${Math.round((c / hs.n) * 100)} % des réponses` : 'aucune réponse'}${i === hs.est ? ', ton estimation' : ''}` }),
          ),
        ),
      ),
      h('p.sal-chart-k', { attrs: { 'aria-hidden': 'true' } }, h('span', {}, h('i.sal-key.sal-key--est'), 'Tranche de ton estimation')),
    );
  }

  // ---------------------------------------------------------------- primes et avantages
  function renderPerks() {
    const pk = est.perks;
    els.perksScope.textContent = `${scopeText(pk.scope.f)}${pk.scope.dropped.length ? ' (élargi)' : ''} · ${plural(pk.n, 'réponse')}.`;
    const advs = info.adv.map((a, i) => ({ a, s: pk.adv[i] })).sort((x, y) => (y.s ?? -1) - (x.s ?? -1));
    els.perks.replaceChildren(
      h(
        'div.sal-kpis',
        {},
        h('div.sal-kpi', {}, h('b', { text: pk.bonus != null ? `${Math.round(pk.bonus * 100)} %` : '—' }), h('span', { text: pk.bonus != null ? 'touchent des primes ou de l’intéressement' : `moins de ${MIN()} réponses avec primes` })),
        h(
          'div.sal-kpi',
          {},
          h('b', { text: pk.bonusMedian != null ? `${nf.format(round500(pk.bonusMedian))} €` : '—' }),
          h('span', { text: pk.bonusMedian != null ? 'de primes par an (médiane, pour ceux qui en ont)' : `moins de ${MIN()} réponses avec primes` }),
        ),
      ),
      h(
        'ul.sal-adv',
        {},
        advs.map(({ a, s }) =>
          h('li', {}, h('span.sal-adv-k', { text: a }), h('span.sal-adv-bar', { attrs: { 'aria-hidden': 'true' } }, h('span', { style: { '--w': `${((s ?? 0) * 100).toFixed(1)}%` } })), h('span.sal-adv-v', { text: s != null ? `${Math.round(s * 100)} %` : `< ${MIN()}` })),
        ),
      ),
    );
  }

  // ---------------------------------------------------------------- ouverture par l'administration
  function setAvailable(on, n) {
    available = on;
    for (const b of goBtns) {
      b.hidden = !on;
      b.nextElementSibling?.matches?.('.sal-go-sep') && (b.nextElementSibling.hidden = !on);
    }
    $$('[data-sal-n]').forEach((e) => (e.textContent = n ? `${n} alumni` : 'les alumni'));
    o.onAvailable?.(on);
  }

  let statusReady = null;
  function checkStatus() {
    statusReady = (async () => {
      // Aperçu (appareil de l'administrateur, choisi depuis l'administration) : le bouton se montre
      // ici avant l'ouverture ; le serveur ne sert le simulateur qu'aux identifiants de l'administration.
      const preview = prefs.get('salaires-apercu') === true;
      let res = { enabled: false };
      try {
        res = await api.status();
      } catch {
        res = { enabled: false };
      }
      setAvailable(Boolean(res.enabled) || preview, res.n);
      if (location.hash === '#salaires' && available && o.isSignedIn()) setTimeout(enter, 50);
    })();
    return statusReady;
  }

  return {
    checkStatus,
    whenReady: () => Promise.race([statusReady ?? Promise.resolve(), new Promise((r) => setTimeout(r, 3000))]),
    enter,
    close,
    escape: close,
    isOpen: () => open,
    available: () => available,
    handleHash() {
      if (location.hash === '#salaires' && available && o.isSignedIn()) setTimeout(enter, 50);
    },
    /** Déconnexion : session et calculs oubliés. */
    async signedOut() {
      close();
      if (info) await api.leave().catch(() => {});
      info = est = null;
      cache.clear();
      built = false;
      failed = null;
      st.f = blank();
      body.replaceChildren();
    },
  };
}
