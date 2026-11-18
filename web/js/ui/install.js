// Tutoriel d'installation (application web) : proposé une fois après la première connexion,
// puis depuis le menu du compte. Rien n'est téléchargé : le navigateur crée simplement une
// icône qui ouvre ISIS Hub en plein écran.

import { $, $$ } from '../core/dom.js';
import { seen, markSeen } from '../core/seen.js';
import { modal } from './layout.js';
import { tourActive } from './tour.js';

const standalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;

function guessOS() {
  const ua = navigator.userAgent;
  if (/iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) return 'ios';
  if (/Android/.test(ua)) return 'android';
  return 'desktop';
}

export function setupInstall() {
  const dialog = $('dialog[data-install]');
  const tabs = $$('[data-install-tab]', dialog);
  const now = $('[data-install-now]', dialog);
  let deferred = null; // invitation d'installation de Chrome / Edge (Android, ordinateur)

  function select(os) {
    tabs.forEach((t) => t.setAttribute('aria-selected', String(t.dataset.installTab === os)));
    $$('[data-install-panel]', dialog).forEach((p) => (p.hidden = p.dataset.installPanel !== os));
    $('.install-tabs', dialog).dataset.active = os;
  }
  tabs.forEach((t) => t.addEventListener('click', () => select(t.dataset.installTab)));

  const sheet = modal(dialog, { onClose: () => markSeen('install') });
  const open = () => {
    select(guessOS());
    now.hidden = !deferred;
    sheet.open();
  };

  addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferred = e;
    now.hidden = false;
  });
  addEventListener('appinstalled', () => {
    deferred = null;
    markSeen('install');
    sheet.close();
  });
  now.addEventListener('click', async () => {
    if (!deferred) return;
    deferred.prompt();
    await deferred.userChoice.catch(() => null);
    deferred = null;
    now.hidden = true;
  });
  $$('[data-open-install]').forEach((b) => b.addEventListener('click', open));

  return {
    open,
    /** Après la première connexion : une seule fois, jamais dans l'application déjà installée. */
    maybeOffer() {
      if (standalone() || seen('install')) return;
      const wait = setInterval(() => {
        if (tourActive() || document.querySelector('dialog[open]')) return;
        clearInterval(wait);
        if (!seen('install')) open();
      }, 1500);
    },
  };
}
