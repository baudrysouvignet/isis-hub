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
import { setupInfinite } from './ui/infinite.js';
import { createLoginAlerts } from './core/loginalerts.js';
import * as MP from './core/mailprefs.js';
import { createPromo } from './ui/promo.js';
import { createSchedule } from './ui/schedule.js';
import { createMails } from './ui/mails.js';
import { createMoodle } from './ui/moodle.js';
import { createMoodleView } from './ui/moodle-view.js';
import { createDeadlines } from './ui/deadlines.js';
import { setupMenus, setupBento, setupIcal, anyMenuOpen, closeMenus, modal } from './ui/layout.js';
import { createComposer } from './ui/composer.js';
import { createCourseSheet } from './ui/course.js';
import { createCrousSheet, menus as crousMenus } from './ui/crous.js';
import { setupMailRules } from './ui/mailrules.js';
import { setupInstall } from './ui/install.js';
import { setupChangelog } from './ui/changelog.js';
import { seen, whenKnown, adoptLocal, forgetLocal } from './core/seen.js';
import { countVisit } from './core/stats.js';
import { watchUpdates } from './core/update.js';
import { initMailPrefs, resetMailPrefs } from './core/mailprefs.js';
import * as UD from './core/userdata.js';
import { isEval, loadSignals, onSignals, withdrawVotes } from './core/evals.js';
import { onMemosChange } from './core/memos.js';
import { deriveSecret } from './net/sync.js';
import { createNotes } from './ui/notes.js';
import { setupFeedback } from './ui/feedback.js';
import { fetchContent, renderLinks } from './ui/content.js';
import { setupTransparency, versionLabel } from './ui/transparency.js';
import { startTour, tourActive } from './ui/tour.js';
import { createTCG } from './tcg/app.js';
import { isisMatcher } from './tcg/isis.js';

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
// Données personnelles (notes, examens marqués, règles de mails) : chiffrées sur l'appareil, puis
// synchronisées dans la sauvegarde anonyme dès qu'un secret de connexion est connu. Les anciens
// emplacements (avant la sauvegarde) sont repris une fois puis effacés.
await UD.initUserData(vault, {
  evals: prefs.get('evals'),
  mail: await vault.loadMailPrefs(),
  profile: state.signedIn && state.promo ? { promo: state.promo, choice: state.choice } : null,
});
prefs.set('evals', null);
vault.forgetMailPrefs();
initMailPrefs();
vault.loadSync().then((bits) => bits && UD.connect(bits).catch(() => {}));
document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && UD.refresh());

/** Après une connexion par mot de passe : secret de la sauvegarde anonyme, puis lecture du serveur. */
async function startSync(username, password) {
  try {
    const previous = await vault.loadSync();
    const bits = await deriveSecret(username, password);
    await vault.saveSync(bits);
    const same = previous && previous.every((b, i) => b === bits[i]);
    await UD.connect(bits, same ? null : previous);
  } catch {
    // sauvegarde injoignable : la tuile Notes le dit et propose de réessayer
  }
}

/**
 * Profil sauvegardé (classe, groupe, langue, parcours) : appliqué à la connexion, et quand un autre
 * appareil le change. Rend true si la classe affichée a changé.
 */
function applyProfile() {
  const p = UD.get('profile');
  if (!state.signedIn || !p || !classOf(p.promo) || !isComplete(p.promo, p.choice ?? {})) return false;
  const changed = p.promo !== state.promo || JSON.stringify(p.choice ?? {}) !== JSON.stringify(state.choice);
  state.promo = p.promo;
  state.choice = p.choice ?? {};
  prefs.set('promo', state.promo);
  prefs.set('choice', state.choice);
  return changed;
}
const saveProfile = () => state.signedIn && state.promo && UD.set('profile', { promo: state.promo, choice: state.choice });

// Le moteur TLS (1,4 Mo) se charge dès maintenant, pendant que l'écran s'affiche.
ready().catch(() => {});

// ------------------------------------------------------------------ écrans

function show(screen) {
  state.screen = screen;
  for (const el of $$('[data-screen]')) el.hidden = el.dataset.screen !== screen;
  app.dataset.page = screen;
  if (screen === 'login') {
    login.show();
    infinite.loginShown(); // connexion infinie : identifiant + passkey d'abord
  } else login.hide();
  window.scrollTo(0, 0);
}

const matcher = createMatcher({ search: (q) => moodle.searchCourses(q), enabled: () => state.signedIn });

/** Après une connexion acceptée par le CAS (mot de passe tapé, ou connexion infinie). */
async function completeLogin(username, password) {
  await vault.save(jar.toJSON());
  state.signedIn = true;
  state.username = username;
  // Sauvegarde du serveur lue avant d'entrer : classe et notes suivent l'étudiant d'un appareil à l'autre.
  login.step('Récupération de tes données…');
  await Promise.race([startSync(username, password), new Promise((r) => setTimeout(r, 15_000))]);
  const changed = applyProfile();
  if (!changed && state.promo) saveProfile(); // première connexion avec cette version : la classe part sur le serveur
  if (wantsAdmin) return openAdmin();
  if (!state.promo) {
    const user = await loadUser().catch(() => null);
    promo.show({ mode: 'first', current: guessPromo(), choice: state.choice, firstName: firstName(user?.name) });
    show('promo');
  } else enterDashboard(changed || !dashboardReady);
}

/**
 * Connexion infinie (ui/infinite.js) : identifiants rouverts par la passkey, sur un geste de
 * l'étudiant. Refusés par le CAS : le mot de passe a changé, la connexion infinie est effacée.
 */
async function unlockLogin(username, password) {
  vault.keepOnDevice();
  try {
    await casLogin(jar, username, password);
  } catch (err) {
    if (err.name === 'LoginRefused') {
      await infinite.passwordChanged();
      show('login');
      login.show('Ton mot de passe universitaire a changé : la connexion infinie a été effacée. Connecte-toi avec le nouveau, tu pourras la réactiver.');
    }
    throw err;
  }
  await completeLogin(username, password);
}

const infinite = await setupInfinite({ vault, onUnlock: unlockLogin, onShowLogin: () => show('login') });

// Moodle envoie une alerte « Nouvelle connexion » quand ISIS Hub s'y connecte : seule celle de CET
// appareil, dans la minute et demie, est mise à la corbeille (core/loginalerts.js). Réglable.
const loginAlerts = createLoginAlerts();
moodle.onLogin((at) => {
  if (!MP.loginAlertsOn()) return;
  loginAlerts.noteLogin(at);
  mails?.watchLoginAlerts();
});

const login = createLogin({
  async onSubmit(username, password) {
    // Session gardée sur l'appareil (chiffrée) jusqu'à sa fin côté université ou « Se déconnecter ».
    vault.keepOnDevice();
    await casLogin(jar, username, password);
    // Connexion infinie demandée (case cochée, clé créée et vérifiée) : chiffrée maintenant.
    await infinite.afterPasswordLogin(username, password);
    await completeLogin(username, password);
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
    saveProfile(); // connecté : la classe est sauvegardée pour tous ses appareils
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
  $$('[data-tcg-leave]').forEach((b) => (b.hidden = !state.signedIn));
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
let notes;
let dashboardReady = false;
let install;
let changelog;
let bento;
let rendus;
let moodleView;
let tcg;

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
  mails = createMails({
    app,
    loginAlerts,
    onSessionLost: sessionLost,
    onLogin: openLogin,
    onReply: (kind, m, text) => composer.respond(kind, m, text),
    onExpand: () => {
      notes?.close();
      if (schedule.isExpanded()) schedule.collapse();
    },
  });
  notes = createNotes({
    app,
    isSignedIn: () => state.signedIn,
    onLogin: openLogin,
    onRetry: () => vault.loadSync().then((bits) => bits && UD.connect(bits)).catch(() => {}),
    async getExams(codes) {
      // Année universitaire en cours (août → juillet) : les blocs ADE déjà lus sont réutilisés.
      const today = D.todayKey();
      const y = Number(today.slice(0, 4)) - (Number(today.slice(5, 7)) < 8 ? 1 : 0);
      const events = await schedule.between(`${y}-08-25`, `${y + 1}-07-31`);
      const out = {};
      for (const ev of events) {
        const code = (ev.code || '').toUpperCase();
        if (!code || !codes.has(code) || !(ev.exam || isEval(ev))) continue;
        (out[code] ??= []).push(ev.day);
      }
      return out;
    },
    beforeOpen: () => {
      mails.close();
      if (schedule.isExpanded()) schedule.collapse();
    },
  });
  courseSheet = createCourseSheet({
    notes,
    schedule,
    matcher,
    isSignedIn: () => state.signedIn,
    promo: () => state.promo,
    onWrite: ({ name, subject }) => composer.open({ subject, body: 'Bonjour,\n\n', focusRecipient: name }),
    onEvalChange: () => {
      schedule.rerender();
      notes.refreshExams();
    },
  });
  const crousSheet = createCrousSheet();
  // Menus du Resto U' : dès qu'ils sont connus, les blocs du midi indiquent s'il y a un menu.
  crousMenus().then((m) => m && schedule.rerender());
  // Page restée ouverte : menus relus toutes les 15 minutes, et au retour sur l'onglet (5 min au moins).
  let lastCrous = Date.now();
  const refreshCrous = () => {
    if (document.visibilityState !== 'visible') return;
    lastCrous = Date.now();
    crousMenus(true).then((m) => m && schedule.rerender());
  };
  setInterval(refreshCrous, 15 * 60_000);
  document.addEventListener('visibilitychange', () => Date.now() - lastCrous > 5 * 60_000 && refreshCrous());
  setupMailRules({ onRuleAdded: () => mails.applyRulesNow() });
  install = setupInstall();
  // Écran « nouvelle version » : où mène « Accéder » (launch.go.to dans core/changelog.js).
  const launchTargets = { moodle: () => moodleView?.openHome(null), tcg: () => tcg.enter() };
  changelog = setupChangelog({ onLaunch: (to) => launchTargets[to]?.(), canLaunch: (what) => what !== 'tcg' || Boolean(tcg?.visible()) });
  $$('[data-compose]').forEach((b) => b.addEventListener('click', () => composer.open()));
  moodleView = createMoodleView({
    app,
    schedule,
    matcher,
    notes,
    promo: () => state.promo,
    isSignedIn: () => state.signedIn,
    onSessionLost: sessionLost,
    onEnrolled: ({ name, at } = {}) => {
      courses.load();
      // Mail « Bienvenue sur <cours> » de cette inscription : mis à la corbeille en silence (core/loginalerts.js).
      if (name) {
        loginAlerts.noteEnrol(name, at);
        mails?.watchLoginAlerts();
      }
    },
    onWrite: ({ name, subject }) => composer.open({ subject, body: 'Bonjour,\n\n', focusRecipient: name }),
    beforeOpen: () => {
      mails.close();
      notes.close();
      if (schedule.isExpanded()) schedule.collapse();
    },
  });
  courses = createMoodle({ matcher, schedule, onSessionLost: sessionLost, onLogin: openLogin, onCourses: (list) => moodleView.setEnrolled(list) });
  rendus = createDeadlines({ onSessionLost: sessionLost, onLogin: openLogin });
  // TCG de la promo : bascule Hub / TCG de l'en-tête. L'identité de l'étudiant est prouvée par un
  // ticket CAS (pour l'ENT, comme l'administration) que le serveur fait valider par l'université.
  tcg = createTCG({
    app,
    isSignedIn: () => state.signedIn,
    userName: () => state.user?.name || '',
    // Connexion demandée depuis le jeu : on y revient après (« #tcg », lu par enterDashboard).
    onLogin: (hash = '#tcg') => {
      history.replaceState(null, '', `${location.pathname}${location.search}${hash}`);
      openLogin();
    },
    getTicket: adminTicket,
    // Personnes sur la photo : adresse de la messagerie (pour retrouver mes apparitions), envoi des
    // mails d'accord depuis la messagerie de l'administrateur, et sa session d'administration.
    userEmail: () => state.user?.email || '',
    sendMail: (msg) => mail.send(msg),
    searchContacts: (q, n) => mail.searchContacts(q, n),
    recentRecipients: () => mail.recentRecipients(),
    isisMatcher: () => isisMatcher(moodle),
    adminSession: openAdminSession,
    beforeOpen: () => {
      closeMenus();
      mails.close();
      notes.close();
      if (moodleView?.isOpen()) moodleView.close();
      if (schedule.isExpanded()) schedule.collapse();
      // Prénom (nom dans le jeu) et adresse (cartes où l'on m'a indiqué), lus dans la messagerie.
      if (state.signedIn) loadUser().then(() => tcg?.mailReady(), () => {});
    },
  });
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
}

// Premiers pas, une fois par connexion : visite guidée et installation (une seule fois par
// étudiant, tous appareils confondus), sinon « Quoi de neuf ? » après une mise à jour. On attend
// d'avoir lu la sauvegarde : un nouvel appareil ne doit pas tout reproposer.
let welcomed = false;
async function welcome() {
  if (welcomed) return;
  welcomed = true;
  await whenKnown(true);
  if (!state.signedIn || state.screen !== 'dash') return void (welcomed = false);
  adoptLocal();
  const newcomer = !seen('tour');
  if (newcomer) setTimeout(() => !document.querySelector('dialog[open]') && state.screen === 'dash' && startTour(app), 600);
  await tcg?.whenReady(); // la 2.0.0 attend de savoir si le TCG est ouvert
  changelog.maybeShow({ newcomer });
  install.maybeOffer(); // après la visite guidée : installer l'application sur le téléphone
}

async function enterDashboard(promoChanged = true) {
  setupDashboard();
  renderHeader();
  show('dash');
  requestAnimationFrame(() => bento.syncDock()); // onglet du bas : la tuile en haut de l'écran
  setTimeout(() => bento.syncDock(), 300);
  countVisit({ signedIn: state.signedIn, promo: state.promo });
  loadSignals(state.promo, { force: promoChanged }); // examens signalés par la classe
  if (promoChanged || !schedule.started) {
    schedule.started = true;
    schedule.start(state.promo, state.choice);
    notes.load(state.promo, state.choice);
  }
  notes.refresh();
  if (state.signedIn) {
    loadUser()
      .then(renderHeader)
      .catch(() => {});
    mails.load();
    courses.load();
    rendus.load();
    welcome();
  } else {
    mails.showSignedOut(false);
    courses.showSignedOut(false);
    rendus.showSignedOut(false);
  }
  // Lien vers le jeu : « #tcg », ou « #echange=K7Q2 » (QR code d'un échange en face à face).
  if (!tcg.handleHash() && state.signedIn) tcg.signedIn();
  // Adresse de la messagerie : « Mes apparitions » et, pour l'administrateur, mails d'accord.
  if (state.signedIn) loadUser().then(() => tcg.mailReady(), () => {});
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
  tcg?.leave(); // pas connecté = pas de TCG
  jar.clear();
  vault.clear();
  clearCache();
  moodle.reset();
  moodleView?.reset();
  mail.reset();
  matcher.clear();
  schedule.rerender();
  renderHeader();
  mails.showSignedOut(true);
  courses.showSignedOut(true);
  rendus.showSignedOut(true);
  notes?.refresh(); // les notes demandent d'être connecté
  // Connexion infinie : reprise sur place (identifiant + passkey), sans passer par l'écran de connexion.
  if (!infinite.offerResume()) toast('Ta session universitaire a expiré : reconnecte-toi pour retrouver mails et Moodle.');
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
  // Connexion infinie gardée si elle est active : au retour, l'identifiant et la passkey suffisent.
  // Elle s'efface par « Désactiver » (menu du compte, écran de connexion) ou « Supprimer mes données ».
  // Se déconnecter efface de cet appareil les données personnelles (notes, règles, examens marqués)
  // et le secret de la sauvegarde ; la sauvegarde chiffrée reste, retrouvée à la prochaine connexion.
  UD.disconnect({ wipeLocal: true });
  vault.forgetSync();
  forgetLocal();
  prefs.set('feedback', null); // « Mes propositions » : rien ne reste pour la personne suivante
  await tcg?.signedOut(); // session de jeu de cet appareil oubliée (cookie effacé par le serveur)
  tcg?.leave();
  welcomed = false;
  resetMailPrefs();
  notes?.load(state.promo, state.choice);
  clearCache();
  moodle.reset();
  moodleView?.reset();
  mail.reset();
  matcher.clear();
  schedule?.rerender();
  state.signedIn = false;
  state.user = null;
  state.username = '';
  renderHeader();
  mails.showSignedOut(false);
  courses.showSignedOut(false);
  rendus.showSignedOut(false);
  notes?.refresh();
  show('login');
}

// ------------------------------------------------------------ Transparence

const transparency = setupTransparency({ sessionPlace: () => vault.place, syncId: UD.syncId, infinite: () => infinite.enabled() });
// « Quitter le TCG » (Transparence) : les données de jeu de l'étudiant sont effacées du serveur.
$$('[data-tcg-leave]').forEach((b) =>
  b.addEventListener('click', async () => {
    if (!tcg) return;
    if (!confirm('Quitter le TCG ? Ta collection, tes votes, tes propositions pas encore imprimées et ton pseudo sont effacés du serveur. Les cartes déjà imprimées restent dans le jeu, sans ton nom. C’est définitif.')) return;
    try {
      const done = await tcg.leaveGame();
      toast(done ? 'Tu as quitté le TCG : tes données de jeu sont effacées.' : 'Tu n’as pas de compte de jeu sur ce Hub.', 'check');
    } catch (err) {
      toast(`Impossible pour l’instant : ${err.message}`, 'alert');
    }
  }),
);

// « Supprimer mes données sauvegardées » (Transparence) : appareil et sauvegarde anonyme.
$$('[data-erase-data]').forEach((b) =>
  b.addEventListener('click', async () => {
    if (!confirm('Effacer tes notes saisies, séances marquées examen, étiquettes et règles de mails, sur cet appareil et dans la sauvegarde ? C’est définitif.')) return;
    try {
      await withdrawVotes(state.promo); // votes anonymes des séances à venir retirés aussi
      await UD.eraseEverywhere();
      await infinite.disable();
      vault.forgetSync();
      notes?.load(state.promo, state.choice);
      schedule?.rerender();
      toast('Tes données sauvegardées ont été effacées.', 'check');
    } catch (err) {
      toast(`Effacement impossible : ${err.message}`, 'alert');
    }
  }),
);
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
  if (tcg?.isOpen()) return; // feuilles et ouverture du booster : gérées par le TCG
  if (moodleView?.isOpen()) return moodleView.close();
  if (mails?.isOpen()) return mails.close();
  if (notes?.isOpen()) return notes.close();
  if (schedule?.isExpanded()) schedule.collapse();
});

// Examens signalés par la classe : relus au retour sur l'onglet (au plus toutes les 2 minutes).
onSignals(() => schedule?.rerender());
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && state.screen === 'dash') loadSignals(state.promo);
});

// Note de cours écrite ou effacée (ici ou sur un autre appareil) : le repère 📝 suit.
onMemosChange(() => schedule?.rerender());

// Classe changée sur un autre appareil (ou retrouvée dans la sauvegarde) : appliquée ici aussi.
UD.onUserData((touched) => {
  if (!touched.includes('profile') || !applyProfile()) return;
  renderHeader();
  if (state.screen === 'dash') enterDashboard(true);
});

// Nouvelle version publiée : rechargée au retour sur l'onglet si rien n'est en cours, sinon proposée.
watchUpdates({
  busy: () =>
    Boolean(
      composer?.isOpen() ||
        mails?.isOpen() ||
        notes?.isOpen() ||
        moodleView?.isOpen() ||
        document.querySelector('dialog[open]') ||
        document.querySelector('.op, .tsh-layer, .ttb') || // booster en cours d'ouverture, feuille ou table d'échange du TCG
        tourActive() ||
        (state.screen === 'login' && [...document.querySelectorAll('[data-screen="login"] input')].some((i) => i.value)),
    ),
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

/** Session d'administration (cookie) à partir d'un ticket CAS ; refusée hors ADMIN_USERS. */
async function openAdminSession() {
  const ticket = await adminTicket();
  const res = await fetch('api/admin/cas', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Hub-Admin': '1' },
    body: JSON.stringify({ ticket }),
    credentials: 'same-origin',
    cache: 'no-store',
  });
  if (!res.ok) throw new Error('Session d’administration refusée.');
}

async function openAdmin() {
  wantsAdmin = false;
  try {
    await openAdminSession();
    return location.assign('admin');
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
else if (!state.signedIn && infinite.enabled()) show('login'); // connexion infinie : un geste pour reprendre
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
