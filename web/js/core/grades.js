// Calcul des notes : moyennes pondérées par matière, UE et semestre, rattrapages (UE sous le seuil,
// matière éliminatoire), progression, note nécessaire pour atteindre un objectif, simulation.
// Code pur (aucun accès au DOM) : testé sous Node. La maquette (UE > matières > évaluations,
// coefficients) vient de l'administration ; les notes saisies viennent de l'étudiant.

const r2 = (v) => Math.round(v * 100) / 100;

/** Mise en forme française : 12,25 · 6,5 · « — » si rien. */
export const f2 = (v) => (v === null || v === undefined ? '—' : r2(v).toFixed(2).replace('.', ','));
export const fN = (v) => (v === null || v === undefined ? '—' : String(r2(v)).replace('.', ','));
/** Arrondi au dixième supérieur : la note à viser n'est jamais sous-estimée. */
export const f1up = (v) => (Math.ceil(v * 10 - 1e-9) / 10).toFixed(1).replace('.', ',').replace(',0', '');
/** Classe de largeur de barre (pw-0 … pw-100) pour une note sur 20. */
export const pw = (v) => `pw-${Math.max(0, Math.min(100, Math.round((v || 0) * 5)))}`;

const MONTHS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
/** « 2027-01-14 » → « 14 janv. » */
export const shortDate = (iso) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
  return m ? `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]}` : '';
};
/** Période d'un semestre : « sept. 2026 → janv. 2027 ». */
export const period = (S) => {
  const a = /^(\d{4})-(\d{2})/.exec(S.start || '');
  const b = /^(\d{4})-(\d{2})/.exec(S.end || '');
  if (!a || !b) return '';
  return a[1] === b[1] ? `${MONTHS[a[2] - 1]} → ${MONTHS[b[2] - 1]} ${b[1]}` : `${MONTHS[a[2] - 1]} ${a[1]} → ${MONTHS[b[2] - 1]} ${b[1]}`;
};
const addDays = (iso, n) => {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

/** Note valide sur 20 (ou null). */
export const cleanGrade = (v) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 20 ? r2(v) : null);

/**
 * Carnet de notes d'une classe. `def` : maquette publiée par l'administration ;
 * `saved` : { values: { idÉval: note }, extra: [{ id, mat, label, coef, date, value }] }.
 */
export function createGrades(def, { saved = null, today = new Date().toISOString().slice(0, 10), year = '' } = {}) {
  const G = structuredClone(def);
  const RULE_UE = G.rules?.ue ?? 10;
  const RULE_M = G.rules?.matiere ?? 7;
  G.semesters.forEach((S) => {
    S.short = S.id;
    S.label = S.label || S.id;
    S.period = period(S);
  });
  const MAT = {};
  const UE_OF = {};
  const SEM_OF = {};
  const EV = {};
  G.semesters.forEach((S) =>
    S.ues.forEach((U) => {
      SEM_OF[U.id] = S;
      U.matieres.forEach((M) => {
        MAT[M.id] = M;
        UE_OF[M.id] = U;
        M.evals = M.evals ?? [];
        M.evals.forEach((e) => {
          e.mat = M.id;
          EV[e.id] = e;
        });
      });
    }),
  );
  const real = {};
  const sim = {};
  let simOn = false;

  function addEval(x, isSim = false) {
    const M = MAT[x.mat];
    if (!M || EV[x.id]) return null;
    const coef = Number(x.coef);
    const e = {
      id: String(x.id).slice(0, 48),
      label: String(x.label || 'Note').slice(0, 40),
      coef: Number.isFinite(coef) && coef > 0 && coef <= 100 ? coef : 1,
      date: /^\d{4}-\d{2}-\d{2}$/.test(x.date || '') ? x.date : '',
      mat: M.id,
      extra: true,
      sim: Boolean(isSim),
    };
    M.evals.push(e);
    EV[e.id] = e;
    return e;
  }
  function removeEval(e) {
    const M = MAT[e.mat];
    M.evals = M.evals.filter((x) => x !== e);
    delete EV[e.id];
    delete real[e.id];
    delete sim[e.id];
  }
  if (saved) {
    for (const [id, v] of Object.entries(saved.values ?? {})) if (EV[id] && !EV[id].extra) real[id] = cleanGrade(v);
    for (const x of (saved.extra ?? []).slice(0, 400)) {
      const e = addEval(x);
      if (e) real[e.id] = cleanGrade(x.value);
    }
  }
  /** Ce qui est enregistré (jamais les simulations). */
  function dump() {
    const extra = Object.values(EV)
      .filter((e) => e.extra && !e.sim)
      .map((e) => ({ id: e.id, mat: e.mat, label: e.label, coef: e.coef, date: e.date, value: real[e.id] ?? null }));
    const values = {};
    for (const [k, v] of Object.entries(real)) if (EV[k] && !EV[k].extra && v !== null && v !== undefined) values[k] = v;
    return { values, extra };
  }

  // ---------------------------------------------------------------- calculs
  const has = (v) => v !== null && v !== undefined && v !== '';
  const val = (e) => (simOn && has(sim[e.id]) ? sim[e.id] : e.sim ? null : real[e.id]);
  const evalsOf = (M) => M.evals.filter((e) => !e.sim || simOn);
  const wavg = (pairs) => {
    let w = 0;
    let s = 0;
    pairs.forEach(([v, c]) => {
      if (has(v)) {
        s += v * c;
        w += c;
      }
    });
    return w ? s / w : null;
  };
  const avgM = (M, f = val) => wavg(evalsOf(M).map((e) => [f(e), e.coef]));
  const avgU = (U, f = val) => wavg(U.matieres.map((M) => [avgM(M, f), M.coef]));
  const avgS = (S, f = val) => wavg(S.ues.map((U) => [avgU(U, f), U.coef]));
  const stM = (M, f = val) => {
    const a = avgM(M, f);
    return a === null ? 'none' : a < RULE_M ? 'fail' : 'ok';
  };
  const stU = (U, f = val) => {
    const a = avgU(U, f);
    if (a === null) return 'none';
    return a < RULE_UE || U.matieres.some((M) => stM(M, f) === 'fail') ? 'fail' : 'ok';
  };
  const semById = (id) => G.semesters.find((S) => S.id === id);
  const allEvals = (S) => S.ues.flatMap((U) => U.matieres.flatMap((M) => evalsOf(M)));
  const remaining = (S) => allEvals(S).filter((e) => !has(val(e)));

  /** Semestre en cours d'après les dates ; sinon le prochain ; sinon le dernier. */
  function currentSem() {
    return (
      G.semesters.find((S) => S.start <= today && today <= S.end) ??
      G.semesters.find((S) => S.start > today) ??
      G.semesters[G.semesters.length - 1]
    );
  }

  /** Part du semestre déjà notée, pondérée par les coefficients. */
  function progress(S) {
    const tu = S.ues.reduce((a, U) => a + U.coef, 0);
    let p = 0;
    S.ues.forEach((U) => {
      const tm = U.matieres.reduce((a, M) => a + M.coef, 0);
      U.matieres.forEach((M) => {
        const ev = evalsOf(M);
        const te = ev.reduce((a, e) => a + e.coef, 0);
        ev.forEach((e) => {
          if (has(val(e))) p += (U.coef / tu) * (M.coef / tm) * (e.coef / te);
        });
      });
    });
    return p;
  }
  function semState(S) {
    const a = avgS(S);
    const failing = S.ues.filter((U) => stU(U) === 'fail');
    const rest = remaining(S).length;
    if (a === null) return { a, kind: 'none', failing, rest, label: 'Pas encore de notes' };
    if (failing.length) return { a, kind: 'fail', failing, rest, label: `${failing.length} UE en rattrapage` };
    return rest ? { a, kind: 'ok', failing, rest, label: 'En bonne voie' } : { a, kind: 'done', failing, rest, label: 'Semestre validé' };
  }

  /** Périmètre d'un calcul : « S:S7 », « U:7.1 » ou « M:interop ». */
  function scopeOf(key) {
    if (key.startsWith('S:')) {
      const S = semById(key.slice(2));
      return { kind: 'S', obj: S, name: S.label, evs: allEvals(S), avg: (f) => avgS(S, f), target: RULE_UE };
    }
    if (key.startsWith('U:')) {
      const U = SEM_OF[key.slice(2)].ues.find((u) => u.id === key.slice(2));
      return { kind: 'U', obj: U, name: `UE ${U.id} · ${U.name}`, evs: U.matieres.flatMap(evalsOf), avg: (f) => avgU(U, f), target: RULE_UE };
    }
    const M = MAT[key.slice(2)];
    return { kind: 'M', obj: M, name: M.name, evs: evalsOf(M), avg: (f) => avgM(M, f), target: RULE_M };
  }
  /** Note moyenne à obtenir sur toutes les évaluations restantes du périmètre pour atteindre `target`. */
  function needFor(key, target) {
    const sc = scopeOf(key);
    const rem = sc.evs.filter((e) => !has(val(e)));
    const ids = new Set(rem.map((e) => e.id));
    const withX = (x) => (e) => (ids.has(e.id) ? x : val(e));
    const now = sc.avg(val);
    if (!rem.length) return { sc, rem, now, target, state: 'final' };
    const f0 = sc.avg(withX(0));
    const f20 = sc.avg(withX(20));
    if (f0 >= target - 1e-9) return { sc, rem, now, target, state: 'secured', min: f0 };
    if (f20 < target - 1e-9) return { sc, rem, now, target, state: 'out', max: f20 };
    const x = ((target - f0) / (f20 - f0)) * 20;
    const xr = Math.ceil(x * 10 - 1e-9) / 10;
    const mats = sc.kind === 'M' ? [] : sc.kind === 'U' ? sc.obj.matieres : sc.obj.ues.flatMap((U) => U.matieres);
    const under = mats
      .filter((M) => {
        const a = avgM(M, withX(xr));
        return a !== null && a < RULE_M;
      })
      .map((M) => ({ M, n: needFor(`M:${M.id}`, RULE_M) }));
    const underU =
      sc.kind === 'S'
        ? sc.obj.ues
            .filter((U) => {
              const v = avgU(U, withX(xr));
              return v !== null && v < RULE_UE;
            })
            .map((U) => ({ U, n: needFor(`U:${U.id}`, RULE_UE) }))
        : [];
    return { sc, rem, now, target, state: 'need', x: xr, ids: [...ids], under, underU };
  }
  /** Points à surveiller : UE sous le seuil, matière éliminatoire, UE juste au-dessus. */
  function coach(S) {
    const items = [];
    S.ues.forEach((U) => {
      const a = avgU(U);
      if (a === null) return;
      if (a < RULE_UE) items.push({ tone: 'err', key: `U:${U.id}`, t: `UE ${U.id} · ${f2(a)} de moyenne`, s: U.name, n: needFor(`U:${U.id}`, RULE_UE) });
      U.matieres.forEach((M) => {
        const m = avgM(M);
        if (m !== null && m < RULE_M) {
          items.push({ tone: 'err', key: `M:${M.id}`, t: `${M.name} · ${fN(m)}`, s: `Sous ${fN(RULE_M)} : toute l’UE ${U.id} part en rattrapage`, n: needFor(`M:${M.id}`, RULE_M) });
        }
      });
      if (a >= RULE_UE && a < RULE_UE + 0.6 && !U.matieres.some((M) => stM(M) === 'fail')) {
        items.push({ tone: 'warn', key: `U:${U.id}`, t: `UE ${U.id} · ${f2(a)}, peu de marge`, s: U.name, n: needFor(`U:${U.id}`, RULE_UE) });
      }
    });
    return items;
  }
  function needLine(n, short) {
    if (!n) return '';
    if (n.state === 'final') return n.now >= n.target ? 'Toutes les notes sont là : c’est acquis.' : 'Plus d’évaluation prévue : seconde session.';
    if (n.state === 'out') return `Même avec 20 partout, ${f2(n.max)} au mieux : seconde session.`;
    if (n.state === 'secured') return 'C’est déjà acquis, quoi qu’il arrive.';
    const one = n.rem[0];
    const what =
      n.rem.length === 1
        ? `${short ? '' : 'à '}${one.label.toLowerCase() === 'examen' ? 'l’examen' : `« ${one.label} »`} (coef ${fN(one.coef)})`
        : `de moyenne sur les ${n.rem.length} évaluations restantes`;
    return `Il te faut ${f1up(n.x)} ${what}.`;
  }

  /** Dernières notes saisies du semestre (par date, puis ordre de saisie). */
  function lastGrades(S, n) {
    return allEvals(S)
      .filter((e) => has(real[e.id]) && !e.sim)
      .map((e, i) => ({ e, i }))
      .sort((a, b) => (b.e.date || '').localeCompare(a.e.date || '') || b.i - a.i)
      .slice(0, n)
      .map(({ e }) => e);
  }
  /** Prochaine évaluation sans note, à partir d'aujourd'hui. */
  function nextEval(S) {
    return allEvals(S)
      .filter((e) => !has(real[e.id]) && e.date && e.date >= today)
      .sort((a, b) => a.date.localeCompare(b.date))[0];
  }
  const isSoon = (e) => Boolean(e?.date) && e.date <= addDays(today, 7);
  const isDue = (e) => Boolean(e?.date) && e.date <= today && e.date >= addDays(today, -7);

  /** Notes d'une matière liée à un code ADE (fiche d'un cours). */
  function course(code) {
    const M = Object.values(MAT).find((m) => m.code && code && m.code.toUpperCase() === String(code).toUpperCase());
    if (!M) return null;
    return { M, U: UE_OF[M.id], avg: avgM(M, (e) => real[e.id]), evals: M.evals.filter((e) => !e.sim).map((e) => ({ e, v: real[e.id] })) };
  }

  /** Bilan de l'année : semestres pondérés par la somme des coefficients d'UE. */
  function yearState() {
    let tw = 0;
    let ts = 0;
    let anyFail = false;
    let anyNone = false;
    let allDone = true;
    const rows = G.semesters.map((S) => {
      const st = semState(S);
      const w = S.ues.reduce((a, U) => a + U.coef, 0);
      if (st.a !== null) {
        tw += w;
        ts += st.a * w;
      }
      anyFail ||= st.kind === 'fail';
      anyNone ||= st.kind === 'none';
      allDone &&= st.kind === 'done';
      return { S, st };
    });
    return { rows, a: tw ? ts / tw : null, anyFail, anyNone, allDone };
  }

  return {
    G,
    year,
    RULE_UE,
    RULE_M,
    MAT,
    UE_OF,
    SEM_OF,
    EV,
    real,
    sim,
    get simOn() {
      return simOn;
    },
    set simOn(on) {
      simOn = Boolean(on);
      if (!simOn) {
        Object.keys(sim).forEach((k) => delete sim[k]);
        Object.values(EV)
          .filter((e) => e.sim)
          .forEach(removeEval);
      }
    },
    clearSim() {
      Object.keys(sim).forEach((k) => delete sim[k]);
      Object.values(EV)
        .filter((e) => e.sim)
        .forEach(removeEval);
    },
    today,
    has,
    val,
    evalsOf,
    avgM,
    avgU,
    avgS,
    stM,
    stU,
    semById,
    allEvals,
    remaining,
    currentSem,
    progress,
    semState,
    needFor,
    coach,
    needLine,
    lastGrades,
    nextEval,
    isSoon,
    isDue,
    course,
    yearState,
    addEval,
    removeEval,
    dump,
  };
}
