import { HOSTS } from '../lib/config.js';

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
 * L'identifiant et le mot de passe ne sont ni conservés ni journalisés ; ils ne quittent cette fonction
 * que dans la requête chiffrée adressée à auth.univ-jfc.fr.
 */
export async function casLogin(http, jar, username, password) {
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
  await res.text();
  if (hasCasSession(jar)) return;
  // Le CAS répond 401 quand il a examiné les identifiants et les a refusés.
  if (res.status === 401) throw new LoginRefused();
  throw new Error(`Le CAS a répondu de façon inattendue (HTTP ${res.status}).`);
}

/** Ferme la session côté université, puis oublie tous les cookies. */
export async function casLogout(http, jar) {
  try {
    if (hasCasSession(jar)) await (await http(`${HOSTS.cas}/cas/logout`)).text();
  } finally {
    jar.clear();
  }
}
