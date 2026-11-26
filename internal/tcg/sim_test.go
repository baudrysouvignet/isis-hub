package tcg

import (
	"fmt"
	"math/rand"
	"os"
	"sort"
	"strings"
	"testing"
	"time"
)

// Simulation d'équilibrage des récompenses de lancement (rewards.go), avec le vrai code du jeu :
// 90 joueurs, 40 créateurs (quelques gros, beaucoup de petits), 7 soirs de jury, une vague 1 de
// 150 cartes, puis 20 jours de jeu (2 boosters de 4 cartes par jour, pas toujours ouverts tous les
// deux). Lancement :
//
//	TCG_SIM=1 go test ./internal/tcg/ -run TestLaunchSimulation -v
//
// Ce n'est pas un test de non-régression : il imprime un tableau (moyenne sur plusieurs tirages).
func TestLaunchSimulation(t *testing.T) {
	if os.Getenv("TCG_SIM") == "" {
		t.Skip("simulation : TCG_SIM=1 pour la lancer")
	}
	variants := []struct {
		name string
		cap  int // soirs comptés au plus (-1 : aucune récompense)
	}{
		{"sans récompenses", -1},
		{"proposition (tous les soirs)", 1000},
		{"5 meilleurs soirs", 5},
		{"4 meilleurs soirs", 4},
	}
	const seeds = 30
	var b strings.Builder
	for _, v := range variants {
		var acc simResult
		for s := 0; s < seeds; s++ {
			acc.add(runLaunchSim(t, int64(s+1), v.cap))
		}
		acc.div(seeds)
		fmt.Fprintf(&b, "\n== %s\n%s", v.name, acc.String())
	}
	t.Log(b.String())
}

type simGroup struct {
	n                          float64
	bonus, day1Cards, day1Num  float64 // cartes bonus, cartes ouvertes le jour 1, exemplaires numérotés le jour 1
	day1Top                    float64 // légendaires + uniques le jour 1
	distinct7, distinct14, d20 float64 // cartes différentes (échos compris) aux jours 7, 14, 20
	num14                      float64 // exemplaires numérotés au jour 14
}

type simResult struct {
	groups                [4]simGroup // podium (3 premiers en cartes bonus), 4e-13e, autres participants, sans récompense
	stock, day1Num, day1N float64     // stock numéroté, numérotés tirés le jour 1, cartes tirées le jour 1
	day14Num              float64     // numérotés tirés au jour 14
	bonusCards            float64
}

var simNames = [4]string{"podium (3)", "4e à 13e", "autres participants", "sans récompense"}

func (r *simResult) add(o simResult) {
	for i := range r.groups {
		g, x := &r.groups[i], o.groups[i]
		g.n += x.n
		g.bonus += x.bonus
		g.day1Cards += x.day1Cards
		g.day1Num += x.day1Num
		g.day1Top += x.day1Top
		g.distinct7 += x.distinct7
		g.distinct14 += x.distinct14
		g.d20 += x.d20
		g.num14 += x.num14
	}
	r.stock += o.stock
	r.day1Num += o.day1Num
	r.day1N += o.day1N
	r.day14Num += o.day14Num
	r.bonusCards += o.bonusCards
}

func (r *simResult) div(k float64) {
	for i := range r.groups {
		g := &r.groups[i]
		for _, f := range []*float64{&g.n, &g.bonus, &g.day1Cards, &g.day1Num, &g.day1Top, &g.distinct7, &g.distinct14, &g.d20, &g.num14} {
			*f /= k
		}
	}
	for _, f := range []*float64{&r.stock, &r.day1Num, &r.day1N, &r.day14Num, &r.bonusCards} {
		*f /= k
	}
}

func (r simResult) String() string {
	var b strings.Builder
	fmt.Fprintf(&b, "stock numéroté %.0f · jour 1 : %.0f cartes tirées, %.0f numérotées (%.1f %% du stock) · jour 14 : %.1f %% du stock · cartes bonus %.0f\n",
		r.stock, r.day1N, r.day1Num, 100*r.day1Num/r.stock, 100*r.day14Num/r.stock, r.bonusCards)
	fmt.Fprintf(&b, "%-22s %5s %7s %9s %9s %9s %7s %7s %7s %8s\n", "groupe", "joueurs", "bonus", "cartes J1", "numér. J1", "lég+uni J1", "diff J7", "diff J14", "diff J20", "numér. J14")
	for i, g := range r.groups {
		if g.n == 0 {
			continue
		}
		fmt.Fprintf(&b, "%-22s %5.1f %7.1f %9.1f %9.2f %9.3f %7.1f %7.1f %7.1f %8.2f\n", simNames[i], g.n, g.bonus/g.n, g.day1Cards/g.n, g.day1Num/g.n, g.day1Top/g.n, g.distinct7/g.n, g.distinct14/g.n, g.d20/g.n, g.num14/g.n)
	}
	return b.String()
}

func runLaunchSim(t *testing.T, seed int64, capNights int) simResult {
	g, clk, _ := newGame(t)
	old := maxNights
	maxNights = 1000 // récompenses complètes d'abord (pour former les groupes), plafond ensuite
	defer func() { maxNights = old }()
	rng := rand.New(rand.NewSource(seed))
	g.rnd = rand.New(rand.NewSource(seed * 7919)).Intn
	g.st.Season.Enabled = true
	start := time.Date(2026, 12, 1, 8, 0, 0, 0, Paris) // propositions : 7 jours, jury : 7 jours
	clk.t = start
	juryFrom := start.Add(7 * 24 * time.Hour)
	release := time.Date(2026, 12, 15, 6, 0, 0, 0, Paris)
	g.st.Waves = []*Wave{{N: 1, ProposalsUntil: release.Add(-10 * time.Hour), JuryFrom: juryFrom, JuryUntil: release.Add(-10 * time.Hour), ReleaseAt: release, Size: 150}}

	var players []string
	for i := 0; i < 90; i++ {
		players = append(players, mustJoin(t, g, fmt.Sprintf("s%d", i), "Joueur J."))
	}
	// 40 créateurs : cartes validées sur les 14 jours avant le lancement. Quelques gros créateurs
	// (30, 22, 16 cartes), une dizaine de moyens, beaucoup de petits.
	weights := []int{30, 22, 16, 12, 10, 9, 8, 8, 7, 6, 6, 5, 5}
	for len(weights) < 40 {
		weights = append(weights, 1+rng.Intn(4))
	}
	rng.Shuffle(len(weights), func(i, j int) { weights[i], weights[j] = weights[j], weights[i] })
	num := 0
	for ci, w := range weights {
		author := players[ci]
		for k := 0; k < w; k++ {
			num++
			at := start.Add(time.Duration(rng.Intn(13*24*60)) * time.Minute)
			id := fmt.Sprintf("s%d", num)
			g.st.Cards[id] = &Card{ID: id, Num: num, Title: id, Author: author, Status: StatusAccepted, Created: at, Decided: at, Validated: at,
				JuryPts: rng.Intn(40) - 20, JuryVotes: 10}
		}
	}
	// Jury : chaque soir, 60 joueurs environ classent une série.
	for d := 0; d < 7; d++ {
		for _, pid := range players {
			if rng.Float64() < 0.65 {
				at := juryFrom.Add(time.Duration(d*24+10+rng.Intn(12)) * time.Hour)
				p := g.st.Players[pid]
				p.Ballots[1] = append(p.Ballots[1], Ballot{Cards: []string{"s1"}, Rank: []string{"s1"}, At: at})
			}
		}
	}
	for _, pid := range players {
		g.st.Players[pid].Seen = release.Add(-24 * time.Hour)
	}
	clk.t = release
	g.Tick() // impression et récompenses
	w := g.st.Waves[0]
	if !w.Printed {
		t.Fatal("vague non imprimée")
	}
	var res simResult
	for _, id := range w.Cards {
		res.stock += float64(g.st.Cards[id].Run)
	}
	// Groupes : selon les cartes bonus de la proposition sans plafond ; puis le plafond de la variante.
	full := map[string]int{}
	var holders []string
	for _, pid := range players {
		p := g.st.Players[pid]
		var nights []RewardNight
		part := false
		for _, pk := range p.Packs {
			full[pid] += pk.Size
			if pk.Kind == "all" {
				part = true
			} else {
				nights = append(nights, RewardNight{Day: pk.Day, Rank: pk.Rank, Size: pk.Size})
			}
		}
		if full[pid] > 0 {
			holders = append(holders, pid)
		}
		p.Packs = nil
		if capNights >= 0 {
			maxNights = capNights
			p.Packs = rewardPacks(nights, part, release.Add(packValid))
			maxNights = 1000
		}
	}
	bonus := map[string]int{}
	for _, pid := range players {
		for _, pk := range g.st.Players[pid].Packs {
			bonus[pid] += pk.Size
		}
		res.bonusCards += float64(bonus[pid])
	}
	sort.Slice(holders, func(i, j int) bool { return full[holders[i]] > full[holders[j]] })
	sort.Slice(holders, func(i, j int) bool { return bonus[holders[i]] > bonus[holders[j]] })
	group := map[string]int{}
	for _, pid := range players {
		group[pid] = 3
	}
	for i, pid := range holders {
		switch {
		case i < 3:
			group[pid] = 0
		case i < 13 && full[pid] > allPackSize:
			group[pid] = 1
		default:
			group[pid] = 2
		}
	}
	for _, pid := range players {
		res.groups[group[pid]].n++
		res.groups[group[pid]].bonus += float64(bonus[pid])
	}

	// Jours de jeu. Chaque joueur : 90 % viennent le jour 1 (80 % ensuite), ouvrent leurs boosters
	// bonus à leur arrivée, puis le second booster 3 h plus tard ou plus (70 %).
	type ev struct {
		at   time.Time
		pid  string
		pack string // "" : booster du jour
	}
	stats := func(day int) {
		for _, pid := range players {
			p := g.st.Players[pid]
			distinct := 0
			for _, id := range w.Cards {
				if len(p.Owned[id]) > 0 || p.Echoes[id] > 0 {
					distinct++
				}
			}
			numbered := 0
			for id, s := range p.Owned {
				if g.st.Cards[id].Run > 0 {
					numbered += len(s)
				}
			}
			gr := &res.groups[group[pid]]
			switch day {
			case 7:
				gr.distinct7 += float64(distinct)
			case 14:
				gr.distinct14 += float64(distinct)
				gr.num14 += float64(numbered)
			case 20:
				gr.d20 += float64(distinct)
			}
		}
	}
	for day := 0; day < 20; day++ {
		base := release.Add(time.Duration(day) * 24 * time.Hour)
		var evs []ev
		for _, pid := range players {
			come := 0.8
			if day == 0 {
				come = 0.9
			}
			if rng.Float64() > come {
				continue
			}
			first := base.Add(time.Duration(30+rng.Intn(15*60)) * time.Minute) // de 6 h 30 à 21 h 30
			evs = append(evs, ev{first, pid, ""})
			if day == 0 {
				for _, pk := range g.st.Players[pid].Packs {
					evs = append(evs, ev{first.Add(time.Minute), pid, pk.ID})
				}
			}
			if rng.Float64() < 0.7 {
				evs = append(evs, ev{first.Add(boosterGap + time.Duration(rng.Intn(5*60))*time.Minute), pid, ""})
			}
		}
		sort.Slice(evs, func(i, j int) bool { return evs[i].at.Before(evs[j].at) })
		for _, e := range evs {
			clk.t = e.at
			p := g.st.Players[e.pid]
			p.Seen = e.at
			var pulls []Pull
			if e.pack != "" {
				pulls, _ = g.OpenPack(e.pid, e.pack)
			} else {
				pulls, _ = g.OpenBooster(e.pid)
			}
			if day != 0 {
				continue
			}
			gr := &res.groups[group[e.pid]]
			for _, pl := range pulls {
				c := g.st.Cards[pl.Card]
				gr.day1Cards++
				res.day1N++
				if pl.Serial > 0 {
					gr.day1Num++
					res.day1Num++
					if c.Rarity.tier() >= 3 {
						gr.day1Top++
					}
				}
			}
		}
		if day == 13 {
			for _, id := range w.Cards {
				res.day14Num += float64(g.st.Cards[id].Issued * min(g.st.Cards[id].Run, 1))
			}
		}
		for _, d := range []int{7, 14, 20} {
			if day+1 == d {
				stats(d)
			}
		}
	}
	return res
}
