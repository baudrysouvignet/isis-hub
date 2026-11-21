import { HOSTS } from './config.js';
import { http } from '../net/http.js';

const LOGIN_URL = `${HOSTS.cas}/cas/login`;
const CAS_HOST = new URL(HOSTS.cas).hostname;

export class LoginRefused extends Error {
  constructor() {
    super("Identifiant ou mot de passe refusé par le CAS de l'université.");
    this.name = 'LoginRefused';
  }
}

/** Le cookie « TGC » est la preuve de session que le CAS remet après une connexion réussie. */
export const hasCasSession = (jar) => jar.has(CAS_HOST, 'TGC');

/**
 * Connexion au CAS : charge le formulaire officiel, puis le soumet tel qu'un navigateur le ferait.
 * L'identifiant et le mot de passe ne sont ni conservés ni journalisés ; ils ne quittent cette
 * fonction que dans la requête chiffrée de bout en bout adressée à auth.univ-jfc.fr.
 */
export async function casLogin(jar, username, password) {
  aliveCheck = null;
  jar.clear(CAS_HOST);
  const form = await (await http(LOGIN_URL)).text();
  const execution = /<input[^>]*name="execution"[^>]*value="([^"]+)"/.exec(form)?.[1];
  if (!execution) throw new Error("Le formulaire de connexion du CAS n'a pas la forme attendue.");

  const body = new URLSearchParams({ username, password, execution, _eventId: 'submit', geolocation: '' });
  const res = await http(LOGIN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  if (hasCasSession(jar)) return;
  // Le CAS répond 401 quand il a examiné les identifiants et les a refusés.
  if (res.status === 401) throw new LoginRefused();
  throw new Error(`Le CAS a répondu de façon inattendue (HTTP ${res.status}).`);
}

/** Ferme la session côté université, puis oublie tous les cookies. */
export async function casLogout(jar) {
  aliveCheck = null;
  try {
    if (hasCasSession(jar)) await http(`${HOSTS.cas}/cas/logout`);
  } finally {
    jar.clear();
  }
}

/**
 * La session universitaire (CAS) est-elle encore valable ? Avant de déclarer « Session expirée »
 * parce qu'un portail (messagerie, Moodle) ne donne pas de session, on le demande au CAS : s'il
 * délivre encore un ticket, c'est le portail qui va mal (maintenance, panne), pas la session.
 * Le ticket demandé (pour l'ENT) n'est ni lu ni envoyé nulle part : il expire tout seul.
 * Rend true, false, ou null si le CAS ne répond pas. Seul « true » est gardé (30 s) : un « false »
 * gardé ferait croire la session perdue juste après une reconnexion.
 */
let aliveCheck = null;
export function casSessionAlive() {
  if (aliveCheck && Date.now() - aliveCheck.at < 30_000) return aliveCheck.result;
  const result = http(`${LOGIN_URL}?service=${encodeURIComponent(ENT_SERVICE)}`, { redirect: 'manual' })
    .then((res) => {
      if (res.location && /[?&]ticket=ST-/.test(res.location)) return true;
      if (res.status === 200) return false; // formulaire de connexion : plus de session
      return null;
    })
    .catch(() => null);
  aliveCheck = { at: Date.now(), result };
  result.then((r) => r !== true && aliveCheck?.result === result && (aliveCheck = null));
  return result;
}
export const forgetCasCheck = () => (aliveCheck = null);

// Service pour lequel le ticket d'identification de l'administrateur est demandé : l'ENT, déjà
// enregistré auprès du CAS (le serveur ISIS Hub ne l'est pas). Même valeur que ENTService côté serveur.
export const ENT_SERVICE = 'https://ent.univ-jfc.fr/uPortal/Login';

/**
 * Ticket de service CAS prouvant l'identité de l'étudiant connecté. La redirection vers l'ENT n'est
 * PAS suivie : le ticket, à usage unique, est remis au serveur ISIS Hub qui le fait valider.
 */
export async function adminTicket() {
  const res = await http(`${LOGIN_URL}?service=${encodeURIComponent(ENT_SERVICE)}`, { redirect: 'manual' });
  const ticket = res.location ? new URL(res.location).searchParams.get('ticket') : null;
  if (!ticket || !/^ST-/.test(ticket)) throw new Error('Pas de ticket CAS (session expirée ?)');
  return ticket;
}
