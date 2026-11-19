package visitor

import (
	"sync"
	"time"
)

// Limiter compte des événements par clé sur une fenêtre glissante (approchée par deux fenêtres
// fixes : mémoire constante par clé), en mémoire seulement. Les clés inactives sont oubliées au
// plus tard à la fenêtre suivante ; au-delà de maxLimiterKeys clés (attaque à adresses
// tournantes), les nouvelles partagent une seule clé commune au lieu de faire gonfler la mémoire.
type Limiter struct {
	mu     sync.Mutex
	window time.Duration
	max    int
	hits   map[string]*counter
	swept  time.Time
}

type counter struct {
	start     time.Time // début de la fenêtre en cours
	cur, prev int
}

const maxLimiterKeys = 100_000

func NewLimiter(max int, window time.Duration) *Limiter {
	return &Limiter{window: window, max: max, hits: map[string]*counter{}, swept: time.Now()}
}

// Allow compte un événement pour `key` et dit s'il est permis.
func (l *Limiter) Allow(key string) bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	now := time.Now()
	if now.Sub(l.swept) > min(l.window, time.Minute) { // ménage régulier, borné dans le temps
		l.swept = now
		for k, c := range l.hits {
			if now.Sub(c.start) >= 2*l.window {
				delete(l.hits, k)
			}
		}
	}
	c := l.hits[key]
	if c == nil {
		if len(l.hits) >= maxLimiterKeys {
			key = "\x00débordement"
			c = l.hits[key]
		}
		if c == nil {
			c = &counter{start: now}
			l.hits[key] = c
		}
	}
	if elapsed := now.Sub(c.start); elapsed >= l.window {
		if elapsed >= 2*l.window {
			c.prev = 0
		} else {
			c.prev = c.cur
		}
		c.cur = 0
		c.start = now.Add(-(elapsed % l.window))
	}
	// Part de la fenêtre précédente encore « dans » la fenêtre glissante.
	weight := 1 - float64(now.Sub(c.start))/float64(l.window)
	if float64(c.cur)+float64(c.prev)*weight >= float64(l.max) {
		return false
	}
	c.cur++
	return true
}
