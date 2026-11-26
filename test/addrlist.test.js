// Liste d'adresses collée dans « À », « Cc » ou « Cci » : `npm test`.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { parseAddresses, looksLikeList } from '../web/js/core/addrlist.js';

test('adresses collées : formats Outlook, BlueMind, tableur', () => {
  const r = parseAddresses('Baudry SOUVIGNET <Baudry.Souvignet@etud.univ-jfc.fr>, Léa MARTIN <lea.martin@etud.univ-jfc.fr>; tom.r@univ-jfc.fr\n"DURAND, Inès" <ines.durand@etud.univ-jfc.fr>');
  assert.deepEqual(r.people, [
    { email: 'baudry.souvignet@etud.univ-jfc.fr', name: 'Baudry SOUVIGNET' },
    { email: 'lea.martin@etud.univ-jfc.fr', name: 'Léa MARTIN' },
    { email: 'tom.r@univ-jfc.fr', name: 'tom.r@univ-jfc.fr' },
    { email: 'ines.durand@etud.univ-jfc.fr', name: 'DURAND, Inès' },
  ]);
  assert.equal(r.rest, '');
});

test('adresses collées : nom avec virgule sans guillemets, parenthèses, doublons, reste', () => {
  const r = parseAddresses('SOUVIGNET, Baudry <b@etud.univ-jfc.fr>, Léa M. (lea@etud.univ-jfc.fr), B@etud.univ-jfc.fr, Lea');
  assert.deepEqual(r.people.map((p) => [p.email, p.name]), [
    ['b@etud.univ-jfc.fr', 'SOUVIGNET, Baudry'],
    ['lea@etud.univ-jfc.fr', 'Léa M.'],
  ]);
  assert.equal(r.rest, 'Lea', 'le début d’un nom sans adresse reste dans le champ');
  assert.ok(looksLikeList('a@b.fr, c@d.fr'));
  assert.ok(looksLikeList('Léa <lea@b.fr>'));
  assert.ok(!looksLikeList('lea@b.fr'), 'une seule adresse tapée : pas une liste');
  assert.ok(!looksLikeList('Léa Martin'));
});
