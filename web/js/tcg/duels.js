// ISIS · TCG : « Tu préfères ? », le jury en duels.
//
// Une série porte sur les cartes d'un bulletin (5 au plus). Chaque duel demande « celle-ci ou
// celle-là ? » ; le tri par insertion fusionnée (Ford-Johnson) n'en pose jamais plus que le minimum
// nécessaire pour connaître l'ordre complet : 1, 3, 5 et 7 duels pour 2, 3, 4 et 5 cartes. Le
// résultat est le même classement que l'ancien glisser-déposer : le serveur reçoit les mêmes
// données. Un duel qu'on peut déduire des précédents n'est jamais posé.
//
// Ce fichier ne touche ni au réseau ni à l'interface : il est testé tel quel sous Node.

/** Duels au plus pour classer n cartes (Ford-Johnson, optimal jusqu'à 11). */
export function maxDuels(n) {
  let total = 0;
  for (let k = 1; k <= n; k++) total += Math.ceil(Math.log2((3 * k) / 4));
  return total;
}

const pairKey = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);

class Need {
  constructor(a, b) {
    this.pair = [a, b];
  }
}

// Ordre d'insertion des « petits » (suite de Jacobsthal) : b3 b2, b5 b4, b11 … b6, b21 … b12…
function insertionOrder(count) {
  const order = [];
  let start = 2;
  for (const end of [3, 5, 11, 21, 43, 85, 171]) {
    for (let b = Math.min(end, count + 1); b >= start; b--) order.push(b - 2);
    start = end + 1;
    if (start > count + 1) break;
  }
  return order;
}

/** Tri croissant par insertion fusionnée ; `less(x, y)` : x passe après y. */
function fordJohnson(items, less) {
  if (items.length <= 1) return [...items];
  const pairs = [];
  for (let i = 0; i + 1 < items.length; i += 2) {
    const [x, y] = [items[i], items[i + 1]];
    pairs.push(less(y, x) ? { hi: x, lo: y } : { hi: y, lo: x });
  }
  const odd = items.length % 2 ? items[items.length - 1] : null;
  const loOf = new Map(pairs.map((p) => [p.hi, p.lo]));
  const his = fordJohnson(
    pairs.map((p) => p.hi),
    less,
  );
  const chain = [loOf.get(his[0]), ...his];
  const pending = his.slice(1).map((hi) => ({ x: loOf.get(hi), bound: hi }));
  if (odd !== null) pending.push({ x: odd, bound: null });
  for (const i of insertionOrder(pending.length)) {
    const { x, bound } = pending[i];
    let lo = 0;
    let hi = bound === null ? chain.length : chain.indexOf(bound);
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (less(x, chain[mid])) hi = mid;
      else lo = mid + 1;
    }
    chain.splice(lo, 0, x);
  }
  return chain;
}

/**
 * Prochain duel, ou ordre final. `ids` : cartes de la série (ordre du bulletin) ; `answers` :
 * duels déjà joués [a, b, gagnante]. Rend { pair: [a, b], done, total } tant qu'il manque un choix,
 * puis { order } : de la carte préférée à la moins voulue.
 */
export function nextDuel(ids, answers = []) {
  const won = new Map(answers.filter(([a, b, w]) => w === a || w === b).map(([a, b, w]) => [pairKey(a, b), w]));
  let asked = 0;
  const less = (x, y) => {
    const w = won.get(pairKey(x, y));
    if (w === undefined) throw new Need(x, y);
    asked++;
    return w === y; // y préférée : x passe après
  };
  try {
    const order = fordJohnson(ids, less).reverse();
    return { order, done: asked, total: asked };
  } catch (e) {
    if (!(e instanceof Need)) throw e;
    return { pair: e.pair, done: asked, total: maxDuels(ids.length) };
  }
}

/** Duels utiles seulement (ceux qu'un nouveau calcul pose encore), dans l'ordre joué. */
export function keepUseful(ids, answers = []) {
  const set = new Set(ids);
  return answers.filter(([a, b, w]) => set.has(a) && set.has(b) && (w === a || w === b));
}
