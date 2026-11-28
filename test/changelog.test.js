import test from 'node:test';
import assert from 'node:assert/strict';
import { CHANGELOG, LATEST, cmpVersion, unseen } from '../web/js/core/changelog.js';

test('journal : versions uniques, de la plus récente à la plus ancienne, contenu complet', () => {
  const versions = CHANGELOG.map((e) => e.version);
  assert.equal(new Set(versions).size, versions.length);
  for (let i = 1; i < CHANGELOG.length; i += 1) assert.ok(cmpVersion(CHANGELOG[i - 1].version, CHANGELOG[i].version) > 0);
  for (const e of CHANGELOG) {
    assert.match(e.date, /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(e.title && e.short.length >= 1 && e.short.length <= 3, e.version);
    assert.ok(e.details.length >= e.short.length - 1, e.version);
  }
  assert.equal(LATEST, CHANGELOG[0].version);
});

test('journal : comparaison de versions', () => {
  assert.ok(cmpVersion('1.0.10', '1.0.9') > 0);
  assert.ok(cmpVersion('1.0.0', '0.0.2') > 0);
  assert.equal(cmpVersion('1.0', '1.0.0'), 0);
});

test('pop-up : première fois de la 1.0.3 à la 1.0.5, puis seulement les versions non vues', () => {
  assert.deepEqual(unseen(null).map((e) => e.version).slice(-3), ['1.0.5', '1.0.4', '1.0.3']);
  assert.ok(unseen(null).every((e) => cmpVersion(e.version, '1.0.3') >= 0));
  assert.deepEqual(unseen(LATEST), []);
  assert.deepEqual(unseen('1.0.4').map((e) => e.version), CHANGELOG.filter((e) => !e.quiet && cmpVersion(e.version, '1.0.4') > 0).map((e) => e.version));
  assert.deepEqual(unseen('n’importe quoi').map((e) => e.version), unseen(null).map((e) => e.version));
});

test('journal public : aucune entrée sur l’administration', () => {
  for (const e of CHANGELOG) {
    assert.equal(e.admin, undefined, e.version);
    const closed = e.closed ? [e.closed.title, ...e.closed.short, ...e.closed.details, ...Object.values(e.closed.onlyDetails ?? {}).flat()] : [];
    for (const line of [e.title, ...e.short, ...e.details, ...Object.values(e.onlyDetails ?? {}).flat(), ...(e.launch?.steps ?? []).flatMap(([t, d]) => [t, d]), ...closed]) assert.doesNotMatch(line, /administration|admin\b/i, `${e.version} : ${line}`);
  }
});

test('pop-up : une version de correctifs (quiet) reste au journal, sans pop-up', () => {
  const quiet = CHANGELOG.filter((e) => e.quiet).map((e) => e.version);
  assert.ok(quiet.includes('1.1.1'));
  assert.deepEqual(unseen('1.1.0').map((e) => e.version).filter((v) => v === '1.1.1'), [], 'qui a vu la 1.1.0 ne revoit pas de pop-up pour la 1.1.1');
  assert.ok(unseen('1.0.6').map((e) => e.version).includes('1.1.0'));
  assert.ok(unseen(null).every((e) => !e.quiet));
});

test('journal : une fonction fermée ne se montre qu’en variante discrète, sans rien d’elle', () => {
  for (const e of CHANGELOG.filter((x) => x.closed)) {
    assert.ok(e.only, `${e.version} : closed sans only`);
    const c = e.closed;
    assert.equal(c.quiet, true, `${e.version} : la variante fermée n’a pas de pop-up`);
    assert.ok(c.title && c.short.length >= 1 && c.short.length <= 3 && c.details.length >= 1, e.version);
    const words = { salaires: /salaire|simulateur|alumni/i, stages: /carte des stages/i, tcg: /\bTCG\b|cartes?\b/i }[e.only];
    for (const line of [c.title, ...c.short, ...c.details]) if (words) assert.doesNotMatch(line, words, `${e.version} : « ${line} » parle de la fonction fermée`);
  }
  const v310 = CHANGELOG.find((e) => e.version === '3.1.0');
  assert.equal(v310.launch.requires, 'salaires');
  assert.equal(v310.launch.steps.length, 3);
});
