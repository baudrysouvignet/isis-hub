package tcg

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"time"

	"isishub/internal/visitor"
)

// Service : l'API du jeu, sous /api/tcg/.
type Service struct {
	Game *Game
	// CASValidate fait valider un ticket de service par le CAS et rend l'identifiant.
	CASValidate func(ctx context.Context, ticket string) (string, error)
	// IsAdmin : la requête porte une session administrateur (cookie de /admin).
	IsAdmin        func(r *http.Request) bool
	AllowedOrigins []string
	TrustProxy     bool
	SecureCookie   bool

	joins, joinAll, uploads, reads, anonReads, joinsCode, polls *visitor.Limiter
	origins                                                     map[string]bool
}

const cookieName = "hub_tcg"

var (
	ticketRE = regexp.MustCompile(`^ST-[A-Za-z0-9._-]{8,256}$`)
	codeRE   = regexp.MustCompile(`^[A-Z0-9]{4}$`)
)

// Init prépare les limites de débit (à appeler une fois).
func (s *Service) Init() *Service {
	// Tout un campus peut sortir par la même adresse IP (eduroam) : les limites sont comptées par
	// joueur dès qu'il y a une session, et larges par adresse pour ce qui précède la session.
	s.joins = visitor.NewLimiter(300, 15*time.Minute)    // rejoindre le jeu, par adresse
	s.joinAll = visitor.NewLimiter(2000, 15*time.Minute) // au total (protège le CAS de l'université)
	s.uploads = visitor.NewLimiter(30, time.Hour)        // propositions, par joueur
	s.reads = visitor.NewLimiter(600, 10*time.Minute)    // lectures, par joueur
	s.anonReads = visitor.NewLimiter(5000, 10*time.Minute)
	s.joinsCode = visitor.NewLimiter(40, 10*time.Minute) // codes d'échange essayés, par joueur
	s.polls = visitor.NewLimiter(1200, 10*time.Minute)   // suivi d'une table d'échange, par joueur
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

// failErr : erreur du jeu → réponse HTTP.
func failErr(w http.ResponseWriter, err error) {
	var ue *Error
	switch {
	case errors.As(err, &ue):
		fail(w, ue.Status, ue.Msg)
	case errors.Is(err, ErrNotFound):
		fail(w, http.StatusNotFound, "introuvable")
	case errors.Is(err, ErrInvalid):
		fail(w, http.StatusBadRequest, "requête invalide")
	case errors.Is(err, ErrImage):
		fail(w, http.StatusBadRequest, "Photo refusée : utilise une image JPG ou PNG.")
	default:
		fail(w, http.StatusServiceUnavailable, "indisponible pour l’instant")
	}
}

// guard : requête qui modifie quelque chose : même site, en-tête maison (anti-CSRF), POST.
func (s *Service) guard(w http.ResponseWriter, r *http.Request) bool {
	if r.Method != http.MethodPost {
		fail(w, http.StatusMethodNotAllowed, "POST attendu")
		return false
	}
	if !s.sameOrigin(r) || r.Header.Get("X-Hub-TCG") != "1" {
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
		Name: cookieName, Value: value, Path: "/api/tcg/", MaxAge: maxAge,
		HttpOnly: true, Secure: s.SecureCookie, SameSite: http.SameSiteStrictMode,
	})
}

func (s *Service) player(r *http.Request) string {
	c, err := r.Cookie(cookieName)
	if err != nil {
		return ""
	}
	return s.Game.PlayerID(c.Value)
}

func ok(w http.ResponseWriter) { reply(w, http.StatusOK, map[string]bool{"ok": true}) }

// ServeHTTP : /api/tcg/…
func (s *Service) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	p := strings.TrimPrefix(r.URL.Path, "/api/tcg/")
	if strings.HasPrefix(p, "img/") {
		name := strings.TrimPrefix(p, "img/")
		// Photo d'une carte bloquée ou retirée : plus servie à personne, sauf à l'administration.
		if !s.Game.ImageShown(name) && (s.IsAdmin == nil || !s.IsAdmin(r)) {
			w.Header().Set("Cache-Control", "no-store")
			http.NotFound(w, r)
			return
		}
		ServeImage(w, r, s.Game.Blobs, name)
		return
	}
	if strings.HasPrefix(p, "admin/") {
		s.serveAdmin(w, r, strings.TrimPrefix(p, "admin/"))
		return
	}
	if r.Method == http.MethodGet && !strings.HasPrefix(p, "trade/") {
		allowed := false
		if pid := s.player(r); pid != "" {
			allowed = s.reads.Allow(pid)
		} else {
			allowed = s.anonReads.Allow(s.clientIP(r))
		}
		if !allowed {
			fail(w, http.StatusTooManyRequests, "trop de demandes")
			return
		}
	}
	switch p {
	case "public":
		reply(w, http.StatusOK, s.Game.PublicView())
		return
	case "join":
		s.handleJoin(w, r)
		return
	case "logout":
		if !s.guard(w, r) {
			return
		}
		if c, err := r.Cookie(cookieName); err == nil {
			s.Game.Logout(c.Value)
		}
		s.setCookie(w, "", -1)
		ok(w)
		return
	}
	pid := s.player(r)
	if pid == "" {
		fail(w, http.StatusUnauthorized, "rejoins le jeu d’abord")
		return
	}
	switch {
	case p == "state" && r.Method == http.MethodGet:
		v, found := s.Game.PlayerView(pid)
		if !found {
			fail(w, http.StatusUnauthorized, "rejoins le jeu d’abord")
			return
		}
		reply(w, http.StatusOK, v)
	case p == "leave":
		if !s.guard(w, r) {
			return
		}
		if err := s.Game.Leave(pid); err != nil {
			failErr(w, err)
			return
		}
		s.setCookie(w, "", -1)
		ok(w)
	case p == "booster":
		if !s.guard(w, r) {
			return
		}
		pulls, err := s.Game.OpenBooster(pid)
		if err != nil {
			failErr(w, err)
			return
		}
		v, _ := s.Game.PlayerView(pid)
		reply(w, http.StatusOK, map[string]any{"pulls": pulls, "state": v})
	case p == "propose":
		s.handlePropose(w, r, pid)
	case strings.HasPrefix(p, "proposal/") && strings.HasSuffix(p, "/withdraw"):
		if s.guard(w, r) {
			s.result(w, s.Game.Withdraw(pid, strings.TrimSuffix(strings.TrimPrefix(p, "proposal/"), "/withdraw")))
		}
	case p == "jury":
		var in struct {
			Wave   int      `json:"wave"`
			Ballot int      `json:"ballot"`
			Rank   []string `json:"rank"`
		}
		if s.readJSON(w, r, 4<<10, &in) {
			s.result(w, s.Game.Vote(pid, in.Wave, in.Ballot, in.Rank))
		}
	case p == "mail":
		var in struct {
			Email string `json:"email"`
		}
		if s.readJSON(w, r, 1<<10, &in) {
			s.result(w, s.Game.LinkMail(pid, in.Email))
		}
	case p == "consent":
		var in struct {
			Card string `json:"card"`
			OK   bool   `json:"ok"`
		}
		if s.readJSON(w, r, 1<<10, &in) {
			s.result(w, s.Game.Consent(pid, in.Card, in.OK))
		}
	case p == "jury/more":
		if s.guard(w, r) {
			s.result(w, s.Game.MoreBallot(pid))
		}
	case p == "wish":
		var in struct {
			Card string `json:"card"`
			On   bool   `json:"on"`
		}
		if s.readJSON(w, r, 1<<10, &in) {
			s.result(w, s.Game.SetWish(pid, in.Card, in.On))
		}
	case p == "report":
		var in struct {
			Card   string `json:"card"`
			Reason string `json:"reason"`
		}
		if s.readJSON(w, r, 1<<10, &in) {
			s.result(w, s.Game.ReportCard(pid, in.Card, in.Reason))
		}
	case p == "trade/new":
		var in struct {
			Invite string `json:"invite"`
		}
		if !s.readJSON(w, r, 1<<10, &in) {
			return
		}
		code, exp, err := s.Game.NewTrade(pid, in.Invite)
		if err != nil {
			failErr(w, err)
			return
		}
		reply(w, http.StatusOK, map[string]any{"code": code, "expires": exp})
	case p == "trade/join":
		var in struct {
			Code string `json:"code"`
		}
		if !s.readJSON(w, r, 1<<10, &in) {
			return
		}
		in.Code = strings.ToUpper(strings.TrimSpace(in.Code))
		if !codeRE.MatchString(in.Code) {
			fail(w, http.StatusBadRequest, "Le code fait 4 caractères.")
			return
		}
		if !s.joinsCode.Allow(pid) {
			fail(w, http.StatusTooManyRequests, "Trop d’essais : attends quelques minutes.")
			return
		}
		s.result(w, s.Game.JoinTrade(pid, in.Code))
	case strings.HasPrefix(p, "trade/"):
		s.handleTrade(w, r, pid, strings.TrimPrefix(p, "trade/"))
	default:
		fail(w, http.StatusNotFound, "inconnu")
	}
}

func (s *Service) result(w http.ResponseWriter, err error) {
	if err != nil {
		failErr(w, err)
		return
	}
	ok(w)
}

// handleJoin : ticket CAS (pour l'ENT) validé par l'université → session de jeu de cet appareil.
func (s *Service) handleJoin(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Ticket string `json:"ticket"`
		Pseudo string `json:"pseudo"`
	}
	if !s.readJSON(w, r, 2<<10, &in) {
		return
	}
	if !s.joins.Allow(s.clientIP(r)) || !s.joinAll.Allow("*") {
		fail(w, http.StatusTooManyRequests, "Trop d’essais : réessaie dans quelques minutes.")
		return
	}
	if !ticketRE.MatchString(in.Ticket) || s.CASValidate == nil {
		fail(w, http.StatusBadRequest, "ticket invalide")
		return
	}
	login, err := s.CASValidate(r.Context(), in.Ticket)
	if err != nil || login == "" {
		fail(w, http.StatusForbidden, "Identité non confirmée par l’université : reconnecte-toi au Hub.")
		return
	}
	tok, created, err := s.Game.Join(login, in.Pseudo)
	if err != nil {
		failErr(w, err)
		return
	}
	s.setCookie(w, tok, int(sessionTTL.Seconds()))
	reply(w, http.StatusOK, map[string]bool{"created": created})
}

// handlePropose : formulaire (multipart) : titre, description, catégorie, consentements, photo
// (960 × 720) et vignette (320 × 240).
func (s *Service) handlePropose(w http.ResponseWriter, r *http.Request, pid string) {
	if !s.guard(w, r) {
		return
	}
	if !s.uploads.Allow(pid) {
		fail(w, http.StatusTooManyRequests, "Trop d’envois : réessaie dans une heure.")
		return
	}
	if err := s.Game.CheckProposal(pid); err != nil {
		failErr(w, err)
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, MaxImgBytes+MaxThumbBytes+16<<10)
	if err := r.ParseMultipartForm(1 << 20); err != nil {
		fail(w, http.StatusBadRequest, "Envoi incomplet ou trop lourd.")
		return
	}
	defer r.MultipartForm.RemoveAll()
	// Les personnes sur la photo sont indiquées par l'administration à la validation (accord demandé).
	if r.FormValue("consentRights") != "1" {
		fail(w, http.StatusBadRequest, "Confirme que tu as le droit d’utiliser cette photo.")
		return
	}
	title, desc, cat, err := CleanCardText(r.FormValue("title"), r.FormValue("desc"), r.FormValue("cat"))
	if err != nil {
		failErr(w, err)
		return
	}
	read := func(field string, max int) ([]byte, error) {
		f, _, err := r.FormFile(field)
		if err != nil {
			return nil, ErrImage
		}
		defer f.Close()
		b, err := io.ReadAll(io.LimitReader(f, int64(max)+1))
		if err != nil || len(b) > max {
			return nil, ErrImage
		}
		return b, nil
	}
	raw, err := read("photo", MaxImgBytes)
	if err != nil {
		failErr(w, err)
		return
	}
	rawThumb, err := read("thumb", MaxThumbBytes)
	if err != nil {
		failErr(w, err)
		return
	}
	img, err := CheckImage(raw, MaxImgBytes, 960, 720)
	if err != nil {
		failErr(w, err)
		return
	}
	thumb, err := CheckImage(rawThumb, MaxThumbBytes, 320, 240)
	if err != nil {
		failErr(w, err)
		return
	}
	if s.Game.Blobs == nil {
		fail(w, http.StatusServiceUnavailable, "Stockage des photos indisponible.")
		return
	}
	for _, im := range []Image{img, thumb} {
		if err := s.Game.Blobs.Put(im.Name, im.Data, im.Ctype); err != nil {
			fail(w, http.StatusBadGateway, "Enregistrement de la photo impossible pour l’instant : réessaie.")
			return
		}
	}
	id, err := s.Game.Propose(pid, NewProposal{Title: title, Desc: desc, Cat: cat, Img: img.Name, Thumb: thumb.Name, Bytes: int64(len(img.Data) + len(thumb.Data))})
	if err != nil {
		failErr(w, err)
		return
	}
	reply(w, http.StatusCreated, map[string]string{"id": id})
}

func (s *Service) handleTrade(w http.ResponseWriter, r *http.Request, pid, rest string) {
	code, action, _ := strings.Cut(rest, "/")
	if !codeRE.MatchString(code) {
		fail(w, http.StatusNotFound, "inconnu")
		return
	}
	switch action {
	case "":
		if r.Method != http.MethodGet {
			fail(w, http.StatusMethodNotAllowed, "GET attendu")
			return
		}
		if !s.polls.Allow(pid) {
			fail(w, http.StatusTooManyRequests, "trop de demandes")
			return
		}
		v, err := strconv.Atoi(r.URL.Query().Get("v"))
		if err != nil {
			v = -1
		}
		st, err := s.Game.WaitTrade(r.Context(), pid, code, v, 25*time.Second)
		if err != nil {
			failErr(w, err)
			return
		}
		reply(w, http.StatusOK, st)
	case "offer":
		var in struct {
			Offer []Copy `json:"offer"`
		}
		if s.readJSON(w, r, 4<<10, &in) {
			s.result(w, s.Game.SetOffer(pid, code, in.Offer))
		}
	case "ready":
		var in struct {
			OfferV int  `json:"offerV"`
			Ready  bool `json:"ready"`
		}
		if s.readJSON(w, r, 1<<10, &in) {
			s.result(w, s.Game.SetReady(pid, code, in.OfferV, in.Ready))
		}
	case "cancel":
		if s.guard(w, r) {
			s.result(w, s.Game.CancelTrade(pid, code))
		}
	default:
		fail(w, http.StatusNotFound, "inconnu")
	}
}

// ------------------------------------------------------------ administration

func (s *Service) serveAdmin(w http.ResponseWriter, r *http.Request, action string) {
	if s.IsAdmin == nil || !s.IsAdmin(r) {
		fail(w, http.StatusUnauthorized, "connexion administrateur requise")
		return
	}
	// Même protection que le reste de l'administration (voir internal/feedback).
	if r.Header.Get("X-Hub-Admin") != "1" {
		fail(w, http.StatusForbidden, "en-tête X-Hub-Admin manquant")
		return
	}
	if r.Method == http.MethodPost && !s.sameOrigin(r) {
		fail(w, http.StatusForbidden, "origine refusée")
		return
	}
	readJSON := func(max int64, v any) bool {
		if r.Method != http.MethodPost {
			fail(w, http.StatusMethodNotAllowed, "POST attendu")
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
	switch {
	case action == "overview" && r.Method == http.MethodGet:
		reply(w, http.StatusOK, s.Game.AdminOverview())
	case action == "mailing" && r.Method == http.MethodGet:
		w.Header().Set("Cache-Control", "no-store")
		reply(w, http.StatusOK, s.Game.MailingState())
	case action == "mailing/sent":
		var in struct {
			Keys  []string `json:"keys"`
			Force bool     `json:"force"`
		}
		if readJSON(8<<10, &in) {
			n, err := s.Game.MailingSent(in.Keys, in.Force)
			if err != nil {
				failErr(w, err)
				return
			}
			reply(w, http.StatusOK, map[string]int{"marked": n})
		}
	case action == "cards" && r.Method == http.MethodGet:
		reply(w, http.StatusOK, s.Game.AdminCards(r.URL.Query().Get("filter"), ImgURL))
	case strings.HasPrefix(action, "card/"):
		var in Moderate
		if readJSON(8<<10, &in) {
			s.result(w, s.Game.ModerateCard(strings.TrimPrefix(action, "card/"), in))
		}
	case action == "season":
		var in SeasonInput
		if readJSON(4<<10, &in) {
			s.result(w, s.Game.SaveSeason(in))
		}
	case action == "wave":
		var in WaveInput
		if !readJSON(4<<10, &in) {
			return
		}
		wv, err := s.Game.SaveWave(in)
		if err != nil {
			failErr(w, err)
			return
		}
		reply(w, http.StatusOK, wv)
	case strings.HasPrefix(action, "wave/"):
		parts := strings.Split(strings.TrimPrefix(action, "wave/"), "/")
		n, err := strconv.Atoi(parts[0])
		if err != nil || len(parts) != 2 {
			fail(w, http.StatusNotFound, "inconnu")
			return
		}
		switch parts[1] {
		case "preview":
			cands, wv, err := s.Game.Preview(n)
			if err != nil {
				failErr(w, err)
				return
			}
			out := make([]AdminCard, len(cands))
			for i, c := range cands {
				s.Game.mu.Lock()
				out[i] = s.Game.adminCard(c.Card, ImgURL)
				s.Game.mu.Unlock()
				out[i].Planned, out[i].Override = c.Rarity, c.Override
			}
			reply(w, http.StatusOK, map[string]any{"wave": wv, "cards": out, "mix": mixFor(min(len(cands), wv.Size))})
		case "rarity":
			var in struct {
				Card   string `json:"card"`
				Rarity Rarity `json:"rarity"`
			}
			if readJSON(1<<10, &in) {
				s.result(w, s.Game.SetOverride(n, in.Card, in.Rarity))
			}
		case "print":
			var in struct{}
			if readJSON(64, &in) {
				s.result(w, s.Game.PrintNow(n))
			}
		case "delete":
			var in struct{}
			if readJSON(64, &in) {
				s.result(w, s.Game.DeleteWave(n))
			}
		default:
			fail(w, http.StatusNotFound, "inconnu")
		}
	case strings.HasPrefix(action, "player/") && strings.HasSuffix(action, "/mute"):
		var in struct {
			On bool `json:"on"`
		}
		if readJSON(256, &in) {
			s.result(w, s.Game.MutePlayer(strings.TrimSuffix(strings.TrimPrefix(action, "player/"), "/mute"), in.On))
		}
	default:
		fail(w, http.StatusNotFound, "inconnu")
	}
}
