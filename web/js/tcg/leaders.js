// ISIS · TCG : classement des créateurs. Le podium (places 1 à 3) et, en dessous, ma place.
// Pendant le jury de lancement, deux podiums : celui de la journée (les points gagnés depuis
// minuit : c'est lui qui donne les boosters bonus à minuit, chaque journée repart de zéro) et le
// classement global, depuis le début.
//
// Le serveur calcule tout (leaderboard.go) et n'envoie que des places : ni score, ni rareté. La
// page dit ce qui fait gagner ou perdre des points, et à quel point (une jauge), sans chiffre : un
// score affiché laisserait deviner la rareté de ses propres cartes. Avant l'impression, une carte
// compte déjà selon sa place au jury ; une seule pénalité, pour une carte tout en bas du jury.
// Ex æquo : même place, même marche (deux 1ers sur la première marche, le suivant sur la troisième).

import { h } from '../core/dom.js';
import { ic, pips, plural } from './ui.js';

const place = (n) => (n === 1 ? '1er' : `${n}e`);
const MEDAL = { 1: 'or', 2: 'argent', 3: 'bronze' };
const SHOWN = 3; // personnes affichées par marche, au plus (« +N » au-delà)

/**
 * Section « Meilleurs créateurs » : lb = { podium: [{ pseudo, initials, place, cards, me }], rank,
 * tied, total, today?: { podium, rank, tied, total } }.
 */
export function leaderboard(lb, { onCreate } = {}) {
  const sec = h('section.tlb', { attrs: { 'aria-labelledby': 'tlb-h' } });
  const today = lb?.today;
  const body = h('div.tlb-body');
  const sub = h('p.tlb-sub');
  sec.append(h('header.tlb-head', {}, h('h2.th-h2', { id: 'tlb-h', text: 'Meilleurs créateurs' }), sub));

  const showGlobal = () => {
    sub.textContent = 'Depuis le début. Le nombre de cartes compte, leur qualité bien plus. Les scores restent secrets, comme la rareté de tes cartes : seules les places s’affichent.';
    body.replaceChildren(podiumEl(lb?.podium, 'Le podium attend ses premiers créateurs : dès qu’une carte est validée, son auteur entre au classement.'), mineEl(lb, onCreate));
  };
  const showToday = () => {
    sub.textContent = 'Les points gagnés depuis minuit : tes cartes validées aujourd’hui, et celles qui montent au jury. À minuit, ce podium donne les boosters bonus ; chaque journée repart de zéro.';
    body.replaceChildren(podiumEl(today.podium, 'Personne n’a encore gagné de points aujourd’hui : la première carte validée, ou qui plaît au jury, prend la tête.'), mineTodayEl(today), h('p.tlb-gifts', {}, ic('gift', 'ic ic--sm'), h('span', { text: 'Ce soir à minuit : 1er → 5 cartes, 2e → 4, 3e → 3, du 4e au 13e → 1. Ex æquo : même booster.' })));
  };

  if (today) {
    // Deux podiums : aujourd'hui (les cadeaux du soir) et depuis le début.
    const tabs = h('div.tlb-tabs', { attrs: { role: 'tablist', 'aria-label': 'Podium' } });
    const views = [
      ['today', 'Aujourd’hui', showToday],
      ['all', 'Depuis le début', showGlobal],
    ];
    const btns = views.map(([k, label, show]) => {
      const b = h('button.tlb-tab', { type: 'button', text: label, attrs: { role: 'tab', 'aria-selected': 'false' } });
      b.addEventListener('click', () => select(k));
      return [k, b, show];
    });
    const select = (k) => {
      for (const [kk, b, show] of btns) {
        const on = kk === k;
        b.classList.toggle('is-on', on);
        b.setAttribute('aria-selected', String(on));
        b.tabIndex = on ? 0 : -1;
        if (on) show();
      }
    };
    tabs.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
      e.preventDefault();
      const i = btns.findIndex(([, b]) => b.classList.contains('is-on'));
      const [k, b] = btns[(i + 1) % btns.length];
      select(k);
      b.focus();
    });
    tabs.append(...btns.map(([, b]) => b));
    sec.append(tabs);
    select('today');
  } else showGlobal();
  sec.append(body, rules());
  return sec;
}

/** Le podium : une marche par place occupée, les ex æquo ensemble ; à l'écran 2e, 1er, 3e. */
function podiumEl(list, empty) {
  // Sans « place » (ancien serveur) : la place est l'ordre d'arrivée.
  const podium = (list ?? []).map((p, i) => ({ ...p, place: p.place || i + 1 }));
  if (!podium.length) return h('p.tlb-empty', {}, ic('spark', 'ic ic--sm'), empty);
  const steps = [2, 1, 3].map((pl) => [pl, podium.filter((p) => p.place === pl)]).filter(([, who]) => who.length);
  const ol = h('ol.tlb-podium', { attrs: { 'aria-label': 'Podium' }, style: { '--n': String(steps.length) } });
  for (const [pl, who] of steps) {
    const shared = who.length > 1;
    const me = who.some((p) => p.me);
    const names = who.map((p) => `${p.pseudo}${p.me ? ' (toi)' : ''}`).join(', ');
    const people = h(`div.tlb-whos${shared ? '.is-shared' : ''}`);
    for (const p of who.slice(0, SHOWN)) {
      people.append(
        h(
          `div.tlb-who${p.me ? '.is-me' : ''}`,
          {},
          h('span.tlb-av', { text: p.initials || '?' }),
          h('b.tlb-name', { text: p.pseudo }),
          p.me ? h('span.tlb-me', { text: 'Toi' }) : p.cards && !shared ? h('span.tlb-cards', { text: plural(p.cards, 'carte en jeu', 'cartes en jeu') }) : null,
        ),
      );
    }
    if (who.length > SHOWN) people.append(h('span.tlb-more', { text: `+${who.length - SHOWN}` }));
    ol.append(
      h(
        `li.tlb-step.tlb-step--${MEDAL[pl]}${me ? '.is-me' : ''}`,
        { attrs: { 'aria-label': `${place(pl)}${shared ? ' ex æquo' : ''} : ${names}` } },
        pl === 1 ? pips('unique', 'tlb-crown') : null,
        people,
        shared ? h('span.tlb-tie', { text: 'ex æquo' }) : null,
        h('div.tlb-block', { attrs: { 'aria-hidden': 'true' } }, h('span', { text: String(pl) })),
      ),
    );
  }
  return ol;
}

/** Ma place au classement global. */
function mineEl(lb, onCreate) {
  const rank = lb?.rank ?? 0;
  const tie = lb?.tied ? ' ex æquo' : '';
  if (rank && rank <= 3) return h('p.tlb-mine.is-top', {}, ic('check', 'ic ic--sm'), h('span', {}, 'Tu es ', h('b', { text: `${place(rank)}${tie}` }), ' : bravo, tu es sur le podium !'));
  if (rank) return h('p.tlb-mine', {}, h('b.tlb-rank', { text: place(rank) }), h('span', { text: `Ta place${tie}, sur ${plural(lb.total, 'créateur classé', 'créateurs classés')}` }));
  const mine = h('p.tlb-mine.is-out', {}, ic('pen', 'ic ic--sm'), h('span', { text: 'Tu n’es pas encore classé·e : une carte validée suffit pour entrer au classement.' }));
  if (onCreate) {
    const b = h('button.tlb-go', { type: 'button', text: 'Créer une carte' });
    b.addEventListener('click', onCreate);
    mine.append(b);
  }
  return mine;
}

/** Ma place au podium du jour. */
function mineTodayEl(today) {
  const rank = today?.rank ?? 0;
  const tie = today?.tied ? ' ex æquo' : '';
  if (rank && rank <= 3) return h('p.tlb-mine.is-top', {}, ic('check', 'ic ic--sm'), h('span', {}, 'Aujourd’hui, tu es ', h('b', { text: `${place(rank)}${tie}` }), ' : si ça tient jusqu’à minuit, le booster est pour toi !'));
  if (rank) return h('p.tlb-mine', {}, h('b.tlb-rank', { text: place(rank) }), h('span', { text: `Ta place aujourd’hui${tie}, sur ${plural(today.total, 'créateur', 'créateurs')} qui ont gagné des points` }));
  return h('p.tlb-mine.is-out', {}, ic('clock', 'ic ic--sm'), h('span', { text: 'Pas encore de points aujourd’hui : une carte validée, ou une carte qui plaît au jury, t’en rapporte.' }));
}

// Ce qui compte, et à quel point : jauge de 1 à 5, sans chiffre (même échelle que leaderboard.go).
const RULES = [
  ['plus', 'Carte en jeu', 'Selon sa rareté, que le jury a décidée : plus elle est rare, plus elle rapporte. Une seule carte très attendue vaut bien plus que beaucoup de cartes communes.', 1, 5],
  ['plus', 'Carte validée, avant l’impression', 'Elle compte déjà selon sa place au jury, comme si la vague s’imprimait maintenant, dès ses 2 premiers classements. D’ici là, ou si elle n’entre pas dans la vague, elle rapporte un peu.', 1, 5],
  ['minus', 'Carte tout en bas du jury', 'Commune ou pas retenue, et placée par le jury de sa vague dans son dernier quart : elle coûte un peu plus qu’elle ne rapporte. Pas retenue, elle a une nouvelle chance au jury suivant.', 2],
  ['zero', 'Ne comptent pas', 'Les propositions en attente, les cartes bloquées (même retirées ensuite) ou retirées du jeu, et celles qu’une personne sur la photo a refusées. Aucune ne fait perdre de points.', 0],
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
  return h(
    'details.tlb-how',
    {},
    h('summary', {}, ic('info', 'ic ic--sm'), 'Ce qui fait gagner ou perdre des points'),
    list,
    h('p.tlb-ties', { text: 'À égalité de points, même place : deux premiers ex æquo partagent la première marche. Pendant le jury de lancement, le podium du jour donne les boosters bonus à minuit ; chaque journée repart de zéro, l’avance de la veille ne compte pas.' }),
  );
}
