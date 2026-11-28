// Rubrique Stages : recherche et regroupements, à partir de l'index servi par le serveur (aucune
// adresse e-mail : les contacts d'une structure se lisent fiche par fiche, voir app.js). Fonctions
// pures, sans le navigateur : testées sous Node (test/stages.test.js).

export const PAGE = 12; // structures par page, sans « tout afficher »

export const fold = (s) =>
  (s || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();

export const yearLabel = (y) => `${y}-${String(y + 1).slice(2)}`;

export const DURATIONS = [
  { id: 'court', label: '4 semaines ou moins', test: (w) => w && w <= 4 },
  { id: 'moyen', label: '5 à 10 semaines', test: (w) => w >= 5 && w <= 10 },
  { id: 'long', label: '11 à 18 semaines', test: (w) => w >= 11 && w <= 18 },
  { id: 'pfe', label: 'Plus de 18 semaines (PFE)', test: (w) => w > 18 },
];
export const STATUTS = ['Hôpital public', 'Public', 'Privé', 'Association'];

export const blank = () => ({ q: '', sector: new Set(), statut: new Set(), level: new Set(), year: new Set(), promo: new Set(), dur: new Set(), paid: false, contact: false });

const latest = (stages) => stages.reduce((m, s) => ((s.d || '') > m ? s.d : m), '');

/**
 * ix : l'index du serveur ({ places, companies, stages, contacts }) ; geo : { DEPTS, REGIONS }
 * (noms des départements et des régions, pour la recherche par lieu).
 */
export function createModel(ix, geo = { DEPTS: [], REGIONS: [] }) {
  const PLACE = new Map(ix.places.map((p) => [p.id, p]));
  const CO = new Map(ix.companies.map((c) => [c.id, c]));
  const ST = new Map(ix.stages.map((s) => [s.id, s]));
  const CT = new Map(ix.contacts.map((c) => [c.id, c]));
  const DEP = new Map(geo.DEPTS.map((d) => [d.c, d]));
  const REG = new Map(geo.REGIONS.map((r) => [r.c, r]));

  const sectors = [...new Set(ix.companies.map((c) => c.s))].sort((a, b) => (a === 'Autre') - (b === 'Autre') || a.localeCompare(b, 'fr'));
  const years = [...new Set(ix.stages.map((s) => s.au).filter(Boolean))].sort();
  const promos = [...new Set(ix.stages.map((s) => s.pr).filter(Boolean))].sort();
  const levels = [1, 2, 3, 4, 5].filter((f) => ix.stages.some((s) => s.f === f));

  const placeText = (p) => fold([p?.n, p?.pays, DEP.get(p?.dep)?.n, p?.dep, REG.get(p?.reg)?.n].filter(Boolean).join(' '));
  const coText = new Map(ix.companies.map((c) => [c.id, `${fold([c.n, ...(c.variants || []), c.s, c.st, c.naf, ...(c.sites || [])].join(' '))} ${placeText(PLACE.get(c.p))}`]));
  const stText = new Map(
    ix.stages.map((s) => {
      const people = [s.et, CT.get(s.tu)?.n, CT.get(s.tu)?.role, CT.get(s.rh)?.n, CT.get(s.rh)?.role];
      return [s.id, fold([s.mi, s.th, ...people].filter(Boolean).join(' '))];
    }),
  );
  const hasMail = (s) => Boolean(CT.get(s.tu)?.hm || CT.get(s.rh)?.hm);

  /** Structures qui ont au moins un stage retenu par les filtres, avec ces stages. */
  function matches(f) {
    const words = fold(f.q).trim().split(/\s+/).filter((w) => w.length >= 2);
    const out = [];
    for (const c of ix.companies) {
      if ((f.sector.size && !f.sector.has(c.s)) || (f.statut.size && !f.statut.has(c.st || 'Autre'))) continue;
      const p = PLACE.get(c.p);
      const coHit = words.filter((w) => coText.get(c.id).includes(w));
      const kept = [];
      for (const sid of c.k) {
        const s = ST.get(sid);
        if (f.level.size && !f.level.has(s.f)) continue;
        if (f.year.size && !f.year.has(s.au)) continue;
        if (f.promo.size && !f.promo.has(s.pr)) continue;
        if (f.dur.size && !DURATIONS.some((d) => f.dur.has(d.id) && d.test(s.wk))) continue;
        if (f.contact && !hasMail(s)) continue;
        if (words.length && !words.every((w) => coHit.includes(w) || stText.get(sid).includes(w))) continue;
        kept.push(s);
      }
      if (kept.length && !(f.paid && !c.paid)) out.push({ c, p, stages: kept });
    }
    return out;
  }

  function inZone(p, zone) {
    if (!zone || zone.kind === 'fr') return !p.zone;
    if (zone.kind === 'reg') return p.reg === zone.code;
    if (zone.kind === 'dep') return p.dep === zone.code;
    if (zone.kind === 'place') return p.id === zone.id;
    if (zone.kind === 'away') return p.zone === zone.code;
    return true;
  }

  function card(c, p, stages) {
    const lv = [...new Set(stages.map((s) => s.f).filter(Boolean))].sort();
    const ys = stages.map((s) => s.au).filter(Boolean);
    const withMission = stages.filter((s) => s.mi).sort((a, b) => (b.d || '').localeCompare(a.d || ''));
    return {
      id: c.id, name: c.n, mono: c.m, color: c.c, sector: c.s, statut: c.st, place: p, levels: lv,
      from: ys.length ? Math.min(...ys) : null, to: ys.length ? Math.max(...ys) : null,
      n: stages.length, total: c.k.length, mission: withMission[0]?.mi || '', paid: c.paid,
      contacts: stages.some((s) => s.tu || s.rh), stageIds: stages.map((s) => s.id),
    };
  }

  /** Comptes pour la carte, puis la page de résultats de la zone choisie. */
  function search(f, zone, { page = 0, sort = 'count' } = {}) {
    const all = matches(f);
    const counts = { reg: {}, dep: {}, places: new Map(), away: { om: 0, monde: 0, inconnu: 0 }, total: 0, companies: all.length };
    for (const { p, stages } of all) {
      const n = stages.length;
      counts.total += n;
      if (p.zone) {
        counts.away[p.zone] += n;
        continue;
      }
      counts.reg[p.reg] = (counts.reg[p.reg] || 0) + n;
      counts.dep[p.dep] = (counts.dep[p.dep] || 0) + n;
      const cur = counts.places.get(p.id) || { id: p.id, name: p.n, x: p.x, y: p.y, dep: p.dep, reg: p.reg, n: 0, cos: 0 };
      cur.n += n;
      cur.cos += 1;
      counts.places.set(p.id, cur);
    }
    counts.places = [...counts.places.values()];
    const rows = all.filter((r) => inZone(r.p, zone));
    const cmp = {
      count: (a, b) => b.stages.length - a.stages.length || latest(b.stages).localeCompare(latest(a.stages)) || a.c.n.localeCompare(b.c.n, 'fr'),
      recent: (a, b) => latest(b.stages).localeCompare(latest(a.stages)) || b.stages.length - a.stages.length,
      az: (a, b) => a.c.n.localeCompare(b.c.n, 'fr', { sensitivity: 'base' }),
    }[sort] ?? (() => 0);
    rows.sort(cmp);
    const pages = Math.max(1, Math.ceil(rows.length / PAGE));
    const pg = Math.min(Math.max(0, page), pages - 1);
    return {
      counts,
      zone: { companies: rows.length, stages: rows.reduce((n, r) => n + r.stages.length, 0) },
      page: pg,
      pages,
      items: rows.slice(pg * PAGE, pg * PAGE + PAGE).map(({ c, p, stages }) => card(c, p, stages)),
    };
  }

  /** Une structure : ses stages (les plus récents d'abord) et les personnes citées dans ses fiches. */
  function detail(id, onlyIds) {
    const c = CO.get(id);
    if (!c) return null;
    const keep = onlyIds ? new Set(onlyIds) : null;
    const stages = c.k.map((k) => ST.get(k)).sort((a, b) => (b.d || '').localeCompare(a.d || ''));
    const people = new Map();
    for (const s of stages) {
      for (const [key, kind] of [['tu', 'maitre'], ['rh', 'rh']]) {
        const ct = CT.get(s[key]);
        if (!ct) continue;
        const cur = people.get(ct.id) || { id: ct.id, kinds: new Set(), years: new Set(), n: 0, last: ct.last || '' };
        cur.kinds.add(kind);
        if (s.au) cur.years.add(s.au);
        if (kind === 'maitre') cur.n += 1;
        people.set(ct.id, cur);
      }
    }
    return {
      ...c,
      place: PLACE.get(c.p),
      stages: stages.map((s) => ({ ...s, match: !keep || keep.has(s.id), tutor: CT.get(s.tu)?.n || '' })),
      people: [...people.values()].sort((a, b) => b.last.localeCompare(a.last) || b.n - a.n),
      also: (c.also || []).map((x) => CO.get(x)).filter(Boolean).map((o) => ({ id: o.id, name: o.n, place: PLACE.get(o.p)?.n, n: o.k.length })),
    };
  }

  /** Un contact de l'index (sans adresse), complété par les adresses lues sur la fiche (full). */
  function contact(id, full) {
    const ct = CT.get(id);
    if (!ct) return null;
    const f = full?.get(id);
    return { id, civ: ct.civ, name: ct.n, role: ct.role, mail: f?.mail || '', old: f?.old || [], hasMail: Boolean(ct.hm), generic: ct.generic, chk: f?.chk, last: ct.last };
  }

  function stage(id, full) {
    const s = ST.get(id);
    if (!s) return null;
    const c = CO.get(s.e);
    return { ...s, company: c, place: PLACE.get(c?.p), tutor: contact(s.tu, full), hr: s.rh && s.rh !== s.tu ? contact(s.rh, full) : null };
  }

  /** Tuile du tableau de bord : où sont allés les étudiants d'un niveau (FIE n), ou tout le monde. */
  function forLevel(level) {
    const f = blank();
    if (level) f.level.add(level);
    const rows = matches(f);
    rows.sort((a, b) => b.stages.length - a.stages.length || latest(b.stages).localeCompare(latest(a.stages)));
    return {
      companies: rows.length,
      stages: rows.reduce((n, r) => n + r.stages.length, 0),
      cities: new Set(rows.map((r) => r.p.id)).size,
      top: rows.slice(0, 8).map(({ c, p, stages }) => card(c, p, stages)),
    };
  }

  return { search, detail, stage, contact, forLevel, matches, place: (id) => PLACE.get(id), company: (id) => CO.get(id), sectors, years, promos, levels, count: ix.stages.length };
}
