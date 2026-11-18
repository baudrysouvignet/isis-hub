// Notes (calculs de la maquette) et sauvegarde anonyme (chiffrement, fusion) : `npm test`.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createGrades, f2, f1up, shortDate, period } from '../web/js/core/grades.js';
import * as sync from '../web/js/net/sync.js';
import * as UD from '../web/js/core/userdata.js';

// Maquette de démonstration (même structure et mêmes notes que la maquette « 08-notes »).
const ev = (id, label, coef, date = '') => ({ id, label, coef, date });
const DEF = {
  rules: { ue: 10, matiere: 7 },
  semesters: [
    {
      id: 'S7',
      label: 'Semestre 7',
      start: '2026-09-01',
      end: '2027-01-31',
      ues: [
        { id: '7.1', name: 'SI de santé', coef: 6, matieres: [
          { id: 'interop', name: 'Interopérabilité', coef: 3, code: 'A4-1-ISI-2', evals: [ev('i1', 'Quiz FHIR', 1, '2026-11-05'), ev('i2', 'Projet HL7', 2, '2026-12-11'), ev('i3', 'Examen', 3, '2027-01-14')] },
          { id: 'bda', name: 'BDA', coef: 3, evals: [ev('b1', 'TD 1', 1), ev('b2', 'TD 2', 1), ev('b3', 'Examen', 2, '2027-01-12')] },
        ] },
        { id: '7.2', name: 'Sécurité', coef: 5, matieres: [
          { id: 'cyber', name: 'Cyber', coef: 3, evals: [ev('c1', 'TP', 1), ev('c2', 'Examen', 2)] },
          { id: 'dws', name: 'Web sécurisé', coef: 2, evals: [ev('d1', 'Projet', 2), ev('d2', 'Soutenance', 1)] },
        ] },
        { id: '7.3', name: 'IA', coef: 4, matieres: [{ id: 'ias', name: 'IA santé', coef: 4, evals: [ev('a1', 'TP 1', 1), ev('a2', 'Partiel', 2), ev('a3', 'Examen', 2, '2027-01-15')] }] },
        { id: '7.4', name: 'Gestion et langues', coef: 5, matieres: [
          { id: 'gpa', name: 'Agile', coef: 2, evals: [ev('g1', 'Examen', 1, '2026-11-19')] },
          { id: 'ang', name: 'Anglais', coef: 2, evals: [ev('e1', 'Oral', 1), ev('e2', 'Écrit', 2, '2027-01-08')] },
          { id: 'dro', name: 'Droit', coef: 1, evals: [ev('r1', 'Dossier', 1)] },
          { id: 'ptut', name: 'Projet tutoré', coef: 3, evals: [ev('p1', 'Jalon 1', 1), ev('p2', 'Jalon 2', 1), ev('p3', 'Soutenance', 2)] },
        ] },
      ],
    },
    { id: 'S8', label: 'Semestre 8', start: '2027-02-01', end: '2027-06-30', ues: [{ id: '8.1', name: 'Décisionnel', coef: 6, matieres: [{ id: 'bi', name: 'BI', coef: 3, evals: [ev('s8', 'Examen', 1)] }] }] },
  ],
};
const VALUES = { i1: 16, b1: 15, b2: 13.5, c1: 9, d1: 14, a1: 12.5, a2: 8.5, e1: 6.5, r1: 14, p1: 15 };

test('notes : moyennes identiques à la maquette', () => {
  const N = createGrades(DEF, { saved: { values: VALUES }, today: '2026-11-16' });
  const S = N.currentSem();
  assert.equal(S.id, 'S7');
  assert.equal(f2(N.avgS(S)), '12,25');
  assert.deepEqual(S.ues.map((U) => f2(N.avgU(U))), ['15,13', '11,00', '9,83', '12,00']);
  const st = N.semState(S);
  assert.equal(st.kind, 'fail');
  assert.deepEqual(st.failing.map((U) => U.id), ['7.3', '7.4'], '7.3 sous 10, 7.4 à cause de l’anglais sous 7');
  assert.equal(N.allEvals(S).length - st.rest, 10);
  assert.equal(Math.round(N.progress(S) * 100), 41);
});

test('notes : note nécessaire, coach et simulation', () => {
  const N = createGrades(DEF, { saved: { values: VALUES }, today: '2026-11-16' });
  const n = N.needFor('U:7.3', 10);
  assert.equal(n.state, 'need');
  assert.equal(f1up(n.x), '10,3', 'il faut 10,3 à l’examen (maquette)');
  assert.equal(N.needLine(n), 'Il te faut 10,3 à l’examen (coef 2).');
  const tips = N.coach(N.currentSem()).map((t) => t.t);
  assert.ok(tips.includes('UE 7.3 · 9,83 de moyenne'));
  assert.ok(tips.includes('Anglais · 6,5'));
  // La simulation ne touche jamais aux vraies notes ni à ce qui est enregistré.
  N.simOn = true;
  N.sim.a3 = 10.3;
  assert.equal(N.stU(N.UE_OF.ias), 'ok');
  N.simOn = false;
  assert.equal(N.stU(N.UE_OF.ias), 'fail');
  assert.equal(N.dump().values.a3, undefined);
  assert.equal(N.needFor('M:gpa', 7).state, 'need');
  assert.equal(N.needFor('S:S8', 10).state, 'need');
});

test('notes : saisies personnelles, notes ajoutées, valeurs hors bornes écartées', () => {
  const N = createGrades(DEF, {
    saved: { values: { i1: 25, b1: -2, c1: 'x', inconnu: 12, i2: 18 }, extra: [{ id: 'n1', mat: 'dro', label: 'Oral bonus', coef: 1, date: '2026-11-20', value: 16 }, { id: 'n2', mat: 'nexiste-pas', value: 3 }] },
    today: '2026-11-16',
  });
  assert.equal(N.real.i1, null, 'note > 20 refusée');
  assert.equal(N.real.b1, null, 'note < 0 refusée');
  assert.equal(N.real.i2, 18);
  assert.equal(N.avgM(N.MAT.dro), 16);
  assert.ok(!N.EV.n2, 'matière inconnue ignorée');
  const dump = N.dump();
  assert.deepEqual(dump.values, { i2: 18 });
  assert.equal(dump.extra[0].label, 'Oral bonus');
  assert.equal(N.nextEval(N.currentSem()).id, 'g1');
  assert.ok(N.isSoon(N.EV.g1));
  assert.equal(N.course('a4-1-isi-2').M.id, 'interop', 'lien avec le code ADE de la séance');
});

test('notes : dates et périodes en français', () => {
  assert.equal(shortDate('2027-01-14'), '14 janv.');
  assert.equal(shortDate(''), '');
  assert.equal(period(DEF.semesters[0]), 'sept. 2026 → janv. 2027');
  assert.equal(period(DEF.semesters[1]), 'févr. → juin 2027');
});

// ------------------------------------------------------------ sauvegarde anonyme

test('sauvegarde : même identifiant pour la même personne, rien de lisible côté serveur', async () => {
  const a = await sync.credentials(await sync.deriveSecret('LMartin ', 'mot de passe', 1000));
  const b = await sync.credentials(await sync.deriveSecret('lmartin', 'mot de passe', 1000));
  const c = await sync.credentials(await sync.deriveSecret('lmartin', 'autre mot de passe', 1000));
  assert.equal(a.id, b.id, 'identifiant indépendant de la casse et des espaces');
  assert.notEqual(a.id, c.id);
  assert.match(a.id, /^[0-9a-f]{64}$/);
  assert.match(a.auth, /^[A-Za-z0-9_-]{43}$/);
  assert.ok(!a.id.includes('6c6d617274696e'), 'l’identifiant universitaire n’apparaît pas');

  const sealed = await sync.seal(a, { notes: { FIA4: { values: { i1: 16 } } } });
  assert.ok(!Buffer.from(sealed, 'base64').toString('latin1').includes('FIA4'), 'données chiffrées');
  assert.deepEqual(await sync.open(b, sealed), { notes: { FIA4: { values: { i1: 16 } } } });
  await assert.rejects(sync.open(c, sealed), 'une autre clé ne déchiffre pas');
  // Lié à l'identifiant : recopié sous un autre nom, le contenu est refusé.
  await assert.rejects(sync.open({ ...a, id: c.id }, sealed));
});

test('sauvegarde : fusion entre appareils, la modification la plus récente gagne', async () => {
  // Faux serveur en mémoire : même contrat que /api/vault.
  const server = new Map();
  globalThis.fetch = async (_url, init) => {
    const { op, id, auth, v, data } = JSON.parse(init.body);
    const rec = server.get(id);
    const json = (status, body) => ({ status, json: async () => body });
    if (rec && rec.auth !== auth) return json(403, { error: 'refusé' });
    if (op === 'read') return rec ? json(200, { v: rec.v, data: rec.data }) : json(404, {});
    if (op === 'write') {
      if ((rec?.v ?? 0) !== v) return json(409, { v: rec.v, data: rec.data });
      server.set(id, { auth, v: v + 1, data });
      return json(200, { v: v + 1 });
    }
    server.delete(id);
    return { status: 204, json: async () => null };
  };
  const secret = await sync.deriveSecret('lmartin', 'secret', 1000);
  const stored = [];
  const vault = { loadUserData: async () => null, saveUserData: (d) => stored.push(d) };

  // Appareil 1 : des notes, puis connexion → envoyées.
  await UD.initUserData(vault);
  UD.set('notes', { FIA4: { values: { i1: 16 } } });
  await UD.connect(secret);
  assert.equal(UD.syncStatus(), 'ok');
  assert.equal(server.size, 1);
  const [id] = server.keys();
  assert.match(id, /^[0-9a-f]{64}$/);

  // Appareil 2 (copie locale vide, règles de mails plus récentes) : récupère les notes, garde ses règles.
  UD.disconnect();
  await UD.initUserData(vault);
  UD.set('mail', { tags: [], rules: [], marks: {} });
  const seen = [];
  UD.onUserData((t) => seen.push(...t));
  await UD.connect(secret);
  assert.deepEqual(UD.get('notes'), { FIA4: { values: { i1: 16 } } });
  assert.ok(seen.includes('notes'));
  const remote = await sync.open(await sync.credentials(secret), server.get(id).data);
  assert.ok(remote.sections.mail && remote.sections.notes, 'le serveur a les deux rubriques, chiffrées');

  // Déconnexion : plus rien sur l'appareil, la sauvegarde reste.
  UD.disconnect();
  assert.equal(UD.get('notes'), null);
  assert.equal(server.size, 1);
  // Effacement complet.
  await UD.connect(secret);
  await UD.eraseEverywhere();
  assert.equal(server.size, 0);
});

// ------------------------------------------------------------ import JSON (administration)

import { normalizeImport, isoDate } from '../web/js/core/grades-import.js';

test('import : une classe, plusieurs classes, format de la démo', () => {
  const one = normalizeImport({ semesters: [{ label: 'Semestre 7', start: '2026-09-01', end: '2027-01-31', ues: [{ name: 'UE A', coef: '6', matieres: [{ name: 'Maths', coef: '2,5', code: 'a4-1-mat-1', evals: [{ label: 'Examen', coef: 2, date: '14 janv.' }] }] }] }] }, { currentClass: 'FIA4' });
  const M = one.FIA4.semesters[0].ues[0].matieres[0];
  assert.equal(one.FIA4.semesters[0].ues[0].id, '1.1');
  assert.equal(M.coef, 2.5);
  assert.equal(M.code, 'A4-1-MAT-1');
  assert.match(M.id, /^m-[a-z0-9]+$/);
  assert.equal(M.evals[0].date, '2027-01-14', 'janvier : année suivante');
  assert.deepEqual(one.FIA4.rules, { ue: 10, matiere: 7 });

  const many = normalizeImport({ FIE4: { semesters: [{ id: 'S7', start: '2026-09-01', end: '2027-01-31', ues: [] }] }, FIE5: { semesters: [{ id: 'S9', start: '2026-09-01', end: '2027-01-31', ues: [] }] } });
  assert.deepEqual(Object.keys(many), ['FIE4', 'FIE5']);

  const demo = normalizeImport({ grades: { year: 'FIA4 · 2026-2027', rules: { ue: 10, matiere: 7 }, semesters: [{ id: 'S7', label: 'Semestre 7', start: '2026-09-01', end: '2027-01-31', ues: [{ id: '7.1', name: 'SI', coef: 6, matieres: [{ id: 'interop', name: 'Interop', coef: 3, evals: [{ id: 's7-int-1', label: 'Quiz', coef: 1, value: 16, date: '5 nov.' }] }] }] }] } }, { currentClass: 'FIA4' });
  const e = demo.FIA4.semesters[0].ues[0].matieres[0].evals[0];
  assert.equal(e.id, 's7-int-1', 'identifiants valides gardés');
  assert.equal(e.date, '2026-11-05');
  assert.equal(e.value, undefined, 'aucune note d’étudiant importée');
});

test('import : erreurs claires', () => {
  assert.throws(() => normalizeImport([]), /objet JSON/);
  assert.throws(() => normalizeImport({ 'fia4 ': {} }), /classes invalides/);
  // Dates de semestre facultatives : le semestre en cours est choisi par l'étudiant.
  assert.doesNotThrow(() => normalizeImport({ semesters: [{ label: 'S7', ues: [] }] }, { currentClass: 'FIA4' }));
  assert.throws(() => normalizeImport({ FIA4: { ues: [] } }), /semesters/);
  // Identifiants en double : le second est renommé.
  const d = normalizeImport({ semesters: [{ start: '2026-09-01', end: '2027-01-31', ues: [{ name: 'U', coef: 1, matieres: [{ id: 'x', name: 'A', coef: 1, evals: [] }, { id: 'x', name: 'B', coef: 1, evals: [] }] }] }] }, { currentClass: 'FIA4' });
  const [a, b] = d.FIA4.semesters[0].ues[0].matieres;
  assert.notEqual(a.id, b.id);
  assert.equal(isoDate('14/01/2027'), '2027-01-14');
});

import { EXAMPLE } from '../web/js/admin-grades-example.js';

test('import : le JSON d’exemple de l’administration est valide et utilisable', () => {
  const { FIA4 } = normalizeImport(structuredClone(EXAMPLE), { currentClass: 'FIA4' });
  assert.equal(FIA4.semesters.length, 2);
  const ids = FIA4.semesters.flatMap((s) => s.ues.flatMap((u) => u.matieres.flatMap((m) => [m.id, ...m.evals.map((e) => e.id)])));
  assert.equal(new Set(ids).size, ids.length, 'identifiants uniques');
  assert.ok(ids.every((id) => /^[a-z0-9][a-z0-9-]{0,47}$/.test(id)), 'identifiants au format du serveur');
  const N = createGrades(FIA4, { today: '2026-11-16' });
  assert.equal(N.currentSem().id, 'S7');
  assert.equal(N.semState(N.currentSem()).kind, 'none');
});

test('sauvegarde : la classe suit l’étudiant, les notes attendent la lecture du serveur', async () => {
  const server = new Map();
  globalThis.fetch = async (_url, init) => {
    const { op, id, auth, v, data } = JSON.parse(init.body);
    const rec = server.get(id);
    const json = (status, body) => ({ status, json: async () => body });
    if (op === 'read') return rec ? json(200, { v: rec.v, data: rec.data }) : json(404, {});
    if (op === 'write') {
      if ((rec?.v ?? 0) !== v) return json(409, { v: rec.v, data: rec.data });
      server.set(id, { auth, v: v + 1, data });
      return json(200, { v: v + 1 });
    }
    return { status: 204, json: async () => null };
  };
  const secret = await sync.deriveSecret('lmartin', 'secret', 1000);
  const vault = { loadUserData: async () => null, saveUserData: () => {} };

  // Appareil 1 : classe choisie une fois connecté.
  UD.disconnect();
  await UD.initUserData(vault);
  assert.equal(UD.isReady(), false, 'pas de notes avant la lecture du serveur');
  await UD.connect(secret);
  assert.equal(UD.isReady(), true);
  UD.set('profile', { promo: 'FIE4', choice: { track: 'ia', group: '1' } });
  await new Promise((r) => setTimeout(r, 1700)); // envoi groupé

  // Navigation privée : rien sur l'appareil, la classe revient du serveur.
  UD.disconnect();
  await UD.initUserData(vault);
  assert.equal(UD.get('profile'), null);
  await UD.connect(secret);
  assert.deepEqual(UD.get('profile'), { promo: 'FIE4', choice: { track: 'ia', group: '1' } });
});

test('notes : semestre en cours choisi par l’étudiant, examens de l’emploi du temps reliés par code', () => {
  const N = createGrades(DEF, { saved: { values: VALUES }, today: '2026-11-16' });
  assert.equal(N.currentSem().id, 'S7', 'par défaut : le premier semestre');
  assert.equal(N.setCurrent('S8').id, 'S8', '« Terminer le semestre »');
  assert.equal(N.setCurrent('S99').id, 'S8', 'semestre inconnu ignoré');
  const again = createGrades(DEF, { saved: { values: VALUES }, current: 'S8', today: '2026-11-16' });
  assert.equal(again.currentSem().id, 'S8', 'repris de la sauvegarde');

  // BDA (code A4-1-BDA-1 ajouté ici) : « Examen » sans date + deux examens dans ADE.
  const def = structuredClone(DEF);
  def.semesters[0].ues[0].matieres[1].code = 'A4-1-BDA-1';
  def.semesters[0].ues[0].matieres[1].evals[2].date = '';
  const G = createGrades(def, { saved: { values: VALUES }, today: '2026-11-16' });
  G.setAdeExams({ 'A4-1-BDA-1': ['2027-01-12', '2026-12-03'], 'A4-1-ISI-2': ['2027-01-14'] });
  assert.equal(G.dateOf(G.EV.b3), '2026-12-03', 'la première date d’examen va à l’évaluation « Examen » sans date');
  assert.deepEqual(G.proposalsOf(G.MAT.bda).map((p) => p.date), ['2027-01-12'], 'l’examen en plus devient une proposition');
  assert.equal(G.proposalsOf(G.MAT.interop).length, 0, 'date déjà prévue dans la maquette : pas de doublon');
  assert.equal(G.dateOf(G.EV.i3), '2027-01-14');
  const next = G.nextEval(G.currentSem());
  assert.equal(next.id, 'g1', 'la prochaine évaluation tient compte des deux sources');
  const course = G.course('A4-1-BDA-1');
  assert.ok(course.evals.some((x) => x.proposal && x.date === '2027-01-12'), 'visible dans la fiche du cours');
});
