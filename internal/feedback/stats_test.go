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
	for i := 0; i < 40; i++ {
		post("http://hub.test", `{}`)
	}
	if v := st.Summary().Total; v != 30 {
		t.Fatalf("limite par visiteur : %d ouvertures comptées, attendu 30", v)
	}
}
