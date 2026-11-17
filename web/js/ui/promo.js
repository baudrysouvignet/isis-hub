// Choix de la classe (FIE1 à FIE5, FIA3 à FIA5) et, selon la classe, du parcours, du groupe et de
// la langue : à la première connexion, puis depuis le compte. Gardé sur l'appareil seulement.

import { $, $$, h } from '../core/dom.js';
import { classes, choicesFor, isComplete, trackLabel, LANGUAGES, classOf } from '../portals/classes.js';

const RULE = {
  groupLanguage: 'Les cours sans groupe indiqué et les événements communs, même facultatifs, sont conservés.',
  fie4: 'Les matières de ton parcours sont incluses. Les TP sans groupe indiqué et les événements communs, même facultatifs, sont conservés.',
  fie5: 'Les matières de ton parcours (maquette FIE5) et les événements communs sont inclus.',
};

export function createPromo({ onChosen }) {
  const screen = $('[data-screen="promo"]');
  const form = $('[data-promo-form]', screen);
  const grid = $('[data-promo-grid]', screen);
  const box = $('[data-promo-choices]', screen);
  const title = $('[data-onb-title]', screen);
  const pill = $('[data-onb-pill]', screen);
  const cta = $('[data-promo-cta]', screen);
  const submit = $('button[type="submit"]', form);
  const tick = () => $('#tpl-promo-tick').content.firstElementChild.cloneNode(true);

  // Une carte par classe, dans l'ordre du fichier de données.
  for (const [key, c] of Object.entries(classes())) {
    grid.append(
      h(
        'label.promo-opt',
        {},
        h('input', { type: 'radio', name: 'promo', value: key }),
        h(
          'span.promo-card',
          {},
          h('span.promo-tick', {}, tick()),
          h('span.promo-num', { text: key.slice(-1), attrs: { 'aria-hidden': 'true' } }),
          h('span.promo-name', { text: key }),
          h('span.promo-sub', { text: c.label }),
        ),
      ),
    );
  }

  const radio = (name, value, label, checked) =>
    h('label.fb-type', {}, h('input', { type: 'radio', name, value: String(value), checked }), h('span', { text: label }));

  const selected = () => $('input[name="promo"]:checked', form)?.value ?? null;

  function current() {
    const promo = selected();
    const v = (name) => $(`input[name="${name}"]:checked`, form)?.value;
    return { promo, choice: { track: v('track'), group: v('group') ? Number(v('group')) : undefined, language: v('language') } };
  }

  function renderChoices(choice = {}) {
    const promo = selected();
    const needed = promo ? choicesFor(promo) : [];
    const c = classOf(promo);
    box.hidden = !needed.length;
    for (const fs of $$('[data-choice]', box)) {
      const kind = fs.dataset.choice;
      fs.hidden = !needed.includes(kind);
      if (fs.hidden) continue;
      const row = $('[data-choice-row]', fs);
      if (kind === 'track') row.replaceChildren(...Object.keys(c.tracks).map((t) => radio('track', t, trackLabel(t), choice.track === t)));
      if (kind === 'group') {
        row.replaceChildren(
          ...[1, 2].map((g) => radio('group', g, c.linkedLanguage ? `Groupe ${g} · ${g === 1 ? 'Chinois' : 'Espagnol'}` : `Groupe ${g}`, choice.group === g)),
        );
      }
      if (kind === 'language') row.replaceChildren(...Object.entries(LANGUAGES).map(([k, l]) => radio('language', k, l, choice.language === k)));
    }
    $('[data-choice-rule]', box).textContent = RULE[c?.filter] ?? '';
    update();
  }

  function update() {
    const { promo, choice } = current();
    submit.disabled = !promo || !isComplete(promo, choice);
  }

  form.addEventListener('change', (e) => {
    if (e.target.name === 'promo') renderChoices();
    else update();
  });
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const { promo, choice } = current();
    if (promo && isComplete(promo, choice)) onChosen(promo, choice);
  });

  return {
    /** mode : 'first' (première connexion), 'guest' (sans connexion) ou 'change'. */
    show({ mode, current: promo, choice = {}, firstName }) {
      const r = $(`input[name="promo"][value="${promo ?? 'FIA4'}"]`, form);
      if (r) r.checked = true;
      renderChoices(promo ? choice : {});
      title.textContent =
        mode === 'change' ? 'Ta classe et tes options ?' : firstName ? `Bienvenue ${firstName}, quelle est ta classe ?` : 'Quelle est ta classe ?';
      pill.textContent = mode === 'first' ? 'Connecté · première visite' : mode === 'guest' ? 'Sans connexion' : 'Changer de classe';
      cta.textContent = mode === 'change' ? 'Enregistrer' : 'Accéder à mon tableau de bord';
      setTimeout(() => $('input[name="promo"]:checked', form)?.focus({ preventScroll: true }), 60);
    },
  };
}
