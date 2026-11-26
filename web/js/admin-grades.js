// Administration : maquettes de notes, classe par classe.
//   - à gauche, les classes et leur état (notes activées, désactivées, pas encore saisies) ;
//   - à droite, l'interrupteur « Notes activées » et, si elles sont désactivées, le message vu
//     par les étudiants ; puis les semestres, et pour chacun les UE et leurs matières, à déplier
//     une par une (coefficients, code ADE, évaluations prévues) ;
//   - import / export JSON et exemple à télécharger ou charger ;
//   - barre d'enregistrement qui signale les modifications en attente ;
//   - « Toutes les maquettes » : exporter les coefficients (UE et matières) de toutes les classes,
//     réimporter un JSON qui les réécrit d'un coup, remettre les coefficients des matières à 1,
//     retirer toutes les évaluations prévues. Chaque fois : un essai à blanc dit ce qui changera,
//     puis tout s'enregistre d'un coup (ou rien). Les notes des étudiants ne sont jamais touchées :
//     une note posée sur une évaluation retirée devient une note personnelle de la même matière.
// Les identifiants internes des matières et évaluations sont créés ici et ne changent plus : les
// notes déjà saisies par les étudiants restent attachées quand on renomme ou réordonne.

import { $, $$, h, icon, toast } from './core/dom.js';
import { normalizeImport } from './core/grades-import.js';
import { EXAMPLE } from './admin-grades-example.js';

const DEFAULT_MESSAGE = 'Ta maquette de notes n’a pas encore été saisie. Le système de notes sera disponible très bientôt : merci de ta patience !';
const rid = (p) => `${p}-${crypto.getRandomValues(new Uint32Array(1))[0].toString(36)}`;
const num = (v) => {
  const n = parseFloat(String(v).replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
};
const fmt = (n) => String(Math.round((Number(n) || 0) * 100) / 100).replace('.', ',');
const plural = (n, one, many = `${one}s`) => `${n} ${n > 1 ? many : one}`;

/** Champ lié au modèle : chaque frappe met à jour l'objet puis appelle onChange. */
function bound(obj, key, onChange, { label, placeholder = '', type = 'text', max = 120, numeric = false, upper = false, cls = '' } = {}) {
  const i = h('input.input', {
    type,
    class: cls,
    value: obj[key] ?? '',
    attrs: { placeholder, maxlength: String(max), 'aria-label': label ?? placeholder, ...(numeric && { inputmode: 'decimal' }) },
  });
  i.addEventListener('input', () => {
    obj[key] = numeric ? num(i.value) : upper ? i.value.trim().toUpperCase() : i.value;
    onChange();
  });
  return i;
}
const field = (label, control, hint) => h('label.gf', {}, h('span.gf-l', { text: label }), control, hint ? h('small.gf-h', { text: hint }) : '');

const blankSemester = (n) => ({ id: `S${n}`, label: `Semestre ${n}`, ues: [] });
const blankEval = (label = '') => ({ id: rid('e'), label, coef: 1, date: '' });
const blankSubject = () => ({ id: rid('m'), name: '', coef: 1, code: '', evals: [blankEval('Examen')] });
const blankUE = (sem) => {
  const base = String(sem.id).replace(/\D/g, '') || '1';
  return { id: `${base}.${sem.ues.length + 1}`, name: '', coef: 1, matieres: [blankSubject()] };
};
const counts = (g) => {
  const ues = g?.semesters?.flatMap((s) => s.ues) ?? [];
  const mats = ues.flatMap((u) => u.matieres);
  return { sems: g?.semesters?.length ?? 0, ues: ues.length, mats: mats.length, evals: mats.flatMap((m) => m.evals).length };
};
const stateOf = (g) => (!g ? 'none' : g.disabled ? 'off' : 'on');
const STATE = { on: 'Notes activées', off: 'Désactivées', none: 'Pas encore saisie' };

export function setupGradesAdmin({ api, getClasses }) {
  const panel = $('[data-adm-panel="grades"]');
  const list = $('[data-gr-classes]', panel);
  const editor = $('[data-gr-editor]', panel);
  const bar = $('[data-gr-savebar]', panel);
  const fileIn = $('[data-gr-file]', panel);
  const coefIn = h('input', { type: 'file', hidden: true, attrs: { accept: 'application/json,.json' } });
  let book = {};
  let cls = null;
  let model = null; // maquette de la classe en cours d'édition (copie)
  let semIdx = 0;
  const opened = new WeakSet(); // UE et matières dépliées

  /** « FIE4:ia » → « FIE4 · Données de santé & IA » (nom du parcours dans la répartition). */
  const labelOf = (k) => {
    const [c, t] = String(k).split(':');
    return t ? `${c} · ${getClasses()?.trackLabels?.[t] ?? t}` : c;
  };
  const hasTracks = (k) => Object.keys(getClasses()?.classes?.[String(k).split(':')[0]]?.tracks ?? {}).length > 0;
  const saved = () => JSON.stringify(book[cls] ?? null);
  const dirty = () => JSON.stringify(model) !== saved();
  function touch() {
    const d = dirty();
    bar.classList.toggle('is-dirty', d);
    $('[data-gr-status]', bar).textContent = d ? 'Modifications non enregistrées' : 'Tout est enregistré';
    $('[data-gr-save]', bar).disabled = !d || !model;
    $('[data-gr-reset]', bar).disabled = !d;
    renderList();
  }

  // ------------------------------------------------------------ classes

  function renderList() {
    // Une entrée par classe, plus une par parcours pour les classes à parcours (FIE4, FIE5).
    const keys = new Set();
    for (const [k, c] of Object.entries(getClasses()?.classes ?? {})) {
      keys.add(k);
      Object.keys(c.tracks ?? {}).forEach((t) => keys.add(`${k}:${t}`));
    }
    Object.keys(book).forEach((k) => keys.add(k));
    list.replaceChildren(
      ...[...keys].sort().map((k) => {
        const g = k === cls ? model : book[k];
        const st = stateOf(g);
        const c = counts(g);
        return h(
          'button.gr-class',
          { type: 'button', class: [k === cls ? 'is-current' : '', k.includes(':') ? 'is-track' : ''].join(' '), attrs: { 'aria-pressed': String(k === cls) }, on: { click: () => choose(k) } },
          h('b', { text: k.includes(':') ? labelOf(k).split(' · ').slice(1).join(' · ') : k }), // parcours : son nom seul, sous sa classe
          h('span.gr-pill', { class: `is-${st}`, text: k === cls && dirty() ? 'Modifiée' : STATE[st] }),
          h('small', {
            text: g
              ? `${plural(c.ues, 'UE', 'UE')} · ${plural(c.mats, 'matière')}`
              : hasTracks(k) && !k.includes(':')
                ? 'Commune aux parcours sans maquette'
                : 'Aucune maquette',
          }),
        );
      }),
    );
  }

  function choose(k) {
    if (k === cls) return;
    if (model && dirty() && !confirm(`Abandonner les modifications de ${cls} ?`)) return;
    cls = k;
    model = book[k] ? structuredClone(book[k]) : null;
    semIdx = 0;
    render();
  }

  // ------------------------------------------------------------ rendu

  function evalRow(M, e, refresh) {
    const row = h(
      'div.gr-ev',
      {},
      bound(e, 'label', refresh, { label: 'Intitulé de l’évaluation', placeholder: 'ex. Examen', max: 40 }),
      bound(e, 'coef', refresh, { label: 'Coefficient de l’évaluation', placeholder: '1', numeric: true, max: 6, cls: 'gr-num' }),
      bound(e, 'date', refresh, { label: 'Date prévue (facultative)', type: 'date' }),
      h(
        'button.icon-btn.icon-btn--sm.gr-x',
        {
          type: 'button',
          title: 'Retirer cette évaluation (les notes déjà saisies restent, en notes personnelles)',
          attrs: { 'aria-label': `Retirer l’évaluation ${e.label || ''}` },
          on: {
            click: () => {
              M.evals = M.evals.filter((x) => x !== e);
              row.replaceWith();
              refresh();
            },
          },
        },
        icon('x', 'ic ic--sm'),
      ),
    );
    return row;
  }

  function subjectCard(U, M, refreshUE) {
    const sum = h('summary.gr-sum.gr-sum--m');
    const evals = h('div.gr-evs');
    const refresh = () => {
      sum.replaceChildren(
        icon('chevRight', 'ic ic--sm gr-chev'),
        h('span.gr-sum-t', {}, h('b', { text: M.name || 'Matière sans nom' }), M.code ? h('code', { text: M.code }) : ''),
        h('span.gr-sum-m', { text: `coef ${fmt(M.coef)} · ${plural(M.evals.length, 'évaluation')}` }),
      );
      sum.classList.toggle('is-incomplete', !M.name || !M.coef);
      refreshUE();
    };
    M.evals.forEach((e) => evals.append(evalRow(M, e, refresh)));
    const card = h(
      'details.gr-m',
      { open: opened.has(M), on: { toggle: (ev) => (ev.currentTarget.open ? opened.add(M) : opened.delete(M)) } },
      sum,
      h(
        'div.gr-m-body',
        {},
        h(
          'div.gr-row.gr-row--m',
          {},
          field('Matière', bound(M, 'name', refresh, { placeholder: 'ex. Interopérabilité des SI de santé' })),
          field('Coef', bound(M, 'coef', refresh, { numeric: true, max: 6, placeholder: '3', cls: 'gr-num' })),
          field('Code ADE', bound(M, 'code', refresh, { placeholder: 'A4-1-ISI-2', max: 48, upper: true }), 'Relie la matière aux séances de l’emploi du temps.'),
        ),
        h('div.gr-evs-head', {}, h('span', { text: 'Évaluations prévues' }), h('span', { text: 'Coef' }), h('span', { text: 'Date' }), h('span')),
        h('p.gf-h.gr-evs-hint', { text: 'Retirer une évaluation ne supprime aucune note : celles déjà saisies par les étudiants restent, comme notes personnelles de cette matière.' }),
        evals,
        h(
          'div.gr-m-foot',
          {},
          h(
            'button.btn.btn--sm.btn--ghost.gr-add',
            {
              type: 'button',
              on: {
                click: () => {
                  const e = blankEval();
                  M.evals.push(e);
                  const r = evalRow(M, e, refresh);
                  evals.append(r);
                  r.querySelector('input').focus();
                  refresh();
                },
              },
            },
            icon('plus', 'ic ic--sm'),
            'Évaluation',
          ),
          h('button.btn.btn--sm.btn--ghost.gr-danger', {
            type: 'button',
            text: 'Retirer la matière',
            on: {
              click: () => {
                if (!confirm(`Retirer « ${M.name || 'cette matière'} » ? Les notes déjà saisies par les étudiants ne compteront plus.`)) return;
                U.matieres = U.matieres.filter((x) => x !== M);
                card.replaceWith();
                refreshUE();
              },
            },
          }),
        ),
      ),
    );
    refresh();
    return card;
  }

  function ueCard(S, U) {
    const sum = h('summary.gr-sum');
    const mats = h('div.gr-ms');
    const refresh = () => {
      const totalCoef = U.matieres.reduce((a, m) => a + (Number(m.coef) || 0), 0);
      sum.replaceChildren(
        icon('chevRight', 'ic ic--sm gr-chev'),
        h('span.gr-ue-id', { text: `UE ${U.id || '?'}` }),
        h('span.gr-sum-t', {}, h('b', { text: U.name || 'UE sans nom' })),
        h('span.gr-sum-m', { text: `coef ${fmt(U.coef)} · ${plural(U.matieres.length, 'matière')} (coef ${fmt(totalCoef)})` }),
      );
      sum.classList.toggle('is-incomplete', !U.name || !U.coef || !U.matieres.length);
      touch();
    };
    U.matieres.forEach((M) => mats.append(subjectCard(U, M, refresh)));
    const card = h(
      'details.gr-ue',
      { open: opened.has(U), on: { toggle: (ev) => (ev.currentTarget.open ? opened.add(U) : opened.delete(U)) } },
      sum,
      h(
        'div.gr-ue-body',
        {},
        h(
          'div.gr-row.gr-row--ue',
          {},
          field('Numéro', bound(U, 'id', refresh, { placeholder: '7.1', max: 8 }), 'Affiché « UE 7.1 ».'),
          field('Nom de l’UE', bound(U, 'name', refresh, { placeholder: 'ex. Systèmes d’information de santé' })),
          field('Coef / ECTS', bound(U, 'coef', refresh, { numeric: true, max: 6, placeholder: '6', cls: 'gr-num' })),
        ),
        h('p.gr-k', { text: 'Matières' }),
        mats,
        h(
          'div.gr-ue-foot',
          {},
          h(
            'button.btn.btn--sm.gr-add',
            {
              type: 'button',
              on: {
                click: () => {
                  const M = blankSubject();
                  U.matieres.push(M);
                  opened.add(M);
                  const c = subjectCard(U, M, refresh);
                  mats.append(c);
                  c.querySelector('.gr-m-body input').focus();
                  refresh();
                },
              },
            },
            icon('plus', 'ic ic--sm'),
            'Ajouter une matière',
          ),
          h('button.btn.btn--sm.btn--ghost.gr-danger', {
            type: 'button',
            text: 'Retirer l’UE',
            on: {
              click: () => {
                if (!confirm(`Retirer l’UE ${U.id} et ses ${plural(U.matieres.length, 'matière')} ?`)) return;
                S.ues = S.ues.filter((x) => x !== U);
                card.replaceWith();
                touch();
              },
            },
          }),
        ),
      ),
    );
    refresh();
    return card;
  }

  function header() {
    const st = stateOf(model);
    const c = counts(model);
    const toggle = h('input', { type: 'checkbox', checked: Boolean(model && !model.disabled), disabled: !model, attrs: { 'aria-describedby': 'gr-toggle-h' } });
    toggle.addEventListener('change', () => {
      model.disabled = !toggle.checked;
      render();
    });
    const head = h(
      'div.gr-head',
      {},
      h(
        'div',
        {},
        h('h2', { text: labelOf(cls) }),
        h('p', {
          text: model
            ? `${plural(c.sems, 'semestre')} · ${plural(c.ues, 'UE', 'UE')} · ${plural(c.mats, 'matière')} · ${plural(c.evals, 'évaluation')}`
            : cls.includes(':')
              ? `Aucune maquette pour ce parcours : ses étudiants voient celle de ${cls.split(':')[0]} si elle existe.`
              : hasTracks(cls)
                ? 'Aucune maquette commune : chaque parcours peut avoir la sienne.'
                : 'Aucune maquette pour cette classe.',
        }),
      ),
      h(
        'label.gr-toggle',
        { class: `is-${st}` },
        h('span.gr-toggle-t', {}, h('b', { text: 'Système de notes' }), h('small', { id: 'gr-toggle-h', text: st === 'on' ? 'Activé : les étudiants saisissent leurs notes' : 'Désactivé : les étudiants voient le message' })),
        toggle,
        h('span.switch', { attrs: { 'aria-hidden': 'true' } }),
      ),
    );
    const out = [head];
    if (model?.disabled) {
      const msg = h('textarea.input.textarea', { rows: 3, value: model.message ?? '', attrs: { maxlength: '400', placeholder: DEFAULT_MESSAGE, 'aria-label': 'Message affiché aux étudiants' } });
      const preview = h('p.gr-wait-p', { text: model.message || DEFAULT_MESSAGE });
      msg.addEventListener('input', () => {
        model.message = msg.value;
        preview.textContent = msg.value.trim() || DEFAULT_MESSAGE;
        touch();
      });
      out.push(
        h(
          'div.gr-wait',
          {},
          h('div.gr-wait-edit', {}, h('span.gf-l', { text: 'Message affiché aux étudiants de ' + labelOf(cls) }), msg, h('small.gf-h', { text: 'Laisse vide pour le message par défaut. La maquette en cours de saisie reste invisible pour eux.' })),
          h('div.gr-wait-show', { attrs: { 'aria-hidden': 'true' } }, h('span.gf-l', { text: 'Aperçu de la tuile Notes' }), h('div.gr-wait-card', {}, icon('clock', 'ic ic--lg'), h('b', { text: 'Tes notes arrivent bientôt' }), preview)),
        ),
      );
    }
    return out;
  }

  function tools() {
    const copy = h('select.input.select', { attrs: { 'aria-label': 'Copier la maquette d’une autre classe' } }, h('option', { value: '', text: 'Copier depuis…' }), ...Object.keys(book).filter((k) => k !== cls).map((k) => h('option', { value: k, text: k })));
    copy.addEventListener('change', () => {
      const from = copy.value;
      copy.value = '';
      if (!from || !book[from]) return;
      if (model && !confirm(`Remplacer la maquette de ${cls} par une copie de celle de ${from} ?`)) return;
      // Nouveaux identifiants : les notes des deux classes restent séparées.
      model = structuredClone(book[from]);
      model.semesters.forEach((S) => S.ues.forEach((U) => U.matieres.forEach((M) => ((M.id = rid('m')), M.evals.forEach((e) => (e.id = rid('e'))), delete M.retired))));
      model.disabled = true;
      semIdx = 0;
      render();
      toast(`Copie de ${from} chargée (désactivée) : adapte-la puis enregistre`, 'check');
    });
    return h(
      'div.gr-tools',
      {},
      h('button.btn.btn--sm', { type: 'button', on: { click: () => fileIn.click() } }, icon('download', 'ic ic--sm gr-up'), 'Importer un JSON'),
      h('button.btn.btn--sm.btn--ghost', { type: 'button', on: { click: loadExample } }, icon('spark', 'ic ic--sm'), 'Charger l’exemple'),
      h('button.btn.btn--sm.btn--ghost', { type: 'button', on: { click: () => download(EXAMPLE, 'exemple-maquette-notes.json') } }, icon('download', 'ic ic--sm'), 'JSON d’exemple'),
      model ? h('button.btn.btn--sm.btn--ghost', { type: 'button', on: { click: () => download(model, `maquette-notes-${cls}.json`) } }, icon('download', 'ic ic--sm'), 'Exporter') : '',
      h('span.spacer'),
      h('div.select-wrap.gr-copy', {}, copy, icon('chevRight', 'ic ic--sm select-chev')),
    );
  }

  function semesterBlock() {
    const S = model.semesters[semIdx];
    const tabs = h(
      'div.gr-sems',
      { attrs: { role: 'tablist', 'aria-label': 'Semestres' } },
      ...model.semesters.map((s, i) =>
        h('button.gr-sem-tab', { type: 'button', attrs: { role: 'tab', 'aria-selected': String(i === semIdx) }, on: { click: () => ((semIdx = i), render()) } }, h('b', { text: s.id || '?' }), h('span', { text: s.label || 'Semestre' })),
      ),
      model.semesters.length < 4
        ? h('button.gr-sem-tab.gr-sem-add', {
            type: 'button',
            on: {
              click: () => {
                model.semesters.push(blankSemester(model.semesters.length + 1));
                semIdx = model.semesters.length - 1;
                render();
              },
            },
          }, icon('plus', 'ic ic--sm'), 'Semestre')
        : '',
    );
    if (!S) return [tabs, h('p.gr-empty', { text: 'Ajoute un premier semestre.' })];
    const refreshTab = () => {
      const t = $$('.gr-sem-tab', tabs)[semIdx];
      if (t) t.replaceChildren(h('b', { text: S.id || '?' }), h('span', { text: S.label || 'Semestre' }));
      touch();
    };
    const ues = h('div.gr-ues', {}, ...S.ues.map((U) => ueCard(S, U)));
    return [
      tabs,
      h(
        'div.gr-sem',
        {},
        h(
          'div.gr-row.gr-row--sem',
          {},
          field('Nom', bound(S, 'label', refreshTab, { placeholder: 'Semestre 7', max: 40 })),
          field('Court', bound(S, 'id', refreshTab, { placeholder: 'S7', max: 6, cls: 'gr-num' }), 'Sur la tuile.'),
          model.semesters.length > 1
            ? h('button.btn.btn--sm.btn--ghost.gr-danger.gr-sem-del', {
                type: 'button',
                text: 'Retirer',
                on: {
                  click: () => {
                    if (!confirm(`Retirer ${S.label || S.id} et ses ${plural(S.ues.length, 'UE', 'UE')} ?`)) return;
                    model.semesters.splice(semIdx, 1);
                    semIdx = 0;
                    render();
                  },
                },
              })
            : '',
        ),
        h(
          'div.gr-rules',
          {},
          h('span', { text: 'Seuils' }),
          h('label', {}, 'UE ≥ ', bound(model.rules, 'ue', touch, { numeric: true, max: 5, label: 'Moyenne minimale d’une UE', cls: 'gr-num' })),
          h('label', {}, 'matière ≥ ', bound(model.rules, 'matiere', touch, { numeric: true, max: 5, label: 'Note éliminatoire d’une matière', cls: 'gr-num' })),
          h('small.gf-h', { text: 'En dessous : rattrapage (UE), ou toute l’UE en rattrapage (matière).' }),
        ),
        S.ues.length ? ues : h('p.gr-empty', { text: 'Aucune UE pour ce semestre.' }),
        h(
          'button.gr-add-ue',
          {
            type: 'button',
            on: {
              click: () => {
                const U = blankUE(S);
                S.ues.push(U);
                opened.add(U);
                opened.add(U.matieres[0]);
                render();
                $$('.gr-ue', editor).at(-1)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
              },
            },
          },
          icon('plus', 'ic ic--sm'),
          'Ajouter une UE',
        ),
      ),
    ];
  }

  function render() {
    renderList();
    if (!model) {
      editor.replaceChildren(
        ...header(),
        tools(),
        h(
          'div.gr-start',
          {},
          icon('chart', 'ic ic--lg'),
          h('h3', { text: `Pas encore de maquette de notes pour ${labelOf(cls)}` }),
          h('p', { text: 'Les étudiants voient pour l’instant le message d’attente. Commence la saisie (elle reste invisible tant que les notes sont désactivées), charge l’exemple, ou importe un JSON.' }),
          h(
            'div.gr-start-a',
            {},
            h('button.btn.btn--primary', {
              type: 'button',
              text: 'Commencer la saisie',
              on: {
                click: () => {
                  model = { disabled: true, message: '', rules: { ue: 10, matiere: 7 }, semesters: [blankSemester(1)] };
                  semIdx = 0;
                  render();
                },
              },
            }),
            h('button.btn', { type: 'button', text: 'Charger l’exemple', on: { click: loadExample } }),
          ),
        ),
      );
    } else editor.replaceChildren(...header(), tools(), ...semesterBlock());
    touch();
  }

  // ------------------------------------------------------------ JSON

  function download(data, name) {
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/octet-stream' }));
    const a = h('a', { href: url, attrs: { download: name } });
    document.body.append(a);
    a.click();
    a.replaceWith();
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
  }
  function loadExample() {
    if (model && !confirm(`Remplacer la maquette de ${cls} par l’exemple ?`)) return;
    model = { disabled: true, message: '', ...normalizeImport(structuredClone(EXAMPLE), { currentClass: cls })[cls] };
    semIdx = 0;
    render();
    toast('Exemple chargé (notes désactivées) : adapte-le puis enregistre', 'check');
  }
  fileIn.addEventListener('change', async () => {
    const file = fileIn.files[0];
    fileIn.value = '';
    if (!file) return;
    if (file.size > 512 * 1024) return toast('Fichier trop lourd (512 Ko au plus).');
    let parsed;
    try {
      parsed = normalizeImport(JSON.parse(await file.text()), { currentClass: cls });
    } catch (err) {
      return toast(`Import impossible : ${err.message}`);
    }
    const keys = Object.keys(parsed);
    if (keys.length === 1 && keys[0] === cls) {
      model = { disabled: model?.disabled ?? true, message: model?.message ?? '', ...parsed[cls] };
      semIdx = 0;
      render();
      return toast(`Maquette de ${cls} importée : relis-la puis enregistre`, 'check');
    }
    if (!confirm(`Importer et enregistrer les maquettes de ${keys.join(', ')} ? Elles remplacent les maquettes actuelles (l’état activé / désactivé de chaque classe est conservé).`)) return;
    const done = [];
    const failed = [];
    for (const k of keys) {
      try {
        book = await api('grades', { class: k, grades: { disabled: book[k]?.disabled ?? true, message: book[k]?.message ?? '', ...parsed[k] } });
        done.push(k);
      } catch (err) {
        failed.push(`${k} (${err.message})`);
      }
    }
    if (done.includes(cls)) model = structuredClone(book[cls]);
    render();
    toast(failed.length ? `Importées : ${done.join(', ') || 'aucune'} · refusées : ${failed.join(' ; ')}` : `Maquettes importées et enregistrées : ${done.join(', ')}`, failed.length ? 'alert' : 'check');
  });

  // ------------------------------------------------------------ toutes les maquettes

  const bulkBox = h('section.gr-bulk', { attrs: { 'aria-labelledby': 'gr-bulk-h' } });
  $('.gr-layout', panel).before(bulkBox, coefIn);
  const bulkBtn = (text, ic, on, cls = '') => h(`button.btn.btn--sm${cls}`, { type: 'button', on: { click: on } }, icon(ic, 'ic ic--sm'), text);
  const where = (rep) => (rep.classes.length ? rep.classes.join(', ') : 'aucune maquette');
  function renderBulk() {
    bulkBox.replaceChildren(
      h('div.gr-bulk-t', {}, h('h3', { id: 'gr-bulk-h', text: 'Toutes les maquettes' }), h('p.hint', { text: 'Corriger les coefficients de toutes les classes d’un coup : exporte-les, modifie le JSON, réimporte-le. Avant chaque enregistrement, un aperçu dit ce qui changera. Les notes déjà saisies par les étudiants ne sont jamais touchées.' })),
      h(
        'div.gr-bulk-a',
        {},
        bulkBtn('Exporter les coefficients', 'download', exportCoefs),
        bulkBtn('Importer des coefficients', 'download', () => coefIn.click(), '.gr-up-btn'),
        bulkBtn('Coefficients des matières à 1', 'retry', resetCoefs, '.btn--ghost'),
        bulkBtn('Retirer les évaluations prévues', 'trash', clearEvals, '.btn--ghost.gr-danger'),
      ),
    );
  }
  /** Rien d'autre en cours : une opération sur toutes les maquettes remplacerait l'édition. */
  const editing = () => {
    if (model && dirty()) {
      toast(`Enregistre ou annule d’abord les modifications de ${cls}.`, 'alert');
      return true;
    }
    return false;
  };
  async function runBulk(body, ask, done) {
    if (editing()) return;
    let preview;
    try {
      preview = await api('grades/bulk', { ...body, dry: true });
    } catch (err) {
      return toast(`Refusé : ${err.message}`, 'alert');
    }
    const q = ask(preview.report);
    if (!q || !confirm(q)) return;
    try {
      const out = await api('grades/bulk', body);
      book = out.grades;
      model = book[cls] ? structuredClone(book[cls]) : null;
      render();
      toast(done(out.report), 'check');
    } catch (err) {
      toast(`Refusé : ${err.message}`, 'alert');
    }
  }
  async function exportCoefs() {
    try {
      download(await api('grades/coefs'), `coefficients-${new Date().toISOString().slice(0, 10)}.json`);
    } catch (err) {
      toast(`Export impossible : ${err.message}`, 'alert');
    }
  }
  coefIn.addEventListener('change', async () => {
    const file = coefIn.files[0];
    coefIn.value = '';
    if (!file) return;
    if (file.size > 512 * 1024) return toast('Fichier trop lourd (512 Ko au plus).', 'alert');
    let sheet;
    try {
      sheet = JSON.parse(await file.text());
    } catch {
      return toast('Ce fichier n’est pas un JSON lisible.', 'alert');
    }
    runBulk(
      { action: 'coefs', sheet },
      (rep) => {
        const unknown = rep.unknown?.length ? `\n\n${plural(rep.unknown.length, 'ligne', 'lignes')} sans correspondance (ignorées) :\n· ${rep.unknown.slice(0, 8).join('\n· ')}${rep.unknown.length > 8 ? '\n…' : ''}` : '';
        if (!rep.changed) {
          toast(`Aucun coefficient ne change.${rep.unknown?.length ? ` ${plural(rep.unknown.length, 'ligne')} sans correspondance.` : ''}`, 'alert');
          return null;
        }
        return `Réécrire ${plural(rep.changed, 'coefficient')} (${where(rep)}) ?${unknown}`;
      },
      (rep) => `${plural(rep.changed, 'coefficient modifié', 'coefficients modifiés')} · ${where(rep)}`,
    );
  });
  function resetCoefs() {
    runBulk(
      { action: 'reset-coefs' },
      (rep) => (rep.changed ? `Remettre au coefficient 1 les ${plural(rep.changed, 'matière')} qui en ont un autre (${where(rep)}) ? Les coefficients des UE ne changent pas.` : (toast('Toutes les matières sont déjà au coefficient 1.', 'check'), null)),
      (rep) => `${plural(rep.changed, 'matière remise', 'matières remises')} au coefficient 1`,
    );
  }
  function clearEvals() {
    runBulk(
      { action: 'clear-evals' },
      (rep) => (rep.evals ? `Retirer les ${plural(rep.evals, 'évaluation prévue', 'évaluations prévues')} de toutes les maquettes (${where(rep)}) ?\n\nLes notes que les étudiants y ont déjà saisies restent : elles deviennent des notes personnelles de la même matière, avec leur coefficient.` : (toast('Aucune évaluation prévue dans les maquettes.', 'check'), null)),
      (rep) => `${plural(rep.evals, 'évaluation retirée', 'évaluations retirées')} · les notes saisies restent`,
    );
  }
  renderBulk();

  // ------------------------------------------------------------ enregistrement

  $('[data-gr-save]', bar).addEventListener('click', async () => {
    if (!model) return;
    try {
      book = await api('grades', { class: cls, grades: model });
      model = structuredClone(book[cls]);
      render();
      toast(model.disabled ? `${cls} enregistrée : notes désactivées, les étudiants voient le message` : `${cls} enregistrée : les étudiants peuvent saisir leurs notes`, 'check');
    } catch (err) {
      toast(`Refusée : ${err.message}`);
    }
  });
  $('[data-gr-reset]', bar).addEventListener('click', () => {
    model = book[cls] ? structuredClone(book[cls]) : null;
    render();
  });
  $('[data-gr-remove]', bar).addEventListener('click', async () => {
    if (!book[cls] || !confirm(`Retirer la maquette de notes de ${cls} ? Les étudiants verront le message d’attente.`)) return;
    try {
      book = await api('grades', { class: cls, grades: null });
      model = null;
      render();
      toast(`Maquette de ${cls} retirée`, 'check');
    } catch (err) {
      toast(`Refusé : ${err.message}`);
    }
  });
  addEventListener('beforeunload', (e) => {
    if (model && dirty()) e.preventDefault();
  });

  return {
    async load() {
      book = await api('grades');
      const keys = Object.keys(getClasses()?.classes ?? {});
      cls ??= keys[0] ?? Object.keys(book)[0];
      model = book[cls] ? structuredClone(book[cls]) : null;
      render();
    },
  };
}
