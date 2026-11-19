package feedback

import (
	"fmt"
	"testing"
	"time"
)

func TestLimiterWindowAndMemory(t *testing.T) {
	l := newLimiter(3, 50*time.Millisecond)
	for i := 0; i < 3; i++ {
		if !l.allow("a") {
			t.Fatal("les 3 premiers passent")
		}
	}
	if l.allow("a") || !l.allow("b") {
		t.Fatal("4e refusé pour a, b indépendant")
	}
	time.Sleep(120 * time.Millisecond) // deux fenêtres : tout est oublié
	if !l.allow("a") {
		t.Fatal("après la fenêtre, a repasse")
	}
	// Adresses tournantes : la carte ne dépasse jamais le plafond.
	big := newLimiter(1, time.Hour)
	for i := 0; i < maxLimiterKeys+500; i++ {
		big.allow(fmt.Sprint("k", i))
	}
	if n := len(big.hits); n > maxLimiterKeys+1 {
		t.Fatalf("%d clés en mémoire, plafond %d", n, maxLimiterKeys)
	}
}
