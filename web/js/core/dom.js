// Petits outils DOM. Aucun innerHTML : tout est construit nœud par nœud, le texte venant des
// portails n'est jamais interprété comme du HTML. Les styles dynamiques passent par le CSSOM,
// que la politique de sécurité (CSP) autorise, et jamais par un attribut style.

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

const reduceMQ = matchMedia('(prefers-reduced-motion: reduce)');
export const motionOK = () => !reduceMQ.matches;
export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
export const EASE = 'cubic-bezier(.2,.8,.2,1)';
export const EASE_IO = 'cubic-bezier(.65,0,.35,1)';

/**
 * h('a.btn.btn--sm', { href, data: { x: 1 }, on: { click }, attrs: { 'aria-label': '…' } }, enfants…)
 * Les enfants falsy sont ignorés ; les chaînes deviennent des nœuds texte.
 */
export function h(spec, props = {}, ...children) {
  const [tag, ...classes] = spec.split('.');
  const el = document.createElement(tag || 'div');
  if (classes.length) el.className = classes.join(' ');
  for (const [key, value] of Object.entries(props ?? {})) {
    if (value === undefined || value === null || value === false) continue;
    if (key === 'class') el.className = [el.className, value].filter(Boolean).join(' ');
    else if (key === 'text') el.textContent = value;
    else if (key === 'data') for (const [k, v] of Object.entries(value)) el.dataset[k] = v;
    else if (key === 'attrs') for (const [k, v] of Object.entries(value)) v != null && el.setAttribute(k, v);
    else if (key === 'on') for (const [k, v] of Object.entries(value)) el.addEventListener(k, v);
    else if (key === 'style') for (const [k, v] of Object.entries(value)) el.style.setProperty(k, v);
    else if (key in el) el[key] = value;
    else el.setAttribute(key, value);
  }
  el.append(...children.flat().filter((c) => c !== null && c !== undefined && c !== false));
  return el;
}

export function restartClass(el, cls) {
  el.classList.remove(cls);
  void el.offsetWidth;
  el.classList.add(cls);
}

/** Découpe (clip-path) qui part du rectangle `from` à l'intérieur de `to`. */
export function clipFrom(from, to, r = 16) {
  const t = Math.max(0, from.top - to.top);
  const l = Math.max(0, from.left - to.left);
  const b = Math.max(0, to.bottom - from.bottom);
  const rr = Math.max(0, to.right - from.right);
  return `inset(${t}px ${rr}px ${b}px ${l}px round ${r}px)`;
}

export const lockScroll = (on) => document.documentElement.style.setProperty('overflow', on ? 'hidden' : '');

export const isTyping = (el) => el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));

// ------------------------------------------------------------------ icônes
// Mêmes tracés que la maquette (grille 24 × 24, trait géré par la feuille de style).
const ICONS = {
  book: [['path', 'M5 18.5V5.5A2.5 2.5 0 0 1 7.5 3H19v14H7.5A2.5 2.5 0 0 0 5 19.5 2.5 2.5 0 0 0 7.5 22H19'], ['path', 'M9 7.5h6']],
  ext: [['path', 'M7.5 16.5l9-9M9 7.5h7.5V15']],
  pin: [['path', 'M12 21s-6.5-5.7-6.5-11a6.5 6.5 0 0 1 13 0c0 5.3-6.5 11-6.5 11z'], ['circle', 12, 10, 2.4]],
  user: [['circle', 12, 8.5, 3.5], ['path', 'M5 20a7 7 0 0 1 14 0']],
  alert: [['path', 'M12 4.5l8.5 15h-17z'], ['path', 'M12 10v4M12 16.8v.1']],
  lock: [['rect', 5, 10.5, 14, 10, 3], ['path', 'M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5']],
  offline: [['path', 'M3.5 3.5l17 17M8.7 8.8A5 5 0 0 0 7 18.5h10.5M11.2 6.1A6 6 0 0 1 18 11a4 4 0 0 1 2.7 6.4']],
  inbox: [['path', 'M3 13l3-8h12l3 8v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z'], ['path', 'M3 13h5l1.5 2.5h5L16 13h5']],
  coffee: [['path', 'M4.5 9.5h11v4.5a5 5 0 0 1-5 5h-1a5 5 0 0 1-5-5z'], ['path', 'M15.5 11h1.5a2.5 2.5 0 0 1 0 5h-1.5M8 3.5v2.5M12 3.5v2.5']],
  sun: [['circle', 12, 12, 4], ['path', 'M12 2.5v2M12 19.5v2M4.6 4.6l1.4 1.4M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4L6 18M18 6l1.4-1.4']],
  briefcase: [['rect', 3, 7, 18, 13, 3], ['path', 'M8.5 7V5.5a2 2 0 0 1 2-2h3a2 2 0 0 1 2 2V7M3 12.5h18']],
  clock: [['circle', 12, 12, 8.5], ['path', 'M12 7.5V12l3 2']],
  check: [['path', 'M5 12.5l4.5 4.5L19 7.5']],
  x: [['path', 'M6.5 6.5l11 11M17.5 6.5l-11 11']],
  retry: [['path', 'M19.5 12a7.5 7.5 0 1 1-2.2-5.3M19.5 4.5v4h-4']],
  eye: [['path', 'M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z'], ['path', 'M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0z']],
  eyeOff: [['path', 'M3.5 3.5l17 17M10.4 5.7c.5-.1 1-.2 1.6-.2 6 0 9.5 6.5 9.5 6.5a16 16 0 0 1-2.9 3.7M6.7 6.8A16 16 0 0 0 2.5 12S6 18.5 12 18.5c1.6 0 3-.4 4.2-1M9.9 9.9a3 3 0 0 0 4.2 4.2']],
  chevRight: [['path', 'M9.5 6l6 6-6 6']],
  search: [['path', 'M17.5 11a6.5 6.5 0 1 1-13 0 6.5 6.5 0 0 1 13 0z'], ['path', 'M16 16l4.5 4.5']],
  image: [['rect', 3.5, 4.5, 17, 15, 3], ['circle', 9, 10, 1.8], ['path', 'M20.5 15.5l-5-5-9 9']],
  clip: [['path', 'M20 11.5l-8 8a5 5 0 0 1-7-7l8.5-8.5a3.3 3.3 0 0 1 4.7 4.7l-8.4 8.4a1.7 1.7 0 0 1-2.4-2.4l7.6-7.6']],
  tag: [['path', 'M3.5 12.2V4.5a1 1 0 0 1 1-1h7.7l8.3 8.3a1.5 1.5 0 0 1 0 2.1l-6.4 6.4a1.5 1.5 0 0 1-2.1 0z'], ['circle', 8, 8, 1.5]],
  trash: [['path', 'M4.5 7h15M9.5 7V5a1.5 1.5 0 0 1 1.5-1.5h2A1.5 1.5 0 0 1 14.5 5v2M6.5 7l1 12.5a2 2 0 0 0 2 1.5h5a2 2 0 0 0 2-1.5l1-12.5']],
  download: [['path', 'M12 4v11M7 10.5l5 5 5-5M5 20h14']],
  restore: [['path', 'M4.5 12a7.5 7.5 0 1 0 2.2-5.3M4.5 4.5v4h4']],
  plus: [['path', 'M12 5v14M5 12h14']],
  send: [['path', 'M4 12l16-8-6 16-2.5-6.5z']],
};

const NS = 'http://www.w3.org/2000/svg';
export function icon(name, cls = 'ic') {
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('class', cls);
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  for (const [kind, ...a] of ICONS[name]) {
    const el = document.createElementNS(NS, kind);
    if (kind === 'path') el.setAttribute('d', a[0]);
    else if (kind === 'circle') ['cx', 'cy', 'r'].forEach((k, i) => el.setAttribute(k, a[i]));
    else ['x', 'y', 'width', 'height', 'rx'].forEach((k, i) => el.setAttribute(k, a[i]));
    svg.append(el);
  }
  return svg;
}

/** Message bref en bas d'écran (erreurs non bloquantes). */
let toastTimer;
export function toast(message, iconName) {
  const el = $('[data-toast]');
  if (!el) return;
  el.replaceChildren(iconName ? icon(iconName, 'ic ic--sm') : '', message);
  el.hidden = false;
  restartClass(el, 'is-in');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.hidden = true), 5000);
}
