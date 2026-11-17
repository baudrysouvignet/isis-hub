// Fiche d'un cours : ouverte en cliquant sur une séance de l'emploi du temps.

import { $, h, icon } from '../core/dom.js';
import * as D from '../core/dates.js';
import * as moodle from '../portals/moodle.js';
import { modal } from './layout.js';

const TYPE_NAME = { CM: 'Cours magistral', TD: 'Travaux dirigés', TP: 'Travaux pratiques' };
const AHEAD_WEEKS = 8;

export function createCourseSheet({ schedule, matcher, isSignedIn, onWrite, promo }) {
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

  async function open(ev) {
    const t = ++token;
    current = ev;
    const kicker = $('[data-cs-kicker]', dialog);
    kicker.replaceChildren(
      ev.kind ? h('span.type', { class: `type--${ev.kind.toLowerCase()}`, text: ev.kind }) : '',
      h('span', { text: TYPE_NAME[ev.kind] ?? 'Séance' }),
      ev.exam ? h('span.exam', {}, icon('alert', 'ic ic--xs'), 'Examen') : '',
    );
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

    const exams = sessions.filter((x) => x.exam && (x === ev || isFuture(x)));
    const examBox = $('[data-cs-exam]', dialog);
    examBox.replaceChildren(
      ...(exams.length
        ? exams.slice(0, 3).map((x) =>
            h(
              'div.cs-exam',
              {},
              icon('alert', 'ic ic--sm'),
              h('div', {}, h('b', { text: `${x === ev ? 'Cette séance est un examen' : 'Examen'} · ${D.dayTitle(x.day)} · ${D.hourLabel(x.startMin)}` }), h('span', { text: `${x.room ? `Salle ${x.room} · ` : ''}d’après l’emploi du temps ADE` })),
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
