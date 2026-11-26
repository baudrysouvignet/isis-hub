package tcg

import (
	"sort"
	"time"
)

// Récompenses de lancement.
//
// Chaque soir du jury de la vague 1 où la promo a voté, à minuit (heure de Paris), on reprend le
// classement des créateurs tel qu'il s'affichait : avant le lancement, une carte validée vaut un
// point (leaderboard.go). Il se reconstitue à la sortie de la vague 1 à partir de la date de
// validation de chaque carte (Card.Validated) et de la date des séries du jury (Ballot.At) : rien
// d'autre n'est gardé pour ça. Ce soir-là :
//
//	1re place       un booster bonus de 5 cartes (une taille qui n'existe pas en boosters du jour)
//	2e place        4 cartes
//	3e place        3 cartes
//	4e à 13e place  1 carte
//
// Et chaque participant (au moins une carte validée, ou une série du jury classée) reçoit un
// booster bonus de 4 cartes. Tous ces boosters s'ajoutent aux deux boosters du jour, se tirent au
// même taux par carte (draw) et sont valables 24 h après la sortie de la vague 1.
//
// Équilibrage (simulation : sim_test.go). Pour que personne ne rafle les cartes numérotées le
// premier jour, le rythme des raretés compte ces boosters bonus d'avance (boostersPerDay) : le jour
// du lancement distribue ~7 % du stock numéroté, bonus ou pas. Et le classement étant cumulatif, les
// mêmes finissent en tête chaque soir : seuls les maxNights meilleurs soirs d'un joueur comptent
// (3 ; 1er tous les soirs : 4 + 3 × 5 = 19 cartes bonus, plutôt que 44 sur 8 soirs), ce qui garde
// l'ordre 1er > 2e > 3e et l'avance du podium à environ deux jours de jeu.
var rankPackSize = map[int]int{1: 5, 2: 4, 3: 3}

const (
	rankPackPlaces = 13 // places récompensées chaque soir (podium, puis 1 carte jusqu'à la 13e)
	followPackSize = 1
	allPackSize    = 4
	packValid      = 24 * time.Hour
)

// maxNights : soirs récompensés au plus par joueur (ses meilleurs). Variable pour la simulation
// d'équilibrage (sim_test.go).
var maxNights = 3

// packSize : taille du booster bonus pour la place rank un soir (0 : rien).
func packSize(rank int) int {
	if n, ok := rankPackSize[rank]; ok {
		return n
	}
	if rank > 0 && rank <= rankPackPlaces {
		return followPackSize
	}
	return 0
}

// RewardNight : la place d'un joueur un soir de jury.
type RewardNight struct {
	Day  string `json:"day"`  // jour calendaire (Paris) du soir
	Rank int    `json:"rank"` // place à minuit
	Size int    `json:"size"` // cartes du booster bonus
}

// launchNights : les soirs de jury de la vague w où il y a eu des votes avant until : minuit qui suit
// chaque jour de votes. Un minuit pas encore passé compte à l'heure until si atRelease (la vague sort
// avant ce minuit-là), sinon pas encore (aperçu d'avant le lancement).
func (g *Game) launchNights(w *Wave, until time.Time, atRelease bool) []time.Time {
	days := map[string]time.Time{}
	for _, p := range g.st.Players {
		for _, b := range p.Ballots[w.N] {
			if len(b.Rank) == 0 || b.At.IsZero() || b.At.After(until) {
				continue
			}
			t := b.At.In(Paris)
			mid := time.Date(t.Year(), t.Month(), t.Day()+1, 0, 0, 0, 0, Paris)
			days[calendarDay(t)] = mid
		}
	}
	var out []time.Time
	for _, mid := range days {
		if mid.After(until) {
			if !atRelease {
				continue
			}
			mid = until
		}
		out = append(out, mid)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Before(out[j]) })
	return out
}

// launchRewards : soirs récompensés de chaque joueur, et participants, à l'instant until (sortie de
// la vague si atRelease, sinon maintenant pour l'aperçu : seuls les minuits passés comptent).
func (g *Game) launchRewards(w *Wave, until time.Time, atRelease bool) (map[string][]RewardNight, map[string]bool) {
	nights := map[string][]RewardNight{}
	for _, mid := range g.launchNights(w, until, atRelease) {
		day := calendarDay(mid.Add(-time.Minute))
		for i, cr := range g.rankingAt(mid) {
			if n := packSize(i + 1); n > 0 {
				nights[cr.id] = append(nights[cr.id], RewardNight{Day: day, Rank: i + 1, Size: n})
			}
		}
	}
	part := map[string]bool{}
	for _, c := range g.st.Cards {
		if (c.Status == StatusAccepted || c.Status == StatusConsent || c.Status == StatusPrinted) && g.st.Players[c.Author] != nil {
			part[c.Author] = true
		}
	}
	for id, p := range g.st.Players {
		for _, b := range p.Ballots[w.N] {
			if len(b.Rank) > 0 {
				part[id] = true
				break
			}
		}
	}
	for id := range part {
		if p := g.st.Players[id]; p == nil || p.Muted {
			delete(part, id)
		}
	}
	return nights, part
}

// rewardPacks : les boosters bonus d'un joueur : participation d'abord, puis ses maxNights
// meilleurs soirs (les plus gros boosters ; à égalité, les premiers soirs), dans l'ordre des soirs.
func rewardPacks(nights []RewardNight, participant bool, until time.Time) []Pack {
	var out []Pack
	add := func(pk Pack) {
		pk.ID = "b" + itoa(len(out)+1)
		pk.Until = until
		out = append(out, pk)
	}
	if participant {
		add(Pack{Kind: "all", Size: allPackSize})
	}
	best := append([]RewardNight{}, nights...)
	sort.SliceStable(best, func(i, j int) bool { return best[i].Size > best[j].Size })
	if len(best) > maxNights {
		best = best[:maxNights]
	}
	sort.SliceStable(best, func(i, j int) bool { return best[i].Day < best[j].Day })
	for _, n := range best {
		add(Pack{Kind: "rank", Day: n.Day, Rank: n.Rank, Size: n.Size})
	}
	return out
}

// grantLaunch : à l'impression de la première vague, les boosters bonus de chacun (verrou tenu).
func (g *Game) grantLaunch(w *Wave, now time.Time) {
	if w.Rewarded {
		return
	}
	w.Rewarded = true
	nights, part := g.launchRewards(w, now, true)
	until := now.Add(packValid)
	for id, p := range g.st.Players {
		if p.Muted {
			continue
		}
		p.Packs = append(p.Packs, rewardPacks(nights[id], part[id], until)...)
	}
	g.dirty = true
}

// launchWave : la vague 1 (première à sortir) tant qu'elle n'est pas imprimée, sinon nil.
func (g *Game) launchWave() *Wave {
	for _, w := range g.st.Waves {
		if w.Printed {
			return nil
		}
	}
	if len(g.st.Waves) == 0 {
		return nil
	}
	return g.st.Waves[0]
}

// RewardsView : récompenses de lancement d'un joueur. Avant la sortie : ce qu'il a gagné jusqu'ici
// (soirs déjà passés). Après : ses boosters bonus, à ouvrir avant leur date.
type RewardsView struct {
	Nights      []RewardNight `json:"nights"`
	Participant bool          `json:"participant"`
	Cards       int           `json:"cards"`     // cartes bonus en tout (meilleurs soirs seulement)
	MaxNights   int           `json:"maxNights"` // soirs comptés au plus
	Packs       []Pack        `json:"packs,omitempty"`
	Until       time.Time     `json:"until,omitzero"`
	Preview     bool          `json:"preview,omitempty"` // avant le lancement : à ce jour
}

// rewardsView : ce que voit le joueur (nil s'il n'y a rien à montrer).
func (g *Game) rewardsView(p *Player, now time.Time) *RewardsView {
	if lw := g.launchWave(); lw != nil {
		if lw.JuryFrom.IsZero() || now.Before(lw.JuryFrom) {
			return nil
		}
		nights, part := g.launchRewards(lw, now, false)
		v := &RewardsView{Nights: nights[p.ID], Participant: part[p.ID], MaxNights: maxNights, Preview: true}
		if v.Nights == nil {
			v.Nights = []RewardNight{}
		}
		for _, pk := range rewardPacks(v.Nights, v.Participant, time.Time{}) {
			v.Cards += pk.Size
		}
		return v
	}
	if len(p.Packs) == 0 {
		return nil
	}
	v := &RewardsView{Nights: []RewardNight{}, MaxNights: maxNights, Packs: append([]Pack{}, p.Packs...)}
	for _, pk := range p.Packs {
		v.Cards += pk.Size
		if pk.Kind == "all" {
			v.Participant = true
		} else {
			v.Nights = append(v.Nights, RewardNight{Day: pk.Day, Rank: pk.Rank, Size: pk.Size})
		}
		if pk.Until.After(v.Until) {
			v.Until = pk.Until
		}
	}
	return v
}

// RewardsPreview : pour l'administration, les récompenses de lancement à ce jour (ou attribuées),
// joueur par joueur : pseudo, soirs, cartes. Aucun identifiant universitaire.
type RewardRow struct {
	Pseudo      string        `json:"pseudo"`
	Nights      []RewardNight `json:"nights"`
	Participant bool          `json:"participant"`
	Cards       int           `json:"cards"`
	Opened      int           `json:"opened"` // cartes bonus déjà ouvertes
}

// NightPodium : le podium d'un soir de jury, tel qu'il est reconstitué (pour le vérifier).
type NightPodium struct {
	Day string   `json:"day"`
	Top []string `json:"top"` // pseudos, du 1er au 3e
}

type RewardsAdmin struct {
	Granted bool          `json:"granted"`
	Podiums []NightPodium `json:"podiums"` // chaque soir compté, du premier au dernier
	Nights  int           `json:"nights"`  // soirs comptés
	Rows    []RewardRow   `json:"rows"`
	Cards   int           `json:"cards"` // cartes bonus en tout
	Players int           `json:"players"`
	Max     int           `json:"maxNights"`
}

func (g *Game) AdminRewards() RewardsAdmin {
	g.mu.Lock()
	defer g.mu.Unlock()
	now := g.now()
	out := RewardsAdmin{Rows: []RewardRow{}, Players: len(g.st.Players), Max: maxNights, Podiums: []NightPodium{}}
	podiums := func(w *Wave, until time.Time, atRelease bool) {
		for _, mid := range g.launchNights(w, until, atRelease) {
			np := NightPodium{Day: calendarDay(mid.Add(-time.Minute)), Top: []string{}}
			for i, cr := range g.rankingAt(mid) {
				if i >= podiumSize {
					break
				}
				np.Top = append(np.Top, g.pseudo(cr.id))
			}
			out.Podiums = append(out.Podiums, np)
		}
	}
	if lw := g.launchWave(); lw != nil {
		podiums(lw, now, false)
		nights, part := g.launchRewards(lw, now, false)
		out.Nights = len(g.launchNights(lw, now, false))
		for id, p := range g.st.Players {
			if p.Muted || (len(nights[id]) == 0 && !part[id]) {
				continue
			}
			row := RewardRow{Pseudo: p.Pseudo, Nights: nights[id], Participant: part[id]}
			for _, pk := range rewardPacks(nights[id], part[id], time.Time{}) {
				row.Cards += pk.Size
			}
			out.Rows = append(out.Rows, row)
		}
	} else {
		out.Granted = true
		for _, w := range g.st.Waves { // la vague 1 : première imprimée
			if w.Printed {
				podiums(w, w.PrintedAt, true)
				break
			}
		}
		nightDays := map[string]bool{}
		for _, p := range g.st.Players {
			if len(p.Packs) == 0 {
				continue
			}
			row := RewardRow{Pseudo: p.Pseudo, Nights: []RewardNight{}}
			for _, pk := range p.Packs {
				row.Cards += pk.Size
				if !pk.Opened.IsZero() {
					row.Opened += pk.Size
				}
				if pk.Kind == "all" {
					row.Participant = true
				} else {
					row.Nights = append(row.Nights, RewardNight{Day: pk.Day, Rank: pk.Rank, Size: pk.Size})
					nightDays[pk.Day] = true
				}
			}
			out.Rows = append(out.Rows, row)
		}
		out.Nights = len(nightDays)
	}
	for _, r := range out.Rows {
		out.Cards += r.Cards
	}
	sort.Slice(out.Rows, func(i, j int) bool {
		if out.Rows[i].Cards != out.Rows[j].Cards {
			return out.Rows[i].Cards > out.Rows[j].Cards
		}
		return out.Rows[i].Pseudo < out.Rows[j].Pseudo
	})
	return out
}
