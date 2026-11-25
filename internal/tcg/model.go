// Package tcg : le jeu de cartes de la promo (« ISIS · TCG »).
//
// Les cartes sont proposées par les étudiants (photo, titre, deux phrases), validées par un
// administrateur (on valide par défaut, on bloque ce qui insulte, dénigre ou expose quelqu'un),
// classées par le jury de la semaine, puis imprimées par vagues avec une rareté :
//
//	Commune      tirage illimité
//	Rare         25 exemplaires numérotés
//	Épique       10 exemplaires
//	Légendaire    3 exemplaires
//	Unique        1 seul exemplaire au monde
//
// Chaque joueur ouvre un booster de 5 cartes par jour et échange ses cartes en face à face.
//
// Ce que le serveur garde (fichier tcg.json du volume /data) : le pseudo de chaque joueur, sa
// collection, ses propositions, ses votes du jury, l'historique de ses échanges ; pour les
// statistiques de l'administration, des compteurs par jour et par vague (jamais qui). Le joueur est
// reconnu par une empreinte de son identifiant universitaire (HMAC avec un secret du serveur,
// tiré de VAULT_PEPPER) : l'identifiant lui-même n'est jamais enregistré. Les photos des cartes
// sont gardées dans un stockage d'objets (Cloudflare R2) ou, à défaut, dans le dossier de données.
package tcg

import (
	"time"
)

// Rarity : rareté d'une carte imprimée.
type Rarity string

const (
	Commune    Rarity = "commune"
	Rare       Rarity = "rare"
	Epique     Rarity = "epique"
	Legendaire Rarity = "legendaire"
	Unique     Rarity = "unique"
)

// Rarities : de la plus courante à la plus rare.
var Rarities = []Rarity{Commune, Rare, Epique, Legendaire, Unique}

func (r Rarity) valid() bool {
	for _, x := range Rarities {
		if r == x {
			return true
		}
	}
	return false
}

// tier : rang de rareté (0 = commune … 4 = unique).
func (r Rarity) tier() int {
	for i, x := range Rarities {
		if r == x {
			return i
		}
	}
	return 0
}

// Catégories d'une carte.
var Categories = map[string]bool{"meme": true, "moment": true, "lieu": true, "truc": true}

// Statut d'une carte, de la proposition à l'impression.
const (
	StatusPending  = "pending"  // en attente de validation
	StatusConsent  = "consent"  // validée par l'administration, en attente de l'accord des personnes sur la photo
	StatusAccepted = "accepted" // validée : passera au jury
	StatusBlocked  = "blocked"  // bloquée par un administrateur (motif et message à l'auteur)
	StatusPrinted  = "printed"  // imprimée dans une vague, en jeu
	StatusRemoved  = "removed"  // retirée du jeu après signalements (les exemplaires restent)
)

// Card : une proposition, puis une carte imprimée.
type Card struct {
	ID      string    `json:"id"`  // « c147 »
	Num     int       `json:"num"` // numéro de proposition (P-0147)
	Author  string    `json:"author"`
	Title   string    `json:"title"`
	Desc    string    `json:"desc"`
	Cat     string    `json:"cat"`
	Img     string    `json:"img"`   // photo (nom d'objet : empreinte + extension)
	Thumb   string    `json:"thumb"` // vignette
	Bytes   int64     `json:"bytes"` // taille des deux images
	Status  string    `json:"status"`
	Created time.Time `json:"created"`
	Decided time.Time `json:"decided,omitzero"`
	Reason  string    `json:"reason,omitempty"`  // motif du blocage
	Message string    `json:"message,omitempty"` // message bienveillant à l'auteur
	Edited  bool      `json:"edited,omitempty"`  // texte corrigé par un administrateur
	Purged  bool      `json:"purged,omitempty"`  // images effacées (bloquée depuis 7 jours ou retirée depuis 30)

	// Jury : points cumulés (× 2, pour rester entiers), nombre de classements, apparitions.
	JuryPts   int `json:"juryPts,omitempty"`
	JuryVotes int `json:"juryVotes,omitempty"`
	JuryShown int `json:"juryShown,omitempty"`

	// Impression.
	Wave    int       `json:"wave,omitempty"`
	No      int       `json:"no,omitempty"` // numéro dans la vague (#017)
	Rarity  Rarity    `json:"rarity,omitempty"`
	Run     int       `json:"run,omitempty"`    // exemplaires numérotés (0 = commune, illimitée)
	Issued  int       `json:"issued,omitempty"` // exemplaires déjà tirés
	FirstBy string    `json:"firstBy,omitempty"`
	FirstAt time.Time `json:"firstAt,omitzero"`

	// Signalements des joueurs (une fois par joueur).
	Reports   []Report  `json:"reports,omitempty"`
	ReportsOK time.Time `json:"reportsOk,omitzero"` // signalements examinés jusqu'ici (« Garder »)
	RemovedAt time.Time `json:"removedAt,omitzero"`

	// Personnes sur la photo et leur accord (consent.go).
	Tags []Tag `json:"tags,omitempty"`
}

// Report : signalement d'une carte en jeu.
type Report struct {
	Player string    `json:"player"`
	Reason string    `json:"reason"`
	At     time.Time `json:"at"`
}

// Pull : une carte tirée d'un booster.
type Pull struct {
	Card   string `json:"card"`
	Serial int    `json:"serial"` // numéro d'exemplaire (0 = commune)
	New    bool   `json:"new"`    // première fois dans la collection
}

// Ballot : 5 cartes candidates à classer (jury de la semaine).
type Ballot struct {
	Cards []string  `json:"cards"`
	Rank  []string  `json:"rank,omitempty"` // classement validé (de « je la veux absolument » à « pas du tout »)
	At    time.Time `json:"at,omitzero"`
}

// TradeLog : un échange terminé, dans l'historique des deux joueurs.
type TradeLog struct {
	With  string    `json:"with"`
	Gave  []Copy    `json:"gave"`
	Got   []Copy    `json:"got"`
	At    time.Time `json:"at"`
	Trade string    `json:"trade"`
}

// Copy : un exemplaire précis d'une carte.
type Copy struct {
	Card   string `json:"card"`
	Serial int    `json:"serial"`
}

// Player : un joueur. Reconnu par l'empreinte de son identifiant (State.Keys), jamais par
// l'identifiant lui-même.
type Player struct {
	ID        string           `json:"id"`
	Pseudo    string           `json:"pseudo"`
	Created   time.Time        `json:"created"`
	Owned     map[string][]int `json:"owned,omitempty"`    // carte → numéros d'exemplaires (0 = commune)
	Wish      []string         `json:"wish,omitempty"`     // « Je cherche »
	Booster   string           `json:"booster,omitempty"`  // jour du dernier booster (statistiques)
	BoosterAt time.Time        `json:"boosterAt,omitzero"` // dernier booster : le suivant 24 h après
	LastDraw  []Pull           `json:"lastDraw,omitempty"`
	Ballots   map[int][]Ballot `json:"ballots,omitempty"` // vague → bulletins
	Trades    []TradeLog       `json:"trades,omitempty"`
	Muted     bool             `json:"muted,omitempty"`     // propositions suspendues par un administrateur
	Seen      time.Time        `json:"seen,omitzero"`       // dernier passage (jour), pour les statistiques
	MailKey   string           `json:"mailKey,omitempty"`   // HMAC de l'adresse de sa messagerie (accords)
	Admin     bool             `json:"admin,omitempty"`     // identifiant dans ADMIN_USERS (envoi des mails d'accord)
	Withdrawn int              `json:"withdrawn,omitempty"` // cartes bloquées par la modération puis retirées : comptent toujours au classement
}

// Wave : une vague de cartes, avec son calendrier.
type Wave struct {
	N              int               `json:"n"`
	ProposalsUntil time.Time         `json:"proposalsUntil"`
	JuryFrom       time.Time         `json:"juryFrom"`
	JuryUntil      time.Time         `json:"juryUntil"`
	ReleaseAt      time.Time         `json:"releaseAt"`
	Size           int               `json:"size"`             // nombre de cartes visé
	PerDay         int               `json:"perDay,omitempty"` // propositions par jour pendant cette vague (0 = réglage de la saison)
	Printed        bool              `json:"printed,omitempty"`
	PrintedAt      time.Time         `json:"printedAt,omitzero"`
	Cards          []string          `json:"cards,omitempty"`
	Overrides      map[string]Rarity `json:"overrides,omitempty"` // raretés choisies par l'administrateur
	Mix            map[Rarity]int    `json:"mix,omitempty"`       // cartes par rareté choisies par l'administrateur (communes : le reste)
	Runs           map[Rarity]int    `json:"runs,omitempty"`      // exemplaires par carte pour cette vague (sinon ceux de la saison)
	Opened         int               `json:"opened,omitempty"`    // boosters ouverts pendant la vague (de sa sortie à la suivante)
}

// Sent : propositions envoyées par un compte dans la journée, retraits compris. Rangé sous
// l'empreinte de l'identifiant (comme State.Keys), pour tenir même après « Quitter le jeu » ; oublié
// le lendemain. Le quota est ainsi par compte, quel que soit l'appareil, et ne se regagne ni en
// retirant une proposition, ni en quittant puis en rejoignant le jeu.
type Sent struct {
	Day string `json:"day"` // jour (Paris)
	N   int    `json:"n"`
}

// Activity : chiffres d'une journée de jeu (de 6 h à 6 h, comme les boosters), pour les
// statistiques de l'administration. Des compteurs seulement : rien ne dit qui.
type Activity struct {
	Visitors  int `json:"visitors,omitempty"`  // joueurs venus sur le TCG ce jour-là
	Joined    int `json:"joined,omitempty"`    // nouveaux joueurs
	Proposals int `json:"proposals,omitempty"` // cartes proposées
	Series    int `json:"series,omitempty"`    // séries du jury classées (une série refaite ne compte pas deux fois)
	Trades    int `json:"trades,omitempty"`    // échanges conclus
}

// Season : réglages du jeu.
type Season struct {
	Enabled    bool           `json:"enabled"` // TCG visible des étudiants
	Name       string         `json:"name"`
	Runs       map[Rarity]int `json:"runs"`       // exemplaires par rareté (commune : 0 = illimité)
	PaceDays   int            `json:"paceDays"`   // jours sur lesquels les exemplaires rares d'une vague sont répartis
	PerDay     int            `json:"perDay"`     // propositions par jour et par joueur
	AutoWeekly bool           `json:"autoWeekly"` // une vague programmée chaque semaine après la précédente
}

// FeedItem : un événement de « Dans la promo ».
type FeedItem struct {
	Kind   string    `json:"kind"` // pull | first | trade
	Player string    `json:"player"`
	Other  string    `json:"other,omitempty"`
	Card   string    `json:"card"`
	At     time.Time `json:"at"`
}

// session : connexion d'un appareil (cookie), par empreinte du jeton.
type session struct {
	Player  string    `json:"player"`
	Expires time.Time `json:"expires"`
}

// state : tout ce qui est écrit dans tcg.json.
type state struct {
	Season   Season               `json:"season"`
	Waves    []*Wave              `json:"waves"`
	Cards    map[string]*Card     `json:"cards"`
	Players  map[string]*Player   `json:"players"`
	Keys     map[string]string    `json:"keys"`     // HMAC(identifiant) → joueur
	Sessions map[string]session   `json:"sessions"` // SHA-256(jeton) → session
	Feed     []FeedItem           `json:"feed,omitempty"`
	NextNum  int                  `json:"nextNum"`
	Boosters map[string]int       `json:"boosters,omitempty"` // jour → boosters ouverts (rythme des raretés, statistiques)
	Activity map[string]*Activity `json:"activity,omitempty"` // jour → compteurs (statistiques)
	Sent     map[string]Sent      `json:"sent,omitempty"`     // empreinte de l'identifiant → propositions envoyées aujourd'hui
	Used     int64                `json:"used"`               // octets d'images gardés
	Mailing  Mailing              `json:"mailing,omitzero"`   // mails d'accord (consent.go)
}

func defaultSeason() Season {
	return Season{
		Name:     "Saison 1",
		Runs:     map[Rarity]int{Commune: 0, Rare: 25, Epique: 10, Legendaire: 3, Unique: 1},
		PaceDays: 14,
		PerDay:   3,
	}
}
