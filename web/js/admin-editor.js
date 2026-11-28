// Administration · éditeur de lignes importées (fiches de stage, réponses du sondage, conseils).
// Une liste qu'on cherche et filtre (« À compléter »), une fiche par ligne dans une fenêtre, et une
// barre « Publier » tant que des modifications attendent. Rien ne part au serveur avant « Publier » :
// onPublish reçoit toutes les lignes et renvoie une promesse (le serveur vérifie tout le fichier).
//
// Design : maquette « Admin ISIS Hub · maquette » (Carrière). Tout ce qui vient des fichiers est
// affiché comme du texte.

import { $, h, icon, toast } from './core/dom.js';

const PAGE = 15;
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/**
 * @param {HTMLElement} host
 * @param {{
 *   name: string, unit?: string, placeholder?: string, rows: object[],
 *   id: (r) => string, title: (r) => string, sub: (r) => string, kicker?: (r) => string,
 *   search: (r) => string, issues: (r) => {key: string, text: string}[], fields: object[] | ((r) => object[]),
 *   onPublish: (rows: object[], removed: string[]) => Promise<void>, canDelete?: boolean, issueLabel?: string,
 * }} o
 */
export function createEditor(host, o) {
  let rows = o.rows.map((r) => structuredClone(r));
  let orig = new Map(rows.map((r) => [o.id(r), structuredClone(r)]));
  let removed = new Set();
  const st = { q: '', only: false, shown: PAGE };
  const changed = () => rows.filter((r) => !same(orig.get(o.id(r)), r));
  const pending = () => changed().length + removed.size;

  const q = h('input.input.ed-q', { type: 'search', placeholder: o.placeholder || 'Chercher…', autocomplete: 'off', attrs: { 'aria-label': `Chercher dans ${o.name}` } });
  const only = h('button.ed-only', { type: 'button', attrs: { 'aria-pressed': 'false' } });
  const count = h('p.ed-count', { attrs: { 'aria-live': 'polite' } });
  const list = h('ul.ed-list');
  const more = h('button.btn.btn--sm.ed-more', { type: 'button', text: 'Afficher plus' });
  const barText = h('span.ed-bar-t');
  const undo = h('button.btn.btn--ghost.btn--sm', { type: 'button', text: 'Tout annuler' });
  const pub = h('button.btn.btn--primary.btn--sm', { type: 'button', text: 'Publier' });
  const bar = h('div.ed-bar', { hidden: true }, h('span.ed-bar-dot', { attrs: { 'aria-hidden': 'true' } }), barText, h('span.spacer'), undo, pub);
  host.replaceChildren(h('div.ed-tools', {}, h('label.ed-search', {}, icon('search', 'ic ic--sm'), q), only), count, list, more, bar);

  let qt;
  q.addEventListener('input', () => {
    clearTimeout(qt);
    qt = setTimeout(() => {
      st.q = q.value.trim().toLowerCase();
      st.shown = PAGE;
      render();
    }, 120);
  });
  only.addEventListener('click', () => {
    st.only = !st.only;
    st.shown = PAGE;
    render();
  });
  more.addEventListener('click', () => {
    st.shown += PAGE;
    render();
  });
  undo.addEventListener('click', () => {
    rows = [...orig.values()].map((r) => structuredClone(r));
    removed = new Set();
    render();
    toast('Modifications annulées.', 'restore');
  });
  pub.addEventListener('click', async () => {
    const n = pending();
    if (!n) return;
    pub.disabled = undo.disabled = true;
    try {
      await o.onPublish(rows.map((r) => structuredClone(r)), [...removed]);
      orig = new Map(rows.map((r) => [o.id(r), structuredClone(r)]));
      removed = new Set();
      render();
      toast(`${n} ${n > 1 ? 'modifications publiées' : 'modification publiée'} : visible${n > 1 ? 's' : ''} tout de suite.`, 'check');
    } catch (err) {
      toast(`Refusé par le serveur : ${err.message}`, 'alert');
    } finally {
      pub.disabled = undo.disabled = false;
    }
  });

  function render() {
    const withIssues = rows.filter((r) => o.issues(r).length).length;
    only.replaceChildren(icon('alert', 'ic ic--sm'), h('span', { text: o.issueLabel || 'À compléter' }), h('b', { text: String(withIssues) }));
    only.setAttribute('aria-pressed', String(st.only));
    only.disabled = !withIssues && !st.only;
    const match = rows.filter((r) => (!st.only || o.issues(r).length) && (!st.q || o.search(r).toLowerCase().includes(st.q)));
    count.textContent = `${match.length} sur ${rows.length} ${o.unit || 'lignes'}${st.only ? ` ${(o.issueLabel || 'à compléter').toLowerCase()}` : ''}`;
    list.replaceChildren(
      ...match.slice(0, st.shown).map((r) => {
        const iss = o.issues(r);
        const mod = !same(orig.get(o.id(r)), r);
        return h(
          'li',
          {},
          h(
            `button.ed-row${iss.length ? '.has-issue' : ''}${mod ? '.is-mod' : ''}`,
            { type: 'button', on: { click: () => edit(r) } },
            h('span.ed-row-t', {}, h('b', { text: o.title(r) || 'Sans titre' }), h('span', { text: o.sub(r) })),
            h(
              'span.ed-row-s',
              {},
              mod ? h('span.ed-tag.ed-tag--mod', { text: 'Modifiée' }) : null,
              iss.length ? h('span.ed-tag.ed-tag--warn', { text: iss.length > 1 ? `${iss.length} manques` : iss[0].text }) : h('span.ed-tag.ed-tag--ok', {}, icon('check', 'ic ic--xs'), o.okLabel || 'Complète'),
            ),
            icon('chevRight', 'ic ic--sm ed-row-go'),
          ),
        );
      }),
    );
    if (!match.length) list.append(h('li.ed-empty', { text: st.only ? 'Tout est complet. Bravo !' : 'Aucune ligne ne correspond.' }));
    more.hidden = match.length <= st.shown;
    more.textContent = `Afficher plus (${match.length - st.shown} restantes)`;
    const c = pending();
    bar.hidden = !c;
    barText.textContent = `${c} ${c > 1 ? 'modifications' : 'modification'} pas encore publiée${c > 1 ? 's' : ''}`;
    o.onChange?.();
  }

  const dlg = h('dialog.ed-dlg', { attrs: { 'aria-labelledby': 'ed-dlg-t' } });
  ($('.app') || document.body).append(dlg);
  dlg.addEventListener('click', (e) => e.target === dlg && dlg.close());

  function edit(row) {
    const draft = structuredClone(row);
    const issues = o.issues(row);
    const iss = new Set(issues.map((i) => i.key));
    const fields = typeof o.fields === 'function' ? o.fields(row) : o.fields;
    const ctl = (f) => {
      const id = `ed-${f.key}`;
      const v = draft[f.key];
      const upd = (val) => {
        draft[f.key] = val;
        f.onInput?.(draft, val);
      };
      let input;
      if (f.type === 'select') {
        const sel = h(
          'select.input.select',
          { id, on: { change: () => upd(f.num ? Number(sel.value) : sel.value) } },
          ...(f.options || []).map(([val, lab]) => h('option', { value: String(val), text: lab, selected: String(val) === String(v ?? '') })),
        );
        input = h('div.select-wrap', {}, sel, icon('chevDown', 'ic ic--sm select-chev'));
      } else if (f.type === 'textarea') input = h('textarea.input.textarea', { id, rows: f.rows || 3, value: v ?? '', attrs: { maxlength: String(f.max || 2000) }, on: { input: (e) => upd(e.target.value) } });
      else if (f.type === 'check') input = h('label.ed-check', {}, h('input', { type: 'checkbox', id, checked: Boolean(v), on: { change: (e) => upd(f.bool ? e.target.checked : e.target.checked ? 1 : 0) } }), h('span', { text: f.check || 'Oui' }));
      else if (f.type === 'checks')
        input = h(
          'div.ed-checks',
          { role: 'group', attrs: { 'aria-labelledby': `${id}-l` } },
          ...f.options.map(([val, lab]) =>
            h(
              'label.ed-check',
              {},
              h('input', {
                type: 'checkbox',
                checked: (v || []).includes(val),
                on: { change: (e) => upd(e.target.checked ? [...(draft[f.key] || []), val].sort((a, b) => a - b) : (draft[f.key] || []).filter((x) => x !== val)) },
              }),
              h('span', { text: lab }),
            ),
          ),
        );
      else
        input = h('input.input', {
          id,
          type: f.type || 'text',
          value: v ?? '',
          inputMode: f.type === 'number' ? 'numeric' : undefined,
          attrs: { maxlength: f.type === 'number' || f.type === 'date' ? null : String(f.max || 200), min: f.min ?? null, max: f.maxv ?? null, step: f.step ?? null },
          on: { input: (e) => upd(f.type === 'number' ? (e.target.value === '' ? null : Number(e.target.value)) : e.target.value) },
        });
      const bad = iss.has(f.key);
      if (bad) (input.matches?.('input,select,textarea') ? input : input.querySelector('input,select,textarea'))?.setAttribute('aria-invalid', 'true');
      return h(
        `div.field.ed-field${f.wide ? '.is-wide' : ''}${bad ? '.is-bad' : ''}`,
        {},
        f.type === 'check' || f.type === 'checks' ? h('span.label', { id: `${id}-l`, text: f.label }) : h('label.label', { attrs: { for: id }, text: f.label }),
        input,
        bad ? h('p.ed-miss', {}, icon('alert', 'ic ic--xs'), issues.find((i) => i.key === f.key).text) : f.hint ? h('p.hint', { text: f.hint }) : null,
      );
    };
    const save = h('button.btn.btn--primary', { type: 'button', text: 'Valider' });
    const cancel = h('button.btn.btn--ghost', { type: 'button', text: 'Annuler' });
    const revert = orig.has(o.id(row)) && !same(orig.get(o.id(row)), row) ? h('button.btn.btn--ghost.btn--sm', { type: 'button', text: 'Revenir à la version publiée' }) : null;
    const del = o.canDelete ? h('button.btn.btn--ghost.btn--sm.gr-danger', { type: 'button', text: 'Supprimer la ligne' }) : null;
    dlg.replaceChildren(
      h(
        'div.ed-dlg-b',
        {},
        h(
          'header.ed-dlg-h',
          {},
          h('div', {}, h('p.ed-kicker', { text: o.kicker?.(row) || o.name }), h('h2', { id: 'ed-dlg-t', text: o.title(row) || 'Sans titre' })),
          h('button.icon-btn', { type: 'button', attrs: { 'aria-label': 'Fermer' }, on: { click: () => dlg.close() } }, icon('x', 'ic ic--sm')),
        ),
        iss.size ? h('p.ed-alert', {}, icon('alert', 'ic ic--sm'), `${iss.size > 1 ? `${iss.size} informations manquent` : 'Une information manque'} : complète les champs signalés.`) : null,
        o.note ? h('p.hint', { text: o.note(row) }) : null,
        h('div.ed-form', {}, ...fields.map(ctl)),
        h('footer.ed-dlg-f', {}, revert, del, h('span.spacer'), cancel, save),
      ),
    );
    cancel.addEventListener('click', () => dlg.close());
    revert?.addEventListener('click', () => {
      Object.assign(row, structuredClone(orig.get(o.id(row))));
      dlg.close();
      render();
    });
    del?.addEventListener('click', () => {
      if (!confirm('Supprimer cette ligne ? Elle disparaît à la publication.')) return;
      rows = rows.filter((r) => r !== row);
      if (orig.has(o.id(row))) removed.add(o.id(row));
      dlg.close();
      render();
    });
    save.addEventListener('click', () => {
      const err = o.check?.(draft);
      if (err) return toast(err, 'alert');
      for (const k of Object.keys(row)) if (!(k in draft)) delete row[k];
      Object.assign(row, draft);
      dlg.close();
      render();
      toast(o.issues(row).length ? 'Ligne modifiée, il manque encore des informations.' : 'Ligne prête. Pense à publier.', 'check');
    });
    dlg.showModal();
    (dlg.querySelector('[aria-invalid="true"]') || dlg.querySelector('input,select,textarea'))?.focus();
  }

  render();
  return {
    replace(next) {
      rows = next.map((r) => structuredClone(r));
      orig = new Map(rows.map((r) => [o.id(r), structuredClone(r)]));
      removed = new Set();
      st.shown = PAGE;
      render();
    },
    rows: () => rows,
    pending,
    incomplete: () => rows.filter((r) => o.issues(r).length).length,
  };
}
