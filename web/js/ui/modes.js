// Rubriques de l'en-tête : Hub et Stages sont deux onglets de la bascule (même produit, même compte,
// le contenu change sur place) ; TCG est un lien à part, à droite (une autre appli d'ISIS). Une seule
// rubrique est visible à la fois.
//
// La bascule n'apparaît que si elle sert : rubrique Stages ouverte, ou jeu ouvert (l'onglet Hub est
// alors le chemin du retour). Ni elle ni le lien TCG ne sont posés par-dessus le reste de l'en-tête :
// tout est dans le flux (hub.css, « En-tête »), rien ne passe sous rien, tout reste cliquable.

import { $ } from '../core/dom.js';
import { hubBarColor } from '../core/theme.js';

/**
 * Chaque rubrique s'enregistre : { el, color?(), transition?(apply, {from, to}), onEnter?(from),
 * onLeave?(to) }. `transition` (le cercle du TCG) enveloppe le changement d'affichage.
 */
export function createModes({ app }) {
  const sw = $('[data-mode-sw]');
  const tabs = { hub: $('#tab-hub'), stages: $('#tab-stg') };
  const theme = $('meta[name="theme-color"]');
  const panels = { hub: { el: $('#contenu') } };
  const opener = {}; // onglet → action (Stages : vérifier la session avant d'ouvrir)
  let current = 'hub';

  const shownTabs = () => Object.keys(tabs).filter((k) => !tabs[k].hidden);

  function sync() {
    const names = shownTabs();
    sw.hidden = !(names.length > 1 || current === 'tcg');
    const at = names.indexOf(current);
    sw.style.setProperty('--tabs', String(names.length));
    sw.style.setProperty('--at', String(Math.max(0, at)));
    sw.classList.toggle('is-none', at < 0); // dans le jeu : aucun onglet choisi
    for (const [k, t] of Object.entries(tabs)) {
      t.setAttribute('aria-selected', String(k === current));
      t.tabIndex = k === current || (at < 0 && k === 'hub') ? 0 : -1;
    }
  }

  function set(name) {
    if (!panels[name] || name === current) return;
    const from = current;
    const leaving = panels[from];
    const entering = panels[name];
    const apply = () => {
      current = name;
      for (const [k, p] of Object.entries(panels)) if (p.el) p.el.hidden = k !== name;
      app.classList.toggle('is-tcg', name === 'tcg');
      app.classList.toggle('is-stg', name === 'stages');
      theme?.setAttribute('content', entering.color?.() ?? hubBarColor());
      sync();
      leaving.onLeave?.(name);
      entering.onEnter?.(from);
      window.scrollTo(0, 0);
    };
    const transition = entering.transition ?? leaving.transition;
    if (transition) transition(apply, { from, to: name });
    else apply();
  }

  const go = (name) => (opener[name] ? opener[name]() : set(name));
  tabs.hub.addEventListener('click', () => set('hub'));
  tabs.stages.addEventListener('click', () => go('stages'));
  sw.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    const names = shownTabs();
    if (names.length < 2) return;
    e.preventDefault();
    const at = Math.max(0, names.indexOf(current));
    const next = names[(at + (e.key === 'ArrowRight' ? 1 : names.length - 1)) % names.length];
    tabs[next].focus();
    go(next);
  });

  sync();
  return {
    register(name, conf) {
      panels[name] = conf;
    },
    /** Action d'un onglet (au lieu d'afficher directement la rubrique). */
    onTab(name, fn) {
      opener[name] = fn;
    },
    set,
    current: () => current,
    /** Onglet Stages visible ou non (rubrique ouverte par l'administration). */
    setTab(name, on) {
      if (!tabs[name]) return;
      tabs[name].hidden = !on;
      if (!on && current === name) set('hub');
      sync();
    },
    tabRect: (name) => (tabs[name] && !tabs[name].hidden && !sw.hidden ? tabs[name].getBoundingClientRect() : null),
    sync,
  };
}
