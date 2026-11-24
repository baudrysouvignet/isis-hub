package tcg

// Personnes sur la photo.
//
// L'auteur indique, en proposant sa carte, les adresses universitaires des personnes visibles. Une
// fois la carte validée, l'administrateur leur écrit depuis SA messagerie (ISIS Hub, dans sa page) :
// un seul mail, tous les destinataires en copie cachée, au plus une fois tous les deux jours, et
// chaque adresse ne reçoit ce mail qu'une fois par carte. Chacun ouvre le TCG (« Mes apparitions »)
// et donne ou refuse son accord ; un refus retire la carte.
//
// Le serveur ne garde que l'empreinte de l'adresse (HMAC) et, jusqu'au départ du mail seulement,
// l'adresse chiffrée (AES-GCM, clé tirée de VAULT_PEPPER). Le serveur n'envoie aucun mail.

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"net/http"
	"regexp"
	"sort"
	"strings"
	"time"
)

const (
	maxTags      = 5              // personnes indiquées par carte
	mailingEvery = 48 * time.Hour // un envoi tous les deux jours au plus
	mailingBatch = time.Hour      // un envoi peut tenir en plusieurs mails (50 destinataires chacun)
	mailingChunk = 49             // copies cachées par mail (+ l'expéditeur en destinataire)
)

// Tag : une personne indiquée sur la photo d'une carte.
type Tag struct {
	Key      string    `json:"key"`               // HMAC(adresse)
	Enc      string    `json:"enc,omitempty"`     // adresse chiffrée, effacée dès le mail parti
	Notified time.Time `json:"notified,omitzero"` // mail d'accord parti
	Answer   string    `json:"answer,omitempty"`  // "ok" | "no"
	At       time.Time `json:"at,omitzero"`
	By       string    `json:"by,omitempty"` // joueur qui a répondu
}

// Mailing : dernier envoi des mails d'accord.
type Mailing struct {
	Start time.Time `json:"start,omitzero"` // début du dernier envoi
	Last  time.Time `json:"last,omitzero"`
	Sent  int       `json:"sent,omitempty"` // adresses prévenues en tout
}

// Adresses de l'université seulement (étudiants et personnels) : personne d'extérieur ne peut être visé.
var mailRE = regexp.MustCompile(`^[a-z0-9][a-z0-9._%+-]{0,63}@([a-z0-9-]+\.)*univ-jfc\.fr$`)

// CleanPeople : adresses saisies par l'auteur (séparées par des virgules, espaces ou retours).
func CleanPeople(raw string) ([]string, error) {
	var out []string
	seen := map[string]bool{}
	for _, a := range strings.FieldsFunc(strings.ToLower(raw), func(r rune) bool { return r == ',' || r == ';' || r == ' ' || r == '\n' || r == '\r' || r == '\t' }) {
		if a == "" || seen[a] {
			continue
		}
		if !mailRE.MatchString(a) {
			return nil, userErr(http.StatusBadRequest, "« %s » : seules les adresses de l’université (…@univ-jfc.fr) sont acceptées.", a)
		}
		seen[a] = true
		out = append(out, a)
	}
	if len(out) > maxTags {
		return nil, userErr(http.StatusBadRequest, "%d personnes au plus par carte.", maxTags)
	}
	return out, nil
}

func (g *Game) mailKey(addr string) string {
	m := hmac.New(sha256.New, g.key)
	m.Write([]byte("mail:" + strings.ToLower(strings.TrimSpace(addr))))
	return hex.EncodeToString(m.Sum(nil))
}

func (g *Game) mailAEAD() cipher.AEAD {
	m := hmac.New(sha256.New, g.key)
	m.Write([]byte("tcg-mail-chiffrement"))
	block, _ := aes.NewCipher(m.Sum(nil))
	aead, _ := cipher.NewGCM(block)
	return aead
}

func (g *Game) sealMail(addr string) string {
	a := g.mailAEAD()
	nonce := make([]byte, a.NonceSize())
	rand.Read(nonce)
	return base64.RawStdEncoding.EncodeToString(a.Seal(nonce, nonce, []byte(addr), []byte("tcg")))
}

func (g *Game) openMail(enc string) (string, error) {
	raw, err := base64.RawStdEncoding.DecodeString(enc)
	a := g.mailAEAD()
	if err != nil || len(raw) < a.NonceSize() {
		return "", errors.New("adresse illisible")
	}
	out, err := a.Open(nil, raw[:a.NonceSize()], raw[a.NonceSize():], []byte("tcg"))
	return string(out), err
}

// newTags : étiquettes d'une nouvelle carte (l'auteur qui s'indique lui-même est d'accord d'office).
func (g *Game) newTags(author string, people []string) []Tag {
	var mine string
	if p := g.st.Players[author]; p != nil {
		mine = p.MailKey
	}
	now := g.now()
	tags := make([]Tag, 0, len(people))
	for _, a := range people {
		k := g.mailKey(a)
		if k == mine && mine != "" {
			tags = append(tags, Tag{Key: k, Answer: "ok", At: now, By: author})
			continue
		}
		tags = append(tags, Tag{Key: k, Enc: g.sealMail(a)})
	}
	return tags
}

// LinkMail : rattache au joueur l'adresse de sa messagerie (transmise par sa page). Une adresse ne
// sert qu'à un compte, et un compte garde la sienne.
func (g *Game) LinkMail(pid, addr string) error {
	addr = strings.ToLower(strings.TrimSpace(addr))
	if !mailRE.MatchString(addr) {
		return userErr(http.StatusBadRequest, "Adresse de l’université attendue.")
	}
	g.mu.Lock()
	defer g.mu.Unlock()
	p := g.st.Players[pid]
	if p == nil {
		return ErrNotFound
	}
	k := g.mailKey(addr)
	if p.MailKey == k {
		return nil
	}
	if p.MailKey != "" {
		return userErr(http.StatusConflict, "Une autre adresse est déjà liée à ce compte du jeu.")
	}
	for _, o := range g.st.Players {
		if o.MailKey == k {
			return userErr(http.StatusConflict, "Cette adresse est déjà liée à un autre compte du jeu.")
		}
	}
	p.MailKey = k
	// L'auteur qui s'était indiqué lui-même sur sa photo est d'accord d'office.
	for _, c := range g.st.Cards {
		for i := range c.Tags {
			if t := &c.Tags[i]; c.Author == pid && t.Key == k && t.Answer == "" {
				t.Answer, t.At, t.By, t.Enc = "ok", g.now(), pid, ""
			}
		}
	}
	g.dirty = true
	return nil
}

// askable : carte dont on peut demander l'accord (validée par l'administration, pas encore écartée).
func askable(c *Card) bool { return c.Status == StatusAccepted || c.Status == StatusPrinted }

// AppearView : une carte où le joueur est indiqué.
type AppearView struct {
	ID       string    `json:"id"`
	Title    string    `json:"title"`
	Desc     string    `json:"desc"`
	Cat      string    `json:"cat"`
	Img      string    `json:"img"`
	Thumb    string    `json:"thumb"`
	Author   string    `json:"author"`
	Printed  bool      `json:"printed,omitempty"`
	Rarity   Rarity    `json:"rarity,omitempty"`
	Answer   string    `json:"answer,omitempty"`
	At       time.Time `json:"at,omitzero"`
	Retired  bool      `json:"retired,omitempty"` // retirée après le refus
	Notified time.Time `json:"notified,omitzero"`
}

func (g *Game) appearances(p *Player) []AppearView {
	out := []AppearView{}
	if p.MailKey == "" {
		return out
	}
	for _, c := range g.st.Cards {
		for _, t := range c.Tags {
			if t.Key != p.MailKey {
				continue
			}
			retired := t.Answer == "no"
			if !askable(c) && !retired {
				continue // pas encore validée (ou écartée pour une autre raison) : rien à montrer
			}
			v := AppearView{ID: c.ID, Title: c.Title, Desc: c.Desc, Cat: c.Cat, Author: g.pseudo(c.Author), Printed: c.Status == StatusPrinted, Rarity: c.Rarity, Answer: t.Answer, At: t.At, Retired: retired, Notified: t.Notified}
			if !retired {
				v.Img, v.Thumb = ImgURL(c.Img), ImgURL(c.Thumb)
			}
			if v.Author == "" {
				v.Author = "Ancien joueur"
			}
			out = append(out, v)
		}
	}
	sort.Slice(out, func(i, j int) bool {
		if (out[i].Answer == "") != (out[j].Answer == "") {
			return out[i].Answer == ""
		}
		return out[i].ID > out[j].ID
	})
	return out
}

// Consent : la personne indiquée accepte ou refuse la carte. Un refus la retire : bloquée si elle
// n'est pas encore imprimée, retirée du jeu sinon (ceux qui l'ont gardent « Carte retirée »).
func (g *Game) Consent(pid, id string, ok bool) error {
	g.mu.Lock()
	defer g.mu.Unlock()
	p, c := g.st.Players[pid], g.st.Cards[id]
	if p == nil || c == nil || p.MailKey == "" {
		return ErrNotFound
	}
	var t *Tag
	for i := range c.Tags {
		if c.Tags[i].Key == p.MailKey {
			t = &c.Tags[i]
		}
	}
	if t == nil {
		return ErrNotFound
	}
	if t.Answer == "no" {
		return userErr(http.StatusConflict, "Tu as refusé cette carte : elle est retirée.")
	}
	if !askable(c) {
		return userErr(http.StatusConflict, "Cette carte n’attend pas ton accord pour l’instant.")
	}
	now := g.now()
	t.At, t.By, t.Enc = now, pid, ""
	if ok {
		t.Answer = "ok"
		g.dirty = true
		return nil
	}
	t.Answer = "no"
	switch c.Status {
	case StatusAccepted:
		c.Status, c.Decided, c.Reason = StatusBlocked, now, "personne"
		c.Message = "Une personne présente sur la photo n’a pas donné son accord : la carte est retirée."
		g.forgetBallots(c.ID)
	case StatusPrinted:
		// En jeu : ceux qui l'ont gardent leur exemplaire, devenu « Accord retiré » (ni photo ni texte).
		c.Status, c.RemovedAt, c.ReportsOK, c.Reason = StatusRemoved, now, now, "personne"
	}
	g.dirty = true
	return nil
}

// ConsentView : où en sont les accords d'une carte (administration).
type ConsentView struct {
	Total   int      `json:"total"`
	OK      int      `json:"ok"`
	No      int      `json:"no"`
	Waiting int      `json:"waiting"` // prévenues, sans réponse
	ToSend  int      `json:"toSend"`  // pas encore prévenues
	By      []string `json:"by,omitempty"`
}

func (g *Game) consentOf(c *Card) *ConsentView {
	if len(c.Tags) == 0 {
		return nil
	}
	v := &ConsentView{Total: len(c.Tags)}
	for _, t := range c.Tags {
		switch {
		case t.Answer == "ok":
			v.OK++
			if ps := g.pseudo(t.By); ps != "" {
				v.By = append(v.By, ps)
			}
		case t.Answer == "no":
			v.No++
		case !t.Notified.IsZero():
			v.Waiting++
		default:
			v.ToSend++
		}
	}
	return v
}

// MailTarget : une adresse à prévenir au prochain envoi.
type MailTarget struct {
	Key   string `json:"key"`
	Email string `json:"email"`
	Cards int    `json:"cards"`
}

// MailingView : l'envoi des mails d'accord, pour l'administrateur.
type MailingView struct {
	Open    bool         `json:"open"`
	Next    time.Time    `json:"next,omitzero"`
	Last    time.Time    `json:"last,omitzero"`
	Chunk   int          `json:"chunk"`
	Targets []MailTarget `json:"targets"`
	Waiting int          `json:"waiting"`
	OK      int          `json:"ok"`
	No      int          `json:"no"`
	Sent    int          `json:"sent"`
}

func (g *Game) mailingOpen(now time.Time) (bool, time.Time) {
	m := g.st.Mailing
	if m.Start.IsZero() || now.Sub(m.Start) < mailingBatch {
		return true, time.Time{}
	}
	next := m.Start.Add(mailingEvery)
	return !now.Before(next), next
}

// MailingState : adresses à prévenir (en clair, pour l'administrateur seulement) et compteurs.
func (g *Game) MailingState() MailingView {
	g.mu.Lock()
	defer g.mu.Unlock()
	now := g.now()
	open, next := g.mailingOpen(now)
	v := MailingView{Open: open, Next: next, Last: g.st.Mailing.Last, Chunk: mailingChunk, Targets: []MailTarget{}, Sent: g.st.Mailing.Sent}
	idx := map[string]int{}
	for _, c := range g.st.Cards {
		for _, t := range c.Tags {
			switch {
			case t.Answer == "ok":
				v.OK++
			case t.Answer == "no":
				v.No++
			case !t.Notified.IsZero():
				v.Waiting++
			case askable(c) && t.Enc != "":
				if i, ok := idx[t.Key]; ok {
					v.Targets[i].Cards++
					continue
				}
				addr, err := g.openMail(t.Enc)
				if err != nil {
					continue
				}
				idx[t.Key] = len(v.Targets)
				v.Targets = append(v.Targets, MailTarget{Key: t.Key, Email: addr, Cards: 1})
			}
		}
	}
	sort.Slice(v.Targets, func(i, j int) bool { return v.Targets[i].Email < v.Targets[j].Email })
	return v
}

// MailingSent : le mail est parti pour ces adresses (l'administrateur l'a envoyé de sa messagerie).
// Elles ne recevront plus ce mail pour ces cartes, et leur adresse en clair est effacée.
func (g *Game) MailingSent(keys []string) (int, error) {
	if len(keys) == 0 || len(keys) > mailingChunk {
		return 0, ErrInvalid
	}
	g.mu.Lock()
	defer g.mu.Unlock()
	now := g.now()
	if open, next := g.mailingOpen(now); !open {
		return 0, userErr(http.StatusConflict, "Un mail est déjà parti il y a moins de deux jours : prochain envoi le %s.", next.In(Paris).Format("02/01 à 15h04"))
	}
	want := map[string]bool{}
	for _, k := range keys {
		want[k] = true
	}
	n := 0
	done := map[string]bool{}
	for _, c := range g.st.Cards {
		if !askable(c) {
			continue
		}
		for i := range c.Tags {
			t := &c.Tags[i]
			if want[t.Key] && t.Notified.IsZero() && t.Answer == "" {
				t.Notified, t.Enc = now, ""
				if !done[t.Key] {
					done[t.Key] = true
					n++
				}
			}
		}
	}
	if n == 0 {
		return 0, nil
	}
	if g.st.Mailing.Start.IsZero() || now.Sub(g.st.Mailing.Start) >= mailingBatch {
		g.st.Mailing.Start = now
	}
	g.st.Mailing.Last = now
	g.st.Mailing.Sent += n
	g.dirty = true
	return n, nil
}
