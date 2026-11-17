import { ADE, HOSTS, MAIL_COUNT, NotLoggedIn } from './lib/config.js';
import { setTransport } from './lib/http.js';
import { fetchSchedule } from './lib/ade.js';
import { createMatcher } from './lib/match.js';
import * as moodle from './lib/moodle.js';
import * as mail from './lib/mail.js';
import * as D from './lib/dates.js';
import { platform } from './platform/index.js';
import { runProof } from './proof.js';

setTransport(platform.http);

const WEEKS_AHEAD = 6; // semaines proposées en accès direct
const $ = (id) => document.getElementById(id);

/** Petit constructeur de DOM : tout contenu externe passe par des nœuds texte, jamais par du HTML. */
function h(tag, props, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props ?? {})) {
    if (value == null || value === false) continue;
    if (key === 'class') el.className = value;
    else if (key === 'style') for (const [prop, v] of Object.entries(value)) el.style.setProperty(prop, v);
    else if (key.startsWith('on')) el.addEventListener(key.slice(2), value);
    else el.setAttribute(key, value === true ? '' : value);
  }
  for (const child of children.flat(Infinity)) {
    if (child == null || child === false) continue;
    el.append(child.nodeType ? child : document.createTextNode(String(child)));
  }
  return el;
}

const ext = (href, props, ...children) =>
  h('a', { href, target: '_blank', rel: 'noopener', ...props }, ...children);

const mount = (id, ...nodes) => $(id).replaceChildren(...nodes.filter(Boolean));

const state = {
  promo: Object.keys(ADE.promos)[0],
  promoChosen: false,
  week: D.mondayOf(D.today()),
  schedule: { status: 'loading', events: [], first: null, last: null, error: null },
  moodle: { status: 'loading', courses: [], error: null },
  mail: { status: 'loading', mails: [], unread: 0, account: null, error: null },
};

const matcher = createMatcher({ search: moodle.searchCourses });

// ---------------------------------------------------------------- connexion

const needsLogin = () => state.moodle.status === 'login' || state.mail.status === 'login';

/** Extension : onglet sur la page officielle du CAS. Appli web : formulaire chiffré vers le CAS. */
function startLogin() {
  if (platform.login.official) platform.login.start(loadAccounts);
  else openLoginDialog();
}

async function logout() {
  await platform.logout().catch(() => {});
  moodle.reset();
  mail.reset();
  loadAccounts();
}

// Extension : la session a pu être ouverte ailleurs dans le navigateur pendant qu'on regardait un autre onglet.
document.addEventListener('visibilitychange', () => {
  const { official, pending } = platform.login;
  if (official && document.visibilityState === 'visible' && needsLogin() && !pending()) loadAccounts();
});

// --------------------------------------------------------------- chargement

let scheduleRun = 0;

async function loadSchedule() {
  const run = ++scheduleRun;
  // La plage couvre toujours les semaines en accès direct, étendue jusqu'à la semaine consultée.
  const home = D.mondayOf(D.today());
  const first = D.addDays(state.week < home ? state.week : home, -7);
  const last = D.addDays(state.week > home ? state.week : home, 7 * (WEEKS_AHEAD + 2) - 1);
  state.schedule = { ...state.schedule, status: 'loading', error: null };
  renderSchedule();
  try {
    const events = await fetchSchedule(state.promo, first, last);
    if (run !== scheduleRun) return;
    state.schedule = { status: 'ok', events, first, last, error: null };
  } catch (error) {
    if (run !== scheduleRun) return;
    state.schedule = { status: 'error', events: [], first: null, last: null, error: error.message };
  }
  renderSchedule();
  linkMoodle();
}

async function loadMoodle() {
  state.moodle = { ...state.moodle, status: 'loading', error: null };
  renderMoodle();
  try {
    const courses = await moodle.enrolledCourses();
    matcher.setEnrolled(courses);
    state.moodle = { status: 'ok', courses, error: null };
    const guess = guessPromo(courses);
    if (!state.promoChosen && guess && guess !== state.promo) {
      state.promo = guess;
      loadSchedule();
    }
  } catch (error) {
    state.moodle = failure(error, { courses: [] });
  }
  renderMoodle();
  renderAccount();
  renderSchedule();
  linkMoodle();
}

async function loadMail() {
  if (!state.mail.mails.length) {
    state.mail = { ...state.mail, status: 'loading', error: null };
    renderMail();
  }
  try {
    const account = await mail.connect();
    const { mails, unread, inboxUrl } = await mail.latestMails(MAIL_COUNT);
    state.mail = { status: 'ok', mails, unread, inboxUrl, account, error: null };
  } catch (error) {
    state.mail = failure(error, { mails: [], unread: 0, account: null });
  }
  renderMail();
  renderAccount();
}

const failure = (error, empty) => ({
  ...empty,
  status: error instanceof NotLoggedIn ? 'login' : 'error',
  error: error.message,
});

function signedOut() {
  state.moodle = { status: 'login', courses: [], error: null };
  state.mail = { status: 'login', mails: [], unread: 0, account: null, error: null };
  renderMoodle();
  renderMail();
  renderAccount();
  renderSchedule();
}

const loadAccounts = () => (platform.maybeSignedIn() ? Promise.all([loadMoodle(), loadMail()]) : signedOut());
const loadAll = () => Promise.all([loadSchedule(), loadAccounts()]);

/** Promo la plus représentée parmi les cours Moodle (« ISIS-FIA4-SEMESTRE7 », « FIA4-1-ISI-2 »…). */
function guessPromo(courses) {
  const votes = {};
  for (const course of courses) {
    const promo = /FIA\d/i.exec(`${course.category} ${course.shortname}`)?.[0].toUpperCase();
    if (promo in ADE.promos) votes[promo] = (votes[promo] ?? 0) + 1;
  }
  return Object.keys(votes).sort((a, b) => votes[b] - votes[a])[0];
}

/** Cherche sur Moodle les cours des séances affichées qui ne sont pas encore associées. */
async function linkMoodle() {
  if (state.moodle.status !== 'ok' || state.schedule.status !== 'ok') return;
  const { current, next } = nowAndNext();
  const shown = [...weekEvents(state.week), ...current, next].filter(Boolean);
  try {
    if (await matcher.resolve(shown)) renderSchedule();
  } catch (error) {
    if (error instanceof NotLoggedIn) {
      state.moodle = failure(error, { courses: [] });
      renderMoodle();
      renderAccount();
    }
  }
}

// ------------------------------------------------------------------ actions

function setPromo(promo) {
  if (promo === state.promo) return;
  state.promo = promo;
  state.promoChosen = true;
  platform.prefs.set('promo', promo);
  state.schedule.events = [];
  loadSchedule();
}

function setWeek(monday) {
  state.week = monday;
  const { first, last } = state.schedule;
  if (!first || monday < first || D.addDays(monday, 6) > last) loadSchedule();
  else {
    renderSchedule();
    linkMoodle();
  }
}

// ------------------------------------------------------------ emploi du temps

const weekEvents = (monday) => {
  const end = D.addDays(monday, 6);
  return state.schedule.events.filter((e) => {
    const key = D.dayKey(e.start);
    return key >= monday && key <= end;
  });
};

function nowAndNext(now = new Date()) {
  const events = state.schedule.events;
  return {
    current: events.filter((e) => e.start <= now && now < e.end),
    next: events.find((e) => e.start > now),
  };
}

function moodleLink(event) {
  if (!event.code || state.moodle.status !== 'ok') return null;
  const match = matcher.get(event.code);
  if (match) {
    const title = match.approx ? `Trouvé par son intitulé : ${match.course.fullname}` : match.course.fullname;
    return ext(match.course.url, { class: 'chip link', title }, match.approx ? '≈ Moodle ↗' : 'Moodle ↗');
  }
  if (match === null) {
    return ext(
      moodle.searchUrl(event.title),
      { class: 'chip ghost', title: `Aucun espace Moodle trouvé pour ${event.code}` },
      'Chercher sur Moodle',
    );
  }
  return null; // recherche en cours
}

const kindClass = (event) => (event.exam ? 'k-exam' : `k-${event.kind ?? 'other'}`);

function eventCard(event, now) {
  const status = event.end <= now ? 'past' : event.start <= now ? 'live' : '';
  return h(
    'article',
    { class: `event ${kindClass(event)} ${status}` },
    h(
      'div',
      { class: 'event-top' },
      h('time', null, `${D.time(event.start)} – ${D.time(event.end)}`),
      event.exam ? h('span', { class: 'badge' }, 'Examen') : event.kind && h('span', { class: 'badge' }, event.kind),
      status === 'live' && h('span', { class: 'badge live' }, 'En cours'),
    ),
    h('h4', { title: event.summary }, event.title),
    h(
      'p',
      { class: 'event-meta' },
      event.room && h('span', { class: 'room' }, event.room),
      event.notes.filter((n) => !/^examen$/i.test(n)).map((n) => h('span', null, n)),
    ),
    moodleLink(event),
  );
}

function spotlight(now) {
  const { current, next } = nowAndNext(now);
  const item = (label, event) =>
    h(
      'div',
      { class: `spot ${kindClass(event)}` },
      h('span', { class: 'spot-label' }, label),
      h('strong', null, event.title),
      h(
        'span',
        { class: 'spot-meta' },
        [`${D.time(event.start)} – ${D.time(event.end)}`, event.room, event.kind].filter(Boolean).join(' · '),
      ),
      moodleLink(event),
    );
  const items = [
    ...current.map((e) => item(`En cours, jusqu'à ${D.time(e.end)}`, e)),
    next && item(`Prochain cours ${D.untilLabel(next.start, now)}`, next),
  ].filter(Boolean);
  return items.length ? h('div', { class: 'spotlight' }, items) : null;
}

function renderSchedule() {
  const { status, error } = state.schedule;
  const now = new Date();
  const todayKey = D.dayKey(now);
  const thisWeek = D.mondayOf(todayKey);

  const head = h(
    'div',
    { class: 'panel-head' },
    h('h2', null, 'Emploi du temps'),
    h(
      'div',
      { class: 'seg', role: 'group', 'aria-label': 'Promotion' },
      Object.keys(ADE.promos).map((promo) =>
        h(
          'button',
          { class: promo === state.promo && 'on', 'aria-pressed': String(promo === state.promo), onclick: () => setPromo(promo) },
          promo,
        ),
      ),
    ),
  );

  const weeks = Array.from({ length: WEEKS_AHEAD }, (_, i) => D.addDays(thisWeek, 7 * i));
  const nav = h(
    'div',
    { class: 'weeknav' },
    h('button', { class: 'btn icon', 'aria-label': 'Semaine précédente', onclick: () => setWeek(D.addDays(state.week, -7)) }, '‹'),
    h('strong', null, D.weekLabel(state.week)),
    h('button', { class: 'btn icon', 'aria-label': 'Semaine suivante', onclick: () => setWeek(D.addDays(state.week, 7)) }, '›'),
    h(
      'div',
      { class: 'weeks' },
      weeks.map((monday, i) => {
        const count = status === 'ok' ? weekEvents(monday).length : null;
        return h(
          'button',
          { class: `week ${monday === state.week ? 'on' : ''} ${count === 0 ? 'empty' : ''}`, onclick: () => setWeek(monday) },
          h('span', null, i === 0 ? 'Cette semaine' : `S${D.isoWeek(monday)} · ${D.dayMonth(monday)}`),
          count !== null && h('small', null, count ? `${count} séance${count > 1 ? 's' : ''}` : 'aucun cours'),
        );
      }),
    ),
  );

  let body;
  if (status === 'error') {
    body = notice(`Impossible de lire ADE : ${error}`, 'Réessayer', () => loadSchedule());
  } else if (status === 'loading') {
    body = skeleton(5);
  } else {
    const events = weekEvents(state.week);
    const days = Array.from({ length: 7 }, (_, i) => D.addDays(state.week, i)).filter(
      (key, i) => i < 5 || events.some((e) => D.dayKey(e.start) === key),
    );
    body = h(
      'div',
      { class: 'days', style: { '--cols': days.length } },
      days.map((key) => {
        const dayEvents = events.filter((e) => D.dayKey(e.start) === key);
        return h(
          'div',
          { class: `day ${key === todayKey ? 'today' : ''}` },
          h(
            'header',
            null,
            h('span', null, D.weekdayShort(key)),
            h('b', null, D.dayNumber(key)),
            key === todayKey && h('em', null, "Aujourd'hui"),
          ),
          dayEvents.length ? dayEvents.map((e) => eventCard(e, now)) : h('p', { class: 'nothing' }, 'Rien de prévu'),
        );
      }),
    );
  }

  mount('schedule', head, status === 'ok' && spotlight(now), nav, body);
}

// --------------------------------------------------------------- mails, Moodle

function loginCard(what, fallbackUrl, fallbackLabel) {
  return h(
    'div',
    { class: 'notice' },
    h('p', null, platform.login.official ? `Connecte-toi sur le portail officiel pour afficher ${what}.` : `Connecte-toi pour afficher ${what}.`),
    h('button', { class: 'btn primary', onclick: startLogin }, 'Se connecter'),
    ext(fallbackUrl, { class: 'subtle' }, fallbackLabel),
  );
}

function notice(text, action, onclick) {
  return h('div', { class: 'notice' }, h('p', null, text), h('button', { class: 'btn', onclick }, action));
}

const skeleton = (rows) => h('div', { class: 'skeleton', 'aria-busy': 'true' }, Array.from({ length: rows }, () => h('i')));

function renderMail() {
  const { status, mails, unread, inboxUrl, error } = state.mail;
  const head = h(
    'div',
    { class: 'panel-head' },
    h('h2', null, 'Mails', unread > 0 && h('span', { class: 'count' }, `${unread} non lu${unread > 1 ? 's' : ''}`)),
    ext(inboxUrl ?? `${HOSTS.mail}/webapp/mail/`, { class: 'subtle' }, 'Ouvrir la messagerie ↗'),
  );

  let body;
  if (status === 'login') body = loginCard('tes mails', `${HOSTS.mail}/webapp/mail/`, 'ou ouvrir la messagerie ↗');
  else if (status === 'error') body = notice(`Messagerie indisponible : ${error}`, 'Réessayer', loadMail);
  else if (status === 'loading') body = skeleton(6);
  else if (!mails.length) body = h('p', { class: 'nothing' }, 'Boîte de réception vide.');
  else {
    body = h(
      'ul',
      { class: 'list' },
      mails.map((m) =>
        h(
          'li',
          null,
          ext(
            m.url,
            { class: `mail ${m.unread ? 'unread' : ''}`, title: m.fromAddress },
            h('span', { class: 'mail-top' }, h('b', null, m.fromName), h('time', null, D.relativeDay(m.date))),
            h('span', { class: 'mail-subject' }, m.subject),
            h('span', { class: 'mail-preview' }, m.preview),
          ),
        ),
      ),
    );
  }
  mount('mail', head, body);
}

function renderMoodle() {
  const { status, courses, error } = state.moodle;
  const head = h(
    'div',
    { class: 'panel-head' },
    h('h2', null, 'Mes cours Moodle'),
    ext(`${HOSTS.moodle}/my/`, { class: 'subtle' }, 'Tableau de bord ↗'),
  );

  let body;
  if (status === 'login') body = loginCard('tes cours', `${HOSTS.moodle}/login/index.php?authCAS=CAS`, 'ou ouvrir Moodle ↗');
  else if (status === 'error') body = notice(`Moodle indisponible : ${error}`, 'Réessayer', loadMoodle);
  else if (status === 'loading') body = skeleton(5);
  else if (!courses.length) body = h('p', { class: 'nothing' }, 'Aucun cours suivi.');
  else {
    body = h(
      'ul',
      { class: 'list' },
      courses.map((c) =>
        h('li', null, ext(c.url, { class: 'course' }, h('b', null, c.fullname), h('span', null, c.category))),
      ),
    );
  }
  mount('moodle', head, body);
}

function renderAccount() {
  const name = state.mail.account?.name;
  mount(
    'account',
    needsLogin()
      ? h('button', { class: 'btn primary', onclick: startLogin }, 'Se connecter')
      : name && h('span', { class: 'who' }, name),
    h('button', { class: 'btn', onclick: loadAll }, 'Actualiser'),
  );
  mount(
    'foot-links',
    h('button', { class: 'linklike', onclick: openTransparency }, 'Transparence'),
    ext(`${HOSTS.ent}/uPortal/Login`, null, 'ENT'),
    ext(`${HOSTS.ade}/direct/`, null, 'ADE'),
    platform.logoutUrl
      ? ext(platform.logoutUrl, null, 'Se déconnecter du CAS')
      : platform.maybeSignedIn() && h('button', { class: 'linklike', onclick: logout }, 'Se déconnecter'),
  );
}

// ------------------------------------------------------------------ fenêtres

function openDialog(title, ...content) {
  const dialog = h('dialog', { class: 'sheet', 'aria-label': title }, h('h2', null, title), content);
  dialog.addEventListener('close', () => dialog.remove());
  document.body.append(dialog);
  dialog.showModal();
  return dialog;
}

/** Appli web uniquement : les identifiants partent chiffrés vers le CAS, sans être conservés. */
function openLoginDialog() {
  const username = h('input', { name: 'username', autocomplete: 'username', autocapitalize: 'none', spellcheck: 'false', required: true });
  const password = h('input', { name: 'password', type: 'password', autocomplete: 'current-password', required: true });
  const remember = h('input', { type: 'checkbox' });
  const error = h('p', { class: 'form-error', role: 'alert' });
  const submit = h('button', { class: 'btn primary', type: 'submit' }, 'Se connecter');

  async function onsubmit(event) {
    event.preventDefault();
    submit.disabled = true;
    submit.textContent = 'Connexion…';
    error.textContent = '';
    try {
      await platform.login.submit(username.value.trim(), password.value, remember.checked);
      password.value = '';
      dialog.close();
      loadAccounts();
    } catch (failure) {
      error.textContent = failure.message;
      submit.disabled = false;
      submit.textContent = 'Se connecter';
    }
  }

  const dialog = openDialog(
    'Connexion au CAS',
    h(
      'p',
      { class: 'hint' },
      'Ton identifiant et ton mot de passe sont chiffrés dans cette page et envoyés uniquement à ',
      h('b', null, new URL(HOSTS.cas).hostname),
      '. Ni ce site ni le relais ne peuvent les lire, et ils ne sont pas enregistrés.',
    ),
    h(
      'form',
      { onsubmit },
      h('label', null, 'Identifiant', username),
      h('label', null, 'Mot de passe', password),
      h('label', { class: 'check' }, remember, 'Rester connecté sur cet appareil (la session, jamais le mot de passe)'),
      error,
      h(
        'div',
        { class: 'actions' },
        h('button', { class: 'btn', type: 'button', onclick: () => dialog.close() }, 'Annuler'),
        submit,
      ),
    ),
  );
}

function openTransparency() {
  const facts = h('dl', { class: 'facts' });
  const fill = () => facts.replaceChildren(...platform.facts().flatMap(([key, value]) => [h('dt', null, key), h('dd', null, value)]));
  fill();

  const results = h('ul', { class: 'checks' });
  const run = h('button', { class: 'btn', onclick: verify }, 'Vérifier maintenant');
  async function verify() {
    run.disabled = true;
    results.replaceChildren();
    await runProof(platform.http, platform.login.official ? 'extension' : 'web', (label, ok, detail) =>
      results.append(h('li', { class: ok ? 'ok' : 'ko' }, h('b', null, label), ` : ${detail}`)),
    );
    fill();
    run.disabled = false;
  }

  const version = h('p', { class: 'hint' });
  fetch('checksums.json')
    .then((res) => res.json())
    .then((sums) => (version.textContent = `Version ${sums.version} : chaque fichier servi peut être comparé au code publié (tools/verify-deploy.mjs).`))
    .catch(() => {});

  const dialog = openDialog(
    'Transparence',
    facts,
    h(
      'p',
      { class: 'hint' },
      'Les vérifications ci-dessous n’utilisent aucun identifiant. ',
      !platform.login.official &&
        'Pour voir ce que reçoit le relais, ouvre les outils de développement, onglet Réseau, filtre WS : les trames commencent par 16 03 ou 17 03, ce sont des enregistrements TLS chiffrés.',
    ),
    results,
    version,
    h('div', { class: 'actions' }, run, h('button', { class: 'btn primary', onclick: () => dialog.close() }, 'Fermer')),
  );
}

// ---------------------------------------------------------------- démarrage

async function start() {
  document.body.append(
    h(
      'header',
      { class: 'topbar' },
      h(
        'div',
        { class: 'brand' },
        h('span', { class: 'logo', 'aria-hidden': 'true' }, 'IH'),
        h('div', null, h('h1', null, 'ISIS Hub'), h('p', null, D.dayLong(D.today()))),
      ),
      h('div', { class: 'account', id: 'account' }),
    ),
    h(
      'main',
      { class: 'layout' },
      h('section', { class: 'panel', id: 'schedule', 'aria-label': 'Emploi du temps' }),
      h(
        'aside',
        { class: 'side' },
        h('section', { class: 'panel', id: 'mail', 'aria-label': 'Mails' }),
        h('section', { class: 'panel', id: 'moodle', 'aria-label': 'Moodle' }),
      ),
    ),
    h('footer', { class: 'foot' }, h('p', null, platform.summary), h('nav', { id: 'foot-links' })),
  );

  const promo = await platform.prefs.get('promo');
  if (promo in ADE.promos) {
    state.promo = promo;
    state.promoChosen = true;
  }

  renderAccount();
  loadAll();

  setInterval(() => document.visibilityState === 'visible' && state.schedule.status === 'ok' && renderSchedule(), 60_000);
  setInterval(() => document.visibilityState === 'visible' && state.mail.status === 'ok' && loadMail(), 5 * 60_000);
}

start();
