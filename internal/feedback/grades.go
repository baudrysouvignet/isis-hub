package feedback

// Maquettes de notes : pour chaque classe et chaque semestre, les unités d'enseignement (UE), leurs
// matières, les coefficients et les évaluations prévues. Définies par l'administrateur, publiques
// en lecture (aucune donnée personnelle) : les étudiants y saisissent ensuite LEURS notes, qui ne
// sont jamais envoyées en clair au serveur (voir vault.go).

import (
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"time"
)

type GradeEval struct {
	ID    string  `json:"id"`
	Label string  `json:"label"`
	Coef  float64 `json:"coef"`
	Date  string  `json:"date"` // AAAA-MM-JJ, ou vide si pas encore fixée
}

type GradeSubject struct {
	ID    string      `json:"id"`
	Name  string      `json:"name"`
	Coef  float64     `json:"coef"`
	Code  string      `json:"code"` // code de la matière dans ADE (lien avec l'emploi du temps), facultatif
	Evals []GradeEval `json:"evals"`
	// Retired : évaluations retirées de la maquette. Plus affichées, mais une note qu'un étudiant y
	// avait saisie devient une note personnelle de la même matière, au lieu de disparaître.
	Retired []GradeEval `json:"retired,omitempty"`
}

type GradeUE struct {
	ID       string         `json:"id"` // numéro affiché, ex. « 7.1 »
	Name     string         `json:"name"`
	Coef     float64        `json:"coef"`
	Matieres []GradeSubject `json:"matieres"`
}

type GradeSemester struct {
	ID    string    `json:"id"`              // ex. « S7 »
	Label string    `json:"label"`           // ex. « Semestre 7 »
	Start string    `json:"start,omitempty"` // AAAA-MM-JJ, facultatif (affichage de la période)
	End   string    `json:"end,omitempty"`   // AAAA-MM-JJ, facultatif
	UEs   []GradeUE `json:"ues"`
}

type GradeRules struct {
	UE      float64 `json:"ue"`      // moyenne minimale d'une UE (10)
	Matiere float64 `json:"matiere"` // note éliminatoire d'une matière (7)
}

type GradeClass struct {
	// Disabled : système de notes désactivé pour la classe (maquette pas encore prête). Les
	// étudiants voient alors seulement Message ; la maquette en cours de saisie reste privée.
	Disabled  bool            `json:"disabled,omitempty"`
	Message   string          `json:"message,omitempty"`
	Rules     GradeRules      `json:"rules"`
	Semesters []GradeSemester `json:"semesters"`
}

// DefaultGradesMessage : affiché aux étudiants d'une classe dont les notes sont désactivées.
const DefaultGradesMessage = "Ta maquette de notes n’a pas encore été saisie. Le système de notes sera disponible très bientôt : merci de ta patience !"

// Public rend ce que voient les étudiants : rien de la maquette tant qu'elle est désactivée.
func (g GradeClass) Public() GradeClass {
	if !g.Disabled {
		g.Message = ""
		return g
	}
	msg := g.Message
	if msg == "" {
		msg = DefaultGradesMessage
	}
	return GradeClass{Disabled: true, Message: msg, Rules: g.Rules, Semesters: []GradeSemester{}}
}

// GradeBook : classe (FIE4, FIA3…) ou parcours d'une classe (FIE4:ia) → maquette de notes.
type GradeBook map[string]GradeClass

var (
	classKeyRE = regexp.MustCompile(`^[A-Z]{2,5}[0-9]{1,2}$`)
	// Maquette d'une classe, ou d'un parcours de la classe (FIE4 et FIE5) : « FIE4:ia ».
	gradeKeyRE = regexp.MustCompile(`^[A-Z]{2,5}[0-9]{1,2}(?::[a-z0-9][a-z0-9-]{0,23})?$`)
	semIDRE    = regexp.MustCompile(`^[A-Za-z0-9]{1,6}$`)
	ueIDRE     = regexp.MustCompile(`^[A-Za-z0-9.\-]{1,8}$`)
	gradeIDRE  = regexp.MustCompile(`^[a-z0-9][a-z0-9-]{0,47}$`)
	adeCodeRE  = regexp.MustCompile(`^[A-Z0-9]+(?:-[A-Z0-9]+){0,7}$`)
)

func validDate(s string) bool {
	_, err := time.Parse("2006-01-02", s)
	return err == nil
}

func validCoef(c float64) bool { return !math.IsNaN(c) && !math.IsInf(c, 0) && c > 0 && c <= 100 }

// Validate vérifie et nettoie une maquette (textes coupés, caractères de contrôle retirés).
func (g *GradeClass) Validate() error {
	if g.Rules.UE == 0 && g.Rules.Matiere == 0 {
		g.Rules = GradeRules{UE: 10, Matiere: 7}
	}
	if g.Rules.UE < 0 || g.Rules.UE > 20 || g.Rules.Matiere < 0 || g.Rules.Matiere > 20 || math.IsNaN(g.Rules.UE) || math.IsNaN(g.Rules.Matiere) {
		return errors.New("seuils : entre 0 et 20")
	}
	g.Message = clean(g.Message, 400, true)
	// Désactivée, une maquette peut rester en brouillon (même vide).
	if (!g.Disabled && len(g.Semesters) < 1) || len(g.Semesters) > 4 {
		return errors.New("1 à 4 semestres (ou désactive les notes le temps de la saisie)")
	}
	ids := map[string]bool{} // identifiants uniques dans toute la classe
	unique := func(kind, id string) error {
		if ids[kind+id] {
			return fmt.Errorf("identifiant en double : %s", id)
		}
		ids[kind+id] = true
		return nil
	}
	for si := range g.Semesters {
		s := &g.Semesters[si]
		s.Label = clean1(s.Label, 40)
		if !semIDRE.MatchString(s.ID) || s.Label == "" {
			return fmt.Errorf("semestre %d : identifiant (ex. S7) et nom obligatoires", si+1)
		}
		if err := unique("s", s.ID); err != nil {
			return err
		}
		// Dates facultatives : le semestre en cours n'en dépend plus (« Terminer le semestre »).
		if (s.Start != "" && !validDate(s.Start)) || (s.End != "" && !validDate(s.End)) || (s.Start != "" && s.End != "" && s.End < s.Start) {
			return fmt.Errorf("%s : dates de début et de fin invalides", s.Label)
		}
		if !g.Disabled && len(s.UEs) == 0 {
			return fmt.Errorf("%s : au moins une UE (ou désactive les notes le temps de la saisie)", s.Label)
		}
		if len(s.UEs) > 15 {
			return fmt.Errorf("%s : 15 UE au maximum", s.Label)
		}
		for ui := range s.UEs {
			u := &s.UEs[ui]
			u.Name = clean1(u.Name, 120)
			if !ueIDRE.MatchString(u.ID) || u.Name == "" || !validCoef(u.Coef) {
				return fmt.Errorf("%s, UE %d : numéro, nom et coefficient (0 à 100) obligatoires", s.Label, ui+1)
			}
			if err := unique("u", u.ID); err != nil {
				return err
			}
			if (!g.Disabled && len(u.Matieres) < 1) || len(u.Matieres) > 20 {
				return fmt.Errorf("UE %s : 1 à 20 matières", u.ID)
			}
			for mi := range u.Matieres {
				m := &u.Matieres[mi]
				m.Name = clean1(m.Name, 120)
				if !gradeIDRE.MatchString(m.ID) || m.Name == "" || !validCoef(m.Coef) {
					return fmt.Errorf("UE %s, matière %d : nom et coefficient (0 à 100) obligatoires", u.ID, mi+1)
				}
				if m.Code != "" && (len(m.Code) > 48 || !adeCodeRE.MatchString(m.Code)) {
					return fmt.Errorf("%s : code ADE invalide (ex. A4-1-ISI-2)", m.Name)
				}
				if err := unique("m", m.ID); err != nil {
					return err
				}
				if len(m.Evals) > 12 {
					return fmt.Errorf("%s : 12 évaluations au maximum", m.Name)
				}
				for ei := range m.Evals {
					e := &m.Evals[ei]
					e.Label = clean1(e.Label, 40)
					if !gradeIDRE.MatchString(e.ID) || e.Label == "" || !validCoef(e.Coef) {
						return fmt.Errorf("%s, évaluation %d : intitulé et coefficient (0 à 100) obligatoires", m.Name, ei+1)
					}
					if e.Date != "" && !validDate(e.Date) {
						return fmt.Errorf("%s, %s : date invalide", m.Name, e.Label)
					}
					if err := unique("e", e.ID); err != nil {
						return err
					}
				}
				// Évaluations retirées : nettoyées, sans celles redevenues actives, 80 au plus.
				kept := m.Retired[:0]
				for _, e := range m.Retired {
					e.Label = clean1(e.Label, 40)
					if !gradeIDRE.MatchString(e.ID) || ids["e"+e.ID] || ids["r"+e.ID] {
						continue
					}
					if e.Label == "" {
						e.Label = "Évaluation"
					}
					if !validCoef(e.Coef) {
						e.Coef = 1
					}
					if e.Date != "" && !validDate(e.Date) {
						e.Date = ""
					}
					ids["r"+e.ID] = true
					kept = append(kept, e)
				}
				if len(kept) > 80 {
					kept = kept[len(kept)-80:]
				}
				m.Retired = kept
			}
		}
	}
	return nil
}

func (c *ContentStore) loadGrades() error {
	raw, err := os.ReadFile(filepath.Join(c.dir, "grades.json"))
	if errors.Is(err, os.ErrNotExist) {
		c.grades = GradeBook{}
		return nil
	}
	if err != nil {
		return err
	}
	var book GradeBook
	if err := json.Unmarshal(raw, &book); err != nil {
		return fmt.Errorf("grades.json : %w", err)
	}
	for k, g := range book {
		if !gradeKeyRE.MatchString(k) {
			return fmt.Errorf("grades.json : classe %q invalide", k)
		}
		if err := g.Validate(); err != nil {
			return fmt.Errorf("grades.json, %s : %w", k, err)
		}
		book[k] = g
	}
	c.grades = book
	return nil
}

// Grades rend une copie des maquettes de notes.
func (c *ContentStore) Grades() GradeBook {
	c.mu.Lock()
	defer c.mu.Unlock()
	out := GradeBook{}
	for k, v := range c.grades {
		out[k] = v
	}
	return out
}

// SetGrades enregistre (ou retire, si g est nil) la maquette de notes d'une classe.
func (c *ContentStore) SetGrades(class string, g *GradeClass) error {
	if !gradeKeyRE.MatchString(class) {
		return errors.New("classe invalide")
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	if g != nil {
		if old, ok := c.grades[class]; ok {
			keepRetired(&old, g)
		}
		if err := g.Validate(); err != nil {
			return err
		}
	}
	next := GradeBook{}
	for k, v := range c.grades {
		next[k] = v
	}
	if g == nil {
		delete(next, class)
	} else {
		next[class] = *g
	}
	raw, _ := json.MarshalIndent(next, "", " ")
	if err := writeAtomic(filepath.Join(c.dir, "grades.json"), raw); err != nil {
		return err
	}
	c.grades = next
	return nil
}

func (s *Service) handleGrades(w http.ResponseWriter, r *http.Request) {
	if s.cfg.Content == nil {
		fail(w, http.StatusNotFound, "inconnu")
		return
	}
	if r.Method != http.MethodGet {
		fail(w, http.StatusMethodNotAllowed, "GET attendu")
		return
	}
	w.Header().Set("Cache-Control", "no-cache")
	out := GradeBook{}
	for k, g := range s.cfg.Content.Grades() {
		out[k] = g.Public()
	}
	reply(w, http.StatusOK, out)
}

func (s *Service) adminGrades(w http.ResponseWriter, r *http.Request) {
	if r.Method == http.MethodGet { // maquettes complètes, brouillons compris
		reply(w, http.StatusOK, s.cfg.Content.Grades())
		return
	}
	var in struct {
		Class  string      `json:"class"`
		Grades *GradeClass `json:"grades"` // null : retire la maquette de la classe
	}
	if !s.readJSON(w, r, 256<<10, &in) {
		return
	}
	if err := s.cfg.Content.SetGrades(in.Class, in.Grades); err != nil {
		fail(w, http.StatusBadRequest, err.Error())
		return
	}
	reply(w, http.StatusOK, s.cfg.Content.Grades())
}
