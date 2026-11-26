package feedback

import (
	"encoding/json"
	"net/http"
	"os"
	"strings"
	"testing"

	"isishub/internal/calendar"
)

func defaults(t *testing.T) calendar.Data {
	t.Helper()
	raw, err := os.ReadFile("../../web/data/classes.json")
	if err != nil {
		t.Fatal(err)
	}
	var d calendar.Data
	if err := json.Unmarshal(raw, &d); err != nil {
		t.Fatal(err)
	}
	return d
}

func contentService(t *testing.T) (*Service, *ContentStore, *http.Cookie, string) {
	t.Helper()
	dir := t.TempDir()
	store, _ := Open(dir)
	content, err := OpenContent(dir, defaults(t))
	if err != nil {
		t.Fatal(err)
	}
	s := New(Config{Store: store, Content: content, AdminUsers: []string{"bsouvign"}, CASValidate: fakeCAS, AllowedOrigins: []string{origin}})
	return s, content, adminCookie(t, s), dir
}

func TestDefaultClassesAreValid(t *testing.T) {
	if err := defaults(t).Validate(); err != nil {
		t.Fatal(err)
	}
}

func TestClassesEditedInAdmin(t *testing.T) {
	s, content, cookie, dir := contentService(t)
	admin := map[string]string{"X-Hub-Admin": "1"}
	changed := 0
	content.OnChange = func(calendar.Data) { changed++ }

	d := defaults(t)
	fie4 := d.Classes["FIE4"]
	fie4.Tracks["ia"] = append(fie4.Tracks["ia"], "E4-1-NOUV-1")
	d.Classes["FIE4"] = fie4
	if rec := call(s, "POST", "/api/admin/classes", d, admin); rec.Code != http.StatusUnauthorized {
		t.Fatalf("sans session : %d", rec.Code)
	}
	if rec := call(s, "POST", "/api/admin/classes", d, admin, cookie); rec.Code != http.StatusOK {
		t.Fatalf("enregistrement : %d %s", rec.Code, rec.Body)
	}
	if changed != 1 || !strings.Contains(call(s, "GET", "/api/classes", nil, nil).Body.String(), "E4-1-NOUV-1") {
		t.Fatal("la nouvelle répartition doit être publiée et appliquée aux calendriers")
	}
	// Relue au redémarrage.
	again, err := OpenContent(dir, defaults(t))
	if err != nil || !strings.Contains(strings.Join(again.Classes().Classes["FIE4"].Tracks["ia"], ","), "E4-1-NOUV-1") {
		t.Fatalf("relecture : %v", err)
	}

	bad := []func(*calendar.Data){
		func(d *calendar.Data) { d.ProjectID = 0 },
		func(d *calendar.Data) { d.Season.First = "2027-09-01" },
		func(d *calendar.Data) { c := d.Classes["FIE4"]; c.Filter = "inconnu"; d.Classes["FIE4"] = c },
		func(d *calendar.Data) {
			c := d.Classes["FIE4"]
			c.Tracks["ia"] = []string{"<script>"}
			d.Classes["FIE4"] = c
		},
		func(d *calendar.Data) { c := d.Classes["FIA3"]; c.Resources = nil; d.Classes["FIA3"] = c },
		func(d *calendar.Data) { d.Classes["fie9"] = d.Classes["FIA3"] },
		func(d *calendar.Data) { c := d.Classes["FIE5"]; c.CodeYear = 0; d.Classes["FIE5"] = c },
	}
	for i, mutate := range bad {
		d := defaults(t)
		mutate(&d)
		if rec := call(s, "POST", "/api/admin/classes", d, admin, cookie); rec.Code != http.StatusBadRequest {
			t.Errorf("répartition invalide n°%d acceptée : %d", i+1, rec.Code)
		}
	}
	if changed != 1 {
		t.Error("une répartition refusée ne doit rien changer")
	}
}

func TestLinks(t *testing.T) {
	s, _, cookie, _ := contentService(t)
	admin := map[string]string{"X-Hub-Admin": "1"}
	bad := []map[string]string{{"title": "x", "url": "javascript:alert(1)"}, {"title": "x", "url": "http://exemple.fr"}, {"title": "", "url": "https://exemple.fr"}}
	for _, l := range bad {
		if rec := call(s, "POST", "/api/admin/links", map[string]any{"links": []map[string]string{l}}, admin, cookie); rec.Code != http.StatusBadRequest {
			t.Errorf("%v : %d, attendu 400", l, rec.Code)
		}
	}
	ok := call(s, "POST", "/api/admin/links", map[string]any{"links": []map[string]string{{"title": "Izly", "subtitle": "Resto U", "url": "https://www.izly.fr"}}}, admin, cookie)
	if ok.Code != http.StatusOK || !strings.Contains(call(s, "GET", "/api/content", nil, nil).Body.String(), "izly") {
		t.Fatalf("raccourcis : %d %s", ok.Code, ok.Body)
	}
	if rec := call(s, "POST", "/api/admin/links", map[string]any{"links": []map[string]string{}}, admin); rec.Code != http.StatusUnauthorized {
		t.Errorf("sans session : %d", rec.Code)
	}
}

// Ambiance de saison : réservée à l'administration, et absente de la réponse publique tant qu'elle
// est coupée (rien ne laisse deviner qu'elle existe), gardée au redémarrage, raccourcis intacts.
func TestAmbiance(t *testing.T) {
	s, _, cookie, dir := contentService(t)
	admin := map[string]string{"X-Hub-Admin": "1"}
	public := func() string { return call(s, "GET", "/api/content", nil, nil).Body.String() }
	if strings.Contains(public(), "ambiance") {
		t.Fatalf("ambiance visible alors qu'elle est coupée : %s", public())
	}
	if rec := call(s, "POST", "/api/admin/ambiance", map[string]string{"ambiance": "noel"}, admin); rec.Code != http.StatusUnauthorized {
		t.Errorf("sans session : %d", rec.Code)
	}
	if rec := call(s, "POST", "/api/admin/ambiance", map[string]string{"ambiance": "carnaval"}, admin, cookie); rec.Code != http.StatusBadRequest {
		t.Errorf("ambiance inconnue : %d", rec.Code)
	}
	call(s, "POST", "/api/admin/links", map[string]any{"links": []map[string]string{{"title": "Izly", "url": "https://www.izly.fr"}}}, admin, cookie)
	if rec := call(s, "POST", "/api/admin/ambiance", map[string]string{"ambiance": "noel"}, admin, cookie); rec.Code != http.StatusOK {
		t.Fatalf("activer : %d %s", rec.Code, rec.Body)
	}
	if p := public(); !strings.Contains(p, `"ambiance":"noel"`) || !strings.Contains(p, "izly") {
		t.Fatalf("après activation : %s", p)
	}
	again, err := OpenContent(dir, defaults(t))
	if err != nil || again.Get().Ambiance != "noel" || len(again.Get().Links) != 1 {
		t.Fatalf("au redémarrage : %+v %v", again.Get(), err)
	}
	call(s, "POST", "/api/admin/ambiance", map[string]string{"ambiance": ""}, admin, cookie)
	if p := public(); strings.Contains(p, "ambiance") || !strings.Contains(p, "izly") {
		t.Fatalf("après arrêt : %s", p)
	}
}
