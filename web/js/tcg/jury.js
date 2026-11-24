// ISIS · TCG : jury de la semaine. Chacun classe 5 cartes candidates (auteurs masqués, jamais les
// siennes), de « je la veux absolument » à « pas du tout » ; les plus attendues entrent dans la
// vague suivante, et deviennent les plus rares. Classement modifiable jusqu'à la fin du jury.

import { h, toast, motionOK } from '../core/dom.js';
import { api } from './api.js';
import { cardEl, ic, meter, tbtn, dayLong, hourText, dateShort, plural } from './ui.js';

const drafts = new Map(); // bulletin → ordre en cours (avant validation)
let editing = false;

export function renderJury(ctx) {
  const st = ctx.st;
  const jury = st.jury;
  const root = h('section.tju');
  if (!jury) {
    const now = new Date();
    const openWave = st.waves.find((w) => !w.printed && w.juryFrom && new Date(w.juryFrom) <= now && now < new Date(w.juryUntil));
    const next = st.waves.find((w) => !w.printed && w.juryFrom && new Date(w.juryFrom) > now);
    root.append(
      h('header.tv-head', {}, h('div', {}, h('p.tk', { text: 'Jury de la semaine' }), h('h1.tv-h1', { tabIndex: -1, text: openWave ? `Jury de la vague ${openWave.n}` : 'Pas de jury en ce moment' }))),
      h(
        'div.tju-done',
        {},
        h('span.tju-check', {}, ic('jury', 'ic')),
        h('p', { text: openWave ? `Le jury est ouvert jusqu’au ${dayLong(openWave.juryUntil)} à ${hourText(openWave.juryUntil)}, mais aucune carte validée n’attend encore d’autres que les tiennes. Propose les tiennes, ou reviens un peu plus tard.` : next ? `Le prochain jury ouvre le ${dayLong(next.juryFrom)} à ${hourText(next.juryFrom)} : tu classeras 5 cartes proposées par la promo.` : 'Le prochain jury sera annoncé ici. En attendant, propose tes cartes : elles y passeront.' }),
        tbtn('Créer une carte', 'pen', 'tbtn--primary', () => ctx.go('create')),
      ),
    );
    return root;
  }
  const bi = jury.ballots.length - 1;
  const ballot = jury.ballots[bi];
  const until = `${dayLong(jury.until).split(' ')[0]} ${dateShort(jury.until)}, ${hourText(jury.until)}`;
  root.append(
    h(
      'header.tv-head',
      {},
      h('div', {}, h('p.tk', { text: `Jury de la semaine · jusqu’à ${until}` }), h('h1.tv-h1', { tabIndex: -1, text: `Classe ces ${plural(ballot.cards.length, 'carte')}` })),
      meter(jury.jurors, jury.players, `${jury.jurors} / ${jury.players} jurés`, 'tju-meter'),
    ),
  );

  if (ballot.rank?.length && !editing) {
    root.append(done(ctx, jury, ballot, bi));
    return root;
  }

  root.append(h('p.tju-lead', { text: 'De celle que tu veux absolument voir dans le jeu, en haut, à celle que tu ne veux pas du tout, en bas. Glisse les cartes ou utilise les flèches.' }));
  const byId = new Map(ballot.cards.map((c) => [c.id, c]));
  const key = `${jury.wave}:${bi}`;
  let order = drafts.get(key) ?? (ballot.rank?.length ? [...ballot.rank] : ballot.cards.map((c) => c.id));
  order = order.filter((id) => byId.has(id));
  for (const c of ballot.cards) if (!order.includes(c.id)) order.push(c.id);
  let focus = order[0];

  const focusBox = h('div.tju-focus');
  const showFocus = () => {
    const c = byId.get(focus);
    focusBox.replaceChildren(cardEl(c, { size: 'lg', mystery: true, live: true, by: '' }), h('p.tju-anon', {}, ic('eye'), 'Auteurs masqués pendant le jury'));
  };
  const list = h('ol.tju-list', { attrs: { 'aria-label': 'Ton classement' } });

  function paint(animateFrom) {
    const before = animateFrom ?? new Map([...list.children].map((li) => [li.dataset.id, li.getBoundingClientRect().top]));
    list.replaceChildren(
      ...order.map((id, i) => {
        const c = byId.get(id);
        const up = h('button.tju-mv', { type: 'button', disabled: i === 0, attrs: { 'aria-label': `Monter « ${c.title} »` } }, ic('up'));
        const down = h('button.tju-mv', { type: 'button', disabled: i === order.length - 1, attrs: { 'aria-label': `Descendre « ${c.title} »` } }, ic('down'));
        up.addEventListener('click', () => move(i, i - 1));
        down.addEventListener('click', () => move(i, i + 1));
        const main = h('button.tju-main', { type: 'button' }, h('span.tju-thumb', {}, h('img', { alt: '', src: c.thumb || c.img })), h('span.tju-txt', {}, h('b', { text: c.title }), h('span', { text: c.desc })));
        main.addEventListener('click', () => {
          focus = id;
          showFocus();
          paint();
        });
        const grip = h('span.tju-grip', { attrs: { 'aria-hidden': 'true' } }, ic('grip'));
        const li = h(`li.tju-item${id === focus ? '.is-focus' : ''}`, { data: { id } }, h(`span.tju-rank.tju-rank--${Math.min(i, 4)}`, { text: String(i + 1) }), grip, main, h('span.tju-mvs', {}, up, down));
        dragHandle(grip, li);
        return li;
      }),
    );
    drafts.set(key, [...order]);
    if (!motionOK()) return;
    for (const li of list.children) {
      const was = before.get(li.dataset.id);
      if (was === undefined) continue;
      const dy = was - li.getBoundingClientRect().top;
      if (dy) li.animate([{ transform: `translateY(${dy}px)` }, { transform: 'none' }], { duration: 260, easing: 'cubic-bezier(.2,.8,.2,1)' });
    }
  }

  function move(from, to) {
    if (to < 0 || to >= order.length) return;
    const [id] = order.splice(from, 1);
    order.splice(to, 0, id);
    focus = id;
    showFocus();
    paint();
    list.querySelector(`[data-id="${CSS.escape(id)}"] .tju-mv:${to < from ? 'first-child' : 'last-child'}`)?.focus();
  }

  // Glisser-déposer (souris et doigt) par la poignée.
  function dragHandle(grip, li) {
    grip.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      const items = [...list.children];
      const start = e.clientY;
      const from = items.indexOf(li);
      const mids = items.map((x) => {
        const r = x.getBoundingClientRect();
        return r.top + r.height / 2;
      });
      li.classList.add('is-drag');
      grip.setPointerCapture(e.pointerId);
      let to = from;
      const onMove = (ev) => {
        const dy = ev.clientY - start;
        li.style.setProperty('transform', `translateY(${dy}px)`);
        const y = mids[from] + dy;
        to = mids.reduce((best, m, i) => (Math.abs(m - y) < Math.abs(mids[best] - y) ? i : best), from);
      };
      const onUp = () => {
        grip.removeEventListener('pointermove', onMove);
        grip.removeEventListener('pointerup', onUp);
        grip.removeEventListener('pointercancel', onUp);
        const before = new Map(items.map((x) => [x.dataset.id, x.getBoundingClientRect().top]));
        li.classList.remove('is-drag');
        li.style.removeProperty('transform');
        if (to !== from) {
          const [id] = order.splice(from, 1);
          order.splice(to, 0, id);
          focus = id;
          showFocus();
        }
        paint(before);
      };
      grip.addEventListener('pointermove', onMove);
      grip.addEventListener('pointerup', onUp);
      grip.addEventListener('pointercancel', onUp);
    });
  }

  const submit = tbtn('Valider mon classement', 'check', 'tbtn--primary tbtn--lg', async () => {
    submit.disabled = true;
    try {
      await api.vote(jury.wave, bi, order);
      drafts.delete(key);
      editing = false;
      toast('Classement enregistré. Merci, juré·e !', 'check');
      await ctx.reload();
    } catch (e) {
      toast(e.message, 'alert');
      submit.disabled = false;
    }
  });
  showFocus();
  paint(new Map());
  const scale = h('div.tju-scale', {}, h('span.tju-top', {}, ic('heart', 'ic ic--xs'), 'Je la veux absolument'), h('i'), h('span.tju-bot', { text: 'Pas du tout' }));
  root.append(
    h('div.tju-grid', {}, focusBox, h('div.tju-col', {}, h('div.tju-board', {}, scale, list), h('div.tju-foot', {}, h('p.thelp', { text: `Tu peux le modifier jusqu’à ${dayLong(jury.until).split(' ')[0]} ${hourText(jury.until)}. Tes propres cartes ne te sont jamais proposées.` }), submit))),
  );
  return root;
}

/** Classement validé : récapitulatif, modifier, ou 5 autres cartes. */
function done(ctx, jury, ballot, bi) {
  const byId = new Map(ballot.cards.map((c) => [c.id, c]));
  const mini = h(
    'div.tju-mini',
    {},
    ...ballot.rank
      .filter((id) => byId.has(id))
      .map((id, i) => {
        const c = byId.get(id);
        return h('figure', {}, h('span.tju-rank', { text: String(i + 1) }), h('img', { alt: '', src: c.thumb || c.img }), h('figcaption', { text: c.title }));
      }),
  );
  const acts = h('div.rc-acts');
  acts.append(
    tbtn('Modifier', 'pen', 'tbtn--ghost', () => {
      editing = true;
      ctx.render();
    }),
  );
  if (jury.more) {
    acts.append(
      tbtn('Classer 5 autres cartes', 'jury', 'tbtn--primary', async () => {
        try {
          await api.moreBallot();
          await ctx.reload();
        } catch (e) {
          toast(e.message, 'alert');
        }
      }),
    );
  }
  void bi;
  return h('div.tju-done', {}, h('span.tju-check', {}, ic('check', 'ic')), h('h2.tdet-h', { text: 'Classement enregistré' }), h('p', { text: `Résultat à la sortie de la vague ${jury.wave}. Les cartes que la promo attend le plus deviennent les plus rares.` }), mini, acts);
}
