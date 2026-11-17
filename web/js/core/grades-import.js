// Import d'une maquette de notes en JSON (administration). Accepte :
//   - une classe : { rules?, semesters: [...] } (ou { class: "FIA4", grades: {...} }) ;
//   - plusieurs classes : { "FIA4": {...}, "FIE5": {...} } ;
//   - le format de la maquette de démonstration (dates « 14 janv. », notes « value » ignorées).
// Les identifiants manquants sont créés, les nombres convertis, les dates remises en AAAA-MM-JJ.
// La validation complète reste celle du serveur (internal/feedback/grades.go).
// Aucune note d'étudiant n'est importée : seulement la structure.

const CLASS_RE = /^[A-Z]{2,5}[0-9]{1,2}$/;
const ID_RE = /^[a-z0-9][a-z0-9-]{0,47}$/;
const MONTHS = { 'janv.': 1, janv: 1, janvier: 1, 'févr.': 2, févr: 2, février: 2, mars: 3, 'avr.': 4, avr: 4, avril: 4, mai: 5, juin: 6, 'juil.': 7, juil: 7, juillet: 7, août: 8, 'sept.': 9, sept: 9, septembre: 9, 'oct.': 10, oct: 10, octobre: 10, 'nov.': 11, nov: 11, novembre: 11, 'déc.': 12, déc: 12, décembre: 12 };

const rid = (p) => `${p}-${crypto.getRandomValues(new Uint32Array(1))[0].toString(36)}`;
const num = (v, fallback = 1) => {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? '').replace(',', '.'));
  return Number.isFinite(n) && n > 0 ? n : fallback;
};
const text = (v, max) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

/** « 2027-01-14 », « 14/01/2027 » ou « 14 janv. » (année déduite du semestre) → AAAA-MM-JJ. */
export function isoDate(v, sem) {
  const s = String(v ?? '').trim();
  if (!s) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  let m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  m = /(\d{1,2})\s+([a-zéû.]+)/i.exec(s);
  const mo = m && MONTHS[m[2].toLowerCase()];
  if (!mo) return '';
  const y0 = Number((sem?.start ?? '').slice(0, 4)) || new Date().getFullYear();
  const startMonth = Number((sem?.start ?? '').slice(5, 7)) || 9;
  const year = mo < startMonth ? y0 + 1 : y0;
  return `${year}-${String(mo).padStart(2, '0')}-${m[1].padStart(2, '0')}`;
}

function normalizeClass(raw, label) {
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.semesters)) throw new Error(`${label} : « semesters » manquant`);
  const used = new Set();
  const uid = (id, p) => {
    let v = typeof id === 'string' && ID_RE.test(id) && !used.has(id) ? id : rid(p);
    while (used.has(v)) v = rid(p);
    used.add(v);
    return v;
  };
  return {
    rules: { ue: num(raw.rules?.ue, 10), matiere: num(raw.rules?.matiere, 7) },
    semesters: raw.semesters.slice(0, 4).map((S, si) => {
      const id = /^[A-Za-z0-9]{1,6}$/.test(S?.id ?? '') ? S.id : `S${si + 1}`;
      const sem = { id, label: text(S?.label, 40) || `Semestre ${id.replace(/\D/g, '') || si + 1}`, start: isoDate(S?.start), end: isoDate(S?.end) };
      if (!sem.start || !sem.end) throw new Error(`${label}, ${sem.label} : dates « start » et « end » (AAAA-MM-JJ) obligatoires`);
      sem.ues = (S.ues ?? []).map((U, ui) => ({
        id: /^[A-Za-z0-9.\-]{1,8}$/.test(String(U?.id ?? '')) ? String(U.id) : `${id.replace(/\D/g, '') || si + 1}.${ui + 1}`,
        name: text(U?.name, 120),
        coef: num(U?.coef ?? U?.ects),
        matieres: (U?.matieres ?? U?.subjects ?? []).map((M) => ({
          id: uid(M?.id, 'm'),
          name: text(M?.name, 120),
          coef: num(M?.coef),
          code: text(M?.code, 48).toUpperCase(),
          evals: (M?.evals ?? []).map((e) => ({ id: uid(e?.id, 'e'), label: text(e?.label, 40) || 'Évaluation', coef: num(e?.coef), date: isoDate(e?.date, sem) })),
        })),
      }));
      return sem;
    }),
  };
}

/** Rend { CLASSE: maquette } prêt à être envoyé au serveur. */
export function normalizeImport(json, { currentClass } = {}) {
  if (!json || typeof json !== 'object' || Array.isArray(json)) throw new Error('le fichier doit contenir un objet JSON');
  // Format de la démo : { grades: { year, rules, semesters } }
  if (json.grades && typeof json.grades === 'object' && Array.isArray(json.grades.semesters)) {
    const k = CLASS_RE.test(json.class ?? '') ? json.class : currentClass;
    return { [k]: normalizeClass(json.grades, k) };
  }
  if (Array.isArray(json.semesters)) {
    const k = CLASS_RE.test(json.class ?? '') ? json.class : currentClass;
    if (!k) throw new Error('classe inconnue');
    return { [k]: normalizeClass(json, k) };
  }
  const keys = Object.keys(json);
  if (!keys.length) throw new Error('fichier vide');
  const bad = keys.filter((k) => !CLASS_RE.test(k));
  if (bad.length) throw new Error(`classes invalides : ${bad.slice(0, 3).join(', ')} (attendu ex. FIA4)`);
  if (keys.length > 30) throw new Error('30 classes au plus');
  return Object.fromEntries(keys.map((k) => [k, normalizeClass(json[k], k)]));
}
