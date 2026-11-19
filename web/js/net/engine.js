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
    // libcurl oublie la connexion au relais par son adresse : le « close » tardif d'une connexion
    // déjà remplacée (resetRelay) effacerait la nouvelle. On n'oublie que la sienne.
    on_conn_close() {
      const all = libcurl.wisp.wisp_connections;
      if (all[this.real_url] === this.connection) delete all[this.real_url];
    }
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

// ------------------------------------------------- connexion au relais (WebSocket)
//
// libcurl réutilise sa connexion au relais tant qu'il n'a pas reçu son « close ». Or une
// application installée (iOS, Android) mise en arrière-plan est suspendue : le relais coupe le
// WebSocket resté muet, et au retour le système livre ce « close » APRÈS les premières requêtes,
// qui partent sur une connexion morte (tuile Mails en rouge, « Réessayer » qui marche ensuite).
// On repère donc les situations où la connexion a pu mourir et on la remplace avant d'envoyer.

const STALE_AFTER_MS = 30_000; // arrière-plan plus long : la connexion est peut-être morte
const IDLE_CLOSE_MS = 3 * 60_000; // connexion inutilisée : rendue au relais (places par adresse)
let stale = false;
let hiddenAt = 0;
let lastUse = Date.now();

if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') hiddenAt = Date.now();
    else if (hiddenAt && Date.now() - hiddenAt > STALE_AFTER_MS) stale = true;
  });
  document.addEventListener('resume', () => (stale = true)); // Chrome Android : page dégelée
  addEventListener('online', () => (stale = true));
  addEventListener('pageshow', (event) => event.persisted && (stale = true)); // retour du cache
  setInterval(() => {
    if (active === 0 && Date.now() - lastUse > IDLE_CLOSE_MS) resetRelay();
  }, 60_000);
}

const relay = () => libcurl?.wisp?.wisp_connections?.[RELAY_URL] ?? null;

/** Abandonne la connexion au relais : ses flux sont fermés, la prochaine requête en ouvre une neuve. */
export function resetRelay() {
  const all = libcurl?.wisp?.wisp_connections;
  const conn = all?.[RELAY_URL];
  stale = false;
  if (!conn) return;
  delete all[RELAY_URL];
  try {
    conn.on_ws_close(); // ferme les flux : curl ne réutilisera pas ces connexions
  } catch {}
  try {
    conn.ws?.close();
  } catch {}
}

/** Remplace la connexion si elle a pu mourir (retour au premier plan, réseau revenu, socket fermé). */
function checkRelay() {
  const conn = relay();
  if (stale || (conn?.ws && conn.ws.readyState > 1)) resetRelay();
}

// Codes d'erreur de curl après lesquels une nouvelle tentative est sûre :
//   7 (connexion impossible), 35 (poignée de main TLS) : la requête n'est jamais partie ;
//   52, 55, 56 (connexion coupée) et délai dépassé : seulement si la requête peut être rejouée.
const NOT_SENT = new Set([7, 35]);
const CUT = new Set([52, 55, 56]);

/** Erreur de transport : passagère, on peut réessayer plus tard (voir ui/mails.js). */
export class PortalUnreachable extends Error {
  constructor(reason, code) {
    super(`Portail injoignable (${reason})`);
    this.name = 'PortalUnreachable';
    this.transient = true;
    this.code = code;
  }
}

function timeoutSignal() {
  if (AbortSignal.timeout) return AbortSignal.timeout(TIMEOUT_MS);
  const ctl = new AbortController(); // iOS < 16 : pas d'AbortSignal.timeout
  setTimeout(() => ctl.abort(new DOMException('délai dépassé', 'TimeoutError')), TIMEOUT_MS);
  return ctl.signal;
}

let active = 0;
const queue = [];

async function once(session, url, init) {
  const signal = timeoutSignal();
  try {
    const res = await session.fetch(url, { method: init.method, headers: init.headers, body: init.body, redirect: 'manual', signal });
    const headers = res.raw_headers ?? [...res.headers];
    const named = (name) => headers.filter(([key]) => key.toLowerCase() === name).map(([, value]) => value);
    const body = new Uint8Array(await res.arrayBuffer());
    return { status: res.status, location: named('location')[0], setCookies: named('set-cookie'), body };
  } catch (error) {
    if (signal.aborted) throw new PortalUnreachable('délai dépassé', 'timeout');
    const message = error?.message ?? String(error);
    throw new PortalUnreachable(message, Number(/error code (\d+)/i.exec(message)?.[1]) || null);
  }
}

/**
 * Une requête HTTPS, sans cookie ni redirection automatiques. Une seule nouvelle tentative, sur une
 * connexion neuve, si la première a échoué faute de connexion (et pour une lecture, si elle a été
 * coupée en route) : jamais de boucle, et jamais un envoi de mail rejoué.
 */
async function raw(url, init) {
  let session;
  try {
    session = await ready();
  } catch (error) {
    throw new PortalUnreachable(`moteur indisponible : ${error?.message ?? error}`, 'engine');
  }
  if (active >= MAX_PARALLEL) await new Promise((resolve) => queue.push(resolve));
  active++;
  lastUse = Date.now();
  try {
    checkRelay();
    try {
      return await once(session, url, init);
    } catch (error) {
      const replay = NOT_SENT.has(error.code) || (init.idempotent && (CUT.has(error.code) || error.code === 'timeout'));
      if (!replay) throw error;
      resetRelay();
      return await once(session, url, init);
    }
  } finally {
    active--;
    lastUse = Date.now();
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
