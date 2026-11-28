// Journal des versions. La plus récente en premier.
//   short : 1 à 3 points, ce qui change pour toi (pop-up « Nouveautés », une fois par version)
//   details : le détail complet (page « Journal des versions » du compte)
// Les petits correctifs ne vont que dans le détail. Rien sur l'administration : le journal est public.
//   quiet : version de correctifs, au journal seulement, jamais dans la pop-up « Nouveautés »
//   launch : l'écran « nouvelle version » (index.html, dialog[data-launch]), pour CHAQUE version
//            non `quiet` désormais : un visuel (template[data-launch-art-tpl=<art>]), un titre, une
//            phrase, 3 étapes au plus, et le bouton « Accéder » (go.to : où il mène, voir main.js).
//            Boutons : Accéder, Quitter, Voir le changelog.
//            launch.requires : la fonction présentée n'est pas encore ouverte à tous (TCG, Stages) :
//            l'écran attend qu'elle le soit, sans rien marquer vu. Une étape [titre, texte, only]
//            n'est montrée que si `only` est ouvert pour ce compte.
//   only : entrée montrée (journal, pop-up) seulement si la fonction est ouverte pour ce compte
//          (« stages » : rubrique ouverte ; « tcg » : jeu ouvert et compte étudiant).
//   onlyDetails : { tcg: [...] } lignes du détail montrées seulement à qui voit cette fonction.

export const CHANGELOG = [
  {
    version: '3.0.0',
    date: '2026-11-28',
    title: 'La rubrique Stages',
    only: 'stages', // au journal et à l'écran une fois la rubrique ouverte
    launch: {
      art: 'stages',
      requires: 'stages',
      title: 'Les stages d’ISIS, sur une carte',
      sub: 'Où sont allés les étudiants d’ISIS, ce qu’ils y ont fait, et qui contacter.',
      steps: [
        ['La carte des stages', 'Région, département puis ville : chaque structure qui a accueilli un étudiant d’ISIS, avec les missions. « Comme moi » garde les stages de ton année.'],
        ['Les contacts', 'Sur la fiche d’une structure : les étudiants passés là, leurs sujets, les maîtres de stage et les RH, avec leur adresse.'],
        ['Ta tuile Stages', 'Sur le tableau de bord : où sont allés les étudiants de ton année, et les structures qui en accueillent le plus.'],
      ],
      privacy: 'Réservé aux comptes de l’université connectés. Les adresses se lisent fiche par fiche, et chaque fiche ouverte est notée 90 jours (écran Transparence).',
      go: { label: 'Voir les stages', to: 'stages' },
    },
    short: [
      'Stages : tous les stages des étudiants d’ISIS sur une carte de France, avec les missions et les contacts.',
      'En-tête : deux onglets, Hub et Stages.',
    ],
    details: [
      'Stages : un nouvel onglet en haut de l’écran. La carte de France montre où sont allés les étudiants d’ISIS : choisis une région, un département puis une ville. En liste ou sur la carte, cherche une structure, une ville, une mission ou une personne, et filtre par niveau, année, promo, secteur, type de structure, durée, stages gratifiés ou avec un contact.',
      'Stages : la fiche d’une structure liste les étudiants passés là et leurs sujets, les maîtres de stage et les contacts RH avec leur adresse (copie ou écris en un geste), le site et le standard. La fiche d’un stage donne les dates, la durée, les missions et l’encadrement.',
      'Stages : la tuile du tableau de bord montre où sont allés les étudiants de ton année, et « Comme moi » filtre la carte sur ton niveau.',
      'Confidentialité : la rubrique demande d’être connecté avec ton compte de l’université. La recherche ne contient aucune adresse : celles d’une structure ne se lisent qu’en ouvrant sa fiche, et chaque fiche ouverte est notée avec ton identifiant pendant 90 jours, pour repérer une aspiration en masse. Pas d’export, 12 structures par page. L’écran Transparence le dit.',
    ],
    onlyDetails: {
      tcg: [
        'TCG : le jeu a son propre lien dans l’en-tête, à droite, à côté de ton compte. On revient au Hub par l’onglet Hub.',
        'TCG : passée la date des propositions d’une vague, l’atelier se ferme (plus de formulaire, seulement le suivi de tes cartes) jusqu’à la vague suivante.',
        'TCG : seules des adresses étudiantes peuvent être indiquées sur une photo.',
      ],
    },
  },
  {
    version: '2.4.4',
    date: '2026-11-27',
    title: 'TCG : le podium du jour compte davantage',
    quiet: true, // au journal seulement, sans pop-up « Nouveautés »
    short: ['Récompenses de lancement : le booster de participation passe à 2 cartes ; les podiums du jour comptent davantage.'],
    details: [
      'Récompenses de lancement : chaque participant (une carte validée ou une série du jury) reçoit un booster bonus de 2 cartes au lieu de 4. Les boosters des podiums du jour ne changent pas (1er → 5 cartes, 2e → 4, 3e → 3, du 4e au 13e → 1) : sur les soirs du jury, ils pèsent désormais autant que la participation. Les raretés sortent au même rythme : le jeu compte toujours les cartes bonus d’avance.',
    ],
  },
  {
    version: '2.4.3',
    date: '2026-11-26',
    title: 'TCG : un podium du jour pour les boosters bonus',
    quiet: true, // au journal seulement, sans pop-up « Nouveautés »
    short: [
      'Meilleurs créateurs : pendant le jury, un podium du jour à côté du classement global.',
      'Boosters bonus du soir : c’est le podium du jour qui compte, chaque journée repart de zéro.',
    ],
    details: [
      'Meilleurs créateurs : pendant le jury de lancement, choisis « Aujourd’hui » ou « Depuis le début ». Le podium du jour classe les points gagnés depuis minuit : tes cartes validées dans la journée, et celles qui montent au jury ce jour-là.',
      'Récompenses de lancement : chaque soir de jury, à minuit, c’est le podium du jour qui donne les boosters bonus (1er → 5 cartes, 2e → 4, 3e → 3, du 4e au 13e → 1, ex æquo compris). L’avance de la veille ne compte pas : chaque soir, tout le monde peut gagner. Tes 3 meilleurs soirs comptent toujours, et les soirs déjà passés sont recomptés de la même façon.',
    ],
  },
  {
    version: '2.4.2',
    date: '2026-11-26',
    title: 'TCG : la place de tes cartes au jury compte au classement',
    quiet: true, // au journal seulement, sans pop-up « Nouveautés »
    short: [
      'Meilleurs créateurs : avant l’impression, une carte compte déjà selon sa place au jury.',
      'Ex æquo : même nombre de points, même place, sur la même marche du podium.',
    ],
    details: [
      'Meilleurs créateurs : une carte validée compte désormais, avant l’impression, comme si la vague s’imprimait maintenant : la rareté que le jury lui donne (une carte que la promo adore rapporte autant qu’une Légendaire ou une Unique). Ça commence dès ses 2 premiers classements au jury ; d’ici là, ou si elle n’entre pas dans la vague, elle rapporte un peu. Une fois imprimée, elle garde ces points : l’impression ne change pas le classement.',
      'Meilleurs créateurs : une carte commune rapporte un peu moins qu’avant, et une carte commune ou pas retenue que le jury place tout en bas (son dernier quart) coûte un peu. Beaucoup de cartes sans soin ne suffisent plus pour le podium : la qualité compte bien plus que le nombre.',
      'Ex æquo : à égalité de points, même place. Deux premiers ex æquo partagent la première marche et le suivant est 3e ; trois ex æquo partagent la même marche. Les soirs du jury de lancement, des ex æquo reçoivent le même booster bonus.',
      'Récompenses de lancement : le classement de chaque soir, à minuit, est recompté avec ces règles et les votes faits avant minuit.',
    ],
  },
  {
    version: '2.4.0',
    date: '2026-11-26',
    title: 'Le mode sombre, la copie cachée et le détail des évaluations',
    launch: {
      art: 'theme',
      title: 'Le mode sombre est là',
      sub: 'Et pour tes mails la copie cachée, pour tes notes le détail des évaluations.',
      steps: [
        ['Le mode sombre', 'Menu du compte → Thème : Auto (comme ton téléphone), Clair ou Sombre.'],
        ['Cci et listes d’adresses', 'Écris en copie cachée, et colle d’un coup une liste « Nom <adresse>, … » : chaque adresse devient un destinataire.'],
        ['Le détail des évaluations', 'Dans Notes, ajoute une évaluation sans note (ex. Oral 0,3 · Écrit 0,4) dès que le prof te la donne.'],
      ],
      privacy: 'Le thème est gardé sur cet appareil : rien n’est envoyé.',
      go: { label: 'Passer en sombre', to: 'dark' },
    },
    short: [
      'Mode sombre : menu du compte → Thème (Auto, Clair ou Sombre).',
      'Mails : copie cachée (Cci), et une liste d’adresses collée devient des destinataires.',
      'Notes : ajoute une évaluation et son coefficient sans note, en attendant la note.',
    ],
    details: [
      'Mode sombre : dans le menu du compte, choisis Auto (le Hub suit ton téléphone ou ton ordinateur, dès l’ouverture), Clair ou Sombre. Le choix est gardé sur cet appareil.',
      'Mails : bouton « Cci » à côté de « Cc » pour écrire en copie cachée ; les autres destinataires ne voient pas ces adresses. Dans « Envoyés », le message garde la liste des Cci.',
      'Mails : colle une liste copiée d’Outlook, de BlueMind, d’un tableur ou d’un mail (« Baudry SOUVIGNET <baudry…>, Léa… », une colonne d’adresses…) dans « À », « Cc » ou « Cci » : chaque adresse devient un destinataire, d’un coup.',
      'Mails : un message envoyé seulement en Cc ou en Cci part avec toi en destinataire principal, comme « destinataires non divulgués ».',
      'Notes : ajoute une évaluation sans note (ex. Oral ×0,3, Écrit ×0,4, TP ×0,3) dès que le prof en donne le détail ; elle compte pour « la note à viser », et tu y mets la note plus tard. Le coefficient accepte les décimales.',
      'Notes : si une évaluation prévue disparaît de ta maquette, la note que tu y avais mise reste, en note personnelle de la même matière.',
    ],
  },
  {
    version: '2.3.0',
    date: '2026-11-26',
    title: 'TCG : deux boosters par jour, les répliques et les récompenses de lancement',
    quiet: true, // au journal seulement, sans pop-up « Nouveautés »
    short: [
      'TCG : deux boosters de 4 cartes par jour, le second 3 h après le premier.',
      'Répliques : une carte dont tous les exemplaires numérotés sont tirés sort encore, en version mate ; elle complète ta collection sans s’échanger.',
      'Récompenses de lancement : chaque soir du jury, ta place au classement des créateurs te rapporte des boosters bonus.',
    ],
    details: [
      'Boosters : deux par jour, de 4 cartes. Le premier quand tu veux, le second 3 h après ; le cycle suivant reprend 24 h après ton premier booster. Un second booster pas ouvert à temps ne se garde pas.',
      'Répliques : quand tous les exemplaires numérotés d’une carte sont tirés, elle sort encore en « Réplique », aussi rarement que la vraie. Même carte, même photo, mais finition mate, liseré pointillé et pas de numéro : tu la reconnais tout de suite, et tu vois au premier coup d’œil que ce n’est pas un exemplaire numéroté. Une réplique compte pour compléter ta collection mais ne s’échange pas : il n’entre ni dans les échanges, ni dans les doubles, ni dans les propositions d’échange des autres.',
      'Récompenses de lancement : chaque soir du jury de lancement où la promo a voté, à minuit, le classement des créateurs compte. 1er : un booster bonus de 5 cartes ; 2e : 4 cartes ; 3e : 3 cartes ; du 4e au 13e : 1 carte. Et chaque participant (une carte validée ou une série du jury) reçoit un booster bonus de 4 cartes. Tes 3 meilleurs soirs comptent. Tu vois sur la page d’attente ce que tu as gagné à ce jour ; les boosters bonus s’ouvrent le jour du lancement (24 h), en plus de tes deux boosters du jour, au même taux de tirage.',
      'Cartes numérotées : le jour du lancement, leur rythme compte d’avance tous les joueurs et tous les boosters bonus. Ouvrir son booster le premier ne donne pas plus de chances d’avoir une carte rare.',
      'Meilleurs créateurs : les points ne font plus que monter. Une carte bloquée ou retirée ne compte plus, ni en plus ni en moins. Seule exception : une carte validée que le jury de la vague a placée tout en bas (son dernier quart) et qui n’a pas été retenue coûte un peu ; au jury suivant, elle a une nouvelle chance.',
      'Créer : retirer une carte bloquée par l’équipe te rend une proposition le jour même, pour en envoyer une autre version. Retirer une carte en attente ne rend toujours rien.',
      'Ouverture des boosters : le booster tombe du ciel et s’ouvre dans un faisceau de lumière, et les cartes en sortent une à une. Chaque carte rare se charge palier par palier (Rare, Épique, Légendaire, Unique) avant de se retourner ; une Légendaire ou une Unique tourne sur elle-même. Tous les dos de cartes sont les mêmes, et tous les boosters se ressemblent : rien ne trahit la rareté avant de toucher la carte. Son facultatif, coupé par défaut.',
    ],
  },
  {
    version: '2.2.2',
    date: '2026-11-25',
    title: 'TCG : suis l’avancement de tes cartes, sans rien dévoiler',
    quiet: true, // au journal seulement, sans pop-up « Nouveautés »
    short: ['TCG : « Mes cartes envoyées » revient, avec le titre et l’avancement de chaque carte, et un bouton pour relancer les personnes sur la photo.'],
    details: [
      'Créer une carte : « Mes cartes envoyées » montre le titre et l’avancement de chaque carte (validation, accords, jury, en jeu), avec sa photo floutée. Ni la description, ni la rareté, ni le nombre de tirages : la surprise reste entière.',
      'Accords en attente : tu vois combien de personnes ont accepté (sans savoir qui) et « Relancer » prépare un message pour elles, avec le lien vers « Mes apparitions » (partage du téléphone, ou copié sur ordinateur).',
      'Une carte bloquée garde son motif, le message de l’équipe et « Retirer ». Une carte en attente de validation peut aussi être retirée.',
    ],
  },
  {
    version: '2.2.1',
    date: '2026-11-25',
    title: 'TCG : une carte envoyée ne se revoit plus',
    quiet: true, // au journal seulement, sans pop-up « Nouveautés »
    short: ['TCG : une carte envoyée ne s’affiche plus ; seules les cartes bloquées reviennent, avec le motif.'],
    details: [
      'Créer une carte : une fois envoyée, ta carte ne s’affiche plus (ni en attente, ni validée, ni au jury, ni imprimée) : son sort reste une surprise jusqu’au jeu. Sa rareté se découvre en la tirant, dans ta collection.',
      'Si la modération bloque une de tes cartes, elle réapparaît dans « Cartes bloquées » avec le motif et le message de l’équipe, pour que tu puisses la corriger ou la retirer.',
      'Meilleurs créateurs : une carte bloquée par la modération compte toujours, même si tu la retires ensuite (le jeu garde seulement leur nombre). Une carte refusée par une personne sur la photo ne compte toujours pas.',
    ],
  },
  {
    version: '2.2.0',
    date: '2026-11-25',
    title: 'Le podium des créateurs, et un jury qui ne se rejoue pas',
    launch: {
      art: 'podium',
      requires: 'tcg', // écran montré seulement quand le TCG est ouvert aux étudiants
      title: 'Le podium des créateurs',
      sub: 'Les meilleurs créateurs de cartes de la promo, sur un podium. Et ta place juste en dessous.',
      steps: [
        ['Le podium', 'Les 3 meilleurs créateurs, sur l’accueil du jeu. Hors du podium, ta place s’affiche en dessous.'],
        ['La qualité avant le nombre', 'Une carte que la promo adore compte bien plus que beaucoup de cartes communes. « Ce qui fait gagner ou perdre des points » explique tout.'],
        ['Une série de jury par jour', 'Une fois envoyée, ta série est close : ni revue, ni refaite. La suivante arrive le lendemain.'],
      ],
      privacy: 'Le classement est calculé par le serveur : seules les places s’affichent, jamais les scores ni la rareté des cartes.',
      go: { label: 'Voir le classement', to: 'tcg' },
    },
    short: [
      'TCG : le podium des meilleurs créateurs, et ta place juste en dessous.',
      'Jury : une série envoyée est close (ni revue, ni refaite) ; la suivante arrive le lendemain.',
      'Propositions : le quota du jour vaut pour ton compte, sur tous tes appareils.',
    ],
    details: [
      'Meilleurs créateurs : les 3 premiers sur un podium (accueil du jeu, et page d’attente avant le lancement), puis ta place si tu n’y es pas.',
      'Ce qui compte : chaque carte en jeu, d’autant plus qu’elle est rare (c’est le jury de la promo qui décide de la rareté) ; un peu, chaque carte validée. Ce qui fait perdre : une carte bloquée par la modération, et davantage une carte retirée après signalements. Les propositions en attente et les cartes refusées par une personne sur la photo ne comptent pas.',
      'Les scores sont calculés par le serveur et ne sont jamais affichés : seules les places le sont, pour ne rien dévoiler de la rareté de tes cartes. Les joueurs dont les propositions sont suspendues ne sont pas classés.',
      'Jury « Tu préfères ? » : une fois ta série envoyée, ses cartes et ton classement ne se revoient plus, et elle ne se refait pas. La suivante ouvre le lendemain, dès minuit (un jour de jury manqué se rattrape).',
      'Propositions : le nombre par jour est compté par compte, tous appareils confondus. Retirer une proposition ou quitter le jeu puis revenir ne rend plus de proposition le même jour ; tout revient le lendemain.',
    ],
  },
  {
    version: '2.1.1',
    date: '2026-11-25',
    title: 'Les cartes se cachent des captures d’écran',
    quiet: true, // au journal seulement, sans pop-up « Nouveautés » (choix de l'équipe)
    short: [
      'TCG : les cartes se floutent dès que tu quittes le jeu et pendant les captures repérables sur ordinateur.',
      'Plus d’« Enregistrer l’image » sur les cartes, et elles ne s’impriment pas.',
    ],
    details: [
      'Cartes floutées (photo, titre et texte) dès que la page du jeu n’est plus au premier plan : autre appli, aperçu des applis ouvertes, volet d’Android et sa tuile « Capture d’écran », outil Capture de Windows. Au retour, elles redeviennent nettes un instant après.',
      'Sur ordinateur, les cartes se floutent dès que les touches d’un raccourci de capture sont enfoncées (⌘ ⇧ 3/4/5 sur Mac, ⊞ ⇧ S sur Windows, Ctrl ⇧ sur ChromeOS), donc avant la capture, et après la touche Impr. écran ; elles reviennent au premier mouvement de la souris.',
      'Partout où une carte s’affiche : collection, jury « Tu préfères ? », « Mes apparitions », ouverture d’un booster et son récapitulatif. Ni « Enregistrer l’image » (appui long, clic droit, glisser-déposer), ni impression.',
      'Ce qu’aucun site ne peut faire : empêcher la capture d’écran d’un téléphone avec ses boutons, dans le navigateur comme dans l’appli installée. Rien n’est envoyé au serveur quand une capture est repérée.',
      'Le jeu compte, jour par jour, combien de joueurs viennent, votent, ouvrent un booster ou échangent : des nombres seulement, rien qui dise qui.',
    ],
  },
  {
    version: '2.1.0',
    date: '2026-11-24',
    title: 'Le jury en « Tu préfères ? », et le Hub voit plus loin',
    launch: {
      art: 'duel',
      requires: 'tcg', // écran montré seulement quand le TCG est ouvert aux étudiants
      title: 'Le jury passe en « Tu préfères ? »',
      sub: 'Deux cartes, un choix. Quelques duels par jour, et c’est la promo qui décide.',
      steps: [
        ['Tu préfères ?', 'Deux cartes de la promo : touche celle que tu veux le plus voir dans le jeu. 5 à 7 duels par jour suffisent.'],
        ['La surprise jusqu’au bout', 'Une fois ta carte validée, elle est dans le jeu : même toi, tu découvres sa rareté en la tirant.'],
        ['Et dans le Hub', 'L’emploi du temps du lendemain dès 19 h, les mails à jour toutes les 4 minutes, les PDF qui s’ouvrent sur Android.'],
      ],
      privacy: 'Tes choix de duels restent sur ton appareil jusqu’à la fin de la série : le jeu ne garde que ton classement des cartes, comme avant.',
      go: { label: 'Ouvrir le TCG', to: 'tcg' },
    },
    short: [
      'TCG : le jury se joue en « Tu préfères ? », 5 à 7 duels par jour ; nouvelle page « Crée ta carte ».',
      'Emploi du temps : dès 19 h, il s’ouvre sur le lendemain.',
      'Mails à jour toutes les 4 minutes, PDF ouvrables sur Android, menus du CROUS gardés une semaine.',
    ],
    details: [
      'Jury du TCG : deux cartes du jeu à la fois, tu touches celle que tu préfères (ou ← / →). Une série porte sur 5 cartes et compte 7 duels au plus : ils suffisent à connaître ton classement complet de ces 5 cartes, enregistré comme avant. Une série par jour de jury (un jour manqué se rattrape), « Choix précédent » pour revenir en arrière, et une série commencée reprend où tu l’as laissée.',
      'Créer une carte : nouvelle page en étapes (photo, texte, catégorie, personnes) avec l’aperçu de la carte en direct.',
      'Une carte validée est dans le jeu : son auteur ne peut plus la retirer, et découvre sa rareté comme tout le monde, en la tirant.',
      'Jusqu’à 10 personnes sur une photo (au lieu de 5).',
      'Bascule Hub / TCG : sur téléphone, la mention « bientôt » ne déborde plus de l’en-tête.',
      'Emploi du temps : à partir de 19 h, la tuile s’ouvre sur le lendemain (le vendredi soir, sur le lundi), et y passe toute seule à 19 h si tu n’as pas changé de jour. Le bouton dit où il mène : « Aujourd’hui », « Demain » ou « Lundi ».',
      'Mails : la boîte se met à jour toute seule toutes les 4 minutes quand la page est ouverte, sans revenir en haut de la liste ; au retour sur le Hub, tout de suite si la dernière mise à jour a plus de 4 minutes.',
      'Mails envoyés à beaucoup de monde : les 3 premiers destinataires, puis « et N autres » à déplier.',
      'PDF (mails et Moodle) : sur les navigateurs qui ne savent pas afficher un PDF dans une page (Android, ou Chrome réglé sur « Télécharger les PDF »), plus d’écran gris : un bouton l’ouvre avec le lecteur du téléphone.',
      'Menus du CROUS : ceux de la semaine passée restent consultables (le serveur garde une semaine de menus publics).',
      'Notes : tu peux changer le coefficient d’une évaluation prévue (par exemple le contrôle continu). Il ne vaut que pour toi ; la maquette ne change pas.',
    ],
  },
  {
    version: '2.0.6',
    date: '2026-11-24',
    title: 'TCG : recadrage des photos et formulaire plus fiable',
    quiet: true, // au journal seulement, sans pop-up « Nouveautés »
    short: ['TCG : recadre ta photo comme dans une app photo ; le formulaire ne se vide plus en cours de saisie.'],
    details: [
      'Créer une carte : toute la photo est visible par défaut (bords flous si besoin). Grand cadre avec grille : fais glisser la photo, zoome avec deux doigts, la molette ou le curseur, ou choisis « Toute la photo » / « Remplir le cadre ».',
      'Correctif : avant le lancement, le formulaire « Propose ta carte » pouvait se vider pendant la saisie. Ce que tu as commencé (photo, texte, personnes) reste maintenant jusqu’à l’envoi.',
    ],
  },
  {
    version: '2.0.5',
    date: '2026-11-24',
    title: 'TCG : jamais deux mails d’accord en 24 h',
    quiet: true, // au journal seulement, sans pop-up « Nouveautés »
    short: ['TCG : tu ne reçois jamais deux mails d’accord en moins de 24 heures.'],
    details: [
      'Si tu apparais sur plusieurs cartes, le mail « tu apparais sur une carte » ne t’arrive pas plus d’une fois par 24 heures : les cartes suivantes attendent le lendemain.',
      '« Refuser » dans « Mes apparitions » retire la carte tout de suite : elle n’entrera pas dans le jeu.',
    ],
  },
  {
    version: '2.0.4',
    date: '2026-11-24',
    title: 'TCG : la carte entière avant de donner ton accord',
    quiet: true, // au journal seulement, sans pop-up « Nouveautés »
    short: ['TCG : « Mes apparitions » montre le titre, la photo et la description de chaque carte.'],
    details: [
      '« Mes apparitions » : la description de la carte est affichée en entier à côté du titre et de la catégorie, et « Voir en grand » ouvre la carte avec sa photo en grand, pour décider en connaissance de cause.',
    ],
  },
  {
    version: '2.0.3',
    date: '2026-11-24',
    title: 'TCG : indique qui est sur ta photo',
    quiet: true, // au journal seulement, sans pop-up « Nouveautés »
    short: ['TCG : en créant une carte, indique qui est sur la photo, avec les suggestions de ta messagerie.'],
    details: [
      'Créer une carte : « Qui est sur la photo ? », avec la même liste que le champ « Cc » d’un mail (personnes récentes d’abord, puis l’annuaire, étudiants en premier). 5 personnes au plus.',
      'L’équipe vérifie cette liste à la validation, puis demande leur accord à ces personnes : rien ne part avant.',
      'Mails : nouvelle option « Ne garder que le dernier mail d’ISIS Hub » (Règles et étiquettes), cochée d’office : seul le plus récent mail « tu apparais sur une carte » reste dans ta boîte, les plus anciens vont à la corbeille.',
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
