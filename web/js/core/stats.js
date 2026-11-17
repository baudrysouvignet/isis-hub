// Fréquentation anonyme : à l'ouverture du tableau de bord, la page dit seulement au serveur
// si c'est sa première ouverture du jour sur cet appareil. Aucun identifiant n'est envoyé ;
// le serveur ne garde que deux compteurs par jour (voir internal/feedback/stats.go).

import { prefs } from './store.js';
import { todayKey } from './dates.js';

let sent = false;
export function countVisit() {
  if (sent) return;
  sent = true;
  const today = todayKey();
  const first = prefs.get('seenDay') !== today;
  prefs.set('seenDay', today);
  fetch('api/ping', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ first }),
    credentials: 'omit',
    keepalive: true,
  }).catch(() => {});
}
