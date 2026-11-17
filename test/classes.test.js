// Les filtres par groupe, langue et parcours doivent donner EXACTEMENT les mêmes séances que le
// projet de référence « Calendriers ISIS » (sortie enregistrée dans fixtures/calendars/expected.json,
// sur ses propres instantanés ADE).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { setClasses, keep, isComplete, choicesFor, feedPath, groupsIn } from '../web/js/portals/classes.js';
import { parseIcal } from '../web/js/portals/ade.js';

const dir = new URL('./fixtures/calendars/', import.meta.url);
setClasses(JSON.parse(await readFile(new URL('../web/data/classes.json', import.meta.url), 'utf8')));
const expected = JSON.parse(await readFile(new URL('expected.json', dir), 'utf8'));

function choiceOf(promo, key) {
  const [a, b] = key.split('/');
  if (promo === 'fie1') return { group: Number(a) };
  if (promo === 'fie2' || promo === 'fie3') return { group: Number(a), language: b };
  if (promo === 'fie4') return { track: a, group: Number(b) };
  if (promo === 'fie5') return { track: a };
  return {};
}

for (const [promo, variants] of Object.entries(expected)) {
  const events = parseIcal(await readFile(new URL(`${promo}.ics`, dir), 'utf8'));
  for (const [key, uids] of Object.entries(variants)) {
    test(`${promo.toUpperCase()} ${key} : mêmes séances que la référence (${new Set(uids).size})`, () => {
      const choice = choiceOf(promo, key);
      assert.ok(isComplete(promo.toUpperCase(), choice), 'choix complet');
      const mine = events.filter((ev) => keep(promo.toUpperCase(), choice, ev)).map((ev) => ev.uid);
      assert.deepEqual([...new Set(mine)].sort(), [...new Set(uids)].sort());
    });
  }
}

test('choix demandés par classe', () => {
  assert.deepEqual(choicesFor('FIE1'), ['group']);
  assert.deepEqual(choicesFor('FIE2'), ['group', 'language']);
  assert.deepEqual(choicesFor('FIE4'), ['track', 'group']);
  assert.deepEqual(choicesFor('FIE5'), ['track']);
  assert.deepEqual(choicesFor('FIA4'), []);
  assert.equal(isComplete('FIE4', { track: 'ia' }), false);
  assert.equal(isComplete('FIE4', { track: 'piratage', group: 1 }), false);
});

test('liens de calendrier identiques au projet de référence', () => {
  assert.equal(feedPath('FIE1', { group: 2 }), 'calendar/fie1/2.ics');
  assert.equal(feedPath('FIE2', { group: 1, language: 'chinois' }), 'calendar/fie2/1/chinois.ics');
  assert.equal(feedPath('FIE4', { track: 'ia', group: 1 }), 'calendar/fie4/ia/1.ics');
  assert.equal(feedPath('FIE5', { track: 'management' }), 'calendar/fie5/management.ics');
  assert.equal(feedPath('FIA3', {}), null);
});

test('groupes : seulement les mentions explicites', () => {
  assert.deepEqual(groupsIn('TP G1'), [1]);
  assert.deepEqual(groupsIn('Groupe 1 et 2'), [1, 2]);
  assert.deepEqual(groupsIn('GR 02'), [2]);
  assert.deepEqual(groupsIn('G10'), []);
  assert.deepEqual(groupsIn('E4-1-DI-1'), []);
  assert.deepEqual(groupsIn('Salle B101'), []);
});
