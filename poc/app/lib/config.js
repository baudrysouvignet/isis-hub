export const HOSTS = {
  cas: 'https://auth.univ-jfc.fr',
  ent: 'https://ent.univ-jfc.fr',
  mail: 'https://mail.univ-jfc.fr',
  moodle: 'https://moodle.univ-jfc.fr',
  ade: 'https://adecampus.univ-jfc.fr',
};

// Page de connexion officielle : c'est elle (et elle seule) qui reçoit l'identifiant et le mot de passe.
export const CAS_LOGIN_URL = `${HOSTS.cas}/cas/login?service=${encodeURIComponent(`${HOSTS.ent}/uPortal/Login`)}`;
export const CAS_LOGOUT_URL = `${HOSTS.cas}/cas/logout`;

// ADE : identifiants relevés dans l'arbre « Trainees > ISIS > ISIS-FIA-ANNEE1-2-3 » du planning 2026-2027.
// projectId change à chaque année universitaire ; les deux semestres d'une promo sont demandés ensemble.
export const ADE = {
  projectId: 10,
  promos: {
    FIA3: [3528, 3571],
    FIA4: [3612, 3657],
    FIA5: [3754, 3706],
  },
};

export const TIMEZONE = 'Europe/Paris';
export const MAIL_COUNT = 10;

export class NotLoggedIn extends Error {
  constructor(service) {
    super(`Session ${service} absente ou expirée`);
    this.name = 'NotLoggedIn';
    this.service = service;
  }
}
