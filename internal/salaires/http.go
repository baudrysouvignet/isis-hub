package salaires

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net"
	"net/http"
	"strings"
	"time"

	"isishub/internal/cas"
	"isishub/internal/visitor"
)

// Service : l'API du simulateur, sous /api/salaires/.
//
//	GET  status              simulateur ouvert ? (public ; le nombre de réponses une fois ouvert)
//	POST join   {ticket}     ticket CAS validé par l'université → session de cet appareil (cookie)
//	POST leave               oublie la session
//	GET  info                catégories, chiffres du sondage, conseils relus
//	POST estimate {f,target} le calcul pour un profil (rien n'est gardé)
//	… admin/…                administration (session /admin) : état, dépôt, éditeur, ouverture
//
// La session ne connaît pas l'identifiant : le ticket CAS prouve seulement que c'est un compte de
// l'université. Les profils envoyés ne sont ni gardés ni notés.
type Service struct {
	Store          *Store
	CASValidate    func(ctx context.Context, ticket string) (cas.Identity, error)
	IsAdmin        func(r *http.Request) bool // session administrateur (cookie de /admin)
	IsAdminUser    func(login string) bool    // identifiant de ADMIN_USERS (aperçu avant l'ouverture)
	AllowedOrigins []string
	TrustProxy     bool
	SecureCookie   bool

	joins, joinAll, reads, calcs, uploads *visitor.Limiter
	origins                               map[string]bool
}

const (
	cookieName = "hub_sal"
	csrfHeader = "X-Hub-Salaires"
)

// Init prépare les limites de débit (à appeler une fois).
func (s *Service) Init() *Service {
	s.joins = visitor.NewLimiter(300, 15*time.Minute)    // par adresse (un campus derrière une IP)
	s.joinAll = visitor.NewLimiter(2000, 15*time.Minute) // au total (protège le CAS)
	s.reads = visitor.NewLimiter(120, 10*time.Minute)    // info, par session
	s.calcs = visitor.NewLimiter(900, 10*time.Minute)    // calculs, par session (bien au-delà d'un usage humain)
	s.uploads = visitor.NewLimiter(60, time.Hour)        // dépôts et enregistrements, administration
	s.origins = map[string]bool{}
	for _, o := range s.AllowedOrigins {
		s.origins[strings.TrimRight(o, "/")] = true
	}
	return s
}

func (s *Service) clientIP(r *http.Request) string {
	if s.TrustProxy {
		if xff := r.Header.Get("X-Forwarded-For"); xff != "" {
			parts := strings.Split(xff, ",")
			return visitor.Key(strings.TrimSpace(parts[len(parts)-1]))
		}
	}
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return visitor.Key(r.RemoteAddr)
	}
	return visitor.Key(host)
}

func (s *Service) sameOrigin(r *http.Request) bool {
	origin := r.Header.Get("Origin")
	if origin == "" {
		return false
	}
	if len(s.origins) > 0 {
		return s.origins[origin]
	}
	host := r.Host
	if s.TrustProxy && r.Header.Get("X-Forwarded-Host") != "" {
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

// guard : POST, même site, en-tête maison (anti-CSRF).
func (s *Service) guard(w http.ResponseWriter, r *http.Request) bool {
	if r.Method != http.MethodPost {
		fail(w, http.StatusMethodNotAllowed, "POST attendu")
		return false
	}
	if !s.sameOrigin(r) || r.Header.Get(csrfHeader) != "1" {
		fail(w, http.StatusForbidden, "origine refusée")
		return false
	}
	return true
}

func (s *Service) readJSON(w http.ResponseWriter, r *http.Request, max int64, v any) bool {
	if !s.guard(w, r) {
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

func (s *Service) setCookie(w http.ResponseWriter, value string, maxAge int) {
	http.SetCookie(w, &http.Cookie{
		Name: cookieName, Value: value, Path: "/api/salaires/", MaxAge: maxAge,
		HttpOnly: true, Secure: s.SecureCookie, SameSite: http.SameSiteStrictMode,
	})
}

func (s *Service) session(r *http.Request) (session, string, string, bool) {
	c, err := r.Cookie(cookieName)
	if err != nil {
		return session{}, "", "", false
	}
	v, key, ok := s.Store.Session(c.Value)
	return v, c.Value, key, ok
}

func (s *Service) admin(r *http.Request) bool { return s.IsAdmin != nil && s.IsAdmin(r) }

// reader : session valable et simulateur ouvert (ou aperçu d'un identifiant de l'administration).
func (s *Service) reader(w http.ResponseWriter, r *http.Request) (string, bool) {
	sess, _, key, ok := s.session(r)
	if !ok {
		fail(w, http.StatusUnauthorized, "Connecte-toi pour ouvrir le simulateur.")
		return "", false
	}
	if s.Store.InfoJSON() == nil || (!s.Store.Enabled() && !sess.Admin) {
		fail(w, http.StatusNotFound, "Le simulateur n’est pas ouvert.")
		return "", false
	}
	return key, true
}

// ServeHTTP route les requêtes de /api/salaires/.
func (s *Service) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	p := strings.TrimPrefix(r.URL.Path, "/api/salaires/")
	switch {
	case p == "status" && r.Method == http.MethodGet:
		on := s.Store.Enabled()
		out := map[string]any{"enabled": on}
		if on {
			out["n"] = s.Store.N()
		}
		reply(w, http.StatusOK, out)
	case p == "join":
		s.handleJoin(w, r)
	case p == "leave":
		if !s.guard(w, r) {
			return
		}
		if _, tok, _, ok := s.session(r); ok {
			s.Store.EndSession(tok)
		}
		s.setCookie(w, "", -1)
		reply(w, http.StatusOK, map[string]bool{"ok": true})
	case p == "info" && r.Method == http.MethodGet:
		key, ok := s.reader(w, r)
		if !ok {
			return
		}
		if !s.reads.Allow(key) {
			fail(w, http.StatusTooManyRequests, "Trop de demandes : réessaie dans quelques minutes.")
			return
		}
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		w.Header().Set("Cache-Control", "no-store")
		w.Write(s.Store.InfoJSON())
	case p == "estimate":
		var in struct {
			F      Profile `json:"f"`
			Target string  `json:"target"`
		}
		if !s.readJSON(w, r, 4<<10, &in) {
			return
		}
		key, ok := s.reader(w, r)
		if !ok {
			return
		}
		if !s.calcs.Allow(key) {
			fail(w, http.StatusTooManyRequests, "Trop de calculs d’affilée : réessaie dans quelques minutes.")
			return
		}
		target := 0
		if in.Target == "total" {
			target = 1
		}
		est, found := s.Store.Estimate(in.F, target)
		if !found {
			fail(w, http.StatusNotFound, "Le simulateur n’est pas ouvert.")
			return
		}
		reply(w, http.StatusOK, est)
	case strings.HasPrefix(p, "admin/"):
		s.handleAdmin(w, r, strings.TrimPrefix(p, "admin/"))
	default:
		fail(w, http.StatusNotFound, "introuvable")
	}
}

func (s *Service) handleJoin(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Ticket string `json:"ticket"`
	}
	if !s.readJSON(w, r, 2<<10, &in) {
		return
	}
	if !s.joins.Allow(s.clientIP(r)) || !s.joinAll.Allow("*") {
		fail(w, http.StatusTooManyRequests, "Trop d’essais : réessaie dans quelques minutes.")
		return
	}
	if !cas.TicketRE.MatchString(in.Ticket) || s.CASValidate == nil {
		fail(w, http.StatusBadRequest, "ticket invalide")
		return
	}
	id, err := s.CASValidate(r.Context(), in.Ticket)
	if err != nil || id.User == "" {
		fail(w, http.StatusForbidden, "Identité non confirmée par l’université : reconnecte-toi au Hub.")
		return
	}
	admin := s.IsAdminUser != nil && s.IsAdminUser(id.User)
	if !s.Store.Enabled() && !admin {
		fail(w, http.StatusNotFound, "Le simulateur n’est pas ouvert.")
		return
	}
	tok, err := s.Store.NewSession(admin) // l'identifiant n'est pas gardé
	if err != nil {
		fail(w, http.StatusServiceUnavailable, "indisponible pour l’instant")
		return
	}
	s.setCookie(w, tok, int(sessionTTL.Seconds()))
	reply(w, http.StatusOK, map[string]bool{"ok": true})
}

func (s *Service) handleAdmin(w http.ResponseWriter, r *http.Request, p string) {
	if !s.admin(r) {
		fail(w, http.StatusForbidden, "session d’administration requise")
		return
	}
	switch {
	case p == "status" && r.Method == http.MethodGet:
		reply(w, http.StatusOK, s.Store.Status())
	case p == "data" && r.Method == http.MethodGet:
		d := s.Store.Data()
		if d == nil {
			fail(w, http.StatusNotFound, "aucun fichier déposé")
			return
		}
		reply(w, http.StatusOK, d)
	case p == "upload" || p == "save":
		// upload : export brut du sondage ou format du Hub ; save : le format du Hub, retouché dans
		// l'éditeur. Les deux sont validés en entier avant de remplacer quoi que ce soit.
		if !s.guard(w, r) {
			return
		}
		if !s.uploads.Allow("admin") {
			fail(w, http.StatusTooManyRequests, "Trop de dépôts : réessaie dans une heure.")
			return
		}
		if !strings.HasPrefix(r.Header.Get("Content-Type"), "application/json") {
			fail(w, http.StatusUnsupportedMediaType, "JSON attendu")
			return
		}
		raw, err := io.ReadAll(http.MaxBytesReader(w, r.Body, MaxBytes))
		if err != nil {
			var tooBig *http.MaxBytesError
			if errors.As(err, &tooBig) {
				fail(w, http.StatusRequestEntityTooLarge, "Fichier trop lourd (4 Mo au plus).")
				return
			}
			fail(w, http.StatusBadRequest, "fichier illisible")
			return
		}
		if p == "save" && IsSurvey(raw) {
			fail(w, http.StatusBadRequest, "format « isis-hub-salaires » attendu")
			return
		}
		d, rep, err := Decode(raw, time.Now())
		if err != nil {
			fail(w, http.StatusBadRequest, err.Error())
			return
		}
		if err := s.Store.Put(d); err != nil {
			fail(w, http.StatusBadRequest, err.Error())
			return
		}
		reply(w, http.StatusOK, map[string]any{"status": s.Store.Status(), "report": rep})
	case p == "enabled":
		var in struct {
			On bool `json:"on"`
		}
		if !s.readJSON(w, r, 256, &in) {
			return
		}
		if err := s.Store.SetEnabled(in.On); err != nil {
			fail(w, http.StatusConflict, err.Error())
			return
		}
		reply(w, http.StatusOK, s.Store.Status())
	case p == "delete":
		if !s.guard(w, r) {
			return
		}
		if err := s.Store.Delete(); err != nil {
			fail(w, http.StatusServiceUnavailable, "suppression impossible")
			return
		}
		reply(w, http.StatusOK, s.Store.Status())
	default:
		fail(w, http.StatusNotFound, "introuvable")
	}
}
