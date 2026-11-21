// Tuile « Prochains rendus » : les échéances Moodle (devoirs, tests…) avec leur date, ce qui reste
// à rendre mis en avant, et une coche verte pour ce qui est déjà rendu. Lu directement dans Moodle
// depuis la page, comme le reste : le serveur d'ISIS Hub n'en voit rien.

import { $, h, icon } from '../core/dom.js';
import * as D from '../core/dates.js';
import * as moodle from '../portals/moodle.js';
import { HOSTS, NotSignedIn } from '../portals/config.js';
import { badge, timeOf } from './deadline-badge.js';

const KIND = { assign: 'Devoir', quiz: 'Test', workshop: 'Atelier', forum: 'Forum', lesson: 'Leçon', choice: 'Sondage', h5pactivity: 'H5P', scorm: 'SCORM', data: 'Base de données', feedback: 'Questionnaire' };

export function createDeadlines({ onSessionLost, onLogin }) {
  const tile = $('.tile--rendus');
  const slot = $('[data-slot="rendus"]', tile);
  const countChip = $('[data-rendus-count]', tile);
  const allLink = $('[data-rendus-all]', tile);
  allLink.href = `${HOSTS.moodle}/calendar/view.php?view=upcoming`;

  let items = null;
  let generation = 0;

  const empty = (cls, ic, title, text, action) =>
    h('div.empty', { class: cls }, h('span.empty-ic', {}, icon(ic, 'ic ic--lg')), h('h3', { text: title }), h('p', { text }), action);

  function reset() {
    generation++;
    items = null;
    countChip.hidden = true;
    allLink.hidden = true;
  }

  function showSignedOut(expired) {
    reset();
    slot.replaceChildren(
      empty(
        'empty--brand',
        'task',
        expired ? 'Session expirée' : 'Connecte-toi pour voir tes rendus',
        'Tes devoirs Moodle à venir, avec leur date limite et ce qui est déjà rendu.',
        h('button.btn.btn--primary.btn--sm', { type: 'button', text: 'Se connecter', on: { click: onLogin } }),
      ),
    );
  }

  function showLoading() {
    slot.replaceChildren(
      h('div.skel-stack', {}, ...['w-80', 'w-70', 'w-90', 'w-60'].map((w) => h('div.skel-dl', {}, h('span.skel.skel--block'), h('div.skel-stack', {}, h('span.skel.skel--line', { class: w }), h('span.skel.skel--line.w-40'))))),
    );
  }

  function row(item, now) {
    const b = badge(item, now);
    const when = new Date(item.at);
    const key = D.dayKey(when);
    const [, m, d] = key.split('-').map(Number);
    const sub = [KIND[item.kind] || '', item.course, `${D.DAYS[D.weekday(key)].slice(0, 3)}. ${timeOf(item.at)}`].filter(Boolean).join(' · ');
    const state = b.tone === 'done' ? h('span.dl-state.is-done', {}, icon('check', 'ic ic--xs'), b.text) : h('span.dl-state', { class: `is-${b.tone}`, text: b.text });
    const label = `${item.name}, ${item.course}, à rendre le ${D.dayShort(key)} à ${timeOf(item.at)} : ${b.tone === 'done' ? 'déjà rendu' : b.text.toLowerCase()}`;
    const body = [
      h('span.dl-date', { attrs: { 'aria-hidden': 'true' } }, b.tone === 'done' ? h('span.dl-check', {}, icon('check', 'ic ic--sm')) : null, h('span.dl-day', { text: String(d) }), h('span.dl-mon', { text: D.MONTHS_SHORT[m - 1] })),
      h('span.dl-main', {}, h('span.dl-name', { text: item.name }), h('span.dl-sub', { text: sub })),
      state,
    ];
    const inner = item.url
      ? h('a.dl-row', { href: item.url, target: '_blank', rel: 'noopener', attrs: { 'aria-label': label } }, ...body)
      : h('div.dl-row', { attrs: { 'aria-label': label, role: 'group' } }, ...body);
    return h('li.dl-item', { class: `is-${b.tone}` }, inner);
  }

  function render() {
    if (!items) return;
    const now = Date.now();
    const open = items.filter((i) => i.status !== 'done');
    const late = open.filter((i) => i.at < now).length;
    countChip.textContent = open.length ? `${open.length} à rendre` : 'À jour';
    countChip.classList.toggle('chip--late', late > 0);
    countChip.classList.toggle('chip--ok', !open.length);
    countChip.hidden = false;
    allLink.hidden = false;
    if (!items.length) {
      slot.replaceChildren(empty('empty--ok', 'check', 'Rien à rendre', 'Aucune échéance Moodle dans les prochaines semaines. Profites-en !'));
      return;
    }
    const list = h('ul.dl-list', { attrs: { 'aria-label': 'Échéances Moodle' } }, ...items.map((i) => row(i, now)));
    const foot = !open.length ? h('p.dl-foot', {}, icon('check', 'ic ic--xs'), 'Tout est rendu pour les prochaines semaines.') : null;
    slot.replaceChildren(list, foot ?? '');
  }

  async function load({ force = false } = {}) {
    const gen = ++generation;
    if (!items) showLoading();
    try {
      await moodle.connect();
      const list = await moodle.deadlines({ force });
      if (gen !== generation) return;
      items = list;
      render();
    } catch (error) {
      if (gen !== generation) return;
      if (error instanceof NotSignedIn) onSessionLost('moodle');
      else if (!items) {
        slot.replaceChildren(
          empty(
            'empty--err',
            'offline',
            'Rendus indisponibles',
            `moodle.univ-jfc.fr : ${error.message}. Les autres tuiles ne sont pas touchées.`,
            h('button.btn.btn--sm', { type: 'button', on: { click: () => load({ force: true }) } }, icon('retry', 'ic ic--sm'), 'Réessayer'),
          ),
        );
      }
    }
  }

  // Les « dans 3 h » avancent tout seuls ; la liste est relue au retour sur l'onglet (10 min au moins).
  setInterval(render, 60_000);
  let last = 0;
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible' || !items || Date.now() - last < 10 * 60_000) return;
    last = Date.now();
    load();
  });

  return { load: (o) => ((last = Date.now()), load(o)), showSignedOut };
}
