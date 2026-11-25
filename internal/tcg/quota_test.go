package tcg

import (
	"fmt"
	"testing"
	"time"
)

// Quota de propositions : par compte, quel que soit l'appareil. Ni un retrait, ni « Quitter le
// jeu » puis revenir ne rendent de proposition le même jour ; le lendemain, tout revient.
func TestProposalQuotaPerAccount(t *testing.T) {
	dir := t.TempDir()
	clk := &clock{t: time.Date(2026, 11, 24, 9, 0, 0, 0, Paris)}
	svc := newService(t, dir, clk)
	admin := &api{t: t, svc: svc, admin: true}
	admin.must("POST", "/api/tcg/admin/season", map[string]any{"enabled": true, "name": "S1", "perDay": 6, "paceDays": 14, "runs": map[string]int{"commune": 0, "rare": 25, "epique": 10, "legendaire": 3, "unique": 1}}, 200)
	admin.must("POST", "/api/tcg/admin/wave", map[string]any{"n": 0, "proposalsUntil": clk.t.Add(5 * 24 * time.Hour), "juryFrom": clk.t.Add(6 * 24 * time.Hour), "juryUntil": clk.t.Add(12 * 24 * time.Hour), "releaseAt": clk.t.Add(13 * 24 * time.Hour), "size": 12}, 200)

	// Deux appareils, un seul compte (identifiant tapé différemment).
	phone, laptop := &api{t: t, svc: svc}, &api{t: t, svc: svc}
	phone.must("POST", "/api/tcg/join", map[string]any{"ticket": "ST-lmartin-123456789", "pseudo": "Léa M."}, 200)
	laptop.must("POST", "/api/tcg/join", map[string]any{"ticket": "ST-LMartin-987654321", "pseudo": "Léa M."}, 200)
	photo, thumb := jpegWithExif(t, 960, 720), jpegWithExif(t, 320, 240)
	propose := func(a *api, title string) int {
		code, _ := a.propose(title, photo, thumb, true)
		return code
	}
	for i := 0; i < 6; i++ {
		if code := propose(phone, fmt.Sprintf("Carte %d", i)); code != 201 {
			t.Fatalf("proposition %d : %d", i, code)
		}
	}
	if code := propose(laptop, "Depuis l'ordinateur"); code != 429 {
		t.Fatalf("7e proposition depuis un autre appareil : %d", code)
	}
	if left := laptop.state().Me.ProposalsLeft; left != 0 {
		t.Fatalf("restantes vues sur l'autre appareil : %d", left)
	}

	// Retirer une proposition ne rend pas de place.
	id := phone.mine()[0].ID
	phone.must("POST", "/api/tcg/proposal/"+id+"/withdraw", map[string]any{}, 200)
	if code := propose(phone, "Après un retrait"); code != 429 {
		t.Fatalf("proposition après un retrait : %d", code)
	}

	// Quitter le jeu puis revenir non plus.
	laptop.must("POST", "/api/tcg/leave", map[string]any{}, 200)
	again := &api{t: t, svc: svc}
	again.must("POST", "/api/tcg/join", map[string]any{"ticket": "ST-lmartin-555555555", "pseudo": "Léa M."}, 200)
	if code := propose(again, "Après être revenue"); code != 429 {
		t.Fatalf("proposition après « Quitter le jeu » : %d", code)
	}

	// Le lendemain, le quota revient (et le compteur de la veille est oublié).
	clk.add(24 * time.Hour)
	svc.Game.Tick()
	if left := again.state().Me.ProposalsLeft; left != 6 {
		t.Fatalf("le lendemain : %d propositions possibles", left)
	}
	if code := propose(again, "Le lendemain"); code != 201 {
		t.Fatalf("proposition le lendemain : %d", code)
	}
	if n := len(svc.Game.st.Sent); n != 1 {
		t.Fatalf("compteurs gardés : %d", n)
	}
}
