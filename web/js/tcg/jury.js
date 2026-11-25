// ISIS · TCG : jury de la semaine, en « Tu préfères ? ». Deux cartes candidates à la fois (auteurs
// masqués, jamais les siennes) : on touche celle qu'on veut le plus voir dans le jeu. 5 à 7 duels
// par série suffisent à classer les 5 cartes du bulletin (duels.js) : le serveur reçoit le même
// classement complet qu'avant. Une série par jour de jury ; une série commencée reprend où on
// l'a laissée (choix gardés sur l'appareil). Une fois envoyée, elle est close : ni ses cartes ni
// l'ordre choisi ne se revoient (le serveur ne les renvoie plus), et elle ne se refait pas.

import { h, toast, motionOK } from '../core/dom.js';
import { api } from './api.js';
import { cardEl, ic, meter, tbtn, sheet, sheetOpen, dayLong, hourText, dateShort, plural } from './ui.js';
import { nextDuel, keepUseful } from './duels.js';

// Choix en cours, par série (« vague:bulletin ») : sur l'appareil seulement, effacés à l'envoi.
const STORE = 'hub.tcg.duels';
const memory = new Map();
function loadAnswers(key) {
  try {
    const all = JSON.parse(localStorage.getItem(STORE) || '{}');
    if (Array.isArray(all[key])) return all[key];
  } catch {
    // stockage indisponible (navigation privée) : on garde en mémoire
  }
  return memory.get(key) ?? [];
}
function saveAnswers(key, list) {
  if (list?.length) memory.set(key, list);
  else memory.delete(key);
  try {
    const all = JSON.parse(localStorage.getItem(STORE) || '{}');
    if (list?.length) all[key] = list;
    else delete all[key];
    const keys = Object.keys(all);
    for (const k of keys.slice(0, Math.max(0, keys.length - 8))) delete all[k];
    localStorage.setItem(STORE, JSON.stringify(all));
  } catch {
    // idem
  }
}

export function renderJury(ctx) {
  const st = ctx.st;
  const jury = st.jury;
  const root = h('section.tju');
  if (!jury && practiceCards && st.me?.admin) {
    root.append(
      h('header.tv-head.tju-head', {}, h('div', {}, h('p.tk', { text: 'Essai · administration' }), h('h1.tv-h1', { tabIndex: -1, text: 'Tu préfères ?' }))),
      duels(ctx, { wave: 'essai' }, { cards: practiceCards }, 0, 'Essai', { practice: true }),
    );
    return root;
  }
  if (!jury) {
    const now = new Date();
    const openWave = st.waves.find((w) => !w.printed && w.juryFrom && new Date(w.juryFrom) <= now && now < new Date(w.juryUntil));
    const next = st.waves.find((w) => !w.printed && w.juryFrom && new Date(w.juryFrom) > now);
    root.append(
      h('header.tv-head', {}, h('div', {}, h('p.tk', { text: 'Jury de la semaine' }), h('h1.tv-h1', { tabIndex: -1, text: openWave ? `Jury de la vague ${openWave.n}` : 'Pas de jury en ce moment' }))),
      h(
        'div.tju-done',
        {},
        h('span.tju-check', {}, ic('jury', 'ic')),
        h('p', { text: openWave ? `Le jury est ouvert jusqu’au ${dayLong(openWave.juryUntil)} à ${hourText(openWave.juryUntil)}, mais aucune carte validée n’attend encore d’autres que les tiennes. Propose les tiennes, ou reviens un peu plus tard.` : next ? `Le prochain jury ouvre le ${dayLong(next.juryFrom)} à ${hourText(next.juryFrom)} : chaque jour, une série de « Tu préfères ? » avec les cartes proposées par la promo.` : 'Le prochain jury sera annoncé ici. En attendant, propose tes cartes : elles y passeront.' }),
        tbtn('Créer une carte', 'pen', 'tbtn--primary', () => ctx.go('create')),
        st.me?.admin ? h('div.tju-try', {}, tbtnTry(ctx), h('p.thelp', { text: 'Administration : essaie les duels avec 5 cartes proposées, même avant le jury. Rien n’est enregistré, les joueurs ne le voient pas.' })) : null,
      ),
    );
    return root;
  }
  const bi = jury.ballots.length - 1;
  const ballot = jury.ballots[bi];
  const until = `${dayLong(jury.until).split(' ')[0].slice(0, 3)}. ${dateShort(jury.until)}, ${hourText(jury.until)}`;
  const series = `Série ${bi + 1}${jury.max ? ` sur ${jury.max}` : ''}`;
  root.append(
    h(
      'header.tv-head.tju-head',
      {},
      h('div', {}, h('p.tk', { text: `Jury · jusqu’au ${until}` }), h('h1.tv-h1', { tabIndex: -1, text: ballot.done ? (jury.more ? 'Série terminée' : 'Reviens demain') : 'Tu préfères ?' })),
      meter(jury.jurors, jury.players, `${jury.jurors} / ${jury.players} jurés`, 'tju-meter'),
    ),
  );
  if (ballot.done) {
    root.append(done(ctx, jury, bi));
    return root;
  }
  root.append(duels(ctx, jury, ballot, bi, series));
  return root;
}

/**
 * Les duels d'une série, jusqu'au classement complet, envoyé tout seul à la fin. `practice` :
 * essai de l'administration (aucun jury ouvert), rien n'est gardé ni envoyé.
 */
function duels(ctx, jury, ballot, bi, series, { practice = false } = {}) {
  const byId = new Map(ballot.cards.map((c) => [c.id, c]));
  const ids = ballot.cards.map((c) => c.id);
  const key = `${jury.wave}:${bi}`;
  let answers = practice ? [] : keepUseful(ids, loadAnswers(key));
  let busy = false;

  const dots = h('span.tdu-dots', { attrs: { 'aria-hidden': 'true' } });
  const count = h('span.tdu-count');
  const undo = h('button.tdu-undo', { type: 'button', disabled: true }, ic('back', 'ic ic--xs'), h('span', { text: 'Choix précédent' }));
  const arena = h('div.tdu-arena', { attrs: { 'aria-live': 'polite' } });
  // Téléphone (80 % des visites) : la carte est le bouton, un appui long l'agrandit.
  const touch = Boolean(globalThis.matchMedia?.('(hover: none), (pointer: coarse)').matches);
  const wrap = h(
    'div.tdu',
    {},
    h('div.tdu-bar', {}, h('span.tdu-series', { text: series }), dots, count),
    h('p.tdu-q', { text: 'Laquelle veux-tu le plus voir dans le jeu ?' }),
    arena,
    h('p.tdu-hint', {}, touch ? h('b', { text: 'Touche celle que tu veux le plus voir dans le jeu' }) : h('b', { text: 'Clique sur ta préférée, ou ← / →' }), touch ? h('span', { text: 'Appui long pour l’agrandir' }) : null),
    h('div.tdu-foot', {}, undo, h('p.tdu-anon', {}, ic('eye', 'ic ic--xs'), 'Auteurs masqués · tes cartes ne te sont jamais proposées')),
  );

  // Les vraies cartes du jeu, rareté masquée : on choisit la carte telle qu'elle sera imprimée.
  const option = (c, side, pick) => {
    const btn = h(
      `button.tdu-opt.tdu-opt--${side}`,
      { type: 'button', attrs: { 'aria-label': `Je préfère « ${c.title} »` } },
      // Au doigt, pas d'inclinaison qui suit le pointeur : elle resterait figée après le toucher.
      cardEl(c, { size: 'sm', mystery: true, live: !touch, by: '' }),
      h('span.tdu-heart', { attrs: { 'aria-hidden': 'true' } }, ic('heart', 'ic')),
      h('span.tdu-pick', { attrs: { 'aria-hidden': 'true' } }, ic('heart', 'ic ic--xs'), 'Celle-ci'),
    );
    // Appui long (450 ms sans bouger) : la carte en grand, sans la choisir.
    let timer = 0;
    let held = false;
    let start = null;
    const cancelHold = () => clearTimeout(timer);
    btn.addEventListener('pointerdown', (e) => {
      held = false;
      start = { x: e.clientX, y: e.clientY };
      cancelHold();
      timer = setTimeout(() => {
        held = true;
        buzz(8);
        bigCard(c);
      }, 450);
    });
    btn.addEventListener('pointermove', (e) => start && Math.hypot(e.clientX - start.x, e.clientY - start.y) > 10 && cancelHold());
    for (const ev of ['pointerup', 'pointercancel', 'pointerleave']) btn.addEventListener(ev, cancelHold);
    btn.addEventListener('contextmenu', (e) => e.preventDefault()); // menu « Enregistrer l'image » au doigt
    btn.addEventListener('click', () => {
      if (held) return void (held = false);
      pick(btn);
    });
    const see = h('button.tdu-see', { type: 'button', attrs: { 'aria-label': `Voir la carte « ${c.title} » en grand` } }, ic('eye', 'ic ic--xs'));
    see.addEventListener('click', () => bigCard(c));
    return h(`div.tdu-cell.tdu-cell--${side}`, {}, btn, see);
  };

  function paint(r, dir = 1) {
    const [a, b] = r.pair;
    dots.replaceChildren(...Array.from({ length: r.total }, (_, i) => h(`i${i < r.done ? '.is-on' : i === r.done ? '.is-cur' : ''}`)));
    count.replaceChildren(`Duel ${r.done + 1}`, h('span.tdu-max', { text: ` · ${r.total} au plus` }));
    undo.disabled = !answers.length;
    const choose = (winner) => (el) => {
      if (busy) return;
      busy = true;
      answers = [...answers, [a, b, winner]];
      if (!practice) saveAnswers(key, answers);
      buzz(12);
      arena.classList.add('is-chosen');
      for (const cell of arena.querySelectorAll('.tdu-cell')) cell.classList.add(cell.contains(el) ? 'is-win' : 'is-lose');
      setTimeout(() => {
        busy = false;
        step(1);
      }, motionOK() ? 520 : 0);
    };
    arena.classList.remove('is-chosen');
    arena.replaceChildren(option(byId.get(a), 'a', choose(a)), h('span.tdu-or', { attrs: { 'aria-hidden': 'true' } }, 'ou'), option(byId.get(b), 'b', choose(b)));
    // Les deux cartes sont distribuées, comme tirées du paquet.
    if (motionOK()) {
      for (const [i, cell] of [...arena.querySelectorAll('.tdu-cell')].entries()) {
        const from = dir > 0 ? `translateY(70px) rotate(${i ? 9 : -9}deg) scale(.86)` : 'translateY(-50px) scale(.92)';
        cell.animate([{ opacity: 0, transform: from }, { opacity: 1, transform: 'none' }], { duration: 420, delay: i * 90, easing: 'cubic-bezier(.2,.9,.25,1.15)', fill: 'backwards' });
      }
      arena.querySelector('.tdu-or')?.animate([{ opacity: 0, transform: 'scale(.4)' }, { opacity: 1, transform: 'none' }], { duration: 300, delay: 220, easing: 'cubic-bezier(.2,.9,.25,1.3)', fill: 'backwards' });
    }
  }

  async function finish(order) {
    dots.replaceChildren(...[...dots.children].map(() => h('i.is-on')));
    if (practice) {
      // Essai : le classement obtenu, sans rien enregistrer.
      count.textContent = 'Essai terminé';
      undo.disabled = true;
      const again = tbtn('Recommencer avec 5 cartes', 'loop', 'tbtn--primary', () => startPractice(ctx));
      const stop = tbtn('Quitter l’essai', 'x', 'tbtn--ghost', () => {
        practiceCards = null;
        ctx.render();
      });
      arena.replaceChildren(h('div.tdu-sending', {}, h('p', { text: `${plural(order.length, 'carte')} classées en ${plural(answers.length, 'duel')} : rien n’a été enregistré.` }), podium(order.map((id) => byId.get(id))), h('div.rc-acts', {}, again, stop)));
      return;
    }
    count.textContent = 'Classement…';
    undo.disabled = true;
    arena.replaceChildren(h('div.tdu-sending', {}, h('span.spinner'), h('span', { text: 'Ton classement est enregistré…' })));
    try {
      await api.vote(jury.wave, ballot.n ?? bi, order);
      saveAnswers(key, null);
      toast('Série terminée : merci, juré·e !', 'check');
      await ctx.reload();
    } catch (e) {
      const retry = tbtn('Réessayer', 'loop', 'tbtn--primary', () => finish(order));
      arena.replaceChildren(h('div.tdu-sending', {}, h('p', { text: `Envoi impossible : ${e.message}` }), retry));
    }
  }

  function step(dir) {
    const r = nextDuel(ids, answers);
    if (r.order) return finish(r.order);
    paint(r, dir);
  }

  undo.addEventListener('click', () => {
    if (busy || !answers.length) return;
    answers = answers.slice(0, -1);
    if (!practice) saveAnswers(key, answers);
    step(-1);
  });

  // Clavier : ← / 1 pour la première carte, → / 2 pour la seconde, Retour arrière pour annuler.
  const onKey = (e) => {
    if (!wrap.isConnected) return document.removeEventListener('keydown', onKey);
    if (sheetOpen() || e.altKey || e.ctrlKey || e.metaKey || /^(INPUT|TEXTAREA|SELECT)$/.test(e.target?.tagName ?? '')) return;
    const cells = arena.querySelectorAll('.tdu-opt');
    if (cells.length !== 2) return;
    if (e.key === 'ArrowLeft' || e.key === '1') cells[0].click();
    else if (e.key === 'ArrowRight' || e.key === '2') cells[1].click();
    else if (e.key === 'Backspace') undo.click();
    else return;
    e.preventDefault();
  };
  document.addEventListener('keydown', onKey);

  step(1);
  if (practice) wrap.querySelector('.tdu-anon').textContent = 'Essai réservé à l’administration : rien n’est enregistré.';
  return wrap;
}

function tbtnTry(ctx) {
  const b = tbtn('Essayer « Tu préfères ? »', 'jury', 'tbtn--ghost', () => startPractice(ctx, b));
  return b;
}

/** Classement d'un essai (administration) : vignettes numérotées, de la préférée à la moins voulue. */
function podium(cards) {
  return h(
    'ol.tju-podium',
    { attrs: { 'aria-label': 'Ton classement' } },
    ...cards.map((c, i) => h(`li.tju-pod.tju-pod--${Math.min(i, 4)}`, {}, h('span.tju-rank', { text: String(i + 1) }), h('img', { alt: '', src: c.thumb || c.img }), h('b', { text: c.title }))),
  );
}

// Essai de l'administration (aucun jury ouvert) : 5 cartes proposées, rien n'est enregistré.
let practiceCards = null;
async function startPractice(ctx, button) {
  if (button) button.disabled = true;
  try {
    practiceCards = (await api.tryJury()).cards;
    ctx.render();
  } catch (e) {
    toast(e.message, 'alert');
    if (button) button.disabled = false;
  }
}

/** Petite vibration (Android) au choix d'une carte ; rien ailleurs. */
function buzz(ms) {
  try {
    navigator.vibrate?.(ms);
  } catch {
    // pas de vibreur : rien
  }
}

function bigCard(c) {
  const s = sheet('detail', c.title, h('div.tdet.tdu-big', {}, h('div.tdet-stage', {}, h('span.tdet-glow'), cardEl(c, { size: 'xl', mystery: true, live: true, by: '' }))));
  return s;
}

/**
 * Série envoyée : close. Ni ses cartes ni l'ordre choisi (le serveur ne les renvoie plus), pas de
 * « refaire » ; la série suivante si elle est déjà ouverte (jour manqué), sinon « reviens demain ».
 */
function done(ctx, jury, bi) {
  const acts = h('div.rc-acts');
  if (jury.more) {
    acts.append(
      tbtn('Série suivante', 'jury', 'tbtn--primary', async (e) => {
        const b = e.currentTarget;
        b.disabled = true;
        try {
          await api.moreBallot();
          await ctx.reload();
        } catch (err) {
          toast(err.message, 'alert');
          b.disabled = false;
        }
      }),
    );
  }
  const last = !jury.more && !jury.next && jury.max && bi + 1 >= jury.max;
  const at = jury.next ? new Date(jury.next) : null;
  const when = at && `${at.toDateString() === new Date(Date.now() + 864e5).toDateString() ? 'demain' : `le ${dayLong(at)}`}, dès ${at.getHours() || at.getMinutes() ? hourText(at) : 'minuit'}`;
  const next = jury.more
    ? 'Une autre série t’attend : un jour de jury manqué se rattrape.'
    : at
      ? `Prochaine série ${when} : 5 autres cartes, 7 duels au plus.`
      : last
        ? 'Tu as joué toutes les séries de ce jury. Merci !'
        : 'Le jury se termine : merci pour tes votes !';
  return h(
    'div.tju-done.tju-sealed',
    {},
    h('span.tju-check', {}, ic('lock', 'ic')),
    h('p.tk', { text: `Série ${bi + 1}${jury.max ? ` sur ${jury.max}` : ''} · envoyée` }),
    h('p.tju-lead', { text: 'Ton classement est enregistré, et il reste secret, même pour toi : les cartes de cette série et ton ordre ne se revoient plus.' }),
    h('p', { text: `Résultat à la sortie de la vague ${jury.wave} : les cartes que la promo préfère deviennent les plus rares.` }),
    h('p.tju-next', {}, ic('clock', 'ic ic--xs'), next),
    acts.childElementCount ? acts : null,
  );
}
