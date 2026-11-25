package tcg

import (
	"context"
	"net/http"
	"sort"
	"sync"
	"time"
)

// Échanges en face à face : l'un crée l'échange (QR code + code à 4 caractères, valable 5 min),
// l'autre le rejoint. Chacun pose ses cartes sur la table ; toute modification annule les deux
// « prêt ». Quand les deux sont prêts, l'échange se fait d'un coup, côté serveur, après une
// dernière vérification de ce que chacun possède. Les tables vivent en mémoire seulement.

const (
	tradeJoinTTL = 5 * time.Minute
	tradeIdleTTL = 15 * time.Minute
	tradeKeep    = 10 * time.Minute
	tradeMaxSide = 6
	codeAlphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789" // sans O/0 ni I/1
)

type tradeSide struct {
	player string
	offer  []Copy
	ready  bool
}

type trade struct {
	code    string
	a, b    tradeSide
	invite  string
	status  string // waiting | open | done | cancelled | expired
	expires time.Time
	ended   time.Time
	v       int // version (tout changement)
	offerV  int // version des offres (« prêt » n'est valable que pour celle-ci)
	changed chan struct{}
	result  *TradeLog // côté A
}

type trades struct {
	mu     sync.Mutex
	byCode map[string]*trade
}

func newTrades() *trades { return &trades{byCode: map[string]*trade{}} }

// bump : nouvelle version, réveille ceux qui attendent.
func (t *trade) bump() {
	t.v++
	close(t.changed)
	t.changed = make(chan struct{})
}

func (t *trade) side(pid string) (me, them *tradeSide) {
	switch pid {
	case t.a.player:
		return &t.a, &t.b
	case t.b.player:
		return &t.b, &t.a
	}
	return nil, nil
}

func (ts *trades) sweep(now time.Time) {
	ts.mu.Lock()
	defer ts.mu.Unlock()
	for code, t := range ts.byCode {
		switch {
		case (t.status == "waiting" || t.status == "open") && now.After(t.expires):
			t.status, t.ended = "expired", now
			t.bump()
		case t.status != "waiting" && t.status != "open" && now.Sub(t.ended) > tradeKeep:
			delete(ts.byCode, code)
		}
	}
}

func (ts *trades) invitesFor(pid string, now time.Time) []InviteView {
	ts.mu.Lock()
	defer ts.mu.Unlock()
	var out []InviteView
	for _, t := range ts.byCode {
		if t.invite == pid && t.status == "waiting" && now.Before(t.expires) {
			out = append(out, InviteView{Code: t.code, From: t.a.player, Expires: t.expires})
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Expires.After(out[j].Expires) })
	return out
}

func (g *Game) newCode() string {
	b := make([]byte, 4)
	for i := range b {
		b[i] = codeAlphabet[g.rnd(len(codeAlphabet))]
	}
	return string(b)
}

// NewTrade : crée une table d'échange (et annule celles que le joueur avait encore ouvertes).
func (g *Game) NewTrade(pid, invite string) (string, time.Time, error) {
	g.mu.Lock()
	defer g.mu.Unlock()
	if g.st.Players[pid] == nil {
		return "", time.Time{}, ErrNotFound
	}
	if g.phase() != "live" {
		return "", time.Time{}, userErr(http.StatusConflict, "Le jeu n’a pas encore commencé.")
	}
	if invite != "" && (g.st.Players[invite] == nil || invite == pid) {
		return "", time.Time{}, ErrNotFound
	}
	now := g.now()
	ts := g.trades
	ts.mu.Lock()
	defer ts.mu.Unlock()
	for _, t := range ts.byCode {
		if (t.a.player == pid || t.b.player == pid) && (t.status == "waiting" || t.status == "open") {
			t.status, t.ended = "cancelled", now
			t.bump()
		}
	}
	code := g.newCode()
	for ts.byCode[code] != nil {
		code = g.newCode()
	}
	ts.byCode[code] = &trade{code: code, a: tradeSide{player: pid}, invite: invite, status: "waiting", expires: now.Add(tradeJoinTTL), changed: make(chan struct{})}
	return code, now.Add(tradeJoinTTL), nil
}

// JoinTrade : rejoindre une table par son code.
func (g *Game) JoinTrade(pid, code string) error {
	g.mu.Lock()
	defer g.mu.Unlock()
	if g.st.Players[pid] == nil {
		return ErrNotFound
	}
	now := g.now()
	ts := g.trades
	ts.mu.Lock()
	defer ts.mu.Unlock()
	t := ts.byCode[code]
	switch {
	case t == nil || t.status == "expired" || (t.status == "waiting" && now.After(t.expires)):
		return userErr(http.StatusNotFound, "Code inconnu ou expiré : demande un nouveau QR code.")
	case t.a.player == pid:
		return userErr(http.StatusConflict, "C’est ton propre échange : fais-le scanner par l’autre téléphone.")
	case t.b.player == pid && t.status == "open":
		return nil
	case t.status != "waiting":
		return userErr(http.StatusConflict, "Cet échange est déjà commencé avec quelqu’un d’autre.")
	}
	for _, x := range ts.byCode {
		if x != t && (x.a.player == pid || x.b.player == pid) && (x.status == "waiting" || x.status == "open") {
			x.status, x.ended = "cancelled", now
			x.bump()
		}
	}
	t.b = tradeSide{player: pid}
	t.status = "open"
	t.expires = now.Add(tradeIdleTTL)
	t.bump()
	return nil
}

// TradeCard : une carte posée sur la table.
type TradeCard struct {
	Card   CardView `json:"card"`
	Serial int      `json:"serial"`
}

// TradeSideView : un côté de la table.
type TradeSideView struct {
	Pseudo   string      `json:"pseudo"`
	Initials string      `json:"initials"`
	Offer    []TradeCard `json:"offer"`
	Ready    bool        `json:"ready"`
	Wish     []string    `json:"wish,omitempty"` // ce qu'il cherche (pour le sélecteur)
}

// TradeState : la table, vue par l'un des deux joueurs.
type TradeState struct {
	Code    string         `json:"code"`
	Status  string         `json:"status"`
	V       int            `json:"v"`
	OfferV  int            `json:"offerV"`
	Expires time.Time      `json:"expires"`
	Me      TradeSideView  `json:"me"`
	Them    *TradeSideView `json:"them,omitempty"`
	Gave    []Copy         `json:"gave,omitempty"`
	Got     []Copy         `json:"got,omitempty"`
}

func (g *Game) sideView(s tradeSide, me string) TradeSideView {
	v := TradeSideView{Pseudo: g.pseudo(s.player), Initials: Initials(g.pseudo(s.player)), Offer: []TradeCard{}, Ready: s.ready}
	for _, c := range s.offer {
		if card := g.st.Cards[c.Card]; card != nil {
			v.Offer = append(v.Offer, TradeCard{Card: g.cardView(card, me), Serial: c.Serial})
		}
	}
	if p := g.st.Players[s.player]; p != nil && s.player != me {
		v.Wish = append([]string{}, p.Wish...)
	}
	return v
}

// TradeView : état de la table pour le joueur, et de quoi attendre le prochain changement.
func (g *Game) TradeView(pid, code string) (TradeState, <-chan struct{}, error) {
	g.mu.Lock()
	defer g.mu.Unlock()
	ts := g.trades
	ts.mu.Lock()
	defer ts.mu.Unlock()
	t := ts.byCode[code]
	if t == nil {
		return TradeState{}, nil, ErrNotFound
	}
	me, them := t.side(pid)
	if me == nil {
		return TradeState{}, nil, ErrNotFound
	}
	s := TradeState{Code: t.code, Status: t.status, V: t.v, OfferV: t.offerV, Expires: t.expires, Me: g.sideView(*me, pid)}
	if them.player != "" {
		tv := g.sideView(*them, pid)
		s.Them = &tv
	}
	if t.status == "done" && t.result != nil {
		if pid == t.a.player {
			s.Gave, s.Got = t.result.Gave, t.result.Got
		} else {
			s.Gave, s.Got = t.result.Got, t.result.Gave
		}
	}
	return s, t.changed, nil
}

// WaitTrade attend un changement de la table (version différente de v) ou la fin du délai.
func (g *Game) WaitTrade(ctx context.Context, pid, code string, v int, max time.Duration) (TradeState, error) {
	s, ch, err := g.TradeView(pid, code)
	if err != nil || s.V != v {
		return s, err
	}
	timer := time.NewTimer(max)
	defer timer.Stop()
	select {
	case <-ch:
	case <-timer.C:
	case <-ctx.Done():
	}
	s, _, err = g.TradeView(pid, code)
	return s, err
}

// owns : le joueur possède-t-il tous ces exemplaires (en tenant compte des doublons) ?
func owns(p *Player, copies []Copy) bool {
	need := map[Copy]int{}
	for _, c := range copies {
		need[c]++
	}
	for c, n := range need {
		have := 0
		for _, s := range p.Owned[c.Card] {
			if s == c.Serial {
				have++
			}
		}
		if have < n {
			return false
		}
	}
	return true
}

// SetOffer : cartes posées sur la table (remplace l'offre ; les deux « prêt » sont annulés).
func (g *Game) SetOffer(pid, code string, offer []Copy) error {
	g.mu.Lock()
	defer g.mu.Unlock()
	p := g.st.Players[pid]
	if p == nil {
		return ErrNotFound
	}
	if len(offer) > tradeMaxSide {
		return userErr(http.StatusBadRequest, "%d cartes au plus par échange.", tradeMaxSide)
	}
	for _, c := range offer {
		card := g.st.Cards[c.Card]
		if card == nil || (card.Status != StatusPrinted && card.Status != StatusRemoved) {
			return ErrNotFound
		}
	}
	if !owns(p, offer) {
		return userErr(http.StatusConflict, "Tu n’as plus l’une de ces cartes.")
	}
	ts := g.trades
	ts.mu.Lock()
	defer ts.mu.Unlock()
	t := ts.byCode[code]
	if t == nil {
		return ErrNotFound
	}
	me, them := t.side(pid)
	if me == nil {
		return ErrNotFound
	}
	if t.status != "open" {
		return userErr(http.StatusConflict, "Cet échange est terminé.")
	}
	me.offer = append([]Copy{}, offer...)
	me.ready, them.ready = false, false
	t.offerV++
	t.expires = g.now().Add(tradeIdleTTL)
	t.bump()
	return nil
}

// SetReady : « prêt » (pour l'offre de version offerV) ; les deux prêts → l'échange se fait.
func (g *Game) SetReady(pid, code string, offerV int, ready bool) error {
	g.mu.Lock()
	defer g.mu.Unlock()
	ts := g.trades
	ts.mu.Lock()
	defer ts.mu.Unlock()
	t := ts.byCode[code]
	if t == nil {
		return ErrNotFound
	}
	me, _ := t.side(pid)
	if me == nil {
		return ErrNotFound
	}
	if t.status != "open" {
		return userErr(http.StatusConflict, "Cet échange est terminé.")
	}
	if ready && offerV != t.offerV {
		return userErr(http.StatusConflict, "L’offre vient de changer : vérifie-la avant de valider.")
	}
	if ready && len(t.a.offer)+len(t.b.offer) == 0 {
		return userErr(http.StatusConflict, "Posez au moins une carte sur la table.")
	}
	me.ready = ready
	now := g.now()
	t.expires = now.Add(tradeIdleTTL)
	if t.a.ready && t.b.ready {
		if err := g.execTrade(t, now); err != nil {
			t.a.ready, t.b.ready = false, false
			t.bump()
			return err
		}
	}
	t.bump()
	return nil
}

// execTrade : l'échange, d'un coup (verrous tenus).
func (g *Game) execTrade(t *trade, now time.Time) error {
	a, b := g.st.Players[t.a.player], g.st.Players[t.b.player]
	if a == nil || b == nil {
		return ErrNotFound
	}
	if !owns(a, t.a.offer) || !owns(b, t.b.offer) {
		return userErr(http.StatusConflict, "L’un de vous n’a plus une carte de l’offre.")
	}
	move := func(from, to *Player, copies []Copy) {
		for _, c := range copies {
			s := from.Owned[c.Card]
			for i, x := range s {
				if x == c.Serial {
					from.Owned[c.Card] = append(s[:i:i], s[i+1:]...)
					break
				}
			}
			if len(from.Owned[c.Card]) == 0 {
				delete(from.Owned, c.Card)
			}
			to.Owned[c.Card] = append(to.Owned[c.Card], c.Serial)
		}
	}
	move(a, b, t.a.offer)
	move(b, a, t.b.offer)
	// Une carte reçue sort de « Je cherche ».
	for _, c := range t.b.offer {
		a.Wish = without(a.Wish, c.Card)
	}
	for _, c := range t.a.offer {
		b.Wish = without(b.Wish, c.Card)
	}
	logA := TradeLog{With: b.ID, Gave: t.a.offer, Got: t.b.offer, At: now, Trade: t.code}
	logB := TradeLog{With: a.ID, Gave: t.b.offer, Got: t.a.offer, At: now, Trade: t.code}
	a.Trades = append(a.Trades, logA)
	b.Trades = append(b.Trades, logB)
	g.activity(now).Trades++
	if len(a.Trades) > tradesKeep {
		a.Trades = a.Trades[len(a.Trades)-tradesKeep:]
	}
	if len(b.Trades) > tradesKeep {
		b.Trades = b.Trades[len(b.Trades)-tradesKeep:]
	}
	// « Dans la promo » : la carte la plus rare de l'échange.
	best := ""
	for _, c := range append(append([]Copy{}, t.a.offer...), t.b.offer...) {
		card := g.st.Cards[c.Card]
		if card != nil && card.Status == StatusPrinted && (best == "" || card.Rarity.tier() > g.st.Cards[best].Rarity.tier()) {
			best = c.Card
		}
	}
	if best != "" {
		g.addFeed(FeedItem{Kind: "trade", Player: a.ID, Other: b.ID, Card: best, At: now})
	}
	t.result = &logA
	t.status, t.ended = "done", now
	g.dirty = true
	return nil
}

// CancelTrade : l'un des deux quitte la table.
func (g *Game) CancelTrade(pid, code string) error {
	ts := g.trades
	ts.mu.Lock()
	defer ts.mu.Unlock()
	t := ts.byCode[code]
	if t == nil {
		return ErrNotFound
	}
	if me, _ := t.side(pid); me == nil {
		return ErrNotFound
	}
	if t.status == "waiting" || t.status == "open" {
		t.status, t.ended = "cancelled", g.now()
		t.bump()
	}
	return nil
}
