package feedback

// Statistiques de fréquentation, sans traçage.
//
// La page envoie POST /api/ping à l'ouverture du tableau de bord, avec seulement
// {"first": true} si c'est sa première ouverture du jour sur cet appareil (la page s'en souvient
// elle-même, dans son stockage local). Le serveur n'enregistre que deux compteurs par jour :
// appareils distincts (« first ») et ouvertures. Ni identifiant, ni adresse IP, ni navigateur,
// ni heure précise ne sont gardés : aucune donnée ne permet de relier une visite à quelqu'un.

import (
	"encoding/json"
	"errors"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"sync"
	"time"
)

// Day : compteurs d'un jour (heure de Paris).
type Day struct {
	Unique int `json:"unique"` // appareils distincts
	Visits int `json:"visits"` // ouvertures du tableau de bord
}

type Stats struct {
	mu   sync.Mutex
	path string
	days map[string]Day // « AAAA-MM-JJ »
	now  func() time.Time
}

const statsKeepDays = 800

var paris = func() *time.Location {
	if loc, err := time.LoadLocation("Europe/Paris"); err == nil {
		return loc
	}
	return time.FixedZone("CET", 3600)
}()

// OpenStats charge (ou crée) le fichier des compteurs.
func OpenStats(dir string) (*Stats, error) {
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return nil, err
	}
	s := &Stats{path: filepath.Join(dir, "stats.json"), days: map[string]Day{}, now: time.Now}
	raw, err := os.ReadFile(s.path)
	if errors.Is(err, os.ErrNotExist) {
		return s, nil
	}
	if err != nil {
		return nil, err
	}
	if err := json.Unmarshal(raw, &s.days); err != nil {
		return nil, err
	}
	return s, nil
}

func (s *Stats) today() string { return s.now().In(paris).Format("2006-01-02") }

// Hit compte une ouverture (et un appareil distinct si first).
func (s *Stats) Hit(first bool) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	k := s.today()
	d := s.days[k]
	d.Visits++
	if first {
		d.Unique++
	}
	s.days[k] = d
	limit := s.now().In(paris).AddDate(0, 0, -statsKeepDays).Format("2006-01-02")
	for k := range s.days {
		if k < limit {
			delete(s.days, k)
		}
	}
	raw, err := json.Marshal(s.days)
	if err != nil {
		return err
	}
	return writeAtomic(s.path, raw)
}

// Summary : ce que voit l'administration.
type Summary struct {
	Days      []DayCount `json:"days"`      // 120 derniers jours, du plus ancien au plus récent
	Weekdays  [7]float64 `json:"weekdays"`  // moyenne d'appareils distincts, lundi → dimanche
	Total     int        `json:"total"`     // ouvertures depuis le début
	TotalDays int        `json:"totalDays"` // jours comptés
	Today     Day        `json:"today"`
}

type DayCount struct {
	Date string `json:"date"`
	Day
}

func (s *Stats) Summary() Summary {
	s.mu.Lock()
	defer s.mu.Unlock()
	var out Summary
	keys := make([]string, 0, len(s.days))
	for k := range s.days {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	var sum, n [7]int
	for _, k := range keys {
		d := s.days[k]
		out.Total += d.Visits
		if t, err := time.Parse("2006-01-02", k); err == nil {
			wd := (int(t.Weekday()) + 6) % 7 // lundi = 0
			sum[wd] += d.Unique
			n[wd]++
		}
	}
	// Moyenne sur les jours écoulés depuis le premier compté (un jour sans visite compte pour 0).
	if len(keys) > 0 {
		first, _ := time.Parse("2006-01-02", keys[0])
		last, _ := time.Parse("2006-01-02", s.today())
		for i := range n {
			n[i] = 0
		}
		for t := first; !t.After(last); t = t.AddDate(0, 0, 1) {
			n[(int(t.Weekday())+6)%7]++
		}
		out.TotalDays = int(last.Sub(first).Hours()/24) + 1
	}
	for i := range out.Weekdays {
		if n[i] > 0 {
			out.Weekdays[i] = float64(int(float64(sum[i])/float64(n[i])*10+0.5)) / 10
		}
	}
	end, _ := time.Parse("2006-01-02", s.today())
	for i := 119; i >= 0; i-- {
		k := end.AddDate(0, 0, -i).Format("2006-01-02")
		out.Days = append(out.Days, DayCount{Date: k, Day: s.days[k]})
	}
	out.Today = s.days[s.today()]
	return out
}

func (s *Service) handlePing(w http.ResponseWriter, r *http.Request) {
	var in struct {
		First bool `json:"first"`
	}
	if !s.readJSON(w, r, 64, &in) {
		return
	}
	// Limite anti-gonflage, en mémoire seulement (l'adresse n'est jamais écrite).
	if !s.pings.allow(s.clientIP(r)) || s.cfg.Stats == nil {
		w.WriteHeader(http.StatusNoContent)
		return
	}
	s.cfg.Stats.Hit(in.First)
	w.WriteHeader(http.StatusNoContent)
}
