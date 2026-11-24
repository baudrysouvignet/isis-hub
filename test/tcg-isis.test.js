// Gens d'ISIS : participants des cours Moodle « ISIS-… », reconnus dans les noms de l'annuaire.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isisMatcher, isisCourses } from '../web/js/tcg/isis.js';

const moodle = {
  enrolledCourses: async () => [
    { id: 1, category: 'ISIS-FIA4-SEMESTRE7' },
    { id: 2, category: 'ISIS-FIA4-SEMESTRE8' },
    { id: 3, category: 'Licence Informatique' },
  ],
  participants: async (id) => {
    if (id === 1) return ['Baudry Souvignet', 'Léa Martin', 'Jean-Pierre De La Tour'];
    if (id === 2) throw new Error('page indisponible');
    return ['Paul Dehors'];
  },
};

test('cours ISIS reconnus par leur catégorie', () => {
  assert.deepEqual(
    isisCourses([{ category: 'ISIS-FIA4-SEMESTRE7' }, { category: 'Licence' }, { category: 'Crisis' }]).map((c) => c.category),
    ['ISIS-FIA4-SEMESTRE7'],
  );
});

test('noms de l’annuaire marqués ISIS, quel que soit l’ordre ou les accents', async () => {
  const isIsis = isisMatcher(moodle);
  assert.equal(isIsis({ name: 'SOUVIGNET Baudry' }), false); // rien tant que Moodle n'a pas répondu
  await isIsis.ready;
  assert.equal(isIsis({ name: 'SOUVIGNET Baudry' }), true);
  assert.equal(isIsis({ name: 'MARTIN Lea' }), true);
  assert.equal(isIsis({ name: 'DE LA TOUR Jean-Pierre' }), true);
  assert.equal(isIsis({ name: 'DEHORS Paul' }), false); // cours hors ISIS
  assert.equal(isIsis({ name: 'MARTIN Hugo' }), false);
  assert.equal(isIsis({ email: 'x@univ-jfc.fr' }), false);
});

test('Moodle indisponible : personne n’est marqué, sans erreur', async () => {
  const isIsis = isisMatcher({ enrolledCourses: async () => { throw new Error('panne'); } });
  await isIsis.ready;
  assert.equal(isIsis({ name: 'SOUVIGNET Baudry' }), false);
});
