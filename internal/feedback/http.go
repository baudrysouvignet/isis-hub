package feedback

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"net"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"
)

// ------------------------------------------------------------ limites de débit

// limiter compte des événements par clé sur une fenêtre glissante, en mémoire seulement.
type limiter struct {
	mu     sync.Mutex
	window time.Duration
	max    int
	hits   map[string][]time.Time
}

func newLimiter(max int, window time.Duration) *limiter {
	return &limiter{window: window, max: max, hits: map[string][]time.Time{}}
}

func (l *limiter) allow(key string) bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	now := time.Now()
	kept := l.hits[key][:0]
	for _, t := range l.hits[key] {
		if now.Sub(t) < l.window {
			kept = append(kept, t)
		}
	}
	if len(kept) >= l.max {
		l.hits[key] = kept
		return false
	}
	l.hits[key] = append(kept, now)
	if len(l.hits) > 10000 { // ménage : on oublie les clés inactives
		for k, v := range l.hits {
			if len(v) == 0 || now.Sub(v[len(v)-1]) > l.window {
				delete(l.hits, k)
			}
		}
	}
	return true
}

// ------------------------------------------------------------ service HTTP

type Config struct {
	Store      *Store
	Content    *ContentStore
	Stats      *Stats      // compteurs anonymes de fréquentation (facultatif)
	Vault      *VaultStore // coffre synchronisé, anonyme et chiffré (facultatif)
	AdminUsers []string    // identifiants universitaires autorisés (ADMIN_USERS) ; vide = pas d'administration
	// CASValidate fait valider un ticket de service par le CAS et rend l'identifiant (voir cas.go).
	CASValidate    func(ctx context.Context, ticket string) (string, error)
	AllowedOrigins []string // vide = même hôte que la requête
	TrustProxy     bool
	SecureCookie   bool
}

type Service struct {
	cfg         Config
	origins     map[string]bool
	submit      *limiter // envois par visiteur
	reads       *limiter // « mes propositions » par visiteur
	loginIP     *limiter // essais de connexion admin par visiteur
	loginAll    *limiter // essais de connexion admin au total
	pings       *limiter // statistiques : ouvertures comptées par visiteur
	vaultReads  *limiter
	vaultWrites *limiter
	mu          sync.Mutex
	sessions    map[string]adminSession // empreinte du jeton → session
}

type adminSession struct {
	user    string
	expires time.Time
}

const sessionTTL = 8 * time.Hour
const cookieName = "hub_admin"

func New(cfg Config) *Service {
	s := &Service{
		cfg: cfg, origins: map[string]bool{}, sessions: map[string]adminSession{},
		submit: newLimiter(5, 10*time.Minute), reads: newLimiter(60, time.Minute),
		loginIP: newLimiter(5, 15*time.Minute), loginAll: newLimiter(30, 15*time.Minute),
		pings: newLimiter(30, time.Hour), vaultReads: newLimiter(120, 10*time.Minute), vaultWrites: newLimiter(240, 10*time.Minute),
	}
	for _, o := range cfg.AllowedOrigins {
		s.origins[strings.TrimRight(o, "/")] = true
	}
	return s
}

func (s *Service) clientIP(r *http.Request) string {
	if s.cfg.TrustProxy {
		if xff := r.Header.Get("X-Forwarded-For"); xff != "" {
			parts := strings.Split(xff, ",")
			return strings.TrimSpace(parts[len(parts)-1])
		}
	}
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
}

// sameOrigin bloque les requêtes envoyées depuis un autre site (CSRF).
func (s *Service) sameOrigin(r *http.Request) bool {
	origin := r.Header.Get("Origin")
	if origin == "" {
		return false
	}
	if len(s.origins) > 0 {
		return s.origins[origin]
	}
	host := r.Host
	if s.cfg.TrustProxy && r.Header.Get("X-Forwarded-Host") != "" {
		host = r.Header.Get("X-Forwarded-Host")
	}
	return origin == "https://"+host || origin == "http://"+host
}

func reply(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(v)
}

func fail(w http.ResponseWriter, status int, msg string) {
	reply(w, status, map[string]string{"error": msg})
}

// readJSON exige une requête JSON du même site, de taille raisonnable.
func (s *Service) readJSON(w http.ResponseWriter, r *http.Request, max int64, v any) bool {
	if r.Method != http.MethodPost {
		fail(w, http.StatusMethodNotAllowed, "POST attendu")
		return false
	}
	if !s.sameOrigin(r) {
		fail(w, http.StatusForbidden, "origine refusée")
		return false
	}
	if !strings.HasPrefix(r.Header.Get("Content-Type"), "application/json") {
		fail(w, http.StatusUnsupportedMediaType, "JSON attendu")
		return false
	}
	dec := json.NewDecoder(io.LimitReader(r.Body, max))
	dec.DisallowUnknownFields()
	if err := dec.Decode(v); err != nil {
		fail(w, http.StatusBadRequest, "requête illisible")
		return false
	}
	return true
}

func (s *Service) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	switch p := r.URL.Path; {
	case p == "/api/feedback":
		s.handleSubmit(w, r)
	case p == "/api/feedback/mine":
		s.handleMine(w, r)
	case p == "/api/content":
		s.handleContent(w, r)
	case p == "/api/classes":
		s.handleClasses(w, r)
	case p == "/api/grades":
		s.handleGrades(w, r)
	case p == "/api/vault":
		s.handleVault(w, r)
	case p == "/api/ping":
		s.handlePing(w, r)
	case strings.HasPrefix(p, "/api/admin/"):
		if !s.AdminEnabled() {
			fail(w, http.StatusNotFound, "inconnu")
			return
		}
		s.handleAdmin(w, r, strings.TrimPrefix(p, "/api/admin/"))
	default:
		fail(w, http.StatusNotFound, "inconnu")
	}
}

func (s *Service) handleSubmit(w http.ResponseWriter, r *http.Request) {
	var in NewItem
	if !s.readJSON(w, r, 8<<10, &in) {
		return
	}
	if !s.submit.allow(s.clientIP(r)) {
		fail(w, http.StatusTooManyRequests, "trop d’envois, réessaie dans quelques minutes")
		return
	}
	id, tok, err := s.cfg.Store.Add(in)
	switch {
	case errors.Is(err, ErrInvalid):
		fail(w, http.StatusBadRequest, err.Error())
	case err != nil:
		fail(w, http.StatusServiceUnavailable, "enregistrement impossible pour l’instant")
	default:
		reply(w, http.StatusCreated, map[string]any{"id": id, "token": tok})
	}
}

func (s *Service) handleMine(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Tokens []string `json:"tokens"`
	}
	if !s.readJSON(w, r, 8<<10, &in) {
		return
	}
	if len(in.Tokens) > 100 || !s.reads.allow(s.clientIP(r)) {
		fail(w, http.StatusTooManyRequests, "trop de demandes")
		return
	}
	reply(w, http.StatusOK, s.cfg.Store.Mine(in.Tokens))
}

// ------------------------------------------------------------ administration

// sessionUser rend l'identifiant de la session administrateur de la requête ("" sinon).
func (s *Service) sessionUser(r *http.Request) string {
	c, err := r.Cookie(cookieName)
	if err != nil || len(c.Value) < 32 {
		return ""
	}
	sum := sha256.Sum256([]byte(c.Value))
	key := hex.EncodeToString(sum[:])
	s.mu.Lock()
	defer s.mu.Unlock()
	sess, ok := s.sessions[key]
	if ok && time.Now().After(sess.expires) {
		delete(s.sessions, key)
		return ""
	}
	if ok && !s.isAdminUser(sess.user) { // identifiant retiré de ADMIN_USERS depuis
		return ""
	}
	return sess.user
}

func (s *Service) session(r *http.Request) bool { return s.sessionUser(r) != "" }

// IsAdmin : la requête porte une session administrateur valide (pour servir la page /admin).
func (s *Service) IsAdmin(r *http.Request) bool { return s.AdminEnabled() && s.session(r) }

func (s *Service) setCookie(w http.ResponseWriter, value string, maxAge int) {
	http.SetCookie(w, &http.Cookie{
		Name: cookieName, Value: value, Path: "/", MaxAge: maxAge,
		HttpOnly: true, Secure: s.cfg.SecureCookie, SameSite: http.SameSiteStrictMode,
	})
}

func (s *Service) handleAdmin(w http.ResponseWriter, r *http.Request, action string) {
	// En-tête maison obligatoire : un autre site ne peut pas l'ajouter sans autorisation CORS.
	if r.Header.Get("X-Hub-Admin") != "1" {
		fail(w, http.StatusForbidden, "en-tête X-Hub-Admin manquant")
		return
	}
	switch {
	case action == "cas":
		var in struct {
			Ticket string `json:"ticket"`
		}
		if !s.readJSON(w, r, 1<<10, &in) {
			return
		}
		if !s.loginIP.allow(s.clientIP(r)) || !s.loginAll.allow("*") {
			fail(w, http.StatusTooManyRequests, "trop d’essais, réessaie dans 15 minutes")
			return
		}
		if !ticketRE.MatchString(in.Ticket) || s.cfg.CASValidate == nil {
			fail(w, http.StatusBadRequest, "ticket invalide")
			return
		}
		user, err := s.cfg.CASValidate(r.Context(), in.Ticket)
		if err != nil || !s.isAdminUser(user) {
			// Même réponse dans tous les cas : rien ne dit si l'identifiant existe.
			fail(w, http.StatusForbidden, "accès refusé")
			return
		}
		b := make([]byte, 32)
		rand.Read(b)
		tok := base64.RawURLEncoding.EncodeToString(b)
		sum := sha256.Sum256([]byte(tok))
		s.mu.Lock()
		for k, sess := range s.sessions {
			if time.Now().After(sess.expires) {
				delete(s.sessions, k)
			}
		}
		s.sessions[hex.EncodeToString(sum[:])] = adminSession{user: user, expires: time.Now().Add(sessionTTL)}
		s.mu.Unlock()
		s.setCookie(w, tok, int(sessionTTL.Seconds()))
		reply(w, http.StatusOK, map[string]string{"user": user})
	case action == "logout":
		if r.Method != http.MethodPost || !s.sameOrigin(r) {
			fail(w, http.StatusForbidden, "refusé")
			return
		}
		if c, err := r.Cookie(cookieName); err == nil {
			sum := sha256.Sum256([]byte(c.Value))
			s.mu.Lock()
			delete(s.sessions, hex.EncodeToString(sum[:]))
			s.mu.Unlock()
		}
		s.setCookie(w, "", -1)
		reply(w, http.StatusOK, map[string]bool{"ok": true})
	case !s.session(r):
		fail(w, http.StatusUnauthorized, "connexion administrateur requise")
	case action == "me":
		reply(w, http.StatusOK, map[string]string{"user": s.sessionUser(r)})
	case s.adminContent(w, r, action):
		// maquettes et raccourcis
	case action == "stats" && r.Method == http.MethodGet:
		if s.cfg.Stats == nil {
			reply(w, http.StatusOK, Summary{})
			return
		}
		reply(w, http.StatusOK, s.cfg.Stats.Summary())
	case action == "feedback" && r.Method == http.MethodGet:
		reply(w, http.StatusOK, s.cfg.Store.All())
	case strings.HasPrefix(action, "feedback/"):
		id, err := strconv.Atoi(strings.TrimPrefix(action, "feedback/"))
		var in Update
		if err != nil || !s.readJSON(w, r, 8<<10, &in) {
			if err != nil {
				fail(w, http.StatusNotFound, "inconnu")
			}
			return
		}
		item, err := s.cfg.Store.Update(id, in)
		switch {
		case errors.Is(err, ErrNotFound):
			fail(w, http.StatusNotFound, err.Error())
		case errors.Is(err, ErrInvalid):
			fail(w, http.StatusBadRequest, "statut inconnu")
		case err != nil:
			fail(w, http.StatusServiceUnavailable, "enregistrement impossible")
		default:
			reply(w, http.StatusOK, item)
		}
	default:
		fail(w, http.StatusNotFound, "inconnu")
	}
}
