// Rubrique Stages : carte de France en SVG (régions, puis départements, puis villes). On clique une
// région pour y entrer, un département, puis une ville. Couleurs par nombre de stages (5 paliers),
// une pastille par ville dont la taille suit le nombre de stages. Aucune image, aucune requête :
// la géométrie vient de geo.js (Lambert 93).

import { motionOK } from '../core/dom.js';

const NS = 'http://www.w3.org/2000/svg';
const svgEl = (name, attrs = {}) => {
  const e = document.createElementNS(NS, name);
  for (const [k, v] of Object.entries(attrs)) if (v != null) e.setAttribute(k, v);
  return e;
};
const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

/** Palier de couleur (1 à 5) d'un compte, sur une échelle logarithmique. */
export function bucket(n, max) {
  if (!n) return 0;
  if (max <= 1) return 3;
  const t = Math.log(n + 1) / Math.log(max + 1);
  return Math.max(1, Math.min(5, Math.ceil(t * 5)));
}

/**
 * host : l'élément qui reçoit la carte ; geo : { BOUNDS, DEPTS, REGIONS, COAST, REGION_BORDERS } ;
 * onPick({ kind: 'reg' | 'dep' | 'place', code | id }).
 */
export function createFranceMap(host, geo, { onPick }) {
  const { BOUNDS, DEPTS, REGIONS, COAST, REGION_BORDERS } = geo;
  const DEP = new Map(DEPTS.map((d) => [d.c, d]));
  const REG = new Map(REGIONS.map((r) => [r.c, r]));
  const [bx0, by0, bx1, by1] = BOUNDS;
  const pad = 18;
  const home = [bx0 - pad, by0 - pad, bx1 - bx0 + 2 * pad, by1 - by0 + 2 * pad];
  const svg = svgEl('svg', { class: 'sm', viewBox: home.join(' '), preserveAspectRatio: 'xMidYMid meet', role: 'group', 'aria-label': 'Carte de France des stages' });
  const gReg = svgEl('g', { class: 'sm-regs' });
  const gLines = svgEl('g', { class: 'sm-lines', 'aria-hidden': 'true' });
  const gBub = svgEl('g', { class: 'sm-bubs' });
  const gLab = svgEl('g', { class: 'sm-labs', 'aria-hidden': 'true' });
  gLines.append(svgEl('path', { class: 'sm-coast', d: COAST }), svgEl('path', { class: 'sm-rborder', d: REGION_BORDERS }));
  svg.append(gReg, gLines, gBub, gLab);
  host.append(svg);

  const regG = new Map();
  const depP = new Map();
  for (const r of REGIONS) {
    const g = svgEl('g', { class: 'sm-reg', 'data-reg': r.c, role: 'button', tabindex: '0' });
    regG.set(r.c, g);
    gReg.append(g);
  }
  for (const d of DEPTS) {
    const p = svgEl('path', { class: 'sm-dep', d: d.d, 'data-dep': d.c });
    depP.set(d.c, p);
    regG.get(d.r).append(p);
  }

  let view = home.slice();
  let level = { kind: 'fr' };
  let data = { reg: {}, dep: {}, places: [] };
  let selPlace = null;
  let anim = 0;
  let bubbles = [];

  const pxPerUnit = () => {
    const r = svg.getBoundingClientRect();
    return !r.width || !r.height ? 1 : Math.min(r.width / view[2], r.height / view[3]);
  };
  function fit([x0, y0, x1, y1], padPx = 28) {
    const r = svg.getBoundingClientRect();
    const W = r.width || 600;
    const H = r.height || 600;
    const w = Math.max(x1 - x0, 30);
    const hh = Math.max(y1 - y0, 30);
    const s = Math.min((W - 2 * padPx) / w, (H - 2 * padPx) / hh);
    const vw = W / s;
    const vh = H / s;
    return [(x0 + x1) / 2 - vw / 2, (y0 + y1) / 2 - vh / 2, vw, vh];
  }
  function setView(v) {
    view = v;
    svg.setAttribute('viewBox', v.map((n) => n.toFixed(2)).join(' '));
    sizeMarks();
  }
  function animateTo(target, instant) {
    cancelAnimationFrame(anim);
    if (instant || !motionOK()) return setView(target);
    const from = view.slice();
    const t0 = performance.now();
    const step = (now) => {
      const t = Math.min(1, (now - t0) / 520);
      const e = ease(t);
      setView(from.map((a, i) => a + (target[i] - a) * e));
      if (t < 1) anim = requestAnimationFrame(step);
    };
    anim = requestAnimationFrame(step);
  }
  const targetFor = (lv) => (lv.kind === 'reg' ? fit(REG.get(lv.code).b) : lv.kind === 'dep' ? fit(DEP.get(lv.code).b, 40) : fit([bx0, by0, bx1, by1], 14));

  // Pastilles et étiquettes gardent la même taille à l'écran quel que soit le zoom ; une étiquette
  // qui en chevauche une autre (plus petite ville) est cachée.
  function sizeMarks() {
    const k = 1 / pxPerUnit();
    const max = Math.max(1, ...bubbles.map((b) => b.n));
    for (const b of bubbles) {
      const big = level.kind === 'fr' ? 6 : level.kind === 'reg' ? 12 : 16;
      const r = ((level.kind === 'fr' ? 2.6 : 4) + big * Math.sqrt(b.n / max)) * k;
      b.c.setAttribute('r', r.toFixed(2));
      b.hit.setAttribute('r', Math.max(r, 11 * k).toFixed(2));
      if (b.t) {
        b.t.setAttribute('font-size', (12 * k).toFixed(2));
        b.t.setAttribute('x', (b.x + r + 4 * k).toFixed(2));
        b.t.setAttribute('y', (b.y + 4 * k).toFixed(2));
      }
    }
    for (const t of gLab.querySelectorAll('.sm-rlab')) t.setAttribute('font-size', (13 * k).toFixed(2));
    const boxes = [];
    for (const b of [...bubbles].sort((x, y) => y.n - x.n)) {
      if (!b.t) continue;
      const fs = 12 * k;
      const x0 = Number(b.t.getAttribute('x'));
      const y1 = Number(b.t.getAttribute('y')) + 3 * k;
      const box = [x0, y1 - fs * 1.15, x0 + b.t.textContent.length * fs * 0.58, y1];
      const hit = boxes.some((o) => box[0] < o[2] && box[2] > o[0] && box[1] < o[3] && box[3] > o[1]);
      b.t.setAttribute('visibility', hit ? 'hidden' : 'visible');
      if (!hit) boxes.push(box);
    }
  }

  const inLevel = (p) => (level.kind === 'reg' ? p.reg === level.code : level.kind === 'dep' ? p.dep === level.code : true);

  function drawBubbles() {
    gBub.replaceChildren();
    gLab.querySelectorAll('.sm-plab').forEach((e) => e.remove());
    const shown = data.places.filter((p) => p.n > 0 && p.x !== undefined).sort((a, b) => b.n - a.n);
    const labelled = new Set(shown.filter(inLevel).slice(0, level.kind === 'fr' ? 0 : level.kind === 'reg' ? 9 : 40).map((p) => p.id));
    bubbles = shown.map((p) => {
      const focusable = level.kind !== 'fr' && inLevel(p);
      const g = svgEl('g', {
        class: `sm-bub${inLevel(p) ? '' : ' is-out'}${p.id === selPlace ? ' is-sel' : ''}`,
        'data-place': p.id,
        role: focusable ? 'button' : null,
        tabindex: focusable ? '0' : null,
        'aria-label': focusable ? `${p.name} : ${p.n} stage${p.n > 1 ? 's' : ''}` : null,
        'aria-hidden': focusable ? null : 'true',
      });
      const hit = svgEl('circle', { class: 'sm-hit', cx: p.x, cy: p.y });
      const c = svgEl('circle', { class: 'sm-dot', cx: p.x, cy: p.y });
      g.append(hit, c);
      gBub.append(g);
      let t = null;
      if (labelled.has(p.id)) {
        t = svgEl('text', { class: `sm-plab${p.id === selPlace ? ' is-sel' : ''}` });
        t.textContent = level.kind === 'fr' ? p.name : `${p.name} · ${p.n}`;
        gLab.append(t);
      }
      return { ...p, c, hit, t, g };
    });
    sizeMarks();
  }

  function drawRegionLabels() {
    gLab.querySelectorAll('.sm-rlab').forEach((e) => e.remove());
    if (level.kind !== 'fr') return;
    for (const r of REGIONS) {
      const n = data.reg[r.c] || 0;
      if (!n) continue;
      const t = svgEl('text', { class: 'sm-rlab', x: r.x, y: r.y, 'text-anchor': 'middle' });
      t.textContent = String(n);
      gLab.append(t);
    }
  }

  function paint() {
    const maxReg = Math.max(1, ...Object.values(data.reg));
    const maxDep = Math.max(1, ...Object.values(data.dep));
    for (const r of REGIONS) {
      const g = regG.get(r.c);
      const n = data.reg[r.c] || 0;
      const active = level.kind === 'fr';
      const out = level.kind !== 'fr' && level.code !== r.c && !(level.kind === 'dep' && DEP.get(level.code).r === r.c);
      g.setAttribute('class', `sm-reg${out ? ' is-out' : ''}`);
      g.setAttribute('tabindex', active ? '0' : '-1');
      g.setAttribute('role', active ? 'button' : 'group');
      g.setAttribute('aria-label', `${r.n} : ${n ? `${n} stage${n > 1 ? 's' : ''}` : 'aucun stage avec ces filtres'}`);
    }
    for (const d of DEPTS) {
      const p = depP.get(d.c);
      const n = data.dep[d.c] || 0;
      const q = level.kind === 'fr' ? bucket(data.reg[d.r] || 0, maxReg) : bucket(n, maxDep);
      const mine = level.kind === 'reg' ? d.r === level.code : level.kind === 'dep' ? d.c === level.code : false;
      const focusable = level.kind === 'reg' && d.r === level.code;
      p.setAttribute('class', `sm-dep q${q}${mine ? ' is-in' : ''}${level.kind === 'dep' && d.c === level.code ? ' is-sel' : ''}`);
      if (focusable) {
        p.setAttribute('tabindex', '0');
        p.setAttribute('role', 'button');
        p.setAttribute('aria-label', `${d.n} (${d.c}) : ${n ? `${n} stage${n > 1 ? 's' : ''}` : 'aucun stage'}`);
      } else {
        p.removeAttribute('tabindex');
        p.removeAttribute('role');
        p.removeAttribute('aria-label');
      }
    }
    svg.setAttribute('data-level', level.kind);
    drawRegionLabels();
    drawBubbles();
  }

  function pickFrom(target) {
    const bub = target.closest('[data-place]');
    if (bub && !bub.classList.contains('is-out')) return onPick({ kind: 'place', id: bub.dataset.place });
    const dep = target.closest('[data-dep]');
    const reg = target.closest('[data-reg]');
    if (level.kind === 'fr' && reg) return onPick({ kind: 'reg', code: reg.dataset.reg });
    if (!dep) return;
    const d = DEP.get(dep.dataset.dep);
    if (level.kind === 'reg' && d.r !== level.code) return onPick({ kind: 'reg', code: d.r });
    if (level.kind === 'dep' && d.c !== level.code) return onPick(d.r === DEP.get(level.code).r ? { kind: 'dep', code: d.c } : { kind: 'reg', code: d.r });
    if (level.kind === 'reg') return onPick({ kind: 'dep', code: d.c });
  }

  svg.addEventListener('click', (e) => pickFrom(e.target));
  svg.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const t = e.target;
    if (!(t instanceof Element) || !t.matches('[tabindex="0"]')) return;
    e.preventDefault();
    pickFrom(t);
  });
  svg.addEventListener('pointerover', (e) => {
    const dep = e.target.closest?.('[data-dep]');
    svg.querySelectorAll('.is-hover').forEach((x) => x.classList.remove('is-hover'));
    if (dep) (level.kind === 'fr' ? dep.parentNode : dep).classList.add('is-hover');
  });
  svg.addEventListener('pointerleave', () => svg.querySelectorAll('.is-hover').forEach((x) => x.classList.remove('is-hover')));
  new ResizeObserver(() => setView(targetFor(level))).observe(host);

  return {
    update(counts, lv, { place = null, instant = false } = {}) {
      data = counts;
      selPlace = place;
      const changed = lv.kind !== level.kind || lv.code !== level.code;
      level = lv;
      paint();
      if (changed || instant) animateTo(targetFor(lv), instant);
    },
    refit: () => setView(targetFor(level)),
  };
}
