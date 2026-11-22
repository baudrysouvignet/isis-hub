// Alertes « Nouvelle connexion » de Moodle (web/js/core/loginalerts.js) : seule celle déclenchée par
// ISIS Hub sur cet appareil est retenue ; toute autre reste dans la boîte.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLoginAlerts, WINDOW_MS } from '../web/js/core/loginalerts.js';

const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.4 Mobile/15E148 Safari/604.1';
const OTHER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36';
const T0 = Date.UTC(2026, 10, 20, 9, 0, 0);

const body = (ua) =>
  `<p>Bonjour Léa Martin,</p><p>Votre compte Moodle a été connecté depuis un nouvel appareil.</p>` +
  `<p>Date : 20/11/2026, 10:00<br>Appareil : ${ua.replace(/&/g, '&amp;')}<br>Adresse IP : 203.0.113.7</p>` +
  `<p>Si ce n'était pas vous, <a href="https://moodle.univ-jfc.fr/login/change_password.php">changez votre mot de passe</a>.</p>`;

const alertMail = (id, { at = T0 + 15_000, subject = 'Nouvelle connexion à votre compte Moodle', from = 'noreply@moodle.univ-jfc.fr', ua = UA } = {}) => ({
  id,
  subject,
  from: { name: 'Moodle', address: from },
  date: new Date(at),
  content: body(ua),
});
const fetchBody = async (m) => ({ content: m.content });

function setup(t = T0 + 20_000) {
  let clock = t;
  const la = createLoginAlerts({ now: () => clock, userAgent: UA });
  return { la, tick: (ms) => (clock += ms) };
}

test('alerte de connexion : retenue si tout concorde, une seule par connexion', async () => {
  const { la } = setup();
  la.noteLogin(T0);
  assert.ok(la.pending());
  const found = await la.find([alertMail(1), alertMail(2, { at: T0 + 25_000 })], fetchBody);
  assert.deepEqual(found.map((m) => m.id), [1], 'une seule alerte par connexion');
  la.consume(found);
  assert.equal(la.pending(), false);
  assert.deepEqual(await la.find([alertMail(3)], fetchBody), [], 'connexion déjà utilisée');
});

test('alerte de connexion : jamais retenue sans connexion ISIS Hub, trop tard ou trop tôt', async () => {
  const { la } = setup();
  assert.deepEqual(await la.find([alertMail(1)], fetchBody), [], 'aucune connexion ISIS Hub');
  la.noteLogin(T0);
  assert.deepEqual(await la.find([alertMail(2, { at: T0 + WINDOW_MS + 1000 })], fetchBody), [], 'trop tard');
  assert.deepEqual(await la.find([alertMail(3, { at: T0 - 60_000 })], fetchBody), [], 'avant la connexion');
  assert.equal((await la.find([alertMail(4, { at: T0 - 5_000 })], fetchBody)).length, 1, 'petit décalage d’horloge toléré');
});

test('alerte de connexion : autre appareil, autre expéditeur, autre objet → laissée', async () => {
  const { la } = setup();
  la.noteLogin(T0);
  const keep = [
    alertMail(1, { ua: OTHER_UA }), // connexion depuis un autre navigateur : peut-être une intrusion
    alertMail(2, { from: 'noreply@moodle-univ-jfc.fr.evil.example' }),
    alertMail(3, { from: 'alerte@univ-jfc.fr.example.com' }),
    alertMail(4, { subject: 'Re: Nouvelle connexion à votre compte Moodle' }),
    alertMail(5, { subject: 'Cours annulé' }),
  ];
  assert.deepEqual(await la.find(keep, fetchBody), []);
  assert.ok(la.pending(), 'la connexion attend toujours sa vraie alerte');
});

test('alerte de connexion : contenu illisible ou User-Agent absent → laissée', async () => {
  const { la } = setup();
  la.noteLogin(T0);
  const failing = async () => {
    throw new Error('réseau');
  };
  assert.deepEqual(await la.find([alertMail(1)], failing), []);
  const short = createLoginAlerts({ now: () => T0 + 20_000, userAgent: 'curl' });
  short.noteLogin(T0);
  assert.deepEqual(await short.find([alertMail(2, { ua: 'curl' })], fetchBody), [], 'identité trop courte pour prouver quoi que ce soit');
});

test('alerte de connexion : version anglaise, texte coupé en lignes, entités HTML', async () => {
  const { la } = setup();
  la.noteLogin(T0);
  const wrapped = { ...alertMail(1, { subject: 'New sign in to your Moodle account' }), content: `Device:\n${UA.slice(0, 70)}\n${UA.slice(70)}` };
  assert.equal((await la.find([wrapped], fetchBody)).length, 1);
  const { la: la2 } = setup();
  la2.noteLogin(T0);
  const entities = { ...alertMail(2), content: body(UA).replace('(KHTML, like Gecko)', '&#40;KHTML, like Gecko&#41;') };
  assert.equal((await la2.find([entities], fetchBody)).length, 1);
});

test('alerte de connexion : la fenêtre se ferme d’elle-même', () => {
  const { la, tick } = setup(T0);
  la.noteLogin(T0);
  assert.ok(la.pending());
  tick(WINDOW_MS + 1);
  assert.equal(la.pending(), false);
});

test('mail « Bienvenue sur <cours> » d’une inscription faite dans le Hub : seul celui-là', async () => {
  const { createLoginAlerts, ENROL_MS } = await import('../web/js/core/loginalerts.js');
  let t = Date.UTC(2026, 10, 22, 15, 13);
  const la = createLoginAlerts({ now: () => t, userAgent: '' });
  const mk = (subject, at, address = 'ne.pas.repondre@univ-jfc.fr') => ({ subject, date: new Date(at), from: { address } });
  const body = (name) => async () => ({ content: `<p>Bonjour Baudry, vous êtes inscrit au cours ${name}</p><p>Vous lisez ceci dans un courriel ?</p>` });
  assert.equal(la.pendingEnrol(), false);
  la.noteEnrol('FIA4-1-LA-3 - Sociologie de la santé', t);
  assert.equal(la.pendingEnrol(), true);
  const good = mk('Bienvenue sur FIA4-1-LA-3 - Sociologie de la santé', t + 20_000);
  const other = mk('Bienvenue sur FIE4-1-DI-5 - Anglais', t + 20_000); // inscription faite ailleurs
  const fake = mk('Bienvenue sur FIA4-1-LA-3 - Sociologie de la santé', t + 20_000, 'x@gmail.com');
  const late = mk('Bienvenue sur FIA4-1-LA-3 - Sociologie de la santé', t + ENROL_MS + 120_000);
  t += 30_000;
  let found = await la.find([other, fake, late, good], body('FIA4-1-LA-3 - Sociologie de la santé'), { logins: false });
  assert.deepEqual(found, [good]);
  assert.equal(la.isWelcome(good), true);
  // contenu qui ne cite pas le cours : gardé
  la.noteEnrol('FIE4-1-DI-5 - Anglais', t);
  found = await la.find([mk('Bienvenue sur FIE4-1-DI-5 - Anglais', t + 5_000)], async () => ({ content: 'autre chose' }));
  assert.deepEqual(found, []);
  // un seul mail par inscription
  la.consume([good]);
  found = await la.find([mk('Bienvenue sur FIA4-1-LA-3 - Sociologie de la santé', t)], body('FIA4-1-LA-3 - Sociologie de la santé'));
  assert.deepEqual(found, []);
});
