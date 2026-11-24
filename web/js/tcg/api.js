// ISIS · TCG : appels au serveur (/api/tcg/…). La session de jeu est un cookie HttpOnly, limité à
// /api/tcg/ : aucun script ne peut le lire. Chaque requête qui modifie quelque chose porte
// l'en-tête X-Hub-TCG, qu'un autre site ne peut pas ajouter (protection CSRF).

export class TcgError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

async function call(path, { method = 'GET', body, form, signal } = {}) {
  const headers = { 'X-Hub-TCG': '1' };
  let payload;
  if (form) payload = form;
  else if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  let res;
  try {
    res = await fetch(`api/tcg/${path}`, { method, headers, body: payload, credentials: 'same-origin', cache: 'no-store', signal });
  } catch (err) {
    if (err.name === 'AbortError') throw err;
    throw new TcgError('Connexion impossible : vérifie ta connexion à Internet.', 0);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new TcgError(data.error || `Erreur ${res.status}`, res.status);
  return data;
}

const post = (path, body = {}) => call(path, { method: 'POST', body });

export const api = {
  publicView: () => call('public'),
  state: () => call('state'),
  join: (ticket, pseudo) => post('join', { ticket, pseudo }),
  logout: () => post('logout'),
  leave: () => post('leave'),
  pseudo: (pseudo) => post('pseudo', { pseudo }),
  booster: () => post('booster'),
  propose: (form) => call('propose', { method: 'POST', form }),
  withdraw: (id) => post(`proposal/${encodeURIComponent(id)}/withdraw`),
  vote: (wave, ballot, rank) => post('jury', { wave, ballot, rank }),
  moreBallot: () => post('jury/more'),
  wish: (card, on) => post('wish', { card, on }),
  report: (card, reason) => post('report', { card, reason }),
  tradeNew: (invite = '') => post('trade/new', { invite }),
  tradeJoin: (code) => post('trade/join', { code }),
  trade: (code, v, signal) => call(`trade/${code}?v=${v}`, { signal }),
  tradeOffer: (code, offer) => post(`trade/${code}/offer`, { offer }),
  tradeReady: (code, offerV, ready) => post(`trade/${code}/ready`, { offerV, ready }),
  tradeCancel: (code) => post(`trade/${code}/cancel`),
};
