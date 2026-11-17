// Tuile « Mails » : liste chargée au fil du défilement, lecteur plein écran dans le Hub.
// Ouvrir un mail le marque comme lu dans la vraie boîte (drapeau \Seen côté serveur).

import { $, $$, h, icon, restartClass, clipFrom, lockScroll, motionOK, toast, EASE, EASE_IO } from '../core/dom.js';
import * as D from '../core/dates.js';
import * as mail from '../portals/mail.js';
import { sanitizeMail, textToFragment } from '../portals/sanitize.js';
import { NotSignedIn } from '../portals/config.js';

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
const kb = (n) => (n > 1048576 ? `${(n / 1048576).toFixed(1)} Mo` : `${Math.max(1, Math.round(n / 1024))} Ko`);

export function createMails({ app, onSessionLost, onLogin, onReply }) {
  const tile = $('.tile--mail');
  const slot = $('[data-slot="mail"]', tile);
  const live = $('[data-mail-live]', tile);
  const reader = $('[data-reader]');
  const badges = () => [$('[data-unread-count]', tile)];
  const dockLabel = $('[data-dock-mail]');

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
  let currentText = '';
  const searchBox = $('[data-mail-searchbox]', tile);
  const searchInput = $('[data-mail-search]', tile);
  const searchCount = $('[data-mail-search-n]', tile);
  const noResult = $('[data-mail-noresult]', tile);
  const showMore = $('[data-mail-showmore]', tile);
  const sync = $('[data-sync="mail"]', tile);

  function setUnread(n) {
    unread = Math.max(0, n);
    for (const b of badges()) {
      b.textContent = String(unread);
      b.setAttribute('aria-label', `${unread} non lus`);
      b.hidden = unread === 0;
    }
    dockLabel.textContent = unread ? `Mails · ${unread}` : 'Mails';
  }

  const empty = (cls, ic, title, text, action) =>
    h('div.empty', { class: cls }, h('span.empty-ic', {}, icon(ic, 'ic ic--lg')), h('h3', { text: title }), h('p', { text }), action);

  function chrome(listShown) {
    searchBox.hidden = !listShown;
    showMore.hidden = !listShown || ids.length <= 5;
    sync.hidden = !listShown && !lastRefresh;
    noResult.hidden = true;
    if (!listShown) {
      searchInput.value = '';
      expanded = false;
      tile.classList.remove('is-searching', 'is-more');
    }
  }

  function showSignedOut(expired) {
    generation++;
    ids = [];
    lastRefresh = 0;
    chrome(false);
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

  function rowEl(m, i) {
    const name = m.from.name || m.from.address || 'Expéditeur inconnu';
    return h(
      'li',
      {},
      h(
        'button.mail-row',
        { type: 'button', class: m.unread ? 'is-unread' : '', data: { mail: i } },
        h('span.avatar', { class: avatarClass(m.from.address || name), text: initials(name), attrs: { 'aria-hidden': 'true' } }),
        h('span.mail-from', { text: name }),
        h('span.mail-time', {}, m.unread && h('span.sr-only', { text: 'Non lu, ' }), D.relative(m.date)),
        h('span.mail-subj', { text: m.subject }),
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

  function endOfList() {
    more.classList.add('is-end');
    more.removeAttribute('aria-hidden');
    more.replaceChildren(mails.length ? 'Tu as atteint le début de ta boîte de réception.' : '');
    observer?.disconnect();
  }

  async function loadMore() {
    if (loading || mails.length >= ids.length) return;
    loading = true;
    const gen = generation;
    try {
      const batch = await mail.getMails(ids.slice(mails.length, mails.length + PAGE));
      if (gen !== generation) return;
      append(batch);
      if (mails.length > PAGE) live.textContent = `${batch.length} mails plus anciens chargés, ${mails.length} au total.`;
      if (mails.length >= ids.length) endOfList();
      if (!reader.hidden) stepButtons();
    } catch (error) {
      if (gen === generation) toast(`Mails plus anciens indisponibles : ${error.message}`);
    } finally {
      loading = false;
      // si la fin de liste est encore visible, on continue
      if (gen === generation && mails.length < ids.length && more.getBoundingClientRect().top < list.getBoundingClientRect().bottom + 240) {
        setTimeout(loadMore, 0);
      }
    }
  }

  async function load() {
    const gen = ++generation;
    chrome(false);
    sync.hidden = false;
    sync.classList.add('is-busy');
    sync.textContent = 'Mise à jour…';
    showLoading();
    try {
      const result = await mail.listInbox();
      if (gen !== generation) return;
      ids = result.ids;
      mails = [];
      setUnread(result.unread);
      lastRefresh = Date.now();
      if (!ids.length) {
        slot.replaceChildren(empty('', 'inbox', 'Aucun mail', 'Ta boîte de réception universitaire est vide.'));
        return;
      }
      more = h(
        'li.mail-more',
        { attrs: { 'aria-hidden': 'true' } },
        h('div.skel-mail', {}, h('span.skel.skel--av'), h('div', {}, h('span.skel.skel--line.w-40'), h('span.skel.skel--line.w-90'))),
        h('div.skel-mail', {}, h('span.skel.skel--av'), h('div', {}, h('span.skel.skel--line.w-50'), h('span.skel.skel--line.w-70'))),
      );
      list = h('ul.mail-list', { data: { mailList: '' } }, more);
      const first = await mail.getMails(ids.slice(0, PAGE));
      if (gen !== generation) return;
      slot.replaceChildren(list);
      append(first);
      chrome(true);
      if (searchInput.value.trim()) filter();
      if (mails.length >= ids.length) endOfList();
      observer?.disconnect();
      observer = new IntersectionObserver((entries) => entries.some((x) => x.isIntersecting) && loadMore(), {
        root: list,
        rootMargin: '0px 0px 240px 0px',
      });
      if (mails.length < ids.length) observer.observe(more);
    } catch (error) {
      if (gen !== generation) return;
      if (error instanceof NotSignedIn) onSessionLost('mail');
      else showError(error);
    } finally {
      if (gen === generation) renderSync();
    }
  }

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

  // --------------------------------------------------------- recherche

  const norm = (t) => t.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
  function filter() {
    const q = norm(searchInput.value.trim());
    tile.classList.toggle('is-searching', Boolean(q));
    let n = 0;
    for (const row of $$('[data-mail]', tile)) {
      const m = mails[Number(row.dataset.mail)];
      const hay = norm(`${m.from.name} ${m.from.address} ${m.subject} ${m.preview}`);
      const ok = !q || hay.includes(q);
      row.parentElement.hidden = !ok;
      if (ok) n++;
    }
    $$('.mail-sep', tile).forEach((x) => (x.hidden = Boolean(q)));
    if (more) more.hidden = Boolean(q);
    // La recherche montre tous les résultats ; une fois effacée, on revient à l'état choisi.
    tile.classList.toggle('is-more', Boolean(q) || expanded);
    searchCount.textContent = q ? `${n} résultat${n > 1 ? 's' : ''}` : '';
    noResult.hidden = !q || n > 0;
    if (q && n === 0) {
      const left = ids.length - mails.length;
      noResult.replaceChildren(
        `Aucun des ${mails.length} mails chargés ne correspond à « ${searchInput.value.trim()} ».`,
        left > 0 ? h('br') : '',
        left > 0 ? h('button.linklike', { type: 'button', text: `Chercher aussi dans les ${Math.min(left, 100)} suivants`, on: { click: searchOlder } }) : '',
      );
    }
  }
  async function searchOlder() {
    for (let i = 0; i < 5 && mails.length < ids.length; i++) await loadMore();
    filter();
  }
  searchInput.addEventListener('input', filter);
  searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && searchInput.value) {
      e.stopPropagation();
      searchInput.value = '';
      filter();
    }
  });
  let expanded = false; // « Afficher plus » cliqué (téléphone)
  showMore.addEventListener('click', () => {
    expanded = true;
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
    setUnread(unread - 1);
    try {
      const confirmed = await mail.markRead(m);
      if (!confirmed) toast('La messagerie n’a pas confirmé la lecture de ce mail.');
    } catch (error) {
      m.unread = true;
      row?.classList.add('is-unread');
      setUnread(unread + 1);
      toast(`Mail non marqué comme lu : ${error.message}`);
    }
  }

  async function fill(i) {
    const m = mails[i];
    current = i;
    const set = (k, v) => ($(`[data-r="${k}"]`, reader).textContent = v);
    set('subject', m.subject);
    set('name', m.from.name || m.from.address);
    set('email', m.from.address && m.from.name ? `<${m.from.address}>` : '');
    set('to', [...m.to, ...m.cc].map(who).join(', ') || '—');
    set('date', D.fullDate(m.date));
    const av = $('[data-r="avatar"]', reader);
    av.textContent = initials(m.from.name || m.from.address || '?');
    av.className = `avatar ${avatarClass(m.from.address || m.from.name || '?')}`;
    $('[data-reader-open]', reader).href = m.url;
    stepButtons();
    restartClass($('[data-reader-body]', reader), 'reader-anim');
    $('.reader-scroll', reader).scrollTop = 0;

    const target = $('[data-r="body"]', reader);
    target.replaceChildren(h('div.reader-loading', {}, h('span.spinner'), 'Ouverture du mail…'));
    currentText = m.preview;
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
      if (content.attachments.length) {
        out.push(
          h(
            'ul.reader-files',
            {},
            ...content.attachments.map((a) =>
              h('li', {}, h('a', { href: m.url, target: '_blank', rel: 'noopener' }, icon('clip', 'ic ic--sm'), h('span', { text: a.name }), a.size ? h('small', { text: kb(a.size) }) : null)),
            ),
          ),
        );
      }
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

  function open(i) {
    const row = rowFor(i);
    const first = row.getBoundingClientRect();
    fill(i);
    reader.hidden = false;
    app.classList.add('has-overlay');
    $('[data-bento]').inert = true;
    lockScroll(true);
    const last = reader.getBoundingClientRect();
    if (motionOK()) {
      reader.animate([{ clipPath: clipFrom(first, last, 12), opacity: 0.85 }, { clipPath: 'inset(0px 0px 0px 0px round 22px)', opacity: 1 }], { duration: 520, easing: EASE });
    } else reader.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 200 });
    $('[data-reader-close]', reader).focus();
  }

  function close() {
    if (reader.hidden) return;
    const row = rowFor(current);
    app.classList.remove('has-overlay');
    $('[data-bento]').inert = false;
    const done = () => {
      reader.hidden = true;
      lockScroll(false);
      row?.focus({ preventScroll: true });
    };
    if (motionOK() && row) {
      row.scrollIntoView({ block: 'nearest' });
      const last = reader.getBoundingClientRect();
      const to = row.getBoundingClientRect();
      reader.animate([{ clipPath: 'inset(0px 0px 0px 0px round 22px)', opacity: 1 }, { clipPath: clipFrom(to, last, 12), opacity: 0.2 }], { duration: 380, easing: EASE_IO }).onfinish = done;
    } else done();
  }

  tile.addEventListener('click', (e) => {
    const row = e.target.closest('[data-mail]');
    if (row) open(Number(row.dataset.mail));
  });
  $$('[data-reader-close]', reader).forEach((b) => b.addEventListener('click', close));
  $$('[data-reader-step]', reader).forEach((b) =>
    b.addEventListener('click', async () => {
      const i = current + Number(b.dataset.readerStep);
      if (i < 0 || i >= ids.length) return;
      if (i >= mails.length) await loadMore();
      if (mails[i]) fill(i);
    }),
  );
  $$('[data-reply]', reader).forEach((b) =>
    b.addEventListener('click', () => {
      const m = mails[current];
      if (!m) return;
      reader.hidden = true; // le compositeur prend la place du lecteur
      onReply(b.dataset.reply, m, currentText);
    }),
  );
  reader.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown' && e.altKey) $('[data-reader-step="1"]', reader).click();
    if (e.key === 'ArrowLeft') $('[data-reader-step="-1"]', reader).click();
  });

  // Nouveau courrier : rafraîchi quand on revient sur l'onglet (au plus toutes les 2 minutes).
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && list && reader.hidden && Date.now() - lastRefresh > 120_000) load();
  });

  return {
    load,
    showSignedOut,
    close,
    isOpen: () => !reader.hidden,
    unread: () => unread,
  };
}
