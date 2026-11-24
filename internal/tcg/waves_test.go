package tcg

import (
	"fmt"
	"testing"
	"time"
)

// Quantités choisies juste avant l'impression : cartes par rareté et exemplaires par carte.
func TestWaveMixAndRuns(t *testing.T) {
	g, clk, _ := newGame(t)
	g.st.Season.Enabled = true
	start := clk.now()
	if _, err := g.SaveWave(WaveInput{ReleaseAt: start.Add(13 * 24 * time.Hour), Size: 12}); err != nil {
		t.Fatal(err)
	}
	var players []string
	for i := 0; i < 5; i++ {
		players = append(players, mustJoin(t, g, fmt.Sprintf("mix%d", i), "Joueur M."))
	}
	for i := 0; i < 15; i++ {
		id := propose(t, g, players[i%len(players)], fmt.Sprintf("Carte %02d", i))
		if err := g.ModerateCard(id, Moderate{Action: "validate"}); err != nil {
			t.Fatal(err)
		}
		if i%5 == 4 {
			clk.add(24 * time.Hour)
		}
	}
	count := func() map[Rarity]int {
		cands, _, err := g.Preview(1)
		if err != nil {
			t.Fatal(err)
		}
		m := map[Rarity]int{}
		for _, c := range cands {
			if c.Rarity != "" {
				m[c.Rarity]++
			}
		}
		return m
	}
	if m := count(); m[Unique] != 1 || m[Commune]+m[Rare]+m[Epique]+m[Legendaire]+m[Unique] != 12 {
		t.Fatalf("répartition automatique : %v", m)
	}
	// 10 uniques et 2 rares, plus de cartes dans la vague : les communes complètent.
	if err := g.SetMix(1, 14, map[Rarity]int{Unique: 10, Rare: 2}, map[Rarity]int{Rare: 30}); err != nil {
		t.Fatal(err)
	}
	if m := count(); m[Unique] != 10 || m[Rare] != 2 || m[Epique] != 0 || m[Legendaire] != 0 || m[Commune] != 2 {
		t.Fatalf("répartition choisie : %v", m)
	}
	if err := g.SetMix(1, 10, map[Rarity]int{Rare: 11}, nil); err == nil {
		t.Fatal("plus de rares que de cartes dans la vague")
	}
	if err := g.SetMix(1, 0, map[Rarity]int{Rare: 2}, map[Rarity]int{Rare: 0}); err == nil {
		t.Fatal("0 exemplaire accepté")
	}
	// Gardé tel quel après un rechargement (zéros compris).
	if err := g.SetMix(1, 14, map[Rarity]int{Unique: 10, Rare: 2}, map[Rarity]int{Rare: 30, Unique: 9}); err != nil {
		t.Fatal(err)
	}
	if err := g.PrintNow(1); err != nil {
		t.Fatal(err)
	}
	for _, id := range g.wave(1).Cards {
		c := g.st.Cards[id]
		want := map[Rarity]int{Unique: 1, Rare: 30, Commune: 0}[c.Rarity]
		if c.Run != want {
			t.Fatalf("%s : %d exemplaires, attendu %d", c.Rarity, c.Run, want)
		}
	}
	if err := g.SetMix(1, 0, nil, nil); err == nil {
		t.Fatal("vague imprimée modifiée")
	}
}

// Carte validée : son auteur ne la retire plus, et ne connaît sa rareté qu'en la tirant.
func TestValidatedCardLockedAndRaritySecret(t *testing.T) {
	g, clk, _ := newGame(t)
	g.st.Season.Enabled = true
	g.SaveWave(WaveInput{ReleaseAt: clk.now().Add(14 * 24 * time.Hour), Size: 10})
	a := mustJoin(t, g, "auteur", "Alice A.")
	kept := propose(t, g, a, "Validée")
	pending := propose(t, g, a, "En attente")
	if err := g.ModerateCard(kept, Moderate{Action: "validate"}); err != nil {
		t.Fatal(err)
	}
	if err := g.Withdraw(a, kept); err == nil {
		t.Fatal("carte validée retirée par son auteur")
	}
	if err := g.Withdraw(a, pending); err != nil {
		t.Fatalf("carte en attente : %v", err)
	}
	if err := g.PrintNow(1); err != nil {
		t.Fatal(err)
	}
	rarity := func() Rarity {
		v, _ := g.PlayerView(a)
		for _, p := range v.Proposals {
			if p.ID == kept {
				return p.Rarity
			}
		}
		return "?"
	}
	if r := rarity(); r != "" {
		t.Fatalf("rareté montrée à l'auteur avant qu'il la tire : %q", r)
	}
	g.st.Players[a].Owned[kept] = []int{0}
	if r := rarity(); r == "" || r == "?" {
		t.Fatal("rareté cachée après le tirage")
	}
}

// Essai des duels pour l'administration, sans jury ouvert : rien n'est enregistré.
func TestTryCardsAdminOnly(t *testing.T) {
	g, clk, _ := newGame(t)
	g.st.Season.Enabled = true
	g.SaveWave(WaveInput{ReleaseAt: clk.now().Add(14 * 24 * time.Hour), Size: 10})
	g.IsAdmin = func(login string) bool { return login == "chef" }
	a := mustJoin(t, g, "auteur", "Alice A.")
	for i := 0; i < 3; i++ {
		propose(t, g, a, fmt.Sprintf("Essai %d", i))
	}
	if _, err := g.TryCards(a); err == nil {
		t.Fatal("essai ouvert à un joueur")
	}
	admin := mustJoin(t, g, "chef", "Chef C.")
	cards, err := g.TryCards(admin)
	if err != nil || len(cards) != 3 {
		t.Fatalf("essai admin : %d cartes, %v", len(cards), err)
	}
	if v, _ := g.PlayerView(admin); v.Jury != nil {
		t.Fatal("l'essai a ouvert un jury")
	}
}
