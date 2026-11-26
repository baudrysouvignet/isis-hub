package tcg

import (
	"maps"
	"sort"
	"time"
)

// Classement des créateurs : le podium et la place de chacun.
//
// Le score est calculé ici et ne sort jamais du serveur : le joueur ne voit que des places. Il
// récompense le nombre de cartes ET leur qualité, et la qualité vient du jury : les cartes que la
// promo préfère deviennent les plus rares à l'impression. Une carte vaut donc selon sa rareté :
//
//   - imprimée : sa rareté (rarityPoints) ;
//   - validée, pas encore imprimée : la rareté qu'elle aurait si la prochaine vague s'imprimait
//     maintenant (l'aperçu de l'impression, planCards), dès minPlanVotes classements au jury ;
//     avant, ou si elle n'est pas retenue (au-delà de la taille de la vague), validatedPoints. Le
//     podium d'avant l'impression est ainsi celui d'après (dès que chaque carte a ses
//     minPlanVotes classements) : l'impression ne crée pas de surprise ;
//   - commune ou non retenue, et placée par le jury de sa vague dans son dernier quart (au moins
//     penaltyMinVotes classements, score négatif) : validatedPoints + juryPenalty, soit -1. C'est ce
//     qui empêche de grimper au podium avec beaucoup de cartes sans soin.
//
// Une carte en attente, bloquée, retirée ou refusée par une personne sur la photo ne compte pas.
// Ex æquo : même score, même place (1er, 1er, 3e…), au podium comme pour les récompenses de
// lancement. Équilibrage : score_sim_test.go (TCG_SIM=1).
var rarityPoints = map[Rarity]float64{Commune: 1, Rare: 5, Epique: 9, Legendaire: 15, Unique: 25}

const (
	validatedPoints = 1  // validée : pas encore assez classée, pas retenue, ou aucune vague prévue
	juryPenalty     = -2 // commune ou non retenue, dans le dernier quart du jury de sa vague : -1 au total
	penaltyMinVotes = 3  // classements du jury qu'il faut au moins pour juger une carte
	minPlanVotes    = 2  // classements du jury qu'il faut pour compter selon la rareté prévue
	podiumSize      = 3
)

// cardValue : ce que vaut une carte au classement, et pourquoi (détail des scores).
type cardValue struct {
	points  float64
	printed bool
	rarity  Rarity // imprimée, ou prévue par l'aperçu (planned)
	planned bool   // rareté prévue par l'aperçu de la prochaine vague
	out     bool   // dans l'aperçu, mais pas retenue (au-delà de la taille de la vague, ou écartée)
	few     bool   // rareté prévue, mais moins de minPlanVotes classements : compte validatedPoints
	penalty bool   // dernier quart du jury de sa vague
	wave    int    // vague : celle où elle est imprimée, ou celle de l'aperçu
	place   int    // place dans l'aperçu (de la plus attendue à la moins attendue)
}

// valuation : la valeur de chaque carte qui compte (validée ou imprimée). Maintenant (cut zéro), ou
// telle qu'elle était à l'instant cut : cartes validées avant cut, classements du jury faits avant
// cut, vagues imprimées avant cut (classement à minuit des récompenses de lancement). judge : vague
// dont le jury juge les cartes pas encore imprimées ; next : vague de l'aperçu (0 : aucune).
func (g *Game) valuation(cut time.Time) (vals map[string]cardValue, next, judge int) {
	live := cut.IsZero()
	waveAt := func(w *Wave) bool { // imprimée à l'instant du calcul
		return w.Printed && (live || (!w.PrintedAt.IsZero() && !w.PrintedAt.After(cut)))
	}
	printedWave := map[int]bool{}
	var nextW, last *Wave
	for _, w := range g.st.Waves {
		if waveAt(w) {
			printedWave[w.N] = true
			if last == nil || w.N > last.N {
				last = w
			}
		} else if nextW == nil || w.N < nextW.N {
			nextW = w
		}
	}
	isPrinted := func(c *Card) bool { return c.Status == StatusPrinted && (live || printedWave[c.Wave]) }

	counts := map[string]*Card{}
	for id, c := range g.st.Cards {
		switch c.Status {
		case StatusPrinted, StatusAccepted, StatusConsent:
		default:
			continue
		}
		if !live {
			if v := validatedAt(c); v.IsZero() || v.After(cut) {
				continue
			}
		}
		counts[id] = c
	}

	// Classements du jury faits avant l'instant du calcul : par vague (dernier quart) et en tout.
	type tally struct{ pts, n int }
	byWave := map[int]map[string]*tally{}
	total := map[string]*tally{}
	for _, p := range g.st.Players {
		for wn, bs := range p.Ballots {
			for _, b := range bs {
				if len(b.Rank) == 0 || (!live && (b.At.IsZero() || b.At.After(cut))) {
					continue
				}
				if byWave[wn] == nil {
					byWave[wn] = map[string]*tally{}
				}
				for i, id := range b.Rank {
					pts := len(b.Rank) - 1 - 2*i
					for _, m := range []map[string]*tally{byWave[wn], total} {
						t := m[id]
						if t == nil {
							t = &tally{}
							m[id] = t
						}
						t.pts += pts
						t.n++
					}
				}
			}
		}
	}
	votes := func(c *Card) (int, int) {
		if live {
			return c.JuryPts, c.JuryVotes // ceux de l'impression
		}
		if t := total[c.ID]; t != nil {
			return t.pts, t.n
		}
		return 0, 0
	}

	// Dernier quart du jury d'une vague, parmi les cartes qui comptent et qu'il a assez classées
	// (points de (n-1) à -(n-1) par série, tirés vers 0 comme juryScore), au score négatif.
	bottoms := map[int]map[string]bool{}
	bottom := func(wn int) map[string]bool {
		if b, ok := bottoms[wn]; ok {
			return b
		}
		type scored struct {
			id    string
			score float64
		}
		var cands []scored
		for id, t := range byWave[wn] {
			if counts[id] != nil && t.n >= penaltyMinVotes {
				cands = append(cands, scored{id, float64(t.pts) / float64(t.n+2)})
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
		bottoms[wn] = out
		return out
	}

	// Les cartes pas encore imprimées sont jugées par le jury de la prochaine vague dès qu'il a
	// classé des cartes, sinon par celui de la dernière vague imprimée (en attendant le suivant).
	if nextW != nil {
		next = nextW.N
		if len(byWave[next]) > 0 {
			judge = next
		}
	}
	if judge == 0 && last != nil {
		judge = last.N
	}
	inPlan := map[string]Candidate{}
	place := map[string]int{}
	if nextW != nil {
		var pool []*Card
		for _, c := range counts {
			if !isPrinted(c) && c.Status != StatusConsent {
				pool = append(pool, c) // validée (imprimée plus tard que l'instant du calcul : validée alors)
			}
		}
		for i, cand := range planCards(nextW, pool, votes) {
			inPlan[cand.Card.ID] = cand
			place[cand.Card.ID] = i + 1
		}
	}

	vals = make(map[string]cardValue, len(counts))
	for id, c := range counts {
		if isPrinted(c) {
			v := cardValue{points: rarityPoints[c.Rarity], printed: true, rarity: c.Rarity, wave: c.Wave}
			if c.Rarity == Commune && bottom(c.Wave)[id] {
				v.points, v.penalty = validatedPoints+juryPenalty, true
			}
			vals[id] = v
			continue
		}
		v := cardValue{points: validatedPoints}
		if cand, ok := inPlan[id]; ok {
			v.wave, v.place = next, place[id]
			if cand.Rarity == "" {
				v.out = true
			} else {
				v.planned, v.rarity = true, cand.Rarity
				if _, n := votes(c); n < minPlanVotes {
					v.few = true
				} else {
					v.points = rarityPoints[cand.Rarity]
				}
			}
		}
		if judge > 0 && (!v.planned || v.rarity == Commune) && bottom(judge)[id] {
			v.points, v.penalty = validatedPoints+juryPenalty, true
		}
		vals[id] = v
	}
	return vals, next, judge
}

// Leader : un créateur du podium (place 1 à 3 ; plusieurs sur la même marche s'ils sont ex æquo).
type Leader struct {
	Pseudo   string `json:"pseudo"`
	Initials string `json:"initials"`
	Place    int    `json:"place"`
	Cards    int    `json:"cards"` // cartes en jeu (imprimées)
	Me       bool   `json:"me,omitempty"`
}

// Leaderboard : le podium, et ma place (0 : pas encore classé). Jamais de score.
type Leaderboard struct {
	Podium []Leader `json:"podium"`
	Rank   int      `json:"rank,omitempty"`
	Tied   bool     `json:"tied,omitempty"` // ma place est partagée (ex æquo)
	Total  int      `json:"total"`          // créateurs classés
}

type creator struct {
	id      string
	score   float64
	place   int       // 1 + créateurs au score strictement meilleur (ex æquo : même place)
	printed int       // cartes en jeu
	valid   int       // cartes validées (en jeu comprises)
	first   time.Time // première carte validée (ordre d'affichage des ex æquo : le plus ancien d'abord)
}

// validatedAt : première validation d'une carte (Decided pour un fichier d'avant Card.Validated).
func validatedAt(c *Card) time.Time {
	if !c.Validated.IsZero() {
		return c.Validated
	}
	return c.Decided
}

// ranking : créateurs classés, du premier au dernier, maintenant.
func (g *Game) ranking() []creator {
	vals, _, _ := g.valuation(time.Time{})
	return g.rank(vals)
}

// rankingAt : le classement tel qu'il était à l'instant cut (récompenses de lancement, rewards.go).
// Une carte bloquée depuis ne compte plus (elle ne mérite pas de récompense).
func (g *Game) rankingAt(cut time.Time) []creator {
	vals, _, _ := g.valuation(cut)
	return g.rank(vals)
}

// rank : créateurs classés selon la valeur de leurs cartes. Seuls comptent ceux qui ont au moins
// une carte validée et un score positif, et dont les propositions ne sont pas suspendues. Même
// score, même place ; l'ordre d'affichage des ex æquo : plus de cartes validées, puis la première
// validée le plus tôt.
func (g *Game) rank(vals map[string]cardValue) []creator {
	by := map[string]*creator{}
	for id, v := range vals {
		c := g.st.Cards[id]
		p := g.st.Players[c.Author]
		if p == nil || p.Muted {
			continue
		}
		cr := by[p.ID]
		if cr == nil {
			cr = &creator{id: p.ID}
			by[p.ID] = cr
		}
		cr.score += v.points
		cr.valid++
		if v.printed {
			cr.printed++
		}
		if t := validatedAt(c); !t.IsZero() && (cr.first.IsZero() || t.Before(cr.first)) {
			cr.first = t
		}
	}
	out := make([]creator, 0, len(by))
	for _, cr := range by {
		if cr.valid > 0 && cr.score > 0 {
			out = append(out, *cr)
		}
	}
	sort.Slice(out, func(i, j int) bool {
		a, b := out[i], out[j]
		if a.score != b.score {
			return a.score > b.score
		}
		if a.valid != b.valid {
			return a.valid > b.valid
		}
		if !a.first.Equal(b.first) {
			return a.first.Before(b.first)
		}
		return a.id < b.id
	})
	for i := range out {
		if i > 0 && out[i].score == out[i-1].score {
			out[i].place = out[i-1].place
		} else {
			out[i].place = i + 1
		}
	}
	return out
}

// podiumMax : créateurs affichés au podium au plus (beaucoup d'ex æquo au tout début).
const podiumMax = 12

// leaderboard : le podium (places 1 à 3, ex æquo compris) et la place du joueur pid.
func (g *Game) leaderboard(pid string) Leaderboard {
	r := g.ranking()
	lb := Leaderboard{Podium: []Leader{}, Total: len(r)}
	same := map[int]int{}
	for _, cr := range r {
		same[cr.place]++
	}
	for _, cr := range r {
		if cr.place <= podiumSize && len(lb.Podium) < podiumMax {
			p := g.st.Players[cr.id]
			lb.Podium = append(lb.Podium, Leader{Pseudo: p.Pseudo, Initials: Initials(p.Pseudo), Place: cr.place, Cards: cr.printed, Me: cr.id == pid})
		}
		if cr.id == pid {
			lb.Rank, lb.Tied = cr.place, same[cr.place] > 1
		}
	}
	return lb
}

// ------------------------------------------------------------ détail des scores (administration)

// ScoreCard : une carte d'un créateur et ce qu'elle rapporte au classement (valuation).
type ScoreCard struct {
	Title   string  `json:"title"`
	Status  string  `json:"status"`
	Rarity  Rarity  `json:"rarity,omitempty"`  // imprimée, ou prévue (Planned)
	Planned bool    `json:"planned,omitempty"` // rareté prévue par l'aperçu de la prochaine vague
	Few     bool    `json:"few,omitempty"`     // rareté prévue, pas encore assez de classements
	Out     bool    `json:"out,omitempty"`     // dans l'aperçu, pas retenue
	Place   int     `json:"place,omitempty"`   // place dans l'aperçu
	Votes   int     `json:"votes"`             // classements au jury (en tout)
	Wave    int     `json:"wave,omitempty"`
	Points  float64 `json:"points"`
	Penalty bool    `json:"penalty,omitempty"` // dernier quart du jury de sa vague
}

// ScoreRow : un créateur, sa place (0 : hors classement ; ex æquo : même place) et ses cartes, de
// celle qui rapporte le plus à celle qui rapporte le moins.
type ScoreRow struct {
	Pseudo string      `json:"pseudo"`
	Rank   int         `json:"rank,omitempty"`
	Tied   bool        `json:"tied,omitempty"` // un autre créateur a la même place
	Score  float64     `json:"score"`
	Muted  bool        `json:"muted,omitempty"`
	Cards  []ScoreCard `json:"cards"`
}

// ScoresAdmin : pour l'administration seulement, le détail du classement des créateurs (qui a
// combien de points, et grâce à quelles cartes), avec le barème. Les joueurs, eux, ne voient
// jamais un score : seulement le podium et leur place.
type ScoresAdmin struct {
	Rows      []ScoreRow         `json:"rows"`
	Rarity    map[Rarity]float64 `json:"rarity"`    // carte en jeu, ou retenue selon sa rareté prévue
	Validated float64            `json:"validated"` // validée sans rareté qui compte
	Penalty   float64            `json:"penalty"`   // en plus, dernier quart du jury
	MinVotes  int                `json:"minVotes"`  // classements pour juger une carte (pénalité)
	PlanVotes int                `json:"planVotes"` // classements pour compter selon la rareté prévue
	NextWave  int                `json:"nextWave,omitempty"`
	NextSize  int                `json:"nextSize,omitempty"` // cartes retenues au plus
	JudgeWave int                `json:"penaltyWave,omitempty"`
	Podium    int                `json:"podium"`
}

// AdminScores : tous les créateurs (au moins une carte proposée), les classés d'abord, dans
// l'ordre du podium. Points et places viennent de valuation et rank, comme pour les joueurs.
func (g *Game) AdminScores() ScoresAdmin {
	g.mu.Lock()
	defer g.mu.Unlock()
	vals, next, judge := g.valuation(time.Time{})
	out := ScoresAdmin{Rows: []ScoreRow{}, Rarity: maps.Clone(rarityPoints), Validated: validatedPoints, Penalty: juryPenalty, MinVotes: penaltyMinVotes, PlanVotes: minPlanVotes, NextWave: next, JudgeWave: judge, Podium: podiumSize}
	if w := g.wave(next); w != nil {
		out.NextSize = w.Size
	}
	ranked := g.rank(vals)
	place, order, sameCount := map[string]int{}, map[string]int{}, map[int]int{}
	for i, cr := range ranked {
		place[cr.id], order[cr.id] = cr.place, i
		sameCount[cr.place]++
	}
	by := map[string]*ScoreRow{}
	for _, c := range g.st.Cards {
		p := g.st.Players[c.Author]
		if p == nil {
			continue
		}
		row := by[p.ID]
		if row == nil {
			row = &ScoreRow{Pseudo: p.Pseudo, Rank: place[p.ID], Tied: place[p.ID] > 0 && sameCount[place[p.ID]] > 1, Muted: p.Muted, Cards: []ScoreCard{}}
			by[p.ID] = row
		}
		v := vals[c.ID] // zéro : en attente, bloquée, retirée
		sc := ScoreCard{Title: c.Title, Status: c.Status, Votes: c.JuryVotes, Points: v.points, Penalty: v.penalty, Wave: v.wave, Place: v.place, Planned: v.planned, Few: v.few, Out: v.out}
		if v.printed || v.planned {
			sc.Rarity = v.rarity
		}
		row.Score += sc.Points
		row.Cards = append(row.Cards, sc)
	}
	ids := make([]string, 0, len(by))
	for id, row := range by {
		sort.SliceStable(row.Cards, func(i, j int) bool {
			a, b := row.Cards[i], row.Cards[j]
			if a.Points != b.Points {
				return a.Points > b.Points
			}
			return a.Title < b.Title
		})
		ids = append(ids, id)
	}
	sort.Slice(ids, func(i, j int) bool {
		a, b := by[ids[i]], by[ids[j]]
		if (a.Rank > 0) != (b.Rank > 0) {
			return a.Rank > 0
		}
		if a.Rank > 0 {
			return order[ids[i]] < order[ids[j]]
		}
		if a.Score != b.Score {
			return a.Score > b.Score
		}
		return a.Pseudo < b.Pseudo
	})
	for _, id := range ids {
		out.Rows = append(out.Rows, *by[id])
	}
	return out
}
