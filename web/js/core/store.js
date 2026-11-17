// Préférences gardées sur cet appareil (localStorage) : la classe, l'affichage des tuiles,
// la visite guidée vue ou non. Rien de personnel, rien qui quitte l'appareil.
// Le stockage peut être indisponible (navigation privée stricte) : l'appli marche alors sans.

const PREFIX = 'hub.';
export const PREF_KEYS = ['promo', 'choice', 'view', 'tourDone', 'edtView', 'feedback'];

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
