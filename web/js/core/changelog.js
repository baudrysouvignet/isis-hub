// Journal des versions. La plus récente en premier.
//   short : 1 à 3 points, ce qui change pour toi (pop-up « Nouveautés », une fois par version)
//   details : le détail complet (page « Journal des versions » du compte)
//   admin : ce qui change dans l'administration (journal seulement)
// Les petits correctifs ne vont que dans le détail.

export const CHANGELOG = [
  {
    version: '1.0.5',
    date: '2026-11-18',
    title: 'Nouveautés et premiers pas',
    short: [
      'Les nouveautés de chaque version s’affichent ici, une seule fois.',
      'La visite guidée et l’installation ne te sont proposées qu’une fois, sur tous tes appareils.',
    ],
    details: [
      'Pop-up « Nouveautés » à la première visite après une mise à jour : une fois par étudiant et par version, quel que soit l’appareil.',
      'Journal des versions complet, depuis le menu du compte.',
      'Visite guidée et tutoriel d’installation proposés une seule fois par étudiant : le « déjà vu » est gardé dans ta sauvegarde chiffrée et anonyme, plus seulement dans le navigateur.',
    ],
    admin: [
      'Fréquentation comptée une fois par compte et par jour (plus par appareil), sans identifiant : jeton du jour illisible et oublié le lendemain.',
      'Nouvelles données anonymes à partir du 18 novembre 2026 : comptes par classe, type d’appareil (téléphone, tablette, ordinateur), application installée ou navigateur, visiteurs sans connexion.',
      'Onglet Fréquentation refait : courbes par jour, période (7, 30, 90 jours, tout), filtre par classe, répartitions en barres.',
    ],
  },
  {
    version: '1.0.4',
    date: '2026-11-18',
    title: 'Menu du CROUS toujours à jour',
    short: [
      'Le menu du Resto U’ est relu toutes les 15 minutes, même page ouverte.',
    ],
    details: [
      'Menu du CROUS relu toutes les 15 minutes sur le serveur, sans cache navigateur ni proxy.',
      'Les pages restées ouvertes relisent le menu toutes les 15 minutes et au retour sur l’onglet.',
    ],
  },
  {
    version: '1.0.3',
    date: '2026-11-18',
    title: 'Messagerie et recherche',
    short: [
      'Messagerie plein écran : sélection multiple et « Tout marquer comme lu ».',
      'Notes personnelles sur chaque cours, chiffrées.',
    ],
    details: [
      'Recherche dans les mails : les plus anciens se chargent automatiquement jusqu’à 20 résultats, puis au défilement.',
      'Messagerie plein écran : sélection multiple (lus, non lus, étiquettes, corbeille, restaurer) et « Tout marquer comme lu » dans l’en-tête.',
      'Plus de boutons vers la webmail : tout se fait dans le Hub.',
      'En-tête de la tuile Mails sur une ligne ; menu Affichage jamais coupé.',
      'Fiche d’un cours : notes personnelles (1000 caractères, chiffrées) à la place du carnet Moodle.',
      'Maquettes de notes par parcours (FIE4 et FIE5).',
      'Correctif : menu du CROUS du jour relu tant qu’il n’est pas publié.',
    ],
    admin: [
      'Maquettes de notes par parcours (FIE4 et FIE5, ex. « FIE4:ia ») : chaque parcours peut avoir la sienne, la maquette de la classe sert à défaut.',
      'Liste des classes avec leurs parcours, et messages adaptés (« commune aux parcours », « aucune maquette pour ce parcours »).',
    ],
  },
  {
    version: '1.0.2',
    date: '2026-11-18',
    title: 'Notes liées à ton compte',
    short: [
      'Ta classe et tes options sont retrouvées sur tous tes appareils.',
      'Les examens de l’emploi du temps sont reliés à tes évaluations.',
    ],
    details: [
      'Notes réservées aux étudiants connectés, lues depuis la sauvegarde avant affichage.',
      'Classe et options (groupe, langue, parcours) sauvegardées et retrouvées à la connexion, sur tout navigateur.',
      'Examens de l’emploi du temps reliés aux évaluations par code ADE (dates et propositions de contrôles).',
      '« Terminer le semestre » par étudiant, sans dates de semestre imposées.',
      'Correctif : bouton « Fermer » visible dans la lecture de mail côte à côte.',
    ],
    admin: [
      'Éditeur de maquettes : dates de semestre retirées (facultatives dans le JSON), le semestre en cours est choisi par chaque étudiant.',
    ],
  },
  {
    version: '1.0.1',
    date: '2026-11-17',
    title: 'Notes par classe',
    short: ['Les notes s’ouvrent classe par classe, dès que leur maquette est prête.'],
    details: [
      'Notes activables par classe, avec un message d’attente tant que la maquette est en brouillon (gardée privée).',
      'Administration : JSON d’exemple à télécharger, nouvel éditeur de maquettes (classes et état, UE et matières dépliables, barre d’enregistrement).',
    ],
    admin: [
      'Notes activables ou désactivables par classe, avec un message d’attente personnalisé ; une maquette en brouillon reste privée.',
      'Nouvel éditeur de maquettes : classes et état, UE et matières dépliables, barre d’enregistrement.',
      'JSON d’exemple à télécharger ou à charger directement dans l’éditeur.',
    ],
  },
  {
    version: '1.0.0',
    date: '2026-11-17',
    title: 'Notes et sauvegarde chiffrée',
    short: [
      'Nouvelle tuile Notes : moyennes, rattrapages et simulation.',
      'Tes données sont sauvegardées, chiffrées et anonymes, sur tous tes appareils.',
      'Messagerie plein écran avec lecture côte à côte.',
    ],
    details: [
      'Notes : maquette par classe, moyennes par UE et par semestre, rattrapages repérés, mode simulation.',
      'Sauvegarde anonyme et chiffrée (notes, examens marqués, règles de mails) : retrouvée sur tous tes appareils, illisible côté serveur.',
      'Messagerie plein écran, liste et lecture côte à côte.',
      'Glisser-déposer des pièces jointes ; destinataires récents proposés en premier.',
      'Sortie « Fermer » unifiée sur toutes les fenêtres.',
      'Transparence en trois catégories : ce que fait la page, ce qui est gardé, contrôles en direct.',
    ],
    admin: [
      'Onglet Notes : maquette par classe (semestres, UE, matières, coefficients, évaluations, codes ADE) et import JSON vérifié par le serveur.',
      'Sauvegarde anonyme des étudiants côté serveur (/api/vault) : uniquement des données chiffrées sous un identifiant qui ne dit rien.',
    ],
  },
  {
    version: '0.0.2',
    date: '2026-11-17',
    title: 'Bêta : mails, CROUS, installation',
    short: ['Menu du Resto U’, étiquettes et règles de mails, application installable.'],
    details: [
      'Menu du midi du Resto U’ de Castres dans l’emploi du temps.',
      'Mails : étiquettes, corbeille, règles automatiques, pièces jointes, bouton d’écriture.',
      'Tutoriel pour installer ISIS Hub comme une application (iPhone, Android, ordinateur).',
      'Statistiques d’usage anonymes (compteurs, sans identifiant) pour l’administration.',
    ],
    admin: [
      'Onglet Fréquentation : appareils distincts par jour, moyenne par jour de la semaine, ouvertures au total.',
    ],
  },
  {
    version: '0.0.1',
    date: '2026-11-17',
    title: 'Première bêta',
    short: ['Emploi du temps, mails et Moodle sur une seule page.'],
    details: [
      'Emploi du temps ADE, messagerie BlueMind et cours Moodle réunis sur une seule page.',
      'Connexion à l’ENT par un relais aveugle : il ne voit que du chiffré.',
      'Écran Transparence et visite guidée.',
      'Avis et suggestions envoyés depuis la page.',
    ],
    admin: [
      'Page d’administration réservée aux identifiants autorisés, ouverte par le CAS de l’université (ticket vérifié par le serveur).',
      'Retours « Une idée ? » des étudiants, répartition des emplois du temps par classe, raccourcis publiés sur la page.',
    ],
  },
];

export const LATEST = CHANGELOG[0].version;

const parts = (v) => String(v).split('.').map((n) => Number.parseInt(n, 10) || 0);
export function cmpVersion(a, b) {
  const x = parts(a);
  const y = parts(b);
  for (let i = 0; i < Math.max(x.length, y.length); i += 1) {
    const d = (x[i] ?? 0) - (y[i] ?? 0);
    if (d) return d;
  }
  return 0;
}

// Première pop-up (personne n'a encore de « déjà vu ») : de la 1.0.3 à la 1.0.5 ensemble.
const FIRST_SHOWN = '1.0.3';

/** Versions à présenter dans la pop-up, de la plus récente à la plus ancienne. */
export function unseen(lastSeen) {
  const floor = typeof lastSeen === 'string' && /^\d+(\.\d+)*$/.test(lastSeen) ? lastSeen : null;
  return CHANGELOG.filter((e) => (floor ? cmpVersion(e.version, floor) > 0 : cmpVersion(e.version, FIRST_SHOWN) >= 0));
}
