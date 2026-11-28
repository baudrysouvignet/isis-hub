package cas

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestStudentMail(t *testing.T) {
	for addr, want := range map[string]bool{
		"lea.martin@etud.univ-jfc.fr":   true,
		" Lea.Martin@ETUD.univ-jfc.fr ": true,
		"jean.dupont@univ-jfc.fr":       false, // personnel
		"x@etud.univ-jfc.fr.evil.com":   false,
		"@etud.univ-jfc.fr":             false,
		"lea@gmail.com":                 false,
		"":                              false,
	} {
		if got := StudentMail(addr); got != want {
			t.Errorf("StudentMail(%q) = %v", addr, got)
		}
	}
}

// L'université fait foi quand elle publie l'adresse ou l'affiliation ; sinon l'adresse déclarée.
func TestStudentRule(t *testing.T) {
	cases := []struct {
		id       Identity
		declared string
		want     bool
	}{
		{Identity{User: "lmartin"}, "lea.martin@etud.univ-jfc.fr", true},
		{Identity{User: "jdupont"}, "jean.dupont@univ-jfc.fr", false},
		{Identity{User: "jdupont"}, "", false},
		{Identity{User: "jdupont", Mail: "jean.dupont@univ-jfc.fr"}, "faux@etud.univ-jfc.fr", false},
		{Identity{User: "lmartin", Mail: "lea.martin@etud.univ-jfc.fr"}, "", true},
		{Identity{User: "jdupont", Affiliations: []string{"staff", "member"}}, "faux@etud.univ-jfc.fr", false},
		{Identity{User: "lmartin", Affiliations: []string{"member", "student"}}, "", true},
	}
	for i, c := range cases {
		if got := c.id.Student(c.declared); got != c.want {
			t.Errorf("cas %d : %v (attendu %v)", i, got, c.want)
		}
	}
}

func TestValidatorAttributes(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/cas/serviceValidate" || r.URL.Query().Get("service") != ENTService {
			http.Error(w, "non", 400)
			return
		}
		switch r.URL.Query().Get("ticket") {
		case "ST-avec-attributs":
			w.Write([]byte(`<cas:serviceResponse xmlns:cas="http://www.yale.edu/tp/cas"><cas:authenticationSuccess><cas:user>lmartin</cas:user><cas:attributes><cas:mail>lea.martin@etud.univ-jfc.fr</cas:mail><cas:eduPersonAffiliation>student</cas:eduPersonAffiliation></cas:attributes></cas:authenticationSuccess></cas:serviceResponse>`))
		case "ST-sans-attributs":
			w.Write([]byte(`<cas:serviceResponse xmlns:cas="http://www.yale.edu/tp/cas"><cas:authenticationSuccess><cas:user> jdupont </cas:user></cas:authenticationSuccess></cas:serviceResponse>`))
		default:
			w.Write([]byte(`<cas:serviceResponse xmlns:cas="http://www.yale.edu/tp/cas"><cas:authenticationFailure code="INVALID_TICKET">non</cas:authenticationFailure></cas:serviceResponse>`))
		}
	}))
	defer srv.Close()
	validate := Validator(srv.URL, ENTService)
	id, err := validate(context.Background(), "ST-avec-attributs")
	if err != nil || id.User != "lmartin" || id.Mail != "lea.martin@etud.univ-jfc.fr" || len(id.Affiliations) != 1 || !id.Student("") {
		t.Fatalf("avec attributs : %+v %v", id, err)
	}
	id, err = validate(context.Background(), "ST-sans-attributs")
	if err != nil || id.User != "jdupont" || id.Mail != "" || id.Student("") {
		t.Fatalf("sans attributs : %+v %v", id, err)
	}
	if _, err := validate(context.Background(), "ST-refuse"); err == nil || !strings.Contains(err.Error(), "refusé") {
		t.Fatalf("ticket refusé : %v", err)
	}
}
