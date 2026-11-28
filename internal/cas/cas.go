// Package cas valide un ticket de service auprès du CAS de l'université (INUC) et dit si le compte
// est celui d'un étudiant.
//
// Le serveur ISIS Hub ne voit jamais la connexion de l'étudiant (le chiffrement se fait dans la
// page). Pour prouver une identité, la page, déjà connectée au CAS, demande un ticket de service
// pour l'ENT (service enregistré auprès du CAS) sans le suivre, puis le transmet au serveur, qui le
// fait valider DIRECTEMENT par auth.univ-jfc.fr (serviceValidate) : c'est l'université qui répond
// avec l'identifiant, la page ne peut pas le falsifier. Le ticket est à usage unique.
package cas

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

// StudentDomain : domaine des adresses étudiantes de l'université.
const StudentDomain = "etud.univ-jfc.fr"

// TicketRE : forme d'un ticket de service.
var TicketRE = regexp.MustCompile(`^ST-[A-Za-z0-9._-]{8,256}$`)

// Identity : ce que l'université répond pour un ticket. Mail et Affiliations ne sont remplis que si
// le CAS publie ces attributs pour le service (CAS 3) ; sinon seul User est connu.
type Identity struct {
	User         string
	Mail         string
	Affiliations []string
}

// StudentMail : adresse étudiante de l'université (…@etud.univ-jfc.fr).
func StudentMail(addr string) bool {
	addr = strings.ToLower(strings.TrimSpace(addr))
	at := strings.LastIndexByte(addr, '@')
	return at > 0 && addr[at+1:] == StudentDomain && !strings.ContainsAny(addr[:at], " @")
}

// Student : le compte est-il celui d'un étudiant ? L'université fait foi quand elle le dit (adresse
// ou affiliation dans la réponse du CAS). Sinon, on se fie à l'adresse que la page a lue dans la
// messagerie universitaire (declared) : c'est la même adresse que celle de l'ENT, mais elle n'est
// pas prouvée par le CAS.
func (id Identity) Student(declared string) bool {
	if id.Mail != "" {
		return StudentMail(id.Mail)
	}
	if len(id.Affiliations) > 0 {
		for _, a := range id.Affiliations {
			if strings.EqualFold(strings.TrimSpace(a), "student") {
				return true
			}
		}
		return false
	}
	return StudentMail(declared)
}

type response struct {
	Success *struct {
		User       string `xml:"user"`
		Attributes struct {
			Items []struct {
				XMLName xml.Name
				Value   string `xml:",chardata"`
			} `xml:",any"`
		} `xml:"attributes"`
	} `xml:"authenticationSuccess"`
	Failure *struct {
		Code string `xml:"code,attr"`
	} `xml:"authenticationFailure"`
}

// Validator rend une fonction qui fait valider un ticket par le CAS et rend l'identité.
func Validator(casBase, service string) func(ctx context.Context, ticket string) (Identity, error) {
	client := &http.Client{
		Timeout: 10 * time.Second,
		// Le CAS répond directement ; aucune redirection n'est attendue ni suivie.
		CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse },
	}
	return func(ctx context.Context, ticket string) (Identity, error) {
		u := fmt.Sprintf("%s/cas/serviceValidate?service=%s&ticket=%s", strings.TrimRight(casBase, "/"), url.QueryEscape(service), url.QueryEscape(ticket))
		req, _ := http.NewRequestWithContext(ctx, http.MethodGet, u, nil)
		req.Header.Set("User-Agent", "ISIS-Hub")
		res, err := client.Do(req)
		if err != nil {
			return Identity{}, err
		}
		defer res.Body.Close()
		if res.StatusCode != http.StatusOK {
			return Identity{}, fmt.Errorf("CAS HTTP %d", res.StatusCode)
		}
		return parse(io.LimitReader(res.Body, 64<<10))
	}
}

func parse(r io.Reader) (Identity, error) {
	var out response
	if err := xml.NewDecoder(r).Decode(&out); err != nil {
		return Identity{}, errors.New("réponse du CAS illisible")
	}
	if out.Success == nil || strings.TrimSpace(out.Success.User) == "" {
		return Identity{}, errors.New("ticket refusé par le CAS")
	}
	id := Identity{User: strings.TrimSpace(out.Success.User)}
	for _, a := range out.Success.Attributes.Items {
		v := strings.TrimSpace(a.Value)
		switch strings.ToLower(a.XMLName.Local) {
		case "mail", "email":
			if id.Mail == "" {
				id.Mail = v
			}
		case "edupersonaffiliation", "edupersonprimaryaffiliation":
			if v != "" {
				id.Affiliations = append(id.Affiliations, v)
			}
		}
	}
	return id, nil
}
