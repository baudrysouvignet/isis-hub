// Fiche d'un cours : ouverte en cliquant sur une séance de l'emploi du temps.

import { $, h, icon } from '../core/dom.js';
import * as D from '../core/dates.js';
import * as moodle from '../portals/moodle.js';
import { modal } from './layout.js';
import { isEval, toggleEval } from '../core/evals.js';

const TYPE_NAME = { CM: 'Cours magistral', TD: 'Travaux dirigés', TP: 'Travaux pratiques' };
const AHEAD_WEEKS = 8;

export function createCourseSheet({ notes, schedule, matcher, isSignedIn, onWrite, promo, onEvalChange }) {
  const dialog = $('dialog[data-course]');
  const sheet = modal(dialog);
  const set = (k, v) => ($(`[data-cs-${k}]`, dialog).textContent = v);
  let current = null;
  let token = 0;

  const same = (ev) => (x) => (ev.code ? x.code === ev.code : x.title === ev.title);
  const isFuture = (x) => x.start > new Date();
  const roomChip = (room) => h('span.room', {}, icon('pin', 'ic ic--xs room-pin'), h('span', { text: room || '?' }));
  const none = (text) => h('p.cs-none', { text });

  function moodleBlock(ev) {
    const found = matcher.get(ev);
    const box = $('[data-cs-moodle]', dialog);
    if (found) {
      box.replaceChildren(
        h('a.sheet-foot-link', { href: found.course.url, target: '_blank', rel: 'noopener' }, `${found.approx ? '≈ ' : ''}${found.course.fullname}`, icon('ext', 'ic ic--xs')),
      );
    } else {
      box.replaceChildren(
        h('a.sheet-foot-link', { href: moodle.searchUrl(ev.code ? `FI${ev.code}` : ev.title), target: '_blank', rel: 'noopener' }, isSignedIn() ? 'Pas d’espace trouvé · chercher sur Moodle' : 'Chercher sur Moodle', icon('ext', 'ic ic--xs')),
      );
    }
    return found;
  }

  /** Mes notes (saisies dans ISIS Hub) pour la matière liée au code ADE de la séance. */
  function myNotes(ev) {
    const box = $('[data-cs-mine]', dialog);
    const mine = notes?.course(ev.code);
    const fmt = (v) => String(Math.round(v * 100) / 100).replace('.', ',');
    const items = mine
      ? mine.evals.length
        ? mine.evals.map(({ e, v, date, proposal }) =>
            h(
              'li',
              { class: v === null || v === undefined ? 'is-planned' : '' },
              h('div', {}, h('b', { text: e.label }), h('span', { text: `${proposal ? 'emploi du temps' : `coef ${fmt(e.coef)}`}${date ? ` · ${date.split('-').reverse().slice(0, 2).join('/')}` : ''}` })),
              h('span.cs-grade', { text: v === null || v === undefined ? 'à venir' : fmt(v) }),
            ),
          )
        : [h('li.cs-none', { text: 'Aucune évaluation pour l’instant.' })]
      : [h('li.cs-none', { text: notes?.hasBook() ? 'Cette matière n’est pas dans ta maquette de notes.' : 'Pas encore de maquette de notes pour ta classe.' })];
    box.replaceChildren(...items);
    const add = $('[data-cs-addnote]', dialog);
    add.hidden = !mine;
    add.onclick = mine ? () => (sheet.close(), setTimeout(() => notes.add({ mat: mine.M.id }), 200)) : null;
  }

  async function grades(found, t) {
    const list = $('[data-cs-notes]', dialog);
    if (!isSignedIn()) return list.replaceChildren(h('li.cs-none', { text: 'Connecte-toi pour voir tes notes Moodle.' }));
    if (!found) return list.replaceChildren(h('li.cs-none', { text: 'Pas d’espace Moodle trouvé pour ce cours.' }));
    list.replaceChildren(h('li.cs-none', {}, h('span.spinner'), ' Lecture du carnet de notes…'));
    try {
      const items = await moodle.grades(found.course.id);
      if (t !== token) return;
      if (!items.length) return list.replaceChildren(h('li.cs-none', { text: 'Aucune note publiée sur Moodle pour ce cours.' }));
      list.replaceChildren(
        ...items.map((g) =>
          h(
            'li',
            {},
            h('div', {}, h('b', { text: g.name }), h('span', { text: [g.range && `sur ${g.range}`, g.average && `moyenne ${g.average}`, g.percentage].filter(Boolean).join(' · ') })),
            h('span.cs-grade', { text: g.grade }),
          ),
        ),
        h('li', {}, h('a.sheet-foot-link', { href: moodle.gradesUrl(found.course.id), target: '_blank', rel: 'noopener' }, 'Carnet de notes complet', icon('ext', 'ic ic--xs'))),
      );
    } catch (err) {
      if (t === token) list.replaceChildren(h('li.cs-none', { text: `Notes indisponibles : ${err.message}` }));
    }
  }

  function renderKicker(ev) {
    $('[data-cs-kicker]', dialog).replaceChildren(
      ev.kind ? h('span.type', { class: `type--${ev.kind.toLowerCase()}`, text: ev.kind }) : '',
      h('span', { text: TYPE_NAME[ev.kind] ?? 'Séance' }),
      ev.exam || isEval(ev) ? h('span.exam', {}, icon('alert', 'ic ic--xs'), 'Examen') : '',
    );
    const btn = $('[data-cs-eval]', dialog);
    btn.hidden = ev.exam || !isSignedIn(); // déjà un examen d'après ADE, ou pas connecté (repère sauvegardé)
    btn.setAttribute('aria-pressed', String(isEval(ev)));
    $('span', btn).textContent = isEval(ev) ? 'Marquée comme examen · retirer' : 'Marquer comme examen';
  }

  $('[data-cs-eval]', dialog).addEventListener('click', () => {
    if (!current) return;
    toggleEval(current);
    renderKicker(current);
    onEvalChange?.();
  });

  async function open(ev) {
    const t = ++token;
    current = ev;
    renderKicker(ev);
    set('title', ev.title);
    set('code', [ev.code, ...(ev.groups.length ? ev.groups : [])].filter(Boolean).join(' · ') || ev.summary);
    $('[data-cs-room] span', dialog).textContent = ev.room || 'Salle non précisée';
    set('date', D.dayTitle(ev.day));
    const dur = ev.endMin - ev.startMin;
    set('time', `${ev.time} · ${Math.floor(dur / 60)} h${dur % 60 ? ` ${String(dur % 60).padStart(2, '0')}` : ''}`);
    const now = new Date();
    $('[data-cs-live]', dialog).hidden = !(ev.start <= now && now < ev.end);
    set('teacher', ev.teacher || 'Non précisé dans ADE');
    $('[data-cs-write]', dialog).hidden = !ev.teacher || !isSignedIn();
    set('group', ev.groups.join(' · ') || promo());
    const found = moodleBlock(ev);

    // Séances : cette semaine, et les 8 semaines suivantes (blocs ADE déjà en cache, sinon lus).
    set('week-total', '…');
    set('week-left', '…');
    set('next-count', '…');
    $('[data-cs-next]', dialog).replaceChildren(h('li.cs-none', {}, h('span.spinner'), ' Recherche des prochaines séances…'));
    $('[data-cs-exam]', dialog).replaceChildren(none('Recherche des examens…'));
    const notes = ev.notes.filter((n) => !/^\s*$/.test(n));
    sheet.open();
    myNotes(ev);
    grades(found, t);

    const monday = D.mondayOf(ev.day);
    const today = D.todayKey();
    const from = today > monday ? today : monday;
    const sessions = (await schedule.between(monday, D.addDays(from, AHEAD_WEEKS * 7))).filter(same(ev));
    if (t !== token) return;
    const thisWeek = sessions.filter((x) => x.day <= D.addDays(monday, 6));
    const upcoming = sessions.filter(isFuture);
    set('week-total', String(thisWeek.length));
    set('week-left', String(thisWeek.filter(isFuture).length));
    set('next-count', String(upcoming.length));
    $('[data-cs-next-count]', dialog).nextElementSibling.textContent = `sur ${AHEAD_WEEKS} semaines`;
    $('[data-cs-next]', dialog).replaceChildren(
      ...(upcoming.length
        ? upcoming.slice(0, 5).map((x) =>
            h('li', {}, h('span.cs-next-d', { text: D.dayShort(x.day) }), h('span', { text: x.time }), roomChip(x.room), x.kind ? h('span.type', { class: `type--${x.kind.toLowerCase()}`, text: x.kind }) : ''),
          )
        : [h('li.cs-none', { text: `Aucune autre séance prévue dans les ${AHEAD_WEEKS} prochaines semaines.` })]),
    );

    const exams = sessions.filter((x) => (x.exam || isEval(x)) && (x === ev || isFuture(x)));
    const examBox = $('[data-cs-exam]', dialog);
    examBox.replaceChildren(
      ...(exams.length
        ? exams.slice(0, 3).map((x) =>
            h(
              'div.cs-exam',
              {},
              icon('alert', 'ic ic--sm'),
              h('div', {}, h('b', { text: `${x === ev ? 'Cette séance est un examen' : 'Examen'} · ${D.dayTitle(x.day)} · ${D.hourLabel(x.startMin)}` }), h('span', { text: `${x.room ? `Salle ${x.room} · ` : ''}${x.exam ? 'd’après l’emploi du temps ADE' : 'marqué par toi'}` })),
            ),
          )
        : [none('Aucun examen prévu à l’emploi du temps pour l’instant.')]),
      ...(notes.length ? [h('p.cs-none', { text: `Remarques ADE : ${notes.join(' · ')}` })] : []),
    );
  }

  $('[data-cs-write]', dialog).addEventListener('click', () => {
    if (!current?.teacher) return;
    const ev = current;
    sheet.close();
    // On cherche l'enseignant dans l'annuaire à partir de son nom de famille.
    const surname = ev.teacher.replace(/^\p{L}\.\s*/u, '');
    setTimeout(() => onWrite({ name: surname, subject: ev.title }), 220);
  });

  return { open };
}
