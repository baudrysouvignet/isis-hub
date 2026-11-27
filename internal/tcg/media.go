package tcg

import (
	"bytes"
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
	"net/http"
	"strconv"
	"strings"
	"time"
)

// Vidéos et musiques des cartes (vagues qui les ouvrent : Wave.Video, Wave.Music).
//
// Vidéo : un extrait de 2 s, découpé et recadré dans la page au format de la carte (640 × 480),
// réencodé par le navigateur (MP4 H.264 s'il sait le produire, sinon WebM) à 800 kbit/s, SANS SON :
// ni voix ni conversation captées par mégarde. Environ 170 Ko (mesuré : 168 Ko au pire, image
// très chargée). La photo de la carte reste : c'est la première image de l'extrait, et c'est elle
// que voient les navigateurs qui ne savent pas lire la vidéo. Le serveur ne décode pas la vidéo
// mais vérifie sa nature, sa taille et, quand le fichier la donne, sa durée.
//
// Musique : choisie dans une bibliothèque que l'administration remplit elle-même (des morceaux
// libres de droits, ou dont elle a les droits), jamais envoyée par les joueurs : une chanson du
// commerce mise en ligne par n'importe qui poserait un problème de droits d'auteur. Elle ne se
// joue que si l'on ouvre la carte et qu'on appuie sur lecture.

const (
	MaxVideoBytes  = 360 << 10 // extrait de 2 s
	MaxTrackBytes  = 2 << 20   // morceau de la bibliothèque
	maxClipSeconds = 2.4       // durée d'un extrait, marge comprise
	maxTracks      = 40
)

var (
	ErrVideo = userErr(http.StatusBadRequest, "Vidéo refusée : un extrait de 2 secondes au plus (MP4 ou WebM), préparé par l’atelier.")
	ErrAudio = userErr(http.StatusBadRequest, "Fichier refusé : un morceau MP3, M4A ou Ogg de 2 Mo au plus.")
)

// mediaName : nom d'objet d'un fichier (empreinte + extension), comme les images.
func mediaName(data []byte, ext string) string {
	sum := sha256.Sum256(data)
	return hex.EncodeToString(sum[:])[:40] + "." + ext
}

// CheckVideo vérifie un extrait vidéo (MP4 ou WebM, MaxVideoBytes, maxClipSeconds).
func CheckVideo(data []byte) (Image, error) {
	if len(data) < 64 || len(data) > MaxVideoBytes {
		return Image{}, ErrVideo
	}
	var ctype, ext string
	switch {
	case string(data[4:8]) == "ftyp":
		if d, ok := mp4Duration(data); ok && d > maxClipSeconds {
			return Image{}, ErrVideo
		}
		ctype, ext = "video/mp4", "mp4"
	case bytes.HasPrefix(data, []byte{0x1A, 0x45, 0xDF, 0xA3}) && bytes.Contains(data[:min(len(data), 64)], []byte("webm")):
		ctype, ext = "video/webm", "webm"
	default:
		return Image{}, ErrVideo
	}
	return Image{Name: mediaName(data, ext), Data: data, Ctype: ctype}, nil
}

// mp4Duration : durée annoncée par la boîte moov/mvhd (0 ou absente : inconnue, false).
func mp4Duration(data []byte) (float64, bool) {
	box := func(b []byte, want string) []byte {
		for len(b) >= 8 {
			size := int(binary.BigEndian.Uint32(b))
			typ := string(b[4:8])
			head := 8
			if size == 1 && len(b) >= 16 {
				size, head = int(binary.BigEndian.Uint64(b[8:])), 16
			} else if size == 0 {
				size = len(b)
			}
			if size < head || size > len(b) {
				return nil
			}
			if typ == want {
				return b[head:size]
			}
			b = b[size:]
		}
		return nil
	}
	mvhd := box(box(data, "moov"), "mvhd")
	if len(mvhd) < 20 {
		return 0, false
	}
	var scale, dur uint64
	if mvhd[0] == 1 && len(mvhd) >= 32 {
		scale, dur = uint64(binary.BigEndian.Uint32(mvhd[20:])), binary.BigEndian.Uint64(mvhd[24:])
	} else {
		scale, dur = uint64(binary.BigEndian.Uint32(mvhd[12:])), uint64(binary.BigEndian.Uint32(mvhd[16:]))
	}
	if scale == 0 || dur == 0 || dur == 0xFFFFFFFF {
		return 0, false
	}
	return float64(dur) / float64(scale), true
}

// CheckAudio vérifie un morceau de la bibliothèque (MP3, M4A ou Ogg, MaxTrackBytes).
func CheckAudio(data []byte) (Image, error) {
	if len(data) < 64 || len(data) > MaxTrackBytes {
		return Image{}, ErrAudio
	}
	var ctype, ext string
	switch {
	case bytes.HasPrefix(data, []byte("ID3")) || (data[0] == 0xFF && data[1]&0xE0 == 0xE0):
		ctype, ext = "audio/mpeg", "mp3"
	case string(data[4:8]) == "ftyp":
		ctype, ext = "audio/mp4", "m4a"
	case bytes.HasPrefix(data, []byte("OggS")):
		ctype, ext = "audio/ogg", "ogg"
	default:
		return Image{}, ErrAudio
	}
	return Image{Name: mediaName(data, ext), Data: data, Ctype: ctype}, nil
}

// mediaType : type d'un fichier vidéo ou audio d'après son nom ("" : une image).
func mediaType(name string) string {
	switch {
	case strings.HasSuffix(name, ".mp4"):
		return "video/mp4"
	case strings.HasSuffix(name, ".webm"):
		return "video/webm"
	case strings.HasSuffix(name, ".mp3"):
		return "audio/mpeg"
	case strings.HasSuffix(name, ".m4a"):
		return "audio/mp4"
	case strings.HasSuffix(name, ".ogg"):
		return "audio/ogg"
	}
	return ""
}

// serveMedia sert une vidéo ou un morceau, avec les requêtes partielles (Range) que Safari exige
// pour lire une vidéo.
func serveMedia(w http.ResponseWriter, r *http.Request, data []byte, name string) {
	w.Header().Set("Content-Type", mediaType(name))
	http.ServeContent(w, r, "", time.Time{}, bytes.NewReader(data))
}

// ------------------------------------------------------------ vague qui reçoit les propositions

// proposalWave : la vague qui reçoit les propositions maintenant (la première pas encore
// imprimée dont les propositions ne sont pas closes), ou nil.
func (g *Game) proposalWave(now time.Time) *Wave {
	for _, w := range g.st.Waves {
		if w.Printed || (!w.ProposalsUntil.IsZero() && !now.Before(w.ProposalsUntil)) {
			continue
		}
		return w
	}
	return nil
}

// ------------------------------------------------------------ bibliothèque de musiques

// Track : un morceau de la bibliothèque, ajouté par l'administration (qui en a vérifié les droits).
type Track struct {
	ID     string    `json:"id"`
	Title  string    `json:"title"`
	Credit string    `json:"credit"` // auteur et licence, affichés avec la carte
	File   string    `json:"file"`
	Bytes  int64     `json:"bytes"`
	Added  time.Time `json:"added"`
}

// TrackView : un morceau tel que le voient les joueurs.
type TrackView struct {
	ID     string `json:"id"`
	Title  string `json:"title"`
	Credit string `json:"credit"`
	URL    string `json:"url"`
}

func (g *Game) track(id string) *Track {
	for _, t := range g.st.Tracks {
		if t.ID == id {
			return t
		}
	}
	return nil
}

func (g *Game) trackViews() []TrackView {
	out := make([]TrackView, 0, len(g.st.Tracks))
	for _, t := range g.st.Tracks {
		out = append(out, TrackView{ID: t.ID, Title: t.Title, Credit: t.Credit, URL: ImgURL(t.File)})
	}
	return out
}

// AddTrack ajoute un morceau (fichier déjà vérifié et stocké) à la bibliothèque.
func (g *Game) AddTrack(title, credit string, f Image) (TrackView, error) {
	title = cleanText(title, false)
	credit = cleanText(credit, false)
	if runes(title) < 1 || runes(title) > 60 || runes(credit) > 120 {
		return TrackView{}, userErr(http.StatusBadRequest, "Un titre (60 caractères au plus) et, si besoin, l’auteur et la licence (120 au plus).")
	}
	g.mu.Lock()
	defer g.mu.Unlock()
	if len(g.st.Tracks) >= maxTracks {
		return TrackView{}, userErr(http.StatusConflict, "La bibliothèque compte déjà %d morceaux : retires-en un d’abord.", maxTracks)
	}
	for _, t := range g.st.Tracks {
		if t.File == f.Name {
			return TrackView{}, userErr(http.StatusConflict, "Ce morceau est déjà dans la bibliothèque (« %s »).", t.Title)
		}
	}
	n := 1
	for _, t := range g.st.Tracks {
		if k, _ := strconv.Atoi(strings.TrimPrefix(t.ID, "m")); k >= n {
			n = k + 1
		}
	}
	t := &Track{ID: "m" + itoa(n), Title: title, Credit: credit, File: f.Name, Bytes: int64(len(f.Data)), Added: g.now()}
	g.st.Tracks = append(g.st.Tracks, t)
	g.st.Used += t.Bytes
	g.dirty = true
	return TrackView{ID: t.ID, Title: t.Title, Credit: t.Credit, URL: ImgURL(t.File)}, nil
}

// DeleteTrack retire un morceau de la bibliothèque ; les cartes qui l'avaient n'ont plus de
// musique. Rend le fichier à effacer.
func (g *Game) DeleteTrack(id string) (string, error) {
	g.mu.Lock()
	defer g.mu.Unlock()
	for i, t := range g.st.Tracks {
		if t.ID != id {
			continue
		}
		g.st.Tracks = append(g.st.Tracks[:i], g.st.Tracks[i+1:]...)
		g.st.Used -= t.Bytes
		for _, c := range g.st.Cards {
			if c.Music == id {
				c.Music = ""
			}
		}
		g.dirty = true
		return t.File, nil
	}
	return "", ErrNotFound
}

// AdminTrack : un morceau et le nombre de cartes qui l'utilisent.
type AdminTrack struct {
	TrackView
	Bytes int64 `json:"bytes"`
	Cards int   `json:"cards"`
}

func (g *Game) AdminTracks() []AdminTrack {
	g.mu.Lock()
	defer g.mu.Unlock()
	use := map[string]int{}
	for _, c := range g.st.Cards {
		if c.Music != "" && c.Status != StatusBlocked && c.Status != StatusRemoved {
			use[c.Music]++
		}
	}
	out := []AdminTrack{}
	for _, t := range g.st.Tracks {
		out = append(out, AdminTrack{TrackView: TrackView{ID: t.ID, Title: t.Title, Credit: t.Credit, URL: ImgURL(t.File)}, Bytes: t.Bytes, Cards: use[t.ID]})
	}
	return out
}

// MediaAllowed : la vague qui reçoit les propositions accepte-t-elle un extrait vidéo (video) et
// ce morceau (music, "" : aucun) ?
func (g *Game) MediaAllowed(video bool, music string) error {
	if !video && music == "" {
		return nil
	}
	g.mu.Lock()
	defer g.mu.Unlock()
	w := g.proposalWave(g.now())
	if video && (w == nil || !w.Video) {
		return userErr(http.StatusBadRequest, "Les vidéos ne sont pas ouvertes pour cette vague : envoie ta carte avec une photo.")
	}
	if music != "" && (w == nil || !w.Music || g.track(music) == nil) {
		return userErr(http.StatusBadRequest, "Cette musique n’est pas disponible pour cette vague.")
	}
	return nil
}
