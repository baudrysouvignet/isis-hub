// ISIS · TCG : « Qui est sur la photo ? » — adresses en étiquettes, avec les suggestions de
// l'annuaire de l'université (comme le champ « Cc » d'un mail). Adresses de l'université seulement.

import { h } from '../core/dom.js';

export const MAX_PEOPLE = 5;
const UNIV_MAIL = /^[a-z0-9][a-z0-9._%+-]{0,63}@([a-z0-9-]+\.)*univ-jfc\.fr$/;
export const isUnivMail = (a) => UNIV_MAIL.test(a);

/**
 * search(q) → [{ name, email }] (annuaire), peut échouer : la saisie libre reste possible.
 * Rend { el, list(), focus() } ; list() = adresses retenues (texte en cours compris s'il est valide).
 */
export function peoplePicker({ search, id = 'tad-people', onChange } = {}) {
  const chosen = new Map(); // adresse → nom
  const chips = h('span.tpp-chips');
  const input = h('input.tpp-input', { id, type: 'email', autocomplete: 'off', placeholder: 'Nom ou adresse…', attrs: { spellcheck: 'false', autocapitalize: 'off', 'aria-autocomplete': 'list' } });
  const ac = h('ul.tpp-ac', { hidden: true, attrs: { role: 'listbox' } });
  const note = h('p.tpp-note', { hidden: true });
  const box = h('div.tpp-box', {}, chips, input);
  const el = h('div.tpp', {}, box, ac, note);
  let timer = 0;
  let token = 0;
  let items = [];
  let active = -1;

  const changed = () => onChange?.(list());
  const draw = () => {
    chips.replaceChildren(
      ...[...chosen].map(([addr, name]) => {
        const x = h('button.tpp-x', { type: 'button', attrs: { 'aria-label': `Retirer ${name || addr}` }, text: '×' });
        x.addEventListener('click', () => {
          chosen.delete(addr);
          draw();
          changed();
          input.focus();
        });
        return h('span.tpp-chip', { attrs: { title: addr } }, h('span', { text: name || addr }), x);
      }),
    );
    input.disabled = chosen.size >= MAX_PEOPLE;
    input.placeholder = chosen.size >= MAX_PEOPLE ? `${MAX_PEOPLE} personnes au plus` : chosen.size ? 'Ajouter…' : 'Nom ou adresse…';
  };
  const add = (addr, name = '') => {
    addr = addr.trim().toLowerCase();
    if (!addr) return true;
    if (!isUnivMail(addr)) {
      note.textContent = `« ${addr} » : seules les adresses de l’université (…@univ-jfc.fr) sont acceptées.`;
      note.hidden = false;
      return false;
    }
    if (chosen.size >= MAX_PEOPLE) return false;
    note.hidden = true;
    chosen.set(addr, name);
    input.value = '';
    closeAc();
    draw();
    changed();
    return true;
  };
  const closeAc = () => {
    ac.hidden = true;
    items = [];
    active = -1;
  };
  const showAc = () => {
    ac.replaceChildren(
      ...items.map((p, i) => {
        const li = h(`li.tpp-opt${i === active ? '.is-on' : ''}`, { attrs: { role: 'option' } }, h('b', { text: p.name || p.email }), h('span', { text: p.email }));
        li.addEventListener('mousedown', (e) => {
          e.preventDefault();
          add(p.email, p.name);
        });
        return li;
      }),
    );
    ac.hidden = !items.length;
  };
  input.addEventListener('input', () => {
    note.hidden = true;
    const q = input.value.trim();
    clearTimeout(timer);
    if (/[,;\s]$/.test(input.value)) {
      add(q.replace(/[,;]$/, ''));
      return;
    }
    if (q.length < 2 || !search) return closeAc();
    const mine = ++token;
    timer = setTimeout(async () => {
      try {
        const found = (await search(q)).filter((p) => isUnivMail(p.email) && !chosen.has(p.email)).slice(0, 8);
        if (mine !== token) return;
        items = found;
        active = found.length ? 0 : -1;
        showAc();
      } catch (err) {
        if (mine !== token) return;
        closeAc();
        note.textContent = `Suggestions indisponibles (${err.message}) : tape l’adresse en entier.`;
        note.hidden = false;
      }
    }, 220);
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (!items.length) return;
      e.preventDefault();
      active = (active + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
      showAc();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (active >= 0 && items[active]) add(items[active].email, items[active].name);
      else add(input.value);
    } else if (e.key === 'Backspace' && !input.value && chosen.size) {
      chosen.delete([...chosen.keys()].pop());
      draw();
      changed();
    } else if (e.key === 'Escape' && !ac.hidden) {
      e.stopPropagation();
      closeAc();
    }
  });
  input.addEventListener('blur', () => setTimeout(closeAc, 120));
  box.addEventListener('click', () => input.focus());
  draw();
  return {
    el,
    /** Adresses retenues, plus le texte en cours s'il forme une adresse valide ; null si invalide. */
    list() {
      const rest = input.value.trim().toLowerCase();
      if (rest && !add(rest)) return null;
      return [...chosen.keys()];
    },
    focus: () => input.focus(),
  };
}
