// Package site sert les fichiers de l'appli, intégrés au binaire au moment de la compilation.
//
// Chaque fichier est servi tel qu'il est dans le dépôt, avec son empreinte SHA-256 publiée dans
// /manifest.json : n'importe qui peut comparer le site en ligne au code source
// (`isis-hub verify https://…`), et l'écran « Transparence » de l'appli refait le calcul.
package site

import (
	"bytes"
	"compress/gzip"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"io/fs"
	"mime"
	"net/http"
	"path"
	"sort"
	"strings"
)

type file struct {
	body  []byte
	gz    []byte // version compressée, si elle est plus petite
	hash  string
	ctype string
}

// Manifest liste les fichiers servis et leur empreinte ; Fingerprint résume l'ensemble.
type Manifest struct {
	Version     string            `json:"version"`
	Fingerprint string            `json:"fingerprint"`
	Files       map[string]string `json:"files"`
}

type Options struct {
	Version   string // libellé de version affiché (ex. 1.0.0)
	ConnectTo string // origine WebSocket du relais pour la CSP (ex. wss://hub.exemple.fr) ; vide = même origine
	HSTS      bool
}

type Site struct {
	files    map[string]*file
	manifest []byte
	Manifest Manifest
	csp      string
	hsts     bool
}

// Fingerprint calcule l'empreinte globale à partir des empreintes de fichiers : SHA-256 des
// lignes « empreinte  chemin » triées par chemin. Le calcul est refait à l'identique par la page.
func Fingerprint(files map[string]string) string {
	names := make([]string, 0, len(files))
	for n := range files {
		names = append(names, n)
	}
	sort.Strings(names)
	var b strings.Builder
	for _, n := range names {
		b.WriteString(files[n] + "  " + n + "\n")
	}
	sum := sha256.Sum256([]byte(b.String()))
	return hex.EncodeToString(sum[:])
}

func compressible(ctype string) bool {
	return strings.HasPrefix(ctype, "text/") || strings.Contains(ctype, "javascript") ||
		strings.Contains(ctype, "json") || strings.Contains(ctype, "wasm") || strings.Contains(ctype, "svg")
}

// New charge tous les fichiers de `root` en mémoire et calcule leurs empreintes.
func New(root fs.FS, opt Options) (*Site, error) {
	s := &Site{files: map[string]*file{}, hsts: opt.HSTS}
	hashes := map[string]string{}
	err := fs.WalkDir(root, ".", func(p string, d fs.DirEntry, err error) error {
		if err != nil || d.IsDir() || strings.HasSuffix(p, ".go") || strings.HasPrefix(path.Base(p), ".") {
			return err
		}
		body, err := fs.ReadFile(root, p)
		if err != nil {
			return err
		}
		sum := sha256.Sum256(body)
		ctype := mime.TypeByExtension(path.Ext(p))
		switch path.Ext(p) {
		case ".mjs", ".js":
			ctype = "text/javascript; charset=utf-8"
		case ".wasm":
			ctype = "application/wasm"
		case ".webmanifest":
			ctype = "application/manifest+json"
		case ".woff2":
			ctype = "font/woff2"
		case "":
			ctype = "text/plain; charset=utf-8"
		}
		f := &file{body: body, hash: hex.EncodeToString(sum[:]), ctype: ctype}
		if compressible(ctype) && len(body) > 1024 {
			var buf bytes.Buffer
			zw, _ := gzip.NewWriterLevel(&buf, gzip.BestCompression)
			zw.Write(body)
			zw.Close()
			if buf.Len() < len(body) {
				f.gz = buf.Bytes()
			}
		}
		s.files["/"+p] = f
		hashes[p] = f.hash
		return nil
	})
	if err != nil {
		return nil, err
	}
	s.Manifest = Manifest{Version: opt.Version, Fingerprint: Fingerprint(hashes), Files: hashes}
	s.manifest, _ = json.MarshalIndent(s.Manifest, "", "  ")

	connect := "'self'"
	if opt.ConnectTo != "" {
		connect += " " + opt.ConnectTo
	}
	s.csp = strings.Join([]string{
		"default-src 'none'",
		"script-src 'self' 'wasm-unsafe-eval'",
		"style-src 'self'",
		// blob: : pièces jointes affichées dans le Hub (images et PDF reconnus à leurs premiers
		// octets, voir web/js/ui/attachments.js). Rien d'autre n'est chargé dans un cadre.
		"img-src 'self' data: blob:",
		// Vidéos de 2 s et musiques des cartes du TCG (servies par le Hub) ; blob: : l'aperçu de
		// l'extrait dans l'atelier, avant l'envoi.
		"media-src 'self' blob:",
		"frame-src blob:",
		"font-src 'self'",
		"connect-src " + connect,
		"manifest-src 'self'",
		"base-uri 'none'",
		"form-action 'none'",
		"frame-ancestors 'none'",
		// blob: seulement : Safari affiche un PDF dans un cadre avec son module PDF, soumis à
		// object-src (Chrome, non). Ce sont les mêmes PDF que frame-src blob: : créés par la page
		// elle-même après vérification de leurs premiers octets. Aucune adresse extérieure.
		"object-src blob:",
		"require-trusted-types-for 'script'",
		"trusted-types hub-mail-parser",
	}, "; ")
	return s, nil
}

// Headers pose les en-têtes de sécurité communs à toutes les réponses.
func (s *Site) Headers(h http.Header) {
	h.Set("Content-Security-Policy", s.csp)
	h.Set("X-Content-Type-Options", "nosniff")
	h.Set("X-Frame-Options", "DENY")
	h.Set("Referrer-Policy", "no-referrer")
	h.Set("Cross-Origin-Opener-Policy", "same-origin")
	h.Set("Cross-Origin-Resource-Policy", "same-origin")
	// Pas de Cross-Origin-Embedder-Policy : elle ne sert qu'à l'isolement entre origines
	// (SharedArrayBuffer), dont la page n'a pas besoin, et la CSP ne laisse de toute façon rien
	// charger d'ailleurs. Avec elle, Chrome et Safari n'affichaient plus les PDF joints aux mails
	// (leur lecteur intégré est refusé dans un cadre isolé).
	h.Set("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=(), usb=(), "+
		"interest-cohort=(), browsing-topics=()")
	if s.hsts {
		h.Set("Strict-Transport-Security", "max-age=63072000; includeSubDomains")
	}
}

func (s *Site) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	s.Headers(w.Header())
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		w.Header().Set("Allow", "GET, HEAD")
		http.Error(w, "méthode non autorisée", http.StatusMethodNotAllowed)
		return
	}
	p := r.URL.Path
	if p == "/manifest.json" {
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		w.Header().Set("Cache-Control", "no-cache")
		w.Write(s.manifest)
		return
	}
	if p == "/" || p == "" {
		p = "/index.html"
	}
	f := s.files[p]
	if f == nil {
		http.NotFound(w, r)
		return
	}
	h := w.Header()
	h.Set("Content-Type", f.ctype)
	// Toujours revalidé (pas de nom de fichier versionné) : la réponse 304 évite le retéléchargement.
	h.Set("Cache-Control", "no-cache")
	etag := `W/"` + f.hash[:32] + `"` // faible : la même empreinte couvre la version compressée
	h.Set("ETag", etag)
	h.Set("Vary", "Accept-Encoding")
	if r.Header.Get("If-None-Match") == etag {
		w.WriteHeader(http.StatusNotModified)
		return
	}
	body := f.body
	if f.gz != nil && strings.Contains(r.Header.Get("Accept-Encoding"), "gzip") {
		h.Set("Content-Encoding", "gzip")
		body = f.gz
	}
	h.Set("Content-Length", itoa(len(body)))
	if r.Method == http.MethodHead {
		return
	}
	w.Write(body)
}

func itoa(n int) string {
	if n == 0 {
		return "0"
	}
	var b [20]byte
	i := len(b)
	for n > 0 {
		i--
		b[i] = byte('0' + n%10)
		n /= 10
	}
	return string(b[i:])
}
