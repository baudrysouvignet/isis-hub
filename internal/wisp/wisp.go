// Package wisp est le relais aveugle d'ISIS Hub.
//
// La page ouvre UN WebSocket vers le relais et y multiplexe ses connexions TCP selon le
// protocole Wisp v1 (https://github.com/MercuryWorkshop/wisp-protocol). Chaque connexion
// transporte une session TLS négociée DANS le navigateur avec le portail de l'université :
// le relais ne fait que recopier des octets chiffrés, il n'a aucune clé pour les lire.
//
// Garanties tenues ici :
//   - seules les destinations de la liste fixe sont jointes (port 443, TCP) ;
//   - l'adresse IP résolue doit être publique, et c'est elle qui est appelée (pas de
//     seconde résolution DNS qu'un tiers pourrait détourner) ;
//   - rien n'est journalisé : ni adresse IP, ni destination, ni contenu ;
//   - plafonds par visiteur et au total, délais d'inactivité.
package wisp

import (
	"context"
	"encoding/binary"
	"errors"
	"net"
	"net/http"
	"net/netip"
	"strings"
	"sync"
	"sync/atomic"
	"time"
)

// Types de paquets et motifs de fermeture définis par Wisp v1.
const (
	pktConnect  = 0x01
	pktData     = 0x02
	pktContinue = 0x03
	pktClose    = 0x04

	streamTCP = 0x01

	closeVoluntary   = 0x02
	closeNetwork     = 0x03
	closeInvalid     = 0x41
	closeUnreachable = 0x42
	closeTimeout     = 0x47
	closeBlocked     = 0x48
	closeThrottled   = 0x49
)

// Config règle le relais. Les valeurs nulles prennent un défaut raisonnable.
type Config struct {
	Targets          []string      // « hôte:port » autorisés
	AllowedOrigins   []string      // origines de page acceptées ; vide = même hôte que la requête
	TrustProxy       bool          // lire l'IP du visiteur dans X-Forwarded-For (derrière Caddy)
	MaxConnsPerIP    int           // WebSockets simultanés par visiteur (une adresse de campus en NAT en porte beaucoup)
	MaxConns         int           // WebSockets simultanés au total
	MaxStreams       int           // connexions TCP simultanées par WebSocket
	MaxStreamsPerIP  int           // connexions TCP simultanées par visiteur, tous WebSockets confondus
	MaxStreamsTotal  int           // connexions TCP simultanées au total (vers l'université)
	ConnectsPerMin   int           // nouvelles connexions TCP par minute et par WebSocket
	Buffer           uint32        // paquets en vol autorisés par connexion (contrôle de flux)
	MaxMessage       int           // taille maximale d'un message WebSocket
	StreamBytes      int64         // octets en attente d'écriture par connexion avant coupure
	TotalBytes       int64         // octets en attente d'écriture, toutes connexions, avant refus
	FrameTimeout     time.Duration // délai pour recevoir une trame une fois son en-tête arrivé
	DialTimeout      time.Duration // délai d'ouverture d'une connexion TCP
	IdleTimeout      time.Duration // inactivité tolérée sur le WebSocket
	Resolver         func(ctx context.Context, host string) ([]netip.Addr, error)
	Dial             func(ctx context.Context, addr string) (net.Conn, error)
	AllowPrivateAddr bool // tests uniquement
}

func (c *Config) defaults() {
	if c.MaxConnsPerIP == 0 {
		c.MaxConnsPerIP = 96
	}
	if c.MaxConns == 0 {
		c.MaxConns = 2000
	}
	if c.MaxStreams == 0 {
		c.MaxStreams = 16 // la page en ouvre au plus 6 à la fois
	}
	if c.MaxStreamsPerIP == 0 {
		c.MaxStreamsPerIP = 256
	}
	if c.MaxStreamsTotal == 0 {
		c.MaxStreamsTotal = 6000
	}
	if c.ConnectsPerMin == 0 {
		c.ConnectsPerMin = 120
	}
	if c.Buffer == 0 {
		c.Buffer = 32 // 32 enregistrements TLS (≤ 16 Kio) : 512 Kio en vol, bien assez
	}
	if c.MaxMessage == 0 {
		c.MaxMessage = 64 << 10 // un enregistrement TLS fait au plus ~17 Kio
	}
	if c.StreamBytes == 0 {
		c.StreamBytes = 1 << 20
	}
	if c.TotalBytes == 0 {
		c.TotalBytes = 256 << 20
	}
	if c.FrameTimeout == 0 {
		c.FrameTimeout = 15 * time.Second
	}
	if c.DialTimeout == 0 {
		c.DialTimeout = 10 * time.Second
	}
	if c.IdleTimeout == 0 {
		c.IdleTimeout = 2 * time.Minute
	}
	if c.Resolver == nil {
		c.Resolver = func(ctx context.Context, host string) ([]netip.Addr, error) {
			return net.DefaultResolver.LookupNetIP(ctx, "ip", host)
		}
	}
	if c.Dial == nil {
		d := &net.Dialer{Timeout: c.DialTimeout, KeepAlive: 30 * time.Second}
		c.Dial = func(ctx context.Context, addr string) (net.Conn, error) { return d.DialContext(ctx, "tcp", addr) }
	}
}

// Stats est un compteur agrégé, sans aucune donnée personnelle.
type Stats struct {
	Conns   atomic.Int64
	Streams atomic.Int64
	Refused atomic.Int64
}

type Relay struct {
	cfg       Config
	targets   map[string]bool
	origins   map[string]bool
	mu        sync.Mutex
	perIP     map[string]int
	total     int
	ipStreams map[string]int
	streams   int
	queued    atomic.Int64 // octets reçus de pages, pas encore écrits vers les portails
	Stats     Stats
}

func New(cfg Config) *Relay {
	cfg.defaults()
	r := &Relay{cfg: cfg, targets: map[string]bool{}, origins: map[string]bool{}, perIP: map[string]int{}, ipStreams: map[string]int{}}
	for _, t := range cfg.Targets {
		r.targets[strings.ToLower(t)] = true
	}
	for _, o := range cfg.AllowedOrigins {
		r.origins[strings.TrimRight(o, "/")] = true
	}
	return r
}

func (r *Relay) clientIP(req *http.Request) string {
	if r.cfg.TrustProxy {
		if xff := req.Header.Get("X-Forwarded-For"); xff != "" {
			parts := strings.Split(xff, ",")
			return strings.TrimSpace(parts[len(parts)-1]) // ajoutée par notre propre frontal
		}
	}
	host, _, err := net.SplitHostPort(req.RemoteAddr)
	if err != nil {
		return req.RemoteAddr
	}
	return host
}

func (r *Relay) originAllowed(req *http.Request) bool {
	origin := req.Header.Get("Origin")
	if origin == "" {
		return false
	}
	if len(r.origins) > 0 {
		return r.origins[origin]
	}
	host := req.Host
	if r.cfg.TrustProxy && req.Header.Get("X-Forwarded-Host") != "" {
		host = req.Header.Get("X-Forwarded-Host")
	}
	return origin == "https://"+host || origin == "http://"+host
}

func (r *Relay) acquire(ip string) bool {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.total >= r.cfg.MaxConns || r.perIP[ip] >= r.cfg.MaxConnsPerIP {
		return false
	}
	r.total++
	r.perIP[ip]++
	return true
}

func (r *Relay) release(ip string) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.total--
	if r.perIP[ip]--; r.perIP[ip] <= 0 {
		delete(r.perIP, ip) // rien ne reste en mémoire une fois le visiteur parti
	}
}

// Connexions TCP vers l'université : plafonnées par visiteur et au total, pour qu'un client ne
// puisse ni épuiser le serveur ni faire bannir l'adresse du relais par le pare-feu de l'université.
func (r *Relay) acquireStream(ip string) bool {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.streams >= r.cfg.MaxStreamsTotal || r.ipStreams[ip] >= r.cfg.MaxStreamsPerIP {
		return false
	}
	r.streams++
	r.ipStreams[ip]++
	return true
}

func (r *Relay) releaseStream(ip string) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.streams--
	if r.ipStreams[ip]--; r.ipStreams[ip] <= 0 {
		delete(r.ipStreams, ip)
	}
}

// ServeHTTP accepte un WebSocket Wisp.
func (r *Relay) ServeHTTP(w http.ResponseWriter, req *http.Request) {
	if !isUpgrade(req) {
		http.Error(w, "WebSocket Wisp attendu", http.StatusUpgradeRequired)
		return
	}
	if !r.originAllowed(req) {
		r.Stats.Refused.Add(1)
		http.Error(w, "origine refusée", http.StatusForbidden)
		return
	}
	ip := r.clientIP(req)
	if !r.acquire(ip) {
		r.Stats.Refused.Add(1)
		http.Error(w, "trop de connexions", http.StatusTooManyRequests)
		return
	}
	defer r.release(ip)

	ws, err := upgrade(w, req, r.cfg.MaxMessage)
	if err != nil {
		return
	}
	ws.frameTimeout = r.cfg.FrameTimeout
	r.Stats.Conns.Add(1)
	defer r.Stats.Conns.Add(-1)
	(&session{relay: r, ws: ws, ip: ip, streams: map[uint32]*stream{}}).run()
}

// ---------------------------------------------------------------- session Wisp

type session struct {
	relay    *Relay
	ws       *wsConn
	ip       string
	mu       sync.Mutex
	streams  map[uint32]*stream
	window   time.Time
	connects int
	closed   atomic.Bool
}

type stream struct {
	id     uint32
	queue  chan []byte
	bytes  atomic.Int64 // octets dans la file (budget par connexion)
	conn   net.Conn
	ready  chan struct{} // fermé quand la connexion TCP est ouverte (ou a échoué)
	cancel context.CancelFunc
}

func packet(kind byte, id uint32, payload ...byte) []byte {
	p := make([]byte, 5, 5+len(payload))
	p[0] = kind
	binary.LittleEndian.PutUint32(p[1:], id)
	return append(p, payload...)
}

func u32(v uint32) []byte {
	b := make([]byte, 4)
	binary.LittleEndian.PutUint32(b, v)
	return b
}

func (s *session) send(kind byte, id uint32, payload []byte) error {
	head := packet(kind, id)
	return s.ws.writeBinary(head, payload)
}

func (s *session) run() {
	cfg := &s.relay.cfg
	defer s.shutdown()

	// Délai d'inactivité : toute trame reçue le repousse ; un ping régulier garde la ligne ouverte.
	deadline := func() { s.ws.conn.SetReadDeadline(time.Now().Add(cfg.IdleTimeout)) }
	deadline()
	stop := make(chan struct{})
	defer close(stop)
	go func() {
		t := time.NewTicker(30 * time.Second)
		defer t.Stop()
		for {
			select {
			case <-stop:
				return
			case <-t.C:
				if s.ws.writeFrame(opPing, nil) != nil {
					return
				}
			}
		}
	}()

	// Paquet initial : CONTINUE sur le flux 0 annonce la taille du tampon de chaque connexion.
	if s.send(pktContinue, 0, u32(cfg.Buffer)) != nil {
		return
	}
	for {
		msg, err := s.ws.readMessage(deadline)
		if err != nil {
			if errors.Is(err, errTooLarge) || errors.Is(err, errProtocol) {
				s.ws.close(1002)
			}
			return
		}
		if len(msg) < 5 {
			return
		}
		kind, id, payload := msg[0], binary.LittleEndian.Uint32(msg[1:5]), msg[5:]
		switch kind {
		case pktConnect:
			s.connect(id, payload)
		case pktData:
			// L'envoi dans la file se fait sous le verrou : closeStream ferme la file sous ce
			// même verrou, après avoir retiré la connexion, donc jamais d'écriture tardive.
			// Budget en octets (par connexion et au total), pas seulement en paquets : un client
			// qui n'attend pas les CONTINUE ne peut pas faire gonfler la mémoire du serveur.
			overflow := false
			n := int64(len(payload))
			s.mu.Lock()
			if st := s.streams[id]; st != nil {
				if st.bytes.Load()+n > cfg.StreamBytes || s.relay.queued.Load()+n > cfg.TotalBytes {
					overflow = true
				} else {
					select {
					case st.queue <- payload:
						st.bytes.Add(n)
						s.relay.queued.Add(n)
					default:
						overflow = true
					}
				}
			}
			s.mu.Unlock()
			if overflow { // le client dépasse le tampon annoncé : on coupe cette connexion seulement
				s.closeStream(id, closeThrottled, true)
			}
		case pktClose:
			s.closeStream(id, closeVoluntary, false)
		case pktContinue:
			// le client n'a pas à en envoyer ; ignoré
		default:
			return
		}
	}
}

func (s *session) refuse(id uint32, reason byte) {
	s.relay.Stats.Refused.Add(1)
	s.send(pktClose, id, []byte{reason})
}

func (s *session) connect(id uint32, payload []byte) {
	cfg := &s.relay.cfg
	if id == 0 || len(payload) < 4 {
		s.refuse(id, closeInvalid)
		return
	}
	kind, port, host := payload[0], binary.LittleEndian.Uint16(payload[1:3]), strings.ToLower(string(payload[3:]))
	target := net.JoinHostPort(host, itoa(int(port)))
	if kind != streamTCP || !s.relay.targets[target] {
		s.refuse(id, closeBlocked)
		return
	}

	s.mu.Lock()
	now := time.Now()
	if now.Sub(s.window) > time.Minute {
		s.window, s.connects = now, 0
	}
	s.connects++
	_, exists := s.streams[id]
	full := len(s.streams) >= cfg.MaxStreams || s.connects > cfg.ConnectsPerMin
	if exists || full || !s.relay.acquireStream(s.ip) {
		s.mu.Unlock()
		s.refuse(id, map[bool]byte{true: closeInvalid, false: closeThrottled}[exists])
		return
	}
	ctx, cancel := context.WithCancel(context.Background())
	st := &stream{id: id, queue: make(chan []byte, 2*cfg.Buffer), ready: make(chan struct{}), cancel: cancel}
	s.streams[id] = st
	s.mu.Unlock()
	s.relay.Stats.Streams.Add(1)

	go s.pump(ctx, st, host, port)
}

func itoa(n int) string {
	if n == 0 {
		return "0"
	}
	var b [6]byte
	i := len(b)
	for n > 0 {
		i--
		b[i] = byte('0' + n%10)
		n /= 10
	}
	return string(b[i:])
}

func publicAddr(a netip.Addr) bool {
	a = a.Unmap()
	return a.IsGlobalUnicast() && !a.IsPrivate() && !a.IsLoopback() && !a.IsLinkLocalUnicast()
}

// pump ouvre la connexion TCP puis recopie les octets dans les deux sens.
func (s *session) pump(ctx context.Context, st *stream, host string, port uint16) {
	cfg := &s.relay.cfg
	dialCtx, cancelDial := context.WithTimeout(ctx, cfg.DialTimeout)
	defer cancelDial()

	addrs, err := cfg.Resolver(dialCtx, host)
	var conn net.Conn
	if err == nil {
		err = errors.New("aucune adresse publique")
		for _, a := range addrs {
			if !cfg.AllowPrivateAddr && !publicAddr(a) {
				continue
			}
			if conn, err = cfg.Dial(dialCtx, netip.AddrPortFrom(a.Unmap(), port).String()); err == nil {
				break
			}
		}
	}
	if err != nil {
		reason := byte(closeUnreachable)
		if errors.Is(err, context.DeadlineExceeded) {
			reason = closeTimeout
		}
		s.closeStream(st.id, reason, true)
		close(st.ready)
		return
	}
	st.conn = conn
	close(st.ready)

	// Page → portail : écrit les paquets reçus et rouvre la fenêtre d'envoi au fil de l'eau.
	go func() {
		processed := uint32(0)
		for data := range st.queue {
			st.bytes.Add(-int64(len(data)))
			s.relay.queued.Add(-int64(len(data)))
			conn.SetWriteDeadline(time.Now().Add(cfg.IdleTimeout))
			if _, err := conn.Write(data); err != nil {
				s.closeStream(st.id, closeNetwork, true)
				return
			}
			if processed++; processed >= cfg.Buffer/4 {
				processed = 0
				free := cfg.Buffer - min(uint32(len(st.queue)), cfg.Buffer)
				if free > 0 && s.send(pktContinue, st.id, u32(free)) != nil {
					return
				}
			}
		}
	}()

	// Portail → page.
	buf := make([]byte, 32*1024)
	for {
		conn.SetReadDeadline(time.Now().Add(cfg.IdleTimeout))
		n, err := conn.Read(buf)
		if n > 0 {
			if s.send(pktData, st.id, buf[:n]) != nil {
				s.closeStream(st.id, closeNetwork, false)
				return
			}
		}
		if err != nil {
			s.closeStream(st.id, closeVoluntary, true)
			return
		}
	}
}

// closeStream libère une connexion ; `notify` prévient la page par un paquet CLOSE.
func (s *session) closeStream(id uint32, reason byte, notify bool) {
	s.mu.Lock()
	st := s.streams[id]
	if st != nil {
		delete(s.streams, id)
		close(st.queue)
	}
	s.mu.Unlock()
	if st == nil {
		return
	}
	s.relay.releaseStream(s.ip)
	// Octets jamais écrits : rendus au budget global (la file n'est plus lue après la coupure).
	go func() {
		for data := range st.queue {
			st.bytes.Add(-int64(len(data)))
			s.relay.queued.Add(-int64(len(data)))
		}
	}()
	st.cancel()
	go func() {
		<-st.ready
		if st.conn != nil {
			st.conn.Close()
		}
	}()
	s.relay.Stats.Streams.Add(-1)
	if notify && !s.closed.Load() {
		s.send(pktClose, id, []byte{reason})
	}
}

func (s *session) shutdown() {
	s.closed.Store(true)
	s.mu.Lock()
	ids := make([]uint32, 0, len(s.streams))
	for id := range s.streams {
		ids = append(ids, id)
	}
	s.mu.Unlock()
	for _, id := range ids {
		s.closeStream(id, closeVoluntary, false)
	}
	s.ws.conn.Close()
}
