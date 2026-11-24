package tcg

import (
	"bytes"
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
	"errors"
	"image/jpeg"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"sync"
)

// Images des cartes. La page recadre la photo au format de la carte (4:3) et l'envoie déjà
// compressée en deux tailles : 960 × 720 (carte) et 320 × 240 (vignette), en WebP (JPEG si le
// navigateur ne sait pas produire de WebP). Le serveur ne décode pas l'image mais vérifie sa
// nature et ses dimensions, et retire les métadonnées (EXIF : position GPS, appareil…) qu'un
// navigateur aurait laissées. Chaque image est rangée sous son empreinte SHA-256 : un nom
// impossible à deviner, et la même image n'est jamais stockée deux fois.

const (
	MaxImgBytes   = 400 << 10 // carte
	MaxThumbBytes = 80 << 10  // vignette
)

var ErrImage = errors.New("image refusée")

// NameRE : nom d'objet d'une image (empreinte + extension).
var NameRE = regexp.MustCompile(`^[0-9a-f]{40}\.(webp|jpg)$`)

// Image : image vérifiée, prête à être stockée.
type Image struct {
	Name  string
	Data  []byte
	Ctype string
	W, H  int
}

// CheckImage vérifie une image (WebP ou JPEG), la nettoie et contrôle sa taille.
// wantW × wantH : dimensions attendues (± 2 px), ratio 4:3.
func CheckImage(data []byte, max, wantW, wantH int) (Image, error) {
	if len(data) == 0 || len(data) > max {
		return Image{}, ErrImage
	}
	var (
		out   []byte
		ctype string
		ext   string
		w, h  int
		err   error
	)
	switch {
	case len(data) > 12 && string(data[0:4]) == "RIFF" && string(data[8:12]) == "WEBP":
		out, w, h, err = cleanWebP(data)
		ctype, ext = "image/webp", "webp"
	case len(data) > 3 && data[0] == 0xFF && data[1] == 0xD8 && data[2] == 0xFF:
		out, err = cleanJPEG(data)
		if err == nil {
			var cfg, e2 = jpeg.DecodeConfig(bytes.NewReader(out))
			if e2 != nil {
				err = e2
			}
			w, h = cfg.Width, cfg.Height
		}
		ctype, ext = "image/jpeg", "jpg"
	default:
		return Image{}, ErrImage
	}
	if err != nil {
		return Image{}, ErrImage
	}
	if abs(w-wantW) > 2 || abs(h-wantH) > 2 {
		return Image{}, ErrImage
	}
	sum := sha256.Sum256(out)
	return Image{Name: hex.EncodeToString(sum[:20]) + "." + ext, Data: out, Ctype: ctype, W: w, H: h}, nil
}

func abs(n int) int {
	if n < 0 {
		return -n
	}
	return n
}

// cleanJPEG retire les segments APP1 à APP15 (EXIF, XMP, ICC…) et les commentaires.
func cleanJPEG(data []byte) ([]byte, error) {
	out := []byte{0xFF, 0xD8}
	i := 2
	for i+4 <= len(data) {
		if data[i] != 0xFF {
			return nil, ErrImage
		}
		marker := data[i+1]
		if marker == 0xFF { // remplissage
			i++
			continue
		}
		if marker == 0xD9 {
			return append(out, 0xFF, 0xD9), nil
		}
		if marker >= 0xD0 && marker <= 0xD7 || marker == 0x01 {
			out = append(out, data[i:i+2]...)
			i += 2
			continue
		}
		n := int(binary.BigEndian.Uint16(data[i+2:]))
		if n < 2 || i+2+n > len(data) {
			return nil, ErrImage
		}
		seg := data[i : i+2+n]
		i += 2 + n
		if marker >= 0xE1 && marker <= 0xEF || marker == 0xFE {
			continue
		}
		out = append(out, seg...)
		if marker == 0xDA { // début de l'image compressée : le reste est recopié tel quel
			return append(out, data[i:]...), nil
		}
	}
	return nil, ErrImage
}

// cleanWebP garde seulement l'image (VP8, VP8L, et ALPH pour la transparence) et ses dimensions.
func cleanWebP(data []byte) ([]byte, int, int, error) {
	size := int(binary.LittleEndian.Uint32(data[4:8]))
	if size+8 > len(data) || size < 4 {
		return nil, 0, 0, ErrImage
	}
	data = data[:size+8]
	var vp8, alph []byte
	var kind string
	var w, h int
	for i := 12; i+8 <= len(data); {
		id := string(data[i : i+4])
		n := int(binary.LittleEndian.Uint32(data[i+4 : i+8]))
		if n < 0 || i+8+n > len(data) {
			return nil, 0, 0, ErrImage
		}
		end := i + 8 + n
		body := data[i+8 : end]
		chunk := data[i:end]
		if n%2 == 1 && end < len(data) {
			chunk = data[i : end+1] // octet de remplissage
		}
		switch id {
		case "VP8 ":
			if len(body) < 10 || body[3] != 0x9D || body[4] != 0x01 || body[5] != 0x2A {
				return nil, 0, 0, ErrImage
			}
			w = int(binary.LittleEndian.Uint16(body[6:8]) & 0x3FFF)
			h = int(binary.LittleEndian.Uint16(body[8:10]) & 0x3FFF)
			vp8, kind = chunk, id
		case "VP8L":
			if len(body) < 5 || body[0] != 0x2F {
				return nil, 0, 0, ErrImage
			}
			bits := binary.LittleEndian.Uint32(body[1:5])
			w = int(bits&0x3FFF) + 1
			h = int((bits>>14)&0x3FFF) + 1
			vp8, kind = chunk, id
		case "ALPH":
			alph = chunk
		case "ANIM", "ANMF":
			return nil, 0, 0, ErrImage // pas d'animation
		}
		i += 8 + n + n%2
	}
	if vp8 == nil {
		return nil, 0, 0, ErrImage
	}
	var body []byte
	if alph != nil && kind == "VP8 " {
		// Format étendu minimal : VP8X (drapeau transparence) + ALPH + VP8.
		x := make([]byte, 18)
		copy(x, "VP8X")
		binary.LittleEndian.PutUint32(x[4:], 10)
		x[8] = 0x10
		putU24(x[12:], w-1)
		putU24(x[15:], h-1)
		body = append(append(x, alph...), vp8...)
	} else {
		body = vp8
	}
	out := make([]byte, 12, 12+len(body))
	copy(out, "RIFF")
	binary.LittleEndian.PutUint32(out[4:], uint32(4+len(body)))
	copy(out[8:], "WEBP")
	return append(out, body...), w, h, nil
}

func putU24(b []byte, v int) {
	b[0], b[1], b[2] = byte(v), byte(v>>8), byte(v>>16)
}

// ------------------------------------------------------------ stockage

// Blobs : où sont gardées les images (Cloudflare R2, ou le dossier de données).
type Blobs interface {
	Put(name string, data []byte, ctype string) error
	Get(name string) ([]byte, error)
	Delete(name string) error
	Kind() string // « r2 » ou « local »
}

// Local : images dans un dossier (DATA_DIR/tcg-img), sans dépendance extérieure.
type Local struct{ Dir string }

func (l Local) Kind() string { return "local" }

func (l Local) path(name string) (string, error) {
	if !NameRE.MatchString(name) {
		return "", ErrImage
	}
	return filepath.Join(l.Dir, name[:2], name), nil
}

func (l Local) Put(name string, data []byte, _ string) error {
	p, err := l.path(name)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(p), 0o700); err != nil {
		return err
	}
	if _, err := os.Stat(p); err == nil {
		return nil
	}
	return writeAtomic(p, data)
}

func (l Local) Get(name string) ([]byte, error) {
	p, err := l.path(name)
	if err != nil {
		return nil, err
	}
	b, err := os.ReadFile(p)
	if errors.Is(err, os.ErrNotExist) {
		return nil, ErrNotFound
	}
	return b, err
}

func (l Local) Delete(name string) error {
	p, err := l.path(name)
	if err != nil {
		return err
	}
	err = os.Remove(p)
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	return err
}

// Cached : petit cache en mémoire devant un stockage distant (les images ne changent jamais).
type Cached struct {
	Blobs
	mu    sync.Mutex
	max   int
	size  int
	items map[string][]byte
	order []string
}

// NewCached : cache de `max` octets au plus.
func NewCached(b Blobs, max int) *Cached {
	return &Cached{Blobs: b, max: max, items: map[string][]byte{}}
}

func (c *Cached) Get(name string) ([]byte, error) {
	c.mu.Lock()
	if b, ok := c.items[name]; ok {
		c.mu.Unlock()
		return b, nil
	}
	c.mu.Unlock()
	b, err := c.Blobs.Get(name)
	if err != nil {
		return nil, err
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	if _, ok := c.items[name]; !ok && len(b) < c.max/8 {
		c.items[name] = b
		c.order = append(c.order, name)
		c.size += len(b)
		for c.size > c.max && len(c.order) > 0 {
			old := c.order[0]
			c.order = c.order[1:]
			c.size -= len(c.items[old])
			delete(c.items, old)
		}
	}
	return b, nil
}

func (c *Cached) Delete(name string) error {
	c.mu.Lock()
	if b, ok := c.items[name]; ok {
		c.size -= len(b)
		delete(c.items, name)
		for i, n := range c.order {
			if n == name {
				c.order = append(c.order[:i], c.order[i+1:]...)
				break
			}
		}
	}
	c.mu.Unlock()
	return c.Blobs.Delete(name)
}

// ctypeOf : type d'une image d'après son nom.
func ctypeOf(name string) string {
	if filepath.Ext(name) == ".jpg" {
		return "image/jpeg"
	}
	return "image/webp"
}

// ServeImage sert une image du jeu (immuable : gardée un an par le navigateur).
// Les images ne sont plus « immuables » : une carte bloquée ou retirée doit disparaître des
// navigateurs. Cinq minutes de cache, puis revalidation (304) après le contrôle du statut.
func ServeImage(w http.ResponseWriter, r *http.Request, b Blobs, name string) {
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		http.Error(w, "GET attendu", http.StatusMethodNotAllowed)
		return
	}
	if !NameRE.MatchString(name) || b == nil {
		http.NotFound(w, r)
		return
	}
	etag := `"` + name[:40] + `"`
	h := w.Header()
	h.Set("Cache-Control", "private, max-age=300")
	h.Set("ETag", etag)
	if r.Header.Get("If-None-Match") == etag {
		w.WriteHeader(http.StatusNotModified)
		return
	}
	data, err := b.Get(name)
	if errors.Is(err, ErrNotFound) {
		h.Set("Cache-Control", "no-store")
		http.NotFound(w, r)
		return
	}
	if err != nil {
		h.Set("Cache-Control", "no-store")
		http.Error(w, "image indisponible", http.StatusBadGateway)
		return
	}
	h.Set("Content-Type", ctypeOf(name))
	h.Set("Content-Length", itoa(len(data)))
	if r.Method == http.MethodHead {
		return
	}
	w.Write(data)
}
