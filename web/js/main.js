// ISIS Hub : démarrage et enchaînement des écrans (connexion → classe → tableau de bord).

import { $, $$, toast } from './core/dom.js';
import * as D from './core/dates.js';
import { prefs } from './core/store.js';
import { openVault } from './net/vault.js';
import { initCache, clearCache } from './net/cache.js';
import { http, jar, ready } from './net/engine.js';
import { useTransport } from './net/http.js';
import { loadClasses, classOf, isComplete, choiceLabel } from './portals/classes.js';
import { casLogin, casLogout, hasCasSession, adminTicket } from './portals/cas.js';
import * as moodle from './portals/moodle.js';
import * as mail from './portals/mail.js';
import { createMatcher } from './portals/match.js';
import { createLogin } from './ui/login.js';
import { createPromo } from './ui/promo.js';
import { createSchedule } from './ui/schedule.js';
import { createMails } from './ui/mails.js';
import { createMoodle } from './ui/moodle.js';
import { setupMenus, setupBento, setupIcal, anyMenuOpen, closeMenus, modal } from './ui/layout.js';
import { createComposer } from './ui/composer.js';
import { createCourseSheet } from './ui/course.js';
import { createCrousSheet, menus as crousMenus } from './ui/crous.js';
import { setupMailRules } from './ui/mailrules.js';
import { setupInstall } from './ui/install.js';
import { countVisit } from './core/stats.js';
import { initMailPrefs, resetMailPrefs } from './core/mailprefs.js';
import { setupFeedback } from './ui/feedback.js';
import { fetchContent, renderLinks } from './ui/content.js';
import { setupTransparency, versionLabel } from './ui/transparency.js';
import { startTour, tourActive } from './ui/tour.js';

if (window.top !== window.self) throw new Error('ISIS Hub refuse de s’afficher dans un cadre.');

const app = $('.app');
useTransport(http);

await loadClasses();
const savedPromo = prefs.get('promo');
const savedChoice = prefs.get('choice', {}) ?? {};
const state = {
  // Une classe n'est retenue que si ses choix (groupe, parcours, langue) sont complets.
  promo: classOf(savedPromo) && isComplete(savedPromo, savedChoice) ? savedPromo : null,
  choice: savedChoice,
  signedIn: false,
  user: null, // { name, email, login } lu dans la messagerie, en mémoire seulement
  username: '',
  screen: 'boot',
};

const vault = await openVault();
jar.replace(await vault.load());
jar.onchange = () => vault.save(jar.toJSON());
state.signedIn = hasCasSession(jar);
// Cache des portails (Moodle par matière…), chiffré comme la session ; vide sans session.
initCache(state.signedIn ? await vault.loadCache() : {}, (entries) => vault.saveCache(entries));
// Étiquettes et règles des mails : chiffrées sur l'appareil.
await initMailPrefs(vault);

// Le moteur TLS (1,4 Mo) se charge dès maintenant, pendant que l'écran s'affiche.
ready().catch(() => {});

// ------------------------------------------------------------------ écrans

function show(screen) {
  state.screen = screen;
  for (const el of $$('[data-screen]')) el.hidden = el.dataset.screen !== screen;
  app.dataset.page = screen;
  if (screen === 'login') login.show();
  else login.hide();
  window.scrollTo(0, 0);
}

const matcher = createMatcher({ search: (q) => moodle.searchCourses(q), enabled: () => state.signedIn });

const login = createLogin({
  async onSubmit(username, password, remember) {
    vault.choose(remember);
    await casLogin(jar, username, password);
    await vault.save(jar.toJSON());
    state.signedIn = true;
    state.username = username;
    if (wantsAdmin) return openAdmin();
    if (!state.promo) {
      const user = await loadUser().catch(() => null);
      promo.show({ mode: 'first', current: guessPromo(), choice: state.choice, firstName: firstName(user?.name) });
      show('promo');
    } else enterDashboard();
  },
  onSkip() {
    if (state.promo) enterDashboard();
    else {
      promo.show({ mode: 'guest', current: guessPromo(), choice: state.choice });
      show('promo');
    }
  },
  onTransparency: () => transparency.open(),
});

const promo = createPromo({
  onChosen(chosen, choice) {
    const changed = chosen !== state.promo || JSON.stringify(choice) !== JSON.stringify(state.choice);
    state.promo = chosen;
    state.choice = choice;
    prefs.set('promo', chosen);
    prefs.set('choice', choice);
    enterDashboard(changed);
  },
});

// ------------------------------------------------------------- utilisateur

function firstName(name = '') {
  // BlueMind donne « Prénom NOM » ou « NOM Prénom » : on garde le mot qui n'est pas en capitales.
  const words = name.split(/\s+/).filter(Boolean);
  return words.find((w) => /\p{Ll}/u.test(w)) ?? words[0] ?? '';
}
const initials = (name = '') =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join('') || '?';
const guessPromo = () => state.promo ?? (classOf(savedPromo) ? savedPromo : 'FIA4');

async function loadUser() {
  state.user ??= await mail.connect();
  return state.user;
}

function renderHeader() {
  app.dataset.auth = state.signedIn ? 'in' : 'out';
  const today = D.todayKey();
  $('[data-today-day]').textContent = D.dayTitle(today);
  $('[data-today-week]').textContent = `· semaine ${D.isoWeek(today)}`;
  const detail = state.promo ? choiceLabel(state.promo, state.choice) : '';
  $$('[data-class-chip]').forEach((el) => (el.textContent = state.promo ?? ''));
  $$('[data-class-label]').forEach((el) => (el.textContent = [state.promo, detail].filter(Boolean).join(' · ')));
  const name = state.user?.name || state.username || 'Mon compte';
  $('[data-user-name]').textContent = name;
  $('[data-user-id]').textContent = state.user?.email || state.username || 'connecté';
  $('[data-avatar]').textContent = initials(state.user?.name || state.username);
  $('[data-avatar-btn]').setAttribute('aria-label', `Compte de ${name}`);
}

// ------------------------------------------------------------ tableau de bord

let schedule;
let mails;
let courses;
let composer;
let courseSheet;
let dashboardReady = false;
let install;
let bento;

function setupDashboard() {
  if (dashboardReady) return;
  dashboardReady = true;
  schedule = createSchedule({
    app,
    matcher,
    onOpen: (ev) => courseSheet.open(ev),
    onLunch: (day) => crousSheet.open(day),
    onData: () => {
      // Les séances à venir servent aussi à Moodle (cours mis en avant).
      if (state.signedIn) matcher.resolve(schedule.upcoming(new Date(), 21), () => courses.refresh());
      courses?.refresh();
    },
  });
  composer = createComposer({ app, onSessionLost: sessionLost });
  mails = createMails({ app, onSessionLost: sessionLost, onLogin: openLogin, onReply: (kind, m, text) => composer.respond(kind, m, text) });
  courseSheet = createCourseSheet({
    schedule,
    matcher,
    isSignedIn: () => state.signedIn,
    promo: () => state.promo,
    onWrite: ({ name, subject }) => composer.open({ subject, body: 'Bonjour,\n\n', focusRecipient: name }),
    onEvalChange: () => schedule.rerender(),
  });
  const crousSheet = createCrousSheet();
  // Menus du Resto U' : dès qu'ils sont connus, les blocs du midi indiquent s'il y a un menu.
  crousMenus().then((m) => m && schedule.rerender());
  setupMailRules({ onRuleAdded: () => mails.applyRulesNow() });
  install = setupInstall();
  $$('[data-compose]').forEach((b) => b.addEventListener('click', () => composer.open()));
  courses = createMoodle({ matcher, schedule, onSessionLost: sessionLost, onLogin: openLogin });
  setupMenus();
  bento = setupBento();
  fetchContent().then((content) => {
    renderLinks(content);
    bento.refresh();
  });
  setupIcal(() => ({ promo: state.promo, choice: state.choice }));
  $$('[data-login-open]').forEach((b) => b.addEventListener('click', openLogin));
  $$('[data-change-class]').forEach((b) =>
    b.addEventListener('click', () => {
      closeMenus();
      promo.show({ mode: 'change', current: state.promo, choice: state.choice });
      show('promo');
    }),
  );
  $$('[data-logout]').forEach((b) => b.addEventListener('click', logout));
  $$('[data-start-tour]').forEach((b) => b.addEventListener('click', () => startTour(app)));
  // Minuit passé : la date de l'en-tête suit.
  setInterval(renderHeader, 60_000);
}

async function enterDashboard(promoChanged = true) {
  setupDashboard();
  renderHeader();
  show('dash');
  requestAnimationFrame(() => bento.syncDock()); // onglet du bas : la tuile en haut de l'écran
  setTimeout(() => bento.syncDock(), 300);
  countVisit();
  if (promoChanged || !schedule.started) {
    schedule.started = true;
    schedule.start(state.promo, state.choice);
  }
  if (state.signedIn) {
    loadUser()
      .then(renderHeader)
      .catch(() => {});
    mails.load();
    courses.load();
    if (!prefs.get('tourDone')) setTimeout(() => !document.querySelector('dialog[open]') && state.screen === 'dash' && startTour(app), 1200);
    install.maybeOffer(); // après la visite guidée : installer l'application sur le téléphone
  } else {
    mails.showSignedOut(false);
    courses.showSignedOut(false);
  }
}

function openLogin() {
  closeMenus();
  show('login');
}

/** Un portail n'accepte plus la session : on repasse en mode déconnecté, sans rien perdre d'autre. */
let lostOnce = false;
function sessionLost() {
  if (lostOnce) return;
  lostOnce = true;
  state.signedIn = false;
  state.user = null;
  jar.clear();
  vault.clear();
  clearCache();
  moodle.reset();
  mail.reset();
  matcher.clear();
  schedule.rerender();
  renderHeader();
  mails.showSignedOut(true);
  courses.showSignedOut(true);
  toast('Ta session universitaire a expiré : reconnecte-toi pour retrouver mails et Moodle.');
  setTimeout(() => (lostOnce = false), 2000);
}

async function logout() {
  closeMenus();
  mails.close();
  try {
    await casLogout(jar);
  } catch {
    jar.clear(); // le CAS injoignable n'empêche pas d'oublier la session ici
  }
  vault.clear();
  vault.forgetMailPrefs(); // se déconnecter efface aussi étiquettes et règles de cet appareil
  resetMailPrefs();
  clearCache();
  moodle.reset();
  mail.reset();
  matcher.clear();
  schedule?.rerender();
  state.signedIn = false;
  state.user = null;
  state.username = '';
  renderHeader();
  mails.showSignedOut(false);
  courses.showSignedOut(false);
  show('login');
}

// ------------------------------------------------------------ Transparence

const transparency = setupTransparency({ sessionPlace: () => vault.place });
let versionText = '';
setupFeedback({
  username: () => (state.signedIn ? state.username || state.user?.email?.split('@')[0] || '' : ''),
  version: () => versionText,
});
$$('[data-open-transparence]').forEach((b) => b.addEventListener('click', () => transparency.open()));
versionLabel().then((label) => {
  versionText = label;
  login.setVersion(label);
});

// Échap ferme le calque le plus haut.
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (anyMenuOpen()) return closeMenus();
  if (document.querySelector('dialog[open]') || tourActive()) return; // géré par « cancel » du dialog
  if (composer?.isOpen()) return; // géré par le compositeur
  if (mails?.isOpen()) return mails.close();
  if (schedule?.isExpanded()) schedule.collapse();
});

window.addEventListener('unhandledrejection', (e) => {
  console.warn(e.reason);
});

// ------------------------------------------------------------ administration

// « /admin » sans session renvoie ici avec « #admin ». Seul l'étudiant connecté qui l'a demandé
// envoie au serveur un ticket CAS (pour l'ENT) ; le serveur le fait valider par l'université et
// n'ouvre l'administration qu'aux identifiants de ADMIN_USERS. Pour tous les autres, rien ne se
// passe : la page d'administration n'existe pas.
let wantsAdmin = location.hash === '#admin';
if (wantsAdmin) history.replaceState(null, '', location.pathname + location.search);

async function openAdmin() {
  wantsAdmin = false;
  try {
    const ticket = await adminTicket();
    const res = await fetch('api/admin/cas', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Hub-Admin': '1' },
      body: JSON.stringify({ ticket }),
      credentials: 'same-origin',
      cache: 'no-store',
    });
    if (res.ok) return location.assign('admin');
  } catch {
    // ticket indisponible ou refusé : on reste sur l'accueil, sans message
  }
  if (state.promo) enterDashboard();
  else {
    promo.show({ mode: state.signedIn ? 'first' : 'guest', current: guessPromo(), choice: state.choice });
    show('promo');
  }
}

// ------------------------------------------------------------------ départ

if (wantsAdmin && state.signedIn) openAdmin();
else if (wantsAdmin) show('login'); // l'administrateur se connecte d'abord, puis la suite se fait seule
else if (state.signedIn && !state.promo) {
  promo.show({ mode: 'first', current: guessPromo(), choice: state.choice });
  show('promo');
} else if (state.promo) enterDashboard();
else if (classOf(savedPromo)) {
  // Classe connue mais choix incomplets (nouvelle option, nouvelle année) : on les redemande.
  promo.show({ mode: 'change', current: savedPromo, choice: savedChoice });
  show('promo');
}
else show('login');
