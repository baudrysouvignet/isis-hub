// ISIS · TCG : briques d'interface partagées (carte, raretés, feuilles, icônes, dates).
// Même balisage que la maquette v9 (classes tc-*, tsh-*, trchip…). Aucun innerHTML : tout est
// construit nœud par nœud, le texte des cartes (écrit par les étudiants) n'est jamais du HTML.

import { h, motionOK, lockScroll } from '../core/dom.js';

export const RARITIES = ['commune', 'rare', 'epique', 'legendaire', 'unique'];
export const RLABEL = { commune: 'Commune', rare: 'Rare', epique: 'Épique', legendaire: 'Légendaire', unique: 'Unique' };
export const CATS = { meme: 'Mème', moment: 'Moment', lieu: 'Lieu', truc: 'Truc' };
export const tier = (r) => Math.max(0, RARITIES.indexOf(r));

const NS = 'http://www.w3.org/2000/svg';

// ------------------------------------------------------------------ icônes (tracés de la maquette)
const ICONS = {
  booster: ['M6 4.5h12l-1 3 1 3v8a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 6 18.5v-8l1-3z', 'M6 10.5h12M10 14.5l2-2 2 2-2 2z'],
  collection: [['rect', 7.5, 3.5, 12, 16, 2.5], 'M4.5 7.5v11a2.5 2.5 0 0 0 2.5 2.5h8.5'],
  plus: ['M12 5v14M5 12h14'],
  pen: ['M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16z', 'M13.5 6.5l4 4'],
  jury: ['M4 20.5h16M6 16.5h12v4H6zM9 12.5l2.5 2.5L17 9.5', 'M8 16.5V5a1.5 1.5 0 0 1 1.5-1.5h7A1.5 1.5 0 0 1 18 5v11.5'],
  trade: ['M4 8h14M14.5 4.5L18 8l-3.5 3.5M20 16H6M9.5 12.5L6 16l3.5 3.5'],
  chev: ['M9.5 6l6 6-6 6'],
  info: ['M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z', 'M12 11v5M12 8v.01'],
  lock: ['M8 10.5h8a3 3 0 0 1 3 3v4a3 3 0 0 1-3 3H8a3 3 0 0 1-3-3v-4a3 3 0 0 1 3-3z', 'M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5'],
  cards: ['M7.5 3.5h9.5a2.5 2.5 0 0 1 2.5 2.5v11a2.5 2.5 0 0 1-2.5 2.5H7.5A2.5 2.5 0 0 1 5 17V6a2.5 2.5 0 0 1 2.5-2.5z', 'M2.5 7.5v11a2.5 2.5 0 0 0 2.5 2.5h9'],
  person: ['M15 8.5a3 3 0 1 1-6 0 3 3 0 0 1 6 0z', 'M5.5 19a6.5 6.5 0 0 1 13 0'],
  check: ['M5 12.5l4.5 4.5L19 7.5'],
  loop: ['M19 12a7 7 0 1 1-2.1-5', 'M19 4v4h-4'],
  photo: ['M4 5.5h16v13H4z', 'M4 15l4.5-4.5 4 4 2.5-2.5L20 17M15.5 9.5h.01'],
  send: ['M4 12l16-8-6 16-2.5-6.5z', 'M11.5 13.5L20 4'],
  clock: ['M20.5 12a8.5 8.5 0 1 1-17 0 8.5 8.5 0 0 1 17 0z', 'M12 7.5V12l3 2'],
  x: ['M6.5 6.5l11 11M17.5 6.5l-11 11'],
  flag: ['M5 21V4.5M5 4.5h11l-2 4 2 4H5'],
  qr: ['M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4z', 'M14 14h2v2h-2zM18 14h2M14 18h2M18 18h2v2'],
  arrow: ['M5 12h14M13 6l6 6-6 6'],
  camera: ['M4 8a2 2 0 0 1 2-2h2l1.5-2h5L16 6h2a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z', 'M15.5 12.5a3.5 3.5 0 1 1-7 0 3.5 3.5 0 0 1 7 0z'],
  copy: ['M9 9h10v10H9z', 'M5 15V5h10'],
  hand: ['M8 13V6.5a1.5 1.5 0 0 1 3 0V12M11 11V5a1.5 1.5 0 0 1 3 0v6M14 11V6.5a1.5 1.5 0 0 1 3 0V14a6 6 0 0 1-6 6h-.5a5 5 0 0 1-4-2L4 14.5a1.5 1.5 0 0 1 2.3-2L8 14'],
  eye: ['M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z', 'M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0z'],
  heart: ['M12 20s-7.5-4.6-7.5-10.2A4.3 4.3 0 0 1 12 7.2a4.3 4.3 0 0 1 7.5 2.6C19.5 15.4 12 20 12 20z'],
  grip: ['M9 6h.01M15 6h.01M9 12h.01M15 12h.01M9 18h.01M15 18h.01'],
  up: ['M12 19V5M6 11l6-6 6 6'],
  down: ['M12 5v14M6 13l6 6 6-6'],
  alert: ['M12 4.5l8.5 15h-17z', 'M12 10v4M12 16.8v.1'],
  back: ['M14.5 6l-6 6 6 6'],
  spark: ['M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5L18 18M6 18l2.5-2.5M15.5 8.5L18 6'],
  trash: ['M4.5 7h15M9.5 7V5a1.5 1.5 0 0 1 1.5-1.5h2A1.5 1.5 0 0 1 14.5 5v2M6.5 7l1 12.5a2 2 0 0 0 2 1.5h5a2 2 0 0 0 2-1.5l1-12.5'],
  logout: ['M14.5 4H18a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3.5M10 8l-4 4 4 4M6 12h10'],
};

/** Icône de la maquette (grille 24 × 24, trait géré par la feuille de style). */
export function ic(name, cls = 'ic ic--sm') {
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('class', cls);
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  for (const part of ICONS[name] ?? []) {
    if (Array.isArray(part)) {
      const r = document.createElementNS(NS, 'rect');
      ['x', 'y', 'width', 'height', 'rx'].forEach((k, i) => r.setAttribute(k, part[i + 1]));
      svg.append(r);
    } else {
      const p = document.createElementNS(NS, 'path');
      p.setAttribute('d', part);
      svg.append(p);
    }
  }
  return svg;
}

// Marque ISIS (75 × 88), reprise du logo de l'en-tête plutôt que recopiée.
let markPath = null;
export function mark(cls) {
  markPath ??= document.querySelector('.isis-mark path')?.getAttribute('d') ?? 'M37 4 70 84H4z';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 75 88');
  svg.setAttribute('class', cls);
  svg.setAttribute('aria-hidden', 'true');
  const p = document.createElementNS(NS, 'path');
  p.setAttribute('d', markPath);
  svg.append(p);
  return svg;
}

// ------------------------------------------------------------------ raretés
const PIP = {
  diamond: 'M12 2.5l7 9.5-7 9.5-7-9.5z',
  star: 'M12 2.5l2.7 6.3 6.8.6-5.2 4.5 1.6 6.6L12 17l-5.9 3.5 1.6-6.6L2.5 9.4l6.8-.6z',
  crown: 'M3.5 8l4.5 3.5L12 5l4 6.5L20.5 8 19 18.5H5zM5 20.5h14',
};
const PIPS = { commune: ['diamond'], rare: ['diamond', 'diamond'], epique: ['diamond', 'diamond', 'diamond'], legendaire: ['star'], unique: ['crown'] };

function pip(kind) {
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('class', 'pip');
  const p = document.createElementNS(NS, 'path');
  p.setAttribute('d', PIP[kind]);
  svg.append(p);
  return svg;
}

/** Pastilles de rareté (◆, ◆◆, ◆◆◆, ★, couronne). */
export const pips = (rarity, cls) => h(`span.${cls}`, { attrs: { role: 'img', 'aria-label': RLABEL[rarity] } }, ...(PIPS[rarity] ?? []).map(pip));

/** Pastille « Légendaire » colorée. */
export const rchip = (rarity) => h(`span.trchip.trchip--${rarity}`, {}, pips(rarity, 'trchip-pips'), h('span', { text: RLABEL[rarity] }));

// ------------------------------------------------------------------ images

const pad3 = (n) => String(n).padStart(3, '0');

/** Illustration de remplacement (pas de photo, carte retirée, brouillon). */
export function placeholderArt(seed = '', label = '') {
  let x = 0;
  for (const ch of String(seed)) x = (x * 31 + ch.charCodeAt(0)) >>> 0;
  const palettes = [
    ['#1C8FA0', '#6B4BD6'],
    ['#0B6E7F', '#4CC3D3'],
    ['#6B4BD6', '#FF7A59'],
    ['#123A45', '#A98BFF'],
    ['#B24A6B', '#F5C451'],
  ];
  const [a, b] = palettes[x % palettes.length];
  const txt = label ? `<text x="200" y="164" font-family="Inter,system-ui,sans-serif" font-size="26" font-weight="700" fill="#ffffff" fill-opacity=".82" text-anchor="middle">${label.replace(/[<>&"]/g, '')}</text>` : '';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 300" preserveAspectRatio="xMidYMid slice"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient><radialGradient id="r" cx=".75" cy=".2" r=".7"><stop offset="0" stop-color="#fff" stop-opacity=".35"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient></defs><rect width="400" height="300" fill="url(#g)"/><rect width="400" height="300" fill="url(#r)"/><circle cx="${60 + (x % 280)}" cy="${40 + (x % 200)}" r="${30 + (x % 50)}" fill="#fff" fill-opacity=".08"/>${txt}</svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

// ------------------------------------------------------------------ la carte

/**
 * Carte du jeu, balisage de la maquette.
 * card : { id, title, desc, cat, img, thumb, author, wave, no, total, rarity, run, removed }
 * o : { size: sm|md|lg|xl, serial, back, live, mystery, isNew, count, by, foot, artSrc }
 */
export function cardEl(card, o = {}) {
  const rarity = o.mystery ? 'mystery' : card.rarity || 'commune';
  const label = o.mystery ? card.title || 'Carte' : `${card.title}, ${RLABEL[rarity]}`;
  const el = h(`article.tc.tc--${rarity}.tc--${o.size || 'md'}`, { data: { card: card.id || '' }, attrs: { 'aria-label': label } });
  if (o.back) el.classList.add('is-back');
  if (o.live) el.classList.add('is-live');

  const head = h('header.tc-head', {}, h('h3.tc-title', { text: card.title || '' }));
  head.append(o.mystery ? h('span.tc-pips', { attrs: { 'aria-label': 'Rareté inconnue' } }, h('b.pip-q', { text: '?' })) : pips(rarity, 'tc-pips'));

  const img = h('img', { alt: '', decoding: 'async', draggable: false });
  const big = o.size === 'lg' || o.size === 'xl';
  img.src = o.artSrc || (card.removed ? placeholderArt(card.id, card.consentOff ? 'Accord retiré' : 'Carte retirée') : (big ? card.img || card.thumb : card.thumb || card.img) || placeholderArt(card.id || card.title));
  const art = h('div.tc-art', {}, img, card.cat ? h('span.tc-cat', { text: CATS[card.cat] ?? card.cat }) : null, h('span.tc-shine'));

  const by = o.by ?? (card.author ? `Proposée par ${card.author}` : '');
  const body = h('div.tc-body', {}, h('p.tc-desc', { text: card.desc || '' }), by ? h('p.tc-by', { text: by }) : null);

  let foot;
  if (o.mystery) foot = h('footer.tc-foot', {}, h('span', { text: o.foot ?? 'Rareté révélée à l’impression' }));
  else {
    const left = card.no ? `#${pad3(card.no)}/${pad3(card.total || card.no)} · V${card.wave}` : '';
    const serial = card.run > 0 ? `${o.serial || '?'}/${card.run}` : RLABEL[rarity];
    foot = h('footer.tc-foot', {}, h('span', { text: left }), h('span.tc-serial', { text: serial }));
  }

  const front = h('div.tc-face.tc-front', {}, h('div.tc-frame', {}, head, art, body, foot), h('span.tc-holo'), h('span.tc-glare'));
  const back = h('div.tc-face.tc-back', {}, h('span.tc-back-ring'), mark('tc-back-mark'), h('span.tc-back-txt', { text: 'ISIS · TCG' }));
  el.append(h('div.tc-tilt', {}, h('div.tc-inner', {}, front, back)));
  if (o.isNew) el.append(h('span.tc-new', { text: 'Nouvelle' }));
  if (o.count > 1) el.append(h('span.tc-count', { text: `×${o.count}` }));
  if (o.live) attachTilt(el);
  return el;
}

/** Reflet et inclinaison qui suivent le pointeur (souris, doigt). */
export function attachTilt(el) {
  if (!motionOK()) return;
  const move = (e) => {
    const r = el.getBoundingClientRect();
    if (!r.width) return;
    const x = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
    const y = Math.min(1, Math.max(0, (e.clientY - r.top) / r.height));
    el.classList.add('is-hover');
    el.style.setProperty('--mx', `${(x * 100).toFixed(1)}%`);
    el.style.setProperty('--my', `${(y * 100).toFixed(1)}%`);
    el.style.setProperty('--rx', `${((0.5 - y) * 16).toFixed(2)}deg`);
    el.style.setProperty('--ry', `${((x - 0.5) * 20).toFixed(2)}deg`);
  };
  const leave = () => {
    el.classList.remove('is-hover');
    for (const k of ['--mx', '--my', '--rx', '--ry']) el.style.removeProperty(k);
  };
  el.addEventListener('pointermove', move);
  el.addEventListener('pointerleave', leave);
  el.addEventListener('pointercancel', leave);
}

/** Emplacement d'une carte manquante : numéro et rareté seulement. */
export function ghostEl(card, wished) {
  const el = h(`button.tc-ghost.tc-ghost--${card.rarity}.tco-cell`, { type: 'button', data: { ghost: card.id }, attrs: { 'aria-label': `Carte ${card.no}, ${RLABEL[card.rarity]}, pas encore dans ta collection` } });
  el.append(mark('tc-ghost-mark'), h('span.tc-ghost-n', { text: `#${pad3(card.no)}` }), pips(card.rarity, 'tc-ghost-pips'));
  if (wished) el.append(h('span.tc-ghost-wish', { attrs: { 'aria-label': 'Je cherche' } }, ic('heart', 'ic ic--xs')));
  return el;
}

// ------------------------------------------------------------------ boutons, compteurs

export function tbtn(text, icon, cls = '', on) {
  const b = h(`button.tbtn${cls ? '.' + cls.split(' ').join('.') : ''}`, { type: 'button' }, icon ? ic(icon) : null, h('span', { text }));
  if (on) b.addEventListener('click', on);
  return b;
}

/** Jauge (largeur en %), sans attribut style : CSSOM seulement. */
export function meter(n, total, label, cls = '') {
  const pct = total ? Math.round((n / total) * 100) : 0;
  const bar = h('i');
  bar.style.setProperty('--pw', `${pct}%`);
  return h(`div.th-meter${cls ? '.' + cls : ''}`, { attrs: { role: 'img', 'aria-label': `${n} / ${total}` } }, h('span.th-meter-bar', {}, bar), label ? h('span.th-meter-l', { text: label }) : null);
}

export function quota(left, max) {
  const q = h('span.quota', { attrs: { 'aria-label': `${left} sur ${max} restantes` } });
  for (let i = 0; i < max; i++) q.append(h(`i${i < left ? '.is-on' : ''}`));
  return q;
}

// ------------------------------------------------------------------ feuilles (fenêtres du jeu)

const openSheets = [];
export const sheetOpen = () => openSheets.length > 0;

/**
 * Feuille modale du jeu (tsh-layer). Échap, le fond ou ✕ la ferment.
 * Rend { layer, box, close } ; onClose est appelé une fois.
 */
export function sheet(kind, label, content, { onClose, root = document.querySelector('.app') } = {}) {
  const back = document.activeElement;
  const box = h('div.tsh', { attrs: { role: 'dialog', 'aria-modal': 'true', 'aria-label': label } });
  const x = h('button.tsh-x', { type: 'button', attrs: { 'aria-label': 'Fermer' } }, ic('x'));
  box.append(x, ...[content].flat().filter(Boolean));
  const scrim = h('div.tsh-scrim');
  const layer = h(`div.tsh-layer.tsh--${kind}`, {}, scrim, box);
  let closed = false;
  const s = {
    layer,
    box,
    close() {
      if (closed) return;
      closed = true;
      openSheets.splice(openSheets.indexOf(s), 1);
      document.removeEventListener('keydown', onKey, true);
      if (!openSheets.length) lockScroll(false);
      const done = () => layer.remove();
      if (motionOK()) layer.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 180, easing: 'ease-out' }).onfinish = done;
      else done();
      onClose?.();
      back?.focus?.({ preventScroll: true });
    },
  };
  const onKey = (e) => {
    if (e.key === 'Escape' && openSheets[openSheets.length - 1] === s) {
      e.stopPropagation();
      e.preventDefault();
      s.close();
    }
  };
  x.addEventListener('click', s.close);
  scrim.addEventListener('click', s.close);
  document.addEventListener('keydown', onKey, true);
  root.append(layer);
  openSheets.push(s);
  lockScroll(true);
  if (motionOK()) {
    scrim.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 220 });
    box.animate([{ opacity: 0, transform: 'translateY(18px) scale(.98)' }, { opacity: 1, transform: 'none' }], { duration: 320, easing: 'cubic-bezier(.2,.8,.2,1)' });
  }
  requestAnimationFrame(() => (box.querySelector('[autofocus]') || x).focus({ preventScroll: true }));
  return s;
}

// ------------------------------------------------------------------ dates (heure de Paris)

const TZ = 'Europe/Paris';
const fDay = new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: TZ });
const fDate = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long', timeZone: TZ });
const fShort = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', timeZone: TZ });
const fHour = new Intl.DateTimeFormat('fr-FR', { hour: 'numeric', minute: '2-digit', timeZone: TZ });

export const dayLong = (d) => fDay.format(new Date(d)); // « lundi 7 décembre »
export const dateLong = (d) => fDate.format(new Date(d)); // « 7 décembre »
export const dateShort = (d) => fShort.format(new Date(d)); // « 7 déc. »
/** « 6 h », « 20 h », « 18 h 30 ». */
export function hourText(d) {
  const [hh, mm] = fHour.format(new Date(d)).split(':');
  return mm === '00' ? `${Number(hh)} h` : `${Number(hh)} h ${mm}`;
}

/** « à l'instant », « il y a 40 min », « il y a 2 h », « il y a 3 j ». */
export function ago(d, now = Date.now()) {
  const s = Math.max(0, (now - new Date(d).getTime()) / 1000);
  if (s < 60) return 'à l’instant';
  if (s < 3600) return `il y a ${Math.floor(s / 60)} min`;
  if (s < 86400) return `il y a ${Math.floor(s / 3600)} h`;
  return `il y a ${Math.floor(s / 86400)} j`;
}

/** Durée restante : « 11 h 57 », « 42 min », « 3 j ». */
export function untilText(d, now = Date.now()) {
  const s = Math.max(0, (new Date(d).getTime() - now) / 1000);
  if (s >= 2 * 86400) return `${Math.floor(s / 86400)} j`;
  if (s >= 3600) return `${Math.floor(s / 3600)} h ${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}`;
  return `${Math.max(1, Math.ceil(s / 60))} min`;
}

export const plural = (n, one, many = `${one}s`) => `${n} ${n > 1 ? many : one}`;
