package feedback

// Identification de l'administrateur par le CAS de l'université, sans mot de passe propre.
//
// Le serveur ISIS Hub ne voit jamais qui se connecte (le chiffrement se fait dans la page). Pour
// prouver son identité, la page de l'administrateur, déjà connectée au CAS, demande un ticket de
// service pour l'ENT (service enregistré auprès du CAS) sans le suivre, puis le transmet au
// serveur. Le serveur le fait valider DIRECTEMENT par auth.univ-jfc.fr (serviceValidate) : c'est
// l'université qui répond avec l'identifiant, impossible à falsifier par la page. Le ticket est à
// usage unique ; l'ENT ne le reçoit jamais.
//
// Seuls les identifiants listés dans ADMIN_USERS obtiennent une session ; les autres sont refusés
// sans que rien ne soit gardé.

import (
	"context"
	"encoding/xml"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"time"
)

// ENTService : le service pour lequel le ticket est demandé (enregistré auprès du CAS de l'INUC).
const ENTService = "https://ent.univ-jfc.fr/uPortal/Login"

var ticketRE = regexp.MustCompile(`^ST-[A-Za-z0-9._-]{8,256}$`)

type casResponse struct {
	Success *struct {
		User string `xml:"user"`
	} `xml:"authenticationSuccess"`
	Failure *struct {
		Code string `xml:"code,attr"`
	} `xml:"authenticationFailure"`
}

// CASValidator rend une fonction qui fait valider un ticket par le CAS et rend l'identifiant.
func CASValidator(casBase, service string) func(ctx context.Context, ticket string) (string, error) {
	client := &http.Client{
		Timeout: 10 * time.Second,
		// Le CAS répond directement ; aucune redirection n'est attendue ni suivie.
		CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse },
	}
	return func(ctx context.Context, ticket string) (string, error) {
		u := fmt.Sprintf("%s/cas/serviceValidate?service=%s&ticket=%s", strings.TrimRight(casBase, "/"), url.QueryEscape(service), url.QueryEscape(ticket))
		req, _ := http.NewRequestWithContext(ctx, http.MethodGet, u, nil)
		req.Header.Set("User-Agent", "ISIS-Hub")
		res, err := client.Do(req)
		if err != nil {
			return "", err
		}
		defer res.Body.Close()
		if res.StatusCode != http.StatusOK {
			return "", fmt.Errorf("CAS HTTP %d", res.StatusCode)
		}
		var out casResponse
		if err := xml.NewDecoder(io.LimitReader(res.Body, 64<<10)).Decode(&out); err != nil {
			return "", errors.New("réponse du CAS illisible")
		}
		if out.Success == nil || strings.TrimSpace(out.Success.User) == "" {
			return "", errors.New("ticket refusé par le CAS")
		}
		return strings.TrimSpace(out.Success.User), nil
	}
}

func (s *Service) isAdminUser(user string) bool {
	for _, u := range s.cfg.AdminUsers {
		if u != "" && strings.EqualFold(strings.TrimSpace(u), user) {
			return true
		}
	}
	return false
}

// AdminEnabled : au moins un identifiant administrateur est configuré.
func (s *Service) AdminEnabled() bool {
	for _, u := range s.cfg.AdminUsers {
		if strings.TrimSpace(u) != "" {
			return true
		}
	}
	return false
}
