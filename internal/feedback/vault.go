package feedback

// Coffre synchronisé, anonyme et chiffré : ce que l'étudiant crée dans ISIS Hub (notes saisies,
// examens marqués, étiquettes et règles de mails) est retrouvé sur tous ses appareils, sans que
// le serveur puisse le lire NI savoir à qui il appartient.
//
// Tout est préparé dans la page, à la connexion :
//   secret = PBKDF2-SHA-256(mot de passe, sel = « isis-hub/sync/v1: » + identifiant, 600 000 tours)
//   - id   = SHA-256(secret[0:32])  → nom de l'enregistrement (64 caractères hexadécimaux)
//   - auth = secret[32:64]          → preuve pour lire / écrire (le serveur n'en garde que l'empreinte)
//   - clé  = secret[64:96]          → AES-GCM, ne quitte jamais l'appareil
// Le serveur ne reçoit que id, auth et des octets chiffrés. Il ne voit jamais l'identifiant ni le
// mot de passe : ni la base, ni son administrateur ne peuvent relier un enregistrement à quelqu'un.
//
// Poivre (VAULT_PEPPER, secret gardé HORS du dossier de données) : id et auth dépendent du mot de
// passe ; écrits tels quels, une copie du dossier permettrait de tester des mots de passe hors
// ligne (un identifiant connu + un mot de passe candidat → l'id existe-t-il ?). Avec le poivre, le
// fichier est rangé sous HMAC(poivre, id) et la preuve gardée sous HMAC(poivre, auth) : sans le
// poivre, le dossier ne permet plus aucun essai. Les anciens fichiers sont convertis à leur
// première utilisation.
//
// Quotas : taille par enregistrement, nombre et volume total, créations par adresse et par jour ;
// un enregistrement sans écriture ni lecture depuis 18 mois est effacé.

import (
	"crypto/hmac"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"sync"
	"time"
)

const (
	vaultMaxData     = 256 << 10 // octets chiffrés, encodés en base64
	vaultMaxRecords  = 100_000
	vaultKeepMonths  = 18
	vaultDefaultSize = 2 << 30 // volume total par défaut (VAULT_MAX_BYTES)
)

var (
	vaultIDRE   = regexp.MustCompile(`^[0-9a-f]{64}$`)
	vaultAuthRE = regexp.MustCompile(`^[A-Za-z0-9_-]{43}$`) // 32 octets en base64url
)

// vaultRecord : ce qui est écrit sur le disque. Aucune date précise, aucune adresse.
type vaultRecord struct {
	Auth  string `json:"auth"`  // SHA-256 de la preuve
	V     int64  `json:"v"`     // version (écritures concurrentes)
	Month string `json:"month"` // mois de la dernière écriture, pour purger un jour les comptes abandonnés
	Data  string `json:"data"`  // base64 : IV + texte chiffré AES-GCM
}

type VaultStore struct {
	mu       sync.Mutex
	dir      string
	pepper   []byte
	count    int
	bytes    int64
	MaxBytes int64 // volume total des enregistrements
	now      func() time.Time
}

// OpenVaultStore ouvre le coffre. `pepper` : secret du serveur (VAULT_PEPPER), vide = sans poivre.
func OpenVaultStore(dir string, pepper ...string) (*VaultStore, error) {
	dir = filepath.Join(dir, "vault")
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return nil, err
	}
	v := &VaultStore{dir: dir, now: time.Now, MaxBytes: vaultDefaultSize}
	if len(pepper) > 0 && pepper[0] != "" {
		v.pepper = []byte(pepper[0])
	}
	v.mu.Lock()
	v.scan()
	v.mu.Unlock()
	go func() { // purge quotidienne des enregistrements abandonnés
		for range time.Tick(24 * time.Hour) {
			v.mu.Lock()
			v.scan()
			v.mu.Unlock()
		}
	}()
	return v, nil
}

// scan recompte les enregistrements et efface ceux inutilisés depuis vaultKeepMonths mois.
func (v *VaultStore) scan() {
	limit := v.now().UTC().AddDate(0, -vaultKeepMonths, 0).Format("2006-01")
	v.count, v.bytes = 0, 0
	_ = filepath.WalkDir(v.dir, func(path string, d os.DirEntry, err error) error {
		if err != nil || d.IsDir() || filepath.Ext(d.Name()) != ".json" {
			return nil
		}
		info, err := d.Info()
		if err != nil {
			return nil
		}
		// Le mois est écrit avant les données : l'en-tête du fichier suffit (pas de lecture complète).
		if m := monthRE.FindSubmatch(head(path)); m != nil && string(m[1]) < limit {
			os.Remove(path)
			return nil
		}
		v.count++
		v.bytes += info.Size()
		return nil
	})
}

var monthRE = regexp.MustCompile(`"month":"([0-9]{4}-[0-9]{2})"`)

func head(path string) []byte {
	f, err := os.Open(path)
	if err != nil {
		return nil
	}
	defer f.Close()
	b := make([]byte, 256)
	n, _ := f.Read(b)
	return b[:n]
}

func (v *VaultStore) mac(kind, value string) string {
	m := hmac.New(sha256.New, v.pepper)
	m.Write([]byte(kind + ":" + value))
	return hex.EncodeToString(m.Sum(nil))
}

// key : nom du fichier. Avec le poivre, HMAC de l'id : sans le poivre, impossible de vérifier un
// mot de passe candidat contre le dossier.
func (v *VaultStore) key(id string) string {
	if v.pepper == nil {
		return id
	}
	return v.mac("id", id)
}

func (v *VaultStore) path(id string) string {
	k := v.key(id)
	return filepath.Join(v.dir, k[:2], k+".json")
}
func (v *VaultStore) legacyPath(id string) string { return filepath.Join(v.dir, id[:2], id+".json") }

func authHash(auth string) string {
	sum := sha256.Sum256([]byte(auth))
	return hex.EncodeToString(sum[:])
}

// authFor : ce qui est gardé de la preuve (HMAC avec le poivre, sinon SHA-256).
func (v *VaultStore) authFor(auth string) string {
	if v.pepper == nil {
		return authHash(auth)
	}
	return v.mac("auth", auth)
}

func (v *VaultStore) checkAuth(rec *vaultRecord, auth string) bool {
	return subtle.ConstantTimeCompare([]byte(rec.Auth), []byte(v.authFor(auth))) == 1
}

var (
	errVaultNotFound = errors.New("introuvable")
	errVaultDenied   = errors.New("refusé")
	errVaultFull     = errors.New("plein")
)

func readRecord(path string) (*vaultRecord, int64, error) {
	raw, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		return nil, 0, errVaultNotFound
	}
	if err != nil {
		return nil, 0, err
	}
	var rec vaultRecord
	if err := json.Unmarshal(raw, &rec); err != nil {
		return nil, 0, err
	}
	return &rec, int64(len(raw)), nil
}

// open lit l'enregistrement et vérifie la preuve. Un ancien fichier (sans poivre) est converti :
// rangé sous son nouveau nom, preuve re-hachée avec le poivre, ancien fichier effacé.
func (v *VaultStore) open(id, auth string) (*vaultRecord, int64, error) {
	rec, size, err := readRecord(v.path(id))
	if err == nil {
		if !v.checkAuth(rec, auth) {
			return nil, 0, errVaultDenied
		}
		return rec, size, nil
	}
	if !errors.Is(err, errVaultNotFound) || v.pepper == nil {
		return nil, 0, err
	}
	old, oldSize, err := readRecord(v.legacyPath(id))
	if err != nil {
		return nil, 0, err
	}
	if subtle.ConstantTimeCompare([]byte(old.Auth), []byte(authHash(auth))) != 1 {
		return nil, 0, errVaultDenied
	}
	old.Auth = v.authFor(auth)
	newSize, err := v.store(id, old)
	if err != nil {
		return nil, 0, err
	}
	os.Remove(v.legacyPath(id))
	v.bytes += newSize - oldSize
	return old, newSize, nil
}

func (v *VaultStore) store(id string, rec *vaultRecord) (int64, error) {
	raw, _ := json.Marshal(rec)
	if err := os.MkdirAll(filepath.Dir(v.path(id)), 0o700); err != nil {
		return 0, err
	}
	if err := writeAtomic(v.path(id), raw); err != nil {
		return 0, err
	}
	return int64(len(raw)), nil
}

// Read rend la version et les octets chiffrés. Une lecture garde l'enregistrement en vie (mois
// mis à jour au plus une fois par mois), pour qu'un étudiant qui ne fait que consulter ne le
// perde pas à la purge.
func (v *VaultStore) Read(id, auth string) (*vaultRecord, error) {
	v.mu.Lock()
	defer v.mu.Unlock()
	rec, size, err := v.open(id, auth)
	if err != nil {
		return nil, err
	}
	if month := v.now().UTC().Format("2006-01"); rec.Month != month {
		rec.Month = month
		if n, err := v.store(id, rec); err == nil {
			v.bytes += n - size
		}
	}
	return rec, nil
}

// Write remplace l'enregistrement si `expected` est sa version actuelle (0 : création).
// En cas de conflit, rend l'enregistrement actuel pour que la page fusionne.
func (v *VaultStore) Write(id, auth string, expected int64, data string) (*vaultRecord, error) {
	v.mu.Lock()
	defer v.mu.Unlock()
	rec, size, err := v.open(id, auth)
	created := false
	switch {
	case errors.Is(err, errVaultNotFound):
		// Rien à cet id : seule une création (version attendue 0) est acceptée, sans rien
		// compter ni écrire sinon (la page fusionne avec une sauvegarde vide puis recrée).
		if expected != 0 {
			return &vaultRecord{}, errConflict
		}
		if v.count >= vaultMaxRecords {
			return nil, errVaultFull
		}
		rec, created = &vaultRecord{Auth: v.authFor(auth)}, true
	case err != nil:
		return nil, err
	}
	if rec.V != expected {
		return rec, errConflict
	}
	next := *rec
	next.V++
	next.Month = v.now().UTC().Format("2006-01")
	next.Data = data
	if grow := int64(len(data)) + 256 - size; grow > 0 && v.bytes+grow > v.MaxBytes {
		return nil, errVaultFull
	}
	n, err := v.store(id, &next)
	if err != nil {
		return nil, err
	}
	// Comptes mis à jour seulement après une écriture réussie.
	if created {
		v.count++
	}
	v.bytes += n - size
	return &next, nil
}

// Stats : nombre et volume des enregistrements (administration, sans rien d'autre).
func (v *VaultStore) Stats() (count int, bytes int64) {
	v.mu.Lock()
	defer v.mu.Unlock()
	return v.count, v.bytes
}

var errConflict = errors.New("conflit")

// Delete efface l'enregistrement (« Supprimer mes données »).
func (v *VaultStore) Delete(id, auth string) error {
	v.mu.Lock()
	defer v.mu.Unlock()
	_, size, err := v.open(id, auth)
	if err != nil {
		return err
	}
	if err := os.Remove(v.path(id)); err != nil {
		return err
	}
	v.count--
	v.bytes -= size
	return nil
}

func (s *Service) handleVault(w http.ResponseWriter, r *http.Request) {
	if s.cfg.Vault == nil {
		fail(w, http.StatusNotFound, "inconnu")
		return
	}
	var in struct {
		Op   string `json:"op"`
		ID   string `json:"id"`
		Auth string `json:"auth"`
		V    int64  `json:"v"`
		Data string `json:"data"`
	}
	if !s.readJSON(w, r, vaultMaxData+1024, &in) {
		return
	}
	if !vaultIDRE.MatchString(in.ID) || !vaultAuthRE.MatchString(in.Auth) {
		fail(w, http.StatusBadRequest, "identifiant invalide")
		return
	}
	limit := s.vaultReads
	if in.Op != "read" {
		limit = s.vaultWrites
	}
	ip := s.clientIP(r)
	if !limit.allow(ip) {
		fail(w, http.StatusTooManyRequests, "trop de requêtes, réessaie dans quelques minutes")
		return
	}
	// Création d'une sauvegarde (version 0) : comptée à part, par adresse et par jour.
	if in.Op == "write" && in.V == 0 && !s.vaultCreates.allow(ip) {
		fail(w, http.StatusTooManyRequests, "trop de nouvelles sauvegardes depuis cette adresse aujourd’hui")
		return
	}
	var rec *vaultRecord
	var err error
	switch in.Op {
	case "read":
		rec, err = s.cfg.Vault.Read(in.ID, in.Auth)
	case "write":
		if len(in.Data) == 0 || len(in.Data) > vaultMaxData || in.V < 0 {
			fail(w, http.StatusBadRequest, "données invalides")
			return
		}
		if _, e := base64.StdEncoding.DecodeString(in.Data); e != nil {
			fail(w, http.StatusBadRequest, "données invalides")
			return
		}
		rec, err = s.cfg.Vault.Write(in.ID, in.Auth, in.V, in.Data)
	case "delete":
		err = s.cfg.Vault.Delete(in.ID, in.Auth)
		if err == nil {
			w.Header().Set("Cache-Control", "no-store")
			w.WriteHeader(http.StatusNoContent)
			return
		}
	default:
		fail(w, http.StatusBadRequest, "opération inconnue")
		return
	}
	switch {
	case errors.Is(err, errConflict):
		reply(w, http.StatusConflict, map[string]any{"v": rec.V, "data": rec.Data})
	case errors.Is(err, errVaultNotFound):
		fail(w, http.StatusNotFound, "aucune sauvegarde")
	case errors.Is(err, errVaultDenied):
		fail(w, http.StatusForbidden, "refusé")
	case errors.Is(err, errVaultFull):
		fail(w, http.StatusInsufficientStorage, "stockage plein")
	case err != nil:
		fail(w, http.StatusServiceUnavailable, "sauvegarde indisponible")
	case in.Op == "read":
		reply(w, http.StatusOK, map[string]any{"v": rec.V, "data": rec.Data})
	default:
		reply(w, http.StatusOK, map[string]any{"v": rec.V})
	}
}
