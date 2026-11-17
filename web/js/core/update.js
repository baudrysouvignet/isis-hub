// Nouvelle version d'ISIS Hub : la page compare de temps en temps l'empreinte publiée dans
// /manifest.json avec celle du code qu'elle a chargé. Si elle a changé :
// - au retour sur l'onglet (ou l'application installée), et si rien n'est en cours : rechargement ;
// - sinon : un bandeau « Nouvelle version — Recharger », sans jamais interrompre ce qui est en cours
//   (mail en cours d'écriture, fiche ouverte…).
// Seul /manifest.json est demandé, sans cookie ni identifiant. Le serveur sert tout en
// « no-cache » : le rechargement récupère bien les fichiers modifiés, et seulement eux.

import { $ } from './dom.js';

const EVERY = 15 * 60_000; // vérification périodique, onglet visible
const MIN_GAP = 60_000; // au plus une vérification par minute

export function watchUpdates({ busy = () => false } = {}) {
  const bar = $('[data-update]');
  let loaded = null; // empreinte du code en cours d'exécution
  let available = false;
  let lastCheck = 0;

  async function fingerprint() {
    try {
      const res = await fetch('manifest.json', { cache: 'no-store', credentials: 'omit' });
      if (!res.ok) return null;
      const m = await res.json();
      return typeof m.fingerprint === 'string' ? m.fingerprint : null;
    } catch {
      return null; // hors ligne : on réessaiera
    }
  }

  const reload = () => location.reload();

  function offer() {
    if (!bar || !bar.hidden) return;
    bar.hidden = false;
  }

  async function check({ returning = false } = {}) {
    if (available) {
      if (returning && !busy()) reload();
      return;
    }
    if (!loaded || Date.now() - lastCheck < MIN_GAP) return;
    lastCheck = Date.now();
    const now = await fingerprint();
    if (!now || now === loaded) return;
    available = true;
    if (returning && !busy()) reload();
    else offer();
  }

  fingerprint().then((f) => {
    loaded = f;
    lastCheck = Date.now();
  });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') check({ returning: true });
  });
  addEventListener('online', () => check());
  setInterval(() => document.visibilityState === 'visible' && check(), EVERY);

  $('[data-update-reload]', bar ?? document)?.addEventListener('click', reload);
  $('[data-update-dismiss]', bar ?? document)?.addEventListener('click', () => (bar.hidden = true));

  return { check, get available() { return available; } };
}
