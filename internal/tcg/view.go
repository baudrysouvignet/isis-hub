package tcg

import (
	"sort"
	"strings"
	"time"
	"unicode"
)

// ImgURL : adresse d'une image du jeu, servie par ce serveur (jamais par un tiers).
func ImgURL(name string) string {
	if name == "" {
		return ""
	}
	return "api/tcg/img/" + name
}

// ConsentCount : « 1 / 2 d'accord », pour l'auteur (sans savoir qui).
type ConsentCount struct {
	OK    int `json:"ok"`
	Total int `json:"total"`
}

// CardView : une carte imprimée, telle que la voit un joueur.
type CardView struct {
	ID      string `json:"id"`
	Title   string `json:"title"`
	Desc    string `json:"desc"`
	Cat     string `json:"cat"`
	Img     string `json:"img,omitempty"`
	Thumb   string `json:"thumb,omitempty"`
	Author  string `json:"author"`
	Mine    bool   `json:"mine,omitempty"`
	Wave    int    `json:"wave"`
	No      int    `json:"no"`
	Total   int    `json:"total"`
	Rarity  Rarity `json:"rarity"`
	Run     int    `json:"run"`
	Issued  int    `json:"issued"`
	FirstBy string `json:"firstBy,omitempty"`
	Removed bool   `json:"removed,omitempty"`
	Consent bool   `json:"consentOff,omitempty"` // retirée parce qu'une personne a retiré son accord
}

// WaveView : calendrier et avancement d'une vague.
type WaveView struct {
	N              int       `json:"n"`
	ProposalsUntil time.Time `json:"proposalsUntil,omitzero"`
	JuryFrom       time.Time `json:"juryFrom,omitzero"`
	JuryUntil      time.Time `json:"juryUntil,omitzero"`
	ReleaseAt      time.Time `json:"releaseAt"`
	Size           int       `json:"size"`
	PerDay         int       `json:"perDay,omitempty"` // quota de propositions propre à la vague
	Printed        bool      `json:"printed"`
	Total          int       `json:"total"`
	Discovered     int       `json:"discovered"` // cartes déjà tirées au moins une fois (défi de la promo)
}

// Stats : chiffres de la page d'attente.
type Stats struct {
	Proposed int `json:"proposed"`
	Creators int `json:"creators"`
	Accepted int `json:"accepted"`
	Players  int `json:"players"`
}

// Public : ce que voit quelqu'un qui n'a pas (encore) rejoint le jeu. Aucun pseudo.
type Public struct {
	Phase  string         `json:"phase"`
	Season string         `json:"season"`
	Runs   map[Rarity]int `json:"runs"`
	PerDay int            `json:"perDay"`
	Waves  []WaveView     `json:"waves"`
	Stats  Stats          `json:"stats"`
	Now    time.Time      `json:"now"`
}

func (g *Game) waveViews() []WaveView {
	out := make([]WaveView, 0, len(g.st.Waves))
	for _, w := range g.st.Waves {
		v := WaveView{N: w.N, ProposalsUntil: w.ProposalsUntil, JuryFrom: w.JuryFrom, JuryUntil: w.JuryUntil, ReleaseAt: w.ReleaseAt, Size: w.Size, PerDay: w.PerDay, Printed: w.Printed, Total: len(w.Cards)}
		for _, id := range w.Cards {
			if c := g.st.Cards[id]; c != nil && c.Issued > 0 {
				v.Discovered++
			}
		}
		out = append(out, v)
	}
	return out
}

func (g *Game) stats() Stats {
	s := Stats{Players: len(g.st.Players)}
	creators := map[string]bool{}
	for _, c := range g.st.Cards {
		s.Proposed++
		creators[c.Author] = true
		if c.Status == StatusAccepted || c.Status == StatusPrinted {
			s.Accepted++
		}
	}
	s.Creators = len(creators)
	return s
}

// PublicView : page d'attente et bascule Hub / TCG, sans session.
func (g *Game) PublicView() Public {
	g.mu.Lock()
	defer g.mu.Unlock()
	return Public{Phase: g.phase(), Season: g.st.Season.Name, Runs: g.st.Season.Runs, PerDay: g.perDay(g.now()), Waves: g.waveViews(), Stats: g.stats(), Now: g.now()}
}

func (g *Game) pseudo(pid string) string {
	if p := g.st.Players[pid]; p != nil {
		return p.Pseudo
	}
	return ""
}

func (g *Game) cardView(c *Card, me string) CardView {
	v := CardView{
		ID: c.ID, Title: c.Title, Desc: c.Desc, Cat: c.Cat, Img: ImgURL(c.Img), Thumb: ImgURL(c.Thumb),
		Author: g.pseudo(c.Author), Mine: c.Author == me && me != "", Wave: c.Wave, No: c.No, Rarity: c.Rarity,
		Run: c.Run, Issued: c.Issued, FirstBy: g.pseudo(c.FirstBy),
	}
	if w := g.wave(c.Wave); w != nil {
		v.Total = len(w.Cards)
	}
	if c.Status == StatusRemoved {
		// Carte retirée : ceux qui l'ont gardent l'exemplaire, sans l'image ni le texte.
		v.Removed, v.Img, v.Thumb, v.Desc = true, "", "", ""
		v.Title = "Carte retirée"
		if c.Reason == "personne" {
			// Une personne sur la photo a retiré son accord : l'exemplaire reste, sans photo ni texte.
			v.Title, v.Desc, v.Consent = "Accord retiré", "Une personne sur la photo a retiré son accord : la photo n’est plus montrée. Tu gardes ton exemplaire.", true
		}
	}
	if v.Author == "" {
		v.Author = "Ancien joueur"
	}
	return v
}

// candidateView : carte au jury (auteur masqué, rareté inconnue).
func (g *Game) candidateView(c *Card) CardView {
	return CardView{ID: c.ID, Title: c.Title, Desc: c.Desc, Cat: c.Cat, Img: ImgURL(c.Img), Thumb: ImgURL(c.Thumb)}
}

// ProposalView : une proposition du joueur, avec son statut.
type ProposalView struct {
	ID      string        `json:"id"`
	Num     int           `json:"num"`
	Title   string        `json:"title"`
	Desc    string        `json:"desc"`
	Cat     string        `json:"cat"`
	Img     string        `json:"img,omitempty"`
	Thumb   string        `json:"thumb,omitempty"`
	Status  string        `json:"status"`
	Reason  string        `json:"reason,omitempty"`
	Message string        `json:"message,omitempty"`
	Created time.Time     `json:"created"`
	Wave    int           `json:"wave,omitempty"`
	Rarity  Rarity        `json:"rarity,omitempty"`
	Issued  int           `json:"issued,omitempty"`
	AtJury  bool          `json:"atJury,omitempty"`
	Consent *ConsentCount `json:"consent,omitempty"` // accords des personnes sur la photo (carte en attente)
	JuryEnd time.Time     `json:"juryEnd,omitzero"`
}

// BallotView : un bulletin du jury.
// Une série classée ne renvoie plus ni ses cartes ni l'ordre choisi : le classement reste secret,
// même pour le juré, et ne se refait pas.
type BallotView struct {
	N     int        `json:"n"` // numéro du bulletin (celui que /api/tcg/jury attend)
	Cards []CardView `json:"cards"`
	Done  bool       `json:"done,omitempty"` // classée
	At    time.Time  `json:"at,omitzero"`
}

// JuryView : le jury ouvert.
type JuryView struct {
	Wave    int          `json:"wave"`
	Until   time.Time    `json:"until"`
	Jurors  int          `json:"jurors"`
	Players int          `json:"players"`
	Ballots []BallotView `json:"ballots"`
	More    bool         `json:"more"`          // une autre série est ouverte
	Next    time.Time    `json:"next,omitzero"` // ouverture de la série suivante (minuit)
	Max     int          `json:"max"`           // séries au plus pendant ce jury
}

// FeedView : un événement de « Dans la promo ».
type FeedView struct {
	Kind   string    `json:"kind"`
	Player string    `json:"player"`
	Other  string    `json:"other,omitempty"`
	Card   CardView  `json:"card"`
	At     time.Time `json:"at"`
	Mine   bool      `json:"mine,omitempty"`
}

// MatchView : un joueur qui a ce que je cherche, ou cherche mes doubles.
type MatchView struct {
	ID       string   `json:"id"`
	Pseudo   string   `json:"pseudo"`
	Has      []string `json:"has"`   // cartes de ma liste qu'il possède
	Wants    []string `json:"wants"` // mes doubles qu'il cherche
	Initials string   `json:"initials"`
}

// TradeView : un échange de l'historique.
type TradeView struct {
	With string    `json:"with"`
	Gave []Copy    `json:"gave"`
	Got  []Copy    `json:"got"`
	At   time.Time `json:"at"`
}

// InviteView : invitation à un échange en attente.
type InviteView struct {
	Code    string    `json:"code"`
	From    string    `json:"from"`
	Expires time.Time `json:"expires"`
}

// Me : le joueur.
type Me struct {
	ID            string    `json:"id"`
	Pseudo        string    `json:"pseudo"`
	Initials      string    `json:"initials"`
	BoosterReady  bool      `json:"boosterReady"`
	NextBooster   time.Time `json:"nextBooster"`
	ProposalsLeft int       `json:"proposalsLeft"`
	Muted         bool      `json:"muted,omitempty"`
	Created       time.Time `json:"created"`
	MailLinked    bool      `json:"mailLinked"`
	Admin         bool      `json:"admin,omitempty"`
}

// View : tout l'état du jeu pour un joueur (un seul appel à l'ouverture du TCG).
type View struct {
	Public
	Me        Me               `json:"me"`
	Cards     []CardView       `json:"cards"`
	Owned     map[string][]int `json:"owned"`
	Wish      []string         `json:"wish"`
	LastDraw  []Pull           `json:"lastDraw,omitempty"`
	Proposals []ProposalView   `json:"proposals"`
	Jury      *JuryView        `json:"jury,omitempty"`
	Feed      []FeedView       `json:"feed"`
	Matches   []MatchView      `json:"matches"`
	Trades    []TradeView      `json:"trades"`
	Invites   []InviteView     `json:"invites"`
	Appear    []AppearView     `json:"appear"`  // cartes où je suis indiqué (accord à donner)
	Leaders   Leaderboard      `json:"leaders"` // classement des créateurs : podium et ma place
}

// Initials : deux lettres pour l'avatar (« Léa M. » → LM).
func Initials(name string) string {
	var out []rune
	for _, w := range strings.Fields(name) {
		for _, r := range w {
			if unicode.IsLetter(r) || unicode.IsDigit(r) {
				out = append(out, unicode.ToUpper(r))
				break
			}
		}
		if len(out) == 2 {
			break
		}
	}
	if len(out) == 0 {
		return "?"
	}
	return string(out)
}

// PlayerView : l'état du jeu vu par le joueur.
func (g *Game) PlayerView(pid string) (View, bool) {
	g.mu.Lock()
	defer g.mu.Unlock()
	p := g.st.Players[pid]
	if p == nil {
		return View{}, false
	}
	now := g.now()
	if DayKey(p.Seen) != DayKey(now) { // première venue de la journée : un visiteur de plus
		g.activity(now).Visitors++
		p.Seen = now
		g.dirty = true
	} else if now.Sub(p.Seen) > 6*time.Hour {
		p.Seen = now
		g.dirty = true
	}
	v := View{
		Public: Public{Phase: g.phase(), Season: g.st.Season.Name, Runs: g.st.Season.Runs, PerDay: g.perDay(now), Waves: g.waveViews(), Stats: g.stats(), Now: now},
		Me: Me{
			ID: p.ID, Pseudo: p.Pseudo, Initials: Initials(p.Pseudo), Muted: p.Muted, Created: p.Created,
			MailLinked: p.MailKey != "", Admin: p.Admin,
			ProposalsLeft: g.proposalsLeft(pid, now), NextBooster: g.boosterNext(p, now),
		},
		Owned: map[string][]int{}, Wish: append([]string{}, p.Wish...), Feed: []FeedView{}, Matches: []MatchView{},
		Trades: []TradeView{}, Invites: []InviteView{}, Proposals: []ProposalView{}, Cards: []CardView{},
		Appear:  g.appearances(p),
		Leaders: g.leaderboard(pid),
	}
	v.Me.BoosterReady = v.Phase == "live" && !now.Before(v.Me.NextBooster)
	if !v.Me.BoosterReady {
		v.LastDraw = p.LastDraw // tirage des dernières 24 h (« Revoir mon tirage »)
	}
	if v.Me.NextBooster.IsZero() {
		v.Me.NextBooster = now
	}
	// Cartes en jeu (et celles retirées que le joueur possède encore).
	for _, w := range g.st.Waves {
		if !w.Printed {
			continue
		}
		for _, id := range w.Cards {
			c := g.st.Cards[id]
			if c == nil || (c.Status == StatusRemoved && len(p.Owned[id]) == 0) {
				continue
			}
			v.Cards = append(v.Cards, g.cardView(c, pid))
		}
	}
	for id, serials := range p.Owned {
		if len(serials) > 0 {
			v.Owned[id] = serials
		}
	}
	// Mes propositions, la plus récente d'abord.
	jw := g.juryWave(now)
	for _, c := range g.st.Cards {
		if c.Author != pid {
			continue
		}
		pv := ProposalView{ID: c.ID, Num: c.Num, Title: c.Title, Desc: c.Desc, Cat: c.Cat, Img: ImgURL(c.Img), Thumb: ImgURL(c.Thumb), Status: c.Status, Reason: BlockReasons[c.Reason], Message: c.Message, Created: c.Created, Wave: c.Wave, Issued: c.Issued}
		// Rareté : surprise, même pour l'auteur, jusqu'à ce qu'il tire sa carte.
		if (c.Status == StatusPrinted || c.Status == StatusRemoved) && len(p.Owned[c.ID]) > 0 {
			pv.Rarity = c.Rarity
		}
		if c.Status == StatusAccepted && jw != nil {
			pv.AtJury, pv.JuryEnd = true, jw.JuryUntil
		}
		if len(c.Tags) > 0 && c.Status == StatusConsent {
			cc := &ConsentCount{Total: len(c.Tags)}
			for _, t := range c.Tags {
				if t.Answer == "ok" {
					cc.OK++
				}
			}
			pv.Consent = cc
		}
		v.Proposals = append(v.Proposals, pv)
	}
	sort.Slice(v.Proposals, func(i, j int) bool { return v.Proposals[i].Created.After(v.Proposals[j].Created) })
	if len(v.Proposals) > 40 {
		v.Proposals = v.Proposals[:40]
	}
	// Jury ouvert : premier bulletin préparé à la demande.
	if jw != nil {
		g.ensureBallot(p, jw)
		jv := &JuryView{Wave: jw.N, Until: jw.JuryUntil, Players: len(g.st.Players), Ballots: []BallotView{}}
		for _, q := range g.st.Players {
			for _, b := range q.Ballots[jw.N] {
				if len(b.Rank) > 0 {
					jv.Jurors++
					break
				}
			}
		}
		for i, b := range p.Ballots[jw.N] {
			if len(b.Rank) > 0 {
				jv.Ballots = append(jv.Ballots, BallotView{N: i, Cards: []CardView{}, Done: true, At: b.At})
				continue
			}
			bv := BallotView{N: i}
			for _, id := range b.Cards {
				if c := g.st.Cards[id]; c != nil && c.Status == StatusAccepted {
					bv.Cards = append(bv.Cards, g.candidateView(c))
				}
			}
			if len(bv.Cards) >= 2 {
				jv.Ballots = append(jv.Ballots, bv)
			}
		}
		jv.Max = maxBallots
		if n := len(p.Ballots[jw.N]); n > 0 && n < maxBallots && len(p.Ballots[jw.N][n-1].Rank) > 0 {
			if n < seriesOpen(jw, now) {
				jv.More = true
			} else {
				jv.Next = nextSeries(jw, now)
			}
		}
		if len(jv.Ballots) > 0 {
			v.Jury = jv
		}
	}
	// Dans la promo : le plus récent d'abord.
	for i := len(g.st.Feed) - 1; i >= 0 && len(v.Feed) < 12; i-- {
		f := g.st.Feed[i]
		c := g.st.Cards[f.Card]
		if c == nil || c.Status != StatusPrinted {
			continue
		}
		v.Feed = append(v.Feed, FeedView{Kind: f.Kind, Player: g.pseudo(f.Player), Other: g.pseudo(f.Other), Card: g.cardView(c, pid), At: f.At, Mine: f.Player == pid || f.Other == pid})
	}
	v.Matches = g.matches(p, now)
	for i := len(p.Trades) - 1; i >= 0 && len(v.Trades) < 10; i-- {
		t := p.Trades[i]
		v.Trades = append(v.Trades, TradeView{With: g.pseudo(t.With), Gave: t.Gave, Got: t.Got, At: t.At})
	}
	for _, inv := range g.trades.invitesFor(pid, now) {
		inv.From = g.pseudo(inv.From)
		v.Invites = append(v.Invites, inv)
	}
	return v, true
}

// matches : joueurs actifs qui ont des cartes de ma liste ou cherchent mes doubles.
func (g *Game) matches(p *Player, now time.Time) []MatchView {
	wish := map[string]bool{}
	for _, id := range p.Wish {
		wish[id] = true
	}
	doubles := map[string]bool{}
	for id, s := range p.Owned {
		if len(s) >= 2 {
			doubles[id] = true
		}
	}
	if len(wish) == 0 && len(doubles) == 0 {
		return []MatchView{}
	}
	var out []MatchView
	for _, q := range g.st.Players {
		if q.ID == p.ID || now.Sub(q.Seen) > 30*24*time.Hour {
			continue
		}
		m := MatchView{ID: q.ID, Pseudo: q.Pseudo, Initials: Initials(q.Pseudo), Has: []string{}, Wants: []string{}}
		for id := range wish {
			if len(q.Owned[id]) > 0 {
				m.Has = append(m.Has, id)
			}
		}
		for _, id := range q.Wish {
			if doubles[id] {
				m.Wants = append(m.Wants, id)
			}
		}
		if len(m.Has)+len(m.Wants) > 0 {
			sort.Strings(m.Has)
			sort.Strings(m.Wants)
			out = append(out, m)
		}
	}
	sort.Slice(out, func(i, j int) bool {
		si, sj := 2*len(out[i].Has)+len(out[i].Wants), 2*len(out[j].Has)+len(out[j].Wants)
		if si != sj {
			return si > sj
		}
		return out[i].Pseudo < out[j].Pseudo
	})
	if len(out) > 6 {
		out = out[:6]
	}
	return out
}
