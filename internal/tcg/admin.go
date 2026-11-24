package tcg

import (
	"net/http"
	"sort"
	"strings"
	"time"
)

// Motifs de blocage (administration).
var BlockReasons = map[string]string{
	"injure":         "Injurieux ou dénigrant",
	"reconnaissable": "Personne reconnaissable sans accord",
	"prive":          "Données privées",
	"choquant":       "Contenu choquant ou illégal",
	"illisible":      "Photo illisible",
	"doublon":        "Doublon",
	"personne":       "Refusée par une personne sur la photo",
	"autre":          "Autre",
}

// Moderate : décision d'un administrateur sur une carte.
type Moderate struct {
	Action  string `json:"action"` // validate | block | edit | keep | remove | restore
	Reason  string `json:"reason,omitempty"`
	Message string `json:"message,omitempty"`
	Title   string `json:"title,omitempty"`
	Desc    string `json:"desc,omitempty"`
	Cat     string `json:"cat,omitempty"`
	People  string `json:"people,omitempty"` // validate / people : adresses des personnes sur la photo
	Key     string `json:"key,omitempty"`    // untag : personne à retirer de la carte
}

// ModerateCard applique la décision.
func (g *Game) ModerateCard(id string, m Moderate) error {
	g.mu.Lock()
	defer g.mu.Unlock()
	c := g.st.Cards[id]
	if c == nil {
		return ErrNotFound
	}
	now := g.now()
	switch m.Action {
	case "validate":
		// Validée par l'administration. Personnes indiquées sur la photo : la carte attend leur
		// accord à toutes (« consent ») et passe au jury d'elle-même après la dernière réponse.
		if c.Status != StatusPending && c.Status != StatusBlocked {
			return userErr(http.StatusConflict, "Cette carte n’est pas à valider.")
		}
		if c.Purged {
			return userErr(http.StatusConflict, "La photo de cette carte a déjà été effacée.")
		}
		if c.Reason == "personne" {
			return userErr(http.StatusConflict, "Une personne sur la photo a refusé : la carte ne peut pas être validée.")
		}
		people, err := CleanPeople(m.People)
		if err != nil {
			return err
		}
		// La liste confirmée par l'administration remplace celle de l'auteur.
		c.Tags = g.newTags(c.Author, people)
		c.Status, c.Decided, c.Reason, c.Message = StatusConsent, now, "", ""
		g.settleConsent(c)
	case "people":
		// Personnes ajoutées après coup (carte validée ou en jeu).
		if c.Status != StatusConsent && c.Status != StatusAccepted && c.Status != StatusPrinted {
			return userErr(http.StatusConflict, "Valide d’abord la carte.")
		}
		people, err := CleanPeople(m.People)
		if err != nil {
			return err
		}
		have := map[string]bool{}
		for _, t := range c.Tags {
			have[t.Key] = true
		}
		var fresh []string
		for _, a := range people {
			if !have[g.mailKey(a)] {
				fresh = append(fresh, a)
			}
		}
		if len(c.Tags)+len(fresh) > maxTags {
			return userErr(http.StatusBadRequest, "%d personnes au plus par carte.", maxTags)
		}
		c.Tags = append(c.Tags, g.newTags(c.Author, fresh)...)
		if c.Status == StatusAccepted {
			c.Status = StatusConsent
			g.forgetBallots(c.ID)
		}
		g.settleConsent(c)
	case "untag":
		// Ne plus attendre (ni demander) l'accord de cette personne, sans bloquer la carte.
		kept := c.Tags[:0]
		for _, t := range c.Tags {
			if t.Key != m.Key {
				kept = append(kept, t)
			}
		}
		if len(kept) == len(c.Tags) {
			return ErrNotFound
		}
		c.Tags = kept
		g.settleConsent(c)
	case "force":
		// Valider sans attendre les réponses manquantes.
		if c.Status != StatusConsent {
			return userErr(http.StatusConflict, "Cette carte n’attend pas d’accord.")
		}
		c.Status, c.Decided = StatusAccepted, now
	case "block":
		if c.Status != StatusPending && c.Status != StatusAccepted && c.Status != StatusConsent {
			return userErr(http.StatusConflict, "Seule une carte pas encore imprimée se bloque ; une carte en jeu se retire.")
		}
		if BlockReasons[m.Reason] == "" {
			return userErr(http.StatusBadRequest, "Choisis un motif.")
		}
		msg := cleanText(m.Message, true)
		if runes(msg) > 400 {
			return userErr(http.StatusBadRequest, "Message trop long (400 caractères au plus).")
		}
		c.Status, c.Decided, c.Reason, c.Message = StatusBlocked, now, m.Reason, msg
		g.forgetBallots(c.ID)
	case "edit":
		title, desc, cat, err := CleanCardText(m.Title, m.Desc, m.Cat)
		if err != nil {
			return err
		}
		c.Title, c.Desc, c.Cat, c.Edited = title, desc, cat, true
	case "keep":
		c.ReportsOK = now
	case "remove":
		if c.Status != StatusPrinted {
			return userErr(http.StatusConflict, "Cette carte n’est pas en jeu.")
		}
		c.Status, c.RemovedAt, c.ReportsOK = StatusRemoved, now, now
	case "restore":
		if c.Status != StatusRemoved {
			return userErr(http.StatusConflict, "Cette carte n’est pas retirée.")
		}
		if c.Reason == "personne" {
			return userErr(http.StatusConflict, "Une personne sur la photo a retiré son accord : la carte ne peut pas revenir en jeu.")
		}
		if c.Purged {
			return userErr(http.StatusConflict, "Retirée depuis plus de 30 jours : sa photo a été effacée, elle ne peut plus revenir en jeu.")
		}
		c.Status, c.RemovedAt = StatusPrinted, time.Time{}
	default:
		return ErrInvalid
	}
	g.dirty = true
	return nil
}

// forgetBallots : une carte bloquée sort des bulletins non validés.
func (g *Game) forgetBallots(id string) {
	for _, p := range g.st.Players {
		for n, bs := range p.Ballots {
			for i := range bs {
				if len(bs[i].Rank) == 0 {
					bs[i].Cards = without(bs[i].Cards, id)
				}
			}
			p.Ballots[n] = bs
		}
	}
}

// SeasonInput : réglages modifiables.
type SeasonInput struct {
	Enabled    bool           `json:"enabled"`
	Name       string         `json:"name"`
	Runs       map[Rarity]int `json:"runs"`
	PaceDays   int            `json:"paceDays"`
	PerDay     int            `json:"perDay"`
	AutoWeekly bool           `json:"autoWeekly"`
}

// SaveSeason enregistre les réglages du jeu.
func (g *Game) SaveSeason(in SeasonInput) error {
	name := cleanText(in.Name, false)
	if runes(name) < 2 || runes(name) > 30 {
		return userErr(http.StatusBadRequest, "Nom de saison : 2 à 30 caractères.")
	}
	if in.PaceDays < 1 || in.PaceDays > 90 || in.PerDay < 1 || in.PerDay > 10 {
		return userErr(http.StatusBadRequest, "Réglages hors limites.")
	}
	runs := map[Rarity]int{Commune: 0}
	for _, r := range []Rarity{Rare, Epique, Legendaire, Unique} {
		n := in.Runs[r]
		if n < 1 || n > 1000 {
			return userErr(http.StatusBadRequest, "Exemplaires par rareté : de 1 à 1000.")
		}
		runs[r] = n
	}
	if !(runs[Unique] <= runs[Legendaire] && runs[Legendaire] <= runs[Epique] && runs[Epique] <= runs[Rare]) {
		return userErr(http.StatusBadRequest, "Une rareté plus haute a moins d’exemplaires.")
	}
	g.mu.Lock()
	defer g.mu.Unlock()
	g.st.Season = Season{Enabled: in.Enabled, Name: name, Runs: runs, PaceDays: in.PaceDays, PerDay: in.PerDay, AutoWeekly: in.AutoWeekly}
	g.dirty = true
	return nil
}

// MutePlayer suspend (ou rétablit) les propositions d'un joueur.
func (g *Game) MutePlayer(pid string, on bool) error {
	g.mu.Lock()
	defer g.mu.Unlock()
	p := g.st.Players[pid]
	if p == nil {
		return ErrNotFound
	}
	p.Muted = on
	g.dirty = true
	return nil
}

// ------------------------------------------------------------ vues de l'administration

// AdminCard : une carte telle que la voit la modération.
type AdminCard struct {
	ID       string         `json:"id"`
	Num      int            `json:"num"`
	Title    string         `json:"title"`
	Desc     string         `json:"desc"`
	Cat      string         `json:"cat"`
	Img      string         `json:"img"`
	Thumb    string         `json:"thumb"`
	Status   string         `json:"status"`
	Created  time.Time      `json:"created"`
	Decided  time.Time      `json:"decided,omitzero"`
	Reason   string         `json:"reason,omitempty"`
	Message  string         `json:"message,omitempty"`
	Edited   bool           `json:"edited,omitempty"`
	Author   AdminAuthor    `json:"author"`
	Wave     int            `json:"wave,omitempty"`
	No       int            `json:"no,omitempty"`
	Total    int            `json:"total,omitempty"`
	Rarity   Rarity         `json:"rarity,omitempty"`
	Run      int            `json:"run,omitempty"`
	Issued   int            `json:"issued,omitempty"`
	Reports  map[string]int `json:"reports,omitempty"` // motif → nombre (non examinés)
	ReportN  int            `json:"reportN,omitempty"`
	LastRep  time.Time      `json:"lastReport,omitzero"`
	Jury     float64        `json:"jury"`
	JuryN    int            `json:"juryN"`
	Flags    []string       `json:"flags,omitempty"` // points à vérifier, repérés automatiquement
	Planned  Rarity         `json:"planned,omitempty"`
	Override bool           `json:"override,omitempty"`
	Consent  *ConsentView   `json:"consent,omitempty"`  // accords des personnes sur la photo
	Proposed []string       `json:"proposed,omitempty"` // carte à valider : personnes indiquées par l'auteur (à confirmer)
}

// AdminAuthor : auteur d'une carte (pseudo et historique, jamais l'identifiant universitaire).
type AdminAuthor struct {
	ID        string `json:"id"`
	Pseudo    string `json:"pseudo"`
	Validated int    `json:"validated"`
	Blocked   int    `json:"blocked"`
	Muted     bool   `json:"muted,omitempty"`
}

func (g *Game) adminCard(c *Card, img func(string) string) AdminCard {
	a := AdminCard{
		ID: c.ID, Num: c.Num, Title: c.Title, Desc: c.Desc, Cat: c.Cat, Img: img(c.Img), Thumb: img(c.Thumb),
		Status: c.Status, Created: c.Created, Decided: c.Decided, Reason: c.Reason, Message: c.Message, Edited: c.Edited,
		Wave: c.Wave, No: c.No, Rarity: c.Rarity, Run: c.Run, Issued: c.Issued, Jury: juryScore(c), JuryN: c.JuryVotes,
	}
	if c.Status == StatusPending || c.Status == StatusAccepted || c.Status == StatusConsent {
		a.Flags = Flags(c.Title, c.Desc)
	}
	a.Consent = g.consentOf(c)
	if c.Status == StatusPending || c.Status == StatusBlocked {
		for _, t := range c.Tags {
			if addr, err := g.openMail(t.Enc); err == nil {
				a.Proposed = append(a.Proposed, addr)
			}
		}
	}
	if w := g.wave(c.Wave); w != nil {
		a.Total = len(w.Cards)
	}
	if p := g.st.Players[c.Author]; p != nil {
		a.Author = AdminAuthor{ID: p.ID, Pseudo: p.Pseudo, Muted: p.Muted}
		for _, x := range g.st.Cards {
			if x.Author != p.ID {
				continue
			}
			switch x.Status {
			case StatusAccepted, StatusConsent, StatusPrinted, StatusRemoved:
				a.Author.Validated++
			case StatusBlocked:
				a.Author.Blocked++
			}
		}
	} else {
		a.Author.Pseudo = "Ancien joueur"
	}
	for _, r := range c.Reports {
		if r.At.After(c.ReportsOK) {
			if a.Reports == nil {
				a.Reports = map[string]int{}
			}
			a.Reports[r.Reason]++
			a.ReportN++
			if r.At.After(a.LastRep) {
				a.LastRep = r.At
			}
		}
	}
	return a
}

// AdminCards : cartes d'une file (pending, reports, validated, blocked, printed, removed).
func (g *Game) AdminCards(filter string, img func(string) string) []AdminCard {
	g.mu.Lock()
	defer g.mu.Unlock()
	out := []AdminCard{}
	for _, c := range g.st.Cards {
		ok := false
		switch filter {
		case "pending":
			ok = c.Status == StatusPending
		case "consent":
			ok = c.Status == StatusConsent
		case "validated":
			ok = c.Status == StatusAccepted || c.Status == StatusPrinted
		case "blocked":
			ok = c.Status == StatusBlocked
		case "removed":
			ok = c.Status == StatusRemoved
		case "reports":
			if c.Status == StatusPrinted {
				for _, r := range c.Reports {
					if r.At.After(c.ReportsOK) {
						ok = true
						break
					}
				}
			}
		}
		if ok {
			out = append(out, g.adminCard(c, img))
		}
	}
	sort.Slice(out, func(i, j int) bool {
		switch filter {
		case "pending":
			return out[i].Created.Before(out[j].Created) // la plus ancienne d'abord
		case "reports":
			if out[i].ReportN != out[j].ReportN {
				return out[i].ReportN > out[j].ReportN
			}
			return out[i].LastRep.After(out[j].LastRep)
		default:
			return out[i].Decided.After(out[j].Decided)
		}
	})
	return out
}

// Overview : chiffres et réglages pour l'administration.
type Overview struct {
	Phase   string         `json:"phase"`
	Season  Season         `json:"season"`
	Waves   []WaveView     `json:"waves"`
	Counts  map[string]int `json:"counts"`
	Players int            `json:"players"`
	Active  int            `json:"active"`  // joueurs vus ces 7 derniers jours
	Today   int            `json:"today"`   // boosters ouverts aujourd'hui
	Used    int64          `json:"used"`    // octets d'images
	Storage string         `json:"storage"` // r2 | local
	Juries  map[int]int    `json:"juries"`  // vague → jurés ayant validé
	Now     time.Time      `json:"now"`
}

// AdminOverview : tableau de bord de l'administration.
func (g *Game) AdminOverview() Overview {
	g.mu.Lock()
	defer g.mu.Unlock()
	now := g.now()
	o := Overview{Phase: g.phase(), Season: g.st.Season, Counts: map[string]int{}, Players: len(g.st.Players), Used: g.st.Used, Juries: map[int]int{}, Now: now}
	if g.Blobs != nil {
		o.Storage = g.Blobs.Kind()
	}
	for _, c := range g.st.Cards {
		o.Counts[c.Status]++
		if c.Status == StatusPrinted {
			for _, r := range c.Reports {
				if r.At.After(c.ReportsOK) {
					o.Counts["reports"]++
					break
				}
			}
		}
	}
	for _, p := range g.st.Players {
		if now.Sub(p.Seen) < 7*24*time.Hour {
			o.Active++
		}
		for n, bs := range p.Ballots {
			for _, b := range bs {
				if len(b.Rank) > 0 {
					o.Juries[n]++
					break
				}
			}
		}
	}
	o.Today = g.st.Boosters[DayKey(now)]
	o.Waves = g.waveViews()
	return o
}

// AdminPlayers : joueurs, pour suspendre les propositions d'un auteur.
func (g *Game) AdminPlayer(pid string) (AdminAuthor, bool) {
	g.mu.Lock()
	defer g.mu.Unlock()
	p := g.st.Players[pid]
	if p == nil {
		return AdminAuthor{}, false
	}
	return AdminAuthor{ID: p.ID, Pseudo: p.Pseudo, Muted: p.Muted}, true
}

// flagWords : repérés dans le texte d'une proposition, à vérifier par un humain (aide, pas filtre).
var flagWords = []string{"pire", "nul", "nulle", "moche", "con", "conne", "débile", "idiot", "idiote", "gros", "grosse", "naze", "bouffon", "clochard", "pute", "salope", "pd", "tg", "ntm", "fdp", "enculé", "connard", "connasse", "attardé", "mongol", "handicapé", "laid", "laide", "sale", "puant", "puante", "ivre", "bourré", "bourrée", "drogue", "suicide"}

// Flags : points à vérifier, repérés automatiquement (l'administrateur juge).
func Flags(title, desc string) []string {
	text := strings.ToLower(title + " " + desc)
	var out []string
	if strings.Contains(text, "sait de qui") || strings.Contains(text, "devinez qui") || strings.Contains(text, "on sait qui") {
		out = append(out, "Vise peut-être une personne identifiable")
	}
	words := strings.FieldsFunc(text, func(r rune) bool {
		return !(r >= 'a' && r <= 'z' || r >= 'à' && r <= 'ÿ' || r == '\'')
	})
	seen := map[string]bool{}
	for _, w := range words {
		for _, f := range flagWords {
			if w == f && !seen[w] {
				seen[w] = true
				out = append(out, "Mot à vérifier : « "+w+" »")
			}
		}
	}
	for _, w := range strings.Fields(title + " " + desc) {
		if strings.Contains(w, "@") && strings.Contains(w, ".") {
			out = append(out, "Adresse mail : données privées ?")
			break
		}
	}
	digits := 0
	for _, r := range title + desc {
		if r >= '0' && r <= '9' {
			digits++
		} else if r != ' ' && r != '.' {
			if digits >= 9 {
				break
			}
			digits = 0
		}
	}
	if digits >= 9 {
		out = append(out, "Numéro de téléphone : données privées ?")
	}
	return out
}
