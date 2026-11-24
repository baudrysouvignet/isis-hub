// Étiquettes et règles automatiques des mails, appliquées par la page elle-même. Gardées dans les
// données personnelles (core/userdata.js) : chiffrées sur l'appareil et dans la sauvegarde anonyme,
// donc retrouvées sur tous les appareils après connexion, jamais lisibles par le serveur.

import * as UD from './userdata.js';

const MAX_TAGS = 12;
const MAX_RULES = 30;
const MAX_MARKS = 2000;
export const TAG_COLORS = ['blue', 'green', 'orange', 'violet', 'pink', 'teal'];

let state = { tags: [], marks: {}, rules: [], loginAlerts: true, hubMails: true };
const listeners = new Set();

const str = (v, max) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '');
const newId = () => crypto.getRandomValues(new Uint32Array(1))[0].toString(36);

function sanitize(raw) {
  const tags = (Array.isArray(raw?.tags) ? raw.tags : [])
    .map((t) => ({ id: str(t?.id, 12), name: str(t?.name, 24), color: TAG_COLORS.includes(t?.color) ? t.color : TAG_COLORS[0] }))
    .filter((t) => t.id && t.name)
    .slice(0, MAX_TAGS);
  const known = new Set(tags.map((t) => t.id));
  const marks = {};
  for (const [k, v] of Object.entries(raw?.marks && typeof raw.marks === 'object' ? raw.marks : {}).slice(0, MAX_MARKS)) {
    const ids = (Array.isArray(v) ? v : []).filter((id) => known.has(id));
    if (ids.length && k.length <= 300) marks[k] = ids;
  }
  const rules = (Array.isArray(raw?.rules) ? raw.rules : [])
    .map((r) => ({
      id: str(r?.id, 12),
      field: r?.field === 'subject' ? 'subject' : 'from',
      text: str(r?.text, 80),
      action: r?.action === 'tag' && known.has(r?.tag) ? 'tag' : 'trash',
      tag: known.has(r?.tag) ? r.tag : null,
    }))
    .filter((r) => r.id && r.text)
    .slice(0, MAX_RULES);
  // Alertes « Nouvelle connexion » de Moodle dues à ISIS Hub : mises à la corbeille sauf refus.
  // Mails d'ISIS Hub (mail d'accord du TCG) : on ne garde que le dernier, sauf refus.
  return { tags, marks, rules, loginAlerts: raw?.loginAlerts !== false, hubMails: raw?.hubMails !== false };
}

function changed() {
  UD.set('mail', state);
  for (const fn of listeners) fn();
}

/** Lit les étiquettes et règles depuis les données personnelles (au démarrage et après synchronisation). */
export function initMailPrefs() {
  state = sanitize(UD.get('mail'));
  for (const fn of listeners) fn();
}
UD.onUserData((touched) => touched.includes('mail') && initMailPrefs());
export const onMailPrefs = (fn) => listeners.add(fn);
export const resetMailPrefs = () => {
  state = { tags: [], marks: {}, rules: [], loginAlerts: true, hubMails: true };
  for (const fn of listeners) fn();
};

/** Clé stable d'un mail : son Message-ID (il survit à un déplacement de dossier). */
export const mailKey = (m) => m.messageId || `${m.folder}:${m.id}`;

export const tags = () => state.tags;
export const tagById = (id) => state.tags.find((t) => t.id === id);
export const tagsOf = (m) => (state.marks[mailKey(m)] ?? []).map(tagById).filter(Boolean);
export const rules = () => state.rules;
export const loginAlertsOn = () => state.loginAlerts !== false;
export function setLoginAlerts(on) {
  state.loginAlerts = Boolean(on);
  changed();
}
export const hubMailsOn = () => state.hubMails !== false;
export function setHubMails(on) {
  state.hubMails = Boolean(on);
  changed();
}

export function addTag(name) {
  const n = str(name, 24);
  if (!n) return null;
  const same = state.tags.find((t) => t.name.toLowerCase() === n.toLowerCase());
  if (same) return same;
  if (state.tags.length >= MAX_TAGS) throw new Error(`${MAX_TAGS} étiquettes au maximum.`);
  const tag = { id: newId(), name: n, color: TAG_COLORS[state.tags.length % TAG_COLORS.length] };
  state.tags.push(tag);
  changed();
  return tag;
}

export function removeTag(id) {
  state.tags = state.tags.filter((t) => t.id !== id);
  for (const k of Object.keys(state.marks)) {
    state.marks[k] = state.marks[k].filter((x) => x !== id);
    if (!state.marks[k].length) delete state.marks[k];
  }
  state.rules = state.rules.filter((r) => !(r.action === 'tag' && r.tag === id));
  changed();
}

export function setTag(m, id, on) {
  const k = mailKey(m);
  const cur = new Set(state.marks[k] ?? []);
  if (on) cur.add(id);
  else cur.delete(id);
  if (cur.size) state.marks[k] = [...cur];
  else delete state.marks[k];
  const keys = Object.keys(state.marks);
  if (keys.length > MAX_MARKS) delete state.marks[keys[0]]; // les plus anciens repères partent
  changed();
}

export function addRule({ field, text, action, tag }) {
  if (state.rules.length >= MAX_RULES) throw new Error(`${MAX_RULES} règles au maximum.`);
  const r = sanitize({ tags: state.tags, rules: [{ id: newId(), field, text, action, tag }] }).rules[0];
  if (!r) throw new Error('Indique le texte à rechercher.');
  state.rules.push(r);
  changed();
  return r;
}

export function removeRule(id) {
  state.rules = state.rules.filter((r) => r.id !== id);
  changed();
}

const norm = (t) => (t ?? '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

/** Règle qui s'applique à un mail (la première qui correspond), ou null. */
export function matchRules(m) {
  const out = [];
  for (const r of state.rules) {
    const hay = r.field === 'subject' ? norm(m.subject) : norm(`${m.from?.name ?? ''} ${m.from?.address ?? ''}`);
    if (hay.includes(norm(r.text))) out.push(r);
  }
  return out;
}

/** Applique les règles « étiquette » (sans réseau). Rend les mails à mettre à la corbeille. */
export function applyRules(list) {
  const toTrash = [];
  let touched = false;
  for (const m of list) {
    for (const r of matchRules(m)) {
      if (r.action === 'trash') {
        toTrash.push(m);
        break;
      }
      const k = mailKey(m);
      const cur = state.marks[k] ?? [];
      if (r.tag && !cur.includes(r.tag)) {
        state.marks[k] = [...cur, r.tag];
        touched = true;
      }
    }
  }
  if (touched) changed();
  return toTrash;
}
