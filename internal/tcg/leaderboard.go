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
// la rareté qu'elle aura. Les cartes bloquées par la modération, ou retirées après signalements,
// font perdre des points ; celles qu'une personne sur la photo a refusées ne comptent pas.
var rarityPoints = map[Rarity]float64{Commune: 2, Rare: 5, Epique: 9, Legendaire: 15, Unique: 25}

const (
	validatedPoints = 1  // validée, pas encore imprimée
	blockedPoints   = -1 // bloquée par la modération
	removedPoints   = -3 // retirée du jeu après signalements
	podiumSize      = 3
)

// cardPoints : ce qu'une carte rapporte à son auteur.
func cardPoints(c *Card) float64 {
	if c.Reason == "personne" && (c.Status == StatusBlocked || c.Status == StatusRemoved) {
		return 0 // refusée par une personne sur la photo : ni bonus, ni malus
	}
	switch c.Status {
	case StatusPrinted:
		return rarityPoints[c.Rarity]
	case StatusAccepted, StatusConsent:
		return validatedPoints
	case StatusBlocked:
		return blockedPoints
	case StatusRemoved:
		return removedPoints
	}
	return 0 // en attente de validation
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

// ranking : créateurs classés, du premier au dernier. Seuls comptent ceux qui ont au moins une
// carte validée et un score positif, et dont les propositions ne sont pas suspendues.
func (g *Game) ranking() []creator {
	by := map[string]*creator{}
	for _, c := range g.st.Cards {
		p := g.st.Players[c.Author]
		if p == nil || p.Muted {
			continue
		}
		cr := by[p.ID]
		if cr == nil {
			cr = &creator{id: p.ID}
			by[p.ID] = cr
		}
		cr.score += cardPoints(c)
		switch c.Status {
		case StatusPrinted:
			cr.printed++
			fallthrough
		case StatusAccepted, StatusConsent:
			cr.valid++
			if !c.Decided.IsZero() && (cr.first.IsZero() || c.Decided.Before(cr.first)) {
				cr.first = c.Decided
			}
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
