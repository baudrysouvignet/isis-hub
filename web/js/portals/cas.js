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
  try {
    if (hasCasSession(jar)) await http(`${HOSTS.cas}/cas/logout`);
  } finally {
    jar.clear();
  }
}

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
