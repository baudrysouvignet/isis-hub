package tcg

import (
	"maps"
	"math"
	"net/http"
	"sort"
	"strings"
	"time"
)

// WaveInput : calendrier d'une vague, saisi dans l'administration.
type WaveInput struct {
	N              int       `json:"n"` // 0 = nouvelle vague
	ProposalsUntil time.Time `json:"proposalsUntil"`
	JuryFrom       time.Time `json:"juryFrom"`
	JuryUntil      time.Time `json:"juryUntil"`
	ReleaseAt      time.Time `json:"releaseAt"`
	Size           int       `json:"size"`
	PerDay         int       `json:"perDay"` // 0 = réglage de la saison (vague 1 : 10 par défaut)
}

func (in WaveInput) check() error {
	switch {
	case in.ReleaseAt.IsZero():
		return userErr(http.StatusBadRequest, "Date de sortie manquante.")
	case in.PerDay < 0 || in.PerDay > 20:
		return userErr(http.StatusBadRequest, "Propositions par jour : de 1 à 20 (0 = réglage de la saison).")
	case in.Size < 3 || in.Size > 200:
		return userErr(http.StatusBadRequest, "Une vague compte de 3 à 200 cartes.")
	case !in.JuryFrom.IsZero() && !in.JuryUntil.After(in.JuryFrom):
		return userErr(http.StatusBadRequest, "Le jury doit finir après avoir commencé.")
	case !in.JuryUntil.IsZero() && in.JuryUntil.After(in.ReleaseAt):
		return userErr(http.StatusBadRequest, "Le jury doit finir avant la sortie de la vague.")
	case !in.ProposalsUntil.IsZero() && in.ProposalsUntil.After(in.ReleaseAt):
		return userErr(http.StatusBadRequest, "Les propositions doivent finir avant la sortie.")
	}
	return nil
}

// SaveWave crée ou modifie une vague pas encore imprimée.
func (g *Game) SaveWave(in WaveInput) (*Wave, error) {
	if err := in.check(); err != nil {
		return nil, err
	}
	g.mu.Lock()
	defer g.mu.Unlock()
	var w *Wave
	if in.N == 0 {
		n := 1
		for _, x := range g.st.Waves {
			if x.N >= n {
				n = x.N + 1
			}
		}
		w = &Wave{N: n}
		g.st.Waves = append(g.st.Waves, w)
	} else if w = g.wave(in.N); w == nil {
		return nil, ErrNotFound
	}
	if w.Printed {
		return nil, userErr(http.StatusConflict, "Cette vague est déjà imprimée.")
	}
	if in.N == 0 {
		// La vague précédente doit sortir avant celle-ci.
		for _, x := range g.st.Waves {
			if x != w && !x.Printed && !x.ReleaseAt.Before(in.ReleaseAt) {
				g.st.Waves = g.st.Waves[:len(g.st.Waves)-1]
				return nil, userErr(http.StatusBadRequest, "La vague %d sort après cette date.", x.N)
			}
		}
	}
	w.ProposalsUntil, w.JuryFrom, w.JuryUntil, w.ReleaseAt, w.Size, w.PerDay = in.ProposalsUntil, in.JuryFrom, in.JuryUntil, in.ReleaseAt, in.Size, in.PerDay
	sortWaves(g.st.Waves)
	g.dirty = true
	cp := *w
	return &cp, nil
}

// DeleteWave supprime une vague pas encore imprimée (les votes de son jury sont oubliés).
func (g *Game) DeleteWave(n int) error {
	g.mu.Lock()
	defer g.mu.Unlock()
	for i, w := range g.st.Waves {
		if w.N != n {
			continue
		}
		if w.Printed {
			return userErr(http.StatusConflict, "Une vague imprimée ne se supprime pas.")
		}
		g.st.Waves = append(g.st.Waves[:i], g.st.Waves[i+1:]...)
		for _, p := range g.st.Players {
			delete(p.Ballots, n)
		}
		g.dirty = true
		return nil
	}
	return ErrNotFound
}

// SetOverride : rareté choisie par l'administrateur pour une carte candidate ("" = automatique).
func (g *Game) SetOverride(n int, card string, r Rarity) error {
	g.mu.Lock()
	defer g.mu.Unlock()
	w := g.wave(n)
	c := g.st.Cards[card]
	if w == nil || c == nil {
		return ErrNotFound
	}
	if w.Printed {
		return userErr(http.StatusConflict, "Cette vague est déjà imprimée.")
	}
	if r != "" && r != "out" && !r.valid() {
		return ErrInvalid
	}
	if w.Overrides == nil {
		w.Overrides = map[string]Rarity{}
	}
	if r == "" {
		delete(w.Overrides, card)
	} else {
		w.Overrides[card] = r
	}
	g.dirty = true
	return nil
}

// mixFor : nombre de cartes par rareté pour une vague de n cartes (47 → 1 unique, 2 légendaires,
// 5 épiques, 10 rares, 29 communes).
func mixFor(n int) map[Rarity]int {
	round := func(f float64) int { return int(math.Round(f)) }
	m := map[Rarity]int{}
	if n >= 8 {
		m[Unique] = 1
	}
	m[Legendaire] = round(float64(n) * 0.05)
	if n >= 5 && m[Legendaire] < 1 {
		m[Legendaire] = 1
	}
	m[Epique] = round(float64(n) * 0.11)
	m[Rare] = round(float64(n) * 0.21)
	rest := n - m[Unique] - m[Legendaire] - m[Epique] - m[Rare]
	for rest < 0 {
		for _, r := range []Rarity{Rare, Epique, Legendaire, Unique} {
			if rest < 0 && m[r] > 0 {
				m[r]--
				rest++
			}
		}
	}
	m[Commune] = rest
	return m
}

// rarer : raretés réglables à l'impression, de la plus rare à la moins rare (communes : le reste).
var rarer = []Rarity{Unique, Legendaire, Epique, Rare}

// waveMix : cartes par rareté pour une vague de n cartes retenues. Choix de l'administrateur s'il
// y en a un (dans l'ordre unique → rare, les communes complètent), sinon la répartition automatique.
func waveMix(w *Wave, n int) map[Rarity]int {
	if len(w.Mix) == 0 {
		return mixFor(n)
	}
	m := map[Rarity]int{}
	left := n
	for _, r := range rarer {
		k := min(max(w.Mix[r], 0), left)
		m[r] = k
		left -= k
	}
	m[Commune] = left
	return m
}

// runOf : exemplaires numérotés d'une carte de cette rareté dans la vague (0 = commune, illimitée).
func (g *Game) runOf(w *Wave, r Rarity) int {
	switch {
	case r == Commune:
		return 0
	case r == Unique:
		return 1
	case w.Runs[r] > 0:
		return w.Runs[r]
	}
	return g.st.Season.Runs[r]
}

// SetMix : quantités de la vague, réglables jusqu'à l'impression. size : cartes au plus (0 = sans
// changement) ; mix : cartes par rareté (nil = automatique) ; runs : exemplaires par carte (nil =
// ceux de la saison). Une unique reste à 1 exemplaire, une commune illimitée.
func (g *Game) SetMix(n, size int, mix, runs map[Rarity]int) error {
	g.mu.Lock()
	defer g.mu.Unlock()
	w := g.wave(n)
	if w == nil {
		return ErrNotFound
	}
	if w.Printed {
		return userErr(http.StatusConflict, "Cette vague est déjà imprimée.")
	}
	if size != 0 && (size < 3 || size > 200) {
		return userErr(http.StatusBadRequest, "Une vague compte de 3 à 200 cartes.")
	}
	if size == 0 {
		size = w.Size
	}
	var cm map[Rarity]int
	if mix != nil {
		cm = map[Rarity]int{}
		total := 0
		for _, r := range rarer {
			k := mix[r]
			if k < 0 || k > 200 {
				return userErr(http.StatusBadRequest, "De 0 à 200 cartes par rareté.")
			}
			cm[r] = k // les zéros sont gardés : « aucune » n'est pas « automatique »
			total += k
		}
		if total > size {
			return userErr(http.StatusBadRequest, "%d cartes rares ou plus, pour une vague de %d cartes : augmente la taille de la vague.", total, size)
		}
	}
	var cr map[Rarity]int
	for _, r := range []Rarity{Legendaire, Epique, Rare} {
		k, ok := runs[r]
		if !ok {
			continue
		}
		if k < 1 || k > 500 {
			return userErr(http.StatusBadRequest, "De 1 à 500 exemplaires par carte.")
		}
		if cr == nil {
			cr = map[Rarity]int{}
		}
		cr[r] = k
	}
	w.Size, w.Mix, w.Runs = size, cm, cr
	g.dirty = true
	return nil
}

// Candidate : carte candidate d'une vague, avec la rareté qu'elle aurait à l'impression.
type Candidate struct {
	Card     *Card
	Score    float64
	Rarity   Rarity // "" = pas retenue
	Override bool
}

// plan : cartes retenues pour la vague et leur rareté, de la plus attendue à la moins attendue.
// Les plus attendues par le jury deviennent les plus rares ; l'administrateur peut forcer une
// rareté (ou « out » : écartée).
func (g *Game) plan(w *Wave) []Candidate {
	var pool []*Card
	for _, c := range g.st.Cards {
		if c.Status == StatusAccepted {
			pool = append(pool, c)
		}
	}
	return planCards(w, pool, func(c *Card) (int, int) { return c.JuryPts, c.JuryVotes })
}

// planCards : l'aperçu de l'impression pour ces cartes, votes(c) donnant les points et le nombre de
// classements du jury de chacune (ceux de la carte, ou ceux d'un instant passé pour le classement
// à minuit, leaderboard.go). Même tri, mêmes raretés que l'impression.
func planCards(w *Wave, pool []*Card, votes func(c *Card) (pts, n int)) []Candidate {
	cands := make([]Candidate, 0, len(pool))
	ranked := map[string]int{}
	for _, c := range pool {
		pts, k := votes(c)
		ranked[c.ID] = k
		cands = append(cands, Candidate{Card: c, Score: float64(pts) / float64(k+2)})
	}
	sort.SliceStable(cands, func(i, j int) bool {
		a, b := cands[i], cands[j]
		if a.Score != b.Score {
			return a.Score > b.Score
		}
		if ranked[a.Card.ID] != ranked[b.Card.ID] {
			return ranked[a.Card.ID] > ranked[b.Card.ID]
		}
		return a.Card.Num < b.Card.Num
	})
	// Écartées et forcées d'abord.
	forced := 0
	for i := range cands {
		if r, ok := w.Overrides[cands[i].Card.ID]; ok {
			cands[i].Override = true
			if r != "out" {
				cands[i].Rarity = r
				forced++
			}
		}
	}
	n := 0
	for _, c := range cands {
		if !c.Override || c.Rarity != "" {
			n++
		}
	}
	if n > w.Size {
		n = w.Size
	}
	mix := waveMix(w, n)
	for _, c := range cands {
		if c.Override && c.Rarity != "" {
			mix[c.Rarity]--
		}
	}
	free := n - forced
	order := []Rarity{Unique, Legendaire, Epique, Rare, Commune}
	k := 0
	for i := range cands {
		if cands[i].Override || free <= 0 {
			continue
		}
		for k < len(order) && mix[order[k]] <= 0 {
			k++
		}
		r := Commune
		if k < len(order) {
			r = order[k]
			mix[r]--
		}
		cands[i].Rarity = r
		free--
	}
	return cands
}

// Preview : ce que donnerait l'impression de la vague maintenant.
func (g *Game) Preview(n int) ([]Candidate, *Wave, error) {
	g.mu.Lock()
	defer g.mu.Unlock()
	w := g.wave(n)
	if w == nil {
		return nil, nil, ErrNotFound
	}
	cands := g.plan(w)
	out := make([]Candidate, len(cands))
	for i, c := range cands {
		cp := *c.Card
		out[i] = Candidate{Card: &cp, Score: c.Score, Rarity: c.Rarity, Override: c.Override}
	}
	cw := *w
	cw.Mix, cw.Runs, cw.Overrides = maps.Clone(w.Mix), maps.Clone(w.Runs), nil
	return out, &cw, nil
}

// PrintNow imprime la vague tout de suite (sans attendre sa date de sortie).
func (g *Game) PrintNow(n int) error {
	g.mu.Lock()
	defer g.mu.Unlock()
	w := g.wave(n)
	if w == nil {
		return ErrNotFound
	}
	if w.Printed {
		return userErr(http.StatusConflict, "Cette vague est déjà imprimée.")
	}
	for _, x := range g.st.Waves {
		if x.N < n && !x.Printed {
			return userErr(http.StatusConflict, "Imprime d’abord la vague %d.", x.N)
		}
	}
	if !g.printWave(w, g.now()) {
		return userErr(http.StatusConflict, "Aucune carte validée à imprimer.")
	}
	return nil
}

// printWave : impression (verrou tenu). Numérotation : communes, puis rares… l'unique en dernier.
func (g *Game) printWave(w *Wave, now time.Time) bool {
	var picked []*Card
	for _, c := range g.plan(w) {
		if c.Rarity != "" {
			c.Card.Rarity = c.Rarity
			picked = append(picked, c.Card)
		}
	}
	if len(picked) == 0 {
		// Rien à imprimer : la sortie est repoussée d'un jour plutôt que de sortir une vague vide.
		w.ReleaseAt = now.Add(24 * time.Hour)
		g.dirty = true
		return false
	}
	sort.SliceStable(picked, func(i, j int) bool {
		a, b := picked[i], picked[j]
		if a.Rarity.tier() != b.Rarity.tier() {
			return a.Rarity.tier() < b.Rarity.tier()
		}
		return strings.ToLower(a.Title) < strings.ToLower(b.Title)
	})
	first := true // première vague imprimée : récompenses de lancement
	for _, x := range g.st.Waves {
		if x.Printed {
			first = false
		}
	}
	w.Cards = w.Cards[:0]
	for i, c := range picked {
		c.Status = StatusPrinted
		c.Wave = w.N
		c.No = i + 1
		c.Run = g.runOf(w, c.Rarity)
		c.Decided = now
		w.Cards = append(w.Cards, c.ID)
	}
	w.Printed = true
	w.PrintedAt = now
	if w.ReleaseAt.After(now) {
		w.ReleaseAt = now
	}
	w.Overrides = nil
	g.dirty = true
	if first {
		g.grantLaunch(w, now)
	}
	if g.st.Season.AutoWeekly {
		g.scheduleNext(w)
	}
	return true
}

// scheduleNext : vague suivante une semaine plus tard (jury du lundi au dimanche 20 h), si aucune
// n'est déjà prévue.
func (g *Game) scheduleNext(w *Wave) {
	for _, x := range g.st.Waves {
		if !x.Printed {
			return
		}
	}
	rel := w.ReleaseAt.In(Paris)
	next := time.Date(rel.Year(), rel.Month(), rel.Day()+7, rel.Hour(), rel.Minute(), 0, 0, Paris)
	juryUntil := time.Date(rel.Year(), rel.Month(), rel.Day()+6, 20, 0, 0, 0, Paris)
	g.st.Waves = append(g.st.Waves, &Wave{
		N: w.N + 1, ProposalsUntil: juryUntil, JuryFrom: w.ReleaseAt, JuryUntil: juryUntil,
		ReleaseAt: next, Size: w.Size,
	})
}
