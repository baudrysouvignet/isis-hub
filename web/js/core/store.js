// Préférences gardées sur cet appareil (localStorage) : la classe (aussi dans la sauvegarde chiffrée
// quand l'étudiant est connecté, voir core/userdata.js), l'affichage des tuiles,
// la visite guidée vue ou non. Ce stockage-ci ne quitte jamais l'appareil.
// Le stockage peut être indisponible (navigation privée stricte) : l'appli marche alors sans.

const PREFIX = 'hub.';
export const PREF_KEYS = ['promo', 'choice', 'view', 'tourDone', 'edtView', 'feedback', 'evals', 'installSeen', 'seenDay', 'changelogSeen', 'tcgJoined', 'tcgView'];

function storage() {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export const prefs = {
  get(key, fallback = null) {
    try {
      const raw = storage()?.getItem(PREFIX + key);
      return raw === null || raw === undefined ? fallback : JSON.parse(raw);
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      storage()?.setItem(PREFIX + key, JSON.stringify(value));
    } catch {
      // préférence non mémorisée, sans conséquence
    }
  },
};
