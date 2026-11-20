package feedback

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func tok(i int) string { return fmt.Sprintf("tok%019d", i) } // 22 caractères, comme un vrai jeton

func openExamsAt(t *testing.T, dir string, day time.Time) *ExamStore {
	t.Helper()
	e, err := OpenExams(dir)
	if err != nil {
		t.Fatal(err)
	}
	e.now = func() time.Time { return day }
	return e
}

func TestExamThreshold(t *testing.T) {
	e := openExamsAt(t, t.TempDir(), time.Date(2026, 11, 20, 10, 0, 0, 0, paris))
	for active, want := range map[int]int{0: 3, 5: 3, 12: 3, 15: 3, 16: 4, 40: 8, 41: 9} {
		e.Active = func(string) int { return active }
		if got := e.Threshold("FIE4"); got != want {
			t.Errorf("%d actifs : seuil %d, attendu %d", active, got, want)
		}
	}
}

func TestExamVotesAreCountedOncePerTokenAndShownOnlyAboveThreshold(t *testing.T) {
	e := openExamsAt(t, t.TempDir(), time.Date(2026, 11, 20, 10, 0, 0, 0, paris))
	e.Active = func(string) int { return 20 } // seuil : 4
	vote := func(i int, on bool) {
		t.Helper()
		if err := e.Vote(ExamVote{Class: "FIE4", UID: "ADE-123-0", Day: "2026-12-01", Token: tok(i), On: on}, nil); err != nil {
			t.Fatal(err)
		}
	}
	for i := 0; i < 3; i++ {
		vote(i, true)
		vote(i, true) // même étudiant, autre appareil : un seul vote
	}
	if s, th := e.Signals("FIE4"); len(s) != 0 || th != 4 {
		t.Fatalf("3 votes sur un seuil de 4 : rien ne doit être montré (%v, seuil %d)", s, th)
	}
	vote(3, true)
	s, _ := e.Signals("FIE4")
	if s["ADE-123-0"] != (ExamSignal{Day: "2026-12-01", Votes: 4}) {
		t.Fatalf("signal attendu : %v", s)
	}
	if other, _ := e.Signals("FIE3"); len(other) != 0 {
		t.Fatal("une autre classe ne voit pas ce signal")
	}
	vote(3, false) // repère retiré
	if s, _ := e.Signals("FIE4"); len(s) != 0 {
		t.Fatal("le retrait d'un vote doit repasser sous le seuil")
	}
}

func TestExamVoteValidationAndLimits(t *testing.T) {
	e := openExamsAt(t, t.TempDir(), time.Date(2026, 11, 20, 10, 0, 0, 0, paris))
	ok := ExamVote{Class: "FIE4", UID: "ADE-1", Day: "2026-11-25", Token: tok(1), On: true}
	bad := []ExamVote{
		{Class: "fie4", UID: ok.UID, Day: ok.Day, Token: ok.Token, On: true},
		{Class: ok.Class, UID: "avec espace", Day: ok.Day, Token: ok.Token, On: true},
		{Class: ok.Class, UID: strings.Repeat("x", 161), Day: ok.Day, Token: ok.Token, On: true},
		{Class: ok.Class, UID: ok.UID, Day: "25/11/2026", Token: ok.Token, On: true},
		{Class: ok.Class, UID: ok.UID, Day: ok.Day, Token: "court", On: true},
		{Class: ok.Class, UID: ok.UID, Day: "2026-11-17", Token: ok.Token, On: true}, // passée depuis 3 jours
		{Class: ok.Class, UID: ok.UID, Day: "2028-01-01", Token: ok.Token, On: true}, // trop lointaine
	}
	for _, v := range bad {
		if err := e.Vote(v, nil); err != ErrInvalid {
			t.Errorf("vote %+v accepté", v)
		}
	}
	// Visiteur refusé par les limites : le vote est ignoré, sans erreur.
	if err := e.Vote(ok, func() bool { return false }); err != nil {
		t.Fatal(err)
	}
	if len(e.classes) != 0 {
		t.Fatal("un vote refusé ne doit rien enregistrer")
	}
	// Plafond de votes par séance.
	for i := 0; i < examMaxVoters; i++ {
		v := ok
		v.Token = tok(i)
		if err := e.Vote(v, nil); err != nil {
			t.Fatal(err)
		}
	}
	v := ok
	v.Token = tok(examMaxVoters)
	if err := e.Vote(v, nil); err != ErrExamFull {
		t.Fatalf("plafond de votes : %v", err)
	}
}

func TestExamsForgetPastSessionsAndSurviveRestart(t *testing.T) {
	dir := t.TempDir()
	day := time.Date(2026, 11, 20, 10, 0, 0, 0, paris)
	e := openExamsAt(t, dir, day)
	for i := 0; i < 3; i++ {
		e.Vote(ExamVote{Class: "FIE4", UID: "ADE-soon", Day: "2026-11-21", Token: tok(i), On: true}, nil)
		e.Vote(ExamVote{Class: "FIE4", UID: "ADE-later", Day: "2026-12-10", Token: tok(i), On: true}, nil)
	}
	if err := e.Flush(); err != nil {
		t.Fatal(err)
	}
	raw, _ := os.ReadFile(filepath.Join(dir, "exams.json"))
	if strings.Contains(string(raw), "127.0.0.1") {
		t.Fatal("aucune adresse ne doit être enregistrée")
	}
	again := openExamsAt(t, dir, day)
	if s, _ := again.Signals("FIE4"); len(s) != 2 {
		t.Fatalf("les votes doivent survivre à un redémarrage : %v", s)
	}
	// Trois jours après la séance du 21 : oubliée, celle du 10 décembre reste.
	later := day.AddDate(0, 0, 4)
	again.now = func() time.Time { return later }
	again.Flush()
	if s, _ := again.Signals("FIE4"); len(s) != 1 || s["ADE-later"].Votes != 3 {
		t.Fatalf("séance passée non oubliée : %v", s)
	}
	raw, _ = os.ReadFile(filepath.Join(dir, "exams.json"))
	if strings.Contains(string(raw), "ADE-soon") {
		t.Fatal("la séance passée doit disparaître du fichier")
	}
}

func TestExamEndpoints(t *testing.T) {
	e := openExamsAt(t, t.TempDir(), time.Now())
	api := New(Config{Exams: e})
	day := time.Now().In(paris).AddDate(0, 0, 3).Format("2006-01-02")
	post := func(origin string, v ExamVote) int {
		raw, _ := json.Marshal(v)
		req := httptest.NewRequest(http.MethodPost, "http://hub.test/api/exams/vote", strings.NewReader(string(raw)))
		req.Header.Set("Content-Type", "application/json")
		if origin != "" {
			req.Header.Set("Origin", origin)
		}
		rec := httptest.NewRecorder()
		api.ServeHTTP(rec, req)
		return rec.Code
	}
	get := func(class string) (int, map[string]any) {
		rec := httptest.NewRecorder()
		api.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "http://hub.test/api/exams?class="+class, nil))
		var out map[string]any
		json.Unmarshal(rec.Body.Bytes(), &out)
		return rec.Code, out
	}
	v := ExamVote{Class: "FIE4", UID: "ADE-9", Day: day, Token: tok(0), On: true}
	if post("https://evil.example", v) != http.StatusForbidden {
		t.Fatal("un autre site ne doit pas pouvoir voter")
	}
	if code, _ := get("<script>"); code != http.StatusBadRequest {
		t.Fatal("classe invalide acceptée")
	}
	// Une même adresse ne compte que 6 nouveaux votants par séance et par jour.
	for i := 0; i < 10; i++ {
		v.Token = tok(i)
		if code := post("http://hub.test", v); code != http.StatusNoContent {
			t.Fatalf("vote %d : HTTP %d", i, code)
		}
	}
	code, out := get("FIE4")
	sig, _ := out["signals"].(map[string]any)["ADE-9"].(map[string]any)
	if code != http.StatusOK || sig == nil || sig["votes"] != float64(6) {
		t.Fatalf("signal attendu à 6 votes : %d %v", code, out)
	}
}

func TestStatsActiveIsTheBusiestDayOfTheWindow(t *testing.T) {
	st, err := OpenStats(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	today := time.Date(2026, 11, 20, 10, 0, 0, 0, paris)
	visit := func(daysAgo, n int, class string) {
		day := today.AddDate(0, 0, -daysAgo)
		st.now = func() time.Time { return day }
		for i := 0; i < n; i++ {
			st.Record(Visit{Token: tok(daysAgo*1000 + i), Class: class})
		}
	}
	visit(20, 30, "FIE4") // hors de la fenêtre de 14 jours
	visit(5, 7, "FIE4")
	visit(0, 4, "FIE4")
	visit(0, 50, "FIE3") // une autre classe ne compte pas
	st.now = func() time.Time { return today }
	if got := st.Active("FIE4", ExamActiveDays); got != 7 {
		t.Fatalf("membres actifs récemment : %d, attendu 7", got)
	}
}
