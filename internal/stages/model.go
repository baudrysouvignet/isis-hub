// Package stages : la rubrique Stages d'ISIS Hub, tous les stages des étudiants d'ISIS (structures,
// lieux, sujets, maîtres de stage et contacts RH), déposés par l'administration au format JSON.
//
// Ce sont des données personnelles (noms des étudiants, contacts des structures) : elles ne sont
// servies qu'à une session ouverte par un ticket CAS que le serveur fait valider par l'université.
// La recherche (index) ne contient aucune adresse e-mail ; les contacts d'une structure viennent
// d'un second appel, un par fiche ouverte. Rien n'est gardé sur qui consulte, ni sur ce qu'il
// ouvre : seule la fréquentation de la rubrique est comptée, anonymement (comme celle du Hub).
package stages

import (
	"errors"
	"fmt"
	"math"
	"regexp"
	"strings"
	"unicode"
	"unicode/utf8"
)

// Format et Version : en-tête attendu du fichier déposé.
const (
	Format  = "isis-hub-stages"
	Version = 1
)

// Limites du fichier déposé (le fichier réel : ~240 structures, ~350 stages, ~420 contacts).
const (
	MaxBytes     = 12 << 20
	maxPlaces    = 5000
	maxCompanies = 10000
	maxStages    = 30000
	maxContacts  = 30000
)

// Dataset : le fichier déposé, tel que l'application l'attend (voir README, « Stages »).
type Dataset struct {
	Format    string         `json:"format"`
	Version   int            `json:"version"`
	Built     string         `json:"built"`            // AAAA-MM-JJ : date de construction
	Source    string         `json:"source,omitempty"` // d'où viennent les données (affiché en pied de page)
	Meta      map[string]int `json:"meta,omitempty"`   // compteurs du nettoyage (fiches réunies, lieux déduits…)
	Places    []Place        `json:"places"`
	Companies []Company      `json:"companies"`
	Stages    []Stage        `json:"stages"`
	Contacts  []Contact      `json:"contacts"`
}

// Place : une commune de France (coordonnées sur la carte, en Lambert 93 ramené à la carte), un
// lieu d'outre-mer, un pays étranger ou « lieu non renseigné ».
type Place struct {
	ID   string   `json:"id"`             // fr:<code INSEE>, om:…, abroad:…, none:…
	N    string   `json:"n"`              // nom
	Dep  string   `json:"dep,omitempty"`  // département (01…95, 2A, 2B, 971…)
	Reg  string   `json:"reg,omitempty"`  // région (code INSEE)
	X    *float64 `json:"x,omitempty"`    // position sur la carte (métropole)
	Y    *float64 `json:"y,omitempty"`    //
	Zone string   `json:"zone,omitempty"` // om | monde | inconnu ; vide = métropole
	Pays string   `json:"pays,omitempty"`
	ISO  string   `json:"iso,omitempty"`
}

// Company : une structure dans une commune (les fiches en double sont déjà réunies).
type Company struct {
	ID       string   `json:"id"`
	N        string   `json:"n"`            // nom
	M        string   `json:"m"`            // monogramme du logo
	C        int      `json:"c"`            // couleur du logo (0 à 11)
	P        string   `json:"p"`            // lieu (Place.ID)
	A        string   `json:"a,omitempty"`  // adresse
	CP       string   `json:"cp,omitempty"` // code postal
	W        string   `json:"w,omitempty"`  // site internet
	T        string   `json:"t,omitempty"`  // téléphone du standard
	S        string   `json:"s"`            // secteur
	St       string   `json:"st,omitempty"` // statut (Hôpital public, Public, Privé, Association)
	Naf      string   `json:"naf,omitempty"`
	Sites    []string `json:"sites"`    // autres noms d'établissement réunis ici
	K        []string `json:"k"`        // stages (Stage.ID)
	Paid     int      `json:"paid"`     // stages gratifiés (compte seulement, jamais de montant)
	N0       int      `json:"n0"`       // fiches d'origine réunies
	Variants []string `json:"variants"` // noms saisis, pour contrôle
	Also     []string `json:"also"`     // la même structure dans d'autres villes (Company.ID)
}

// Stage : un stage d'un étudiant.
type Stage struct {
	ID string `json:"id"`
	E  string `json:"e"`            // structure (Company.ID)
	Pr int    `json:"pr,omitempty"` // promotion (année de sortie)
	F  int    `json:"f,omitempty"`  // FIE 1 à 5
	Au int    `json:"au,omitempty"` // année universitaire (2025 = 2025-26)
	D  string `json:"d,omitempty"`  // début, AAAA-MM
	Wk int    `json:"wk,omitempty"` // durée en semaines
	Mi string `json:"mi,omitempty"` // mission
	Th string `json:"th,omitempty"` // thème
	Et string `json:"et"`           // étudiant (prénom et nom)
	Tu string `json:"tu,omitempty"` // maître de stage (Contact.ID)
	Rh string `json:"rh,omitempty"` // responsable / RH (Contact.ID)
	Ob bool   `json:"ob,omitempty"` // stage obligatoire
	Db string `json:"db,omitempty"` // AAAA-MM-JJ
	Df string `json:"df,omitempty"` // AAAA-MM-JJ
	G  int    `json:"g,omitempty"`  // 1 : gratifié
}

// Contact : maître de stage ou responable RH d'une structure.
type Contact struct {
	ID      string   `json:"id"`
	Civ     string   `json:"civ,omitempty"`
	N       string   `json:"n"`
	Role    string   `json:"role,omitempty"`
	Mail    string   `json:"mail,omitempty"`
	Old     []string `json:"old,omitempty"` // anciennes adresses de la même personne
	Generic bool     `json:"generic,omitempty"`
	Chk     bool     `json:"chk,omitempty"` // adresse qui ne ressemble pas au nom : à vérifier
	Kinds   []string `json:"kinds"`         // maitre, rh
	Last    string   `json:"last,omitempty"`
}

var (
	placeIDRE = regexp.MustCompile(`^(fr|om|abroad|none):[^\x00-\x1f]{1,80}$`)
	idRE      = regexp.MustCompile(`^[A-Za-z0-9_-]{1,40}$`)
	monthRE   = regexp.MustCompile(`^\d{4}-(0[1-9]|1[0-2])$`)
	dayRE     = regexp.MustCompile(`^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$`)
	builtRE   = dayRE
	depRE     = regexp.MustCompile(`^(\d{2}|2A|2B|97\d|98\d)$`)
	regRE     = regexp.MustCompile(`^\d{2}$`)
	mailRE    = regexp.MustCompile(`^[^@\s<>"]{1,64}@[A-Za-z0-9.-]{1,190}\.[A-Za-z]{2,24}$`)
	webRE     = regexp.MustCompile(`^(https?://)?[A-Za-z0-9.-]+\.[A-Za-z]{2,24}([/?#][^\s<>"]*)?$`)
	isoRE     = regexp.MustCompile(`^[A-Z]{2}$`)
)

// text vérifie un texte libre : longueur, UTF-8 et aucun caractère de contrôle (sauf retours à la
// ligne si multi).
func text(field, s string, max int, multi bool) error {
	if !utf8.ValidString(s) {
		return fmt.Errorf("%s : texte illisible", field)
	}
	if utf8.RuneCountInString(s) > max {
		return fmt.Errorf("%s : plus de %d caractères", field, max)
	}
	for _, r := range s {
		if unicode.IsControl(r) && !(multi && (r == '\n' || r == '\t')) {
			return fmt.Errorf("%s : caractère de contrôle", field)
		}
	}
	return nil
}

func texts(field string, list []string, n, max int) error {
	if len(list) > n {
		return fmt.Errorf("%s : plus de %d éléments", field, n)
	}
	for _, s := range list {
		if err := text(field, s, max, false); err != nil {
			return err
		}
	}
	return nil
}

func finite(p *float64) bool {
	return p == nil || (!math.IsNaN(*p) && !math.IsInf(*p, 0) && math.Abs(*p) < 1e6)
}

// Validate contrôle le fichier déposé en entier : forme, limites et liens entre les listes. Le
// premier problème trouvé est rendu, avec l'élément en cause.
func (d *Dataset) Validate() error {
	if d.Format != Format || d.Version != Version {
		return fmt.Errorf("format attendu : « %s », version %d", Format, Version)
	}
	if !builtRE.MatchString(d.Built) {
		return errors.New("built : date AAAA-MM-JJ attendue")
	}
	if err := text("source", d.Source, 300, false); err != nil {
		return err
	}
	if len(d.Places) > maxPlaces || len(d.Companies) > maxCompanies || len(d.Stages) > maxStages || len(d.Contacts) > maxContacts {
		return errors.New("fichier trop grand")
	}
	if len(d.Companies) == 0 || len(d.Stages) == 0 {
		return errors.New("aucune structure ou aucun stage")
	}
	places := map[string]bool{}
	for i, p := range d.Places {
		at := fmt.Sprintf("places[%d] (%s)", i, p.ID)
		switch {
		case !placeIDRE.MatchString(p.ID) || places[p.ID]:
			return fmt.Errorf("%s : identifiant invalide ou en double", at)
		case p.Zone != "" && p.Zone != "om" && p.Zone != "monde" && p.Zone != "inconnu":
			return fmt.Errorf("%s : zone inconnue", at)
		case p.Zone == "" && (p.X == nil || p.Y == nil || !depRE.MatchString(p.Dep) || !regRE.MatchString(p.Reg)):
			return fmt.Errorf("%s : un lieu de métropole a un département, une région et des coordonnées", at)
		case p.Dep != "" && !depRE.MatchString(p.Dep), p.Reg != "" && !regRE.MatchString(p.Reg):
			return fmt.Errorf("%s : département ou région invalide", at)
		case !finite(p.X) || !finite(p.Y):
			return fmt.Errorf("%s : coordonnées invalides", at)
		case p.ISO != "" && !isoRE.MatchString(p.ISO):
			return fmt.Errorf("%s : code pays invalide", at)
		}
		for f, v := range map[string]string{"n": p.N, "pays": p.Pays} {
			if err := text(at+"."+f, v, 120, false); err != nil {
				return err
			}
		}
		if strings.TrimSpace(p.N) == "" {
			return fmt.Errorf("%s : nom vide", at)
		}
		places[p.ID] = true
	}
	contacts := map[string]bool{}
	for i, c := range d.Contacts {
		at := fmt.Sprintf("contacts[%d] (%s)", i, c.ID)
		if !idRE.MatchString(c.ID) || contacts[c.ID] {
			return fmt.Errorf("%s : identifiant invalide ou en double", at)
		}
		for f, v := range map[string]string{"civ": c.Civ, "n": c.N, "role": c.Role, "last": c.Last} {
			if err := text(at+"."+f, v, 200, false); err != nil {
				return err
			}
		}
		if c.Mail != "" && !mailRE.MatchString(c.Mail) {
			return fmt.Errorf("%s : adresse e-mail invalide", at)
		}
		for _, o := range c.Old {
			if !mailRE.MatchString(o) {
				return fmt.Errorf("%s : ancienne adresse invalide", at)
			}
		}
		if len(c.Old) > 10 || len(c.Kinds) == 0 || len(c.Kinds) > 2 {
			return fmt.Errorf("%s : rôles ou anciennes adresses invalides", at)
		}
		for _, k := range c.Kinds {
			if k != "maitre" && k != "rh" {
				return fmt.Errorf("%s : rôle « %s » inconnu (maitre, rh)", at, k)
			}
		}
		if c.Last != "" && !monthRE.MatchString(c.Last) {
			return fmt.Errorf("%s : last attend AAAA-MM", at)
		}
		contacts[c.ID] = true
	}
	companies := map[string]*Company{}
	for i := range d.Companies {
		c := &d.Companies[i]
		at := fmt.Sprintf("companies[%d] (%s)", i, c.ID)
		switch {
		case !idRE.MatchString(c.ID) || companies[c.ID] != nil:
			return fmt.Errorf("%s : identifiant invalide ou en double", at)
		case !places[c.P]:
			return fmt.Errorf("%s : lieu « %s » absent de places", at, c.P)
		case c.C < 0 || c.C > 11:
			return fmt.Errorf("%s : couleur de logo de 0 à 11", at)
		case len(c.K) == 0:
			return fmt.Errorf("%s : aucun stage", at)
		case c.Paid < 0 || c.Paid > len(c.K) || c.N0 < 0:
			return fmt.Errorf("%s : compteurs invalides", at)
		case c.W != "" && !webRE.MatchString(c.W):
			return fmt.Errorf("%s : site internet invalide", at)
		case strings.TrimSpace(c.N) == "" || strings.TrimSpace(c.M) == "" || strings.TrimSpace(c.S) == "":
			return fmt.Errorf("%s : nom, monogramme et secteur sont obligatoires", at)
		}
		for f, v := range map[string]string{"n": c.N, "a": c.A, "cp": c.CP, "w": c.W, "t": c.T, "s": c.S, "st": c.St, "naf": c.Naf} {
			if err := text(at+"."+f, v, 300, false); err != nil {
				return err
			}
		}
		if err := text(at+".m", c.M, 6, false); err != nil {
			return err
		}
		if err := texts(at+".sites", c.Sites, 40, 300); err != nil {
			return err
		}
		if err := texts(at+".variants", c.Variants, 60, 300); err != nil {
			return err
		}
		companies[c.ID] = c
	}
	stageOf := map[string]string{}
	for i, s := range d.Stages {
		at := fmt.Sprintf("stages[%d] (%s)", i, s.ID)
		switch {
		case !idRE.MatchString(s.ID) || stageOf[s.ID] != "":
			return fmt.Errorf("%s : identifiant invalide ou en double", at)
		case companies[s.E] == nil:
			return fmt.Errorf("%s : structure « %s » absente de companies", at, s.E)
		case s.F < 0 || s.F > 5 || (s.Pr != 0 && (s.Pr < 2000 || s.Pr > 2100)) || (s.Au != 0 && (s.Au < 2000 || s.Au > 2100)) || s.Wk < 0 || s.Wk > 104:
			return fmt.Errorf("%s : niveau, promotion, année ou durée invalide", at)
		case s.D != "" && !monthRE.MatchString(s.D), s.Db != "" && !dayRE.MatchString(s.Db), s.Df != "" && !dayRE.MatchString(s.Df):
			return fmt.Errorf("%s : dates attendues AAAA-MM et AAAA-MM-JJ", at)
		case s.Tu != "" && !contacts[s.Tu], s.Rh != "" && !contacts[s.Rh]:
			return fmt.Errorf("%s : contact absent de contacts", at)
		case s.G != 0 && s.G != 1:
			return fmt.Errorf("%s : g vaut 0 ou 1", at)
		case strings.TrimSpace(s.Et) == "":
			return fmt.Errorf("%s : nom de l'étudiant vide", at)
		}
		if err := text(at+".mi", s.Mi, 3000, true); err != nil {
			return err
		}
		if err := text(at+".th", s.Th, 1000, true); err != nil {
			return err
		}
		if err := text(at+".et", s.Et, 120, false); err != nil {
			return err
		}
		stageOf[s.ID] = s.E
	}
	for id, c := range companies {
		for _, k := range c.K {
			if stageOf[k] != id {
				return fmt.Errorf("companies (%s) : le stage « %s » n'est pas rattaché à cette structure", id, k)
			}
		}
		for _, a := range c.Also {
			if companies[a] == nil || a == id {
				return fmt.Errorf("companies (%s) : « aussi ailleurs » vers une structure inconnue (%s)", id, a)
			}
		}
	}
	listed := 0
	for _, c := range companies {
		listed += len(c.K)
	}
	if listed != len(d.Stages) {
		return errors.New("chaque stage doit figurer une fois dans la liste k de sa structure")
	}
	return nil
}

// Index : ce que reçoit la page pour chercher et dessiner la carte, sans aucune adresse e-mail :
// les contacts n'y gardent que leur nom, leur fonction et s'ils ont une adresse.
type Index struct {
	Built     string         `json:"built"`
	Source    string         `json:"source,omitempty"`
	Meta      map[string]int `json:"meta,omitempty"`
	Places    []Place        `json:"places"`
	Companies []Company      `json:"companies"`
	Stages    []Stage        `json:"stages"`
	Contacts  []IndexContact `json:"contacts"`
}

// IndexContact : un contact sans son adresse.
type IndexContact struct {
	ID      string   `json:"id"`
	Civ     string   `json:"civ,omitempty"`
	N       string   `json:"n"`
	Role    string   `json:"role,omitempty"`
	Generic bool     `json:"generic,omitempty"`
	HasMail bool     `json:"hm,omitempty"`
	Kinds   []string `json:"kinds"`
	Last    string   `json:"last,omitempty"`
}

func (d *Dataset) index() *Index {
	ix := &Index{Built: d.Built, Source: d.Source, Meta: d.Meta, Places: d.Places, Companies: d.Companies, Stages: d.Stages, Contacts: make([]IndexContact, len(d.Contacts))}
	for i, c := range d.Contacts {
		ix.Contacts[i] = IndexContact{ID: c.ID, Civ: c.Civ, N: c.N, Role: c.Role, Generic: c.Generic, HasMail: c.Mail != "", Kinds: c.Kinds, Last: c.Last}
	}
	return ix
}
