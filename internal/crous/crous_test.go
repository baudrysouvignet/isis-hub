package crous

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

const apiSample = `{"success":true,"data":[{"code":1,"date":"17-11-2026","repas":[{"code":2,"type":"midi","categories":[
{"code":3,"libelle":"Plats","ordre":2,"plats":[{"code":5,"ordre":2,"libelle":"Filet de colin"},{"code":4,"ordre":1,"libelle":"Steak haché de bœuf"}]},
{"code":6,"libelle":"Entrées","ordre":1,"plats":[{"code":7,"ordre":1,"libelle":"Samoussa de légumes"}]}]},
{"code":8,"type":"soir","categories":[{"code":9,"libelle":"Plats","ordre":1,"plats":[{"code":10,"ordre":1,"libelle":"Soupe"}]}]}]}]}`

const pageSample = `<div class="menu_date"><h3 class="menu_date_title"><time datetime="2026-11-18">Menu du mercredi</time></h3></div>
<div class="meal"> <h4 class="meal_title">Déjeuner</h4> <ul class="meal_foodies"> <li>Entrées<ul><li>Tomates fêta</li><li>ou</li><li>Salade Verte</li></ul></li><li>Plats<ul><li>Galette potiron (VG)</li></ul></li> </ul> </div>`

func TestCroustillant(t *testing.T) {
	api := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.Write([]byte(apiSample)) }))
	defer api.Close()
	s := New()
	s.BaseAPI = api.URL
	m := s.Get(context.Background())
	day := m.Days["2026-11-17"]
	if m.Source != "Croustillant" || len(day) != 2 || day[0].Name != "Entrées" || day[1].Dishes[0] != "Steak haché de bœuf" {
		t.Fatalf("menu inattendu : %+v", m)
	}
	for _, c := range day {
		for _, d := range c.Dishes {
			if d == "Soupe" {
				t.Fatal("seul le repas du midi est retenu")
			}
		}
	}
}

func TestFallbackAndCache(t *testing.T) {
	calls := 0
	api := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { calls++; w.WriteHeader(500) }))
	defer api.Close()
	page := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { calls++; w.Write([]byte(pageSample)) }))
	defer page.Close()
	s := New()
	s.BaseAPI, s.BaseCrou = api.URL, page.URL
	m := s.Get(context.Background())
	day := m.Days["2026-11-18"]
	if m.Source != "CROUS Toulouse" || len(day) != 2 || strings.Join(day[0].Dishes, ",") != "Tomates fêta,Salade Verte" {
		t.Fatalf("secours : %+v", m)
	}
	s.Get(context.Background())
	if calls != 2 {
		t.Fatalf("les sources ont été interrogées %d fois, attendu 2 (cache de 12 h)", calls)
	}
}

func TestNoSource(t *testing.T) {
	down := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(503) }))
	defer down.Close()
	s := New()
	s.BaseAPI, s.BaseCrou = down.URL, down.URL
	if m := s.Get(context.Background()); len(m.Days) != 0 {
		t.Fatal("sans source, aucun menu")
	}
}

func TestTodayRefetchedUntilPublished(t *testing.T) {
	served := `{"success":true,"data":[{"date":"17-11-2026","repas":[{"type":"midi","categories":[{"libelle":"Plats","ordre":1,"plats":[{"libelle":"Hier","ordre":1}]}]}]}]}`
	calls := 0
	api := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { calls++; w.Write([]byte(served)) }))
	defer api.Close()
	s := New()
	s.BaseAPI = api.URL
	clock := time.Date(2026, 11, 17, 18, 0, 0, 0, paris)
	s.now = func() time.Time { return clock }
	s.Get(context.Background()) // la veille au soir : menu du 17
	clock = time.Date(2026, 11, 18, 7, 0, 0, 0, paris)
	served = `{"success":true,"data":[{"date":"18-11-2026","repas":[{"type":"midi","categories":[{"libelle":"Plats","ordre":1,"plats":[{"libelle":"Lasagnes","ordre":1}]}]}]}]}`
	m := s.Get(context.Background()) // 13 h plus tard mais pas de menu du 18 : relu
	if calls != 2 || m.Days["2026-11-18"][0].Dishes[0] != "Lasagnes" {
		t.Fatalf("menu du jour non relu : %d appels, %+v", calls, m.Days)
	}
	clock = clock.Add(10 * time.Minute)
	s.Get(context.Background())
	if calls != 2 {
		t.Fatal("pas de nouvelle lecture avant 15 minutes")
	}
	clock = clock.Add(6 * time.Minute)
	s.Get(context.Background())
	if calls != 3 {
		t.Fatalf("relu après 15 minutes même quand le menu est connu : %d", calls)
	}
}

func TestRetriedEvery15Minutes(t *testing.T) {
	calls := 0
	api := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		w.Write([]byte(`{"success":true,"data":[]}`))
	}))
	defer api.Close()
	page := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(404) }))
	defer page.Close()
	s := New()
	s.BaseAPI, s.BaseCrou = api.URL, page.URL
	clock := time.Date(2026, 11, 18, 8, 0, 0, 0, paris)
	s.now = func() time.Time { return clock }
	s.Get(context.Background())
	clock = clock.Add(10 * time.Minute)
	s.Get(context.Background())
	if calls != 1 {
		t.Fatalf("relu trop tôt : %d", calls)
	}
	clock = clock.Add(6 * time.Minute)
	s.Get(context.Background())
	if calls != 2 {
		t.Fatalf("pas relu après 15 minutes : %d", calls)
	}
}

// Les sources ne donnent que le menu du jour : ceux déjà vus restent une semaine, même après un
// redémarrage du serveur (fichier du dossier de données).
func TestHistoryPersistsOneWeek(t *testing.T) {
	day := 0
	api := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		date := time.Date(2026, 11, 17+day, 12, 0, 0, 0, time.UTC).Format("02-01-2006")
		w.Write([]byte(strings.Replace(apiSample, "17-11-2026", date, 1)))
	}))
	defer api.Close()
	path := t.TempDir() + "/crous.json"
	now := time.Date(2026, 11, 17, 9, 0, 0, 0, paris)
	open := func() *Service {
		s := New()
		s.BaseAPI, s.BaseCrou = api.URL, api.URL
		s.now = func() time.Time { return now }
		if err := s.Persist(path); err != nil {
			t.Fatal(err)
		}
		return s
	}
	s := open()
	for ; day < 10; day++ {
		now = time.Date(2026, 11, 17+day, 9, 0, 0, 0, paris)
		s.Get(context.Background())
		if day == 4 {
			s = open() // redémarrage : l'historique est relu sur disque
			if m := s.Get(context.Background()); len(m.Days["2026-11-17"]) == 0 {
				t.Fatal("menu du 17 perdu au redémarrage")
			}
		}
	}
	m := s.Get(context.Background())
	if len(m.Days["2026-11-26"]) == 0 || len(m.Days["2026-11-19"]) == 0 {
		t.Fatalf("semaine écoulée incomplète : %v", keys(m))
	}
	if len(m.Days["2026-11-18"]) != 0 {
		t.Fatalf("menu de plus d'une semaine gardé : %v", keys(m))
	}
}

func keys(m Menus) []string {
	var out []string
	for d := range m.Days {
		out = append(out, d)
	}
	return out
}
