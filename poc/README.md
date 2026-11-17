# ISIS Hub

Une page qui regroupe l'emploi du temps ADE (FIA3 / FIA4 / FIA5), les 10 derniers mails et les cours
Moodle, avec pour chaque séance le lien vers le bon espace Moodle.

Tout est lu en direct sur les portails officiels. Rien n'est stocké côté serveur : il n'y a ni base de
données, ni compte, ni journal.

Le dossier `app/` se déploie de deux façons, avec le même code :

| | Appli web | Extension |
| --- | --- | --- |
| Fonctionne sur | tout navigateur récent, ordinateur et téléphone | Chrome, Edge, Brave, Opera, Vivaldi, Arc (ordinateur) |
| Installation | aucune (ajout possible à l'écran d'accueil) | charger le dossier `app/` |
| Accès aux portails | connexions chiffrées dans la page, acheminées par un relais aveugle | direct, sans relais |
| Connexion | formulaire dans l'appli, chiffré vers `auth.univ-jfc.fr` | page officielle du CAS, dans un onglet |
| Session | cookies gardés dans l'onglet (ou sur l'appareil, sur demande) | celle du navigateur |

## Pourquoi un relais

Un navigateur interdit à une page de lire un autre site, sauf si ce site l'autorise, et aucun portail de
l'université ne le fait. Une extension lève cette interdiction ; une page web ordinaire ne le peut pas.

L'appli web contourne le problème sans rien céder sur la confidentialité : elle embarque son propre
client HTTPS (curl et mbedTLS compilés en WebAssembly, `app/vendor/libcurl/`) et négocie le chiffrement
elle-même avec chaque portail. Les octets déjà chiffrés passent par un relais WebSocket
([relay/relay.mjs](relay/relay.mjs)) qui les recopie vers le portail.

- **Ce que le relais voit :** l'adresse IP du visiteur, lequel des quatre portails est contacté, l'heure
  et le volume.
- **Ce qu'il ne voit pas :** mot de passe, cookies de session, mails, cours.
- **Ce qu'il ne peut pas faire :** se faire passer pour un portail (la page vérifie le certificat du
  portail), ni joindre autre chose que les quatre portails (liste fixe dans le fichier).

Le prix : dans l'appli web, le mot de passe se tape dans l'appli et non sur la page du CAS. Il n'est ni
enregistré ni journalisé, et ne part que dans la requête chiffrée adressée à `auth.univ-jfc.fr`, mais
il faut faire confiance au code servi. D'où les verrous et les moyens de vérification ci-dessous.

## Verrous

- **Politique de sécurité** (`app/index.html`) : la page ne charge que ses propres fichiers et ne peut
  se connecter qu'à elle-même et au relais. Aucun script, style ou image externe.
- **Destinations** : le client de la page refuse toute adresse hors des quatre portails, et le relais
  aussi, indépendamment.
- **Cookies** : chacun n'est renvoyé qu'au portail qui l'a émis ; les en-têtes propres à un portail ne
  suivent pas une redirection vers un autre.
- **Relais** : un fichier, aucune dépendance, aucun journal, plafonds de connexions, pages autorisées
  limitées par `ALLOWED_ORIGINS`.
- **Brique de chiffrement** : copie figée de libcurl.js 0.7.5, empreintes dans
  `app/vendor/libcurl/README.md` et vérifiées par les tests.

## Vérifier par soi-même

- **Dans l'appli** : lien *Transparence* en bas de page. Il affiche le mode, le relais, le nombre de
  connexions et les volumes, ce qui est gardé sur l'appareil, et lance cinq vérifications sans identifiant.
- **Le relais ne voit que du chiffré** : outils de développement, onglet Réseau, filtre WS. Les trames
  commencent par `16 03` ou `17 03` (enregistrements TLS). Côté serveur : `node relay/relay.mjs --debug`.
- **Le relais ne peut pas tricher** : dans une copie de `relay.mjs`, remplacer la cible par un autre
  serveur (`connect({ host: 'moodle.univ-jfc.fr', port: 443 })`) et y pointer la balise `isis-relay` :
  ADE, CAS et messagerie échouent avec « SSL peer certificate was not OK ».
- **Le site sert bien ce code** : `node tools/verify-deploy.mjs https://adresse-du-site/` compare chaque
  fichier en ligne à ce dépôt.

## Lancer en local

```bash
npm run relay
```

```bash
npm run web
```

Puis ouvrir http://localhost:4173. L'emploi du temps s'affiche sans connexion ; *Se connecter* ouvre le
formulaire du CAS. http://localhost:4173/demo montre l'interface avec des données fictives, sans réseau.

```bash
npm test
```

## Mettre en ligne

1. **Relais** : lancer `node relay/relay.mjs` sur un serveur, derrière un frontal HTTPS (Caddy, nginx,
   ou la terminaison TLS de l'hébergeur) pour l'exposer en `wss://`. Variables :
   `ALLOWED_ORIGINS=https://adresse-du-site` et `TRUST_PROXY=1` derrière un frontal.
2. **Site** : dans `app/index.html`, mettre l'adresse du relais dans la balise `isis-relay` **et** dans
   `connect-src`, puis `npm run checksums`. Publier le dossier `app/` tel quel sur un hébergement
   statique en HTTPS.
3. Vérifier avec `node tools/verify-deploy.mjs https://adresse-du-site/`.

Toutes les connexions arrivent à l'université depuis l'adresse IP du relais, et un formulaire de mot de
passe hors du domaine universitaire ressemble à du hameçonnage : avant d'ouvrir le site à d'autres
étudiants, prévenir la DSI.

## Extension

1. Ouvrir `chrome://extensions`, activer le **Mode développeur**.
2. **Charger l'extension non empaquetée** → choisir le dossier `app/`.
3. Cliquer sur l'icône « IH ».

## Comment chaque source est lue

| Source | Mécanisme | Authentification |
| --- | --- | --- |
| ADE | Export iCal `anonymous_cal.jsp?resources=…&projectId=…&firstDate=…&lastDate=…` | Aucune |
| CAS | Formulaire `/cas/login` (appli web) ; le cookie `TGC` atteste la session | Identifiant et mot de passe |
| Moodle | `sesskey` lu dans `/my/`, puis API AJAX `lib/ajax/service.php` | SSO via `login/index.php?authCAS=CAS` |
| Mails (BlueMind 5) | `/session-infos` donne le `sid`, puis API `/api/mail_folders` et `/api/mail_items` (en-tête `X-BM-ApiKey`) | SSO via le CAS |

Lien séance ADE → cours Moodle (`app/lib/match.js`) : même code (`TD-A4-1-ISI-2` et `FIA4-1-ISI-2`
partagent `A4-1-ISI-2`) parmi les cours suivis, puis via la recherche Moodle ; à défaut, même intitulé
dans la même promo (lien marqué `≈`) ; sinon un lien « Chercher sur Moodle ».

## Organisation

```
app/            le site et l'extension (aucune étape de construction)
  lib/          lecture d'ADE, de Moodle, de la messagerie ; correspondance des cours
  platform/     web.js (tunnel), tunnel.js (cookies, redirections), cas.js, extension.js
  vendor/       libcurl.js figée
relay/          le relais aveugle
tools/          empreintes et vérification d'un site en ligne
test/           tests (faux portails dans test/support/)
dev/            serveur local et données fictives
```

## À mettre à jour chaque année

`app/lib/config.js` contient le `projectId` ADE (10 pour 2026-2027) et les identifiants des groupes.
Pour les retrouver : ouvrir ADE, déplier *Trainees > ISIS > ISIS-FIA-ANNEE1-2-3* et lire l'identifiant
des lignes dans l'inspecteur (`id="Direct Planning Tree_3612"` → `3612`).
