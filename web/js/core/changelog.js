// Journal des versions. La plus récente en premier.
//   short : 1 à 3 points, ce qui change pour toi (pop-up « Nouveautés », une fois par version)
//   details : le détail complet (page « Journal des versions » du compte)
// Les petits correctifs ne vont que dans le détail. Rien sur l'administration : le journal est public.
//   quiet : version de correctifs, au journal seulement, jamais dans la pop-up « Nouveautés »
//   launch : l'écran « nouvelle version » (index.html, dialog[data-launch]), pour CHAQUE version
//            non `quiet` désormais : un visuel (template[data-launch-art-tpl=<art>]), un titre, une
//            phrase, 3 étapes au plus, et le bouton « Accéder » (go.to : où il mène, voir main.js).
//            Boutons : Accéder, Quitter, Voir le changelog.

export const CHANGELOG = [
  {
    version: '2.0.3',
    date: '2026-11-24',
    title: 'TCG : indique qui est sur ta photo',
    quiet: true, // au journal seulement, sans pop-up « Nouveautés »
    short: ['TCG : en créant une carte, indique qui est sur la photo, avec les suggestions de ta messagerie.'],
    details: [
      'Créer une carte : « Qui est sur la photo ? », avec la même liste que le champ « Cc » d’un mail (personnes récentes d’abord, puis l’annuaire, étudiants en premier). 5 personnes au plus.',
      'Les gens d’ISIS passent en tête de la liste, avec la mention « ISIS » : ils sont reconnus d’après les participants de tes cours Moodle d’ISIS, dans ta page (aucun nom n’est envoyé au serveur d’ISIS Hub).',
      'L’équipe vérifie cette liste à la validation, puis demande leur accord à ces personnes : rien ne part avant.',
    ],
  },
  {
    version: '2.0.2',
    date: '2026-11-24',
    title: 'TCG : l’accord demandé à la validation, un booster toutes les 24 h',
    quiet: true, // au journal seulement, sans pop-up « Nouveautés »
    short: ['TCG : l’accord des personnes sur la photo est demandé à la validation ; un booster toutes les 24 h.'],
    details: [
      'À la validation, l’équipe indique les personnes reconnaissables sur la photo. La carte attend l’accord de chacune (« Acceptée · en attente de l’accord des personnes sur la photo ») et passe au jury dès la dernière réponse.',
      'Créer une carte : plus de champ « Qui est sur la photo ? » ni de case « les personnes sont d’accord » : l’accord leur est demandé directement.',
      '« Mes apparitions » est toujours visible dans le TCG. Personne ne sait qui a refusé.',
      'Accord retiré sur une carte en jeu : les exemplaires restent dans les collections, marqués « Accord retiré », sans photo ni texte.',
      'Un booster toutes les 24 heures, comptées depuis le dernier ouvert (et non plus chaque matin).',
    ],
  },
  {
    version: '2.0.1',
    date: '2026-11-24',
    title: 'TCG : l’accord des personnes sur la photo',
    quiet: true, // au journal seulement, sans pop-up « Nouveautés »
    short: ['TCG : indique qui est sur ta photo, chacun donne son accord dans « Mes apparitions ».'],
    details: [
      'Créer une carte : champ « Qui est sur la photo ? » (5 adresses de l’université au plus).',
      'Une fois la carte validée, ces personnes reçoivent un mail de l’équipe ISIS Hub (un seul, en copie cachée, au plus tous les deux jours) et donnent ou refusent leur accord dans le TCG, « Mes apparitions ». Un refus retire la carte, sans dire qui a refusé.',
      'Le serveur ne garde qu’une empreinte de ces adresses, et leur version chiffrée seulement jusqu’au départ du mail.',
      'Correctif : l’icône des fichiers Moodle (PDF…) et les destinataires d’un mail retrouvent leur affichage.',
    ],
  },
  {
    version: '2.0.0',
    date: '2026-11-24',
    title: 'Le TCG de la promo',
    launch: {
      art: 'tcg',
      requires: 'tcg', // écran montré seulement quand le TCG est ouvert aux étudiants
      title: 'Le TCG de la promo arrive',
      sub: 'Des cartes à collectionner, créées par la promo elle-même.',
      steps: [
        ['Propose tes cartes', 'Une photo, un titre, deux phrases : un mème, un moment, un lieu de l’école.'],
        ['Classe celles des autres', 'Le jury de la semaine choisit les cartes qui entrent dans le jeu, et leur rareté.'],
        ['Un booster toutes les 24 h', 'Cinq cartes, de Commune à Unique, et des échanges en face à face avec un QR code.'],
      ],
      privacy: 'Tu y apparais sous ton prénom et l’initiale de ton nom. Le jeu garde ce nom, ta collection, tes propositions et tes votes, rattachés à une empreinte de ton identifiant : jamais l’identifiant lui-même.',
      go: { label: 'Ouvrir le TCG', to: 'tcg' },
    },
    short: [
      'Nouvel en-tête : bascule Hub / TCG au centre ; Transparence est dans ton compte.',
      'Le TCG de la promo : propose tes cartes, classe celles des autres, un booster par jour.',
      'Échanges en face à face : un QR code, et l’échange se fait d’un coup.',
    ],
    details: [
      'En-tête : bascule Hub / TCG au centre, la date n’y est plus, Transparence est rangée dans le menu du compte. Sur un écran moyen, les boutons du Hub ne gardent que leur icône.',
      'TCG de la promo (connexion requise) : avant le lancement, page d’attente avec compte à rebours et propositions ouvertes ; ensuite, un booster de 5 cartes par jour, avec une ouverture animée.',
      'Créer une carte : photo recadrée et compressée dans ta page (les métadonnées de la photo, dont la position GPS, sont retirées), titre, deux phrases, catégorie ; relue par un administrateur.',
      'Jury de la semaine : 5 cartes à classer, auteurs masqués, jamais les tiennes ; les plus attendues entrent dans la vague suivante et deviennent les plus rares.',
      'Nom dans le jeu : ton prénom et l’initiale de ton nom (« Léa M. »), tirés de ton compte ; il ne se change pas.',
      'Collection par vague, cartes manquantes (numéro et rareté), « Je cherche », doubles, signalement d’une carte.',
      'Une carte refusée ou retirée n’est plus montrée à personne ; sa photo est effacée du stockage au bout de 7 jours (refusée) ou de 30 jours (retirée).',
      'Échanges en face à face : QR code ou code à 4 caractères, table en direct, « Maintiens pour échanger » ; toute modification annule les deux « prêt ».',
      'Ce qui est gardé : voir Transparence. Ton identifiant universitaire n’est jamais enregistré ; le jeu en garde une empreinte pour qu’il n’y ait qu’un compte par étudiant.',
    ],
  },
  {
    version: '1.2.0',
    date: '2026-11-22',
    title: 'Moodle dans ISIS Hub',
    launch: {
      art: 'moodle',
      title: 'Moodle, maintenant dans ISIS Hub',
      sub: 'Tes cours, leurs fichiers et tes inscriptions, sans quitter le Hub.',
      steps: [
        ['Ouvre un cours', 'Touche un cours sur la tuile Moodle ou dans l’emploi du temps : il s’ouvre ici, tout déplié.'],
        ['Lis et télécharge', 'Un PDF ou une image s’affiche d’un geste ; un dossier entier se récupère en .zip.'],
        ['Inscris-toi', '« Ma classe » liste tous les cours de ton semestre. Sur « Pas inscrit », un bouton et c’est fait.'],
      ],
      privacy: 'Tout est lu depuis ta page, par le tunnel chiffré : le serveur d’ISIS Hub ne voit rien de tes cours.',
      go: { label: 'Accéder à mes cours', to: 'moodle' },
    },
    short: [
      'Moodle s’ouvre dans le Hub : tes cours, tout déplié, sans quitter la page.',
      'Aperçu des PDF et des images d’un geste, téléchargement direct, dossiers en .zip.',
      '« Ma classe » : tous les cours de ton semestre, et l’inscription en un bouton.',
    ],
    details: [
      'Moodle dans le Hub : la tuile Moodle, l’emploi du temps, les rendus et les liens des enseignants ouvrent maintenant la page du cours dans ISIS Hub, plutôt que Moodle dans un autre onglet.',
      'Page d’un cours : toutes les parties dépliées, un sommaire qui suit la lecture, les rendus à faire en tête, les devoirs et tests avec leur date limite et leur note, les nouveautés depuis ta dernière visite.',
      'Fichiers : aperçu des PDF et des images dans le Hub, téléchargement direct, dossier entier en .zip. Les liens déposés par les enseignants mènent directement au site visé.',
      'Accueil Moodle : recherche dans tous tes cours, le cours du moment, « Ma classe » (tous les cours du semestre de ta classe, S1 à S10, avec « Pas inscrit » sur ceux que tu ne suis pas), puis « Mes autres cours » et le catalogue des cours ISIS.',
      'Inscription : en un bouton pour les cours ouverts, avec la clé donnée par l’enseignant sinon ; pour les autres, un mail à l’enseignant. Le mail « Bienvenue sur … » envoyé par Moodle après une inscription faite dans le Hub part à la corbeille, sans bruit.',
      'Safari : les PDF s’affichent dans le Hub.',
      'Tout est lu depuis ta page, par le tunnel chiffré : le serveur d’ISIS Hub ne voit ni tes cours ni tes fichiers. Seuls les numéros des éléments déjà vus sont gardés, chiffrés, pour signaler les nouveautés.',
    ],
  },
  {
    version: '1.1.4',
    date: '2026-11-22',
    title: 'Prochains rendus Moodle',
    short: [
      'Nouvelle tuile « Prochains rendus » : tes devoirs Moodle avec leur date limite, une coche verte quand c’est rendu.',
      'Emploi du temps : un repère sur les jours où un rendu est attendu.',
      'Moodle : la tuile défile d’un bloc, la recherche reste en haut.',
    ],
    details: [
      'Prochains rendus : les échéances Moodle (devoirs, tests…) à côté de la tuile Moodle, avec la date, la matière et le temps restant (« Demain, 23 h 59 », « Dans 3 j »). Les devoirs déjà rendus portent une coche verte ; les retards sont en rouge.',
      'Un retard de plus d’une semaine n’est plus affiché.',
      'Un rendu affiché par erreur se masque d’un clic (au survol de la ligne). Les rendus masqués restent en bas de la tuile, dans « Masqués », et se réaffichent d’un clic. Ce choix est gardé chiffré, sur tous tes appareils.',
      'Emploi du temps : un petit badge sur les jours où un rendu est attendu (coche verte si tout est rendu) ; la pastille à côté de la date mène à la tuile Rendus.',
      'Moodle : toute la tuile défile, la recherche reste collée en haut ; le cours du moment réapparaît en remontant, et la tuile remonte seule après un moment sans y toucher.',
      'Les rendus sont lus dans Moodle depuis ta page, comme le reste : le serveur d’ISIS Hub n’en voit rien.',
    ],
  },
  {
    version: '1.1.3',
    date: '2026-11-21',
    title: 'Plus de déconnexion quand la messagerie est en panne',
    quiet: true, // correctif : au journal, sans pop-up
    short: ['Messagerie ou Moodle en panne : tu restes connecté, seule la tuile concernée l’indique.'],
    details: [
      'Pendant une panne ou une maintenance de la messagerie, ISIS Hub affichait « Session expirée » en boucle, même juste après Face ID ou Touch ID. Une panne d’un portail n’est plus prise pour une fin de session : la tuile indique « indisponible pour le moment » avec « Réessayer ».',
      '« Session expirée » n’apparaît plus que si le service d’authentification de l’université confirme que la session est finie.',
    ],
  },
  {
    version: '1.1.2',
    date: '2026-11-20',
    title: 'Recherche par personne, notes renommées',
    short: [
      'Mails : cherche une personne, puis affine avec d’autres mots ; les PDF joints s’ouvrent dans le Hub.',
      'Notes : renomme une évaluation (« Contrôle continu » → « Oral ») et ajoute des notes en simulation.',
      'Emploi du temps : un petit crayon signale les cours où tu as écrit une note.',
    ],
    details: [
      'Mails : en tapant un nom, la recherche propose les personnes de tes mails et de l’annuaire. En choisir une garde les mails qu’elle a envoyés, ou où elle est destinataire ou en copie ; tu peux encore taper des mots (« contrôle »).',
      'Mails en plein écran : la liste ne passe plus sous le mail ouvert, les dates sont visibles, et la recherche n’affiche que les mails trouvés.',
      'Pièces jointes : les PDF s’affichent dans le Hub, comme les images.',
      'Mails non lus plus visibles : en gras, les mails lus plus discrets.',
      'Menu « Affichage » : il passe devant la messagerie en plein écran.',
      'Notes : renomme une évaluation prévue depuis sa fiche ; le nouveau nom n’est visible que par toi.',
      'Notes en simulation : « + » ajoute une note simulée en plus des évaluations prévues, et elle ne disparaît plus.',
      'Notes : si une évaluation disparaît de la maquette de ta classe, la note que tu avais saisie reste, en note personnelle.',
      'Emploi du temps : un crayon, à côté du lien Moodle, sur les séances des cours où tu as écrit une note.',
    ],
  },
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
