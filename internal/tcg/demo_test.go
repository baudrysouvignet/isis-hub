package tcg

import (
	"bytes"
	"fmt"
	"image"
	"image/color"
	"image/jpeg"
	"math/rand"
	"os"
	"path/filepath"
	"sort"
	"testing"
	"time"
)

// Données de démonstration pour l'environnement de test (compose.test.yaml), JAMAIS en production :
// des joueurs fictifs (identifiants « demo-NN », qu'aucune connexion universitaire ne peut ouvrir),
// des cartes avec des photos générées (dégradés), un jury de la vague 1 en cours depuis 3 soirs
// (podiums et récompenses de lancement à voir), 6 cartes à valider (mode file), 2 bloquées.
// Exemplaires réduits (Rare 2, Épique 1, Légendaire 1) : une fois la vague imprimée, les répliques
// sortent vite. Ce fichier n'est compilé que par « go test » : il n'est pas dans l'appli.
//
// Serveur de test arrêté (il réécrirait tcg.json par-dessus) ; voir README « Données de démo » :
//
//	TCG_DEMO_DIR=<dossier de données> go test ./internal/tcg/ -run TestDemoSeed -count=1 -v
func TestDemoSeed(t *testing.T) {
	dir := os.Getenv("TCG_DEMO_DIR")
	if dir == "" {
		t.Skip("TCG_DEMO_DIR=<dossier de données> pour remplir un jeu de test")
	}
	g, err := Open(dir, os.Getenv("VAULT_PEPPER"), Local{Dir: filepath.Join(dir, "tcg-img")})
	if err != nil {
		t.Fatal(err)
	}
	// Garde-fous : jamais sur un jeu lancé, sur un jeu bien rempli (production ?), ni deux fois.
	for _, w := range g.st.Waves {
		if w.Printed {
			t.Fatal("jeu déjà lancé : rien n'est ajouté")
		}
	}
	if len(g.st.Players) > 30 {
		t.Fatalf("%d joueurs : ce n'est pas un jeu de test, rien n'est ajouté", len(g.st.Players))
	}
	if _, ok := g.st.Keys[g.loginKey("demo-01")]; ok {
		t.Fatal("données de démo déjà présentes")
	}

	real := time.Now()
	day0 := func(d int, h int) time.Time {
		p := real.In(Paris)
		return time.Date(p.Year(), p.Month(), p.Day()+d, h, 0, 0, 0, Paris)
	}
	clk := &clock{t: day0(-4, 9)}
	g.now = clk.now
	rng := rand.New(rand.NewSource(real.UnixNano()))
	g.rnd = rng.Intn

	// Saison visible, vague 1 : jury commencé il y a 3 jours, sortie dans 3 jours.
	g.st.Season.Enabled = true
	if len(g.st.Waves) == 0 {
		g.st.Waves = []*Wave{{N: 1}}
	}
	w := g.st.Waves[0]
	w.ProposalsUntil, w.JuryFrom, w.JuryUntil, w.ReleaseAt = day0(2, 20), day0(-3, 0), day0(2, 20), day0(3, 6)
	w.Size, w.PerDay = 60, 10
	w.Runs = map[Rarity]int{Rare: 2, Epique: 1, Legendaire: 1}

	pseudos := []string{"Léa M.", "Hugo B.", "Inès K.", "Tom R.", "Chloé D.", "Nathan P.", "Emma L.", "Lucas G.", "Manon T.", "Yanis H.", "Sarah V.", "Théo C.", "Jade F.", "Enzo A.", "Camille N.", "Rayan S.", "Zoé J.", "Louis W.", "Lina O.", "Adam E.", "Alice Q.", "Noah Z.", "Eva U.", "Gabriel Y."}
	var players []string
	for i, ps := range pseudos {
		players = append(players, mustJoin(t, g, fmt.Sprintf("demo-%02d", i+1), ps))
	}
	cards := []struct{ title, cat, desc string }{
		{"Le néon du couloir", "lieu", "Il clignote depuis la rentrée et personne ne sait qui doit le changer."},
		{"Le café de 10 h", "moment", "La file devant la machine, le seul vrai réseau social du bâtiment."},
		{"Le bus de 18 h 12", "truc", "Toujours plein, toujours en retard, toujours là."},
		{"Le wifi du campus", "meme", "Connecté, sans Internet. Une philosophie."},
		{"La salle B204", "lieu", "Trop chaude en hiver, trop froide en été."},
		{"Le partiel surprise", "moment", "Annoncé la veille à 23 h 58 sur Moodle."},
		{"La photocopieuse", "truc", "Bourrage papier : le boss final du semestre."},
		{"Le groupe de promo", "meme", "400 messages, dont 3 utiles."},
		{"Le distributeur", "truc", "Il avale les pièces et rend des regrets."},
		{"Le parking vélo", "lieu", "Toujours plein le lundi, vide le vendredi."},
		{"La pause de midi", "moment", "Trente minutes pour manger, vingt pour trouver une table."},
		{"Le micro qui grésille", "truc", "Chaque amphi a le sien, chaque prof fait semblant de rien."},
		{"Le TP qui plante", "moment", "Tout marchait chez moi, promis."},
		{"La bibliothèque", "lieu", "Silence total, sauf la porte qui grince."},
		{"Le badge oublié", "truc", "Trois étages à pied pour aller le chercher."},
		{"La soirée de promo", "moment", "Ceux qui étaient là savent. Les autres ont vu les stories."},
		{"Le tableau blanc", "truc", "Un seul feutre marche, et il est rouge."},
		{"L'ascenseur", "lieu", "En panne une semaine sur deux, l'autre il sent bizarre."},
		{"Le mail du vendredi", "moment", "Envoyé à 17 h 59 : « petit changement lundi »."},
		{"Le chargeur partagé", "truc", "Il appartient à tout le monde et à personne."},
		{"Le banc du hall", "lieu", "Toujours occupé, jamais par les mêmes."},
		{"Le quiz Moodle", "meme", "Une seule tentative, et le wifi coupe."},
		{"La rentrée", "moment", "Tout le monde motivé, pendant une semaine."},
		{"Le gobelet", "truc", "Trop chaud pour le tenir, trop petit pour se réchauffer."},
		{"Le prof en retard", "moment", "Quinze minutes de grâce, comptées à la seconde."},
		{"La cafétéria", "lieu", "Le menu change, le goût jamais."},
		{"Le diaporama", "truc", "Cent slides, police 8, aucun schéma."},
		{"L'exposé de groupe", "moment", "Quatre noms sur la couverture, un seul a travaillé."},
		{"La salle info", "lieu", "Trente postes, douze qui démarrent."},
		{"Le parapluie oublié", "truc", "Il pleut toujours le jour où on le laisse."},
		{"Le résumé de cours", "meme", "Trois pages qui circulent, personne ne sait d'où."},
		{"L'amphi A", "lieu", "La moitié des prises ne marchent pas, l'autre est prise."},
		{"Le dernier bus", "moment", "Courir, le voir partir, attendre une heure."},
		{"Le feutre sec", "truc", "Il écrit une lettre sur deux, le prof continue."},
		{"La file de la cantine", "moment", "Le temps passe plus vite en TD, c'est dire."},
		{"La porte coincée", "lieu", "Il faut pousser, puis tirer, puis pousser encore."},
		{"Le tuto YouTube", "meme", "Plus clair que le cours, et en 8 minutes."},
		{"Le stylo prêté", "truc", "Jamais rendu, jamais réclamé."},
		{"Le premier rang", "lieu", "Réservé aux courageux et aux retardataires."},
		{"La note sur Moodle", "moment", "Publiée un dimanche à minuit, sans prévenir."},
		{"Le casier", "truc", "Le code est simple, on l'oublie quand même."},
		{"Le couloir du 2e", "lieu", "Toujours en travaux, depuis toujours."},
		// Dernières : restent à valider (mode file), dont deux avec des signaux à vérifier.
		{"Le prof qui dort", "meme", "Il s'endort pendant ses propres TD, on sait qui."},
		{"Le TD le plus nul", "moment", "Deux heures pour un exercice, et c'était le mauvais."},
		{"La machine à cookies", "truc", "Elle sent bon, elle est toujours vide."},
		{"Le local des assos", "lieu", "Trois canapés, zéro chaise, une odeur de pizza."},
		{"Le cours en visio", "moment", "Caméras coupées, micros ouverts, chats en fond."},
		{"La plante du bureau", "truc", "Personne ne l'arrose et elle va très bien."},
	}
	weights := []int{8, 7, 6, 5, 4, 4, 3, 3, 2, 2}
	authorOf := func(i int) string {
		k := i
		for a, n := range weights {
			if k < n {
				return players[a]
			}
			k -= n
		}
		return players[len(weights)+k%(len(players)-len(weights))]
	}
	quality := map[string]float64{}
	var accepted []string
	for i, c := range cards {
		clk.t = day0(-4, 9).Add(time.Duration(i) * 95 * time.Minute) // sur 3 jours environ
		img, err := CheckImage(demoPhoto(rng, 960, 720), MaxImgBytes, 960, 720)
		if err != nil {
			t.Fatal(err)
		}
		thumb, err := CheckImage(demoPhoto(rng, 320, 240), MaxThumbBytes, 320, 240)
		if err != nil {
			t.Fatal(err)
		}
		for _, im := range []Image{img, thumb} {
			if err := g.Blobs.Put(im.Name, im.Data, im.Ctype); err != nil {
				t.Fatal(err)
			}
		}
		id, err := g.Propose(authorOf(i), NewProposal{Title: c.title, Desc: c.desc, Cat: c.cat, Img: img.Name, Thumb: thumb.Name, Bytes: int64(len(img.Data) + len(thumb.Data))})
		if err != nil {
			t.Fatalf("%s : %v", c.title, err)
		}
		switch {
		case i >= len(cards)-6: // à valider
		case i == 7 || i == 19:
			clk.add(40 * time.Minute)
			g.ModerateCard(id, Moderate{Action: "block", Reason: []string{"doublon", "illisible"}[i%2], Message: "Propose une autre version !"})
		default:
			clk.add(40 * time.Minute)
			if err := g.ModerateCard(id, Moderate{Action: "validate"}); err != nil {
				t.Fatal(err)
			}
			quality[id] = rng.Float64()
			accepted = append(accepted, id)
		}
	}
	// Jury : 3 soirs passés, environ 70 % des joueurs fictifs classent leur série du jour.
	for d := 0; d < 3; d++ {
		for _, pid := range players {
			if rng.Float64() > 0.7 {
				continue
			}
			clk.t = w.JuryFrom.Add(time.Duration(d*24+10+rng.Intn(11)) * time.Hour)
			v, _ := g.PlayerView(pid)
			if v.Jury == nil {
				continue
			}
			var b *BallotView
			for i := range v.Jury.Ballots {
				if !v.Jury.Ballots[i].Done {
					b = &v.Jury.Ballots[i]
				}
			}
			if b == nil && v.Jury.More {
				if g.MoreBallot(pid) == nil {
					v, _ = g.PlayerView(pid)
					for i := range v.Jury.Ballots {
						if !v.Jury.Ballots[i].Done {
							b = &v.Jury.Ballots[i]
						}
					}
				}
			}
			if b == nil {
				continue
			}
			rank := make([]string, 0, len(b.Cards))
			for _, c := range b.Cards {
				rank = append(rank, c.ID)
			}
			sort.SliceStable(rank, func(i, j int) bool { return quality[rank[i]]+0.3*rng.Float64() > quality[rank[j]]+0.3*rng.Float64() })
			if err := g.Vote(pid, w.N, b.N, rank); err != nil {
				t.Fatal(err)
			}
		}
	}
	g.now = time.Now
	g.dirty = true
	if err := g.Flush(); err != nil {
		t.Fatal(err)
	}
	counts := map[string]int{}
	for _, c := range g.st.Cards {
		counts[c.Status]++
	}
	t.Logf("démo : %d joueurs fictifs, cartes %v, %d soirs de jury", len(players), counts, len(g.launchNights(w, real, false)))
}

// demoPhoto : une « photo » de démonstration (dégradé et cercles), en JPEG.
func demoPhoto(rng *rand.Rand, w, h int) []byte {
	pal := [][2]color.RGBA{
		{{28, 143, 160, 255}, {107, 75, 214, 255}}, {{11, 110, 127, 255}, {76, 195, 211, 255}}, {{107, 75, 214, 255}, {255, 122, 89, 255}},
		{{18, 58, 69, 255}, {169, 139, 255, 255}}, {{178, 74, 107, 255}, {245, 196, 81, 255}}, {{40, 120, 80, 255}, {200, 230, 120, 255}},
	}
	c := pal[rng.Intn(len(pal))]
	img := image.NewRGBA(image.Rect(0, 0, w, h))
	type disc struct{ x, y, r float64 }
	discs := []disc{}
	for i := 0; i < 3; i++ {
		discs = append(discs, disc{rng.Float64() * float64(w), rng.Float64() * float64(h), (0.1 + rng.Float64()*0.25) * float64(w)})
	}
	for y := 0; y < h; y++ {
		for x := 0; x < w; x++ {
			t := (float64(x)/float64(w) + float64(y)/float64(h)) / 2
			r := float64(c[0].R)*(1-t) + float64(c[1].R)*t
			gg := float64(c[0].G)*(1-t) + float64(c[1].G)*t
			b := float64(c[0].B)*(1-t) + float64(c[1].B)*t
			for _, d := range discs {
				if dx, dy := float64(x)-d.x, float64(y)-d.y; dx*dx+dy*dy < d.r*d.r {
					r, gg, b = r+(255-r)*0.14, gg+(255-gg)*0.14, b+(255-b)*0.14
				}
			}
			img.SetRGBA(x, y, color.RGBA{uint8(r), uint8(gg), uint8(b), 255})
		}
	}
	var buf bytes.Buffer
	jpeg.Encode(&buf, img, &jpeg.Options{Quality: 82})
	return buf.Bytes()
}
