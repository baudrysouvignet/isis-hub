// Menu du midi du Resto U' de Castres (bloc 12 h 30 – 13 h 30 de l'emploi du temps).
// Le serveur d'ISIS Hub lit le menu public (Croustillant, sinon le site du CROUS) et le garde
// 12 heures : la page ne contacte aucun site tiers et n'envoie rien de personnel.

import { $, h } from '../core/dom.js';
import * as D from '../core/dates.js';
import { modal } from './layout.js';

let pending = null;
let loadedAt = 0;
let known = null; // dernier résultat reçu : { days: { « AAAA-MM-JJ » : [...] } }

/** Menu publié pour ce jour ? true / false, ou null tant que la réponse n'est pas arrivée. */
export const hasMenu = (day) => (known ? Boolean(known.days?.[day]?.length) : null);

/** Charge les menus (au plus toutes les 30 minutes) ; rend la promesse de la réponse. */
export function menus() {
  if (!pending || Date.now() - loadedAt > 30 * 60_000) {
    loadedAt = Date.now();
    pending = fetch('api/crous', { credentials: 'omit' })
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null)
      .then((m) => {
        if (!m) pending = null; // échec : on réessaiera à la prochaine ouverture
        else known = m;
        return m;
      });
  }
  return pending;
}

export function createCrousSheet() {
  const dialog = $('dialog[data-crous]');
  const sheet = modal(dialog);
  const body = $('[data-crous-body]', dialog);
  let token = 0;

  async function open(day) {
    const t = ++token;
    $('[data-crous-title]', dialog).textContent = `Menu du ${D.dayTitle(day).replace(/^\p{L}/u, (c) => c.toLowerCase())}`;
    body.replaceChildren(h('p.cs-none', {}, h('span.spinner'), ' Lecture du menu…'));
    sheet.open();
    const m = await menus();
    if (t !== token) return;
    const cats = m?.days?.[day];
    if (!cats?.length) {
      body.replaceChildren(
        h(
          'div.crous-empty',
          {},
          h('b', { text: 'Menu non publié' }),
          h('span', { text: m ? 'Le CROUS n’a pas encore mis en ligne le menu de ce jour (il le publie en général le jour même).' : 'Le menu est indisponible pour le moment. Réessaie un peu plus tard.' }),
        ),
      );
      return;
    }
    body.replaceChildren(
      ...cats.map((c) => h('section.crous-cat', {}, h('h3', { text: c.name }), h('ul', {}, ...c.dishes.map((d) => h('li', { text: d }))))),
      h('p.crous-source', { text: `Source : ${m.source} · menu public du Resto U’ de Castres, susceptible de changer sur place.` }),
    );
  }

  return { open };
}
