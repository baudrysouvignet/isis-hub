// Tuile « Emploi du temps » : vue jour (heure par heure) ou semaine, navigation sans limite,
// plein écran (toujours en vue semaine), glisser sur téléphone.

import { $, $$, h, icon, restartClass, clipFrom, lockScroll, motionOK, isTyping, EASE, EASE_IO } from '../core/dom.js';
import * as D from '../core/dates.js';
import { prefs } from '../core/store.js';
import { fetchSchedule } from '../portals/ade.js';
import { isEval, signalOf } from '../core/evals.js';
import { hasMemo } from '../core/memos.js';
import { hasMenu } from './crous.js';

// Créneau du Resto U' affiché chaque jour de cours (lundi – vendredi).
const LUNCH = { startMin: 12 * 60 + 30, endMin: 13 * 60 + 30 };

const GRID_START = 8 * 60; // la grille de la maquette couvre 8 h – 19 h, par pas de 5 minutes
const GRID_END = 19 * 60;
const ROWS = (GRID_END - GRID_START) / 5;
const CHUNK_WEEKS = 6; // ADE est interrogé par blocs de 6 semaines
const EPOCH = '2024-01-01'; // un lundi : origine des blocs
const TYPE_TITLE = { CM: 'Cours magistral', TD: 'Travaux dirigés', TP: 'Travaux pratiques' };

// Sur téléphone, le sélecteur Jours / Semaine est masqué : vue jour, sauf en plein écran.
const phoneMQ = matchMedia('(max-width: 759.98px)');

const rowOf = (min) => Math.round((Math.min(Math.max(min, GRID_START), GRID_END) - GRID_START) / 5) + 1;
const toMin = (s) => {
  const [hh, mm] = s.split(':').map(Number);
  return hh * 60 + mm;
};

export function createSchedule({ app, matcher, onData, onOpen, onLunch }) {
  const tile = $('.tile--edt');
  const cal = $('.cal', tile);
  const body = $('[data-swipe]', tile);
  const seg = $('.seg', tile);
  const cols = $$('.day-col', tile);
  const heads = $$('.cal-dh', tile);
  const dayBtns = $$('[data-day-btn]', tile);
  const nowline = $('[data-nowline]', tile);
  const nowTag = $('[data-now-tag]', tile);
  const note = $('[data-week-note]', tile);
  const status = $('[data-edt-status]', tile);
  const expandBtn = $('[data-expand]', tile);
  const sync = $('[data-sync="edt"]', tile);

  let promo = null;
  let choice = {};
  let chunks = new Map(); // index → Promise<événements>
  const fetchedAt = new Map(); // index → date de lecture dans ADE
  let byDay = new Map(); // « AAAA-MM-JJ » → événements
  let monday = D.mondayOf(D.todayKey());
  let active = 0; // jour affiché en vue jour (0 = lundi)
  let viewBeforeExpand = 'day';
  let ghost = null;
  let renderToken = 0;

  // ------------------------------------------------------------ données

  const chunkOf = (mon) => Math.floor(D.daysBetween(EPOCH, mon) / 7 / CHUNK_WEEKS);
  const chunkStart = (i) => D.addDays(EPOCH, i * CHUNK_WEEKS * 7);

  function loadChunk(i) {
    if (!chunks.has(i)) {
      const first = chunkStart(i);
      const p = fetchSchedule(promo, first, D.addDays(first, CHUNK_WEEKS * 7 - 1), choice).then((events) => {
        fetchedAt.set(i, Date.now());
        for (let d = 0; d < CHUNK_WEEKS * 7; d++) byDay.delete(D.addDays(first, d)); // relecture : on remplace
        for (const ev of events) {
          if (!byDay.has(ev.day)) byDay.set(ev.day, []);
          byDay.get(ev.day).push(ev);
        }
        onData?.();
        return events;
      });
      p.catch(() => chunks.delete(i)); // un échec n'est pas mis en cache : on pourra réessayer
      chunks.set(i, p);
    }
    return chunks.get(i);
  }
  const ensureWeek = (mon) => loadChunk(chunkOf(mon));
  const eventsOn = (key) => byDay.get(key) ?? [];
  const weekEvents = (mon) => [0, 1, 2, 3, 4, 5, 6].flatMap((i) => eventsOn(D.addDays(mon, i)));

  /** Toutes les séances déjà chargées à partir d'un instant (pour Moodle et « prochain cours »). */
  function upcoming(from = new Date(), days = 14) {
    const out = [];
    const start = D.dayKey(from);
    for (let i = 0; i <= days; i++) out.push(...eventsOn(D.addDays(start, i)));
    return out.filter((ev) => ev.end > from).sort((a, b) => a.start - b.start);
  }

  /** Séances entre deux jours inclus, en chargeant les blocs manquants. */
  async function between(first, last) {
    for (let i = chunkOf(D.mondayOf(first)); i <= chunkOf(D.mondayOf(last)); i++) await loadChunk(i).catch(() => {});
    const out = [];
    for (let k = first; k <= last; k = D.addDays(k, 1)) out.push(...eventsOn(k));
    return out;
  }

  async function nextSchoolWeek(after) {
    for (let w = 1; w <= 26; w++) {
      const mon = D.addDays(after, 7 * w);
      await ensureWeek(mon);
      if (weekEvents(mon).some((ev) => D.weekday(ev.day) < 5)) return mon;
    }
    return null;
  }

  // ------------------------------------------------------------- rendu

  function moodleChip(ev) {
    const found = matcher.get(ev);
    if (!found) return null;
    const { course, approx } = found;
    const label = `Ouvrir sur Moodle${approx ? ' (correspondance approximative)' : ''} : ${course.fullname}`;
    return h(
      'a.ev-mdl',
      { class: approx ? 'is-approx' : '', href: course.url, target: '_blank', rel: 'noopener', title: label, attrs: { 'aria-label': label } },
      icon('book', 'ic ic--xs'),
      approx && h('span', { text: '≈', attrs: { 'aria-hidden': 'true' } }),
      icon('ext', 'ic ic--xs mdl-arrow'),
    );
  }

  /** Bloc « Resto U' » de 12 h 30 à 13 h 30 : ouvre le menu du jour. */
  function lunchEl(day) {
    const published = hasMenu(day);
    const el = h(
      'article.ev.ev--crous',
      {
        class: published ? '' : 'is-unpublished',
        data: { start: LUNCH.startMin, end: LUNCH.endMin, lunch: '1' },
        title: published ? 'Voir le menu du midi' : 'Menu pas encore publié',
      },
      h(
        'div.ev-in',
        {},
        h('div.ev-top', {}, h('span.crous-badge', { text: 'crous', attrs: { 'aria-hidden': 'true' } }), h('span.crous-when', { text: '12:30 – 13:30' })),
        h('h4.ev-title', { text: 'Resto U’ · menu du midi' }),
      ),
    );
    el.style.setProperty('grid-row', `${rowOf(LUNCH.startMin)} / ${rowOf(LUNCH.endMin)}`);
    el.prepend(h('button.ev-hit', { type: 'button', attrs: { 'aria-label': `Menu du Resto U’ de Castres, ${D.dayTitle(day)}` }, on: { click: () => onLunch?.(day) } }));
    return el;
  }

  function eventEl(ev) {
    if (ev.lunch) return lunchEl(ev.day);
    const kind = (ev.kind ?? 'autre').toLowerCase();
    const exam = ev.exam || isEval(ev); // repère personnel « examen » : même affichage qu'un examen ADE
    const signal = !exam && signalOf(ev); // signal de la classe : à part, jamais présenté comme sûr
    const memo = hasMemo(ev); // l'étudiant a écrit une note sur ce cours
    const el = h(
      'article.ev',
      { class: `ev--${ev.kind ? kind : 'cm'}`, data: { start: ev.startMin, end: ev.endMin } },
      h(
        'div.ev-in',
        {},
        h('span.room', {}, icon('pin', 'ic ic--xs room-pin'), h('span', { text: ev.room || 'Salle ?' })),
        h(
          'div.ev-main',
          {},
          h(
            'div.ev-top',
            {},
            ev.kind && h('span.type', { class: `type--${kind}`, text: ev.kind, title: TYPE_TITLE[ev.kind] }),
            exam && h('span.exam', {}, icon('alert', 'ic ic--xs'), 'Examen'),
            signal && h('span.exam.exam--signal', { title: `Signalé comme examen par ${signal.votes} camarade${signal.votes > 1 ? 's' : ''} (votes anonymes, non vérifiés)` }, icon('alert', 'ic ic--xs'), 'Examen ?'),
          ),
          h('h4.ev-title', { text: ev.title, title: ev.title }),
          h(
            'p.ev-meta',
            {},
            h('span.ev-time', { text: ev.time }),
            ev.teacher && h('span.ev-teacher', {}, icon('user'), ev.teacher),
            h('span.ev-group', { text: (ev.groups.length ? ev.groups : [promo]).join(' · ') }),
            ev.code && h('span.ev-code', { text: ev.code }),
          ),
          h('div.ev-foot'),
        ),
      ),
    );
    el.style.setProperty('grid-row', `${rowOf(ev.startMin)} / ${Math.max(rowOf(ev.endMin), rowOf(ev.startMin) + 1)}`);
    el.prepend(
      h('button.ev-hit', {
        type: 'button',
        attrs: { 'aria-label': `Détails : ${ev.title}, ${ev.time}, salle ${ev.room || 'inconnue'}${ev.teacher ? `, ${ev.teacher}` : ''}${memo ? ', tu as une note sur ce cours' : ''}` },
        on: { click: () => onOpen?.(ev) },
      }),
    );
    // En haut à droite : un petit crayon si l'étudiant a écrit une note sur ce cours, puis Moodle.
    const chip = moodleChip(ev);
    const mark = memo && h('span.ev-memo', { title: 'Tu as écrit une note sur ce cours', attrs: { 'aria-hidden': 'true' } }, icon('pen', 'ic ic--xs'));
    if (chip || mark) {
      el.classList.toggle('has-mdl', Boolean(chip));
      el.classList.toggle('has-memo', Boolean(mark));
      el.prepend(h('div.ev-corner', {}, mark, chip));
    }
    return el;
  }

  /** Répartit les séances qui se chevauchent sur plusieurs colonnes (avec le Resto U' les jours de cours). */
  function layoutDay(col, events, day) {
    // Resto U' : jours de cours seulement, à partir d'aujourd'hui.
    if (events.length && D.weekday(day) < 5 && day >= D.todayKey()) {
      events = [...events, { lunch: true, day, ...LUNCH }].sort((a, b) => a.startMin - b.startMin || b.endMin - a.endMin);
    }
    const lanes = [];
    const placed = events.map((ev) => {
      let lane = lanes.findIndex((end) => end <= ev.startMin);
      if (lane < 0) lane = lanes.push(0) - 1;
      lanes[lane] = ev.endMin;
      return { ev, lane };
    });
    col.style.setProperty('grid-template-columns', lanes.length > 1 ? `repeat(${lanes.length}, minmax(0, 1fr))` : '');
    for (const { ev, lane } of placed) {
      const el = eventEl(ev);
      // Une séance seule sur son créneau prend toute la largeur.
      const overlaps = placed.some((o) => o.ev !== ev && o.ev.startMin < ev.endMin && ev.startMin < o.ev.endMin);
      if (lanes.length > 1 && overlaps) el.style.setProperty('grid-column', String(lane + 1));
      col.append(el);
    }
  }

  function dayEmpty(key) {
    const next = upcoming(new Date(`${D.addDays(key, 1)}T00:00:00Z`), 21)[0];
    return h(
      'div.empty.day-empty',
      {},
      h('span.empty-ic', {}, icon('coffee', 'ic ic--lg')),
      h('h3', { text: key === D.todayKey() ? 'Aucun cours aujourd’hui' : 'Aucun cours ce jour-là' }),
      h('p', { text: `Rien n’est prévu à l’emploi du temps de ${promo}.` }),
      next &&
        h(
          'div.next-up',
          {},
          h('span.room', {}, icon('pin', 'ic ic--xs room-pin'), h('span', { text: next.room || '?' })),
          h('div', {}, h('b', { text: next.title }), h('span', { text: `Prochain cours · ${D.dayShort(next.day)}, ${D.hourLabel(next.startMin)}` })),
        ),
    );
  }

  function labels() {
    const key = D.addDays(monday, active);
    const today = D.todayKey();
    const wn = D.isoWeek(monday);
    $('[data-day-title]', tile).textContent = D.dayTitle(key);
    $('[data-day-sub]', tile).textContent = `${key === today ? 'aujourd’hui · ' : ''}semaine ${wn}`;
    $('[data-week-title]', tile).textContent = `Semaine ${wn}`;
    $('[data-week-range]', tile).textContent = D.weekRange(monday);
    $('[data-week-chip]', tile).textContent = `S${wn}`;
    const week = tile.dataset.view === 'week';
    $('[data-nav="-1"]', tile).setAttribute('aria-label', week ? 'Semaine précédente' : 'Jour précédent');
    $('[data-nav="1"]', tile).setAttribute('aria-label', week ? 'Semaine suivante' : 'Jour suivant');
  }

  /** Nombre de jours affichés côte à côte en vue jour (1, 2 ou 3 selon la largeur de la tuile). */
  function visibleDays() {
    if (tile.dataset.view !== 'day') return 1;
    const n = cols.filter((c) => getComputedStyle(c).display !== 'none').length;
    return Math.min(Math.max(n, 1), 3);
  }
  const windowStart = (k) => Math.min(active, 5 - k);

  function setWindows() {
    const w2 = active < 4 ? [active, active + 1] : [3, 4];
    const s3 = Math.min(active, 2);
    const w3 = [s3, s3 + 1, s3 + 2];
    [cols, heads].forEach((list) =>
      list.forEach((c, i) => {
        c.classList.toggle('in-2', w2.includes(i));
        c.classList.toggle('in-3', w3.includes(i));
        c.classList.toggle('is-active', i === active);
      }),
    );
    dayBtns.forEach((b, i) => b.setAttribute('aria-pressed', String(i === active)));
  }

  function showStatus(text, retry) {
    status.replaceChildren(text, retry ? h('button.linklike', { type: 'button', text: 'Réessayer', on: { click: retry } }) : '');
    status.hidden = !text;
  }

  async function render(dir = 0) {
    const token = ++renderToken;
    const today = D.todayKey();
    cols.forEach((col, i) => {
      const key = D.addDays(monday, i);
      const isToday = key === today;
      col.classList.toggle('is-today', isToday);
      col.setAttribute('aria-label', D.dayTitle(key));
      $('b', heads[i]).textContent = D.dayNumber(key);
      heads[i].classList.toggle('is-today', isToday);
      $('b', dayBtns[i]).textContent = D.dayNumber(key);
      dayBtns[i].classList.toggle('is-today', isToday);
      dayBtns[i].setAttribute('aria-label', D.dayTitle(key));
    });
    labels();

    const loaded = chunks.has(chunkOf(monday)) && byDay.size > 0;
    if (!loaded) tile.classList.add('is-loading');
    try {
      await ensureWeek(monday);
      showStatus('');
    } catch (error) {
      if (token !== renderToken) return;
      tile.classList.remove('is-loading');
      cols.forEach((col) => col.replaceChildren());
      showStatus(`ADE ne répond pas (${error.message}). `, () => render());
      return;
    }
    if (token !== renderToken) return;
    tile.classList.remove('is-loading');
    // Les blocs voisins sont préchargés pour une navigation instantanée.
    loadChunk(chunkOf(D.addDays(monday, 7 * CHUNK_WEEKS))).catch(() => {});
    loadChunk(chunkOf(D.addDays(monday, -7))).catch(() => {});

    cols.forEach((col, i) => {
      col.replaceChildren();
      const key = D.addDays(monday, i);
      const events = eventsOn(key);
      layoutDay(col, events, key);
      if (!events.length && i === active && weekEvents(monday).length) col.append(dayEmpty(key));
    });
    matcher.resolve(weekEvents(monday), () => token === renderToken && refreshChips());

    const empty = !weekEvents(monday).some((ev) => D.weekday(ev.day) < 5);
    note.hidden = !empty;
    if (empty) {
      const [, m, d] = monday.split('-').map(Number);
      const holiday = (m === 12 && d >= 18) || (m === 1 && d <= 3) || m === 7 || m === 8;
      note.dataset.kind = holiday ? 'holiday' : 'company';
      $('[data-week-note-title]', note).textContent = holiday ? 'Vacances' : 'Pas de cours à l’école';
      const text = $('[data-week-note-text]', note);
      text.textContent = 'Recherche du prochain cours…';
      nextSchoolWeek(monday).then((mon) => {
        if (token !== renderToken) return;
        text.textContent = mon
          ? `Aucun cours de ${promo} cette semaine. Retour à ISIS le lundi ${D.dayTitle(mon).split(' ').slice(1).join(' ')}.`
          : `Aucun cours de ${promo} n’est encore prévu dans ADE.`;
      }, () => (text.textContent = `Aucun cours de ${promo} cette semaine.`));
    }
    if (dir) restartClass(body, dir > 0 ? 'week-in-right' : 'week-in-left');
    renderSync();
    tick();
  }

  function renderSync() {
    const at = fetchedAt.get(chunkOf(monday));
    sync.hidden = !at;
    if (!at) return;
    sync.classList.remove('is-busy');
    sync.replaceChildren(icon('retry', 'ic ic--xs'), (Date.now() - at < 60000 ? 'À jour' : `il y a ${D.ago(at)}`));
    sync.title = `Emploi du temps lu dans ADE ${D.ago(at, true)} · cliquer pour actualiser`;
    sync.setAttribute('aria-label', sync.title);
  }
  sync.addEventListener('click', async () => {
    if (sync.classList.contains('is-busy')) return;
    sync.classList.add('is-busy');
    sync.textContent = 'Mise à jour…';
    // On relit le bloc affiché ; les autres seront relus en y naviguant.
    const keep = chunks;
    chunks = new Map([...keep].filter(([i]) => i !== chunkOf(monday)));
    await render();
    onData?.();
  });
  setInterval(() => !sync.classList.contains('is-busy') && renderSync(), 30_000);

  function refreshChips() {
    for (const el of $$('.ev', tile)) el.remove();
    cols.forEach((col, i) => {
      const key = D.addDays(monday, i);
      const empty = $('.day-empty', col);
      layoutDay(col, eventsOn(key), key);
      if (empty) col.append(empty);
    });
    tick();
  }

  // ------------------------------------------------------- « maintenant »

  function tick() {
    const now = new Date();
    const { key, minutes } = D.paris(now);
    const col = cols.findIndex((_, i) => D.addDays(monday, i) === key);
    const visible = col >= 0 && minutes >= GRID_START && minutes < GRID_END;
    nowline.hidden = nowTag.hidden = !visible;
    if (visible) {
      if (nowline.parentElement !== cols[col]) cols[col].append(nowline);
      const slot = minutes - (minutes % 5);
      for (const el of [nowline, nowTag]) {
        el.style.setProperty('grid-row-start', String((slot - GRID_START) / 5 + 1));
        el.style.setProperty('--m', String(minutes - slot));
      }
      nowTag.textContent = D.hhmm(minutes);
    }
    for (const el of $$('.ev', tile)) {
      const day = D.addDays(monday, cols.indexOf(el.closest('.day-col')));
      const s = Number(el.dataset.start);
      const e = Number(el.dataset.end);
      const isNow = !el.dataset.lunch && day === key && s <= minutes && minutes < e;
      el.classList.toggle('is-now', isNow);
      el.classList.toggle('is-past', day < key || (day === key && e <= minutes));
      const live = $('.live', el);
      const bar = $('.bar', el);
      if (!isNow) {
        live?.remove();
        bar?.remove();
        continue;
      }
      if (!live) $('.ev-top', el).append(h('span.live', {}, h('span.live-dot', { attrs: { 'aria-hidden': 'true' } }), 'En cours'));
      const fill = $('.bar-fill', el) ?? $('.ev-foot', el).appendChild(h('span.bar', { attrs: { 'aria-hidden': 'true' } }, h('span.bar-fill'))).firstChild;
      fill.style.setProperty('--p', `${(((minutes - s) / (e - s)) * 100).toFixed(1)}%`);
    }
  }

  function scrollToNow() {
    if (nowline.hidden || cal.scrollHeight <= cal.clientHeight + 4) return;
    const y = nowline.getBoundingClientRect().top - cal.getBoundingClientRect().top + cal.scrollTop - 110;
    cal.scrollTo({ top: Math.max(0, y), behavior: motionOK() ? 'smooth' : 'auto' });
  }

  // ------------------------------------------------------- navigation

  function setView(v, animate = true) {
    if (tile.dataset.view === v) return;
    tile.dataset.view = v;
    seg.dataset.active = v;
    $$('.seg-btn', seg).forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.viewBtn === v)));
    if (animate) restartClass(cal, 'cal-anim');
    if (!tile.classList.contains('is-expanded') && !phoneMQ.matches) prefs.set('edtView', v);
    labels();
    if (v === 'day') render();
  }

  function setWeek(mon, dir) {
    monday = mon;
    return render(dir);
  }

  function setDay(i, dir = 0) {
    if (i > 4) return setWeek(D.addDays(monday, 7), 0).then(() => setDay(0, dir));
    if (i < 0) return setWeek(D.addDays(monday, -7), 0).then(() => setDay(4, dir));
    const changed = i !== active;
    cols[active].classList.remove('slide-from-right', 'slide-from-left');
    active = i;
    setWindows();
    if (dir && changed) {
      cols.forEach((c) => {
        if (c.classList.contains('in-3') || c.classList.contains('is-active')) restartClass(c, dir > 0 ? 'slide-from-right' : 'slide-from-left');
      });
    }
    labels();
    // l'état « aucun cours ce jour » dépend du jour affiché
    $$('.day-empty', tile).forEach((e) => e.remove());
    const key = D.addDays(monday, active);
    if (!eventsOn(key).length && weekEvents(monday).length && chunks.has(chunkOf(monday))) cols[active].append(dayEmpty(key));
  }

  /** Flèches : une semaine en vue semaine ; en vue jour, autant de jours qu'il y en a d'affichés. */
  function step(n) {
    if (tile.dataset.view === 'week') return setWeek(D.addDays(monday, 7 * n), n);
    const k = visibleDays();
    if (k === 1) return setDay(active + n, n);
    const start = windowStart(k);
    if (n > 0) {
      if (start + k <= 4) return setDay(start + k, 1); // fenêtre suivante dans la semaine
      return setWeek(D.addDays(monday, 7), 0).then(() => setDay(0, 1));
    }
    if (start > 0) return setDay(Math.max(start - k, 0), -1);
    return setWeek(D.addDays(monday, -7), 0).then(() => setDay(5 - k, -1));
  }

  /** Aujourd'hui, ou le lundi suivant pendant le week-end. */
  function home() {
    const today = D.todayKey();
    const wd = D.weekday(today);
    return wd >= 5 ? { mon: D.addDays(D.mondayOf(today), 7), day: 0 } : { mon: D.mondayOf(today), day: wd };
  }

  async function goToday() {
    const { mon, day } = home();
    const dir = mon === monday ? Math.sign(day - active) : Math.sign(D.daysBetween(monday, mon));
    if (mon !== monday) await setWeek(mon, tile.dataset.view === 'week' ? dir : 0);
    setDay(day, tile.dataset.view === 'day' ? dir : 0);
    requestAnimationFrame(scrollToNow);
  }

  // ------------------------------------------------------- plein écran

  const others = () => $$('.bento > .tile').filter((t) => t !== tile);
  function expand() {
    if (tile.classList.contains('is-expanded')) return;
    const first = tile.getBoundingClientRect();
    ghost = h('div.tile-ghost', { class: (tile.className.match(/\b(cw|rh)-\d+\b/g) || []).join(' ') });
    tile.after(ghost);
    viewBeforeExpand = tile.dataset.view;
    tile.classList.add('is-expanded');
    app.classList.add('has-expanded');
    others().forEach((t) => (t.inert = true));
    lockScroll(true);
    setView('week', false); // le plein écran reste en vue semaine
    $$('.seg-btn', seg).forEach((b) => (b.disabled = true));
    expandBtn.setAttribute('aria-pressed', 'true');
    expandBtn.setAttribute('aria-label', 'Quitter le plein écran');
    const last = tile.getBoundingClientRect();
    if (motionOK()) {
      tile.animate([{ clipPath: clipFrom(first, last, 22) }, { clipPath: 'inset(0px 0px 0px 0px round 22px)' }], { duration: 560, easing: EASE });
      cal.animate([{ opacity: 0, transform: 'scale(.985)' }, { opacity: 1, transform: 'none' }], { duration: 420, delay: 140, easing: EASE, fill: 'backwards' });
    } else tile.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 220 });
    expandBtn.focus();
  }

  function collapse() {
    if (!tile.classList.contains('is-expanded')) return;
    const finish = () => {
      tile.classList.remove('is-expanded');
      ghost?.remove();
      ghost = null;
      others().forEach((t) => (t.inert = false));
      lockScroll(false);
      $$('.seg-btn', seg).forEach((b) => (b.disabled = false));
      setView(phoneMQ.matches ? 'day' : viewBeforeExpand, false);
      expandBtn.setAttribute('aria-pressed', 'false');
      expandBtn.setAttribute('aria-label', 'Afficher en plein écran');
      if (motionOK()) cal.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 260, easing: EASE });
      expandBtn.focus();
    };
    app.classList.remove('has-expanded');
    if (motionOK() && ghost) {
      const to = ghost.getBoundingClientRect();
      const cur = tile.getBoundingClientRect();
      const fade = cal.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 200, fill: 'forwards' });
      tile.animate([{ clipPath: 'inset(0px 0px 0px 0px round 22px)' }, { clipPath: clipFrom(to, cur, 22) }], { duration: 400, easing: EASE_IO }).onfinish = () => {
        fade.cancel();
        finish();
      };
    } else finish();
  }

  // ------------------------------------------------------- événements

  $$('[data-view-btn]', tile).forEach((b) => b.addEventListener('click', () => setView(b.dataset.viewBtn)));
  $$('[data-nav]', tile).forEach((b) =>
    b.addEventListener('click', () => {
      const n = Number(b.dataset.nav);
      if (n === 0) goToday();
      else step(n);
    }),
  );
  dayBtns.forEach((b, i) => b.addEventListener('click', () => setDay(i, i > active ? 1 : -1)));
  $('[data-week-note-next]', tile).addEventListener('click', () => setWeek(D.addDays(monday, 7), 1));
  tile.addEventListener('keydown', (e) => {
    if (isTyping(e.target) || e.target.closest('a, button:not(.ds-btn)')) return;
    if (e.key === 'ArrowRight') {
      e.preventDefault();
      step(1);
    }
    if (e.key === 'ArrowLeft') {
      e.preventDefault();
      step(-1);
    }
  });
  expandBtn.addEventListener('click', () => (tile.classList.contains('is-expanded') ? collapse() : expand()));

  // Glisser gauche / droite (écran tactile) : change de jour, et de semaine aux extrémités.
  let sx = 0;
  let sy = 0;
  let dragging = false;
  let axis = null;
  body.addEventListener('pointerdown', (e) => {
    if (tile.dataset.view !== 'day' || e.pointerType === 'mouse') return;
    sx = e.clientX;
    sy = e.clientY;
    dragging = true;
    axis = null;
  });
  body.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const dx = e.clientX - sx;
    const dy = e.clientY - sy;
    if (axis === null && Math.abs(dx) + Math.abs(dy) > 8) axis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
    if (axis !== 'x') return;
    cols[active].style.setProperty('transform', `translateX(${dx * 0.6}px)`);
    cols[active].style.setProperty('opacity', String(1 - Math.min(Math.abs(dx) / 500, 0.35)));
  });
  const endSwipe = (e) => {
    if (!dragging) return;
    dragging = false;
    const dx = e.clientX - sx;
    cols[active].style.removeProperty('transform');
    cols[active].style.removeProperty('opacity');
    if (axis === 'x' && Math.abs(dx) > 48) setDay(active + (dx < 0 ? 1 : -1), dx < 0 ? 1 : -1);
  };
  body.addEventListener('pointerup', endSwipe);
  body.addEventListener('pointercancel', endSwipe);

  setInterval(tick, 15_000);
  phoneMQ.addEventListener('change', () => {
    if (!tile.classList.contains('is-expanded')) setView(phoneMQ.matches ? 'day' : prefs.get('edtView', 'day'), false);
  });

  return {
    collapse,
    isExpanded: () => tile.classList.contains('is-expanded'),
    upcoming,
    eventsOn,
    between,
    /** (Re)démarre pour une classe : vide le cache et revient à aujourd'hui. */
    async start(newPromo, newChoice = {}) {
      promo = newPromo;
      choice = newChoice;
      chunks = new Map();
      byDay = new Map();
      fetchedAt.clear();
      const { mon, day } = home();
      monday = mon;
      active = day;
      tile.dataset.view = 'day';
      seg.dataset.active = 'day';
      setView(phoneMQ.matches ? 'day' : prefs.get('edtView', 'day'), false);
      setWindows();
      await render();
      requestAnimationFrame(() => requestAnimationFrame(scrollToNow));
    },
    /** Redessine la semaine affichée (nouvelles correspondances Moodle, déconnexion). */
    rerender: () => (promo ? render() : undefined),
  };
}
