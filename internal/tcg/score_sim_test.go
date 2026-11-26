package tcg

import (
	"fmt"
	"math"
	"math/rand"
	"os"
	"sort"
	"strings"
	"testing"
	"time"
)

// Simulation d'équilibrage du classement des créateurs AVANT l'impression : la place des cartes au
// jury doit compter. Vrai code d'impression (plan, mixFor : la rareté que chaque carte aurait si la
// vague s'imprimait ce soir), jury réaliste (séries de 5 cartes, les moins vues d'abord, chacun
// classe selon la qualité de la carte et son goût), 7 soirs, 40 créateurs dont trois profils suivis :
//
//	Spam : 30 cartes, plutôt faibles · Soigné : 5 cartes, très bonnes · Régulier : 12 cartes, un peu au-dessus
//
//	TCG_SIM=1 go test ./internal/tcg/ -run TestScoreSimulation -v
//
// Ce n'est pas un test de non-régression : il imprime un tableau (moyenne sur plusieurs tirages).
func TestScoreSimulation(t *testing.T) {
	if os.Getenv("TCG_SIM") == "" {
		t.Skip("simulation : TCG_SIM=1 pour la lancer")
	}
	full := map[Rarity]float64{Commune: 2, Rare: 5, Epique: 9, Legendaire: 15, Unique: 25} // barème d'avant (communes à 2)
	c1 := map[Rarity]float64{Commune: 1, Rare: 5, Epique: 9, Legendaire: 15, Unique: 25}
	variants := []scoreVariant{
		{"A · actuel : 1 par validée, puis C2 R5 E9 L15 U25", true, full, 1, 0, false},
		{"B1 · rareté prévue C2 · pénalité si non retenue", false, full, 1, 0, false},
		{"B2 · rareté prévue C2 · pénalité même gardée", false, full, 2, 0, false},
		{"E1 · rareté prévue C1 · pénalité si non retenue", false, c1, 1, 0, false},
		{"E2 · rareté prévue C1 · pénalité même gardée", false, c1, 2, 0, false},
		{"E2+ · E2, rareté prévue dès 2 classements", false, c1, 2, 2, false},
		{"E2+ · E2, rareté prévue dès 3 classements", false, c1, 2, 3, false},
		{name: "retenu · vrai code du serveur (valuation)", points: rarityPoints, penalty: 2, real: true},
	}
	const seeds = 40
	var b strings.Builder
	for _, size := range simSizes() {
		acc := make([]scoreSimResult, len(variants))
		for s := 0; s < seeds; s++ {
			for i, r := range runScoreSim(t, int64(s+1), variants, size) {
				acc[i].add(r)
			}
		}
		fmt.Fprintf(&b, "\n== vague de %d cartes au plus (environ 221 cartes validées)", size)
		fmt.Fprintf(&b, "\n%-54s %6s %6s %6s %6s %7s %7s %7s %7s %7s %6s %7s\n", "barème avant impression", "Spam1", "Spam3", "Soig3", "Rég3", "ρ qual.", "ρ nb", "bonusSp", "bonusSo", "podium=", "ex æq.", "Spam S1")
		for i, v := range variants {
			r := acc[i]
			k := float64(seeds)
			fmt.Fprintf(&b, "%-54s %5.0f%% %5.0f%% %5.0f%% %5.0f%% %7.2f %7.2f %7.1f %7.1f %6.0f%% %5.0f%% %6.0f%%\n", v.name,
				100*r.spam1/k, 100*r.spam3/k, 100*r.soigne3/k, 100*r.regulier3/k, r.rhoQual/k, r.rhoCount/k, r.bonusSpam/k, r.bonusSoigne/k, 100*r.keep/k, 100*r.ties/k, 100*r.spamNight1/k)
		}
	}
	b.WriteString("\nSpam1 / Spam3 / Soig3 / Rég3 : part des tirages où le profil est 1er / sur le podium le dernier soir.\n")
	b.WriteString("ρ qual. / ρ nb : corrélation (Spearman) entre le score d'un créateur et la qualité moyenne de ses cartes / leur nombre.\n")
	b.WriteString("bonusSp / bonusSo : cartes bonus de lancement du Spam / du Soigné (3 meilleurs soirs).\n")
	b.WriteString("podium= : part du podium d'avant l'impression qui reste sur le podium juste après (barème plein des cartes imprimées).\n")
	b.WriteString("ex æq. : soirs où deux créateurs ont le même score dans les 4 premiers.\n")
	b.WriteString("Spam S1 : part des tirages où le Spam est sur le podium du premier soir (peu de classements).\n")
	t.Log(b.String())
}

type scoreVariant struct {
	name     string
	current  bool               // barème actuel : 1 par carte validée avant l'impression
	points   map[Rarity]float64 // carte imprimée (et, sauf current, carte retenue selon sa rareté prévue)
	penalty  int                // dernier quart du jury de la vague : 1 si la carte n'est pas retenue, 2 même retenue
	minVotes int                // classements qu'il faut pour compter selon la rareté prévue (0 : aucun)
	real     bool               // le calcul du serveur (valuation), pour vérifier qu'il fait ce qui est simulé
}

// value : ce que vaut une carte validée (r : rareté prévue ou imprimée, in : retenue).
func (v scoreVariant) value(r Rarity, in, bottom, printed bool) float64 {
	switch {
	case bottom && (v.penalty == 2 || !in):
		return validatedPoints + juryPenalty
	case v.current && !printed:
		return validatedPoints
	case in:
		return v.points[r]
	}
	return validatedPoints
}

type scoreSimResult struct {
	spam1, spam3, soigne3, regulier3 float64
	rhoQual, rhoCount                float64
	bonusSpam, bonusSoigne           float64
	keep, ties                       float64
	spamNight1                       float64 // Spam sur le podium du premier soir
}

func (r *scoreSimResult) add(o scoreSimResult) {
	r.spam1 += o.spam1
	r.spam3 += o.spam3
	r.soigne3 += o.soigne3
	r.regulier3 += o.regulier3
	r.rhoQual += o.rhoQual
	r.rhoCount += o.rhoCount
	r.bonusSpam += o.bonusSpam
	r.bonusSoigne += o.bonusSoigne
	r.keep += o.keep
	r.ties += o.ties
	r.spamNight1 += o.spamNight1
}

func runScoreSim(t *testing.T, seed int64, variants []scoreVariant, size int) []scoreSimResult {
	g, _, _ := newGame(t)
	rng := rand.New(rand.NewSource(seed))
	w := &Wave{N: 1, Size: size}
	g.st.Waves = []*Wave{w}
	var players []string
	for i := 0; i < 90; i++ {
		players = append(players, mustJoin(t, g, fmt.Sprintf("s%d", i), "Joueur J."))
	}
	// Créateurs : 0 Spam, 1 Soigné, 2 Régulier, puis les autres (volume et talent indépendants).
	weights := []int{30, 5, 12, 22, 16, 10, 9, 8, 8, 7, 6, 6, 5}
	talent := []float64{-1, 1.5, 0.3}
	for len(weights) < 40 {
		weights = append(weights, 1+rng.Intn(4))
	}
	for len(talent) < len(weights) {
		talent = append(talent, rng.NormFloat64())
	}
	quality := map[string]float64{}
	var ids []string
	num := 0
	for ci, n := range weights {
		for k := 0; k < n; k++ {
			num++
			id := fmt.Sprintf("c%d", num)
			g.st.Cards[id] = &Card{ID: id, Num: num, Author: players[ci], Status: StatusAccepted}
			quality[id] = 0.7*talent[ci] + 0.7*rng.NormFloat64()
			ids = append(ids, id)
		}
	}
	shown := map[string]int{}
	waveVotes := map[string][2]int{} // points, classements (jury de la vague)
	creators := players[:len(weights)]
	out := make([]scoreSimResult, len(variants))
	nightRanks := make([][]map[string]int, len(variants)) // par barème, par soir : place de chaque créateur

	scores := func(v scoreVariant) map[string]float64 {
		if v.real {
			sc := map[string]float64{}
			vals, _, _ := g.valuation(time.Time{})
			for id, val := range vals {
				sc[g.st.Cards[id].Author] += val.points
			}
			return sc
		}
		planned := map[string]Rarity{}
		for _, c := range g.plan(w) {
			if c.Rarity != "" {
				planned[c.Card.ID] = c.Rarity
			}
		}
		bottom := simBottom(ids, waveVotes)
		sc := map[string]float64{}
		for _, id := range ids {
			c := g.st.Cards[id]
			r, in := planned[id]
			if v.current {
				sc[c.Author] += validatedPoints // avant la première impression : aucune pénalité, 1 par carte
				continue
			}
			if c.JuryVotes < v.minVotes && !bottom[id] {
				sc[c.Author] += validatedPoints // pas encore assez de classements
				continue
			}
			sc[c.Author] += v.value(r, in, bottom[id], false)
		}
		return sc
	}

	for night := 0; night < 7; night++ {
		for _, pid := range players {
			if rng.Float64() > 0.65 {
				continue
			}
			// Série : 5 cartes validées, jamais les siennes, les moins vues d'abord.
			var pool []string
			for _, id := range ids {
				if g.st.Cards[id].Author != pid {
					pool = append(pool, id)
				}
			}
			rng.Shuffle(len(pool), func(i, j int) { pool[i], pool[j] = pool[j], pool[i] })
			sort.SliceStable(pool, func(i, j int) bool { return shown[pool[i]] < shown[pool[j]] })
			series := pool[:ballotSize]
			taste := map[string]float64{}
			for _, id := range series {
				shown[id]++
				taste[id] = quality[id] + rng.NormFloat64()
			}
			sort.Slice(series, func(i, j int) bool { return taste[series[i]] > taste[series[j]] })
			for i, id := range series {
				c := g.st.Cards[id]
				pts := len(series) - 1 - 2*i
				c.JuryPts += pts
				c.JuryVotes++
				v := waveVotes[id]
				waveVotes[id] = [2]int{v[0] + pts, v[1] + 1}
			}
			rank := append([]string(nil), series...)
			g.st.Players[pid].Ballots[1] = append(g.st.Players[pid].Ballots[1], Ballot{Cards: rank, Rank: rank})
		}
		for vi, v := range variants {
			sc := scores(v)
			order := rankCreators(creators, sc)
			places := map[string]int{}
			for i, id := range order {
				places[id] = i + 1
			}
			nightRanks[vi] = append(nightRanks[vi], places)
			for i := 0; i+1 < min(4, len(order)); i++ {
				if sc[order[i]] == sc[order[i+1]] {
					out[vi].ties += 1.0 / 7
					break
				}
			}
		}
	}

	// Après l'impression : chaque barème avec ses cartes imprimées (rareté du plan).
	postTop := make([]map[string]bool, len(variants))
	{
		planned := map[string]Rarity{}
		for _, c := range g.plan(w) {
			if c.Rarity != "" {
				planned[c.Card.ID] = c.Rarity
			}
		}
		bottom := simBottom(ids, waveVotes)
		for vi, v := range variants {
			post := map[string]float64{}
			for _, id := range ids {
				r, in := planned[id]
				post[g.st.Cards[id].Author] += v.value(r, in, bottom[id] && !in || (v.penalty == 2 && bottom[id]), in)
			}
			postTop[vi] = map[string]bool{}
			for _, id := range rankCreators(creators, post)[:podiumSize] {
				postTop[vi][id] = true
			}
		}
	}

	meanQ := map[string]float64{}
	count := map[string]float64{}
	for _, id := range ids {
		a := g.st.Cards[id].Author
		meanQ[a] += quality[id]
		count[a]++
	}
	for a := range meanQ {
		meanQ[a] /= count[a]
	}
	for vi, v := range variants {
		sc := scores(v)
		order := rankCreators(creators, sc)
		r := &out[vi]
		for i, id := range order[:podiumSize] {
			if id == players[0] {
				r.spam3++
				if i == 0 {
					r.spam1++
				}
			}
			if id == players[1] {
				r.soigne3++
			}
			if id == players[2] {
				r.regulier3++
			}
			if postTop[vi][id] {
				r.keep += 1.0 / podiumSize
			}
		}
		r.rhoQual = spearman(creators, sc, meanQ)
		r.rhoCount = spearman(creators, sc, count)
		// Cartes bonus de lancement : 3 meilleurs soirs.
		bonus := func(pid string) float64 {
			var sizes []int
			for _, places := range nightRanks[vi] {
				if n := packSize(places[pid]); n > 0 {
					sizes = append(sizes, n)
				}
			}
			sort.Sort(sort.Reverse(sort.IntSlice(sizes)))
			total := allPackSize
			for i, n := range sizes {
				if i < maxNights {
					total += n
				}
			}
			return float64(total)
		}
		if p := nightRanks[vi][0][players[0]]; p > 0 && p <= podiumSize {
			r.spamNight1++
		}
		r.bonusSpam = bonus(players[0])
		r.bonusSoigne = bonus(players[1])
	}
	return out
}

// simBottom : comme juryBottom, avec les classements du jury de la vague (wv : points, classements).
func simBottom(ids []string, wv map[string][2]int) map[string]bool {
	type scored struct {
		id    string
		score float64
	}
	var cands []scored
	for _, id := range ids {
		v := wv[id]
		if v[1] >= penaltyMinVotes {
			cands = append(cands, scored{id, float64(v[0]) / float64(v[1]+2)})
		}
	}
	sort.Slice(cands, func(i, j int) bool {
		if cands[i].score != cands[j].score {
			return cands[i].score < cands[j].score
		}
		return cands[i].id < cands[j].id
	})
	out := map[string]bool{}
	for _, c := range cands[:len(cands)/4] {
		if c.score < 0 {
			out[c.id] = true
		}
	}
	return out
}

// rankCreators : créateurs du meilleur score au moins bon (ordre stable : identifiant).
func rankCreators(ids []string, sc map[string]float64) []string {
	out := append([]string(nil), ids...)
	sort.SliceStable(out, func(i, j int) bool {
		if sc[out[i]] != sc[out[j]] {
			return sc[out[i]] > sc[out[j]]
		}
		return out[i] < out[j]
	})
	return out
}

// spearman : corrélation des rangs (rangs moyens pour les ex æquo).
func spearman(ids []string, a, b map[string]float64) float64 {
	rk := func(m map[string]float64) map[string]float64 {
		s := append([]string(nil), ids...)
		sort.Slice(s, func(i, j int) bool { return m[s[i]] < m[s[j]] })
		r := map[string]float64{}
		for i := 0; i < len(s); {
			j := i
			for j+1 < len(s) && m[s[j+1]] == m[s[i]] {
				j++
			}
			for k := i; k <= j; k++ {
				r[s[k]] = float64(i+j)/2 + 1
			}
			i = j + 1
		}
		return r
	}
	ra, rb := rk(a), rk(b)
	var ma, mb float64
	for _, id := range ids {
		ma += ra[id]
		mb += rb[id]
	}
	n := float64(len(ids))
	ma /= n
	mb /= n
	var cov, va, vb float64
	for _, id := range ids {
		cov += (ra[id] - ma) * (rb[id] - mb)
		va += (ra[id] - ma) * (ra[id] - ma)
		vb += (rb[id] - mb) * (rb[id] - mb)
	}
	return cov / math.Sqrt(va*vb)
}

func simSizes() []int { return []int{150, 300} }
