// Tuile « Mails » : boîte de réception et corbeille, étiquettes et règles automatiques (gardées
// sur l'appareil), lecteur plein écran dans le Hub. Ouvrir un mail le marque comme lu dans la
// vraie boîte (drapeau \Seen côté serveur) ; « Supprimer » le déplace dans la corbeille.

import { $, $$, h, icon, restartClass, clipFrom, lockScroll, motionOK, toast, EASE, EASE_IO } from '../core/dom.js';
import * as D from '../core/dates.js';
import * as mail from '../portals/mail.js';
import * as MP from '../core/mailprefs.js';
import { createHubMails } from '../core/hubmails.js';
import { sanitizeMail, textToFragment } from '../portals/sanitize.js';
import { NotSignedIn } from '../portals/config.js';
import { modal } from './layout.js';
import { createAttachmentViewer, viewable, kb } from './attachments.js';

const PAGE = 20;

const initials = (name) =>
  name
    .replace(/[<>"]/g, '')
    .split(/[\s@._-]+/)
    .filter((w) => /\p{L}/u.test(w))
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join('') || '?';
const avatarClass = (text) => `av-${([...text].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7) % 6) + 1}`;
const who = (p) => (p.name && p.address && p.name !== p.address ? `${p.name} <${p.address}>` : p.name || p.address);
const tagChip = (t) => h('span.mtag', { class: `mtag--${t.color}`, text: t.name });

export function createMails({ app, onSessionLost, onLogin, onReply, onExpand, loginAlerts = null }) {
  const tile = $('.tile--mail');
  const slot = $('[data-slot="mail"]', tile);
  const live = $('[data-mail-live]', tile);
  const reader = $('[data-reader]');
  const badges = () => [$('[data-unread-count]', tile)];
  const dockLabel = $('[data-dock-mail]');
  const viewer = createAttachmentViewer();

  let box = 'inbox'; // 'inbox' | 'sent' | 'trash'
  let tagFilter = null; // identifiant d'étiquette, ou null
  let person = null; // recherche par personne : { name, email }, ou null
  let ids = [];
  let mails = [];
  let unread = 0;
  let list = null;
  let more = null;
  let observer = null;
  let loading = false;
  let current = -1;
  let generation = 0;
  let lastRefresh = 0;
  // Reprises (voir net/engine.js pour la connexion elle-même) : après une erreur passagère,
  // 4 nouveaux essais espacés de 1, 2, 4 et 8 s (± 30 %), puis le bouton « Réessayer ». Jamais
  // de boucle : le compteur ne repart qu'à un clic, à un succès, ou au retour sur l'application /
  // du réseau (au plus une fois toutes les 30 s).
  const RETRY_DELAYS = [1000, 2000, 4000, 8000];
  let retryTimer = null;
  let pendingAttempt = 0; // essai reporté parce que la page était cachée (0 = aucun)
  let failed = false; // tous les essais ont échoué : « Réessayer » affiché
  let lastResume = 0;
  let moreFailures = 0;
  let currentText = '';
  let currentFiles = [];
  const searchBox = $('[data-mail-searchbox]', tile);
  const searchInput = $('[data-mail-search]', tile);
  const searchCount = $('[data-mail-search-n]', tile);
  const noResult = $('[data-mail-noresult]', tile);
  const showMore = $('[data-mail-showmore]', tile);
  const sync = $('[data-sync="mail"]', tile);
  const filters = $('[data-mail-filters]', tile);

  function setUnread(n) {
    unread = Math.max(0, n);
    queueMicrotask(() => renderTools()); // « Tout marquer comme lu (n) »
    for (const b of badges()) {
      b.textContent = unread > 99 ? '99+' : String(unread); // l'en-tête de la tuile reste sur une ligne
      b.setAttribute('aria-label', `${unread} non lus`);
      b.hidden = unread === 0;
    }
    dockLabel.textContent = unread ? `Mails · ${unread}` : 'Mails';
  }

  const empty = (cls, ic, title, text, action) =>
    h('div.empty', { class: cls }, h('span.empty-ic', {}, icon(ic, 'ic ic--lg')), h('h3', { text: title }), h('p', { text }), action);

  function chrome(listShown) {
    searchBox.hidden = !listShown;
    filters.hidden = !listShown && !(box !== 'inbox' && lastRefresh);
    showMore.hidden = !listShown || ids.length <= 5;
    sync.hidden = !listShown && !lastRefresh;
    noResult.hidden = true;
    if (!listShown) {
      searchInput.value = '';
      person = null;
      renderPerson();
      closeAc();
      expandedMore = false;
      if (!expanded()) tile.classList.remove('is-searching', 'is-more');
    }
  }

  function showSignedOut(expired) {
    generation++;
    clearTimeout(retryTimer);
    retryTimer = null;
    pendingAttempt = 0;
    failed = false;
    ids = [];
    lastRefresh = 0;
    box = 'inbox';
    tagFilter = null;
    chrome(false);
    filters.hidden = true;
    setUnread(0);
    slot.replaceChildren(
      empty(
        'empty--brand',
        'lock',
        expired ? 'Session expirée' : 'Connecte-toi pour voir tes mails',
        expired ? 'Reconnecte-toi pour retrouver ta messagerie.' : 'Ta boîte de réception universitaire, lue en direct.',
        h('button.btn.btn--primary.btn--sm', { type: 'button', text: 'Se connecter', on: { click: onLogin } }),
      ),
    );
  }

  function showLoading() {
    const skel = (a, b) => h('div.skel-mail', {}, h('span.skel.skel--av'), h('div', {}, h('span.skel.skel--line', { class: a }), h('span.skel.skel--line', { class: b })));
    slot.replaceChildren(h('div.skel-stack', {}, ...[['w-50', 'w-90'], ['w-40', 'w-80'], ['w-60', 'w-70'], ['w-30', 'w-90'], ['w-50', 'w-60']].map(([a, b]) => skel(a, b))));
  }

  function showError(error) {
    slot.replaceChildren(
      empty(
        'empty--err',
        'offline',
        'La messagerie ne répond pas',
        `mail.univ-jfc.fr : ${error.message}. Les autres tuiles ne sont pas touchées.`,
        h('button.btn.btn--sm', { type: 'button', on: { click: () => load() } }, icon('retry', 'ic ic--sm'), 'Réessayer'),
      ),
    );
  }

  // ------------------------------------------------------------ filtres

  function renderFilters() {
    const pill = (key, label, extra) =>
      h(
        'button.mfilter',
        {
          type: 'button',
          class: extra,
          attrs: { 'aria-pressed': String((key === box && key !== 'inbox') || (key === 'all' && box === 'inbox' && !tagFilter) || (box === 'inbox' && tagFilter === key)) },
          on: { click: () => choose(key) },
        },
        label,
      );
    filters.replaceChildren(
      pill('all', 'Tous'),
      ...MP.tags().map((t) => pill(t.id, h('span', {}, h('i.mdot', { class: `mtag--${t.color}` }), t.name))),
      pill('sent', h('span', {}, icon('send', 'ic ic--xs'), 'Envoyés'), 'mfilter--sent'),
      pill('trash', h('span', {}, icon('trash', 'ic ic--xs'), 'Corbeille')),
    );
  }

  function choose(key) {
    if (key === 'trash' || key === 'sent') {
      if (box === key) return;
      box = key;
      tagFilter = null;
      searchInput.value = '';
      renderFilters();
      return load();
    }
    const elsewhere = box !== 'inbox';
    box = 'inbox';
    tagFilter = key === 'all' ? null : key;
    renderFilters();
    if (elsewhere) return load();
    filter();
  }

  // ------------------------------------------------------------ liste

  /** Nom affiché sur une ligne : l'expéditeur, ou les destinataires dans « Envoyés ». */
  function rowName(m) {
    if (box !== 'sent') return m.from.name || m.from.address || 'Expéditeur inconnu';
    const to = [...m.to, ...m.cc];
    if (!to.length) return 'Sans destinataire';
    const first = to[0].name || to[0].address;
    return `À : ${first}${to.length > 1 ? ` +${to.length - 1}` : ''}`;
  }

  function rowEl(m, i) {
    const name = rowName(m);
    const who_ = box === 'sent' ? m.to[0]?.address || name : m.from.address || name;
    const tags = MP.tagsOf(m);
    return h(
      'li',
      {},
      h(
        'button.mail-row',
        { type: 'button', class: m.unread ? 'is-unread' : '', data: { mail: i } },
        h('span.avatar', { class: avatarClass(who_), text: initials(name.replace(/^À : /, '')), attrs: { 'aria-hidden': 'true' } }),
        h('span.mail-from', { text: name }),
        h('span.mail-time', {}, m.unread && h('span.sr-only', { text: 'Non lu, ' }), D.relative(m.date)),
        h('span.mail-subj', {}, tags.length ? h('span.mail-tags', {}, ...tags.map(tagChip)) : null, m.subject),
        h('span.mail-prev', { text: m.preview }),
      ),
    );
  }

  function append(batch) {
    const frag = document.createDocumentFragment();
    for (const m of batch) {
      const prev = mails.at(-1);
      if (prev && D.monthLabel(prev.date) !== D.monthLabel(m.date)) frag.append(h('li.mail-sep', { text: D.monthLabel(m.date) }));
      mails.push(m);
      const row = rowEl(m, mails.length - 1);
      if (prev) row.firstChild.classList.add('is-new');
      frag.append(row);
    }
    more.before(frag);
  }

  /** Redessine les lignes déjà chargées (après suppression ou changement d'étiquette). */
  function redraw() {
    if (!list) return;
    const keep = mails;
    mails = [];
    $$(':scope > li:not(.mail-more)', list).forEach((li) => li.remove());
    append(keep);
    $$('.mail-row.is-new', list).forEach((r) => r.classList.remove('is-new'));
    filter();
    if (selecting()) paintPicks();
  }

  function endOfList() {
    more.classList.add('is-end');
    more.removeAttribute('aria-hidden');
    const END = { trash: 'Fin de la corbeille.', sent: 'Fin des messages envoyés.', inbox: 'Tu as atteint le début de ta boîte de réception.' };
    more.replaceChildren(mails.length ? END[box] : '');
    observer?.disconnect();
  }

  // ------------------------------------------- alerte « Nouvelle connexion » de Moodle (ISIS Hub)

  /**
   * Alerte que Moodle envoie quand ISIS Hub se connecte, sur cet appareil : lue puis mise à la
   * corbeille (récupérable). Critères stricts dans core/loginalerts.js ; toute autre alerte reste.
   */
  async function trashLoginAlerts(list) {
    const logins = loginAlerts?.pendingLogin() && MP.loginAlertsOn();
    if (!logins && !loginAlerts?.pendingEnrol()) return [];
    const found = await loginAlerts.find(list, (m) => mail.fetchBody(m), { logins });
    if (!found.length) return [];
    await mail.setSeen(found, true).catch(() => {});
    await mail.moveTo(found, 'trash');
    loginAlerts.consume(found);
    // « Bienvenue sur <cours> » après une inscription faite dans le Hub : à la corbeille, sans message.
    const alerts = found.filter((m) => !loginAlerts.isWelcome(m));
    if (alerts.length) toast(
      alerts.length > 1
        ? `${alerts.length} alertes Moodle de tes connexions à ISIS Hub mises à la corbeille.`
        : 'Alerte Moodle « Nouvelle connexion » de ta connexion à ISIS Hub mise à la corbeille.',
      'trash',
    );
    return found;
  }

  async function withoutLoginAlerts(batch) {
    try {
      const found = await trashLoginAlerts(batch);
      if (!found.length) return batch;
      const gone = new Set(found.map((m) => m.id));
      ids = ids.filter((id) => !gone.has(id));
      setUnread(unread - found.filter((m) => m.unread).length);
      return batch.filter((m) => !gone.has(m.id));
    } catch {
      return batch; // en cas de doute, le mail reste
    }
  }

  // L'alerte arrive quelques secondes après la connexion : la boîte est relue à ≈ 12, 27, 47 et 77 s.
  let alertTimer = 0;
  function watchLoginAlerts() {
    clearTimeout(alertTimer);
    const delays = [12_000, 15_000, 20_000, 30_000, 60_000, 120_000, 240_000];
    let i = 0;
    const tick = async () => {
      if (!(loginAlerts?.pendingLogin() && MP.loginAlertsOn()) && !loginAlerts?.pendingEnrol()) return;
      try {
        const res = await mail.listInbox('inbox');
        const found = await trashLoginAlerts(await mail.getMails(res.ids.slice(0, 8), 'inbox'));
        if (found.length && box === 'inbox') {
          const gone = new Set(found.map((m) => m.id));
          ids = ids.filter((id) => !gone.has(id));
          setUnread(res.unread - found.filter((m) => m.unread).length);
          if (mails.some((m) => gone.has(m.id))) {
            mails = mails.filter((m) => !gone.has(m.id));
            redraw();
          }
        }
      } catch {
        // boîte injoignable : nouvel essai au prochain passage, l'alerte reste sinon
      }
      if (i < delays.length && loginAlerts.pending()) alertTimer = setTimeout(tick, delays[i++]);
    };
    alertTimer = setTimeout(tick, delays[i++]);
  }

  // ------------------------------------------- mails d'ISIS Hub : ne garder que le dernier

  const hubMails = createHubMails();
  /** Anciens mails d'accord du TCG à la corbeille (récupérables), le plus récent reste (core/hubmails.js). */
  async function withoutOldHubMails(batch) {
    if (!MP.hubMailsOn()) return batch;
    const old = hubMails.pick(batch);
    if (!old.length) return batch;
    try {
      await mail.moveTo(old, 'trash');
    } catch {
      return batch; // en cas de doute, les mails restent
    }
    const gone = new Set(old.map((m) => m.id));
    ids = ids.filter((id) => !gone.has(id));
    setUnread(unread - old.filter((m) => m.unread).length);
    // L'ancien « dernier » peut être déjà affiché (un plus récent vient d'arriver).
    if (mails.some((m) => gone.has(m.id))) {
      mails = mails.filter((m) => !gone.has(m.id));
      redraw();
    }
    return batch.filter((m) => !gone.has(m.id));
  }

  /** Règles automatiques sur un lot (boîte de réception seulement). Rend le lot sans les mails mis à la corbeille. */
  async function withRules(input) {
    if (box !== 'inbox') return input;
    const batch = await withoutOldHubMails(await withoutLoginAlerts(input));
    if (!MP.rules().length) return batch;
    const toTrash = MP.applyRules(batch);
    if (!toTrash.length) return batch;
    try {
      await mail.moveTo(toTrash, 'trash');
      const gone = new Set(toTrash.map((m) => m.id));
      ids = ids.filter((id) => !gone.has(id));
      setUnread(unread - toTrash.filter((m) => m.unread).length);
      live.textContent = `${toTrash.length} mail${toTrash.length > 1 ? 's' : ''} mis à la corbeille par tes règles.`;
      return batch.filter((m) => !gone.has(m.id));
    } catch (err) {
      toast(`Règles : mails non déplacés (${err.message})`, 'alert');
      return batch;
    }
  }

  async function loadMore() {
    if (loading || mails.length >= ids.length) return;
    loading = true;
    const gen = generation;
    let ok = false;
    try {
      const batch = await withRules(await mail.getMails(ids.slice(mails.length, mails.length + PAGE), box));
      if (gen !== generation) return;
      if (narrowedNow()) searchBudget -= batch.length;
      append(batch);
      if (mails.length > PAGE) live.textContent = `${batch.length} mails plus anciens chargés, ${mails.length} au total.`;
      if (mails.length >= ids.length) endOfList();
      if (!reader.hidden) stepButtons();
      filter();
      ok = true;
      moreFailures = 0;
    } catch (error) {
      if (gen !== generation) return;
      if (error instanceof NotSignedIn) return onSessionLost('mail');
      moreFailures++;
      if (moreFailures >= 3) toast(`Mails plus anciens indisponibles : ${error.message}`);
    } finally {
      loading = false;
      // Si la fin de liste est encore visible, on continue : tout de suite après un succès, avec
      // une pause croissante après un échec (3 essais au plus, puis seulement au défilement).
      const room = list && more.getBoundingClientRect().top < list.getBoundingClientRect().bottom + 240;
      if (gen === generation && list && mails.length < ids.length && room && (!narrowedNow() || searchBudget > 0)) {
        if (ok) setTimeout(loadMore, 0);
        else if (moreFailures < 3) setTimeout(() => gen === generation && loadMore(), 1000 * 2 ** moreFailures * (0.7 + Math.random() * 0.6));
      }
    }
  }

  /** Erreur qui peut passer toute seule (réseau, relais, serveur), par opposition à un refus. */
  const transient = (error) =>
    !(error instanceof NotSignedIn) && !(error?.status >= 400 && error.status < 500 && error.status !== 408 && error.status !== 429);

  async function load({ attempt = 0 } = {}) {
    const gen = ++generation;
    clearTimeout(retryTimer);
    retryTimer = null;
    pendingAttempt = 0;
    if (attempt === 0) moreFailures = 0;
    let retrying = false;
    if (selecting()) setSelecting(false);
    list = null;
    chrome(false);
    renderFilters();
    filters.hidden = false;
    sync.hidden = false;
    sync.classList.add('is-busy');
    sync.textContent = attempt ? 'Reconnexion…' : 'Mise à jour…';
    showLoading();
    try {
      const result = await mail.listInbox(box);
      if (gen !== generation) return;
      ids = result.ids;
      mails = [];
      if (box === 'inbox') setUnread(result.unread);
      lastRefresh = Date.now();
      failed = false;
      if (!ids.length) {
        const EMPTY = {
          trash: ['trash', 'Corbeille vide', 'Les mails supprimés depuis ISIS Hub ou la messagerie arrivent ici.'],
          sent: ['send', 'Aucun message envoyé', 'Les mails que tu envoies, depuis ISIS Hub ou la messagerie, apparaissent ici.'],
          inbox: ['inbox', 'Aucun mail', 'Ta boîte de réception universitaire est vide.'],
        };
        slot.replaceChildren(empty('', ...EMPTY[box]));
        filters.hidden = false;
        return;
      }
      more = h(
        'li.mail-more',
        { attrs: { 'aria-hidden': 'true' } },
        h('div.skel-mail', {}, h('span.skel.skel--av'), h('div', {}, h('span.skel.skel--line.w-40'), h('span.skel.skel--line.w-90'))),
        h('div.skel-mail', {}, h('span.skel.skel--av'), h('div', {}, h('span.skel.skel--line.w-50'), h('span.skel.skel--line.w-70'))),
      );
      const newList = h('ul.mail-list', { data: { mailList: '' } }, more);
      const first = await withRules(await mail.getMails(ids.slice(0, PAGE), box));
      if (gen !== generation) return;
      list = newList;
      slot.replaceChildren(list);
      append(first);
      chrome(true);
      filter();
      if (mails.length >= ids.length) endOfList();
      observer?.disconnect();
      observer = new IntersectionObserver((entries) => entries.some((x) => x.isIntersecting) && loadMore(), {
        root: list,
        rootMargin: '0px 0px 240px 0px',
      });
      if (mails.length < ids.length) observer.observe(more);
    } catch (error) {
      if (gen !== generation) return;
      if (error instanceof NotSignedIn) return onSessionLost('mail');
      if (transient(error) && attempt < RETRY_DELAYS.length) {
        // Le squelette reste affiché : l'étudiant voit « Reconnexion… », pas une erreur.
        retrying = true;
        sync.textContent = 'Reconnexion…';
        const delay = RETRY_DELAYS[attempt] * (0.7 + Math.random() * 0.6);
        retryTimer = setTimeout(() => {
          retryTimer = null;
          if (gen !== generation) return;
          // Page cachée (téléphone verrouillé, application en arrière-plan) : on attend son retour.
          if (document.visibilityState === 'hidden') pendingAttempt = attempt + 1;
          else load({ attempt: attempt + 1 });
        }, delay);
        return;
      }
      failed = true;
      showError(error);
    } finally {
      if (gen === generation && !retrying) renderSync();
    }
  }

  // --------------------------------------------------------- mise à jour discrète

  // Page visible : la boîte est relue toutes les 4 minutes, sans squelette ni perte de la position
  // dans la liste (nouveaux mails ajoutés en tête, lus / non lus de la première page relus). Page
  // cachée (onglet en arrière-plan, application fermée) : rien ; au retour, relue tout de suite si
  // la dernière lecture date de plus de 4 minutes. Rien pendant la lecture d'un mail ou une
  // sélection : on attend qu'ils soient finis.
  const AUTO_REFRESH = 4 * 60_000;
  let quiet = false;
  async function refreshQuietly() {
    if (quiet || !list || !reader.hidden || selecting() || retryTimer || pendingAttempt || failed) return;
    if (sync.classList.contains('is-busy') || document.visibilityState !== 'visible') return;
    quiet = true;
    const gen = generation;
    sync.classList.add('is-busy');
    sync.textContent = 'Mise à jour…';
    try {
      const res = await mail.listInbox(box);
      if (gen !== generation || !list) return;
      const pos = new Map(res.ids.map((id, i) => [id, i]));
      const old = new Map(mails.filter((m) => pos.has(m.id)).map((m) => [m.id, m]));
      // Mails déjà affichés : de la tête de la boîte jusqu'au plus ancien chargé (la liste reste un
      // début de la boîte, que « plus anciens » continue au défilement).
      const last = Math.max(-1, ...[...old.keys()].map((id) => pos.get(id)));
      const range = res.ids.slice(0, Math.max(last + 1, Math.min(PAGE, res.ids.length)));
      const want = range.filter((id, i) => i < PAGE || !old.has(id));
      if (!old.size || want.length > 2 * PAGE) return void load(); // beaucoup de changements : on recharge
      ids = res.ids;
      if (box === 'inbox') setUnread(res.unread);
      const got = await withRules(await mail.getMails(want, box));
      if (gen !== generation || !list) return;
      const fresh = new Map([...old, ...got.map((m) => [m.id, m])]);
      const still = new Set(ids); // les règles ont pu en mettre à la corbeille
      const next = range.filter((id) => still.has(id) && fresh.has(id)).map((id) => fresh.get(id));
      const shown = new Set(mails.map((m) => m.id));
      const added = next.filter((m) => !shown.has(m.id)).length;
      if (next.length !== mails.length || next.some((m, i) => m.id !== mails[i].id || Boolean(m.unread) !== Boolean(mails[i].unread))) {
        mails = next;
        redraw();
        if (added) live.textContent = added > 1 ? `${added} nouveaux mails.` : '1 nouveau mail.';
      }
      if (mails.length >= ids.length) endOfList();
      lastRefresh = Date.now();
    } catch (error) {
      if (gen === generation && error instanceof NotSignedIn) onSessionLost('mail');
      // autre échec : rien n'est effacé, nouvel essai au tour suivant
    } finally {
      quiet = false;
      if (gen === generation && !retryTimer) renderSync();
    }
  }
  setInterval(() => lastRefresh && Date.now() - lastRefresh >= AUTO_REFRESH && refreshQuietly(), 20_000);

  // --------------------------------------------------------- état de mise à jour

  function renderSync() {
    sync.classList.remove('is-busy');
    sync.replaceChildren(icon('retry', 'ic ic--xs'), lastRefresh ? (Date.now() - lastRefresh < 60000 ? 'À jour' : `il y a ${D.ago(lastRefresh)}`) : 'Mettre à jour');
    sync.title = lastRefresh ? `Mis à jour ${D.ago(lastRefresh, true)} · cliquer pour actualiser` : 'Actualiser';
    sync.setAttribute('aria-label', sync.title);
  }
  sync.addEventListener('click', () => {
    if (!sync.classList.contains('is-busy')) load();
  });
  setInterval(() => lastRefresh && !sync.classList.contains('is-busy') && renderSync(), 30_000);

  // --------------------------------------------------------- recherche et étiquette

  const norm = (t) => t.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
  // Texte où chercher, calculé une fois par mail. Les adresses y sont aussi découpées en mots :
  // « jean martin » trouve jean.martin@… comme « MARTIN Jean ».
  const hays = new WeakMap();
  const hayOf = (m) => {
    let hay = hays.get(m);
    if (hay === undefined) {
      const people = [m.from, ...(m.to ?? []), ...(m.cc ?? [])].map((p) => `${p?.name ?? ''} ${p?.address ?? ''}`).join(' ');
      hay = norm(`${people} ${m.subject ?? ''} ${m.preview ?? ''}`);
      hay = `${hay} ${hay.replace(/[._+@-]+/g, ' ')}`;
      hays.set(m, hay);
    }
    return hay;
  };
  // Chaque mot cherché doit apparaître quelque part, dans n'importe quel ordre.
  const matches = (m, terms) => terms.every((t) => hayOf(m).includes(t));

  // Recherche par personne. En tapant un nom, une liste propose d'abord « Rechercher « … » »
  // (la recherche dans le texte, déjà appliquée), puis les personnes trouvées : celles des mails
  // déjà chargés, puis l'annuaire de la messagerie. En choisir une pose un filtre (une pastille
  // dans le champ) : les mails qu'elle a envoyés, ou où elle est destinataire ou en copie. On
  // peut ensuite taper d'autres mots (« contrôle ») pour affiner.
  const peopleOf = (m) => [m.from, ...(m.to ?? []), ...(m.cc ?? [])].filter((p) => p?.address);
  const involves = (m, email) => peopleOf(m).some((p) => p.address.toLowerCase() === email);
  const ac = h('ul.ac.msearch-ac', { id: 'msearch-ac', attrs: { role: 'listbox', 'aria-label': 'Suggestions de recherche' } });
  ac.hidden = true;
  searchBox.append(ac);
  let acItems = [];
  let acIndex = -1;
  let acToken = 0;
  let acTimer = 0;
  let personChip = null;
  const PLACEHOLDER = searchInput.placeholder;

  /** Personnes des mails déjà chargés dont le nom ou l'adresse contient tous les mots tapés. */
  function peopleIn(q) {
    const terms = norm(q).split(/\s+/).filter(Boolean);
    const found = new Map();
    for (const m of mails) {
      for (const p of peopleOf(m)) {
        const email = p.address.toLowerCase();
        if (person?.email === email) continue;
        const hay = norm(`${p.name ?? ''} ${email} ${email.replace(/[._+@-]+/g, ' ')}`);
        if (!terms.every((t) => hay.includes(t))) continue;
        const e = found.get(email) ?? { name: '', email, n: 0 };
        e.n++;
        if (!e.name && p.name && p.name !== p.address) e.name = p.name;
        found.set(email, e);
      }
    }
    return [...found.values()].map((e) => ({ ...e, name: e.name || e.email })).sort((a, b) => b.n - a.n);
  }

  function closeAc() {
    clearTimeout(acTimer);
    acToken++;
    ac.hidden = true;
    acItems = [];
    acIndex = -1;
    searchInput.setAttribute('aria-expanded', 'false');
    searchInput.removeAttribute('aria-activedescendant');
  }

  function paintAc() {
    $$('.ac-item', ac).forEach((x, k) => x.setAttribute('aria-selected', String(k === acIndex)));
    if (acIndex >= 0) searchInput.setAttribute('aria-activedescendant', `msearch-${acIndex}`);
    $(`#msearch-${acIndex}`, ac)?.scrollIntoView({ block: 'nearest' });
  }

  function renderAc(q, people) {
    acItems = [{ kind: 'text', q }, ...people.map((p) => ({ kind: 'person', ...p }))];
    acIndex = Math.min(Math.max(acIndex, 0), acItems.length - 1);
    ac.replaceChildren(
      ...acItems.map((it, k) =>
        h(
          'li.ac-item',
          {
            id: `msearch-${k}`,
            attrs: { role: 'option', 'aria-selected': String(k === acIndex) },
            on: {
              mousedown: (e) => {
                e.preventDefault(); // le champ garde le focus
                pick(k);
              },
            },
          },
          it.kind === 'text'
            ? h('span.ac-ic', { attrs: { 'aria-hidden': 'true' } }, icon('search', 'ic ic--sm'))
            : h('span.avatar', { class: avatarClass(it.email), text: initials(it.name), attrs: { 'aria-hidden': 'true' } }),
          it.kind === 'text'
            ? h('span.link-txt', {}, h('b', { text: `Rechercher « ${q} »` }), h('span', { text: person ? `Parmi les mails avec ${person.name}` : 'Expéditeur, destinataires, objet, début du mail' }))
            : h('span.link-txt', {}, h('b', { text: it.name }), h('span', { text: `Envoyés, reçus ou en copie · ${it.email}` })),
        ),
      ),
    );
    ac.hidden = false;
    searchInput.setAttribute('aria-expanded', 'true');
    paintAc();
  }

  function suggest() {
    const q = searchInput.value.trim();
    clearTimeout(acTimer);
    if (q.length < 2 || document.activeElement !== searchInput) return closeAc();
    const local = peopleIn(q).slice(0, 6);
    renderAc(q, local);
    const token = ++acToken;
    acTimer = setTimeout(async () => {
      try {
        const dir = (await mail.searchContacts(q, 8)).filter((p) => p.email !== person?.email && !local.some((l) => l.email === p.email));
        if (token !== acToken || searchInput.value.trim() !== q) return;
        if (dir.length) renderAc(q, [...local, ...dir.map((p) => ({ name: p.name, email: p.email }))].slice(0, 9));
      } catch {
        // annuaire indisponible : les personnes des mails chargés suffisent
      }
    }, 250);
  }

  function pick(k) {
    const it = acItems[k];
    closeAc();
    if (!it || it.kind === 'text') return; // la recherche dans le texte est déjà appliquée
    person = { name: it.name, email: it.email };
    searchInput.value = '';
    renderPerson();
    filter();
    searchInput.focus();
  }

  function renderPerson() {
    personChip?.remove();
    personChip = null;
    searchInput.placeholder = person ? 'et qui contient…' : PLACEHOLDER;
    if (!person) return;
    personChip = h(
      'span.msearch-chip',
      { title: `Mails envoyés, reçus ou en copie : ${person.email}` },
      h('span', { text: person.name }),
      h('button', {
        type: 'button',
        text: '×',
        attrs: { 'aria-label': `Retirer le filtre ${person.name}` },
        on: {
          click: (e) => {
            e.preventDefault();
            clearPerson();
            searchInput.focus();
          },
        },
      }),
    );
    searchInput.before(personChip);
  }

  function clearPerson() {
    person = null;
    renderPerson();
    filter();
  }
  // Recherche : les mails plus anciens se chargent tout seuls jusqu'à MIN_RESULTS résultats
  // (au plus SEARCH_BUDGET mails par recherche), puis au défilement, comme la liste normale.
  const MIN_RESULTS = 20;
  const SEARCH_BUDGET = 400;
  let searchBudget = 0;
  let lastQuery = '';
  const narrowedNow = () => Boolean(searchInput.value.trim()) || Boolean(tagFilter) || Boolean(person);
  function filter() {
    if (!list) return;
    const q = norm(searchInput.value.trim());
    const terms = q.split(/\s+/).filter(Boolean);
    const narrowed = Boolean(q) || Boolean(tagFilter) || Boolean(person);
    tile.classList.toggle('is-searching', narrowed);
    let n = 0;
    for (const row of $$('[data-mail]', tile)) {
      const m = mails[Number(row.dataset.mail)];
      const ok = (!person || involves(m, person.email)) && (!q || matches(m, terms)) && (!tagFilter || MP.tagsOf(m).some((t) => t.id === tagFilter));
      row.parentElement.hidden = !ok;
      if (ok) n++;
    }
    $$('.mail-sep', tile).forEach((x) => (x.hidden = narrowed));
    const key = `${q}|${tagFilter ?? ''}|${person?.email ?? ''}`;
    if (key !== lastQuery) {
      lastQuery = key;
      searchBudget = narrowed ? SEARCH_BUDGET : 0;
    }
    const left = ids.length - mails.length;
    // La fin de liste reste visible pendant la recherche : défiler charge les mails plus anciens.
    if (more) more.hidden = false;
    if (narrowed && n < MIN_RESULTS && left > 0 && searchBudget > 0 && !loading) setTimeout(loadMore, 0);
    // La recherche montre tous les résultats ; une fois effacée, on revient à l'état choisi.
    tile.classList.toggle('is-more', narrowed || expandedMore || expanded());
    searchCount.textContent = narrowed ? `${n} résultat${n > 1 ? 's' : ''}` : '';
    const searching = narrowed && left > 0 && searchBudget > 0 && n < MIN_RESULTS;
    const exhausted = narrowed && left > 0 && searchBudget <= 0;
    noResult.hidden = !narrowed || (n > 0 && !exhausted);
    if (!noResult.hidden) {
      const what = person
        ? `« ${person.name} »${q ? ` et « ${searchInput.value.trim()} »` : ''}`
        : q ? `« ${searchInput.value.trim()} »` : `l’étiquette « ${MP.tagById(tagFilter)?.name ?? ''} »`;
      noResult.replaceChildren(
        searching
          ? h('span', {}, h('span.spinner'), ` Recherche de ${what} dans les mails plus anciens (${mails.length} sur ${ids.length})…`)
          : n === 0
            ? `Aucun des ${mails.length} mails chargés ne correspond à ${what}.`
            : `${n} résultat${n > 1 ? 's' : ''} dans les ${mails.length} mails chargés.`,
        exhausted ? h('br') : '',
        exhausted ? h('button.linklike', { type: 'button', text: `Chercher aussi dans les ${Math.min(left, SEARCH_BUDGET)} suivants`, on: { click: searchOlder } }) : '',
      );
    }
  }
  function searchOlder() {
    searchBudget = SEARCH_BUDGET;
    filter();
  }
  searchInput.addEventListener('input', () => {
    filter();
    suggest();
  });
  searchInput.addEventListener('blur', () => setTimeout(() => document.activeElement !== searchInput && closeAc(), 150));
  searchInput.addEventListener('keydown', (e) => {
    if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && !ac.hidden && acItems.length) {
      e.preventDefault();
      e.stopPropagation();
      acIndex = (acIndex + (e.key === 'ArrowDown' ? 1 : -1) + acItems.length) % acItems.length;
      paintAc();
    } else if (e.key === 'Enter' && !ac.hidden && acIndex >= 0) {
      e.preventDefault();
      pick(acIndex);
    } else if (e.key === 'Backspace' && person && !searchInput.value) {
      clearPerson();
    } else if (e.key === 'Escape') {
      if (!ac.hidden) {
        e.preventDefault(); // un champ de recherche s'efface aussi sur Échap : ici, on ferme seulement
        closeAc();
      } else if (searchInput.value) {
        searchInput.value = '';
        filter();
      } else if (person) clearPerson();
      else return;
      e.stopPropagation();
    }
  });
  let expandedMore = false; // « Afficher plus » cliqué (téléphone)
  showMore.addEventListener('click', () => {
    expandedMore = true;
    tile.classList.add('is-more');
    $$('.mail-list > li', tile)[5]?.querySelector('button')?.focus({ preventScroll: true });
  });

  // ------------------------------------------------------------- lecteur

  const rowFor = (i) => $(`[data-mail="${i}"]`, tile);

  function stepButtons() {
    $('[data-reader-count]', reader).textContent = `${current + 1} sur ${ids.length}`;
    $('[data-reader-step="-1"]', reader).disabled = current <= 0;
    $('[data-reader-step="1"]', reader).disabled = current >= ids.length - 1;
  }

  async function markRead(i) {
    const m = mails[i];
    if (!m?.unread) return;
    m.unread = false;
    const row = rowFor(i);
    row?.classList.remove('is-unread');
    $('.sr-only', row ?? document.createElement('i'))?.remove();
    if (box === 'inbox') setUnread(unread - 1);
    try {
      const confirmed = await mail.markRead(m);
      if (!confirmed) toast('La messagerie n’a pas confirmé la lecture de ce mail.');
    } catch (error) {
      m.unread = true;
      row?.classList.add('is-unread');
      if (box === 'inbox') setUnread(unread + 1);
      toast(`Mail non marqué comme lu : ${error.message}`);
    }
  }

  function renderReaderTags() {
    const m = mails[current];
    const box_ = $('[data-reader-tags]', reader);
    const tags = m ? MP.tagsOf(m) : [];
    box_.hidden = !tags.length;
    box_.replaceChildren(...tags.map(tagChip));
  }

  function readerMode() {
    const inTrash = box === 'trash';
    $('[data-mail-delete]', reader).hidden = inTrash;
    $('[data-mail-restore]', reader).hidden = !inTrash;
    $('[data-mail-destroy]', reader).hidden = !inTrash;
    $('[data-mail-tag]', reader).hidden = inTrash;
  }

  function filesEl(m, attachments) {
    return h(
      'ul.reader-files',
      {},
      ...attachments.map((a) =>
        h(
          'li.rfile',
          {},
          viewable(a)
            ? h('button.rfile-main', { type: 'button', title: `Voir ${a.name}`, on: { click: () => viewer.view(m, a) } }, icon('clip', 'ic ic--sm'), h('span', { text: a.name }), a.size ? h('small', { text: kb(a.size) }) : null)
            : h('span.rfile-main', {}, icon('clip', 'ic ic--sm'), h('span', { text: a.name }), a.size ? h('small', { text: kb(a.size) }) : null),
          h('button.rfile-dl', {
            type: 'button',
            title: `Télécharger ${a.name}`,
            attrs: { 'aria-label': `Télécharger ${a.name}` },
            on: { click: (e) => viewer.download(m, a, e.currentTarget) },
          }, icon('download', 'ic ic--sm')),
        ),
      ),
    );
  }

  /** « À : » : jusqu'à 4 personnes en entier ; au-delà les 3 premières, puis « et N autres ». */
  function showRecipients(target, people) {
    if (!people.length) return void (target.textContent = '—');
    const all = people.map(who).join(', ');
    if (people.length <= 4) return void (target.textContent = all);
    const more = h('button.reader-to-more', { type: 'button', attrs: { 'aria-expanded': 'false' } });
    const short = () => {
      more.textContent = `et ${people.length - 3} autres`;
      more.setAttribute('aria-expanded', 'false');
      target.replaceChildren(`${people.slice(0, 3).map(who).join(', ')} `, more);
    };
    more.addEventListener('click', () => {
      if (more.getAttribute('aria-expanded') === 'true') return short();
      more.textContent = 'réduire';
      more.setAttribute('aria-expanded', 'true');
      target.replaceChildren(`${all} `, more);
    });
    short();
  }

  async function fill(i) {
    const m = mails[i];
    current = i;
    const set = (k, v) => ($(`[data-r="${k}"]`, reader).textContent = v);
    set('subject', m.subject);
    set('name', m.from.name || m.from.address);
    set('email', m.from.address && m.from.name ? `<${m.from.address}>` : '');
    showRecipients($('[data-r="to"]', reader), [...m.to, ...m.cc]);
    set('date', D.fullDate(m.date));
    const av = $('[data-r="avatar"]', reader);
    av.textContent = initials(m.from.name || m.from.address || '?');
    av.className = `avatar ${avatarClass(m.from.address || m.from.name || '?')}`;
    readerMode();
    renderReaderTags();
    stepButtons();
    restartClass($('[data-reader-body]', reader), 'reader-anim');
    $('.reader-scroll', reader).scrollTop = 0;

    const target = $('[data-r="body"]', reader);
    target.replaceChildren(h('div.reader-loading', {}, h('span.spinner'), 'Ouverture du mail…'));
    currentText = m.preview;
    currentFiles = [];
    markRead(i);
    if (i >= mails.length - 3) loadMore();
    try {
      const content = await mail.fetchBody(m);
      if (current !== i) return;
      const out = [];
      if (content.kind === 'html') {
        const { fragment, blockedImages } = sanitizeMail(content.content);
        if (blockedImages) {
          out.push(
            h('p.reader-note', {}, icon('image', 'ic ic--sm'), `${blockedImages} image${blockedImages > 1 ? 's' : ''} non chargée${blockedImages > 1 ? 's' : ''} : elles préviendraient l’expéditeur de ta lecture. `,
              h('a', { href: m.url, target: '_blank', rel: 'noopener', text: 'Voir dans la messagerie' })),
          );
        }
        out.push(h('div.reader-html', {}, fragment));
      } else out.push(h('div.reader-plain', {}, textToFragment(content.content)));
      currentText = content.kind === 'html' ? null : content.content;
      currentFiles = content.attachments;
      if (content.attachments.length) out.push(filesEl(m, content.attachments));
      target.replaceChildren(...out);
      if (currentText === null) currentText = $('.reader-html', target)?.innerText ?? m.preview;
    } catch (error) {
      if (current !== i) return;
      if (error instanceof NotSignedIn) {
        close();
        onSessionLost('mail');
        return;
      }
      target.replaceChildren(
        textToFragment(m.preview || ''),
        h('p.reader-note', {}, icon('alert', 'ic ic--sm'), `Contenu complet indisponible (${error.message}). `, h('a', { href: m.url, target: '_blank', rel: 'noopener', text: 'Ouvrir dans la messagerie' })),
      );
    }
  }

  // --------------------------------------------- messagerie plein écran (maquette v7)
  // Ordinateur (≥ 1100 px) : liste à gauche, lecture à droite. Tablette, téléphone : la liste en
  // plein écran, le mail par-dessus. Une seule sortie, « Fermer », en haut à droite.
  const mailExp = $('[data-mail-expand]', tile);
  const splitMQ = matchMedia('(min-width: 1100px)');
  const bentoEl = $('[data-bento]');
  let ghost = null;
  const expanded = () => tile.classList.contains('is-expanded');
  const docked = () => reader.classList.contains('is-docked');

  function markActive(i) {
    $$('.mail-row.is-active', tile).forEach((r) => {
      r.setAttribute('aria-current', 'false');
      r.classList.toggle('is-active', false);
    });
    const r = i >= 0 ? rowFor(i) : null;
    if (r) {
      r.setAttribute('aria-current', 'true');
      r.classList.add('is-active');
    }
  }

  function expandMail(animate = true) {
    if (expanded()) return;
    onExpand?.();
    const first = tile.getBoundingClientRect();
    ghost = h('div.tile-ghost', { class: (tile.className.match(/\b(cw|rh)-\d+\b/g) || []).join(' ') });
    ghost.style.setProperty('height', `${first.height}px`);
    tile.after(ghost);
    tile.classList.add('is-expanded', 'is-more');
    app.classList.add('has-expanded', 'mail-expanded');
    app.classList.toggle('mail-split', splitMQ.matches);
    $$('.bento > .tile').forEach((t) => t !== tile && (t.inert = true));
    lockScroll(true);
    mailExp.setAttribute('aria-pressed', 'true');
    mailExp.setAttribute('aria-label', 'Fermer la messagerie plein écran');
    const last = tile.getBoundingClientRect();
    if (animate && motionOK()) tile.animate([{ clipPath: clipFrom(first, last, 22) }, { clipPath: 'inset(0px 0px 0px 0px round 22px)' }], { duration: 520, easing: EASE });
  }

  function collapseMail() {
    if (!expanded()) return;
    if (selecting()) setSelecting(false); // la sélection n'existe qu'en plein écran
    if (!reader.hidden) {
      reader.hidden = true;
      reader.classList.toggle('is-docked', false);
      app.classList.toggle('has-overlay', false);
      bentoEl.inert = false;
    }
    markActive(-1);
    const finish = () => {
      tile.classList.toggle('is-expanded', false);
      if (!expandedMore && !searchInput.value.trim() && !tagFilter) tile.classList.toggle('is-more', false);
      app.classList.toggle('mail-expanded', false);
      app.classList.toggle('mail-split', false);
      ghost?.replaceWith();
      ghost = null;
      $$('.bento > .tile').forEach((t) => (t.inert = false));
      lockScroll(false);
      mailExp.setAttribute('aria-pressed', 'false');
      mailExp.setAttribute('aria-label', 'Afficher en plein écran');
      mailExp.focus({ preventScroll: true });
    };
    app.classList.toggle('has-expanded', false);
    if (motionOK() && ghost) {
      const to = ghost.getBoundingClientRect();
      const cur = tile.getBoundingClientRect();
      tile.animate([{ clipPath: 'inset(0px 0px 0px 0px round 22px)' }, { clipPath: clipFrom(to, cur, 22) }], { duration: 400, easing: EASE_IO }).onfinish = finish;
    } else finish();
  }

  function openDocked(i) {
    const wasHidden = reader.hidden;
    fill(i);
    reader.classList.add('is-docked');
    reader.hidden = false;
    markActive(i);
    rowFor(i)?.scrollIntoView({ block: 'nearest' });
    if (wasHidden && motionOK()) reader.animate([{ opacity: 0, transform: 'translateX(14px)' }, { opacity: 1, transform: 'none' }], { duration: 340, easing: EASE });
  }

  function open(i) {
    if (splitMQ.matches) {
      // Ordinateur : la messagerie passe en plein écran, liste et lecture côte à côte.
      if (!expanded()) expandMail();
      openDocked(i);
      return;
    }
    const row = rowFor(i);
    const first = row.getBoundingClientRect();
    fill(i);
    reader.classList.toggle('is-docked', false);
    reader.hidden = false;
    app.classList.add('has-overlay');
    bentoEl.inert = true;
    lockScroll(true);
    const last = reader.getBoundingClientRect();
    if (motionOK()) {
      reader.animate([{ clipPath: clipFrom(first, last, 12), opacity: 0.85 }, { clipPath: 'inset(0px 0px 0px 0px round 22px)', opacity: 1 }], { duration: 520, easing: EASE });
    } else reader.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 200 });
    $('[data-reader-close]', reader).focus();
  }

  function close() {
    if (reader.hidden || docked()) return collapseMail(); // côte à côte : « Fermer » ferme tout le plein écran
    const row = rowFor(current);
    app.classList.toggle('has-overlay', false);
    bentoEl.inert = false;
    const done = () => {
      reader.hidden = true;
      if (!expanded()) lockScroll(false);
      row?.focus({ preventScroll: true });
    };
    if (motionOK() && row) {
      row.scrollIntoView({ block: 'nearest' });
      const last = reader.getBoundingClientRect();
      const to = row.getBoundingClientRect();
      reader.animate([{ clipPath: 'inset(0px 0px 0px 0px round 22px)', opacity: 1 }, { clipPath: clipFrom(to, last, 12), opacity: 0.2 }], { duration: 380, easing: EASE_IO }).onfinish = done;
    } else done();
  }

  mailExp.addEventListener('click', () => (expanded() ? collapseMail() : expandMail()));
  $$('[data-mail-close]', tile).forEach((b) => b.addEventListener('click', collapseMail));
  splitMQ.addEventListener('change', () => {
    if (!expanded()) return;
    app.classList.toggle('mail-split', splitMQ.matches);
    if (reader.hidden) return;
    if (splitMQ.matches) {
      reader.classList.add('is-docked');
      app.classList.toggle('has-overlay', false);
      bentoEl.inert = false;
      markActive(current);
    } else {
      reader.classList.toggle('is-docked', false);
      app.classList.add('has-overlay');
      bentoEl.inert = true;
    }
  });
  // ↑ ↓ dans la liste : passe d'un mail à l'autre en lecture côte à côte
  tile.addEventListener('keydown', (e) => {
    if (!expanded() || !splitMQ.matches || (e.key !== 'ArrowDown' && e.key !== 'ArrowUp')) return;
    const row = e.target.closest('[data-mail]');
    if (!row) return;
    const rows = $$('.mail-row', tile).filter((r) => r.offsetParent);
    const k = rows.indexOf(row) + (e.key === 'ArrowDown' ? 1 : -1);
    if (k < 0 || k >= rows.length) return;
    e.preventDefault();
    rows[k].focus();
    openDocked(Number(rows[k].dataset.mail));
  });

  /** Retire le mail affiché de la liste et passe au suivant (ou ferme le lecteur). */
  function dropCurrent() {
    const m = mails[current];
    mails.splice(current, 1);
    ids = ids.filter((id) => id !== m.id);
    redraw();
    if (!mails.length) {
      reader.hidden = true;
      reader.classList.remove('is-docked');
      app.classList.remove('has-overlay');
      bentoEl.inert = false;
      if (!expanded()) lockScroll(false);
      if (!ids.length) load();
      return;
    }
    const next = Math.min(current, mails.length - 1);
    fill(next);
    if (docked()) markActive(next);
  }

  async function act(button, run, done) {
    const m = mails[current];
    if (!m || button.classList.contains('is-busy')) return;
    button.classList.add('is-busy');
    try {
      await run(m);
      toast(done, 'check');
      dropCurrent();
    } catch (err) {
      if (err instanceof NotSignedIn) return onSessionLost('mail');
      toast(`Action impossible : ${err.message}`, 'alert');
    } finally {
      button.classList.remove('is-busy');
    }
  }

  const delBtn = $('[data-mail-delete]', reader);
  delBtn.addEventListener('click', () => act(delBtn, async (m) => {
    await mail.moveTo([m], 'trash');
    if (m.unread) setUnread(unread - 1);
  }, 'Mail mis à la corbeille.'));
  const restoreBtn = $('[data-mail-restore]', reader);
  restoreBtn.addEventListener('click', () => act(restoreBtn, (m) => mail.moveTo([m], 'inbox'), 'Mail remis dans la boîte de réception.'));
  const destroyBtn = $('[data-mail-destroy]', reader);
  destroyBtn.addEventListener('click', () => {
    const m = mails[current];
    if (!m) return;
    // Suppression irréversible : confirmation explicite.
    if (!confirm(`Supprimer définitivement « ${m.subject} » ? Il ne pourra pas être récupéré.`)) return;
    act(destroyBtn, (x) => mail.destroy([x]), 'Mail supprimé définitivement.');
  });

  tile.addEventListener('click', (e) => {
    const row = e.target.closest('[data-mail]');
    if (!row) return;
    if (selecting()) togglePick(Number(row.dataset.mail), e.shiftKey);
    else open(Number(row.dataset.mail));
  });
  $$('[data-reader-close]', reader).forEach((b) => b.addEventListener('click', close));
  $$('[data-reader-step]', reader).forEach((b) =>
    b.addEventListener('click', async () => {
      const i = current + Number(b.dataset.readerStep);
      if (i < 0 || i >= ids.length) return;
      if (i >= mails.length) await loadMore();
      if (mails[i]) {
        fill(i);
        if (docked()) {
          markActive(i);
          rowFor(i)?.scrollIntoView({ block: 'nearest' });
        }
      }
    }),
  );
  $$('[data-reply]', reader).forEach((b) =>
    b.addEventListener('click', () => {
      const m = mails[current];
      if (!m) return;
      reader.hidden = true; // le compositeur prend la place du lecteur
      reader.classList.remove('is-docked');
      markActive(-1);
      onReply(b.dataset.reply, m, currentText);
    }),
  );
  reader.addEventListener('keydown', (e) => {
    if (e.target.closest('dialog')) return;
    if (e.key === 'ArrowRight' || (e.key === 'ArrowDown' && e.altKey)) $('[data-reader-step="1"]', reader).click();
    if (e.key === 'ArrowLeft') $('[data-reader-step="-1"]', reader).click();
  });

  // ------------------------------------------------------- étiquettes d'un mail

  const tagsDialog = $('dialog[data-tags-sheet]');
  const tagsSheet = modal(tagsDialog);
  let tagTargets = [];
  function openTags(targets) {
    tagTargets = targets;
    renderTagPick();
    tagsSheet.open();
  }
  function renderTagPick() {
    const targets = tagTargets.filter(Boolean);
    // Coché si tous les mails visés ont l'étiquette.
    const on = new Set(MP.tags().filter((t) => targets.length && targets.every((m) => MP.tagsOf(m).some((x) => x.id === t.id))).map((t) => t.id));
    const pick = $('[data-tag-pick]', tagsDialog);
    pick.replaceChildren(
      ...(MP.tags().length
        ? MP.tags().map((t) =>
            h(
              'li',
              {},
              h(
                'label.check',
                {},
                h('input', { type: 'checkbox', checked: on.has(t.id), on: { change: (e) => targets.forEach((m) => MP.setTag(m, t.id, e.target.checked)) } }),
                h('span.check-box', { attrs: { 'aria-hidden': 'true' } }),
                h('span.check-text', {}, h('span', {}, h('i.mdot', { class: `mtag--${t.color}` }), t.name)),
              ),
            ),
          )
        : [h('li.cs-none', { text: 'Aucune étiquette pour l’instant : crée la première ci-dessous.' })]),
    );
  }
  $('[data-mail-tag]', reader).addEventListener('click', () => openTags([mails[current]]));
  $('[data-tag-quick]', tagsDialog).addEventListener('submit', (e) => {
    e.preventDefault();
    const input = $('input', e.currentTarget);
    try {
      const t = MP.addTag(input.value);
      if (t) tagTargets.filter(Boolean).forEach((m) => MP.setTag(m, t.id, true));
      input.value = '';
      renderTagPick();
    } catch (err) {
      toast(err.message, 'alert');
    }
  });


  // --------------------------------------------- outils de la messagerie plein écran
  // Une barre discrète sous les filtres : « Sélectionner » et « Tout marquer comme lu ». En mode
  // sélection, un clic coche un mail (Maj + clic : une plage), et une barre d'actions groupées
  // apparaît : lus, non lus, étiquettes, corbeille (ou restaurer / supprimer dans la corbeille).
  const picked = new Set(); // indices dans `mails`
  let anchor = -1;
  const tools = h('div.mail-tools', { attrs: { 'aria-label': 'Outils de la messagerie' } });
  filters.after(tools);
  const selecting = () => tile.classList.contains('is-selecting');
  const pickedMails = () => [...picked].sort((a, b) => a - b).map((i) => mails[i]).filter(Boolean);

  // En-tête (plein écran) : « Sélectionner » et « Tout marquer comme lu », en icônes.
  const selectBtn = $('[data-mail-select]', tile);
  const readAllBtn = $('[data-mail-readall]', tile);
  selectBtn.addEventListener('click', () => setSelecting(!selecting()));
  readAllBtn.addEventListener('click', () => readAll());

  function renderTools() {
    selectBtn.setAttribute('aria-pressed', String(selecting()));
    readAllBtn.hidden = !(box === 'inbox' && unread > 0) || selecting();
    readAllBtn.title = `Tout marquer comme lu (${unread})`;
    readAllBtn.setAttribute('aria-label', readAllBtn.title);
    tools.hidden = !selecting();
    if (!selecting()) {
      tools.replaceChildren();
      return;
    }
    const n = picked.size;
    const act = (label, ic, run, cls = '') => h('button.btn.btn--sm', { type: 'button', class: cls, disabled: !n, on: { click: run } }, icon(ic, 'ic ic--sm'), label);
    tools.replaceChildren(
      h('span.mail-tools-n', { text: n ? `${n} sélectionné${n > 1 ? 's' : ''}` : 'Coche des mails' }),
      h('button.btn.btn--sm.btn--ghost', { type: 'button', text: n && n === visibleIdx().length ? 'Tout décocher' : 'Tout cocher', on: { click: toggleAll } }),
      h('span.spacer'),
      ...(box === 'trash'
        ? [act('Restaurer', 'restore', () => bulk('restore')), act('Supprimer', 'trash', () => bulk('destroy'), 'btn--danger-soft')]
        : [
            act('Lu', 'eye', () => bulk('read')),
            act('Non lu', 'eyeOff', () => bulk('unread')),
            act('Étiquettes', 'tag', () => openTags(pickedMails())),
            act('Corbeille', 'trash', () => bulk('trash'), 'btn--danger-soft'),
          ]),
      h('button.icon-btn.icon-btn--sm', { type: 'button', attrs: { 'aria-label': 'Quitter la sélection' }, title: 'Quitter la sélection', on: { click: () => setSelecting(false) } }, icon('x', 'ic ic--sm')),
    );
  }
  const visibleIdx = () => $$('[data-mail]', tile).filter((r) => !r.parentElement.hidden).map((r) => Number(r.dataset.mail));
  function paintPicks() {
    $$('[data-mail]', tile).forEach((r) => {
      const on = picked.has(Number(r.dataset.mail));
      r.classList.toggle('is-picked', on);
      if (selecting()) r.setAttribute('aria-pressed', String(on));
      else r.removeAttribute('aria-pressed');
    });
    renderTools();
  }
  function setSelecting(on) {
    tile.classList.toggle('is-selecting', on);
    picked.clear();
    anchor = -1;
    if (on && !reader.hidden && docked()) {
      reader.hidden = true;
      reader.classList.toggle('is-docked', false);
      markActive(-1);
    }
    paintPicks();
  }
  function togglePick(i, range) {
    if (range && anchor >= 0) {
      const vis = visibleIdx();
      const [a, b] = [vis.indexOf(anchor), vis.indexOf(i)].sort((x, y) => x - y);
      vis.slice(a, b + 1).forEach((k) => picked.add(k));
    } else if (picked.has(i)) picked.delete(i);
    else picked.add(i);
    anchor = i;
    paintPicks();
  }
  function toggleAll() {
    const vis = visibleIdx();
    if (picked.size === vis.length) picked.clear();
    else vis.forEach((i) => picked.add(i));
    paintPicks();
  }

  async function readAll() {
    if (!confirm(`Marquer les ${unread} mails non lus de ta boîte de réception comme lus ?`)) return;
    try {
      await mail.markAllRead('inbox');
      mails.forEach((m) => (m.unread = false));
      setUnread(0);
      redraw();
      toast('Tous les mails sont marqués comme lus.', 'check');
    } catch (err) {
      if (err instanceof NotSignedIn) return onSessionLost('mail');
      toast(`Action impossible : ${err.message}`, 'alert');
    }
  }

  async function bulk(kind) {
    const list = pickedMails();
    if (!list.length) return;
    if (kind === 'destroy' && !confirm(`Supprimer définitivement ${list.length} mail${list.length > 1 ? 's' : ''} ? Ils ne pourront pas être récupérés.`)) return;
    tools.classList.add('is-busy');
    try {
      if (kind === 'read' || kind === 'unread') {
        await mail.setSeen(list, kind === 'read');
        let delta = 0;
        list.forEach((m) => {
          if (m.unread === (kind === 'read')) delta += kind === 'read' ? -1 : 1;
          m.unread = kind === 'unread';
        });
        if (box === 'inbox') setUnread(unread + delta);
        redraw();
        toast(`${list.length} mail${list.length > 1 ? 's' : ''} marqué${list.length > 1 ? 's' : ''} comme ${kind === 'read' ? 'lu' : 'non lu'}${list.length > 1 ? 's' : ''}.`, 'check');
      } else {
        if (kind === 'trash') await mail.moveTo(list, 'trash');
        if (kind === 'restore') await mail.moveTo(list, 'inbox');
        if (kind === 'destroy') await mail.destroy(list);
        const gone = new Set(list.map((m) => m.id));
        if (box === 'inbox') setUnread(unread - list.filter((m) => m.unread).length);
        mails = mails.filter((m) => !gone.has(m.id));
        ids = ids.filter((id) => !gone.has(id));
        redraw();
        toast(
          kind === 'trash' ? `${list.length} mail${list.length > 1 ? 's' : ''} mis à la corbeille.` : kind === 'restore' ? `${list.length} mail${list.length > 1 ? 's' : ''} restauré${list.length > 1 ? 's' : ''}.` : `${list.length} mail${list.length > 1 ? 's' : ''} supprimé${list.length > 1 ? 's' : ''} définitivement.`,
          'check',
        );
        if (!ids.length) load();
      }
      picked.clear();
      paintPicks();
    } catch (err) {
      if (err instanceof NotSignedIn) return onSessionLost('mail');
      toast(`Action impossible : ${err.message}`, 'alert');
    } finally {
      tools.classList.toggle('is-busy', false);
    }
  }
  addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && selecting() && !document.querySelector('dialog[open]')) {
      e.stopPropagation();
      setSelecting(false);
    }
  }, true);

  // Toute modification d'étiquettes ou de règles se voit tout de suite.
  MP.onMailPrefs(() => {
    if (tagFilter && !MP.tagById(tagFilter)) tagFilter = null;
    if (!filters.hidden) renderFilters();
    if (list) redraw();
    if (!reader.hidden) renderReaderTags();
  });

  // Retour sur l'application ou du réseau : essai reporté repris, tuile en erreur relancée, ou
  // nouveau courrier si la dernière lecture a plus de 4 minutes (mise à jour discrète). Au plus une
  // relance toutes les 30 s.
  function resume() {
    if (document.visibilityState !== 'visible' || retryTimer || sync.classList.contains('is-busy')) return;
    if (pendingAttempt) return load({ attempt: pendingAttempt });
    const due = failed || (list && Date.now() - lastRefresh >= AUTO_REFRESH);
    if (!due || Date.now() - lastResume < 30_000) return;
    lastResume = Date.now();
    if (failed) load();
    else refreshQuietly();
  }
  document.addEventListener('visibilitychange', resume);
  addEventListener('online', resume);
  addEventListener('pageshow', (event) => event.persisted && resume());

  return {
    load,
    watchLoginAlerts,
    showSignedOut,
    close,
    isOpen: () => !reader.hidden || expanded(),
    unread: () => unread,
    /** Après l'ajout d'une règle : l'appliquer aux mails déjà affichés. */
    async applyRulesNow() {
      if (box !== 'inbox' || !mails.length) return;
      const before = mails.length;
      const kept = await withRules(mails.slice());
      if (kept.length !== before) {
        mails = kept;
        redraw();
      }
    },
  };
}
