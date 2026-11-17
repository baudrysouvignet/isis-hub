// Session HTTP de l'appli web : cookies et redirections sont gérés ici, en clair et sans dépendance,
// au-dessus d'une fonction `raw` qui émet UNE requête HTTPS chiffrée (voir web.js).
// Rien dans ce fichier ne touche au navigateur : il est testé tel quel sous Node.

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

function parseSetCookie(header, url) {
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

  constructor(saved = [], onChange = () => {}) {
    this.#cookies = saved;
    this.#onChange = onChange;
  }

  #alive() {
    const now = Date.now();
    return this.#cookies.filter((c) => c.expires === null || c.expires > now);
  }

  /** Enregistre les en-têtes Set-Cookie d'une réponse reçue de `url`. */
  store(url, headers) {
    for (const header of headers) {
      const cookie = parseSetCookie(header, url);
      if (!cookie) continue;
      this.#cookies = this.#cookies.filter(
        (c) => !(c.name === cookie.name && c.domain === cookie.domain && c.path === cookie.path),
      );
      this.#cookies.push(cookie); // un cookie déjà expiré reste filtré par #alive : c'est une suppression
    }
    if (headers.length) {
      this.#cookies = this.#alive();
      this.#onChange();
    }
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
    this.#onChange();
  }

  toJSON() {
    return this.#alive();
  }
}

/**
 * Fabrique un `fetch` minimal : cookies envoyés et mémorisés, redirections suivies à la main.
 * `raw(url, { method, headers, body })` doit renvoyer { status, location, setCookies, text() }.
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
      const res = await raw(target.href, { method, body, headers: cookie ? { ...headers, Cookie: cookie } : headers });
      jar.store(target, res.setCookies);

      if (!REDIRECTS.has(res.status) || !res.location) {
        let text;
        const read = () => (text ??= res.text());
        return {
          status: res.status,
          ok: res.status >= 200 && res.status < 300,
          url: target.href,
          redirected: hops > 0,
          text: read,
          json: async () => JSON.parse(await read()),
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
