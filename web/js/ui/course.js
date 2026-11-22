// Fiche d'un cours : ouverte en cliquant sur une séance de l'emploi du temps.

import { $, h, icon } from '../core/dom.js';
import * as D from '../core/dates.js';
import * as moodle from '../portals/moodle.js';
import { modal } from './layout.js';
import { isEval, toggleEval, signalOf, hideSignal } from '../core/evals.js';
import { getMemo, setMemo, memoDate, MAX_CHARS } from '../core/memos.js';
import * as UD from '../core/userdata.js';

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
        h('a.sheet-foot-link', { href: found.course.url, target: '_blank', rel: 'noopener', data: { moodleCourse: found.course.id } }, `${found.approx ? '≈ ' : ''}${found.course.fullname}`, icon('chevRight', 'ic ic--xs')),
      );
    } else {
      box.replaceChildren(
        isSignedIn()
          ? h('a.sheet-foot-link', { href: moodle.searchUrl(ev.code ? `FI${ev.code}` : ev.title), target: '_blank', rel: 'noopener', data: { moodleHome: '', moodleQuery: ev.title } }, 'Pas d’espace trouvé · chercher dans les cours', icon('search', 'ic ic--xs'))
          : h('a.sheet-foot-link', { href: moodle.searchUrl(ev.code ? `FI${ev.code}` : ev.title), target: '_blank', rel: 'noopener' }, 'Chercher sur Moodle', icon('ext', 'ic ic--xs')),
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


  const votesText = (n) => `${n} camarade${n > 1 ? 's' : ''}`;

  function renderKicker(ev) {
    const exam = ev.exam || isEval(ev);
    const signal = signalOf(ev);
    $('[data-cs-kicker]', dialog).replaceChildren(
      ev.kind ? h('span.type', { class: `type--${ev.kind.toLowerCase()}`, text: ev.kind }) : '',
      h('span', { text: TYPE_NAME[ev.kind] ?? 'Séance' }),
      exam ? h('span.exam', {}, icon('alert', 'ic ic--xs'), 'Examen') : signal ? h('span.exam.exam--signal', {}, icon('alert', 'ic ic--xs'), 'Examen ?') : '',
    );
    // Signal de la classe : jamais présenté comme sûr (le serveur ne peut pas vérifier les votants).
    const box = $('[data-cs-signal]', dialog);
    box.hidden = !signal;
    if (signal) {
      box.replaceChildren(
        icon('alert', 'ic ic--sm'),
        h(
          'div',
          {},
          h('b', { text: isEval(ev) ? `Marquée aussi par d’autres : ${votesText(signal.votes)} en tout` : `Signalée comme examen par ${votesText(signal.votes)} de ${promo()}` }),
          h('span', { text: 'Votes anonymes, non vérifiés : seul l’emploi du temps ou l’enseignant fait foi.' }),
        ),
        !isEval(ev) && isSignedIn() && UD.isReady()
          ? h('button.btn.btn--sm.btn--ghost', { type: 'button', text: 'Masquer', on: { click: () => (hideSignal(ev), renderKicker(ev), onEvalChange?.()) } })
          : '',
      );
    }
    const btn = $('[data-cs-eval]', dialog);
    btn.hidden = ev.exam || !isSignedIn(); // déjà un examen d'après ADE, ou pas connecté (repère sauvegardé)
    btn.closest('.cs-eval').hidden = btn.hidden;
    btn.setAttribute('aria-pressed', String(isEval(ev)));
    $('span', btn).textContent = isEval(ev) ? 'Marquée comme examen · retirer' : 'Marquer comme examen';
  }

  $('[data-cs-eval]', dialog).addEventListener('click', () => {
    if (!current) return;
    toggleEval(current, promo());
    renderKicker(current);
    onEvalChange?.();
  });

  // Mes notes de cours : enregistrées pendant la frappe (après une courte pause), en chiffré.
  const memo = $('[data-cs-memo]', dialog);
  const memoCount = $('[data-cs-memo-count]', dialog);
  const memoHint = $('[data-cs-memo-hint]', dialog);
  const memoState = $('[data-cs-memo-state]', dialog);
  let memoTimer = 0;
  let memoFor = null;
  const memoReady = () => isSignedIn() && UD.isReady();
  function renderMemo(ev) {
    clearTimeout(memoTimer);
    memoFor = ev;
    const ok = memoReady();
    memo.disabled = !ok;
    memo.value = ok ? getMemo(ev) : '';
    memo.placeholder = ok ? 'Ce qu’on a fait, ce qui reste à revoir, les consignes…' : 'Connecte-toi pour écrire tes notes sur ce cours.';
    memoCount.textContent = `${memo.value.length} / ${MAX_CHARS}`;
    const d = ok && memoDate(ev);
    memoHint.textContent = d ? `Modifiée le ${D.dayShort(d)} · visible seulement par toi, sur tous tes appareils.` : 'Visible seulement par toi, sur tous tes appareils.';
    memoState.textContent = 'privé, chiffré';
  }
  // Fiche fermée pendant la frappe : rien n'est perdu.
  dialog.addEventListener('close', () => {
    clearTimeout(memoTimer);
    if (memoFor && memoReady() && memo.value !== getMemo(memoFor)) setMemo(memoFor, memo.value);
  });
  memo.addEventListener('input', () => {
    memoCount.textContent = `${memo.value.length} / ${MAX_CHARS}`;
    memoState.textContent = 'enregistrement…';
    clearTimeout(memoTimer);
    const ev = memoFor;
    memoTimer = setTimeout(() => {
      if (!ev || !memoReady()) return;
      setMemo(ev, memo.value);
      memoState.textContent = 'enregistré';
    }, 600);
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
    renderMemo(ev);

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

    const exams = sessions.filter((x) => (x.exam || isEval(x) || signalOf(x)) && (x === ev || isFuture(x)));
    const examBox = $('[data-cs-exam]', dialog);
    examBox.replaceChildren(
      ...(exams.length
        ? exams.slice(0, 3).map((x) =>
            h(
              'div.cs-exam',
              {},
              icon('alert', 'ic ic--sm'),
              h(
                'div',
                {},
                h('b', { text: `${x === ev ? (x.exam || isEval(x) ? 'Cette séance est un examen' : 'Examen probable') : x.exam || isEval(x) ? 'Examen' : 'Examen ?'} · ${D.dayTitle(x.day)} · ${D.hourLabel(x.startMin)}` }),
                h('span', { text: `${x.room ? `Salle ${x.room} · ` : ''}${x.exam ? 'd’après l’emploi du temps ADE' : isEval(x) ? 'marqué par toi' : `signalé par ${votesText(signalOf(x).votes)}, non vérifié`}` }),
              ),
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
