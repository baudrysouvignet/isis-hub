// Boucle « Session expirée » après Touch ID (v1.1.0) : des requêtes parties AVANT la reconnexion
// revenaient APRÈS et écrasaient la session neuve. Ces tests rejouent ces courses.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { CookieJar, createClient } from '../web/js/net/session.js';
import { useTransport } from '../web/js/net/http.js';
import { HOSTS, NotSignedIn } from '../web/js/portals/config.js';
import * as mail from '../web/js/portals/mail.js';

const CAS = new URL('https://auth.univ-jfc.fr/cas/login');
const ALLOWED = new Set(['auth.univ-jfc.fr', 'mail.univ-jfc.fr', 'moodle.univ-jfc.fr']);
const settle = () => new Promise((r) => setTimeout(r, 0));
const empty = new Uint8Array();

/** Transport aux réponses tenues à la main, dans l'ordre qu'on veut. */
function heldRaw() {
  const pending = [];
  const raw = (url, init) => new Promise((resolve) => pending.push({ url, init, resolve }));
  return { raw, pending };
}

test('cookies : la page du CAS d’une requête en retard n’efface plus la session neuve', async () => {
  const { raw, pending } = heldRaw();
  const jar = new CookieJar();
  const http = createClient({ raw, jar, allowedHosts: ALLOWED });

  const stale = http(CAS.href); // partie quand il n'y avait plus de session
  await settle();
  const login = http(CAS.href, { method: 'POST', body: 'u&p' }); // Touch ID : reconnexion
  await settle();
  pending[1].resolve({ status: 200, setCookies: ['TGC=TGT-neuf; Path=/cas; Secure; HttpOnly'], body: empty });
  await login;
  assert.ok(jar.has('auth.univ-jfc.fr', 'TGC'));

  // La réponse en retard : le formulaire du CAS, qui efface TGC faute de session.
  pending[0].resolve({ status: 200, setCookies: ['TGC=; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:10 GMT; Path=/cas; Secure; HttpOnly'], body: empty });
  await stale;
  assert.ok(jar.has('auth.univ-jfc.fr', 'TGC'), 'la session ouverte après ne doit pas être effacée');

  // Une requête partie APRÈS peut toujours constater la fin de session.
  const later = http(CAS.href);
  await settle();
  pending[2].resolve({ status: 200, setCookies: ['TGC=; Max-Age=0; Path=/cas; Secure; HttpOnly'], body: empty });
  await later;
  assert.equal(jar.has('auth.univ-jfc.fr', 'TGC'), false);
});

test('cookies : après un effacement, une réponse en retard ne remet pas l’ancienne session', async () => {
  const { raw, pending } = heldRaw();
  const jar = new CookieJar();
  const http = createClient({ raw, jar, allowedHosts: ALLOWED });
  const stale = http('https://moodle.univ-jfc.fr/my/');
  await settle();
  jar.clear(); // session perdue : tout est effacé
  pending[0].resolve({ status: 200, setCookies: ['MoodleSession=ancienne; path=/'], body: empty });
  await stale;
  assert.equal(jar.header(new URL('https://moodle.univ-jfc.fr/my/')), '');
  // jar.clear(hôte) : même règle, pour cet hôte seulement.
  jar.store(new URL('https://moodle.univ-jfc.fr/my/'), ['MoodleSession=m2; path=/']);
  const staleCas = http(CAS.href);
  await settle();
  jar.clear('auth.univ-jfc.fr');
  pending[1].resolve({ status: 200, setCookies: ['TGC=TGT-ancien; Path=/cas'], body: empty });
  await staleCas;
  assert.equal(jar.has('auth.univ-jfc.fr', 'TGC'), false);
  assert.equal(jar.header(new URL('https://moodle.univ-jfc.fr/my/')), 'MoodleSession=m2');
});

test('messagerie : après une déconnexion, l’ouverture de session d’avant n’est plus réutilisée', async () => {
  const calls = [];
  useTransport((url, init) => new Promise((resolve) => calls.push({ url, init, resolve })));
  const json = (url, body) => ({ status: 200, ok: true, url, redirected: false, json: async () => body, text: async () => JSON.stringify(body) });

  const stale = mail.connect(); // lancée avant la perte de session, encore en route
  await settle();
  mail.reset(); // session perdue
  const fresh = mail.connect(); // Touch ID : nouvelle ouverture
  await settle();
  assert.equal(calls.length, 2, 'une nouvelle ouverture, pas la réutilisation de l’ancienne');

  calls[1].resolve(json(`${HOSTS.mail}/session-infos`, { sid: 'sid-neuf', domain: 'univ-jfc.fr', userId: 'u1' }));
  await fresh;
  // L'ancienne aboutit sur le formulaire du CAS : elle échoue, sans toucher à la session neuve.
  calls[0].resolve({ status: 200, ok: true, url: `${HOSTS.cas}/cas/login?service=x`, redirected: true, json: async () => ({}), text: async () => '<html>' });
  await assert.rejects(stale, NotSignedIn);

  const next = mail.listInbox();
  next.catch(() => {});
  await settle();
  assert.equal(calls.length, 3);
  assert.equal(calls[2].init.headers['X-BM-ApiKey'], 'sid-neuf', 'la session neuve sert aux appels suivants');
});
