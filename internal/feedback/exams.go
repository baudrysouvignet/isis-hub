package feedback

// Examens signalés par une classe (« Examen signalé par N camarades »).
//
// Quand un étudiant connecté marque une séance comme examen, la page envoie un vote anonyme :
//   - class : sa classe (FIE4…), sans groupe ni parcours ;
//   - uid   : l'identifiant public de la séance dans l'export ADE de la classe ;
//   - day   : le jour de la séance ;
//   - token : HMAC(clé tirée de sa sauvegarde chiffrée, uid), tronqué. Le même étudiant donne le
//             même jeton pour cette séance sur tous ses appareils (un seul vote), mais deux séances
//             donnent deux jetons sans lien entre eux. Le serveur ne peut ni le recalculer, ni le
//             relier à la sauvegarde, au jeton de fréquentation ou à une personne.
// Le serveur garde, par classe et par séance, le jour et les jetons des votants : ni adresse IP, ni
// heure, ni lien entre deux séances. Une séance passée depuis plus de deux jours est oubliée.
//
// Une séance est signalée à toute la classe dès 3 votes (3 jetons distincts), quelle que soit la
// taille de la classe. Le serveur ne peut pas prouver qu'un vote vient d'un vrai étudiant de la
// classe (il faudrait un ticket CAS, qui ouvrirait l'ENT de l'étudiant) : la page présente donc un
// signal, jamais un examen certain, et chacun peut le masquer.

import (
	"encoding/json"
	"errors"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"sync"
	"time"
)

const (
	examThreshold   = 3   // votes (camarades distincts) pour signaler une séance à la classe
	examKeepPast    = 2   // jours gardés après la séance
	examMaxAhead    = 400 // jours : pas de vote pour une séance plus lointaine
	examMaxClasses  = 40
	examMaxPerClass = 3000 // séances suivies par classe
	examMaxVoters   = 500  // votes gardés par séance
	examFlushEvery  = 30 * time.Second
)

var (
	examUIDRE = regexp.MustCompile(`^[\x21-\x7E]{1,160}$`) // ASCII visible, sans espace
	dayRE     = regexp.MustCompile(`^\d{4}-\d{2}-\d{2}$`)
)

// ErrExamFull : plus de place (classe, séances ou votes) ; le vote est ignoré.
var ErrExamFull = errors.New("trop de votes")

type examVotes struct {
	day    string
	voters map[string]struct{}
}

// ExamStore : votes anonymes par classe et par séance, écrits dans exams.json.
type ExamStore struct {
	mu      sync.Mutex
	path    string
	classes map[string]map[string]*examVotes
	dirty   bool
	now     func() time.Time
}

type examFile struct {
	Classes map[string]map[string]examRecord `json:"classes"`
}

type examRecord struct {
	Day    string   `json:"day"`
	Voters []string `json:"voters"`
}

// OpenExams charge (ou crée) le fichier des votes.
func OpenExams(dir string) (*ExamStore, error) {
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return nil, err
	}
	e := &ExamStore{path: filepath.Join(dir, "exams.json"), classes: map[string]map[string]*examVotes{}, now: time.Now}
	raw, err := os.ReadFile(e.path)
	if err != nil && !errors.Is(err, os.ErrNotExist) {
		return nil, err
	}
	if err == nil {
		var f examFile
		if err := json.Unmarshal(raw, &f); err != nil {
			return nil, err
		}
		for class, events := range f.Classes {
			if !classKeyRE.MatchString(class) {
				continue
			}
			for uid, rec := range events {
				if !examUIDRE.MatchString(uid) || !dayRE.MatchString(rec.Day) {
					continue
				}
				v := &examVotes{day: rec.Day, voters: map[string]struct{}{}}
				for _, t := range rec.Voters {
					if tokenRE.MatchString(t) {
						v.voters[t] = struct{}{}
					}
				}
				if e.classes[class] == nil {
					e.classes[class] = map[string]*examVotes{}
				}
				e.classes[class][uid] = v
			}
		}
	}
	go func() {
		for range time.Tick(examFlushEvery) {
			e.Flush()
		}
	}()
	return e, nil
}

func (e *ExamStore) today() string { return e.now().In(paris).Format("2006-01-02") }

func (e *ExamStore) shift(days int) string {
	return e.now().In(paris).AddDate(0, 0, days).Format("2006-01-02")
}

// prune oublie les séances passées depuis plus de examKeepPast jours (verrou tenu).
func (e *ExamStore) prune() {
	limit := e.shift(-examKeepPast)
	for class, events := range e.classes {
		for uid, v := range events {
			if v.day < limit || len(v.voters) == 0 {
				delete(events, uid)
				e.dirty = true
			}
		}
		if len(events) == 0 {
			delete(e.classes, class)
		}
	}
}

// ExamVote : ce qu'envoie la page.
type ExamVote struct {
	Class string `json:"class"`
	UID   string `json:"uid"`
	Day   string `json:"day"`
	Token string `json:"token"`
	On    bool   `json:"on"`
}

func (v ExamVote) valid() bool {
	return classKeyRE.MatchString(v.Class) && examUIDRE.MatchString(v.UID) && dayRE.MatchString(v.Day) && tokenRE.MatchString(v.Token)
}

// Vote ajoute ou retire un vote. `admit` n'est appelé que pour un nouveau votant (limite par
// visiteur) : s'il refuse, le vote est ignoré sans erreur.
func (e *ExamStore) Vote(v ExamVote, admit func() bool) error {
	if !v.valid() {
		return ErrInvalid
	}
	e.mu.Lock()
	defer e.mu.Unlock()
	if v.Day < e.shift(-examKeepPast) || v.Day > e.shift(examMaxAhead) {
		return ErrInvalid
	}
	e.prune()
	events := e.classes[v.Class]
	ev := events[v.UID]
	if !v.On {
		if ev != nil {
			if _, ok := ev.voters[v.Token]; ok {
				delete(ev.voters, v.Token)
				if len(ev.voters) == 0 {
					delete(events, v.UID)
				}
				e.dirty = true
			}
		}
		return nil
	}
	if ev != nil {
		if _, ok := ev.voters[v.Token]; ok {
			return nil // déjà compté (autre appareil, nouvel envoi)
		}
	}
	switch {
	case events == nil && len(e.classes) >= examMaxClasses,
		ev == nil && len(events) >= examMaxPerClass,
		ev != nil && len(ev.voters) >= examMaxVoters:
		return ErrExamFull
	}
	if admit != nil && !admit() {
		return nil
	}
	if events == nil {
		events = map[string]*examVotes{}
		e.classes[v.Class] = events
	}
	if ev == nil {
		ev = &examVotes{day: v.Day, voters: map[string]struct{}{}}
		events[v.UID] = ev
	}
	ev.voters[v.Token] = struct{}{}
	e.dirty = true
	return nil
}

// Threshold : votes nécessaires pour signaler une séance à toute la classe (le même pour toutes).
func (e *ExamStore) Threshold(string) int { return examThreshold }

// ExamSignal : une séance signalée, sans rien sur les votants.
type ExamSignal struct {
	Day   string `json:"day"`
	Votes int    `json:"votes"`
}

// Signals rend les séances d'une classe qui atteignent le seuil (les autres ne sont pas montrées,
// même leur nombre de votes).
func (e *ExamStore) Signals(class string) (map[string]ExamSignal, int) {
	threshold := e.Threshold(class)
	e.mu.Lock()
	defer e.mu.Unlock()
	out := map[string]ExamSignal{}
	limit := e.shift(-examKeepPast)
	for uid, v := range e.classes[class] {
		if v.day >= limit && len(v.voters) >= threshold {
			out[uid] = ExamSignal{Day: v.day, Votes: len(v.voters)}
		}
	}
	return out, threshold
}

// Flush écrit les votes s'ils ont changé (appelé régulièrement et à l'arrêt du serveur).
func (e *ExamStore) Flush() error {
	e.mu.Lock()
	defer e.mu.Unlock()
	e.prune()
	if !e.dirty {
		return nil
	}
	f := examFile{Classes: map[string]map[string]examRecord{}}
	for class, events := range e.classes {
		out := map[string]examRecord{}
		for uid, v := range events {
			voters := make([]string, 0, len(v.voters))
			for t := range v.voters {
				voters = append(voters, t)
			}
			sort.Strings(voters) // aucun ordre d'arrivée dans le fichier
			out[uid] = examRecord{Day: v.day, Voters: voters}
		}
		f.Classes[class] = out
	}
	raw, err := json.Marshal(f)
	if err != nil {
		return err
	}
	if err := writeAtomic(e.path, raw); err != nil {
		return err
	}
	e.dirty = false
	return nil
}

// ------------------------------------------------------------ service HTTP

// GET /api/exams?class=FIE4 : séances signalées de la classe et seuil en vigueur.
func (s *Service) handleExams(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		fail(w, http.StatusMethodNotAllowed, "GET attendu")
		return
	}
	class := r.URL.Query().Get("class")
	if !classKeyRE.MatchString(class) {
		fail(w, http.StatusBadRequest, "classe invalide")
		return
	}
	if !s.examReads.allow(s.clientIP(r)) {
		fail(w, http.StatusTooManyRequests, "trop de demandes")
		return
	}
	if s.cfg.Exams == nil {
		reply(w, http.StatusOK, map[string]any{"threshold": examThreshold, "signals": map[string]ExamSignal{}})
		return
	}
	signals, threshold := s.cfg.Exams.Signals(class)
	reply(w, http.StatusOK, map[string]any{"threshold": threshold, "signals": signals})
}

// POST /api/exams/vote : ajoute ou retire le vote anonyme d'un étudiant connecté.
func (s *Service) handleExamVote(w http.ResponseWriter, r *http.Request) {
	var in ExamVote
	if !s.readJSON(w, r, 1<<10, &in) {
		return
	}
	ip := s.clientIP(r)
	if !s.examVotes.allow(ip) {
		fail(w, http.StatusTooManyRequests, "trop de votes, réessaie plus tard")
		return
	}
	if s.cfg.Exams == nil {
		w.WriteHeader(http.StatusNoContent)
		return
	}
	// Adresse gardée en mémoire seulement, pour les limites ; jamais écrite ni liée au vote.
	admit := func() bool { return s.examNew.allow(ip) && s.examPerEvent.allow(ip+"|"+in.Class+"|"+in.UID) }
	switch err := s.cfg.Exams.Vote(in, admit); {
	case errors.Is(err, ErrInvalid):
		fail(w, http.StatusBadRequest, "vote invalide")
	case errors.Is(err, ErrExamFull):
		fail(w, http.StatusServiceUnavailable, "trop de votes pour l’instant")
	default:
		w.WriteHeader(http.StatusNoContent)
	}
}
