package wisp

// WebSocket côté serveur (RFC 6455), réduit à ce dont le relais a besoin :
// trames binaires, ping/pong, fermeture. Pas d'extension (compression) ni de sous-protocole.

import (
	"bufio"
	"crypto/sha1"
	"encoding/base64"
	"encoding/binary"
	"errors"
	"io"
	"net"
	"net/http"
	"strings"
	"sync"
	"time"
)

const (
	opContinuation = 0x0
	opText         = 0x1
	opBinary       = 0x2
	opClose        = 0x8
	opPing         = 0x9
	opPong         = 0xA

	wsGUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"
)

var (
	errTooLarge  = errors.New("message trop grand")
	errProtocol  = errors.New("trame WebSocket invalide")
	errClosedByP = errors.New("fermeture demandée par le client")
)

type wsConn struct {
	conn   net.Conn
	r      *bufio.Reader
	wmu    sync.Mutex
	maxMsg int
}

func headerHas(h http.Header, name, token string) bool {
	for _, v := range h.Values(name) {
		for _, part := range strings.Split(v, ",") {
			if strings.EqualFold(strings.TrimSpace(part), token) {
				return true
			}
		}
	}
	return false
}

// isUpgrade dit si la requête demande une connexion WebSocket valide.
func isUpgrade(r *http.Request) bool {
	return r.Method == http.MethodGet &&
		headerHas(r.Header, "Connection", "upgrade") &&
		headerHas(r.Header, "Upgrade", "websocket") &&
		r.Header.Get("Sec-WebSocket-Version") == "13" &&
		r.Header.Get("Sec-WebSocket-Key") != ""
}

func acceptKey(key string) string {
	h := sha1.New()
	h.Write([]byte(key + wsGUID))
	return base64.StdEncoding.EncodeToString(h.Sum(nil))
}

// upgrade termine la poignée de main et rend la connexion brute.
func upgrade(w http.ResponseWriter, r *http.Request, maxMsg int) (*wsConn, error) {
	hj, ok := w.(http.Hijacker)
	if !ok {
		return nil, errors.New("connexion non détournable")
	}
	conn, rw, err := hj.Hijack()
	if err != nil {
		return nil, err
	}
	resp := "HTTP/1.1 101 Switching Protocols\r\n" +
		"Upgrade: websocket\r\nConnection: Upgrade\r\n" +
		"Sec-WebSocket-Accept: " + acceptKey(r.Header.Get("Sec-WebSocket-Key")) + "\r\n\r\n"
	conn.SetWriteDeadline(time.Now().Add(10 * time.Second))
	if _, err := conn.Write([]byte(resp)); err != nil {
		conn.Close()
		return nil, err
	}
	conn.SetDeadline(time.Time{})
	return &wsConn{conn: conn, r: rw.Reader, maxMsg: maxMsg}, nil
}

// writeFrame envoie une trame non masquée (le serveur ne masque jamais).
func (c *wsConn) writeFrame(op byte, payload []byte) error {
	var head [10]byte
	head[0] = 0x80 | op
	n := 2
	switch l := len(payload); {
	case l < 126:
		head[1] = byte(l)
	case l <= 0xFFFF:
		head[1] = 126
		binary.BigEndian.PutUint16(head[2:], uint16(l))
		n = 4
	default:
		head[1] = 127
		binary.BigEndian.PutUint64(head[2:], uint64(l))
		n = 10
	}
	c.wmu.Lock()
	defer c.wmu.Unlock()
	c.conn.SetWriteDeadline(time.Now().Add(30 * time.Second))
	if _, err := c.conn.Write(head[:n]); err != nil {
		return err
	}
	_, err := c.conn.Write(payload)
	return err
}

// writeBinary envoie un message binaire composé de plusieurs morceaux sans les recopier.
func (c *wsConn) writeBinary(parts ...[]byte) error {
	total := 0
	for _, p := range parts {
		total += len(p)
	}
	buf := make([]byte, 0, total)
	for _, p := range parts {
		buf = append(buf, p...)
	}
	return c.writeFrame(opBinary, buf)
}

func (c *wsConn) close(code uint16) {
	var p [2]byte
	binary.BigEndian.PutUint16(p[:], code)
	c.writeFrame(opClose, p[:])
	c.conn.Close()
}

// readMessage rend le prochain message binaire complet. Les pings reçoivent un pong ;
// `alive` est appelé à chaque trame reçue (sert au délai d'inactivité).
func (c *wsConn) readMessage(alive func()) ([]byte, error) {
	var msg []byte
	started := false
	for {
		var h [2]byte
		if _, err := io.ReadFull(c.r, h[:]); err != nil {
			return nil, err
		}
		alive()
		fin := h[0]&0x80 != 0
		if h[0]&0x70 != 0 { // bits réservés : aucune extension n'a été négociée
			return nil, errProtocol
		}
		op := h[0] & 0x0F
		if h[1]&0x80 == 0 { // un client doit masquer ses trames
			return nil, errProtocol
		}
		length := uint64(h[1] & 0x7F)
		switch length {
		case 126:
			var b [2]byte
			if _, err := io.ReadFull(c.r, b[:]); err != nil {
				return nil, err
			}
			length = uint64(binary.BigEndian.Uint16(b[:]))
		case 127:
			var b [8]byte
			if _, err := io.ReadFull(c.r, b[:]); err != nil {
				return nil, err
			}
			length = binary.BigEndian.Uint64(b[:])
		}
		if op >= 0x8 && (length > 125 || !fin) {
			return nil, errProtocol
		}
		if length > uint64(c.maxMsg) || uint64(len(msg))+length > uint64(c.maxMsg) {
			return nil, errTooLarge
		}
		var mask [4]byte
		if _, err := io.ReadFull(c.r, mask[:]); err != nil {
			return nil, err
		}
		payload := make([]byte, length)
		if _, err := io.ReadFull(c.r, payload); err != nil {
			return nil, err
		}
		for i := range payload {
			payload[i] ^= mask[i&3]
		}

		switch op {
		case opPing:
			if err := c.writeFrame(opPong, payload); err != nil {
				return nil, err
			}
			continue
		case opPong:
			continue
		case opClose:
			return nil, errClosedByP
		case opText:
			return nil, errProtocol // Wisp est un protocole binaire
		case opBinary:
			if started {
				return nil, errProtocol
			}
			started = true
			msg = payload
		case opContinuation:
			if !started {
				return nil, errProtocol
			}
			msg = append(msg, payload...)
		default:
			return nil, errProtocol
		}
		if fin {
			return msg, nil
		}
	}
}
