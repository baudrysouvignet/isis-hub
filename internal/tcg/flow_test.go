package tcg

// Parcours complet, par l'API HTTP, comme la page et l'administration le font : lancement depuis
// l'administration, propositions (avec et sans photo), modération, jury, impression automatique à
// la date de sortie, boosters, signalement, échange, redémarrage du serveur et sauvegardes.

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

type api struct {
	t      *testing.T
	svc    *Service
	cookie string
	admin  bool
}

func (a *api) do(method, path string, body any) (int, map[string]any) {
	a.t.Helper()
	var rd *bytes.Reader
	ctype := "application/json"
	switch b := body.(type) {
	case nil:
		rd = bytes.NewReader(nil)
	case *multipart.Writer:
		a.t.Fatal("utiliser propose()")
	case [2]any: // corps multipart déjà prêt
		rd = bytes.NewReader(b[0].([]byte))
		ctype = b[1].(string)
	default:
		raw, _ := json.Marshal(b)
		rd = bytes.NewReader(raw)
	}
	r := httptest.NewRequest(method, "https://hub.test"+path, rd)
	r.Header.Set("Origin", "https://hub.test")
	r.Header.Set("Content-Type", ctype)
	if a.admin {
		r.Header.Set("X-Hub-Admin", "1")
		r.Header.Set("Cookie", "hub_admin=ok")
	} else {
		r.Header.Set("X-Hub-TCG", "1")
		if a.cookie != "" {
			r.Header.Set("Cookie", a.cookie)
		}
	}
	w := httptest.NewRecorder()
	a.svc.ServeHTTP(w, r)
	for _, c := range w.Result().Cookies() {
		if c.Name == cookieName {
			a.cookie = c.Name + "=" + c.Value
		}
	}
	var out map[string]any
	raw := w.Body.Bytes()
	if len(raw) > 0 && raw[0] == '[' {
		var list []any
		json.Unmarshal(raw, &list)
		out = map[string]any{"list": list}
	} else {
		json.Unmarshal(raw, &out)
	}
	return w.Code, out
}

func (a *api) must(method, path string, body any, want int) map[string]any {
	a.t.Helper()
	code, out := a.do(method, path, body)
	if code != want {
		a.t.Fatalf("%s %s : %d (attendu %d) %v", method, path, code, want, out)
	}
	return out
}

func (a *api) state() View {
	a.t.Helper()
	r := httptest.NewRequest("GET", "https://hub.test/api/tcg/state", nil)
	r.Header.Set("Cookie", a.cookie)
	w := httptest.NewRecorder()
	a.svc.ServeHTTP(w, r)
	if w.Code != 200 {
		a.t.Fatalf("état : %d %s", w.Code, w.Body)
	}
	var v View
	json.Unmarshal(w.Body.Bytes(), &v)
	return v
}

// propose envoie une carte comme la page (multipart) ; photo/thumb nil = champ absent.
func (a *api) propose(title string, photo, thumb []byte, consent bool) (int, map[string]any) {
	var body bytes.Buffer
	mw := multipart.NewWriter(&body)
	mw.WriteField("title", title)
	mw.WriteField("desc", "Deux phrases pour la promo. Tout le monde la reconnaîtra.")
	mw.WriteField("cat", "moment")
	if consent {
		mw.WriteField("consentPeople", "1")
		mw.WriteField("consentRights", "1")
	}
	if photo != nil {
		fw, _ := mw.CreateFormFile("photo", "photo.jpg")
		fw.Write(photo)
	}
	if thumb != nil {
		fw, _ := mw.CreateFormFile("thumb", "vignette.jpg")
		fw.Write(thumb)
	}
	mw.Close()
	return a.do("POST", "/api/tcg/propose", [2]any{body.Bytes(), mw.FormDataContentType()})
}

// imgCode : statut HTTP d'une image, vue par un joueur ou par l'administration.
func imgCode(svc *Service, img string, admin bool) int {
	r := httptest.NewRequest("GET", "https://hub.test/"+img, nil)
	if admin {
		r.Header.Set("Cookie", "hub_admin=ok")
	}
	w := httptest.NewRecorder()
	svc.ServeHTTP(w, r)
	return w.Code
}

func newService(t *testing.T, dir string, clk *clock) *Service {
	t.Helper()
	g, err := Open(dir, "poivre", Local{Dir: filepath.Join(dir, "tcg-img")})
	if err != nil {
		t.Fatal(err)
	}
	g.now = clk.now
	return (&Service{
		Game: g,
		CASValidate: func(_ context.Context, ticket string) (string, error) {
			// Faux CAS : « ST-<identifiant>-… ».
			parts := strings.Split(ticket, "-")
			if len(parts) < 3 {
				return "", fmt.Errorf("refusé")
			}
			return parts[1], nil
		},
		IsAdmin:        func(r *http.Request) bool { return strings.Contains(r.Header.Get("Cookie"), "hub_admin=ok") },
		AllowedOrigins: []string{"https://hub.test"},
	}).Init()
}

func TestFullLaunchFlow(t *testing.T) {
	dir := t.TempDir()
	clk := &clock{t: time.Date(2026, 11, 24, 9, 0, 0, 0, Paris)}
	svc := newService(t, dir, clk)
	admin := &api{t: t, svc: svc, admin: true}
	anon := &api{t: t, svc: svc}
	photo, thumb := jpegWithExif(t, 960, 720), jpegWithExif(t, 320, 240)

	// 0. Rien de lancé : le jeu est masqué, personne ne peut proposer.
	if out := anon.must("GET", "/api/tcg/public", nil, 200); out["phase"] != "off" {
		t.Fatalf("phase initiale : %v", out["phase"])
	}

	// 1. Lancement depuis l'administration : réglages, puis vague 1 (dates du compte à rebours).
	day := func(d, hh int) time.Time { return time.Date(2026, 11, 24+d, hh, 0, 0, 0, Paris) }
	admin.must("POST", "/api/tcg/admin/season", map[string]any{"enabled": true, "name": "Saison 1", "perDay": 3, "paceDays": 14, "autoWeekly": true, "runs": map[string]int{"commune": 0, "rare": 25, "epique": 10, "legendaire": 3, "unique": 1}}, 200)
	admin.must("POST", "/api/tcg/admin/wave", map[string]any{"n": 0, "proposalsUntil": day(5, 20), "juryFrom": day(6, 6), "juryUntil": day(12, 20), "releaseAt": day(6, 6), "size": 12}, 400) // jury après la sortie
	admin.must("POST", "/api/tcg/admin/wave", map[string]any{"n": 0, "proposalsUntil": day(5, 20), "juryFrom": day(6, 6), "juryUntil": day(12, 20), "releaseAt": day(13, 6), "size": 12}, 200)
	pub := anon.must("GET", "/api/tcg/public", nil, 200)
	if pub["phase"] != "soon" {
		t.Fatalf("après lancement : %v", pub["phase"])
	}
	rel, _ := time.Parse(time.RFC3339, pub["waves"].([]any)[0].(map[string]any)["releaseAt"].(string))
	if !rel.Equal(day(13, 6)) {
		t.Fatalf("date affichée sur la page d'attente : %v", rel)
	}
	// Sans session administrateur, l'administration du jeu est fermée.
	if code, _ := anon.do("POST", "/api/tcg/admin/wave/1/print", map[string]any{}); code != 401 {
		t.Fatalf("impression sans admin : %d", code)
	}

	// 2. Joueurs (ticket CAS validé) et propositions.
	players := map[string]*api{}
	names := []string{"ines", "hugo", "sarah", "yanis", "camille", "theo"}
	for _, n := range names {
		p := &api{t: t, svc: svc}
		p.must("POST", "/api/tcg/join", map[string]any{"ticket": "ST-" + n + "-123456789", "pseudo": strings.ToUpper(n[:1]) + n[1:] + " X."}, 200)
		players[n] = p
	}
	ines := players["ines"]
	if code, out := ines.propose("Sans photo", nil, nil, true); code != 400 {
		t.Fatalf("proposition sans photo : %d %v", code, out)
	}
	if code, _ := ines.propose("Sans vignette", photo, nil, true); code != 400 {
		t.Fatal("proposition sans vignette acceptée")
	}
	if code, _ := ines.propose("Sans accord", photo, thumb, false); code != 400 {
		t.Fatal("proposition sans les deux engagements acceptée")
	}
	if code, _ := ines.propose("Mauvais format", thumb, thumb, true); code != 400 {
		t.Fatal("photo aux mauvaises dimensions acceptée")
	}
	if code, _ := ines.propose("Faux JPEG", []byte("<html>pas une image</html>"), thumb, true); code != 400 {
		t.Fatal("faux fichier accepté")
	}
	n := 0
	for i := 0; i < 3; i++ {
		for _, name := range names {
			n++
			if code, out := players[name].propose(fmt.Sprintf("Carte numéro %02d", n), jpegSeed(t, 960, 720, uint8(n)), jpegSeed(t, 320, 240, uint8(n)), true); code != 201 {
				t.Fatalf("proposition %d : %d %v", n, code, out)
			}
		}
	}
	if code, _ := ines.propose("Une de trop", photo, thumb, true); code != 429 {
		t.Fatalf("4e proposition du jour : %d", code)
	}
	if st := ines.state(); len(st.Proposals) != 3 || st.Proposals[0].Status != StatusPending || st.Me.ProposalsLeft != 0 {
		t.Fatalf("mes propositions : %+v", st.Proposals)
	}
	// La photo est servie par le serveur, sans ses métadonnées.
	img := ines.state().Proposals[0].Img
	r := httptest.NewRequest("GET", "https://hub.test/"+img, nil)
	w := httptest.NewRecorder()
	svc.ServeHTTP(w, r)
	if w.Code != 200 || bytes.Contains(w.Body.Bytes(), []byte("GPS")) {
		t.Fatalf("image servie : %d", w.Code)
	}

	// 3. Modération : 16 validées, 1 bloquée (message visible), 1 retirée par son auteur.
	pending := admin.must("GET", "/api/tcg/admin/cards?filter=pending", nil, 200)["list"].([]any)
	if len(pending) != 18 {
		t.Fatalf("file à valider : %d", len(pending))
	}
	var blocked, withdrawn string
	for i, x := range pending {
		c := x.(map[string]any)
		id := c["id"].(string)
		switch {
		case i == 0:
			blocked = id
			admin.must("POST", "/api/tcg/admin/card/"+id, map[string]any{"action": "block", "reason": "illisible", "message": "Renvoie une photo plus nette !"}, 200)
		case c["author"].(map[string]any)["pseudo"] == "Theo X." && withdrawn == "":
			withdrawn = id
		default:
			admin.must("POST", "/api/tcg/admin/card/"+id, map[string]any{"action": "validate"}, 200)
		}
	}
	admin.must("POST", "/api/tcg/admin/card/"+blocked, map[string]any{"action": "block", "reason": "inconnu"}, 409) // déjà bloquée
	// La photo d'une carte bloquée n'est plus servie aux joueurs ; l'administration la voit encore.
	blockedImg := ""
	for _, x := range admin.must("GET", "/api/tcg/admin/cards?filter=blocked", nil, 200)["list"].([]any) {
		if c := x.(map[string]any); c["id"] == blocked {
			blockedImg = c["img"].(string)
		}
	}
	if imgCode(svc, blockedImg, false) != 404 || imgCode(svc, blockedImg, true) != 200 {
		t.Fatalf("image d'une carte bloquée : joueur %d, admin %d", imgCode(svc, blockedImg, false), imgCode(svc, blockedImg, true))
	}
	players["theo"].must("POST", "/api/tcg/proposal/"+withdrawn+"/withdraw", nil, 200)
	for _, p := range players["ines"].state().Proposals {
		if p.ID == blocked && (p.Status != StatusBlocked || p.Message != "Renvoie une photo plus nette !") {
			t.Fatalf("blocage vu par l'auteur : %+v", p)
		}
	}

	// 4. Jury : ouvert à sa date, bulletins sans ses propres cartes, classement modifiable.
	if players["hugo"].state().Jury != nil {
		t.Fatal("jury ouvert trop tôt")
	}
	clk.t = day(6, 7)
	for _, name := range names {
		p := players[name]
		st := p.state()
		if st.Jury == nil || len(st.Jury.Ballots) != 1 {
			t.Fatalf("%s : pas de bulletin", name)
		}
		b := st.Jury.Ballots[0]
		var rank []string
		for _, c := range b.Cards {
			if c.Author != "" {
				t.Fatal("auteur visible pendant le jury")
			}
			rank = append(rank, c.ID)
		}
		p.must("POST", "/api/tcg/jury", map[string]any{"wave": st.Jury.Wave, "ballot": 0, "rank": rank}, 200)
		p.must("POST", "/api/tcg/jury", map[string]any{"wave": st.Jury.Wave, "ballot": 0, "rank": rank[:2]}, 400) // incomplet
		p.must("POST", "/api/tcg/jury/more", nil, 200)
	}
	if st := ines.state(); st.Jury.Jurors != len(names) || len(st.Jury.Ballots) != 2 {
		t.Fatalf("jurés : %d, bulletins : %d", st.Jury.Jurors, len(st.Jury.Ballots))
	}
	// Aperçu de l'impression et rareté forcée par l'administrateur.
	prev := admin.must("GET", "/api/tcg/admin/wave/1/preview", nil, 200)
	cands := prev["cards"].([]any)
	if len(cands) != 16 {
		t.Fatalf("candidates : %d", len(cands))
	}
	forced := cands[len(cands)-1].(map[string]any)["id"].(string)
	admin.must("POST", "/api/tcg/admin/wave/1/rarity", map[string]any{"card": forced, "rarity": "unique"}, 200)
	if code, _ := players["hugo"].do("POST", "/api/tcg/booster", nil); code != 409 {
		t.Fatal("booster avant la sortie")
	}

	// 5. Sortie : la vague s'imprime seule à l'heure, la vague 2 est programmée.
	clk.t = day(13, 6).Add(time.Minute)
	svc.Game.Tick()
	pub = anon.must("GET", "/api/tcg/public", nil, 200)
	if pub["phase"] != "live" {
		t.Fatalf("après la sortie : %v", pub["phase"])
	}
	waves := pub["waves"].([]any)
	if len(waves) != 2 || waves[0].(map[string]any)["total"].(float64) != 12 {
		t.Fatalf("vagues après impression : %v", waves)
	}
	st := ines.state()
	uniques := 0
	for _, c := range st.Cards {
		if c.Rarity == Unique {
			uniques++
			if c.ID != forced {
				t.Fatal("la rareté forcée n'a pas été appliquée")
			}
		}
	}
	if uniques != 1 {
		t.Fatalf("uniques : %d", uniques)
	}

	// 6. Boosters : 1 par jour, 5 cartes, cartes « Nouvelle ».
	for _, name := range names {
		out := players[name].must("POST", "/api/tcg/booster", nil, 200)
		if len(out["pulls"].([]any)) != 5 {
			t.Fatal("booster incomplet")
		}
		players[name].must("POST", "/api/tcg/booster", nil, 409)
	}
	clk.t = clk.t.Add(24 * time.Hour)
	for _, name := range names {
		players[name].must("POST", "/api/tcg/booster", nil, 200)
	}

	// 7. Signalement → retrait : la carte sort du tirage, ceux qui l'ont la gardent.
	hugo := players["hugo"]
	var target CardView
	for id := range hugo.state().Owned {
		for _, c := range hugo.state().Cards {
			if c.ID == id && !c.Mine {
				target = c
			}
		}
	}
	if target.ID == "" {
		t.Fatal("rien à signaler")
	}
	hugo.must("POST", "/api/tcg/report", map[string]any{"card": target.ID, "reason": "moque"}, 200)
	hugo.must("POST", "/api/tcg/report", map[string]any{"card": target.ID, "reason": "moque"}, 409)
	reps := admin.must("GET", "/api/tcg/admin/cards?filter=reports", nil, 200)["list"].([]any)
	if len(reps) != 1 {
		t.Fatalf("signalées : %d", len(reps))
	}
	removedImg := target.Img
	if imgCode(svc, removedImg, false) != 200 {
		t.Fatal("image d'une carte en jeu non servie")
	}
	admin.must("POST", "/api/tcg/admin/card/"+target.ID, map[string]any{"action": "remove"}, 200)
	if imgCode(svc, removedImg, false) != 404 {
		t.Fatal("image d'une carte retirée encore servie")
	}
	admin.must("POST", "/api/tcg/admin/card/"+target.ID, map[string]any{"action": "restore"}, 200)
	if imgCode(svc, removedImg, false) != 200 {
		t.Fatal("image d'une carte restaurée non servie")
	}
	admin.must("POST", "/api/tcg/admin/card/"+target.ID, map[string]any{"action": "remove"}, 200)
	found := false
	for _, c := range hugo.state().Cards {
		if c.ID == target.ID {
			found = true
			if !c.Removed || c.Img != "" {
				t.Fatal("carte retirée encore visible")
			}
		}
	}
	if !found || len(hugo.state().Owned[target.ID]) == 0 {
		t.Fatal("l'exemplaire d'une carte retirée doit rester")
	}

	// 8. Échange en face à face par l'API.
	sarah := players["sarah"]
	code := hugo.must("POST", "/api/tcg/trade/new", map[string]any{"invite": ""}, 200)["code"].(string)
	sarah.must("POST", "/api/tcg/trade/join", map[string]any{"code": code}, 200)
	var give, get Copy
	for id, s := range hugo.state().Owned {
		give = Copy{id, s[0]}
		break
	}
	for id, s := range sarah.state().Owned {
		get = Copy{id, s[0]}
		break
	}
	hugo.must("POST", "/api/tcg/trade/"+code+"/offer", map[string]any{"offer": []Copy{give}}, 200)
	sarah.must("POST", "/api/tcg/trade/"+code+"/offer", map[string]any{"offer": []Copy{get}}, 200)
	ts := hugo.must("GET", "/api/tcg/trade/"+code+"?v=-1", nil, 200)
	ov := ts["offerV"]
	hugo.must("POST", "/api/tcg/trade/"+code+"/ready", map[string]any{"offerV": ov, "ready": true}, 200)
	sarah.must("POST", "/api/tcg/trade/"+code+"/ready", map[string]any{"offerV": ov, "ready": true}, 200)
	if ts := hugo.must("GET", "/api/tcg/trade/"+code+"?v=-1", nil, 200); ts["status"] != "done" {
		t.Fatalf("échange : %v", ts["status"])
	}
	if len(hugo.state().Trades) != 1 || len(sarah.state().Trades) != 1 {
		t.Fatal("historique d'échange")
	}

	// 9. Après la sortie, les propositions continuent (pour la vague suivante).
	players["yanis"].must("POST", "/api/tcg/pseudo", map[string]any{"pseudo": "Yanis K."}, 404) // le nom ne se change pas
	if code, _ := players["yanis"].propose("Pour la vague deux", photo, thumb, true); code != 201 {
		t.Fatal("proposition après le lancement")
	}

	// 10. Redémarrage du serveur : tout est relu depuis tcg.json, les sessions tiennent.
	before := hugo.state()
	if err := svc.Game.Flush(); err != nil {
		t.Fatal(err)
	}
	svc2 := newService(t, dir, clk)
	hugo.svc = svc2
	after := hugo.state()
	if after.Me.Pseudo != before.Me.Pseudo || len(after.Owned) != len(before.Owned) || len(after.Cards) != len(before.Cards) || after.Phase != "live" {
		t.Fatal("état perdu au redémarrage")
	}
	raw, _ := os.ReadFile(filepath.Join(dir, "tcg.json"))
	for _, login := range names {
		if bytes.Contains(raw, []byte(`"`+login+`"`)) {
			t.Fatalf("identifiant %q en clair dans tcg.json", login)
		}
	}
	if fi, _ := os.Stat(filepath.Join(dir, "tcg.json")); fi.Mode().Perm()&0o077 != 0 {
		t.Fatalf("tcg.json lisible par d'autres : %v", fi.Mode())
	}
	if _, err := os.Stat(filepath.Join(dir, "tcg-backups", "tcg-"+calendarDay(clk.now())+".json")); err != nil {
		t.Fatal("pas de sauvegarde du jour")
	}

	// 10. Trente jours après le retrait, la photo quitte le stockage et la carte ne revient plus.
	admin.svc = svc2
	clk.add(31 * 24 * time.Hour)
	svc2.Game.Tick()
	time.Sleep(50 * time.Millisecond)
	if _, err := os.Stat(filepath.Join(dir, "tcg-img", strings.TrimPrefix(removedImg, "api/tcg/img/"))); !os.IsNotExist(err) {
		t.Fatalf("photo d'une carte retirée depuis 31 jours encore stockée : %v", err)
	}
	admin.must("POST", "/api/tcg/admin/card/"+target.ID, map[string]any{"action": "restore"}, 409)
}

// Un tcg.json abîmé est mis de côté et la dernière sauvegarde reprise ; sans sauvegarde, le serveur
// refuse de démarrer plutôt que d'écraser le jeu par un jeu vide.
func TestBackupRecovery(t *testing.T) {
	dir := t.TempDir()
	g, clk, _ := newGame(t)
	_ = clk
	g.path = filepath.Join(dir, "tcg.json")
	mustJoin(t, g, "lmartin", "Léa M.")
	if err := g.Flush(); err != nil {
		t.Fatal(err)
	}
	os.WriteFile(g.path, []byte(`{"players": tronqué`), 0o600)
	g2, err := Open(dir, "poivre-de-test", nil)
	if err != nil {
		t.Fatal(err)
	}
	if g2.Recovered == "" || len(g2.st.Players) != 1 {
		t.Fatal("sauvegarde non reprise")
	}
	matches, _ := filepath.Glob(filepath.Join(dir, "tcg.json.abime-*"))
	if len(matches) != 1 {
		t.Fatal("fichier abîmé non gardé de côté")
	}
	empty := t.TempDir()
	os.WriteFile(filepath.Join(empty, "tcg.json"), []byte(`{abîmé`), 0o600)
	if _, err := Open(empty, "x", nil); err == nil {
		t.Fatal("démarrage sur un fichier abîmé sans sauvegarde")
	}
	if raw, _ := os.ReadFile(filepath.Join(empty, "tcg.json")); string(raw) != `{abîmé` {
		t.Fatal("fichier abîmé écrasé")
	}
}

// Sans carte validée, la sortie est repoussée d'un jour au lieu d'imprimer une vague vide.
func TestEmptyWaveIsPostponed(t *testing.T) {
	g, clk, _ := newGame(t)
	g.st.Season.Enabled = true
	g.SaveWave(WaveInput{ReleaseAt: clk.now().Add(time.Hour), Size: 10})
	clk.add(2 * time.Hour)
	g.Tick()
	if g.phase() != "soon" || !g.st.Waves[0].ReleaseAt.After(clk.now()) {
		t.Fatal("vague vide imprimée")
	}
}

// Vague 1 : 10 propositions par jour (quota propre à la vague), puis retour au réglage de la saison.
func TestWaveOneQuota(t *testing.T) {
	g, clk, _ := newGame(t)
	g.st.Season.Enabled = true
	start := clk.now()
	if _, err := g.SaveWave(WaveInput{ProposalsUntil: start.Add(5 * 24 * time.Hour), JuryFrom: start.Add(6 * 24 * time.Hour), JuryUntil: start.Add(12 * 24 * time.Hour), ReleaseAt: start.Add(13 * 24 * time.Hour), Size: 50, PerDay: 10}); err != nil {
		t.Fatal(err)
	}
	if _, err := g.SaveWave(WaveInput{N: 1, ReleaseAt: start.Add(13 * 24 * time.Hour), Size: 50, PerDay: 21}); err == nil {
		t.Fatal("quota hors limites accepté")
	}
	a := mustJoin(t, g, "a", "Alice A.")
	if pv := g.PublicView(); pv.PerDay != 10 {
		t.Fatalf("quota affiché : %d", pv.PerDay)
	}
	for i := 0; i < 10; i++ {
		propose(t, g, a, fmt.Sprintf("Carte %d", i))
	}
	if _, err := g.Propose(a, NewProposal{Title: "Onzième", Desc: "Une de trop ce jour-là.", Cat: "lieu"}); err == nil || !strings.Contains(err.Error(), "10 cartes") {
		t.Fatalf("11e proposition : %v", err)
	}
	// Propositions de la vague 1 terminées : réglage de la saison (3 par jour).
	clk.t = start.Add(5*24*time.Hour + time.Hour)
	if pv := g.PublicView(); pv.PerDay != 3 {
		t.Fatalf("quota après la vague 1 : %d", pv.PerDay)
	}
	v, _ := g.PlayerView(a)
	if v.Me.ProposalsLeft != 3 {
		t.Fatalf("restantes le jour suivant : %d", v.Me.ProposalsLeft)
	}
}

// Lancement sur le campus : 120 étudiants derrière la même adresse IP (eduroam) rejoignent le jeu
// et rafraîchissent la page sans jamais recevoir « trop de demandes ».
func TestCampusSharedIP(t *testing.T) {
	dir := t.TempDir()
	clk := &clock{t: time.Date(2026, 12, 7, 6, 0, 0, 0, Paris)}
	svc := newService(t, dir, clk)
	admin := &api{t: t, svc: svc, admin: true}
	admin.must("POST", "/api/tcg/admin/season", map[string]any{"enabled": true, "name": "Saison 1", "perDay": 3, "paceDays": 14, "autoWeekly": false, "runs": map[string]int{"commune": 0, "rare": 25, "epique": 10, "legendaire": 3, "unique": 1}}, 200)
	admin.must("POST", "/api/tcg/admin/wave", map[string]any{"n": 0, "releaseAt": clk.now().Add(time.Hour), "size": 20}, 200)
	for i := 0; i < 120; i++ {
		p := &api{t: t, svc: svc} // httptest : même adresse IP pour toutes les requêtes
		p.must("POST", "/api/tcg/join", map[string]any{"ticket": fmt.Sprintf("ST-etu%03d-123456789", i), "pseudo": "Étudiant E."}, 200)
		for k := 0; k < 8; k++ {
			p.must("GET", "/api/tcg/state", nil, 200)
			p.must("GET", "/api/tcg/public", nil, 200)
		}
	}
}
