package feedback

import (
	"encoding/json"
	"net/http"
	"testing"

	"isishub/internal/calendar"
)

func twoSubjects() *GradeClass {
	g := sampleGrades()
	g.Semesters[0].UEs[0].Matieres = append(g.Semesters[0].UEs[0].Matieres, GradeSubject{ID: "sante-pub", Name: "Santé publique", Coef: 2, Evals: []GradeEval{{ID: "s7-sp-1", Label: "CC", Coef: 1}}})
	return g
}

// Export des coefficients, réimport modifié (par identifiant et par nom), remise à 1, retrait des
// évaluations : tout ou rien, et les évaluations retirées restent connues pour les notes saisies.
func TestGradesBulk(t *testing.T) {
	dir := t.TempDir()
	store, _ := Open(dir)
	content, _ := OpenContent(dir, calendar.Data{})
	api := New(Config{Store: store, Content: content, AdminUsers: []string{"bsouvign"}, CASValidate: fakeCAS, AllowedOrigins: []string{origin}})
	cookie := adminCookie(t, api)
	admin := map[string]string{"X-Hub-Admin": "1"}
	for _, k := range []string{"FIA4", "FIE4"} {
		if rec := call(api, "POST", "/api/admin/grades", map[string]any{"class": k, "grades": twoSubjects()}, admin, cookie); rec.Code != http.StatusOK {
			t.Fatalf("maquette %s : %d %s", k, rec.Code, rec.Body)
		}
	}
	if rec := call(api, "GET", "/api/admin/grades/coefs", nil, admin); rec.Code != http.StatusUnauthorized {
		t.Fatalf("export sans session : %d", rec.Code)
	}
	rec := call(api, "GET", "/api/admin/grades/coefs", nil, admin, cookie)
	var sheet CoefSheet
	json.Unmarshal(rec.Body.Bytes(), &sheet)
	if rec.Code != http.StatusOK || sheet.Format != coefFormat || len(sheet.Classes) != 2 || sheet.Classes["FIA4"][0].UEs[0].Matieres[1].Name != "Santé publique" {
		t.Fatalf("export : %d %s", rec.Code, rec.Body)
	}
	// FIA4 : UE 7.1 → 5, Interopérabilité (par id) → 4, Santé publique (par nom, sans accent) → 1.5.
	ue := &sheet.Classes["FIA4"][0].UEs[0]
	ue.Coef = 5
	ue.Matieres[0].Coef = 4
	ue.Matieres[1] = CoefSubject{Name: "sante publique", Coef: 1.5}
	ue.Matieres = append(ue.Matieres, CoefSubject{Name: "Matière inconnue", Coef: 2})
	delete(sheet.Classes, "FIE4")
	bulk := func(body map[string]any) (int, BulkReport, GradeBook) {
		rec := call(api, "POST", "/api/admin/grades/bulk", body, admin, cookie)
		var out struct {
			Report BulkReport `json:"report"`
			Grades GradeBook  `json:"grades"`
		}
		json.Unmarshal(rec.Body.Bytes(), &out)
		return rec.Code, out.Report, out.Grades
	}
	code, rep, book := bulk(map[string]any{"action": "coefs", "sheet": sheet, "dry": true})
	if code != 200 || rep.Changed != 3 || len(rep.Unknown) != 1 || book["FIA4"].Semesters[0].UEs[0].Coef != 6 {
		t.Fatalf("essai à blanc : %d %+v", code, rep)
	}
	code, rep, book = bulk(map[string]any{"action": "coefs", "sheet": sheet})
	m := book["FIA4"].Semesters[0].UEs[0]
	if code != 200 || m.Coef != 5 || m.Matieres[0].Coef != 4 || m.Matieres[1].Coef != 1.5 || book["FIE4"].Semesters[0].UEs[0].Matieres[0].Coef != 3 {
		t.Fatalf("import : %d %+v %+v", code, rep, m)
	}
	// Une valeur invalide : tout est refusé, rien ne change.
	ue.Matieres[0].Coef = 400
	if code, _, _ := bulk(map[string]any{"action": "coefs", "sheet": sheet}); code != 400 || content.Grades()["FIA4"].Semesters[0].UEs[0].Matieres[0].Coef != 4 {
		t.Fatalf("coefficient invalide : %d", code)
	}
	if code, _, _ := bulk(map[string]any{"action": "coefs", "sheet": map[string]any{"format": "autre"}}); code != 400 {
		t.Fatal("autre format accepté")
	}
	// Toutes les matières au coefficient 1 (les UE gardent le leur).
	code, rep, book = bulk(map[string]any{"action": "reset-coefs"})
	if code != 200 || rep.Changed != 4 || book["FIA4"].Semesters[0].UEs[0].Matieres[1].Coef != 1 || book["FIA4"].Semesters[0].UEs[0].Coef != 5 {
		t.Fatalf("remise à 1 : %d %+v", code, rep)
	}
	// Plus aucune évaluation prévue ; elles restent connues (retired) et publiques pour la migration.
	code, rep, book = bulk(map[string]any{"action": "clear-evals"})
	mat := book["FIE4"].Semesters[0].UEs[0].Matieres[0]
	if code != 200 || rep.Evals != 6 || len(mat.Evals) != 0 || len(mat.Retired) != 2 {
		t.Fatalf("retrait des évaluations : %d %+v %+v", code, rep, mat)
	}
	var pub GradeBook
	json.Unmarshal(call(api, "GET", "/api/grades", nil, nil).Body.Bytes(), &pub)
	if len(pub["FIE4"].Semesters[0].UEs[0].Matieres[0].Retired) != 2 {
		t.Fatal("évaluations retirées absentes de la lecture publique")
	}
	// Relu au redémarrage.
	again, _ := OpenContent(dir, calendar.Data{})
	if len(again.Grades()["FIA4"].Semesters[0].UEs[0].Matieres[0].Retired) != 2 {
		t.Fatal("évaluations retirées perdues au redémarrage")
	}
}

// Une évaluation supprimée dans l'éditeur (ou par un import de maquette) reste connue de sa
// matière ; recréée avec le même identifiant, elle redevient active.
func TestGradesKeepRetired(t *testing.T) {
	dir := t.TempDir()
	content, _ := OpenContent(dir, calendar.Data{})
	g := sampleGrades()
	if err := content.SetGrades("FIA4", g); err != nil {
		t.Fatal(err)
	}
	g2 := sampleGrades()
	g2.Semesters[0].UEs[0].Matieres[0].Evals = g2.Semesters[0].UEs[0].Matieres[0].Evals[1:] // le quiz est supprimé
	if err := content.SetGrades("FIA4", g2); err != nil {
		t.Fatal(err)
	}
	m := content.Grades()["FIA4"].Semesters[0].UEs[0].Matieres[0]
	if len(m.Evals) != 1 || len(m.Retired) != 1 || m.Retired[0].ID != "s7-int-1" {
		t.Fatalf("quiz retiré : %+v", m)
	}
	if err := content.SetGrades("FIA4", sampleGrades()); err != nil {
		t.Fatal(err)
	}
	if m := content.Grades()["FIA4"].Semesters[0].UEs[0].Matieres[0]; len(m.Evals) != 2 || len(m.Retired) != 0 {
		t.Fatalf("quiz rétabli : %+v", m)
	}
}
