// Alertes « Nouvelle connexion à votre compte Moodle » déclenchées par ISIS Hub lui-même.
//
// Quand ISIS Hub ouvre une session Moodle (bouton CAS de Moodle, portals/moodle.js), Moodle envoie
// une alerte par mail. Une alerte de sécurité ne se supprime pas à la légère : elle peut révéler
// une intrusion. Celle-ci n'est donc mise à la corbeille (récupérable) que si TOUT concorde :
//   1. objet « Nouvelle connexion à votre compte… » (ou la version anglaise de Moodle) ;
//   2. expéditeur de l'université (…@univ-jfc.fr ou un de ses sous-domaines) ;
//   3. reçue au plus WINDOW_MS après une connexion Moodle faite par ISIS Hub SUR CET APPAREIL, dans
//      cette page (instant gardé en mémoire seulement) ;
//   4. son contenu cite l'identité exacte du navigateur de cet appareil (User-Agent), que Moodle
//      recopie dans l'alerte et qu'ISIS Hub lui a envoyée ;
//   5. une seule alerte par connexion.
// Une connexion faite d'ailleurs (autre appareil, autre navigateur, autre moment) ne remplit pas ces
// conditions : son alerte reste dans la boîte. Rien ne part vers le serveur ISIS Hub.
//
// Ce fichier ne touche ni au réseau ni à l'interface : il est testé tel quel sous Node.

export const WINDOW_MS = 90_000; // après la connexion Moodle (Moodle envoie l'alerte par tâche de fond)
const EARLY_MS = 10_000; // tolérance d'horloge entre l'appareil et le serveur de Moodle
const SUBJECT = /^(nouvelle connexion a votre compte|new sign in to your)\b/;
const SENDER = /@([a-z0-9-]+\.)*univ-jfc\.fr$/i;

const norm = (t) => (t ?? '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim();

export function createLoginAlerts({ now = () => Date.now(), userAgent = globalThis.navigator?.userAgent ?? '' } = {}) {
  let logins = []; // { at, used } : connexions Moodle faites par ISIS Hub dans cette page
  const owner = new WeakMap(); // mail → connexion qu'il signale

  const fresh = () => (logins = logins.filter((l) => now() - l.at <= WINDOW_MS + 60_000));

  /** ISIS Hub vient d'ouvrir une session Moodle (instant pris avant la demande). */
  function noteLogin(at = now()) {
    fresh();
    logins.push({ at, used: false });
  }

  /** Une alerte est-elle encore attendue ? */
  const pending = () => fresh().some((l) => !l.used && now() - l.at <= WINDOW_MS);

  /** Critères 1 et 2 : objet et expéditeur. */
  const looksLikeAlert = (m) => SUBJECT.test(norm(m?.subject)) && SENDER.test(m?.from?.address ?? '');

  /** Critère 3 : connexion non encore utilisée dont la fenêtre contient la date du mail. */
  function loginFor(m) {
    const t = m?.date instanceof Date ? m.date.getTime() : NaN;
    if (!Number.isFinite(t)) return null;
    return fresh().find((l) => !l.used && t >= l.at - EARLY_MS && t <= l.at + WINDOW_MS) ?? null;
  }

  /** Critère 4 : le contenu cite le User-Agent de cet appareil (blancs et balises ignorés). */
  function mentionsThisDevice(content) {
    const ua = userAgent.replace(/\s+/g, '');
    if (ua.length < 20) return false; // identité trop courte pour être une preuve
    const text = String(content ?? '')
      .replace(/<[^>]*>/g, ' ')
      .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
      .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
      .replace(/&quot;/g, '"')
      .replace(/&#39;|&apos;/g, "'")
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/\s+/g, '');
    return text.includes(ua);
  }

  /**
   * Alertes d'ISIS Hub parmi `list`. Lit le contenu des seuls mails qui passent déjà les critères
   * 1 à 3 (`fetchBody(m)` rend { content }). Rend les mails à mettre à la corbeille ; `consume`
   * les marque traités une fois déplacés.
   */
  async function find(list, fetchBody) {
    const out = [];
    const taken = new Set();
    for (const m of list ?? []) {
      if (!looksLikeAlert(m)) continue;
      const login = loginFor(m);
      if (!login || taken.has(login)) continue;
      let content = '';
      try {
        content = (await fetchBody(m))?.content ?? '';
      } catch {
        continue;
      }
      if (!mentionsThisDevice(content)) continue;
      taken.add(login);
      owner.set(m, login);
      out.push(m);
    }
    return out;
  }

  /** Après la mise à la corbeille : chaque connexion n'efface qu'une alerte. */
  function consume(found) {
    for (const m of found) {
      const login = owner.get(m);
      if (login) login.used = true;
    }
  }

  return { noteLogin, pending, looksLikeAlert, mentionsThisDevice, find, consume };
}
