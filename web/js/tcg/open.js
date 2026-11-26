// ISIS · TCG : ouverture d'un booster (du jour ou bonus), en plein écran.
//   1. glisser le doigt sur le haut du booster (ou « Ouvrir », ou Entrée) : il se déchire ;
//   2. les cartes, face cachée : le dos luit avant une carte Épique ou mieux ; toucher la
//      retourne, toucher encore la range dans le plateau du bas ;
//   3. Légendaire et Unique : rayons, éclat, bannière. Un écho (copie de substitution) : une onde
//      et une bannière sobre, sans rayons ni confettis ;
//   4. récapitulatif du tirage.
// Les cartes sont déjà dans la collection (le serveur a tiré le booster avant l'animation).

import { h, motionOK, sleep, lockScroll } from '../core/dom.js';
import { cardEl, ic, mark, tier, RLABEL, ECHO, sheet, tbtn, placeholderArt, plural } from './ui.js';

const EASE = 'cubic-bezier(.2,.8,.2,1)';

/** Booster : { size, bonus, season, big, mini } (bonus : feuille dorée et sceau « Bonus »). */
export function packEl({ size = 4, bonus = false, season = 'Saison 1', big = true, mini = false } = {}) {
  const window_ = h('div.pack-window', {}, h('img', { alt: '', draggable: false, src: placeholderArt(bonus ? 'booster-bonus-isis' : 'booster-isis') }));
  return h(
    `div.pack.is-ready${big ? '.is-big' : ''}${bonus ? '.pack--bonus' : ''}${mini ? '.pack--mini' : ''}`,
    {},
    h(
      'div.pack-tilt',
      {},
      h(
        'div.pack-body',
        {},
        h('span.pack-foil'),
        h('div.pack-cap', {}, h('span.pack-teeth')),
        h('div.pack-top', {}, mark('pack-mark'), h('span.pack-brand', {}, 'ISIS', h('b', { text: 'TCG' }))),
        window_,
        h('div.pack-meta', {}, h('span.pack-season', { text: bonus ? 'Bonus' : season }), h('span.pack-n', { text: plural(size, 'carte') })),
        h('span.pack-tear', {}, h('i')),
        h('span.pack-sheen'),
      ),
      bonus ? h('span.pack-seal', { attrs: { 'aria-hidden': 'true' }, text: mini ? `+${size}` : 'Bonus' }) : null,
    ),
    h('span.pack-shadow'),
  );
}

/** Étincelles et confettis (couleurs de la rareté). */
function burst(fx, rarity, strong) {
  if (!motionOK()) return;
  const colors = {
    epique: ['#C9B6FF', '#A98BFF', '#8FEAF3'],
    legendaire: ['#FF8A65', '#FFB86B', '#FF4D9D', '#FFE8A3'],
    unique: ['#F5C451', '#FFE8A3', '#FFF6CF', '#FFFFFF'],
  }[rarity] ?? ['#8FEAF3'];
  const n = strong ? 70 : 26;
  const cx = window.innerWidth / 2;
  const cy = window.innerHeight * 0.45;
  for (let i = 0; i < n; i++) {
    const kind = strong && i % 3 === 0 ? 'tfx--conf' : i % 4 === 0 ? 'tfx--star' : '';
    const p = h(`span.tfx${kind ? '.' + kind : ''}`);
    p.style.setProperty('--c', colors[i % colors.length]);
    p.style.setProperty('--s', `${4 + Math.random() * (strong ? 9 : 6)}px`);
    p.style.setProperty('left', `${cx}px`);
    p.style.setProperty('top', `${cy}px`);
    fx.append(p);
    const a = Math.random() * Math.PI * 2;
    const d = (strong ? 220 : 130) + Math.random() * (strong ? 320 : 160);
    const dx = Math.cos(a) * d;
    const dy = Math.sin(a) * d + (strong ? 140 : 60);
    p.animate(
      [
        { transform: 'translate(-50%, -50%) scale(1) rotate(0deg)', opacity: 1 },
        { transform: `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px)) scale(${0.3 + Math.random() * 0.6}) rotate(${Math.random() * 720 - 360}deg)`, opacity: 0 },
      ],
      { duration: 900 + Math.random() * 900, easing: 'cubic-bezier(.15,.7,.3,1)', fill: 'forwards' },
    ).onfinish = () => p.remove();
  }
}

/**
 * Ouvre l'écran d'ouverture.
 * o : { pulls, cardOf(id), ownedCount, totalCount, onClose(goCollection), onCard(card, serial, echo), bonus, season, kicker }
 */
export function openBooster(o) {
  const root = document.querySelector('.app');
  const reveal = o.pulls.map((p) => ({ ...p, card: o.cardOf(p.card) })).filter((p) => p.card);
  const rays = h('div.op-rays');
  const dim = h('div.op-dim');
  const flash = h('div.op-flash');
  const fx = h('div.op-fx');
  const banner = h('div.op-banner');
  const count = h('p.op-count');
  const skip = h('button.op-skip', { type: 'button', hidden: true }, ic('spark'), h('span', { text: 'Tout révéler' }));
  const quit = h('button.op-quit', { type: 'button', attrs: { 'aria-label': 'Fermer' } }, ic('x'));
  const hint = h('p.op-hint', { attrs: { 'aria-live': 'polite' }, text: 'Glisse sur le haut du booster, ou appuie sur Entrée' });
  const slots = reveal.map(() => h('span.op-slot'));
  const tray = h('div.op-tray', {}, ...slots);
  const pack = packEl({ size: reveal.length, bonus: Boolean(o.bonus), season: o.season });
  const openBtn = tbtn('Ouvrir', 'booster', 'tbtn--primary op-openbtn');
  const stage = h('div.op-stage', {}, pack, openBtn);
  const layer = h('div.op', { attrs: { role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Ouverture du booster' }, tabindex: -1 }, h('div.op-bg'), rays, dim, stage, flash, fx, banner, h('div.op-top', {}, count, h('span.spacer'), skip, quit), hint, tray);
  root.append(layer);
  lockScroll(true);
  layer.focus({ preventScroll: true });

  let phase = 'pack';
  let k = 0; // carte affichée
  let deck = [];
  let busy = false;
  let closed = false;

  function close(goCollection = false) {
    if (closed) return;
    closed = true;
    document.removeEventListener('keydown', onKey, true);
    const done = () => {
      layer.remove();
      lockScroll(false);
    };
    if (motionOK()) layer.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 220 }).onfinish = done;
    else done();
    o.onClose?.(goCollection);
  }

  // ---------------------------------------------------------------- 1. déchirer le booster
  const tear = pack.querySelector('.pack-tear');
  const body = pack.querySelector('.pack-body');
  const setP = (p) => tear.style.setProperty('--p', String(Math.max(0, Math.min(1, p))));
  let drag = null;
  body.addEventListener('pointerdown', (e) => {
    if (phase !== 'pack') return;
    const r = body.getBoundingClientRect();
    if (e.clientY - r.top > r.height * 0.32) return; // seulement le haut du booster
    drag = { x0: e.clientX, w: r.width };
    pack.classList.add('is-tearing');
    body.setPointerCapture(e.pointerId);
  });
  body.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const p = Math.abs(e.clientX - drag.x0) / (drag.w * 0.8);
    setP(p);
    if (p >= 1) {
      drag = null;
      tearOpen();
    }
  });
  const endDrag = () => {
    if (!drag) return;
    drag = null;
    pack.classList.remove('is-tearing');
    if (motionOK()) tear.firstChild.animate([{ transform: tear.firstChild.style.transform || 'scaleX(0)' }, { transform: 'scaleX(0)' }], { duration: 250 });
    setP(0);
  };
  body.addEventListener('pointerup', endDrag);
  body.addEventListener('pointercancel', endDrag);
  body.addEventListener('click', () => phase === 'pack' && hint.animate([{ opacity: 0.4 }, { opacity: 1 }], { duration: 400 }));
  openBtn.addEventListener('click', () => autoTear());

  async function autoTear() {
    if (phase !== 'pack' || busy) return;
    busy = true;
    pack.classList.add('is-tearing');
    if (motionOK()) {
      for (let i = 1; i <= 12; i++) {
        setP(i / 12);
        await sleep(28);
      }
    }
    busy = false;
    tearOpen();
  }

  async function tearOpen() {
    if (phase !== 'pack') return;
    phase = 'deck';
    setP(1);
    openBtn.hidden = true;
    if (motionOK()) {
      flash.animate([{ opacity: 0 }, { opacity: 0.9 }, { opacity: 0 }], { duration: 650, easing: 'ease-out' });
      await pack.animate([{ transform: 'none', opacity: 1 }, { transform: 'translateY(-60px) scale(1.08) rotate(-4deg)', opacity: 0 }], { duration: 420, easing: EASE, fill: 'forwards' }).finished.catch(() => {});
    }
    pack.remove();
    showDeck();
  }

  // ---------------------------------------------------------------- 2. les cartes
  function showDeck() {
    const holder = h('div.op-deck');
    deck = reveal.map((p, i) => {
      const el = cardEl(p.card, { size: 'xl', serial: p.serial, back: true, isNew: false, echo: p.echo });
      el.classList.add('op-card', `di-${reveal.length - 1 - i}`);
      return el;
    });
    // Le dessus de la pile est le dernier enfant : la première carte à révéler.
    for (let i = deck.length - 1; i >= 0; i--) holder.append(deck[i]);
    stage.append(holder);
    holder.addEventListener('click', advance);
    skip.hidden = false;
    if (motionOK()) holder.animate([{ opacity: 0, transform: 'translateY(40px) scale(.9)' }, { opacity: 1, transform: 'none' }], { duration: 420, easing: EASE });
    top();
  }

  function top() {
    const el = deck[k];
    if (!el) return;
    el.classList.add('is-top');
    count.textContent = `${k + 1} / ${reveal.length}`;
    const r = reveal[k].card.rarity;
    const echo = reveal[k].echo;
    if (tier(r) >= 2 && !echo && !reveal[k].card.removed) el.classList.add(`is-hint-${r}`);
    hint.textContent = k === 0 ? 'Touche la carte pour la retourner' : tier(r) >= 2 && !echo ? 'Celle-ci brille… touche pour la retourner' : 'Touche pour retourner';
  }

  async function advance() {
    if (busy || phase !== 'deck') return;
    const el = deck[k];
    const p = reveal[k];
    if (!el) return;
    busy = true;
    if (el.classList.contains('is-back')) {
      // Retourner (après un battement pour les plus rares).
      const r = p.card.rarity;
      if (tier(r) >= 3 && !p.echo && motionOK()) {
        await el.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.04)' }, { transform: 'scale(.98)' }, { transform: 'scale(1.05)' }, { transform: 'scale(1)' }], { duration: 900, easing: 'ease-in-out' }).finished.catch(() => {});
      }
      el.classList.remove('is-back', ...['epique', 'legendaire', 'unique'].map((x) => `is-hint-${x}`));
      el.classList.add('is-live');
      if (p.new) el.append(h('span.tc-new', { text: 'Nouvelle' }));
      if (p.echo) echoed(p);
      else if (tier(r) >= 2) celebrate(p);
      hint.textContent = k === reveal.length - 1 ? 'Touche pour voir ton tirage' : 'Touche pour la carte suivante';
      await sleep(motionOK() ? 450 : 0);
      busy = false;
      return;
    }
    // Ranger dans le plateau.
    calm();
    const slot = slots[k];
    if (motionOK()) {
      const a = el.getBoundingClientRect();
      const b = slot.getBoundingClientRect();
      const dx = b.left + b.width / 2 - (a.left + a.width / 2);
      const dy = b.top + b.height / 2 - (a.top + a.height / 2);
      await el.animate([{ transform: 'none', opacity: 1 }, { transform: `translate(${dx}px, ${dy}px) scale(${b.width / a.width})`, opacity: 0.4 }], { duration: 420, easing: EASE, fill: 'forwards' }).finished.catch(() => {});
    }
    el.remove();
    slot.classList.add(`is-${p.card.rarity}`);
    if (p.echo) slot.classList.add('is-echo');
    slot.append(h('img', { alt: '', src: p.card.thumb || p.card.img || placeholderArt(p.card.id) }));
    if (motionOK()) slot.animate([{ transform: 'scale(1.25)' }, { transform: 'none' }], { duration: 300, easing: EASE });
    k++;
    busy = false;
    if (k >= reveal.length) return recap();
    top();
  }

  function celebrate(p) {
    const r = p.card.rarity;
    if (tier(r) >= 3) {
      rays.className = `op-rays is-${r}`;
      if (motionOK()) {
        rays.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 600, fill: 'forwards' });
        dim.animate([{ opacity: 0 }, { opacity: 0.55 }], { duration: 600, fill: 'forwards' });
        flash.animate([{ opacity: 0 }, { opacity: r === 'unique' ? 1 : 0.7 }, { opacity: 0 }], { duration: 700 });
      }
      const run = p.card.run;
      banner.replaceChildren(
        h(`span.op-banner-k${r === 'unique' ? '.op-banner--unique' : ''}`, { text: RLABEL[r] }),
        h('span.op-banner-s', { text: r === 'unique' ? 'Seul exemplaire au monde · 1 / 1' : `${run} exemplaires au monde · n° ${p.serial}` }),
      );
      banner.classList.remove('is-on');
      void banner.offsetWidth;
      banner.classList.add('is-on');
      burst(fx, r, true);
      if (navigator.vibrate) navigator.vibrate(r === 'unique' ? [60, 40, 60, 40, 120] : [40, 30, 80]);
    } else burst(fx, r, false);
  }

  // Écho : une onde qui part de la carte, une bannière sobre. Ni rayons, ni éclat, ni confettis.
  function echoed(p) {
    const r = p.card.rarity;
    banner.replaceChildren(
      h('span.op-banner-k.op-banner--echo', { text: `${ECHO} · ${RLABEL[r]}` }),
      h('span.op-banner-s', { text: `${r === 'unique' ? 'Exemplaire unique déjà tiré' : `${p.card.run} exemplaires déjà tirés`} · ne s’échange pas` }),
    );
    banner.classList.remove('is-on');
    void banner.offsetWidth;
    banner.classList.add('is-on');
    if (!motionOK()) return;
    for (let i = 0; i < 3; i++) {
      const ring = h('span.op-echo');
      fx.append(ring);
      ring.animate([{ opacity: 0.9, transform: 'translate(-50%, -50%) scale(.6)' }, { opacity: 0, transform: 'translate(-50%, -50%) scale(4.2)' }], { duration: 1500, delay: 260 * i, easing: 'cubic-bezier(.2,.6,.3,1)', fill: 'backwards' }).onfinish = () => ring.remove();
    }
    if (navigator.vibrate) navigator.vibrate(30);
  }

  function calm() {
    if (!motionOK()) return;
    for (const el of [rays, dim]) {
      const now = getComputedStyle(el).opacity;
      if (Number(now) > 0) el.animate([{ opacity: now }, { opacity: 0 }], { duration: 300, fill: 'forwards' });
    }
  }

  // ---------------------------------------------------------------- 3. récapitulatif
  function recap() {
    if (phase === 'recap') return;
    phase = 'recap';
    close(false);
    showRecap(o, reveal);
  }

  skip.addEventListener('click', recap);
  quit.addEventListener('click', () => (phase === 'pack' ? close(false) : recap()));
  const onKey = (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      phase === 'pack' ? close(false) : recap();
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      if (phase === 'pack') autoTear();
      else advance();
    }
  };
  document.addEventListener('keydown', onKey, true);
}

/** Récapitulatif d'un tirage (après l'ouverture, ou « Revoir mon tirage »). */
export function showRecap(o, reveal = o.pulls.map((p) => ({ ...p, card: o.cardOf(p.card) })).filter((p) => p.card)) {
  const fresh = reveal.filter((p) => p.new).length;
  const echoes = reveal.filter((p) => p.echo).length;
  const row = h('div.rc-row');
  for (const p of reveal) {
    const btn = h('button.rc-cardbtn', { type: 'button', attrs: { 'aria-label': `${p.card.title}, ${RLABEL[p.card.rarity]}${p.echo ? `, ${ECHO}` : ''}` } }, cardEl(p.card, { size: 'md', serial: p.serial, live: true, isNew: p.new, echo: p.echo }));
    btn.addEventListener('click', () => o.onCard?.(p.card, p.serial, p.echo));
    row.append(btn);
  }
  let s;
  const done = tbtn('Terminer', null, 'tbtn--ghost', () => s.close());
  const coll = tbtn('Voir ma collection', 'collection', 'tbtn--primary', () => {
    s.close();
    o.onClose?.(true);
  });
  const title = fresh === 0 ? 'Que des doubles : parfait pour échanger' : fresh === 1 ? '1 nouvelle carte !' : `${fresh} nouvelles cartes !`;
  const echoNote = echoes ? ` ${echoes > 1 ? `Les ${echoes} échos comptent` : 'L’écho compte'} pour ta collection, sans s’échanger.` : '';
  s = sheet('recap', 'Ton tirage', h('div.rc', {}, h('p.tk', { text: o.kicker ?? 'Ton tirage' }), h('h2.rc-h', { text: title }), row, h('p.rc-p', { text: `Ta collection : ${o.ownedCount()} / ${o.totalCount()} cartes. Les doubles servent aux échanges.${echoNote}` }), h('div.rc-acts', {}, done, coll)));
  if (motionOK()) [...row.children].forEach((c, i) => c.animate([{ opacity: 0, transform: 'translateY(24px) rotate(-3deg)' }, { opacity: 1, transform: 'none' }], { duration: 420, delay: 80 * i, easing: EASE, fill: 'backwards' }));
  return s;
}
