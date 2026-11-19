package calendar

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"net/http"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"isishub/internal/visitor"
)

// ------------------------------------------------------------ fabrication du fichier .ics

var (
	eventBlock = regexp.MustCompile(`(?s)BEGIN:VEVENT\r?\n.*?END:VEVENT(?:\r?\n)?`)
	startCal   = regexp.MustCompile(`^BEGIN:VCALENDAR\r?\n`)
	endCal     = regexp.MustCompile(`END:VCALENDAR\s*$`)
	unfold     = regexp.MustCompile(`\r?\n[ \t]`)
	lineSplit  = regexp.MustCompile(`\r?\n`)
	unescape   = regexp.MustCompile(`\\([nN,;\\])`)
	methodLine = regexp.MustCompile(`(?m)^METHOD:[^\r\n\x{2028}\x{2029}]*\r?\n`)
	nameLine   = regexp.MustCompile(`(?m)^X-WR-CALNAME:[^\r\n\x{2028}\x{2029}]*\r?\n`)
	ttlLine    = regexp.MustCompile(`(?m)^X-PUBLISHED-TTL:[^\r\n\x{2028}\x{2029}]*\r?\n`)
)

type event struct {
	raw                              string
	uid, summary, description, start string
}

// fields reproduit fieldsOf() : seulement les lignes de la séance elle-même (pas des alarmes).
func fields(raw string) event {
	ev := event{raw: strings.TrimRightFunc(raw, isSpace)}
	depth := 0
	for _, line := range lineSplit.Split(unfold.ReplaceAllString(raw, ""), -1) {
		if strings.HasPrefix(line, "BEGIN:") {
			depth++
			continue
		}
		if strings.HasPrefix(line, "END:") {
			depth--
			continue
		}
		i := strings.Index(line, ":")
		if depth != 1 || i < 0 {
			continue
		}
		key := strings.ToUpper(strings.SplitN(line[:i], ";", 2)[0])
		value := unescape.ReplaceAllStringFunc(line[i+1:], func(m string) string {
			if m[1] == 'n' || m[1] == 'N' {
				return "\n"
			}
			return m[1:]
		})
		switch key {
		case "UID":
			ev.uid = value
		case "SUMMARY":
			ev.summary = value
		case "DESCRIPTION":
			ev.description = value
		case "DTSTART":
			ev.start = value
		}
	}
	return ev
}

func replaceFirst(re *regexp.Regexp, s string) string {
	if loc := re.FindStringIndex(s); loc != nil {
		return s[:loc[0]] + s[loc[1]:]
	}
	return s
}

// Variant : un calendrier publié (clé de l'URL, choix, nom affiché).
type Variant struct {
	Key    string
	Choice Choice
	Name   string
}

var shortTrack = map[string]string{"ia": "IA", "developpement": "Développement", "management": "Management", "commun": "Cursus commun"}

// Variants énumère les calendriers d'une classe, avec les mêmes URL que le projet de référence.
func Variants(promo string, c Class) []Variant { return VariantsWith(promo, c, nil) }

func trackName(t string, labels map[string]string) string {
	if n, ok := shortTrack[t]; ok {
		return n
	}
	if n, ok := labels[t]; ok {
		return n
	}
	return t
}

func sortedTracks(c Class) []string {
	// Ordre du projet de référence pour les trois parcours connus, puis ordre alphabétique.
	known := []string{"ia", "developpement", "management"}
	var out []string
	for _, t := range known {
		if _, ok := c.Tracks[t]; ok {
			out = append(out, t)
		}
	}
	var rest []string
	for t := range c.Tracks {
		if !contains(known, t) {
			rest = append(rest, t)
		}
	}
	sort.Strings(rest)
	return append(out, rest...)
}

// VariantsWith : idem, avec les noms de parcours ajoutés dans l'administration.
func VariantsWith(promo string, c Class, labels map[string]string) []Variant {
	P := strings.ToUpper(promo)
	var out []Variant
	switch c.Filter {
	case "groupLanguage":
		for _, g := range []int{1, 2} {
			if c.LinkedLanguage {
				lang := map[bool]string{true: "chinois", false: "espagnol"}[g == 1]
				out = append(out, Variant{strconv.Itoa(g), Choice{Group: g}, fmt.Sprintf("ISIS %s · G%d · %s", P, g, lang)})
				continue
			}
			for _, lang := range []string{"chinois", "espagnol"} {
				out = append(out, Variant{fmt.Sprintf("%d/%s", g, lang), Choice{Group: g, Language: lang}, fmt.Sprintf("ISIS %s · G%d · %s", P, g, lang)})
			}
		}
	case "fie4":
		for _, t := range sortedTracks(c) {
			for _, g := range []int{1, 2} {
				out = append(out, Variant{fmt.Sprintf("%s/%d", t, g), Choice{Track: t, Group: g}, fmt.Sprintf("ISIS %s · %s · G%d", P, trackName(t, labels), g)})
			}
		}
	case "fie5":
		for _, t := range sortedTracks(c) {
			out = append(out, Variant{t, Choice{Track: t}, fmt.Sprintf("ISIS %s · %s", P, trackName(t, labels))})
		}
	}
	return out
}

// Build produit le fichier .ics d'une variante à partir de l'export ADE complet de la classe,
// exactement comme le projet de référence (propriétés des séances conservées telles quelles).
func Build(text string, c Class, v Variant) (string, int, error) {
	if len(text) > 2_000_000 || !startCal.MatchString(text) || !endCal.MatchString(text) {
		return "", 0, errors.New("calendrier ADE invalide")
	}
	var events []event
	seen := map[string]bool{}
	var bad error
	shell := eventBlock.ReplaceAllStringFunc(text, func(raw string) string {
		ev := fields(raw)
		if ev.uid == "" || ev.start == "" {
			bad = errors.New("séance incomplète")
		}
		// Le projet de référence ne dédoublonne pas les séances de FIE4.
		if c.Filter == "fie4" || !seen[ev.uid] {
			seen[ev.uid] = true
			events = append(events, ev)
		}
		return ""
	})
	if bad != nil {
		return "", 0, bad
	}
	if len(events) == 0 || strings.Contains(shell, "BEGIN:VEVENT") || strings.Contains(shell, "END:VEVENT") {
		return "", 0, errors.New("calendrier ADE vide ou abîmé")
	}
	if c.Filter == "fie4" && len(events) != strings.Count(text, "BEGIN:VEVENT") {
		return "", 0, errors.New("calendrier ADE abîmé")
	}
	base := replaceFirst(methodLine, shell)
	base = replaceFirst(nameLine, base)
	base = replaceFirst(ttlLine, base)
	base = strings.TrimRightFunc(endCal.ReplaceAllString(base, ""), isSpace)

	lines := []string{base, "METHOD:PUBLISH", "X-WR-CALNAME:" + v.Name, "X-PUBLISHED-TTL:PT15M"}
	count := 0
	for _, ev := range events {
		if Keep(c, v.Choice, ev.summary, ev.description) {
			lines = append(lines, ev.raw)
			count++
		}
	}
	lines = append(lines, "END:VCALENDAR", "")
	return strings.Join(lines, "\r\n"), count, nil
}

// ------------------------------------------------------------ service

const refresh = 15 * time.Minute

var errUnreadable = errors.New("calendrier ADE illisible")

// retryAfterFailure : ADE injoignable et rien en cache : on ne le relance pas à chaque requête.
const retryAfterFailure = 2 * time.Minute

type source struct {
	mu       sync.Mutex
	text     string
	fetched  time.Time
	failedAt time.Time
	failErr  error
	version  int              // change à chaque nouvel export lu
	built    map[string]built // calendrier par variante, pour la version en cours
}

// built : calendrier déjà construit, servi tel quel (et 304) tant que l'export ne change pas.
type built struct {
	ics  string
	etag string
}

type Service struct {
	mu         sync.RWMutex
	data       Data
	client     *http.Client
	sources    map[string]*source
	ADEBase    string // https://adecampus.univ-jfc.fr (remplaçable pour les tests)
	TrustProxy bool   // adresse du visiteur lue dans X-Forwarded-For (derrière le frontal)
	limit      *visitor.Limiter
}

func New(data Data) *Service {
	s := &Service{
		client:  &http.Client{Timeout: 25 * time.Second},
		ADEBase: "https://adecampus.univ-jfc.fr",
		// Large : les agendas (Google, Apple) relisent les abonnements depuis peu d'adresses.
		limit: visitor.NewLimiter(300, time.Minute),
	}
	s.SetData(data)
	return s
}

// SetData remplace la répartition (modifiée dans l'administration) ; les exports ADE en cache
// sont oubliés, puisque les ressources ont pu changer.
func (s *Service) SetData(data Data) {
	sources := map[string]*source{}
	for key := range data.Classes {
		sources[key] = &source{}
	}
	s.mu.Lock()
	s.data, s.sources = data, sources
	s.mu.Unlock()
}

func (s *Service) adeURL(c Class) string {
	s.mu.RLock()
	project, season := s.data.ProjectID, s.data.Season
	s.mu.RUnlock()
	ids := make([]string, len(c.Resources))
	for i, r := range c.Resources {
		ids[i] = strconv.Itoa(r)
	}
	return fmt.Sprintf("%s/jsp/custom/modules/plannings/anonymous_cal.jsp?resources=%s&projectId=%d&calType=ical&firstDate=%s&lastDate=%s",
		s.ADEBase, strings.Join(ids, ","), project, season.First, season.Last)
}

// text rend l'export ADE de la classe, relu au plus toutes les 15 minutes ; si ADE ne répond pas,
// la dernière version obtenue est servie. La lecture ne dépend pas de la requête du visiteur
// (qui peut s'interrompre) ; après un échec sans rien en cache, ADE n'est pas relancé avant 2 min.
// Appelé avec src.mu verrouillé.
func (s *Service) text(src *source, c Class) (string, error) {
	if src.text != "" && time.Since(src.fetched) < refresh {
		return src.text, nil
	}
	if src.text == "" && src.failErr != nil && time.Since(src.failedAt) < retryAfterFailure {
		return "", src.failErr
	}
	ctx, cancel := context.WithTimeout(context.Background(), 25*time.Second)
	defer cancel()
	req, _ := http.NewRequestWithContext(ctx, http.MethodGet, s.adeURL(c), nil)
	req.Header.Set("User-Agent", "ISIS-Hub")
	res, err := s.client.Do(req)
	if err == nil {
		defer res.Body.Close()
		var body []byte
		body, err = io.ReadAll(io.LimitReader(res.Body, 4<<20))
		if err == nil && (res.StatusCode != http.StatusOK || !startCal.Match(body)) {
			err = fmt.Errorf("ADE a répondu HTTP %d", res.StatusCode)
		}
		if err == nil {
			if string(body) != src.text {
				src.version++
				src.built = nil
			}
			src.text, src.fetched, src.failErr = string(body), time.Now(), nil
			return src.text, nil
		}
	}
	src.failedAt, src.failErr = time.Now(), err
	if src.text != "" {
		src.fetched = time.Now().Add(-refresh + retryAfterFailure) // export gardé, nouvel essai dans 2 min
		return src.text, nil
	}
	return "", err
}

func (s *Service) clientKey(r *http.Request) string {
	if s.TrustProxy {
		if xff := r.Header.Get("X-Forwarded-For"); xff != "" {
			parts := strings.Split(xff, ",")
			return visitor.Key(strings.TrimSpace(parts[len(parts)-1]))
		}
	}
	return visitor.Key(r.RemoteAddr)
}

// ServeHTTP répond à /calendar/<classe>/<choix>.ics (mêmes URL que le projet de référence).
func (s *Service) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		http.Error(w, "méthode non autorisée", http.StatusMethodNotAllowed)
		return
	}
	path := strings.TrimPrefix(r.URL.Path, "/calendar/")
	if !strings.HasSuffix(path, ".ics") {
		http.NotFound(w, r)
		return
	}
	parts := strings.SplitN(strings.TrimSuffix(path, ".ics"), "/", 2)
	promo := strings.ToUpper(parts[0])
	s.mu.RLock()
	c, ok := s.data.Classes[promo]
	labels := s.data.TrackLabels
	s.mu.RUnlock()
	if !ok || len(parts) != 2 {
		http.NotFound(w, r)
		return
	}
	var variant *Variant
	for _, v := range VariantsWith(promo, c, labels) {
		if v.Key == parts[1] {
			v := v
			variant = &v
		}
	}
	if variant == nil {
		http.NotFound(w, r)
		return
	}
	if !s.limit.Allow(s.clientKey(r)) {
		http.Error(w, "trop de requêtes, réessaie dans une minute", http.StatusTooManyRequests)
		return
	}
	s.mu.RLock()
	src := s.sources[promo]
	s.mu.RUnlock()
	// Calendrier construit une fois par variante et par export ADE, puis servi tel quel : une
	// rafale de requêtes ne relance ni ADE ni la construction (expressions régulières, empreinte).
	src.mu.Lock()
	text, err := s.text(src, c)
	cached, hit := src.built[variant.Key]
	if err == nil && !hit {
		var ics string
		if ics, _, err = Build(text, c, *variant); err == nil {
			sum := sha256.Sum256([]byte(ics))
			cached = built{ics: ics, etag: `"` + hex.EncodeToString(sum[:16]) + `"`}
			if src.built == nil {
				src.built = map[string]built{}
			}
			src.built[variant.Key] = cached
		} else {
			err = errUnreadable
		}
	}
	src.mu.Unlock()
	if errors.Is(err, errUnreadable) {
		http.Error(w, "calendrier ADE illisible", http.StatusBadGateway)
		return
	}
	if err != nil {
		http.Error(w, "ADE est injoignable pour l'instant, réessaie plus tard.", http.StatusBadGateway)
		return
	}
	ics, etag := cached.ics, cached.etag
	h := w.Header()
	h.Set("Content-Type", "text/calendar; charset=utf-8")
	h.Set("Cache-Control", "public, max-age=900")
	h.Set("ETag", etag)
	if m := r.Header.Get("If-None-Match"); m == etag || m == "W/"+etag {
		w.WriteHeader(http.StatusNotModified)
		return
	}
	if r.Method == http.MethodHead {
		return
	}
	io.WriteString(w, ics)
}
