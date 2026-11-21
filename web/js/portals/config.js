// Les quatre portails joignables. Le relais (cmd/isis-hub/main.go) a la même liste, en dur :
// même si cette page était modifiée, il refuserait toute autre destination.
export const HOSTS = {
  cas: 'https://auth.univ-jfc.fr',
  ade: 'https://adecampus.univ-jfc.fr',
  mail: 'https://mail.univ-jfc.fr',
  moodle: 'https://moodle.univ-jfc.fr',
};
export const PORTAL_HOSTS = new Set(Object.values(HOSTS).map((url) => new URL(url).hostname));

/** Lien hors appli (raccourci), jamais appelé par la page elle-même. */
export const ENT_URL = 'https://ent.univ-jfc.fr/';

// Classes, ressources ADE et règles de filtrage : data/classes.json (voir portals/classes.js).

/** Le portail répond mal (maintenance, panne) alors que la session universitaire est valable. */
export class PortalDown extends Error {
  constructor(service, detail = '') {
    super(`${service} indisponible pour le moment${detail ? ` (${detail})` : ''}, réessaie plus tard`);
    this.name = 'PortalDown';
    this.service = service;
  }
}

/**
 * « Session expirée » seulement si le CAS le confirme. Sinon (session CAS valable, ou CAS muet),
 * le portail est en panne : erreur ordinaire, la tuile propose « Réessayer » et rien n'est effacé.
 */
export async function notSignedInOrDown(service, detail, check) {
  const alive = await check();
  return alive === false ? new NotSignedIn(service) : new PortalDown(service, detail);
}

export class NotSignedIn extends Error {
  constructor(service) {
    super(`Session ${service} absente ou expirée`);
    this.name = 'NotSignedIn';
    this.service = service;
  }
}
