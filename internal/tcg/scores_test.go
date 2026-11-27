package tcg

import (
	"fmt"
	"testing"
	"time"
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
	if s.JudgeWave != 1 || s.Validated != validatedPoints || s.Penalty != juryPenalty || s.Rarity[Unique] != 25 || s.Rarity[Commune] != 1 {
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

// Avant l'impression, une carte vaut la rareté que l'aperçu lui donne (dès minPlanVotes
// classements au jury) : la qualité l'emporte sur le nombre, le classement d'avant l'impression est
// celui d'après, et le classement à minuit ne voit que les votes faits avant minuit.
func TestScorePlannedRarity(t *testing.T) {
	g, clk, _ := newGame(t)
	g.st.Season.Enabled = true
	now := clk.now()
	w := &Wave{N: 1, Size: 50, ReleaseAt: now.Add(48 * time.Hour)}
	g.st.Waves = []*Wave{w}
	a := mustJoin(t, g, "a", "Alice A.") // 1 carte, adorée
	b := mustJoin(t, g, "b", "Bob B.")   // 9 cartes, les moins aimées
	c := mustJoin(t, g, "c", "Chloé C.") // 20 cartes, entre les deux
	var bobs, chloes []string
	add := func(id, author string, num int) {
		g.st.Cards[id] = &Card{ID: id, Num: num, Title: id, Author: author, Status: StatusAccepted, Validated: now, Decided: now}
	}
	add("a1", a, 1)
	for i := 0; i < 9; i++ {
		id := fmt.Sprintf("b%d", i)
		add(id, b, 2+i)
		bobs = append(bobs, id)
	}
	for i := 0; i < 20; i++ {
		id := fmt.Sprintf("c%d", i)
		add(id, c, 20+i)
		chloes = append(chloes, id)
	}
	score := func(cut time.Time) map[string]float64 {
		out := map[string]float64{}
		for _, cr := range g.rankingAt(cut) {
			out[cr.id] = cr.score
		}
		return out
	}
	// Aucun classement : chaque carte vaut 1, la plus ancienne ne devient pas « unique ».
	if s := score(time.Time{}); s[a] != 1 || s[b] != 9 || s[c] != 20 {
		t.Fatalf("sans jury : %v", s)
	}
	// Le jury : 20 séries (chaque carte au moins 2 fois), la carte d'Alice en tête, deux de Chloé,
	// puis deux de Bob.
	vote := func(pid string, at time.Time, rank []string) {
		for i, id := range rank {
			c := g.st.Cards[id]
			c.JuryPts += len(rank) - 1 - 2*i
			c.JuryVotes++
		}
		g.st.Players[pid].Ballots[1] = append(g.st.Players[pid].Ballots[1], Ballot{Cards: rank, Rank: rank, At: at})
	}
	night := now.Add(2 * time.Hour)
	for i := 0; i < 20; i++ {
		v := mustJoin(t, g, fmt.Sprintf("v%d", i), "Juré J.")
		vote(v, night, []string{"a1", chloes[(2*i)%20], chloes[(2*i+1)%20], bobs[(2*i)%9], bobs[(2*i+1)%9]})
	}
	vals, next, _ := g.valuation(time.Time{})
	if next != 1 || !vals["a1"].planned || vals["a1"].rarity != Unique || vals["a1"].points != 25 {
		t.Fatalf("carte d'Alice : %+v", vals["a1"])
	}
	before := score(time.Time{})
	if before[a] <= before[b] || before[a] != 25 {
		t.Fatalf("la qualité ne l'emporte pas : Alice %v, Bob %v", before[a], before[b])
	}
	penalized := 0
	for _, id := range bobs {
		if vals[id].penalty {
			penalized++
		}
	}
	if penalized == 0 {
		t.Fatal("aucune carte de Bob dans le dernier quart du jury")
	}
	// Classement à minuit, avant les votes : comme sans jury.
	if s := score(night.Add(-time.Minute)); s[a] != 1 || s[b] != 9 || s[c] != 20 {
		t.Fatalf("à minuit, avant les votes : %v", s)
	}
	// Rétroactif : à minuit, après les votes, le même barème que maintenant (mêmes points, mêmes
	// pénalités, même place : c'est ce podium qui donne les récompenses de lancement).
	if s := score(night.Add(time.Minute)); fmt.Sprint(s) != fmt.Sprint(before) {
		t.Fatalf("à minuit, après les votes %v, maintenant %v", s, before)
	}
	nightly, live := g.rankingAt(night.Add(time.Minute)), g.ranking()
	for i := range live {
		if nightly[i].id != live[i].id || nightly[i].place != live[i].place {
			t.Fatalf("podium à minuit %+v, maintenant %+v", nightly, live)
		}
	}
	// L'impression ne change rien au classement (chaque carte a ses minPlanVotes classements) :
	// même rareté, mêmes points.
	if err := g.PrintNow(1); err != nil {
		t.Fatal(err)
	}
	after := score(time.Time{})
	if fmt.Sprint(before) != fmt.Sprint(after) {
		t.Fatalf("avant l'impression %v, après %v", before, after)
	}
	if g.st.Cards["a1"].Rarity != Unique {
		t.Fatalf("rareté imprimée : %s", g.st.Cards["a1"].Rarity)
	}
}

// Podium de la journée : chaque journée repart de zéro. Louis, 1er hier, garde la tête du
// classement global, mais Marie, qui gagne plus de points aujourd'hui, est 1re du jour et c'est
// elle qui reçoit le booster de la 1re place ce soir.
func TestDayPodium(t *testing.T) {
	g, clk, _ := newGame(t)
	g.st.Season.Enabled = true
	day := func(d, h int) time.Time { return time.Date(2026, 11, 24+d, h, 0, 0, 0, Paris) }
	g.st.Waves = []*Wave{{N: 1, JuryFrom: day(1, 0), JuryUntil: day(4, 20), ReleaseAt: day(5, 6), Size: 50}}
	louis := mustJoin(t, g, "l", "Louis L.")
	marie := mustJoin(t, g, "m", "Marie M.")
	voter := mustJoin(t, g, "v", "Vic V.")
	n := 0
	add := func(author string, at time.Time, k int) {
		for i := 0; i < k; i++ {
			n++
			id := fmt.Sprintf("k%d", n)
			g.st.Cards[id] = &Card{ID: id, Num: n, Title: id, Author: author, Status: StatusAccepted, Validated: at, Decided: at}
		}
	}
	vote := func(at time.Time) {
		p := g.st.Players[voter]
		p.Ballots[1] = append(p.Ballots[1], Ballot{Cards: []string{"x"}, Rank: []string{"x"}, At: at})
	}
	add(louis, day(1, 9), 10) // hier : Louis +10
	vote(day(1, 14))
	add(marie, day(2, 9), 3) // aujourd'hui : Marie +3, Louis +1
	add(louis, day(2, 10), 1)
	vote(day(2, 14))
	clk.t = day(2, 15)

	v, _ := g.PlayerView(marie)
	lb := v.Leaders
	if lb.Rank != 2 || lb.Podium[0].Pseudo != "Louis L." {
		t.Fatalf("classement global : %+v", lb)
	}
	if lb.Today == nil || lb.Today.Rank != 1 || lb.Today.Total != 2 || lb.Today.Podium[0].Pseudo != "Marie M." || lb.Today.Podium[1].Place != 2 {
		t.Fatalf("podium du jour : %+v", lb.Today)
	}
	clk.t = day(3, 9) // le lendemain matin : les deux soirs sont passés
	nights, _ := g.launchRewards(g.st.Waves[0], clk.now(), false)
	if fmt.Sprint(nights[louis]) != "[{2026-11-25 1 5} {2026-11-26 2 4}]" || fmt.Sprint(nights[marie]) != "[{2026-11-26 1 5}]" {
		t.Fatalf("soirs : Louis %v, Marie %v", nights[louis], nights[marie])
	}
	// Après la sortie, plus de podium du jour.
	clk.t = day(5, 7)
	if v, _ := g.PlayerView(marie); v.Leaders.Today != nil {
		t.Fatalf("podium du jour après la sortie : %+v", v.Leaders.Today)
	}
}

// Heure de Paris partout : une série du jury classée vendredi à 00 h 20 compte vendredi, dans les
// statistiques comme pour le podium du jour et les cadeaux du soir (jamais jeudi). L'heure d'hiver
// (UTC+1) fait que 00 h 20 à Paris est encore jeudi en UTC : c'est le cas piégeux.
func TestParisMidnight(t *testing.T) {
	g, clk, _ := newGame(t)
	g.st.Season.Enabled = true
	fri := func(h, m int) time.Time { return time.Date(2026, 11, 27, h, m, 0, 0, Paris) } // vendredi
	if utc := fri(0, 20).UTC(); utc.Day() != 26 {
		t.Fatalf("hypothèse du test : 00 h 20 à Paris doit être jeudi en UTC (%v)", utc)
	}
	g.st.Waves = []*Wave{{N: 1, JuryFrom: fri(0, 0).Add(-48 * time.Hour), JuryUntil: fri(20, 0), ReleaseAt: fri(0, 0).Add(72 * time.Hour), Size: 50}}
	a := mustJoin(t, g, "a", "Alice A.")
	v := mustJoin(t, g, "v", "Vic V.")
	g.st.Cards["k1"] = &Card{ID: "k1", Num: 1, Title: "k1", Author: a, Status: StatusAccepted, Validated: fri(0, 10), Decided: fri(0, 10)}
	clk.t = fri(0, 20)
	g.activity(clk.now()).Series++
	g.st.Players[v].Ballots[1] = []Ballot{{Cards: []string{"x"}, Rank: []string{"x"}, At: fri(0, 20)}}
	if g.st.Activity["2026-11-27"] == nil || g.st.Activity["2026-11-26"] != nil {
		t.Fatalf("statistiques : %v", g.st.Activity)
	}
	clk.t = fri(9, 0)
	if d := g.dayRanking(dayStart(clk.now()), clk.now()); len(d) != 1 || d[0].id != a {
		t.Fatalf("podium du jour de vendredi : %+v", d)
	}
	clk.t = fri(0, 0).Add(25 * time.Hour) // samedi 1 h : le soir de vendredi est passé
	nights, _ := g.launchRewards(g.st.Waves[0], clk.now(), false)
	if n := nights[a]; len(n) != 1 || n[0].Day != "2026-11-27" {
		t.Fatalf("soir compté : %+v", n)
	}
}

// Scores du jour (administration) : la place au podium du jour, les points gagnés depuis minuit,
// et seulement les cartes qui ont bougé, avec ce qu'elles valaient avant (nil : validée aujourd'hui).
func TestAdminDayScores(t *testing.T) {
	g, clk, _ := newGame(t)
	g.st.Season.Enabled = true
	day := func(d, h int) time.Time { return time.Date(2026, 11, 24+d, h, 0, 0, 0, Paris) }
	g.st.Waves = []*Wave{{N: 1, JuryFrom: day(1, 0), JuryUntil: day(4, 20), ReleaseAt: day(5, 6), Size: 50}}
	louis := mustJoin(t, g, "l", "Louis L.")
	marie := mustJoin(t, g, "m", "Marie M.")
	n := 0
	add := func(author string, at time.Time, k int) {
		for i := 0; i < k; i++ {
			n++
			id := fmt.Sprintf("k%d", n)
			g.st.Cards[id] = &Card{ID: id, Num: n, Title: id, Author: author, Status: StatusAccepted, Validated: at, Decided: at}
		}
	}
	add(louis, day(1, 9), 10) // hier
	add(marie, day(2, 9), 3)  // aujourd'hui
	add(louis, day(2, 10), 1)
	clk.t = day(2, 15)
	s := g.AdminScores()
	if !s.DayFrom.Equal(day(2, 0)) || len(s.Day) != 2 {
		t.Fatalf("scores du jour : depuis %v, %+v", s.DayFrom, s.Day)
	}
	m, l := s.Day[0], s.Day[1]
	if m.Pseudo != "Marie M." || m.Place != 1 || m.Gain != 3 || len(m.Cards) != 3 || m.Cards[0].Before != nil || m.Cards[0].After == nil || m.Cards[0].Delta != 1 {
		t.Fatalf("Marie : %+v", m)
	}
	if l.Pseudo != "Louis L." || l.Place != 2 || l.Gain != 1 || len(l.Cards) != 1 {
		t.Fatalf("Louis (ses 10 cartes d'hier ne bougent pas) : %+v", l)
	}
}
