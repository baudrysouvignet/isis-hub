// Ambiance de saison du Hub (décor choisi par l'administration). Ce module n'est chargé que si
// l'ambiance est active (api/content), ou en aperçu sur l'appareil de l'administrateur. Jamais
// dans le jeu (TCG) : tout s'arrête et se cache quand on y passe.
//
// Neige : un calque <canvas> fixe au-dessus de la page, qui ne capte ni clic ni toucher. Elle est
// pleine en haut de la page, puis de plus en plus légère plus bas, pour que tout reste lisible. Une
// partie des flocons se pose sur le haut des bentos : une fine couche qui suit leur bord, arrondis
// compris (plus mince là où ça penche, rien là où c'est vertical). La souris ou le doigt chasse les
// flocons et souffle la neige posée. En-tête : une guirlande et un brin de houx, quelques notes de
// rouge. Mouvement réduit : rien ne tombe, seule la neige déjà posée reste. Onglet caché : la boucle
// s'arrête. Chacun peut couper le décor pour lui (menu du compte, sous Thème) : choix gardé sur
// l'appareil.

import { isDark, onThemeChange } from '../core/theme.js';
import { prefs } from '../core/store.js';

const NS = 'http://www.w3.org/2000/svg';
const OFF = 'ambiance-off'; // préférence locale : décor coupé sur cet appareil
const STEP = 2; // largeur d'une colonne de neige posée (px)
const CAP = 5; // épaisseur maximale de la neige posée (px)
const REACH = 90; // rayon d'action de la souris (px)

const svg = (tag, attrs = {}) => {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  return el;
};

/**
 * Ambiance « noel » sur le Hub : le décor (s'il n'est pas coupé sur cet appareil) et son
 * interrupteur dans le menu du compte. preview : aperçu sur cet appareil seulement.
 */
export function startAmbiance({ app, preview = false, onStopPreview } = {}) {
  if (!app || app.querySelector('.amb-menu')) return null;
  const link = Object.assign(document.createElement('link'), { rel: 'stylesheet', href: 'assets/ambiance.css' });
  document.head.append(link);
  let current = null;
  const on = () => !prefs.get(OFF, false);

  // Interrupteur, juste sous le choix du thème (menu du compte).
  const input = Object.assign(document.createElement('input'), { type: 'checkbox', checked: on() });
  input.setAttribute('role', 'menuitemcheckbox');
  input.setAttribute('aria-checked', String(on()));
  const label = Object.assign(document.createElement('label'), { className: 'menu-switch amb-menu' });
  const knob = Object.assign(document.createElement('span'), { className: 'switch' });
  knob.setAttribute('aria-hidden', 'true');
  label.append(Object.assign(document.createElement('span'), { textContent: 'Neige de Noël' }), input, knob);
  const theme = app.querySelector('.menu-theme');
  theme?.after(label);
  input.addEventListener('change', () => {
    prefs.set(OFF, input.checked ? null : true);
    input.setAttribute('aria-checked', String(input.checked));
    if (input.checked && !current) current = decor(app);
    if (!input.checked && current) {
      current.stop();
      current = null;
    }
  });

  // Aperçu (appareil de l'administrateur) : une étiquette discrète pour l'arrêter.
  let chip = null;
  const api = {
    stop() {
      current?.stop();
      current = null;
      label.remove();
      chip?.remove();
      link.remove();
    },
  };
  if (preview) {
    const stop = Object.assign(document.createElement('button'), { type: 'button', className: 'amb-chip-b', textContent: 'Arrêter' });
    chip = Object.assign(document.createElement('div'), { className: 'amb-chip' });
    chip.setAttribute('role', 'status');
    chip.append(Object.assign(document.createElement('span'), { textContent: 'Aperçu de l’ambiance · sur cet appareil seulement' }), stop);
    stop.addEventListener('click', () => {
      onStopPreview?.();
      api.stop();
    });
    app.append(chip); // dans .app : les couleurs du thème (clair ou sombre)
  }

  if (on()) current = decor(app);
  return api;
}

/** Le décor : guirlande, houx et neige. Rend { stop }. */
function decor(app) {
  app.dataset.ambiance = 'noel';
  const still = matchMedia('(prefers-reduced-motion: reduce)');
  let stopped = false;

  // ---------------------------------------------------------------- en-tête
  const top = app.querySelector('.top');
  const garland = svg('svg', { class: 'amb-garland', 'aria-hidden': 'true', focusable: 'false' });
  const paintGarland = () => {
    const w = Math.max(320, Math.round(top?.clientWidth ?? innerWidth));
    const span = w < 640 ? 64 : 92; // une boucle de fil
    const n = Math.max(3, Math.round(w / span));
    const step = w / n;
    garland.setAttribute('viewBox', `0 0 ${w} 22`);
    const parts = [];
    let d = 'M0 2';
    for (let i = 0; i < n; i++) {
      const x0 = i * step;
      d += ` Q${(x0 + step / 2).toFixed(1)} 15 ${(x0 + step).toFixed(1)} 2`;
      // Une ampoule au creux de chaque boucle : surtout du rouge, un peu d'or et de blanc chaud.
      const kind = ['red', 'gold', 'red', 'white'][i % 4];
      const g = svg('g', { class: `amb-bulb amb-bulb--${kind}`, transform: `translate(${(x0 + step / 2).toFixed(1)} 9)` });
      g.style.setProperty('--i', String(i));
      g.append(svg('rect', { class: 'amb-cap', x: -1.6, y: -0.5, width: 3.2, height: 2.4, rx: 0.6 }), svg('ellipse', { cx: 0, cy: 5.2, rx: 3.1, ry: 4.2 }));
      parts.push(g);
    }
    garland.replaceChildren(svg('path', { class: 'amb-wire', d }), ...parts);
  };
  paintGarland();
  top?.append(garland);

  const holly = svg('svg', { class: 'amb-holly', viewBox: '0 0 22 16', 'aria-hidden': 'true', focusable: 'false' });
  holly.append(
    svg('path', { class: 'amb-leaf', d: 'M11 9C8.6 5.6 4.6 4.4 1.2 5.6c1.2.6 1.4 1.8.8 2.8 1.4-.2 2.4.6 2.4 1.8 1.4-.8 2.8-.4 3.4.8.8-1.2 2-1.6 3.2-2z' }),
    svg('path', { class: 'amb-leaf amb-leaf--b', d: 'M11 9c2.4-3.4 6.4-4.6 9.8-3.4-1.2.6-1.4 1.8-.8 2.8-1.4-.2-2.4.6-2.4 1.8-1.4-.8-2.8-.4-3.4.8-.8-1.2-2-1.6-3.2-2z' }),
    svg('circle', { class: 'amb-berry', cx: 9.4, cy: 10.6, r: 2.1 }),
    svg('circle', { class: 'amb-berry', cx: 12.8, cy: 10.8, r: 2.1 }),
    svg('circle', { class: 'amb-berry', cx: 11.1, cy: 8, r: 2 }),
  );
  app.querySelector('.top .brand')?.append(holly);

  // ---------------------------------------------------------------- neige
  const canvas = Object.assign(document.createElement('canvas'), { className: 'amb-snow' });
  canvas.setAttribute('aria-hidden', 'true');
  document.body.append(canvas);
  const ctx = canvas.getContext('2d');
  let W = 0;
  let H = 0;
  let dpr = 1;
  let sprites = [];
  const flakes = [];
  const puffs = [];
  const caps = new WeakMap(); // bento → { w, radius, h: Float32Array (épaisseur), max: Float32Array, drop: Float32Array }
  let tiles = [];
  let running = false;
  let raf = 0;
  let last = 0;
  let clock = 0;
  let seen = 0; // dernière relecture de la liste des bentos
  const pointer = { x: -1e4, y: -1e4, vx: 0, vy: 0, at: 0 };
  const lowEnd = (navigator.hardwareConcurrency ?? 8) <= 4 && matchMedia('(pointer: coarse)').matches;

  // Densité selon la hauteur dans la page : pleine en haut, puis de plus en plus légère.
  const density = (y) => {
    const d = y + scrollY;
    const full = H * 0.45;
    const end = H * 1.7;
    if (d <= full) return 1;
    if (d >= end) return 0.08;
    const t = (d - full) / (end - full);
    return 1 - 0.92 * t * t * (3 - 2 * t);
  };

  // Flocons pré-dessinés (un par taille) : en clair, un liseré bleu-gris pour qu'ils se voient.
  function makeSprites() {
    const dark = isDark();
    sprites = [1.1, 1.6, 2.2, 3].map((r) => {
      const s = Math.ceil((r * 2 + 4) * dpr);
      const c = document.createElement('canvas');
      c.width = c.height = s;
      const g = c.getContext('2d');
      const m = s / 2;
      if (!dark) {
        g.fillStyle = 'rgba(96, 116, 138, .36)';
        g.beginPath();
        g.arc(m, m, (r + 0.55) * dpr, 0, Math.PI * 2);
        g.fill();
      }
      const grad = g.createRadialGradient(m, m, 0, m, m, r * dpr);
      grad.addColorStop(0, 'rgba(255, 255, 255, 1)');
      grad.addColorStop(0.65, 'rgba(255, 255, 255, .92)');
      grad.addColorStop(1, 'rgba(255, 255, 255, 0)');
      g.fillStyle = grad;
      g.beginPath();
      g.arc(m, m, r * dpr, 0, Math.PI * 2);
      g.fill();
      return { c, r, s: s / dpr };
    });
  }

  function size() {
    dpr = Math.min(2, devicePixelRatio || 1);
    W = innerWidth;
    H = innerHeight;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    makeSprites();
    const want = Math.round(Math.min(170, Math.max(44, (W * H) / 9500)) * (lowEnd ? 0.6 : 1));
    while (flakes.length < want) flakes.push(flake(true));
    flakes.length = want;
  }

  function flake(anywhere) {
    const k = Math.random();
    const bucket = k < 0.35 ? 0 : k < 0.7 ? 1 : k < 0.92 ? 2 : 3;
    const r = sprites[bucket]?.r ?? 2;
    return {
      x: Math.random() * W,
      y: anywhere ? Math.random() * H : -8 - Math.random() * 40,
      vx: 0,
      vy: 0,
      fall: 16 + r * 12 + Math.random() * 10, // vitesse de chute (px/s) : les gros tombent plus vite
      sway: 6 + Math.random() * 16,
      freq: 0.4 + Math.random() * 0.9,
      phase: Math.random() * Math.PI * 2,
      a: 0.5 + Math.random() * 0.45,
      bucket,
      r,
      stick: 0.18 + Math.random() * 0.22, // chance de se poser à chaque bord de bento croisé ; sinon il continue
    };
  }

  // Bentos visibles et leur couche de neige (recréée si la largeur change).
  function refreshTiles() {
    tiles = [...app.querySelectorAll('.bento > .tile')].filter((el) => el.offsetParent !== null);
  }
  function capOf(el, rect) {
    let c = caps.get(el);
    const w = Math.round(rect.width);
    if (!c || c.w !== w) {
      const radius = Math.min(w / 2, parseFloat(getComputedStyle(el).borderTopLeftRadius) || 22);
      const n = Math.max(2, Math.floor(w / STEP) + 1);
      // Bord haut de la tuile : droit au milieu, arrondi dans les coins (drop : hauteur sous le haut).
      // La neige y tient d'autant moins que ça penche (max), et pas du tout à la verticale.
      const drop = new Float32Array(n);
      const max = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        const x = Math.min(i * STEP, w);
        const into = Math.max(0, radius - Math.min(x, w - x)); // distance dans l'arrondi (0 : partie droite)
        drop[i] = radius - Math.sqrt(Math.max(0, radius * radius - into * into));
        const flat = 1 - into / radius; // 1 en haut de l'arrondi, 0 sur le côté
        max[i] = CAP * Math.pow(Math.max(0, flat), 1.6);
      }
      const h = new Float32Array(n);
      const prev = c;
      c = { w, radius, h, max, drop };
      if (prev) for (let i = 0; i < n; i++) h[i] = Math.min(max[i], prev.h[Math.min(prev.h.length - 1, Math.round((i * prev.h.length) / n))]);
      else if (still.matches) for (let i = 0; i < n; i++) h[i] = Math.min(max[i], (2.4 + 1.1 * Math.sin(i * 0.25) * Math.sin(i * 0.07 + 1)) * (max[i] / CAP)); // déjà posée
      caps.set(el, c);
    }
    return c;
  }

  function deposit(c, x, amount) {
    const i0 = Math.round(x / STEP);
    for (let d = -4; d <= 4; d++) {
      const i = i0 + d;
      if (i < 0 || i >= c.h.length) continue;
      c.h[i] = Math.min(c.max[i], c.h[i] + amount * Math.exp(-(d * d) / 6));
    }
  }

  const onScreen = () => tiles.map((el) => [el, el.getBoundingClientRect()]).filter(([, r]) => r.bottom > 0 && r.top < H && r.width > 40);

  function step(dt) {
    clock += dt;
    const wind = Math.sin(clock * 0.13) * 14 + Math.sin(clock * 0.41 + 1.3) * 6;
    const recent = performance.now() - pointer.at < 700;
    const rects = onScreen();

    for (const f of flakes) {
      const prevY = f.y;
      const tx = wind + Math.sin(clock * f.freq + f.phase) * f.sway;
      f.vx += (tx - f.vx) * Math.min(1, dt * 1.6);
      f.vy += (f.fall - f.vy) * Math.min(1, dt * 1.2);
      if (recent) {
        const dx = f.x - pointer.x;
        const dy = f.y - pointer.y;
        const d2 = dx * dx + dy * dy;
        if (d2 < REACH * REACH && d2 > 1) {
          const d = Math.sqrt(d2);
          const push = 1 - d / REACH;
          f.vx += (dx / d) * push * 1400 * dt + pointer.vx * push * 0.9 * dt;
          f.vy += (dy / d) * push * 1400 * dt + pointer.vy * push * 0.9 * dt;
        }
      }
      f.x += f.vx * dt;
      f.y += f.vy * dt;
      if (f.vy > 0) {
        for (const [el, r] of rects) {
          const lx = f.x - r.left;
          if (lx < 0 || lx > r.width) continue;
          const c = capOf(el, r);
          const i = Math.min(c.h.length - 1, Math.round(lx / STEP));
          if (c.max[i] < 0.3) continue;
          const surface = r.top + c.drop[i] - c.h[i];
          if (prevY < surface && f.y >= surface && Math.random() < f.stick * density(f.y)) {
            deposit(c, lx, f.r * 0.37);
            Object.assign(f, flake(false));
            break;
          }
        }
      }
      if (f.y > H + 12 || f.x < -40 || f.x > W + 40) Object.assign(f, flake(false), { x: Math.random() * W });
    }

    // La souris (ou le doigt) qui passe au ras d'un bento souffle sa neige.
    const speed = Math.hypot(pointer.vx, pointer.vy);
    if (recent && speed > 60) {
      for (const [el, r] of rects) {
        if (Math.abs(pointer.y - r.top) > 26) continue;
        const c = caps.get(el);
        if (!c) continue;
        const lx = pointer.x - r.left;
        const span = REACH * 0.6;
        for (let i = Math.max(0, Math.floor((lx - span) / STEP)); i <= Math.min(c.h.length - 1, Math.ceil((lx + span) / STEP)); i++) {
          const k = 1 - Math.abs(i * STEP - lx) / span;
          if (k <= 0 || c.h[i] <= 0.05) continue;
          const take = Math.min(c.h[i], k * speed * dt * 0.035);
          c.h[i] -= take;
          if (Math.random() < take * 1.2 && puffs.length < 120) {
            puffs.push({ x: r.left + i * STEP, y: r.top + c.drop[i] - c.h[i], vx: pointer.vx * 0.35 + (Math.random() - 0.5) * 60, vy: -60 - Math.random() * 120, life: 1.2 + Math.random() * 0.6, r: 0.9 + Math.random() * 1.2 });
          }
        }
      }
    }
    for (let i = puffs.length - 1; i >= 0; i--) {
      const p = puffs[i];
      p.vy += 240 * dt;
      p.vx *= 1 - dt * 1.5;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.life -= dt;
      if (p.life <= 0 || p.y > H + 10) puffs.splice(i, 1);
    }
    pointer.vx *= 1 - Math.min(1, dt * 6);
    pointer.vy *= 1 - Math.min(1, dt * 6);
    return rects;
  }

  function draw(rects) {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    const dark = isDark();
    const edge = dark ? 'rgba(255, 255, 255, .35)' : 'rgba(110, 130, 152, .32)';
    // Neige posée : posée sur le bord de la tuile (arrondis compris), contour tracé seulement là
    // où il y a de la neige.
    for (const [el, r] of rects) {
      const c = capOf(el, r);
      let any = false;
      for (let i = 0; i < c.h.length; i++) if (c.h[i] > 0.15) { any = true; break; }
      if (!any) continue;
      const X = (i) => r.left + Math.min(i * STEP, r.width);
      const base = (i) => r.top + 0.5 + c.drop[i];
      ctx.beginPath();
      ctx.moveTo(X(0), base(0));
      for (let i = 0; i < c.h.length; i++) ctx.lineTo(X(i), base(i) - c.h[i]);
      for (let i = c.h.length - 1; i >= 0; i--) ctx.lineTo(X(i), base(i));
      ctx.closePath();
      const g = ctx.createLinearGradient(0, r.top - CAP, 0, r.top + 1);
      g.addColorStop(0, dark ? 'rgba(255, 255, 255, .96)' : '#FFFFFF');
      g.addColorStop(1, dark ? 'rgba(226, 236, 246, .9)' : '#E6EEF6');
      ctx.fillStyle = g;
      ctx.fill();
      ctx.beginPath();
      let pen = false;
      for (let i = 0; i < c.h.length; i++) {
        if (c.h[i] > 0.3) {
          if (pen) ctx.lineTo(X(i), base(i) - c.h[i]);
          else ctx.moveTo(X(i), base(i) - c.h[i]);
          pen = true;
        } else pen = false;
      }
      ctx.lineWidth = 1;
      ctx.strokeStyle = edge;
      ctx.stroke();
    }
    // Flocons, de plus en plus légers vers le bas de la page, puis neige soufflée.
    for (const f of flakes) {
      const a = f.a * density(f.y);
      if (a < 0.03) continue;
      const s = sprites[f.bucket];
      ctx.globalAlpha = a;
      ctx.drawImage(s.c, f.x - s.s / 2, f.y - s.s / 2, s.s, s.s);
    }
    for (const p of puffs) {
      const s = sprites[p.r > 1.5 ? 1 : 0];
      ctx.globalAlpha = Math.min(1, p.life);
      ctx.drawImage(s.c, p.x - s.s / 2, p.y - s.s / 2, s.s, s.s);
    }
    ctx.globalAlpha = 1;
  }

  function frame(now) {
    raf = 0;
    if (!running) return;
    const dt = Math.min(0.05, (now - last) / 1000 || 0.016);
    last = now;
    if (clock - seen > 1.5) {
      seen = clock;
      refreshTiles();
    }
    draw(step(dt));
    raf = requestAnimationFrame(frame);
  }
  // Mouvement réduit : seulement la neige posée, redessinée quand la page bouge.
  const drawStill = () => {
    if (!still.matches || !visible()) return;
    flakes.length = 0;
    draw(onScreen());
  };

  const visible = () => !document.hidden && !app.classList.contains('is-tcg');
  function sync() {
    if (stopped) return;
    const on = visible();
    canvas.hidden = !on;
    if (on && still.matches) {
      running = false;
      drawStill();
      return;
    }
    if (on && !running) {
      if (!flakes.length) size();
      running = true;
      last = performance.now();
      raf = requestAnimationFrame(frame);
    } else if (!on && running) {
      running = false;
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
    }
  }

  // ---------------------------------------------------------------- événements
  const ctrl = new AbortController();
  const opts = { passive: true, signal: ctrl.signal };
  const move = (x, y) => {
    const now = performance.now();
    const dt = Math.max(0.008, (now - pointer.at) / 1000);
    if (now - pointer.at < 200) {
      pointer.vx = pointer.vx * 0.5 + ((x - pointer.x) / dt) * 0.5;
      pointer.vy = pointer.vy * 0.5 + ((y - pointer.y) / dt) * 0.5;
    }
    pointer.x = x;
    pointer.y = y;
    pointer.at = now;
  };
  addEventListener('pointermove', (e) => move(e.clientX, e.clientY), opts);
  addEventListener('touchmove', (e) => e.touches[0] && move(e.touches[0].clientX, e.touches[0].clientY), opts);
  addEventListener('touchstart', (e) => e.touches[0] && move(e.touches[0].clientX, e.touches[0].clientY), opts);
  addEventListener(
    'resize',
    () => {
      size();
      paintGarland();
      refreshTiles();
      drawStill();
    },
    opts,
  );
  addEventListener('scroll', drawStill, { ...opts, capture: true });
  document.addEventListener('visibilitychange', sync, opts);
  still.addEventListener?.('change', sync, { signal: ctrl.signal });
  onThemeChange(() => {
    if (stopped) return;
    makeSprites();
    drawStill();
  });
  // Passage au jeu (classe is-tcg) : tout s'arrête ; retour au Hub : la neige reprend.
  const watch = new MutationObserver(() => {
    refreshTiles();
    sync();
  });
  watch.observe(app, { attributes: true, attributeFilter: ['class'] });

  size();
  refreshTiles();
  sync();

  return {
    stop() {
      stopped = true;
      running = false;
      if (raf) cancelAnimationFrame(raf);
      ctrl.abort();
      watch.disconnect();
      canvas.remove();
      garland.remove();
      holly.remove();
      delete app.dataset.ambiance;
    },
  };
}
