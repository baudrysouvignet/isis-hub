// isis-hub : sert l'appli ISIS Hub, son relais aveugle et les calendriers filtrés, dans un seul binaire.
//
//	isis-hub                  démarre le serveur (variables d'environnement ci-dessous)
//	isis-hub manifest         affiche les empreintes des fichiers intégrés
//	isis-hub verify <url>     compare un site en ligne à ce binaire, fichier par fichier
//	isis-hub healthcheck      vérifie que le serveur local répond (sonde Docker)
//
// Variables : ADDR (:8080), PUBLIC_ORIGIN (https://hub.exemple.fr), TRUST_PROXY (1 derrière un
// proxy inverse), MAX_CONNS_PER_IP (8), MAX_CONNS (2000), MAX_STREAMS (64), DATA_DIR (data) pour les
// retours et la répartition des classes, ADMIN_USERS (identifiants universitaires administrateurs,
// séparés par des virgules ; vide = pas d'administration). CAS_URL ne sert qu'aux tests (faux CAS).
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
	"sort"
	"strconv"
	"strings"
	"syscall"
	"time"

	"isishub/internal/calendar"
	"isishub/internal/crous"
	"isishub/internal/feedback"
	"isishub/internal/site"
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
		MaxConnsPerIP:  envInt("MAX_CONNS_PER_IP", 8),
		MaxConns:       envInt("MAX_CONNS", 2000),
		MaxStreams:     envInt("MAX_STREAMS", 64),
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
	vaultStore, err := feedback.OpenVaultStore(env("DATA_DIR", "data"))
	if err != nil {
		return fmt.Errorf("coffre : %w", err)
	}
	stats, err := feedback.OpenStats(env("DATA_DIR", "data"))
	if err != nil {
		return fmt.Errorf("statistiques : %w", err)
	}
	// Calendriers filtrés par groupe, langue et parcours (abonnement des agendas).
	calendars := calendar.New(content.Classes())
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
		AdminUsers:     admins,
		CASValidate:    feedback.CASValidator(env("CAS_URL", "https://auth.univ-jfc.fr"), feedback.ENTService),
		AllowedOrigins: origins,
		TrustProxy:     os.Getenv("TRUST_PROXY") == "1",
		SecureCookie:   strings.HasPrefix(os.Getenv("PUBLIC_ORIGIN"), "https://"),
	})

	mux := http.NewServeMux()
	mux.Handle("/wisp/", relay)
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
	// Menu public du Resto U' de Castres, relu au plus toutes les 12 heures.
	menus := crous.New()
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
		IdleTimeout:       120 * time.Second,
		MaxHeaderBytes:    32 << 10,
		ErrorLog:          log.New(io.Discard, "", 0), // aucun journal de requête, même en erreur
	}
	stop := make(chan os.Signal, 1)
	signal.Notify(stop, syscall.SIGINT, syscall.SIGTERM)
	go func() {
		<-stop
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		srv.Shutdown(ctx)
	}()
	// Seule ligne écrite par le serveur : de quoi comparer avec le dépôt, rien sur les visiteurs.
	admin := "administration désactivée"
	if len(admins) > 0 {
		admin = fmt.Sprintf("administration : %d identifiant(s)", len(admins))
	}
	log.Printf("ISIS Hub %s sur %s · empreinte %s · %d fichiers · relais limité à %s · %s",
		Version, srv.Addr, s.Manifest.Fingerprint, len(s.Manifest.Files), strings.Join(Portals, ", "), admin)
	if err := srv.ListenAndServe(); !errors.Is(err, http.ErrServerClosed) {
		return err
	}
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

func healthcheck() error {
	addr := env("ADDR", ":8080")
	if strings.HasPrefix(addr, ":") {
		addr = "127.0.0.1" + addr
	}
	client := &http.Client{Timeout: 3 * time.Second}
	_, err := get(client, "http://"+addr+"/healthz")
	return err
}
