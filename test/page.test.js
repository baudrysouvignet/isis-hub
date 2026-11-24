// Tests du code de la page qui ne dépend pas du navigateur : `npm test` (Node 20+).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { CookieJar, createClient } from '../web/js/net/session.js';
import { useTransport } from '../web/js/net/http.js';
import { parseIcal, courseCode, fetchSchedule } from '../web/js/portals/ade.js';
import { createMatcher, moodleCode, codeOfCourse } from '../web/js/portals/match.js';
import { pickParts } from '../web/js/portals/mail.js';
import { sniff, safeName } from '../web/js/portals/files.js';
import * as MP from '../web/js/core/mailprefs.js';
import * as UD from '../web/js/core/userdata.js';
import { casLogin, LoginRefused } from '../web/js/portals/cas.js';
import * as D from '../web/js/core/dates.js';
import { setClasses } from '../web/js/portals/classes.js';

setClasses(JSON.parse(await readFile(new URL('../web/data/classes.json', import.meta.url), 'utf8')));

const enc = new TextEncoder();
const ALLOWED = new Set(['auth.univ-jfc.fr', 'adecampus.univ-jfc.fr', 'mail.univ-jfc.fr', 'moodle.univ-jfc.fr']);

// ------------------------------------------------------------------ cookies

test('les cookies ne retournent qu’au portail qui les a posés', () => {
  const jar = new CookieJar();
  jar.store(new URL('https://auth.univ-jfc.fr/cas/login'), ['TGC=secret; Path=/cas; Secure; HttpOnly']);
  jar.store(new URL('https://moodle.univ-jfc.fr/my/'), ['MoodleSession=m1; path=/']);
  assert.equal(jar.header(new URL('https://auth.univ-jfc.fr/cas/login')), 'TGC=secret');
  assert.equal(jar.header(new URL('https://auth.univ-jfc.fr/autre')), '', 'chemin /cas uniquement');
  assert.equal(jar.header(new URL('https://moodle.univ-jfc.fr/course/view.php')), 'MoodleSession=m1');
  assert.equal(jar.header(new URL('https://mail.univ-jfc.fr/')), '', 'aucun cookie d’un autre portail');
});

test('un portail ne peut pas poser de cookie pour un autre domaine', () => {
  const jar = new CookieJar();
  jar.store(new URL('https://moodle.univ-jfc.fr/'), ['a=1; Domain=example.com', 'b=2; Domain=fr', 'c=3; Domain=univ-jfc.fr']);
  assert.equal(jar.header(new URL('https://moodle.univ-jfc.fr/')), 'c=3');
  assert.equal(jar.header(new URL('https://mail.univ-jfc.fr/')), 'c=3', 'Domain=univ-jfc.fr vaut pour les sous-domaines');
});

test('un cookie expiré est supprimé', () => {
  const jar = new CookieJar();
  const url = new URL('https://mail.univ-jfc.fr/');
  jar.store(url, ['s=1']);
  jar.store(url, ['s=; Max-Age=0']);
  assert.equal(jar.header(url), '');
});

// ----------------------------------------------------------- client HTTP

function fakeRaw(routes) {
  const calls = [];
  const raw = async (url, init) => {
    calls.push({ url, ...init });
    const route = routes[url] ?? { status: 404 };
    return { status: route.status, location: route.location, setCookies: route.cookies ?? [], body: enc.encode(route.body ?? '') };
  };
  return { raw, calls };
}

test('le client refuse toute destination hors des 4 portails, avant toute connexion', async () => {
  const { raw, calls } = fakeRaw({});
  const http = createClient({ raw, jar: new CookieJar(), allowedHosts: ALLOWED });
  await assert.rejects(http('https://example.com/'), /Destination refusée/);
  await assert.rejects(http('http://moodle.univ-jfc.fr/'), /Destination refusée/, 'HTTP en clair refusé');
  assert.equal(calls.length, 0);
});

test('une redirection vers un hôte interdit est refusée', async () => {
  const { raw } = fakeRaw({ 'https://moodle.univ-jfc.fr/x': { status: 302, location: 'https://evil.example/' } });
  const http = createClient({ raw, jar: new CookieJar(), allowedHosts: ALLOWED });
  await assert.rejects(http('https://moodle.univ-jfc.fr/x'), /evil.example/);
});

test('les en-têtes d’un portail ne suivent pas une redirection vers un autre', async () => {
  const { raw, calls } = fakeRaw({
    'https://mail.univ-jfc.fr/api/x': { status: 302, location: 'https://auth.univ-jfc.fr/cas/login' },
    'https://auth.univ-jfc.fr/cas/login': { status: 200, body: 'ok' },
  });
  const http = createClient({ raw, jar: new CookieJar(), allowedHosts: ALLOWED });
  const res = await http('https://mail.univ-jfc.fr/api/x', { headers: { 'X-BM-ApiKey': 'secret' } });
  assert.equal(await res.text(), 'ok');
  assert.equal(calls[1].headers['X-BM-ApiKey'], undefined);
});

test('un POST redirigé en 302 devient un GET sans corps', async () => {
  const { raw, calls } = fakeRaw({
    'https://auth.univ-jfc.fr/cas/login': { status: 302, location: '/cas/done' },
    'https://auth.univ-jfc.fr/cas/done': { status: 200 },
  });
  const http = createClient({ raw, jar: new CookieJar(), allowedHosts: ALLOWED });
  await http('https://auth.univ-jfc.fr/cas/login', { method: 'POST', body: 'a=1', headers: { 'Content-Type': 'x' } });
  assert.equal(calls[1].method, 'GET');
  assert.equal(calls[1].body, undefined);
  assert.equal(calls[1].headers['Content-Type'], undefined);
});

// --------------------------------------------------------------------- CAS

function casPortal(goodPassword) {
  const jar = new CookieJar();
  const raw = async (url, init) => {
    if (init.method === 'GET') return { status: 200, setCookies: [], body: enc.encode('<input type="hidden" name="execution" value="e1s1"/>') };
    const form = new URLSearchParams(init.body);
    assert.equal(form.get('execution'), 'e1s1');
    if (form.get('password') !== goodPassword) return { status: 401, setCookies: [], body: enc.encode('') };
    return { status: 200, setCookies: ['TGC=TGT-1; Path=/cas'], body: enc.encode('') };
  };
  useTransport(createClient({ raw, jar, allowedHosts: ALLOWED }));
  return jar;
}

test('CAS : identifiants refusés → LoginRefused', async () => {
  const jar = casPortal('juste');
  await assert.rejects(casLogin(jar, 'etu', 'faux'), LoginRefused);
});

test('CAS : identifiants acceptés → cookie TGC', async () => {
  const jar = casPortal('juste');
  await casLogin(jar, 'etu', 'juste');
  assert.ok(jar.has('auth.univ-jfc.fr', 'TGC'));
});

// --------------------------------------------------------------------- ADE

test('ADE : séances lues avec salle, titre complet, enseignant, examen', async () => {
  const events = parseIcal(await readFile(new URL('./fixtures/fia4-extrait.ics', import.meta.url), 'utf8'));
  assert.equal(events.length, 4);
  const [isi2, isi1, ses4, bilan] = events;
  assert.deepEqual(
    { code: isi2.code, kind: isi2.kind, room: isi2.room, title: isi2.title, teacher: isi2.teacher, day: isi2.day, time: isi2.time, exam: isi2.exam },
    { code: 'A4-1-ISI-2', kind: 'TD', room: 'B106', title: 'Aide à la décision', teacher: 'J. Dupont', day: '2026-11-16', time: '10:30 – 12:30', exam: false },
  );
  assert.equal(isi1.title, 'Architecture fonctionnelle et technique des SIS', 'titre non abrégé');
  assert.equal(isi1.teacher, 'P. Exemple', '« Intervenant : … », mis en forme');
  assert.equal(ses4.exam, true);
  assert.equal(ses4.teacher, 'C. Martin Durand');
  assert.equal(ses4.time, '08:15 – 10:15', 'heure de Paris');
  assert.equal(bilan.code, null);
  assert.deepEqual(bilan.groups, ['FIA4']);
});

test('ADE : la requête vise l’export anonyme de la bonne classe', async () => {
  let asked;
  useTransport(async (url) => {
    asked = url;
    return { ok: true, status: 200, text: async () => 'BEGIN:VCALENDAR\nEND:VCALENDAR' };
  });
  await fetchSchedule('FIA4', '2026-11-16', '2026-12-27');
  assert.match(asked, /anonymous_cal\.jsp\?resources=3612,3657&projectId=10&calType=ical&firstDate=2026-11-16&lastDate=2026-12-27$/);
});

// --------------------------------------------------------- ADE ↔ Moodle

test('code ADE A4-1-ISI-2 ↔ cours Moodle FIA4-1-ISI-2', () => {
  assert.equal(courseCode('TD-A4-1-ISI-2 Aide à la décision'), 'A4-1-ISI-2');
  assert.equal(moodleCode('FIA4-1-ISI-2 - Aide à la décision'), 'A4-1-ISI-2');
  assert.equal(codeOfCourse({ shortname: 'X', fullname: 'Y', idnumber: 'A4-1-SES-1' }), 'A4-1-SES-1');
});

test('correspondance : code exact parmi les cours suivis, sinon même intitulé (≈)', async () => {
  const searched = [];
  const m = createMatcher({ search: async (q) => (searched.push(q), []) });
  m.setEnrolled([
    { id: 2125, fullname: 'FIA4-1-ISI-2 - Aide à la décision', shortname: 'FIA4-1-ISI-2', category: '' },
    { id: 2140, fullname: 'FIA4-1-LA-1 - Anglais', shortname: 'FIA4-1-LA-1', category: '' },
  ]);
  const isi = { code: 'A4-1-ISI-2', title: 'Aide à la décision' };
  const anglais = { code: 'A4-1-LSS-1', title: 'Anglais' };
  const autre = { code: 'A4-1-ZZZ-9', title: 'Inconnu' };
  await m.resolve([isi, anglais, autre]);
  assert.deepEqual(m.get(isi), { course: m.get(isi).course, approx: false });
  assert.equal(m.get(isi).course.id, 2125);
  assert.equal(m.get(anglais).course.id, 2140);
  assert.equal(m.get(anglais).approx, true);
  assert.equal(m.get(autre), null);
  assert.deepEqual(searched, ['FIA4-1-LSS-1', 'FIA4-1-ZZZ-9'], 'recherche Moodle seulement si le code n’est pas suivi');
});

test('correspondance : rien n’est cherché sans session', async () => {
  let called = false;
  const m = createMatcher({ search: async () => ((called = true), []), enabled: () => false });
  m.setEnrolled([]);
  await m.resolve([{ code: 'A4-1-ISI-2', title: 'x' }]);
  assert.equal(called, false);
});

// --------------------------------------------------------------- mails

test('mail : partie HTML préférée, pièces jointes listées', () => {
  const { body, attachments } = pickParts({
    mime: 'multipart/mixed',
    children: [
      { mime: 'multipart/alternative', children: [{ mime: 'text/plain', address: '1.1' }, { mime: 'text/html', address: '1.2' }] },
      { mime: 'application/pdf', address: '2', fileName: 'a.pdf', size: 10, dispositionType: 'ATTACHMENT' },
    ],
  });
  assert.equal(body.address, '1.2');
  assert.deepEqual(
    attachments.map(({ part, ...a }) => ({ ...a, address: part.address })),
    [{ name: 'a.pdf', size: 10, mime: 'application/pdf', address: '2' }],
  );
});

test('pièces jointes : type reconnu aux octets, jamais au nom', () => {
  const b = (...x) => Uint8Array.from(x);
  assert.equal(sniff(b(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0)), 'image/png');
  assert.equal(sniff(b(0xff, 0xd8, 0xff, 0xe0)), 'image/jpeg');
  assert.equal(sniff(enc.encode('%PDF-1.7')), 'application/pdf');
  assert.equal(sniff(enc.encode('<svg onload=alert(1)>')), null, 'SVG jamais affiché');
  assert.equal(sniff(enc.encode('<!doctype html><script>')), null, 'HTML jamais affiché');
  assert.ok(!/[\\/]|^\./.test(safeName('../../etc/passwd')), 'ni chemin ni fichier caché');
  assert.equal(safeName('rapport\u0000.pdf'), 'rapport_.pdf');
  assert.equal(safeName(''), 'piece-jointe');
});

test('mails : étiquettes et règles appliquées sur l’appareil', async () => {
  const saved = [];
  // Les règles vivent dans les données personnelles (chiffrées, synchronisées) : coffre simulé.
  await UD.initUserData(
    { loadUserData: async () => null, saveUserData: (d) => saved.push(d) },
    { mail: { tags: [{ id: 'x', name: '<b>', color: 'evil' }], rules: [{ id: 'r', field: 'from', text: '', action: 'trash' }] } },
  );
  MP.initMailPrefs();
  assert.equal(MP.tags()[0].color, 'blue', 'couleur inconnue remplacée');
  assert.equal(MP.rules().length, 0, 'règle vide écartée');
  const stage = MP.addTag('Stage');
  assert.equal(MP.addTag('stage').id, stage.id, 'pas de doublon');
  MP.addRule({ field: 'subject', text: 'offre de STAGE', action: 'tag', tag: stage.id });
  MP.addRule({ field: 'from', text: 'newsletter', action: 'trash' });
  const a = { messageId: '<a@x>', subject: 'Offre de stage chez X', from: { name: 'RH', address: 'rh@x.fr' } };
  const n = { messageId: '<n@x>', subject: 'Nouveautés', from: { name: 'News', address: 'newsletter@x.fr' } };
  const trash = MP.applyRules([a, n]);
  assert.deepEqual(trash, [n]);
  assert.deepEqual(MP.tagsOf(a).map((t) => t.name), ['Stage']);
  MP.removeTag(stage.id);
  assert.equal(MP.tagsOf(a).length, 0);
  assert.equal(MP.rules().length, 1, 'la règle de l’étiquette supprimée part avec elle');
  assert.ok(saved.length > 0, 'chaque changement est enregistré');
});

// --------------------------------------------------------------- dates

test('dates : semaines ISO et heure de Paris', () => {
  assert.equal(D.isoWeek('2026-11-17'), 47);
  assert.equal(D.isoWeek('2026-12-31'), 53);
  assert.equal(D.isoWeek('2027-01-04'), 1);
  assert.equal(D.mondayOf('2026-11-22'), '2026-11-16');
  assert.deepEqual(D.paris(new Date('2026-07-01T06:00:00Z')), { key: '2026-07-01', minutes: 8 * 60 }, 'heure d’été');
  assert.deepEqual(D.paris(new Date('2026-12-01T23:30:00Z')), { key: '2026-12-02', minutes: 30 }, 'changement de jour');
  assert.equal(D.weekRange('2026-11-30'), '30 nov. – 4 déc. 2026');
});

test('rejouable ou non : lectures oui, envois non (sauf lecture déclarée), redirection en GET oui', async () => {
  const { raw, calls } = fakeRaw({
    'https://moodle.univ-jfc.fr/a': { status: 200, body: 'ok' },
    'https://moodle.univ-jfc.fr/post': { status: 302, location: 'https://moodle.univ-jfc.fr/a' },
  });
  const http = createClient({ raw, jar: new CookieJar(), allowedHosts: ALLOWED });
  await http('https://moodle.univ-jfc.fr/a');
  await http('https://moodle.univ-jfc.fr/a', { method: 'POST', body: '{}' });
  await http('https://moodle.univ-jfc.fr/a', { method: 'POST', body: '{}', idempotent: true });
  await http('https://moodle.univ-jfc.fr/post', { method: 'POST', body: 'x' });
  assert.deepEqual(calls.map((c) => c.idempotent), [true, false, true, false, true]);
});

test('PDF : affiché dans la page seulement si le navigateur sait le faire (sinon un bouton « Ouvrir »)', async () => {
  const { inlinePdf } = await import('../web/js/portals/files.js');
  assert.equal(inlinePdf({ pdfViewerEnabled: true, userAgent: 'Mozilla/5.0 (Macintosh)' }), true);
  assert.equal(inlinePdf({ pdfViewerEnabled: false, userAgent: 'Mozilla/5.0 (Macintosh)' }), false, 'Chrome réglé sur « Télécharger les PDF »');
  assert.equal(inlinePdf({ pdfViewerEnabled: false, userAgent: 'Mozilla/5.0 (Linux; Android 14) Chrome/140' }), false, 'Chrome Android');
  assert.equal(inlinePdf({ userAgent: 'Mozilla/5.0 (Linux; Android 9) SamsungBrowser/12' }), false, 'vieux navigateur Android');
  assert.equal(inlinePdf({ userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 15_0)' }), true);
});
