// ISIS · TCG : la collection. Par vague, cartes possédées et emplacements manquants (numéro et
// rareté seulement), filtres par vague, rareté, doubles, manquantes et « Je cherche ». Un écho
// (copie de substitution) compte pour compléter la collection, jamais comme un double : il ne
// s'échange pas.

import { h, toast } from '../core/dom.js';
import { api } from './api.js';
import { cardEl, ghostEl, meter, pips, rchip, sheet, tbtn, RLABEL, RARITIES, ECHO, dateShort, plural } from './ui.js';

const filters = { wave: 0, rarities: new Set(), show: 'all' };
const SHOW = [
  ['all', 'Tout'],
  ['mine', 'Mes cartes'],
  ['doubles', 'Doubles'],
  ['missing', 'Manquantes'],
  ['wish', 'Je cherche'],
];

export function renderCollection(ctx) {
  const st = ctx.st;
  const printed = st.waves.filter((w) => w.printed).sort((a, b) => b.n - a.n);
  const all = [...ctx.cards.values()];
  const total = all.filter((c) => !c.removed).length;
  const has = (c) => ctx.owned(c.id).length > 0 || ctx.echoes(c.id) > 0;
  const mineN = all.filter(has).length;
  const wish = new Set(st.wish);
  if (filters.wave && !printed.some((w) => w.n === filters.wave)) filters.wave = 0;

  const root = h('section.tco');
  root.append(
    h(
      'header.tv-head',
      {},
      h('div', {}, h('p.tk', { text: `${st.season} · ${plural(printed.length, 'vague')}` }), h('h1.tv-h1', { tabIndex: -1, text: 'Ma collection' })),
      h('div.tco-score', {}, h('b', { text: String(mineN) }), h('span', { text: `/ ${total}` }), h('small', { text: `${total ? Math.round((mineN / total) * 100) : 0} %` })),
    ),
  );
  root.append(
    h(
      'div.tco-waves',
      {},
      ...printed.slice(0, 3).map((w) => {
        const ids = all.filter((c) => c.wave === w.n);
        const n = ids.filter(has).length;
        return h('div.tco-wave', {}, h('span', {}, h('b', { text: `Vague ${w.n}` }), ` · ${dateShort(w.releaseAt)}`), meter(n, ids.length, `${n} / ${ids.length}`));
      }),
    ),
  );

  // Filtres.
  const bar = h('div.tco-filters', { attrs: { role: 'toolbar', 'aria-label': 'Filtres' } });
  const seg = (items, cur, on, soft) =>
    h(
      `div.tseg${soft ? '.tseg--soft' : ''}`,
      {},
      ...items.map(([v, label]) => {
        const b = h(`button.tseg-b${v === cur ? '.is-on' : ''}`, { type: 'button', attrs: { 'aria-pressed': String(v === cur) } }, h('span', { text: label }));
        b.addEventListener('click', () => on(v));
        return b;
      }),
    );
  const rerender = () => ctx.render();
  bar.append(
    seg(
      [[0, 'Toutes'], ...printed.map((w) => [w.n, `V${w.n}`])],
      filters.wave,
      (v) => {
        filters.wave = v;
        rerender();
      },
    ),
  );
  bar.append(
    h(
      'div.tco-rar',
      {},
      ...RARITIES.map((r) => {
        const on = filters.rarities.has(r);
        const b = h(`button.tfilter.tfilter--${r}${on ? '.is-on' : ''}`, { type: 'button', attrs: { 'aria-pressed': String(on) } }, pips(r, 'tfilter-pips'), h('span', { text: RLABEL[r] }));
        b.addEventListener('click', () => {
          on ? filters.rarities.delete(r) : filters.rarities.add(r);
          rerender();
        });
        return b;
      }),
    ),
  );
  bar.append(
    seg(
      SHOW,
      filters.show,
      (v) => {
        filters.show = v;
        rerender();
      },
      true,
    ),
  );
  root.append(bar);

  // Grilles par vague.
  let shown = 0;
  for (const w of printed) {
    if (filters.wave && w.n !== filters.wave) continue;
    const list = all.filter((c) => c.wave === w.n).sort((a, b) => a.no - b.no);
    const own = list.filter(has).length;
    const grid = h('div.tco-grid');
    for (const c of list) {
      const mine = ctx.owned(c.id);
      const echoes = ctx.echoes(c.id);
      if (filters.rarities.size && !filters.rarities.has(c.rarity)) continue;
      if (filters.show === 'mine' && !has(c)) continue;
      if (filters.show === 'doubles' && mine.length < 2) continue;
      if (filters.show === 'missing' && has(c)) continue;
      if (filters.show === 'wish' && !wish.has(c.id)) continue;
      if (c.removed && !has(c)) continue;
      if (mine.length) {
        const serial = mine.find((s) => s > 0) || 0;
        const cell = h('button.tco-cell', { type: 'button', attrs: { 'aria-label': `${c.title}, ${RLABEL[c.rarity]}${echoes ? `, et ${plural(echoes, 'écho')}` : ''}` } }, cardEl(c, { size: 'sm', serial, count: mine.length }));
        cell.addEventListener('click', () => ctx.openCard(c, serial));
        grid.append(cell);
      } else if (echoes) {
        // Seulement des échos : la carte s'affiche en écho (finition mate, étiquette « Écho »).
        const cell = h('button.tco-cell', { type: 'button', attrs: { 'aria-label': `${c.title}, ${RLABEL[c.rarity]}, ${ECHO}` } }, cardEl(c, { size: 'sm', echo: true, count: echoes }));
        cell.addEventListener('click', () => ctx.openCard(c, 0, true));
        grid.append(cell);
      } else {
        const g = ghostEl(c, wish.has(c.id));
        g.addEventListener('click', () => ghostSheet(ctx, c));
        grid.append(g);
      }
      shown++;
    }
    if (!grid.children.length) continue;
    root.append(h('section.tco-sec', {}, h('h2.tco-sec-h', {}, h('span', { text: `Vague ${w.n}` }), h('small', { text: `${dateShort(w.releaseAt)} · ${own} / ${list.length}` })), grid));
  }
  if (!shown) {
    const msg = filters.show === 'wish' ? 'Ta liste « Je cherche » est vide : touche une carte manquante pour l’ajouter.' : filters.show === 'doubles' ? 'Pas encore de doubles : ils viendront avec les boosters.' : 'Aucune carte ne correspond à ces filtres.';
    root.append(h('div.tco-empty', {}, h('p', { text: msg })));
  }
  return root;
}

/** Carte manquante : numéro, rareté, « Je la cherche ». */
function ghostSheet(ctx, c) {
  const wished = ctx.st.wish.includes(c.id);
  const holders = (ctx.st.matches ?? []).filter((m) => m.has.includes(c.id));
  const g = ghostEl(c, wished);
  g.classList.add('is-big');
  g.disabled = true;
  let s;
  const toggle = tbtn(wished ? 'Retirer de « Je cherche »' : 'Je la cherche', 'heart', wished ? 'tbtn--ghost' : 'tbtn--primary', async () => {
    toggle.disabled = true;
    try {
      await api.wish(c.id, !wished);
      s.close();
      await ctx.reload();
      toast(wished ? 'Retirée de ta liste.' : 'Ajoutée à « Je cherche » : les joueurs qui l’ont te seront proposés.', 'check');
    } catch (e) {
      toast(e.message, 'alert');
      toggle.disabled = false;
    }
  });
  const info = h(
    'div',
    {},
    h('p.tk', { text: `Vague ${c.wave} · n° ${String(c.no).padStart(3, '0')}` }),
    h('h2.tdet-h', { text: 'Pas encore dans ta collection' }),
    rchip(c.rarity),
    h('p.tdet-desc', { text: c.run > 0 ? (c.issued >= c.run ? `Les ${plural(c.run, 'exemplaire numéroté', 'exemplaires numérotés')} sont tous tirés : elle sort désormais en ${ECHO}, aussi rarement que la vraie. Un écho complète ta collection ; seuls les exemplaires numérotés s’échangent.` : `${plural(c.run, 'exemplaire numéroté', 'exemplaires numérotés')}, ${plural(Math.max(0, c.run - c.issued), 'encore à tirer', 'encore à tirer')}. Deux boosters par jour, ou un échange.`) : 'Tirage illimité : elle finira par sortir d’un booster, ou échange-la.' }),
    holders.length ? h('p.thelp', { text: `${holders.map((m) => m.pseudo).join(', ')} ${holders.length > 1 ? 'l’ont' : 'l’a'} : propose un échange.` }) : null,
    h('div.tdet-acts', {}, toggle),
  );
  s = sheet('ghost', 'Carte manquante', h('div.tghost', {}, g, info));
}
