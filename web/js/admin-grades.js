// Administration : maquettes de notes. Pour chaque classe et chaque semestre, les UE (numéro, nom,
// coefficient), leurs matières (nom, coefficient, code ADE pour le lien avec l'emploi du temps) et
// les évaluations prévues (intitulé, coefficient, date). Les étudiants y saisissent ensuite leurs
// notes. Les identifiants internes sont créés ici et ne changent plus : les notes déjà saisies
// restent attachées à la bonne évaluation quand on renomme ou réordonne.

import { $, h, icon, toast } from './core/dom.js';
import { normalizeImport } from './core/grades-import.js';

const rid = (p) => `${p}-${crypto.getRandomValues(new Uint32Array(1))[0].toString(36)}`;
const num = (v) => {
  const n = parseFloat(String(v).replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
};
const field = (label, control, hint) => h('label.adm-field', {}, h('span.label', { text: label }), control, hint ? h('small', { text: hint }) : '');
/** Champ lié au modèle : chaque frappe met à jour l'objet. */
function bound(obj, key, { placeholder = '', type = 'text', max = 120, numeric = false, upper = false, label } = {}) {
  const i = h('input.input', { type, value: obj[key] ?? '', attrs: { placeholder, maxlength: String(max), 'aria-label': label ?? placeholder, ...(numeric && { inputmode: 'decimal' }) } });
  i.addEventListener('input', () => {
    obj[key] = numeric ? num(i.value) : upper ? i.value.trim().toUpperCase() : i.value;
  });
  return i;
}
const blankSemester = (n) => ({ id: `S${n}`, label: `Semestre ${n}`, start: '', end: '', ues: [] });
const blankUE = (sem, k) => ({ id: `${String(sem.id).replace(/\D/g, '') || 1}.${k}`, name: '', coef: 1, matieres: [blankSubject()] });
function blankSubject() {
  return { id: rid('m'), name: '', coef: 1, code: '', evals: [{ id: rid('e'), label: 'Examen', coef: 1, date: '' }] };
}

export function setupGradesAdmin({ api, getClasses }) {
  const panel = $('[data-adm-panel="grades"]');
  const sel = $('[data-gr-class]', panel);
  const copyFrom = $('[data-gr-copy]', panel);
  const body = $('[data-gr-body]', panel);
  let book = {};
  let cls = null;
  let model = null; // maquette de la classe en cours d'édition
  let semIdx = 0;

  function renderClassList() {
    const keys = Object.keys(getClasses()?.classes ?? {});
    for (const k of Object.keys(book)) if (!keys.includes(k)) keys.push(k);
    keys.sort();
    sel.replaceChildren(...keys.map((k) => h('option', { value: k, text: `${k}${book[k] ? '' : ' · pas de maquette'}`, selected: k === cls })));
    copyFrom.replaceChildren(h('option', { value: '', text: 'Copier depuis…' }), ...Object.keys(book).filter((k) => k !== cls).map((k) => h('option', { value: k, text: k })));
  }

  function choose(k) {
    cls = k;
    model = book[k] ? structuredClone(book[k]) : null;
    semIdx = 0;
    renderClassList();
    render();
  }

  function evalRow(M, e) {
    const row = h(
      'div.gr-eval',
      {},
      bound(e, 'label', { placeholder: 'Intitulé (ex. Examen)', max: 40 }),
      bound(e, 'coef', { placeholder: 'Coef', numeric: true, max: 6, label: 'Coefficient de l’évaluation' }),
      bound(e, 'date', { placeholder: 'Date', type: 'date', label: 'Date prévue (facultatif)' }),
      h('button.icon-btn.icon-btn--sm', {
        type: 'button',
        attrs: { 'aria-label': `Retirer l’évaluation ${e.label}` },
        on: {
          click: () => {
            M.evals = M.evals.filter((x) => x !== e);
            row.remove();
          },
        },
      }, icon('x', 'ic ic--sm')),
    );
    return row;
  }

  function subjectBlock(U, M) {
    const evals = h('div.gr-evals', {}, ...M.evals.map((e) => evalRow(M, e)));
    const block = h(
      'div.gr-subject',
      {},
      h(
        'div.gr-subject-head',
        {},
        field('Matière', bound(M, 'name', { placeholder: 'Interopérabilité des SI de santé' })),
        field('Coef', bound(M, 'coef', { numeric: true, max: 6, placeholder: '3' })),
        field('Code ADE', bound(M, 'code', { placeholder: 'A4-1-ISI-2', max: 48, upper: true }), 'Lien avec les séances.'),
        h('button.btn.btn--sm.btn--ghost.gr-del', {
          type: 'button',
          text: 'Retirer',
          on: {
            click: () => {
              if (!confirm(`Retirer la matière « ${M.name || 'sans nom'} » ? Les notes déjà saisies par les étudiants ne compteront plus.`)) return;
              U.matieres = U.matieres.filter((x) => x !== M);
              block.remove();
            },
          },
        }),
      ),
      h('p.gr-k', { text: 'Évaluations prévues' }),
      evals,
      h('button.btn.btn--sm.gr-add', {
        type: 'button',
        on: {
          click: () => {
            const e = { id: rid('e'), label: '', coef: 1, date: '' };
            M.evals.push(e);
            const r = evalRow(M, e);
            evals.append(r);
            r.querySelector('input').focus();
          },
        },
      }, icon('plus', 'ic ic--sm'), 'Évaluation'),
    );
    return block;
  }

  function ueCard(S, U) {
    const subjects = h('div.gr-subjects', {}, ...U.matieres.map((M) => subjectBlock(U, M)));
    const card = h(
      'details.adm-class.gr-ue',
      { open: true },
      h('summary', {}, h('b', { text: `UE ${U.id || '?'}` }), h('span', { text: ` · ${U.name || 'sans nom'} · coef ${U.coef}` })),
      h(
        'div.adm-grid3',
        {},
        field('Numéro', bound(U, 'id', { placeholder: '7.1', max: 8 }), 'Affiché « UE 7.1 ».'),
        field('Nom de l’UE', bound(U, 'name', { placeholder: 'Systèmes d’information de santé' })),
        field('Coefficient (ou ECTS)', bound(U, 'coef', { numeric: true, max: 6, placeholder: '6' })),
      ),
      subjects,
      h(
        'div.adm-actions',
        {},
        h('button.btn.btn--sm', {
          type: 'button',
          on: {
            click: () => {
              const M = blankSubject();
              U.matieres.push(M);
              const b = subjectBlock(U, M);
              subjects.append(b);
              b.querySelector('input').focus();
            },
          },
        }, icon('plus', 'ic ic--sm'), 'Matière'),
        h('span.spacer'),
        h('button.btn.btn--sm.btn--ghost', {
          type: 'button',
          text: 'Retirer l’UE',
          on: {
            click: () => {
              if (!confirm(`Retirer l’UE ${U.id} et ses matières ?`)) return;
              S.ues = S.ues.filter((x) => x !== U);
              card.remove();
            },
          },
        }),
      ),
    );
    return card;
  }

  function render() {
    if (!model) {
      body.replaceChildren(
        h(
          'div.empty',
          {},
          h('h3', { text: `Pas encore de maquette de notes pour ${cls}` }),
          h('p', { text: 'Crée-la ici, ou copie celle d’une autre classe puis adapte-la.' }),
          h('button.btn.btn--primary', {
            type: 'button',
            text: 'Créer la maquette',
            on: {
              click: () => {
                model = { rules: { ue: 10, matiere: 7 }, semesters: [blankSemester(1)] };
                render();
              },
            },
          }),
        ),
      );
      return;
    }
    semIdx = Math.min(semIdx, model.semesters.length - 1);
    const S = model.semesters[semIdx];
    const tabs = h(
      'div.gr-sems',
      { attrs: { role: 'tablist', 'aria-label': 'Semestres' } },
      ...model.semesters.map((s, i) =>
        h('button.nchip', { type: 'button', text: s.label || s.id, attrs: { 'aria-pressed': String(i === semIdx) }, on: { click: () => ((semIdx = i), render()) } }),
      ),
      model.semesters.length < 4
        ? h('button.btn.btn--sm', {
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
    const ues = h('div.adm-classes', {}, ...S.ues.map((U) => ueCard(S, U)));
    body.replaceChildren(
      h(
        'div.adm-grid3',
        {},
        field('Moyenne minimale d’une UE', bound(model.rules, 'ue', { numeric: true, max: 5, placeholder: '10' }), 'En dessous : rattrapage.'),
        field('Note éliminatoire d’une matière', bound(model.rules, 'matiere', { numeric: true, max: 5, placeholder: '7' }), 'En dessous : toute l’UE en rattrapage.'),
        h('span'),
      ),
      tabs,
      h(
        'div.adm-grid3.gr-sem',
        {},
        field('Identifiant', bound(S, 'id', { placeholder: 'S7', max: 6 }), 'Court, affiché sur la tuile.'),
        field('Nom', bound(S, 'label', { placeholder: 'Semestre 7', max: 40 })),
        h('div.gr-dates', {}, field('Début', bound(S, 'start', { type: 'date', label: 'Début du semestre' })), field('Fin', bound(S, 'end', { type: 'date', label: 'Fin du semestre' }))),
      ),
      ues,
      h(
        'div.adm-actions',
        {},
        h('button.btn.btn--sm', {
          type: 'button',
          on: {
            click: () => {
              const U = blankUE(S, S.ues.length + 1);
              S.ues.push(U);
              const c = ueCard(S, U);
              ues.append(c);
              c.querySelector('input').focus();
            },
          },
        }, icon('plus', 'ic ic--sm'), 'UE'),
        h('span.spacer'),
        model.semesters.length > 1
          ? h('button.btn.btn--sm.btn--ghost', {
              type: 'button',
              text: `Retirer ${S.label || S.id}`,
              on: {
                click: () => {
                  if (!confirm(`Retirer ${S.label || S.id} et toutes ses UE ?`)) return;
                  model.semesters.splice(semIdx, 1);
                  semIdx = 0;
                  render();
                },
              },
            })
          : '',
      ),
    );
  }

  async function save() {
    if (!model) return;
    try {
      book = await api('grades', { class: cls, grades: model });
      model = structuredClone(book[cls]);
      renderClassList();
      render();
      toast(`Maquette de notes de ${cls} enregistrée : les étudiants la voient au prochain chargement`, 'check');
    } catch (err) {
      toast(`Refusée : ${err.message}`);
    }
  }
  async function remove() {
    if (!book[cls] || !confirm(`Retirer la maquette de notes de ${cls} ? Les étudiants ne verront plus leurs notes (elles restent sur leurs appareils).`)) return;
    try {
      book = await api('grades', { class: cls, grades: null });
      choose(cls);
      toast(`Maquette de ${cls} retirée`, 'check');
    } catch (err) {
      toast(`Refusé : ${err.message}`);
    }
  }

  sel.addEventListener('change', () => {
    if (model && JSON.stringify(model) !== JSON.stringify(book[cls] ?? null) && !confirm('Abandonner les modifications non enregistrées ?')) {
      sel.value = cls;
      return;
    }
    choose(sel.value);
  });
  copyFrom.addEventListener('change', () => {
    const from = copyFrom.value;
    copyFrom.value = '';
    if (!from || !book[from]) return;
    if (model && !confirm(`Remplacer la maquette de ${cls} par une copie de celle de ${from} ?`)) return;
    // Copie avec de nouveaux identifiants : les notes des deux classes restent séparées.
    model = structuredClone(book[from]);
    model.semesters.forEach((S) => S.ues.forEach((U) => U.matieres.forEach((M) => ((M.id = rid('m')), M.evals.forEach((e) => (e.id = rid('e')))))));
    render();
  });
  // ---------------------------------------------------------- import / export JSON
  const fileIn = $('[data-gr-file]', panel);
  $('[data-gr-import]', panel).addEventListener('click', () => fileIn.click());
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
      // Une classe : chargée dans l'éditeur, à relire puis enregistrer.
      model = parsed[cls];
      semIdx = 0;
      render();
      return toast(`Maquette de ${cls} importée : relis-la puis « Enregistrer la maquette »`, 'check');
    }
    if (!confirm(`Importer et enregistrer les maquettes de ${keys.join(', ')} ? Elles remplacent les maquettes actuelles de ces classes.`)) return;
    const done = [];
    const failed = [];
    for (const k of keys) {
      try {
        book = await api('grades', { class: k, grades: parsed[k] });
        done.push(k);
      } catch (err) {
        failed.push(`${k} (${err.message})`);
      }
    }
    choose(done.includes(cls) || !done.length ? cls : done[0]);
    toast(failed.length ? `Importées : ${done.join(', ') || 'aucune'} · refusées : ${failed.join(' ; ')}` : `Maquettes importées et enregistrées : ${done.join(', ')}`, failed.length ? 'alert' : 'check');
  });
  $('[data-gr-export]', panel).addEventListener('click', () => {
    const data = model ? { [cls]: model } : book;
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/octet-stream' }));
    const a = h('a', { href: url, attrs: { download: `maquette-notes-${model ? cls : 'toutes'}.json` } });
    document.body.append(a);
    a.click();
    a.replaceWith();
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
  });

  $('[data-gr-save]', panel).addEventListener('click', save);
  $('[data-gr-reset]', panel).addEventListener('click', () => choose(cls));
  $('[data-gr-remove]', panel).addEventListener('click', remove);

  return {
    async load() {
      book = await fetch('api/grades', { cache: 'no-store' }).then((r) => r.json());
      const first = Object.keys(getClasses()?.classes ?? {})[0] ?? Object.keys(book)[0];
      choose(cls ?? first);
    },
  };
}
