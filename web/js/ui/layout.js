// En-tête, menus, grille bento (tuiles affichées ou masquées), barre d'onglets mobile, fiches modales.

import { $, $$, h, icon, restartClass, motionOK, EASE } from '../core/dom.js';
import { prefs } from '../core/store.js';
import { subscriptionUrl } from '../portals/ade.js';
import { feedPath, choiceLabel } from '../portals/classes.js';

// ------------------------------------------------------------------ menus

const menuButtons = () => $$('[data-menu]');
export function closeMenus(except) {
  for (const b of menuButtons()) {
    if (b === except) continue;
    const m = document.getElementById(b.dataset.menu);
    if (m && !m.hidden) {
      m.hidden = true;
      b.setAttribute('aria-expanded', 'false');
    }
  }
}
export const anyMenuOpen = () => menuButtons().some((b) => b.getAttribute('aria-expanded') === 'true');

export function setupMenus() {
  for (const b of menuButtons()) {
    const m = document.getElementById(b.dataset.menu);
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      const open = m.hidden;
      closeMenus(b);
      m.hidden = !open;
      b.setAttribute('aria-expanded', String(open));
      if (open) $('[role^="menuitem"], input', m)?.focus();
    });
    m.addEventListener('keydown', (e) => {
      const items = $$('[role^="menuitem"]', m);
      const i = items.indexOf(document.activeElement);
      if (e.key === 'ArrowDown' && items.length) {
        e.preventDefault();
        items[(i + 1) % items.length].focus();
      }
      if (e.key === 'ArrowUp' && items.length) {
        e.preventDefault();
        items[(i - 1 + items.length) % items.length].focus();
      }
      if (e.key === 'Escape') {
        e.stopPropagation();
        closeMenus();
        b.focus();
      }
    });
    m.addEventListener('click', (e) => {
      if (e.target.closest('[role="menuitem"]')) closeMenus();
    });
  }
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.menu')) closeMenus();
  });
}

// ------------------------------------------------------------ grille bento

const desktopMQ = matchMedia('(min-width: 1180px)');

// Rangée Notes · Moodle · Rendus : largeurs selon les tuiles visibles, toujours 12 colonnes en tout.
const ROW = { 'notes,moodle,rendus': [4, 4, 4], 'notes,moodle': [4, 8], 'notes,rendus': [6, 6], 'moodle,rendus': [7, 5] };
function rowSizes(ids, hidden, rh) {
  const shown = ids.filter((id) => !hidden[id]);
  const widths = ROW[shown.join(',')] ?? [12];
  return Object.fromEntries(ids.map((id) => [id, [shown.includes(id) ? widths[shown.indexOf(id)] : 12, rh]]));
}

/** Largeur (sur 12 colonnes) et hauteur (rangées de 64 px) selon les tuiles visibles : jamais de trou. */
function sizesFor(hidden) {
  const on = (id) => !hidden[id];
  if (desktopMQ.matches) {
    return {
      edt: [on('mail') ? 8 : 12, 11],
      mail: [on('edt') ? 4 : 12, 11],
      ...rowSizes(['notes', 'moodle', 'rendus'], hidden, 5),
      links: [12, 1],
    };
  }
  return {
    edt: [12, 11],
    mail: [on('notes') ? 6 : 12, 9],
    notes: [on('mail') ? 6 : 12, 9],
    moodle: [on('rendus') ? 6 : 12, 7],
    rendus: [on('moodle') ? 6 : 12, 7],
    links: [12, 1],
  };
}

export function setupBento() {
  const bento = $('[data-bento]');
  const tiles = () => $$('[data-tile]', bento);
  const saved = prefs.get('view', null);
  const view = { hidden: saved?.hidden ?? {}, hiddenLinks: Array.isArray(saved?.hiddenLinks) ? saved.hiddenLinks : [] };

  function flip(mutate) {
    const els = tiles().filter((e) => !e.hidden);
    if (!motionOK()) return mutate();
    const first = new Map(els.map((e) => [e, e.getBoundingClientRect()]));
    mutate();
    for (const e of els) {
      if (e.hidden) continue;
      const a = first.get(e);
      const b = e.getBoundingClientRect();
      const dx = a.left - b.left;
      const dy = a.top - b.top;
      if (Math.abs(dx) < 1 && Math.abs(dy) < 1 && Math.abs(a.width - b.width) < 1 && Math.abs(a.height - b.height) < 1) continue;
      e.animate(
        [
          { transform: `translate(${dx}px, ${dy}px)`, clipPath: `inset(0 ${Math.max(0, b.width - a.width)}px ${Math.max(0, b.height - a.height)}px 0 round 22px)` },
          { transform: 'none', clipPath: 'inset(0 0 0 0 round 22px)' },
        ],
        { duration: 420, easing: EASE },
      );
    }
  }

  function render(animate) {
    const run = () => {
      const size = sizesFor(view.hidden);
      for (const t of tiles()) {
        const id = t.dataset.tile;
        t.hidden = Boolean(view.hidden[id]);
        t.classList.remove(...[...t.classList].filter((c) => /^(cw|rh)-\d+$/.test(c)));
        t.classList.add(`cw-${size[id][0]}`, `rh-${size[id][1]}`);
      }
      $$('[data-show-tile]').forEach((c) => (c.checked = !view.hidden[c.dataset.showTile]));
      $$('[data-link]').forEach((li) => (li.hidden = view.hiddenLinks.includes(li.dataset.link)));
      $$('[data-show-link]').forEach((c) => (c.checked = !view.hiddenLinks.includes(c.dataset.showLink)));
      const dock = { '#edt': 'edt', '#mails': 'mail', '#notes': 'notes', '#moodle': 'moodle' };
      $$('.dock a').forEach((a) => (a.hidden = Boolean(view.hidden[dock[a.getAttribute('href')]])));
    };
    if (animate) flip(run);
    else run();
  }

  render(false);
  setTimeout(() => bento.classList.add('is-ready'), 900);
  desktopMQ.addEventListener('change', () => render(false));
  $$('[data-show-tile]').forEach((c) =>
    c.addEventListener('change', () => {
      view.hidden[c.dataset.showTile] = !c.checked;
      if (tiles().every((t) => view.hidden[t.dataset.tile])) {
        view.hidden[c.dataset.showTile] = false; // au moins une tuile reste visible
        c.checked = true;
        return;
      }
      prefs.set('view', view);
      render(true);
      const t = $(`[data-tile="${c.dataset.showTile}"]`, bento);
      if (c.checked && t && motionOK()) t.animate([{ opacity: 0, transform: 'scale(.97)' }, { opacity: 1, transform: 'none' }], { duration: 420, easing: EASE });
    }),
  );

  // Les cases des raccourcis sont créées après coup (contenu publié) : écoute déléguée.
  document.addEventListener('change', (e) => {
    const c = e.target.closest?.('[data-show-link]');
    if (!c) return;
    view.hiddenLinks = $$('[data-show-link]').filter((x) => !x.checked).map((x) => x.dataset.showLink);
    prefs.set('view', view);
    render(false);
  });

  // Barre d'onglets (téléphone) : l'onglet touché s'allume tout de suite, puis l'onglet suit la
  // tuile qui occupe le milieu de l'écran pendant le défilement.
  const dockLinks = $$('.dock a');
  let pinned = 0; // pendant le défilement lancé par un onglet, l'onglet actif ne bouge pas
  const setCurrent = (id) => dockLinks.forEach((a) => a.setAttribute('aria-current', String(a.getAttribute('href') === `#${id}`)));
  const targets = () =>
    dockLinks
      .filter((a) => !a.hidden)
      .map((a) => document.querySelector(a.getAttribute('href')))
      .filter((t) => t && !t.hidden);
  dockLinks.forEach((a) =>
    a.addEventListener('click', (e) => {
      const t = document.querySelector(a.getAttribute('href'));
      if (!t) return;
      e.preventDefault();
      setCurrent(t.id);
      pinned = Date.now() + 1000;
      t.scrollIntoView({ behavior: motionOK() ? 'smooth' : 'auto', block: 'start' });
    }),
  );
  const pick = () => {
    if (Date.now() < pinned) return;
    const mid = innerHeight / 2;
    let best = null;
    let dist = Infinity;
    for (const t of targets()) {
      const r = t.getBoundingClientRect();
      const d = r.top <= mid && r.bottom >= mid ? 0 : Math.min(Math.abs(r.top - mid), Math.abs(r.bottom - mid));
      if (d < dist) [best, dist] = [t, d];
    }
    // Tout en bas d'une page qui défile, la dernière tuile l'emporte même si elle est courte.
    const root = document.documentElement;
    if (root.scrollHeight > innerHeight + 40 && innerHeight + scrollY >= root.scrollHeight - 4) best = targets().pop() ?? best;
    if (best) setCurrent(best.id);
  };
  // Au plus une mesure toutes les 100 ms pendant le défilement, plus une à l'arrêt.
  let last = 0;
  let trailing = 0;
  addEventListener(
    'scroll',
    () => {
      clearTimeout(trailing);
      if (Date.now() - last > 100) {
        last = Date.now();
        pick();
      }
      trailing = setTimeout(pick, 140);
    },
    { passive: true },
  );
  addEventListener('scrollend', () => ((pinned = 0), pick()));

  return {
    refresh: () => {
      render(false);
      pick();
    },
    /** À appeler quand le tableau de bord devient visible. */
    syncDock: pick,
  };
}

// ----------------------------------------------------------- fiches modales

// Tant qu'une fiche est ouverte, la page derrière ne défile plus (sinon, sur téléphone, glisser sur
// le fond ou sur l'en-tête de la fiche fait défiler le tableau de bord). Classe à part de
// lockScroll(), que le lecteur de mail, les notes et l'agenda plein écran gèrent eux-mêmes : fermer
// une fiche ouverte par-dessus eux ne libère pas leur blocage.
const syncModalLock = () =>
  document.documentElement.classList.toggle('is-modal', Boolean(document.querySelector('dialog[open]')));

export function modal(dialog, { onOpen, onClose } = {}) {
  const open = () => {
    if (dialog.open) return;
    closeMenus();
    dialog.showModal();
    syncModalLock();
    dialog.classList.remove('is-leaving');
    restartClass(dialog, 'is-entering');
    onOpen?.();
  };
  const close = () => {
    if (!dialog.open) return;
    dialog.classList.remove('is-entering');
    dialog.classList.add('is-leaving');
    let done = false;
    const end = () => {
      if (done) return;
      done = true;
      dialog.classList.remove('is-leaving');
      dialog.close();
      onClose?.();
    };
    dialog.addEventListener('animationend', end, { once: true });
    setTimeout(end, 420);
  };
  dialog.addEventListener('cancel', (e) => {
    e.preventDefault();
    close();
  });
  dialog.addEventListener('close', syncModalLock); // toute fermeture, même sans passer par close()
  dialog.addEventListener('click', (e) => {
    if (e.target === dialog) close();
  });
  $$('[data-sheet-close]', dialog).forEach((b) => b.addEventListener('click', close));
  return { open, close };
}

async function copyButton(button, text) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    return; // presse-papiers refusé
  }
  const prev = [...button.childNodes];
  const label = button.getAttribute('aria-label');
  button.replaceChildren(icon('check', 'ic ic--sm'));
  button.setAttribute('aria-label', 'Copié');
  setTimeout(() => {
    button.replaceChildren(...prev);
    button.setAttribute('aria-label', label);
  }, 1600);
}
export { copyButton };

// ------------------------------------------------------------ abonnement iCal

export function setupIcal(getClass) {
  const dialog = $('[data-ical]');
  const sheet = modal(dialog, {
    onOpen() {
      const { promo, choice } = getClass();
      // Classes à options : calendrier filtré produit par ISIS Hub à partir de l'export public d'ADE
      // (aucune donnée personnelle). Sans option : le lien d'ADE, lu directement par l'agenda.
      const feed = feedPath(promo, choice);
      const https = feed ? new URL(feed, location.href).href : subscriptionUrl(promo);
      $('[data-class-label]', dialog).textContent = [promo, choiceLabel(promo, choice)].filter(Boolean).join(' · ');
      $('[data-ical-source]', dialog).replaceChildren(
        feed ? 'Calendrier filtré par ISIS Hub' : 'Export iCal d’ADE pour ta classe',
        h('small', {
          text: feed
            ? 'Ton agenda lit ce lien sur ISIS Hub, qui le prépare à partir de l’export public d’ADE (aucune donnée personnelle, pas de compte).'
            : 'Ton agenda lit ce lien directement chez l’université, sans passer par ISIS Hub.',
        }),
      );
      const webcal = https.replace(/^https:/, 'webcal:');
      $('[data-ical="apple"]', dialog).href = webcal;
      $('[data-ical="google"]', dialog).href = `https://calendar.google.com/calendar/r?cid=${encodeURIComponent(webcal)}`;
      $('[data-ical="outlook"]', dialog).href =
        `https://outlook.live.com/calendar/0/addfromweb?url=${encodeURIComponent(https)}&name=${encodeURIComponent(`Emploi du temps ${promo} · ISIS`)}`;
      $('[data-ical-url]', dialog).textContent = https;
    },
  });
  $$('[data-open-ical]').forEach((b) => b.addEventListener('click', sheet.open));
  const copy = $('[data-copy-ical]', dialog);
  copy.addEventListener('click', () => copyButton(copy, $('[data-ical-url]', dialog).textContent));
  return sheet;
}

export { h };
