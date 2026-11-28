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
	"strings"

	"isishub/internal/cas"
)

// ENTService : le service pour lequel le ticket est demandé (enregistré auprès du CAS de l'INUC).
const ENTService = cas.ENTService

var ticketRE = cas.TicketRE

// CASValidator rend une fonction qui fait valider un ticket par le CAS et rend l'identifiant
// (voir internal/cas).
func CASValidator(casBase, service string) func(ctx context.Context, ticket string) (string, error) {
	validate := cas.Validator(casBase, service)
	return func(ctx context.Context, ticket string) (string, error) {
		id, err := validate(ctx, ticket)
		return id.User, err
	}
}

// IsAdminUser : identifiant listé dans ADMIN_USERS (le TCG s'en sert pour l'envoi des mails d'accord).
func (s *Service) IsAdminUser(user string) bool { return s.isAdminUser(user) }

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
