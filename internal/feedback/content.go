package feedback

// Contenu modifiable par l'administrateur :
//   - les raccourcis (liens https affichés à tous les étudiants) ;
//   - la répartition des emplois du temps par classe (ressources ADE, groupes, langues, parcours et
//     codes de matières), qui remplace chaque année les règles livrées dans web/data/classes.json.
// Public en lecture, modifiable seulement avec la session administrateur. Stocké dans DATA_DIR.

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync"

	"isishub/internal/calendar"
)

type Link struct {
	ID       string `json:"id"`
	Title    string `json:"title"`
	Subtitle string `json:"subtitle"`
	URL      string `json:"url"`
}

type Content struct {
	Links []Link `json:"links"`
}

var DefaultLinks = []Link{{ID: "ent", Title: "ENT", Subtitle: "Portail de l'université", URL: "https://ent.univ-jfc.fr/"}}

type ContentStore struct {
	mu       sync.Mutex
	dir      string
	data     Content
	classes  calendar.Data
	grades   GradeBook
	OnChange func(calendar.Data) // appelé quand la répartition des classes change
}

// OpenContent charge les raccourcis et la répartition des classes ; `defaults` est la répartition
// livrée avec le code, utilisée tant que l'administrateur n'en a pas enregistré une autre.
func OpenContent(dir string, defaults calendar.Data) (*ContentStore, error) {
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return nil, err
	}
	c := &ContentStore{dir: dir, data: Content{Links: DefaultLinks}, classes: defaults}
	if raw, err := os.ReadFile(filepath.Join(dir, "content.json")); err == nil {
		var saved Content
		if err := json.Unmarshal(raw, &saved); err != nil {
			return nil, err
		}
		if saved.Links != nil {
			c.data.Links = saved.Links
		}
	} else if !errors.Is(err, os.ErrNotExist) {
		return nil, err
	}
	if raw, err := os.ReadFile(filepath.Join(dir, "classes.json")); err == nil {
		var saved calendar.Data
		if err := json.Unmarshal(raw, &saved); err != nil {
			return nil, fmt.Errorf("classes.json : %w", err)
		}
		if err := saved.Validate(); err != nil {
			return nil, fmt.Errorf("classes.json : %w", err)
		}
		c.classes = saved
	} else if !errors.Is(err, os.ErrNotExist) {
		return nil, err
	}
	if err := c.loadGrades(); err != nil {
		return nil, err
	}
	return c, nil
}

func writeAtomic(path string, data []byte) error {
	tmp, err := os.CreateTemp(filepath.Dir(path), ".tmp-*")
	if err != nil {
		return err
	}
	defer os.Remove(tmp.Name())
	if _, err := tmp.Write(data); err != nil {
		tmp.Close()
		return err
	}
	if err := tmp.Sync(); err != nil {
		tmp.Close()
		return err
	}
	if err := tmp.Close(); err != nil {
		return err
	}
	return os.Rename(tmp.Name(), path)
}

func (c *ContentStore) Get() Content {
	c.mu.Lock()
	defer c.mu.Unlock()
	return Content{Links: append([]Link(nil), c.data.Links...)}
}

// Classes rend la répartition en vigueur.
func (c *ContentStore) Classes() calendar.Data {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.classes
}

// SetLinks remplace les raccourcis (12 au plus, adresses https uniquement).
func (c *ContentStore) SetLinks(links []Link) error {
	if len(links) > 12 {
		return errors.New("12 raccourcis au maximum")
	}
	clean := make([]Link, 0, len(links))
	for i, l := range links {
		l.Title = clean1(l.Title, 40)
		l.Subtitle = clean1(l.Subtitle, 80)
		u, err := url.Parse(strings.TrimSpace(l.URL))
		if l.Title == "" || err != nil || u.Scheme != "https" || u.Host == "" || u.User != nil || len(l.URL) > 500 {
			return fmt.Errorf("raccourci %d : titre et adresse https:// obligatoires", i+1)
		}
		l.URL = u.String()
		l.ID = fmt.Sprintf("l%d", i+1)
		clean = append(clean, l)
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	prev := c.data.Links
	c.data.Links = clean
	raw, _ := json.MarshalIndent(c.data, "", " ")
	if err := writeAtomic(filepath.Join(c.dir, "content.json"), raw); err != nil {
		c.data.Links = prev
		return err
	}
	return nil
}

// SetClasses remplace la répartition des emplois du temps (validée avant enregistrement).
func (c *ContentStore) SetClasses(d calendar.Data) error {
	if err := d.Validate(); err != nil {
		return err
	}
	raw, _ := json.MarshalIndent(d, "", " ")
	c.mu.Lock()
	if err := writeAtomic(filepath.Join(c.dir, "classes.json"), raw); err != nil {
		c.mu.Unlock()
		return err
	}
	c.classes = d
	c.mu.Unlock()
	if c.OnChange != nil {
		c.OnChange(d)
	}
	return nil
}

func clean1(s string, max int) string { return clean(s, max, false) }

// ------------------------------------------------------------ routes

func (s *Service) handleContent(w http.ResponseWriter, r *http.Request) {
	if s.cfg.Content == nil {
		fail(w, http.StatusNotFound, "inconnu")
		return
	}
	if r.Method != http.MethodGet {
		fail(w, http.StatusMethodNotAllowed, "GET attendu")
		return
	}
	reply(w, http.StatusOK, s.cfg.Content.Get())
}

func (s *Service) handleClasses(w http.ResponseWriter, r *http.Request) {
	if s.cfg.Content == nil {
		fail(w, http.StatusNotFound, "inconnu")
		return
	}
	if r.Method != http.MethodGet {
		fail(w, http.StatusMethodNotAllowed, "GET attendu")
		return
	}
	w.Header().Set("Cache-Control", "no-cache")
	reply(w, http.StatusOK, s.cfg.Content.Classes())
}

// adminContent gère /api/admin/links et /api/admin/classes (session déjà vérifiée).
func (s *Service) adminContent(w http.ResponseWriter, r *http.Request, action string) bool {
	if s.cfg.Content == nil {
		return false
	}
	switch action {
	case "links":
		var in struct {
			Links []Link `json:"links"`
		}
		if !s.readJSON(w, r, 16<<10, &in) {
			return true
		}
		if err := s.cfg.Content.SetLinks(in.Links); err != nil {
			fail(w, http.StatusBadRequest, err.Error())
			return true
		}
		reply(w, http.StatusOK, s.cfg.Content.Get())
		return true
	case "grades":
		s.adminGrades(w, r)
		return true
	case "classes":
		var in calendar.Data
		if !s.readJSON(w, r, 256<<10, &in) {
			return true
		}
		if err := s.cfg.Content.SetClasses(in); err != nil {
			fail(w, http.StatusBadRequest, err.Error())
			return true
		}
		reply(w, http.StatusOK, s.cfg.Content.Classes())
		return true
	}
	return false
}
