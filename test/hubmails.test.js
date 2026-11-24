// Mails d'ISIS Hub (mail d'accord du TCG) : on ne garde que le dernier dans la boîte.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHubMails, isHubMail } from '../web/js/core/hubmails.js';
import { MAIL_SUBJECT } from '../web/js/tcg/consent-text.js';

const mk = (id, day, over = {}) => ({ id, subject: MAIL_SUBJECT, from: { address: 'admin.isis@univ-jfc.fr' }, date: new Date(2026, 10, day), ...over });

test('reconnu à son objet exact et à un expéditeur de l’université', () => {
  assert.equal(isHubMail(mk(1, 1)), true);
  assert.equal(isHubMail(mk(1, 1, { from: { address: 'pirate@gmail.com' } })), false);
  assert.equal(isHubMail(mk(1, 1, { subject: 'Re: ' + MAIL_SUBJECT })), false);
  assert.equal(isHubMail({ id: 2, subject: 'Cours annulé', from: { address: 'prof@univ-jfc.fr' }, date: new Date() }), false);
});

test('seul le plus récent reste, même en descendant la boîte ou quand un nouveau arrive', () => {
  const hub = createHubMails();
  const other = { id: 9, subject: 'Autre chose', from: { address: 'x@univ-jfc.fr' }, date: new Date(2026, 10, 20) };
  // Premier lot (le plus récent en haut) : le 20 reste, le 18 part ; l'autre mail n'est pas touché.
  assert.deepEqual(hub.pick([other, mk(3, 20), mk(2, 18)]).map((m) => m.id), [2]);
  // En descendant la boîte : un plus ancien part aussi.
  assert.deepEqual(hub.pick([mk(1, 10)]).map((m) => m.id), [1]);
  // Relire le même lot ne fait rien partir de plus.
  assert.deepEqual(hub.pick([mk(3, 20)]).map((m) => m.id), []);
  // Un nouveau arrive : c'est l'ancien « dernier » qui part.
  assert.deepEqual(hub.pick([mk(4, 24)]).map((m) => m.id), [3]);
});

test('aucun mail d’ISIS Hub : rien ne part', () => {
  assert.deepEqual(createHubMails().pick([{ id: 1, subject: 'Bonjour', from: { address: 'a@univ-jfc.fr' }, date: new Date() }]), []);
});
