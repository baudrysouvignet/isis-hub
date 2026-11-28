package stages

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"isishub/internal/cas"
)

const origin = "https://hub.test"

func f(v float64) *float64 { return &v }

// sample : deux structures, trois stages, trois contacts.
func sample() *Dataset {
	return &Dataset{
		Format: Format, Version: Version, Built: "2026-11-28", Source: "Test",
		Places: []Place{
			{ID: "fr:81065", N: "Castres", Dep: "81", Reg: "76", X: f(548.7), Y: f(851.2)},
			{ID: "abroad:montreal", N: "Montréal", Zone: "monde", Pays: "Canada", ISO: "CA"},
		},
		Companies: []Company{
			{ID: "e1", N: "Centre Hospitalier de Castres", M: "CH", C: 3, P: "fr:81065", S: "Santé", St: "Hôpital public", W: "www.ch-exemple.fr", K: []string{"s1", "s2"}, Paid: 1, N0: 2, Sites: []string{}, Variants: []string{"CHIC"}, Also: []string{}},
			{ID: "e2", N: "Polytechnique Montréal", M: "PM", C: 5, P: "abroad:montreal", S: "Enseignement", K: []string{"s3"}, Sites: []string{}, Variants: []string{}, Also: []string{}},
		},
		Stages: []Stage{
			{ID: "s1", E: "e1", Pr: 2028, F: 3, Au: 2025, D: "2026-04", Wk: 8, Mi: "Catalogue d'examens", Et: "Léa Martin", Tu: "p1", Rh: "p2", Ob: true, Db: "2026-04-27", Df: "2026-06-19", G: 1},
			{ID: "s2", E: "e1", Pr: 2027, F: 3, Au: 2024, D: "2025-04", Wk: 8, Et: "Hugo Bernard", Tu: "p1"},
			{ID: "s3", E: "e2", Pr: 2026, F: 5, Au: 2025, D: "2026-02", Wk: 24, Et: "Inès Garcia", Tu: "p3"},
		},
		Contacts: []Contact{
			{ID: "p1", Civ: "M.", N: "Paul Durand", Role: "Ingénieur", Mail: "paul.durand@ch-exemple.fr", Kinds: []string{"maitre"}, Last: "2026-04"},
			{ID: "p2", Civ: "Mme", N: "Claire Moreau", Role: "DRH", Mail: "rh@ch-exemple.fr", Generic: true, Kinds: []string{"rh"}, Last: "2026-04"},
			{ID: "p3", N: "Marc Tremblay", Role: "Professeur", Kinds: []string{"maitre"}},
		},
	}
}

func TestValidate(t *testing.T) {
	if err := sample().Validate(); err != nil {
		t.Fatalf("fichier correct refusé : %v", err)
	}
	bad := map[string]func(d *Dataset){
		"format":         func(d *Dataset) { d.Format = "autre" },
		"lieu inconnu":   func(d *Dataset) { d.Companies[0].P = "fr:00000" },
		"stage orphelin": func(d *Dataset) { d.Stages[2].E = "e9" },
		"stage absent":   func(d *Dataset) { d.Companies[0].K = []string{"s1"} },
		"contact absent": func(d *Dataset) { d.Stages[0].Tu = "p9" },
		"adresse":        func(d *Dataset) { d.Contacts[0].Mail = "pas une adresse" },
		"site":           func(d *Dataset) { d.Companies[0].W = "javascript:alert(1)" },
		"contrôle":       func(d *Dataset) { d.Companies[0].N = "CH\x00" },
		"coordonnées":    func(d *Dataset) { d.Places[0].X = nil },
		"rôle":           func(d *Dataset) { d.Contacts[0].Kinds = []string{"patron"} },
		"date":           func(d *Dataset) { d.Stages[0].Db = "27/04/2026" },
		"double":         func(d *Dataset) { d.Stages[1].ID = "s1" },
	}
	for name, mutate := range bad {
		d := sample()
		mutate(d)
		if err := d.Validate(); err == nil {
			t.Errorf("%s : fichier invalide accepté", name)
		}
	}
}

type client struct {
	t      *testing.T
	svc    *Service
	cookie string
	admin  bool
}

func (c *client) do(method, path string, body any) (int, []byte) {
	c.t.Helper()
	var r *http.Request
	if body != nil {
		b, _ := json.Marshal(body)
		r = httptest.NewRequest(method, path, bytes.NewReader(b))
		r.Header.Set("Content-Type", "application/json")
	} else {
		r = httptest.NewRequest(method, path, nil)
	}
	r.Header.Set("Origin", origin)
	r.Header.Set("X-Hub-Stages", "1")
	if c.cookie != "" {
		r.Header.Set("Cookie", c.cookie)
	}
	if c.admin {
		r.Header.Add("Cookie", "hub_admin=ok")
	}
	w := httptest.NewRecorder()
	c.svc.ServeHTTP(w, r)
	for _, ck := range w.Result().Cookies() {
		if ck.Name == cookieName {
			if ck.MaxAge < 0 {
				c.cookie = ""
			} else {
				c.cookie = cookieName + "=" + ck.Value
			}
		}
	}
	return w.Code, w.Body.Bytes()
}

func (c *client) must(method, path string, body any, want int) []byte {
	c.t.Helper()
	code, out := c.do(method, path, body)
	if code != want {
		c.t.Fatalf("%s %s : %d (attendu %d) %s", method, path, code, want, out)
	}
	return out
}

func newSvc(t *testing.T, dir string, now *time.Time) *Service {
	st, err := Open(dir)
	if err != nil {
		t.Fatal(err)
	}
	st.now = func() time.Time { return *now }
	return (&Service{
		Store: st,
		CASValidate: func(_ context.Context, ticket string) (cas.Identity, error) {
			parts := strings.Split(ticket, "-")
			if len(parts) < 3 {
				return cas.Identity{}, fmt.Errorf("refusé")
			}
			return cas.Identity{User: parts[1]}, nil
		},
		IsAdmin:        func(r *http.Request) bool { return strings.Contains(r.Header.Get("Cookie"), "hub_admin=ok") },
		IsAdminUser:    func(login string) bool { return login == "bsouvign" },
		AllowedOrigins: []string{origin},
	}).Init()
}

func TestFlow(t *testing.T) {
	dir := t.TempDir()
	now := time.Date(2026, 11, 28, 10, 0, 0, 0, time.UTC)
	svc := newSvc(t, dir, &now)
	lea := &client{t: t, svc: svc}
	admin := &client{t: t, svc: svc, admin: true}

	// Rubrique fermée par défaut : rien n'est servi, une session n'est même pas ouverte.
	if out := lea.must("GET", "/api/stages/status", nil, 200); !strings.Contains(string(out), `"enabled":false`) {
		t.Fatalf("statut : %s", out)
	}
	lea.must("POST", "/api/stages/join", map[string]any{"ticket": "ST-lmartin-123456789"}, 404)
	admin.must("POST", "/api/stages/admin/enabled", map[string]any{"on": true}, 409) // sans données
	lea.must("POST", "/api/stages/admin/upload", sample(), 403)                      // pas administrateur

	// Dépôt (refusé s'il est invalide, l'ancien reste), puis aperçu par l'administrateur.
	broken := sample()
	broken.Stages[0].E = "e9"
	admin.must("POST", "/api/stages/admin/upload", broken, 400)
	admin.must("POST", "/api/stages/admin/upload", sample(), 200)
	boss := &client{t: t, svc: svc}
	boss.must("POST", "/api/stages/join", map[string]any{"ticket": "ST-bsouvign-123456789"}, 200)
	boss.must("GET", "/api/stages/index", nil, 200)
	lea.must("POST", "/api/stages/join", map[string]any{"ticket": "ST-lmartin-123456789"}, 404)

	// Ouverture : la recherche ne contient aucune adresse, la fiche les donne et entre au journal.
	admin.must("POST", "/api/stages/admin/enabled", map[string]any{"on": true}, 200)
	lea.must("GET", "/api/stages/index", nil, 401)
	lea.must("POST", "/api/stages/join", map[string]any{"ticket": "ST-lmartin-123456789"}, 200)
	ix := lea.must("GET", "/api/stages/index", nil, 200)
	if bytes.Contains(ix, []byte("@")) || !bytes.Contains(ix, []byte(`"hm":true`)) || !bytes.Contains(ix, []byte("Léa Martin")) {
		t.Fatalf("index : %s", ix)
	}
	out := lea.must("GET", "/api/stages/structure/e1", nil, 200)
	var fiche struct{ Contacts []Contact }
	json.Unmarshal(out, &fiche)
	if len(fiche.Contacts) != 2 || fiche.Contacts[0].Mail != "paul.durand@ch-exemple.fr" || fiche.Contacts[1].Mail != "rh@ch-exemple.fr" {
		t.Fatalf("contacts de e1 : %+v", fiche.Contacts)
	}
	lea.must("GET", "/api/stages/structure/e9", nil, 404)
	admin.must("GET", "/api/stages/admin/log", nil, 404) // plus de journal

	// L'éditeur relit le fichier gardé et le renvoie retouché (vérifié comme un dépôt).
	lea.must("GET", "/api/stages/admin/data", nil, 403)
	var kept Dataset
	json.Unmarshal(admin.must("GET", "/api/stages/admin/data", nil, 200), &kept)
	kept.Stages[1].Mi = "Paramétrage du dossier patient"
	admin.must("POST", "/api/stages/admin/upload", kept, 200)
	if again := admin.must("GET", "/api/stages/admin/data", nil, 200); !bytes.Contains(again, []byte("dossier patient")) {
		t.Fatal("fiche retouchée non gardée")
	}

	// Rien sur la personne : ni son identifiant, ni ce qu'elle a ouvert, dans aucun fichier.
	noTrace := func(when string) {
		t.Helper()
		entries, _ := os.ReadDir(dir)
		for _, e := range entries {
			b, _ := os.ReadFile(filepath.Join(dir, e.Name()))
			if bytes.Contains(bytes.ToLower(b), []byte("lmartin")) || bytes.Contains(bytes.ToLower(b), []byte("bsouvign")) {
				t.Fatalf("%s : identifiant gardé dans %s", when, e.Name())
			}
		}
		if _, err := os.Stat(filepath.Join(dir, "stages-log.jsonl")); err == nil {
			t.Fatalf("%s : journal présent", when)
		}
	}
	noTrace("après consultation")

	// Requêtes sans l'en-tête maison ou d'un autre site : refusées.
	r := httptest.NewRequest("POST", "/api/stages/join", strings.NewReader(`{"ticket":"ST-x-123456789"}`))
	r.Header.Set("Content-Type", "application/json")
	r.Header.Set("Origin", "https://ailleurs.test")
	w := httptest.NewRecorder()
	svc.ServeHTTP(w, r)
	if w.Code != 403 {
		t.Fatalf("autre site : %d", w.Code)
	}

	// Redémarrage : données, ouverture et session survivent.
	svc2 := newSvc(t, dir, &now)
	lea.svc = svc2
	lea.must("GET", "/api/stages/index", nil, 200)

	noTrace("après redémarrage")

	// Session expirée (30 jours) ; « Se déconnecter » ; suppression des données.
	now = now.Add(31 * 24 * time.Hour)
	lea.must("GET", "/api/stages/index", nil, 401)
	lea.must("POST", "/api/stages/join", map[string]any{"ticket": "ST-lmartin-223456789"}, 200)
	lea.must("POST", "/api/stages/leave", map[string]any{}, 200)
	lea.must("GET", "/api/stages/index", nil, 401)
	admin.withSvc(svc2).must("POST", "/api/stages/admin/delete", map[string]any{}, 200)
	if svc2.Store.Enabled() || svc2.Store.Index() != nil {
		t.Fatal("données encore servies après suppression")
	}
}

func (c *client) withSvc(s *Service) *client { c.svc = s; return c }

// Passage de la 3.0.0 : le journal des fiches ouvertes et l'identifiant gardé dans chaque session
// sont effacés au démarrage ; les sessions restent valables.
func TestForgetsOldTraces(t *testing.T) {
	dir := t.TempDir()
	exp := time.Now().Add(24 * time.Hour).UTC().Format(time.RFC3339)
	os.WriteFile(filepath.Join(dir, "stages-state.json"), []byte(`{"enabled":false,"sessions":{"abc":{"u":"lmartin","exp":"`+exp+`"}}}`), 0o600)
	os.WriteFile(filepath.Join(dir, "stages-log.jsonl"), []byte(`{"t":"2026-11-28T10:00:00Z","u":"lmartin","e":"e1"}`+"\n"), 0o600)
	st, err := Open(dir)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(dir, "stages-log.jsonl")); !os.IsNotExist(err) {
		t.Fatal("journal de la 3.0.0 encore là")
	}
	b, _ := os.ReadFile(filepath.Join(dir, "stages-state.json"))
	if bytes.Contains(b, []byte("lmartin")) || !bytes.Contains(b, []byte(`"abc"`)) {
		t.Fatalf("état réécrit : %s", b)
	}
	if len(st.st.Sessions) != 1 {
		t.Fatalf("sessions : %+v", st.st.Sessions)
	}
}
