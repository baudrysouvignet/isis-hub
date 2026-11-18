// « Déjà vu » : visite guidée, invitation à installer l'application, nouveautés de chaque version.
// Gardé dans les données personnelles (core/userdata.js) : chiffré, dans la sauvegarde anonyme,
// donc une seule fois PAR UTILISATEUR, quel que soit l'appareil. Sans connexion, l'appareil s'en
// souvient (préférences locales) ; à la connexion, les deux se rejoignent.

import * as UD from './userdata.js';
import { prefs } from './store.js';

const LOCAL = { tour: 'tourDone', install: 'installSeen', changelog: 'changelogSeen' };

/** Valeur enregistrée (true, ou numéro de version pour les nouveautés), sinon null. */
export function seen(key) {
  const s = UD.get('seen');
  if (s && typeof s === 'object' && s[key] !== undefined && s[key] !== null) return s[key];
  return prefs.get(LOCAL[key], null);
}

export function markSeen(key, value = true) {
  prefs.set(LOCAL[key], value);
  const s = UD.get('seen');
  const cur = s && typeof s === 'object' && !Array.isArray(s) ? s : {};
  if (cur[key] === value) return;
  UD.set('seen', { ...cur, [key]: value });
}

/**
 * Attend que la sauvegarde du serveur soit lue (sinon un appareil neuf reverrait tout) ; rend la
 * main tout de suite sans connexion, et au plus tard après `max` millisecondes.
 */
export function whenKnown(signedIn, max = 10_000) {
  return new Promise((resolve) => {
    if (!signedIn || UD.isReady()) return resolve();
    const t0 = Date.now();
    const iv = setInterval(() => {
      const st = UD.syncStatus();
      if (UD.isReady() || st === 'error' || (st === 'off' && Date.now() - t0 > 3000) || Date.now() - t0 > max) {
        clearInterval(iv);
        resolve();
      }
    }, 250);
  });
}

/**
 * Reprise de l'existant : ce qui a été vu sur cet appareil avant la sauvegarde du « déjà vu »
 * (versions ≤ 1.0.4) rejoint la sauvegarde de l'étudiant connecté.
 */
export function adoptLocal() {
  if (!UD.isReady()) return;
  const s = UD.get('seen');
  const cur = s && typeof s === 'object' && !Array.isArray(s) ? s : {};
  const add = {};
  for (const [key, pref] of Object.entries(LOCAL)) {
    const v = prefs.get(pref, null);
    if ((cur[key] === undefined || cur[key] === null) && v !== null && v !== false) add[key] = v;
  }
  if (Object.keys(add).length) UD.set('seen', { ...cur, ...add });
}

/** À la déconnexion : l'appareil oublie le « déjà vu » (le suivant n'hérite de rien). */
export function forgetLocal() {
  for (const pref of Object.values(LOCAL)) prefs.set(pref, null);
}
