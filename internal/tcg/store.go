package tcg

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"
	_ "time/tzdata" // heure de Paris exacte (changement d'heure) même dans l'image « scratch »
	"unicode/utf8"
)

// Paris : jours de jeu, booster du jour et dates du calendrier.
var Paris = func() *time.Location {
	if loc, err := time.LoadLocation("Europe/Paris"); err == nil {
		return loc
	}
	return time.FixedZone("CET", 3600)
}()

// BoosterHour : heure (Paris) à laquelle un nouveau booster est disponible chaque jour.
const BoosterHour = 6

const (
	saveEvery      = 2 * time.Second
	sessionTTL     = 180 * 24 * time.Hour
	feedKeep       = 60
	tradesKeep     = 30
	maxPlayers     = 20_000
	maxPending     = 3_000 // propositions en attente, au total
	blockedPurge   = 7 * 24 * time.Hour
	removedPurge   = 30 * 24 * time.Hour // carte retirée du jeu : « Restaurer » possible pendant 30 jours
	boosterDaysKep = 30
)

var (
	ErrNotFound  = errors.New("introuvable")
	ErrInvalid   = errors.New("requête invalide")
	ErrForbidden = errors.New("refusé")
)

// Error : erreur présentable à l'étudiant (message en français).
type Error struct {
	Status int
	Msg    string
}

func (e *Error) Error() string { return e.Msg }

func userErr(status int, format string, a ...any) error {
	return &Error{Status: status, Msg: fmt.Sprintf(format, a...)}
}

// Game : l'état du jeu, en mémoire, écrit dans tcg.json.
type Game struct {
	mu     sync.Mutex
	wmu    sync.Mutex // une écriture de tcg.json à la fois, dans l'ordre
	path   string
	st     *state
	dirty  bool
	key    []byte // secret des empreintes d'identifiants
	now    func() time.Time
	rnd    func(n int) int // hasard (remplaçable dans les tests)
	trades *trades
	Blobs  Blobs
	// Recovered : sauvegarde reprise au démarrage (tcg.json absent ou abîmé), "" sinon.
	Recovered  string
	lastBackup string
}

// Open charge (ou crée) le jeu. `pepper` : VAULT_PEPPER ; vide = un secret aléatoire gardé dans le
// dossier de données (développement).
func Open(dir, pepper string, blobs Blobs) (*Game, error) {
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return nil, err
	}
	g := &Game{path: filepath.Join(dir, "tcg.json"), now: time.Now, rnd: cryptoIntn, Blobs: blobs}
	g.trades = newTrades()
	key, err := playerKey(dir, pepper)
	if err != nil {
		return nil, err
	}
	g.key = key
	raw, err := os.ReadFile(g.path)
	switch {
	case errors.Is(err, os.ErrNotExist):
		// Pas de tcg.json : premier démarrage, ou fichier perdu (on reprend alors la dernière
		// sauvegarde du jour, s'il y en a une).
		g.st = &state{}
		if st, name := latestBackup(dir); st != nil {
			g.st, g.Recovered, g.dirty = st, name, true
		}
	case err != nil:
		return nil, err
	default:
		g.st = &state{}
		if err := json.Unmarshal(raw, g.st); err != nil {
			// tcg.json abîmé : gardé de côté, dernière sauvegarde reprise. Sans sauvegarde, le
			// serveur refuse de démarrer plutôt que de repartir d'un jeu vide qui écraserait tout.
			st, name := latestBackup(dir)
			if st == nil {
				return nil, fmt.Errorf("tcg.json illisible et aucune sauvegarde dans tcg-backups/ : %w", err)
			}
			os.Rename(g.path, g.path+".abime-"+time.Now().UTC().Format("20060102-150405"))
			g.st, g.Recovered, g.dirty = st, name, true
		}
	}
	g.normalize()
	return g, nil
}

const backupsKeep = 14

func backupDir(dir string) string { return filepath.Join(dir, "tcg-backups") }

// latestBackup : la plus récente sauvegarde lisible de tcg-backups/ (nil si aucune).
func latestBackup(dir string) (*state, string) {
	entries, err := os.ReadDir(backupDir(dir))
	if err != nil {
		return nil, ""
	}
	var names []string
	for _, e := range entries {
		if n := e.Name(); strings.HasPrefix(n, "tcg-") && strings.HasSuffix(n, ".json") {
			names = append(names, n)
		}
	}
	sort.Sort(sort.Reverse(sort.StringSlice(names)))
	for _, n := range names {
		raw, err := os.ReadFile(filepath.Join(backupDir(dir), n))
		if err != nil {
			continue
		}
		st := &state{}
		if json.Unmarshal(raw, st) == nil {
			return st, n
		}
	}
	return nil, ""
}

// backup : une copie de tcg.json par jour dans tcg-backups/ (14 jours gardés), en plus du fichier
// courant : une erreur de manipulation ou un fichier abîmé ne fait perdre au pire qu'une journée.
// Même contenu que tcg.json (aucun identifiant universitaire, jetons de session hachés).
func (g *Game) backup(raw []byte) {
	day := calendarDay(g.now())
	if g.lastBackup == day {
		return
	}
	dir := backupDir(filepath.Dir(g.path))
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return
	}
	if err := writeAtomic(filepath.Join(dir, "tcg-"+day+".json"), raw); err != nil {
		return
	}
	g.lastBackup = day
	entries, _ := os.ReadDir(dir)
	var names []string
	for _, e := range entries {
		if n := e.Name(); strings.HasPrefix(n, "tcg-") && strings.HasSuffix(n, ".json") {
			names = append(names, n)
		}
	}
	sort.Strings(names)
	for len(names) > backupsKeep {
		os.Remove(filepath.Join(dir, names[0]))
		names = names[1:]
	}
}

// playerKey : clé HMAC des identifiants. Tirée de VAULT_PEPPER (hors du dossier de données) : une
// copie du dossier ne permet pas de retrouver qui joue en essayant des identifiants.
func playerKey(dir, pepper string) ([]byte, error) {
	if pepper != "" {
		m := hmac.New(sha256.New, []byte(pepper))
		m.Write([]byte("isis-hub tcg joueur v1"))
		return m.Sum(nil), nil
	}
	p := filepath.Join(dir, "tcg.key")
	if raw, err := os.ReadFile(p); err == nil && len(raw) == 32 {
		return raw, nil
	}
	k := make([]byte, 32)
	if _, err := rand.Read(k); err != nil {
		return nil, err
	}
	return k, os.WriteFile(p, k, 0o600)
}

func (g *Game) normalize() {
	st := g.st
	if st.Season.Name == "" {
		st.Season = defaultSeason()
	}
	if st.Season.Runs == nil {
		st.Season.Runs = defaultSeason().Runs
	}
	if st.Season.PaceDays <= 0 {
		st.Season.PaceDays = 14
	}
	if st.Season.PerDay <= 0 {
		st.Season.PerDay = 3
	}
	if st.Cards == nil {
		st.Cards = map[string]*Card{}
	}
	if st.Players == nil {
		st.Players = map[string]*Player{}
	}
	if st.Keys == nil {
		st.Keys = map[string]string{}
	}
	if st.Sessions == nil {
		st.Sessions = map[string]session{}
	}
	if st.Boosters == nil {
		st.Boosters = map[string]int{}
	}
	for _, p := range st.Players {
		if p.Owned == nil {
			p.Owned = map[string][]int{}
		}
		if p.Ballots == nil {
			p.Ballots = map[int][]Ballot{}
		}
	}
	sortWaves(st.Waves)
}

// Run démarre les tâches de fond : écriture régulière, impression des vagues à l'heure, ménage.
func (g *Game) Run(stop <-chan struct{}) {
	save := time.NewTicker(saveEvery)
	tick := time.NewTicker(30 * time.Second)
	defer save.Stop()
	defer tick.Stop()
	g.Tick()
	for {
		select {
		case <-stop:
			g.Flush()
			return
		case <-save.C:
			g.Flush()
		case <-tick.C:
			g.Tick()
		}
	}
}

// Tick : vagues arrivées à leur date imprimées, sessions et images périmées effacées.
func (g *Game) Tick() {
	g.mu.Lock()
	now := g.now()
	for _, w := range g.st.Waves {
		if !w.Printed && !w.ReleaseAt.IsZero() && !now.Before(w.ReleaseAt) {
			g.printWave(w, now)
		}
	}
	for k, s := range g.st.Sessions {
		if now.After(s.Expires) {
			delete(g.st.Sessions, k)
			g.dirty = true
		}
	}
	var purge []string
	for _, c := range g.st.Cards {
		old := (c.Status == StatusBlocked && now.Sub(c.Decided) > blockedPurge) ||
			(c.Status == StatusRemoved && now.Sub(c.RemovedAt) > removedPurge)
		if old && !c.Purged {
			purge = append(purge, c.Img, c.Thumb)
			g.st.Used -= c.Bytes
			c.Purged, c.Img, c.Thumb, c.Bytes = true, "", "", 0
			g.dirty = true
		}
	}
	for d := range g.st.Boosters {
		if t, err := time.ParseInLocation("2006-01-02", d, Paris); err == nil && now.Sub(t) > boosterDaysKep*24*time.Hour {
			delete(g.st.Boosters, d)
		}
	}
	g.mu.Unlock()
	g.trades.sweep(now)
	for _, name := range purge {
		if name != "" && g.Blobs != nil {
			g.Blobs.Delete(name)
		}
	}
}

// Flush écrit tcg.json s'il a changé.
func (g *Game) Flush() error {
	g.wmu.Lock()
	defer g.wmu.Unlock()
	g.mu.Lock()
	if !g.dirty {
		g.mu.Unlock()
		return nil
	}
	raw, err := json.Marshal(g.st)
	g.dirty = false
	g.mu.Unlock()
	if err != nil {
		return err
	}
	if err := writeAtomic(g.path, raw); err != nil {
		g.mu.Lock()
		g.dirty = true
		g.mu.Unlock()
		return err
	}
	g.backup(raw)
	return nil
}

func writeAtomic(path string, data []byte) error {
	tmp, err := os.CreateTemp(filepath.Dir(path), ".tmp-tcg-*")
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

// ------------------------------------------------------------ outils

func cryptoIntn(n int) int {
	if n <= 1 {
		return 0
	}
	var b [8]byte
	rand.Read(b[:])
	v := uint64(b[0]) | uint64(b[1])<<8 | uint64(b[2])<<16 | uint64(b[3])<<24 | uint64(b[4])<<32 | uint64(b[5])<<40 | uint64(b[6])<<48 | uint64(b[7])<<56
	return int(v % uint64(n))
}

// chance : vrai avec la probabilité p (0 à 1).
func (g *Game) chance(p float64) bool {
	if p <= 0 {
		return false
	}
	if p >= 1 {
		return true
	}
	return float64(g.rnd(1_000_000)) < p*1_000_000
}

func (g *Game) shuffle(ids []string) {
	for i := len(ids) - 1; i > 0; i-- {
		j := g.rnd(i + 1)
		ids[i], ids[j] = ids[j], ids[i]
	}
}

func randomToken() string {
	b := make([]byte, 32)
	rand.Read(b)
	return base64.RawURLEncoding.EncodeToString(b)
}

func hashToken(tok string) string {
	sum := sha256.Sum256([]byte(tok))
	return hex.EncodeToString(sum[:])
}

func randomID(prefix string) string {
	b := make([]byte, 9)
	rand.Read(b)
	return prefix + base64.RawURLEncoding.EncodeToString(b)
}

// DayKey : jour de jeu (Paris), qui commence à BoosterHour.
func DayKey(t time.Time) string {
	return t.In(Paris).Add(-BoosterHour * time.Hour).Format("2006-01-02")
}

// calendarDay : jour calendaire à Paris (quotas de propositions).
func calendarDay(t time.Time) string { return t.In(Paris).Format("2006-01-02") }

// nextBooster : prochaine heure de booster après t.
func nextBooster(t time.Time) time.Time {
	p := t.In(Paris)
	next := time.Date(p.Year(), p.Month(), p.Day(), BoosterHour, 0, 0, 0, Paris)
	if !next.After(p) {
		next = time.Date(p.Year(), p.Month(), p.Day()+1, BoosterHour, 0, 0, 0, Paris)
	}
	return next
}

// cleanText : texte d'une ligne ou d'un paragraphe, sans caractères de contrôle, espaces réduits.
func cleanText(s string, multiline bool) string {
	var b strings.Builder
	for _, r := range s {
		switch {
		case r == '\n' && multiline:
			b.WriteRune(' ')
		case r < 0x20 || r == 0x7f || (r >= 0x200b && r <= 0x200f) || (r >= 0x202a && r <= 0x202e) || (r >= 0x2066 && r <= 0x2069):
			b.WriteRune(' ')
		default:
			b.WriteRune(r)
		}
	}
	return strings.Join(strings.Fields(b.String()), " ")
}

func runes(s string) int { return utf8.RuneCountInString(s) }

// CleanPseudo : nom affiché dans le jeu (2 à 24 caractères).
func CleanPseudo(s string) (string, bool) {
	s = cleanText(s, false)
	n := runes(s)
	return s, n >= 2 && n <= 24
}

func sortWaves(ws []*Wave) {
	for i := 1; i < len(ws); i++ {
		for j := i; j > 0 && ws[j].N < ws[j-1].N; j-- {
			ws[j], ws[j-1] = ws[j-1], ws[j]
		}
	}
}
