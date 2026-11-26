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

// Simulation : les boosters bonus du soir, selon le classement cumulé (ce qui se faisait) ou le
// podium de la journée (points gagnés depuis le minuit d'avant). Vrai code du serveur (rankingAt,
// dayRanking, packSize, rewardPacks), cartes et votes datés, 7 soirs de jury, 40 créateurs dont
// trois profils suivis (Spam : 30 cartes faibles, Soigné : 5 très bonnes, Régulier : 12 un peu
// au-dessus). Deux scénarios : propositions pendant le jury, ou toutes avant.
//
//	TCG_SIM=1 go test ./internal/tcg/ -run TestDailyPodiumSimulation -v
func TestDailyPodiumSimulation(t *testing.T) {
	if os.Getenv("TCG_SIM") == "" {
		t.Skip("simulation : TCG_SIM=1 pour la lancer")
	}
	type variant struct {
		name  string
		daily bool
		cap   int
	}
	variants := []variant{
		{"cumulé, 3 meilleurs soirs (actuel)", false, 3},
		{"journée, 3 meilleurs soirs", true, 3},
		{"journée, tous les soirs", true, 1000},
	}
	const seeds = 30
	var b strings.Builder
	for _, during := range []bool{true, false} {
		acc := make([]daySimResult, len(variants))
		for s := 0; s < seeds; s++ {
			nights := runDaySim(t, int64(s+1), during)
			for i, v := range variants {
				acc[i].add(nights.rewards(v.daily, v.cap))
			}
		}
		if during {
			b.WriteString("\n== propositions pendant le jury (40 % des cartes validées avant, 60 % pendant)\n")
		} else {
			b.WriteString("\n== toutes les cartes validées avant le jury\n")
		}
		fmt.Fprintf(&b, "%-36s %7s %7s %8s %8s %8s %8s %8s %8s\n", "cadeaux du soir", "1ers ≠", "podium≠", "max bonus", "Spam", "Soigné", "Régulier", "total", "ρ qual.")
		for i, v := range variants {
			r := acc[i]
			k := float64(seeds)
			fmt.Fprintf(&b, "%-36s %7.1f %7.1f %8.1f %8.1f %8.1f %8.1f %8.0f %8.2f\n", v.name, r.winners/k, r.podium/k, r.maxBonus/k, r.spam/k, r.soigne/k, r.regulier/k, r.total/k, r.rhoQual/k)
		}
	}
	b.WriteString("\n1ers ≠ / podium≠ : créateurs différents qui ont été 1ers / sur le podium au moins un soir (sur 7).\n")
	b.WriteString("max bonus : cartes bonus du créateur le mieux servi (participation comprise) ; Spam, Soigné, Régulier : les leurs.\n")
	b.WriteString("total : cartes bonus distribuées en tout ; ρ qual. : corrélation entre cartes bonus et qualité moyenne des cartes.\n")
	t.Log(b.String())
}

type daySimResult struct{ winners, podium, maxBonus, spam, soigne, regulier, total, rhoQual float64 }

func (r *daySimResult) add(o daySimResult) {
	r.winners += o.winners
	r.podium += o.podium
	r.maxBonus += o.maxBonus
	r.spam += o.spam
	r.soigne += o.soigne
	r.regulier += o.regulier
	r.total += o.total
	r.rhoQual += o.rhoQual
}

// daySimNights : pour chaque soir, la place de chaque créateur, au classement cumulé et au podium de
// la journée.
type daySimNights struct {
	cumul, daily []map[string]int
	creators     []string
	profiles     [3]string
	quality      map[string]float64
}

func (n daySimNights) rewards(daily bool, capNights int) daySimResult {
	nights := n.cumul
	if daily {
		nights = n.daily
	}
	old := maxNights
	maxNights = capNights
	defer func() { maxNights = old }()
	bonus := map[string]float64{}
	winners, podium := map[string]bool{}, map[string]bool{}
	for _, id := range n.creators {
		var rn []RewardNight
		for d, places := range nights {
			pl := places[id]
			if pl == 1 {
				winners[id] = true
			}
			if pl > 0 && pl <= podiumSize {
				podium[id] = true
			}
			if s := packSize(pl); s > 0 {
				rn = append(rn, RewardNight{Day: fmt.Sprintf("d%d", d), Rank: pl, Size: s})
			}
		}
		for _, pk := range rewardPacks(rn, true, time.Time{}) {
			bonus[id] += float64(pk.Size)
		}
	}
	var r daySimResult
	for _, id := range n.creators {
		r.total += bonus[id]
		r.maxBonus = max(r.maxBonus, bonus[id])
	}
	r.winners, r.podium = float64(len(winners)), float64(len(podium))
	r.spam, r.soigne, r.regulier = bonus[n.profiles[0]], bonus[n.profiles[1]], bonus[n.profiles[2]]
	r.rhoQual = spearman(n.creators, bonus, n.quality)
	return r
}

func runDaySim(t *testing.T, seed int64, during bool) daySimNights {
	g, clk, _ := newGame(t)
	rng := rand.New(rand.NewSource(seed))
	start := time.Date(2026, 12, 7, 0, 0, 0, 0, Paris)
	clk.t = start.Add(-8 * 24 * time.Hour)
	w := &Wave{N: 1, Size: 150, JuryFrom: start, JuryUntil: start.Add(7 * 24 * time.Hour), ReleaseAt: start.Add(7*24*time.Hour + 6*time.Hour)}
	g.st.Waves = []*Wave{w}
	var players []string
	for i := 0; i < 90; i++ {
		players = append(players, mustJoin(t, g, fmt.Sprintf("s%d", i), "Joueur J."))
	}
	weights := []int{30, 5, 12, 22, 16, 10, 9, 8, 8, 7, 6, 6, 5}
	talent := []float64{-1, 1.5, 0.3}
	for len(weights) < 40 {
		weights = append(weights, 1+rng.Intn(4))
	}
	for len(talent) < len(weights) {
		talent = append(talent, rng.NormFloat64())
	}
	type ev struct {
		at   time.Time
		card string // validation d'une carte, sinon série du jury de pid
		pid  string
	}
	var evs []ev
	quality := map[string]float64{}
	num := 0
	for ci, n := range weights {
		for k := 0; k < n; k++ {
			num++
			id := fmt.Sprintf("c%d", num)
			at := start.Add(-time.Duration(1+rng.Intn(7*24*60)) * time.Minute) // avant le jury
			if during && rng.Float64() < 0.6 {
				at = start.Add(time.Duration(rng.Intn(7*24*60)) * time.Minute) // pendant
			}
			g.st.Cards[id] = &Card{ID: id, Num: num, Title: id, Author: players[ci], Status: StatusPending}
			quality[id] = 0.7*talent[ci] + 0.7*rng.NormFloat64()
			evs = append(evs, ev{at: at, card: id})
		}
	}
	for d := 0; d < 7; d++ {
		for _, pid := range players {
			if rng.Float64() < 0.65 {
				evs = append(evs, ev{at: start.Add(time.Duration(d*24+10)*time.Hour + time.Duration(rng.Intn(12*60))*time.Minute), pid: pid})
			}
		}
	}
	sort.Slice(evs, func(i, j int) bool { return evs[i].at.Before(evs[j].at) })
	shown := map[string]int{}
	for _, e := range evs {
		if e.card != "" {
			c := g.st.Cards[e.card]
			c.Status, c.Validated, c.Decided = StatusAccepted, e.at, e.at
			continue
		}
		var pool []string
		for id, c := range g.st.Cards {
			if c.Status == StatusAccepted && c.Author != e.pid {
				pool = append(pool, id)
			}
		}
		if len(pool) < ballotSize {
			continue
		}
		sort.Strings(pool)
		rng.Shuffle(len(pool), func(i, j int) { pool[i], pool[j] = pool[j], pool[i] })
		sort.SliceStable(pool, func(i, j int) bool { return shown[pool[i]] < shown[pool[j]] })
		series := append([]string(nil), pool[:ballotSize]...)
		taste := map[string]float64{}
		for _, id := range series {
			shown[id]++
			taste[id] = quality[id] + rng.NormFloat64()
		}
		sort.Slice(series, func(i, j int) bool { return taste[series[i]] > taste[series[j]] })
		for i, id := range series {
			c := g.st.Cards[id]
			c.JuryPts += len(series) - 1 - 2*i
			c.JuryVotes++
		}
		g.st.Players[e.pid].Ballots[1] = append(g.st.Players[e.pid].Ballots[1], Ballot{Cards: series, Rank: series, At: e.at})
	}
	clk.t = w.JuryUntil

	out := daySimNights{creators: players[:len(weights)], profiles: [3]string{players[0], players[1], players[2]}, quality: map[string]float64{}}
	count := map[string]float64{}
	for id, q := range quality {
		a := g.st.Cards[id].Author
		out.quality[a] += q
		count[a]++
	}
	for a := range out.quality {
		out.quality[a] /= count[a]
	}
	for d := 0; d < 7; d++ {
		mid := start.Add(time.Duration(d+1) * 24 * time.Hour)
		cumul, daily := map[string]int{}, map[string]int{}
		for _, cr := range g.rankingAt(mid) {
			cumul[cr.id] = cr.place
		}
		for _, dg := range g.dayRanking(dayStart(mid.Add(-time.Minute)), mid) {
			daily[dg.id] = dg.place
		}
		out.cumul = append(out.cumul, cumul)
		out.daily = append(out.daily, daily)
	}
	return out
}
