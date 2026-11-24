// Gens d'ISIS, toutes classes : listes de diffusion ISIS de l'annuaire (membres) et participants
// des cours Moodle « ISIS-… » (noms), reconnus dans les résultats de l'annuaire.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isisMatcher, isisCourses, isIsisList } from '../web/js/tcg/isis.js';

const CODES = ['FIE1', 'FIE2', 'FIA3', 'FIA4', 'FIA5'];

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

// Faux annuaire : une liste « ETU ISIS FIA3 », une liste FIE2 qui contient une sous-liste, une
// liste hors ISIS.
const lists = {
  'c/fia3': [{ name: 'Inès X', email: 'ines.x@etud.univ-jfc.fr' }, { name: 'Théo Y', email: 'theo.y@etud.univ-jfc.fr' }],
  'c/fie2': [{ name: 'ISIS FIE2 groupe B', email: 'isis-fie2-b@univ-jfc.fr', ref: { container: 'c', uid: 'fie2b' } }, { name: 'Zoé Z', email: 'zoe.z@etud.univ-jfc.fr' }],
  'c/fie2b': [{ name: 'Hugo B', email: 'hugo.b@etud.univ-jfc.fr' }],
  'c/droit': [{ name: 'Paul Dehors', email: 'paul.dehors@etud.univ-jfc.fr' }],
};
const mail = {
  searchContacts: async (q) =>
    ({
      isis: [{ name: 'ETU ISIS FIA3', email: 'etu-isis-fia3@univ-jfc.fr', cat: 'liste', ref: { container: 'c', uid: 'fia3' } }],
      FIE2: [{ name: 'Promo FIE2', email: 'fie2@univ-jfc.fr', cat: 'liste', ref: { container: 'c', uid: 'fie2' } }],
      FIA3: [{ name: 'Licence Droit L3', email: 'droit-l3@univ-jfc.fr', cat: 'liste', ref: { container: 'c', uid: 'droit' } }],
    })[q] ?? [],
  groupMembers: async (ref) => lists[`${ref.container}/${ref.uid}`] ?? [],
};

test('cours et listes ISIS reconnus', () => {
  assert.deepEqual(
    isisCourses([{ category: 'ISIS-FIA4-SEMESTRE7' }, { category: 'Licence' }, { category: 'Crisis' }]).map((c) => c.category),
    ['ISIS-FIA4-SEMESTRE7'],
  );
  assert.equal(isIsisList({ name: 'ETU ISIS FIA3' }, CODES), true);
  assert.equal(isIsisList({ name: 'Promo', email: 'fie2@univ-jfc.fr' }, CODES), true);
  assert.equal(isIsisList({ name: 'Licence Droit L3', email: 'droit-l3@univ-jfc.fr' }, CODES), false);
});

test('toutes les classes : membres des listes ISIS (sous-listes comprises) et participants Moodle', async () => {
  const isIsis = isisMatcher({ moodle, mail, codes: CODES });
  assert.equal(isIsis({ name: 'SOUVIGNET Baudry' }), false); // rien tant que rien n'a répondu
  await isIsis.ready;
  // Listes de l'annuaire : par l'adresse, n'importe quelle classe.
  assert.equal(isIsis({ name: 'X Inès', email: 'ines.x@etud.univ-jfc.fr' }), true); // FIA3
  assert.equal(isIsis({ name: 'Z Zoé', email: 'ZOE.Z@etud.univ-jfc.fr' }), true); // FIE2
  assert.equal(isIsis({ name: 'B Hugo', email: 'hugo.b@etud.univ-jfc.fr' }), true); // sous-liste FIE2
  assert.equal(isIsis({ name: 'DEHORS Paul', email: 'paul.dehors@etud.univ-jfc.fr' }), false); // liste hors ISIS
  // Moodle : par le nom, quel que soit l'ordre ou les accents.
  assert.equal(isIsis({ name: 'SOUVIGNET Baudry' }), true);
  assert.equal(isIsis({ name: 'MARTIN Lea' }), true);
  assert.equal(isIsis({ name: 'DE LA TOUR Jean-Pierre' }), true);
  assert.equal(isIsis({ name: 'MARTIN Hugo', email: 'hugo.martin@etud.univ-jfc.fr' }), false);
  const info = isIsis.info();
  assert.equal(info.emails, 4);
  assert.deepEqual(info.lists.map((l) => l.name).sort(), ['ETU ISIS FIA3', 'ISIS FIE2 groupe B', 'Promo FIE2']);
});

test('annuaire et Moodle indisponibles : personne n’est marqué, sans erreur', async () => {
  const isIsis = isisMatcher({
    moodle: { enrolledCourses: async () => { throw new Error('panne'); } },
    mail: { searchContacts: async () => { throw new Error('panne'); }, groupMembers: async () => [] },
    codes: CODES,
  });
  await isIsis.ready;
  assert.equal(isIsis({ name: 'SOUVIGNET Baudry', email: 'b@etud.univ-jfc.fr' }), false);
  assert.equal(isIsis.info().ready, true);
});
