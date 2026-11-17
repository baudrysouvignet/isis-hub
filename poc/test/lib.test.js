import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseIcal } from '../app/lib/ade.js';
import { courseCode, createMatcher } from '../app/lib/match.js';
import * as D from '../app/lib/dates.js';

// Extraits réels de l'export iCal d'ADE (lignes repliées et échappements compris).
const ICS = [
  'BEGIN:VCALENDAR',
  'VERSION:2.0',
  'BEGIN:VEVENT',
  'DTSTART:20261117T091500Z',
  'DTEND:20261117T111500Z',
  'SUMMARY:CM-A4-1-ISI-1 Architect. fonct. et techn. des SIS',
  'LOCATION:ISIS - B105',
  'DESCRIPTION:\\nISI-1 Architecture fonctionnelle et technique des SIS\\nInter',
  ' venant : Fabien MOULET\\nCM-A4-1-ISI-1 Architect. fonct. et techn. des SIS',
  ' \\n(Exporté le:16/11/2026 14:36)\\n',
  'UID:ADE-2',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'DTSTART:20261116T071500Z',
  'DTEND:20261116T091500Z',
  'SUMMARY:CM-A5-1-GPD-2 Cybersécurité:Cryptograph. & filtrag',
  'LOCATION:ISIS - B019a',
  'DESCRIPTION:\\nA5-1-GPD Gestion des processus et données de santé\\nCM-E5-1-',
  ' IDSNS-6\\nCM-A5-1-GPD-2 Cybersécurité:Cryptograph. & filtrag\\nTRIGUI Emna\\n',
  'UID:ADE-1',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'DTSTART:20261118T070000Z',
  'DTEND:20261118T110000Z',
  'SUMMARY:Université de la E-SANTE',
  'LOCATION:',
  'DESCRIPTION:\\n\\nPrésence Obligatoire\\nISIS-FIA4-SEMESTRE7\\nISIS-FIA3-SEMEST',
  ' RE5\\n(Exporté le:16/11/2026 14:36)\\n',
  'UID:ADE-3',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'DTSTART:20261119T071500Z',
  'DTEND:20261119T091500Z',
  'SUMMARY:CM-A4-1-SES-3 Sciences médicales',
  'LOCATION:ISIS - B007',
  'DESCRIPTION:\\nSES-3 Sciences médicales\\nExamen\\nCM-A4-1-SES-3 Sciences méd',
  ' icales\\nBONY Jean-Charles\\n',
  'UID:ADE-4',
  'END:VEVENT',
  'END:VCALENDAR',
].join('\r\n');

test('parseIcal : séances triées, titres complets, salle, remarques', () => {
  const [gpd, isi, esante, exam] = parseIcal(ICS);

  assert.equal(gpd.code, 'A5-1-GPD-2');
  assert.equal(gpd.title, 'Cybersécurité:Cryptograph. & filtrag');
  assert.deepEqual(gpd.notes, ['Gestion des processus et données de santé', 'TRIGUI Emna']);
  assert.equal(D.time(gpd.start), '08:15'); // 07:15 UTC, heure d'hiver à Paris

  assert.deepEqual(
    { code: isi.code, kind: isi.kind, title: isi.title, room: isi.room, notes: isi.notes },
    {
      code: 'A4-1-ISI-1',
      kind: 'CM',
      title: 'Architecture fonctionnelle et technique des SIS',
      room: 'B105',
      notes: ['Intervenant : Fabien MOULET'],
    },
  );

  assert.deepEqual(
    { code: esante.code, kind: esante.kind, title: esante.title, notes: esante.notes },
    { code: null, kind: null, title: 'Université de la E-SANTE', notes: ['Présence Obligatoire'] },
  );

  assert.equal(exam.exam, true);
});

test('courseCode : même code côté ADE et côté Moodle', () => {
  assert.equal(courseCode('TD-A4-1-ISI-2 Aide à la décision'), 'A4-1-ISI-2');
  assert.equal(courseCode('FIA4-1-ISI-2 - Aide à la décision'), 'A4-1-ISI-2');
  assert.equal(courseCode('Épidémiologie et santé des données (E3-1-ID-3)'), 'E3-1-ID-3');
  assert.equal(courseCode('TP-E5-1-IDSNS-6 Cybersécurité'), 'E5-1-IDSNS-6');
  assert.equal(courseCode('Université de la E-SANTE'), null);
  assert.equal(courseCode('ISIS-FIA4-SEMESTRE7'), null);
});

test('matcher : même code d’abord (inscrit, puis recherche), sinon même intitulé dans la promo', async () => {
  const searched = [];
  const catalogue = [
    { id: 1572, fullname: 'FIA4-1-ISI-1 Architecture fonctionnelle', shortname: 'FIA4-1-ISI-1 Architecture', idnumber: '', category: 'ISIS-FIA4-SEMESTRE7' },
    { id: 2258, fullname: 'FIA4-1-LA-1 - Anglais', shortname: 'FIA4-1-LA-1 - Anglais', idnumber: '', category: 'ISIS-FIA4-SEMESTRE7' },
    { id: 2263, fullname: 'FIA4-2-LSS-1 - Anglais et interculturalité', shortname: 'FIA4-2-LSS-1', idnumber: '', category: 'ISIS-FIA4-SEMESTRE8' },
    { id: 2252, fullname: 'A5-LES1-1 - Anglais', shortname: 'A5-LES1-1 - Anglais', idnumber: '', category: 'ISIS-FIA5-SEMESTRE 9' },
  ];
  const matcher = createMatcher({
    search: async (query) => {
      searched.push(query);
      const terms = query.toLowerCase().split(' ');
      return catalogue.filter((c) => terms.every((t) => `${c.fullname} ${c.category}`.toLowerCase().includes(t)));
    },
  });
  const enrolled = [
    { id: 2125, fullname: 'FIA4-1-ISI-2 - Aide à la décision', shortname: 'FIA4-1-ISI-2 - Aide à la décision', idnumber: 'FIA4-1-ISI-2', category: 'ISIS-FIA4-SEMESTRE7' },
    { id: 2180, fullname: 'FIA4-1-SES-1 - Epidémiologie', shortname: 'FIA4-1-SES-1 - Epidémiologie', idnumber: 'A4-1-SES-1', category: 'ISIS-FIA4-SEMESTRE7' },
    { id: 1937, fullname: 'Apprentissage à ISIS', shortname: 'Suivi-alternance', idnumber: '', category: 'Cycle ingenieur statut apprenti' },
  ];
  matcher.setEnrolled(enrolled);

  const events = [
    { code: 'A4-1-ISI-2', title: 'Aide à la décision' },
    { code: 'A4-1-ISI-1', title: 'Architecture fonctionnelle et technique des SIS' },
    { code: 'A4-1-ISI-1', title: 'Architecture fonctionnelle et technique des SIS' },
    { code: 'A4-1-LSS-1', title: 'Anglais' },
    { code: 'A4-1-LSS-3', title: 'Sociologie de la santé' },
    { code: null, title: 'Université de la E-SANTE' },
  ];
  assert.equal(await matcher.resolve(events), true);

  assert.deepEqual(matcher.get('A4-1-ISI-2'), { course: enrolled[0], enrolled: true, approx: false });
  assert.equal(matcher.get('A4-1-SES-1').course.id, 2180);
  assert.deepEqual(matcher.get('A4-1-ISI-1'), { course: catalogue[0], enrolled: false, approx: false });
  // Code inconnu de Moodle : on retient le cours de même intitulé de la promo FIA4, pas celui de FIA5.
  assert.deepEqual(matcher.get('A4-1-LSS-1'), { course: catalogue[1], enrolled: false, approx: true });
  assert.equal(matcher.get('A4-1-LSS-3'), null);
  assert.deepEqual(searched.sort(), ['A4-1-ISI-1', 'A4-1-LSS-1', 'A4-1-LSS-3', 'Anglais FIA4', 'Sociologie de la santé FIA4']);

  assert.equal(await matcher.resolve(events), false); // tout est mémorisé, plus aucune recherche
  assert.equal(searched.length, 5);
});

test('dates : semaines civiles en heure de Paris', () => {
  assert.equal(D.mondayOf('2026-11-22'), '2026-11-16');
  assert.equal(D.mondayOf('2026-11-16'), '2026-11-16');
  assert.equal(D.addDays('2026-12-28', 7), '2027-01-04');
  assert.equal(D.isoWeek('2026-11-16'), 47);
  assert.equal(D.isoWeek('2026-12-28'), 53);
  assert.equal(D.isoWeek('2027-01-04'), 1);
  assert.equal(D.dayKey(new Date('2026-11-16T23:30:00Z')), '2026-11-17'); // déjà mardi à Paris
  assert.equal(D.weekLabel('2026-11-16'), 'Semaine du 16 au 22 novembre');
  assert.equal(D.weekLabel('2026-11-30'), 'Semaine du 30 nov. au 6 décembre');
});
