package stages

import (
	"bufio"
	"bytes"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"sort"
	"sync"
	"time"
)

// Fichiers, dans le dossier de données :
//   - stages.json : le fichier déposé par l'administration (données personnelles) ;
//   - stages-state.json : rubrique ouverte ou non, date du dépôt, sessions (empreintes des jetons) ;
//   - stages-log.jsonl : journal des fiches ouvertes (qui, quelle structure, quand), 90 jours.
const (
	dataFile  = "stages.json"
	stateFile = "stages-state.json"
	logFile   = "stages-log.jsonl"

	sessionTTL = 30 * 24 * time.Hour
	logKeep    = 90 * 24 * time.Hour
)

type session struct {
	Login   string    `json:"u"`
	Expires time.Time `json:"exp"`
	Admin   bool      `json:"admin,omitempty"`
}

type state struct {
	Enabled  bool               `json:"enabled"`
	Uploaded time.Time          `json:"uploaded,omitzero"`
	Sessions map[string]session `json:"sessions"`
}

// Entry : une fiche ouverte.
type Entry struct {
	At    time.Time `json:"t"`
	Login string    `json:"u"`
	Co    string    `json:"e"`
}

// Store : les données de la rubrique et son état.
type Store struct {
	dir string
	now func() time.Time

	mu        sync.Mutex
	data      *Dataset
	index     []byte               // Index déjà encodé (servi tel quel)
	contacts  map[string][]Contact // contacts de chaque structure (Company.ID)
	names     map[string]string    // nom de chaque structure, pour le journal
	st        state
	lastPrune time.Time
}

// Open lit l'état et le fichier déposé (s'il y en a un) dans dir.
func Open(dir string) (*Store, error) {
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return nil, err
	}
	s := &Store{dir: dir, now: time.Now, st: state{Sessions: map[string]session{}}}
	if b, err := os.ReadFile(filepath.Join(dir, stateFile)); err == nil {
		if err := json.Unmarshal(b, &s.st); err != nil {
			return nil, err
		}
		if s.st.Sessions == nil {
			s.st.Sessions = map[string]session{}
		}
	} else if !errors.Is(err, os.ErrNotExist) {
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
	s.mu.Lock()
	s.pruneLog()
	s.mu.Unlock()
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
	s.names = map[string]string{}
	for _, c := range d.Companies {
		s.names[c.ID] = c.N
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

// Delete efface le fichier déposé et ferme la rubrique. Le journal reste (90 jours).
func (s *Store) Delete() error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if err := os.Remove(filepath.Join(s.dir, dataFile)); err != nil && !errors.Is(err, os.ErrNotExist) {
		return err
	}
	s.data, s.index, s.contacts, s.names = nil, nil, nil, nil
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

// NewSession ouvre une session pour login et rend son jeton (le serveur n'en garde que l'empreinte).
func (s *Store) NewSession(login string, admin bool) (string, error) {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	tok := base64.RawURLEncoding.EncodeToString(b)
	s.mu.Lock()
	defer s.mu.Unlock()
	s.st.Sessions[hashToken(tok)] = session{Login: login, Expires: s.now().Add(sessionTTL), Admin: admin}
	return tok, s.saveState()
}

// Session rend la session d'un jeton (ok = false si inconnue ou expirée).
func (s *Store) Session(tok string) (session, bool) {
	if tok == "" {
		return session{}, false
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	v, ok := s.st.Sessions[hashToken(tok)]
	if !ok || s.now().After(v.Expires) {
		return session{}, false
	}
	return v, true
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

// Contacts : contacts de la structure id, ok = false si elle n'existe pas. L'ouverture est inscrite
// au journal au nom de login.
func (s *Store) Contacts(id, login string) ([]Contact, bool, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.data == nil {
		return nil, false, nil
	}
	list, ok := s.contacts[id]
	if !ok {
		return nil, false, nil
	}
	if err := s.appendLog(Entry{At: s.now(), Login: login, Co: id}); err != nil {
		return nil, true, err
	}
	if list == nil {
		list = []Contact{}
	}
	return list, true, nil
}

// ------------------------------------------------------------ journal

func (s *Store) appendLog(e Entry) error {
	if s.now().Sub(s.lastPrune) > 24*time.Hour {
		s.pruneLog()
	}
	f, err := os.OpenFile(filepath.Join(s.dir, logFile), os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o600)
	if err != nil {
		return err
	}
	b, _ := json.Marshal(e)
	_, err = f.Write(append(b, '\n'))
	if cerr := f.Close(); err == nil {
		err = cerr
	}
	return err
}

func (s *Store) readLog() []Entry {
	f, err := os.Open(filepath.Join(s.dir, logFile))
	if err != nil {
		return nil
	}
	defer f.Close()
	var out []Entry
	sc := bufio.NewScanner(f)
	sc.Buffer(make([]byte, 64<<10), 1<<20)
	for sc.Scan() {
		var e Entry
		if json.Unmarshal(sc.Bytes(), &e) == nil {
			out = append(out, e)
		}
	}
	return out
}

// pruneLog réécrit le journal sans les entrées de plus de 90 jours (verrou tenu).
func (s *Store) pruneLog() {
	now := s.now()
	s.lastPrune = now
	all := s.readLog()
	keep := all[:0]
	for _, e := range all {
		if now.Sub(e.At) <= logKeep {
			keep = append(keep, e)
		}
	}
	if len(keep) == len(all) {
		return
	}
	var buf bytes.Buffer
	for _, e := range keep {
		b, _ := json.Marshal(e)
		buf.Write(append(b, '\n'))
	}
	writeAtomic(filepath.Join(s.dir, logFile), buf.Bytes())
}

// LogView : le journal vu par l'administration.
type LogView struct {
	Recent []LogLine `json:"recent"` // les plus récentes d'abord
	Top    []LogUser `json:"top"`    // comptes qui ont ouvert le plus de fiches (7 derniers jours)
	Total  int       `json:"total"`  // entrées gardées (90 jours)
}

// LogLine : une ligne du journal, avec le nom de la structure.
type LogLine struct {
	At    time.Time `json:"at"`
	Login string    `json:"login"`
	Co    string    `json:"co"`
	Name  string    `json:"name"`
}

// LogUser : fiches ouvertes par un compte.
type LogUser struct {
	Login    string `json:"login"`
	Opens    int    `json:"opens"`    // ouvertures sur 7 jours
	Distinct int    `json:"distinct"` // structures différentes
	Today    int    `json:"today"`    // ouvertures depuis 24 h
}

// Log rend les n dernières ouvertures et les comptes les plus actifs.
func (s *Store) Log(n int) LogView {
	s.mu.Lock()
	defer s.mu.Unlock()
	all := s.readLog()
	now := s.now()
	v := LogView{Total: len(all), Recent: []LogLine{}, Top: []LogUser{}}
	for i := len(all) - 1; i >= 0 && len(v.Recent) < n; i-- {
		e := all[i]
		v.Recent = append(v.Recent, LogLine{At: e.At, Login: e.Login, Co: e.Co, Name: s.names[e.Co]})
	}
	users := map[string]*LogUser{}
	distinct := map[string]map[string]bool{}
	for _, e := range all {
		if now.Sub(e.At) > 7*24*time.Hour {
			continue
		}
		u := users[e.Login]
		if u == nil {
			u = &LogUser{Login: e.Login}
			users[e.Login] = u
			distinct[e.Login] = map[string]bool{}
		}
		u.Opens++
		if now.Sub(e.At) <= 24*time.Hour {
			u.Today++
		}
		distinct[e.Login][e.Co] = true
	}
	for login, u := range users {
		u.Distinct = len(distinct[login])
		v.Top = append(v.Top, *u)
	}
	sort.Slice(v.Top, func(i, j int) bool {
		if v.Top[i].Opens != v.Top[j].Opens {
			return v.Top[i].Opens > v.Top[j].Opens
		}
		return v.Top[i].Login < v.Top[j].Login
	})
	if len(v.Top) > 20 {
		v.Top = v.Top[:20]
	}
	return v
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
	Sessions  int            `json:"sessions"`
}

// Status rend l'état de la rubrique.
func (s *Store) Status() Status {
	s.mu.Lock()
	defer s.mu.Unlock()
	now := s.now()
	v := Status{Enabled: s.st.Enabled && s.data != nil, HasData: s.data != nil, Uploaded: s.st.Uploaded}
	for _, x := range s.st.Sessions {
		if !now.After(x.Expires) {
			v.Sessions++
		}
	}
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
