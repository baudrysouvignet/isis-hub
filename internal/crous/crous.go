// Package crous fournit le menu du midi du Resto U' de Castres, lu sur des sources publiques :
// l'API Croustillant, et à défaut la page du CROUS Toulouse. Aucune donnée personnelle n'est en jeu.
// Les menus sont gardés 12 heures en mémoire ; ceux déjà vus restent connus 3 semaines.
package crous

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"html"
	"io"
	"net/http"
	"regexp"
	"sort"
	"strings"
	"sync"
	"time"
)

const (
	croustillantURL = "https://api.croustillant.menu/v1/restaurants/117/menu"
	crousURL        = "https://www.crous-toulouse.fr/restaurant/resto-u-castres/"
	ttl             = 12 * time.Hour
	keep            = 21 * 24 * time.Hour
)

// Category : une rubrique du menu (Entrées, Plats, Desserts…) et ses plats.
type Category struct {
	Name   string   `json:"name"`
	Dishes []string `json:"dishes"`
}

// Menus : réponse publique de /api/crous.
type Menus struct {
	Restaurant string                `json:"restaurant"`
	Source     string                `json:"source"`
	Updated    time.Time             `json:"updated"`
	Days       map[string][]Category `json:"days"` // « AAAA-MM-JJ » → menu du midi
}

type Service struct {
	mu       sync.Mutex
	client   *http.Client
	menus    Menus
	fetched  time.Time
	sources  []func(ctx context.Context) (map[string][]Category, string, error)
	BaseCrou string
	BaseAPI  string
}

func New() *Service {
	s := &Service{client: &http.Client{Timeout: 15 * time.Second}, BaseAPI: croustillantURL, BaseCrou: crousURL}
	s.menus = Menus{Restaurant: "Resto U' Castres", Days: map[string][]Category{}}
	s.sources = []func(context.Context) (map[string][]Category, string, error){s.fromCroustillant, s.fromCrous}
	return s
}

func (s *Service) get(ctx context.Context, url string) ([]byte, error) {
	req, _ := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	req.Header.Set("User-Agent", "ISIS-Hub (menu du Resto U' de Castres)")
	res, err := s.client.Do(req)
	if err != nil {
		return nil, err
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("HTTP %d", res.StatusCode)
	}
	return io.ReadAll(io.LimitReader(res.Body, 2<<20))
}

func clean(s string) string {
	s = html.UnescapeString(s)
	s = strings.Join(strings.Fields(s), " ")
	if r := []rune(s); len(r) > 120 {
		s = string(r[:120])
	}
	return s
}

// fromCroustillant lit l'API Croustillant (dates « JJ-MM-AAAA », repas « midi »).
func (s *Service) fromCroustillant(ctx context.Context) (map[string][]Category, string, error) {
	body, err := s.get(ctx, s.BaseAPI)
	if err != nil {
		return nil, "", err
	}
	var out struct {
		Success bool `json:"success"`
		Data    []struct {
			Date  string `json:"date"`
			Repas []struct {
				Type       string `json:"type"`
				Categories []struct {
					Libelle string `json:"libelle"`
					Ordre   int    `json:"ordre"`
					Plats   []struct {
						Libelle string `json:"libelle"`
						Ordre   int    `json:"ordre"`
					} `json:"plats"`
				} `json:"categories"`
			} `json:"repas"`
		} `json:"data"`
	}
	if err := json.Unmarshal(body, &out); err != nil || !out.Success {
		return nil, "", errors.New("réponse Croustillant illisible")
	}
	days := map[string][]Category{}
	for _, d := range out.Data {
		t, err := time.Parse("02-01-2006", d.Date)
		if err != nil {
			continue
		}
		for _, r := range d.Repas {
			if r.Type != "midi" {
				continue
			}
			sort.SliceStable(r.Categories, func(i, j int) bool { return r.Categories[i].Ordre < r.Categories[j].Ordre })
			var cats []Category
			for _, c := range r.Categories {
				sort.SliceStable(c.Plats, func(i, j int) bool { return c.Plats[i].Ordre < c.Plats[j].Ordre })
				cat := Category{Name: clean(c.Libelle)}
				for _, p := range c.Plats {
					if n := clean(p.Libelle); n != "" {
						cat.Dishes = append(cat.Dishes, n)
					}
				}
				if cat.Name != "" && len(cat.Dishes) > 0 {
					cats = append(cats, cat)
				}
			}
			if len(cats) > 0 {
				days[t.Format("2006-01-02")] = cats
			}
		}
	}
	return days, "Croustillant", nil
}

var (
	dayRE   = regexp.MustCompile(`(?s)<time datetime="(\d{4}-\d{2}-\d{2})">.*?(?:<time datetime=|$)`)
	mealRE  = regexp.MustCompile(`(?s)<h4 class="meal_title">\s*Déjeuner\s*</h4>\s*<ul class="meal_foodies">(.*?)</ul>\s*</div>`)
	catRE   = regexp.MustCompile(`(?s)<li>([^<]+)<ul>(.*?)</ul></li>`)
	itemRE  = regexp.MustCompile(`<li>([^<]*)</li>`)
	sepItem = regexp.MustCompile(`^(?i:ou|et)$`)
)

// fromCrous lit la page du CROUS Toulouse (secours).
func (s *Service) fromCrous(ctx context.Context) (map[string][]Category, string, error) {
	body, err := s.get(ctx, s.BaseCrou)
	if err != nil {
		return nil, "", err
	}
	page := string(body)
	days := map[string][]Category{}
	for _, loc := range dayRE.FindAllStringSubmatchIndex(page, -1) {
		date := page[loc[2]:loc[3]]
		block := page[loc[0]:loc[1]]
		m := mealRE.FindStringSubmatch(block + "</div>")
		if m == nil {
			continue
		}
		var cats []Category
		for _, c := range catRE.FindAllStringSubmatch(m[1], -1) {
			cat := Category{Name: clean(c[1])}
			for _, it := range itemRE.FindAllStringSubmatch(c[2], -1) {
				if n := clean(it[1]); n != "" && !sepItem.MatchString(n) {
					cat.Dishes = append(cat.Dishes, n)
				}
			}
			if cat.Name != "" && len(cat.Dishes) > 0 {
				cats = append(cats, cat)
			}
		}
		if len(cats) > 0 {
			days[date] = cats
		}
	}
	if len(days) == 0 {
		return nil, "", errors.New("aucun menu dans la page du CROUS")
	}
	return days, "CROUS Toulouse", nil
}

// Get rend les menus connus, relus au plus toutes les 12 heures.
func (s *Service) Get(ctx context.Context) Menus {
	s.mu.Lock()
	defer s.mu.Unlock()
	if time.Since(s.fetched) >= ttl {
		for _, src := range s.sources {
			days, name, err := src(ctx)
			if err != nil {
				continue
			}
			for d, m := range days {
				s.menus.Days[d] = m
			}
			s.menus.Source, s.menus.Updated = name, time.Now().UTC().Truncate(time.Second)
			s.fetched = time.Now()
			break
		}
		if s.fetched.IsZero() || time.Since(s.fetched) >= ttl {
			// Aucune source : on réessaiera dans 30 minutes, en gardant ce qui est connu.
			s.fetched = time.Now().Add(-ttl + 30*time.Minute)
		}
		limit := time.Now().Add(-keep).Format("2006-01-02")
		for d := range s.menus.Days {
			if d < limit {
				delete(s.menus.Days, d)
			}
		}
	}
	out := s.menus
	out.Days = make(map[string][]Category, len(s.menus.Days))
	for d, m := range s.menus.Days {
		out.Days[d] = m
	}
	return out
}

func (s *Service) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "GET attendu", http.StatusMethodNotAllowed)
		return
	}
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "public, max-age=1800")
	json.NewEncoder(w).Encode(s.Get(r.Context()))
}
