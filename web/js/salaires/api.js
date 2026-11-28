// Simulateur de salaire : appels au serveur (/api/salaires/). La session est un cookie HttpOnly
// ouvert par un ticket CAS que le serveur fait valider par l'université. Les réponses des alumni
// restent sur le serveur : la page envoie un profil (des cases cochées) et reçoit des groupes.

export class SalairesError extends Error {
  constructor(message, status) {
    super(message);
    this.name = 'SalairesError';
    this.status = status;
  }
}

async function call(path, init = {}) {
  let res;
  try {
    res = await fetch(`api/salaires/${path}`, { credentials: 'same-origin', cache: 'no-store', ...init });
  } catch (err) {
    if (err?.name === 'AbortError') throw err;
    throw new SalairesError('Serveur injoignable : vérifie ta connexion.', 0);
  }
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new SalairesError(body?.error || `Erreur ${res.status}`, res.status);
  return body;
}

const HEAD = { 'Content-Type': 'application/json', 'X-Hub-Salaires': '1' };
const post = (path, data = {}, signal) => call(path, { method: 'POST', headers: HEAD, body: JSON.stringify(data), signal });

export const api = {
  /** Simulateur ouvert ? (et le nombre de réponses une fois ouvert) */
  status: () => call('status'),
  join: (ticket) => post('join', { ticket }),
  leave: () => post('leave'),
  /** Catégories, chiffres du sondage, conseils relus. */
  info: () => call('info'),
  /** Le calcul pour un profil (rien n'est gardé). */
  estimate: (f, target, signal) => post('estimate', { f, target }, signal),
};

/** Administration (session /admin). */
export const adminApi = {
  status: () => call('admin/status'),
  data: () => call('admin/data'),
  enabled: (on) => post('admin/enabled', { on }),
  remove: () => post('admin/delete'),
  /** Fichier choisi (export brut du sondage ou format du Hub) : envoyé tel quel, vérifié en entier. */
  upload: (text) => call('admin/upload', { method: 'POST', headers: HEAD, body: text }),
  /** Fichier retouché dans l'éditeur. */
  save: (data) => post('admin/save', data),
};
