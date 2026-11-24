// ISIS · TCG : échanges en face à face. L'un affiche un QR code (et un code à 4 caractères,
// valable 5 minutes) ; l'autre le scanne avec l'appareil photo de son téléphone, qui ouvre le
// lien dans le Hub, ou tape le code. Sur la table, chacun pose ses cartes ; toute modification
// annule les deux « prêt ». Quand les deux ont maintenu « échanger », le serveur fait l'échange
// d'un coup. La table se met à jour en direct (requête longue, sans WebSocket supplémentaire).

import { h, toast, motionOK, sleep } from '../core/dom.js';
import { api, TcgError } from './api.js';
import { cardEl, ic, mark, sheet, tbtn, RLABEL, dateShort, plural } from './ui.js';
import { qrDataURL } from './qr.js';

let active = null; // { code, s: état de la table, stop(), warn }

const ENDED = ['done', 'cancelled', 'expired'];

/** Suit une table d'échange (requêtes longues) ; rend la fonction d'arrêt. */
function watch(code, onState) {
  const ctrl = new AbortController();
  (async () => {
    let v = -1;
    let fails = 0;
    while (!ctrl.signal.aborted) {
      try {
        const s = await api.trade(code, v, ctrl.signal);
        fails = 0;
        v = s.v;
        onState(s);
        if (ENDED.includes(s.status)) break;
      } catch (e) {
        if (ctrl.signal.aborted) break;
        if (e.status === 404) {
          onState(null);
          break;
        }
        if (++fails > 20) break;
        await sleep(Math.min(8000, 1000 * fails));
      }
    }
  })();
  return () => ctrl.abort();
}

const shareURL = (code) => `${location.origin}${location.pathname}#echange=${code}`;

// ------------------------------------------------------------------ hall des échanges

export function renderTrade(ctx) {
  if (active) return renderTable(ctx);
  const st = ctx.st;
  const root = h('section.ttr');
  root.append(h('header.tv-head', {}, h('div', {}, h('p.tk', { text: 'Échanges' }), h('h1.tv-h1', { tabIndex: -1, text: 'Échanger en face à face' })), h('p.ttr-lead', { text: 'Deux téléphones, un QR code. Chacun choisit ses cartes, valide, et l’échange se fait d’un coup.' })));
  const big = (cls, icon, title, sub, on) => {
    const b = h(`button.ttr-big.${cls}`, { type: 'button' }, h('span.ttr-big-ic', {}, ic(icon, 'ic')), h('span.ttr-big-t', {}, h('b', { text: title }), h('span', { text: sub })), ic('arrow'));
    b.addEventListener('click', on);
    return b;
  };
  root.append(h('div.ttr-actions', {}, big('ttr-big--create', 'qr', 'Créer un échange', 'Affiche ton QR code, l’autre le scanne', () => startTrade(ctx)), big('ttr-big--join', 'camera', 'Rejoindre un échange', 'Scanne son QR code ou tape son code', () => openJoinSheet(ctx))));

  // Invitations en attente.
  const cols = h('div.ttr-cols');
  const left = h('section.ttr-sec');
  if (st.invites.length) {
    left.append(h('h2.tco-sec-h', {}, h('span', { text: 'On t’invite' })));
    const ul = h('ul.ttr-match');
    for (const inv of st.invites) {
      const b = tbtn('Rejoindre', 'arrow', 'tbtn--sm tbtn--primary', () => joinTradeCode(ctx, inv.code));
      ul.append(h('li', {}, h('span.tav', { text: inv.from.slice(0, 2).toUpperCase() }), h('div.ttr-m-t', {}, h('b', { text: inv.from }), h('span', { text: `code ${inv.code} · expire dans ${Math.max(1, Math.round((new Date(inv.expires) - Date.now()) / 60000))} min` })), b));
    }
    left.append(ul);
  }

  // Correspondances : ils ont des cartes de « Je cherche », ou cherchent mes doubles.
  const doubles = Object.entries(st.owned).filter(([, s]) => s.length > 1);
  left.append(h('h2.tco-sec-h', {}, h('span', { text: 'Ils ont ce que tu cherches' }), h('small', { text: `d’après ta liste (${st.wish.length}) et tes doubles` })));
  if (st.matches.length) {
    const ul = h('ul.ttr-match');
    for (const m of st.matches) {
      const has = m.has.length ? `a ${plural(m.has.length, 'carte')} de ta liste` : 'n’a rien de ta liste';
      const wants = m.wants.length ? ` · cherche ${plural(m.wants.length, 'de tes doubles', 'de tes doubles')}` : '';
      const b = tbtn('Inviter', 'qr', 'tbtn--sm', () => startTrade(ctx, m));
      ul.append(h('li', {}, h('span.tav', { text: m.initials }), h('div.ttr-m-t', {}, h('b', { text: m.pseudo }), h('span', { text: has + wants })), b));
    }
    left.append(ul);
  } else left.append(h('p.thelp', { text: st.wish.length ? 'Personne n’a encore les cartes de ta liste.' : 'Ajoute des cartes manquantes à « Je cherche » (dans ta collection) : les joueurs qui les ont apparaîtront ici.' }));
  cols.append(left);

  const right = h('section.ttr-sec', {}, h('h2.tco-sec-h', {}, h('span', { text: 'Mes doubles' }), h('small', { text: `${plural(doubles.length, 'carte échangeable', 'cartes échangeables')}` })));
  if (doubles.length) {
    const row = h('div.ttr-row');
    for (const [id, serials] of doubles) {
      const c = ctx.card(id);
      if (!c) continue;
      const cell = h('button.tco-cell', { type: 'button' }, cardEl(c, { size: 'sm', serial: serials.find((x) => x > 0) || 0, count: serials.length }));
      cell.addEventListener('click', () => ctx.openCard(c));
      row.append(cell);
    }
    right.append(row);
  } else right.append(h('p.thelp', { text: 'Tes doubles apparaîtront ici : ce sont tes meilleures monnaies d’échange.' }));
  cols.append(right);
  root.append(cols);

  if (st.trades.length) {
    const ul = h('ul.ttr-hist');
    for (const t of st.trades) {
      const names = (list) => list.map((x) => `« ${ctx.card(x.card)?.title ?? 'carte'} »`).join(', ') || 'rien';
      ul.append(h('li', {}, h('span.tav.tav--sm', { text: t.with.slice(0, 2).toUpperCase() }), h('span', {}, h('b', { text: t.with }), ` · ${dateShort(t.at)} · tu as donné ${names(t.gave)}, reçu ${names(t.got)}`)));
    }
    root.append(h('section.ttr-sec', {}, h('h2.tco-sec-h', {}, h('span', { text: 'Historique' })), ul));
  }
  return root;
}

// ------------------------------------------------------------------ créer : QR code

export async function startTrade(ctx, match) {
  if (!(await ctx.join())) return;
  let res;
  try {
    res = await api.tradeNew(match?.id ?? '');
  } catch (e) {
    return toast(e.message, 'alert');
  }
  const { code, expires } = res;
  const img = h('img', { alt: `QR code de l’échange ${code}`, src: qrDataURL(shareURL(code)) });
  const exp = h('span.tqr-exp');
  const wait = h('p.tqr-wait', {}, h('span.tqr-dots', {}, h('i'), h('i'), h('i')), match ? `Invitation envoyée à ${match.pseudo}. En attente…` : 'En attente de ton partenaire…');
  const copy = tbtn('Copier le lien', 'copy', 'tbtn--sm tbtn--ghost', async () => {
    try {
      await navigator.clipboard.writeText(shareURL(code));
      toast('Lien copié.', 'check');
    } catch {
      toast(shareURL(code));
    }
  });
  let stop = () => {};
  let timer;
  let joined = false;
  const s = sheet(
    'qr',
    'QR code d’échange',
    h(
      'div.tqr',
      {},
      h('p.tk', { text: 'Échange en face à face' }),
      h('h2.tdet-h', { text: 'Fais scanner ce code' }),
      h('div.tqr-frame', {}, img, h('span.tqr-scan'), h('span.tqr-logo', {}, mark('tqr-mark'))),
      h('p.tqr-or', { text: 'ou tape le code' }),
      h('p.tqr-code', { attrs: { 'aria-label': `Code ${code.split('').join(' ')}` } }, ...code.split('').map((ch) => h('span', { text: ch }))),
      h('div.tqr-row', {}, h('span.tqr-expw', {}, ic('clock'), 'Expire dans ', exp), copy),
      wait,
    ),
    {
      onClose: () => {
        clearInterval(timer);
        if (!joined) {
          stop();
          api.tradeCancel(code).catch(() => {});
        }
      },
    },
  );
  const tickExp = () => {
    const left = Math.max(0, Math.round((new Date(expires) - Date.now()) / 1000));
    exp.textContent = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
    if (left === 0 && !joined) {
      wait.replaceChildren('Code expiré : crée un nouvel échange.');
      clearInterval(timer);
    }
  };
  tickExp();
  timer = setInterval(tickExp, 1000);
  stop = watch(code, async (state) => {
    if (!state || joined) return;
    if (state.status === 'open' && state.them) {
      joined = true;
      stop();
      wait.classList.add('is-ok');
      wait.replaceChildren(ic('check'), `${state.them.pseudo} a rejoint l’échange`);
      await sleep(motionOK() ? 700 : 0);
      s.close();
      openTable(ctx, code, state);
    }
  });
}

// ------------------------------------------------------------------ rejoindre

export function openJoinSheet(ctx) {
  const input = h('input.tinput.tjoin-code', { id: 'tjoin-code', maxLength: 4, autocomplete: 'off', placeholder: 'K7Q2', attrs: { autocapitalize: 'characters', autofocus: '', spellcheck: 'false', inputmode: 'text' } });
  const err = h('p.terr', { hidden: true, attrs: { role: 'alert' } });
  const btn = h('button.tbtn.tbtn--primary', { type: 'submit' }, ic('arrow'), h('span', { text: 'Rejoindre' }));
  const form = h(
    'form.tjoin',
    { noValidate: true },
    h('p.tk', { text: 'Rejoindre un échange' }),
    h('h2.tdet-h', { text: 'Scanne son QR code' }),
    h('div.tjoin-cam', {}, h('span.tjoin-corners'), h('span.tjoin-line'), h('p', {}, ic('camera'), 'Ouvre l’appareil photo de ton téléphone et vise son QR code')),
    h('div.tfield', {}, h('label.tlabel', { htmlFor: 'tjoin-code', text: 'Ou tape son code' }), h('div.tjoin-row', {}, input, btn)),
    err,
  );
  input.addEventListener('input', () => (input.value = input.value.toUpperCase().replace(/[^A-Z0-9]/g, '')));
  const s = sheet('join', 'Rejoindre un échange', form);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (input.value.length !== 4) {
      err.textContent = 'Le code fait 4 caractères.';
      err.hidden = false;
      return;
    }
    btn.disabled = true;
    const ok = await joinTradeCode(ctx, input.value, (msg) => {
      err.textContent = msg;
      err.hidden = false;
    });
    btn.disabled = false;
    if (ok) s.close();
  });
}

/** Rejoint la table `code` (lien du QR code, invitation ou code tapé). */
export async function joinTradeCode(ctx, code, onErr) {
  if (!(await ctx.join())) return false;
  try {
    await api.tradeJoin(code);
    const state = await api.trade(code, -1);
    openTable(ctx, code, state);
    return true;
  } catch (e) {
    const msg = e instanceof TcgError ? e.message : 'Échange introuvable.';
    if (onErr) onErr(msg);
    else toast(msg, 'alert');
    return false;
  }
}

// ------------------------------------------------------------------ la table

function openTable(ctx, code, state) {
  active?.stop?.();
  active = { code, s: state, warn: '', stop: () => {} };
  active.stop = watch(code, (s) => {
    if (!active || active.code !== code) return;
    if (!s) {
      active = null;
      return ctx.render();
    }
    const prev = active.s;
    if (prev?.me.ready && !s.me.ready && s.offerV !== prev.offerV && s.status === 'open') active.warn = `${s.them?.pseudo ?? 'L’autre'} a modifié l’offre : vérifie avant de valider.`;
    active.s = s;
    if (s.status === 'done') ctx.reload();
    else ctx.render();
  });
  ctx.go('trade');
}

function closeTable(ctx) {
  active?.stop?.();
  active = null;
  ctx.render();
}

function renderTable(ctx) {
  const { code, s } = active;
  const root = h('section.ttb');
  if (s.status === 'done') return renderDone(ctx, s);
  if (s.status === 'cancelled' || s.status === 'expired') {
    root.append(
      h(
        'div.tju-done',
        {},
        h('span.tju-check', {}, ic('x', 'ic')),
        h('h2.tdet-h', { text: s.status === 'expired' ? 'Échange expiré' : 'Échange annulé' }),
        h('p', { text: 'Rien n’a bougé : chacun garde ses cartes.' }),
        tbtn('Retour aux échanges', 'back', 'tbtn--primary', () => closeTable(ctx)),
      ),
    );
    return root;
  }
  const who = (side, me) =>
    h(
      `div.ttb-who${side?.ready ? '.is-ready' : ''}`,
      {},
      h(`span.tav${me ? '.tav--me' : ''}`, { text: side ? side.initials : '…' }),
      h('div', {}, h('b', { text: me ? 'Toi' : side?.pseudo ?? 'En attente…' }), h('span', { text: !side ? 'n’a pas encore rejoint' : side.ready ? 'Prêt·e' : 'Choisit ses cartes…' })),
      side?.ready ? h('span.ttb-ok', {}, ic('check', 'ic ic--xs')) : null,
    );
  root.append(h('header.ttb-head', {}, who(s.me, true), h('span.ttb-link', {}, ic('trade', 'ic')), who(s.them, false)));

  // Mes cartes posées.
  const mine = h('div.ttb-slots');
  for (const t of s.me.offer) {
    const rm = h('button.ttb-rm', { type: 'button', attrs: { 'aria-label': `Retirer « ${t.card.title} »` } }, ic('x'));
    rm.addEventListener('click', () => setOffer(ctx, s.me.offer.filter((x) => x !== t).map((x) => ({ card: x.card.id, serial: x.serial }))));
    const cardBtn = cardEl(t.card, { size: 'md', serial: t.serial });
    mine.append(h('div.ttb-card', {}, cardBtn, rm));
  }
  if (s.me.offer.length < 6) {
    const add = h('button.ttb-add', { type: 'button' }, ic('plus', 'ic'), h('span', { text: s.me.offer.length ? 'Ajouter' : 'Poser une carte' }));
    add.addEventListener('click', () => pickSheet(ctx, s));
    mine.append(add);
  }
  const theirs = h('div.ttb-slots');
  for (const t of s.them?.offer ?? []) {
    const el = cardEl(t.card, { size: 'md', serial: t.serial, live: true });
    el.addEventListener('click', () => ctx.openCard(t.card, t.serial));
    theirs.append(h('div.ttb-card', {}, el));
  }
  if (!s.them?.offer.length) theirs.append(h('div.ttb-wait', { text: s.them ? `${s.them.pseudo} choisit ses cartes…` : 'En attente…' }));
  const zones = h('div.ttb-zones', {}, h('section.ttb-zone.ttb-zone--mine', {}, h('h2.ttb-zt', { text: 'Tu donnes' }), mine), h('section.ttb-zone', {}, h('h2.ttb-zt', { text: 'Tu reçois' }), theirs));
  root.append(zones);
  if (active.warn) root.append(h('p.ttb-warn', {}, ic('alert'), active.warn));

  // Actions : annuler, maintenir pour échanger (ou retirer son « prêt »).
  const cancel = tbtn('Annuler', null, 'tbtn--ghost', async () => {
    await api.tradeCancel(code).catch(() => {});
    closeTable(ctx);
  });
  const empty = !s.me.offer.length && !s.them?.offer.length;
  let action;
  if (s.me.ready) {
    action = tbtn(`Prêt·e · en attente de ${s.them?.pseudo ?? 'l’autre'}`, 'check', 'tbtn--lg', () => ready(ctx, s, false));
    action.title = 'Toucher pour annuler ton « prêt »';
  } else {
    action = holdButton(empty ? 'Posez une carte d’abord' : 'Maintiens pour échanger', () => ready(ctx, s, true));
    action.disabled = empty || !s.them;
  }
  root.append(h('div.ttb-acts', {}, cancel, action), h('p.thelp.ttb-rule', { text: 'Si quelqu’un modifie son offre, les deux « prêt » sont annulés. Rien ne bouge tant que vous n’avez pas validé tous les deux.' }));
  return root;
}

function holdButton(label, onDone) {
  const fill = h('span.thold-fill');
  const b = h('button.thold', { type: 'button' }, fill, ic('hand'), h('span', { text: label }));
  let anim = null;
  const start = () => {
    if (b.disabled || anim) return;
    b.classList.add('is-holding');
    if (navigator.vibrate) navigator.vibrate(15);
    anim = fill.animate([{ transform: 'scaleX(0)' }, { transform: 'scaleX(1)' }], { duration: motionOK() ? 900 : 300, easing: 'linear', fill: 'forwards' });
    anim.onfinish = () => {
      anim = null;
      b.classList.remove('is-holding');
      if (navigator.vibrate) navigator.vibrate([20, 40, 60]);
      onDone();
    };
  };
  const stop = () => {
    if (!anim) return;
    anim.cancel();
    anim = null;
    b.classList.remove('is-holding');
  };
  b.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    b.setPointerCapture?.(e.pointerId);
    start();
  });
  b.addEventListener('pointerup', stop);
  b.addEventListener('pointercancel', stop);
  b.addEventListener('pointerleave', stop);
  b.addEventListener('contextmenu', (e) => e.preventDefault());
  b.addEventListener('keydown', (e) => {
    if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) {
      e.preventDefault();
      start();
    }
  });
  b.addEventListener('keyup', (e) => (e.key === ' ' || e.key === 'Enter') && stop());
  return b;
}

async function ready(ctx, s, on) {
  active.warn = '';
  try {
    await api.tradeReady(active.code, s.offerV, on);
  } catch (e) {
    toast(e.message, 'alert');
  }
}

async function setOffer(ctx, offer) {
  active.warn = '';
  try {
    await api.tradeOffer(active.code, offer);
  } catch (e) {
    toast(e.message, 'alert');
  }
}

/** Choisir les cartes à poser (6 au plus). */
function pickSheet(ctx, s) {
  const st = ctx.st;
  const theyWant = new Set(s.them?.wish ?? []);
  const chosen = new Map(s.me.offer.map((t) => [t.card.id, t.serial]));
  const grid = h('div.tpick-grid');
  const entries = Object.entries(st.owned)
    .map(([id, serials]) => ({ c: ctx.card(id), serials }))
    .filter((x) => x.c)
    .sort((a, b) => (theyWant.has(b.c.id) ? 1 : 0) - (theyWant.has(a.c.id) ? 1 : 0) || b.serials.length - a.serials.length || a.c.title.localeCompare(b.c.title));
  const foot = tbtn('', 'check', 'tbtn--primary');
  const label = () => (foot.querySelector('span').textContent = chosen.size ? `Poser ${plural(chosen.size, 'carte')}` : 'Ne rien poser');
  for (const { c, serials } of entries) {
    const serial = serials[serials.length - 1];
    const cell = h(`button.tpick-cell${chosen.has(c.id) ? '.is-on' : ''}`, { type: 'button', attrs: { 'aria-pressed': String(chosen.has(c.id)), 'aria-label': `${c.title}, ${RLABEL[c.rarity]}` } }, cardEl(c, { size: 'sm', serial: chosen.get(c.id) ?? serial, count: serials.length }));
    if (theyWant.has(c.id)) cell.append(h('span.tpick-want', {}, ic('heart', 'ic ic--xs'), 'Il la cherche'));
    if (serials.length === 1) cell.append(h('span.tpick-last', { text: 'Ton seul exemplaire' }));
    cell.addEventListener('click', () => {
      if (chosen.has(c.id)) chosen.delete(c.id);
      else if (chosen.size >= 6) return toast('6 cartes au plus par échange.', 'alert');
      else chosen.set(c.id, serial);
      cell.classList.toggle('is-on', chosen.has(c.id));
      cell.setAttribute('aria-pressed', String(chosen.has(c.id)));
      label();
    });
    grid.append(cell);
  }
  label();
  const sh = sheet('pick', 'Choisir mes cartes', [h('p.tk', { text: 'Tu donnes' }), h('h2.tdet-h', { text: 'Choisis les cartes à poser sur la table' }), h('p.thelp', { text: s.them?.wish?.length ? `En premier : celles que ${s.them.pseudo} cherche.` : 'Tes doubles sont les meilleures monnaies d’échange.' }), entries.length ? grid : h('p.tco-empty', { text: 'Ta collection est vide : ouvre ton booster du jour.' }), h('div.tpick-foot', {}, foot)]);
  foot.addEventListener('click', () => {
    sh.close();
    setOffer(
      ctx,
      [...chosen].map(([card, serial]) => ({ card, serial })),
    );
  });
}

function renderDone(ctx, s) {
  const got = (s.got ?? []).map((x) => ({ c: ctx.card(x.card), serial: x.serial })).filter((x) => x.c);
  const row = h('div.rc-row', {}, ...got.map(({ c, serial }) => cardEl(c, { size: 'md', serial, live: true, isNew: true })));
  if (motionOK()) [...row.children].forEach((c, i) => c.animate([{ opacity: 0, transform: 'translateY(24px) rotate(-3deg)' }, { opacity: 1, transform: 'none' }], { duration: 420, delay: 100 * i, easing: 'cubic-bezier(.2,.8,.2,1)', fill: 'backwards' }));
  return h(
    'section.ttb',
    {},
    h(
      'div.rc',
      {},
      h('p.tk', { text: 'Échange terminé' }),
      h('h2.rc-h', { text: got.length ? `Tu reçois ${plural(got.length, 'carte')} !` : 'Cadeau envoyé !' }),
      got.length ? row : null,
      h('p.rc-p', { text: `Tu as donné ${plural((s.gave ?? []).length, 'carte')} à ${s.them?.pseudo ?? 'ton partenaire'}.` }),
      h(
        'div.rc-acts',
        {},
        tbtn('Nouvel échange', 'trade', 'tbtn--ghost', () => closeTable(ctx)),
        tbtn('Voir ma collection', 'collection', 'tbtn--primary', () => {
          active?.stop?.();
          active = null;
          ctx.go('collection');
        }),
      ),
    ),
  );
}
