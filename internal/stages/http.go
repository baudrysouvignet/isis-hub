package stages

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net"
	"net/http"
	"strconv"
	"strings"
	"time"

	"isishub/internal/cas"
	"isishub/internal/visitor"
)

// Service : l'API de la rubrique, sous /api/stages/.
//
//	GET  status              rubrique ouverte ? (public, aucune donnée)
//	POST join   {ticket}     ticket CAS validé par l'université → session de cet appareil (cookie)
//	POST leave               oublie la session
//	GET  index               recherche et carte (sans aucune adresse e-mail)
//	GET  structure/<id>      contacts d'une structure, avec leurs adresses ; inscrit au journal
//	… admin/…                administration (session /admin) : état, dépôt, ouverture, journal
type Service struct {
	Store *Store
	// CASValidate fait valider un ticket de service par le CAS (internal/cas).
	CASValidate func(ctx context.Context, ticket string) (cas.Identity, error)
	// IsAdmin : la requête porte une session administrateur (cookie de /admin).
	IsAdmin func(r *http.Request) bool
	// IsAdminUser : identifiant listé dans ADMIN_USERS (aperçu avant l'ouverture).
	IsAdminUser    func(login string) bool
	AllowedOrigins []string
	TrustProxy     bool
	SecureCookie   bool

	joins, joinAll, reads, opens, uploads *visitor.Limiter
	origins                               map[string]bool
}

const cookieName = "hub_stg"

// Init prépare les limites de débit (à appeler une fois).
func (s *Service) Init() *Service {
	// Pas de quota de consultation : la protection repose sur la connexion CAS et le journal. Ces
	// plafonds, très au-dessus d'un usage humain, ne protègent que le serveur.
	s.joins = visitor.NewLimiter(300, 15*time.Minute)    // par adresse (tout un campus derrière une IP)
	s.joinAll = visitor.NewLimiter(2000, 15*time.Minute) // au total (protège le CAS de l'université)
	s.reads = visitor.NewLimiter(240, 10*time.Minute)    // index, par compte
	s.opens = visitor.NewLimiter(1500, 10*time.Minute)   // fiches, par compte
	s.uploads = visitor.NewLimiter(40, time.Hour)        // dépôts, administration
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

// guard : requête qui modifie quelque chose : même site, en-tête maison (anti-CSRF), POST.
func (s *Service) guard(w http.ResponseWriter, r *http.Request) bool {
	if r.Method != http.MethodPost {
		fail(w, http.StatusMethodNotAllowed, "POST attendu")
		return false
	}
	if !s.sameOrigin(r) || r.Header.Get("X-Hub-Stages") != "1" {
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
		Name: cookieName, Value: value, Path: "/api/stages/", MaxAge: maxAge,
		HttpOnly: true, Secure: s.SecureCookie, SameSite: http.SameSiteStrictMode,
	})
}

func (s *Service) session(r *http.Request) (session, string, bool) {
	c, err := r.Cookie(cookieName)
	if err != nil {
		return session{}, "", false
	}
	v, ok := s.Store.Session(c.Value)
	return v, c.Value, ok
}

func (s *Service) admin(r *http.Request) bool { return s.IsAdmin != nil && s.IsAdmin(r) }

// ServeHTTP route les requêtes de /api/stages/.
func (s *Service) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	p := strings.TrimPrefix(r.URL.Path, "/api/stages/")
	switch {
	case p == "status" && r.Method == http.MethodGet:
		reply(w, http.StatusOK, map[string]bool{"enabled": s.Store.Enabled()})
	case p == "join":
		s.handleJoin(w, r)
	case p == "leave":
		if !s.guard(w, r) {
			return
		}
		if _, tok, ok := s.session(r); ok {
			s.Store.EndSession(tok)
		}
		s.setCookie(w, "", -1)
		reply(w, http.StatusOK, map[string]bool{"ok": true})
	case p == "index" && r.Method == http.MethodGet:
		sess, ok := s.reader(w, r)
		if !ok {
			return
		}
		if !s.reads.Allow(sess.Login) {
			fail(w, http.StatusTooManyRequests, "Trop de demandes : réessaie dans quelques minutes.")
			return
		}
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		w.Header().Set("Cache-Control", "no-store")
		w.Write(s.Store.Index())
	case strings.HasPrefix(p, "structure/") && r.Method == http.MethodGet:
		sess, ok := s.reader(w, r)
		if !ok {
			return
		}
		if !s.opens.Allow(sess.Login) {
			fail(w, http.StatusTooManyRequests, "Trop de fiches ouvertes d’affilée : réessaie dans quelques minutes.")
			return
		}
		list, found, err := s.Store.Contacts(strings.TrimPrefix(p, "structure/"), sess.Login)
		switch {
		case err != nil:
			fail(w, http.StatusServiceUnavailable, "indisponible pour l’instant")
		case !found:
			fail(w, http.StatusNotFound, "structure introuvable")
		default:
			reply(w, http.StatusOK, map[string]any{"contacts": list})
		}
	case strings.HasPrefix(p, "admin/"):
		s.handleAdmin(w, r, strings.TrimPrefix(p, "admin/"))
	default:
		fail(w, http.StatusNotFound, "introuvable")
	}
}

// reader : session valable et rubrique ouverte (ou aperçu d'un identifiant de l'administration).
func (s *Service) reader(w http.ResponseWriter, r *http.Request) (session, bool) {
	sess, _, ok := s.session(r)
	if !ok {
		fail(w, http.StatusUnauthorized, "Connecte-toi pour voir les stages.")
		return session{}, false
	}
	if s.Store.Index() == nil || (!s.Store.Enabled() && !sess.Admin) {
		fail(w, http.StatusNotFound, "La rubrique Stages n’est pas ouverte.")
		return session{}, false
	}
	return sess, true
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
		fail(w, http.StatusNotFound, "La rubrique Stages n’est pas ouverte.")
		return
	}
	tok, err := s.Store.NewSession(strings.ToLower(id.User), admin)
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
	case p == "log" && r.Method == http.MethodGet:
		n, _ := strconv.Atoi(r.URL.Query().Get("n"))
		if n <= 0 || n > 1000 {
			n = 200
		}
		reply(w, http.StatusOK, s.Store.Log(n))
	case p == "upload":
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
		var d Dataset
		dec := json.NewDecoder(http.MaxBytesReader(w, r.Body, MaxBytes))
		dec.DisallowUnknownFields()
		if err := dec.Decode(&d); err != nil {
			var tooBig *http.MaxBytesError
			if errors.As(err, &tooBig) {
				fail(w, http.StatusRequestEntityTooLarge, "Fichier trop lourd (12 Mo au plus).")
				return
			}
			fail(w, http.StatusBadRequest, "Fichier illisible : "+err.Error())
			return
		}
		if err := s.Store.Put(&d); err != nil {
			fail(w, http.StatusBadRequest, err.Error())
			return
		}
		reply(w, http.StatusOK, s.Store.Status())
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
