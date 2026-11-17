// Tuile « Notes » et vue « Mes notes » : saisie des notes, moyennes par UE et par semestre,
// rattrapages repérés, mode simulation et « Viser une moyenne ». La maquette (UE, matières,
// coefficients, évaluations prévues) est publiée par l'administration pour chaque classe ; les
// notes saisies restent à l'étudiant (core/userdata.js : chiffrées, sauvegarde anonyme).
// Interface et comportements repris de la maquette « 08-notes ».

import { $, $$, h, icon, toast, restartClass, clipFrom, lockScroll, motionOK, EASE, EASE_IO } from '../core/dom.js';
import { createGrades, f2, fN, f1up, pw, shortDate } from '../core/grades.js';
import * as UD from '../core/userdata.js';
import * as D from '../core/dates.js';
import { modal, closeMenus } from './layout.js';

/** el('span', 'classe', 'texte') : raccourci de la maquette. */
const el = (tag, cls = '', text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined && text !== null) e.textContent = text;
  return e;
};
const SYNC_TEXT = {
  off: 'Sur cet appareil',
  syncing: 'Sauvegarde…',
  ok: 'Sauvegardé, chiffré',
  error: 'Sauvegarde en attente',
};

let bookPromise = null;
function loadBook(force = false) {
  if (!bookPromise || force) {
    bookPromise = fetch('api/grades', { credentials: 'omit', cache: 'no-cache' })
      .then((r) => (r.ok ? r.json() : {}))
      .catch(() => {
        bookPromise = null;
        return null;
      });
  }
  return bookPromise;
}

export function createNotes({ app, beforeOpen, isSignedIn }) {
  const nTile = $('[data-notes-tile]');
  const nView = $('[data-notes-view]');
  const bento = $('[data-bento]');
  const tileBody = $('[data-nt-body]', nTile);
  const main = $('[data-nv-main]', nView);
  const aside = $('[data-nv-aside]', nView);
  const syncChip = $('[data-nv-sync]', nView);

  let promo = null;
  let def = null;
  let waitMessage = ''; // notes désactivées pour la classe : message de l'administration
  let N = null; // carnet (core/grades.js)
  let semId = null;
  let viewOpen = false;
  const listeners = new Set();

  // ------------------------------------------------------------ données

  const savedFor = (p) => UD.get('notes')?.[p] ?? null;
  function save() {
    const all = { ...(UD.get('notes') ?? {}) };
    all[promo] = N.dump();
    UD.set('notes', all);
    listeners.forEach((fn) => fn());
  }
  function build() {
    if (!def) {
      N = null;
      return;
    }
    const years = def.semesters.flatMap((s) => [s.start?.slice(0, 4), s.end?.slice(0, 4)]).filter(Boolean).sort();
    N = createGrades(def, { saved: savedFor(promo), today: D.todayKey(), year: `${promo} · ${years[0]}-${years.at(-1)}` });
    if (!N.semById(semId)) semId = N.currentSem().id;
  }

  async function load(newPromo) {
    promo = newPromo;
    const book = await loadBook();
    const entry = book?.[promo] ?? null;
    waitMessage = entry?.disabled ? entry.message || '' : '';
    def = entry && !entry.disabled && entry.semesters?.length ? entry : null;
    if (!def && viewOpen) closeView();
    semId = null;
    build();
    renderAll();
  }
  UD.onUserData((touched) => {
    if (!touched.includes('notes') || !def) return;
    const wasSim = N?.simOn;
    build();
    if (wasSim) N.simOn = true;
    renderAll();
  });
  UD.onSyncStatus(renderSync);
  function renderSync() {
    const st = UD.syncStatus();
    syncChip.hidden = !N;
    syncChip.className = `nv-sync is-${st}`;
    syncChip.replaceChildren(icon(st === 'ok' ? 'cloud' : st === 'error' ? 'alert' : 'lock', 'ic ic--xs'), el('span', 'label-md', SYNC_TEXT[st]));
    syncChip.title =
      st === 'off'
        ? 'Tes notes sont chiffrées sur cet appareil. Connecte-toi pour les retrouver sur tes autres appareils.'
        : st === 'error'
          ? 'La sauvegarde n’a pas pu être envoyée : nouvel essai à la prochaine modification.'
          : 'Chiffrées dans ton navigateur avant l’envoi : ISIS Hub ne peut ni les lire ni savoir à qui elles sont.';
  }

  // ------------------------------------------------------------ mise en forme

  function bar(v, marks, cls = '') {
    const b = el('span', `nbar ${cls}`);
    b.setAttribute('aria-hidden', 'true');
    b.append(el('span', `nbar-fill ${pw(v)}`));
    marks.forEach((m) => {
      const mk = el('span', 'nbar-mark');
      mk.style.setProperty('left', `${(m / 20) * 100}%`);
      b.append(mk);
    });
    return b;
  }
  const pill = (kind, txt) => el('span', `npill npill--${kind}`, txt);
  const coefTxt = (c) => `coef ${fN(c)}`;
  const nameOf = (e) => N.MAT[e.mat].name;

  // ------------------------------------------------------------ tuile

  /** Classe sans maquette, ou notes désactivées par l'administration : message d'attente. */
  function renderEmptyTile() {
    $('[data-nt-sem]', nTile).hidden = true;
    $('[data-open-notes]', nTile).hidden = true;
    tileBody.replaceChildren(
      h(
        'div.empty.nt-empty.nt-wait',
        {},
        h('span.empty-ic', {}, icon('clock', 'ic ic--lg')),
        h('h3', { text: promo ? 'Tes notes arrivent bientôt' : 'Choisis ta classe' }),
        h('p', {
          text:
            waitMessage ||
            'Ta maquette de notes n’a pas encore été saisie. Le système de notes sera disponible très bientôt : merci de ta patience !',
        }),
        promo ? h('span.chip.nt-wait-chip', {}, icon('lock', 'ic ic--xs'), 'Tes notes resteront privées et chiffrées') : null,
      ),
    );
  }

  function renderTile() {
    if (!N) return renderEmptyTile();
    const S = N.currentSem();
    const wasSim = N.simOn;
    if (wasSim) N.simOn = false; // la tuile montre toujours les vraies notes
    const st = N.semState(S);
    $('[data-nt-sem]', nTile).hidden = false;
    $('[data-nt-sem]', nTile).textContent = S.short;
    $('[data-open-notes]', nTile).hidden = false;
    const open = el('button', 'nt-open');
    open.type = 'button';
    open.dataset.openNotes = '';
    open.setAttribute('aria-label', `Ouvrir mes notes. Moyenne ${S.label} : ${f2(st.a)}. ${st.label}.`);
    const top = el('span', 'nt-top');
    const big = el('span', 'nt-avg');
    big.append(el('span', 'nt-k', `Moyenne ${S.short}`));
    const num = el('span', 'nt-big');
    num.append(el('b', '', f2(st.a)), el('span', '', '/20'));
    big.append(num);
    top.append(big, pill(st.kind, st.label));
    // une ligne par UE : état, nom en clair, moyenne ; la raison du rattrapage dessous
    const ues = el('span', 'nt-ues');
    S.ues.forEach((U) => {
      const a = N.avgU(U);
      const su = N.stU(U);
      const r = el('span', `nt-ue is-${su}`);
      r.append(su === 'none' ? el('span', 'nt-dot') : icon(su === 'fail' ? 'alert' : 'check', 'ic ic--sm nt-ue-ic'));
      const nm = el('span', 'nt-ue-n');
      nm.append(el('span', 'nt-ue-name', U.name));
      if (su === 'fail') {
        const low = U.matieres.filter((M) => N.stM(M) === 'fail').map((M) => M.name);
        nm.append(el('span', 'nt-ue-why', a !== null && a < N.RULE_UE ? `Moyenne sous ${fN(N.RULE_UE)}` : `${low.join(', ')} sous ${fN(N.RULE_M)}`));
      }
      r.append(nm, el('b', `nt-ue-v${a !== null && a < N.RULE_UE ? ' is-low' : ''}`, su === 'none' ? '—' : f2(a)));
      ues.append(r);
    });
    const last = N.lastGrades(S, 3);
    const lt = el('span', 'nt-last');
    if (last.length) {
      lt.append(el('span', 'nt-k', 'Dernières notes'));
      last.forEach((e) => {
        const g = el('span', 'nt-g');
        g.append(el('span', '', `${e.label} · ${nameOf(e)}`), el('b', N.real[e.id] < N.RULE_M ? 'is-low' : '', fN(N.real[e.id])));
        lt.append(g);
      });
    }
    open.append(top, ues);
    if (last.length) open.append(lt);
    const foot = el('div', 'nt-foot');
    const nx = N.nextEval(S);
    const next = el('p', `nt-next${nx && N.isSoon(nx) ? ' is-soon' : ''}`);
    if (nx) next.append(el('span', 'nt-k', 'Prochaine'), el('span', 'nt-next-t', `${nx.label} · ${nameOf(nx)}`), el('b', '', shortDate(nx.date)));
    else next.append(el('span', 'nt-k', 'Aucune évaluation à venir'));
    const add = el('button', 'btn btn--sm nt-add');
    add.type = 'button';
    add.dataset.noteAdd = '';
    add.append(icon('plus', 'ic ic--sm'), 'Note');
    foot.append(next, add);
    tileBody.replaceChildren(open, foot);
    if (wasSim) N.simOn = true;
  }

  // ------------------------------------------------------------ vue complète

  function evalChip(e) {
    const v = N.val(e);
    const isSim = N.simOn && N.has(N.sim[e.id]);
    if ((N.simOn && !N.has(N.real[e.id]) && !e.extra) || (N.simOn && e.sim)) {
      const lab = el('label', `ng is-input${N.has(N.sim[e.id]) ? ' is-sim' : ''}`);
      lab.append(el('span', 'ng-l', e.label));
      const inp = el('input', 'ng-in');
      inp.type = 'text';
      inp.inputMode = 'decimal';
      inp.placeholder = '?';
      inp.dataset.simIn = e.id;
      inp.value = N.has(N.sim[e.id]) ? fN(N.sim[e.id]) : '';
      inp.setAttribute('aria-label', `${e.label}, ${nameOf(e)} : note simulée sur 20`);
      lab.append(inp, el('span', 'ng-c', `×${fN(e.coef)}`));
      return lab;
    }
    if (!N.has(v)) {
      const b = el('button', 'ng is-planned');
      b.type = 'button';
      b.dataset.slot = e.id;
      b.setAttribute('aria-label', `Saisir la note : ${e.label}, ${nameOf(e)}${e.date ? `, prévu le ${shortDate(e.date)}` : ''}`);
      b.append(el('span', 'ng-l', e.label), el('span', 'ng-d', shortDate(e.date) || 'à venir'), icon('plus', 'ic ic--xs'));
      if (N.isDue(e)) b.classList.add('is-due');
      return b;
    }
    const b = el('button', `ng${v < N.RULE_M ? ' is-low' : ''}${isSim ? ' is-sim' : ''}`);
    b.type = 'button';
    b.dataset.evalEdit = e.id;
    b.setAttribute('aria-label', `${e.label} : ${fN(v)} sur 20, coef ${fN(e.coef)}. Modifier`);
    b.append(el('span', 'ng-l', e.label), el('b', 'ng-v', fN(v)), el('span', 'ng-c', `×${fN(e.coef)}`));
    return b;
  }

  function renderMain(S) {
    const frag = [];
    S.ues.forEach((U) => {
      const a = N.avgU(U);
      const st = N.stU(U);
      const card = el('section', `nv-ue is-${st}`);
      const hid = `nv-ue-${U.id.replace(/[^A-Za-z0-9-]/g, '-')}`;
      card.setAttribute('aria-labelledby', hid);
      const head = el('header', 'nv-ue-head');
      const t = el('div', 'nv-ue-t');
      t.append(el('p', 'nv-ue-k', `UE ${U.id} · ${coefTxt(U.coef)}`));
      const hh = el('h3', '', U.name);
      hh.id = hid;
      t.append(hh);
      const right = el('div', 'nv-ue-avg');
      right.append(el('b', '', f2(a)));
      const failM = U.matieres.filter((M) => N.stM(M) === 'fail');
      right.append(
        st === 'fail'
          ? pill('fail', a !== null && a < N.RULE_UE ? `Sous ${fN(N.RULE_UE)}` : `Matière sous ${fN(N.RULE_M)}`)
          : st === 'ok'
            ? pill('ok', 'Validée si ça tient')
            : pill('none', 'Pas de note'),
      );
      if (st === 'ok' && !U.matieres.some((M) => N.evalsOf(M).some((e) => !N.has(N.val(e))))) right.lastChild.textContent = 'Validée';
      head.append(t, right);
      card.append(head, bar(a, [N.RULE_UE], 'nbar--ue'));
      const ul = el('ul', 'nv-mats');
      U.matieres.forEach((M) => {
        const m = N.avgM(M);
        const sm = N.stM(M);
        const li = el('li', `nv-mat is-${sm}`);
        const mh = el('div', 'nv-mat-h');
        const nm = el('p', 'nv-mat-n');
        nm.append(el('b', '', M.name), el('span', 'nv-coef', coefTxt(M.coef)));
        const av = el('p', 'nv-mat-a');
        av.append(el('b', '', fN(m === null ? null : Math.round(m * 100) / 100)));
        if (sm === 'fail') av.append(pill('fail', `sous ${fN(N.RULE_M)}`));
        mh.append(nm, av);
        const evs = el('div', 'nv-evals');
        N.evalsOf(M).forEach((e) => evs.append(evalChip(e)));
        const add = el('button', 'ng-add');
        add.type = 'button';
        add.dataset.addMat = M.id;
        add.setAttribute('aria-label', `Ajouter une note en ${M.name}`);
        add.append(icon('plus', 'ic ic--sm'));
        evs.append(add);
        li.append(mh, evs);
        ul.append(li);
      });
      card.append(ul);
      if (failM.length && a !== null && a >= N.RULE_UE) {
        card.append(el('p', 'nv-ue-note', `Moyenne au-dessus de ${fN(N.RULE_UE)}, mais ${failM.map((M) => M.name).join(', ')} sous ${fN(N.RULE_M)} : l’UE passe en rattrapage.`));
      }
      frag.push(card);
    });
    main.replaceChildren(...frag);
  }

  function renderAside(S) {
    const st = N.semState(S);
    const p = N.progress(S);
    const sum = el('section', `nv-card nv-sum is-${st.kind}`);
    sum.append(el('p', 'nv-k', `${S.label} · ${N.simOn ? 'avec la simulation' : 'moyenne générale'}`));
    const big = el('p', 'nv-big');
    big.append(el('b', '', f2(st.a)), el('span', '', '/20'));
    sum.append(big, bar(st.a, [N.RULE_UE], 'nbar--lg'));
    const v = el('p', `nv-verdict is-${st.kind}`);
    v.append(
      icon(st.kind === 'fail' ? 'alert' : 'check', 'ic ic--sm'),
      el(
        'span',
        '',
        st.kind === 'fail'
          ? `${st.label} : ${st.failing.map((U) => U.id).join(' et ')}`
          : st.kind === 'ok'
            ? 'En bonne voie : si ça tient, semestre validé'
            : st.label,
      ),
    );
    if (st.kind !== 'none') sum.append(v);
    const pr = el('p', 'nv-prog');
    const tot = N.allEvals(S).length;
    pr.append(el('span', '', `${tot - st.rest} notes sur ${tot}`), el('span', '', `${Math.round(p * 100)} % du semestre noté`));
    sum.append(pr);
    const out = [sum];

    const items = N.coach(S);
    const co = el('section', 'nv-card nv-coach');
    co.append(el('h3', '', 'À surveiller'));
    if (!items.length) {
      co.append(
        el(
          'p',
          'nv-none',
          st.kind === 'none' ? 'Ajoute tes premières notes pour voir où tu en es.' : `Tout est au-dessus des seuils (${fN(N.RULE_UE)} par UE, ${fN(N.RULE_M)} par matière).`,
        ),
      );
    } else {
      const ul = el('ul', 'nv-coach-l');
      items.forEach((it) => {
        const li = el('li', `nv-tip is-${it.tone}`);
        const need =
          it.tone === 'warn' && it.n && it.n.state === 'need'
            ? `Pour rester à ${fN(N.RULE_UE)} : au moins ${f1up(it.n.x)} ${it.n.rem.length > 1 ? `de moyenne sur les ${it.n.rem.length} évaluations restantes` : 'à la dernière évaluation'}.`
            : N.needLine(it.n);
        li.append(el('b', '', it.t), el('span', '', it.s), el('p', 'nv-need', need));
        if (it.n && it.n.state === 'need' && it.tone === 'err') {
          const b = el('button', 'btn btn--sm nv-tip-sim');
          b.type = 'button';
          b.dataset.simScenario = it.key;
          b.append(icon('spark', 'ic ic--sm'), `Simuler avec ${f1up(it.n.x)}`);
          li.append(b);
        }
        ul.append(li);
      });
      co.append(ul);
    }
    out.push(co);

    // Année : tous les semestres
    const ys = N.yearState();
    const yr = el('section', 'nv-card nv-year');
    yr.append(el('h3', '', N.year));
    const rows = el('ul', 'nv-year-l');
    ys.rows.forEach(({ S: s2, st: st2 }) => {
      const li = el('li', `is-${st2.kind}${s2.id === S.id ? ' is-cur' : ''}`);
      const sb = el('button', 'nv-year-b');
      sb.type = 'button';
      sb.dataset.sem = s2.id;
      sb.append(
        el('span', '', s2.label),
        el('span', 'nv-year-p', s2.period),
        el('b', '', f2(st2.a)),
        pill(st2.kind, st2.kind === 'none' ? 'À venir' : st2.kind === 'fail' ? 'Rattrapage' : st2.kind === 'done' ? 'Validé' : 'En cours'),
      );
      li.append(sb);
      rows.append(li);
    });
    yr.append(rows);
    const notStarted = ys.rows.filter((r) => r.st.kind === 'none').map((r) => r.S.short);
    const yv = el('p', `nv-year-v is-${ys.anyFail ? 'fail' : ys.allDone ? 'done' : 'ok'}`);
    yv.append(
      el('span', '', 'Année'),
      el('b', '', f2(ys.a)),
      el(
        'span',
        '',
        ys.anyFail
          ? 'Pas encore : rattrapage à passer'
          : ys.allDone
            ? 'Année validée'
            : ys.anyNone
              ? `En cours : ${notStarted.join(', ')} ${notStarted.length > 1 ? 'n’ont' : 'n’a'} pas commencé`
              : 'En cours',
      ),
    );
    yr.append(yv);
    out.push(yr);

    const priv = el('p', 'nv-priv');
    priv.append(
      icon('check', 'ic ic--xs'),
      UD.isConnected()
        ? 'Tes notes sont chiffrées dans ton navigateur, puis sauvegardées anonymement : personne d’autre, pas même ISIS Hub, ne peut les lire.'
        : 'Tes notes sont chiffrées sur cet appareil. Connecte-toi pour les retrouver sur tes autres appareils.',
    );
    out.push(priv);
    aside.replaceChildren(...out);
  }

  function renderSems() {
    const seg = $('[data-nv-sem]', nView);
    const sems = N.G.semesters;
    seg.classList.toggle('nv-sem--n', sems.length !== 2);
    seg.hidden = sems.length < 2;
    seg.replaceChildren(
      ...sems.map((s) => {
        const b = el('button', 'seg-btn', s.label);
        b.type = 'button';
        b.dataset.sem = s.id;
        b.setAttribute('aria-pressed', String(s.id === semId));
        return b;
      }),
      ...(sems.length === 2 ? [Object.assign(el('span', 'seg-thumb'), { ariaHidden: 'true' })] : []),
    );
    seg.dataset.active = semId === sems[0].id ? 'day' : 'week';
  }

  function renderView() {
    if (!N) return;
    const S = N.semById(semId);
    nView.classList.toggle('is-sim', N.simOn);
    $('[data-sim-bar]', nView).hidden = !N.simOn;
    $('[data-sim-toggle]', nView).checked = N.simOn;
    renderSems();
    const focusSim = document.activeElement?.dataset?.simIn ?? null;
    renderMain(S);
    renderAside(S);
    renderSync();
    if (N.simOn) {
      const st = N.semState(S);
      const r = $('[data-sim-res]', nView);
      r.className = `nv-simres is-${st.kind}`;
      r.replaceChildren(
        el('span', '', `${S.short} `),
        el('b', '', f2(st.a)),
        el('span', '', st.kind === 'fail' ? ` · ${st.label}` : st.kind === 'none' ? '' : st.kind === 'ok' ? ' · en bonne voie' : ' · semestre validé'),
      );
    }
    if (focusSim) {
      const f = $(`[data-sim-in="${focusSim}"]`, nView);
      if (f) {
        f.focus();
        const n = f.value.length;
        f.setSelectionRange(n, n);
      }
    }
  }
  const renderAll = () => {
    renderTile();
    if (viewOpen) renderView();
  };

  // ------------------------------------------------------------ ouvrir / fermer

  function openView(animate = true) {
    if (!N || viewOpen) return;
    closeMenus();
    beforeOpen?.();
    viewOpen = true;
    renderView();
    nView.hidden = false;
    app.classList.add('has-overlay', 'notes-open');
    bento.inert = true;
    lockScroll(true);
    $('.nv-scroll', nView).scrollTop = 0;
    if (animate && motionOK() && !nTile.hidden && nTile.getBoundingClientRect().width) {
      const first = nTile.getBoundingClientRect();
      const last = nView.getBoundingClientRect();
      nView.animate([{ clipPath: clipFrom(first, last, 22), opacity: 0.85 }, { clipPath: 'inset(0px 0px 0px 0px round 22px)', opacity: 1 }], { duration: 520, easing: EASE });
      restartClass(nView, 'nv-anim');
    } else if (animate) nView.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 200 });
    $('[data-notes-close]', nView).focus({ preventScroll: true });
  }

  function closeView() {
    if (!viewOpen) return;
    viewOpen = false;
    const done = () => {
      nView.hidden = true;
      lockScroll(false);
      app.classList.remove('notes-open');
      if (N?.simOn) N.simOn = false;
      renderAll();
      const back = $('.nt-open', nTile);
      if (back && !nTile.hidden) back.focus({ preventScroll: true });
    };
    app.classList.remove('has-overlay');
    bento.inert = false;
    if (motionOK() && !nTile.hidden) {
      nTile.scrollIntoView({ block: 'nearest' });
      const last = nView.getBoundingClientRect();
      const to = nTile.getBoundingClientRect();
      nView.animate([{ clipPath: 'inset(0px 0px 0px 0px round 22px)', opacity: 1 }, { clipPath: clipFrom(to, last, 22), opacity: 0.2 }], { duration: 380, easing: EASE_IO }).onfinish = done;
    } else nView.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 160 }).onfinish = done;
  }

  function setSim(on) {
    N.simOn = on;
    renderView();
    if (on && motionOK()) $('[data-sim-bar]', nView).animate([{ opacity: 0, transform: 'translateY(-6px)' }, { opacity: 1, transform: 'none' }], { duration: 260, easing: EASE });
  }
  function runScenario(ids, x) {
    ids.forEach((id) => (N.sim[id] = x));
    if (!N.simOn) setSim(true);
    else renderView();
    toast(`Simulation : ${f1up(x)} sur ${ids.length > 1 ? `${ids.length} évaluations` : '1 évaluation'}`);
  }

  // ------------------------------------------------------------ saisie d'une note

  const nadd = $('[data-nadd]');
  const addM = modal(nadd);
  const form = $('[data-nadd-form]', nadd);
  const selM = $('[data-nadd-mat]', nadd);
  const slots = $('[data-nadd-slots]', nadd);
  const label = $('[data-nadd-label]', nadd);
  const vIn = $('[data-nadd-val]', nadd);
  const outIn = $('[data-nadd-out]', nadd);
  const coefOut = $('[data-nadd-coef]', nadd);
  const prev = $('[data-nadd-preview]', nadd);
  const err = $('[data-nadd-error]', nadd);
  const del = $('[data-nadd-del]', nadd);
  const okLab = $('[data-nadd-ok]', nadd);
  const num = (s) => {
    const n = parseFloat(String(s).replace(',', '.').replace(/\s/g, ''));
    return Number.isFinite(n) ? n : null;
  };
  let coef = 1;
  let slot = null;
  let editId = null;
  const setCoef = (c) => {
    coef = Math.max(0.5, Math.min(10, c));
    coefOut.textContent = fN(coef);
  };
  function fillMats() {
    const S = N.semById(semId);
    selM.replaceChildren(
      ...S.ues.map((U) => {
        const og = el('optgroup');
        og.label = `UE ${U.id} · ${U.name}`;
        U.matieres.forEach((M) => {
          const o = el('option', '', M.name);
          o.value = M.id;
          og.append(o);
        });
        return og;
      }),
    );
  }
  function fillSlots() {
    const M = N.MAT[selM.value];
    const free = N.evalsOf(M).filter((e) => !N.has(N.val(e)) && !e.extra);
    slots.replaceChildren(
      ...free.map((e) => {
        const b = el('button', 'nchip');
        b.type = 'button';
        b.dataset.slotPick = e.id;
        b.setAttribute('aria-pressed', String(slot === e.id));
        b.append(el('span', '', e.label), el('span', 'nchip-m', `×${fN(e.coef)}${e.date ? ` · ${shortDate(e.date)}` : ''}`));
        return b;
      }),
    );
    slots.hidden = !free.length || Boolean(editId);
  }
  function pickSlot(id) {
    slot = id;
    const e = id && N.EV[id];
    if (e) {
      label.value = e.label;
      setCoef(e.coef);
    }
    $$('[data-slot-pick]', slots).forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.slotPick === id)));
    $$('[data-coef]', nadd).forEach((b) => (b.disabled = Boolean(e) && !e.extra));
    nadd.classList.toggle('is-slot', Boolean(e) && !e.extra);
    preview();
  }
  function candidate() {
    const v = num(vIn.value);
    const out = num(outIn.value) || 20;
    if (v === null || v < 0 || v > out || out <= 0 || out > 1000) return null;
    return Math.round((v / out) * 20 * 100) / 100;
  }
  function preview() {
    const v = candidate();
    const M = N.MAT[selM.value];
    if (!M || v === null) {
      prev.replaceChildren(el('span', 'nadd-hint', 'Tape la note : tu verras tout de suite l’effet sur tes moyennes.'));
      return;
    }
    const U = N.UE_OF[M.id];
    const S = N.SEM_OF[U.id];
    const before = [N.avgM(M), N.avgU(U), N.avgS(S)];
    const stBeforeU = N.stU(U);
    // application temporaire
    const store = N.simOn ? N.sim : N.real;
    let tmp = null;
    let prevVal;
    if (editId) {
      prevVal = store[editId];
      store[editId] = v;
    } else if (slot) {
      prevVal = store[slot];
      store[slot] = v;
    } else {
      tmp = { id: '__tmp', label: 'tmp', coef, value: null, mat: M.id, extra: true, sim: N.simOn };
      M.evals.push(tmp);
      store.__tmp = v;
    }
    const after = [N.avgM(M), N.avgU(U), N.avgS(S)];
    const stAfterU = N.stU(U);
    const stAfterM = N.stM(M);
    if (tmp) {
      M.evals.pop();
      delete store.__tmp;
    } else store[editId || slot] = prevVal;
    const row = (k, a, b, low) => {
      const r = el('span', 'nadd-pr');
      const d = b - (a === null ? b : a);
      r.append(el('span', 'nadd-pr-k', k), el('span', 'nadd-pr-a', f2(a)), icon('chevRight', 'ic ic--xs'), el('b', low ? 'is-low' : '', f2(b)));
      if (Math.abs(d) >= 0.005) r.append(el('span', `nadd-d ${d > 0 ? 'is-up' : 'is-down'}`, `${d > 0 ? '+' : '−'}${f2(Math.abs(d))}`));
      return r;
    };
    prev.replaceChildren(
      row(M.name.length > 26 ? 'Matière' : M.name, before[0], after[0], stAfterM === 'fail'),
      row(`UE ${U.id}`, before[1], after[1], stAfterU === 'fail'),
      row(S.short, before[2], after[2], false),
    );
    if (stBeforeU !== stAfterU && stAfterU !== 'none') {
      const msg = el('p', `nadd-flip is-${stAfterU}`);
      msg.append(icon(stAfterU === 'ok' ? 'check' : 'alert', 'ic ic--sm'), stAfterU === 'ok' ? `L’UE ${U.id} sort du rattrapage.` : `L’UE ${U.id} passerait en rattrapage.`);
      prev.append(msg);
    }
  }
  const fillSim = () => {
    $('[data-nadd-sim]', nadd).hidden = !N.simOn;
    nadd.classList.toggle('is-sim', N.simOn);
  };
  function openAdd(o = {}) {
    if (!N) return;
    if (o.semId) semId = o.semId;
    fillMats();
    fillSim();
    editId = o.editId || null;
    slot = null;
    const e = editId && N.EV[editId];
    const firstGrade = N.lastGrades(N.semById(semId), 1)[0];
    const matId = o.mat || e?.mat || (o.slot && N.EV[o.slot].mat) || firstGrade?.mat || selM.options[0]?.value;
    if (!matId) return;
    const S = N.SEM_OF[N.UE_OF[matId].id];
    if (S.id !== semId) {
      semId = S.id;
      fillMats();
    }
    selM.value = matId;
    selM.disabled = Boolean(editId);
    label.value = '';
    vIn.value = '';
    outIn.value = '20';
    setCoef(1);
    err.hidden = true;
    vIn.removeAttribute('aria-invalid');
    $('[data-nadd-title]', nadd).textContent = editId ? 'Modifier la note' : N.simOn ? 'Ajouter une note simulée' : 'Ajouter une note';
    $('[data-nadd-sub]', nadd).textContent = editId ? `${e.label} · ${nameOf(e)}` : 'Elle compte tout de suite dans tes moyennes.';
    okLab.textContent = editId ? 'Enregistrer' : 'Ajouter';
    del.hidden = !editId;
    fillSlots();
    if (e) {
      label.value = e.label;
      setCoef(e.coef);
      vIn.value = fN(N.val(e));
      $$('[data-coef]', nadd).forEach((b) => (b.disabled = !e.extra));
      nadd.classList.toggle('is-slot', !e.extra);
      label.disabled = !e.extra;
    } else {
      label.disabled = false;
      const first = o.slot || N.evalsOf(N.MAT[matId]).find((x) => !N.has(N.val(x)) && !x.extra)?.id || null;
      pickSlot(first);
    }
    preview();
    addM.open();
    setTimeout(() => vIn.focus(), 60);
  }
  selM.addEventListener('change', () => {
    slot = null;
    fillSlots();
    const f = N.evalsOf(N.MAT[selM.value]).find((x) => !N.has(N.val(x)) && !x.extra)?.id || null;
    pickSlot(f);
    if (!f) {
      label.value = '';
      setCoef(1);
    }
  });
  slots.addEventListener('click', (e) => {
    const b = e.target.closest('[data-slot-pick]');
    if (!b) return;
    pickSlot(slot === b.dataset.slotPick ? null : b.dataset.slotPick);
    if (!slot) {
      label.value = '';
      setCoef(1);
    }
    vIn.focus();
  });
  label.addEventListener('input', () => {
    if (slot && N.EV[slot] && label.value !== N.EV[slot].label) pickSlot(null);
  });
  [vIn, outIn].forEach((i) =>
    i.addEventListener('input', () => {
      err.hidden = true;
      vIn.removeAttribute('aria-invalid');
      preview();
    }),
  );
  $$('[data-coef]', nadd).forEach((b) =>
    b.addEventListener('click', () => {
      const step = Number(b.dataset.coef);
      setCoef(coef + step * (coef <= 1 && step < 0 ? 0.5 : 1));
      preview();
    }),
  );
  form.addEventListener('submit', (ev) => {
    ev.preventDefault();
    const v = candidate();
    if (v === null) {
      err.hidden = false;
      vIn.setAttribute('aria-invalid', 'true');
      vIn.focus();
      return;
    }
    const M = N.MAT[selM.value];
    const U = N.UE_OF[M.id];
    const S = N.SEM_OF[U.id];
    const target = N.simOn ? N.sim : N.real;
    if (editId) {
      const e = N.EV[editId];
      target[editId] = v;
      if (e.extra) {
        e.label = label.value.trim().slice(0, 40) || e.label;
        e.coef = coef;
      }
    } else if (slot) target[slot] = v;
    else {
      const e = N.addEval({ id: `n${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`, mat: M.id, label: label.value.trim() || 'Note', coef, date: D.todayKey() }, N.simOn);
      target[e.id] = v;
    }
    if (!N.simOn) save();
    addM.close();
    renderAll();
    toast(`${N.simOn ? 'Note simulée' : editId ? 'Note modifiée' : 'Note ajoutée'} · ${U.id} ${f2(N.avgU(U))} · ${S.short} ${f2(N.avgS(S))}`);
  });
  del.addEventListener('click', () => {
    if (!editId) return;
    const e = N.EV[editId];
    if (N.simOn && N.has(N.sim[editId])) delete N.sim[editId];
    else if (e.extra) N.removeEval(e);
    else N.real[editId] = null;
    if (!N.simOn) save();
    addM.close();
    renderAll();
    toast('Note supprimée');
  });

  // ------------------------------------------------------------ viser une moyenne

  const ngoal = $('[data-ngoal]');
  const gm = modal(ngoal);
  const scopeSel = $('[data-goal-scope]', ngoal);
  const out = $('[data-goal-val]', ngoal);
  const range = $('[data-goal-range]', ngoal);
  const res = $('[data-goal-result]', ngoal);
  const simBtn = $('[data-goal-sim]', ngoal);
  let goalTarget = 10;
  let lastNeed = null;
  const setT = (t) => {
    goalTarget = Math.max(0, Math.min(20, Math.round(t * 2) / 2));
    out.textContent = fN(goalTarget);
    range.value = String(goalTarget);
    calc();
  };
  function fillScopes() {
    const S = N.semById(semId);
    const o0 = el('option', '', `${S.label} (moyenne générale)`);
    o0.value = `S:${S.id}`;
    const ogU = el('optgroup');
    ogU.label = 'Une UE';
    S.ues.forEach((U) => {
      const o = el('option', '', `UE ${U.id} · ${U.name}`);
      o.value = `U:${U.id}`;
      ogU.append(o);
    });
    const ogM = el('optgroup');
    ogM.label = 'Une matière';
    S.ues.forEach((U) =>
      U.matieres.forEach((M) => {
        const o = el('option', '', M.name);
        o.value = `M:${M.id}`;
        ogM.append(o);
      }),
    );
    scopeSel.replaceChildren(o0, ogU, ogM);
  }
  function calc() {
    const n = N.needFor(scopeSel.value, goalTarget);
    lastNeed = n;
    const box = [];
    const now = el('p', 'ngoal-now');
    now.append(el('span', '', 'Aujourd’hui'), el('b', '', f2(n.now)));
    box.push(now);
    const verdict = el('div', `ngoal-v is-${n.state}`);
    if (n.state === 'need') {
      const big = el('p', 'ngoal-need');
      big.append(el('span', '', 'Il te faut au moins'), el('b', '', f1up(n.x)), el('span', '', n.rem.length > 1 ? `/20 de moyenne sur les ${n.rem.length} évaluations restantes` : '/20 à cette évaluation'));
      verdict.append(big);
      const ul = el('ul', 'ngoal-rem');
      n.rem.slice(0, 6).forEach((e) => {
        const li = el('li');
        li.append(el('b', '', e.label), el('span', '', `${n.sc.kind === 'M' ? '' : `${nameOf(e)} · `}coef ${fN(e.coef)}${e.date ? ` · ${shortDate(e.date)}` : ''}`));
        ul.append(li);
      });
      if (n.rem.length > 6) ul.append(el('li', 'ngoal-more', `et ${n.rem.length - 6} autres`));
      verdict.append(ul);
      const tough = n.x > 16 ? 'C’est ambitieux : regarde d’abord les évaluations à gros coefficient.' : n.x <= 8 ? 'Atteignable : reste régulier.' : '';
      if (tough) verdict.append(el('p', 'ngoal-tip', tough));
      n.underU.forEach((u) => verdict.append(el('p', 'ngoal-warn', `Pour valider, l’UE ${u.U.id} doit aussi atteindre ${fN(N.RULE_UE)}. ${N.needLine(u.n)}`)));
      n.under.forEach((u) => verdict.append(el('p', 'ngoal-warn', `Attention : ${u.M.name} resterait sous ${fN(N.RULE_M)}. ${N.needLine(u.n)}`)));
    } else if (n.state === 'secured') verdict.append(el('p', 'ngoal-msg', `C’est déjà acquis : même avec 0 partout, tu aurais ${f2(n.min)}.`));
    else if (n.state === 'out') verdict.append(el('p', 'ngoal-msg', `Hors de portée : même avec 20 partout, tu plafonnerais à ${f2(n.max)}.`));
    else verdict.append(el('p', 'ngoal-msg', `Toutes les notes sont saisies : moyenne finale ${f2(n.now)}.`));
    box.push(verdict);
    res.replaceChildren(...box);
    simBtn.disabled = n.state !== 'need';
  }
  scopeSel.addEventListener('change', () => setT(goalTarget));
  range.addEventListener('input', () => setT(Number(range.value)));
  $$('[data-goal-step]', ngoal).forEach((b) => b.addEventListener('click', () => setT(goalTarget + Number(b.dataset.goalStep))));
  simBtn.addEventListener('click', () => {
    if (!lastNeed || lastNeed.state !== 'need') return;
    gm.close();
    if (!viewOpen) openView();
    runScenario(lastNeed.ids, lastNeed.x);
  });
  function openGoal(key, t) {
    fillScopes();
    scopeSel.value = key || `S:${semId}`;
    setT(t || N.RULE_UE);
    gm.open();
    setTimeout(() => scopeSel.focus(), 60);
  }

  // ------------------------------------------------------------ événements

  document.addEventListener('click', (e) => {
    const t = e.target;
    if (!(t instanceof Element)) return;
    if (t.closest('[data-open-notes]')) return openView();
    if (t.closest('[data-note-add]')) return openAdd({});
    if (!nView.contains(t)) return;
    const slotB = t.closest('[data-slot]');
    if (slotB) return openAdd({ slot: slotB.dataset.slot });
    const ed = t.closest('[data-eval-edit]');
    if (ed) return openAdd({ editId: ed.dataset.evalEdit });
    const am = t.closest('[data-add-mat]');
    if (am) return openAdd({ mat: am.dataset.addMat });
    const sc = t.closest('[data-sim-scenario]');
    if (sc) {
      const key = sc.dataset.simScenario;
      const n = N.needFor(key, key.startsWith('M:') ? N.RULE_M : N.RULE_UE);
      if (n.state === 'need') runScenario(n.ids, n.x);
      return;
    }
    const sb = t.closest('[data-sem]');
    if (sb) {
      semId = sb.dataset.sem;
      renderView();
      if (motionOK()) restartClass(nView, 'nv-anim');
      return;
    }
    if (t.closest('[data-goal-open]')) return openGoal();
    if (t.closest('[data-notes-close]')) return closeView();
    if (t.closest('[data-sim-clear]')) {
      N.clearSim();
      return renderView();
    }
    if (t.closest('[data-sim-exit]')) setSim(false);
  });
  $('[data-sim-toggle]', nView).addEventListener('change', (e) => setSim(e.target.checked));
  let simTimer = 0;
  nView.addEventListener('input', (e) => {
    const id = e.target.dataset?.simIn;
    if (!id) return;
    const raw = e.target.value.trim();
    const n = parseFloat(raw.replace(',', '.'));
    if (raw === '') delete N.sim[id];
    else if (Number.isFinite(n) && n >= 0 && n <= 20) N.sim[id] = n;
    else {
      e.target.setAttribute('aria-invalid', 'true');
      return;
    }
    e.target.removeAttribute('aria-invalid');
    clearTimeout(simTimer);
    simTimer = setTimeout(renderView, 250);
  });

  return {
    load,
    isOpen: () => viewOpen,
    open: openView,
    close: closeView,
    /** Pour la fiche d'un cours : notes de la matière liée au code ADE. */
    course: (code) => N?.course(code) ?? null,
    add: (o) => openAdd(o),
    onChange: (fn) => listeners.add(fn),
    hasBook: () => Boolean(N),
    reload: () => loadBook(true).then(() => load(promo)),
  };
}
