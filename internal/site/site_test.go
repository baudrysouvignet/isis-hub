package site

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"testing/fstest"
)

func testSite(t *testing.T) *Site {
	t.Helper()
	s, err := New(fstest.MapFS{
		"index.html":     {Data: []byte("<!doctype html><title>x</title>" + strings.Repeat(" ", 2000))},
		"js/main.js":     {Data: []byte("console.log(1)")},
		"embed.go":       {Data: []byte("package web")},
		".DS_Store":      {Data: []byte("x")},
		"assets/hub.css": {Data: []byte("body{}")},
	}, Options{Version: "test", ConnectTo: "wss://hub.exemple.fr"})
	if err != nil {
		t.Fatal(err)
	}
	return s
}

func get(s *Site, path string, header ...string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(http.MethodGet, path, nil)
	for i := 0; i+1 < len(header); i += 2 {
		req.Header.Set(header[i], header[i+1])
	}
	rec := httptest.NewRecorder()
	s.ServeHTTP(rec, req)
	return rec
}

func TestSecurityHeaders(t *testing.T) {
	rec := get(testSite(t), "/")
	csp := rec.Header().Get("Content-Security-Policy")
	for _, want := range []string{"default-src 'none'", "script-src 'self' 'wasm-unsafe-eval'", "connect-src 'self' wss://hub.exemple.fr", "frame-ancestors 'none'", "require-trusted-types-for 'script'"} {
		if !strings.Contains(csp, want) {
			t.Errorf("CSP sans %q : %s", want, csp)
		}
	}
	if strings.Contains(csp, "unsafe-inline") || strings.Contains(csp, "'unsafe-eval'") {
		t.Error("la CSP ne doit autoriser ni le code en ligne ni eval")
	}
	for h, want := range map[string]string{"X-Frame-Options": "DENY", "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff"} {
		if got := rec.Header().Get(h); got != want {
			t.Errorf("%s = %q, attendu %q", h, got, want)
		}
	}
}

func TestOnlyWebFilesAreServed(t *testing.T) {
	s := testSite(t)
	for _, p := range []string{"/embed.go", "/.DS_Store", "/../go.mod", "/nope"} {
		if code := get(s, p).Code; code != http.StatusNotFound {
			t.Errorf("%s : %d, attendu 404", p, code)
		}
	}
	req := httptest.NewRequest(http.MethodPost, "/", nil)
	rec := httptest.NewRecorder()
	s.ServeHTTP(rec, req)
	if rec.Code != http.StatusMethodNotAllowed {
		t.Errorf("POST : %d", rec.Code)
	}
}

func TestManifestMatchesFiles(t *testing.T) {
	s := testSite(t)
	var m Manifest
	if err := json.Unmarshal(get(s, "/manifest.json").Body.Bytes(), &m); err != nil {
		t.Fatal(err)
	}
	if len(m.Files) != 3 {
		t.Fatalf("3 fichiers attendus, %d listés", len(m.Files))
	}
	for name, hash := range m.Files {
		body := get(s, "/"+name).Body.Bytes()
		sum := sha256.Sum256(body)
		if hex.EncodeToString(sum[:]) != hash {
			t.Errorf("%s : empreinte publiée différente du contenu servi", name)
		}
	}
	if m.Fingerprint != Fingerprint(m.Files) {
		t.Error("empreinte globale incohérente")
	}
}

func TestGzipAndRevalidation(t *testing.T) {
	s := testSite(t)
	rec := get(s, "/index.html", "Accept-Encoding", "gzip")
	if rec.Header().Get("Content-Encoding") != "gzip" {
		t.Error("index.html devrait être compressé")
	}
	etag := rec.Header().Get("ETag")
	if code := get(s, "/index.html", "If-None-Match", etag).Code; code != http.StatusNotModified {
		t.Errorf("revalidation : %d, attendu 304", code)
	}
}
