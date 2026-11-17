# ISIS Hub — points techniques à suivre

Règle n° 1 : **la sécurité passe avant la fonctionnalité.** Le serveur ne doit jamais pouvoir lire
les données d'un étudiant (TLS de bout en bout dans la page, relais aveugle).

## À vérifier en conditions réelles (session universitaire nécessaire)

- [ ] **Corbeille BlueMind** : « Supprimer » appelle `POST mail_items_transfer/{source}/{corbeille}/move` (IItemsTransfer), à défaut `PUT mail_folders/{domaine}/user.{id}/importItems/{corbeille}`
      avec `deleteFromSource: true`, puis vérifie que le mail a quitté la boîte. Endpoint repris de
      l'API BlueMind 5 mais **pas encore essayé sur mail.univ-jfc.fr** : si l'action échoue, le
      message d'erreur s'affiche et rien n'est perdu. Idem pour « Restaurer ».
- [ ] **Suppression définitive** : `DELETE mail_items/{dossier}/_multipleDelete`, à défaut drapeau
      `\Deleted` + `_expunge`. Vérifiée après coup, à essayer sur un mail de test.
- [ ] **Nom de la corbeille** : cherché sous `Trash`, sinon `Corbeille`, `Deleted Items`… À
      confirmer dans la liste des dossiers (journal `sendTrace` → `dossiers`).
- [ ] **PDF dans la visionneuse** sur iOS Safari (cadre `blob:`) : si l'affichage est partiel, garder
      « Télécharger ».

## Sessions longues (60 – 90 jours, voire 1 an)

Demandé : rester connecté 60 à 90 jours. **Limite actuelle, non contournable sans affaiblir la
sécurité :**

- La durée d'une session est fixée par **l'université** : ticket CAS (TGC) et sessions de la
  messagerie et de Moodle. Le formulaire du CAS n'a pas d'option « se souvenir de moi » (vérifié).
- Les seuls moyens de dépasser cette durée seraient (a) garder le **mot de passe** pour se
  reconnecter tout seul, ou (b) que le **serveur** garde les sessions et rejoue les connexions.
  Les deux sont exclus : (a) un mot de passe stocké est la donnée la plus sensible qui soit, (b) le
  serveur pourrait alors lire les mails, ce qui détruit le principe du relais aveugle.
- Ce qui est fait : « Rester connecté » garde les cookies des portails **chiffrés sur l'appareil**
  (clé non exportable) aussi longtemps que l'université les accepte ; à expiration, la page le
  dit et l'emploi du temps reste visible. Les gestionnaires de mots de passe (trousseau iCloud,
  Google) remplissent le formulaire en un geste.
- Piste propre : demander à la DSI d'activer le **« Remember Me » d'Apereo CAS** (TGC long, jusqu'à
  plusieurs mois) et d'enregistrer ISIS Hub comme service CAS. Rien à changer côté sécurité ici.
- Un jeton de rafraîchissement « maison » (cookie HttpOnly rotatif) ne servirait à rien : il
  prouverait l'identité auprès d'ISIS Hub, pas auprès des portails de l'université.

## Sécurité (OWASP) — état et suites

- [x] CSP stricte (`default-src 'none'`, scripts du site seulement, Trusted Types), aucun style ni
      script en ligne. Ajout limité : `img-src blob:` et `frame-src blob:` pour les pièces jointes
      vérifiées par signature d'octets.
- [x] Pas d'`innerHTML` ; mails assainis par un analyseur dédié (politique Trusted Types unique).
- [x] Anti-CSRF : origine vérifiée + en-tête `X-Hub-Admin` ; cookies admin HttpOnly SameSite=Strict.
- [x] Limites de débit : retours, connexion admin, compteur de fréquentation (en mémoire).
- [x] Données sur l'appareil chiffrées (AES-GCM, clé non exportable) : session, cache, étiquettes,
      règles. Repères « Évaluation » en clair dans localStorage (aucune donnée sensible).
- [x] `Permissions-Policy` (caméra, micro, géolocalisation, paiement… désactivés).
- [ ] Revue des dépendances : libcurl.js 0.7.5 (vérifier les versions mbedTLS publiées).
- [ ] Tests navigateur automatisés (Playwright) pour Chrome, Firefox, WebKit.

## Interface multi-navigateurs

- [x] Champs à 16 px sur écran tactile (plus de zoom bloqué sur iOS) ; zoom manuel conservé.
- [x] Défilement : la grille, la liste des mails et Moodle rendent la main à la page en butée
      (`overscroll-behavior: auto`).
- [x] Barres de défilement fines sur Chrome / Edge Windows, champs `search` uniformisés.
- [x] Barre d'onglets mobile : onglet actif au toucher et pendant le défilement.
- [x] Menu « Affichage » : les cases masquent de nouveau les tuiles (écouteurs jamais branchés).
- [ ] Vérifier sur appareils réels : Android Chrome / Samsung Internet, iOS 16 et 17, Firefox Android.

## Resto U'

- Source : API Croustillant (`/v1/restaurants/117/menu`), secours : page du CROUS Toulouse.
  Les deux ne publient que le menu **du jour** : les autres jours affichent « Menu non publié ».
- Le badge reprend les couleurs du CROUS **sans son logo** (marque déposée) : à remplacer par le
  logo officiel seulement avec l'accord du CROUS.

## Fréquentation

- Deux compteurs par jour (`stats.json`, 800 jours gardés). Le « premier passage du jour » est
  décidé par l'appareil : un visiteur qui vide son stockage compte deux fois ; c'est le prix de
  l'absence d'identifiant.

## Notes et sauvegarde anonyme (17/11/2026)

- [ ] **À essayer avec une vraie session** : messagerie plein écran côte à côte (lecture, ↑ ↓,
      suppression, réponse), glisser-déposer de pièces jointes, destinataires récents (lus dans
      « Envoyés »). Testés en local sans messagerie : mise en page, ouverture et fermeture.
- [ ] **Sauvegarde anonyme sur deux appareils réels** (ordinateur + téléphone) : connexion par mot
      de passe sur chacun, notes saisies d'un côté, retrouvées de l'autre au retour sur l'onglet.
- [ ] **Durée du calcul PBKDF2** (600 000 tours) sur un vieux téléphone : fait en fond après la
      connexion ; mesurer, et baisser à 310 000 (minimum OWASP pour SHA-256) si c'est trop lent.
- Mot de passe changé : la sauvegarde de l'ancien secret est reprise puis effacée par le premier
  appareil qui se reconnecte (il garde l'ancien secret). Un appareil neuf après un changement de
  mot de passe repart d'une sauvegarde vide : à dire dans l'aide si des étudiants le signalent.
- Les sessions ouvertes avant cette version n'ont pas de secret : la sauvegarde démarre à la
  prochaine connexion par mot de passe (les données restent sur l'appareil en attendant).
- Fusion par rubrique (notes, examens, mails) : la modification la plus récente gagne. Deux
  appareils modifiant les notes hors ligne en même temps : la dernière écriture l'emporte.
- [ ] Purge des sauvegardes abandonnées (champ `month`, mois de la dernière écriture) : ex. plus de
      2 ans sans écriture. Rien n'est purgé pour l'instant.
- Maquettes de notes : saisies dans l'administration (onglet Notes), copiables d'une classe à
  l'autre (nouveaux identifiants, notes séparées). Ne pas recréer une évaluation pour la renommer :
  modifier son intitulé garde les notes déjà saisies.
