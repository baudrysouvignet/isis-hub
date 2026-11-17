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

export class NotSignedIn extends Error {
  constructor(service) {
    super(`Session ${service} absente ou expirée`);
    this.name = 'NotSignedIn';
    this.service = service;
  }
}
