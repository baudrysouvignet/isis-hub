// Administration · Retours des étudiants (« Une idée ? ») : filtres par statut, recherche, liste et
// détail (statut, réponse visible dans « Mes propositions », note interne, suppression).
// Tout ce qui vient des étudiants est affiché comme du texte.

import { $$, h, icon, toast } from './core/dom.js';

const STATUSES = [
  ['new', 'Nouveau'],
  ['review', 'À l’étude'],
  ['planned', 'Planifié'],
  ['done', 'Fait'],
  ['declined', 'Refusé'],
];
const LAB = Object.fromEntries(STATUSES);
const TYP = { idea: 'Idée', better: 'Amélioration', bug: 'Bug', other: 'Autre' };
const dateFmt = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Paris' });
const shortFmt = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', timeZone: 'Europe/Paris' });
const norm = (t) => (t ?? '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
const open = (f) => f.status === 'new' || f.status === 'review';

export function setupFeedback({ root, app, api, onCount }) {
  const st = { status: 'open', q: '', sel: null };
  let items = [];
  const filters = h('div.adm-chips', { role: 'group', attrs: { 'aria-label': 'Statut' } });
  const q = h('input.input.ed-q', { type: 'search', placeholder: 'Chercher un retour', attrs: { 'aria-label': 'Chercher un retour' } });
  const list = h('ul.rt-list');
  const detail = h('div.rt-detail');
  root.replaceChildren(
    h('div.adm-toolbar', {}, filters, h('label.ed-search', {}, icon('search', 'ic ic--sm'), q)),
    h('div.rt-wrap', {}, h('section.adm-card.rt-l', { attrs: { 'aria-label': 'Liste des retours' } }, list), h('section.adm-card.rt-d', { attrs: { 'aria-live': 'polite', 'aria-label': 'Retour choisi' } }, detail)),
  );
  q.addEventListener('input', () => {
    st.q = norm(q.value.trim());
    render();
  });

  const matches = (f, v) => (v === 'all' ? true : v === 'open' ? open(f) : f.status === v);

  function render() {
    const opts = [['open', 'À traiter'], ...STATUSES, ['all', 'Tous']];
    filters.replaceChildren(
      ...opts.map(([v, lab]) =>
        h('button.adm-chip', { type: 'button', attrs: { 'aria-pressed': String(st.status === v) }, on: { click: () => ((st.status = v), render()) } }, lab, h('b', { text: String(items.filter((f) => matches(f, v)).length) })),
      ),
    );
    const shown = items.filter((f) => matches(f, st.status) && (!st.q || norm(`${f.title} ${f.desc} ${f.zone} ${f.author ?? ''} ${f.id}`).includes(st.q)));
    list.replaceChildren(
      ...shown.map((f) =>
        h(
          'li',
          {},
          h(
            `button.rt-item${st.sel === f.id ? '.is-sel' : ''}`,
            { type: 'button', on: { click: () => ((st.sel = f.id), render(), app.classList.add('rt-open')) } },
            h('span.rt-top', {}, h(`span.status.status--${f.status}`, { text: LAB[f.status] }), h('span.chip', { text: TYP[f.type] ?? f.type }), h('span.rt-date', { text: `#${f.id} · ${shortFmt.format(new Date(f.created))}` })),
            h('b', { text: f.title }),
            f.desc ? h('span.rt-desc', { text: f.desc }) : null,
          ),
        ),
      ),
    );
    if (!shown.length) list.append(h('li.ed-empty', { text: items.length ? 'Rien ici.' : 'Aucun retour pour l’instant.' }));
    onCount?.(items.filter((f) => f.status === 'new').length);
    renderDetail();
  }

  function renderDetail() {
    const f = items.find((x) => x.id === st.sel);
    if (!f) return detail.replaceChildren(h('p.adm-hint.rt-none', { text: 'Choisis un retour dans la liste.' }));
    const sel = h('select.input.select', { id: 'fb-st' }, ...STATUSES.map(([v, l]) => h('option', { value: v, text: l, selected: v === f.status })));
    const reply = h('textarea.input.textarea', { id: 'fb-rep', rows: 3, value: f.reply ?? '', placeholder: 'Visible par l’étudiant dans « Mes propositions ».' });
    const note = h('textarea.input.textarea', { id: 'fb-note', rows: 2, value: f.note ?? '', placeholder: 'Visible des admins seulement.' });
    const save = h('button.btn.btn--primary', { type: 'button', text: 'Enregistrer' });
    const del = h('button.btn.btn--ghost.gr-danger', { type: 'button', text: 'Supprimer' });
    detail.replaceChildren(
      h('button.btn.btn--ghost.btn--sm.rt-back', { type: 'button', on: { click: () => app.classList.remove('rt-open') } }, icon('back', 'ic ic--sm'), 'Liste'),
      h('p.rt-top', {}, h('span.chip', { text: TYP[f.type] ?? f.type }), h('span.rt-date', { text: `#${f.id} · ${f.zone}` })),
      h('h2.rt-title', { text: f.title }),
      ...(f.desc ? [h('p.rt-body.adm-desc', { text: f.desc })] : []),
      h(
        'dl.facts',
        {},
        h('div.fact', {}, h('dt', {}, icon('user', 'ic ic--sm'), 'Auteur'), h('dd', { text: f.author ? `${f.author} (déclaré par la page, non vérifié)` : 'Anonyme' })),
        h('div.fact', {}, h('dt', {}, icon('clock', 'ic ic--sm'), 'Dates'), h('dd', { text: `Reçu le ${dateFmt.format(new Date(f.created))}${f.updated !== f.created ? ` · modifié le ${dateFmt.format(new Date(f.updated))}` : ''}` })),
        h('div.fact', {}, h('dt', {}, icon('doc', 'ic ic--sm'), 'Appareil'), h('dd', { text: f.tech || 'Non joint' })),
      ),
      h('div.field', {}, h('label.label', { attrs: { for: 'fb-st' }, text: 'Statut' }), h('div.select-wrap', {}, sel, icon('chevDown', 'ic ic--sm select-chev'))),
      h('div.field', {}, h('label.label', { attrs: { for: 'fb-rep' }, text: 'Réponse à l’étudiant' }), reply),
      h('div.field', {}, h('label.label', { attrs: { for: 'fb-note' }, text: 'Note interne' }), note),
      h('div.adm-actions', {}, del, h('span.spacer'), save),
    );
    save.addEventListener('click', async () => {
      save.disabled = true;
      try {
        const saved = await api(`feedback/${f.id}`, { status: sel.value, reply: reply.value, note: note.value });
        items = items.map((x) => (x.id === saved.id ? saved : x));
        render();
        toast(`#${saved.id} enregistré · ${LAB[saved.status]}${saved.reply ? ', réponse visible par l’étudiant' : ''}`, 'check');
      } catch (err) {
        toast(`Enregistrement impossible : ${err.message}`, 'alert');
      } finally {
        save.disabled = false;
      }
    });
    del.addEventListener('click', async () => {
      if (!confirm(`Supprimer définitivement la proposition #${f.id} « ${f.title} » ? Son auteur ne la verra plus dans « Mes propositions ».`)) return;
      try {
        await api(`feedback/${f.id}/delete`, {});
        items = items.filter((x) => x.id !== f.id);
        st.sel = null;
        app.classList.remove('rt-open');
        render();
        toast(`#${f.id} supprimée`, 'check');
      } catch (err) {
        toast(`Suppression impossible : ${err.message}`, 'alert');
      }
    });
  }

  return {
    async load() {
      items = await api('feedback');
      if (st.sel == null) st.sel = items.find(open)?.id ?? null;
      render();
      return items;
    },
    newCount: () => items.filter((f) => f.status === 'new').length,
    openCount: () => items.filter(open).length,
    focusFirst: () => $$('.rt-item', list)[0]?.focus(),
  };
}
