package tcg

import (
	"fmt"
	"testing"
)

// Détail des scores (administration) : mêmes points et mêmes places que le podium, carte par
// carte, les classés d'abord ; une carte bloquée ne rapporte rien, un joueur suspendu est hors
// classement.
func TestAdminScores(t *testing.T) {
	g, clk, _ := newGame(t)
	g.st.Season.Enabled = true
	now := clk.now()
	g.st.Waves = []*Wave{{N: 1, Printed: true, PrintedAt: now, ReleaseAt: now}}
	a := mustJoin(t, g, "a", "Alice A.")
	b := mustJoin(t, g, "b", "Bob B.")
	c := mustJoin(t, g, "c", "Carl C.")
	card := func(id, author, status string) *Card {
		k := &Card{ID: id, Title: "Carte " + id, Author: author, Status: status, Validated: now, Decided: now}
		g.st.Cards[id] = k
		return k
	}
	// k0, k1 (Alice) en bas de chaque classement du jury de la vague 1 : dernier quart.
	for i := 0; i < 8; i++ {
		author := b
		if i < 2 {
			author = a
		}
		card(fmt.Sprintf("k%d", i), author, StatusAccepted)
	}
	rank := []string{"k7", "k6", "k5", "k4", "k3", "k2", "k1", "k0"}
	for i := 0; i < 4; i++ {
		v := mustJoin(t, g, fmt.Sprintf("v%d", i), "Juré J.")
		g.st.Players[v].Ballots[1] = []Ballot{{Cards: rank, Rank: rank, At: now}}
	}
	ep := card("p1", b, StatusPrinted)
	ep.Rarity, ep.Wave = Epique, 1
	card("x1", a, StatusBlocked)
	card("m1", c, StatusAccepted)
	g.st.Players[c].Muted = true

	s := g.AdminScores()
	if s.PenaltyWave != 1 || s.Validated != validatedPoints || s.Penalty != juryPenalty || s.Rarity[Unique] != 25 {
		t.Fatalf("barème : %+v", s)
	}
	if len(s.Rows) != 3 {
		t.Fatalf("lignes : %+v", s.Rows)
	}
	bob, carl, alice := s.Rows[0], s.Rows[1], s.Rows[2]
	if bob.Pseudo != "Bob B." || bob.Rank != 1 || bob.Score != 15 || len(bob.Cards) != 7 {
		t.Fatalf("Bob : %+v", bob) // 9 (épique en jeu) + 6 validées
	}
	if top := bob.Cards[0]; top.Points != 9 || top.Rarity != Epique || top.Wave != 1 {
		t.Fatalf("Bob, première carte : %+v", top)
	}
	if carl.Pseudo != "Carl C." || carl.Rank != 0 || !carl.Muted || carl.Score != 1 {
		t.Fatalf("Carl (suspendu) : %+v", carl)
	}
	if alice.Pseudo != "Alice A." || alice.Rank != 0 || alice.Score != -2 || len(alice.Cards) != 3 {
		t.Fatalf("Alice : %+v", alice)
	}
	if blocked := alice.Cards[0]; blocked.Status != StatusBlocked || blocked.Points != 0 || blocked.Penalty {
		t.Fatalf("Alice, carte bloquée : %+v", blocked)
	}
	for _, k := range alice.Cards[1:] {
		if !k.Penalty || k.Points != validatedPoints+juryPenalty {
			t.Fatalf("Alice, carte du dernier quart : %+v", k)
		}
	}
	// Mêmes places que le podium vu par les joueurs.
	if lb := g.leaderboard(b); lb.Rank != 1 || lb.Total != 1 {
		t.Fatalf("podium : %+v", lb)
	}
}
