// Session HTTP de l'appli : cookies et redirections gérés ici, en clair et sans dépendance, au-dessus
// d'une fonction `raw` qui émet UNE requête HTTPS chiffrée dans la page (voir engine.js).
// Ce fichier ne touche pas au navigateur : il est testé tel quel sous Node.

const REDIRECTS = new Set([301, 302, 303, 307, 308]);

const defaultPath = (pathname) => {
  const i = pathname.lastIndexOf('/');
  return i <= 0 ? '/' : pathname.slice(0, i);
};

const pathMatches = (requestPath, cookiePath) =>
  requestPath === cookiePath ||
  (requestPath.startsWith(cookiePath) && (cookiePath.endsWith('/') || requestPath[cookiePath.length] === '/'));

const hostMatches = (hostname, cookie) =>
  hostname === cookie.domain || (!cookie.hostOnly && hostname.endsWith(`.${cookie.domain}`));

export function parseSetCookie(header, url) {
  const [pair, ...attributes] = header.split(';');
  const eq = pair.indexOf('=');
  if (eq < 1) return null;
  const cookie = {
    name: pair.slice(0, eq).trim(),
    value: pair.slice(eq + 1).trim(),
    domain: url.hostname,
    hostOnly: true,
    path: defaultPath(url.pathname),
    expires: null,
  };
  let maxAge = null;
  for (const attribute of attributes) {
    const i = attribute.indexOf('=');
    const key = (i < 0 ? attribute : attribute.slice(0, i)).trim().toLowerCase();
    const value = i < 0 ? '' : attribute.slice(i + 1).trim();
    if (key === 'domain' && value) {
      const domain = value.replace(/^\./, '').toLowerCase();
      // Un serveur ne peut poser un cookie que pour son propre domaine.
      if (!domain.includes('.') || (url.hostname !== domain && !url.hostname.endsWith(`.${domain}`))) return null;
      cookie.domain = domain;
      cookie.hostOnly = false;
    } else if (key === 'path' && value.startsWith('/')) cookie.path = value;
    else if (key === 'max-age' && /^-?\d+$/.test(value)) maxAge = Number(value);
    else if (key === 'expires' && !Number.isNaN(Date.parse(value))) cookie.expires = Date.parse(value);
  }
  if (maxAge !== null) cookie.expires = Date.now() + maxAge * 1000;
  return cookie;
}

export class CookieJar {
  #cookies;
  #onChange;
  // Ordre des changements : une réponse ne modifie pas un cookie écrit ou effacé APRÈS le départ
  // de sa requête. Sans cela, une réponse en retard (ex. la page du CAS, qui efface « TGC » faute de
  // session) effaçait la session qu'on venait d'ouvrir : boucle « Session expirée » après Touch ID.
  #tick = 0;
  #written = new Map(); // nom|domaine|chemin → tick de la dernière écriture
  #clearedHost = new Map(); // hôte → tick du dernier effacement de ses cookies
  #clearedAll = 0;

  constructor(saved = [], onChange = () => {}) {
    this.#cookies = Array.isArray(saved) ? saved : [];
    this.#onChange = onChange;
  }

  /** Position actuelle, à relever au départ d'une requête puis à rendre à store(). */
  get tick() {
    return this.#tick;
  }

  #changedSince(cookie, since) {
    if (since === undefined) return false;
    return (
      this.#clearedAll > since ||
      (this.#clearedHost.get(cookie.domain) ?? 0) > since ||
      (this.#written.get(`${cookie.name}|${cookie.domain}|${cookie.path}`) ?? 0) > since
    );
  }

  #alive() {
    const now = Date.now();
    return this.#cookies.filter((c) => c.expires === null || c.expires > now);
  }

  /**
   * Enregistre les en-têtes Set-Cookie d'une réponse reçue de `url`. `since` : position relevée
   * au départ de la requête (voir tick) ; un cookie changé depuis n'est pas touché.
   */
  store(url, headers, since) {
    if (!headers.length) return;
    for (const header of headers) {
      const cookie = parseSetCookie(header, url);
      if (!cookie || this.#changedSince(cookie, since)) continue;
      this.#cookies = this.#cookies.filter(
        (c) => !(c.name === cookie.name && c.domain === cookie.domain && c.path === cookie.path),
      );
      this.#cookies.push(cookie); // un cookie déjà expiré est filtré aussitôt : c'est une suppression
      this.#written.set(`${cookie.name}|${cookie.domain}|${cookie.path}`, ++this.#tick);
    }
    this.#cookies = this.#alive();
    this.#onChange();
  }

  /** Valeur de l'en-tête Cookie à envoyer à `url` (chaîne vide s'il n'y en a pas). */
  header(url) {
    return this.#alive()
      .filter((c) => hostMatches(url.hostname, c) && pathMatches(url.pathname, c.path))
      .sort((a, b) => b.path.length - a.path.length)
      .map((c) => `${c.name}=${c.value}`)
      .join('; ');
  }

  has(hostname, name) {
    return this.#alive().some((c) => c.domain === hostname && c.name === name && c.value !== '');
  }

  /** Oublie les cookies d'un hôte, ou tous si aucun n'est précisé. */
  clear(hostname) {
    this.#cookies = hostname ? this.#cookies.filter((c) => c.domain !== hostname) : [];
    this.#tick++;
    if (hostname) this.#clearedHost.set(hostname, this.#tick);
    else this.#clearedAll = this.#tick;
    this.#onChange();
  }

  /** Fonction appelée à chaque changement (sauvegarde chiffrée de la session). */
  set onchange(fn) {
    this.#onChange = fn;
  }

  /** Remplace tout le contenu (session relue depuis le coffre). */
  replace(cookies) {
    this.#cookies = Array.isArray(cookies) ? cookies : [];
    this.#clearedAll = ++this.#tick; // contenu remplacé : les réponses d'avant ne s'y mêlent pas
  }

  toJSON() {
    return this.#alive();
  }
}

const decoder = new TextDecoder();

/**
 * Fabrique un `fetch` minimal : cookies envoyés et mémorisés, redirections suivies à la main.
 * `raw(url, { method, headers, body })` doit renvoyer { status, location, setCookies, body: Uint8Array }.
 * Toute destination hors de `allowedHosts` est refusée avant même d'ouvrir une connexion.
 */
export function createClient({ raw, jar, allowedHosts, maxRedirects = 15 }) {
  return async function request(url, init = {}) {
    let target = new URL(url);
    let method = (init.method ?? 'GET').toUpperCase();
    let body = init.body;
    let headers = { ...init.headers };

    for (let hops = 0; ; hops++) {
      if (target.protocol !== 'https:' || !allowedHosts.has(target.hostname)) {
        throw new Error(`Destination refusée : ${target.host}`);
      }
      const cookie = jar.header(target);
      const since = jar.tick; // départ de la requête : sa réponse ne remplace rien de plus récent
      // idempotent : la requête peut être rejouée sans effet de bord (lecture), voir engine.js.
      const idempotent = method === 'GET' || method === 'HEAD' || Boolean(init.idempotent);
      const res = await raw(target.href, { method, body, idempotent, headers: cookie ? { ...headers, Cookie: cookie } : headers });
      jar.store(target, res.setCookies, since);

      // redirect: 'manual' : on rend la redirection elle-même (ticket CAS, à ne pas suivre).
      if (init.redirect === 'manual' && REDIRECTS.has(res.status)) {
        return { status: res.status, ok: false, url: target.href, location: res.location ?? null, redirected: hops > 0, text: async () => '', json: async () => null };
      }
      if (!REDIRECTS.has(res.status) || !res.location) {
        const bytes = res.body ?? new Uint8Array();
        let text;
        return {
          status: res.status,
          ok: res.status >= 200 && res.status < 300,
          url: target.href,
          redirected: hops > 0,
          bytes: () => bytes,
          text: async () => (text ??= decoder.decode(bytes)),
          json: async () => JSON.parse((text ??= decoder.decode(bytes))),
        };
      }
      if (hops === maxRedirects) throw new Error('Trop de redirections');

      const next = new URL(res.location, target);
      // Comme un navigateur : un POST redirigé devient un GET, sauf en 307/308.
      if (res.status === 303 || (res.status < 307 && method !== 'GET' && method !== 'HEAD')) {
        method = 'GET';
        body = undefined;
        const { 'Content-Type': dropped, ...rest } = headers;
        headers = rest;
      }
      // Les en-têtes propres à un portail (clé d'API…) ne suivent pas vers un autre hôte.
      if (next.host !== target.host) headers = {};
      target = next;
    }
  };
}
