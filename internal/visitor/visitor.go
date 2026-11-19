// Package visitor donne la clé d'un visiteur pour les limites de débit, en mémoire seulement.
//
// En IPv4, l'adresse elle-même. En IPv6, le préfixe /64 : un abonné en reçoit couramment un
// entier (2^64 adresses), compter l'adresse exacte permettrait de contourner toute limite.
package visitor

import "net/netip"

// Key rend la clé de limite d'une adresse (« 192.0.2.1 », « 2001:db8:1:2::/64 »).
func Key(addr string) string {
	ip, err := netip.ParseAddr(addr)
	if err != nil {
		if ap, err2 := netip.ParseAddrPort(addr); err2 == nil {
			ip = ap.Addr()
		} else {
			return addr
		}
	}
	ip = ip.Unmap().WithZone("")
	if ip.Is4() {
		return ip.String()
	}
	p, err := ip.Prefix(64)
	if err != nil {
		return ip.String()
	}
	return p.String()
}
