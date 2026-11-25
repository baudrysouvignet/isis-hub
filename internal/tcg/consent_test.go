package tcg

import (
	"bytes"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// Personnes sur la photo, indiquées par l'administration à la validation : la carte attend leur
// accord et passe au jury d'elle-même à la dernière réponse ; mail groupé au plus tous les deux
// jours (sauf envoi forcé), une seule fois par carte ; adresse effacée dès le mail parti.
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
	hugo.must("POST", "/api/tcg/mail", map[string]any{"email": "hugo.b@etud.univ-jfc.fr"}, 200)

	photo := func(n uint8) ([]byte, []byte) { return jpegSeed(t, 960, 720, n), jpegSeed(t, 320, 240, n) }
	propose := func(p *api, title string, n uint8) string {
		img, th := photo(n)
		if code, out := p.proposeWith(title, img, th, true, ""); code != 201 {
			t.Fatalf("proposition : %d %v", code, out)
		}
		return p.mine()[0].ID
	}
	card := propose(ines, "Au foyer", 1)
	alone := propose(hugo, "Le néon", 2)

	// Sans personne indiquée : validée tout de suite. Adresses hors université refusées.
	admin.must("POST", "/api/tcg/admin/card/"+alone, map[string]any{"action": "validate"}, 200)
	if p := hugo.mine()[0]; p.Status != StatusAccepted {
		t.Fatalf("validation sans personne : %s", p.Status)
	}
	admin.must("POST", "/api/tcg/admin/card/"+card, map[string]any{"action": "validate", "people": "x@gmail.com"}, 400)
	// Léa, Hugo et l'autrice elle-même (d'accord d'office), avec un doublon ignoré.
	admin.must("POST", "/api/tcg/admin/card/"+card, map[string]any{"action": "validate", "people": "lea.martin@etud.univ-jfc.fr, hugo.b@etud.univ-jfc.fr; LEA.MARTIN@etud.univ-jfc.fr ines.x@etud.univ-jfc.fr"}, 200)
	if p := ines.mine()[0]; p.Status != StatusConsent || len(p.Tags) != 3 {
		t.Fatalf("en attente d'accord : %+v", p)
	}
	if len(ines.state().Proposals) != 0 {
		t.Fatal("carte en attente d'accord montrée à l'autrice")
	}
	if len(lea.state().Appear) != 1 {
		t.Fatal("carte absente de « Mes apparitions »")
	}

	m := admin.must("GET", "/api/tcg/admin/mailing", nil, 200)
	targets := m["targets"].([]any)
	if len(targets) != 2 || m["open"] != true {
		t.Fatalf("à prévenir : %v", m)
	}
	var keys []string
	for _, x := range targets {
		keys = append(keys, x.(map[string]any)["key"].(string))
	}
	svc.Game.Flush()
	raw, _ := os.ReadFile(filepath.Join(dir, "tcg.json"))
	if bytes.Contains(raw, []byte("lea.martin")) || bytes.Contains(raw, []byte("hugo.b")) {
		t.Fatal("adresse en clair dans tcg.json")
	}
	if out := admin.must("POST", "/api/tcg/admin/mailing/sent", map[string]any{"keys": keys}, 200); out["marked"] != float64(2) {
		t.Fatalf("marquées : %v", out)
	}
	if m := admin.must("GET", "/api/tcg/admin/mailing", nil, 200); len(m["targets"].([]any)) != 0 || m["waiting"] != float64(2) {
		t.Fatalf("après envoi : %v", m)
	}

	// Léa, déjà prévenue il y a 5 h, est indiquée sur une autre carte, avec Zoé (jamais prévenue) :
	// Zoé peut être prévenue tout de suite, Léa attend ses 24 h, même si on envoie sa clé.
	clk.add(5 * time.Hour)
	admin.must("POST", "/api/tcg/admin/card/"+alone, map[string]any{"action": "people", "people": "lea.martin@etud.univ-jfc.fr, zoe.z@etud.univ-jfc.fr"}, 200)
	if p := hugo.mine()[0]; p.Status != StatusConsent {
		t.Fatalf("personne ajoutée à une carte validée : %s", p.Status)
	}
	m = admin.must("GET", "/api/tcg/admin/mailing", nil, 200)
	if tg := m["targets"].([]any); len(tg) != 1 || tg[0].(map[string]any)["email"] != "zoe.z@etud.univ-jfc.fr" || m["held"] != float64(1) {
		t.Fatalf("à prévenir (Léa doit attendre ses 24 h) : %v", m)
	}
	leaKey := svc.Game.mailKey("lea.martin@etud.univ-jfc.fr")
	zoeKey := m["targets"].([]any)[0].(map[string]any)["key"].(string)
	if out := admin.must("POST", "/api/tcg/admin/mailing/sent", map[string]any{"keys": []string{leaKey, zoeKey}, "force": true}, 200); out["marked"] != float64(1) {
		t.Fatalf("seule Zoé doit être marquée : %v", out)
	}
	clk.add(19 * time.Hour) // 24 h après le mail de Léa : elle revient dans la liste
	m = admin.must("GET", "/api/tcg/admin/mailing", nil, 200)
	if tg := m["targets"].([]any); len(tg) != 1 || tg[0].(map[string]any)["email"] != "lea.martin@etud.univ-jfc.fr" || m["held"] != float64(0) {
		t.Fatalf("Léa après 24 h : %v", m)
	}
	admin.must("POST", "/api/tcg/admin/mailing/sent", map[string]any{"keys": []string{leaKey}}, 200)
	// Le lendemain, Zoé a 24 h : rien ne reste à envoyer.
	if m := admin.must("GET", "/api/tcg/admin/mailing", nil, 200); len(m["targets"].([]any)) != 0 {
		t.Fatalf("après les deux envois : %v", m)
	}

	// Réponses : Léa accepte « Au foyer », Hugo aussi → la carte passe au jury d'elle-même.
	lea.must("POST", "/api/tcg/consent", map[string]any{"card": card, "ok": true}, 200)
	if p := ines.mine()[0]; p.Status != StatusConsent {
		t.Fatal("validée avant la dernière réponse")
	}
	hugo.must("POST", "/api/tcg/consent", map[string]any{"card": card, "ok": true}, 200)
	if p := ines.mine()[0]; p.Status != StatusAccepted {
		t.Fatalf("après le dernier accord : %s", p.Status)
	}
	// Léa refuse « Le néon » : la carte est bloquée aussitôt, sans action de l'administration.
	lea.must("POST", "/api/tcg/consent", map[string]any{"card": alone, "ok": false}, 200)
	lea.must("POST", "/api/tcg/consent", map[string]any{"card": alone, "ok": true}, 409)
	ines.must("POST", "/api/tcg/consent", map[string]any{"card": alone, "ok": true}, 404) // pas indiquée
	if p := hugo.state().Proposals[0]; p.ID != alone || p.Status != StatusBlocked || !strings.Contains(p.Message, "accord") || strings.Contains(p.Message, "Léa") {
		t.Fatalf("carte refusée, vue de l'auteur : %+v", p)
	}
	for _, x := range admin.must("GET", "/api/tcg/admin/mailing", nil, 200)["targets"].([]any) {
		if x.(map[string]any)["email"] == "zoe.z@etud.univ-jfc.fr" {
			t.Fatal("mail prévu pour une carte bloquée")
		}
	}
	// Refusée par une personne : l'administration ne peut pas la revalider.
	admin.must("POST", "/api/tcg/admin/card/"+alone, map[string]any{"action": "validate"}, 409)

	// Retirer une personne qui ne répond pas : la carte repart, sans être bloquée.
	third := propose(ines, "En amphi", 3)
	admin.must("POST", "/api/tcg/admin/card/"+third, map[string]any{"action": "validate", "people": "z@univ-jfc.fr"}, 200)
	admin.must("POST", "/api/tcg/admin/card/"+third, map[string]any{"action": "untag", "key": svc.Game.mailKey("z@univ-jfc.fr")}, 200)
	if p := ines.mine()[0]; p.Status != StatusAccepted {
		t.Fatalf("après retrait de la personne : %s", p.Status)
	}
	// « Valider sans attendre » : une carte en attente passe au jury.
	clk.add(time.Minute)
	fourth := propose(ines, "Au labo", 4)
	admin.must("POST", "/api/tcg/admin/card/"+fourth, map[string]any{"action": "validate", "people": "y@univ-jfc.fr"}, 200)
	admin.must("POST", "/api/tcg/admin/card/"+fourth, map[string]any{"action": "force"}, 200)
	if p := ines.mine()[0]; p.Status != StatusAccepted {
		t.Fatalf("validation forcée : %s", p.Status)
	}
	// L'autrice peut indiquer des personnes : rien ne part avant la validation, et l'administration
	// retrouve sa liste pour la confirmer.
	clk.add(time.Minute)
	pimg, pth := photo(9)
	if code, out := ines.proposeWith("Proposée avec Léa", pimg, pth, true, "lea.martin@etud.univ-jfc.fr"); code != 201 {
		t.Fatalf("proposition avec personnes : %d %v", code, out)
	}
	var withLea string
	for _, p := range ines.mine() {
		if p.Title == "Proposée avec Léa" {
			withLea = p.ID
		}
	}
	for _, ap := range lea.state().Appear {
		if ap.ID == withLea {
			t.Fatal("carte pas encore validée montrée à la personne indiquée")
		}
	}
	for _, x := range admin.must("GET", "/api/tcg/admin/mailing", nil, 200)["targets"].([]any) {
		if x.(map[string]any)["email"] == "lea.martin@etud.univ-jfc.fr" {
			t.Fatal("mail prévu avant la validation")
		}
	}
	var proposed []any
	for _, x := range admin.must("GET", "/api/tcg/admin/cards?filter=pending", nil, 200)["list"].([]any) {
		if c := x.(map[string]any); c["id"] == withLea {
			proposed, _ = c["proposed"].([]any)
		}
	}
	if len(proposed) != 1 || proposed[0] != "lea.martin@etud.univ-jfc.fr" {
		t.Fatalf("personnes proposées par l'autrice : %v", proposed)
	}
	admin.must("POST", "/api/tcg/admin/card/"+withLea, map[string]any{"action": "block", "reason": "doublon"}, 200)
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

// Un booster toutes les 24 heures, comptées depuis le dernier ouvert (pas à heure fixe).
func TestBoosterEvery24h(t *testing.T) {
	g, clk, players := liveGame(t)
	clk.add(2 * time.Hour) // après la sortie de la vague
	a := players[0]
	if _, err := g.OpenBooster(a); err != nil {
		t.Fatal(err)
	}
	clk.add(23*time.Hour + 59*time.Minute)
	if v, _ := g.PlayerView(a); v.Me.BoosterReady {
		t.Fatal("booster prêt avant 24 h")
	}
	if _, err := g.OpenBooster(a); err == nil {
		t.Fatal("deuxième booster avant 24 h")
	}
	clk.add(time.Minute)
	if v, _ := g.PlayerView(a); !v.Me.BoosterReady {
		t.Fatal("booster pas prêt après 24 h")
	}
	if _, err := g.OpenBooster(a); err != nil {
		t.Fatal(err)
	}
}
