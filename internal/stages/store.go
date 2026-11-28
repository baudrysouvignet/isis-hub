package stages

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"sync"
	"time"
)

// Fichiers, dans le dossier de données :
//   - stages.json : le fichier déposé par l'administration ;
//   - stages-state.json : rubrique ouverte ou non, date du dépôt, sessions.
//
// Rien sur les personnes qui consultent la rubrique : une session n'est qu'une empreinte de jeton,
// une date d'expiration et « administration ou non » (pour l'aperçu avant l'ouverture). Ni
// identifiant, ni journal de ce qui est ouvert. La fréquentation de la rubrique est comptée comme
// celle du Hub (internal/feedback/stats.go : jeton du jour, sans lien vers la personne).
const (
	dataFile  = "stages.json"
	stateFile = "stages-state.json"
	oldLog    = "stages-log.jsonl" // journal de la 3.0.0, effacé à l'ouverture

	sessionTTL = 30 * 24 * time.Hour
)

type session struct {
	Expires time.Time `json:"exp"`
	Admin   bool      `json:"admin,omitempty"`
}

type state struct {
	Enabled  bool               `json:"enabled"`
	Uploaded time.Time          `json:"uploaded,omitzero"`
	Sessions map[string]session `json:"sessions"`
}

// Store : les données de la rubrique et son état.
type Store struct {
	dir string
	now func() time.Time

	mu       sync.Mutex
	data     *Dataset
	index    []byte               // Index déjà encodé (servi tel quel)
	contacts map[string][]Contact // contacts de chaque structure (Company.ID)
	st       state
}

// Open lit l'état et le fichier déposé (s'il y en a un) dans dir. Ce que la 3.0.0 gardait sur les
// personnes (journal des fiches ouvertes, identifiant dans chaque session) est effacé ici.
func Open(dir string) (*Store, error) {
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return nil, err
	}
	s := &Store{dir: dir, now: time.Now, st: state{Sessions: map[string]session{}}}
	if err := os.Remove(filepath.Join(dir, oldLog)); err != nil && !errors.Is(err, os.ErrNotExist) {
		return nil, err
	}
	b, err := os.ReadFile(filepath.Join(dir, stateFile))
	switch {
	case err == nil:
		if err := json.Unmarshal(b, &s.st); err != nil {
			return nil, err
		}
		if s.st.Sessions == nil {
			s.st.Sessions = map[string]session{}
		}
		// Réécrit tout de suite : les sessions ouvertes en 3.0.0 portaient l'identifiant (« u »),
		// le nouveau format ne le connaît plus.
		if err := s.saveState(); err != nil {
			return nil, err
		}
	case !errors.Is(err, os.ErrNotExist):
		return nil, err
	}
	if b, err := os.ReadFile(filepath.Join(dir, dataFile)); err == nil {
		var d Dataset
		if err := json.Unmarshal(b, &d); err != nil {
			return nil, err
		}
		if err := d.Validate(); err != nil {
			return nil, err
		}
		s.install(&d)
	} else if !errors.Is(err, os.ErrNotExist) {
		return nil, err
	}
	return s, nil
}

func (s *Store) install(d *Dataset) {
	s.data = d
	s.index, _ = json.Marshal(d.index())
	byID := map[string]Contact{}
	for _, c := range d.Contacts {
		byID[c.ID] = c
	}
	stage := map[string]Stage{}
	for _, st := range d.Stages {
		stage[st.ID] = st
	}
	s.contacts = map[string][]Contact{}
	for _, c := range d.Companies {
		seen := map[string]bool{}
		var list []Contact
		for _, k := range c.K {
			st := stage[k]
			for _, id := range []string{st.Tu, st.Rh} {
				if id != "" && !seen[id] {
					seen[id] = true
					list = append(list, byID[id])
				}
			}
		}
		s.contacts[c.ID] = list
	}
}

func writeAtomic(path string, data []byte) error {
	tmp, err := os.CreateTemp(filepath.Dir(path), ".tmp-*")
	if err != nil {
		return err
	}
	if _, err := tmp.Write(data); err != nil {
		tmp.Close()
		os.Remove(tmp.Name())
		return err
	}
	if err := tmp.Sync(); err != nil {
		tmp.Close()
		os.Remove(tmp.Name())
		return err
	}
	if err := tmp.Close(); err != nil {
		os.Remove(tmp.Name())
		return err
	}
	if err := os.Chmod(tmp.Name(), 0o600); err != nil {
		os.Remove(tmp.Name())
		return err
	}
	return os.Rename(tmp.Name(), path)
}

func (s *Store) saveState() error {
	now := s.now()
	for k, v := range s.st.Sessions {
		if now.After(v.Expires) {
			delete(s.st.Sessions, k)
		}
	}
	b, err := json.Marshal(s.st)
	if err != nil {
		return err
	}
	return writeAtomic(filepath.Join(s.dir, stateFile), b)
}

// Put installe un nouveau fichier (déjà décodé) après l'avoir validé.
func (s *Store) Put(d *Dataset) error {
	if err := d.Validate(); err != nil {
		return err
	}
	b, err := json.Marshal(d)
	if err != nil {
		return err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if err := writeAtomic(filepath.Join(s.dir, dataFile), b); err != nil {
		return err
	}
	s.install(d)
	s.st.Uploaded = s.now()
	return s.saveState()
}

// Delete efface le fichier déposé et ferme la rubrique.
func (s *Store) Delete() error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if err := os.Remove(filepath.Join(s.dir, dataFile)); err != nil && !errors.Is(err, os.ErrNotExist) {
		return err
	}
	s.data, s.index, s.contacts = nil, nil, nil
	s.st.Enabled = false
	s.st.Uploaded = time.Time{}
	return s.saveState()
}

// SetEnabled ouvre ou ferme la rubrique aux étudiants.
func (s *Store) SetEnabled(on bool) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if on && s.data == nil {
		return errors.New("dépose d’abord un fichier de stages")
	}
	s.st.Enabled = on
	return s.saveState()
}

// Enabled : rubrique ouverte (et données présentes).
func (s *Store) Enabled() bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.st.Enabled && s.data != nil
}

// ------------------------------------------------------------ sessions

func hashToken(tok string) string {
	sum := sha256.Sum256([]byte(tok))
	return hex.EncodeToString(sum[:])
}

// NewSession ouvre une session et rend son jeton (le serveur n'en garde que l'empreinte). Rien de
// la personne : admin dit seulement si l'aperçu avant l'ouverture lui est permis.
func (s *Store) NewSession(admin bool) (string, error) {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	tok := base64.RawURLEncoding.EncodeToString(b)
	s.mu.Lock()
	defer s.mu.Unlock()
	s.st.Sessions[hashToken(tok)] = session{Expires: s.now().Add(sessionTTL), Admin: admin}
	return tok, s.saveState()
}

// Session rend la session d'un jeton (ok = false si inconnue ou expirée) et son empreinte (pour
// les limites de débit, tenues en mémoire).
func (s *Store) Session(tok string) (session, string, bool) {
	if tok == "" {
		return session{}, "", false
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	h := hashToken(tok)
	v, ok := s.st.Sessions[h]
	if !ok || s.now().After(v.Expires) {
		return session{}, "", false
	}
	return v, h, true
}

// EndSession oublie une session.
func (s *Store) EndSession(tok string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	h := hashToken(tok)
	if _, ok := s.st.Sessions[h]; !ok {
		return nil
	}
	delete(s.st.Sessions, h)
	return s.saveState()
}

// ------------------------------------------------------------ lecture

// Index rend la recherche encodée (nil sans données).
func (s *Store) Index() []byte {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.index
}

// Contacts : contacts de la structure id, ok = false si elle n'existe pas. Rien n'est noté.
func (s *Store) Contacts(id string) ([]Contact, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.data == nil {
		return nil, false
	}
	list, ok := s.contacts[id]
	if !ok {
		return nil, false
	}
	if list == nil {
		list = []Contact{}
	}
	return list, true
}

// Status : l'état vu par l'administration.
type Status struct {
	Enabled   bool           `json:"enabled"`
	HasData   bool           `json:"hasData"`
	Uploaded  time.Time      `json:"uploaded,omitzero"`
	Built     string         `json:"built,omitempty"`
	Source    string         `json:"source,omitempty"`
	Meta      map[string]int `json:"meta,omitempty"`
	Places    int            `json:"places"`
	Companies int            `json:"companies"`
	Stages    int            `json:"stages"`
	Contacts  int            `json:"contacts"`
	Mails     int            `json:"mails"` // contacts avec une adresse
}

// Status rend l'état de la rubrique.
func (s *Store) Status() Status {
	s.mu.Lock()
	defer s.mu.Unlock()
	v := Status{Enabled: s.st.Enabled && s.data != nil, HasData: s.data != nil, Uploaded: s.st.Uploaded}
	if d := s.data; d != nil {
		v.Built, v.Source, v.Meta = d.Built, d.Source, d.Meta
		v.Places, v.Companies, v.Stages, v.Contacts = len(d.Places), len(d.Companies), len(d.Stages), len(d.Contacts)
		for _, c := range d.Contacts {
			if c.Mail != "" {
				v.Mails++
			}
		}
	}
	return v
}
