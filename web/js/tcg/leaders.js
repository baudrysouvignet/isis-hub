// ISIS · TCG : classement des créateurs. Le podium (3 premiers) et, en dessous, ma place.
//
// Le serveur calcule tout (leaderboard.go) et n'envoie que des places : ni score, ni rareté. La
// page dit ce qui fait gagner ou perdre des points, et à quel point (une jauge), sans chiffre : un
// score affiché laisserait deviner la rareté de ses propres cartes.

import { h } from '../core/dom.js';
import { ic, pips, plural } from './ui.js';

const place = (n) => (n === 1 ? '1er' : `${n}e`);
const MEDAL = ['or', 'argent', 'bronze'];

/** Section « Meilleurs créateurs » : lb = { podium: [{ pseudo, initials, cards, me }], rank, total }. */
export function leaderboard(lb, { onCreate } = {}) {
  const podium = lb?.podium ?? [];
  const sec = h('section.tlb', { attrs: { 'aria-labelledby': 'tlb-h' } });
  sec.append(
    h('header.tlb-head', {}, h('h2.th-h2', { id: 'tlb-h', text: 'Meilleurs créateurs' }), h('p.tlb-sub', { text: 'Le nombre de cartes compte, leur qualité bien plus. Les scores restent secrets, comme la rareté de tes cartes : seules les places s’affichent.' })),
  );

  if (!podium.length) {
    sec.append(h('p.tlb-empty', {}, ic('spark', 'ic ic--sm'), 'Le podium attend ses premiers créateurs : dès qu’une carte est validée, son auteur entre au classement.'));
  } else {
    // Ordre à l'écran : 2e, 1er, 3e (le premier au centre, sur la plus haute marche).
    const order = [1, 0, 2].filter((i) => podium[i]);
    const ol = h('ol.tlb-podium', { attrs: { 'aria-label': 'Podium' } });
    for (const i of order) {
      const p = podium[i];
      ol.append(
        h(
          `li.tlb-step.tlb-step--${MEDAL[i]}${p.me ? '.is-me' : ''}`,
          { attrs: { 'aria-label': `${place(i + 1)} : ${p.pseudo}${p.me ? ' (toi)' : ''}` } },
          h(
            'div.tlb-who',
            {},
            i === 0 ? pips('unique', 'tlb-crown') : null,
            h('span.tlb-av', { text: p.initials || '?' }),
            h('b.tlb-name', { text: p.pseudo }),
            p.me ? h('span.tlb-me', { text: 'Toi' }) : p.cards ? h('span.tlb-cards', { text: plural(p.cards, 'carte en jeu', 'cartes en jeu') }) : null,
          ),
          h('div.tlb-block', { attrs: { 'aria-hidden': 'true' } }, h('span', { text: String(i + 1) })),
        ),
      );
    }
    sec.append(ol);
  }

  // Ma place, sous le podium.
  const rank = lb?.rank ?? 0;
  let mine;
  if (rank && rank <= 3) mine = h('p.tlb-mine.is-top', {}, ic('check', 'ic ic--sm'), h('span', {}, 'Tu es ', h('b', { text: `${place(rank)}` }), ' : bravo, tu es sur le podium !'));
  else if (rank) mine = h('p.tlb-mine', {}, h('b.tlb-rank', { text: place(rank) }), h('span', { text: `Ta place, sur ${plural(lb.total, 'créateur classé', 'créateurs classés')}` }));
  else {
    mine = h('p.tlb-mine.is-out', {}, ic('pen', 'ic ic--sm'), h('span', { text: 'Tu n’es pas encore classé·e : une carte validée suffit pour entrer au classement.' }));
    if (onCreate) {
      const b = h('button.tlb-go', { type: 'button', text: 'Créer une carte' });
      b.addEventListener('click', onCreate);
      mine.append(b);
    }
  }
  sec.append(mine, rules());
  return sec;
}

// Ce qui compte, et à quel point : jauge de 1 à 5, sans chiffre (même échelle que leaderboard.go).
const RULES = [
  ['plus', 'Carte en jeu', 'Selon ce que la promo en a pensé au jury : plus elle est rare, plus elle rapporte. Une seule carte très attendue vaut bien plus que beaucoup de cartes communes.', 2, 5],
  ['plus', 'Carte validée', 'Acceptée par la modération, en attente du jury ou de l’impression.', 1],
  ['minus', 'Carte bloquée', 'Refusée par la modération (insulte, dénigrement, photo floue, doublon…).', 1],
  ['minus', 'Carte retirée du jeu', 'Après des signalements de joueurs.', 2],
  ['zero', 'Ne comptent pas', 'Les propositions en attente, et les cartes qu’une personne sur la photo a refusées.', 0],
];
const SIGN = { plus: '+', minus: '−', zero: '=' };

function rules() {
  const list = h('ul.tlb-rules', { attrs: { 'aria-label': 'Ce qui fait gagner ou perdre des points' } });
  for (const [kind, title, text, w, upTo] of RULES) {
    const label = w ? `${kind === 'plus' ? 'Gagne' : 'Perd'} ${upTo ? `de ${w} à ${upTo}` : w} sur 5` : 'Rien';
    const gauge = h(`span.tlb-w.tlb-w--${kind}`, { attrs: { role: 'img', 'aria-label': label } });
    for (let i = 1; i <= 5; i++) gauge.append(h(`i${i <= w ? '.is-on' : upTo && i <= upTo ? '.is-up' : ''}`));
    list.append(h(`li.tlb-rule.tlb-rule--${kind}`, {}, h('span.tlb-sign', { text: SIGN[kind], attrs: { 'aria-hidden': 'true' } }), h('span.tlb-rule-t', {}, h('b', { text: title }), h('small', { text })), w ? gauge : null));
  }
  return h('details.tlb-how', {}, h('summary', {}, ic('info', 'ic ic--sm'), 'Ce qui fait gagner ou perdre des points'), list);
}
