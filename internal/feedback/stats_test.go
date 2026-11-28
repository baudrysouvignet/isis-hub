package feedback

import (
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestStatsCountsWithoutIdentifiers(t *testing.T) {
	dir := t.TempDir()
	st, err := OpenStats(dir)
	if err != nil {
		t.Fatal(err)
	}
	day := time.Date(2026, 11, 16, 10, 0, 0, 0, paris) // un lundi
	st.now = func() time.Time { return day }
	st.Hit(true)
	st.Hit(false)
	st.Hit(true)
	day = day.AddDate(0, 0, 1)
	st.Hit(true)

	sum := st.Summary()
	if sum.Total != 4 || sum.Today.Unique != 1 || sum.Weekdays[0] != 2 || sum.Weekdays[1] != 1 || sum.TotalDays != 2 {
		t.Fatalf("résumé inattendu : %+v", sum)
	}
	if len(sum.Days) != 120 || sum.Days[119].Date != "2026-11-17" {
		t.Fatalf("série des jours : %d, %+v", len(sum.Days), sum.Days[119])
	}
	st.Flush()
	raw, _ := os.ReadFile(filepath.Join(dir, "stats.json"))
	if strings.ContainsAny(string(raw), ":.") && strings.Contains(string(raw), "127.0.0.1") {
		t.Fatal("aucune adresse ne doit être enregistrée")
	}
	again, _ := OpenStats(dir)
	if again.days["2026-11-16"].Visits != 3 {
		t.Fatal("les compteurs doivent survivre à un redémarrage")
	}
}

func TestPingEndpoint(t *testing.T) {
	st, _ := OpenStats(t.TempDir())
	api := New(Config{Stats: st})
	post := func(origin, body string) int {
		req := httptest.NewRequest(http.MethodPost, "http://hub.test/api/ping", strings.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		if origin != "" {
			req.Header.Set("Origin", origin)
		}
		rec := httptest.NewRecorder()
		api.ServeHTTP(rec, req)
		return rec.Code
	}
	if post("http://hub.test", `{"first":true}`) != http.StatusNoContent {
		t.Fatal("ping refusé")
	}
	if post("https://autre.example", `{"first":true}`) != http.StatusForbidden {
		t.Fatal("un autre site ne doit pas pouvoir compter")
	}
	if post("http://hub.test", `{"first":true,"user":"x"}`) != http.StatusBadRequest {
		t.Fatal("aucun autre champ n'est accepté")
	}
	for _, bad := range []string{`{"token":"court"}`, `{"class":"<b>"}`, `{"device":"iphone-15"}`, `{"mode":"x"}`} {
		if post("http://hub.test", bad) != http.StatusBadRequest {
			t.Fatalf("valeur refusée attendue : %s", bad)
		}
	}
	for i := 0; i < 700; i++ {
		post("http://hub.test", `{}`)
	}
	if v := st.Summary().Total; v != 600 {
		t.Fatalf("limite par adresse : %d ouvertures comptées, attendu 600", v)
	}
}

func TestStatsAccountsPerDay(t *testing.T) {
	dir := t.TempDir()
	st, _ := OpenStats(dir)
	day := time.Date(2026, 11, 18, 9, 0, 0, 0, paris)
	st.now = func() time.Time { return day }
	a, b := "AAAAAAAAAAAAAAAAAAAAAA", "BBBBBBBBBBBBBBBBBBBBBB"
	// Le même compte sur deux appareils, deux fois : un seul compte.
	st.Record(Visit{First: true, Token: a, Class: "FIE4", Device: "phone", Mode: "app"})
	st.Record(Visit{First: true, Token: a, Class: "FIE4", Device: "desktop", Mode: "browser"})
	st.Record(Visit{Token: a, Class: "FIE4"})
	st.Record(Visit{First: true, Token: b, Class: "FIA3", Device: "desktop", Mode: "browser"})
	st.Record(Visit{First: true, Device: "phone", Mode: "browser"}) // sans connexion
	st.Record(Visit{Device: "phone"})                               // même appareil, revenu
	d := st.Summary().Today
	if d.Accounts != 2 || d.Guests != 1 || d.Visits != 6 || d.Unique != 4 {
		t.Fatalf("compteurs : %+v", d)
	}
	if d.Classes["FIE4"] != 1 || d.Classes["FIA3"] != 1 || d.Devices["phone"] != 2 || d.Devices["desktop"] != 1 || d.Modes["app"] != 1 {
		t.Fatalf("répartitions : %+v", d)
	}
	// Redémarrage : les jetons du jour sont gardés (pas de double compte).
	st.Flush()
	again, _ := OpenStats(dir)
	again.now = st.now
	again.Record(Visit{Token: a})
	if again.Summary().Today.Accounts != 2 {
		t.Fatal("un compte déjà vu aujourd'hui ne doit pas être recompté après redémarrage")
	}
	// Le lendemain : les jetons d'hier sont oubliés.
	day = day.AddDate(0, 0, 1)
	again.Record(Visit{Token: a})
	again.Flush()
	raw, _ := os.ReadFile(filepath.Join(dir, "stats.json"))
	if strings.Contains(string(raw), b) {
		t.Fatal("les jetons de la veille doivent disparaître")
	}
	if again.Summary().Today.Accounts != 1 {
		t.Fatal("nouveau jour, nouveau compte")
	}
}

func TestStatsReadsOldFormat(t *testing.T) {
	dir := t.TempDir()
	os.WriteFile(filepath.Join(dir, "stats.json"), []byte(`{"2026-11-17":{"unique":3,"visits":5}}`), 0o600)
	st, err := OpenStats(dir)
	if err != nil || st.days["2026-11-17"].Visits != 5 {
		t.Fatalf("ancien fichier illisible : %v %+v", err, st.days)
	}
}

// Une rafale de visites ne réécrit pas le fichier à chaque fois : écriture groupée (Flush).
func TestStatsWritesAreDeferred(t *testing.T) {
	dir := t.TempDir()
	st, _ := OpenStats(dir)
	for i := 0; i < 100; i++ {
		st.Record(Visit{First: true})
	}
	if _, err := os.Stat(filepath.Join(dir, "stats.json")); !os.IsNotExist(err) {
		t.Fatal("aucune écriture attendue avant Flush")
	}
	st.Flush()
	again, _ := OpenStats(dir)
	if again.Summary().Today.Visits != 100 {
		t.Fatal("les 100 visites doivent être écrites par Flush")
	}
}

// Rubriques : ouvertures et comptes distincts du jour, à part des visites du Hub, et combinaisons
// de rubriques ouvertes par un même compte ce jour-là ; tout est oublié le lendemain.
func TestStatsModules(t *testing.T) {
	dir := t.TempDir()
	st, _ := OpenStats(dir)
	day := time.Date(2026, 11, 28, 9, 0, 0, 0, paris)
	st.now = func() time.Time { return day }
	a, b, c := "AAAAAAAAAAAAAAAAAAAAAA", "BBBBBBBBBBBBBBBBBBBBBB", "CCCCCCCCCCCCCCCCCCCCCC"
	st.Record(Visit{First: true, Token: a, Class: "FIE4", Device: "phone", Mode: "app"}) // le Hub
	st.Record(Visit{Page: "stages", Token: a})
	st.Record(Visit{Page: "stages", Token: a}) // même compte, rouverte
	st.Record(Visit{Page: "salaires", Token: a})
	st.Record(Visit{Page: "stages", Token: b}) // rubrique avant le Hub (ordre des envois)
	st.Record(Visit{First: true, Token: b, Class: "FIE3"})
	st.Record(Visit{First: true, Token: c, Class: "FIE3"})
	st.Record(Visit{Page: "tcg", Token: c})
	st.Record(Visit{Page: "tcg"}) // sans compte : une ouverture, pas un compte
	d := st.Summary().Today
	if m := d.Mods["stages"]; m.Opens != 3 || m.Accounts != 2 {
		t.Fatalf("Stages : %+v", d.Mods)
	}
	if m := d.Mods["tcg"]; m.Opens != 2 || m.Accounts != 1 {
		t.Fatalf("TCG : %+v", d.Mods)
	}
	if d.Visits != 3 || d.Accounts != 3 || d.Classes["FIE3"] != 2 {
		t.Fatalf("les rubriques ne comptent pas comme des visites du Hub : %+v", d)
	}
	want := map[string]int{"hub+stages+salaires": 1, "hub+stages": 1, "hub+tcg": 1}
	if len(d.Combos) != len(want) {
		t.Fatalf("combinaisons : %v", d.Combos)
	}
	for k, n := range want {
		if d.Combos[k] != n {
			t.Fatalf("combinaisons : %v", d.Combos)
		}
	}
	for _, bad := range []string{"autre", "hub"} {
		if (Visit{Page: bad}).valid() {
			t.Fatalf("page « %s » acceptée", bad)
		}
	}
	st.Flush()
	again, _ := OpenStats(dir)
	again.now = st.now
	again.Record(Visit{Page: "stages", Token: b})
	again.Record(Visit{Page: "salaires", Token: b})
	d = again.Summary().Today
	if d.Mods["stages"].Accounts != 2 || d.Combos["hub+stages"] != 0 || d.Combos["hub+stages+salaires"] != 2 {
		t.Fatalf("après redémarrage, un compte n'est pas recompté et sa combinaison suit : %+v", d)
	}
	day = day.AddDate(0, 0, 1)
	again.Record(Visit{Page: "stages", Token: a})
	again.Flush()
	raw, _ := os.ReadFile(filepath.Join(dir, "stats.json"))
	if strings.Contains(string(raw), b) || strings.Contains(string(raw), c) {
		t.Fatal("les jetons de la veille doivent disparaître")
	}
}

// Les compteurs Stages de la 3.0.1 sont versés dans les rubriques.
func TestStatsReadsStagesOf301(t *testing.T) {
	dir := t.TempDir()
	os.WriteFile(filepath.Join(dir, "stats.json"), []byte(`{"days":{"2026-11-28":{"unique":4,"visits":9,"accounts":3,"stages":5,"stagesAccounts":2}},"tokenDay":"2026-11-28","tokens":["AAAAAAAAAAAAAAAAAAAAAA"],"tokensStages":["AAAAAAAAAAAAAAAAAAAAAA"]}`), 0o600)
	st, err := OpenStats(dir)
	if err != nil {
		t.Fatal(err)
	}
	st.now = func() time.Time { return time.Date(2026, 11, 28, 15, 0, 0, 0, paris) }
	st.Record(Visit{Page: "stages", Token: "AAAAAAAAAAAAAAAAAAAAAA"})
	d := st.Summary().Today
	if m := d.Mods["stages"]; m.Opens != 6 || m.Accounts != 2 || d.Stages != 0 {
		t.Fatalf("reprise : %+v", d)
	}
}
