// Plateforme « appli web » : la page ne peut pas lire les portails directement (règle des navigateurs),
// elle ouvre donc elle-même des connexions HTTPS, chiffrées ici par curl + mbedTLS en WebAssembly,
// et les fait transiter par un relais qui ne voit que des octets chiffrés.
import { HOSTS } from '../lib/config.js';
import { CookieJar, createClient } from './tunnel.js';
import { casLogin, casLogout, hasCasSession } from './cas.js';

if (window.top !== window.self) throw new Error("ISIS Hub refuse de s'afficher dans un cadre.");

const RELAY = document.querySelector('meta[name="isis-relay"]')?.content;
const PORTALS = new Set([HOSTS.cas, HOSTS.mail, HOSTS.moodle, HOSTS.ade].map((url) => new URL(url).hostname));
const SESSION_KEY = 'isis.session';
const MAX_PARALLEL = 4;
const TIMEOUT_MS = 30_000;

// ------------------------------------------------------------------ stockage

const storage = (name) => {
  try {
    return window[name];
  } catch {
    return null; // stockage désactivé (navigation privée stricte)
  }
};
const tab = storage('sessionStorage');
const device = storage('localStorage');

/** Où la session est gardée : dans l'onglet par défaut, sur l'appareil si l'utilisateur l'a demandé. */
let keep = device?.getItem(SESSION_KEY) ? device : tab;

function loadCookies() {
  try {
    return JSON.parse(keep?.getItem(SESSION_KEY) ?? '[]');
  } catch {
    return [];
  }
}

const jar = new CookieJar(loadCookies(), () => {
  try {
    const cookies = jar.toJSON();
    if (cookies.length) keep?.setItem(SESSION_KEY, JSON.stringify(cookies));
    else keep?.removeItem(SESSION_KEY);
  } catch {
    // stockage plein ou refusé : la session reste simplement en mémoire
  }
});

// -------------------------------------------------------------------- tunnel

const stats = { connections: 0, sent: 0, received: 0, hosts: new Set(), engine: null };
const size = (data) => data?.byteLength ?? data?.size ?? data?.length ?? 0;

/** Un WebSocket ordinaire vers le relais, qui compte ce qui passe pour l'écran « Transparence ». */
class RelaySocket extends WebSocket {
  constructor(url) {
    super(url);
    stats.connections++;
    stats.hosts.add(decodeURIComponent(new URL(url).pathname.slice(1)).split(':')[0]);
    this.addEventListener('message', (event) => (stats.received += size(event.data)));
  }

  send(data) {
    stats.sent += size(data);
    super.send(data);
  }
}

let engine;
const startEngine = async () => {
  if (!RELAY) throw new Error("Aucun relais n'est configuré (balise isis-relay de index.html).");
  const { libcurl } = await import('../vendor/libcurl/libcurl.mjs');
  await libcurl.load_wasm(new URL('../vendor/libcurl/libcurl.wasm', import.meta.url).href);
  libcurl.set_websocket(RELAY);
  libcurl.transport = RelaySocket;
  stats.engine = libcurl.version;
  // Une seule session pour toute la durée de la page ; ses cookies intégrés sont désactivés (voir tunnel.js).
  return new libcurl.HTTPSession({ enable_cookies: false });
};

let active = 0;
const queue = [];

/** Une requête HTTPS, sans cookie ni redirection automatiques. */
async function raw(url, init) {
  const session = await (engine ??= startEngine().catch((error) => {
    engine = undefined;
    throw error;
  }));
  if (active >= MAX_PARALLEL) await new Promise((resolve) => queue.push(resolve));
  active++;
  try {
    const res = await session.fetch(url, { ...init, redirect: 'manual', signal: AbortSignal.timeout?.(TIMEOUT_MS) });
    const headers = res.raw_headers ?? [...res.headers];
    const named = (name) => headers.filter(([key]) => key.toLowerCase() === name).map(([, value]) => value);
    const body = await res.text();
    return { status: res.status, location: named('location')[0], setCookies: named('set-cookie'), text: async () => body };
  } catch (error) {
    throw new Error(`Relais ou portail injoignable (${error?.message ?? error})`);
  } finally {
    active--;
    queue.shift()?.();
  }
}

const http = createClient({ raw, jar, allowedHosts: PORTALS });

// ---------------------------------------------------------------- plateforme

const kilo = (bytes) => `${Math.round(bytes / 1024).toLocaleString('fr-FR')} Ko`;

export default {
  http,

  prefs: {
    get: async (key) => {
      try {
        return JSON.parse(device?.getItem(`isis.${key}`) ?? 'null');
      } catch {
        return null;
      }
    },
    set: async (key, value) => {
      try {
        device?.setItem(`isis.${key}`, JSON.stringify(value));
      } catch {
        // préférence non mémorisée, sans conséquence
      }
    },
  },

  summary:
    "Tout est lu en direct sur les portails officiels. Le chiffrement se fait dans cette page : le relais ne " +
    'voit passer que des octets chiffrés, et aucun mot de passe ni contenu n’est enregistré.',

  /** Sans cookie de session CAS, inutile d'interroger Moodle ou la messagerie. */
  maybeSignedIn: () => hasCasSession(jar),

  login: {
    official: false,
    /** `remember` garde la session (jamais le mot de passe) sur l'appareil plutôt que dans l'onglet. */
    async submit(username, password, remember) {
      const chosen = (remember && device) || tab;
      if (chosen !== keep) keep?.removeItem(SESSION_KEY);
      keep = chosen;
      await casLogin(http, jar, username, password);
    },
  },

  async logout() {
    await casLogout(http, jar);
    tab?.removeItem(SESSION_KEY);
    device?.removeItem(SESSION_KEY);
  },

  /** Faits affichés dans l'écran « Transparence ». */
  facts() {
    const session = !hasCasSession(jar)
      ? 'aucune session ouverte'
      : keep === device
        ? 'cookies de session gardés sur cet appareil (à ta demande)'
        : "cookies de session gardés dans cet onglet, effacés à sa fermeture";
    return [
      ['Mode', 'Appli web : connexions chiffrées dans la page, acheminées par un relais aveugle'],
      ['Relais', RELAY ?? 'non configuré'],
      ['Chiffrement', stats.engine ? `curl ${stats.engine.curl}, ${stats.engine.ssl}` : 'pas encore chargé'],
      ['Destinations autorisées', [...PORTALS].join(', ')],
      [
        'Depuis l’ouverture de la page',
        `${stats.connections} connexion(s) via le relais, ${kilo(stats.sent)} envoyés, ${kilo(stats.received)} reçus` +
          (stats.hosts.size ? `, vers ${[...stats.hosts].join(', ')}` : ''),
      ],
      ['Enregistré sur cet appareil', `la promo choisie ; ${session}`],
      ['Jamais enregistré', 'ton mot de passe, tes mails, tes cours'],
    ];
  },
};
