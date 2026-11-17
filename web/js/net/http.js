// Point d'entrée réseau unique des portails. La page y branche le tunnel chiffré (engine.js) ;
// les tests y branchent de faux portails.
let transport = () => Promise.reject(new Error('Aucun transport configuré'));

export const useTransport = (fn) => {
  transport = fn;
};
export const http = (url, init) => transport(url, init);
