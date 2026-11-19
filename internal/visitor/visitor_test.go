package visitor

import "testing"

func TestKey(t *testing.T) {
	for in, want := range map[string]string{
		"192.0.2.1":                 "192.0.2.1",
		"::ffff:192.0.2.1":          "192.0.2.1",
		"2001:db8:1:2:aaaa::1":      "2001:db8:1:2::/64",
		"2001:db8:1:2:bbbb:cccc::9": "2001:db8:1:2::/64",
		"[2001:db8:1:3::1]:443":     "2001:db8:1:3::/64",
		"fe80::1%en0":               "fe80::/64",
		"pas-une-adresse":           "pas-une-adresse",
	} {
		if got := Key(in); got != want {
			t.Errorf("Key(%q) = %q, attendu %q", in, got, want)
		}
	}
}
