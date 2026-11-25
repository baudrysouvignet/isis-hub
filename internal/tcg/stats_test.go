package tcg

import (
	"encoding/json"
	"fmt"
	"strings"
	"testing"
	"time"
)

// Statistiques de l'administration : venues (une par jour), inscriptions, boosters par vague.
func TestAdminStats(t *testing.T) {
	g, clk, ps := liveGame(t)
	a, b := ps[0], ps[1]
	s := g.AdminStats()
	if s.Players != 2 || s.Joined7 != 2 || s.Proposals != 10 || s.Creators != 2 || len(s.Days) != statsSpan {
		t.Fatalf("départ : %+v", s)
	}
	joined := 0
	for _, d := range s.Days {
		joined += d.Joined
	}
	if joined != 2 {
		t.Fatalf("inscriptions par jour : %d", joined)
	}

	// Trois passages dans la journée : un seul visiteur.
	for i := 0; i < 3; i++ {
		g.PlayerView(a)
		clk.add(time.Hour)
	}
	g.PlayerView(b)
	if s := g.AdminStats(); s.Today != 2 || s.Days[len(s.Days)-1].Visitors != 2 {
		t.Fatalf("visiteurs du jour : %d / %d", s.Today, s.Days[len(s.Days)-1].Visitors)
	}

	if _, err := g.OpenBooster(a); err != nil {
		t.Fatal(err)
	}
	if _, err := g.OpenBooster(b); err != nil {
		t.Fatal(err)
	}
	s = g.AdminStats()
	w := s.Waves[0]
	if s.Boosters != 2 || w.Boosters != 2 || w.Copies != 10 || w.Collectors != 2 || s.Collectors != 2 || s.Days[len(s.Days)-1].Boosters != 2 {
		t.Fatalf("boosters : %+v", s)
	}

	// Le lendemain : de nouveau un visiteur, et rien ne dit qui.
	clk.add(24 * time.Hour)
	g.PlayerView(a)
	s = g.AdminStats()
	if s.Today != 1 || s.Week != 2 || s.Days[len(s.Days)-1].Visitors != 1 || s.Days[len(s.Days)-2].Visitors != 2 {
		t.Fatalf("lendemain : %+v", s)
	}
	if got := fmt.Sprintf("%+v", s); strings.Contains(got, "Alice") || strings.Contains(got, "Bob") {
		t.Fatal("un pseudo dans les statistiques")
	}
}

// Fichier d'avant le compteur de boosters par vague : retrouvés dans les boosters par jour.
func TestBackfillOpened(t *testing.T) {
	rel := func(d string) time.Time {
		x, _ := time.ParseInLocation("2006-01-02 15:04", d, Paris)
		return x
	}
	st := &state{
		Waves: []*Wave{
			{N: 1, Printed: true, ReleaseAt: rel("2026-11-02 18:00")},
			{N: 2, Printed: true, ReleaseAt: rel("2026-11-09 18:00")},
			{N: 3, ReleaseAt: rel("2026-11-16 18:00")},
		},
		Boosters: map[string]int{"2026-11-01": 4, "2026-11-02": 10, "2026-11-08": 5, "2026-11-09": 7, "2026-11-20": 3},
	}
	backfillOpened(st)
	// Le 1er : aucune vague sortie (perdu) ; le 2 et le 8 : vague 1 ; le 9 et le 20 : vague 2.
	if st.Waves[0].Opened != 15 || st.Waves[1].Opened != 10 || st.Waves[2].Opened != 0 {
		t.Fatalf("par vague : %d, %d, %d", st.Waves[0].Opened, st.Waves[1].Opened, st.Waves[2].Opened)
	}
	backfillOpened(st) // déjà compté : rien ne change
	if st.Waves[0].Opened != 15 {
		t.Fatal("compté deux fois")
	}
}

// Classement des créateurs : la qualité compte plus que le nombre, et jamais de score envoyé.
func TestLeaderboard(t *testing.T) {
	g, _, _ := liveGame(t) // Alice et Bob : 5 cartes imprimées chacun (vague de 10)
	c := mustJoin(t, g, "c", "Chloé C.")
	d := mustJoin(t, g, "d", "Dan D.")
	e := mustJoin(t, g, "e", "Eva E.")
	set := func(author string, status string, r Rarity, n int) {
		for i := 0; i < n; i++ {
			g.st.NextNum++
			id := fmt.Sprintf("x%d", g.st.NextNum)
			g.st.Cards[id] = &Card{ID: id, Author: author, Status: status, Rarity: r, Decided: g.now()}
		}
	}
	// Toutes les cartes de la vague deviennent communes : 5 × 2 = 10 points chacun.
	for _, card := range g.st.Cards {
		card.Rarity = Commune
	}
	set(c, StatusPrinted, Legendaire, 1) // une légendaire : 15
	set(d, StatusAccepted, "", 9)        // beaucoup de cartes validées, pas encore imprimées : 9
	set(d, StatusBlocked, "", 3)         // et des cartes bloquées : -3
	set(e, StatusPending, "", 4)         // seulement en attente : pas classé

	v, _ := g.PlayerView(e)
	lb := v.Leaders
	if lb.Total != 4 || lb.Rank != 0 || len(lb.Podium) != 3 || lb.Podium[0].Pseudo != "Chloé C." {
		t.Fatalf("classement : %+v", lb)
	}
	if v, _ := g.PlayerView(d); v.Leaders.Rank != 4 {
		t.Fatalf("place de Dan : %d", v.Leaders.Rank)
	}
	if v, _ := g.PlayerView(c); !v.Leaders.Podium[0].Me || v.Leaders.Rank != 1 || v.Leaders.Podium[0].Cards != 1 {
		t.Fatalf("Chloé sur le podium : %+v", v.Leaders)
	}
	// Ni score, ni rareté dans ce qui part vers le joueur.
	raw, _ := json.Marshal(lb)
	if strings.Contains(string(raw), "score") || strings.Contains(string(raw), "legendaire") {
		t.Fatalf("score ou rareté envoyés : %s", raw)
	}
	// Refus d'une personne sur la photo : ni bonus ni malus ; suspendu : hors classement.
	if cardPoints(&Card{Status: StatusRemoved, Reason: "personne"}) != 0 || cardPoints(&Card{Status: StatusRemoved, Reason: "moque"}) >= 0 {
		t.Fatal("points des cartes retirées")
	}
	g.st.Players[c].Muted = true
	if v, _ := g.PlayerView(c); v.Leaders.Rank != 0 || v.Leaders.Podium[0].Pseudo == "Chloé C." {
		t.Fatal("joueur suspendu encore classé")
	}
}
