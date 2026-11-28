// Fréquentation anonyme, une fois par compte et par jour (voir internal/feedback/stats.go).
// À l'ouverture du tableau de bord, la page envoie seulement :
//   - first  : première ouverture du jour sur cet appareil ;
//   - token  : si l'étudiant est connecté, le jeton du jour tiré de sa sauvegarde chiffrée
//              (net/sync.js) : il compte un compte une fois par jour, tous appareils confondus,
//              sans rien dire de qui il est et sans lien d'un jour à l'autre ;
//   - class  : la classe choisie (FIE4…), sans groupe ni parcours ;
//   - device : téléphone, tablette ou ordinateur ; mode : application installée ou navigateur.
// Ni identifiant, ni nom, ni navigateur précis. Le serveur ne garde que des compteurs par jour.

import { prefs } from './store.js';
import { todayKey } from './dates.js';
import * as UD from './userdata.js';

function device() {
  const ua = navigator.userAgent;
  if (/iPad/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1) || (/Android/.test(ua) && !/Mobile/.test(ua))) return 'tablet';
  if (/Mobi|iPhone|iPod|Android/.test(ua)) return 'phone';
  return 'desktop';
}
const mode = () => (matchMedia('(display-mode: standalone)').matches || navigator.standalone === true ? 'app' : 'browser');

/** Attend (10 s au plus) que la sauvegarde soit branchée, pour compter le compte et pas l'appareil. */
function connected(signedIn) {
  return new Promise((resolve) => {
    if (!signedIn || UD.isConnected()) return resolve();
    const t0 = Date.now();
    const iv = setInterval(() => {
      if (UD.isConnected() || Date.now() - t0 > 10_000) {
        clearInterval(iv);
        resolve();
      }
    }, 250);
  });
}

/**
 * Rubrique ouverte (stages, salaires, tcg, notes, mails) : comptée une fois par chargement de la
 * page, avec le même jeton du jour. Le serveur compte les comptes distincts de chaque rubrique et
 * les rubriques ouvertes ensemble ce jour-là, sans rien savoir de qui il s'agit ni de ce qui y est
 * consulté ; les jetons du jour sont oubliés le lendemain.
 */
const PAGES = new Set(['stages', 'salaires', 'tcg', 'notes', 'mails']);
export async function countPage(page) {
  if (!PAGES.has(page) || sent.has(page)) return;
  sent.add(page);
  await connected(true);
  const token = await UD.visitToken(todayKey()).catch(() => null);
  const body = { first: false, page };
  if (token) body.token = token;
  fetch('api/ping', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    credentials: 'omit',
    keepalive: true,
  }).catch(() => {});
}

export const countStages = () => countPage('stages');

// Une fois par ouverture de la page et par état (visiteur, puis étudiant s'il se connecte ensuite).
const sent = new Set();
export async function countVisit({ signedIn = false, promo = '' } = {}) {
  const kind = signedIn ? 'account' : 'guest';
  if (sent.has(kind)) return;
  sent.add(kind);
  const today = todayKey();
  const first = prefs.get('seenDay') !== today;
  prefs.set('seenDay', today);
  await connected(signedIn);
  const token = signedIn ? await UD.visitToken(today) : null;
  const body = { first, device: device(), mode: mode() };
  if (token) body.token = token;
  if (/^[A-Z]{2,5}[0-9]{1,2}$/.test(promo ?? '')) body.class = promo;
  fetch('api/ping', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    credentials: 'omit',
    keepalive: true,
  }).catch(() => {});
}
