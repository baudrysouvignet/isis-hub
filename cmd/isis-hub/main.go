// isis-hub : sert l'appli ISIS Hub, son relais aveugle et les calendriers filtrés, dans un seul binaire.
//
//	isis-hub                  démarre le serveur (variables d'environnement ci-dessous)
//	isis-hub manifest         affiche les empreintes des fichiers intégrés
//	isis-hub verify <url>     compare un site en ligne à ce binaire, fichier par fichier
//	isis-hub healthcheck      vérifie que le serveur local répond (sonde Docker)
//	isis-hub r2check          vérifie l'accès au seau Cloudflare R2 des images du TCG (R2_*)
//
// Variables : ADDR (:8080), PUBLIC_ORIGIN (https://hub.exemple.fr), TRUST_PROXY (1 derrière un
// proxy inverse), MAX_CONNS_PER_IP (8), MAX_CONNS (2000), MAX_STREAMS (64), DATA_DIR (data) pour les
// retours et la répartition des classes, ADMIN_USERS (identifiants universitaires administrateurs,
// séparés par des virgules ; vide = pas d'administration), R2_ACCOUNT_ID, R2_BUCKET,
// R2_ACCESS_KEY_ID et R2_SECRET_ACCESS_KEY (images du TCG ; sans elles, dans DATA_DIR/tcg-img).
// CAS_URL ne sert qu'aux tests (faux CAS).
package main

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"syscall"
	"time"

	"isishub/internal/calendar"
	"isishub/internal/cas"
	"isishub/internal/crous"
	"isishub/internal/feedback"
	"isishub/internal/site"
	"isishub/internal/salaires"
	"isishub/internal/stages"
	"isishub/internal/tcg"
	"isishub/internal/wisp"
	"isishub/web"
)

// Version est fixée à la compilation (-ldflags "-X main.Version=…").
var Version = "dev"

// Portals : les seules destinations que le relais accepte. Liste fixe, compilée dans le binaire.
var Portals = []string{
	"auth.univ-jfc.fr:443",      // CAS (connexion)
	"adecampus.univ-jfc.fr:443", // ADE (emploi du temps)
	"mail.univ-jfc.fr:443",      // BlueMind (messagerie)
	"moodle.univ-jfc.fr:443",    // Moodle
}

func env(name, def string) string {
	if v := os.Getenv(name); v != "" {
		return v
	}
	return def
}

func envInt(name string, def int) int {
	n, err := strconv.Atoi(os.Getenv(name))
	if err != nil || n <= 0 {
		return def
	}
	return n
}

func main() {
	log.SetFlags(0)
	cmd := "serve"
	if len(os.Args) > 1 {
		cmd = os.Args[1]
	}
	var err error
	switch cmd {
	case "serve":
		err = serve()
	case "manifest":
		err = printManifest()
	case "verify":
		if len(os.Args) < 3 {
			err = errors.New("usage : isis-hub verify https://adresse-du-site/")
		} else {
			err = verify(os.Args[2])
		}
	case "healthcheck":
		err = healthcheck()
	case "r2check":
		err = r2check()
	default:
		err = fmt.Errorf("commande inconnue : %s", cmd)
	}
	if err != nil {
		log.Println("isis-hub :", err)
		os.Exit(1)
	}
}

func newSite() (*site.Site, error) {
	origin := strings.TrimRight(os.Getenv("PUBLIC_ORIGIN"), "/")
	connect := ""
	switch {
	case strings.HasPrefix(origin, "https://"):
		connect = "wss://" + strings.TrimPrefix(origin, "https://")
	case strings.HasPrefix(origin, "http://"):
		connect = "ws://" + strings.TrimPrefix(origin, "http://")
	}
	return site.New(web.Files, site.Options{Version: Version, ConnectTo: connect, HSTS: strings.HasPrefix(origin, "https://")})
}

func serve() error {
	s, err := newSite()
	if err != nil {
		return err
	}
	var origins []string
	if o := strings.TrimRight(os.Getenv("PUBLIC_ORIGIN"), "/"); o != "" {
		origins = []string{o}
	}
	relay := wisp.New(wisp.Config{
		Targets:        Portals,
		AllowedOrigins: origins,
		TrustProxy:     os.Getenv("TRUST_PROXY") == "1",
		MaxConnsPerIP:  envInt("MAX_CONNS_PER_IP", 96), // tout un campus peut sortir par une adresse
		MaxConns:       envInt("MAX_CONNS", 2000),
		MaxStreams:     envInt("MAX_STREAMS", 16),
	})

	// Répartition des emplois du temps : celle livrée avec le code, remplacée par celle de
	// l'administration si elle existe.
	rawClasses, err := web.Files.ReadFile("data/classes.json")
	if err != nil {
		return err
	}
	var defaults calendar.Data
	if err := json.Unmarshal(rawClasses, &defaults); err != nil {
		return fmt.Errorf("classes.json : %w", err)
	}
	store, err := feedback.Open(env("DATA_DIR", "data"))
	if err != nil {
		return fmt.Errorf("retours : %w", err)
	}
	content, err := feedback.OpenContent(env("DATA_DIR", "data"), defaults)
	if err != nil {
		return fmt.Errorf("contenu : %w", err)
	}
	// VAULT_PEPPER : secret du serveur, gardé hors du dossier de données (voir feedback/vault.go).
	vaultStore, err := feedback.OpenVaultStore(env("DATA_DIR", "data"), os.Getenv("VAULT_PEPPER"))
	if err != nil {
		return fmt.Errorf("coffre : %w", err)
	}
	if n := envInt("VAULT_MAX_BYTES", 0); n > 0 {
		vaultStore.MaxBytes = int64(n)
	}
	stats, err := feedback.OpenStats(env("DATA_DIR", "data"))
	if err != nil {
		return fmt.Errorf("statistiques : %w", err)
	}
	exams, err := feedback.OpenExams(env("DATA_DIR", "data"))
	if err != nil {
		return fmt.Errorf("examens signalés : %w", err)
	}
	// Calendriers filtrés par groupe, langue et parcours (abonnement des agendas).
	calendars := calendar.New(content.Classes())
	calendars.TrustProxy = os.Getenv("TRUST_PROXY") == "1"
	content.OnChange = calendars.SetData

	var admins []string
	for _, u := range strings.Split(os.Getenv("ADMIN_USERS"), ",") {
		if u = strings.TrimSpace(u); u != "" {
			admins = append(admins, u)
		}
	}
	api := feedback.New(feedback.Config{
		Store:          store,
		Content:        content,
		Stats:          stats,
		Vault:          vaultStore,
		Exams:          exams,
		AdminUsers:     admins,
		CASValidate:    feedback.CASValidator(env("CAS_URL", "https://auth.univ-jfc.fr"), feedback.ENTService),
		AllowedOrigins: origins,
		TrustProxy:     os.Getenv("TRUST_PROXY") == "1",
		SecureCookie:   strings.HasPrefix(os.Getenv("PUBLIC_ORIGIN"), "https://"),
	})

	// TCG de la promo : images dans Cloudflare R2 si configuré, sinon dans le dossier de données.
	var blobs tcg.Blobs = tcg.Local{Dir: env("DATA_DIR", "data") + "/tcg-img"}
	r2, err := tcg.R2FromEnv(os.Getenv)
	if err != nil {
		return err
	}
	if r2 != nil {
		blobs = tcg.NewCached(r2, 96<<20)
	}
	game, err := tcg.Open(env("DATA_DIR", "data"), os.Getenv("VAULT_PEPPER"), blobs)
	if err != nil {
		return fmt.Errorf("TCG : %w", err)
	}
	game.IsAdmin = api.IsAdminUser
	game.SyncAdmins(admins)
	recovered := ""
	if game.Recovered != "" {
		recovered = " · TCG repris de la sauvegarde " + game.Recovered
	}
	stopGame := make(chan struct{})
	gameDone := make(chan struct{})
	go func() {
		game.Run(stopGame)
		close(gameDone)
	}()
	tcgAPI := (&tcg.Service{
		Game:           game,
		CASValidate:    cas.Validator(env("CAS_URL", "https://auth.univ-jfc.fr"), cas.ENTService),
		StudentOnly:    true,
		IsAdmin:        api.IsAdmin,
		AllowedOrigins: origins,
		TrustProxy:     os.Getenv("TRUST_PROXY") == "1",
		SecureCookie:   strings.HasPrefix(os.Getenv("PUBLIC_ORIGIN"), "https://"),
	}).Init()

	// Rubrique Stages : fermée tant que l'administration ne l'ouvre pas (données déposées en JSON).
	stagesStore, err := stages.Open(env("DATA_DIR", "data"))
	if err != nil {
		return fmt.Errorf("stages : %w", err)
	}
	stagesAPI := (&stages.Service{
		Store:          stagesStore,
		CASValidate:    cas.Validator(env("CAS_URL", "https://auth.univ-jfc.fr"), cas.ENTService),
		IsAdmin:        api.IsAdmin,
		IsAdminUser:    api.IsAdminUser,
		AllowedOrigins: origins,
		TrustProxy:     os.Getenv("TRUST_PROXY") == "1",
		SecureCookie:   strings.HasPrefix(os.Getenv("PUBLIC_ORIGIN"), "https://"),
	}).Init()

	// Simulateur de salaire : fermé tant que l'administration ne l'ouvre pas. Les réponses du
	// sondage restent sur le serveur, la page ne reçoit que des groupes d'au moins 5 réponses.
	salairesStore, err := salaires.Open(env("DATA_DIR", "data"))
	if err != nil {
		return fmt.Errorf("salaires : %w", err)
	}
	salairesAPI := (&salaires.Service{
		Store:          salairesStore,
		CASValidate:    cas.Validator(env("CAS_URL", "https://auth.univ-jfc.fr"), cas.ENTService),
		IsAdmin:        api.IsAdmin,
		IsAdminUser:    api.IsAdminUser,
		AllowedOrigins: origins,
		TrustProxy:     os.Getenv("TRUST_PROXY") == "1",
		SecureCookie:   strings.HasPrefix(os.Getenv("PUBLIC_ORIGIN"), "https://"),
	}).Init()

	mux := http.NewServeMux()
	mux.Handle("/wisp/", relay)
	mux.Handle("/api/tcg/", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		s.Headers(w.Header())
		tcgAPI.ServeHTTP(w, r)
	}))
	mux.Handle("/api/stages/", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		s.Headers(w.Header())
		stagesAPI.ServeHTTP(w, r)
	}))
	mux.Handle("/api/salaires/", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		s.Headers(w.Header())
		salairesAPI.ServeHTTP(w, r)
	}))
	mux.Handle("/calendar/", calendars)
	// Page d'administration : elle n'existe que pour une session administrateur. Sinon, retour à
	// l'accueil avec « #admin » : si l'étudiant connecté figure dans ADMIN_USERS, la page fait
	// valider son identité par le CAS (voir internal/feedback/cas.go) puis revient ici.
	adminPage := func(w http.ResponseWriter, r *http.Request) {
		if !api.IsAdmin(r) {
			w.Header().Set("Cache-Control", "no-store")
			http.Redirect(w, r, "/#admin", http.StatusFound)
			return
		}
		r2 := r.Clone(r.Context())
		r2.URL.Path = "/admin.html"
		s.ServeHTTP(w, r2)
	}
	mux.HandleFunc("/admin", adminPage)
	mux.HandleFunc("/admin.html", adminPage)
	mux.Handle("/api/", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		s.Headers(w.Header())
		api.ServeHTTP(w, r)
	}))
	// Menu public du Resto U' de Castres, relu au plus toutes les 15 minutes ; une semaine de menus
	// déjà vus est gardée dans DATA_DIR/crous.json (les sources ne donnent que celui du jour).
	menus := crous.New()
	if err := menus.Persist(filepath.Join(env("DATA_DIR", "data"), "crous.json")); err != nil {
		log.Printf("menus du CROUS : %v (historique repris de zéro)", err)
	}
	mux.Handle("/api/crous", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		s.Headers(w.Header())
		menus.ServeHTTP(w, r)
	}))
	mux.HandleFunc("/healthz", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/plain; charset=utf-8")
		w.Header().Set("Cache-Control", "no-store")
		io.WriteString(w, "ok\n")
	})
	mux.Handle("/", s)

	srv := &http.Server{
		Addr:              env("ADDR", ":8080"),
		Handler:           mux,
		ReadHeaderTimeout: 10 * time.Second,
		// Corps envoyé goutte à goutte, réponse jamais lue : la connexion ne reste pas ouverte
		// indéfiniment. Sans effet sur le relais : upgrade() lève ces délais après la réponse 101.
		ReadTimeout:    30 * time.Second,
		WriteTimeout:   120 * time.Second, // large : libcurl.wasm (1,4 Mo) sur un réseau mobile lent
		IdleTimeout:    120 * time.Second,
		MaxHeaderBytes: 32 << 10,
		ErrorLog:       log.New(io.Discard, "", 0), // aucun journal de requête, même en erreur
	}
	stop := make(chan os.Signal, 1)
	signal.Notify(stop, syscall.SIGINT, syscall.SIGTERM)
	// Arrêt (mise à jour, redémarrage) : le processus attend que tout soit écrit avant de sortir.
	// ListenAndServe rend la main dès l'appel à Shutdown : sans cette attente, les dernières
	// secondes (compteurs, examens, actions du TCG) pouvaient être perdues.
	flushed := make(chan struct{})
	go func() {
		defer close(flushed)
		<-stop
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		srv.Shutdown(ctx)
		stats.Flush() // compteurs du jour écrits avant l'arrêt
		exams.Flush()
		close(stopGame) // tcg.json écrit avant l'arrêt
		<-gameDone
	}()
	// Seule ligne écrite par le serveur : de quoi comparer avec le dépôt, rien sur les visiteurs.
	admin := "administration désactivée"
	if len(admins) > 0 {
		admin = fmt.Sprintf("administration : %d identifiant(s)", len(admins))
	}
	log.Printf("ISIS Hub %s sur %s · empreinte %s · %d fichiers · relais limité à %s · %s · images du TCG : %s",
		Version, srv.Addr, s.Manifest.Fingerprint, len(s.Manifest.Files), strings.Join(Portals, ", "), admin, blobs.Kind()+recovered)
	if err := srv.ListenAndServe(); !errors.Is(err, http.ErrServerClosed) {
		return err
	}
	<-flushed
	return nil
}

func printManifest() error {
	s, err := newSite()
	if err != nil {
		return err
	}
	names := make([]string, 0, len(s.Manifest.Files))
	for n := range s.Manifest.Files {
		names = append(names, n)
	}
	sort.Strings(names)
	for _, n := range names {
		fmt.Printf("%s  %s\n", s.Manifest.Files[n], n)
	}
	fmt.Printf("\nempreinte globale : %s\n", s.Manifest.Fingerprint)
	return nil
}

func get(client *http.Client, url string) ([]byte, error) {
	res, err := client.Get(url)
	if err != nil {
		return nil, err
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("HTTP %d", res.StatusCode)
	}
	return io.ReadAll(io.LimitReader(res.Body, 64<<20))
}

// verify télécharge chaque fichier du site en ligne et compare son empreinte à celle du binaire.
func verify(base string) error {
	base = strings.TrimRight(base, "/") + "/"
	s, err := newSite()
	if err != nil {
		return err
	}
	client := &http.Client{Timeout: 30 * time.Second}
	raw, err := get(client, base+"manifest.json")
	if err != nil {
		return fmt.Errorf("manifest.json : %w", err)
	}
	var remote site.Manifest
	if err := json.Unmarshal(raw, &remote); err != nil {
		return fmt.Errorf("manifest.json illisible : %w", err)
	}
	bad := 0
	names := make([]string, 0, len(s.Manifest.Files))
	for n := range s.Manifest.Files {
		names = append(names, n)
	}
	for n := range remote.Files {
		if _, ok := s.Manifest.Files[n]; !ok {
			names = append(names, n)
		}
	}
	sort.Strings(names)
	for _, n := range names {
		want, known := s.Manifest.Files[n]
		body, err := get(client, base+n)
		switch {
		case !known:
			fmt.Printf("✗ %s : servi en ligne mais absent du code\n", n)
			bad++
		case err != nil:
			fmt.Printf("✗ %s : %v\n", n, err)
			bad++
		default:
			sum := sha256.Sum256(body)
			if got := hex.EncodeToString(sum[:]); got != want {
				fmt.Printf("✗ %s : contenu différent\n", n)
				bad++
			} else {
				fmt.Printf("✓ %s\n", n)
			}
		}
	}
	if remote.Fingerprint != s.Manifest.Fingerprint {
		fmt.Printf("✗ empreinte annoncée %s ≠ %s\n", remote.Fingerprint, s.Manifest.Fingerprint)
		bad++
	}
	if bad > 0 {
		return fmt.Errorf("%d écart(s) : le site ne sert pas exactement ce code", bad)
	}
	fmt.Printf("\nLe site sert exactement ce code (%d fichiers, empreinte %s).\n", len(names), s.Manifest.Fingerprint)
	return nil
}

// r2check : écrit, relit et efface un objet de test dans le seau R2 (variables R2_*).
func r2check() error {
	r2, err := tcg.R2FromEnv(os.Getenv)
	if err != nil {
		return err
	}
	if r2 == nil {
		return errors.New("R2 non configuré : définir R2_ACCOUNT_ID, R2_BUCKET, R2_ACCESS_KEY_ID et R2_SECRET_ACCESS_KEY")
	}
	fmt.Printf("Seau %s sur %s…\n", r2.Bucket, r2.Endpoint)
	if err := r2.Check(); err != nil {
		return err
	}
	fmt.Println("✓ écriture, lecture et suppression : le TCG peut ranger ses images dans R2.")
	return nil
}

func healthcheck() error {
	addr := env("ADDR", ":8080")
	if strings.HasPrefix(addr, ":") {
		addr = "127.0.0.1" + addr
	}
	client := &http.Client{Timeout: 3 * time.Second}
	_, err := get(client, "http://"+addr+"/healthz")
	return err
}
