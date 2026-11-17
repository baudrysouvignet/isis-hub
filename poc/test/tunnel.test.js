import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { CookieJar, createClient } from '../app/platform/tunnel.js';
import { casLogin, casLogout, hasCasSession, LoginRefused } from '../app/platform/cas.js';
import { NotLoggedIn } from '../app/lib/config.js';
import { setTransport } from '../app/lib/http.js';
import * as moodle from '../app/lib/moodle.js';
import * as mail from '../app/lib/mail.js';
import { createPortals } from './support/fake-portals.js';

const HOSTS = new Set(['auth.univ-jfc.fr', 'moodle.univ-jfc.fr', 'mail.univ-jfc.fr', 'adecampus.univ-jfc.fr']);
const at = (href) => new URL(href);

function setup() {
  const portals = createPortals();
  const jar = new CookieJar();
  const http = createClient({ raw: portals.raw, jar, allowedHosts: HOSTS });
  setTransport(http);
  return { ...portals, jar, http };
}

beforeEach(() => {
  moodle.reset();
  mail.reset();
});

test('CookieJar : portée par hôte et par chemin, suppression, expiration', () => {
  let saves = 0;
  const jar = new CookieJar([], () => saves++);
  jar.store(at('https://auth.univ-jfc.fr/cas/login'), ['TGC=abc; Path=/cas; Secure; HttpOnly', 'LOCALE=fr; Path=/']);
  jar.store(at('https://adecampus.univ-jfc.fr/jsp/custom/cal.jsp'), ['JSESSIONID=J1; Path=/jsp; Secure']);
  jar.store(at('https://moodle.univ-jfc.fr/a/b/page.php'), ['sansChemin=1']);

  assert.equal(jar.header(at('https://auth.univ-jfc.fr/cas/login?service=x')), 'TGC=abc; LOCALE=fr');
  assert.equal(jar.header(at('https://auth.univ-jfc.fr/casse')), 'LOCALE=fr'); // « /cas » ne couvre pas « /casse »
  assert.equal(jar.header(at('https://mail.univ-jfc.fr/cas/login')), ''); // cookie d'hôte : jamais envoyé ailleurs
  assert.equal(jar.header(at('https://adecampus.univ-jfc.fr/direct/')), '');
  assert.equal(jar.header(at('https://moodle.univ-jfc.fr/a/b/autre.php')), 'sansChemin=1');
  assert.equal(jar.header(at('https://moodle.univ-jfc.fr/a/')), '');

  // Un portail ne peut pas poser de cookie pour un autre domaine.
  jar.store(at('https://moodle.univ-jfc.fr/'), ['vol=1; Domain=auth.univ-jfc.fr', 'large=1; Domain=fr']);
  assert.equal(jar.header(at('https://auth.univ-jfc.fr/')), 'LOCALE=fr');

  assert.equal(jar.has('auth.univ-jfc.fr', 'TGC'), true);
  jar.store(at('https://auth.univ-jfc.fr/cas/login'), ['TGC=; Max-Age=0; Path=/cas']);
  assert.equal(jar.has('auth.univ-jfc.fr', 'TGC'), false);

  jar.store(at('https://mail.univ-jfc.fr/'), ['vieux=1; Expires=Thu, 01 Jan 1970 00:00:10 GMT', 'court=1; Max-Age=3600']);
  assert.equal(jar.header(at('https://mail.univ-jfc.fr/')), 'court=1');

  // La sauvegarde ne contient que des cookies vivants et se recharge à l'identique.
  const copy = new CookieJar(JSON.parse(JSON.stringify(jar)));
  assert.equal(copy.header(at('https://adecampus.univ-jfc.fr/jsp/x')), 'JSESSIONID=J1');
  assert.ok(saves >= 5);

  jar.clear();
  assert.deepEqual(jar.toJSON(), []);
});

test('client : redirections façon navigateur, en-têtes privés non transmis, destinations verrouillées', async () => {
  const seen = [];
  const pages = {
    'https://mail.univ-jfc.fr/api/x': { status: 302, location: 'https://auth.univ-jfc.fr/cas/login' },
    'https://auth.univ-jfc.fr/cas/login': { status: 200 },
    'https://moodle.univ-jfc.fr/post': { status: 302, location: '/suite' },
    'https://moodle.univ-jfc.fr/suite': { status: 200 },
    'https://moodle.univ-jfc.fr/garde': { status: 307, location: '/suite' },
    'https://moodle.univ-jfc.fr/dehors': { status: 302, location: 'https://ent.univ-jfc.fr/uPortal/' },
    'https://moodle.univ-jfc.fr/boucle': { status: 302, location: '/boucle' },
  };
  const raw = async (url, init) => {
    seen.push({ url, ...init });
    return { setCookies: [], text: async () => url, ...pages[url] };
  };
  const http = createClient({ raw, jar: new CookieJar(), allowedHosts: HOSTS });

  const res = await http('https://mail.univ-jfc.fr/api/x', { headers: { 'X-BM-ApiKey': 'SID' } });
  assert.deepEqual([res.status, res.url, res.redirected, res.ok], [200, 'https://auth.univ-jfc.fr/cas/login', true, true]);
  assert.deepEqual(seen.map((r) => r.headers), [{ 'X-BM-ApiKey': 'SID' }, {}]); // la clé ne part pas vers le CAS

  seen.length = 0;
  await http('https://moodle.univ-jfc.fr/post', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  assert.deepEqual(seen.map((r) => [r.method, r.body, r.headers]), [['POST', '{}', { 'Content-Type': 'application/json' }], ['GET', undefined, {}]]);

  seen.length = 0;
  await http('https://moodle.univ-jfc.fr/garde', { method: 'POST', body: 'a=1' });
  assert.deepEqual(seen.map((r) => [r.method, r.body]), [['POST', 'a=1'], ['POST', 'a=1']]);

  await assert.rejects(http('https://example.com/'), /Destination refusée : example\.com/);
  await assert.rejects(http('http://moodle.univ-jfc.fr/'), /Destination refusée/); // jamais en clair
  await assert.rejects(http('https://moodle.univ-jfc.fr/dehors'), /Destination refusée : ent\.univ-jfc\.fr/);
  await assert.rejects(http('https://moodle.univ-jfc.fr/boucle'), /Trop de redirections/);
});

test('CAS : mot de passe refusé, puis accepté ; il ne reste dans aucun cookie', async () => {
  const { http, jar, log } = setup();

  await assert.rejects(casLogin(http, jar, 'alice', 'mauvais'), LoginRefused);
  assert.equal(hasCasSession(jar), false);

  await casLogin(http, jar, 'alice', 'secret');
  assert.equal(hasCasSession(jar), true);
  assert.ok(!JSON.stringify(jar).includes('secret'));

  // Le mot de passe n'est parti que dans le corps du POST adressé au CAS.
  const carrying = log.filter((r) => JSON.stringify(r).includes('secret'));
  assert.deepEqual(carrying.map((r) => [r.method, r.url]), [['POST', 'https://auth.univ-jfc.fr/cas/login']]);
});

test('sans session : Moodle et la messagerie signalent qu’il faut se connecter, sans boucler', async () => {
  const { log } = setup();
  await assert.rejects(moodle.enrolledCourses(), NotLoggedIn);
  await assert.rejects(mail.connect(), NotLoggedIn);
  assert.ok(log.length < 12, `${log.length} requêtes`);
});

test('parcours complet : connexion, SSO vers Moodle et la messagerie, puis déconnexion', async () => {
  const { http, jar, cas, log } = setup();
  await casLogin(http, jar, 'alice', 'secret');

  const courses = await moodle.enrolledCourses();
  assert.deepEqual(courses.map((c) => [c.id, c.url]), [[2125, 'https://moodle.univ-jfc.fr/course/view.php?id=2125']]);

  assert.deepEqual(await mail.connect(), { email: 'alice@etud.univ-jfc.fr', name: 'Alice Martin' });
  const { mails, unread } = await mail.latestMails(10);
  assert.deepEqual(mails.map((m) => [m.id, m.unread, m.url]), [
    [12, true, 'https://mail.univ-jfc.fr/webapp/mail/.t/inbox:12'],
    [11, false, 'https://mail.univ-jfc.fr/webapp/mail/.t/inbox:11'],
    [10, false, 'https://mail.univ-jfc.fr/webapp/mail/.t/inbox:10'],
  ]);
  assert.equal(unread, 1);

  // Chaque cookie n'est allé qu'à son portail.
  for (const request of log) {
    const host = new URL(request.url).hostname;
    const cookie = request.headers.Cookie ?? '';
    assert.equal(cookie.includes('TGC='), host === 'auth.univ-jfc.fr' && cookie.includes('TGC='), request.url);
    assert.equal(cookie.includes('MoodleSession='), host === 'moodle.univ-jfc.fr' && cookie.includes('MoodleSession='), request.url);
    assert.equal(cookie.includes('BMSID='), host === 'mail.univ-jfc.fr' && cookie.includes('BMSID='), request.url);
  }

  await casLogout(http, jar);
  assert.equal(cas.tgt, null); // session fermée côté université
  assert.deepEqual(jar.toJSON(), []); // et plus rien dans la page
});
