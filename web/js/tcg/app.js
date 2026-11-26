// ISIS · TCG : bascule Hub / TCG de l'en-tête, navigation du jeu (dock), page d'attente avant le
// lancement, accueil (booster du jour, à faire, « Dans la promo »), bienvenue et fiche d'une carte.
//
// Identité : pour rejoindre le jeu, la page demande au CAS un ticket à usage unique (pour l'ENT,
// comme l'administration) que le serveur fait valider par l'université ; il n'en garde qu'une
// empreinte (HMAC) de l'identifiant. La session de jeu de l'appareil est un cookie HttpOnly.

import { $, h, toast, motionOK } from '../core/dom.js';
import { prefs } from '../core/store.js';
import { seen, markSeen } from '../core/seen.js';
import { api, adminApi, TcgError } from './api.js';
import { cardEl, ic, mark, rchip, RLABEL, CATS, REPLICA, tier, sheet, sheetOpen, tbtn, meter, dayLong, dateShort, hourText, ago, untilText, plural, placeholderArt, pips } from './ui.js';
import { shield } from './shield.js';
import { openBooster, showRecap, packEl } from './open.js';
import { renderCreate, createForm, proposalsList } from './create.js';
import { renderCollection } from './collection.js';
import { renderJury } from './jury.js';
import { renderTrade, startTrade, joinTradeCode, openJoinSheet } from './trade.js';
import { renderConsent, openMailing, pendingAppear } from './consent.js';
import { leaderboard } from './leaders.js';

const DOCK = [
  ['home', 'Booster', 'booster'],
  ['collection', 'Collection', 'collection'],
  ['create', 'Créer', 'plus'],
  ['jury', 'Jury', 'jury'],
  ['trade', 'Échanges', 'trade'],
];

/** « Léa MARTIN » ou « MARTIN Léa » → « Léa M. » */
export function defaultPseudo(name = '') {
  const words = name.split(/\s+/).filter(Boolean);
  if (!words.length) return '';
  const first = words.find((w) => /\p{Ll}/u.test(w)) ?? words[0];
  const other = words.find((w) => w !== first);
  const cap = (w) => w.toLowerCase().replace(/(^|[-'’])(\p{L})/gu, (_, sep, l) => sep + l.toUpperCase()); // Jean-Pierre
  return other ? `${cap(first)} ${other.charAt(0).toUpperCase()}.` : cap(first);
}

/**
 * o : { app, isSignedIn(), userName(), onLogin(), getTicket(), beforeOpen(), onMode(tcg) }
 */
export function createTCG(o) {
  const app = o.app;
  const hub = $('#contenu');
  const sw = $('[data-mode-sw]');
  const tabHub = $('#tab-hub');
  const tabTcg = $('#tab-tcg');
  const dot = $('[data-tcg-ready]');
  const soonChip = $('[data-tcg-soon]');
  const theme = $('meta[name="theme-color"]');

  const wrap = h('div.tcg-wrap', { data: { tcgView: '' } });
  shield(); // cartes floutées pendant les captures repérables, sans aucun message
  const dockBtns = {};
  const dockBadges = {};
  const dock = h(
    'nav.tcg-dock',
    { attrs: { 'aria-label': 'TCG' } },
    ...DOCK.map(([v, label, icon]) => {
      const badge = h('i.tcg-dock-badge', { hidden: true });
      const b = h(`button.tcg-dock-btn${v === 'home' ? '.is-main' : ''}`, { type: 'button', data: { tcgGo: v } }, ic(icon), h('span', { text: label }), badge);
      b.addEventListener('click', () => go(v));
      dockBtns[v] = b;
      dockBadges[v] = badge;
      return b;
    }),
  );
  const main = h('main.tcg', { id: 'tcg', hidden: true, attrs: { role: 'tabpanel', 'aria-labelledby': 'tab-tcg' } }, h('div.tcg-bg', { attrs: { 'aria-hidden': 'true' } }, h('i'), h('i'), h('i')), wrap, dock);
  hub.after(main);

  let pub = null; // vue publique (sans session)
  let st = null; // vue du joueur (session de jeu)
  let view = prefs.get('tcgView', 'home');
  let open = false;
  let loading = null;
  let refreshTimer = null;
  let tickTimer = null;
  let pendingCode = null;
  let mailTried = false; // adresse de la messagerie envoyée une fois par visite
  let mailing = null; // mails d'accord (administrateur), dernier état connu
  let joining = null;
  const cards = new Map();

  // ---------------------------------------------------------------- données
  const phase = () => (st ?? pub)?.phase ?? 'off';
  const data = () => st ?? pub;
  function setState(next) {
    st = next;
    cards.clear();
    for (const c of st?.cards ?? []) cards.set(c.id, c);
    if (st) pub = { phase: st.phase, season: st.season, runs: st.runs, perDay: st.perDay, waves: st.waves, stats: st.stats, now: st.now };
    syncHeader();
  }

  async function loadPublic() {
    try {
      pub = await api.publicView();
    } catch {
      pub ??= null;
    }
    syncHeader();
    return pub;
  }

  /** Session de jeu de cet appareil (sinon null). */
  async function loadState() {
    try {
      setState(await api.state());
    } catch (err) {
      if (err.status === 401) setState(null);
      else throw err;
    }
    linkMail();
    if (st?.me?.admin && !mailing) {
      // Compteurs des mails d'accord, sans rien demander : la session admin peut ne pas être ouverte.
      adminApi.mailing().then((m) => {
        mailing = m;
        if (open && view === 'home' && !ctx.editing && !sheetOpen()) render();
      }, () => {});
    }
    return st;
  }

  // Personnes sur la photo : le jeu retrouve les cartes où l'on m'a indiqué grâce à l'adresse de ma
  // messagerie (lue par cette page) ; le serveur n'en garde qu'une empreinte.
  async function linkMail() {
    if (!st || st.me.mailLinked || mailTried) return;
    const email = o.userEmail?.();
    if (!email) return;
    mailTried = true;
    try {
      await api.linkMail(email);
      setState(await api.state());
      if (open && !ctx.editing && !sheetOpen()) render();
    } catch {
      // adresse hors université ou déjà liée : « Mes apparitions » le dira
    }
  }

  async function refresh({ quiet = true } = {}) {
    try {
      if (st) await loadState();
      else await loadPublic();
      // Formulaire en cours (photo choisie, texte tapé) ou feuille ouverte : on ne redessine pas la
      // page, sinon la saisie serait perdue ; seuls l'en-tête et le dock suivent.
      if (open && !ctx.editing && !sheetOpen()) render();
    } catch (err) {
      if (!quiet) toast(err.message, 'alert');
    }
  }

  /** Entrée dans le jeu : session existante, ou reconnexion silencieuse si déjà inscrit ailleurs. */
  async function load() {
    if (loading) return loading;
    loading = (async () => {
      await Promise.all([loadState().catch(() => null), pub ? null : loadPublic()]);
      if (!st && o.isSignedIn() && seen('tcg') && phase() !== 'off') await join({ silent: true }).catch(() => {});
    })();
    try {
      await loading;
    } finally {
      loading = null;
    }
  }

  // ---------------------------------------------------------------- rejoindre le jeu
  async function doJoin(pseudo) {
    const ticket = await o.getTicket();
    await api.join(ticket, pseudo);
    markSeen('tcg');
    prefs.set('tcgJoined', true);
    await loadState();
  }

  async function join({ silent = false } = {}) {
    if (st) return true;
    if (!o.isSignedIn()) {
      requireLogin();
      return false;
    }
    if (silent) {
      const name = defaultPseudo(o.userName());
      if (!name) return false; // nom du compte pas encore connu : la fenêtre d'arrivée le dira
      await doJoin(name);
      return true;
    }
    if (joining) return joining;
    joining = welcomeSheet().finally(() => (joining = null));
    return joining;
  }

  function welcomeSheet() {
    return new Promise((resolve) => {
      const soon = phase() === 'soon';
      // Le nom n'est pas choisi : « Prénom N. », tiré du compte ENT, et il ne se change pas.
      const pseudo = defaultPseudo(o.userName());
      const shown = h('p.tinput.tpseudo', { id: 'twel-pseudo', text: pseudo || '—', attrs: { 'aria-readonly': 'true' } });
      const err = h('p.terr', { hidden: true, attrs: { role: 'alert' } });
      const go = tbtn('Rejoindre la partie', 'arrow', 'tbtn--primary tbtn--lg');
      const fan = h('div.twel-fan');
      const sample = [...cards.values()].filter((c) => !c.removed).sort((a, b) => tier(b.rarity) - tier(a.rarity)).slice(0, 3);
      for (let i = 0; i < 3; i++) {
        const c = sample[i];
        const el = c ? cardEl(c, { size: 'md' }) : cardEl({ id: `fan${i}`, title: ['Le néon qui clignote', 'Le café de 10 h', 'Le bus de 18 h 12'][i], cat: ['lieu', 'moment', 'truc'][i], desc: '' }, { size: 'md', mystery: true });
        el.classList.add(`fan-${i}`);
        fan.append(el);
      }
      const li = (icon, b, rest) => h('li', {}, ic(icon), h('span', {}, h('b', { text: b }), rest));
      let ok = false;
      const s = sheet(
        'welcome',
        'Bienvenue dans le TCG',
        h(
          'div.twel',
          {},
          fan,
          h('p.tk', { text: soon ? 'Bientôt · TCG de la promo' : 'Nouveau · TCG de la promo' }),
          h('h2.twel-h', { text: 'Les cartes, c’est la promo qui les crée' }),
          h(
            'ul.twel-list',
            {},
            li('booster', '2 boosters par jour', ', 4 cartes chacun (le second 3 h après le premier), de Commune à Unique (un seul exemplaire au monde).'),
            li('pen', 'Crée tes cartes', ` : une photo, un titre, deux phrases. ${data()?.perDay ?? 3} par jour.`),
            li('jury', 'Le jury de la semaine', ' choisit les cartes qui entrent dans le jeu.'),
            li('trade', 'Échange en face à face', ' avec un QR code.'),
          ),
          h(
            'div.tfield',
            {},
            h('span.tlabel', { text: 'Ton nom dans le jeu' }),
            shown,
            h('p.thelp', { text: `Ton prénom et l’initiale de ton nom, tirés de ton compte : il ne se change pas, pour que chacun sache avec qui il échange. ${soon ? 'Avant le lancement, le jeu n’enregistre que tes propositions et ce nom, rien d’autre de ton compte.' : 'Le jeu enregistre ta collection, tes propositions et tes votes, rien d’autre de ton compte.'}` }),
          ),
          err,
          go,
        ),
        { onClose: () => resolve(ok) },
      );
      const submit = async () => {
        const name = pseudo;
        if (!name) {
          err.textContent = 'Ton prénom n’a pas pu être lu depuis ton compte : reconnecte-toi au Hub, puis réessaie.';
          err.hidden = false;
          return;
        }
        go.disabled = true;
        go.querySelector('span').textContent = 'Vérification par l’université…';
        try {
          await doJoin(name);
          ok = true;
          s.close();
          toast(`Bienvenue dans le jeu, ${st.me.pseudo} !`, 'check');
        } catch (e) {
          err.textContent = e instanceof TcgError ? e.message : 'Ta session universitaire a expiré : reconnecte-toi au Hub, puis réessaie.';
          err.hidden = false;
          go.disabled = false;
          go.querySelector('span').textContent = 'Rejoindre la partie';
        }
      };
      go.addEventListener('click', submit);
      if (motionOK()) [...fan.children].forEach((c, i) => c.animate([{ opacity: 0, transform: 'translateY(40px)' }, { opacity: 1 }], { duration: 500, delay: 90 * i, easing: 'cubic-bezier(.2,.8,.2,1)', fill: 'backwards' }));
    });
  }

  // ---------------------------------------------------------------- en-tête et mode
  function syncHeader() {
    const p = phase();
    sw.hidden = p === 'off';
    soonChip.hidden = p !== 'soon';
    const lastBallot = st?.jury?.ballots?.[st.jury.ballots.length - 1];
    const juryPending = Boolean(lastBallot && !lastBallot.done);
    dot.hidden = !((p === 'live' && (!st || st.me.boosterReady)) || juryPending);
    dot.setAttribute('aria-label', juryPending && p !== 'live' ? 'Duels du jury à jouer' : 'Booster disponible');
    app.classList.toggle('tcg-soon', p === 'soon' || (p === 'live' && !st));
    if (p === 'off' && open) setMode(false);
    syncDock();
  }

  function syncDock() {
    const s = st;
    const badge = (v, n) => {
      dockBadges[v].hidden = !n;
      dockBadges[v].textContent = n ? String(n) : '';
    };
    badge('home', s?.me.boosterReady ? 1 : 0);
    const last = s?.jury?.ballots?.[s.jury.ballots.length - 1];
    badge('jury', last && !last.done ? 1 : 0);
    badge('trade', s?.invites?.length ?? 0);
    badge('collection', 0);
    badge('create', 0);
    for (const [v, b] of Object.entries(dockBtns)) {
      if (v === view) b.setAttribute('aria-current', 'page');
      else b.removeAttribute('aria-current');
    }
  }

  /**
   * Passage Hub ↔ TCG : le jeu s'ouvre en cercle depuis l'onglet « TCG » (et se referme vers lui).
   * View Transitions quand le navigateur les connaît, sinon un voile qui fait le même geste.
   */
  function reveal(tcg, apply) {
    if (!motionOK()) return apply();
    const r = (tcg ? tabTcg : tabHub).getBoundingClientRect();
    const x = r.left + r.width / 2;
    const y = r.top + r.height / 2;
    const R = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y));
    const from = `circle(0px at ${x}px ${y}px)`;
    const to = `circle(${R}px at ${x}px ${y}px)`;
    const html = document.documentElement;
    if (document.startViewTransition && document.visibilityState === 'visible') {
      html.dataset.vt = tcg ? 'in' : 'out';
      const t = document.startViewTransition(apply);
      t.ready
        .then(() =>
          html.animate(
            { clipPath: tcg ? [from, to] : [to, from] },
            { duration: tcg ? 720 : 520, easing: 'cubic-bezier(.65,0,.35,1)', pseudoElement: tcg ? '::view-transition-new(root)' : '::view-transition-old(root)' },
          ),
        )
        .catch(() => {});
      t.finished.catch(() => {}).finally(() => delete html.dataset.vt);
      t.updateCallbackDone.catch(() => {});
      return;
    }
    // Sans View Transitions (anciens navigateurs) : voile aux couleurs du jeu.
    const veil = h('div.mode-veil', { attrs: { 'aria-hidden': 'true' } });
    document.body.append(veil);
    if (tcg) {
      veil.animate({ clipPath: [from, to] }, { duration: 520, easing: 'cubic-bezier(.65,0,.35,1)', fill: 'forwards' }).onfinish = () => {
        apply();
        veil.animate({ opacity: [1, 0] }, { duration: 320, fill: 'forwards' }).onfinish = () => veil.remove();
      };
    } else {
      apply();
      veil.animate({ clipPath: [to, from] }, { duration: 480, easing: 'cubic-bezier(.65,0,.35,1)', fill: 'forwards' }).onfinish = () => veil.remove();
    }
  }

  function setMode(tcg) {
    if (tcg === open) return;
    const apply = () => {
      open = tcg;
      app.classList.toggle('is-tcg', tcg);
      hub.hidden = tcg;
      main.hidden = !tcg;
      tabHub.setAttribute('aria-selected', String(!tcg));
      tabTcg.setAttribute('aria-selected', String(tcg));
      tabHub.tabIndex = tcg ? -1 : 0;
      tabTcg.tabIndex = tcg ? 0 : -1;
      theme?.setAttribute('content', tcg ? '#061317' : '#F5F4F0');
      if (tcg) render();
      window.scrollTo(0, 0);
    };
    reveal(tcg, apply);
    clearInterval(refreshTimer);
    clearInterval(tickTimer);
    if (tcg) {
      refreshTimer = setInterval(() => document.visibilityState === 'visible' && refresh(), 60_000);
      tickTimer = setInterval(tick, 1000);
    }
    o.onMode?.(tcg);
  }

  /**
   * Pas connecté = pas de TCG : le jeu est rattaché au compte universitaire. On ne montre aucune
   * page du jeu, on mène à la connexion, et on revient au jeu une fois connecté (`hash`).
   */
  let askedLogin = false;
  function requireLogin(hash = '#tcg') {
    askedLogin = true;
    toast('Connecte-toi pour accéder au TCG : tes cartes sont rattachées à ton compte universitaire.', 'lock');
    o.onLogin(hash);
  }

  async function enter(target) {
    if (!o.isSignedIn()) return requireLogin();
    o.beforeOpen?.();
    view = target || 'home'; // le booster du jour d'abord
    setMode(true);
    wrap.replaceChildren(h('div.tco-empty', {}, h('span.spinner')));
    try {
      await load();
    } catch (err) {
      toast(err.message, 'alert');
    }
    if (phase() === 'off') {
      setMode(false);
      return toast('Le TCG n’est pas encore ouvert.', 'info');
    }
    render();
    // Le jeu est rattaché au compte universitaire : sans connexion, l'écran « Connecte-toi ».
    if (!st && !o.isSignedIn()) return;
    if (!st && !(await join())) return;
    if (pendingCode) {
      const code = pendingCode;
      pendingCode = null;
      if (await join()) joinTradeCode(ctx, code);
    }
  }

  tabHub.addEventListener('click', () => setMode(false));
  tabTcg.addEventListener('click', () => (open ? go('home') : enter()));
  sw.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    const tcg = e.key === 'ArrowRight';
    (tcg ? tabTcg : tabHub).focus();
    tcg ? enter() : setMode(false);
  });

  // ---------------------------------------------------------------- navigation
  function go(v) {
    if (!open) return enter(v);
    if (phase() === 'soon' && v !== 'create' && v !== 'jury' && v !== 'consent') v = 'home';
    view = v;
    prefs.set('tcgView', v === 'trade' ? 'home' : v);
    render();
    window.scrollTo({ top: 0, behavior: motionOK() ? 'smooth' : 'auto' });
  }

  function render() {
    if (!open) return;
    ctx.editing = false;
    syncDock();
    const p = phase();
    let content;
    if (!o.isSignedIn()) return setMode(false); // session universitaire finie : retour au Hub
    else if (p === 'soon') content = st && (view === 'create' || view === 'jury' || view === 'consent') ? withBack(view === 'jury' ? renderJury(ctx) : view === 'consent' ? renderConsent(ctx) : renderCreate(ctx)) : renderSoon();
    else if (!st) content = renderLocked();
    else if (view === 'collection') content = renderCollection(ctx);
    else if (view === 'create') content = renderCreate(ctx);
    else if (view === 'jury') content = renderJury(ctx);
    else if (view === 'trade') content = renderTrade(ctx);
    else if (view === 'consent') content = renderConsent(ctx);
    else content = renderHome();
    wrap.dataset.v = p === 'soon' ? 'soon' : view;
    wrap.replaceChildren(content);
    // Formulaire commencé à l'écran : la page reste « en saisie » (pas de rafraîchissement qui
    // déplacerait le champ pendant qu'on tape).
    if (ctx.draftForm && wrap.contains(ctx.draftForm)) ctx.editing = true;
    if (motionOK()) content.animate([{ opacity: 0, transform: 'translateY(8px)' }, { opacity: 1, transform: 'none' }], { duration: 260, easing: 'cubic-bezier(.2,.8,.2,1)' });
  }

  // Compteurs (compte à rebours, prochain booster), sans tout redessiner.
  function tick() {
    for (const el of wrap.querySelectorAll('[data-until]')) el.textContent = untilText(el.dataset.until);
    const cd = wrap.querySelector('[data-countdown]');
    if (cd) countdown(cd);
    // Booster prêt : seulement une fois le jeu lancé (avant, le formulaire « Propose ta carte » est
    // sur l'accueil), et jamais pendant une saisie ou une feuille ouverte : la page attend.
    if (phase() === 'live' && st?.me && !st.me.boosterReady && Date.now() >= new Date(st.me.nextBooster).getTime()) {
      st.me.boosterReady = true; // le serveur confirmera à l'ouverture
      syncHeader();
      if (view === 'home' && !ctx.editing && !sheetOpen()) render();
    }
  }

  // ---------------------------------------------------------------- page d'attente
  function launchWave() {
    return (data()?.waves ?? []).find((w) => !w.printed) ?? null;
  }

  function countdown(el) {
    const target = new Date(el.dataset.countdown).getTime();
    let s = Math.max(0, Math.floor((target - Date.now()) / 1000));
    const parts = { d: Math.floor(s / 86400), h: Math.floor((s % 86400) / 3600), m: Math.floor((s % 3600) / 60), s: s % 60 };
    for (const [k, v] of Object.entries(parts)) {
      const b = el.querySelector(`[data-u="${k}"]`);
      if (b) b.textContent = String(v).padStart(2, '0');
    }
    if (s === 0 && !el.dataset.done) {
      el.dataset.done = '1';
      setTimeout(() => refresh(), 4000);
    }
  }

  function mysteryFan() {
    const fan = h('div.tsoon-fan');
    ['Ta carte ici', 'Le néon du couloir', 'Le café de 10 h'].forEach((t, i) => {
      const el = cardEl({ id: `soon${i}`, title: t, cat: ['meme', 'lieu', 'moment'][i], desc: '' }, { size: 'md', mystery: true, back: true });
      el.classList.add(`sf-${i}`);
      fan.append(el);
    });
    return fan;
  }

  function lockedPack(label) {
    const p = h(
      'div.pack.is-locked',
      {},
      h(
        'div.pack-tilt',
        {},
        h(
          'div.pack-body',
          {},
          h('span.pack-foil'),
          h('div.pack-cap', {}, h('span.pack-teeth')),
          h('div.pack-top', {}, mark('pack-mark'), h('span.pack-brand', {}, 'ISIS', h('b', { text: 'TCG' }))),
          h('div.pack-window', {}, h('img', { alt: '', draggable: false, src: placeholderArt('booster-isis') })),
          h('div.pack-meta', {}, h('span.pack-season', { text: data()?.season ?? 'Saison 1' }), h('span.pack-n', { text: `${st?.me?.boosterSize ?? 4} cartes` })),
          h('span.pack-sheen'),
        ),
      ),
      h('span.pack-shadow'),
    );
    if (label) p.append(h('span.pack-lock', {}, ic('lock', 'ic'), h('span', { text: label })));
    return p;
  }

  /** Avant le lancement (pas de dock) : retour à la page d'attente. */
  // Page d'attente : accès à « Mes apparitions » et, pour l'administrateur, aux mails d'accord.
  function consentCtas() {
    const n = pendingAppear(st).length;
    const b = [];
    if (st) b.push(tbtn(n ? `Mes apparitions · ${plural(n, 'carte')} à valider` : 'Mes apparitions', 'person', n ? 'tbtn--primary tbtn--lg' : 'tbtn--ghost tbtn--lg', () => go('consent')));
    if (st?.me?.admin) b.push(tbtn(`Mails d’accord · ${mailingSub()}`, 'send', 'tbtn--ghost tbtn--sm', () => openMailing(ctx)));
    return b.length ? h('div.tsoon-ctas.tsoon-ctas--more', {}, ...b) : null;
  }

  function mailingSub() {
    if (!mailing) return 'qui prévenir, et quand';
    const n = mailing.targets.length;
    if (!n) return 'personne à prévenir';
    return `${plural(n, 'personne')} à prévenir`;
  }

  function withBack(content) {
    const back = tbtn('Page d’attente', 'back', 'tbtn--ghost tbtn--sm tsoon-back', () => go('home'));
    return h('div', {}, back, content);
  }

  function renderSoon() {
    const d = data();
    const w = launchWave();
    const rel = w?.releaseAt;
    const relDay = rel ? dayLong(rel) : 'bientôt';
    const unit = (k, label) => h('span.tsoon-u', {}, h('b', { data: { u: k }, text: '00' }), h('small', { text: label }));
    const count = h('div.tsoon-count', { attrs: { role: 'timer', 'aria-label': rel ? `Lancement le ${relDay} à ${hourText(rel)}` : 'Lancement bientôt' } }, unit('d', 'jours'), unit('h', 'heures'), unit('m', 'min'), unit('s', 's'));
    if (rel) {
      count.dataset.countdown = rel;
      countdown(count);
    }
    // Jury de lancement ouvert : c'est l'action du moment.
    const juryOpen = w?.juryFrom && Date.now() >= new Date(w.juryFrom) && Date.now() < new Date(w.juryUntil);
    const juryCta = juryOpen ? tbtn('Vote pour tes cartes préférées', 'jury', 'tbtn--primary tbtn--xl', async () => (st || (await join())) && go('jury')) : null;
    const propose = tbtn('Proposer une carte', 'pen', juryCta ? 'tbtn--ghost tbtn--lg' : 'tbtn--primary tbtn--xl', () => $('#tsoon-form', wrap)?.scrollIntoView({ behavior: motionOK() ? 'smooth' : 'auto', block: 'start' }));
    // Administration, avant l'ouverture du jury : essayer les duels (rien n'est enregistré).
    const tryDuels = !juryCta && st?.me?.admin ? tbtn('Essayer « Tu préfères ? »', 'jury', 'tbtn--ghost tbtn--lg', () => go('jury')) : null;
    // Administration : essayer l'ouverture (booster du jour, booster bonus, répliques) avant le lancement.
    const tryOpen = st?.me?.admin ? h('div.tsoon-ctas.tsoon-ctas--more', {}, tbtn('Essayer un booster', 'booster', 'tbtn--ghost tbtn--sm', () => tryBooster('')), tbtn('Essayer un booster bonus', 'gift', 'tbtn--ghost tbtn--sm', () => tryBooster('pack'))) : null;
    const how = tbtn('Comment ça marche', 'info', 'tbtn--ghost tbtn--lg', () => $('#tsoon-steps', wrap)?.scrollIntoView({ behavior: motionOK() ? 'smooth' : 'auto', block: 'start' }));
    const hero = h(
      'div.tsoon-hero',
      {},
      h(
        'div.tsoon-intro',
        {},
        h('p.tk.tsoon-kick', {}, h('span.tsoon-live'), 'Bientôt · TCG de la promo'),
        h('h1.tsoon-h1', { tabIndex: -1 }, 'Le TCG arrive le ', h('em', { text: relDay }), '.'),
        h('p.tsoon-lead', { text: 'Deux boosters par jour, des cartes rares, des échanges en face à face. Et toutes les cartes viennent de vous : propose les tiennes dès maintenant, les plus attendues formeront la première vague.' }),
        count,
        h('div.tsoon-ctas', {}, ...(juryCta ? [juryCta, propose] : [propose, how, tryDuels].filter(Boolean))),
        consentCtas(),
        tryOpen,
      ),
      h('div.tsoon-visual', {}, h('span.th-halo'), mysteryFan(), lockedPack(rel ? dateShort(rel).replace('.', '') : 'Bientôt')),
    );
    const stat = (icon, n, label) => h('div.tsoon-stat', {}, h('span.tp-ic', {}, ic(icon, 'ic')), h('div', {}, h('b', { text: String(n) }), h('span', { text: label })));
    const s = d?.stats ?? {};
    const stats = h('div.tsoon-stats', {}, stat('cards', s.proposed ?? 0, s.proposed > 1 ? 'cartes proposées' : 'carte proposée'), stat('person', s.creators ?? 0, 'créateurs et créatrices'), stat('check', s.accepted ?? 0, 'déjà acceptées'));

    // Calendrier : propositions → jury de lancement → lancement → ensuite.
    const now = Date.now();
    const t = (x) => (x ? new Date(x).getTime() : 0);
    let cur = 3;
    if (w) {
      if (w.juryFrom && now < t(w.juryFrom)) cur = 0;
      else if (w.juryFrom && now < t(w.juryUntil)) cur = 1;
      else if (now < t(w.releaseAt)) cur = w.juryFrom ? 2 : 0;
    }
    const perDay = d?.perDay ?? 3;
    const steps = [
      ['pen', 'Propositions', w?.proposalsUntil ? `Jusqu’au ${dayLong(w.proposalsUntil)}. ${perDay} cartes par jour et par personne.` : `${perDay} cartes par jour et par personne, validées par un admin.`],
      ['jury', 'Jury de lancement', w?.juryFrom ? `Du ${dateShort(w.juryFrom).replace('.', '')} au ${dateShort(w.juryUntil).replace('.', '')} : chaque jour, une série de « Tu préfères ? », les cartes préférées entrent dans le jeu.` : 'Chaque jour, une série de « Tu préfères ? » : les cartes préférées entrent dans le jeu.'],
      ['booster', 'Lancement', rel ? `${relDay.charAt(0).toUpperCase() + relDay.slice(1)}, ${hourText(rel)} : la Vague 1, tes premiers boosters et tes boosters bonus.` : 'La Vague 1, tes premiers boosters et tes boosters bonus.'],
      ['loop', 'Ensuite', 'Une nouvelle vague chaque semaine, avec les cartes proposées entre-temps.'],
    ];
    const ol = h(
      'ol.tsoon-steps',
      { id: 'tsoon-steps' },
      ...steps.map(([icon, title, text], i) => h(`li.tsoon-step${i === cur ? '.is-now' : ''}`, {}, h('span.tsoon-dot', {}, ic(icon, 'ic')), h('div', {}, h('p.tk', { text: `Étape ${i + 1}${i === cur ? ' · en cours' : ''}` }), h('h3', { text: title }), h('p', { text })))),
    );

    // Atelier : proposer une carte (la rareté sera révélée au lancement).
    const form = h('section.tsoon-form', { id: 'tsoon-form' });
    form.append(createForm(ctx, { launch: true, heading: 'h2' }));
    const runs = d?.runs ?? { rare: 25, epique: 10, legendaire: 3, unique: 1 };
    const tiers = h(
      'section.tsoon-rar',
      {},
      h('h2.tco-sec-h', {}, h('span', { text: '5 raretés' }), h('small', { text: 'de la carte que tout le monde aura à celle qui n’existe qu’une fois' })),
      h(
        'div.tsoon-tiers',
        {},
        ...['commune', 'rare', 'epique', 'legendaire', 'unique'].map((r) =>
          h(`div.tsoon-tier.tsoon-tier--${r}`, {}, h(`span.tsoon-sw.tc--${r}`, {}, pips(r, 'tsoon-sw-pips')), h('b', { text: RLABEL[r] }), h('span', { text: r === 'commune' ? 'illimitée' : r === 'unique' ? `${runs.unique === 1 ? '1 seul exemplaire au monde' : plural(runs.unique, 'exemplaire')}` : plural(runs[r], 'exemplaire') })),
        ),
      ),
    );
    const note = h('p.tsoon-note', {}, ic('info'), 'Avant le lancement, le jeu n’enregistre que tes propositions et ton pseudo. Les photos où quelqu’un est reconnaissable demandent son accord.');
    // Classement des créateurs (joueurs inscrits) : avant le lancement, les cartes validées comptent.
    const lb = st ? leaderboard(st.leaders, { onCreate: () => $('#tsoon-form', wrap)?.scrollIntoView({ behavior: motionOK() ? 'smooth' : 'auto', block: 'start' }) }) : null;
    return h('section.tsoon', {}, hero, stats, rewardsPanel(st?.rewards), lb, ol, form, tiers, note);
  }

  // ---------------------------------------------------------------- jeu lancé, sans session
  function renderLocked() {
    const signed = o.isSignedIn();
    const rel = phase() === 'soon' ? launchWave()?.releaseAt : null;
    const btn = signed ? tbtn('Rejoindre la partie', 'arrow', 'tbtn--primary tbtn--xl', () => join().then((ok) => ok && render())) : tbtn('Se connecter', 'lock', 'tbtn--primary tbtn--xl', () => o.onLogin());
    const title = rel ? `Le TCG arrive le ${dayLong(rel)}` : phase() === 'soon' ? 'Le TCG arrive bientôt' : 'Le TCG de la promo est lancé';
    return h(
      'section.th.th--simple',
      {},
      h(
        'div.th-stage',
        {},
        h('h1.th-h1', { tabIndex: -1, text: title }),
        h('div.th-pack', {}, h('span.th-halo'), lockedPack(rel ? dateShort(rel).replace('.', '') : signed ? null : 'Connexion')),
        h(
          'div.th-cta',
          {},
          btn,
          h('p.th-hint', { text: signed ? 'Ton identité est vérifiée par l’université ; le jeu n’en garde qu’une empreinte.' : 'Connecte-toi au Hub pour y accéder : tes cartes, tes propositions et tes votes sont rattachés à ton compte, un seul par étudiant.' }),
        ),
      ),
    );
  }

  // ---------------------------------------------------------------- accueil (booster du jour)
  // Deux boosters par cycle : ●● à ouvrir, ●○ le second arrive, ○○ prochain cycle.
  function cycleDots(me) {
    const per = me.perCycle || 2;
    const left = Math.max(0, per - (me.cycle || 0));
    const dots = h('span.th-cycle', { attrs: { role: 'img', 'aria-label': `${left} booster${left > 1 ? 's' : ''} sur ${per} pour ce cycle` } });
    for (let i = 0; i < per; i++) dots.append(h(`i${i < left ? '.is-on' : ''}`));
    dots.append(h('span', { text: left ? `${left} sur ${per} à ouvrir` : 'Boosters du jour ouverts' }));
    return dots;
  }

  function renderHome() {
    const me = st.me;
    const ready = me.boosterReady;
    const second = (me.cycle || 0) >= 1 && (me.cycle || 0) < (me.perCycle || 2);
    const pack = lockedPack(null);
    pack.className = `pack ${ready ? 'is-ready' : 'is-spent'}`;
    const packBtn = h('button.th-packbtn', { type: 'button', attrs: { 'aria-label': ready ? (second ? 'Ouvrir le second booster' : 'Ouvrir le booster du jour') : 'Revoir mon tirage' } }, pack);
    packBtn.addEventListener('click', ready ? openToday : replay);
    // Second booster pas ouvert avant la fin du cycle : il ne se garde pas.
    const keep = ready && second && me.cycleEnd ? h('p.th-hint', { text: `À ouvrir avant ${dayLong(me.cycleEnd).split(' ')[0]} ${hourText(me.cycleEnd)} : il ne se garde pas au-delà.` }) : null;
    const cta = ready
      ? h('div.th-cta', {}, tbtn(second ? 'Ouvrir le second booster' : 'Ouvrir le booster', 'booster', 'tbtn--primary tbtn--xl', openToday), cycleDots(me), keep)
      : h('div.th-cta', {}, h('p.th-timer', {}, ic('clock'), second ? 'Second booster dans ' : 'Prochain booster dans ', h('b', { data: { until: me.nextBooster }, text: untilText(me.nextBooster) })), cycleDots(me), st.lastDraw?.length ? tbtn('Revoir mon tirage', 'loop', 'tbtn--ghost', replay) : null);
    const title = ready ? (second ? 'Ton second booster' : 'Ton booster du jour') : second ? 'Second booster bientôt' : 'Prochain booster bientôt';
    const stage = h('div.th-stage', {}, h('h1.th-h1', { tabIndex: -1, text: title }), h('div.th-pack', {}, h('span.th-halo'), packBtn), cta);

    // À faire
    const todo = [];
    const item = (kind, icon, title, sub, on) => {
      const b = h(`button.tnext.tnext--${kind}`, { type: 'button' }, h('span.tnext-ic', {}, ic(icon, 'ic')), h('span.tnext-t', {}, h('b', { text: title }), h('span', { text: sub })), ic('chev', 'ic ic--sm tnext-go'));
      b.addEventListener('click', on);
      todo.push(b);
    };
    for (const inv of st.invites) item('trade', 'trade', `${inv.from} t’invite à échanger`, `Code ${inv.code} · expire dans ${untilText(inv.expires)}`, () => joinTradeCode(ctx, inv.code));
    const jury = st.jury;
    const lastBallot = jury?.ballots?.[jury.ballots.length - 1];
    if (jury && lastBallot && !lastBallot.done) item('jury', 'jury', 'Jury de la semaine', `Vote pour tes cartes préférées · une série t’attend, jusqu’à ${dayLong(jury.until).split(' ')[0]} ${hourText(jury.until)}`, () => go('jury'));
    // « Mes apparitions » toujours là : en tête quand une carte attend mon accord.
    const toAnswer = pendingAppear(st);
    const appearSub = toAnswer.length ? `${plural(toAnswer.length, 'carte attend', 'cartes attendent')} ton accord` : (st.appear?.length ? `${plural(st.appear.length, 'carte')} où l’on t’a indiqué` : 'Les cartes où l’on t’indique sur la photo');
    item(toAnswer.length ? 'consent.is-due' : 'consent', 'person', 'Mes apparitions', appearSub, () => go('consent'));
    if (me.admin) item('mail', 'send', 'Mails d’accord', mailingSub(), () => openMailing(ctx));
    if (me.proposalsLeft > 0 && !me.muted) item('create', 'pen', 'Créer une carte', `${plural(me.proposalsLeft, 'proposition possible', 'propositions possibles')} aujourd’hui`, () => go('create'));
    const m = st.matches?.find((x) => x.has.length);
    if (m) item('trade', 'trade', `${m.pseudo} a une carte que tu cherches`, 'Échange en face à face, avec un QR code', () => go('trade'));
    else if (!st.invites.length) {
      const doubles = Object.values(st.owned).filter((s) => s.length > 1).length;
      if (doubles) item('trade', 'trade', `${plural(doubles, 'double')} à échanger`, 'Échange en face à face, avec un QR code', () => go('trade'));
    }
    const below = [];
    const rw = rewardsPanel(st.rewards);
    if (rw) below.push(rw);
    if (todo.length) below.push(h('section.th-todo', {}, h('h2.th-h2', { text: 'À faire' }), h('div.tnext-list', {}, ...todo)));
    below.push(leaderboard(st.leaders, { onCreate: me.proposalsLeft > 0 && !me.muted ? () => go('create') : null }));

    // Dans la promo : défi de la dernière vague et événements.
    const latest = [...st.waves].reverse().find((w) => w.printed);
    const feed = h('section.th-feed', {}, h('h2.th-h2', { text: 'Dans la promo' }));
    if (latest) feed.append(h('div.th-defi', {}, h('span', {}, h('b', { text: `${latest.discovered} / ${latest.total}` }), ` cartes de la Vague ${latest.n} découvertes`), meter(latest.discovered, latest.total, null)));
    const list = h('ul.th-feed-list');
    for (const f of st.feed) {
      const c = f.card;
      const verb = f.kind === 'first' ? 'a découvert en premier' : f.kind === 'trade' ? `a échangé avec ${f.other}` : 'a tiré';
      const li = h(`li.th-fi${c.rarity === 'unique' ? '.is-big' : ''}${f.mine ? '.is-mine' : ''}`, {}, h(`span.th-fi-thumb.tf--${c.rarity}`, {}, h('img', { alt: '', src: c.thumb || placeholderArt(c.id) })), h('p', {}, h('b', { text: f.mine && f.kind !== 'trade' ? 'Toi' : f.player }), ` ${verb} `, h('b', { text: `« ${c.title} »` }), ' ', rchip(c.rarity)), h('span.th-fi-when', { text: ago(f.at) }));
      li.addEventListener('click', () => openCard(c));
      list.append(li);
    }
    if (!st.feed.length) list.append(h('li.th-fi', {}, h('span'), h('p', { text: 'Les cartes rares tirées par la promo apparaîtront ici.' })));
    feed.append(list);
    below.push(feed);
    return h('section.th.th--simple', {}, stage, h('div.th-below', {}, ...below));
  }

  // Cartes différentes de ma collection (répliques comprises : elles la complètent).
  const collected = () => new Set([...Object.keys(st?.owned ?? {}), ...Object.keys(st?.replicas ?? {})]).size;

  async function openToday(e) {
    const btn = e?.currentTarget;
    if (btn) btn.disabled = true;
    try {
      const res = await api.booster();
      setState(res.state);
      showOpening(res.pulls, { kicker: 'Ton tirage du jour' });
    } catch (err) {
      toast(err.message, 'alert');
      refresh();
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  async function openPack(pk, btn) {
    if (btn) btn.disabled = true;
    try {
      const res = await api.openPack(pk.id);
      setState(res.state);
      showOpening(res.pulls, { bonus: true, kicker: 'Ton booster bonus' });
    } catch (err) {
      toast(err.message, 'alert');
      refresh();
      if (btn) btn.disabled = false;
    }
  }

  function showOpening(pulls, { bonus = false, kicker, cardOf = (id) => cards.get(id), trial = false } = {}) {
    openBooster({
      pulls,
      bonus,
      kicker,
      trial,
      season: data()?.season,
      cardOf,
      ownedCount: trial ? () => 0 : collected,
      totalCount: () => (trial ? pulls.length : cards.size),
      onCard: (c, serial, replica) => openCard(c, serial, replica),
      onClose: (toCollection) => (toCollection && !trial ? go('collection') : render()),
    });
  }

  // Administration, avant le lancement : une ouverture d'essai avec les vraies cartes proposées
  // (raretés et numéros inventés, une réplique), sans rien enregistrer.
  async function tryBooster(kind) {
    try {
      const t = await api.tryBooster(kind);
      const local = new Map(t.cards.map((c) => [c.id, c]));
      showOpening(t.pulls, { bonus: t.pack, kicker: 'Essai · rien n’est enregistré', cardOf: (id) => local.get(id), trial: true });
    } catch (err) {
      toast(err.message, 'alert');
    }
  }

  function replay() {
    if (!st.lastDraw?.length) return;
    showRecap({ pulls: st.lastDraw, cardOf: (id) => cards.get(id), ownedCount: collected, totalCount: () => cards.size, onCard: (c, s, replica) => openCard(c, s, replica), onClose: (toCollection) => toCollection && go('collection') });
  }

  // ---------------------------------------------------------------- récompenses de lancement
  const placeTxt = (n) => (n === 1 ? '1er' : `${n}e`);
  /**
   * Ce que j'ai gagné au lancement, et pourquoi : chaque soir du jury où j'étais classé (à
   * minuit), et ma participation. Avant la sortie : à ce jour. Après : les boosters à ouvrir.
   */
  function rewardsPanel(rw) {
    if (!rw || (!rw.participant && !rw.nights?.length && !rw.packs?.length)) {
      if (!rw?.preview) return null;
      return h('section.trw', {}, h('div.trw-head', {}, h('div', {}, h('h2', { text: 'Récompenses de lancement' }), h('p', { text: 'Chaque soir de jury, à minuit, le classement des créateurs compte : 1er → booster bonus de 5 cartes, 2e → 4, 3e → 3, du 4e au 13e → 1. Et un booster de 4 cartes pour chaque participant (une carte validée ou une série du jury). Tu les ouvriras le jour du lancement.' }))), h('p.trw-note', { text: 'Rien pour l’instant : propose une carte ou joue une série du jury pour participer.' }));
    }
    const live = !rw.preview;
    const left = live && rw.until ? Math.max(0, new Date(rw.until) - Date.now()) : 0;
    const open = (rw.packs ?? []).filter((p) => !p.opened && new Date(p.until) > Date.now());
    const head = h(
      'div.trw-head',
      {},
      h(
        'div',
        {},
        h('h2', { text: live ? 'Tes boosters bonus de lancement' : 'Tes récompenses de lancement, à ce jour' }),
        h('p', { text: live ? `${plural(rw.cards, 'carte bonus', 'cartes bonus')}, en plus de tes deux boosters du jour, au même taux de tirage.` : `${plural(rw.cards, 'carte bonus', 'cartes bonus')} gagnées jusqu’ici, à ouvrir le jour du lancement.` }),
      ),
      live && open.length && left ? h('span.trw-left', {}, 'Encore ', h('b', { data: { until: rw.until }, text: untilText(rw.until) })) : null,
    );
    const sec = h('section.trw', { attrs: { 'aria-label': 'Récompenses de lancement' } }, head);
    if (live && rw.packs?.length) {
      const row = h('div.trw-packs', { attrs: { role: 'list' } });
      for (const pk of rw.packs) {
        const gone = Boolean(pk.opened) || new Date(pk.until) <= Date.now();
        const why = pk.kind === 'all' ? 'Participation' : `${placeTxt(pk.rank)} · ${dateShort(pk.day + 'T12:00:00').replace('.', '')}`;
        const b = h('button.trw-pack', { type: 'button', disabled: gone, attrs: { role: 'listitem', 'aria-label': `Booster bonus de ${plural(pk.size, 'carte')}, ${why}${pk.opened ? ', ouvert' : gone ? ', expiré' : ''}` } }, packEl({ size: pk.size, bonus: true, big: false, mini: true }), h('b', { text: pk.opened ? 'Ouvert' : gone ? 'Expiré' : `+${plural(pk.size, 'carte')}` }), h('small', { text: why }));
        if (!gone) b.addEventListener('click', () => openPack(pk, b));
        row.append(b);
      }
      sec.append(row);
    }
    const why = h('ul.trw-why');
    if (rw.participant) why.append(h('li', {}, h('span.trw-rank', {}, ic('check', 'ic ic--xs')), h('span', {}, h('b', { text: 'Participation' }), ' au lancement'), h('span.trw-n', { text: `+${allPackSizeOf(rw)}` })));
    for (const n of rw.nights ?? []) why.append(h('li', {}, h('span.trw-rank', { text: placeTxt(n.rank) }), h('span', {}, 'Soir du ', h('b', { text: dayLong(n.day + 'T12:00:00') }), ' (classement à minuit)'), h('span.trw-n', { text: `+${n.size}` })));
    sec.append(why);
    const counted = rw.maxNights ? ` Seuls tes ${rw.maxNights} meilleurs soirs comptent.` : '';
    sec.append(h('p.trw-note', { text: live ? `Valables jusqu’au ${dayLong(rw.until)} à ${hourText(rw.until)}, puis ils expirent.${counted}` : `Chaque soir de jury, à minuit : 1er → 5 cartes, 2e → 4, 3e → 3, du 4e au 13e → 1 ; et 4 cartes pour chaque participant.${counted} Le classement ne montre que des places, jamais de score.` }));
    if (live && open.length) sec.append(h('div.trw-acts', {}, tbtn(open.length > 1 ? `Ouvrir un booster bonus (${open.length})` : 'Ouvrir le booster bonus', 'gift', 'tbtn--primary', (e) => openPack(open[0], e.currentTarget))));
    return sec;
  }
  const allPackSizeOf = (rw) => (rw.packs ?? []).find((p) => p.kind === 'all')?.size ?? 4;

  // ---------------------------------------------------------------- fiche d'une carte
  function openCard(card, serial, replicaView) {
    const mine = st?.owned?.[card.id] ?? [];
    const replicas = st?.replicas?.[card.id] ?? 0;
    const ser = serial || mine.find((x) => x > 0) || 0;
    const asReplica = Boolean(replicaView || (!mine.length && replicas));
    const c = cards.get(card.id) ?? card;
    const el = cardEl(c, { size: 'xl', serial: ser, live: true, replica: asReplica });
    const dl = h('dl.tdet-dl');
    const row = (dt, dd) => dl.append(h('dt', { text: dt }), h('dd', {}, dd));
    row('Rareté', asReplica ? h('span', {}, rchip(c.rarity), ' ', h('span.trchip.trchip--replica', {}, ic('replica', 'ic ic--xs'), h('span', { text: REPLICA }))) : rchip(c.rarity));
    if (c.run > 0) row('Tirage', `${plural(c.run, 'exemplaire numéroté', 'exemplaires numérotés')}${ser && !asReplica ? ` · le tien : n° ${ser}` : ''}${c.issued >= c.run ? ' · tous tirés' : ''}`);
    else row('Tirage', 'Illimité');
    row('Proposée par', c.author || '—');
    if (c.firstBy) row('Tirée en premier par', c.firstBy);
    const w = (data()?.waves ?? []).find((x) => x.n === c.wave);
    row('Vague', `Vague ${c.wave}${w?.releaseAt ? ` · ${dateShort(w.releaseAt)}` : ''} · n° ${String(c.no).padStart(3, '0')}`);
    const inColl = [mine.length ? plural(mine.length, 'exemplaire') : '', replicas ? plural(replicas, 'réplique') : ''].filter(Boolean).join(' · ');
    row('Dans ta collection', inColl || 'Pas encore');
    const acts = h('div.tdet-acts');
    if (!mine.length && st) {
      const wished = st.wish.includes(c.id);
      const wishBtn = tbtn(wished ? 'Retirer de « Je cherche »' : 'Je la cherche', 'heart', 'tbtn--sm', async () => {
        try {
          await api.wish(c.id, !wished);
          await loadState();
          s.close();
          if (open) render();
          toast(wished ? 'Retirée de ta liste.' : 'Ajoutée à « Je cherche » : elle servira à te proposer des échanges.', 'check');
        } catch (err) {
          toast(err.message, 'alert');
        }
      });
      acts.append(wishBtn);
    }
    if (st && !c.mine && !c.removed) acts.append(tbtn('Signaler', 'flag', 'tbtn--ghost tbtn--sm', () => reportSheet(c)));
    const replicaNote = asReplica ? h('p.tdet-replica', {}, ic('replica', 'ic ic--sm'), h('span', { text: `${REPLICA} : ${c.run === 1 ? 'l’exemplaire unique' : `les ${c.run} exemplaires numérotés`} étaient déjà tirés. Elle complète ta collection mais ne s’échange pas ; « Je la cherche » reste possible pour un vrai exemplaire.` })) : null;
    const info = h('div.tdet-info', {}, h('p.tk', { text: CATS[c.cat] ?? '' }), h('h2.tdet-h', { text: c.title }), c.desc ? h('p.tdet-desc', { text: c.desc }) : null, dl, replicaNote, acts);
    const s = sheet('detail', c.title, h(`div.tdet.tdet--${c.rarity}`, {}, h('div.tdet-stage', {}, h('span.tdet-glow'), el), info));
    return s;
  }

  function reportSheet(c) {
    const reasons = { moque: 'Se moque de quelqu’un', reconnaissable: 'Personne reconnaissable sans accord', prive: 'Données privées', choquant: 'Contenu choquant', pasdrole: 'Pas drôle', autre: 'Autre' };
    let pick = '';
    const chips = h('div.tchips', { attrs: { role: 'radiogroup', 'aria-label': 'Motif' } });
    for (const [k, label] of Object.entries(reasons)) {
      const b = h('button.tchip', { type: 'button', attrs: { role: 'radio', 'aria-checked': 'false' }, text: label });
      b.addEventListener('click', () => {
        pick = k;
        for (const x of chips.children) {
          x.classList.toggle('is-on', x === b);
          x.setAttribute('aria-checked', String(x === b));
        }
        send.disabled = false;
      });
      chips.append(b);
    }
    const send = tbtn('Envoyer le signalement', 'flag', 'tbtn--primary');
    send.disabled = true;
    const s = sheet('ghost', 'Signaler une carte', h('div.twel', {}, h('p.tk', { text: 'Signaler' }), h('h2.twel-h', { text: `« ${c.title} »` }), h('p.thelp', { text: 'Un administrateur regarde chaque signalement. La carte peut être retirée du jeu ; ceux qui l’ont gardent leur exemplaire. Ton nom n’est pas transmis à l’auteur.' }), chips, send));
    send.addEventListener('click', async () => {
      send.disabled = true;
      try {
        await api.report(c.id, pick);
        s.close();
        toast('Merci, la carte est signalée à l’administration.', 'check');
      } catch (err) {
        toast(err.message, 'alert');
        send.disabled = false;
      }
    });
  }

  // ---------------------------------------------------------------- contexte des vues
  const ctx = {
    get st() {
      return st;
    },
    get pub() {
      return data();
    },
    get phase() {
      return phase();
    },
    cards,
    card: (id) => cards.get(id),
    owned: (id) => st?.owned?.[id] ?? [],
    replicas: (id) => st?.replicas?.[id] ?? 0,
    ownedCount: () => collected(),
    go,
    render,
    refresh: () => refresh({ quiet: false }),
    reload: async () => {
      await loadState();
      render();
    },
    join,
    openCard,
    userName: () => o.userName(),
    userEmail: () => o.userEmail?.() ?? '',
    // Liste « Qui est sur la photo ? » : annuaire et destinataires récents de ma messagerie.
    searchContacts: (q) => o.searchContacts(q, 12),
    recentPeople: () => o.recentRecipients(),
    sendMail: (msg) => o.sendMail(msg),
    adminSession: () => o.adminSession(),
    setMailing: (m) => {
      mailing = m;
    },
    defaultPseudo: () => defaultPseudo(o.userName()),
    proposalsList,
    wrap,
  };

  // ---------------------------------------------------------------- liens (#tcg, #echange=K7Q2)
  function handleHash() {
    const m = location.hash.match(/^#echange=([A-Za-z0-9]{4})$/);
    if (!m && location.hash !== '#tcg' && location.hash !== '#tcg/accord') return false;
    if (!o.isSignedIn()) {
      // Lien du jeu sans connexion : d'abord la connexion (le lien est gardé pour après). Si
      // l'étudiant choisit de continuer sans se connecter, on n'insiste pas.
      if (askedLogin) {
        history.replaceState(null, '', location.pathname + location.search);
        return false;
      }
      requireLogin(location.hash);
      return true;
    }
    if (m) {
      pendingCode = m[1].toUpperCase();
      history.replaceState(null, '', location.pathname + location.search);
      enter('trade');
      return true;
    }
    if (location.hash === '#tcg' || location.hash === '#tcg/accord') {
      const consent = location.hash === '#tcg/accord';
      history.replaceState(null, '', location.pathname + location.search);
      enter(consent ? 'consent' : undefined);
      return true;
    }
    return false;
  }

  const publicReady = loadPublic();
  document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && (open ? refresh() : loadPublic()));

  return {
    enter,
    /** Adresse de la messagerie connue (lue après l'ouverture du jeu) : rattachement au joueur. */
    mailReady: () => linkMail(),
    leave: () => setMode(false),
    isOpen: () => open,
    /** Vue publique chargée (pour savoir si le TCG est ouvert), 3 s au plus. */
    whenReady: () => Promise.race([publicReady, new Promise((r) => setTimeout(r, 3000))]),
    /** A rejoint le jeu sur cet appareil (session de jeu) ? */
    joined: () => Boolean(st),
    /**
     * Quitter le jeu (Transparence) : collection, votes, propositions non imprimées et pseudo
     * effacés du serveur ; les cartes déjà imprimées restent en jeu, sans nom d'auteur.
     */
    async leaveGame() {
      if (!st) await loadState().catch(() => null);
      if (!st) return false;
      await api.leave();
      setState(null);
      prefs.set('tcgJoined', null);
      markSeen('tcg', false);
      if (open) setMode(false);
      return true;
    },
    /** Le TCG est-il ouvert aux étudiants (bascule visible) ? */
    visible: () => phase() !== 'off',
    handleHash,
    refreshPublic: loadPublic,
    openJoin: () => openJoinSheet(ctx),
    startTrade: () => startTrade(ctx),
    /** Déconnexion du Hub : la session de jeu de cet appareil est oubliée aussi. */
    async signedOut() {
      ctx.draftForm = null; // brouillon (photo comprise) oublié à la déconnexion
      if (st) await api.logout().catch(() => {});
      setState(null);
      prefs.set('tcgJoined', null);
      if (open) render();
    },
    /** Connexion au Hub : reconnexion silencieuse au jeu si l'étudiant y joue déjà. */
    signedIn() {
      if (open) load().then(render);
    },
  };
}
