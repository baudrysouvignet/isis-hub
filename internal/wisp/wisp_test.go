package wisp

import (
	"bufio"
	"bytes"
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/binary"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"net/netip"
	"strings"
	"testing"
	"time"
)

// ---------------------------------------------------------- client de test

type client struct {
	conn net.Conn
	r    *bufio.Reader
}

func dialWS(t *testing.T, srv *httptest.Server, origin string) (*client, *http.Response) {
	t.Helper()
	conn, err := net.Dial("tcp", strings.TrimPrefix(srv.URL, "http://"))
	if err != nil {
		t.Fatal(err)
	}
	key := make([]byte, 16)
	rand.Read(key)
	req, _ := http.NewRequest("GET", srv.URL+"/wisp/", nil)
	req.Header.Set("Connection", "Upgrade")
	req.Header.Set("Upgrade", "websocket")
	req.Header.Set("Sec-WebSocket-Version", "13")
	req.Header.Set("Sec-WebSocket-Key", base64.StdEncoding.EncodeToString(key))
	if origin != "" {
		req.Header.Set("Origin", origin)
	}
	req.Write(conn)
	r := bufio.NewReader(conn)
	res, err := http.ReadResponse(r, req)
	if err != nil {
		t.Fatal(err)
	}
	if res.StatusCode != http.StatusSwitchingProtocols {
		conn.Close()
		return nil, res
	}
	return &client{conn: conn, r: r}, res
}

func (c *client) sendFrame(op byte, payload []byte) {
	head := []byte{0x80 | op}
	switch l := len(payload); {
	case l < 126:
		head = append(head, 0x80|byte(l))
	case l <= 0xFFFF:
		head = append(head, 0x80|126, byte(l>>8), byte(l))
	default:
		var b [8]byte
		binary.BigEndian.PutUint64(b[:], uint64(l))
		head = append(append(head, 0x80|127), b[:]...)
	}
	mask := []byte{1, 2, 3, 4}
	masked := make([]byte, len(payload))
	for i := range payload {
		masked[i] = payload[i] ^ mask[i&3]
	}
	c.conn.Write(append(append(head, mask...), masked...))
}

func (c *client) send(kind byte, id uint32, payload []byte) {
	c.sendFrame(opBinary, append(packet(kind, id), payload...))
}

func (c *client) read(t *testing.T) (byte, uint32, []byte) {
	t.Helper()
	c.conn.SetReadDeadline(time.Now().Add(5 * time.Second))
	for {
		var h [2]byte
		if _, err := io.ReadFull(c.r, h[:]); err != nil {
			t.Fatal("lecture :", err)
		}
		n := int(h[1] & 0x7F)
		if n == 126 {
			var b [2]byte
			io.ReadFull(c.r, b[:])
			n = int(binary.BigEndian.Uint16(b[:]))
		} else if n == 127 {
			var b [8]byte
			io.ReadFull(c.r, b[:])
			n = int(binary.BigEndian.Uint64(b[:]))
		}
		p := make([]byte, n)
		io.ReadFull(c.r, p)
		if h[0]&0x0F == opPing {
			continue
		}
		if h[0]&0x0F == opClose {
			return 0xFF, 0, p
		}
		return p[0], binary.LittleEndian.Uint32(p[1:5]), p[5:]
	}
}

func connectPayload(host string, port uint16) []byte {
	p := []byte{streamTCP, 0, 0}
	binary.LittleEndian.PutUint16(p[1:], port)
	return append(p, host...)
}

// ---------------------------------------------------------- banc d'essai

// echo écoute en local et renvoie tout ce qu'il reçoit : il joue le portail.
func echo(t *testing.T) (port uint16) {
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { ln.Close() })
	go func() {
		for {
			c, err := ln.Accept()
			if err != nil {
				return
			}
			go func() { io.Copy(c, c); c.Close() }()
		}
	}()
	return uint16(ln.Addr().(*net.TCPAddr).Port)
}

func newRelay(t *testing.T, port uint16, tweak func(*Config)) *httptest.Server {
	cfg := Config{
		Targets:          []string{"portail.test:" + itoa(int(port))},
		AllowPrivateAddr: true,
		Resolver: func(ctx context.Context, host string) ([]netip.Addr, error) {
			if host == "portail.test" {
				return []netip.Addr{netip.MustParseAddr("127.0.0.1")}, nil
			}
			return nil, &net.DNSError{Err: "inconnu", Name: host}
		},
	}
	if tweak != nil {
		tweak(&cfg)
	}
	mux := http.NewServeMux()
	mux.Handle("/wisp/", New(cfg))
	srv := httptest.NewServer(mux)
	t.Cleanup(srv.Close)
	return srv
}

func origin(srv *httptest.Server) string { return srv.URL } // même hôte que le relais

// ---------------------------------------------------------- tests

func TestInitialContinue(t *testing.T) {
	srv := newRelay(t, echo(t), nil)
	c, _ := dialWS(t, srv, origin(srv))
	kind, id, p := c.read(t)
	if kind != pktContinue || id != 0 || binary.LittleEndian.Uint32(p) != 32 {
		t.Fatalf("paquet initial inattendu : %x %d %x", kind, id, p)
	}
}

func TestRelaysBytesUnchanged(t *testing.T) {
	port := echo(t)
	srv := newRelay(t, port, nil)
	c, _ := dialWS(t, srv, origin(srv))
	c.read(t)
	c.send(pktConnect, 1, connectPayload("portail.test", port))
	msg := bytes.Repeat([]byte("\x17\x03\x03chiffré"), 3000) // ~30 Ko, comme un enregistrement TLS
	c.send(pktData, 1, msg)
	var got []byte
	for len(got) < len(msg) {
		kind, id, p := c.read(t)
		if kind == pktContinue {
			continue
		}
		if kind != pktData || id != 1 {
			t.Fatalf("paquet inattendu : type %x flux %d", kind, id)
		}
		got = append(got, p...)
	}
	if !bytes.Equal(got, msg) {
		t.Fatal("les octets ne sont pas recopiés à l'identique")
	}
}

func TestRefusesOtherDestinations(t *testing.T) {
	port := echo(t)
	srv := newRelay(t, port, nil)
	c, _ := dialWS(t, srv, origin(srv))
	c.read(t)
	cases := []struct {
		id      uint32
		payload []byte
	}{
		{1, connectPayload("example.com", 443)},            // hors liste
		{2, connectPayload("portail.test", port+1)},        // bon hôte, autre port
		{3, append([]byte{0x02, 0, 0}, "portail.test"...)}, // UDP
	}
	for _, tc := range cases {
		c.send(pktConnect, tc.id, tc.payload)
		kind, id, p := c.read(t)
		if kind != pktClose || id != tc.id || p[0] != closeBlocked {
			t.Fatalf("flux %d : attendu CLOSE 0x48, reçu type %x motif %x", tc.id, kind, p)
		}
	}
}

func TestRefusesPrivateAddresses(t *testing.T) {
	port := echo(t)
	srv := newRelay(t, port, func(c *Config) { c.AllowPrivateAddr = false })
	c, _ := dialWS(t, srv, origin(srv))
	c.read(t)
	c.send(pktConnect, 1, connectPayload("portail.test", port)) // résolu en 127.0.0.1
	kind, _, p := c.read(t)
	if kind != pktClose || p[0] != closeUnreachable {
		t.Fatalf("une adresse privée doit être refusée, reçu type %x motif %x", kind, p)
	}
}

func TestOriginChecked(t *testing.T) {
	srv := newRelay(t, echo(t), nil)
	for _, o := range []string{"", "https://site-malveillant.example"} {
		if c, res := dialWS(t, srv, o); c != nil || res.StatusCode != http.StatusForbidden {
			t.Fatalf("origine %q : attendu 403, reçu %d", o, res.StatusCode)
		}
	}
	srv2 := newRelay(t, echo(t), func(c *Config) { c.AllowedOrigins = []string{"https://hub.exemple.fr"} })
	if c, _ := dialWS(t, srv2, "https://hub.exemple.fr"); c == nil {
		t.Fatal("l'origine configurée doit être acceptée")
	}
}

func TestPerVisitorCap(t *testing.T) {
	srv := newRelay(t, echo(t), func(c *Config) { c.MaxConnsPerIP = 2 })
	a, _ := dialWS(t, srv, origin(srv))
	b, _ := dialWS(t, srv, origin(srv))
	if a == nil || b == nil {
		t.Fatal("les deux premières connexions doivent passer")
	}
	if c, res := dialWS(t, srv, origin(srv)); c != nil || res.StatusCode != http.StatusTooManyRequests {
		t.Fatalf("la troisième doit être refusée (429), reçu %d", res.StatusCode)
	}
	a.conn.Close()
	time.Sleep(100 * time.Millisecond)
	if c, _ := dialWS(t, srv, origin(srv)); c == nil {
		t.Fatal("une place libérée doit être réutilisable")
	}
}

func TestStreamCap(t *testing.T) {
	port := echo(t)
	srv := newRelay(t, port, func(c *Config) { c.MaxStreams = 2 })
	c, _ := dialWS(t, srv, origin(srv))
	c.read(t)
	for id := uint32(1); id <= 3; id++ {
		c.send(pktConnect, id, connectPayload("portail.test", port))
	}
	kind, id, p := c.read(t)
	if kind != pktClose || id != 3 || p[0] != closeThrottled {
		t.Fatalf("la 3e connexion doit être refusée (0x49), reçu type %x flux %d", kind, id)
	}
}

func TestTextFrameClosesConnection(t *testing.T) {
	srv := newRelay(t, echo(t), nil)
	c, _ := dialWS(t, srv, origin(srv))
	c.read(t)
	c.sendFrame(opText, []byte("bonjour"))
	if kind, _, _ := c.read(t); kind != 0xFF {
		t.Fatal("une trame texte doit fermer la connexion")
	}
}

func TestPortalCloseIsForwarded(t *testing.T) {
	ln, _ := net.Listen("tcp", "127.0.0.1:0")
	defer ln.Close()
	go func() {
		c, err := ln.Accept()
		if err == nil {
			c.Write([]byte("au revoir"))
			c.Close()
		}
	}()
	port := uint16(ln.Addr().(*net.TCPAddr).Port)
	srv := newRelay(t, port, nil)
	c, _ := dialWS(t, srv, origin(srv))
	c.read(t)
	c.send(pktConnect, 7, connectPayload("portail.test", port))
	if kind, _, p := c.read(t); kind != pktData || string(p) != "au revoir" {
		t.Fatalf("données attendues, reçu %x %q", kind, p)
	}
	if kind, id, _ := c.read(t); kind != pktClose || id != 7 {
		t.Fatalf("CLOSE attendu, reçu %x", kind)
	}
}

// Connexions TCP plafonnées par visiteur, tous WebSockets confondus.
func TestStreamCapPerVisitor(t *testing.T) {
	port := echo(t)
	srv := newRelay(t, port, func(c *Config) { c.MaxStreamsPerIP = 2 })
	a, _ := dialWS(t, srv, origin(srv))
	a.read(t)
	b, _ := dialWS(t, srv, origin(srv))
	b.read(t)
	a.send(pktConnect, 1, connectPayload("portail.test", port))
	a.send(pktConnect, 2, connectPayload("portail.test", port))
	time.Sleep(100 * time.Millisecond)
	b.send(pktConnect, 1, connectPayload("portail.test", port))
	if kind, id, p := b.read(t); kind != pktClose || id != 1 || p[0] != closeThrottled {
		t.Fatalf("3e connexion du même visiteur : refus 0x49 attendu, reçu %x flux %d", kind, id)
	}
	// Une place libérée se réutilise.
	a.send(pktClose, 1, []byte{closeVoluntary})
	time.Sleep(100 * time.Millisecond)
	b.send(pktConnect, 2, connectPayload("portail.test", port))
	b.send(pktData, 2, []byte("ping"))
	if kind, _, p := b.read(t); kind != pktData || string(p) != "ping" {
		t.Fatalf("après libération, données attendues, reçu %x %q", kind, p)
	}
}

// Un client qui ignore le contrôle de flux et inonde une connexion lente est coupé dès que son
// budget en octets est dépassé, sans faire gonfler la mémoire du serveur.
func TestByteBudgetCutsFlood(t *testing.T) {
	ln, _ := net.Listen("tcp", "127.0.0.1:0")
	defer ln.Close()
	hold := make(chan struct{})
	defer close(hold)
	go func() {
		c, err := ln.Accept()
		if err == nil {
			c.(*net.TCPConn).SetReadBuffer(4096)
			<-hold // portail qui ne lit jamais
			c.Close()
		}
	}()
	port := uint16(ln.Addr().(*net.TCPAddr).Port)
	srv := newRelay(t, port, func(c *Config) { c.StreamBytes = 64 << 10 })
	c, _ := dialWS(t, srv, origin(srv))
	c.read(t)
	c.send(pktConnect, 1, connectPayload("portail.test", port))
	time.Sleep(100 * time.Millisecond)
	chunk := make([]byte, 16<<10)
	go func() { // 16 Mio d'un coup, sans attendre de CONTINUE (bien plus que les tampons du système)
		for i := 0; i < 1024; i++ {
			c.send(pktData, 1, chunk)
		}
	}()
	for {
		kind, id, p := c.read(t)
		if kind == pktContinue {
			continue
		}
		if kind != pktClose || id != 1 || p[0] != closeThrottled {
			t.Fatalf("coupure 0x49 attendue, reçu %x flux %d", kind, id)
		}
		return
	}
}

// Message plus grand que la limite (64 Kio par défaut) : connexion fermée.
func TestMessageLimit(t *testing.T) {
	srv := newRelay(t, echo(t), nil)
	c, _ := dialWS(t, srv, origin(srv))
	c.read(t)
	c.sendFrame(opBinary, make([]byte, 65<<10))
	if kind, _, _ := c.read(t); kind != 0xFF {
		t.Fatal("un message de plus de 64 Kio doit fermer la connexion")
	}
}
