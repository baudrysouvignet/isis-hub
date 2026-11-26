package tcg

import (
	"sort"
	"time"
)

// Classement des créateurs : le podium (3 premiers) et la place de chacun.
//
// Le score est calculé ici et ne sort jamais du serveur : le joueur ne voit que des places. Il
// récompense le nombre de cartes ET leur qualité : une carte compte selon sa rareté une fois
// imprimée (la rareté vient du jury : les cartes que la promo préfère deviennent les plus rares),
// si bien qu'une poignée de cartes légendaires pèse plus que beaucoup de cartes communes. Avant
// l'impression, une carte validée compte un peu, sans le score du jury : rien ne laisse deviner
// la rareté qu'elle aura.
//
// Les points ne font que monter, avec une seule exception : une carte validée que le jury de la
// vague en jeu (la dernière imprimée) a placée dans son dernier quart, et qui n'a donc pas été
// retenue, coûte juryPenalty. C'est ce qui empêche de grimper au podium en envoyant beaucoup de
// cartes sans soin (chaque carte validée rapporte 1). La pénalité se calcule vague par vague, avec
// les seuls classements du jury de cette vague : au jury suivant, la carte a une nouvelle chance.
// Une carte bloquée, retirée ou refusée par une personne sur la photo ne compte pas, ni en plus ni
// en moins.
var rarityPoints = map[Rarity]float64{Commune: 2, Rare: 5, Epique: 9, Legendaire: 15, Unique: 25}

const (
	validatedPoints = 1  // validée, pas encore imprimée
	juryPenalty     = -2 // validée, non retenue, dans le dernier quart du jury de la vague : -1 au total
	penaltyMinVotes = 3  // classements du jury qu'il faut au moins pour juger une carte
	podiumSize      = 3
)

// cardPoints : ce qu'une carte rapporte à son auteur. bottom : cartes du dernier quart du jury.
func cardPoints(c *Card, bottom map[string]bool) float64 {
	switch c.Status {
	case StatusPrinted:
		return rarityPoints[c.Rarity]
	case StatusAccepted, StatusConsent:
		if bottom[c.ID] {
			return validatedPoints + juryPenalty
		}
		return validatedPoints
	}
	return 0 // en attente, bloquée, retirée
}

// juryBottom : cartes validées non retenues que le jury de la vague en jeu (la dernière imprimée) a
// placées dans son dernier quart. Score de chaque carte : les seuls classements de ce jury (points
// de (n-1) à -(n-1) par série, comme Vote), tirés vers 0 comme juryScore ; au moins
// penaltyMinVotes classements, et un score négatif (la promo ne l'a vraiment pas aimée).
func (g *Game) juryBottom() map[string]bool {
	w := g.latestPrinted()
	if w == nil {
		return nil
	}
	pts, votes := map[string]int{}, map[string]int{}
	for _, p := range g.st.Players {
		for _, b := range p.Ballots[w.N] {
			for i, id := range b.Rank {
				pts[id] += len(b.Rank) - 1 - 2*i
				votes[id]++
			}
		}
	}
	type scored struct {
		id    string
		score float64
	}
	var cands []scored
	for id, n := range votes {
		c := g.st.Cards[id]
		if c == nil || (c.Status != StatusAccepted && c.Status != StatusConsent) || n < penaltyMinVotes {
			continue
		}
		cands = append(cands, scored{id, float64(pts[id]) / float64(n+2)})
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

// Leader : une place du podium.
type Leader struct {
	Pseudo   string `json:"pseudo"`
	Initials string `json:"initials"`
	Cards    int    `json:"cards"` // cartes en jeu (imprimées)
	Me       bool   `json:"me,omitempty"`
}

// Leaderboard : le podium, et ma place (0 : pas encore classé). Jamais de score.
type Leaderboard struct {
	Podium []Leader `json:"podium"`
	Rank   int      `json:"rank,omitempty"`
	Total  int      `json:"total"` // créateurs classés
}

type creator struct {
	id      string
	score   float64
	printed int       // cartes en jeu
	valid   int       // cartes validées (en jeu comprises)
	first   time.Time // première carte validée (départage : le plus ancien d'abord)
}

// validatedAt : première validation d'une carte (Decided pour un fichier d'avant Card.Validated).
func validatedAt(c *Card) time.Time {
	if !c.Validated.IsZero() {
		return c.Validated
	}
	return c.Decided
}

// ranking : créateurs classés, du premier au dernier.
func (g *Game) ranking() []creator {
	bottom := g.juryBottom()
	return g.rank(func(c *Card) (float64, bool) {
		switch c.Status {
		case StatusPrinted, StatusAccepted, StatusConsent:
			return cardPoints(c, bottom), true
		}
		return 0, false
	})
}

// rankingAt : le classement tel qu'il s'affichait à l'instant cut, avant la première impression
// (récompenses de lancement, rewards.go) : chaque carte validée avant cut vaut validatedPoints.
// Une carte bloquée depuis ne compte plus (on ne sait plus quand elle avait été validée, et elle
// ne mérite pas de récompense).
func (g *Game) rankingAt(cut time.Time) []creator {
	return g.rank(func(c *Card) (float64, bool) {
		switch c.Status {
		case StatusPrinted, StatusAccepted, StatusConsent:
			if v := validatedAt(c); !v.IsZero() && !v.After(cut) {
				return validatedPoints, true
			}
		}
		return 0, false
	})
}

// rank : créateurs classés selon points(c) (et si la carte compte comme validée). Seuls comptent
// ceux qui ont au moins une carte validée et un score positif, et dont les propositions ne sont pas
// suspendues. Départage : plus de cartes validées, puis la première validée le plus tôt.
func (g *Game) rank(points func(c *Card) (float64, bool)) []creator {
	by := map[string]*creator{}
	for _, c := range g.st.Cards {
		p := g.st.Players[c.Author]
		if p == nil || p.Muted {
			continue
		}
		pts, valid := points(c)
		if !valid {
			continue
		}
		cr := by[p.ID]
		if cr == nil {
			cr = &creator{id: p.ID}
			by[p.ID] = cr
		}
		cr.score += pts
		cr.valid++
		if c.Status == StatusPrinted {
			cr.printed++
		}
		if v := validatedAt(c); !v.IsZero() && (cr.first.IsZero() || v.Before(cr.first)) {
			cr.first = v
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
	return out
}

// leaderboard : le podium et la place du joueur pid.
func (g *Game) leaderboard(pid string) Leaderboard {
	r := g.ranking()
	lb := Leaderboard{Podium: []Leader{}, Total: len(r)}
	for i, cr := range r {
		if i < podiumSize {
			p := g.st.Players[cr.id]
			lb.Podium = append(lb.Podium, Leader{Pseudo: p.Pseudo, Initials: Initials(p.Pseudo), Cards: cr.printed, Me: cr.id == pid})
		}
		if cr.id == pid {
			lb.Rank = i + 1
		}
	}
	return lb
}
