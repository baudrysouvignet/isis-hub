// Journal des versions. La plus récente en premier.
//   short : 1 à 3 points, ce qui change pour toi (pop-up « Nouveautés », une fois par version)
//   details : le détail complet (page « Journal des versions » du compte)
// Les petits correctifs ne vont que dans le détail. Rien sur l'administration : le journal est public.
//   quiet : version de correctifs, au journal seulement, jamais dans la pop-up « Nouveautés »

export const CHANGELOG = [
  {
    version: '1.1.1',
    date: '2026-11-20',
    title: 'Reconnexion stable, examens dès 3 votes',
    quiet: true, // correctifs de la 1.1.0 : au journal, sans pop-up
    short: ['Reconnexion avec Face ID ou Touch ID stable, et examens signalés dès 3 camarades.'],
    details: [
      'Connexion infinie : après Face ID ou Touch ID, la fenêtre « Session expirée » pouvait revenir aussitôt, en boucle. Des échanges partis avant la reconnexion effaçaient la session neuve ; ils ne la touchent plus.',
      'Examens signalés : une séance apparaît chez toute la classe en « Examen ? » dès 3 camarades, quelle que soit la taille de la classe.',
    ],
  },
  {
    version: '1.1.0',
    date: '2026-11-20',
    title: 'Connexion infinie, examens de la classe',
    short: [
      'Connexion infinie, en option : sur ton appareil, Face ID ou Touch ID remplace ton mot de passe, même quand ta session expire.',
      'Examens signalés par ta classe : une séance que beaucoup de camarades ont marquée « examen » apparaît chez tous en « Examen ? ».',
      'Recherche des mails plus juste, et tu restes connecté sans case à cocher.',
    ],
    details: [
      'Connexion infinie (option, appareil par appareil) : ton mot de passe est chiffré et verrouillé sur l’appareil ; seule ta passkey (Face ID, Touch ID, empreinte, Windows Hello) peut l’ouvrir. Le serveur ne reçoit ni ton mot de passe, ni sa copie, ni la clé.',
      'Session expirée pendant que tu utilises ISIS Hub : une fenêtre propose de reprendre avec Face ID ou Touch ID, sans quitter la page, ou avec ton mot de passe.',
      'Après « Se déconnecter », l’écran de connexion montre ton identifiant et le bouton Face ID. La connexion infinie se désactive depuis le menu du compte ; elle s’efface seule après 90 jours sans usage ou si ton mot de passe change.',
      'Connexion : plus de case « Rester connecté ». La session reste chiffrée sur l’appareil jusqu’à sa fin côté université ; sur un ordinateur partagé, pense à te déconnecter.',
      'Examens signalés : marquer une séance comme examen compte aussi, anonymement, pour ta classe. Dès 20 % des membres actifs (3 au moins), la séance apparaît chez tous en « Examen ? », en pointillés. Votes anonymes et non vérifiés : seul l’emploi du temps ou l’enseignant fait foi, et tu peux masquer le signal.',
      'Mails : la recherche trouve chaque mot dans n’importe quel ordre (« Hélène Martin » trouve « MARTIN Hélène » comme helene.martin@…). Le champ dit ce qu’il fouille : expéditeur, objet, début du mail.',
      'Mails : l’alerte Moodle « Nouvelle connexion » envoyée quand ISIS Hub se connecte va à la corbeille, seulement si elle cite cet appareil et arrive dans la minute et demie. Une connexion faite d’ailleurs garde son alerte. Réglable dans « Règles et étiquettes ».',
      'Téléphone : la page derrière une fiche ouverte ne défile plus.',
      'Transparence : votes d’examen et connexion infinie ajoutés à ce que gardent le serveur et l’appareil.',
    ],
  },
  {
    version: '1.0.6',
    date: '2026-11-19',
    title: 'Mails fiables, ptut FIE5',
    short: [
      'Les mails ne passent plus au rouge quand tu reviens dans l’application : la reconnexion est automatique.',
      'FIE5 : les séances de projet d’innovation (ptut) sont de retour, dans le Hub et dans ton agenda.',
      'Sécurité et fiabilité renforcées.',
    ],
    details: [
      'Mails : au retour dans l’application (téléphone verrouillé, appli en arrière-plan), la connexion est renouvelée avant de recharger ; fini la tuile rouge qu’il fallait « Réessayer ».',
      'Mails : en cas de coupure, nouveaux essais automatiques (1, 2, 4 puis 8 secondes) ; « Réessayer » n’apparaît que s’ils échouent tous. Relance aussi au retour du réseau.',
      'Mails : une session de messagerie expirée est rouverte sans afficher d’erreur.',
      'Mails plus anciens : plus de chargement en boucle quand la messagerie ne répond pas.',
      'FIE5 : séances « Projet innovation » (ptut) de retour dans l’emploi du temps et dans les abonnements d’agenda (Google, Apple, Outlook), pour les trois parcours.',
      'Wi-Fi du campus : beaucoup plus d’étudiants peuvent utiliser le Hub en même temps depuis le même réseau.',
      'Sauvegarde chiffrée encore mieux protégée : même une copie des fichiers du serveur ne permet pas de tester un mot de passe.',
      '« Mes propositions » : rien ne reste sur l’appareil après déconnexion. Sur un ordinateur partagé, l’étudiant suivant ne voit plus tes propositions ni les réponses de l’équipe.',
      '« Mes propositions » : retrouvées sur tous tes appareils. Quand tu es connecté, le suivi est rangé dans ta sauvegarde chiffrée : tu le retrouves en te reconnectant, même sur un autre appareil (les propositions déjà envoyées comprises).',
      'Réponse à un mail : en-têtes de conversation vérifiés.',
      'Transparence : textes précisés (ce que garde le serveur, limites du coffre de l’appareil, classe, règles et étiquettes retrouvées sur tes autres appareils).',
      'Serveur : protections renforcées contre les abus et les pannes (mémoire, disque, débit).',
    ],
  },
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
  },
  {
    version: '1.0.1',
    date: '2026-11-17',
    title: 'Notes par classe',
    short: ['Les notes s’ouvrent classe par classe, dès que leur maquette est prête.'],
    details: [
      'Notes ouvertes classe par classe, avec un message d’attente tant que la maquette de ta classe n’est pas prête.',
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

/** Versions à présenter dans la pop-up, de la plus récente à la plus ancienne (sans les `quiet`). */
export function unseen(lastSeen) {
  const floor = typeof lastSeen === 'string' && /^\d+(\.\d+)*$/.test(lastSeen) ? lastSeen : null;
  return CHANGELOG.filter((e) => !e.quiet && (floor ? cmpVersion(e.version, floor) > 0 : cmpVersion(e.version, FIRST_SHOWN) >= 0));
}
