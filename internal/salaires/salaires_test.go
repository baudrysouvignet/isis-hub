package salaires

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"math/rand"
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

// fakeSurvey : un export brut inventé, avec tous les champs que le sondage contient (ceux qui ne
// doivent jamais être gardés portent des marqueurs).
func fakeSurvey(n int) []byte {
	rnd := rand.New(rand.NewSource(42))
	postes := []string{"Développeur / Ingénieur", "Chef de Projet", "Product Owner / Product Manager", "Consultant / Intégrateur", "Autre", "Non renseigné"}
	secteurs := []string{"Éditeur Logiciel Santé", "ESN / Conseil", "Structure de Soins", "Tech / Industrie / Autre"}
	structures := []string{"Grand groupe", "PME", "Administration publique", "Start-up"}
	regions := []string{"Occitanie", "Occitanie", "Île-de-France", "International", "Nouvelle-Aquitaine", "Full Télétravail"}
	xps := []string{"0-1 an", "2-3 ans", "4-5 ans", "6-9 ans", "10+ ans"}
	advs := []string{"Tickets Resto", "Télétravail", "RTT / Congés", "Intéressement"}
	var rows []map[string]any
	for i := 0; i < n; i++ {
		xp := rnd.Intn(5)
		base := 32500 + 5000*xp + 5000*rnd.Intn(3)
		var adv []string
		for _, a := range advs {
			if rnd.Intn(3) > 0 {
				adv = append(adv, a)
			}
		}
		rows = append(rows, map[string]any{
			"annee_diplome": fmt.Sprint(2025 - xp*2 - rnd.Intn(2)), "poste": postes[rnd.Intn(len(postes))], "sexe": []string{"Homme", "Femme"}[rnd.Intn(2)],
			"xp_group": xps[xp], "secteur": secteurs[rnd.Intn(len(secteurs))], "type_structure": structures[rnd.Intn(len(structures))],
			"departement": regions[rnd.Intn(len(regions))], "salaire_base": base, "salaire_total": base + 1000*rnd.Intn(4),
			"annees_experience": 1 + 2*xp, "avantages": adv, "statut_resolution": "Isolé (100% exact)", "anecdote": "ANECDOTE-SECRETE",
		})
	}
	// Deux réponses rares (Bretagne, Data / BI) : fusionnées à l'import.
	rows[0]["departement"], rows[1]["departement"] = "Bretagne", "Bretagne"
	rows[2]["poste"] = "Data / BI"
	rows[3]["statut_resolution"] = "Groupe de 2 profils identiques (Moyenne)"
	b, _ := json.Marshal(map[string]any{
		"metadata":               map[string]any{"application": "sondage.exemple.test", "extraction_date": "2026-11-28 13:19:48"},
		"reponses_individuelles": rows,
		"boite_a_idees":          []map[string]any{{"id": "x", "title": "IDEE-SECRETE", "userHasVoted": 1}},
		"conseils_anecdotes":     []map[string]any{{"conseil": "Négociez votre premier salaire.", "poste": "Chef de Projet", "secteur": "ESN / Conseil", "experience": 3}, {"conseil": "Négociez votre premier salaire."}, {"conseil": "  "}},
		"statistiques_globales":  map[string]any{"mean": 1},
	})
	return b
}

func TestImport(t *testing.T) {
	d, rep, err := Decode(fakeSurvey(150), time.Now())
	if err != nil {
		t.Fatal(err)
	}
	if rep == nil || rep.Rows != 150 || rep.Tips != 1 || d.Grouped != 1 {
		t.Fatalf("rapport : %+v, grouped %d", rep, d.Grouped)
	}
	b, _ := json.Marshal(d)
	for _, secret := range []string{"ANECDOTE", "IDEE", "annee", "experience", "sondage.exemple", "Bretagne", "Data / BI", "Non renseigné", "statut"} {
		if bytes.Contains(b, []byte(secret)) {
			t.Errorf("« %s » gardé : %s", secret, b[:200])
		}
	}
	if d.Promos[0] < 2010 || d.Promos[1] > 2025 || d.Extracted != "2026-11-28" {
		t.Fatalf("promos %v, date %s", d.Promos, d.Extracted)
	}
	if last := d.Dims.Poste[len(d.Dims.Poste)-1]; last != "Autre poste" {
		t.Fatalf("« Autre » et rares fusionnés en dernier : %v", d.Dims.Poste)
	}
	if !contains(d.Dims.Region, "Autres régions et outre-mer") || !contains(d.Dims.Secteur, "Tech / Industrie / Autre") || contains(d.Dims.Secteur, "Autre secteur") {
		t.Fatalf("catégories : %v / %v", d.Dims.Region, d.Dims.Secteur)
	}
	if len(d.Tips) != 1 || d.Tips[0].On {
		t.Fatalf("conseils (sans doublon, à relire) : %+v", d.Tips)
	}
	// Le format du Hub se relit tel quel, et tout est vérifié.
	again, rep2, err := Decode(b, time.Now())
	if err != nil || rep2 != nil || len(again.Rows) != 150 {
		t.Fatalf("relecture : %v", err)
	}
	bad := map[string]func(d *Dataset){
		"catégorie":  func(d *Dataset) { d.Rows[0].Poste = 99 },
		"salaire":    func(d *Dataset) { d.Rows[0].Base = 900_000 },
		"avantage":   func(d *Dataset) { d.Rows[0].Adv = []int{0, 0} },
		"double":     func(d *Dataset) { d.Rows[1].ID = d.Rows[0].ID },
		"contrôle":   func(d *Dataset) { d.Tips[0].T = "a\x00b" },
		"libellé":    func(d *Dataset) { d.Dims.Poste[1] = d.Dims.Poste[0] },
		"format":     func(d *Dataset) { d.Format = "autre" },
		"date":       func(d *Dataset) { d.Extracted = "28/11/2026" },
		"sans ligne": func(d *Dataset) { d.Rows = nil },
	}
	for name, mutate := range bad {
		var c Dataset
		json.Unmarshal(b, &c)
		mutate(&c)
		if err := c.Validate(); err == nil {
			t.Errorf("%s : fichier invalide accepté", name)
		}
	}
}

// Aucune réponse ne doit pouvoir être isolée : tout groupe montré a MinShow réponses, ses quartiles
// MinSpread, et un profil qui ne respecte pas la règle est corrigé par le serveur.
func TestDiscretion(t *testing.T) {
	d, _, err := Decode(fakeSurvey(150), time.Now())
	if err != nil {
		t.Fatal(err)
	}
	e := newEngine(d)
	check := func(where string, g Group) {
		t.Helper()
		if g.Median != nil && g.N < MinShow || g.Q1 != nil && g.N < MinSpread || g.Few && (g.N != 0 || g.Median != nil) {
			t.Fatalf("%s : groupe trop petit montré %+v", where, g)
		}
		if g.Median != nil && int(*g.Median)%500 != 0 {
			t.Fatalf("%s : médiane non arrondie %v", where, *g.Median)
		}
	}
	rnd := rand.New(rand.NewSource(7))
	for i := 0; i < 400; i++ {
		var f Profile
		for _, dim := range factors {
			var s []int
			for v := 0; v < e.levels[dim]; v++ {
				if rnd.Intn(4) == 0 {
					s = append(s, v)
				}
			}
			f.put(dim, s)
		}
		est := e.Estimate(f, i%2)
		if !e.valid(est.F) {
			t.Fatalf("profil rendu invalide : %+v", est.F)
		}
		if n := est.Result.Exact.N; n != 0 && n < MinShow || est.Result.Exact.Few {
			t.Fatalf("profil exact trop petit : %+v", est.Result.Exact)
		}
		check("exact", est.Result.Exact)
		for _, p := range est.Xp.Pts {
			check("xp", p.Obs)
		}
		for _, g := range est.Map.Groups {
			check("carte", g)
		}
		for k, p := range est.Cmp {
			for _, g := range p.Groups {
				check(k, g)
			}
		}
		hidden := 0
		for _, c := range est.Hist.Bins {
			if c != nil && *c > 0 && *c < MinShow {
				t.Fatalf("tranche trop petite : %d", *c)
			}
			if c == nil {
				hidden++
			}
		}
		if hidden == 1 {
			t.Fatalf("une seule tranche masquée : elle se déduit du total %+v", est.Hist)
		}
		for name, list := range est.Chips {
			for v, c := range list {
				if c.N > 0 && c.N < MinShow {
					t.Fatalf("case %s %d : effectif %d montré", name, v, c.N)
				}
			}
		}
	}
	// Une case rare ne se coche pas, même avec une autre du même critère.
	var rare = -1
	for v := 0; v < e.levels[dRegion]; v++ {
		if n := e.count(only(Profile{Xp: []int{4}}, dRegion, v)); n > 0 && n < MinShow {
			rare = v
		}
	}
	if rare >= 0 {
		got := e.enforce(Profile{Xp: []int{4}, Region: []int{0, rare}})
		if has(got.Region, rare) {
			t.Fatalf("case rare gardée : %+v", got)
		}
	}
	// Toute case montrée cochable se coche vraiment : elle reste dans le profil rendu, quitte à ce
	// qu'une case d'un autre critère, devenue trop rare, soit décochée.
	rnd2 := rand.New(rand.NewSource(11))
	for i := 0; i < 300; i++ {
		var f Profile
		for _, dim := range factors {
			if rnd2.Intn(2) == 0 {
				f.put(dim, []int{rnd2.Intn(e.levels[dim])})
			}
		}
		f = e.enforce(f)
		for _, dim := range factors {
			for v, c := range e.chips(f)[dimNames[dim]] {
				if !c.Ok || has(f.get(dim), v) {
					continue
				}
				if got := e.enforce(toggled(f, dim, v)); !has(got.get(dim), v) {
					t.Fatalf("case %s %d cochable mais refusée : %+v → %+v", dimNames[dim], v, f, got)
				}
			}
		}
	}
	// Valeurs hors bornes ignorées.
	if got := e.enforce(Profile{Poste: []int{-1, 99, 0, 0}}); len(got.Poste) > 1 {
		t.Fatalf("profil mal nettoyé : %+v", got)
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
	switch b := body.(type) {
	case nil:
		r = httptest.NewRequest(method, path, nil)
	case []byte:
		r = httptest.NewRequest(method, path, bytes.NewReader(b))
		r.Header.Set("Content-Type", "application/json")
	default:
		raw, _ := json.Marshal(b)
		r = httptest.NewRequest(method, path, bytes.NewReader(raw))
		r.Header.Set("Content-Type", "application/json")
	}
	r.Header.Set("Origin", origin)
	r.Header.Set(csrfHeader, "1")
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
	profile := map[string]any{"f": map[string]any{"xp": []int{1}, "poste": []int{0}}, "target": "base"}

	// Fermé par défaut : rien, pas même le nombre de réponses ni une session.
	if out := lea.must("GET", "/api/salaires/status", nil, 200); string(bytes.TrimSpace(out)) != `{"enabled":false}` {
		t.Fatalf("statut : %s", out)
	}
	lea.must("POST", "/api/salaires/join", map[string]any{"ticket": "ST-lmartin-123456789"}, 404)
	admin.must("POST", "/api/salaires/admin/enabled", map[string]any{"on": true}, 409)
	lea.must("POST", "/api/salaires/admin/upload", fakeSurvey(150), 403)

	// Dépôt de l'export brut : rien d'identifiant n'est gardé sur le disque.
	out := admin.must("POST", "/api/salaires/admin/upload", fakeSurvey(150), 200)
	if !bytes.Contains(out, []byte(`"rows":150`)) || !bytes.Contains(out, []byte(`"merged"`)) {
		t.Fatalf("dépôt : %s", out)
	}
	raw, _ := os.ReadFile(filepath.Join(dir, dataFile))
	if bytes.Contains(raw, []byte("ANECDOTE")) || bytes.Contains(raw, []byte("annee")) || bytes.Contains(raw, []byte("IDEE")) {
		t.Fatal("champ identifiant gardé sur le disque")
	}
	admin.must("POST", "/api/salaires/admin/save", fakeSurvey(150), 400) // l'éditeur n'enregistre que le format du Hub

	// Aperçu de l'administrateur avant l'ouverture.
	boss := &client{t: t, svc: svc}
	boss.must("POST", "/api/salaires/join", map[string]any{"ticket": "ST-bsouvign-123456789"}, 200)
	boss.must("POST", "/api/salaires/estimate", profile, 200)
	lea.must("POST", "/api/salaires/join", map[string]any{"ticket": "ST-lmartin-123456789"}, 404)

	// Ouverture.
	admin.must("POST", "/api/salaires/admin/enabled", map[string]any{"on": true}, 200)
	if out := lea.must("GET", "/api/salaires/status", nil, 200); !bytes.Contains(out, []byte(`"n":150`)) {
		t.Fatalf("statut ouvert : %s", out)
	}
	lea.must("GET", "/api/salaires/info", nil, 401)
	lea.must("POST", "/api/salaires/estimate", profile, 401)
	lea.must("POST", "/api/salaires/join", map[string]any{"ticket": "ST-lmartin-123456789"}, 200)
	info := lea.must("GET", "/api/salaires/info", nil, 200)
	if !bytes.Contains(info, []byte(`"tips":[]`)) || !bytes.Contains(info, []byte(`"min":5`)) {
		t.Fatalf("info (conseils non relus cachés) : %s", info)
	}
	var est Estimate
	json.Unmarshal(lea.must("POST", "/api/salaires/estimate", profile, 200), &est)
	if est.Result.Value <= 0 || len(est.Xp.Pts) != 5 || est.Target != "base" {
		t.Fatalf("estimation : %+v", est.Result)
	}
	lea.must("POST", "/api/salaires/estimate", map[string]any{"f": map[string]any{"xp": []int{1}}, "evil": 1}, 400)

	// L'éditeur : le conseil relu devient visible ; une réponse retouchée est vérifiée.
	var d Dataset
	json.Unmarshal(admin.must("GET", "/api/salaires/admin/data", nil, 200), &d)
	d.Tips[0].On = true
	d.Rows[0].Base = 41000
	admin.must("POST", "/api/salaires/admin/save", d, 200)
	if info := lea.must("GET", "/api/salaires/info", nil, 200); !bytes.Contains(info, []byte("Négociez")) {
		t.Fatalf("conseil relu absent : %s", info)
	}
	d.Rows[0].Poste = 77
	admin.must("POST", "/api/salaires/admin/save", d, 400)

	// Rien sur les étudiants : ni identifiant, ni profil demandé, dans aucun fichier.
	entries, _ := os.ReadDir(dir)
	for _, e := range entries {
		b, _ := os.ReadFile(filepath.Join(dir, e.Name()))
		if bytes.Contains(b, []byte("lmartin")) || bytes.Contains(b, []byte("bsouvign")) {
			t.Fatalf("identifiant gardé dans %s", e.Name())
		}
	}

	// Autre site, ou sans l'en-tête maison : refusé.
	r := httptest.NewRequest("POST", "/api/salaires/estimate", strings.NewReader(`{"f":{}}`))
	r.Header.Set("Content-Type", "application/json")
	r.Header.Set("Origin", "https://ailleurs.test")
	r.Header.Set("Cookie", lea.cookie)
	w := httptest.NewRecorder()
	svc.ServeHTTP(w, r)
	if w.Code != 403 {
		t.Fatalf("autre site : %d", w.Code)
	}

	// Redémarrage : tout survit ; session expirée ; « Se déconnecter » ; suppression.
	svc2 := newSvc(t, dir, &now)
	lea.svc = svc2
	lea.must("POST", "/api/salaires/estimate", profile, 200)
	now = now.Add(31 * 24 * time.Hour)
	lea.must("GET", "/api/salaires/info", nil, 401)
	lea.must("POST", "/api/salaires/join", map[string]any{"ticket": "ST-lmartin-223456789"}, 200)
	lea.must("POST", "/api/salaires/leave", map[string]any{}, 200)
	lea.must("GET", "/api/salaires/info", nil, 401)
	admin.svc = svc2
	admin.must("POST", "/api/salaires/admin/delete", map[string]any{}, 200)
	if svc2.Store.Enabled() || svc2.Store.InfoJSON() != nil {
		t.Fatal("encore servi après suppression")
	}
}
