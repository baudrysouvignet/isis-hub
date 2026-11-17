// Visite guidée : à la première visite du tableau de bord, puis « Revoir la visite » dans le compte.

import { $$, h, restartClass, motionOK } from '../core/dom.js';
import { prefs } from '../core/store.js';

const STEPS = [
  { k: 'Bienvenue', t: 'Découvre ISIS Hub en 1 minute', p: 'Une visite rapide de ce que tu peux faire. Tu pourras la revoir à tout moment depuis ton compte.', go: 'Commencer' },
  { sel: '#edt', t: 'Ton emploi du temps', p: 'La salle d’abord, puis le cours. Passe de Jours à Semaine, et avance aussi loin que tu veux avec les flèches.' },
  { sel: '#edt .ev.has-mdl', t: 'Un cours, son Moodle', p: 'La pastille en haut à droite d’un cours ouvre son espace Moodle. « ≈ » signale une correspondance approximative.' },
  { sel: '[data-open-ical]', t: 'Dans l’agenda de ton téléphone', p: 'Abonne-toi à l’emploi du temps : Apple Calendrier, Google Agenda ou Outlook le tiennent à jour tout seuls.' },
  { sel: '#mails', t: 'Tes mails, sans quitter le Hub', p: 'Clique sur un mail pour le lire ici : il est aussi marqué comme lu dans ta messagerie. Les plus anciens se chargent en faisant défiler.' },
  { sel: '#notes', t: 'Tes notes, tes moyennes', p: 'Saisis tes notes au bon endroit : moyennes par UE et par semestre, rattrapages repérés. Le mode simulation répond à « est-ce que je valide ? ». Tout est chiffré : personne d’autre ne les lit.' },
  { sel: '#moodle', t: 'Le bon cours au bon moment', p: 'Le cours en cours, ou le prochain, est mis en avant. Tape « / » pour chercher parmi tous tes cours.' },
  { sel: '[data-menu="view-menu"]', t: 'À ta façon', p: 'Affiche ou masque les tuiles. Le reste de la grille s’adapte.' },
  { sel: '.top [data-open-transparence]', t: 'Tout est vérifiable', p: 'L’écran Transparence montre ce que fait la page, ce qui est gardé, et lance des contrôles en direct.', go: 'C’est parti' },
];

const visible = (sel) => $$(sel).find((x) => !x.closest('[hidden]') && x.getBoundingClientRect().width > 0) || null;

let tour = null;

function end() {
  if (!tour) return;
  prefs.set('tourDone', true);
  const t = tour;
  tour = null;
  window.removeEventListener('resize', t.reflow);
  window.removeEventListener('scroll', t.reflow, true);
  if (motionOK()) t.root.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 220 }).onfinish = () => t.root.remove();
  else t.root.remove();
  t.back?.focus?.({ preventScroll: true });
}

export const tourActive = () => Boolean(tour);

export function startTour(app) {
  if (tour) return;
  const steps = STEPS.filter((s) => !s.sel || visible(s.sel));
  const hole = h('div.tour-hole.is-center');
  const kick = h('p.tour-step');
  const title = h('h3', { id: 'tour-title' });
  const text = h('p.tour-text');
  const dots = h('div.tour-dots', { attrs: { 'aria-hidden': 'true' } }, ...steps.map(() => h('span')));
  const skip = h('button.btn.btn--ghost.btn--sm', { type: 'button', text: 'Passer' });
  const prev = h('button.btn.btn--sm', { type: 'button', text: 'Précédent' });
  const next = h('button.btn.btn--primary.btn--sm', { type: 'button', text: 'Suivant' });
  const card = h('div.tour-card', { attrs: { role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'tour-title' } }, kick, title, text, dots, h('div.tour-actions', {}, skip, h('span.spacer'), prev, next));
  const root = h('div.tour', {}, hole, card);
  app.append(root);
  tour = { root, i: 0, back: document.activeElement };
  if (motionOK()) root.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 260 });

  const px = (n) => `${n}px`;
  function position() {
    const st = steps[tour.i];
    const W = window.innerWidth;
    const H = window.innerHeight;
    const phone = W < 760;
    const cw = Math.min(360, W - 24);
    const ch = card.offsetHeight;
    const target = st.sel ? visible(st.sel) : null;
    card.style.setProperty('width', px(phone ? W - 24 : cw));
    if (!target) {
      hole.classList.add('is-center');
      for (const [k, v] of Object.entries({ top: px(H / 2), left: px(W / 2), width: '0px', height: '0px' })) hole.style.setProperty(k, v);
      card.style.setProperty('left', phone ? '12px' : px((W - cw) / 2));
      card.style.setProperty('top', phone ? px(H - ch - 16) : px((H - ch) / 2));
      return;
    }
    hole.classList.remove('is-center');
    const r = target.getBoundingClientRect();
    const pad = r.height > 80 ? 8 : 6;
    const top = Math.max(4, r.top - pad);
    const bottom = Math.min(H - 4, r.bottom + pad);
    for (const [k, v] of Object.entries({ top: px(top), left: px(r.left - pad), width: px(r.width + 2 * pad), height: px(Math.max(0, bottom - top)) })) hole.style.setProperty(k, v);
    hole.style.setProperty('border-radius', r.height > 80 ? '24px' : '12px');
    let x;
    let y;
    const below = () => (r.bottom + ch + 28 < H ? r.bottom + 16 : r.top - ch - 16 > 8 ? r.top - ch - 16 : H - ch - 16);
    if (phone) [x, y] = [12, below()];
    else if (r.right + 20 + cw < W - 12) [x, y] = [r.right + 20, Math.min(Math.max(12, r.top), H - ch - 12)];
    else if (r.left - 20 - cw > 12) [x, y] = [r.left - 20 - cw, Math.min(Math.max(12, r.top), H - ch - 12)];
    else [x, y] = [Math.min(Math.max(12, r.left), W - cw - 12), below()];
    card.style.setProperty('left', px(x));
    card.style.setProperty('top', px(y));
  }
  tour.reflow = () => {
    if (tour && !tour.raf) {
      tour.raf = requestAnimationFrame(() => {
        if (!tour) return;
        tour.raf = 0;
        position();
      });
    }
  };
  function show(i) {
    tour.i = i;
    const st = steps[i];
    kick.textContent = i === 0 ? st.k : `${i + 1} sur ${steps.length}`;
    title.textContent = st.t;
    text.textContent = st.p;
    [...dots.children].forEach((d, k) => d.classList.toggle('is-on', k === i));
    prev.hidden = i === 0;
    next.textContent = st.go || 'Suivant';
    restartClass(card, 'is-swap');
    const target = st.sel ? visible(st.sel) : null;
    if (target && !target.closest('.top')) {
      const r = target.getBoundingClientRect();
      const y = window.scrollY + r.top - (r.height > window.innerHeight * 0.6 ? 80 : (window.innerHeight - r.height) / 2);
      window.scrollTo({ top: Math.max(0, y), behavior: motionOK() ? 'smooth' : 'auto' });
    }
    position();
    setTimeout(() => tour && position(), 450);
    next.focus({ preventScroll: true });
  }
  next.addEventListener('click', () => (tour.i < steps.length - 1 ? show(tour.i + 1) : end()));
  prev.addEventListener('click', () => tour.i > 0 && show(tour.i - 1));
  skip.addEventListener('click', end);
  root.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowRight') next.click();
    if (e.key === 'ArrowLeft') prev.click();
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      end();
    }
    if (e.key === 'Tab') {
      const f = [skip, prev, next].filter((b) => !b.hidden);
      const k = f.indexOf(document.activeElement);
      e.preventDefault();
      f[(k + (e.shiftKey ? -1 : 1) + f.length) % f.length].focus();
    }
  });
  window.addEventListener('resize', tour.reflow);
  window.addEventListener('scroll', tour.reflow, true);
  show(0);
}
