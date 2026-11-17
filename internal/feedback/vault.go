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

import (
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
	vaultMaxData    = 512 << 10 // octets chiffrés, encodés en base64
	vaultMaxRecords = 100_000
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
	mu    sync.Mutex
	dir   string
	count int
	now   func() time.Time
}

func OpenVaultStore(dir string) (*VaultStore, error) {
	dir = filepath.Join(dir, "vault")
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return nil, err
	}
	v := &VaultStore{dir: dir, now: time.Now}
	_ = filepath.WalkDir(dir, func(_ string, d os.DirEntry, err error) error {
		if err == nil && !d.IsDir() && filepath.Ext(d.Name()) == ".json" {
			v.count++
		}
		return nil
	})
	return v, nil
}

func (v *VaultStore) path(id string) string { return filepath.Join(v.dir, id[:2], id+".json") }

func authHash(auth string) string {
	sum := sha256.Sum256([]byte(auth))
	return hex.EncodeToString(sum[:])
}

var (
	errVaultNotFound = errors.New("introuvable")
	errVaultDenied   = errors.New("refusé")
	errVaultFull     = errors.New("plein")
)

func (v *VaultStore) load(id string) (*vaultRecord, error) {
	raw, err := os.ReadFile(v.path(id))
	if errors.Is(err, os.ErrNotExist) {
		return nil, errVaultNotFound
	}
	if err != nil {
		return nil, err
	}
	var rec vaultRecord
	if err := json.Unmarshal(raw, &rec); err != nil {
		return nil, err
	}
	return &rec, nil
}

func checkAuth(rec *vaultRecord, auth string) bool {
	return subtle.ConstantTimeCompare([]byte(rec.Auth), []byte(authHash(auth))) == 1
}

// Read rend la version et les octets chiffrés.
func (v *VaultStore) Read(id, auth string) (*vaultRecord, error) {
	v.mu.Lock()
	defer v.mu.Unlock()
	rec, err := v.load(id)
	if err != nil {
		return nil, err
	}
	if !checkAuth(rec, auth) {
		return nil, errVaultDenied
	}
	return rec, nil
}

// Write remplace l'enregistrement si `expected` est sa version actuelle (0 : création).
// En cas de conflit, rend l'enregistrement actuel pour que la page fusionne.
func (v *VaultStore) Write(id, auth string, expected int64, data string) (*vaultRecord, error) {
	v.mu.Lock()
	defer v.mu.Unlock()
	rec, err := v.load(id)
	switch {
	case errors.Is(err, errVaultNotFound):
		if v.count >= vaultMaxRecords {
			return nil, errVaultFull
		}
		rec = &vaultRecord{Auth: authHash(auth)}
		v.count++
	case err != nil:
		return nil, err
	case !checkAuth(rec, auth):
		return nil, errVaultDenied
	}
	if rec.V != expected {
		return rec, errConflict
	}
	rec.V++
	rec.Month = v.now().UTC().Format("2006-01")
	rec.Data = data
	raw, _ := json.Marshal(rec)
	if err := os.MkdirAll(filepath.Dir(v.path(id)), 0o700); err != nil {
		return nil, err
	}
	if err := writeAtomic(v.path(id), raw); err != nil {
		return nil, err
	}
	return rec, nil
}

var errConflict = errors.New("conflit")

// Delete efface l'enregistrement (« Supprimer mes données »).
func (v *VaultStore) Delete(id, auth string) error {
	v.mu.Lock()
	defer v.mu.Unlock()
	rec, err := v.load(id)
	if err != nil {
		return err
	}
	if !checkAuth(rec, auth) {
		return errVaultDenied
	}
	if err := os.Remove(v.path(id)); err != nil {
		return err
	}
	v.count--
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
	if !limit.allow(s.clientIP(r)) {
		fail(w, http.StatusTooManyRequests, "trop de requêtes, réessaie dans quelques minutes")
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
