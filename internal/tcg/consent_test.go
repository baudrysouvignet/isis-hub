package tcg

import (
	"bytes"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// Personnes sur la photo : adresses de l'université seulement, mail d'accord groupé au plus tous
// les deux jours et une seule fois par carte, accord ou refus dans le jeu, adresse effacée dès le
// mail parti.
func TestConsentFlow(t *testing.T) {
	dir := t.TempDir()
	clk := &clock{t: time.Date(2026, 11, 24, 9, 0, 0, 0, Paris)}
	svc := newService(t, dir, clk)
	svc.Game.IsAdmin = func(l string) bool { return l == "chef" }
	admin := &api{t: t, svc: svc, admin: true}
	day := func(d, hh int) time.Time { return time.Date(2026, 11, 24+d, hh, 0, 0, 0, Paris) }
	admin.must("POST", "/api/tcg/admin/season", map[string]any{"enabled": true, "name": "Saison 1", "perDay": 5, "paceDays": 14, "runs": map[string]int{"commune": 0, "rare": 25, "epique": 10, "legendaire": 3, "unique": 1}}, 200)
	admin.must("POST", "/api/tcg/admin/wave", map[string]any{"n": 0, "proposalsUntil": day(5, 20), "juryFrom": day(6, 6), "juryUntil": day(12, 20), "releaseAt": day(13, 6), "size": 12}, 200)

	join := func(login, pseudo string) *api {
		p := &api{t: t, svc: svc}
		p.must("POST", "/api/tcg/join", map[string]any{"ticket": "ST-" + login + "-123456789", "pseudo": pseudo}, 200)
		return p
	}
	ines, lea, hugo, chef := join("ines", "Ines X."), join("lea", "Léa M."), join("hugo", "Hugo B."), join("chef", "Chef C.")
	if !chef.state().Me.Admin || ines.state().Me.Admin {
		t.Fatal("drapeau administrateur")
	}
	ines.must("POST", "/api/tcg/mail", map[string]any{"email": "ines.x@etud.univ-jfc.fr"}, 200)
	lea.must("POST", "/api/tcg/mail", map[string]any{"email": "ines.x@etud.univ-jfc.fr"}, 409) // déjà liée à un autre compte
	lea.must("POST", "/api/tcg/mail", map[string]any{"email": "lea@gmail.com"}, 400)
	lea.must("POST", "/api/tcg/mail", map[string]any{"email": "Lea.Martin@etud.univ-jfc.fr"}, 200)
	lea.must("POST", "/api/tcg/mail", map[string]any{"email": "autre@univ-jfc.fr"}, 409) // un compte garde son adresse

	photo := func(n uint8) ([]byte, []byte) { return jpegSeed(t, 960, 720, n), jpegSeed(t, 320, 240, n) }
	p1, t1 := photo(1)
	if code, _ := ines.proposeWith("Hors université", p1, t1, true, "x@gmail.com"); code != 400 {
		t.Fatal("adresse hors université acceptée")
	}
	if code, _ := ines.proposeWith("Trop de monde", p1, t1, true, "a@univ-jfc.fr b@univ-jfc.fr c@univ-jfc.fr d@univ-jfc.fr e@univ-jfc.fr f@univ-jfc.fr"); code != 400 {
		t.Fatal("6 personnes acceptées")
	}
	// Léa, Hugo et l'autrice elle-même (d'accord d'office), avec un doublon ignoré.
	ines.must("POST", "/api/tcg/propose", nil, 400) // (corps vide)
	if code, out := ines.proposeWith("Au foyer", p1, t1, true, "lea.martin@etud.univ-jfc.fr, hugo.b@etud.univ-jfc.fr; LEA.MARTIN@etud.univ-jfc.fr ines.x@etud.univ-jfc.fr"); code != 201 {
		t.Fatalf("proposition avec personnes : %d %v", code, out)
	}
	card := ines.state().Proposals[0].ID

	// Rien à envoyer tant que la carte n'est pas validée ; rien à montrer non plus.
	if m := admin.must("GET", "/api/tcg/admin/mailing", nil, 200); len(m["targets"].([]any)) != 0 {
		t.Fatal("mail prévu pour une carte pas encore validée")
	}
	if len(lea.state().Appear) != 0 {
		t.Fatal("carte en attente montrée à la personne indiquée")
	}
	admin.must("POST", "/api/tcg/admin/card/"+card, map[string]any{"action": "validate"}, 200)
	m := admin.must("GET", "/api/tcg/admin/mailing", nil, 200)
	targets := m["targets"].([]any)
	if len(targets) != 2 || m["open"] != true {
		t.Fatalf("à prévenir : %v", m)
	}
	var keys []string
	for _, x := range targets {
		tg := x.(map[string]any)
		if !strings.HasSuffix(tg["email"].(string), "@etud.univ-jfc.fr") {
			t.Fatalf("adresse : %v", tg)
		}
		keys = append(keys, tg["key"].(string))
	}
	svc.Game.Flush()
	raw, _ := os.ReadFile(filepath.Join(dir, "tcg.json"))
	if bytes.Contains(raw, []byte("lea.martin")) || bytes.Contains(raw, []byte("hugo.b")) {
		t.Fatal("adresse en clair dans tcg.json")
	}
	if out := admin.must("POST", "/api/tcg/admin/mailing/sent", map[string]any{"keys": keys}, 200); out["marked"] != float64(2) {
		t.Fatalf("marquées : %v", out)
	}
	// Envoyées : plus jamais proposées pour cette carte.
	if m := admin.must("GET", "/api/tcg/admin/mailing", nil, 200); len(m["targets"].([]any)) != 0 || m["waiting"] != float64(2) {
		t.Fatalf("après envoi : %v", m)
	}

	// Nouvelle carte avec Léa le lendemain : elle attend le prochain envoi (deux jours après le premier).
	clk.add(26 * time.Hour)
	p2, t2 := photo(2)
	if code, _ := hugo.proposeWith("En amphi", p2, t2, true, "lea.martin@etud.univ-jfc.fr"); code != 201 {
		t.Fatal("deuxième carte")
	}
	admin.must("POST", "/api/tcg/admin/card/"+hugo.state().Proposals[0].ID, map[string]any{"action": "validate"}, 200)
	m = admin.must("GET", "/api/tcg/admin/mailing", nil, 200)
	if m["open"] != false || len(m["targets"].([]any)) != 1 {
		t.Fatalf("envoi trop tôt permis : %v", m)
	}
	key := m["targets"].([]any)[0].(map[string]any)["key"].(string)
	admin.must("POST", "/api/tcg/admin/mailing/sent", map[string]any{"keys": []string{key}}, 409)
	clk.add(23 * time.Hour)
	admin.must("POST", "/api/tcg/admin/mailing/sent", map[string]any{"keys": []string{key}}, 200)

	// Réponses : Léa accepte la première et refuse la seconde ; Hugo ne répond pas.
	ap := lea.state().Appear
	if len(ap) != 2 || ap[0].Answer != "" || ap[0].Img == "" {
		t.Fatalf("mes apparitions : %+v", ap)
	}
	lea.must("POST", "/api/tcg/consent", map[string]any{"card": card, "ok": true}, 200)
	second := hugo.state().Proposals[0].ID
	lea.must("POST", "/api/tcg/consent", map[string]any{"card": second, "ok": false}, 200)
	lea.must("POST", "/api/tcg/consent", map[string]any{"card": second, "ok": true}, 409)  // refus définitif
	ines.must("POST", "/api/tcg/consent", map[string]any{"card": second, "ok": true}, 404) // pas indiquée
	for _, p := range hugo.state().Proposals {
		if p.ID == second && (p.Status != StatusBlocked || !strings.Contains(p.Message, "accord")) {
			t.Fatalf("carte refusée : %+v", p)
		}
	}
	found := false
	for _, x := range admin.must("GET", "/api/tcg/admin/cards?filter=validated", nil, 200)["list"].([]any) {
		c := x.(map[string]any)
		if c["id"] != card {
			continue
		}
		found = true
		cs := c["consent"].(map[string]any)
		if cs["total"] != float64(3) || cs["ok"] != float64(2) || cs["waiting"] != float64(1) {
			t.Fatalf("indicateurs d'accord : %v", cs)
		}
	}
	if !found {
		t.Fatal("carte absente de l'administration")
	}
}

// Accord retiré sur une carte en jeu : elle sort du jeu, mais ceux qui l'ont gardent leur exemplaire,
// devenu « Accord retiré » (ni photo ni texte), et elle ne peut pas être remise en jeu.
func TestConsentWithdrawnOnPrintedCard(t *testing.T) {
	g, _, _ := liveGame(t)
	var id string
	for k, c := range g.st.Cards {
		if c.Status == StatusPrinted {
			id = k
			break
		}
	}
	if id == "" {
		t.Fatal("aucune carte imprimée")
	}
	cam := mustJoin(t, g, "cam", "Camille C.")
	g.mu.Lock()
	g.st.Cards[id].Tags = g.newTags(g.st.Cards[id].Author, []string{"camille.c@etud.univ-jfc.fr"})
	g.st.Players[cam].Owned[id] = []int{0}
	g.st.Cards[id].Img = strings.Repeat("c", 40) + ".webp" // photo propre à cette carte
	g.mu.Unlock()
	if err := g.LinkMail(cam, "camille.c@etud.univ-jfc.fr"); err != nil {
		t.Fatal(err)
	}
	if err := g.Consent(cam, id, true); err != nil {
		t.Fatal(err)
	}
	if err := g.Consent(cam, id, false); err != nil { // retire son accord après coup
		t.Fatal(err)
	}
	if c := g.st.Cards[id]; c.Status != StatusRemoved || c.Reason != "personne" {
		t.Fatalf("carte après retrait d'accord : %s %s", c.Status, c.Reason)
	}
	v, _ := g.PlayerView(cam)
	found := false
	for _, c := range v.Cards {
		if c.ID == id {
			found = true
			if c.Title != "Accord retiré" || c.Img != "" || c.Thumb != "" || !c.Consent {
				t.Fatalf("exemplaire après retrait d'accord : %+v", c)
			}
		}
	}
	if !found || len(v.Owned[id]) != 1 {
		t.Fatal("l'exemplaire doit rester dans la collection")
	}
	if g.ImageShown(g.st.Cards[id].Img) {
		t.Fatal("photo encore servie")
	}
	if err := g.ModerateCard(id, Moderate{Action: "restore"}); err == nil {
		t.Fatal("carte remise en jeu malgré le retrait d'accord")
	}
}
