package tcg

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"net/http"
	"sort"
	"strings"
	"time"
)

// ------------------------------------------------------------ joueurs et sessions

// loginKey : empreinte de l'identifiant universitaire (seule trace gardée de l'identité).
func (g *Game) loginKey(login string) string {
	m := hmac.New(sha256.New, g.key)
	m.Write([]byte(strings.ToLower(strings.TrimSpace(login))))
	return hex.EncodeToString(m.Sum(nil))
}

// Join : connexion d'un appareil au jeu, après validation du ticket CAS. Crée le joueur s'il est
// nouveau (avec le pseudo proposé). Rend le jeton de session (cookie) et si le joueur est nouveau.
func (g *Game) Join(login, pseudo string) (tok string, created bool, err error) {
	if strings.TrimSpace(login) == "" {
		return "", false, ErrInvalid
	}
	g.mu.Lock()
	defer g.mu.Unlock()
	now := g.now()
	key := g.loginKey(login)
	id, ok := g.st.Keys[key]
	if !ok || g.st.Players[id] == nil {
		ps, valid := CleanPseudo(pseudo)
		if !valid {
			return "", false, userErr(http.StatusBadRequest, "Ton prénom n’a pas pu être lu depuis ton compte : reconnecte-toi au Hub, puis réessaie.")
		}
		if len(g.st.Players) >= maxPlayers {
			return "", false, userErr(http.StatusServiceUnavailable, "Le jeu est complet pour l’instant.")
		}
		id = randomID("j")
		g.st.Players[id] = &Player{ID: id, Pseudo: ps, Created: now, Owned: map[string][]int{}, Ballots: map[int][]Ballot{}}
		g.st.Keys[key] = id
		created = true
	}
	tok = randomToken()
	g.st.Sessions[hashToken(tok)] = session{Player: id, Expires: now.Add(sessionTTL)}
	g.dirty = true
	return tok, created, nil
}

// PlayerID : joueur de la session (jeton du cookie), "" sinon.
func (g *Game) PlayerID(tok string) string {
	if len(tok) < 32 {
		return ""
	}
	g.mu.Lock()
	defer g.mu.Unlock()
	s, ok := g.st.Sessions[hashToken(tok)]
	if !ok || g.now().After(s.Expires) || g.st.Players[s.Player] == nil {
		return ""
	}
	return s.Player
}

// Logout : oublie la session de cet appareil.
func (g *Game) Logout(tok string) {
	g.mu.Lock()
	defer g.mu.Unlock()
	if _, ok := g.st.Sessions[hashToken(tok)]; ok {
		delete(g.st.Sessions, hashToken(tok))
		g.dirty = true
	}
}

// Leave : le joueur quitte le jeu. Sa collection, ses votes et ses propositions non imprimées sont
// effacés ; les cartes imprimées restent dans le jeu, sans son nom.
func (g *Game) Leave(pid string) error {
	g.mu.Lock()
	defer g.mu.Unlock()
	if g.st.Players[pid] == nil {
		return ErrNotFound
	}
	var purge []string
	for id, c := range g.st.Cards {
		if c.Author != pid {
			continue
		}
		if c.Status == StatusPrinted || c.Status == StatusRemoved {
			c.Author = ""
			continue
		}
		purge = append(purge, c.Img, c.Thumb)
		g.st.Used -= c.Bytes
		delete(g.st.Cards, id)
	}
	for _, c := range g.st.Cards {
		if c.FirstBy == pid {
			c.FirstBy = ""
		}
		kept := c.Reports[:0]
		for _, r := range c.Reports {
			if r.Player != pid {
				kept = append(kept, r)
			}
		}
		c.Reports = kept
	}
	for k, id := range g.st.Keys {
		if id == pid {
			delete(g.st.Keys, k)
		}
	}
	for k, s := range g.st.Sessions {
		if s.Player == pid {
			delete(g.st.Sessions, k)
		}
	}
	feed := g.st.Feed[:0]
	for _, f := range g.st.Feed {
		if f.Player != pid && f.Other != pid {
			feed = append(feed, f)
		}
	}
	g.st.Feed = feed
	delete(g.st.Players, pid)
	g.dirty = true
	go func() {
		for _, n := range purge {
			if n != "" && g.Blobs != nil {
				g.Blobs.Delete(n)
			}
		}
	}()
	return nil
}

// ------------------------------------------------------------ phases

// phase : off (jeu masqué), soon (avant la première vague), live.
func (g *Game) phase() string {
	if !g.st.Season.Enabled || len(g.st.Waves) == 0 {
		return "off"
	}
	for _, w := range g.st.Waves {
		if w.Printed {
			return "live"
		}
	}
	return "soon"
}

func (g *Game) wave(n int) *Wave {
	for _, w := range g.st.Waves {
		if w.N == n {
			return w
		}
	}
	return nil
}

// juryWave : vague dont le jury est ouvert maintenant.
func (g *Game) juryWave(now time.Time) *Wave {
	for _, w := range g.st.Waves {
		if !w.Printed && !w.JuryFrom.IsZero() && !now.Before(w.JuryFrom) && now.Before(w.JuryUntil) {
			return w
		}
	}
	return nil
}

func (g *Game) latestPrinted() *Wave {
	var last *Wave
	for _, w := range g.st.Waves {
		if w.Printed && (last == nil || w.N > last.N) {
			last = w
		}
	}
	return last
}

// ------------------------------------------------------------ booster du jour

// OpenBooster ouvre le booster du jour : 5 cartes, plus rares au fil de leur rythme.
func (g *Game) OpenBooster(pid string) ([]Pull, error) {
	g.mu.Lock()
	defer g.mu.Unlock()
	p := g.st.Players[pid]
	if p == nil {
		return nil, ErrNotFound
	}
	now := g.now()
	if g.phase() != "live" {
		return nil, userErr(http.StatusConflict, "Le jeu n’a pas encore commencé.")
	}
	day := DayKey(now)
	if p.Booster == day {
		return nil, userErr(http.StatusConflict, "Booster déjà ouvert aujourd’hui : le prochain arrive demain à %d h.", BoosterHour)
	}
	pulls := g.draw(now)
	if len(pulls) == 0 {
		return nil, userErr(http.StatusConflict, "Aucune carte à tirer pour l’instant.")
	}
	for i := range pulls {
		c := g.st.Cards[pulls[i].Card]
		pulls[i].New = len(p.Owned[c.ID]) == 0
		first := c.Issued == 0
		c.Issued++
		if c.Run > 0 {
			pulls[i].Serial = c.Issued
		}
		if first {
			c.FirstBy, c.FirstAt = pid, now
		}
		p.Owned[c.ID] = append(p.Owned[c.ID], pulls[i].Serial)
		if c.Rarity.tier() >= 2 {
			kind := "pull"
			if first {
				kind = "first"
			}
			g.addFeed(FeedItem{Kind: kind, Player: pid, Card: c.ID, At: now})
		}
	}
	p.Booster = day
	p.LastDraw = pulls
	g.st.Boosters[day]++
	g.dirty = true
	return pulls, nil
}

// draw : tirage de 5 cartes (sans les attribuer). Chaque exemplaire numéroté encore libre a une
// chance proportionnée au temps qui reste pour le distribuer (PaceDays après la sortie de sa
// vague) et au nombre de boosters ouverts chaque jour : les cartes rares se répartissent sur
// toute la période au lieu de partir le premier jour. Le reste est fait de cartes communes.
func (g *Game) draw(now time.Time) []Pull {
	const size, maxLimited = 5, 3
	var limited, communes []string
	latest := g.latestPrinted()
	var latestCommunes []string
	for _, w := range g.st.Waves {
		if !w.Printed {
			continue
		}
		for _, id := range w.Cards {
			c := g.st.Cards[id]
			if c == nil || c.Status != StatusPrinted {
				continue
			}
			if c.Run > 0 {
				if c.Issued < c.Run {
					limited = append(limited, id)
				}
				continue
			}
			communes = append(communes, id)
			if latest != nil && w.N == latest.N {
				latestCommunes = append(latestCommunes, id)
			}
		}
	}
	perDay := g.boostersPerDay(now)
	g.shuffle(limited)
	var pulls []Pull
	taken := map[string]bool{}
	for _, id := range limited {
		if len(pulls) >= maxLimited {
			break
		}
		c := g.st.Cards[id]
		w := g.wave(c.Wave)
		deadline := now
		if w != nil {
			deadline = w.PrintedAt.Add(time.Duration(g.st.Season.PaceDays) * 24 * time.Hour)
		}
		days := deadline.Sub(now).Hours() / 24
		if days < 0.5 {
			days = 0.5
		}
		p := float64(c.Run-c.Issued) / (perDay * days)
		if p > 0.6 {
			p = 0.6
		}
		if g.chance(p) {
			pulls = append(pulls, Pull{Card: id})
			taken[id] = true
		}
	}
	for len(pulls) < size {
		pool := communes
		if len(latestCommunes) > 0 && g.chance(0.5) {
			pool = latestCommunes
		}
		if len(pool) == 0 {
			// Plus de communes : les exemplaires numérotés restants complètent le booster.
			var rest []string
			for _, id := range limited {
				if !taken[id] {
					rest = append(rest, id)
				}
			}
			if len(rest) == 0 {
				break
			}
			id := rest[g.rnd(len(rest))]
			pulls = append(pulls, Pull{Card: id})
			taken[id] = true
			continue
		}
		id := pool[g.rnd(len(pool))]
		for try := 0; try < 6 && taken[id] && len(pool) > 1; try++ {
			id = pool[g.rnd(len(pool))]
		}
		pulls = append(pulls, Pull{Card: id})
		taken[id] = true
	}
	// Révélation : de la plus courante à la plus rare, la meilleure en dernier.
	sort.SliceStable(pulls, func(i, j int) bool {
		return g.st.Cards[pulls[i].Card].Rarity.tier() < g.st.Cards[pulls[j].Card].Rarity.tier()
	})
	return pulls
}

// boostersPerDay : boosters ouverts par jour ces derniers jours (au moins 10, et au moins le
// rythme du jour en cours).
func (g *Game) boostersPerDay(now time.Time) float64 {
	today := DayKey(now)
	total, days := 0, 0
	for i := 1; i <= 7; i++ {
		d := DayKey(now.Add(-time.Duration(i) * 24 * time.Hour))
		if n, ok := g.st.Boosters[d]; ok {
			total += n
			days++
		}
	}
	est := 10.0
	if days > 0 && float64(total)/float64(days) > est {
		est = float64(total) / float64(days)
	}
	if n := float64(g.st.Boosters[today]); n > est {
		est = n
	}
	return est
}

func (g *Game) addFeed(f FeedItem) {
	g.st.Feed = append(g.st.Feed, f)
	if len(g.st.Feed) > feedKeep {
		g.st.Feed = g.st.Feed[len(g.st.Feed)-feedKeep:]
	}
}

// ------------------------------------------------------------ propositions

// NewProposal : une carte proposée (images déjà enregistrées). Rend son identifiant.
type NewProposal struct {
	Title, Desc, Cat string
	Img, Thumb       string
	Bytes            int64
}

// ProposalsLeft : propositions encore possibles aujourd'hui.
// perDay : propositions permises aujourd'hui. Pendant les propositions d'une vague qui a son
// propre quota (vague 1 : 10 par jour), celui-ci ; sinon le réglage de la saison.
func (g *Game) perDay(now time.Time) int {
	for _, w := range g.st.Waves {
		if w.Printed || (!w.ProposalsUntil.IsZero() && !now.Before(w.ProposalsUntil)) {
			continue
		}
		if w.PerDay > 0 {
			return w.PerDay
		}
		break
	}
	return g.st.Season.PerDay
}

func (g *Game) proposalsLeft(pid string, now time.Time) int {
	today := calendarDay(now)
	n := 0
	for _, c := range g.st.Cards {
		if c.Author == pid && calendarDay(c.Created) == today {
			n++
		}
	}
	if left := g.perDay(now) - n; left > 0 {
		return left
	}
	return 0
}

// CheckProposal vérifie, avant l'envoi des images, que le joueur peut proposer une carte.
func (g *Game) CheckProposal(pid string) error {
	g.mu.Lock()
	defer g.mu.Unlock()
	return g.checkProposal(pid)
}

func (g *Game) checkProposal(pid string) error {
	p := g.st.Players[pid]
	if p == nil {
		return ErrNotFound
	}
	if g.phase() == "off" {
		return userErr(http.StatusConflict, "Les propositions ne sont pas ouvertes.")
	}
	if p.Muted {
		return userErr(http.StatusForbidden, "Tes propositions sont suspendues par l’administration.")
	}
	if g.proposalsLeft(pid, g.now()) <= 0 {
		return userErr(http.StatusTooManyRequests, "Tu as proposé %d cartes aujourd’hui : reviens demain.", g.perDay(g.now()))
	}
	pending := 0
	for _, c := range g.st.Cards {
		if c.Status == StatusPending {
			pending++
		}
	}
	if pending >= maxPending {
		return userErr(http.StatusServiceUnavailable, "Trop de cartes en attente de validation : réessaie un peu plus tard.")
	}
	return nil
}

// CleanCardText vérifie titre, description et catégorie d'une carte.
func CleanCardText(title, desc, cat string) (string, string, string, error) {
	title = cleanText(title, false)
	desc = cleanText(desc, true)
	cat = strings.ToLower(strings.TrimSpace(cat))
	switch {
	case runes(title) < 2 || runes(title) > 28:
		return "", "", "", userErr(http.StatusBadRequest, "Le titre fait de 2 à 28 caractères.")
	case runes(desc) < 4 || runes(desc) > 160:
		return "", "", "", userErr(http.StatusBadRequest, "La description fait de 4 à 160 caractères.")
	case !Categories[cat]:
		return "", "", "", userErr(http.StatusBadRequest, "Catégorie inconnue.")
	}
	return title, desc, cat, nil
}

// Propose enregistre une proposition en attente de validation.
func (g *Game) Propose(pid string, in NewProposal) (string, error) {
	title, desc, cat, err := CleanCardText(in.Title, in.Desc, in.Cat)
	if err != nil {
		return "", err
	}
	g.mu.Lock()
	defer g.mu.Unlock()
	if err := g.checkProposal(pid); err != nil {
		return "", err
	}
	g.st.NextNum++
	c := &Card{
		ID: "c" + itoa(g.st.NextNum), Num: g.st.NextNum, Author: pid,
		Title: title, Desc: desc, Cat: cat, Img: in.Img, Thumb: in.Thumb, Bytes: in.Bytes,
		Status: StatusPending, Created: g.now(),
	}
	g.st.Cards[c.ID] = c
	g.st.Used += in.Bytes
	g.dirty = true
	return c.ID, nil
}

// ImageShown : l'image appartient à une carte visible (en attente, au jury ou en jeu). Une image
// sans carte, ou dont toutes les cartes sont bloquées ou retirées, n'est plus servie aux joueurs.
func (g *Game) ImageShown(name string) bool {
	if name == "" {
		return false
	}
	g.mu.Lock()
	defer g.mu.Unlock()
	for _, c := range g.st.Cards {
		if (c.Img == name || c.Thumb == name) && c.Status != StatusBlocked && c.Status != StatusRemoved {
			return true
		}
	}
	return false
}

// Withdraw : l'auteur retire une proposition pas encore imprimée.
func (g *Game) Withdraw(pid, id string) error {
	g.mu.Lock()
	c := g.st.Cards[id]
	if c == nil || c.Author != pid {
		g.mu.Unlock()
		return ErrNotFound
	}
	if c.Status == StatusPrinted || c.Status == StatusRemoved {
		g.mu.Unlock()
		return userErr(http.StatusConflict, "Cette carte est déjà imprimée.")
	}
	imgs := []string{c.Img, c.Thumb}
	g.st.Used -= c.Bytes
	delete(g.st.Cards, id)
	for _, p := range g.st.Players {
		for n, bs := range p.Ballots {
			for i := range bs {
				bs[i].Cards = without(bs[i].Cards, id)
				bs[i].Rank = without(bs[i].Rank, id)
			}
			p.Ballots[n] = bs
		}
	}
	g.dirty = true
	g.mu.Unlock()
	for _, n := range imgs {
		if n != "" && g.Blobs != nil {
			g.Blobs.Delete(n)
		}
	}
	return nil
}

func without(ids []string, id string) []string {
	out := ids[:0]
	for _, x := range ids {
		if x != id {
			out = append(out, x)
		}
	}
	return out
}

// ------------------------------------------------------------ jury de la semaine

const (
	ballotSize = 5
	maxBallots = 3
)

// ensureBallot : premier bulletin du joueur pour le jury ouvert (créé à la demande).
func (g *Game) ensureBallot(p *Player, w *Wave) {
	if len(p.Ballots[w.N]) > 0 {
		return
	}
	if b, ok := g.newBallot(p, w); ok {
		p.Ballots[w.N] = append(p.Ballots[w.N], b)
		g.dirty = true
	}
}

// newBallot : 5 cartes validées, jamais les siennes, les moins vues d'abord.
func (g *Game) newBallot(p *Player, w *Wave) (Ballot, bool) {
	seen := map[string]bool{}
	for _, b := range p.Ballots[w.N] {
		for _, id := range b.Cards {
			seen[id] = true
		}
	}
	var pool []*Card
	for _, c := range g.st.Cards {
		if c.Status == StatusAccepted && c.Author != p.ID && !seen[c.ID] {
			pool = append(pool, c)
		}
	}
	if len(pool) < 2 {
		return Ballot{}, false
	}
	ids := make([]string, len(pool))
	for i, c := range pool {
		ids[i] = c.ID
	}
	g.shuffle(ids)
	sort.SliceStable(ids, func(i, j int) bool { return g.st.Cards[ids[i]].JuryShown < g.st.Cards[ids[j]].JuryShown })
	if len(ids) > ballotSize {
		ids = ids[:ballotSize]
	}
	for _, id := range ids {
		g.st.Cards[id].JuryShown++
	}
	return Ballot{Cards: ids}, true
}

// Vote : classement d'un bulletin, modifiable jusqu'à la fin du jury.
func (g *Game) Vote(pid string, wave, ballot int, rank []string) error {
	g.mu.Lock()
	defer g.mu.Unlock()
	p := g.st.Players[pid]
	if p == nil {
		return ErrNotFound
	}
	w := g.juryWave(g.now())
	if w == nil || w.N != wave {
		return userErr(http.StatusConflict, "Le jury est fermé.")
	}
	bs := p.Ballots[wave]
	if ballot < 0 || ballot >= len(bs) {
		return ErrNotFound
	}
	b := &bs[ballot]
	if len(rank) != len(b.Cards) || !samePerm(rank, b.Cards) {
		return userErr(http.StatusBadRequest, "Classement incomplet.")
	}
	// Ancien classement retiré, nouveau compté : points de (n-1) à -(n-1), par pas de 2.
	if len(b.Rank) > 0 {
		for i, id := range b.Rank {
			if c := g.st.Cards[id]; c != nil {
				c.JuryPts -= len(b.Rank) - 1 - 2*i
				c.JuryVotes--
			}
		}
	}
	for i, id := range rank {
		if c := g.st.Cards[id]; c != nil {
			c.JuryPts += len(rank) - 1 - 2*i
			c.JuryVotes++
		}
	}
	b.Rank = append([]string(nil), rank...)
	b.At = g.now()
	g.dirty = true
	return nil
}

// MoreBallot : 5 autres cartes à classer (3 bulletins au plus par jury).
func (g *Game) MoreBallot(pid string) error {
	g.mu.Lock()
	defer g.mu.Unlock()
	p := g.st.Players[pid]
	if p == nil {
		return ErrNotFound
	}
	w := g.juryWave(g.now())
	if w == nil {
		return userErr(http.StatusConflict, "Le jury est fermé.")
	}
	bs := p.Ballots[w.N]
	if len(bs) == 0 || len(bs[len(bs)-1].Rank) == 0 || len(bs) >= maxBallots {
		return userErr(http.StatusConflict, "Valide d’abord ton classement.")
	}
	b, ok := g.newBallot(p, w)
	if !ok {
		return userErr(http.StatusConflict, "Tu as vu toutes les cartes candidates.")
	}
	p.Ballots[w.N] = append(bs, b)
	g.dirty = true
	return nil
}

func samePerm(a, b []string) bool {
	m := map[string]int{}
	for _, x := range b {
		m[x]++
	}
	for _, x := range a {
		m[x]--
		if m[x] < 0 {
			return false
		}
	}
	return true
}

// juryScore : moyenne des points, tirée vers 0 tant qu'il y a peu de classements.
func juryScore(c *Card) float64 { return float64(c.JuryPts) / float64(c.JuryVotes+2) }

// ------------------------------------------------------------ collection

// SetWish : ajoute ou retire une carte de « Je cherche ».
func (g *Game) SetWish(pid, card string, on bool) error {
	g.mu.Lock()
	defer g.mu.Unlock()
	p := g.st.Players[pid]
	c := g.st.Cards[card]
	if p == nil || c == nil || c.Status != StatusPrinted {
		return ErrNotFound
	}
	p.Wish = without(p.Wish, card)
	if on {
		if len(p.Wish) >= 60 {
			return userErr(http.StatusConflict, "60 cartes au plus dans « Je cherche ».")
		}
		p.Wish = append(p.Wish, card)
	}
	g.dirty = true
	return nil
}

// Report reasons acceptées.
var ReportReasons = map[string]string{
	"moque":          "Se moque de quelqu’un",
	"reconnaissable": "Personne reconnaissable sans accord",
	"prive":          "Données privées",
	"choquant":       "Contenu choquant",
	"pasdrole":       "Pas drôle",
	"autre":          "Autre",
}

// ReportCard : signalement d'une carte en jeu (une fois par joueur).
func (g *Game) ReportCard(pid, card, reason string) error {
	if ReportReasons[reason] == "" {
		return ErrInvalid
	}
	g.mu.Lock()
	defer g.mu.Unlock()
	c := g.st.Cards[card]
	if g.st.Players[pid] == nil || c == nil || c.Status != StatusPrinted {
		return ErrNotFound
	}
	if c.Author == pid {
		return userErr(http.StatusConflict, "C’est ta carte.")
	}
	for _, r := range c.Reports {
		if r.Player == pid {
			return userErr(http.StatusConflict, "Tu as déjà signalé cette carte.")
		}
	}
	if len(c.Reports) >= 500 {
		return nil
	}
	c.Reports = append(c.Reports, Report{Player: pid, Reason: reason, At: g.now()})
	g.dirty = true
	return nil
}

func itoa(n int) string {
	if n == 0 {
		return "0"
	}
	neg := n < 0
	if neg {
		n = -n
	}
	var b [20]byte
	i := len(b)
	for n > 0 {
		i--
		b[i] = byte('0' + n%10)
		n /= 10
	}
	if neg {
		i--
		b[i] = '-'
	}
	return string(b[i:])
}
