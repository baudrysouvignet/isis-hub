package feedback

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

const origin = "https://hub.exemple.fr"

func newService(t *testing.T) (*Service, string) {
	t.Helper()
	dir := t.TempDir()
	store, err := Open(dir)
	if err != nil {
		t.Fatal(err)
	}
	return New(Config{Store: store, AdminUsers: []string{"bsouvign"}, CASValidate: fakeCAS, AllowedOrigins: []string{origin}}), dir
}

// fakeCAS joue le CAS de l'université : chaque ticket correspond à un identifiant.
func fakeCAS(_ context.Context, ticket string) (string, error) {
	switch ticket {
	case "ST-ticket-admin-0001":
		return "bsouvign", nil
	case "ST-ticket-autre-0001":
		return "lmartin", nil
	}
	return "", errors.New("ticket refusé par le CAS")
}

// adminCookie ouvre une session administrateur par le CAS.
func adminCookie(t *testing.T, s *Service) *http.Cookie {
	t.Helper()
	rec := call(s, "POST", "/api/admin/cas", map[string]string{"ticket": "ST-ticket-admin-0001"}, map[string]string{"X-Hub-Admin": "1"})
	if rec.Code != http.StatusOK {
		t.Fatalf("connexion admin : %d %s", rec.Code, rec.Body)
	}
	return rec.Result().Cookies()[0]
}

func call(s *Service, method, path string, body any, headers map[string]string, cookies ...*http.Cookie) *httptest.ResponseRecorder {
	var buf bytes.Buffer
	if body != nil {
		json.NewEncoder(&buf).Encode(body)
	}
	req := httptest.NewRequest(method, path, &buf)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Origin", origin)
	for k, v := range headers {
		if v == "" {
			req.Header.Del(k)
		} else {
			req.Header.Set(k, v)
		}
	}
	for _, c := range cookies {
		req.AddCookie(c)
	}
	rec := httptest.NewRecorder()
	s.ServeHTTP(rec, req)
	return rec
}

var valid = map[string]string{"type": "idea", "zone": "Mails", "title": "Recherche", "desc": "Chercher dans les mails", "author": "etudiant"}

func TestSubmitAndMine(t *testing.T) {
	s, dir := newService(t)
	rec := call(s, "POST", "/api/feedback", valid, nil)
	if rec.Code != http.StatusCreated {
		t.Fatalf("envoi : %d %s", rec.Code, rec.Body)
	}
	var out struct {
		ID    int    `json:"id"`
		Token string `json:"token"`
	}
	json.Unmarshal(rec.Body.Bytes(), &out)
	if out.ID != 1 || len(out.Token) < 40 {
		t.Fatalf("réponse inattendue : %+v", out)
	}
	raw, _ := os.ReadFile(filepath.Join(dir, "feedback.json"))
	if strings.Contains(string(raw), out.Token) {
		t.Fatal("le jeton ne doit pas être stocké en clair")
	}
	mine := call(s, "POST", "/api/feedback/mine", map[string]any{"tokens": []string{out.Token, "x"}}, nil)
	var items []Public
	json.Unmarshal(mine.Body.Bytes(), &items)
	if len(items) != 1 || items[0].Title != "Recherche" {
		t.Fatalf("mes propositions : %s", mine.Body)
	}
	if strings.Contains(mine.Body.String(), "etudiant") {
		t.Fatal("« mes propositions » ne renvoie que l'essentiel")
	}
}

func TestSubmitValidation(t *testing.T) {
	s, _ := newService(t)
	bad := []map[string]string{
		{"type": "spam", "zone": "Mails", "title": "a", "desc": "b"},
		{"type": "idea", "zone": "Ailleurs", "title": "a", "desc": "b"},
		{"type": "idea", "zone": "Mails", "title": "", "desc": "b"},
		{"type": "idea", "zone": "Mails", "title": "a", "desc": "b", "author": "<script>"},
	}
	for _, b := range bad {
		if rec := call(s, "POST", "/api/feedback", b, nil); rec.Code != http.StatusBadRequest {
			t.Errorf("%v : %d, attendu 400", b, rec.Code)
		}
	}
	if rec := call(s, "POST", "/api/feedback", valid, map[string]string{"Origin": "https://evil.example"}); rec.Code != http.StatusForbidden {
		t.Errorf("autre origine : %d, attendu 403", rec.Code)
	}
	if rec := call(s, "POST", "/api/feedback", map[string]any{"type": "idea", "inconnu": 1}, nil); rec.Code != http.StatusBadRequest {
		t.Errorf("champ inconnu : %d, attendu 400", rec.Code)
	}
}

func TestSubmitRateLimit(t *testing.T) {
	s, _ := newService(t)
	for i := 0; i < 5; i++ {
		call(s, "POST", "/api/feedback", valid, nil)
	}
	if rec := call(s, "POST", "/api/feedback", valid, nil); rec.Code != http.StatusTooManyRequests {
		t.Fatalf("6e envoi : %d, attendu 429", rec.Code)
	}
}

func TestAdmin(t *testing.T) {
	s, _ := newService(t)
	call(s, "POST", "/api/feedback", valid, nil)
	admin := map[string]string{"X-Hub-Admin": "1"}

	if rec := call(s, "GET", "/api/admin/feedback", nil, admin); rec.Code != http.StatusUnauthorized {
		t.Fatalf("sans session : %d", rec.Code)
	}
	for _, ticket := range []string{"ST-ticket-autre-0001", "ST-ticket-inconnu-01", "pas-un-ticket"} {
		rec := call(s, "POST", "/api/admin/cas", map[string]string{"ticket": ticket}, admin)
		if rec.Code == http.StatusOK || len(rec.Result().Cookies()) > 0 {
			t.Fatalf("%s : %d, aucune session attendue", ticket, rec.Code)
		}
	}
	if rec := call(s, "POST", "/api/admin/cas", map[string]string{"ticket": "ST-ticket-admin-0001"}, nil); rec.Code != http.StatusForbidden {
		t.Fatalf("sans en-tête X-Hub-Admin : %d", rec.Code)
	}
	if rec := call(s, "POST", "/api/admin/cas", map[string]string{"ticket": "ST-ticket-admin-0001"}, map[string]string{"X-Hub-Admin": "1", "Origin": "https://evil.example"}); rec.Code != http.StatusForbidden {
		t.Fatalf("depuis un autre site : %d", rec.Code)
	}
	cookie := adminCookie(t, s)
	if !cookie.HttpOnly || cookie.SameSite != http.SameSiteStrictMode || cookie.Path != "/" {
		t.Fatal("cookie admin : HttpOnly, SameSite=Strict et Path=/ attendus")
	}
	req := httptest.NewRequest("GET", "/admin", nil)
	req.AddCookie(cookie)
	if !s.IsAdmin(req) || s.IsAdmin(httptest.NewRequest("GET", "/admin", nil)) {
		t.Fatal("IsAdmin doit reconnaître la session, et elle seule")
	}
	if me := call(s, "GET", "/api/admin/me", nil, admin, cookie); !strings.Contains(me.Body.String(), "bsouvign") {
		t.Fatalf("identité : %s", me.Body)
	}
	list := call(s, "GET", "/api/admin/feedback", nil, admin, cookie)
	if list.Code != http.StatusOK {
		t.Fatalf("liste : %d %s", list.Code, list.Body)
	}
	up := call(s, "POST", "/api/admin/feedback/1", map[string]string{"status": "done", "reply": "Fait !", "note": "interne"}, admin, cookie)
	if up.Code != http.StatusOK {
		t.Fatalf("mise à jour : %d %s", up.Code, up.Body)
	}
	if rec := call(s, "POST", "/api/admin/feedback/1/delete", map[string]string{}, admin); rec.Code != http.StatusUnauthorized {
		t.Fatalf("suppression sans session : %d", rec.Code)
	}
	if del := call(s, "POST", "/api/admin/feedback/1/delete", map[string]string{}, admin, cookie); del.Code != http.StatusOK {
		t.Fatalf("suppression : %d %s", del.Code, del.Body)
	}
	if list := call(s, "GET", "/api/admin/feedback", nil, admin, cookie); strings.Contains(list.Body.String(), `"id":1`) {
		t.Fatal("la proposition supprimée ne doit plus apparaître")
	}
	if del := call(s, "POST", "/api/admin/feedback/1/delete", map[string]string{}, admin, cookie); del.Code != http.StatusNotFound {
		t.Fatalf("seconde suppression : %d, attendu 404", del.Code)
	}
	call(s, "POST", "/api/admin/logout", map[string]string{}, admin, cookie)
	if rec := call(s, "GET", "/api/admin/feedback", nil, admin, cookie); rec.Code != http.StatusUnauthorized {
		t.Fatalf("après déconnexion : %d", rec.Code)
	}
}

func TestCASRateLimit(t *testing.T) {
	s, _ := newService(t)
	admin := map[string]string{"X-Hub-Admin": "1"}
	for i := 0; i < 5; i++ {
		call(s, "POST", "/api/admin/cas", map[string]string{"ticket": "ST-ticket-autre-0001"}, admin)
	}
	if rec := call(s, "POST", "/api/admin/cas", map[string]string{"ticket": "ST-ticket-admin-0001"}, admin); rec.Code != http.StatusTooManyRequests {
		t.Fatalf("6e essai : %d, attendu 429", rec.Code)
	}
}

func TestAdminDisabledWithoutUsers(t *testing.T) {
	store, _ := Open(t.TempDir())
	s := New(Config{Store: store, CASValidate: fakeCAS, AllowedOrigins: []string{origin}})
	if rec := call(s, "POST", "/api/admin/cas", map[string]string{"ticket": "ST-ticket-admin-0001"}, map[string]string{"X-Hub-Admin": "1"}); rec.Code != http.StatusNotFound {
		t.Fatalf("sans ADMIN_USERS : %d, attendu 404", rec.Code)
	}
}

// Le validateur parle bien le protocole CAS (serviceValidate) et lit l'identifiant renvoyé.
func TestCASValidator(t *testing.T) {
	cas := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/cas/serviceValidate" || r.URL.Query().Get("service") != ENTService {
			t.Errorf("requête CAS inattendue : %s", r.URL)
		}
		if r.URL.Query().Get("ticket") == "ST-bon-ticket-123" {
			w.Write([]byte(`<cas:serviceResponse xmlns:cas="http://www.yale.edu/tp/cas"><cas:authenticationSuccess><cas:user>bsouvign</cas:user></cas:authenticationSuccess></cas:serviceResponse>`))
			return
		}
		w.Write([]byte(`<cas:serviceResponse xmlns:cas="http://www.yale.edu/tp/cas"><cas:authenticationFailure code="INVALID_TICKET">non</cas:authenticationFailure></cas:serviceResponse>`))
	}))
	defer cas.Close()
	validate := CASValidator(cas.URL, ENTService)
	if user, err := validate(context.Background(), "ST-bon-ticket-123"); err != nil || user != "bsouvign" {
		t.Fatalf("bon ticket : %q %v", user, err)
	}
	if _, err := validate(context.Background(), "ST-mauvais-ticket"); err == nil {
		t.Fatal("un ticket refusé par le CAS doit échouer")
	}
}

func TestPersistence(t *testing.T) {
	dir := t.TempDir()
	store, _ := Open(dir)
	store.Add(NewItem{Type: "bug", Zone: "Moodle", Title: "x", Desc: "y"})
	again, err := Open(dir)
	if err != nil || len(again.All()) != 1 {
		t.Fatalf("relecture : %v %d", err, len(again.All()))
	}
}
