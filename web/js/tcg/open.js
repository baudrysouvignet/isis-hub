// ISIS · TCG : ouverture d'un booster (du jour ou bonus), en plein écran.
//
// Mise en scène (montée en tension, puis récompense), inspirée des ouvertures de coffres et de
// « Starr Drops » des jeux mobiles :
//   1. le booster tombe du haut de l'écran et atterrit (impact, poussière d'étincelles), des rayons
//      tournent derrière lui et des particules montent. Glisser le doigt sur le haut (ou « Ouvrir »,
//      ou Entrée) le déchire : des étincelles suivent le doigt, il vibre de plus en plus. S'il cache
//      une Légendaire ou mieux, il tremble et luit, et la déchirure prend la couleur de sa meilleure
//      carte. À l'ouverture : éclair, le haut du booster s'envole, un faisceau de lumière jaillit, et
//      les cartes sortent une à une avant de retomber en pile ;
//   2. les cartes, face cachée. Une Commune se retourne tout de suite. Les autres se chargent,
//      palier par palier (Rare, puis Épique, puis Légendaire, puis Unique) : à chaque palier la
//      lueur change de couleur, la carte tremble plus fort, des étincelles partent, le fond
//      s'assombrit. Avant une Légendaire ou une Unique, un temps d'attente ; avant une Unique, une
//      pluie d'or converge vers la carte. Toucher l'écran fait passer au palier suivant ;
//   3. le retournement : Rare et Épique, onde de choc et éclat ; Légendaire et Unique, la carte
//      tourne sur elle-même, l'écran tremble, rayons, bannière et confettis. Un écho (copie de
//      substitution) se charge comme sa rareté, mais se révèle sobrement : une onde, une bannière
//      grise, ni rayons ni confettis. Rien ne dit « écho » avant le retournement ;
//   4. récapitulatif du tirage.
// Son facultatif (coupé par défaut, synthétisé dans la page : aucun fichier, aucune requête) et
// vibrations. Sans animations (réglage du système), tout se retourne sans attendre.
// Les cartes sont déjà dans la collection (le serveur a tiré le booster avant l'animation).

import { h, motionOK, sleep, lockScroll } from '../core/dom.js';
import { prefs } from '../core/store.js';
import { cardEl, ic, mark, tier, RLABEL, ECHO, sheet, tbtn, placeholderArt, plural } from './ui.js';

const EASE = 'cubic-bezier(.2,.8,.2,1)';
const LADDER = ['rare', 'epique', 'legendaire', 'unique'];
const TONE = { commune: '#A9C3C7', rare: '#4CC3D3', epique: '#A98BFF', legendaire: '#FF8A65', unique: '#F5C451', echo: '#C9E2E6' };
const SPARKS = {
  commune: ['#EAF6F7', '#A9C3C7'],
  rare: ['#B4F3F9', '#4CC3D3', '#EAF6F7'],
  epique: ['#C9B6FF', '#A98BFF', '#8FEAF3'],
  legendaire: ['#FF8A65', '#FFB86B', '#FF4D9D', '#FFE8A3', '#A98BFF'],
  unique: ['#F5C451', '#FFE8A3', '#FFF6CF', '#FFFFFF'],
  echo: ['#DDE7E9', '#B8C9CC', '#FFFFFF'],
};
// Vibrations : seulement après un geste de l'utilisateur (sinon le navigateur refuse et le signale).
const buzz = (pattern) => navigator.userActivation?.hasBeenActive !== false && navigator.vibrate?.(pattern);

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

// ------------------------------------------------------------------ son (facultatif)
// Synthétisé avec Web Audio : quelques notes et un souffle. Coupé par défaut (on ouvre souvent
// ses boosters en cours) ; le bouton du haut de l'écran le rallume, et le choix est gardé ici.
const sound = (() => {
  let ctx = null;
  const on = () => prefs.get('tcgSound', false) === true;
  function ac() {
    if (!ctx) {
      const C = window.AudioContext || window.webkitAudioContext;
      if (!C) return null;
      ctx = new C();
    }
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    return ctx;
  }
  function note(freq, { at = 0, dur = 0.25, type = 'triangle', gain = 0.06, slide = 0 } = {}) {
    if (!on()) return;
    const c = ac();
    if (!c) return;
    const t = c.currentTime + at;
    const osc = c.createOscillator();
    const g = c.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (slide) osc.frequency.exponentialRampToValueAtTime(Math.max(30, freq * slide), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g).connect(c.destination);
    osc.start(t);
    osc.stop(t + dur + 0.05);
  }
  function whoosh({ at = 0, dur = 0.35, gain = 0.07, from = 2600, to = 380 } = {}) {
    if (!on()) return;
    const c = ac();
    if (!c) return;
    const t = c.currentTime + at;
    const len = Math.floor(c.sampleRate * dur);
    const buf = c.createBuffer(1, len, c.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    const src = c.createBufferSource();
    src.buffer = buf;
    const f = c.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.setValueAtTime(from, t);
    f.frequency.exponentialRampToValueAtTime(to, t + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(c.destination);
    src.start(t);
    src.stop(t + dur);
  }
  const C5 = 523.25;
  const chord = (ratios, at = 0, gain = 0.05) => ratios.forEach((r, i) => note(C5 * r, { at: at + i * 0.07, dur: 0.6, gain }));
  return {
    on,
    toggle() {
      prefs.set('tcgSound', !on());
      if (on()) ac();
      return on();
    },
    tear: () => whoosh(),
    thump: () => note(70, { dur: 0.35, type: 'sine', gain: 0.12, slide: 0.6 }),
    pop: (i) => note(620 + i * 90, { dur: 0.12, type: 'triangle', gain: 0.04, slide: 1.4 }),
    flip: () => note(880, { dur: 0.08, type: 'sine', gain: 0.035 }),
    step: (i) => {
      const f = C5 * [1, 1.26, 1.5, 2][Math.min(i, 3)];
      note(f, { dur: 0.3 });
      note(f * 2, { dur: 0.2, type: 'sine', gain: 0.02 });
    },
    rise: () => whoosh({ dur: 0.9, gain: 0.05, from: 300, to: 3200 }),
    reveal(r) {
      if (r === 'rare') chord([1, 1.26]);
      else if (r === 'epique') chord([1, 1.26, 1.5]);
      else if (r === 'legendaire' || r === 'unique') {
        note(98, { dur: 0.7, type: 'sine', gain: 0.14, slide: 0.45 });
        chord(r === 'unique' ? [1, 1.26, 1.5, 2, 2.52] : [1, 1.26, 1.5, 2], 0.05, 0.055);
        if (r === 'unique') for (let i = 0; i < 6; i++) note(2093 + i * 120, { at: 0.4 + i * 0.09, dur: 0.18, type: 'sine', gain: 0.02 });
      } else note(660, { dur: 0.1, type: 'sine', gain: 0.03 });
    },
    echo: () => [0, 0.2, 0.4].forEach((at, i) => note(880, { at, dur: 0.35, type: 'sine', gain: 0.045 / (i + 1), slide: 0.75 })),
  };
})();

// ------------------------------------------------------------------ particules
/** Étincelles qui partent d'un point (x, y). */
function burst(fx, colors, { n = 26, x = innerWidth / 2, y = innerHeight * 0.45, spread = 160, fall = 60, conf = false } = {}) {
  if (!motionOK()) return;
  for (let i = 0; i < n; i++) {
    const kind = conf && i % 3 === 0 ? 'tfx--conf' : i % 4 === 0 ? 'tfx--star' : '';
    const p = h(`span.tfx${kind ? '.' + kind : ''}`);
    p.style.setProperty('--c', colors[i % colors.length]);
    p.style.setProperty('--s', `${4 + Math.random() * (conf ? 9 : 6)}px`);
    p.style.setProperty('left', `${x}px`);
    p.style.setProperty('top', `${y}px`);
    fx.append(p);
    const a = Math.random() * Math.PI * 2;
    const d = spread * (0.55 + Math.random());
    p.animate(
      [
        { transform: 'translate(-50%, -50%) scale(1) rotate(0deg)', opacity: 1 },
        { transform: `translate(calc(-50% + ${Math.cos(a) * d}px), calc(-50% + ${Math.sin(a) * d + fall}px)) scale(${0.3 + Math.random() * 0.6}) rotate(${Math.random() * 720 - 360}deg)`, opacity: 0 },
      ],
      { duration: 800 + Math.random() * 900, easing: 'cubic-bezier(.15,.7,.3,1)', fill: 'forwards' },
    ).onfinish = () => p.remove();
  }
}

/** Pluie qui converge vers (x, y) depuis les bords de l'écran (avant une Unique). */
function implode(fx, colors, { n = 48, x, y, duration = 900 } = {}) {
  if (!motionOK()) return;
  const R = Math.hypot(innerWidth, innerHeight) / 1.6;
  for (let i = 0; i < n; i++) {
    const p = h(`span.tfx${i % 3 === 0 ? '.tfx--star' : ''}`);
    p.style.setProperty('--c', colors[i % colors.length]);
    p.style.setProperty('--s', `${3 + Math.random() * 6}px`);
    p.style.setProperty('left', `${x}px`);
    p.style.setProperty('top', `${y}px`);
    fx.append(p);
    const a = Math.random() * Math.PI * 2;
    const d = R * (0.6 + Math.random() * 0.5);
    p.animate(
      [
        { transform: `translate(calc(-50% + ${Math.cos(a) * d}px), calc(-50% + ${Math.sin(a) * d}px)) scale(.6)`, opacity: 0 },
        { opacity: 1, offset: 0.25 },
        { transform: 'translate(-50%, -50%) scale(1.2)', opacity: 0.9 },
      ],
      { duration: duration * (0.7 + Math.random() * 0.3), delay: Math.random() * 200, easing: 'cubic-bezier(.55,0,.8,.4)', fill: 'forwards' },
    ).onfinish = () => p.remove();
  }
}

/**
 * Ouvre l'écran d'ouverture.
 * o : { pulls, cardOf(id), ownedCount, totalCount, onClose(goCollection), onCard(card, serial, echo), bonus, season, kicker, trial }
 */
export function openBooster(o) {
  const root = document.querySelector('.app');
  const reveal = o.pulls.map((p) => ({ ...p, card: o.cardOf(p.card) })).filter((p) => p.card);
  const rays = h('div.op-rays');
  const glow = h('div.op-glow');
  const dim = h('div.op-dim');
  const flash = h('div.op-flash');
  const fx = h('div.op-fx');
  const banner = h('div.op-banner');
  const tierLabel = h('div.op-tier', { attrs: { 'aria-live': 'polite' } });
  const count = h('p.op-count');
  const skip = h('button.op-skip', { type: 'button', hidden: true }, ic('spark'), h('span', { text: 'Tout révéler' }));
  const quit = h('button.op-quit', { type: 'button', attrs: { 'aria-label': 'Fermer' } }, ic('x'));
  const soundBtn = h('button.op-quit.op-sound', { type: 'button' });
  const paintSound = () => {
    soundBtn.replaceChildren(ic(sound.on() ? 'sound' : 'mute'));
    soundBtn.setAttribute('aria-label', sound.on() ? 'Couper le son' : 'Activer le son');
    soundBtn.setAttribute('aria-pressed', String(sound.on()));
  };
  paintSound();
  soundBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    sound.toggle();
    paintSound();
    sound.flip();
  });
  const hint = h('p.op-hint', { attrs: { 'aria-live': 'polite' }, text: 'Glisse sur le haut du booster, ou appuie sur Entrée' });
  const slots = reveal.map(() => h('span.op-slot'));
  const tray = h('div.op-tray', {}, ...slots);
  const pack = packEl({ size: reveal.length, bonus: Boolean(o.bonus), season: o.season });
  // Le booster trahit sa meilleure vraie carte (pas un écho) : lueur et tremblement dès Légendaire,
  // couleur de la déchirure dès Rare.
  const best = reveal.reduce((m, p) => (p.echo ? m : Math.max(m, tier(p.card.rarity))), 0);
  if (best >= 1) {
    pack.classList.add(`is-tease-${LADDER[best - 1]}`);
    pack.style.setProperty('--tease', TONE[LADDER[best - 1]]);
  }
  const openBtn = tbtn('Ouvrir', 'booster', 'tbtn--primary op-openbtn');
  const stage = h('div.op-stage', {}, pack, openBtn);
  // Derrière le booster : rayons qui tournent, halo, particules qui montent (à la couleur de sa
  // meilleure carte s'il en cache une).
  const sun = h('div.op-sun');
  const motes = h('div.op-motes', { attrs: { 'aria-hidden': 'true' } });
  for (let i = 0; i < 18; i++) {
    const m = h('i');
    m.style.setProperty('--x', `${Math.round(Math.random() * 100)}%`);
    m.style.setProperty('--d', `${(3 + Math.random() * 4).toFixed(2)}s`);
    m.style.setProperty('--w', `${(-Math.random() * 6).toFixed(2)}s`);
    m.style.setProperty('--z', `${(0.5 + Math.random()).toFixed(2)}`);
    motes.append(m);
  }
  const packTone = best >= 1 ? TONE[LADDER[best - 1]] : '#8FEAF3';
  sun.style.setProperty('--tone', packTone);
  motes.style.setProperty('--tone', packTone);
  const layer = h(
    'div.op',
    { attrs: { role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Ouverture du booster' }, tabindex: -1 },
    h('div.op-bg'),
    sun,
    motes,
    glow,
    rays,
    dim,
    stage,
    flash,
    fx,
    tierLabel,
    banner,
    h('div.op-top', {}, count, h('span.spacer'), skip, soundBtn, quit),
    hint,
    tray,
  );
  root.append(layer);
  lockScroll(true);
  layer.focus({ preventScroll: true });
  entrance();

  let phase = 'pack'; // pack | deck | charge | recap
  let k = 0; // carte affichée
  let deck = [];
  let busy = false;
  let closed = false;
  let hurry = null; // touche pendant la charge : palier suivant tout de suite

  /** Attente, que le joueur peut abréger d'un toucher. */
  const wait = (ms) =>
    new Promise((resolve) => {
      const done = () => {
        clearTimeout(timer);
        hurry = null;
        resolve();
      };
      const timer = setTimeout(done, ms);
      hurry = done;
    });

  function close(goCollection = false) {
    if (closed) return;
    closed = true;
    hurry?.();
    document.removeEventListener('keydown', onKey, true);
    const done = () => {
      layer.remove();
      lockScroll(false);
    };
    if (motionOK()) layer.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 220 }).onfinish = done;
    else done();
    o.onClose?.(goCollection);
  }

  // ---------------------------------------------------------------- 1. le booster arrive
  function entrance() {
    sun.classList.add('is-on');
    if (!motionOK()) return;
    pack.animate(
      [
        { transform: 'translateY(-115vh) rotate(-14deg) scale(.78)', opacity: 1 },
        { transform: 'translateY(0) rotate(3deg) scale(1.02, .9)', offset: 0.62 },
        { transform: 'translateY(-26px) rotate(-1.5deg) scale(.98, 1.04)', offset: 0.8 },
        { transform: 'translateY(0) rotate(0) scale(1)' },
      ],
      { duration: 820, easing: 'cubic-bezier(.45,0,.55,1)' },
    );
    sun.animate([{ opacity: 0, transform: 'scale(.4) rotate(-40deg)' }, { opacity: 1, transform: 'scale(1) rotate(0)' }], { duration: 900, delay: 380, easing: EASE, fill: 'backwards' });
    openBtn.animate([{ opacity: 0, transform: 'translateY(16px)' }, { opacity: 1, transform: 'none' }], { duration: 360, delay: 700, easing: EASE, fill: 'backwards' });
    setTimeout(() => {
      if (closed || phase !== 'pack') return;
      // Atterrissage : onde au sol, étincelles, petit tremblement de l'écran.
      const r = pack.getBoundingClientRect();
      const x = r.left + r.width / 2;
      const y = r.bottom - 8;
      const ring = h('span.op-land');
      ring.style.setProperty('left', `${x}px`);
      ring.style.setProperty('top', `${y}px`);
      ring.style.setProperty('--tone', packTone);
      fx.append(ring);
      ring.animate([{ opacity: 0.9, transform: 'translate(-50%, -50%) scale(.3, .12)' }, { opacity: 0, transform: 'translate(-50%, -50%) scale(3.4, 1)' }], { duration: 700, easing: 'cubic-bezier(.1,.7,.3,1)' }).onfinish = () => ring.remove();
      burst(fx, best >= 1 ? SPARKS[LADDER[best - 1]] : SPARKS.rare, { n: 22, x, y, spread: 140, fall: -70 });
      layer.animate([{ transform: 'none' }, { transform: 'translateY(5px)' }, { transform: 'translateY(-2px)' }, { transform: 'none' }], { duration: 260, easing: 'ease-out' });
      sound.thump();
      buzz(20);
    }, 510);
  }

  // ---------------------------------------------------------------- 2. déchirer le booster
  const tear = pack.querySelector('.pack-tear');
  const body = pack.querySelector('.pack-body');
  let lastSpark = 0;
  const setP = (p) => {
    p = Math.max(0, Math.min(1, p));
    tear.style.setProperty('--p', String(p));
    pack.style.setProperty('--tp', String(p));
    if (!motionOK()) return;
    // Le booster vibre de plus en plus, des étincelles suivent la déchirure.
    body.style.translate = p > 0 && p < 1 ? `${((Math.random() - 0.5) * p * 7).toFixed(1)}px ${((Math.random() - 0.5) * p * 4).toFixed(1)}px` : '';
    if (p - lastSpark > 0.07 || p < lastSpark) {
      lastSpark = p;
      const r = tear.getBoundingClientRect();
      if (p > 0) burst(fx, best >= 1 ? SPARKS[LADDER[best - 1]] : ['#FFFFFF', '#8FEAF3'], { n: 5, x: r.left + r.width * p, y: r.top, spread: 46, fall: 34 });
    }
  };
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
    sound.tear();
    if (best >= 3) sound.thump();
    buzz(best >= 3 ? [30, 40, 60] : 25);
    if (motionOK()) {
      const r = pack.getBoundingClientRect();
      const x = r.left + r.width / 2;
      const top = r.top + r.height * 0.12;
      flash.style.setProperty('--flash', packTone);
      flash.animate([{ opacity: 0 }, { opacity: 0.95 }, { opacity: 0 }], { duration: 700, easing: 'ease-out' });
      layer.animate([{ transform: 'none' }, { transform: 'translate(4px, -3px)' }, { transform: 'translate(-4px, 3px)' }, { transform: 'none' }], { duration: 300 });
      // Le haut du booster s'envole.
      const cap = pack.querySelector('.pack-cap');
      const cr = cap.getBoundingClientRect();
      const flyer = cap.cloneNode(true);
      flyer.classList.add('op-cap');
      for (const [k, v] of Object.entries({ left: `${cr.left}px`, top: `${cr.top}px`, width: `${cr.width}px`, height: `${cr.height}px` })) flyer.style.setProperty(k, v);
      if (pack.classList.contains('pack--bonus')) flyer.classList.add('op-cap--bonus');
      fx.append(flyer);
      cap.style.visibility = 'hidden';
      flyer.animate([{ transform: 'none', opacity: 1 }, { transform: `translate(${-40 - Math.random() * 40}px, -42vh) rotate(-${30 + Math.random() * 25}deg)`, opacity: 0 }], { duration: 900, easing: 'cubic-bezier(.2,.6,.4,1)', fill: 'forwards' }).onfinish = () => flyer.remove();
      // Un faisceau de lumière jaillit du booster ouvert.
      const beam = h('span.op-beam');
      beam.style.setProperty('--tone', packTone);
      beam.style.setProperty('left', `${x}px`);
      beam.style.setProperty('top', `${top}px`);
      beam.style.setProperty('width', `${r.width * 1.7}px`);
      fx.append(beam);
      beam.animate([{ opacity: 0, transform: 'translate(-50%, -100%) scaleY(0)' }, { opacity: 1, transform: 'translate(-50%, -100%) scaleY(1)', offset: 0.35 }, { opacity: 0, transform: 'translate(-50%, -100%) scaleY(1.1) scaleX(1.5)' }], { duration: 820, easing: 'ease-out' }).onfinish = () => beam.remove();
      burst(fx, best >= 1 ? SPARKS[LADDER[best - 1]] : SPARKS.rare, { n: 30 + best * 12, x, y: top, spread: 200 + best * 30, fall: -60 });
      sun.animate([{ opacity: 1 }, { opacity: 0, transform: 'scale(1.6)' }], { duration: 600, fill: 'forwards' });
      motes.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 400, fill: 'forwards' });
      // Le booster retombe pendant que les cartes en sortent : il quitte la mise en page (position
      // fixe, à sa place) pour que la pile prenne sa place sans attendre.
      const pr = pack.getBoundingClientRect();
      for (const [k2, v] of Object.entries({ position: 'fixed', left: `${pr.left}px`, top: `${pr.top}px`, width: `${pr.width}px`, margin: '0', 'z-index': '2' })) pack.style.setProperty(k2, v);
      layer.append(pack);
      const exit = pack.animate([{ transform: 'none', opacity: 1 }, { transform: 'translateY(-14px) scale(1.06)', opacity: 1, offset: 0.25 }, { transform: 'translateY(110px) scale(.9) rotate(4deg)', opacity: 0 }], { duration: 560, easing: 'cubic-bezier(.4,0,.6,1)', fill: 'forwards' });
      exit.finished.catch(() => {}).finally(() => {
        pack.remove();
        sun.remove();
        motes.remove();
      });
      await sleep(240);
      showDeck();
      return;
    }
    pack.remove();
    sun.remove();
    motes.remove();
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
    if (motionOK()) {
      // Les cartes sortent du booster une à une, montent en tournoyant, puis retombent en pile.
      const n = deck.length;
      for (let j = n - 1; j >= 0; j--) {
        const el = deck[j];
        const i = j === 0 ? 0 : n - 1 - j; // décalage de la carte dans la pile (aucun pour celle du dessus)
        const order = n - 1 - j; // la carte du dessous sort la première
        const spin = (Math.random() - 0.5) * 40;
        const side = (order % 2 ? 1 : -1) * (30 + Math.random() * 40);
        el.animate(
          [
            { transform: 'translateY(38%) scale(.32) rotate(0deg)', opacity: 0 },
            { transform: `translate(${side}px, -62%) scale(.82) rotate(${spin}deg)`, opacity: 1, offset: 0.45 },
            { transform: `translate(${i * 4}px, ${-i * 4 - 10}px) scale(1.02) rotate(${i * 1.3}deg)`, offset: 0.82 },
            { transform: `translate(${i * 4}px, ${-i * 4}px) scale(1) rotate(${i * 1.3}deg)` },
          ],
          { duration: 760, delay: 90 + order * 120, easing: 'cubic-bezier(.3,.7,.3,1)', fill: 'backwards' },
        );
        setTimeout(() => !closed && sound.pop(order), 90 + order * 120);
      }
    }
    top();
  }

  function top() {
    const el = deck[k];
    if (!el) return;
    el.classList.add('is-top');
    count.textContent = `${k + 1} / ${reveal.length}`;
    const r = reveal[k].card.rarity;
    // Le dos luit avant une Épique ou mieux, écho compris : rien ne trahit un écho avant le
    // retournement.
    if (tier(r) >= 2 && !reveal[k].card.removed) el.classList.add(`is-hint-${r}`);
    hint.textContent = k === 0 ? 'Touche la carte pour la retourner' : tier(r) >= 2 ? 'Celle-ci brille… touche pour la retourner' : 'Touche pour retourner';
  }

  const centerOf = (el) => {
    const b = el.getBoundingClientRect();
    return { x: b.left + b.width / 2, y: b.top + b.height / 2 };
  };

  /** Montée en tension avant le retournement : un palier par rareté, jusqu'à celle de la carte. */
  async function charge(el, p) {
    const t = tier(p.card.rarity);
    if (t === 0 || !motionOK() || p.card.removed) return;
    phase = 'charge';
    hint.textContent = 'Touche pour accélérer';
    el.classList.remove(...LADDER.map((x) => `is-hint-${x}`));
    const c = centerOf(el);
    glow.classList.add('is-on');
    for (let i = 0; i < t && !closed; i++) {
      const s = LADDER[i];
      const last = i === t - 1;
      el.dataset.charge = s;
      layer.style.setProperty('--tone', TONE[s]);
      const label = h(`b.op-tier-k.is-${s}`, { text: last ? `${RLABEL[s]}${t >= 3 ? ' !!' : ' !'}` : `${RLABEL[s]}…` });
      tierLabel.replaceChildren(label);
      label.animate([{ opacity: 0, transform: 'scale(1.8)' }, { opacity: 1, transform: 'scale(.94)', offset: 0.6 }, { opacity: 1, transform: 'scale(1)' }], { duration: 360, easing: EASE });
      const amp = 3 + i * 3;
      el.animate(
        [
          { transform: 'scale(1)' },
          { transform: `scale(${1.06 + i * 0.03}) translateX(${amp}px) rotate(${amp / 3}deg)`, offset: 0.25 },
          { transform: `scale(${1.04 + i * 0.03}) translateX(${-amp}px) rotate(${-amp / 3}deg)`, offset: 0.5 },
          { transform: `scale(${1.02 + i * 0.02}) translateX(${amp / 2}px)`, offset: 0.75 },
          { transform: 'scale(1)' },
        ],
        { duration: 380, easing: 'ease-out' },
      );
      burst(fx, SPARKS[s], { n: 10 + i * 9, x: c.x, y: c.y, spread: 110 + i * 50, fall: 20 });
      if (i >= 1) dim.animate([{ opacity: getComputedStyle(dim).opacity }, { opacity: Math.min(0.75, 0.18 + i * 0.18) }], { duration: 300, fill: 'forwards' });
      sound.step(i);
      buzz(14 + i * 14);
      await wait(last ? 300 : [560, 640, 760][i]);
    }
    if (closed) return;
    if (t >= 3) {
      // Le temps d'attente : la carte tremble, plus rien ne bouge autour.
      el.classList.add('is-tremble');
      hint.textContent = '…';
      if (t === 4) {
        dim.animate([{ opacity: getComputedStyle(dim).opacity }, { opacity: 0.9 }], { duration: 500, fill: 'forwards' });
        implode(fx, SPARKS.unique, { n: 56, x: c.x, y: c.y, duration: 1000 });
        sound.rise();
        buzz([20, 60, 20, 60, 20]);
      }
      await wait(t === 4 ? 1150 : 700);
      el.classList.remove('is-tremble');
    }
  }

  async function advance() {
    if (phase === 'charge') return hurry?.();
    if (busy || phase !== 'deck') return;
    const el = deck[k];
    const p = reveal[k];
    if (!el) return;
    busy = true;
    if (el.classList.contains('is-back')) {
      await charge(el, p);
      if (closed) return;
      phase = 'deck';
      flip(el, p);
      hint.textContent = k === reveal.length - 1 ? 'Touche pour voir ton tirage' : 'Touche pour la carte suivante';
      await sleep(motionOK() ? 520 : 0);
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

  // ---------------------------------------------------------------- 3. le retournement
  function flip(el, p) {
    const r = p.card.rarity;
    const t = tier(r);
    el.classList.remove('is-back', ...LADDER.map((x) => `is-hint-${x}`));
    delete el.dataset.charge;
    // L'annonce du palier laisse la place à la bannière.
    const lbl = tierLabel.firstChild;
    if (lbl && motionOK()) lbl.animate([{ opacity: 1 }, { opacity: 0, transform: 'scale(.8) translateY(-12px)' }], { duration: 180, fill: 'forwards' }).onfinish = () => tierLabel.replaceChildren();
    else tierLabel.replaceChildren();
    el.classList.add('is-live');
    if (el.dataset.label) el.setAttribute('aria-label', el.dataset.label);
    if (p.new) el.append(h('span.tc-new', { text: 'Nouvelle' }));
    if (motionOK()) {
      if (t >= 3 && !p.echo) {
        // Légendaire, Unique : la carte tourne sur elle-même en grandissant.
        el.animate([{ transform: 'perspective(1200px) rotateY(0) scale(.9)' }, { transform: 'perspective(1200px) rotateY(360deg) scale(1.16)', offset: 0.72 }, { transform: 'perspective(1200px) rotateY(360deg) scale(1)' }], { duration: 1050, easing: 'cubic-bezier(.2,.7,.2,1)' });
      } else if (t >= 1) {
        el.animate([{ transform: 'scale(.94)' }, { transform: 'scale(1.07)', offset: 0.55 }, { transform: 'scale(1)' }], { duration: 520, easing: EASE });
      }
    }
    if (p.echo && t >= 1) return echoed(p, el);
    if (t === 0) {
      sound.flip();
      glow.classList.remove('is-on');
      return;
    }
    celebrate(p, el);
  }

  function shock(el, color, big) {
    if (!motionOK()) return;
    const c = centerOf(el);
    for (let i = 0; i < (big ? 2 : 1); i++) {
      const ring = h('span.op-shock');
      ring.style.setProperty('--tone', color);
      ring.style.setProperty('left', `${c.x}px`);
      ring.style.setProperty('top', `${c.y}px`);
      fx.append(ring);
      ring.animate([{ opacity: 1, transform: 'translate(-50%, -50%) scale(.4)' }, { opacity: 0, transform: `translate(-50%, -50%) scale(${big ? 9 : 5.5})` }], { duration: big ? 1100 : 800, delay: i * 180, easing: 'cubic-bezier(.1,.7,.3,1)', fill: 'backwards' }).onfinish = () => ring.remove();
    }
  }

  function showBanner(kind, title, sub, small) {
    banner.className = small ? 'op-banner is-small' : 'op-banner';
    banner.replaceChildren(h(`span.op-banner-k.is-${kind}${kind === 'unique' ? '.op-banner--unique' : ''}${kind === 'echo' ? '.op-banner--echo' : ''}`, { text: title }), sub ? h('span.op-banner-s', { text: sub }) : null);
    banner.classList.remove('is-on');
    void banner.offsetWidth;
    banner.classList.add('is-on');
  }

  function celebrate(p, el) {
    const r = p.card.rarity;
    const t = tier(r);
    const c = centerOf(el);
    const run = p.card.run;
    layer.style.setProperty('--tone', TONE[r]);
    sound.reveal(r);
    if (t <= 2) {
      // Rare, Épique : onde de choc, éclat, bannière.
      shock(el, TONE[r], t === 2);
      burst(fx, SPARKS[r], { n: t === 2 ? 44 : 22, x: c.x, y: c.y, spread: t === 2 ? 230 : 150 });
      if (t === 2 && motionOK()) {
        rays.className = 'op-rays is-epique';
        rays.animate([{ opacity: 0 }, { opacity: 0.8 }], { duration: 500, fill: 'forwards' });
        flash.style.setProperty('--flash', TONE[r]);
        flash.animate([{ opacity: 0 }, { opacity: 0.5 }, { opacity: 0 }], { duration: 500 });
      }
      showBanner(r, RLABEL[r], run > 0 && p.serial ? `n° ${p.serial} sur ${run}` : '', true);
      buzz(t === 2 ? [30, 30, 50] : 30);
      return;
    }
    // Légendaire, Unique : l'écran tremble, rayons, éclat blanc, bannière, confettis.
    rays.className = `op-rays is-${r}`;
    if (motionOK()) {
      rays.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 600, fill: 'forwards' });
      dim.animate([{ opacity: getComputedStyle(dim).opacity }, { opacity: 0.55 }], { duration: 600, fill: 'forwards' });
      flash.style.setProperty('--flash', '#FFFFFF');
      flash.animate([{ opacity: 0 }, { opacity: r === 'unique' ? 1 : 0.75 }, { opacity: 0 }], { duration: 750 });
      layer.animate(
        [{ transform: 'none' }, { transform: 'translate(6px, -4px)' }, { transform: 'translate(-7px, 5px)' }, { transform: 'translate(5px, 3px)' }, { transform: 'translate(-3px, -2px)' }, { transform: 'none' }],
        { duration: 420, easing: 'ease-out' },
      );
    }
    shock(el, TONE[r], true);
    showBanner(r, RLABEL[r], r === 'unique' ? 'Seul exemplaire au monde · 1 / 1' : `${run} exemplaires au monde · n° ${p.serial}`);
    burst(fx, SPARKS[r], { n: 80, x: c.x, y: c.y, spread: 320, fall: 140, conf: true });
    setTimeout(() => !closed && burst(fx, SPARKS[r], { n: 40, x: c.x, y: c.y - 40, spread: 260, fall: 180, conf: true }), 380);
    buzz(r === 'unique' ? [60, 40, 60, 40, 140] : [40, 30, 90]);
  }

  // Écho : il s'est chargé comme sa rareté, il se révèle sobrement : une onde, une bannière grise.
  function echoed(p, el) {
    const r = p.card.rarity;
    layer.style.setProperty('--tone', TONE.echo);
    glow.classList.add('is-on');
    showBanner('echo', `${ECHO} · ${RLABEL[r]}`, `${r === 'unique' ? 'Exemplaire unique déjà tiré' : `${p.card.run} exemplaires déjà tirés`} · ne s’échange pas`, true);
    sound.echo();
    buzz(30);
    if (!motionOK()) return;
    const c = centerOf(el);
    for (let i = 0; i < 3; i++) {
      const ring = h('span.op-echo');
      ring.style.setProperty('left', `${c.x}px`);
      ring.style.setProperty('top', `${c.y}px`);
      fx.append(ring);
      ring.animate([{ opacity: 0.9, transform: 'translate(-50%, -50%) scale(.6)' }, { opacity: 0, transform: 'translate(-50%, -50%) scale(4.2)' }], { duration: 1500, delay: 260 * i, easing: 'cubic-bezier(.2,.6,.3,1)', fill: 'backwards' }).onfinish = () => ring.remove();
    }
    burst(fx, SPARKS.echo, { n: 14, x: c.x, y: c.y, spread: 120, fall: 30 });
  }

  function calm() {
    tierLabel.replaceChildren();
    glow.classList.remove('is-on');
    if (!motionOK()) return;
    for (const el of [rays, dim]) {
      const now = getComputedStyle(el).opacity;
      if (Number(now) > 0) el.animate([{ opacity: now }, { opacity: 0 }], { duration: 300, fill: 'forwards' });
    }
  }

  // ---------------------------------------------------------------- 4. récapitulatif
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
      if (e.target.closest?.('button') && e.target !== layer) return; // un bouton du haut a le focus
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
  const line = o.trial ? 'Essai : ces cartes n’entrent dans aucune collection, rien n’est enregistré.' : `Ta collection : ${o.ownedCount()} / ${o.totalCount()} cartes. Les doubles servent aux échanges.${echoNote}`;
  s = sheet('recap', 'Ton tirage', h('div.rc', {}, h('p.tk', { text: o.kicker ?? 'Ton tirage' }), h('h2.rc-h', { text: title }), row, h('p.rc-p', { text: line }), h('div.rc-acts', {}, done, o.trial ? null : coll)));
  if (motionOK()) [...row.children].forEach((c, i) => c.animate([{ opacity: 0, transform: 'translateY(24px) rotate(-3deg)' }, { opacity: 1, transform: 'none' }], { duration: 420, delay: 80 * i, easing: EASE, fill: 'backwards' }));
  return s;
}
