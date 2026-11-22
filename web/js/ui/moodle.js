// Tuile « Moodle » : les cours suivis, et le bon cours mis en avant selon l'heure
// (celui qui a lieu maintenant, sinon le prochain de la journée, sinon le prochain à venir).

import { $, $$, h, icon, isTyping } from '../core/dom.js';
import * as D from '../core/dates.js';
import * as moodle from '../portals/moodle.js';
import { normalize } from '../portals/match.js';
import { NotSignedIn } from '../portals/config.js';

export function createMoodle({ matcher, schedule, onSessionLost, onLogin, onCourses }) {
  const tile = $('.tile--moodle');
  const slot = $('[data-slot="moodle"]', tile);
  const countChip = $('[data-course-count]', tile);
  const autoChip = $('[data-moodle-auto]', tile);
  const expandBtn = $('[data-moodle-home]', tile);

  let courses = [];
  let generation = 0;
  let spot = null;
  let listEl = null;
  let search = null;
  let emptyLi = null;

  const empty = (cls, ic, title, text, action) =>
    h('div.empty', { class: cls }, h('span.empty-ic', {}, icon(ic, 'ic ic--lg')), h('h3', { text: title }), h('p', { text }), action);

  function reset() {
    generation++;
    courses = [];
    countChip.hidden = autoChip.hidden = true;
    if (expandBtn) expandBtn.hidden = true;
    spot = listEl = search = null;
  }

  function showSignedOut(expired) {
    reset();
    slot.replaceChildren(
      empty(
        'empty--brand',
        'lock',
        expired ? 'Session expirée' : 'Connecte-toi pour voir tes cours Moodle',
        'La liste de tes cours, avec celui du moment mis en avant.',
        h('button.btn.btn--primary.btn--sm', { type: 'button', text: 'Se connecter', on: { click: onLogin } }),
      ),
    );
  }

  function showLoading() {
    slot.replaceChildren(
      h(
        'div.moodle-layout',
        {},
        h('span.skel.skel--block.skel-h180'),
        h('div.skel-stack', {}, h('span.skel.skel--line.skel-h40'), ...['w-80', 'w-60', 'w-70', 'w-50'].map((w) => h('span.skel.skel--line', { class: w }))),
      ),
    );
  }

  function courseItem(c) {
    const sub = [c.shortname, c.category].filter(Boolean).join(' · ');
    return h(
      'li',
      { data: { course: c.id } },
      h(
        'a.course',
        // Un clic ouvre le cours dans le Hub (ui/moodle-view.js) ; Ctrl/Cmd + clic garde le lien Moodle.
        { href: c.url, target: '_blank', rel: 'noopener', data: { moodleCourse: c.id } },
        h('span.course-ic', {}, icon('book', 'ic ic--sm')),
        h('span', {}, h('span.course-name', { text: c.fullname }), h('span.course-sub', { text: sub })),
        icon('chevRight', 'ic ic--sm btn-arrow'),
      ),
    );
  }

  /** Séance la plus pertinente maintenant, avec son cours Moodle. */
  function pick() {
    const now = new Date();
    const today = D.todayKey();
    const linked = schedule.upcoming(now, 21).map((ev) => ({ ev, found: matcher.get(ev) })).filter((x) => x.found);
    const current = linked.find(({ ev }) => ev.start <= now && now < ev.end);
    if (current) return { ...current, mode: 'now' };
    const later = linked.find(({ ev }) => ev.start > now);
    if (later) return { ...later, mode: later.ev.day === today ? 'today' : 'later' };
    return null;
  }

  function renderSpot() {
    if (!spot) return;
    const chosen = pick();
    spot.hidden = !chosen;
    autoChip.hidden = !chosen;
    $$('.course.is-match', tile).forEach((a) => a.classList.remove('is-match'));
    if (!chosen) return;
    const { ev, found, mode } = chosen;
    const room = ev.room ? ` · salle ${ev.room}` : '';
    const kicker = $('.spot-kicker', spot);
    if (mode === 'now') {
      kicker.replaceChildren(h('span.live-dot', { attrs: { 'aria-hidden': 'true' } }), `En cours${room} · jusqu’à ${D.hourLabel(ev.endMin)}`);
    } else if (mode === 'today') {
      kicker.replaceChildren(icon('clock', 'ic ic--xs'), `Prochain · ${D.hourLabel(ev.startMin)}${room}`);
    } else {
      kicker.replaceChildren(icon('clock', 'ic ic--xs'), `Prochain cours · ${D.dayShort(ev.day)}, ${D.hourLabel(ev.startMin)}${room}`);
    }
    $('.spot-title', spot).textContent = found.course.fullname;
    $('.spot-meta', spot).textContent = [found.course.shortname, found.course.category, found.approx ? 'correspondance approximative' : '']
      .filter(Boolean)
      .join(' · ');
    spot.href = found.course.url;
    spot.dataset.moodleCourse = found.course.id;
    $(`[data-course="${found.course.id}"] .course`, tile)?.classList.add('is-match');
  }

  /**
   * Après un moment sans y toucher, la tuile remonte toute seule : le cours du moment redevient
   * visible. Jamais pendant une recherche, ni sous le pointeur ou le clavier.
   */
  const IDLE_TOP = 45_000;
  let idleTimer = 0;
  let scroller = null; // la zone qui défile (la mise en page du moment)
  function arm() {
    clearTimeout(idleTimer);
    if (!scroller?.isConnected || scroller.scrollTop < 2) return;
    idleTimer = setTimeout(() => {
      if (!scroller?.isConnected) return;
      if (tile.matches(':hover') || tile.contains(document.activeElement) || search?.value) return arm();
      scroller.scrollTo({ top: 0, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    }, IDLE_TOP);
  }
  tile.addEventListener('pointerleave', arm);
  tile.addEventListener('focusout', arm);
  function follow(layout) {
    scroller = layout;
    layout.addEventListener('scroll', arm, { passive: true });
  }

  function filter() {
    const q = normalize(search.value);
    let n = 0;
    for (const li of $$('li[data-course]', listEl)) {
      const ok = !q || normalize(li.textContent).includes(q);
      li.hidden = !ok;
      if (ok) n++;
    }
    emptyLi.hidden = n > 0;
    emptyLi.textContent = `Aucun cours ne correspond à « ${search.value.trim()} ».`;
  }

  function render() {
    countChip.textContent = `${courses.length} cours`;
    countChip.hidden = false;
    if (expandBtn) expandBtn.hidden = false;
    if (!courses.length) {
      slot.replaceChildren(empty('', 'book', 'Aucun cours Moodle', 'Tu n’es inscrit à aucun cours pour l’instant.'));
      return;
    }
    spot = $('#tpl-spot').content.firstElementChild.cloneNode(true);
    const searchLabel = $('#tpl-search').content.firstElementChild.cloneNode(true);
    search = $('input', searchLabel);
    emptyLi = h('li.course-empty', { hidden: true, data: { courseEmpty: '' } });
    listEl = h('ul.course-list', { data: { courseList: '' } }, ...courses.map(courseItem), emptyLi);
    // Tuile étroite : toute la tuile défile, la recherche reste collée en haut au-dessus de la liste,
    // et le cours du moment réapparaît en remontant (voir follow()).
    const layout = h('div.moodle-layout', {}, spot, h('div.moodle-list', {}, h('div.moodle-searchbar', {}, searchLabel), listEl));
    slot.replaceChildren(layout);
    follow(layout);
    search.addEventListener('input', filter);
    // En cherchant, la liste prend toute la hauteur : le cours du moment passe au-dessus.
    search.addEventListener('focus', () => {
      if (layout.scrollHeight > layout.clientHeight + 4) layout.scrollTo({ top: Math.max(layout.scrollTop, spot.hidden ? 0 : spot.offsetHeight), behavior: 'smooth' });
    });
    search.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') $$('li[data-course]', listEl).find((li) => !li.hidden)?.querySelector('a').click();
      if (e.key === 'Escape' && search.value) {
        e.stopPropagation();
        search.value = '';
        filter();
      }
    });
    renderSpot();
  }

  async function load() {
    const gen = ++generation;
    showLoading();
    try {
      await moodle.connect();
      const list = await moodle.enrolledCourses();
      if (gen !== generation) return;
      // Les cours de l'année (code FIA…/FIE…) d'abord, puis les autres, par ordre alphabétique.
      const rank = (c) => (/\bFI[AE]\d/i.test(`${c.shortname} ${c.fullname}`) ? 0 : 1);
      courses = list.sort((a, b) => rank(a) - rank(b) || a.fullname.localeCompare(b.fullname, 'fr'));
      matcher.setEnrolled(courses);
      render();
      onCourses?.(courses);
      schedule.rerender();
      matcher.resolve(schedule.upcoming(new Date(), 21), renderSpot);
    } catch (error) {
      if (gen !== generation) return;
      if (error instanceof NotSignedIn) onSessionLost('moodle');
      else {
        slot.replaceChildren(
          empty(
            'empty--err',
            'offline',
            'Moodle ne répond pas',
            `moodle.univ-jfc.fr : ${error.message}. Les autres tuiles ne sont pas touchées.`,
            h('button.btn.btn--sm', { type: 'button', on: { click: load } }, icon('retry', 'ic ic--sm'), 'Réessayer'),
          ),
        );
      }
    }
  }

  document.addEventListener('keydown', (e) => {
    if (e.key === '/' && search && !isTyping(e.target) && !document.querySelector('dialog[open]') && $('[data-reader]').hidden) {
      e.preventDefault();
      search.focus();
    }
  });
  setInterval(renderSpot, 30_000);

  return { load, showSignedOut, refresh: renderSpot };
}
