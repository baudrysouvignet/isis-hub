import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nextDuel, maxDuels } from '../web/js/tcg/duels.js';

// Joue une série avec une préférence fixée (ordre « vrai ») et compte les duels.
function play(ids, truth) {
  const rank = new Map(truth.map((id, i) => [id, i]));
  const answers = [];
  for (let guard = 0; guard < 50; guard++) {
    const r = nextDuel(ids, answers);
    if (r.order) return { order: r.order, duels: answers.length };
    const [a, b] = r.pair;
    answers.push([a, b, rank.get(a) < rank.get(b) ? a : b]);
  }
  throw new Error('série sans fin');
}

function* permutations(list) {
  if (list.length <= 1) return yield [...list];
  for (let i = 0; i < list.length; i++) {
    for (const rest of permutations([...list.slice(0, i), ...list.slice(i + 1)])) yield [list[i], ...rest];
  }
}

test('maxDuels : 0, 1, 3, 5, 7 duels pour 1 à 5 cartes', () => {
  assert.deepEqual([1, 2, 3, 4, 5].map(maxDuels), [0, 1, 3, 5, 7]);
});

test('toutes les préférences possibles : le bon classement, en 7 duels au plus', () => {
  for (const n of [2, 3, 4, 5]) {
    const ids = ['c1', 'c2', 'c3', 'c4', 'c5'].slice(0, n);
    let most = 0;
    for (const truth of permutations(ids)) {
      const { order, duels } = play(ids, truth);
      assert.deepEqual(order, truth);
      most = Math.max(most, duels);
    }
    assert.equal(most, maxDuels(n), `${n} cartes`);
  }
});

test('jamais deux fois le même duel, ni un duel déductible', () => {
  const ids = ['a', 'b', 'c', 'd', 'e'];
  for (const truth of permutations(ids)) {
    const rank = new Map(truth.map((id, i) => [id, i]));
    const answers = [];
    const seen = new Set();
    for (;;) {
      const r = nextDuel(ids, answers);
      if (r.order) break;
      const key = [...r.pair].sort().join('|');
      assert.ok(!seen.has(key), `duel répété ${key}`);
      seen.add(key);
      answers.push([...r.pair, rank.get(r.pair[0]) < rank.get(r.pair[1]) ? r.pair[0] : r.pair[1]]);
    }
  }
});

test('reprise : les réponses déjà données ne sont pas redemandées', () => {
  const ids = ['a', 'b', 'c', 'd', 'e'];
  const first = nextDuel(ids, []);
  assert.equal(first.done, 0);
  const after = nextDuel(ids, [[...first.pair, first.pair[0]]]);
  assert.equal(after.done, 1);
  assert.notDeepEqual([...after.pair].sort(), [...first.pair].sort());
});

test('une carte seule : classement immédiat', () => {
  assert.deepEqual(nextDuel(['a'], []).order, ['a']);
});
