// Tuile « Prochains rendus » : les échéances Moodle (devoirs, tests…) avec leur date, ce qui reste
// à rendre mis en avant, et une coche verte pour ce qui est déjà rendu. Lu directement dans Moodle
// depuis la page, comme le reste : le serveur d'ISIS Hub n'en voit rien.

import { $, $$, h, icon, toast } from '../core/dom.js';
import * as UD from '../core/userdata.js';
import * as D from '../core/dates.js';
import * as moodle from '../portals/moodle.js';
import { HOSTS, NotSignedIn } from '../portals/config.js';
import { badge, timeOf } from './deadline-badge.js';

const LATE_KEPT = 7 * 864e5; // un retard de plus d'une semaine n'est plus affiché
const MAX_HIDDEN = 200;

// Rendus masqués à la main (une erreur de Moodle, un devoir qui ne te concerne pas…) : rangés dans
// les données personnelles, chiffrés et retrouvés sur tous les appareils. id → jour du masquage.
const hiddenMap = () => {
  const v = UD.get('rendus')?.hidden;
  return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
};
function setHidden(id, on) {
  const next = { ...hiddenMap() };
  if (on) next[id] = D.todayKey();
  else delete next[id];
  // Les plus anciens partent au-delà de MAX_HIDDEN : l'échéance est passée depuis longtemps.
  const kept = Object.entries(next).sort((a, b) => String(b[1]).localeCompare(String(a[1]))).slice(0, MAX_HIDDEN);
  UD.set('rendus', { hidden: Object.fromEntries(kept) });
}

const KIND = { assign: 'Devoir', quiz: 'Test', workshop: 'Atelier', forum: 'Forum', lesson: 'Leçon', choice: 'Sondage', h5pactivity: 'H5P', scorm: 'SCORM', data: 'Base de données', feedback: 'Questionnaire' };

export function createDeadlines({ onSessionLost, onLogin }) {
  const tile = $('.tile--rendus');
  const slot = $('[data-slot="rendus"]', tile);
  const countChip = $('[data-rendus-count]', tile);
  const allLink = $('[data-rendus-all]', tile);
  allLink.href = `${HOSTS.moodle}/calendar/view.php?view=upcoming`;

  let items = null;
  let showHidden = false;
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
    const hidden = Boolean(hiddenMap()[item.id]);
    const toggle = h(
      'button.dl-hide',
      {
        type: 'button',
        title: hidden ? 'Réafficher ce rendu' : 'Masquer ce rendu',
        attrs: { 'aria-label': `${hidden ? 'Réafficher' : 'Masquer'} « ${item.name} »` },
        on: {
          click: (e) => {
            const at = $$('.dl-hide', slot).indexOf(e.currentTarget);
            setHidden(item.id, !hidden);
            if (!hidden) toast(`« ${item.name} » masqué. Il reste en bas de la liste, dans « Masqués ».`, 'eyeOff');
            render();
            // Le clavier reste au même endroit de la liste.
            ($$('.dl-hide', slot)[at] ?? $('.dl-more', slot))?.focus({ preventScroll: true });
          },
        },
      },
      icon(hidden ? 'eye' : 'eyeOff', 'ic ic--sm'),
    );
    return h('li.dl-item', { class: `is-${b.tone}${hidden ? ' is-hidden' : ''}` }, inner, toggle);
  }

  function render() {
    if (!items) return;
    const now = Date.now();
    const hidden = hiddenMap();
    const current = items.filter((i) => i.status !== 'late' || now - i.at <= LATE_KEPT);
    const shown = current.filter((i) => !hidden[i.id]);
    const masked = current.filter((i) => hidden[i.id]);
    if (!masked.length) showHidden = false;
    const open = shown.filter((i) => i.status !== 'done');
    const late = open.filter((i) => i.at < now).length;
    countChip.textContent = open.length ? `${open.length} à rendre` : 'À jour';
    countChip.classList.toggle('chip--late', late > 0);
    countChip.classList.toggle('chip--ok', !open.length);
    countChip.hidden = false;
    allLink.hidden = false;
    const more = masked.length
      ? h(
          'button.dl-more',
          { type: 'button', attrs: { 'aria-expanded': String(showHidden) }, on: { click: () => ((showHidden = !showHidden), render()) } },
          icon(showHidden ? 'eyeOff' : 'eye', 'ic ic--xs'),
          showHidden ? 'Cacher les rendus masqués' : `Masqués (${masked.length})`,
        )
      : null;
    if (!shown.length && !showHidden) {
      slot.replaceChildren(
        h('div.dl-wrap', {}, empty('empty--ok', 'check', 'Rien à rendre', 'Aucune échéance Moodle dans les prochaines semaines. Profites-en !'), more),
      );
      return;
    }
    const list = showHidden ? current : shown;
    const scrolled = $('.dl-list', slot)?.scrollTop ?? 0;
    const foot = !open.length && shown.length ? h('p.dl-foot', {}, icon('check', 'ic ic--xs'), 'Tout est rendu pour les prochaines semaines.') : null;
    slot.replaceChildren(
      h('div.dl-wrap', {}, h('ul.dl-list', { attrs: { 'aria-label': 'Échéances Moodle' } }, ...list.map((i) => row(i, now)), more ? h('li.dl-more-li', {}, more) : null), foot),
    );
    $('.dl-list', slot).scrollTop = scrolled;
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
  // Pas pendant qu'on s'en sert : la liste reconstruite ferait perdre le survol et le clavier.
  setInterval(() => !tile.matches(':hover') && !tile.contains(document.activeElement) && render(), 60_000);
  UD.onUserData((touched) => touched.includes('rendus') && render()); // masqué sur un autre appareil
  let last = 0;
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible' || !items || Date.now() - last < 10 * 60_000) return;
    last = Date.now();
    load();
  });

  return { load: (o) => ((last = Date.now()), load(o)), showSignedOut };
}
