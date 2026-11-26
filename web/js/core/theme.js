// Thème de l'interface : « auto » (suit le réglage clair / sombre du téléphone ou de l'ordinateur),
// « light » ou « dark ». Le choix est gardé sur cet appareil (préférences locales), rien n'est envoyé.
// Sans choix, index.html porte data-theme="auto" : la feuille de style suit le système dès le premier
// affichage (prefers-color-scheme), sans attendre ce script, donc sans éclair blanc.

import { prefs } from './store.js';

const KEY = 'theme';
const THEMES = ['auto', 'light', 'dark'];
const mq = typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: dark)') : null;

/** Couleur de la barre du navigateur (meta theme-color) : celle du fond du Hub. */
const BAR = { light: '#F5F4F0', dark: '#111416' };

export const themeOf = () => {
  const t = prefs.get(KEY, 'auto');
  return THEMES.includes(t) ? t : 'auto';
};

/** Le Hub s'affiche-t-il en sombre en ce moment ? */
export const isDark = () => {
  const t = themeOf();
  return t === 'dark' || (t === 'auto' && Boolean(mq?.matches));
};

/** Couleur de la barre du navigateur pour le Hub (le TCG garde la sienne). */
export const hubBarColor = () => (isDark() ? BAR.dark : BAR.light);

let onChange = [];
/** Appelé à chaque changement effectif (choix, ou passage du système en sombre). */
export const onThemeChange = (fn) => onChange.push(fn);

export function applyTheme(t = themeOf()) {
  for (const app of document.querySelectorAll('.app')) app.dataset.theme = t;
  const bar = document.querySelector('meta[name="theme-color"]');
  // En mode TCG, la barre est celle du jeu (app.js) : on n'y touche pas.
  if (bar && !document.querySelector('.app.is-tcg')) bar.setAttribute('content', hubBarColor());
  onChange.forEach((fn) => fn(t));
}

export function setTheme(t) {
  if (!THEMES.includes(t)) return;
  prefs.set(KEY, t);
  applyTheme(t);
}

mq?.addEventListener?.('change', () => themeOf() === 'auto' && applyTheme());
