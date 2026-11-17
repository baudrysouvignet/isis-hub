// Plateforme « extension » : le navigateur autorise la page à lire les portails avec la session déjà
// ouverte. Aucun relais, et la connexion se fait sur la vraie page du CAS, dans un onglet.
import { CAS_LOGIN_URL, CAS_LOGOUT_URL, HOSTS } from '../lib/config.js';

let loginTabId = null;
let whenDone = () => {};

async function finished(closeTab) {
  const tabId = loginTabId;
  loginTabId = null;
  if (closeTab) {
    const self = await chrome.tabs.getCurrent();
    if (self) await chrome.tabs.update(self.id, { active: true });
    chrome.tabs.remove(tabId).catch(() => {});
  }
  whenDone();
}

// Le CAS renvoie vers l'ENT une fois l'authentification réussie : c'est le signal attendu.
chrome.tabs.onUpdated.addListener((tabId, change, tab) => {
  if (tabId === loginTabId && (change.url || tab.url || '').startsWith(HOSTS.ent)) finished(true);
});
chrome.tabs.onRemoved.addListener((tabId) => {
  if (tabId === loginTabId) finished(false);
});

export default {
  http: (url, init) => fetch(url, { credentials: 'include', cache: 'no-store', ...init }),

  prefs: {
    get: async (key) => (await chrome.storage.local.get(key))[key],
    set: (key, value) => chrome.storage.local.set({ [key]: value }),
  },

  summary:
    'Tout est lu en direct sur les portails officiels (ADE, messagerie, Moodle) avec la session de ton ' +
    "navigateur. Aucun identifiant ni contenu n'est enregistré ou envoyé ailleurs.",

  /** La session vit dans le navigateur : seul un appel aux portails dit si elle est ouverte. */
  maybeSignedIn: () => true,

  login: {
    official: true,
    pending: () => loginTabId !== null,
    async start(done) {
      whenDone = done;
      loginTabId = (await chrome.tabs.create({ url: CAS_LOGIN_URL })).id;
    },
  },

  logoutUrl: CAS_LOGOUT_URL,

  facts: () => [
    ['Mode', 'Extension : la page parle directement aux portails, sans aucun relais'],
    ['Connexion', 'sur la page officielle auth.univ-jfc.fr, dans un onglet ; le mot de passe ne passe jamais par ISIS Hub'],
    ['Session', 'celle de ton navigateur (les cookies des portails), rien de plus'],
    ['Enregistré sur cet appareil', 'la promo choisie'],
    ['Jamais enregistré', 'ton mot de passe, tes mails, tes cours'],
  ],
};
