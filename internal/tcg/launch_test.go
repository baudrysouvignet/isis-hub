package tcg

import (
	"fmt"
	"math/rand"
	"sort"
	"testing"
	"time"
)

// Retirer une carte bloquée rend une proposition le jour même ; une carte en attente, non. Le
// compteur du jour ne descend jamais sous 0.
func TestWithdrawBlockedGivesCredit(t *testing.T) {
	g, clk, _ := newGame(t)
	g.st.Season.Enabled = true
	g.SaveWave(WaveInput{ReleaseAt: clk.now().Add(14 * 24 * time.Hour), Size: 10})
	a := mustJoin(t, g, "a", "Alice A.")
	left := func() int {
		v, _ := g.PlayerView(a)
		return v.Me.ProposalsLeft
	}
	var ids []string
	for i := 0; i < 3; i++ {
		ids = append(ids, propose(t, g, a, fmt.Sprintf("Carte %d", i)))
	}
	if left() != 0 {
		t.Fatalf("après 3 propositions : %d", left())
	}
	if err := g.ModerateCard(ids[0], Moderate{Action: "block", Reason: "illisible"}); err != nil {
		t.Fatal(err)
	}
	if credited, err := g.Withdraw(a, ids[0]); err != nil || !credited || left() != 1 {
		t.Fatalf("carte bloquée retirée : rendue=%v err=%v restantes=%d", credited, err, left())
	}
	if credited, err := g.Withdraw(a, ids[1]); err != nil || credited || left() != 1 {
		t.Fatalf("carte en attente retirée : rendue=%v err=%v restantes=%d", credited, err, left())
	}
	propose(t, g, a, "Nouvelle version")
	if left() != 0 {
		t.Fatalf("après la nouvelle version : %d", left())
	}
	// Le lendemain, rien d'envoyé : une carte bloquée de la veille ne fait pas dépasser le quota.
	if err := g.ModerateCard(ids[2], Moderate{Action: "block", Reason: "doublon"}); err != nil {
		t.Fatal(err)
	}
	clk.add(24 * time.Hour)
	if credited, _ := g.Withdraw(a, ids[2]); credited || left() != 3 {
		t.Fatalf("lendemain : rendue=%v restantes=%d", credited, left())
	}
}

// Seule pénalité : une carte validée, non retenue, dans le dernier quart du jury de la vague en
// jeu. Elle se calcule vague par vague.
func TestJuryPenaltyBottomQuarter(t *testing.T) {
	g, clk, _ := newGame(t)
	g.st.Season.Enabled = true
	now := clk.now()
	g.st.Waves = []*Wave{{N: 1, Printed: true, PrintedAt: now, ReleaseAt: now}}
	a := mustJoin(t, g, "a", "Alice A.")
	b := mustJoin(t, g, "b", "Bob B.")
	var cards []string
	for i := 0; i < 8; i++ {
		author := b
		if i < 2 {
			author = a
		}
		id := fmt.Sprintf("k%d", i)
		g.st.Cards[id] = &Card{ID: id, Author: author, Status: StatusAccepted, Validated: now, Decided: now}
		cards = append(cards, id)
	}
	// k0 et k1 (Alice) en bas de chaque classement ; k8 (Bob), plus bas encore, n'a que deux
	// classements : pas assez pour le juger.
	g.st.Cards["k8"] = &Card{ID: "k8", Author: b, Status: StatusAccepted, Validated: now, Decided: now}
	rank := []string{"k7", "k6", "k5", "k4", "k3", "k2", "k1", "k0"}
	for i := 0; i < 4; i++ {
		v := mustJoin(t, g, fmt.Sprintf("v%d", i), "Juré J.")
		r := rank
		if i < 2 {
			r = append(append([]string{}, rank...), "k8")
		}
		g.st.Players[v].Ballots[1] = []Ballot{{Cards: r, Rank: r, At: now}}
	}
	vals, _, judge := g.valuation(time.Time{})
	var bottom []string
	for id, v := range vals {
		if v.penalty {
			bottom = append(bottom, id)
		}
	}
	sort.Strings(bottom)
	if judge != 1 || len(bottom) != 2 || bottom[0] != "k0" || bottom[1] != "k1" {
		t.Fatalf("dernier quart : %v (jury de la vague %d)", bottom, judge)
	}
	score := func(pid string) float64 {
		for _, cr := range g.ranking() {
			if cr.id == pid {
				return cr.score
			}
		}
		return 0
	}
	if s := score(a); s != 0 { // -1 + -1 : hors classement
		t.Fatalf("Alice : %v", s)
	}
	if s := score(b); s != 7 {
		t.Fatalf("Bob : %v", s)
	}
	// La vague 2 sort : seul son jury compte, Alice n'est plus pénalisée.
	g.st.Waves = append(g.st.Waves, &Wave{N: 2, Printed: true, PrintedAt: now, ReleaseAt: now})
	if s := score(a); s != 2 {
		t.Fatalf("Alice après la vague 2 : %v", s)
	}
}

// Les répliques : seulement quand tous les exemplaires numérotés sont tirés, hors de Owned (jamais
// échangés, ni doubles, ni correspondances), et ils comptent pour la collection.
func TestEchoes(t *testing.T) {
	g, clk, ps := liveGame(t)
	a, b := ps[0], ps[1]
	var rare *Card
	for _, c := range g.st.Cards {
		if c.Status == StatusPrinted && c.Run > 0 {
			rare = c
			break
		}
	}
	if rare == nil {
		t.Fatal("pas de carte numérotée")
	}
	pa := g.st.Players[a]
	pulls := []Pull{{Card: rare.ID}}
	g.give(pa, pulls, clk.now())
	if pulls[0].Replica || pulls[0].Serial != 1 {
		t.Fatalf("premier tirage : %+v", pulls[0])
	}
	rare.Issued = rare.Run // tous les exemplaires partis
	for i := 0; i < 2; i++ {
		pulls = []Pull{{Card: rare.ID}}
		g.give(pa, pulls, clk.now())
		if !pulls[0].Replica || pulls[0].Serial != 0 || pulls[0].New {
			t.Fatalf("réplique : %+v", pulls[0])
		}
	}
	if len(pa.Owned[rare.ID]) != 1 || pa.Replicas[rare.ID] != 2 || rare.Replicas != 2 || rare.Issued != rare.Run {
		t.Fatalf("collection : %v, répliques %d, carte %d/%d", pa.Owned[rare.ID], pa.Replicas[rare.ID], rare.Issued, rare.Run)
	}
	// Échange : la réplique ne se pose pas sur la table (seul l'exemplaire n° 1 existe dans Owned).
	code, _, _ := g.NewTrade(a, "")
	if err := g.JoinTrade(b, code); err != nil {
		t.Fatal(err)
	}
	if err := g.SetOffer(a, code, []Copy{{rare.ID, 1}, {rare.ID, 0}}); err == nil {
		t.Fatal("réplique posé sur la table")
	}
	if err := g.SetOffer(a, code, []Copy{{rare.ID, 1}}); err != nil {
		t.Fatal(err)
	}
	// Un joueur qui n'a que des répliques n'apparaît pas dans les correspondances, et ses répliques ne
	// sont pas des doubles.
	delete(pa.Owned, rare.ID)
	if err := g.SetWish(b, rare.ID, true); err != nil {
		t.Fatal(err)
	}
	vb, _ := g.PlayerView(b)
	for _, m := range vb.Matches {
		if m.ID == a {
			t.Fatalf("répliques vus comme une carte à échanger : %+v", m)
		}
	}
	va, _ := g.PlayerView(a)
	if va.Replicas[rare.ID] != 2 || len(va.Owned[rare.ID]) != 0 {
		t.Fatalf("vue : répliques %v, owned %v", va.Replicas, va.Owned[rare.ID])
	}
	// Au tirage, une carte épuisée sort en réplique (au rythme de la vraie), jamais avec un numéro.
	for _, c := range g.st.Cards {
		if c.Run > 0 {
			c.Issued = c.Run
		}
	}
	g.rnd = rand.New(rand.NewSource(3)).Intn
	replicas := 0
	for i := 0; i < 300; i++ {
		for _, p := range g.draw(clk.now(), boosterSize) {
			if c := g.st.Cards[p.Card]; c.Run > 0 {
				if !p.Replica {
					t.Fatal("carte épuisée tirée sans être une réplique")
				}
				replicas++
			}
		}
	}
	if replicas == 0 {
		t.Fatal("aucune réplique tirée")
	}
}

// Récompenses de lancement : le classement de chaque soir de votes, à minuit, reconstitué à la
// sortie ; participation pour tous ; plafond ; valables 24 h.
func TestLaunchRewards(t *testing.T) {
	g, clk, _ := newGame(t)
	g.st.Season.Enabled = true
	g.st.Season.PerDay = 10
	day := func(d, h int) time.Time { return time.Date(2026, 11, 24+d, h, 0, 0, 0, Paris) }
	clk.t = day(0, 8)
	if _, err := g.SaveWave(WaveInput{ProposalsUntil: day(4, 20), JuryFrom: day(1, 0), JuryUntil: day(4, 20), ReleaseAt: day(5, 6), Size: 60}); err != nil {
		t.Fatal(err)
	}
	var creators []string
	for i := 0; i < 15; i++ {
		creators = append(creators, mustJoin(t, g, fmt.Sprintf("c%d", i), fmt.Sprintf("Créa%c C.", 'A'+i)))
	}
	voter := mustJoin(t, g, "voter", "Vic V.")
	idle := mustJoin(t, g, "idle", "Ida I.")
	validate := func(pid string, n int) {
		for k := 0; k < n; k++ {
			id := propose(t, g, pid, fmt.Sprintf("C %s %d", pid[:4], k))
			if err := g.ModerateCard(id, Moderate{Action: "validate"}); err != nil {
				t.Fatal(err)
			}
			clk.add(time.Minute)
		}
	}
	// Jour 1 (premier jour du jury) : c0 = 6 cartes, c1 = 5, c2 = 4, puis 1 chacun pour c3 … c14.
	clk.t = day(1, 8)
	validate(creators[0], 6)
	validate(creators[1], 5)
	validate(creators[2], 4)
	for _, c := range creators[3:] {
		validate(c, 1)
	}
	vote := func(at time.Time) {
		p := g.st.Players[voter]
		p.Ballots[1] = append(p.Ballots[1], Ballot{Cards: []string{"x"}, Rank: []string{"x"}, At: at})
	}
	vote(day(1, 14)) // soir 1 : c0, c1, c2 au podium du jour, c3 … c14 ensuite, tous 4es ex æquo
	// Jour 2 : pas de vote. Jour 3 : seul c14 gagne des points (9 cartes) : seul au podium du jour,
	// l'avance de c0 la veille ne compte pas.
	clk.t = day(3, 9)
	validate(creators[14], 9)
	vote(day(3, 18))
	// Aperçu avant le lancement : seuls les minuits passés comptent.
	clk.t = day(3, 22)
	if v, _ := g.PlayerView(creators[0]); v.Rewards == nil || !v.Rewards.Preview || len(v.Rewards.Nights) != 1 || v.Rewards.Cards != allPackSize+5 {
		t.Fatalf("aperçu : %+v", v.Rewards)
	}
	// Podium de chaque soir (administration) : celui qui s'affichait à minuit.
	if pd := g.AdminRewards().Podiums; len(pd) != 1 || pd[0].Day != "2026-11-25" || fmt.Sprint(pd[0].Top) != "[CréaA C. CréaB C. CréaC C.]" {
		t.Fatalf("podiums : %+v", pd)
	}
	clk.t = day(5, 6).Add(time.Minute)
	g.Tick()
	if pd := g.AdminRewards().Podiums; len(pd) != 2 || pd[1].Top[0] != "CréaO C." {
		t.Fatalf("podiums après la sortie : %+v", pd)
	}
	if !g.st.Waves[0].Printed || !g.st.Waves[0].Rewarded {
		t.Fatal("vague 1 pas imprimée ou pas récompensée")
	}
	sizes := func(pid string) []int {
		var out []int
		for _, pk := range g.st.Players[pid].Packs {
			out = append(out, pk.Size)
		}
		return out
	}
	eq := func(pid string, want ...int) {
		t.Helper()
		got := sizes(pid)
		if fmt.Sprint(got) != fmt.Sprint(want) {
			t.Fatalf("%s : %v, attendu %v", g.st.Players[pid].Pseudo, got, want)
		}
	}
	eq(creators[0], allPackSize, 5)     // 1er le soir 1 ; le soir 3, rien gagné ce jour-là
	eq(creators[14], allPackSize, 1, 5) // 4e ex æquo le soir 1 (1 carte comme c3 … c13), 1er le soir 3
	eq(creators[3], allPackSize, 1)     // 4e ex æquo le soir 1
	eq(creators[13], allPackSize, 1)    // même gain que c3 ce soir-là : même place, même booster
	eq(voter, allPackSize)              // une série du jury : participant
	eq(idle)                            // ni carte, ni vote
	if pk := g.st.Players[creators[0]].Packs[1]; pk.Kind != "rank" || pk.Rank != 1 || pk.Day != "2026-11-25" {
		t.Fatalf("soir : %+v", pk)
	}
	// Boosters bonus : même tirage, valables 24 h, une seule fois.
	clk.add(time.Hour)
	pulls, err := g.OpenPack(creators[0], "b2")
	if err != nil || len(pulls) != 5 {
		t.Fatalf("booster bonus : %d cartes, %v", len(pulls), err)
	}
	if _, err := g.OpenPack(creators[0], "b2"); err == nil {
		t.Fatal("booster bonus ouvert deux fois")
	}
	if _, err := g.OpenBooster(creators[0]); err != nil { // les boosters du jour restent
		t.Fatal(err)
	}
	clk.t = day(6, 6).Add(2 * time.Minute)
	if _, err := g.OpenPack(creators[0], "b3"); err == nil {
		t.Fatal("booster bonus ouvert après 24 h")
	}
	// Seuls les meilleurs soirs comptent (3 au plus), remis dans l'ordre des soirs.
	var many []RewardNight
	for i, r := range []int{4, 1, 1, 2, 3, 1, 1} {
		many = append(many, RewardNight{Day: fmt.Sprintf("2026-12-0%d", i+1), Rank: r, Size: packSize(r)})
	}
	got := rewardPacks(many, false, time.Time{})
	var days []string
	for _, pk := range got {
		days = append(days, pk.Day[8:])
	}
	if len(got) != maxNights || fmt.Sprint(days) != "[02 03 06]" {
		t.Fatalf("meilleurs soirs : %+v", got)
	}
}

// Annuler une décision (mode file) : la carte revient à valider, tant que rien n'en dépend.
func TestReopenDecision(t *testing.T) {
	g, clk, _ := newGame(t)
	g.st.Season.Enabled = true
	g.SaveWave(WaveInput{ReleaseAt: clk.now().Add(14 * 24 * time.Hour), Size: 10})
	a := mustJoin(t, g, "a", "Alice A.")
	id := propose(t, g, a, "Carte")
	for _, m := range []Moderate{{Action: "validate"}, {Action: "block", Reason: "illisible"}} {
		if err := g.ModerateCard(id, m); err != nil {
			t.Fatal(err)
		}
		if err := g.ModerateCard(id, Moderate{Action: "reopen"}); err != nil {
			t.Fatal(err)
		}
		if c := g.st.Cards[id]; c.Status != StatusPending || !c.Validated.IsZero() || c.Reason != "" {
			t.Fatalf("après annulation : %+v", c)
		}
	}
	if err := g.ModerateCard(id, Moderate{Action: "reopen"}); err == nil {
		t.Fatal("annulation sans décision")
	}
	g.ModerateCard(id, Moderate{Action: "validate"})
	g.st.Cards[id].JuryVotes = 1
	if err := g.ModerateCard(id, Moderate{Action: "reopen"}); err == nil {
		t.Fatal("annulation d'une carte déjà classée au jury")
	}
}

// Booster d'essai : réservé à l'administration, rien n'est enregistré.
func TestTryBooster(t *testing.T) {
	g, clk, _ := newGame(t)
	g.st.Season.Enabled = true
	g.SaveWave(WaveInput{ReleaseAt: clk.now().Add(14 * 24 * time.Hour), Size: 10})
	g.IsAdmin = func(login string) bool { return login == "boss" }
	admin := mustJoin(t, g, "boss", "Boss B.")
	a := mustJoin(t, g, "a", "Alice A.")
	for i := 0; i < 5; i++ {
		propose(t, g, a, fmt.Sprintf("Carte %d", i))
		if i == 2 {
			clk.add(24 * time.Hour)
		}
	}
	if _, err := g.TryBooster(a, ""); err == nil {
		t.Fatal("essai ouvert à un joueur")
	}
	// Sans aucune carte proposée : l'essai marche quand même (cartes de démonstration).
	g2, _, _ := newGame(t)
	g2.IsAdmin = g.IsAdmin
	if try, err := g2.TryBooster(mustJoin(t, g2, "boss", "Boss B."), "pack"); err != nil || len(try.Cards) != 5 || try.Cards[0].Title == "" {
		t.Fatalf("essai sans carte : %+v %v", try, err)
	}
	for kind, n := range map[string]int{"": 4, "pack": 5} {
		try, err := g.TryBooster(admin, kind)
		if err != nil || len(try.Pulls) != n || len(try.Cards) != n {
			t.Fatalf("essai %q : %+v %v", kind, try, err)
		}
		replica := false
		for _, p := range try.Pulls {
			replica = replica || p.Replica
		}
		if !replica {
			t.Fatal("pas de réplique dans l'essai")
		}
	}
	if len(g.st.Players[admin].Owned) != 0 {
		t.Fatal("l'essai a rempli une collection")
	}
}

// Rythme des raretés le jour du lancement : les premiers boosters ouverts ne raflent pas les
// cartes numérotées (le rythme compte d'avance tous les joueurs et les boosters bonus).
func TestLaunchDayPacing(t *testing.T) {
	g, clk, _ := newGame(t)
	g.st.Season.Enabled = true
	g.rnd = rand.New(rand.NewSource(7)).Intn
	now := clk.now()
	w := &Wave{N: 1, ReleaseAt: now, Size: 150}
	g.st.Waves = []*Wave{w}
	var players []string
	for i := 0; i < 90; i++ {
		players = append(players, mustJoin(t, g, fmt.Sprintf("p%d", i), "Joueur J."))
		g.st.Players[players[i]].Seen = now
	}
	for i := 0; i < 150; i++ {
		id := fmt.Sprintf("q%d", i)
		g.st.Cards[id] = &Card{ID: id, Title: id, Author: players[i%40], Status: StatusAccepted, JuryPts: 150 - i, JuryVotes: 10, Validated: now.Add(-time.Hour), Decided: now.Add(-time.Hour)}
	}
	if !g.printWave(w, now) {
		t.Fatal("impression")
	}
	stock := 0
	for _, id := range w.Cards {
		stock += g.st.Cards[id].Run
	}
	numbered := 0
	for _, pid := range players[:20] { // les 20 premiers à ouvrir leur booster
		pulls, err := g.OpenBooster(pid)
		if err != nil {
			t.Fatal(err)
		}
		for _, p := range pulls {
			if p.Serial > 0 {
				numbered++
			}
		}
	}
	// Un jour de jeu vaut 1/14 du stock pour ~135 boosters : 20 boosters ≈ 1 % du stock.
	if numbered > stock/40 {
		t.Fatalf("%d exemplaires numérotés dans les 20 premiers boosters (stock %d)", numbered, stock)
	}
}

// Rétroactif : un fichier d'avant 2.3.0 (ni Card.Validated, ni récompenses) rechargé reconstitue les
// soirs de jury déjà passés. Une carte passée par les accords est datée de sa validation, pas de la
// dernière réponse (Decided réécrit).
func TestLaunchRewardsRetroactive(t *testing.T) {
	g, clk, dir := newGame(t)
	g.st.Season.Enabled = true
	day := func(d, h int) time.Time { return time.Date(2026, 11, 24+d, h, 0, 0, 0, Paris) }
	g.st.Waves = []*Wave{{N: 1, JuryFrom: day(1, 0), JuryUntil: day(4, 20), ReleaseAt: day(6, 6), Size: 50}}
	a := mustJoin(t, g, "a", "Alice A.")
	b := mustJoin(t, g, "b", "Bob B.")
	v := mustJoin(t, g, "v", "Vic V.")
	// Alice : 2 cartes validées le jour 1. Bob : 3 cartes validées le jour 1, mais l'une attendait
	// des accords jusqu'au jour 3 (Decided réécrit), avec un mail parti le jour 1 à 11 h.
	add := func(id, author string, decided time.Time, tags ...Tag) {
		g.st.Cards[id] = &Card{ID: id, Author: author, Status: StatusAccepted, Created: day(0, 8), Decided: decided, Tags: tags}
	}
	add("a1", a, day(1, 10))
	add("a2", a, day(1, 10))
	add("b1", b, day(1, 10))
	add("b2", b, day(1, 10))
	add("b3", b, day(3, 15), Tag{Key: "k", Notified: day(1, 11), Answer: "ok", At: day(3, 15)})
	g.st.Players[v].Ballots[1] = []Ballot{{Cards: []string{"a1"}, Rank: []string{"a1"}, At: day(1, 12)}}
	clk.t = day(2, 9)
	if err := g.Flush(); err != nil {
		t.Fatal(err)
	}
	// Ancien fichier : on efface ce que 2.3.0 ajoute, puis on recharge.
	for _, c := range g.st.Cards {
		c.Validated = time.Time{}
	}
	g.dirty = true
	g.Flush()
	g2, err := Open(dir, "poivre-de-test", Local{Dir: t.TempDir()})
	if err != nil {
		t.Fatal(err)
	}
	g2.now = clk.now
	if got := g2.st.Cards["b3"].Validated; !got.Equal(day(1, 11)) {
		t.Fatalf("date de validation reconstituée : %v", got)
	}
	// Podium du soir 1 (points gagnés le jour 1) : Bob 3, Alice 2. Sans la date reconstituée, b3
	// compterait le jour 3 : Bob et Alice seraient ex æquo.
	nights, _ := g2.launchRewards(g2.st.Waves[0], clk.now(), false)
	if n := nights[b]; len(n) != 1 || n[0].Rank != 1 || n[0].Day != "2026-11-25" {
		t.Fatalf("Bob au soir 1 : %+v", n)
	}
	if n := nights[a]; len(n) != 1 || n[0].Rank != 2 {
		t.Fatalf("Alice au soir 1 : %+v", n)
	}
}

// ADMIN_USERS appliqué au démarrage, sans attendre que l'administrateur rejoigne le jeu à nouveau.
func TestSyncAdmins(t *testing.T) {
	g, _, _ := newGame(t)
	a := mustJoin(t, g, "bsouvign", "Baudry S.")
	b := mustJoin(t, g, "autre", "Autre A.")
	g.st.Players[b].Admin = true
	g.SyncAdmins([]string{" BSouvign "})
	if !g.st.Players[a].Admin || g.st.Players[b].Admin {
		t.Fatalf("admin : a=%v b=%v", g.st.Players[a].Admin, g.st.Players[b].Admin)
	}
}
