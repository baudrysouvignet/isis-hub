package salaires

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
//   - salaires.json : les réponses réduites à leurs tranches (jamais le fichier brut du sondage) ;
//   - salaires-state.json : simulateur ouvert ou non, date du dépôt, sessions.
//
// Rien sur les étudiants qui s'en servent : une session n'est qu'une empreinte de jeton, une date
// d'expiration et « administration ou non » (aperçu avant l'ouverture). Les profils envoyés pour
// le calcul ne sont ni gardés ni notés.
const (
	dataFile  = "salaires.json"
	stateFile = "salaires-state.json"

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

// Store : les réponses, le moteur de calcul et l'état du simulateur.
type Store struct {
	dir string
	now func() time.Time

	mu   sync.Mutex
	data *Dataset
	eng  *engine
	info []byte // Info déjà encodée
	st   state
}

// Open lit l'état et les réponses (s'il y en a) dans dir.
func Open(dir string) (*Store, error) {
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return nil, err
	}
	s := &Store{dir: dir, now: time.Now, st: state{Sessions: map[string]session{}}}
	b, err := os.ReadFile(filepath.Join(dir, stateFile))
	switch {
	case err == nil:
		if err := json.Unmarshal(b, &s.st); err != nil {
			return nil, err
		}
		if s.st.Sessions == nil {
			s.st.Sessions = map[string]session{}
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

// Info : ce que la page reçoit à l'ouverture (catégories, conseils relus, chiffres du sondage).
type Info struct {
	N         int                 `json:"n"`
	Source    string              `json:"source"`
	Extracted string              `json:"extracted"`
	Promos    [2]int              `json:"promos"`
	Grouped   int                 `json:"grouped"`
	Min       int                 `json:"min"`
	Spread    int                 `json:"spread"`
	Mdae      float64             `json:"mdae"`
	Dims      map[string][]string `json:"dims"`
	Adv       []string            `json:"adv"`
	Regions   map[string]string   `json:"regions"` // catégorie → code INSEE (carte)
	Tips      []string            `json:"tips"`
}

func (s *Store) install(d *Dataset) {
	s.data, s.eng = d, newEngine(d)
	in := Info{N: len(d.Rows), Source: d.Source, Extracted: d.Extracted, Promos: d.Promos, Grouped: d.Grouped, Min: MinShow, Spread: MinSpread,
		Mdae: float64(int(s.eng.models[0].mdae*1000+0.5)) / 1000, Dims: map[string][]string{}, Adv: d.Adv, Regions: map[string]string{}, Tips: []string{}}
	for dim := 0; dim < nDims; dim++ {
		in.Dims[dimNames[dim]] = d.Dims.of(dim)
	}
	for _, r := range d.Dims.Region {
		if c, ok := regionCodes[r]; ok {
			in.Regions[r] = c
		}
	}
	for _, t := range d.Tips {
		if t.On {
			in.Tips = append(in.Tips, t.T)
		}
	}
	s.info, _ = json.Marshal(in)
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

// Put installe des réponses (déjà décodées) après les avoir validées.
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

// Data : une copie du fichier gardé (administration : éditeur et téléchargement).
func (s *Store) Data() *Dataset {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.data == nil {
		return nil
	}
	b, _ := json.Marshal(s.data)
	var d Dataset
	json.Unmarshal(b, &d)
	return &d
}

// Delete efface les réponses et ferme le simulateur.
func (s *Store) Delete() error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if err := os.Remove(filepath.Join(s.dir, dataFile)); err != nil && !errors.Is(err, os.ErrNotExist) {
		return err
	}
	s.data, s.eng, s.info = nil, nil, nil
	s.st.Enabled = false
	s.st.Uploaded = time.Time{}
	return s.saveState()
}

// SetEnabled ouvre ou ferme le simulateur aux étudiants.
func (s *Store) SetEnabled(on bool) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if on && s.data == nil {
		return errors.New("dépose d’abord le fichier du sondage")
	}
	s.st.Enabled = on
	return s.saveState()
}

// Enabled : simulateur ouvert (et réponses présentes).
func (s *Store) Enabled() bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.st.Enabled && s.data != nil
}

// N : nombre de réponses (0 sans fichier).
func (s *Store) N() int {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.data == nil {
		return 0
	}
	return len(s.data.Rows)
}

// InfoJSON : Info encodée (nil sans réponses).
func (s *Store) InfoJSON() []byte {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.info
}

// Estimate : le calcul pour un profil ; ok = false sans réponses.
func (s *Store) Estimate(f Profile, target int) (Estimate, bool) {
	s.mu.Lock()
	eng := s.eng
	s.mu.Unlock()
	if eng == nil {
		return Estimate{}, false
	}
	return eng.Estimate(f, target), true
}

// ------------------------------------------------------------ sessions

func hashToken(tok string) string {
	sum := sha256.Sum256([]byte(tok))
	return hex.EncodeToString(sum[:])
}

// NewSession ouvre une session et rend son jeton (le serveur n'en garde que l'empreinte).
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

// Session rend la session d'un jeton et son empreinte (limites de débit, en mémoire).
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

// ------------------------------------------------------------ administration

// Issue : ce qui mérite d'être revu dans une réponse (éditeur de l'administration).
func (d *Dataset) issues(r *Row) []string {
	var out []string
	vague := func(labels []string, v int) bool {
		return v >= 0 && v < len(labels) && (labels[v] == otherLabel[dPoste] || labels[v] == otherLabel[dRegion])
	}
	if vague(d.Dims.Poste, r.Poste) {
		out = append(out, "poste")
	}
	if vague(d.Dims.Region, r.Region) {
		out = append(out, "region")
	}
	if r.Total < r.Base {
		out = append(out, "total")
	}
	return out
}

// Status : l'état vu par l'administration.
type Status struct {
	Enabled   bool      `json:"enabled"`
	HasData   bool      `json:"hasData"`
	Uploaded  time.Time `json:"uploaded,omitzero"`
	Extracted string    `json:"extracted,omitempty"`
	Source    string    `json:"source,omitempty"`
	Promos    [2]int    `json:"promos"`
	Rows      int       `json:"rows"`
	Tips      int       `json:"tips"`
	TipsOn    int       `json:"tipsOn"`
	Issues    int       `json:"issues"` // réponses à revoir (dont imprécises)
	Errors    int       `json:"errors"` // réponses fausses à corriger (total sous le fixe)
	Mdae      float64   `json:"mdae,omitempty"`
	Min       int       `json:"min"`
	Spread    int       `json:"spread"`
}

// Status rend l'état du simulateur.
func (s *Store) Status() Status {
	s.mu.Lock()
	defer s.mu.Unlock()
	v := Status{Enabled: s.st.Enabled && s.data != nil, HasData: s.data != nil, Uploaded: s.st.Uploaded, Min: MinShow, Spread: MinSpread}
	if d := s.data; d != nil {
		v.Extracted, v.Source, v.Promos, v.Rows, v.Tips = d.Extracted, d.Source, d.Promos, len(d.Rows), len(d.Tips)
		for _, t := range d.Tips {
			if t.On {
				v.TipsOn++
			}
		}
		for i := range d.Rows {
			if len(d.issues(&d.Rows[i])) > 0 {
				v.Issues++
			}
			if d.Rows[i].Total < d.Rows[i].Base {
				v.Errors++
			}
		}
		v.Mdae = float64(int(s.eng.models[0].mdae*1000+0.5)) / 1000
	}
	return v
}
