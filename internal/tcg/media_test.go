package tcg

import (
	"bytes"
	"encoding/binary"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// mp4 : un faux MP4 (ftyp, puis moov/mvhd avec cette durée), complété jusqu'à size octets.
func mp4(seconds float64, size int) []byte {
	box := func(typ string, body []byte) []byte {
		b := make([]byte, 8, 8+len(body))
		binary.BigEndian.PutUint32(b, uint32(8+len(body)))
		copy(b[4:], typ)
		return append(b, body...)
	}
	mvhd := make([]byte, 100)
	binary.BigEndian.PutUint32(mvhd[12:], 1000)                 // timescale
	binary.BigEndian.PutUint32(mvhd[16:], uint32(seconds*1000)) // duration
	out := append(box("ftyp", []byte("isom\x00\x00\x02\x00isomavc1")), box("moov", box("mvhd", mvhd))...)
	if pad := size - len(out) - 8; pad > 0 {
		out = append(out, box("mdat", make([]byte, pad))...)
	}
	return out
}

// Un extrait vidéo : MP4 ou WebM, 2 s au plus, 360 Ko au plus. Un morceau : MP3, M4A ou Ogg.
func TestCheckMedia(t *testing.T) {
	if v, err := CheckVideo(mp4(2, 150<<10)); err != nil || v.Ctype != "video/mp4" || !NameRE.MatchString(v.Name) || !strings.HasSuffix(v.Name, ".mp4") {
		t.Fatalf("MP4 de 2 s : %+v %v", v.Ctype, err)
	}
	if _, err := CheckVideo(mp4(6, 150<<10)); err == nil {
		t.Fatal("MP4 de 6 s accepté")
	}
	if _, err := CheckVideo(mp4(2, MaxVideoBytes+1)); err == nil {
		t.Fatal("vidéo trop lourde acceptée")
	}
	webm := append([]byte{0x1A, 0x45, 0xDF, 0xA3, 0x9F, 0x42, 0x86, 0x81, 0x01, 0x42, 0x82, 0x84}, []byte("webm")...)
	webm = append(webm, make([]byte, 200)...)
	if v, err := CheckVideo(webm); err != nil || v.Ctype != "video/webm" {
		t.Fatalf("WebM : %+v %v", v.Ctype, err)
	}
	if _, err := CheckVideo(bytes.Repeat([]byte("x"), 500)); err == nil {
		t.Fatal("n'importe quoi accepté comme vidéo")
	}
	for _, c := range []struct {
		data []byte
		want string
	}{
		{append([]byte("ID3\x04"), make([]byte, 100)...), "audio/mpeg"},
		{append([]byte("OggS"), make([]byte, 100)...), "audio/ogg"},
		{mp4(30, 2000), "audio/mp4"},
	} {
		if a, err := CheckAudio(c.data); err != nil || a.Ctype != c.want {
			t.Fatalf("%s : %+v %v", c.want, a.Ctype, err)
		}
	}
	if _, err := CheckAudio(bytes.Repeat([]byte("x"), 500)); err == nil {
		t.Fatal("n'importe quoi accepté comme musique")
	}
}

// Vidéo et musique seulement si la vague qui reçoit les propositions les ouvre ; la vidéo d'une
// carte bloquée n'est plus servie ; retirer un morceau l'ôte des cartes.
func TestProposalMedia(t *testing.T) {
	g, clk, _ := newGame(t)
	g.st.Season.Enabled = true
	g.SaveWave(WaveInput{ReleaseAt: clk.now().Add(14 * 24 * time.Hour), Size: 10})
	a := mustJoin(t, g, "a", "Alice A.")
	vid := strings.Repeat("c", 40) + ".mp4"
	in := NewProposal{Title: "Le café", Desc: "La file devant la machine.", Cat: "meme", Img: strings.Repeat("a", 40) + ".webp", Thumb: strings.Repeat("b", 40) + ".webp", Video: vid, Bytes: 300}
	if _, err := g.Propose(a, in); err == nil || g.MediaAllowed(true, "") == nil {
		t.Fatal("vidéo acceptée alors que la vague ne l'ouvre pas")
	}
	tr, err := g.AddTrack("Neige douce", "Libre de droits", Image{Name: strings.Repeat("d", 40) + ".mp3", Data: make([]byte, 1000)})
	if err != nil {
		t.Fatal(err)
	}
	in.Music = tr.ID
	g.st.Waves[0].Video, g.st.Waves[0].Music = true, true
	if err := g.MediaAllowed(true, tr.ID); err != nil {
		t.Fatal(err)
	}
	if err := g.MediaAllowed(false, "m999"); err == nil {
		t.Fatal("morceau inconnu accepté")
	}
	id, err := g.Propose(a, in)
	if err != nil {
		t.Fatal(err)
	}
	c := g.st.Cards[id]
	if c.Video != vid || c.Music != tr.ID {
		t.Fatalf("carte : vidéo %q, musique %q", c.Video, c.Music)
	}
	if v := g.cardView(c, a); v.Video != "api/tcg/img/"+vid || v.Music != tr.ID {
		t.Fatalf("vue : %+v", v)
	}
	if !g.ImageShown(vid) || !g.ImageShown(strings.Repeat("d", 40)+".mp3") {
		t.Fatal("vidéo ou musique pas servie")
	}
	if err := g.ModerateCard(id, Moderate{Action: "block", Reason: "illisible"}); err != nil {
		t.Fatal(err)
	}
	if g.ImageShown(vid) {
		t.Fatal("vidéo d'une carte bloquée encore servie")
	}
	if pv, _ := g.PlayerView(a); len(pv.Tracks) != 1 || pv.Tracks[0].Title != "Neige douce" || !pv.Waves[0].Video {
		t.Fatalf("vue du joueur : %+v / %+v", pv.Tracks, pv.Waves)
	}
	file, err := g.DeleteTrack(tr.ID)
	if err != nil || file != strings.Repeat("d", 40)+".mp3" || c.Music != "" || g.ImageShown(file) {
		t.Fatalf("retrait du morceau : %q %v, carte %q", file, err, c.Music)
	}
	// Une vague suivante programmée d'elle-même garde les options de la précédente.
	w := g.st.Waves[0]
	w.Printed, w.PrintedAt = true, clk.now()
	g.scheduleNext(w)
	if n := g.st.Waves[len(g.st.Waves)-1]; !n.Video || !n.Music {
		t.Fatalf("vague suivante : %+v", n)
	}
}

// Une vidéo se sert par morceaux (Range) : Safari l'exige pour la lire.
func TestServeVideoRange(t *testing.T) {
	dir := t.TempDir()
	b := Local{Dir: filepath.Join(dir, "img")}
	v, err := CheckVideo(mp4(2, 20000))
	if err != nil {
		t.Fatal(err)
	}
	if err := b.Put(v.Name, v.Data, v.Ctype); err != nil {
		t.Fatal(err)
	}
	req := httptest.NewRequest(http.MethodGet, "/api/tcg/img/"+v.Name, nil)
	req.Header.Set("Range", "bytes=0-99")
	rec := httptest.NewRecorder()
	ServeImage(rec, req, b, v.Name)
	if rec.Code != http.StatusPartialContent || rec.Body.Len() != 100 || rec.Header().Get("Content-Type") != "video/mp4" || !strings.HasPrefix(rec.Header().Get("Content-Range"), "bytes 0-99/") {
		t.Fatalf("Range : %d, %d octets, %q, %q", rec.Code, rec.Body.Len(), rec.Header().Get("Content-Type"), rec.Header().Get("Content-Range"))
	}
}
