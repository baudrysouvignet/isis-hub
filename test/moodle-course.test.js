// Moodle dans le Hub : lecture des dates, tailles, catégories et adresses (code pur).
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseFrDate, parseDateLine, dueOf, openOf, sizeOf, promoOfCategory, moodleUrl, webUrl, cmIdOf, courseIdOf, stripStyles } from '../web/js/portals/moodle-course.js';

test('dates en français de Moodle', () => {
  assert.equal(parseFrDate('mardi 18 novembre 2025, 17:09'), new Date(2025, 10, 18, 17, 9).getTime());
  assert.equal(parseFrDate('lundi 5 janvier 2026'), new Date(2026, 0, 5).getTime());
  assert.equal(parseFrDate('bientôt'), null);
  const dates = ['Ouvert le : lundi 16 novembre 2026, 00:00', 'À rendre : vendredi 27 novembre 2026, 23:59'].map(parseDateLine);
  assert.equal(dates[0].label, 'Ouvert le');
  assert.equal(openOf(dates), new Date(2026, 10, 16).getTime());
  assert.equal(dueOf(dates), new Date(2026, 10, 27, 23, 59).getTime());
  assert.equal(dueOf([parseDateLine('Ferme le : vendredi 27 novembre 2026, 23:59')]), new Date(2026, 10, 27, 23, 59).getTime());
});

test('tailles et catégories', () => {
  assert.equal(sizeOf('3.8 Mo'), Math.round(3.8 * 1048576));
  assert.equal(sizeOf('895,7 Ko'), Math.round(895.7 * 1024));
  assert.equal(sizeOf('PDF'), null);
  assert.deepEqual(promoOfCategory('cycle Ingénieur FIE3, 1ère année, semestre 5'), { promo: 'FIE3', semester: 5 });
  assert.deepEqual(promoOfCategory('Cycle ingenieur statut apprenti › ISIS-FIA4-SEMESTRE7'), { promo: 'FIA4', semester: 7 });
  assert.deepEqual(promoOfCategory(''), { promo: 'Transversal', semester: null });
});

test('seules les adresses de Moodle sont demandées par le tunnel', () => {
  assert.equal(moodleUrl('/pluginfile.php/1/a.pdf'), 'https://moodle.univ-jfc.fr/pluginfile.php/1/a.pdf');
  assert.equal(moodleUrl('https://evil.example/pluginfile.php'), '');
  assert.equal(moodleUrl('https://moodle.univ-jfc.fr.evil.example/x'), '');
  assert.equal(webUrl('javascript:alert(1)'), '');
  assert.equal(webUrl('https://www.apec.fr/'), 'https://www.apec.fr/');
  assert.equal(cmIdOf('https://moodle.univ-jfc.fr/mod/assign/view.php?id=81243'), 81243);
  assert.equal(courseIdOf('https://moodle.univ-jfc.fr/course/view.php?id=2180'), 2180);
  assert.equal(cmIdOf('https://moodle.univ-jfc.fr/course/view.php?id=2180'), null);
});

test('styles retirés avant analyse', () => {
  assert.equal(stripStyles('<p style="color:red">a</p><style>p{}</style>'), '<p>a</p>');
});

test('semestres de la classe : deux par année, celui en cours selon le mois', async () => {
  const { semestersOf } = await import('../web/js/portals/moodle-course.js');
  assert.deepEqual(semestersOf('FIA4', new Date(2026, 10, 22)), { list: [7, 8], current: 7 });
  assert.deepEqual(semestersOf('FIA4', new Date(2027, 0, 10)), { list: [7, 8], current: 7 });
  assert.deepEqual(semestersOf('FIE1', new Date(2027, 2, 1)), { list: [1, 2], current: 2 });
  assert.equal(semestersOf(''), null);
});
