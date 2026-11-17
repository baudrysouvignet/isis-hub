// Package feedback gère les retours envoyés depuis « Une idée ? » et leur administration.
//
// C'est la SEULE donnée que le serveur conserve. Principes :
//   - l'étudiant choisit d'envoyer, et peut le faire anonymement ;
//   - aucune adresse IP n'est enregistrée (elle sert seulement, en mémoire, à limiter le débit) ;
//   - « Mes propositions » fonctionne sans compte : à l'envoi, la page reçoit un jeton secret qu'elle
//     garde sur l'appareil ; le serveur n'en conserve que l'empreinte SHA-256 ;
//   - l'administration est protégée par un mot de passe dont seule l'empreinte PBKDF2 est
//     configurée (variable ADMIN_PASSWORD_HASH), une session courte, et des protections CSRF.
package feedback

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"
	"unicode"
	"unicode/utf8"
)

var (
	Types    = map[string]bool{"idea": true, "better": true, "bug": true, "other": true}
	Statuses = map[string]bool{"new": true, "review": true, "planned": true, "done": true, "declined": true}
	Zones    = map[string]bool{"Emploi du temps": true, "Mails": true, "Moodle": true, "Raccourcis": true, "Connexion": true, "Abonnement iCal": true, "Autre": true}
)

const maxItems = 10000

type Item struct {
	ID        int       `json:"id"`
	Created   time.Time `json:"created"`
	Updated   time.Time `json:"updated"`
	Type      string    `json:"type"`
	Zone      string    `json:"zone"`
	Title     string    `json:"title"`
	Desc      string    `json:"desc"`
	Tech      string    `json:"tech,omitempty"`
	Author    string    `json:"author,omitempty"` // identifiant déclaré par la page, non vérifié
	Status    string    `json:"status"`
	Reply     string    `json:"reply,omitempty"`
	Note      string    `json:"note,omitempty"` // note interne, jamais montrée à l'étudiant
	TokenHash string    `json:"tokenHash"`
}

// Public est ce que l'étudiant voit de ses propres propositions.
type Public struct {
	ID      int       `json:"id"`
	Created time.Time `json:"created"`
	Type    string    `json:"type"`
	Zone    string    `json:"zone"`
	Title   string    `json:"title"`
	Status  string    `json:"status"`
	Reply   string    `json:"reply,omitempty"`
}

type Store struct {
	mu    sync.Mutex
	path  string
	items []Item
}

// Open charge (ou crée) le fichier des retours.
func Open(dir string) (*Store, error) {
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return nil, err
	}
	s := &Store{path: filepath.Join(dir, "feedback.json")}
	raw, err := os.ReadFile(s.path)
	if errors.Is(err, os.ErrNotExist) {
		return s, nil
	}
	if err != nil {
		return nil, err
	}
	if err := json.Unmarshal(raw, &s.items); err != nil {
		return nil, err
	}
	return s, nil
}

// save écrit de façon atomique : fichier temporaire, synchronisation disque, renommage.
func (s *Store) save() error {
	raw, err := json.MarshalIndent(s.items, "", " ")
	if err != nil {
		return err
	}
	tmp, err := os.CreateTemp(filepath.Dir(s.path), ".feedback-*")
	if err != nil {
		return err
	}
	defer os.Remove(tmp.Name())
	if _, err := tmp.Write(raw); err != nil {
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
	return os.Rename(tmp.Name(), s.path)
}

// clean retire les caractères de contrôle (sauf saut de ligne dans les textes longs) et coupe.
func clean(s string, max int, multiline bool) string {
	s = strings.TrimSpace(strings.ToValidUTF8(s, ""))
	var b strings.Builder
	n := 0
	for _, r := range s {
		if unicode.IsControl(r) && !(multiline && r == '\n') {
			continue
		}
		if n == max {
			break
		}
		b.WriteRune(r)
		n++
	}
	return b.String()
}

func token() (raw, hash string) {
	b := make([]byte, 32)
	rand.Read(b)
	raw = base64.RawURLEncoding.EncodeToString(b)
	sum := sha256.Sum256([]byte(raw))
	return raw, hex.EncodeToString(sum[:])
}

func hashToken(t string) string {
	sum := sha256.Sum256([]byte(t))
	return hex.EncodeToString(sum[:])
}

type NewItem struct {
	Type   string `json:"type"`
	Zone   string `json:"zone"`
	Title  string `json:"title"`
	Desc   string `json:"desc"`
	Tech   string `json:"tech"`
	Author string `json:"author"`
}

var ErrInvalid = errors.New("proposition incomplète ou invalide")
var ErrFull = errors.New("trop de propositions enregistrées")

func validAuthor(a string) bool {
	if a == "" {
		return true
	}
	if utf8.RuneCountInString(a) > 64 {
		return false
	}
	for _, r := range a {
		if !(r == '.' || r == '-' || r == '_' || r == '@' || r < 128 && (unicode.IsLetter(r) || unicode.IsDigit(r))) {
			return false
		}
	}
	return true
}

// Add enregistre une proposition et rend son numéro et le jeton secret de son auteur.
func (s *Store) Add(in NewItem) (int, string, error) {
	in.Title = clean(in.Title, 80, false)
	in.Desc = clean(in.Desc, 1000, true)
	in.Tech = clean(in.Tech, 200, false)
	in.Author = clean(in.Author, 64, false)
	if !Types[in.Type] || !Zones[in.Zone] || in.Title == "" || in.Desc == "" || !validAuthor(in.Author) {
		return 0, "", ErrInvalid
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if len(s.items) >= maxItems {
		return 0, "", ErrFull
	}
	id := 1
	if n := len(s.items); n > 0 {
		id = s.items[n-1].ID + 1
	}
	raw, hash := token()
	now := time.Now().UTC().Truncate(time.Second)
	s.items = append(s.items, Item{
		ID: id, Created: now, Updated: now, Type: in.Type, Zone: in.Zone, Title: in.Title, Desc: in.Desc,
		Tech: in.Tech, Author: in.Author, Status: "new", TokenHash: hash,
	})
	if err := s.save(); err != nil {
		s.items = s.items[:len(s.items)-1]
		return 0, "", err
	}
	return id, raw, nil
}

// Mine rend les propositions dont la page détient le jeton.
func (s *Store) Mine(tokens []string) []Public {
	want := map[string]bool{}
	for _, t := range tokens {
		if len(t) >= 32 && len(t) <= 64 {
			want[hashToken(t)] = true
		}
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	out := []Public{}
	for _, it := range s.items {
		if want[it.TokenHash] {
			out = append(out, Public{ID: it.ID, Created: it.Created, Type: it.Type, Zone: it.Zone, Title: it.Title, Status: it.Status, Reply: it.Reply})
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].ID > out[j].ID })
	return out
}

// All rend tout, pour l'administration (sans les empreintes de jetons).
func (s *Store) All() []Item {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := make([]Item, len(s.items))
	for i, it := range s.items {
		it.TokenHash = ""
		out[len(s.items)-1-i] = it
	}
	return out
}

type Update struct {
	Status string `json:"status"`
	Reply  string `json:"reply"`
	Note   string `json:"note"`
}

var ErrNotFound = errors.New("proposition introuvable")

func (s *Store) Update(id int, u Update) (Item, error) {
	if !Statuses[u.Status] {
		return Item{}, ErrInvalid
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	for i := range s.items {
		if s.items[i].ID != id {
			continue
		}
		prev := s.items[i]
		s.items[i].Status = u.Status
		s.items[i].Reply = clean(u.Reply, 1000, true)
		s.items[i].Note = clean(u.Note, 1000, true)
		s.items[i].Updated = time.Now().UTC().Truncate(time.Second)
		if err := s.save(); err != nil {
			s.items[i] = prev
			return Item{}, err
		}
		out := s.items[i]
		out.TokenHash = ""
		return out, nil
	}
	return Item{}, ErrNotFound
}
