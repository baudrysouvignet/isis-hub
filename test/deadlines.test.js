// Tuile « Prochains rendus » : fusion des deux lectures du calendrier Moodle, et pastilles.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { useTransport } from '../web/js/net/http.js';
import { HOSTS } from '../web/js/portals/config.js';
import * as moodle from '../web/js/portals/moodle.js';
import { toDeadlines } from '../web/js/portals/moodle.js';
import { badge } from '../web/js/ui/deadline-badge.js';

const NOW = Date.UTC(2026, 10, 21, 19, 0); // samedi 21 novembre 2026, 20 h à Paris
const S = NOW / 1000;
const M = HOSTS.moodle;
const ev = (id, t, extra = {}) => ({
  id, modulename: 'assign', eventtype: 'due', activityname: `Devoir ${id}`, timesort: t,
  course: { fullname: 'Réseaux &amp; télécoms', viewurl: `${M}/course/view.php?id=7` },
  url: `${M}/mod/assign/view.php?id=${id}`,
  action: { name: 'addsubmission', url: `${M}/mod/assign/view.php?id=${id}&action=editsubmission`, actionable: true },
  ...extra,
});

test('à rendre, en retard, déjà rendu : fusion triée par date', () => {
  const todo = [ev(1, S - 86400), ev(2, S + 3 * 86400)];
  const upcoming = [
    ev(2, S + 3 * 86400),
    ev(3, S + 86400, { action: undefined, isactionevent: false }), // devoir sans action : rendu
    ev(4, S + 2 * 86400, { modulename: 'quiz', eventtype: 'close', action: undefined }), // test sans action : inconnu, ignoré
    { id: 9, name: 'Réunion', eventtype: 'user', timestart: S + 86400 }, // événement personnel : ignoré
  ];
  const out = toDeadlines(todo, upcoming, NOW);
  assert.deepEqual(out.map((d) => [d.id, d.status]), [[1, 'late'], [3, 'done'], [2, 'todo']]);
  assert.equal(out[0].course, 'Réseaux & télécoms');
  assert.equal(out[0].url, `${M}/mod/assign/view.php?id=1&action=editsubmission`);
  assert.equal(out[1].url, `${M}/mod/assign/view.php?id=3`);
});

test('un lien hors de Moodle n’est jamais repris', () => {
  const [d] = toDeadlines([ev(1, S + 60, { action: { url: 'https://evil.example/x' }, url: 'javascript:alert(1)' })], [], NOW);
  assert.equal(d.url, '');
});

test('pastilles : retard, aujourd’hui, demain, jours, semaines, rendu', () => {
  const at = (h) => ({ at: NOW + h * 36e5, status: 'todo' });
  assert.deepEqual(badge({ at: NOW - 30 * 36e5, status: 'late' }, NOW), { tone: 'late', text: 'En retard · 1 j' });
  assert.equal(badge(at(0.5), NOW).text, 'Dans 30 min');
  assert.equal(badge(at(3), NOW).text, 'Dans 3 h');
  assert.deepEqual(badge(at(6), NOW), { tone: 'soon', text: 'Demain, 2 h' });
  assert.deepEqual(badge(at(72), NOW), { tone: 'near', text: 'Dans 3 j' });
  assert.equal(badge(at(5 * 24), NOW).tone, 'later');
  assert.equal(badge(at(16 * 24), NOW).text, 'Dans 2 sem.');
  assert.deepEqual(badge({ at: NOW + 1e8, status: 'done' }, NOW), { tone: 'done', text: 'Rendu' });
});

test('Moodle et Rendus démarrent ensemble : une seule ouverture de session', async () => {
  moodle.reset();
  let opened = 0;
  useTransport(async (url) => {
    if (url === `${M}/my/`) {
      opened++;
      await new Promise((r) => setTimeout(r, 10));
      return { status: 200, ok: true, url, redirected: false, text: async () => '"sesskey":"k","userId":42' };
    }
    throw new Error(`inattendu : ${url}`);
  });
  await Promise.all([moodle.connect(), moodle.connect()]);
  assert.equal(opened, 1);
});

test('un retard de plus d’une semaine n’est plus affiché', () => {
  const out = toDeadlines([ev(1, S - 6 * 86400), ev(2, S - 8 * 86400)], [], NOW);
  assert.deepEqual(out.map((d) => d.id), [1]);
});
