// Unique point de passage vers le réseau. La plateforme (extension ou appli web) fournit le transport :
// l'extension utilise le `fetch` du navigateur, l'appli web le tunnel chiffré via le relais.
let transport = () => {
  throw new Error('Transport non initialisé');
};

export const setTransport = (fn) => {
  transport = fn;
};

/** Même forme que `fetch` : renvoie { ok, status, url, text(), json() }, redirections suivies, session incluse. */
export const http = (url, init) => transport(url, init);
