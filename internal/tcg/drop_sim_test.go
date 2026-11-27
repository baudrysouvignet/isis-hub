package tcg

import (
	"fmt"
	"math/rand"
	"os"
	"strings"
	"testing"
	"time"
)

// Simulation : à quel rythme sortent les raretés, avec le vrai tirage (draw, give) et le rythme
// des cartes numérotées (boostersPerDay, PaceDays). Vague 1 telle que réglée dans l'administration :
// 140 cartes, 1 unique (1 exemplaire), 7 légendaires (5 exemplaires chacune), 30 épiques (15),
// 50 rares (30), 52 communes (illimitées). 78 joueurs actifs, 110 boosters ouverts par jour, et
// le jour du lancement les boosters bonus (participation de 4 ou 2 cartes, plus les soirs).
//
//	TCG_SIM=1 go test ./internal/tcg/ -run TestDropRates -v
func TestDropRates(t *testing.T) {
	if os.Getenv("TCG_SIM") == "" {
		t.Skip("simulation : TCG_SIM=1 pour la lancer")
	}
	const seeds = 20
	const days = 21
	var b strings.Builder
	for _, part := range []int{4, 2} {
		var acc [days][6]float64 // boosters, rares, épiques, légendaires, uniques, répliques
		for s := 0; s < seeds; s++ {
			r := runDropSim(t, int64(s+1), part, days)
			for d := range r {
				for k := range r[d] {
					acc[d][k] += r[d][k] / seeds
				}
			}
		}
		bonus := 78*part + 45
		fmt.Fprintf(&b, "\n== participation %d cartes (%d cartes bonus le jour du lancement, %d joueurs)\n", part, bonus, 78)
		fmt.Fprintf(&b, "%-6s %9s %7s %8s %11s %8s %10s\n", "jour", "boosters", "rares", "épiques", "légendaires", "unique", "répliques")
		var sum [6]float64
		for d := 0; d < days; d++ {
			fmt.Fprintf(&b, "J%-5d %9.0f %7.1f %8.1f %11.2f %8.2f %10.1f\n", d+1, acc[d][0], acc[d][1], acc[d][2], acc[d][3], acc[d][4], acc[d][5])
			if d < 14 {
				for k := range sum {
					sum[k] += acc[d][k]
				}
			}
		}
		every := func(n float64) string {
			if n == 0 {
				return "—"
			}
			return fmt.Sprintf("1 booster sur %.0f", sum[0]/n)
		}
		fmt.Fprintf(&b, "J1–J14 : rare %s · épique %s · légendaire %s · unique %s\n", every(sum[1]), every(sum[2]), every(sum[3]), every(sum[4]))
	}
	t.Log(b.String())
}

// runDropSim : par jour, boosters ouverts et cartes tirées de chaque rareté (exemplaires numérotés,
// et répliques à part).
func runDropSim(t *testing.T, seed int64, part, days int) [][6]float64 {
	g, clk, _ := newGame(t)
	rng := rand.New(rand.NewSource(seed))
	g.rnd = rand.New(rand.NewSource(seed * 7919)).Intn
	g.st.Season.Enabled = true
	g.st.Season.PaceDays = 14
	release := time.Date(2026, 12, 7, 6, 0, 0, 0, Paris)
	clk.t = release.Add(-time.Hour)
	w := &Wave{N: 1, ReleaseAt: release, Printed: true, PrintedAt: release, Size: 140, Rewarded: true}
	g.st.Waves = []*Wave{w}
	mix := []struct {
		r    Rarity
		n    int
		runs int
	}{{Unique, 1, 1}, {Legendaire, 7, 5}, {Epique, 30, 15}, {Rare, 50, 30}, {Commune, 52, 0}}
	no := 0
	for _, m := range mix {
		for i := 0; i < m.n; i++ {
			no++
			id := fmt.Sprintf("w%d", no)
			g.st.Cards[id] = &Card{ID: id, Num: no, Title: id, Status: StatusPrinted, Wave: 1, No: no, Rarity: m.r, Run: m.runs}
			w.Cards = append(w.Cards, id)
		}
	}
	var players []string
	for i := 0; i < 78; i++ {
		pid := mustJoin(t, g, fmt.Sprintf("j%d", i), "Joueur J.")
		g.st.Players[pid].Seen = release.Add(-time.Hour)
		players = append(players, pid)
	}
	// Boosters bonus du lancement : la participation pour chacun, et les soirs (2 soirs : 5, 4, 3,
	// puis dix fois 1, soit 45 cartes avec les arrondis du podium).
	var packs [][2]int // joueur, taille
	for i := range players {
		packs = append(packs, [2]int{i, part})
	}
	for n := 0; n < 2; n++ {
		for k, size := range []int{5, 4, 3, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1} {
			packs = append(packs, [2]int{(k + n*5) % len(players), size})
		}
	}
	packs = append(packs, [2]int{20, 1})
	for _, pk := range packs {
		p := g.st.Players[players[pk[0]]]
		p.Packs = append(p.Packs, Pack{ID: "b", Size: pk[1], Until: release.Add(packValid)})
	}

	out := make([][6]float64, days)
	count := func(d int, pulls []Pull) {
		for _, pl := range pulls {
			c := g.st.Cards[pl.Card]
			switch {
			case pl.Replica:
				out[d][5]++
			case c.Rarity == Rare:
				out[d][1]++
			case c.Rarity == Epique:
				out[d][2]++
			case c.Rarity == Legendaire:
				out[d][3]++
			case c.Rarity == Unique:
				out[d][4]++
			}
		}
	}
	for d := 0; d < days; d++ {
		base := release.Add(time.Duration(d) * 24 * time.Hour)
		type ev struct {
			at    time.Time
			pid   string
			size  int
			bonus bool // booster bonus : hors du compteur des boosters du jour (comme OpenPack)
		}
		var evs []ev
		for i := 0; i < 110; i++ {
			evs = append(evs, ev{base.Add(time.Duration(30+rng.Intn(17*60)) * time.Minute), players[rng.Intn(len(players))], boosterSize, false})
		}
		if d == 0 {
			for _, pk := range packs {
				evs = append(evs, ev{base.Add(time.Duration(30+rng.Intn(10*60)) * time.Minute), players[pk[0]], pk[1], true})
			}
		}
		for i := range evs {
			j := i + rng.Intn(len(evs)-i)
			evs[i], evs[j] = evs[j], evs[i]
		}
		for i := 1; i < len(evs); i++ { // dans l'ordre de l'heure
			for k := i; k > 0 && evs[k].at.Before(evs[k-1].at); k-- {
				evs[k], evs[k-1] = evs[k-1], evs[k]
			}
		}
		for _, e := range evs {
			clk.t = e.at
			p := g.st.Players[e.pid]
			p.Seen = e.at
			pulls := g.draw(e.at, e.size)
			g.give(p, pulls, e.at)
			if !e.bonus {
				g.st.Boosters[DayKey(e.at)]++
			}
			count(d, pulls)
		}
		out[d][0] = 110
	}
	return out
}
