# ISIS Hub

Emploi du temps ADE (FIE1 à FIE5, FIA3 à FIA5), mails et cours Moodle d'ISIS sur une seule page, sur ordinateur comme sur
téléphone. Tout est lu **en direct sur les portails de l'université**, et le serveur ne peut rien lire
de ce qui transite par lui. Le serveur conserve seulement : les retours que les étudiants
choisissent d'envoyer depuis « Une idée ? » (seule donnée qui peut être reliée à quelqu'un, et
seulement sans « Envoyer anonymement »), une sauvegarde chiffrée et anonyme de ce qu'ils créent dans
le Hub, et des compteurs de fréquentation anonymes.

```bash
DOMAIN=hub.exemple.fr docker compose up -d --build
```

## Comment c'est sécurisé

Un navigateur interdit à une page de lire un autre site, et aucun portail de l'université ne
l'autorise. La page embarque donc son propre client HTTPS : **curl + mbedTLS compilés en
WebAssembly** (`web/vendor/libcurl`). Le chiffrement TLS est négocié *dans la page*, directement
avec le certificat de `auth.univ-jfc.fr`, `adecampus`, `mail` ou `moodle`. Les octets, déjà chiffrés,
passent par un unique WebSocket vers le relais (protocole **Wisp**), qui les recopie en TCP vers le
portail.

```
navigateur ──TLS de bout en bout (clés dans la page)──────────────────────▶ portail de l'université
     └── WebSocket ──▶ relais ISIS Hub ──TCP──▶                          (le relais ne voit que du chiffré)
```

| Le relais voit | Le relais ne voit pas | Le relais ne peut pas |
| --- | --- | --- |
| l'adresse IP du visiteur, le portail contacté, l'heure, le volume | mot de passe, cookies, mails, cours, emploi du temps | se faire passer pour un portail (la page vérifie le certificat), joindre autre chose que les 4 portails (liste compilée dans le binaire), garder une trace (aucun journal) |

Les autres verrous :

- **Politique de sécurité stricte** (en-tête HTTP) : la page ne charge que ses propres fichiers, ne
  se connecte qu'à elle-même, n'exécute ni code en ligne ni `eval`, et ne peut pas être affichée dans
  un cadre. Trusted Types activé.
- **Double liste de destinations** : le client de la page refuse tout hôte hors des 4 portails ; le
  relais aussi, indépendamment, et seulement vers des adresses IP publiques sur le port 443.
- **Cookies cloisonnés** : chacun ne repart que vers le portail qui l'a posé ; les en-têtes propres à
  un portail (clé d'API de la messagerie) ne suivent pas une redirection.
- **Session chiffrée sur l'appareil** : les cookies des portails sont gardés chiffrés (AES-GCM 256),
  avec une clé que le navigateur crée **non exportable** : aucun script ne peut en lire la valeur.
  Dans l'onglet par défaut, sur l'appareil si « Rester connecté » est coché. Le mot de passe n'est
  jamais stocké : le champ est vidé dès l'envoi.
- **Mails inertes** : le HTML d'un mail est reconstruit balise par balise à partir d'une liste
  fermée. Scripts, styles, formulaires, cadres et images distantes (qui préviendraient l'expéditeur)
  ne sont jamais recopiés.
- **Cache chiffré** : cours Moodle, correspondances et notes sont mis en cache par matière (cours
  suivis 6 h, correspondance 7 jours, notes 30 min) pour ne pas solliciter Moodle à chaque clic. Le
  cache est chiffré avec la même clé que la session et effacé à la déconnexion.
- **Presque rien côté serveur** : ni compte, ni base de données, ni journal. Seuls les retours
  « Une idée ? » sont gardés (fichier `feedback.json` du volume `/data`), sans adresse IP ; l'auteur
  est celui que la page déclare (non vérifié) ou anonyme. « Mes propositions » marche sans compte :
  la page garde un jeton secret, le serveur n'en conserve que l'empreinte. Le conteneur tourne en lecture
  seule, sans privilège, dans une image `scratch` qui ne contient que le binaire (8 Mo).

Le prix de cette architecture : le mot de passe se tape dans ISIS Hub et non sur la page du CAS. Il
ne part que dans la requête chiffrée adressée à `auth.univ-jfc.fr`, mais il faut faire confiance au
code servi. D'où les moyens de vérification ci-dessous.

## Vérifier par soi-même

- **Dans l'appli**, écran *Transparence* : connexions et volumes en direct, ce qui est gardé, et
  quatre contrôles exécutés pour de vrai dans le navigateur :
  1. aucune ressource ne vient d'une autre origine ;
  2. `eval` et un script en ligne sont bloqués ;
  3. le relais refuse `example.com` ;
  4. un relais malhonnête est simulé (le trafic pour `auth.univ-jfc.fr` est envoyé vers un autre
     serveur) : la page refuse la connexion, faute du bon certificat ;

  L'écran recalcule aussi l'empreinte SHA-256 de chaque fichier reçu et la compare à
  `/manifest.json`.
- **Le site sert-il ce code ?** `go run ./cmd/isis-hub verify https://hub.exemple.fr/` télécharge
  chaque fichier en ligne et le compare à ce dépôt.
- **Le relais ne voit que du chiffré** : outils de développement, onglet Réseau, filtre WS. Les
  messages Wisp transportent des enregistrements TLS (`17 03 03 …`).

## Ce que fait l'appli

- **Connexion** au CAS de l'université, puis **choix de la classe** (FIE1 à FIE5, FIA3 à FIA5) et de
  ses options à la première visite, modifiable depuis le compte. Sans connexion, l'emploi du temps
  reste disponible.
- **Emploi du temps filtré par groupe, langue et parcours**, avec exactement les règles du projet
  « Calendriers ISIS » (vérifié séance par séance et octet par octet, voir plus bas) :

  | Classe | Choix | Règle |
  | --- | --- | --- |
  | FIE1 | groupe 1 (chinois) ou 2 (espagnol) | séance sans groupe ou du groupe, sans langue ou de la langue |
  | FIE2, FIE3 | groupe 1/2 et langue | idem |
  | FIE4 | parcours (IA, Développement, Management) et groupe | codes de la maquette FIE4 du parcours, événements communs `ISIS-FIE4-SEMESTRE7`, puis groupe |
  | FIE5 | parcours | codes de la maquette FIE5 du parcours, événements sans code conservés |
  | FIA3–5 | aucun | tout est conservé |

  L'abonnement d'agenda des classes à options pointe vers `/calendar/…ics` (mêmes URL que l'ancien
  projet : `fie1/1.ics`, `fie2/1/chinois.ics`, `fie4/ia/1.ics`, `fie5/ia.ics`) : le serveur lit
  l'export **public** d'ADE (aucune donnée personnelle), au plus toutes les 15 minutes, et garde la
  dernière version si ADE ne répond pas.
- **Emploi du temps** : vue jour heure par heure (la salle en premier), vue semaine, plein écran
  (toujours en vue semaine), navigation sans limite, séance en cours et ligne « maintenant », semaines
  sans cours, glisser sur téléphone, abonnement iCal (Apple, Google, Outlook). Les flèches avancent
  d'autant de jours qu'il y en a d'affichés (1, 2 ou 3). Toute séance peut être **marquée
  « Évaluation »** depuis sa fiche : repère personnel, gardé sur l'appareil seulement.
- **Resto U' de Castres** : bloc 12 h 30 – 13 h 30 chaque jour de cours ; un clic affiche le menu du
  midi (ou « Menu non publié »). Le serveur lit le menu **public** (API Croustillant, à défaut la page
  du CROUS Toulouse) au plus toutes les 15 minutes (`/api/crous`, sans cache) : la page ne contacte
  aucun tiers, et une page restée ouverte relit le menu toutes les 15 minutes.
- **Mails** : boîte de réception chargée au fil du défilement, lus et non lus, recherche (expéditeur,
  objet, aperçu), 5 mails sur téléphone puis « Afficher plus », état « mis à jour il y a… » cliquable.
  Un clic ouvre le mail en plein écran **et le marque comme lu dans la messagerie** (`\Seen`).
- **Corbeille** : « Supprimer » déplace le mail dans la corbeille de la messagerie ; le filtre
  *Corbeille* permet de le restaurer ou de le **supprimer définitivement** (confirmation demandée).
- **Étiquettes et règles automatiques** (bouton réglages de la tuile) : « si l'expéditeur / l'objet
  contient… alors corbeille / étiquette ». Étiquettes, filtres en pastilles (*Tous*, étiquettes,
  *Corbeille*). Tout est gardé **chiffré sur l'appareil** et appliqué par la page ; effacé par
  « Se déconnecter ».
- **Pièces jointes vues et téléchargées dans le Hub** : images et PDF affichés seulement si leurs
  premiers octets le confirment (jamais HTML ni SVG), tout le reste téléchargé sous un type neutre.
- **Écrire, répondre, répondre à tous, transférer**, avec pièces jointes (15 Mo au total) et
  l'**annuaire partagé** de la messagerie (autocomplétion et fiche Annuaire). Le message part par la
  messagerie de l'étudiant : pièces déposées, message créé dans la boîte d'envoi, expédition demandée
  puis vérifiée (le message doit avoir quitté la boîte d'envoi).
- **Fiche cours** au clic sur une séance : salle, horaire, enseignant (bouton « Écrire »), séances de
  la semaine et des 8 suivantes, examens d'après ADE, notes personnelles sur le cours (chiffrées, sauvegardées).
- **Notes** (tuile et vue « Mes notes », maquette v7) : l'étudiant saisit ses notes dans la maquette
  de sa classe (UE, matières, coefficients, évaluations prévues, publiés dans l'administration).
  Moyennes par matière, UE, semestre et année, rattrapages repérés (UE sous 10, matière sous 7,
  seuils réglables), « À surveiller » avec la note nécessaire, **mode simulation** (rien n'est
  enregistré) et **Viser une moyenne**. La fiche d'un cours montre les notes de la matière liée
  par son code ADE. **Examens de l'emploi du temps** : pour une matière dont le code ADE est saisi,
  les séances marquées examen (par ADE ou par l'étudiant) datent les évaluations « Examen » sans
  date et, en plus, apparaissent comme propositions de contrôles (« Examen · EDT »). **Semestre en
  cours** choisi par chaque étudiant (« Terminer le S7 », réversible), sauvegardé pour tous ses
  appareils : plus de dates de semestre.
- **Sauvegarde anonyme et chiffrée** des données créées dans le Hub (notes, séances marquées
  examen, étiquettes et règles de mails, notes de cours, « déjà vu ») : retrouvées sur tous les appareils. À la connexion, la
  page tire du mot de passe (PBKDF2-SHA-256, 600 000 tours) un identifiant, une preuve et une clé
  AES-GCM ; le serveur (`/api/vault`) ne reçoit que l'identifiant, l'empreinte de la preuve et des
  octets chiffrés : il ne peut ni lire les données ni savoir à qui elles sont. Transparence détaille
  ce qui n'est pas gardé, ce qui l'est anonymement et ce qui est relié à quelqu'un, et permet de
  tout effacer.
- **Messagerie plein écran** (maquette v7) : sur ordinateur, liste à gauche et lecture à droite
  (↑ ↓ pour passer d'un mail à l'autre) ; filtres, étiquettes, Envoyés, Corbeille et actions y
  restent. Tous les pleins écrans se ferment par « ✕ Fermer » en haut à droite.
- **Écrire** : pièces jointes par glisser-déposer, destinataires récents (boîte « Envoyés »)
  proposés en premier.
- **Retours** (« Une idée ? ») et page d'**administration** `/admin` (voir plus bas).
- **Moodle** : cours suivis, recherche (`/`), et le bon cours mis en avant selon l'heure (en cours,
  sinon le prochain).
- **Lien séance ↔ Moodle** par le code : `TD-A4-1-ISI-2 Aide à la décision` → cours
  `FIA4-1-ISI-2`. Cherché parmi les cours suivis, puis dans tout Moodle ; à défaut, même intitulé
  dans la même classe (pastille « ≈ »).
- **Raccourcis** publiés par l'administrateur (ENT par défaut).
- **Mises à jour sans manipulation** : la page compare régulièrement l'empreinte de `/manifest.json`
  à celle du code chargé. Nouvelle version : rechargement automatique au retour sur l'onglet (ou
  l'application installée) si rien n'est en cours, sinon un bandeau « Recharger ». Tout est servi en
  `no-cache` : ne pas activer « Cache Assets » dans Nginx Proxy Manager.
- **Installer l'application** : tutoriel iPhone / Android / ordinateur proposé une fois après la
  première connexion (et depuis le menu du compte).
- **Une seule fois par étudiant** : visite guidée et tutoriel d'installation ne sont proposés
  qu'une fois, sur tous ses appareils. Le « déjà vu » est une rubrique de la sauvegarde anonyme et
  chiffrée (rien de lisible côté serveur) ; l'appareil l'oublie à la déconnexion.
- **Quoi de neuf ?** : après une mise à jour, une pop-up courte (les points principaux), une fois
  par étudiant et par version ; « Voir tout le journal » ouvre le **journal des versions** détaillé,
  aussi dans le menu du compte. Le contenu est dans `web/js/core/changelog.js` : ajouter une entrée
  en tête à chaque version (`short` : 1 à 3 points pour la pop-up, `details` : tout).
- **Fréquentation anonyme, une fois par compte et par jour** (onglet *Fréquentation* de
  l'administration : courbe par jour, période 7 / 30 / 90 jours ou tout, mesure, filtre par classe,
  jours de la semaine, répartitions par classe, appareil et application / navigateur). La page
  envoie « première ouverture du jour sur cet appareil : oui / non », la classe (sans groupe ni
  parcours), téléphone / tablette / ordinateur, application installée ou navigateur et, pour un
  étudiant connecté, un **jeton du jour** : HMAC du jour avec une clé tirée (HKDF) de sa sauvegarde
  chiffrée, que le serveur ne connaît pas. Même compte → même jeton toute la journée sur tous ses
  appareils, donc compté une fois ; d'un jour à l'autre, aucun lien ; impossible d'en déduire la
  personne ou sa sauvegarde. Le serveur ne garde que des compteurs par jour, jamais croisés entre
  eux (`stats.json`), et oublie les jetons au changement de jour. Ni identifiant ni adresse IP.
  Comptage par compte depuis le 18 novembre 2026 ; avant, seulement les appareils et ouvertures.
- **Plein écran** de l'emploi du temps : toujours en vue semaine, sans le choix Jours / Semaine.

### Administration

`/admin` (retours, répartition des emplois du temps, maquettes de notes, raccourcis, fréquentation) **n'existe que pour les identifiants
de `ADMIN_USERS`** (ex. `bsouvign`) : pour tous les autres, l'adresse renvoie à l'accueil. Pas de mot
de passe propre à ISIS Hub.

Comment l'identité est prouvée sans que le serveur voie la connexion : la page de l'administrateur,
déjà connectée au CAS, demande un ticket de service pour l'**ENT** (service enregistré auprès du CAS ;
ISIS Hub, lui, ne l'est pas) et ne suit pas la redirection. Le serveur reçoit ce ticket et le fait
valider **directement par `auth.univ-jfc.fr`** (`/cas/serviceValidate`) : c'est l'université qui
renvoie l'identifiant, la page ne peut pas le falsifier. Le ticket est à usage unique et l'ENT ne le
reçoit jamais. Seul celui qui ouvre `/admin` envoie un ticket ; le serveur ne garde rien d'un refus.
Session de 8 h (cookie HttpOnly, SameSite=Strict), 5 essais par quart d'heure, en-tête anti-CSRF.

**Répartition des emplois du temps** : dans l'onglet *Emplois du temps*, chaque classe se règle
sans toucher au code. Pour chaque classe :
- les ressources ADE ;
- le mode : toutes les séances, groupe (et langue), parcours et groupe, parcours ;
- pour les parcours : les codes de matières de la maquette, les alias de codes et le repère des
  événements communs.

**Maquettes de notes** : dans l'onglet *Notes*, chaque classe a un interrupteur **Système de notes** :
désactivé, les étudiants voient seulement un message d'attente (personnalisable, aperçu à côté) et la
maquette en cours de saisie reste privée (`/api/grades` ne la publie pas). Pour chaque semestre, les UE
se déplient une par une, puis leurs matières (coefficient, code ADE, évaluations prévues) ; une barre
signale les modifications non enregistrées. **JSON d'exemple** à télécharger ou à charger d'un clic.
Pour chaque classe et semestre, les UE, matières,
coefficients, codes ADE et évaluations prévues. **Import JSON** : une classe (`{ "semesters": [...] }`)
ou plusieurs (`{ "FIA4": {...}, "FIE5": {...} }`), dates en `AAAA-MM-JJ`, `JJ/MM/AAAA` ou « 14 janv. » ;
les identifiants manquants sont créés, aucune note d'étudiant n'est importée. **Export** pour
sauvegarder ou recopier une maquette.

La répartition est vérifiée avant d'être acceptée, puis appliquée aussitôt à l'emploi du temps des
étudiants et à leurs abonnements d'agenda. Elle est gardée dans le volume `/data` ; tant qu'elle n'a
pas été modifiée, c'est celle de `web/data/classes.json` qui s'applique.

## Mettre en ligne

### Avec un proxy inverse existant (production)

`./build` construit l'image pour **Linux x86 (amd64) et Linux ARM (arm64)** et l'envoie sur le
registre GitHub `ghcr.io/baudrysouvignet/isis-hub` ; arm64 est aussi l'image qui tourne sur un Mac
Apple Silicon. La compilation est croisée, sans émulation. Le script marche sur macOS et sur Linux ;
seul Docker est nécessaire (Go et Node, s'ils sont là, relancent les tests avant).

La première fois, se connecter au registre. Docker demande « Password » : coller un **jeton GitHub**
(github.com → Settings → Developer settings → Personal access tokens → Tokens (classic) → droits
`write:packages` et `read:packages`), pas le mot de passe GitHub ni un jeton Docker.

```bash
docker login ghcr.io -u baudrysouvignet
```

```bash
./build
```

Pour construire directement sur le VPS (ou sur le Mac), sans passer par le registre :

```bash
./build --local
```

Sur le serveur, copier `compose.prod.yaml` et `.env.example.prod` (renommé en `.env`, à remplir),
puis :

```bash
docker compose -f compose.prod.yaml pull && docker compose -f compose.prod.yaml up -d
```

Aucun port n'est publié : le conteneur `isis-hub` est sur le réseau externe `proxy-network`. Le proxy
doit envoyer le domaine vers `isis-hub:8080`, **laisser passer les WebSockets** (chemin `/wisp/`) et
ajouter `X-Forwarded-For`. Si le paquet GHCR est privé, faire aussi `docker login ghcr.io` sur le
serveur (ou rendre le paquet public dans GitHub).

### Seul, avec Caddy pour le HTTPS

```bash
cp .env.example .env    # puis mettre le domaine et ADMIN_USERS dans .env
```

```bash
docker compose up -d --build
```

### Après la mise en ligne

```bash
go run ./cmd/isis-hub verify https://hub.exemple.fr/
```

Variables : `PUBLIC_ORIGIN` (origine publique, seule page autorisée à utiliser le relais et l'API),
`ADMIN_USERS`, `VAULT_PEPPER` (secret du coffre anonyme, **obligatoire en production** : généré une
fois avec `openssl rand -base64 48`, jamais changé, jamais dans le dossier de données ; les
sauvegardes existantes sont converties à leur première utilisation), `VAULT_MAX_BYTES` (volume total
des sauvegardes, 2 Gio), `TRUST_PROXY=1` derrière un proxy, `MAX_CONNS_PER_IP` (96 : tout un campus
peut sortir par une adresse), `MAX_CONNS` (2000), `MAX_STREAMS` (16 connexions par WebSocket). `CAS_URL` ne sert qu'aux tests (faux CAS).

Toutes les connexions arrivent à l'université depuis l'adresse IP du serveur, et un formulaire de
mot de passe hors du domaine universitaire ressemble à de l'hameçonnage : **prévenir la DSI avant
d'ouvrir le site à d'autres étudiants.**

## Développer

```bash
go run ./cmd/isis-hub
```

Puis ouvrir http://localhost:8080. Les fichiers de `web/` sont intégrés au binaire : relancer après
une modification. Aucune étape de construction côté page (modules ES servis tels quels).

```bash
go test -race ./...
```

```bash
npm test
```

Les tests comparent les filtres à la sortie du projet de référence « Calendriers ISIS », enregistrée
dans `test/fixtures/calendars/expected.json` (séances) et `internal/calendar/testdata/reference.json`
(empreinte de chaque fichier .ics) sur ses propres instantanés ADE.

## Organisation

```
cmd/isis-hub/       le binaire : serveur, `manifest`, `verify`, `healthcheck`
internal/wisp/      relais aveugle (WebSocket RFC 6455 + Wisp v1, sans dépendance)
internal/site/      fichiers intégrés, en-têtes de sécurité, empreintes
internal/feedback/  retours « Une idée ? », raccourcis, répartition des classes, maquettes de notes,
                    sauvegarde anonyme (vault.go), fréquentation, administration (CAS)
internal/calendar/  calendriers filtrés par groupe, langue, parcours (abonnement des agendas)
internal/crous/     menu du midi du Resto U' de Castres (Croustillant, secours CROUS), relu toutes les 15 min
web/data/           classes.json : ressources ADE et règles de filtrage, lues par la page et le serveur
web/                la page (servie telle quelle)
  js/net/           moteur TLS, cookies et redirections, coffre de session chiffré
  js/portals/       CAS, ADE, Moodle, messagerie, correspondance des cours, nettoyage des mails
  js/ui/            écrans et tuiles
  assets/           styles (hub.css = maquette, intacte), police, icônes
  vendor/libcurl/   libcurl.js 0.7.5 (curl + mbedTLS en WebAssembly, LGPL-3.0)
deploy/Caddyfile    frontal HTTPS (compose.yaml)
build               construit et envoie l'image sur ghcr.io
compose.prod.yaml   production derrière un proxy inverse (réseau proxy-network)
test/               tests de la page (Node)
poc/                ancienne preuve de concept, pour mémoire
```

## Changer d'année

Dans `/admin`, onglet *Emplois du temps* : projet ADE de l'année (10 pour 2026-2027), période des
abonnements d'agenda, ressources de chaque classe et codes de matières de chaque parcours (d'après les
maquettes de l'année). `web/data/classes.json` n'est que la répartition par défaut. Pour retrouver
les ressources : ouvrir ADE, déplier *Trainees > ISIS >
ISIS-FIA-ANNEE1-2-3* et lire l'identifiant des lignes dans l'inspecteur
(`id="Direct Planning Tree_3612"` → `3612`).
# isis-hub

## Licence

Code publié **en consultation seulement**, pour la transparence : tu peux le lire, le télécharger
et l'exécuter chez toi pour vérifier ce qu'il fait. Toute réutilisation, modification,
redistribution, mise en ligne ou utilisation commerciale est interdite sans accord écrit de
l'auteur. Détails dans [LICENSE](LICENSE). Les composants tiers (libcurl.js, golang.org/x/text,
police Inter) gardent leur propre licence.
