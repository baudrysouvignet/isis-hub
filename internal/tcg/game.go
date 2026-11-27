package tcg

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"math"
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
		g.activity(now).Joined++
		created = true
	}
	if p := g.st.Players[id]; p != nil && g.IsAdmin != nil && p.Admin != g.IsAdmin(login) {
		p.Admin = !p.Admin
	}
	tok = randomToken()
	g.st.Sessions[hashToken(tok)] = session{Player: id, Expires: now.Add(sessionTTL)}
	g.dirty = true
	return tok, created, nil
}

// SyncAdmins : drapeau « administration » de chaque joueur d'après ADMIN_USERS, au démarrage, sans
// attendre sa prochaine connexion au jeu (Join le recalcule aussi). On compare des empreintes
// (loginKey) : aucun identifiant n'est écrit.
func (g *Game) SyncAdmins(logins []string) {
	g.mu.Lock()
	defer g.mu.Unlock()
	want := map[string]bool{}
	for _, l := range logins {
		if strings.TrimSpace(l) == "" {
			continue
		}
		if id, ok := g.st.Keys[g.loginKey(l)]; ok {
			want[id] = true
		}
	}
	for id, p := range g.st.Players {
		if p.Admin != want[id] {
			p.Admin = want[id]
			g.dirty = true
		}
	}
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

// ------------------------------------------------------------ boosters du jour

// Deux boosters de 4 cartes par cycle : le premier quand on veut, le second 3 h après le premier, et
// le cycle suivant 24 h après le premier booster du précédent (un second booster pas ouvert à
// temps ne se garde pas). Soit 8 cartes par jour pour qui passe deux fois.
const (
	boosterSize      = 4
	boostersPerCycle = 2
	boosterGap       = 3 * time.Hour
	boosterCycle     = 24 * time.Hour
	maxLimited       = 3 // exemplaires numérotés (ou répliques) au plus dans un booster de 4 cartes
)

// cycleOf : début du cycle en cours et boosters déjà ouverts dedans (0 : un nouveau cycle peut
// commencer maintenant).
func cycleOf(p *Player, now time.Time) (time.Time, int) {
	start, n := p.CycleAt, p.CycleN
	if start.IsZero() && !p.BoosterAt.IsZero() { // fichier d'avant les deux boosters : un déjà ouvert
		start, n = p.BoosterAt, 1
	}
	if start.IsZero() || !now.Before(start.Add(boosterCycle)) {
		return time.Time{}, 0
	}
	return start, n
}

// boosterNext : quand le prochain booster du joueur est prêt (zéro : maintenant).
func (g *Game) boosterNext(p *Player, now time.Time) time.Time {
	start, n := cycleOf(p, now)
	switch {
	case n == 0:
		return time.Time{}
	case n < boostersPerCycle:
		return start.Add(time.Duration(n) * boosterGap)
	}
	return start.Add(boosterCycle)
}

// OpenBooster ouvre le booster suivant du cycle : 4 cartes, plus rares au fil de leur rythme.
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
	start, n := cycleOf(p, now)
	if next := g.boosterNext(p, now); now.Before(next) {
		if n < boostersPerCycle {
			return nil, userErr(http.StatusConflict, "Ton second booster arrive à %s.", next.In(Paris).Format("15h04"))
		}
		return nil, userErr(http.StatusConflict, "Boosters du jour ouverts : le prochain arrive le %s.", next.In(Paris).Format("02/01 à 15h04"))
	}
	pulls := g.draw(now, boosterSize)
	if len(pulls) == 0 {
		return nil, userErr(http.StatusConflict, "Aucune carte à tirer pour l’instant.")
	}
	g.give(p, pulls, now)
	if n == 0 {
		start, n = now, 0
	}
	p.CycleAt, p.CycleN = start, n+1
	p.Booster, p.BoosterAt = DayKey(now), now
	p.LastDraw = pulls
	g.st.Boosters[DayKey(now)]++                // rythme des raretés (jour de jeu)
	g.activity(now).Opened++                    // statistiques (jour du calendrier)
	for i := len(g.st.Waves) - 1; i >= 0; i-- { // vague en cours : la dernière sortie
		if g.st.Waves[i].Printed {
			g.st.Waves[i].Opened++
			break
		}
	}
	g.dirty = true
	return pulls, nil
}

// OpenPack ouvre un booster bonus (récompenses de lancement), au même taux de tirage qu'un booster
// du jour : seule sa taille change.
func (g *Game) OpenPack(pid, id string) ([]Pull, error) {
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
	var pk *Pack
	for i := range p.Packs {
		if p.Packs[i].ID == id {
			pk = &p.Packs[i]
		}
	}
	switch {
	case pk == nil:
		return nil, ErrNotFound
	case !pk.Opened.IsZero():
		return nil, userErr(http.StatusConflict, "Ce booster bonus est déjà ouvert.")
	case !now.Before(pk.Until):
		return nil, userErr(http.StatusConflict, "Ce booster bonus a expiré.")
	}
	pulls := g.draw(now, pk.Size)
	if len(pulls) == 0 {
		return nil, userErr(http.StatusConflict, "Aucune carte à tirer pour l’instant.")
	}
	g.give(p, pulls, now)
	pk.Opened = now
	p.LastDraw = pulls
	g.activity(now).Packs++
	g.dirty = true
	return pulls, nil
}

// give : les cartes tirées entrent dans la collection (numéro d'exemplaire, ou réplique à part).
func (g *Game) give(p *Player, pulls []Pull, now time.Time) {
	for i := range pulls {
		c := g.st.Cards[pulls[i].Card]
		pulls[i].New = len(p.Owned[c.ID]) == 0 && p.Replicas[c.ID] == 0
		if c.Run > 0 && c.Issued >= c.Run {
			pulls[i].Replica = true
		}
		if pulls[i].Replica {
			// Tous les exemplaires numérotés sont partis : une réplique, rangée hors de Owned (aucun
			// échange, « doubles » ni correspondance ne le voit).
			if p.Replicas == nil {
				p.Replicas = map[string]int{}
			}
			p.Replicas[c.ID]++
			c.Replicas++
			g.activity(now).Replicas++
			continue
		}
		first := c.Issued == 0
		c.Issued++
		if c.Run > 0 {
			pulls[i].Serial = c.Issued
		}
		if first {
			c.FirstBy, c.FirstAt = p.ID, now
		}
		p.Owned[c.ID] = append(p.Owned[c.ID], pulls[i].Serial)
		if c.Rarity.tier() >= 2 {
			kind := "pull"
			if first {
				kind = "first"
			}
			g.addFeed(FeedItem{Kind: kind, Player: p.ID, Card: c.ID, At: now})
		}
	}
}

// draw : tirage de `size` cartes (sans les attribuer). Chaque exemplaire numéroté encore libre a une
// chance proportionnée au temps qui reste pour le distribuer (PaceDays après la sortie de sa vague)
// et au nombre de boosters ouverts chaque jour : les cartes numérotées se répartissent sur toute la
// période au lieu de partir le premier jour. Une carte dont tous les exemplaires sont tirés sort en
// réplique au même rythme moyen que ses vrais exemplaires (Run / (boosters par jour × PaceDays)). Le
// reste est fait de cartes communes. Un booster plus petit ou plus grand (bonus) garde le même taux
// par carte : les chances sont multipliées par size / 4, comme le plafond de cartes numérotées.
func (g *Game) draw(now time.Time, size int) []Pull {
	if size <= 0 {
		return nil
	}
	scale := float64(size) / boosterSize
	capLimited := max(1, int(math.Round(maxLimited*scale)))
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
				limited = append(limited, id)
				continue
			}
			communes = append(communes, id)
			if latest != nil && w.N == latest.N {
				latestCommunes = append(latestCommunes, id)
			}
		}
	}
	perDay := g.boostersPerDay(now)
	pace := float64(max(g.st.Season.PaceDays, 1))
	g.shuffle(limited)
	var pulls []Pull
	taken := map[string]bool{}
	for _, id := range limited {
		if len(pulls) >= capLimited {
			break
		}
		c := g.st.Cards[id]
		var p float64
		if c.Issued >= c.Run {
			p = float64(c.Run) / (perDay * pace) // réplique : le rythme moyen de la vraie
		} else {
			deadline := now
			if w := g.wave(c.Wave); w != nil {
				deadline = w.PrintedAt.Add(time.Duration(pace) * 24 * time.Hour)
			}
			days := deadline.Sub(now).Hours() / 24
			if days < 0.5 {
				days = 0.5
			}
			p = min(float64(c.Run-c.Issued)/(perDay*days), 0.6)
		}
		if g.chance(p * scale) {
			pulls = append(pulls, Pull{Card: id, Replica: c.Issued >= c.Run})
			taken[id] = true
		}
	}
	for len(pulls) < size {
		pool := communes
		if len(latestCommunes) > 0 && g.chance(0.5) {
			pool = latestCommunes
		}
		if len(pool) == 0 {
			// Plus de communes : les cartes numérotées restantes (ou leurs répliques) complètent le booster.
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
			c := g.st.Cards[id]
			pulls = append(pulls, Pull{Card: id, Replica: c.Issued >= c.Run})
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
	// Révélation : de la plus courante à la plus rare, la meilleure en dernier (une réplique avant une
	// vraie carte de même rareté).
	rank := func(p Pull) int {
		r := 2 * g.st.Cards[p.Card].Rarity.tier()
		if !p.Replica {
			r++
		}
		return r
	}
	sort.SliceStable(pulls, func(i, j int) bool { return rank(pulls[i]) < rank(pulls[j]) })
	return pulls
}

// boostersPerDay : boosters attendus par jour, pour le rythme des cartes numérotées. Le plus grand
// de : 10 ; la moyenne des 7 derniers jours ; ceux déjà ouverts aujourd'hui ; 1,5 par joueur venu
// ces 7 derniers jours (deux boosters par jour, pas toujours ouverts tous les deux), plus les
// boosters bonus valables maintenant (en boosters de 4 cartes). Ce plancher compte d'avance tout le
// monde le jour du lancement : sans lui, les premiers à ouvrir leur booster ce jour-là (aucun
// historique) tireraient l'essentiel des cartes numérotées.
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
	if days > 0 {
		est = max(est, float64(total)/float64(days))
	}
	est = max(est, float64(g.st.Boosters[today]))
	active, bonus := 0, 0
	for _, p := range g.st.Players {
		if now.Sub(p.Seen) < 7*24*time.Hour || now.Sub(p.BoosterAt) < 7*24*time.Hour {
			active++
		}
		for _, pk := range p.Packs {
			if now.Before(pk.Until) {
				bonus += pk.Size
			}
		}
	}
	return max(est, 0.75*boostersPerCycle*float64(active)+float64(bonus)/boosterSize)
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
	People           []string // personnes sur la photo indiquées par l'auteur (CleanPeople), à confirmer par l'administration
	Img, Thumb       string
	Video            string // extrait de 2 s (media.go), si la vague l'ouvre
	Music            string // morceau de la bibliothèque, si la vague l'ouvre
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

// keyOf : empreinte de l'identifiant du joueur pid ("" si inconnue).
func (g *Game) keyOf(pid string) string {
	for k, id := range g.st.Keys {
		if id == pid {
			return k
		}
	}
	return ""
}

// proposalsLeft : propositions encore possibles aujourd'hui, PAR COMPTE (tous appareils). On compte
// les envois du jour (State.Sent : retraits d'une carte en attente compris, et même après « Quitter
// le jeu » ; moins les cartes bloquées retirées aujourd'hui). Sans compteur du jour (fichier d'avant
// ce compteur), les cartes encore présentes créées aujourd'hui.
func (g *Game) proposalsLeft(pid string, now time.Time) int {
	today := calendarDay(now)
	n := 0
	if s, ok := g.st.Sent[g.keyOf(pid)]; ok && s.Day == today {
		n = s.N
	} else {
		for _, c := range g.st.Cards {
			if c.Author == pid && calendarDay(c.Created) == today {
				n++
			}
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
	if in.Video != "" || in.Music != "" {
		w := g.proposalWave(g.now())
		if in.Video != "" && (w == nil || !w.Video) {
			return "", userErr(http.StatusBadRequest, "Les vidéos ne sont pas ouvertes pour cette vague : envoie ta carte avec une photo.")
		}
		if in.Music != "" && (w == nil || !w.Music || g.track(in.Music) == nil) {
			return "", userErr(http.StatusBadRequest, "Cette musique n’est pas disponible pour cette vague.")
		}
	}
	g.st.NextNum++
	c := &Card{
		ID: "c" + itoa(g.st.NextNum), Num: g.st.NextNum, Author: pid,
		Title: title, Desc: desc, Cat: cat, Img: in.Img, Thumb: in.Thumb, Video: in.Video, Music: in.Music, Bytes: in.Bytes,
		Status: StatusPending, Created: g.now(),
	}
	c.Tags = g.newTags(pid, in.People) // aucun mail avant la validation (askable)
	g.st.Cards[c.ID] = c
	g.st.Used += in.Bytes
	g.activity(c.Created).Proposals++
	if k := g.keyOf(pid); k != "" { // envois du jour, par compte (proposalsLeft)
		today := calendarDay(c.Created)
		s := g.st.Sent[k]
		if s.Day != today {
			s = Sent{Day: today}
		}
		s.N++
		g.st.Sent[k] = s
	}
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
		if (c.Img == name || c.Thumb == name || c.Video == name) && c.Status != StatusBlocked && c.Status != StatusRemoved {
			return true
		}
	}
	for _, t := range g.st.Tracks {
		if t.File == name {
			return true // musique de la bibliothèque
		}
	}
	return false
}

// Withdraw : l'auteur retire une proposition pas encore validée (en attente ou bloquée). Une carte
// bloquée par la modération rend une proposition le jour même (le compteur du jour baisse d'un, sans
// passer sous 0) ; une carte en attente ne rend rien. Rend vrai si une proposition est rendue.
func (g *Game) Withdraw(pid, id string) (bool, error) {
	g.mu.Lock()
	c := g.st.Cards[id]
	if c == nil || c.Author != pid {
		g.mu.Unlock()
		return false, ErrNotFound
	}
	switch c.Status {
	case StatusPrinted, StatusRemoved:
		g.mu.Unlock()
		return false, userErr(http.StatusConflict, "Cette carte est déjà imprimée.")
	case StatusConsent, StatusAccepted:
		// Validée : elle est dans le jeu (jury, impression), son auteur ne la retire plus.
		g.mu.Unlock()
		return false, userErr(http.StatusConflict, "Ta carte est validée : elle est dans le jeu et ne peut plus être retirée.")
	}
	credited := false
	if c.Status == StatusBlocked {
		today := calendarDay(g.now())
		if k := g.keyOf(pid); k != "" {
			if s, ok := g.st.Sent[k]; ok && s.Day == today && s.N > 0 {
				s.N--
				g.st.Sent[k] = s
				credited = true
			}
		}
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
	return credited, nil
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

// Le jury se joue en « Tu préfères » : une série de duels porte sur les 5 cartes d'un bulletin, et
// les choix (7 duels au plus, tri de Ford-Johnson, web/js/tcg/duels.js) donnent le classement
// complet de ces 5 cartes, enregistré comme avant. Une série de plus chaque jour du jury.
const (
	ballotSize = 5
	maxBallots = 7
)

// parisDays : jours calendaires (Paris) de a à b.
func parisDays(a, b time.Time) int {
	ya, ma, da := a.In(Paris).Date()
	yb, mb, db := b.In(Paris).Date()
	return int(time.Date(yb, mb, db, 12, 0, 0, 0, time.UTC).Sub(time.Date(ya, ma, da, 12, 0, 0, 0, time.UTC)).Hours() / 24)
}

// seriesOpen : séries ouvertes à ce moment du jury (une le premier jour, une de plus chaque jour à
// minuit ; un jour manqué se rattrape).
func seriesOpen(w *Wave, now time.Time) int {
	return min(max(parisDays(w.JuryFrom, now)+1, 1), maxBallots)
}

// nextSeries : ouverture de la série suivante (minuit à Paris), ou zéro s'il n'y en aura plus.
func nextSeries(w *Wave, now time.Time) time.Time {
	if seriesOpen(w, now) >= maxBallots {
		return time.Time{}
	}
	p := now.In(Paris)
	next := time.Date(p.Year(), p.Month(), p.Day()+1, 0, 0, 0, 0, Paris)
	if !next.Before(w.JuryUntil) {
		return time.Time{}
	}
	return next
}

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

// Vote : classement d'un bulletin, une fois pour toutes (ni revu, ni refait).
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
	if len(b.Rank) > 0 {
		return userErr(http.StatusConflict, "Série déjà classée : reviens demain pour la suivante.")
	}
	// Points de (n-1) à -(n-1), par pas de 2.
	for i, id := range rank {
		if c := g.st.Cards[id]; c != nil {
			c.JuryPts += len(rank) - 1 - 2*i
			c.JuryVotes++
		}
	}
	g.activity(g.now()).Series++
	b.Rank = append([]string(nil), rank...)
	b.At = g.now()
	g.dirty = true
	return nil
}

// MoreBallot : série suivante, 5 autres cartes (une série par jour de jury, 7 au plus).
func (g *Game) MoreBallot(pid string) error {
	g.mu.Lock()
	defer g.mu.Unlock()
	p := g.st.Players[pid]
	if p == nil {
		return ErrNotFound
	}
	now := g.now()
	w := g.juryWave(now)
	if w == nil {
		return userErr(http.StatusConflict, "Le jury est fermé.")
	}
	bs := p.Ballots[w.N]
	switch {
	case len(bs) == 0 || len(bs[len(bs)-1].Rank) == 0:
		return userErr(http.StatusConflict, "Termine d’abord ta série de duels.")
	case len(bs) >= maxBallots:
		return userErr(http.StatusConflict, "Tu as joué toutes les séries de ce jury.")
	case len(bs) >= seriesOpen(w, now):
		return userErr(http.StatusConflict, "La série suivante ouvre demain.")
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

// TryCards : essai de « Tu préfères ? » pour l'administration, même sans jury ouvert (avant le
// lancement notamment) : 5 cartes validées, sinon en attente de l'accord ou de la validation.
// Rien n'est enregistré, et les joueurs n'y ont pas accès.
func (g *Game) TryCards(pid string) ([]CardView, error) {
	g.mu.Lock()
	defer g.mu.Unlock()
	p := g.st.Players[pid]
	if p == nil || !p.Admin {
		return nil, userErr(http.StatusForbidden, "Réservé à l’administration.")
	}
	var out []CardView
	for _, status := range []string{StatusAccepted, StatusConsent, StatusPending} {
		var ids []string
		for _, c := range g.st.Cards {
			if c.Status == status && !c.Purged && c.Img != "" {
				ids = append(ids, c.ID)
			}
		}
		g.shuffle(ids)
		for _, id := range ids {
			if len(out) < ballotSize {
				out = append(out, g.candidateView(g.st.Cards[id]))
			}
		}
	}
	if len(out) < 2 {
		return nil, userErr(http.StatusConflict, "Il faut au moins 2 cartes proposées pour essayer.")
	}
	return out, nil
}

// TryOpen : un booster d'essai pour l'administration (avant le lancement notamment), pour voir
// l'ouverture, les raretés, les répliques et le style des boosters bonus avec les vraies cartes.
// Raretés et numéros sont inventés ; rien n'est enregistré, rien n'entre dans une collection.
type TryOpen struct {
	Cards []CardView `json:"cards"`
	Pulls []Pull     `json:"pulls"`
	Pack  bool       `json:"pack,omitempty"` // booster bonus
}

func (g *Game) TryBooster(pid, kind string) (TryOpen, error) {
	g.mu.Lock()
	defer g.mu.Unlock()
	p := g.st.Players[pid]
	if p == nil || !p.Admin {
		return TryOpen{}, userErr(http.StatusForbidden, "Réservé à l’administration.")
	}
	type demo struct {
		r       Rarity
		run     int
		serial  int
		replica bool
	}
	plan := []demo{{Commune, 0, 0, false}, {Rare, 25, 12, false}, {Epique, 10, 0, true}, {Legendaire, 3, 2, false}}
	if kind == "pack" {
		plan = []demo{{Commune, 0, 0, false}, {Rare, 25, 0, true}, {Epique, 10, 4, false}, {Legendaire, 3, 0, true}, {Unique, 1, 1, false}}
	}
	var ids []string
	for _, c := range g.st.Cards {
		if c.Status != StatusBlocked && c.Status != StatusRemoved && !c.Purged && c.Img != "" {
			ids = append(ids, c.ID)
		}
	}
	g.shuffle(ids)
	// Pas assez de cartes proposées (tout début) : des cartes de démonstration complètent l'essai.
	demos := [][3]string{{"Le néon du couloir", "lieu", "Il clignote depuis la rentrée."}, {"Le café de 10 h", "moment", "La file devant la machine."}, {"Le bus de 18 h 12", "truc", "Toujours plein, toujours en retard."}, {"Le wifi du campus", "meme", "Connecté, sans Internet."}, {"La salle B204", "lieu", "Trop chaude en hiver."}}
	out := TryOpen{Pack: kind == "pack"}
	for i, d := range plan {
		var v CardView
		if i < len(ids) {
			c := g.st.Cards[ids[i]]
			v = g.candidateView(c)
			v.Author = g.pseudo(c.Author)
		} else {
			x := demos[i%len(demos)]
			v = CardView{Title: x[0], Cat: x[1], Desc: x[2] + " (carte d’essai)", Author: "Démo"}
		}
		v.ID = "try" + itoa(i+1)
		v.Rarity, v.Run, v.Wave, v.No, v.Total = d.r, d.run, 1, 140+i, 150
		if d.replica {
			v.Issued = d.run
		}
		out.Cards = append(out.Cards, v)
		out.Pulls = append(out.Pulls, Pull{Card: v.ID, Serial: d.serial, New: i%2 == 0, Replica: d.replica})
	}
	return out, nil
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
