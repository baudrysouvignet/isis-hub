// Rubrique Stages : recherche, filtres, zones de la carte et fiche d'une structure, à partir d'un
// index comme le sert le serveur (aucune adresse e-mail) : `npm test`.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createModel, blank, PAGE } from '../web/js/stages/model.js';

const geo = {
  DEPTS: [{ c: '81', n: 'Tarn', r: '76' }, { c: '31', n: 'Haute-Garonne', r: '76' }, { c: '75', n: 'Paris', r: '11' }],
  REGIONS: [{ c: '76', n: 'Occitanie' }, { c: '11', n: 'Île-de-France' }],
};
const ix = {
  built: '2026-11-28',
  places: [
    { id: 'fr:81065', n: 'Castres', dep: '81', reg: '76', x: 548, y: 851 },
    { id: 'fr:31555', n: 'Toulouse', dep: '31', reg: '76', x: 480, y: 840 },
    { id: 'fr:75056', n: 'Paris', dep: '75', reg: '11', x: 560, y: 260 },
    { id: 'abroad:montreal', n: 'Montréal', zone: 'monde', pays: 'Canada' },
  ],
  companies: [
    { id: 'c1', n: 'Centre Hospitalier Intercommunal Castres-Mazamet', m: 'CHIC', c: 3, p: 'fr:81065', s: 'Santé', st: 'Hôpital public', k: ['s1', 's2', 's3'], paid: 1, variants: ['CHIC'], sites: [], also: [] },
    { id: 'c2', n: 'Pierre Fabre', m: 'PF', c: 9, p: 'fr:81065', s: 'Pharmacie', st: 'Privé', k: ['s4'], paid: 0, variants: [], sites: [], also: ['c3'] },
    { id: 'c3', n: 'Pierre Fabre', m: 'PF', c: 9, p: 'fr:31555', s: 'Pharmacie', st: 'Privé', k: ['s5'], paid: 1, variants: [], sites: [], also: ['c2'] },
    { id: 'c4', n: 'AP-HP', m: 'AP', c: 1, p: 'fr:75056', s: 'Santé', st: 'Hôpital public', k: ['s6'], paid: 0, variants: [], sites: [], also: [] },
    { id: 'c5', n: 'Polytechnique Montréal', m: 'PM', c: 5, p: 'abroad:montreal', s: 'Enseignement', k: ['s7'], paid: 0, variants: [], sites: [], also: [] },
  ],
  stages: [
    { id: 's1', e: 'c1', pr: 2028, f: 3, au: 2025, d: '2026-04', wk: 8, mi: 'Catalogue des examens d’IRM', et: 'Léa Martin', tu: 'p1', rh: 'p2' },
    { id: 's2', e: 'c1', pr: 2027, f: 3, au: 2024, d: '2025-04', wk: 8, mi: '', et: 'Hugo Bernard', tu: 'p1' },
    { id: 's3', e: 'c1', pr: 2030, f: 1, au: 2025, d: '2026-05', wk: 4, mi: 'Maintenance informatique', et: 'Emma Petit' },
    { id: 's4', e: 'c2', pr: 2026, f: 5, au: 2025, d: '2026-02', wk: 24, mi: 'Data analyst supply chain', et: 'Inès Garcia', tu: 'p3' },
    { id: 's5', e: 'c3', pr: 2027, f: 4, au: 2025, d: '2026-04', wk: 12, mi: 'Qualité des données', et: 'Tom Roux' },
    { id: 's6', e: 'c4', pr: 2026, f: 4, au: 2024, d: '2025-05', wk: 10, mi: 'Analyse de données', et: 'Zoé Laurent', rh: 'p4' },
    { id: 's7', e: 'c5', pr: 2026, f: 5, au: 2025, d: '2026-02', wk: 20, mi: 'Recherche en IA', et: 'Nina Faure' },
  ],
  contacts: [
    { id: 'p1', civ: 'M.', n: 'Paul Durand', role: 'Ingénieur', hm: true, kinds: ['maitre'], last: '2026-04' },
    { id: 'p2', civ: 'Mme', n: 'Claire Moreau', role: 'DRH', hm: true, generic: true, kinds: ['rh'], last: '2026-04' },
    { id: 'p3', civ: 'M.', n: 'Marc Lefort', role: 'Manager', kinds: ['maitre'], last: '2026-02' },
    { id: 'p4', civ: 'Mme', n: 'Julie Bonnet', role: 'RH', hm: true, kinds: ['rh'], last: '2025-05' },
  ],
};

test('stages : comptes par région, département, ville et hors métropole', () => {
  const m = createModel(ix, geo);
  const r = m.search(blank(), { kind: 'fr' });
  assert.equal(r.counts.total, 7);
  assert.deepEqual(r.counts.reg, { 76: 5, 11: 1 });
  assert.deepEqual(r.counts.dep, { 81: 4, 31: 1, 75: 1 });
  assert.equal(r.counts.away.monde, 1);
  assert.equal(r.zone.companies, 4, 'la France : les structures de métropole seulement');
  assert.equal(r.items[0].id, 'c1', 'le plus de stages d’abord');
  const castres = r.counts.places.find((p) => p.id === 'fr:81065');
  assert.equal(castres.n, 4);
  assert.equal(castres.cos, 2);
  assert.equal(m.search(blank(), { kind: 'away', code: 'monde' }).items[0].id, 'c5');
  assert.equal(m.search(blank(), { kind: 'dep', code: '31' }).items[0].id, 'c3');
});

test('stages : recherche par structure, ville, région, mission et personne', () => {
  const m = createModel(ix, geo);
  const ids = (q) => m.search({ ...blank(), q }, { kind: 'fr' }).items.map((it) => it.id).sort();
  assert.deepEqual(ids('chic'), ['c1'], 'nom saisi (variante)');
  assert.deepEqual(ids('toulouse'), ['c3'], 'ville');
  assert.deepEqual(ids('occitanie'), ['c1', 'c2', 'c3'], 'région');
  assert.deepEqual(ids('irm'), ['c1'], 'mission');
  assert.deepEqual(ids('lefort'), ['c2'], 'maître de stage');
  assert.deepEqual(ids('hôpital castres'), ['c1'], 'plusieurs mots, accents ignorés');
  const it = m.search({ ...blank(), q: 'irm' }, { kind: 'fr' }).items[0];
  assert.equal(it.n, 1, 'seul le stage qui correspond compte');
  assert.equal(it.total, 3);
});

test('stages : filtres niveau, durée, gratifiés, avec contact, statut', () => {
  const m = createModel(ix, geo);
  const ids = (f) => m.search({ ...blank(), ...f }, { kind: 'fr' }).items.map((it) => it.id).sort();
  assert.deepEqual(ids({ level: new Set([4]) }), ['c3', 'c4']);
  assert.deepEqual(ids({ dur: new Set(['court']) }), ['c1']);
  assert.deepEqual(ids({ dur: new Set(['pfe']) }), ['c2']);
  assert.deepEqual(ids({ paid: true }), ['c1', 'c3']);
  assert.deepEqual(ids({ contact: true }), ['c1', 'c4'], 'une adresse chez le maître de stage ou le RH');
  assert.deepEqual(ids({ statut: new Set(['Privé']) }), ['c2', 'c3']);
  assert.deepEqual(ids({ year: new Set([2024]) }), ['c1', 'c4']);
  assert.deepEqual(m.levels, [1, 3, 4, 5]);
});

test('stages : pages de 12 structures, sans « tout afficher »', () => {
  const many = structuredClone(ix);
  for (let i = 0; i < 30; i++) {
    many.companies.push({ id: `x${i}`, n: `Structure ${i}`, m: 'S', c: 0, p: 'fr:81065', s: 'Autre', st: '', k: [`t${i}`], paid: 0, variants: [], sites: [], also: [] });
    many.stages.push({ id: `t${i}`, e: `x${i}`, f: 1, au: 2025, d: '2026-01', wk: 4, et: `Élève ${i}` });
  }
  const m = createModel(many, geo);
  const p0 = m.search(blank(), { kind: 'fr' });
  assert.equal(p0.items.length, PAGE);
  assert.equal(p0.pages, 3);
  const last = m.search(blank(), { kind: 'fr' }, { page: 99 });
  assert.equal(last.page, 2, 'page bornée');
  assert.equal(last.items.length, 34 - 2 * PAGE);
});

test('stages : fiche d’une structure, contacts complétés par la fiche lue au serveur', () => {
  const m = createModel(ix, geo);
  const d = m.detail('c1', ['s1']);
  assert.deepEqual(d.stages.map((s) => s.id), ['s3', 's1', 's2'], 'les plus récents d’abord');
  assert.deepEqual(d.stages.filter((s) => s.match).map((s) => s.id), ['s1']);
  assert.equal(d.people.length, 2);
  const tutor = d.people.find((p) => p.id === 'p1');
  assert.equal(tutor.n, 2, 'stagiaires encadrés');
  assert.deepEqual([...tutor.kinds], ['maitre']);
  // Sans la fiche : pas d'adresse (l'index n'en a aucune). Avec : l'adresse lue au serveur.
  assert.equal(m.contact('p1').mail, '');
  assert.equal(m.contact('p1').hasMail, true);
  const full = new Map([['p1', { id: 'p1', mail: 'paul.durand@ch-exemple.fr', old: ['p.durand@ch-exemple.fr'] }]]);
  assert.equal(m.contact('p1', full).mail, 'paul.durand@ch-exemple.fr');
  assert.deepEqual(m.contact('p1', full).old, ['p.durand@ch-exemple.fr']);
  const st = m.stage('s1', full);
  assert.equal(st.tutor.mail, 'paul.durand@ch-exemple.fr');
  assert.equal(st.hr.name, 'Claire Moreau');
  assert.deepEqual(m.detail('c2').also.map((a) => a.place), ['Toulouse']);
});

test('stages : tuile « comme moi »', () => {
  const m = createModel(ix, geo);
  const r = m.forLevel(3);
  assert.equal(r.stages, 2);
  assert.equal(r.companies, 1);
  assert.equal(r.cities, 1);
  assert.equal(m.forLevel(null).stages, 7);
});
