// ISIS · TCG : « Qui est sur la photo ? » — adresses en étiquettes, avec les suggestions de
// l'annuaire de l'université (comme le champ « Cc » d'un mail). Adresses de l'université seulement.

import { h } from '../core/dom.js';

export const MAX_PEOPLE = 5;
const UNIV_MAIL = /^[a-z0-9][a-z0-9._%+-]{0,63}@([a-z0-9-]+\.)*univ-jfc\.fr$/;
export const isUnivMail = (a) => UNIV_MAIL.test(a);
const isStudent = (p) => p.cat === 'etud' || /@etud\./i.test(p.email);
/** Étudiants d'abord (ordre d'origine gardé à l'intérieur de chaque groupe). */
const studentsFirst = (list) => [...list.filter(isStudent), ...list.filter((p) => !isStudent(p))];

// Personnes déjà indiquées sur des cartes : gardées sur cet appareil seulement (confort de
// l'administrateur), 20 au plus, la plus récente d'abord.
const RECENT_KEY = 'hub.tcg.people';
function localRecents() {
  try {
    const list = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]');
    return Array.isArray(list) ? list.filter((p) => p && isUnivMail(p.email)) : [];
  } catch {
    return [];
  }
}
function remember(email, name) {
  try {
    const list = [{ email, name: name || '' }, ...localRecents().filter((p) => p.email !== email)].slice(0, 20);
    localStorage.setItem(RECENT_KEY, JSON.stringify(list));
  } catch {
    // stockage indisponible (navigation privée) : pas de récents, rien d'autre ne change
  }
}
const norm = (s) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

/**
 * search(q) → [{ name, email, cat }] (annuaire) ; recent() → personnes à qui l'on a écrit
 * (boîte « Envoyés ») ; les deux peuvent échouer : la saisie libre reste possible.
 * Liste : d'abord les récents (indiqués sur des cartes, puis écrits), puis l'annuaire, étudiants
 * en premier. Rend { el, list(), focus() } ; list() = adresses retenues.
 */
export function peoplePicker({ search, recent, isIsis = () => false, initial = [], id = 'tad-people', onChange } = {}) {
  // Ordre de l'annuaire : étudiants d'ISIS, personnel d'ISIS, autres étudiants, puis le reste.
  const rank = (p) => (isIsis(p) ? 0 : 2) + (isStudent(p) ? 0 : 1);
  const byRank = (list) => list.map((p, i) => [p, i]).sort((a, b) => rank(a[0]) - rank(b[0]) || a[1] - b[1]).map(([p]) => p);
  let mailRecents = [];
  recent?.()
    .then((l) => (mailRecents = (l ?? []).filter((p) => isUnivMail(p.email))))
    .catch(() => {});
  const recents = (q) => {
    const n = norm(q);
    const seen = new Set();
    return studentsFirst(
      [...localRecents(), ...mailRecents].filter((p) => {
        if (seen.has(p.email) || chosen.has(p.email)) return false;
        seen.add(p.email);
        return !n || norm(`${p.name} ${p.email}`).includes(n);
      }),
    ).map((p) => ({ ...p, recent: true }));
  };
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
    remember(addr, name);
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
        const tags = [isIsis(p) ? h('em.tpp-tag.is-isis', { text: 'ISIS' }) : null, p.recent ? h('em.tpp-tag', { text: 'Récent' }) : isStudent(p) ? h('em.tpp-tag.is-etud', { text: 'Étudiant' }) : null];
        const li = h(`li.tpp-opt${i === active ? '.is-on' : ''}`, { attrs: { role: 'option' } }, h('b', {}, p.name || p.email, ...tags), h('span', { text: p.email }));
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
    if (q.length < 2 || !search) return openRecents(q);
    const mine = ++token;
    timer = setTimeout(async () => {
      try {
        const near = recents(q).slice(0, 4);
        const dir = byRank((await search(q)).filter((p) => isUnivMail(p.email) && !chosen.has(p.email) && !near.some((r) => r.email === p.email)));
        const found = [...near, ...dir].slice(0, 10);
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
  // Champ vide ou une lettre : les récents d'abord (comme le champ « Cc » d'un mail).
  function openRecents(q) {
    items = document.activeElement === input ? recents(q).slice(0, 8) : [];
    active = items.length ? 0 : -1;
    showAc();
  }
  input.addEventListener('focus', () => !input.value.trim() && openRecents(''));
  input.addEventListener('blur', () => setTimeout(closeAc, 120));
  box.addEventListener('click', () => input.focus());
  for (const a of initial) if (isUnivMail(a) && chosen.size < MAX_PEOPLE) chosen.set(a, '');
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
