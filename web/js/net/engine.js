// Moteur réseau de la page.
//
// Un navigateur interdit à une page de lire un autre site, et aucun portail de l'université ne
// l'autorise. La page embarque donc son propre client HTTPS : curl + mbedTLS compilés en
// WebAssembly (vendor/libcurl). Le chiffrement TLS est négocié ICI, avec le certificat du portail ;
// les octets déjà chiffrés partent vers le relais dans un unique WebSocket (protocole Wisp), qui
// les recopie vers le portail sans pouvoir les lire.

import { CookieJar, createClient } from './session.js';
import { PORTAL_HOSTS } from '../portals/config.js';

export const RELAY_URL = (() => {
  const url = new URL('wisp/', location.href);
  url.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  url.search = url.hash = '';
  return url.href;
})();

const MAX_PARALLEL = 6;
const TIMEOUT_MS = 30_000;

// --------------------------------------------------------- compteurs publics

/** Ce qui est passé par le relais depuis l'ouverture de la page (écran « Transparence »). */
export const stats = { connections: 0, sent: 0, received: 0, hosts: new Map(), refused: 0, engine: null };
const size = (data) => data?.byteLength ?? data?.length ?? 0;

// Pour le contrôle « certificat vérifié » : détourne une destination vers un autre serveur,
// exactement comme le ferait un relais malhonnête.
const detours = new Map();

let libcurl;
let engine;

async function load() {
  ({ libcurl } = await import('../../vendor/libcurl/libcurl.mjs'));
  await libcurl.load_wasm(new URL('../../vendor/libcurl/libcurl.wasm', import.meta.url).href);
  libcurl.set_websocket(RELAY_URL);
  // Le journal de curl n'a rien à faire dans la console : on le coupe.
  libcurl.logger = () => {};

  const Base = libcurl.wisp.WispWebSocket;
  // Chaque connexion TCP est un flux Wisp ; on compte ce qui passe, rien de plus.
  libcurl.transport = class CountedStream extends Base {
    constructor(url, protocols) {
      const target = url.slice(url.lastIndexOf('/') + 1);
      const host = target.split(':')[0];
      const via = detours.get(host);
      super(via ? url.replace(`/${target}`, `/${via}:${target.split(':')[1]}`) : url, protocols);
      stats.connections++;
      stats.hosts.set(host, (stats.hosts.get(host) ?? 0) + 1);
      this.addEventListener('message', (event) => (stats.received += size(event.data)));
    }
    send(data) {
      stats.sent += size(data);
      super.send(data);
    }
  };
  const v = libcurl.version;
  stats.engine = { curl: v?.curl, ssl: v?.ssl, lib: v?.lib };
  // Une seule session pour toute la vie de la page ; ses cookies intégrés sont désactivés
  // (gérés par session.js, qui sait les persister chiffrés et les cloisonner par portail).
  return new libcurl.HTTPSession({ enable_cookies: false });
}

export const ready = () =>
  (engine ??= load().catch((error) => {
    engine = undefined;
    throw error;
  }));

let active = 0;
const queue = [];

/** Une requête HTTPS, sans cookie ni redirection automatiques. */
async function raw(url, init) {
  const session = await ready();
  if (active >= MAX_PARALLEL) await new Promise((resolve) => queue.push(resolve));
  active++;
  try {
    const res = await session.fetch(url, {
      method: init.method,
      headers: init.headers,
      body: init.body,
      redirect: 'manual',
      signal: AbortSignal.timeout?.(TIMEOUT_MS),
    });
    const headers = res.raw_headers ?? [...res.headers];
    const named = (name) => headers.filter(([key]) => key.toLowerCase() === name).map(([, value]) => value);
    const body = new Uint8Array(await res.arrayBuffer());
    return { status: res.status, location: named('location')[0], setCookies: named('set-cookie'), body };
  } catch (error) {
    const reason = error?.name === 'TimeoutError' ? 'délai dépassé' : (error?.message ?? String(error));
    throw new Error(`Portail injoignable (${reason})`);
  } finally {
    active--;
    queue.shift()?.();
  }
}

// ------------------------------------------------------------- session HTTP

export const jar = new CookieJar();
export const http = createClient({ raw, jar, allowedHosts: PORTAL_HOSTS });

// ------------------------------------------------------- contrôles en direct

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Demande au relais une destination hors liste. Rend le code de fermeture Wisp reçu
 * (0x48 = refusée par la politique du relais), ou 'open' si des données arrivent.
 */
export async function probeRelay(host = 'example.com') {
  await ready();
  return new Promise((resolve) => {
    const ws = new libcurl.wisp.WispWebSocket(`${RELAY_URL}${host}:443`);
    const done = (value) => {
      clearTimeout(timer);
      resolve(value);
    };
    const timer = setTimeout(() => done('timeout'), 8000);
    ws.addEventListener('close', (event) => done(event.code));
    ws.addEventListener('message', () => done('open'));
  });
}

/**
 * Ouvre une connexion TLS vers `host`. Avec `via`, le relais (simulé ici) envoie le trafic vers
 * un autre serveur : la page doit alors refuser la connexion, faute du bon certificat.
 * Rend { ok, code }.
 */
export async function probeTls(host, via) {
  await ready();
  if (via) detours.set(host, via);
  try {
    return await new Promise((resolve) => {
      let socket;
      const timer = setTimeout(() => resolve({ ok: false, code: 'timeout' }), 15000);
      const finish = (result) => {
        clearTimeout(timer);
        try {
          socket?.close();
        } catch {}
        resolve(result);
      };
      try {
        socket = new libcurl.TLSSocket(host, 443, {});
        socket.onopen = () => finish({ ok: true });
        socket.onerror = (code) => finish({ ok: false, code, message: libcurl.get_error_string?.(code) });
      } catch (error) {
        finish({ ok: false, code: String(error) });
      }
    });
  } finally {
    await wait(50);
    detours.delete(host);
  }
}
