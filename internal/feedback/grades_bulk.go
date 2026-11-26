package feedback

// Opérations sur toutes les maquettes d'un coup (administration) :
//   - exporter les coefficients (UE et matières) de toutes les classes dans un JSON, et en
//     réimporter un autre qui les réécrit tous d'un coup ;
//   - remettre les coefficients de toutes les matières à 1 ;
//   - retirer toutes les évaluations prévues des maquettes.
// Une seule écriture de grades.json, après vérification de toutes les maquettes : tout passe, ou
// rien ne change. Les notes des étudiants ne sont jamais touchées (elles sont chiffrées chez eux) :
// une évaluation retirée reste connue de la maquette (GradeSubject.Retired), et la note qu'un
// étudiant y avait saisie devient une note personnelle de la même matière (web/js/core/grades.js).

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"path/filepath"
	"sort"
	"strings"
	"time"
	"unicode"

	"golang.org/x/text/unicode/norm"
)

const coefFormat = "isis-hub-coefficients"

// CoefSheet : les coefficients de toutes les maquettes, à éditer puis réimporter.
type CoefSheet struct {
	Format   string                    `json:"format"`
	Version  int                       `json:"version"`
	Exported string                    `json:"exporte,omitempty"`
	Aide     string                    `json:"aide,omitempty"`
	Classes  map[string][]CoefSemester `json:"classes"`
}

type CoefSemester struct {
	ID  string   `json:"id"`
	UEs []CoefUE `json:"ues"`
}

type CoefUE struct {
	ID       string        `json:"id"`
	Name     string        `json:"nom,omitempty"`
	Coef     float64       `json:"coef,omitempty"`
	Matieres []CoefSubject `json:"matieres"`
}

type CoefSubject struct {
	ID   string  `json:"id,omitempty"`
	Name string  `json:"nom,omitempty"`
	Coef float64 `json:"coef"`
}

// BulkReport : ce qu'une opération a changé (ou changerait, pour un essai à blanc).
type BulkReport struct {
	Changed int      `json:"changed"`           // coefficients modifiés
	Evals   int      `json:"evals"`             // évaluations prévues retirées
	Classes []string `json:"classes"`           // maquettes touchées
	Unknown []string `json:"unknown,omitempty"` // lignes du JSON sans correspondance
}

// CoefSheet : export des coefficients (UE et matières) de toutes les maquettes.
func (b GradeBook) CoefSheet(now time.Time) CoefSheet {
	out := CoefSheet{
		Format: coefFormat, Version: 1, Exported: now.Format(time.RFC3339),
		Aide:    "Modifie les champs « coef » (de 0 à 100, décimales avec un point : 1.5), puis réimporte ce fichier dans Administration → Notes → Toutes les maquettes. Une matière se retrouve par son « id », ou à défaut par son « nom » dans la même UE. Une ligne retirée ne change rien.",
		Classes: map[string][]CoefSemester{},
	}
	for k, g := range b {
		var sems []CoefSemester
		for _, s := range g.Semesters {
			cs := CoefSemester{ID: s.ID}
			for _, u := range s.UEs {
				cu := CoefUE{ID: u.ID, Name: u.Name, Coef: u.Coef}
				for _, m := range u.Matieres {
					cu.Matieres = append(cu.Matieres, CoefSubject{ID: m.ID, Name: m.Name, Coef: m.Coef})
				}
				cs.UEs = append(cs.UEs, cu)
			}
			sems = append(sems, cs)
		}
		out.Classes[k] = sems
	}
	return out
}

// foldName : nom comparable (« Interopérabilité » = « interoperabilite »).
func foldName(s string) string {
	var b strings.Builder
	for _, r := range norm.NFD.String(strings.ToLower(strings.TrimSpace(s))) {
		if unicode.Is(unicode.Mn, r) {
			continue
		}
		if unicode.IsLetter(r) || unicode.IsDigit(r) {
			b.WriteRune(r)
		}
	}
	return b.String()
}

// applyCoefs réécrit les coefficients d'après la feuille (copie du carnet). Seuls les coefficients
// changent ; une ligne qui ne correspond à rien est signalée, une valeur invalide refuse tout.
func applyCoefs(book GradeBook, sheet CoefSheet) (GradeBook, BulkReport, error) {
	rep := BulkReport{Classes: []string{}}
	if sheet.Format != "" && sheet.Format != coefFormat {
		return nil, rep, errors.New("ce fichier n’est pas un export de coefficients d’ISIS Hub")
	}
	next := cloneBook(book)
	touched := map[string]bool{}
	for k, sems := range sheet.Classes {
		g, ok := next[k]
		if !ok {
			rep.Unknown = append(rep.Unknown, fmt.Sprintf("%s : pas de maquette pour cette classe", k))
			continue
		}
		for _, cs := range sems {
			for _, cu := range cs.UEs {
				u := findUE(&g, cs.ID, cu.ID)
				if u == nil {
					rep.Unknown = append(rep.Unknown, fmt.Sprintf("%s · UE %s : introuvable", k, cu.ID))
					continue
				}
				if cu.Coef != 0 {
					if !validCoef(cu.Coef) {
						return nil, rep, fmt.Errorf("%s · UE %s : coefficient %v invalide (0 à 100)", k, cu.ID, cu.Coef)
					}
					if u.Coef != cu.Coef {
						u.Coef = cu.Coef
						rep.Changed++
						touched[k] = true
					}
				}
				for _, cm := range cu.Matieres {
					m := findSubject(u, cm)
					if m == nil {
						rep.Unknown = append(rep.Unknown, fmt.Sprintf("%s · UE %s · « %s » : matière introuvable", k, cu.ID, firstNonEmpty(cm.Name, cm.ID)))
						continue
					}
					if !validCoef(cm.Coef) {
						return nil, rep, fmt.Errorf("%s · %s : coefficient %v invalide (0 à 100)", k, m.Name, cm.Coef)
					}
					if m.Coef != cm.Coef {
						m.Coef = cm.Coef
						rep.Changed++
						touched[k] = true
					}
				}
			}
		}
		next[k] = g
	}
	for k := range touched {
		rep.Classes = append(rep.Classes, k)
	}
	sort.Strings(rep.Classes)
	return next, rep, nil
}

func firstNonEmpty(a, b string) string {
	if a != "" {
		return a
	}
	return b
}

// findUE : l'UE par son numéro, dans le semestre indiqué ou, à défaut, dans toute la classe.
func findUE(g *GradeClass, sem, id string) *GradeUE {
	var any *GradeUE
	for si := range g.Semesters {
		for ui := range g.Semesters[si].UEs {
			u := &g.Semesters[si].UEs[ui]
			if u.ID != id {
				continue
			}
			if g.Semesters[si].ID == sem {
				return u
			}
			if any == nil {
				any = u
			}
		}
	}
	return any
}

// findSubject : la matière par son identifiant, sinon par son nom (un seul, dans l'UE).
func findSubject(u *GradeUE, cm CoefSubject) *GradeSubject {
	if cm.ID != "" {
		for i := range u.Matieres {
			if u.Matieres[i].ID == cm.ID {
				return &u.Matieres[i]
			}
		}
	}
	if n := foldName(cm.Name); n != "" {
		var found *GradeSubject
		for i := range u.Matieres {
			if foldName(u.Matieres[i].Name) == n {
				if found != nil {
					return nil // deux matières du même nom : ambigu
				}
				found = &u.Matieres[i]
			}
		}
		return found
	}
	return nil
}

// resetSubjectCoefs : toutes les matières de toutes les maquettes au coefficient 1.
func resetSubjectCoefs(book GradeBook) (GradeBook, BulkReport) {
	rep := BulkReport{Classes: []string{}}
	next := cloneBook(book)
	for k, g := range next {
		changed := false
		for si := range g.Semesters {
			for ui := range g.Semesters[si].UEs {
				for mi := range g.Semesters[si].UEs[ui].Matieres {
					if m := &g.Semesters[si].UEs[ui].Matieres[mi]; m.Coef != 1 {
						m.Coef = 1
						rep.Changed++
						changed = true
					}
				}
			}
		}
		if changed {
			rep.Classes = append(rep.Classes, k)
		}
	}
	sort.Strings(rep.Classes)
	return next, rep
}

// clearEvals : retire toutes les évaluations prévues (gardées dans Retired, pour les notes déjà
// saisies par les étudiants).
func clearEvals(book GradeBook) (GradeBook, BulkReport) {
	rep := BulkReport{Classes: []string{}}
	next := cloneBook(book)
	for k, g := range next {
		n := 0
		for si := range g.Semesters {
			for ui := range g.Semesters[si].UEs {
				for mi := range g.Semesters[si].UEs[ui].Matieres {
					m := &g.Semesters[si].UEs[ui].Matieres[mi]
					n += len(m.Evals)
					m.Retired = append(m.Retired, m.Evals...)
					m.Evals = []GradeEval{}
				}
			}
		}
		if n > 0 {
			rep.Evals += n
			rep.Classes = append(rep.Classes, k)
		}
	}
	sort.Strings(rep.Classes)
	return next, rep
}

func cloneBook(b GradeBook) GradeBook {
	raw, _ := json.Marshal(b)
	out := GradeBook{}
	json.Unmarshal(raw, &out)
	return out
}

// keepRetired : les évaluations que la nouvelle maquette n'a plus (retirées dans l'éditeur ou par
// un import) restent connues de leur matière, avec celles déjà retirées.
func keepRetired(old *GradeClass, g *GradeClass) {
	if old == nil {
		return
	}
	active := map[string]bool{}
	for _, s := range g.Semesters {
		for _, u := range s.UEs {
			for _, m := range u.Matieres {
				for _, e := range m.Evals {
					active[e.ID] = true
				}
			}
		}
	}
	gone := map[string][]GradeEval{} // matière → évaluations à garder
	for _, s := range old.Semesters {
		for _, u := range s.UEs {
			for _, m := range u.Matieres {
				for _, e := range append(append([]GradeEval{}, m.Retired...), m.Evals...) {
					if !active[e.ID] {
						gone[m.ID] = append(gone[m.ID], e)
					}
				}
			}
		}
	}
	for si := range g.Semesters {
		for ui := range g.Semesters[si].UEs {
			for mi := range g.Semesters[si].UEs[ui].Matieres {
				m := &g.Semesters[si].UEs[ui].Matieres[mi]
				have := map[string]bool{}
				for _, e := range m.Retired {
					have[e.ID] = true
				}
				for _, e := range gone[m.ID] {
					if !have[e.ID] {
						m.Retired = append(m.Retired, e)
						have[e.ID] = true
					}
				}
			}
		}
	}
}

// SetBook enregistre toutes les maquettes d'un coup (après vérification de chacune).
func (c *ContentStore) SetBook(next GradeBook) error {
	for k, g := range next {
		if !gradeKeyRE.MatchString(k) {
			return fmt.Errorf("classe %q invalide", k)
		}
		if err := g.Validate(); err != nil {
			return fmt.Errorf("%s : %w", k, err)
		}
		next[k] = g
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	raw, _ := json.MarshalIndent(next, "", " ")
	if err := writeAtomic(filepath.Join(c.dir, "grades.json"), raw); err != nil {
		return err
	}
	c.grades = next
	return nil
}

func (s *Service) adminGradesCoefs(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		fail(w, http.StatusMethodNotAllowed, "GET attendu")
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	reply(w, http.StatusOK, s.cfg.Content.Grades().CoefSheet(time.Now()))
}

func (s *Service) adminGradesBulk(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Action string    `json:"action"` // coefs | reset-coefs | clear-evals
		Sheet  CoefSheet `json:"sheet"`
		Dry    bool      `json:"dry"` // essai à blanc : rien n'est enregistré
	}
	if !s.readJSON(w, r, 512<<10, &in) {
		return
	}
	book := s.cfg.Content.Grades()
	var (
		next GradeBook
		rep  BulkReport
		err  error
	)
	switch in.Action {
	case "coefs":
		next, rep, err = applyCoefs(book, in.Sheet)
	case "reset-coefs":
		next, rep = resetSubjectCoefs(book)
	case "clear-evals":
		next, rep = clearEvals(book)
	default:
		fail(w, http.StatusBadRequest, "action inconnue")
		return
	}
	if err != nil {
		fail(w, http.StatusBadRequest, err.Error())
		return
	}
	if !in.Dry {
		if err := s.cfg.Content.SetBook(next); err != nil {
			fail(w, http.StatusBadRequest, err.Error())
			return
		}
	}
	reply(w, http.StatusOK, map[string]any{"report": rep, "grades": s.cfg.Content.Grades()})
}
