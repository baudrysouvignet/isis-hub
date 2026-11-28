// Rubrique Stages : appels au serveur (/api/stages/). La session est un cookie HttpOnly ouvert par
// un ticket CAS que le serveur fait valider par l'université.

export class StagesError extends Error {
  constructor(message, status) {
    super(message);
    this.name = 'StagesError';
    this.status = status;
  }
}

async function call(path, init = {}) {
  let res;
  try {
    res = await fetch(`api/stages/${path}`, { credentials: 'same-origin', cache: 'no-store', ...init });
  } catch {
    throw new StagesError('Serveur injoignable : vérifie ta connexion.', 0);
  }
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new StagesError(body?.error || `Erreur ${res.status}`, res.status);
  return body;
}

const post = (path, data = {}) =>
  call(path, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Hub-Stages': '1' }, body: JSON.stringify(data) });

export const api = {
  /** Rubrique ouverte par l'administration ? (aucune donnée) */
  status: () => call('status'),
  join: (ticket) => post('join', { ticket }),
  leave: () => post('leave'),
  /** Recherche et carte : sans aucune adresse e-mail. */
  index: () => call('index'),
  /** Contacts d'une structure, avec leurs adresses (rien n'est noté). */
  structure: (id) => call(`structure/${encodeURIComponent(id)}`),
};

/** Administration (session /admin). */
export const adminApi = {
  status: () => call('admin/status'),
  /** Le fichier gardé, pour l'éditeur des fiches (il revient par upload une fois retouché). */
  data: () => call('admin/data'),
  enabled: (on) => post('admin/enabled', { on }),
  remove: () => post('admin/delete'),
  /** Fichier choisi : envoyé tel quel (le serveur le lit, le vérifie et le garde). */
  upload: (text) => call('admin/upload', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Hub-Stages': '1' }, body: text }),
};
