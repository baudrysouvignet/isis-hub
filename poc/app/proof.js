// Vérifications sans identifiant, lancées depuis l'écran « Transparence » : elles montrent que la page
// joint bien chaque portail à travers le transport en place, et qu'elle refuse toute autre destination.
import { HOSTS } from './lib/config.js';
import { fetchSchedule } from './lib/ade.js';
import * as D from './lib/dates.js';

const CHECKS = [
  [
    'ADE : emploi du temps lu',
    async () => {
      const monday = D.mondayOf(D.today());
      const events = await fetchSchedule('FIA4', monday, D.addDays(monday, 27));
      return `${events.length} séance(s) sur 4 semaines`;
    },
  ],
  [
    'CAS : formulaire officiel reçu (rien n’est envoyé)',
    async (http) => {
      const html = await (await http(`${HOSTS.cas}/cas/login`)).text();
      if (html.includes('name="password"')) return 'champs identifiant et mot de passe présents';
      // En mode extension avec une session déjà ouverte, le CAS n'affiche plus le formulaire.
      if (/TGC|success|réussi/i.test(html)) return 'session déjà ouverte';
      throw new Error('formulaire introuvable');
    },
  ],
  [
    'Moodle : configuration publique lue',
    async (http) => {
      const res = await http(`${HOSTS.moodle}/lib/ajax/service-nologin.php?info=tool_mobile_get_public_config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([{ index: 0, methodname: 'tool_mobile_get_public_config', args: {} }]),
      });
      const [out] = await res.json();
      return `connexion par ${out.data.identityproviders.map((p) => p.name).join(', ')}`;
    },
  ],
  [
    'Messagerie : serveur joint',
    async (http) => {
      const res = await http(`${HOSTS.mail}/session-infos`);
      await res.text();
      const host = new URL(res.url).hostname;
      return host === new URL(HOSTS.mail).hostname ? 'session ouverte' : `sans session, renvoyé vers ${host}`;
    },
  ],
  [
    'Autre destination refusée',
    async (http) => {
      try {
        await http('https://example.com/');
      } catch (error) {
        return error.message;
      }
      throw new Error('example.com a répondu : la page n’est pas verrouillée');
    },
    'web', // l'extension, elle, est verrouillée par les permissions du navigateur
  ],
];

/** Lance les vérifications une à une ; `report(label, ok, detail)` est appelé après chacune. */
export async function runProof(http, mode, report) {
  for (const [label, run, only] of CHECKS) {
    if (only && only !== mode) continue;
    try {
      report(label, true, await run(http));
    } catch (error) {
      report(label, false, error.message);
    }
  }
}
