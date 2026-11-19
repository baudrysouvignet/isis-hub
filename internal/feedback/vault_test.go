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
	"time"

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

func TestGradesDisabledStaysPrivate(t *testing.T) {
	dir := t.TempDir()
	store, _ := Open(dir)
	content, _ := OpenContent(dir, calendar.Data{})
	api := New(Config{Store: store, Content: content, AdminUsers: []string{"bsouvign"}, CASValidate: fakeCAS, AllowedOrigins: []string{origin}})
	cookie := adminCookie(t, api)
	admin := map[string]string{"X-Hub-Admin": "1"}

	// Brouillon vide accepté seulement si les notes sont désactivées.
	if rec := call(api, "POST", "/api/admin/grades", map[string]any{"class": "FIE1", "grades": map[string]any{"semesters": []any{}}}, admin, cookie); rec.Code != http.StatusBadRequest {
		t.Fatalf("maquette vide active acceptée : %d", rec.Code)
	}
	draft := sampleGrades()
	draft.Disabled = true
	draft.Semesters[0].UEs[0].Matieres[0].Evals = nil
	if rec := call(api, "POST", "/api/admin/grades", map[string]any{"class": "FIE1", "grades": draft}, admin, cookie); rec.Code != http.StatusOK {
		t.Fatalf("brouillon désactivé refusé : %d %s", rec.Code, rec.Body)
	}
	var pub GradeBook
	json.Unmarshal(call(api, "GET", "/api/grades", nil, nil).Body.Bytes(), &pub)
	if !pub["FIE1"].Disabled || len(pub["FIE1"].Semesters) != 0 || pub["FIE1"].Message != DefaultGradesMessage {
		t.Fatalf("les étudiants ne doivent voir que le message : %+v", pub["FIE1"])
	}
	var full GradeBook
	json.Unmarshal(call(api, "GET", "/api/admin/grades", nil, admin, cookie).Body.Bytes(), &full)
	if len(full["FIE1"].Semesters) != 1 {
		t.Fatal("l'administration garde le brouillon complet")
	}
	if rec := call(api, "GET", "/api/admin/grades", nil, admin); rec.Code != http.StatusUnauthorized {
		t.Fatalf("brouillon lisible sans session : %d", rec.Code)
	}
}

func TestGradesPerTrack(t *testing.T) {
	dir := t.TempDir()
	content, _ := OpenContent(dir, calendar.Data{})
	if err := content.SetGrades("FIE4:ia", sampleGrades()); err != nil {
		t.Fatalf("maquette de parcours refusée : %v", err)
	}
	for _, bad := range []string{"FIE4:", "FIE4:IA", "FIE4:../x", "fie4:ia", "FIE4:ia:x"} {
		if err := content.SetGrades(bad, sampleGrades()); err == nil {
			t.Fatalf("clé %q acceptée", bad)
		}
	}
	again, err := OpenContent(dir, calendar.Data{})
	if err != nil || len(again.Grades()["FIE4:ia"].Semesters) != 1 {
		t.Fatalf("relecture : %v", err)
	}
}

// Poivre : le dossier ne contient plus ni l'id ni l'empreinte simple de la preuve ; un ancien
// fichier (sans poivre) est converti à sa première utilisation, avec la bonne preuve seulement.
func TestVaultPepperAndMigration(t *testing.T) {
	dir := t.TempDir()
	data := base64.StdEncoding.EncodeToString([]byte("chiffré"))
	plain, _ := OpenVaultStore(dir)
	if _, err := plain.Write(vID, vAuth, 0, data); err != nil {
		t.Fatal(err)
	}
	peppered, _ := OpenVaultStore(dir, "poivre-de-test-assez-long-pour-servir")
	if _, err := peppered.Read(vID, vBad); err != errVaultDenied {
		t.Fatalf("mauvaise preuve sur un ancien fichier : %v", err)
	}
	rec, err := peppered.Read(vID, vAuth)
	if err != nil || rec.Data != data {
		t.Fatalf("conversion : %v", err)
	}
	if _, err := os.Stat(filepath.Join(dir, "vault", vID[:2], vID+".json")); !os.IsNotExist(err) {
		t.Fatal("l'ancien fichier, nommé d'après l'id, doit disparaître")
	}
	var found []string
	filepath.WalkDir(filepath.Join(dir, "vault"), func(p string, d os.DirEntry, _ error) error {
		if !d.IsDir() {
			raw, _ := os.ReadFile(p)
			found = append(found, filepath.Base(p)+string(raw))
		}
		return nil
	})
	if len(found) != 1 || strings.Contains(found[0], vID) || strings.Contains(found[0], authHash(vAuth)) {
		t.Fatalf("ni l'id ni l'empreinte simple de la preuve ne doivent rester : %v", found)
	}
	if _, err := peppered.Write(vID, vAuth, rec.V, data); err != nil {
		t.Fatalf("écriture après conversion : %v", err)
	}
}

// Création : seulement en version 0 ; une écriture sur un id inconnu ne crée ni ne compte rien.
// Volume total plafonné. Enregistrement inutilisé depuis 18 mois purgé à l'ouverture.
func TestVaultQuotasAndPurge(t *testing.T) {
	dir := t.TempDir()
	v, _ := OpenVaultStore(dir)
	data := base64.StdEncoding.EncodeToString(make([]byte, 3000))
	if rec, err := v.Write(vID, vAuth, 5, data); err != errConflict || rec.V != 0 {
		t.Fatalf("id inconnu, version 5 : conflit vide attendu, reçu %v", err)
	}
	if c, _ := v.Stats(); c != 0 {
		t.Fatal("rien ne doit être compté")
	}
	v.MaxBytes = 5000
	if _, err := v.Write(vID, vAuth, 0, data); err != nil {
		t.Fatal(err)
	}
	other := strings.Repeat("ab", 32)
	if _, err := v.Write(other, vAuth, 0, data); err != errVaultFull {
		t.Fatalf("volume dépassé : « plein » attendu, reçu %v", err)
	}
	if c, b := v.Stats(); c != 1 || b <= 0 {
		t.Fatalf("compteurs : %d %d", c, b)
	}
	v.now = func() time.Time { return time.Now().AddDate(-2, 0, 0) }
	v.MaxBytes = 1 << 30
	v.Write(other, vAuth, 0, data) // écrit il y a 2 ans
	again, _ := OpenVaultStore(dir)
	if c, _ := again.Stats(); c != 1 {
		t.Fatalf("l'enregistrement abandonné doit être purgé, reste %d", c)
	}
	if _, err := again.Read(other, vAuth); err != errVaultNotFound {
		t.Fatal("enregistrement purgé encore lisible")
	}
}

func TestVaultCreationsPerDay(t *testing.T) {
	s, _ := vaultAPI(t)
	data := base64.StdEncoding.EncodeToString([]byte("x"))
	for i := 0; i < 200; i++ {
		s.vaultCreates.allow("192.0.2.1") // créations déjà faites aujourd'hui depuis cette adresse
	}
	if code, _ := vaultCall(s, map[string]any{"op": "write", "id": vID, "auth": vAuth, "v": 0, "data": data}); code != http.StatusTooManyRequests {
		t.Fatalf("201e création du jour : 429 attendu, reçu %d", code)
	}
}
