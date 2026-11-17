package feedback

import (
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"isishub/internal/calendar"
)

const (
	vID   = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
	vAuth = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
	vBad  = "BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB"
)

func vaultAPI(t *testing.T) (*Service, string) {
	dir := t.TempDir()
	v, err := OpenVaultStore(dir)
	if err != nil {
		t.Fatal(err)
	}
	return New(Config{Vault: v}), dir
}

func vaultCall(s *Service, body map[string]any) (int, map[string]any) {
	raw, _ := json.Marshal(body)
	req := httptest.NewRequest(http.MethodPost, "http://hub.test/api/vault", strings.NewReader(string(raw)))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Origin", "http://hub.test")
	rec := httptest.NewRecorder()
	s.ServeHTTP(rec, req)
	var out map[string]any
	json.Unmarshal(rec.Body.Bytes(), &out)
	return rec.Code, out
}

func TestVaultLifecycle(t *testing.T) {
	s, dir := vaultAPI(t)
	data := base64.StdEncoding.EncodeToString([]byte("octets chiffrés"))

	if code, _ := vaultCall(s, map[string]any{"op": "read", "id": vID, "auth": vAuth}); code != http.StatusNotFound {
		t.Fatalf("lecture d'un coffre absent : %d", code)
	}
	code, out := vaultCall(s, map[string]any{"op": "write", "id": vID, "auth": vAuth, "v": 0, "data": data})
	if code != http.StatusOK || out["v"].(float64) != 1 {
		t.Fatalf("création : %d %v", code, out)
	}
	// Mauvaise preuve : ni lecture, ni écriture, ni suppression.
	for _, op := range []string{"read", "write", "delete"} {
		if code, _ := vaultCall(s, map[string]any{"op": op, "id": vID, "auth": vBad, "v": 1, "data": data}); code != http.StatusForbidden {
			t.Fatalf("%s avec une mauvaise preuve : %d", op, code)
		}
	}
	// Écriture concurrente : version périmée → 409 avec la version actuelle à fusionner.
	code, out = vaultCall(s, map[string]any{"op": "write", "id": vID, "auth": vAuth, "v": 0, "data": data})
	if code != http.StatusConflict || out["v"].(float64) != 1 || out["data"] != data {
		t.Fatalf("conflit : %d %v", code, out)
	}
	code, out = vaultCall(s, map[string]any{"op": "read", "id": vID, "auth": vAuth})
	if code != http.StatusOK || out["data"] != data {
		t.Fatalf("lecture : %d %v", code, out)
	}

	// Sur le disque : aucune preuve en clair, aucune date précise, rien qui désigne quelqu'un.
	raw, err := os.ReadFile(filepath.Join(dir, "vault", vID[:2], vID+".json"))
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(raw), vAuth) || strings.Contains(string(raw), "127.0.0.1") {
		t.Fatalf("enregistrement trop bavard : %s", raw)
	}
	var stored map[string]any
	json.Unmarshal(raw, &stored)
	if len(stored) != 4 {
		t.Fatalf("champs enregistrés : %v", stored)
	}

	if code, _ := vaultCall(s, map[string]any{"op": "delete", "id": vID, "auth": vAuth}); code != http.StatusNoContent {
		t.Fatalf("suppression : %d", code)
	}
	if code, _ := vaultCall(s, map[string]any{"op": "read", "id": vID, "auth": vAuth}); code != http.StatusNotFound {
		t.Fatal("le coffre doit avoir disparu")
	}
}

func TestVaultRejectsBadInput(t *testing.T) {
	s, _ := vaultAPI(t)
	cases := []map[string]any{
		{"op": "read", "id": "../../etc/passwd", "auth": vAuth},
		{"op": "read", "id": strings.ToUpper(vID), "auth": vAuth},
		{"op": "read", "id": vID, "auth": "court"},
		{"op": "write", "id": vID, "auth": vAuth, "v": 0, "data": "pas du base64 !"},
		{"op": "write", "id": vID, "auth": vAuth, "v": 0, "data": ""},
		{"op": "drop", "id": vID, "auth": vAuth},
	}
	for _, c := range cases {
		if code, _ := vaultCall(s, c); code != http.StatusBadRequest {
			t.Fatalf("%v accepté (%d)", c, code)
		}
	}
	// Autre site : refusé avant tout.
	req := httptest.NewRequest(http.MethodPost, "http://hub.test/api/vault", strings.NewReader(`{"op":"read","id":"`+vID+`","auth":"`+vAuth+`"}`))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Origin", "https://pirate.example")
	rec := httptest.NewRecorder()
	s.ServeHTTP(rec, req)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("origine étrangère : %d", rec.Code)
	}
}

func sampleGrades() *GradeClass {
	return &GradeClass{Semesters: []GradeSemester{{
		ID: "S7", Label: "Semestre 7", Start: "2026-09-01", End: "2027-01-31",
		UEs: []GradeUE{{ID: "7.1", Name: "Systèmes d'information de santé", Coef: 6, Matieres: []GradeSubject{
			{ID: "interop", Name: "Interopérabilité", Coef: 3, Code: "A4-1-ISI-2", Evals: []GradeEval{{ID: "s7-int-1", Label: "Quiz", Coef: 1, Date: "2026-11-05"}, {ID: "s7-int-2", Label: "Examen", Coef: 2}}},
		}}},
	}}}
}

func TestGradesValidation(t *testing.T) {
	g := sampleGrades()
	if err := g.Validate(); err != nil || g.Rules.UE != 10 || g.Rules.Matiere != 7 {
		t.Fatalf("maquette valide refusée : %v %+v", err, g.Rules)
	}
	bad := []func(*GradeClass){
		func(g *GradeClass) { g.Semesters[0].End = "2026-01-01" },
		func(g *GradeClass) { g.Semesters[0].UEs[0].Coef = 0 },
		func(g *GradeClass) { g.Semesters[0].UEs[0].Matieres[0].Code = "<script>" },
		func(g *GradeClass) { g.Semesters[0].UEs[0].Matieres[0].Evals[1].ID = "s7-int-1" },
		func(g *GradeClass) { g.Semesters[0].UEs[0].Matieres[0].ID = "../x" },
		func(g *GradeClass) { g.Semesters[0].UEs[0].Matieres[0].Evals[0].Date = "demain" },
		func(g *GradeClass) { g.Rules = GradeRules{UE: 25, Matiere: 7} },
		func(g *GradeClass) { g.Semesters = nil },
	}
	for i, f := range bad {
		g := sampleGrades()
		f(g)
		if err := g.Validate(); err == nil {
			t.Fatalf("cas %d accepté", i)
		}
	}
	g = sampleGrades()
	g.Semesters[0].UEs[0].Name = "  UE\u0007 avec contrôle  "
	g.Validate()
	if g.Semesters[0].UEs[0].Name != "UE avec contrôle" {
		t.Fatalf("nettoyage : %q", g.Semesters[0].UEs[0].Name)
	}
}

func TestGradesAdminAndPublic(t *testing.T) {
	dir := t.TempDir()
	store, _ := Open(dir)
	content, err := OpenContent(dir, calendar.Data{})
	if err != nil {
		t.Fatal(err)
	}
	api := New(Config{Store: store, Content: content, AdminUsers: []string{"bsouvign"}, CASValidate: fakeCAS, AllowedOrigins: []string{origin}})
	payload := map[string]any{"class": "FIA4", "grades": sampleGrades()}
	if rec := call(api, "POST", "/api/admin/grades", payload, map[string]string{"X-Hub-Admin": "1"}); rec.Code != http.StatusUnauthorized {
		t.Fatalf("sans session : %d", rec.Code)
	}
	cookie := adminCookie(t, api)
	if rec := call(api, "POST", "/api/admin/grades", map[string]any{"class": "../x", "grades": sampleGrades()}, map[string]string{"X-Hub-Admin": "1"}, cookie); rec.Code != http.StatusBadRequest {
		t.Fatalf("classe invalide acceptée : %d", rec.Code)
	}
	if rec := call(api, "POST", "/api/admin/grades", payload, map[string]string{"X-Hub-Admin": "1"}, cookie); rec.Code != http.StatusOK {
		t.Fatalf("enregistrement admin : %d %s", rec.Code, rec.Body)
	}
	rec := call(api, "GET", "/api/grades", nil, nil)
	var book GradeBook
	json.Unmarshal(rec.Body.Bytes(), &book)
	if rec.Code != http.StatusOK || book["FIA4"].Semesters[0].UEs[0].Matieres[0].Code != "A4-1-ISI-2" {
		t.Fatalf("lecture publique : %d %s", rec.Code, rec.Body)
	}
	// Relu au redémarrage.
	again, err := OpenContent(dir, calendar.Data{})
	if err != nil || len(again.Grades()["FIA4"].Semesters) != 1 {
		t.Fatalf("relecture : %v", err)
	}
}
