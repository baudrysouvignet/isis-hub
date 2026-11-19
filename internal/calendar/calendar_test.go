package calendar

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"reflect"
	"strings"
	"testing"
)

func loadData(t *testing.T) Data {
	t.Helper()
	raw, err := os.ReadFile("../../web/data/classes.json")
	if err != nil {
		t.Fatal(err)
	}
	var d Data
	if err := json.Unmarshal(raw, &d); err != nil {
		t.Fatal(err)
	}
	return d
}

func fixture(t *testing.T, promo string) string {
	t.Helper()
	raw, err := os.ReadFile("../../test/fixtures/calendars/" + promo + ".ics")
	if err != nil {
		t.Fatal(err)
	}
	return string(raw)
}

// Chaque calendrier produit doit être identique, octet pour octet, à celui du projet de référence.
func TestSameFilesAsReference(t *testing.T) {
	d := loadData(t)
	raw, _ := os.ReadFile("testdata/reference.json")
	var ref map[string]struct {
		SHA256 string `json:"sha256"`
		Count  int    `json:"count"`
	}
	if err := json.Unmarshal(raw, &ref); err != nil {
		t.Fatal(err)
	}
	checked := 0
	for _, promo := range []string{"fie1", "fie2", "fie3", "fie4", "fie5"} {
		c := d.Classes[strings.ToUpper(promo)]
		text := fixture(t, promo)
		for _, v := range Variants(promo, c) {
			key := promo + "/" + v.Key
			want, ok := ref[key]
			if !ok {
				t.Errorf("%s : variante absente de la référence", key)
				continue
			}
			ics, count, err := Build(text, c, v)
			if err != nil {
				t.Fatalf("%s : %v", key, err)
			}
			sum := sha256.Sum256([]byte(ics))
			if got := hex.EncodeToString(sum[:]); got != want.SHA256 || count != want.Count {
				t.Errorf("%s : %d séances (référence %d), fichier différent de la référence", key, count, want.Count)
			}
			checked++
		}
	}
	if checked != len(ref) {
		t.Errorf("%d calendriers vérifiés sur %d", checked, len(ref))
	}
}

// La détection des groupes doit donner le même résultat que l'original JavaScript.
func TestGroupsLikeJavaScript(t *testing.T) {
	raw, _ := os.ReadFile("testdata/groups.json")
	var corpus [][2]json.RawMessage
	if err := json.Unmarshal(raw, &corpus); err != nil {
		t.Fatal(err)
	}
	for _, item := range corpus {
		var text string
		var want []int
		json.Unmarshal(item[0], &text)
		json.Unmarshal(item[1], &want)
		got := GroupsIn(text)
		if len(got) == 0 && len(want) == 0 {
			continue
		}
		if !reflect.DeepEqual(got, want) {
			t.Errorf("GroupsIn(%q) = %v, JavaScript : %v", text, got, want)
		}
	}
	t.Logf("%d chaînes comparées", len(corpus))
}

func TestHTTP(t *testing.T) {
	d := loadData(t)
	text := fixture(t, "fie4")
	calls := 0
	ade := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		if !strings.Contains(r.URL.RawQuery, "resources=2732&projectId=10") {
			t.Errorf("requête ADE inattendue : %s", r.URL.RawQuery)
		}
		fmt.Fprint(w, text)
	}))
	defer ade.Close()
	s := New(d)
	s.ADEBase = ade.URL

	get := func(path string, headers ...string) *httptest.ResponseRecorder {
		req := httptest.NewRequest("GET", path, nil)
		if len(headers) == 2 {
			req.Header.Set(headers[0], headers[1])
		}
		rec := httptest.NewRecorder()
		s.ServeHTTP(rec, req)
		return rec
	}
	rec := get("/calendar/fie4/ia/1.ics")
	if rec.Code != 200 || !strings.HasPrefix(rec.Body.String(), "BEGIN:VCALENDAR") || rec.Header().Get("Content-Type") != "text/calendar; charset=utf-8" {
		t.Fatalf("calendrier : %d %s", rec.Code, rec.Header())
	}
	if !strings.Contains(rec.Body.String(), "X-WR-CALNAME:ISIS FIE4 · IA · G1") {
		t.Error("nom du calendrier attendu")
	}
	if code := get("/calendar/fie4/ia/1.ics", "If-None-Match", rec.Header().Get("ETag")).Code; code != http.StatusNotModified {
		t.Errorf("revalidation : %d", code)
	}
	get("/calendar/fie4/management/2.ics")
	if calls != 1 {
		t.Errorf("ADE interrogé %d fois, attendu 1 (cache de 15 min)", calls)
	}
	for _, p := range []string{"/calendar/fie4/ia/3.ics", "/calendar/fie9/1.ics", "/calendar/fie2/1.ics", "/calendar/fie1/3.ics", "/calendar/fia4.ics", "/calendar/fie5/1.ics", "/calendar/fie4/ia/1"} {
		if code := get(p).Code; code != http.StatusNotFound {
			t.Errorf("%s : %d, attendu 404", p, code)
		}
	}
}

// Retour d'étudiants FIE5 : ADE nomme le projet tutoré « TD-E5-1-PROJET-1 Projet innovation »,
// la maquette « E5-1-PTUT-1 » (2026-27 : « E5-1-PRJ-1 ») ; les séances doivent rester dans les
// trois parcours.
func TestFIE5ProjectSessionsKept(t *testing.T) {
	c := loadData(t).Classes["FIE5"]
	for _, track := range []string{"ia", "developpement", "management"} {
		for _, s := range []struct{ summary, desc string }{
			{"TD-E5-1-PROJET-1 Projet innovation", "\nProjet d'innovation\nSalle : B101\nTD-E5-1-PROJET-1 Projet innovation\n"},
			{"Projet d'innovation", "E5-1-PRJ-1 Projet d'Innovation\n"},
		} {
			if !Keep(c, Choice{Track: track}, s.summary, s.desc) {
				t.Errorf("%s : séance de projet « %s » retirée", track, s.summary)
			}
		}
	}
	// Le filtre reste actif : un cours d'un autre parcours est toujours retiré.
	if Keep(c, Choice{Track: "ia"}, "CM-E5-1-IMTNS-2 Aide à la décision", "") {
		t.Error("un cours du parcours Management ne doit pas apparaître en IA")
	}
}
