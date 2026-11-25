package tcg

import (
	"bytes"
	"context"
	"encoding/binary"
	"encoding/json"
	"fmt"
	"image"
	"image/color"
	"image/jpeg"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"
)

type clock struct {
	mu sync.Mutex
	t  time.Time
}

func (c *clock) now() time.Time { c.mu.Lock(); defer c.mu.Unlock(); return c.t }
func (c *clock) add(d time.Duration) {
	c.mu.Lock()
	c.t = c.t.Add(d)
	c.mu.Unlock()
}

func newGame(t *testing.T) (*Game, *clock, string) {
	t.Helper()
	dir := t.TempDir()
	g, err := Open(dir, "poivre-de-test", Local{Dir: filepath.Join(dir, "img")})
	if err != nil {
		t.Fatal(err)
	}
	c := &clock{t: time.Date(2026, 11, 24, 10, 0, 0, 0, Paris)}
	g.now = c.now
	return g, c, dir
}

func mustJoin(t *testing.T, g *Game, login, pseudo string) string {
	t.Helper()
	tok, _, err := g.Join(login, pseudo)
	if err != nil {
		t.Fatal(err)
	}
	return g.PlayerID(tok)
}

// L'identifiant universitaire n'est jamais écrit : seule son empreinte (HMAC) l'est.
func TestJoinKeepsNoLogin(t *testing.T) {
	g, _, dir := newGame(t)
	a := mustJoin(t, g, "lmartin", "Léa M.")
	tok, created, err := g.Join("LMartin ", "Autre nom")
	if err != nil || created {
		t.Fatalf("second appareil : created=%v err=%v", created, err)
	}
	if g.PlayerID(tok) != a {
		t.Fatal("même identifiant, autre joueur")
	}
	if err := g.Flush(); err != nil {
		t.Fatal(err)
	}
	raw, _ := os.ReadFile(filepath.Join(dir, "tcg.json"))
	if bytes.Contains(bytes.ToLower(raw), []byte("lmartin")) {
		t.Fatal("identifiant en clair dans tcg.json")
	}
	if !bytes.Contains(raw, []byte("Léa M.")) {
		t.Fatal("pseudo absent")
	}
	for _, bad := range []string{"a", "Le Boss du 3e", "xX_Dark_Xx", "léa M.", "Léa MARTIN"} {
		if _, _, err := g.Join("x"+bad, bad); err == nil {
			t.Fatalf("nom %q accepté : seul « Prénom N. » l'est", bad)
		}
	}
	if _, _, err := g.Join("x", "a"); err == nil {
		t.Fatal("pseudo trop court accepté")
	}
}

func propose(t *testing.T, g *Game, pid, title string) string {
	t.Helper()
	id, err := g.Propose(pid, NewProposal{Title: title, Desc: "Une description assez longue.", Cat: "meme", Img: strings.Repeat("a", 40) + ".webp", Thumb: strings.Repeat("b", 40) + ".webp", Bytes: 100})
	if err != nil {
		t.Fatal(err)
	}
	return id
}

func TestProposalQuotaAndModeration(t *testing.T) {
	g, clk, _ := newGame(t)
	g.st.Season.Enabled = true
	g.SaveWave(WaveInput{ReleaseAt: clk.now().Add(14 * 24 * time.Hour), Size: 10})
	a := mustJoin(t, g, "a", "Alice A.")
	for i := 0; i < 3; i++ {
		propose(t, g, a, fmt.Sprintf("Carte %d", i))
	}
	if _, err := g.Propose(a, NewProposal{Title: "Quatrième", Desc: "Encore une carte.", Cat: "lieu"}); err == nil {
		t.Fatal("4e proposition du jour acceptée")
	}
	clk.add(24 * time.Hour)
	id := propose(t, g, a, "Le lendemain")
	if err := g.ModerateCard(id, Moderate{Action: "block", Reason: "injure", Message: "Propose une autre version !"}); err != nil {
		t.Fatal(err)
	}
	v, _ := g.PlayerView(a)
	var found bool
	for _, p := range v.Proposals {
		if p.ID == id {
			found = p.Status == StatusBlocked && p.Message != "" && p.Reason == "Injurieux ou dénigrant"
		}
	}
	if !found {
		t.Fatal("blocage invisible pour l'auteur")
	}
	if err := g.ModerateCard(id, Moderate{Action: "edit", Title: "Corrigé", Desc: "Texte corrigé ici.", Cat: "truc"}); err != nil {
		t.Fatal(err)
	}
	if flags := Flags("Le pire prof", "Tout le monde sait de qui on parle."); len(flags) < 2 {
		t.Fatalf("points à vérifier : %v", flags)
	}
}

// Du jury au booster : classement, impression avec raretés, exemplaires numérotés jamais dépassés.
func TestJuryPrintAndBoosters(t *testing.T) {
	g, clk, _ := newGame(t)
	g.st.Season.Enabled = true
	start := clk.now()
	if _, err := g.SaveWave(WaveInput{ProposalsUntil: start.Add(5 * 24 * time.Hour), JuryFrom: start.Add(6 * 24 * time.Hour), JuryUntil: start.Add(12 * 24 * time.Hour), ReleaseAt: start.Add(13 * 24 * time.Hour), Size: 20}); err != nil {
		t.Fatal(err)
	}
	var players []string
	for i := 0; i < 12; i++ {
		players = append(players, mustJoin(t, g, fmt.Sprintf("etu%d", i), "Joueur J."))
	}
	var cards []string
	for i := 0; i < 24; i++ {
		id := propose(t, g, players[i%len(players)], fmt.Sprintf("Carte %02d", i))
		if err := g.ModerateCard(id, Moderate{Action: "validate"}); err != nil {
			t.Fatal(err)
		}
		cards = append(cards, id)
		if i%3 == 2 {
			clk.add(24 * time.Hour / 4) // quotas : 3 par jour
		}
	}
	if v, _ := g.PlayerView(players[0]); v.Phase != "soon" || v.Jury != nil {
		t.Fatalf("avant le jury : phase %s, jury %v", v.Phase, v.Jury)
	}
	clk.t = start.Add(6*24*time.Hour + time.Hour)
	for _, pid := range players {
		v, _ := g.PlayerView(pid)
		if v.Jury == nil || len(v.Jury.Ballots) != 1 {
			t.Fatal("pas de bulletin pendant le jury")
		}
		b := v.Jury.Ballots[0]
		var rank []string
		for _, c := range b.Cards {
			if g.st.Cards[c.ID].Author == pid {
				t.Fatal("sa propre carte au jury")
			}
			rank = append(rank, c.ID)
		}
		if err := g.Vote(pid, v.Jury.Wave, 0, rank); err != nil {
			t.Fatal(err)
		}
		if err := g.Vote(pid, v.Jury.Wave, 0, rank); err != nil { // modifiable
			t.Fatal(err)
		}
	}
	// Statistiques : chaque juré compté une fois, une série refaite ne compte pas deux fois.
	if s := g.AdminStats(); s.Jurors != 12 || s.Series != 12 || s.Waves[0].Jurors != 12 || s.Waves[0].Series != 12 || s.Days[len(s.Days)-1].Series != 12 {
		t.Fatalf("statistiques du jury : %+v", s)
	}
	clk.t = start.Add(13*24*time.Hour + time.Minute)
	g.Tick()
	w := g.st.Waves[0]
	if !w.Printed || len(w.Cards) != 20 {
		t.Fatalf("vague : imprimée=%v cartes=%d", w.Printed, len(w.Cards))
	}
	count := map[Rarity]int{}
	for i, id := range w.Cards {
		c := g.st.Cards[id]
		count[c.Rarity]++
		if c.No != i+1 || c.Status != StatusPrinted {
			t.Fatal("numérotation")
		}
		if i > 0 && g.st.Cards[w.Cards[i-1]].Rarity.tier() > c.Rarity.tier() {
			t.Fatal("les plus rares ne sont pas en fin de vague")
		}
	}
	want := mixFor(20)
	for r, n := range want {
		if count[r] != n {
			t.Fatalf("rareté %s : %d, attendu %d", r, count[r], n)
		}
	}
	// 4 cartes validées non retenues restent candidates pour la vague suivante.
	left := 0
	for _, c := range g.st.Cards {
		if c.Status == StatusAccepted {
			left++
		}
	}
	if left != 4 {
		t.Fatalf("candidates restantes : %d", left)
	}
	// 40 jours de boosters pour tout le monde : jamais plus d'exemplaires que le tirage.
	seen := map[Copy]bool{}
	for day := 0; day < 40; day++ {
		for _, pid := range players {
			pulls, err := g.OpenBooster(pid)
			if err != nil {
				t.Fatalf("jour %d : %v", day, err)
			}
			if len(pulls) != 5 {
				t.Fatalf("booster de %d cartes", len(pulls))
			}
			if _, err := g.OpenBooster(pid); err == nil {
				t.Fatal("deux boosters le même jour")
			}
			for _, p := range pulls {
				c := g.st.Cards[p.Card]
				if c.Run > 0 {
					k := Copy{p.Card, p.Serial}
					if seen[k] || p.Serial < 1 || p.Serial > c.Run {
						t.Fatalf("exemplaire %v invalide ou en double", k)
					}
					seen[k] = true
				}
			}
		}
		clk.add(24 * time.Hour)
	}
	for _, id := range w.Cards {
		c := g.st.Cards[id]
		if c.Run > 0 && c.Issued > c.Run {
			t.Fatalf("%s : %d tirés sur %d", c.Title, c.Issued, c.Run)
		}
	}
	// Après PaceDays, les exemplaires rares ont été distribués.
	issued, total := 0, 0
	for _, id := range w.Cards {
		if c := g.st.Cards[id]; c.Run > 0 {
			issued += c.Issued
			total += c.Run
		}
	}
	if issued < total*8/10 {
		t.Fatalf("exemplaires rares distribués : %d / %d", issued, total)
	}
}

func liveGame(t *testing.T) (*Game, *clock, []string) {
	g, clk, _ := newGame(t)
	g.st.Season.Enabled = true
	g.SaveWave(WaveInput{ReleaseAt: clk.now().Add(time.Hour), Size: 10})
	a := mustJoin(t, g, "a", "Alice A.")
	b := mustJoin(t, g, "b", "Bob B.")
	for i := 0; i < 10; i++ {
		owner := a
		if i%2 == 1 {
			owner = b
		}
		if i%3 == 2 {
			clk.add(9 * time.Hour)
		}
		id := propose(t, g, owner, fmt.Sprintf("Carte %d", i))
		g.ModerateCard(id, Moderate{Action: "validate"})
	}
	if err := g.PrintNow(1); err != nil {
		t.Fatal(err)
	}
	return g, clk, []string{a, b}
}

func TestTrade(t *testing.T) {
	g, _, ps := liveGame(t)
	a, b := ps[0], ps[1]
	g.OpenBooster(a)
	g.OpenBooster(b)
	pa, pb := g.st.Players[a], g.st.Players[b]
	var ga, gb Copy
	for id, s := range pa.Owned {
		ga = Copy{id, s[0]}
	}
	for id, s := range pb.Owned {
		gb = Copy{id, s[0]}
	}
	code, _, err := g.NewTrade(a, b)
	if err != nil {
		t.Fatal(err)
	}
	if v, _ := g.PlayerView(b); len(v.Invites) != 1 || v.Invites[0].From != "Alice A." {
		t.Fatal("invitation absente")
	}
	if err := g.JoinTrade(a, code); err == nil {
		t.Fatal("rejoindre son propre échange")
	}
	if err := g.JoinTrade(b, code); err != nil {
		t.Fatal(err)
	}
	if err := g.SetOffer(a, code, []Copy{{"inconnue", 0}}); err == nil {
		t.Fatal("carte inconnue acceptée")
	}
	if err := g.SetOffer(a, code, []Copy{ga}); err != nil {
		t.Fatal(err)
	}
	st, _, _ := g.TradeView(b, code)
	if len(st.Them.Offer) != 1 || st.Them.Pseudo != "Alice A." {
		t.Fatal("offre invisible pour l'autre")
	}
	if err := g.SetReady(b, code, st.OfferV, true); err != nil {
		t.Fatal(err)
	}
	if err := g.SetOffer(b, code, []Copy{gb}); err != nil {
		t.Fatal(err)
	}
	if err := g.SetReady(a, code, st.OfferV, true); err == nil {
		t.Fatal("« prêt » sur une offre périmée accepté")
	}
	st, _, _ = g.TradeView(a, code)
	if st.Them.Ready || st.Me.Ready {
		t.Fatal("offre modifiée : les « prêt » auraient dû être annulés")
	}
	beforeA, beforeB := len(pa.Owned[gb.Card]), len(pb.Owned[ga.Card])
	g.SetReady(a, code, st.OfferV, true)
	if err := g.SetReady(b, code, st.OfferV, true); err != nil {
		t.Fatal(err)
	}
	st, _, _ = g.TradeView(a, code)
	if st.Status != "done" || len(st.Got) != 1 || len(st.Gave) != 1 {
		t.Fatalf("échange : %+v", st)
	}
	if ga.Card != gb.Card && (len(pa.Owned[gb.Card]) != beforeA+1 || len(pb.Owned[ga.Card]) != beforeB+1) {
		t.Fatal("cartes non échangées")
	}
	if len(pa.Trades) != 1 || len(pb.Trades) != 1 {
		t.Fatal("historique")
	}
	if s := g.AdminStats(); s.Trades != 1 || s.Days[len(s.Days)-1].Trades != 1 {
		t.Fatalf("échanges dans les statistiques : %d", s.Trades)
	}
}

func TestWaitTradeWakesUp(t *testing.T) {
	g, _, ps := liveGame(t)
	code, _, _ := g.NewTrade(ps[0], "")
	st, _, _ := g.TradeView(ps[0], code)
	done := make(chan TradeState)
	go func() {
		s, _ := g.WaitTrade(context.Background(), ps[0], code, st.V, 5*time.Second)
		done <- s
	}()
	time.Sleep(50 * time.Millisecond)
	g.JoinTrade(ps[1], code)
	select {
	case s := <-done:
		if s.Status != "open" || s.Them == nil {
			t.Fatal("état après réveil")
		}
	case <-time.After(2 * time.Second):
		t.Fatal("attente non réveillée")
	}
}

// ------------------------------------------------------------ images

func jpegWithExif(t *testing.T, w, h int) []byte { return jpegSeed(t, w, h, 120) }

// jpegSeed : comme jpegWithExif, mais une image différente (donc un fichier différent) par graine.
func jpegSeed(t *testing.T, w, h int, seed uint8) []byte {
	img := image.NewRGBA(image.Rect(0, 0, w, h))
	for y := 0; y < h; y++ {
		for x := 0; x < w; x++ {
			img.Set(x, y, color.RGBA{uint8(x), uint8(y), seed, 255})
		}
	}
	var buf bytes.Buffer
	jpeg.Encode(&buf, img, &jpeg.Options{Quality: 80})
	raw := buf.Bytes()
	exif := append([]byte{0xFF, 0xE1, 0, 0}, []byte("Exif\x00\x00GPS-48.8566N-2.3522E")...)
	binary.BigEndian.PutUint16(exif[2:], uint16(len(exif)-2))
	return append(append(append([]byte{}, raw[:2]...), exif...), raw[2:]...)
}

func TestImageCleaning(t *testing.T) {
	raw := jpegWithExif(t, 320, 240)
	if !bytes.Contains(raw, []byte("GPS")) {
		t.Fatal("préparation")
	}
	im, err := CheckImage(raw, MaxThumbBytes, 320, 240)
	if err != nil {
		t.Fatal(err)
	}
	if bytes.Contains(im.Data, []byte("GPS")) || im.Ctype != "image/jpeg" || !NameRE.MatchString(im.Name) {
		t.Fatal("EXIF gardé ou nom invalide")
	}
	if _, err := jpeg.Decode(bytes.NewReader(im.Data)); err != nil {
		t.Fatal("JPEG nettoyé illisible :", err)
	}
	if _, err := CheckImage(raw, MaxThumbBytes, 960, 720); err == nil {
		t.Fatal("mauvaises dimensions acceptées")
	}
	if _, err := CheckImage([]byte("<svg onload=alert(1)>"), MaxImgBytes, 960, 720); err == nil {
		t.Fatal("SVG accepté")
	}
	// WebP sans perte minimal (en-tête VP8L) avec un bloc EXIF : le bloc disparaît.
	vp8l := []byte{0x2F, 0, 0, 0, 0, 0, 0, 0}
	bits := uint32(960-1) | uint32(720-1)<<14
	binary.LittleEndian.PutUint32(vp8l[1:], bits)
	chunk := func(id string, body []byte) []byte {
		b := make([]byte, 8, 8+len(body)+1)
		copy(b, id)
		binary.LittleEndian.PutUint32(b[4:], uint32(len(body)))
		b = append(b, body...)
		if len(body)%2 == 1 {
			b = append(b, 0)
		}
		return b
	}
	body := append(chunk("VP8L", vp8l), chunk("EXIF", []byte("GPS position"))...)
	webp := append([]byte("RIFF\x00\x00\x00\x00WEBP"), body...)
	binary.LittleEndian.PutUint32(webp[4:], uint32(len(webp)-8))
	im, err = CheckImage(webp, MaxImgBytes, 960, 720)
	if err != nil {
		t.Fatal(err)
	}
	if bytes.Contains(im.Data, []byte("GPS")) || im.W != 960 || im.H != 720 {
		t.Fatalf("WebP : %dx%d", im.W, im.H)
	}
	anim := append([]byte("RIFF\x00\x00\x00\x00WEBP"), append(chunk("ANIM", make([]byte, 6)), chunk("VP8L", vp8l)...)...)
	binary.LittleEndian.PutUint32(anim[4:], uint32(len(anim)-8))
	if _, err := CheckImage(anim, MaxImgBytes, 960, 720); err == nil {
		t.Fatal("WebP animé accepté")
	}
}

// Exemple « GET Object » de la documentation AWS Signature V4.
func TestSigV4Vector(t *testing.T) {
	req, _ := http.NewRequest("GET", "https://examplebucket.s3.amazonaws.com/test.txt", nil)
	req.Header.Set("Range", "bytes=0-9")
	empty := "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
	req.Header.Set("x-amz-content-sha256", empty)
	req.Header.Set("x-amz-date", "20130524T000000Z")
	got := signature(req, empty, "20130524T000000Z", "20130524", "us-east-1", "AKIAIOSFODNN7EXAMPLE", "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY")
	want := "AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request, SignedHeaders=host;range;x-amz-content-sha256;x-amz-date, Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41"
	if got != want {
		t.Fatalf("signature :\n%s\nattendu :\n%s", got, want)
	}
}

// Faux R2 : vérifie la signature de chaque requête et garde les objets en mémoire.
func TestR2RoundTrip(t *testing.T) {
	objects := map[string][]byte{}
	var mu sync.Mutex
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		auth := r.Header.Get("Authorization")
		date := r.Header.Get("x-amz-date")
		check := r.Clone(r.Context())
		check.Header.Del("Authorization")
		check.Header.Del("Accept-Encoding")
		check.Header.Del("Content-Length")
		want := signature(check, sha256hex(body), date, date[:8], "auto", strings.Repeat("k", 32), strings.Repeat("s", 64))
		if auth != want {
			http.Error(w, "SignatureDoesNotMatch", http.StatusForbidden)
			return
		}
		mu.Lock()
		defer mu.Unlock()
		switch r.Method {
		case http.MethodPut:
			objects[r.URL.Path] = body
		case http.MethodGet:
			b, ok := objects[r.URL.Path]
			if !ok {
				http.NotFound(w, r)
				return
			}
			w.Write(b)
		case http.MethodDelete:
			delete(objects, r.URL.Path)
			w.WriteHeader(http.StatusNoContent)
		}
	}))
	defer srv.Close()
	r2, err := R2FromEnv(func(k string) string {
		return map[string]string{"R2_ACCOUNT_ID": strings.Repeat("a", 32), "R2_BUCKET": "cartes", "R2_ACCESS_KEY_ID": strings.Repeat("k", 32), "R2_SECRET_ACCESS_KEY": strings.Repeat("s", 64), "R2_ENDPOINT": srv.URL}[k]
	})
	if err != nil {
		t.Fatal(err)
	}
	if err := r2.Check(); err != nil {
		t.Fatal(err)
	}
	name := strings.Repeat("c", 40) + ".webp"
	if err := r2.Put(name, []byte("image"), "image/webp"); err != nil {
		t.Fatal(err)
	}
	if _, ok := objects["/cartes/tcg/"+name]; !ok {
		t.Fatalf("objet rangé ailleurs : %v", objects)
	}
	cached := NewCached(r2, 1<<20)
	if b, err := cached.Get(name); err != nil || string(b) != "image" {
		t.Fatal("lecture", err)
	}
	if err := cached.Delete(name); err != nil {
		t.Fatal(err)
	}
	if _, err := r2.Get(name); err != ErrNotFound {
		t.Fatal("objet pas effacé")
	}
	if _, err := R2FromEnv(func(k string) string {
		return map[string]string{"R2_ACCOUNT_ID": strings.Repeat("a", 31), "R2_BUCKET": "x", "R2_ACCESS_KEY_ID": strings.Repeat("k", 32), "R2_SECRET_ACCESS_KEY": strings.Repeat("s", 64)}[k]
	}); err == nil || !strings.Contains(err.Error(), "31 reçus") {
		t.Fatalf("Account ID incomplet : %v", err)
	}
	if _, err := R2FromEnv(func(k string) string { return map[string]string{"R2_BUCKET": "x"}[k] }); err == nil {
		t.Fatal("configuration incomplète acceptée")
	}
}

// ------------------------------------------------------------ API

func TestHTTPFlow(t *testing.T) {
	g, clk, _ := newGame(t)
	g.st.Season.Enabled = true
	g.SaveWave(WaveInput{ReleaseAt: clk.now().Add(48 * time.Hour), Size: 10})
	svc := (&Service{
		Game: g,
		CASValidate: func(ctx context.Context, ticket string) (string, error) {
			if ticket == "ST-bon-ticket-123" {
				return "lmartin", nil
			}
			return "", fmt.Errorf("refusé")
		},
		IsAdmin:        func(r *http.Request) bool { return r.Header.Get("Cookie") == "hub_admin=ok" },
		AllowedOrigins: []string{"https://hub.test"},
	}).Init()
	do := func(method, path, body string, cookie string, headers map[string]string) *httptest.ResponseRecorder {
		r := httptest.NewRequest(method, "https://hub.test"+path, strings.NewReader(body))
		r.Header.Set("Origin", "https://hub.test")
		r.Header.Set("Content-Type", "application/json")
		r.Header.Set("X-Hub-TCG", "1")
		if cookie != "" {
			r.Header.Set("Cookie", cookie)
		}
		for k, v := range headers {
			r.Header.Set(k, v)
		}
		w := httptest.NewRecorder()
		svc.ServeHTTP(w, r)
		return w
	}
	if w := do("GET", "/api/tcg/public", "", "", nil); w.Code != 200 || !strings.Contains(w.Body.String(), `"phase":"soon"`) {
		t.Fatalf("public : %d %s", w.Code, w.Body)
	}
	if w := do("GET", "/api/tcg/state", "", "", nil); w.Code != 401 {
		t.Fatal("état sans session")
	}
	if w := do("POST", "/api/tcg/join", `{"ticket":"ST-mauvais-ticket","pseudo":"Léa M."}`, "", nil); w.Code != 403 {
		t.Fatalf("ticket refusé : %d", w.Code)
	}
	if w := do("POST", "/api/tcg/join", `{"ticket":"ST-bon-ticket-123","pseudo":"Léa M."}`, "", map[string]string{"X-Hub-TCG": ""}); w.Code != 403 {
		t.Fatal("sans en-tête anti-CSRF")
	}
	w := do("POST", "/api/tcg/join", `{"ticket":"ST-bon-ticket-123","pseudo":"Léa M."}`, "", nil)
	if w.Code != 200 {
		t.Fatalf("join : %d %s", w.Code, w.Body)
	}
	var cookie string
	for _, c := range w.Result().Cookies() {
		if c.Name == cookieName {
			if !c.HttpOnly || c.SameSite != http.SameSiteStrictMode {
				t.Fatal("cookie mal protégé")
			}
			cookie = c.Name + "=" + c.Value
		}
	}
	if w := do("GET", "/api/tcg/state", "", cookie, nil); w.Code != 200 || !strings.Contains(w.Body.String(), `"pseudo":"Léa M."`) {
		t.Fatalf("état : %d %s", w.Code, w.Body)
	}
	// Proposition avec photo (JPEG) et vignette.
	var body bytes.Buffer
	mw := multipart.NewWriter(&body)
	mw.WriteField("title", "Le néon qui clignote")
	mw.WriteField("desc", "Couloir B, depuis 2019. Personne ne l'a jamais changé.")
	mw.WriteField("cat", "lieu")
	mw.WriteField("consentPeople", "1")
	mw.WriteField("consentRights", "1")
	fw, _ := mw.CreateFormFile("photo", "photo.jpg")
	fw.Write(jpegWithExif(t, 960, 720))
	fw, _ = mw.CreateFormFile("thumb", "thumb.jpg")
	fw.Write(jpegWithExif(t, 320, 240))
	mw.Close()
	w = do("POST", "/api/tcg/propose", body.String(), cookie, map[string]string{"Content-Type": mw.FormDataContentType()})
	if w.Code != 201 {
		t.Fatalf("proposition : %d %s", w.Code, w.Body)
	}
	var st View
	json.Unmarshal(do("GET", "/api/tcg/state", "", cookie, nil).Body.Bytes(), &st)
	if len(st.Proposals) != 1 || st.Proposals[0].Status != StatusPending || st.Proposals[0].Img == "" {
		t.Fatalf("propositions : %+v", st.Proposals)
	}
	if w := do("GET", "/"+st.Proposals[0].Img, "", "", nil); w.Code != 200 || w.Header().Get("Content-Type") != "image/jpeg" {
		t.Fatalf("image : %d", w.Code)
	}
	// Administration : refusée sans session admin, acceptée avec.
	if w := do("GET", "/api/tcg/admin/cards?filter=pending", "", "", map[string]string{"X-Hub-Admin": "1"}); w.Code != 401 {
		t.Fatal("admin sans session")
	}
	w = do("GET", "/api/tcg/admin/cards?filter=pending", "", "hub_admin=ok", map[string]string{"X-Hub-Admin": "1"})
	if w.Code != 200 || !strings.Contains(w.Body.String(), "Le néon qui clignote") {
		t.Fatalf("file admin : %d %s", w.Code, w.Body)
	}
	if w := do("POST", "/api/tcg/admin/card/"+st.Proposals[0].ID, `{"action":"validate"}`, "hub_admin=ok", map[string]string{"X-Hub-Admin": "1"}); w.Code != 200 {
		t.Fatalf("validation : %d %s", w.Code, w.Body)
	}
	if w := do("POST", "/api/tcg/booster", "", cookie, nil); w.Code != 409 {
		t.Fatal("booster avant le lancement")
	}
}
