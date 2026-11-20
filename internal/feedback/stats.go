package feedback

// Statistiques de fréquentation, sans traçage.
//
// La page envoie POST /api/ping à l'ouverture du tableau de bord avec :
//   - first  : première ouverture du jour sur cet appareil (la page s'en souvient elle-même) ;
//   - token  : étudiant connecté seulement, un « jeton du jour » tiré de sa sauvegarde chiffrée
//              (HMAC du jour avec une clé que le serveur ne connaît pas). Le même compte donne le
//              même jeton toute la journée, sur tous ses appareils, puis un tout autre le lendemain :
//              il permet de compter les comptes distincts du jour, sans pouvoir relier deux jours,
//              ni retrouver la personne ou sa sauvegarde ;
//   - class  : classe choisie (FIE4…), device : téléphone / tablette / ordinateur,
//              mode : application installée ou navigateur.
//
// Le serveur garde des compteurs par jour, jamais croisés entre eux (une classe n'est pas reliée à
// un appareil). Les jetons du jour servent seulement à ne pas compter deux fois un compte : ils
// sont oubliés au changement de jour. Ni identifiant, ni adresse IP, ni navigateur précis, ni heure.

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

// Day : compteurs d'un jour (heure de Paris).
type Day struct {
	Unique   int            `json:"unique"`             // appareils distincts
	Visits   int            `json:"visits"`             // ouvertures du tableau de bord
	Accounts int            `json:"accounts,omitempty"` // comptes distincts (depuis le 18/11/2026)
	Guests   int            `json:"guests,omitempty"`   // appareils sans connexion
	Classes  map[string]int `json:"classes,omitempty"`  // visiteurs distincts par classe
	Devices  map[string]int `json:"devices,omitempty"`  // phone | tablet | desktop
	Modes    map[string]int `json:"modes,omitempty"`    // app | browser
}

type statsFile struct {
	Days      map[string]Day `json:"days"`
	TokenDay  string         `json:"tokenDay,omitempty"`
	TokensDay []string       `json:"tokens,omitempty"` // jetons du jour en cours, oubliés le lendemain
}

type Stats struct {
	mu     sync.Mutex
	path   string
	days   map[string]Day // « AAAA-MM-JJ »
	tokDay string
	tokens map[string]struct{}
	dirty  bool // compteurs changés depuis la dernière écriture
	now    func() time.Time
}

// statsFlushEvery : le fichier est réécrit au plus à ce rythme (et à l'arrêt), pas à chaque
// visite : une rafale de pings ne se traduit plus en rafale d'écritures sur le disque.
const statsFlushEvery = 30 * time.Second

const (
	statsKeepDays  = 800
	maxTokensDay   = 50_000
	maxClassesDay  = 40
	AccountsSince  = "2026-11-18" // premier jour compté par compte
	statsShownDays = 120          // au moins ces jours-là dans le résumé
)

var (
	tokenRE   = regexp.MustCompile(`^[A-Za-z0-9_-]{22,43}$`)
	devicesOK = map[string]bool{"phone": true, "tablet": true, "desktop": true}
	modesOK   = map[string]bool{"app": true, "browser": true}
)

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
	s := &Stats{path: filepath.Join(dir, "stats.json"), days: map[string]Day{}, tokens: map[string]struct{}{}, now: time.Now}
	go func() {
		for range time.Tick(statsFlushEvery) {
			s.Flush()
		}
	}()
	raw, err := os.ReadFile(s.path)
	if errors.Is(err, os.ErrNotExist) {
		return s, nil
	}
	if err != nil {
		return nil, err
	}
	var f statsFile
	if err := json.Unmarshal(raw, &f); err == nil && f.Days != nil {
		s.days, s.tokDay = f.Days, f.TokenDay
		for _, t := range f.TokensDay {
			s.tokens[t] = struct{}{}
		}
		return s, nil
	}
	// Ancien format (jusqu'à la 1.0.4) : directement les jours.
	if err := json.Unmarshal(raw, &s.days); err != nil {
		return nil, err
	}
	return s, nil
}

func (s *Stats) today() string { return s.now().In(paris).Format("2006-01-02") }

// Visit : ce qu'envoie la page (tout est facultatif).
type Visit struct {
	First  bool   `json:"first"`
	Token  string `json:"token,omitempty"`
	Class  string `json:"class,omitempty"`
	Device string `json:"device,omitempty"`
	Mode   string `json:"mode,omitempty"`
}

func (v Visit) valid() bool {
	return (v.Token == "" || tokenRE.MatchString(v.Token)) &&
		(v.Class == "" || classKeyRE.MatchString(v.Class)) &&
		(v.Device == "" || devicesOK[v.Device]) &&
		(v.Mode == "" || modesOK[v.Mode])
}

func bump(m map[string]int, k string, limit int) map[string]int {
	if k == "" {
		return m
	}
	if m == nil {
		m = map[string]int{}
	}
	if _, ok := m[k]; ok || len(m) < limit {
		m[k]++
	}
	return m
}

// Hit compte une ouverture (ancienne forme : appareil seulement).
func (s *Stats) Hit(first bool) error { return s.Record(Visit{First: first}) }

// Record compte une ouverture du tableau de bord.
func (s *Stats) Record(v Visit) error {
	if !v.valid() {
		return errors.New("visite invalide")
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	k := s.today()
	if s.tokDay != k { // nouveau jour : les jetons d'hier sont oubliés
		s.tokDay, s.tokens = k, map[string]struct{}{}
	}
	d := s.days[k]
	d.Visits++
	if v.First {
		d.Unique++
	}
	// Visiteur distinct du jour : un compte vu pour la première fois aujourd'hui, ou un appareil
	// sans connexion à sa première ouverture du jour.
	distinct := false
	if v.Token != "" {
		if _, seen := s.tokens[v.Token]; !seen && len(s.tokens) < maxTokensDay {
			s.tokens[v.Token] = struct{}{}
			d.Accounts++
			distinct = true
		}
	} else if v.First {
		d.Guests++
		distinct = true
	}
	if distinct {
		d.Classes = bump(d.Classes, v.Class, maxClassesDay)
		d.Devices = bump(d.Devices, v.Device, 3)
		d.Modes = bump(d.Modes, v.Mode, 2)
	}
	s.days[k] = d
	s.dirty = true
	return nil
}

// Flush écrit les compteurs s'ils ont changé (appelé régulièrement et à l'arrêt du serveur).
// Les jetons du jour sont écrits aussi, pour qu'un redémarrage ne compte pas deux fois un compte ;
// ceux de la veille ne le sont plus.
func (s *Stats) Flush() error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if !s.dirty {
		return nil
	}
	limit := s.now().In(paris).AddDate(0, 0, -statsKeepDays).Format("2006-01-02")
	for k := range s.days {
		if k < limit {
			delete(s.days, k)
		}
	}
	f := statsFile{Days: s.days}
	if s.tokDay == s.today() {
		f.TokenDay = s.tokDay
		f.TokensDay = make([]string, 0, len(s.tokens))
		for t := range s.tokens {
			f.TokensDay = append(f.TokensDay, t)
		}
	}
	raw, err := json.Marshal(f)
	if err != nil {
		return err
	}
	if err := writeAtomic(s.path, raw); err != nil {
		return err
	}
	s.dirty = false
	return nil
}

// Summary : ce que voit l'administration (les filtres et graphiques sont faits par la page).
type Summary struct {
	Days          []DayCount `json:"days"`      // du plus ancien au plus récent, sans trou
	Weekdays      [7]float64 `json:"weekdays"`  // moyenne d'appareils distincts, lundi → dimanche
	Total         int        `json:"total"`     // ouvertures depuis le début
	TotalDays     int        `json:"totalDays"` // jours comptés
	Today         Day        `json:"today"`
	AccountsSince string     `json:"accountsSince"` // premier jour compté par compte
}

type DayCount struct {
	Date string `json:"date"`
	Day
}

func (s *Stats) Summary() Summary {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := Summary{AccountsSince: AccountsSince}
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
			sum[(int(t.Weekday())+6)%7] += d.Unique // lundi = 0
		}
	}
	end, _ := time.Parse("2006-01-02", s.today())
	start := end.AddDate(0, 0, -(statsShownDays - 1))
	// Moyenne sur les jours écoulés depuis le premier compté (un jour sans visite compte pour 0).
	if len(keys) > 0 {
		first, _ := time.Parse("2006-01-02", keys[0])
		for t := first; !t.After(end); t = t.AddDate(0, 0, 1) {
			n[(int(t.Weekday())+6)%7]++
		}
		out.TotalDays = int(end.Sub(first).Hours()/24) + 1
		if first.Before(start) {
			start = first
		}
	}
	for i := range out.Weekdays {
		if n[i] > 0 {
			out.Weekdays[i] = float64(int(float64(sum[i])/float64(n[i])*10+0.5)) / 10
		}
	}
	for t := start; !t.After(end); t = t.AddDate(0, 0, 1) {
		k := t.Format("2006-01-02")
		out.Days = append(out.Days, DayCount{Date: k, Day: s.days[k]})
	}
	out.Today = s.days[s.today()]
	return out
}

func (s *Service) handlePing(w http.ResponseWriter, r *http.Request) {
	var in Visit
	if !s.readJSON(w, r, 256, &in) {
		return
	}
	if !in.valid() {
		fail(w, http.StatusBadRequest, "visite invalide")
		return
	}
	// Limite anti-gonflage, en mémoire seulement (l'adresse n'est jamais écrite). Large : tout un
	// campus peut partager la même adresse.
	if !s.pings.allow(s.clientIP(r)) || s.cfg.Stats == nil {
		w.WriteHeader(http.StatusNoContent)
		return
	}
	s.cfg.Stats.Record(in)
	w.WriteHeader(http.StatusNoContent)
}
