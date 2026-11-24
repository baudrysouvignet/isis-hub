package tcg

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"sort"
	"strings"
	"time"
)

// R2 : stockage d'objets Cloudflare R2 (API compatible S3), signé en AWS Signature V4, sans
// dépendance. Les images restent privées dans le seau : c'est ce serveur qui les lit et les sert,
// la page ne contacte jamais Cloudflare (aucun tiers ne voit les visiteurs).
type R2 struct {
	Endpoint  string // https://<compte>.r2.cloudflarestorage.com
	Bucket    string
	AccessKey string
	SecretKey string
	Prefix    string // dossier dans le seau (« tcg/ »)
	Region    string // « auto » pour R2
	Client    *http.Client
	now       func() time.Time
}

// NewR2 : client pour le compte Cloudflare `account` (identifiant de compte, 32 caractères).
func NewR2(account, bucket, accessKey, secretKey string) *R2 {
	return &R2{
		Endpoint: "https://" + account + ".r2.cloudflarestorage.com", Bucket: bucket,
		AccessKey: accessKey, SecretKey: secretKey, Prefix: "tcg/", Region: "auto",
		Client: &http.Client{Timeout: 20 * time.Second}, now: time.Now,
	}
}

func (r *R2) Kind() string { return "r2" }

func (r *R2) objectURL(name string) string {
	return strings.TrimRight(r.Endpoint, "/") + "/" + r.Bucket + "/" + r.Prefix + name
}

func (r *R2) do(ctx context.Context, method, name string, body []byte, ctype string) (*http.Response, error) {
	if name != "" && !NameRE.MatchString(name) && name != "isis-hub-check.txt" {
		return nil, ErrImage
	}
	req, err := http.NewRequestWithContext(ctx, method, r.objectURL(name), bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	if ctype != "" {
		req.Header.Set("Content-Type", ctype)
	}
	if body == nil {
		req.Body = nil
		req.ContentLength = 0
	}
	r.sign(req, body)
	return r.Client.Do(req)
}

func (r *R2) Put(name string, data []byte, ctype string) error {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	res, err := r.do(ctx, http.MethodPut, name, data, ctype)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	io.Copy(io.Discard, io.LimitReader(res.Body, 64<<10))
	if res.StatusCode/100 != 2 {
		return fmt.Errorf("R2 : HTTP %d à l'envoi", res.StatusCode)
	}
	return nil
}

func (r *R2) Get(name string) ([]byte, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	res, err := r.do(ctx, http.MethodGet, name, nil, "")
	if err != nil {
		return nil, err
	}
	defer res.Body.Close()
	if res.StatusCode == http.StatusNotFound {
		return nil, ErrNotFound
	}
	if res.StatusCode/100 != 2 {
		return nil, fmt.Errorf("R2 : HTTP %d à la lecture", res.StatusCode)
	}
	return io.ReadAll(io.LimitReader(res.Body, 2<<20))
}

func (r *R2) Delete(name string) error {
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	res, err := r.do(ctx, http.MethodDelete, name, nil, "")
	if err != nil {
		return err
	}
	defer res.Body.Close()
	if res.StatusCode/100 != 2 && res.StatusCode != http.StatusNotFound {
		return fmt.Errorf("R2 : HTTP %d à la suppression", res.StatusCode)
	}
	return nil
}

// Check : écrit, relit et efface un petit objet (commande « isis-hub r2check »).
func (r *R2) Check() error {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	payload := []byte("ISIS Hub : test d'accès au seau " + r.now().UTC().Format(time.RFC3339))
	res, err := r.do(ctx, http.MethodPut, "isis-hub-check.txt", payload, "text/plain")
	if err != nil {
		return fmt.Errorf("envoi : %w", err)
	}
	body, _ := io.ReadAll(io.LimitReader(res.Body, 4<<10))
	res.Body.Close()
	if res.StatusCode/100 != 2 {
		return fmt.Errorf("envoi refusé (HTTP %d) : %s", res.StatusCode, strings.TrimSpace(string(body)))
	}
	res, err = r.do(ctx, http.MethodGet, "isis-hub-check.txt", nil, "")
	if err != nil {
		return fmt.Errorf("lecture : %w", err)
	}
	got, _ := io.ReadAll(io.LimitReader(res.Body, 4<<10))
	res.Body.Close()
	if res.StatusCode/100 != 2 || !bytes.Equal(got, payload) {
		return fmt.Errorf("lecture refusée ou différente (HTTP %d)", res.StatusCode)
	}
	res, err = r.do(ctx, http.MethodDelete, "isis-hub-check.txt", nil, "")
	if err != nil {
		return fmt.Errorf("suppression : %w", err)
	}
	res.Body.Close()
	if res.StatusCode/100 != 2 {
		return fmt.Errorf("suppression refusée (HTTP %d)", res.StatusCode)
	}
	return nil
}

// ------------------------------------------------------------ AWS Signature V4

func sha256hex(b []byte) string {
	s := sha256.Sum256(b)
	return hex.EncodeToString(s[:])
}

func hmacSHA256(key []byte, s string) []byte {
	m := hmac.New(sha256.New, key)
	m.Write([]byte(s))
	return m.Sum(nil)
}

// uriEncode : encodage des chemins selon SigV4 (tout sauf A-Z a-z 0-9 - _ . ~ et « / »).
func uriEncode(s string, keepSlash bool) string {
	var b strings.Builder
	for i := 0; i < len(s); i++ {
		c := s[i]
		switch {
		case c >= 'A' && c <= 'Z', c >= 'a' && c <= 'z', c >= '0' && c <= '9', c == '-', c == '_', c == '.', c == '~':
			b.WriteByte(c)
		case c == '/' && keepSlash:
			b.WriteByte(c)
		default:
			fmt.Fprintf(&b, "%%%02X", c)
		}
	}
	return b.String()
}

// sign ajoute les en-têtes x-amz-date, x-amz-content-sha256 et Authorization.
func (r *R2) sign(req *http.Request, body []byte) {
	now := time.Now
	if r.now != nil {
		now = r.now
	}
	t := now().UTC()
	amzDate := t.Format("20060102T150405Z")
	day := t.Format("20060102")
	payload := sha256hex(body)
	req.Header.Set("x-amz-date", amzDate)
	req.Header.Set("x-amz-content-sha256", payload)
	req.Header.Set("Authorization", signature(req, payload, amzDate, day, r.Region, r.AccessKey, r.SecretKey))
}

// signature : en-tête Authorization (fonction pure, vérifiée sur l'exemple de la documentation AWS).
func signature(req *http.Request, payload, amzDate, day, region, access, secret string) string {
	host := req.URL.Host
	if req.Host != "" {
		host = req.Host
	}
	headers := map[string]string{"host": host}
	for k, v := range req.Header {
		lk := strings.ToLower(k)
		if lk == "authorization" || lk == "user-agent" {
			continue
		}
		headers[lk] = strings.TrimSpace(strings.Join(v, ","))
	}
	names := make([]string, 0, len(headers))
	for k := range headers {
		names = append(names, k)
	}
	sort.Strings(names)
	var canonHeaders strings.Builder
	for _, k := range names {
		canonHeaders.WriteString(k + ":" + headers[k] + "\n")
	}
	signed := strings.Join(names, ";")
	// Requête canonique : chemin encodé, paramètres triés.
	q := req.URL.Query()
	keys := make([]string, 0, len(q))
	for k := range q {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	var qs []string
	for _, k := range keys {
		vals := append([]string(nil), q[k]...)
		sort.Strings(vals)
		for _, v := range vals {
			qs = append(qs, uriEncode(k, false)+"="+uriEncode(v, false))
		}
	}
	path := req.URL.EscapedPath()
	if p, err := url.PathUnescape(path); err == nil {
		path = uriEncode(p, true)
	}
	if path == "" {
		path = "/"
	}
	canon := strings.Join([]string{req.Method, path, strings.Join(qs, "&"), canonHeaders.String(), signed, payload}, "\n")
	scope := day + "/" + region + "/s3/aws4_request"
	toSign := "AWS4-HMAC-SHA256\n" + amzDate + "\n" + scope + "\n" + sha256hex([]byte(canon))
	k := hmacSHA256([]byte("AWS4"+secret), day)
	k = hmacSHA256(k, region)
	k = hmacSHA256(k, "s3")
	k = hmacSHA256(k, "aws4_request")
	sig := hex.EncodeToString(hmacSHA256(k, toSign))
	return "AWS4-HMAC-SHA256 Credential=" + access + "/" + scope + ", SignedHeaders=" + signed + ", Signature=" + sig
}

var accountRE = regexp.MustCompile(`^[0-9a-f]{32}$`)

// R2FromEnv : client R2 si les quatre variables sont présentes, nil sinon ; erreur si incomplet.
func R2FromEnv(get func(string) string) (*R2, error) {
	acc, bucket, key, secret := get("R2_ACCOUNT_ID"), get("R2_BUCKET"), get("R2_ACCESS_KEY_ID"), get("R2_SECRET_ACCESS_KEY")
	n := 0
	for _, v := range []string{acc, bucket, key, secret} {
		if v != "" {
			n++
		}
	}
	switch n {
	case 0:
		return nil, nil
	case 4:
		if !accountRE.MatchString(acc) {
			return nil, fmt.Errorf("R2_ACCOUNT_ID : 32 caractères hexadécimaux attendus, %d reçus (copie incomplète ?). Tableau de bord Cloudflare → R2 → « Account ID »", len(acc))
		}
		if len(key) != 32 || len(secret) != 64 {
			return nil, fmt.Errorf("R2 : Access Key ID (32 caractères) ou Secret Access Key (64) incomplet : %d et %d reçus", len(key), len(secret))
		}
		r := NewR2(acc, bucket, key, secret)
		if ep := get("R2_ENDPOINT"); ep != "" { // tests (faux S3) ou juridiction (…eu.r2.cloudflarestorage.com)
			r.Endpoint = ep
		}
		return r, nil
	}
	return nil, errors.New("R2 : définir R2_ACCOUNT_ID, R2_BUCKET, R2_ACCESS_KEY_ID et R2_SECRET_ACCESS_KEY (les quatre)")
}
