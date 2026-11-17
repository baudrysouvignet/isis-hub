// Raccourcis publiés par l'administrateur (GET api/content).
// Ce contenu est public et ne dépend pas de l'étudiant : aucune donnée personnelle n'est envoyée.

import { $, $$, h } from '../core/dom.js';

const tpl = (id) => $(`#${id}`).content.firstElementChild.cloneNode(true);

export async function fetchContent() {
  try {
    const res = await fetch('api/content', { cache: 'no-cache', credentials: 'omit' });
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
}

/** Remplit la tuile Raccourcis et le menu Affichage. Rend la liste des identifiants. */
export function renderLinks(content) {
  const list = $('[data-links]');
  const chips = $('[data-link-chips]');
  list.replaceChildren();
  chips.replaceChildren();
  const links = content?.links ?? [{ id: 'ent', title: 'ENT', subtitle: 'Portail de l’université', url: 'https://ent.univ-jfc.fr/' }];
  for (const l of links) {
    let url;
    try {
      url = new URL(l.url);
    } catch {
      continue;
    }
    if (url.protocol !== 'https:') continue; // défense en profondeur : le serveur le vérifie déjà
    list.append(
      h(
        'li',
        { data: { link: l.id } },
        h('a.link', { href: url.href, target: '_blank', rel: 'noopener noreferrer' }, h('span.link-ic', {}, tpl('tpl-link-ic')), h('span.link-txt', {}, h('b', { text: l.title }), h('span', { text: l.subtitle || url.host })), tpl('tpl-link-arrow')),
      ),
    );
    chips.append(h('label.mchip', {}, h('input', { type: 'checkbox', checked: true, data: { showLink: l.id } }), h('span', { text: l.title })));
  }
  return links.map((l) => l.id);
}
