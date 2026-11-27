package tcg

import (
	"encoding/base64"
	"strings"
	"testing"
)

// chromeMP4Head : début (ftyp + moov) d'un vrai extrait enregistré par Chrome 156 (MediaRecorder,
// video/mp4;codecs=avc1.42E01E, 640 × 480) : MP4 fragmenté, durée annoncée dans moov/mvhd (2,025 s).
const chromeMP4Head = "" +
	"AAAAJGZ0eXBpc29tAAACAGlzb21pc282aXNvMmF2YzFtcDQxAAACyG1vb3YAAAB4bXZoZAEAAAAAAAAA5y5GJQAAAADnLkYl" +
	"AAAD6AAAAAAAAAfpAAEAAAEAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAAAAAQAAAAAAAAAAAAAAAAAAQAAAAAAAAAAAAAAA" +
	"AAAAAAAAAAAAAAAAAAAAAAAAAAIAAAIgdHJhawAAAGh0a2hkAQAAAwAAAADnLkYlAAAAAOcuRiUAAAABAAAAAAAAAAAAAAfp" +
	"AAAAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAAAAAQAAAAAAAAAAAAAAAAAAQAAAAAKAAAAB4AAAAAABsG1kaWEAAAAs" +
	"bWRoZAEAAAAAAAAA5y5GJQAAAADnLkYlAAB1MAAAAAAAAAfpVcQAAAAAAC1oZGxyAAAAAAAAAAB2aWRlAAAAAAAAAAAAAAAA" +
	"VmlkZW9IYW5kbGVyAAAAAU9taW5mAAAAFHZtaGQAAAABAAAAAAAAAAAAAAAlZGluZgAAAB1kcmVmAAAAAAAAAAEAAAANdXJs" +
	"IAAAAAEAAAABDnN0YmwAAAAQc3RzYwAAAAAAAAAAAAAAEHN0dHMAAAAAAAAAAAAAABRzdHN6AAAAAAAAAAAAAAAAAAAAEHN0" +
	"Y28AAAAAAAAAAAAAAMJzdHNkAAAAAAAAAAEAAACyYXZjMQAAAAAAAAABAAAAAQAAAAAAAAAAAAAAAAKAAeAASAAAAEgAAAAA" +
	"AAAAAQtBVkMxIENvZGluZwAAAAAAAAAAAAAAAAAAAAAAAAAAABj//wAAABBwYXNwAAAAAQAAAAEAAAAUYnRydAAAAAAAAAAA" +
	"AAAAAAAAACVhdmNDAUIAHv/hAA4nQgAeq0BQHtNwENAQIAEABCjOPIAAAAATY29scm5jbHgAAQANAAGAAAAAKG12ZXgAAAAg" +
	"dHJleAAAAAAAAAABAAAAAQAAAAAAAAAAAAAAAA=="

// Un extrait tel que Chrome l'enregistre : sa durée se lit dans l'en-tête, et il est accepté.
func TestCheckVideoChrome(t *testing.T) {
	head, err := base64.StdEncoding.DecodeString(chromeMP4Head)
	if err != nil {
		t.Fatal(err)
	}
	if d, known := mp4Duration(head); !known || d < 2 || d > 2.1 {
		t.Fatalf("durée lue : %v (%v), attendue 2,025 s", d, known)
	}
	data := append(head, []byte(strings.Repeat("\x00", 160<<10))...)
	if v, err := CheckVideo(data); err != nil || v.Ctype != "video/mp4" {
		t.Fatalf("extrait de Chrome refusé : %v", err)
	}
}
