// Package salaires : le simulateur de salaire, d'après le sondage des alumni d'ISIS.
//
// Le fichier déposé par l'administration (l'export brut du sondage, ou le format « isis-hub-salaires »
// qu'elle a déjà retouché) est réduit dès l'import à des tranches : expérience, poste, secteur, type de
// structure, lieu, sexe, fixe et total, avantages. Année de diplôme, années d'expérience exactes,
// anecdotes, statut de reconstitution et boîte à idées ne sont jamais gardés ; les catégories de
// moins de MinShow réponses sont fusionnées.
//
// Les réponses ne quittent jamais le serveur : la page envoie un profil (des cases cochées) et reçoit
// des médianes de groupes d'au moins MinShow réponses, des quartiles à partir de MinSpread, et
// l'estimation d'un modèle appris sur toutes les réponses (compute.go).
package salaires

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"
)

const (
	Format  = "isis-hub-salaires"
	Version = 1

	// MinShow : rien ne s'affiche ni ne se filtre sous ce nombre de réponses (médiane, effectif,
	// case à cocher). MinSpread : les quartiles d'un groupe ne sont montrés qu'à partir de là.
	MinShow   = 5
	MinSpread = 10

	MaxBytes = 4 << 20 // fichier déposé

	maxRows   = 5000
	maxTips   = 300
	maxLabels = 40
	minSalary = 10_000
	maxSalary = 500_000
)

// Les dimensions d'une réponse. Le sexe n'entre jamais dans l'estimation ni dans les filtres : il
// sert seulement à l'onglet « Femmes / hommes ».
const (
	dXp = iota
	dPoste
	dSecteur
	dStructure
	dRegion
	dSexe
	nDims
)

var dimNames = [nDims]string{"xp", "poste", "secteur", "structure", "region", "sexe"}

// XPLabels : tranches d'expérience après le diplôme, celles du sondage.
var XPLabels = []string{"0-1 an", "2-3 ans", "4-5 ans", "6-9 ans", "10+ ans"}

// Catégorie où vont les réponses imprécises et les catégories trop rares, par dimension.
var otherLabel = map[int]string{
	dPoste:     "Autre poste",
	dSecteur:   "Autre secteur",
	dStructure: "Autre structure",
	dRegion:    "Autres régions et outre-mer",
	dSexe:      "Non précisé",
}

// Avantages connus, dans cet ordre ; les autres suivent.
var knownAdv = []string{"Tickets Resto", "Télétravail", "RTT / Congés", "Intéressement", "Voiture", "Mutuelle gratuite"}

// Régions de métropole (nom → code INSEE) : la carte les colorie. Les autres lieux (étranger,
// télétravail complet, outre-mer) sont des boutons à côté de la carte.
var regionCodes = map[string]string{
	"Île-de-France": "11", "Centre-Val de Loire": "24", "Bourgogne-Franche-Comté": "27", "Normandie": "28",
	"Hauts-de-France": "32", "Grand Est": "44", "Pays de la Loire": "52", "Bretagne": "53",
	"Nouvelle-Aquitaine": "75", "Occitanie": "76", "Auvergne-Rhône-Alpes": "84",
	"Provence-Alpes-Côte d’Azur": "93", "Corse": "94",
}

var regionAliases = map[string]string{
	"paca": "Provence-Alpes-Côte d’Azur", "paca / sud": "Provence-Alpes-Côte d’Azur", "sud": "Provence-Alpes-Côte d’Azur",
	"provence-alpes-côte d'azur": "Provence-Alpes-Côte d’Azur", "ile-de-france": "Île-de-France", "idf": "Île-de-France",
	"full teletravail": "Full Télétravail", "full télétravail": "Full Télétravail", "télétravail": "Full Télétravail",
	"etranger": "International", "étranger": "International",
}

// Dataset : le fichier gardé par le serveur (et rendu à l'administration pour le retoucher).
type Dataset struct {
	Format    string   `json:"format"`
	Version   int      `json:"version"`
	Source    string   `json:"source"`
	Extracted string   `json:"extracted"`         // AAAA-MM-JJ : date de l'export du sondage
	Promos    [2]int   `json:"promos"`            // première et dernière promo (rien de plus précis)
	Grouped   int      `json:"grouped,omitempty"` // réponses reconstituées comme moyenne de profils identiques
	Dims      Labels   `json:"dims"`
	Adv       []string `json:"adv"`
	Rows      []Row    `json:"rows"`
	Tips      []Tip    `json:"tips"`
}

// Labels : les catégories de chaque dimension (l'expérience a ses tranches fixes, XPLabels).
type Labels struct {
	Poste     []string `json:"poste"`
	Secteur   []string `json:"secteur"`
	Structure []string `json:"structure"`
	Region    []string `json:"region"`
	Sexe      []string `json:"sexe"`
}

func (l *Labels) of(dim int) []string {
	switch dim {
	case dXp:
		return XPLabels
	case dPoste:
		return l.Poste
	case dSecteur:
		return l.Secteur
	case dStructure:
		return l.Structure
	case dRegion:
		return l.Region
	case dSexe:
		return l.Sexe
	}
	return nil
}

func (l *Labels) set(dim int, v []string) {
	switch dim {
	case dPoste:
		l.Poste = v
	case dSecteur:
		l.Secteur = v
	case dStructure:
		l.Structure = v
	case dRegion:
		l.Region = v
	case dSexe:
		l.Sexe = v
	}
}

// Row : une réponse, réduite à ses tranches.
type Row struct {
	ID        string `json:"id"`
	Xp        int    `json:"xp"`
	Poste     int    `json:"poste"`
	Secteur   int    `json:"secteur"`
	Structure int    `json:"structure"`
	Region    int    `json:"region"`
	Sexe      int    `json:"sexe"`
	Base      int    `json:"base"`  // fixe brut annuel (milieu de la tranche du sondage)
	Total     int    `json:"total"` // avec primes
	Adv       []int  `json:"adv"`   // avantages (indices dans Dataset.Adv)
}

func (r *Row) dim(d int) int {
	switch d {
	case dXp:
		return r.Xp
	case dPoste:
		return r.Poste
	case dSecteur:
		return r.Secteur
	case dStructure:
		return r.Structure
	case dRegion:
		return r.Region
	case dSexe:
		return r.Sexe
	}
	return -1
}

func (r *Row) setDim(d, v int) {
	switch d {
	case dXp:
		r.Xp = v
	case dPoste:
		r.Poste = v
	case dSecteur:
		r.Secteur = v
	case dStructure:
		r.Structure = v
	case dRegion:
		r.Region = v
	case dSexe:
		r.Sexe = v
	}
}

// Tip : un conseil d'alumni, anonyme. Montré aux étudiants seulement une fois relu (On).
type Tip struct {
	ID string `json:"id"`
	T  string `json:"t"`
	On bool   `json:"on"`
}

var (
	idRE   = regexp.MustCompile(`^[a-z0-9]{1,12}$`)
	dateRE = regexp.MustCompile(`^\d{4}-\d{2}-\d{2}$`)
)

func cleanText(s string, max int, multiline bool) (string, error) {
	if !utf8.ValidString(s) {
		return "", errors.New("texte illisible (UTF-8)")
	}
	for _, r := range s {
		if unicode.IsControl(r) && !(multiline && (r == '\n' || r == '\t')) {
			return "", errors.New("caractère de contrôle")
		}
	}
	s = strings.TrimSpace(s)
	if utf8.RuneCountInString(s) > max {
		return "", fmt.Errorf("texte trop long (%d caractères au plus)", max)
	}
	return s, nil
}

// Validate vérifie tout le fichier : liens entre listes, bornes, textes.
func (d *Dataset) Validate() error {
	if d.Format != Format || d.Version != Version {
		return fmt.Errorf("format attendu : « %s », version %d", Format, Version)
	}
	var err error
	if d.Source, err = cleanText(d.Source, 200, false); err != nil {
		return fmt.Errorf("source : %w", err)
	}
	if !dateRE.MatchString(d.Extracted) {
		return errors.New("date d’extraction attendue au format AAAA-MM-JJ")
	}
	if _, err := time.Parse("2006-01-02", d.Extracted); err != nil {
		return errors.New("date d’extraction invalide")
	}
	if p := d.Promos; p != [2]int{} && (p[0] < 1990 || p[1] > 2100 || p[0] > p[1]) {
		return errors.New("promos : première et dernière année attendues")
	}
	if d.Grouped < 0 || d.Grouped > len(d.Rows) {
		return errors.New("nombre de réponses reconstituées invalide")
	}
	for dim := dPoste; dim < nDims; dim++ {
		labels := d.Dims.of(dim)
		if len(labels) == 0 || len(labels) > maxLabels {
			return fmt.Errorf("catégories « %s » : entre 1 et %d", dimNames[dim], maxLabels)
		}
		seen := map[string]bool{}
		for i, l := range labels {
			c, err := cleanText(l, 60, false)
			if err != nil || c == "" || seen[c] {
				return fmt.Errorf("catégorie « %s » n° %d vide, en double ou invalide", dimNames[dim], i+1)
			}
			seen[c] = true
			labels[i] = c
		}
	}
	if len(d.Adv) > 20 {
		return errors.New("20 avantages au plus")
	}
	for i, a := range d.Adv {
		c, err := cleanText(a, 40, false)
		if err != nil || c == "" {
			return fmt.Errorf("avantage n° %d invalide", i+1)
		}
		d.Adv[i] = c
	}
	if len(d.Rows) == 0 || len(d.Rows) > maxRows {
		return fmt.Errorf("entre 1 et %d réponses", maxRows)
	}
	ids := map[string]bool{}
	for i := range d.Rows {
		r := &d.Rows[i]
		if !idRE.MatchString(r.ID) || ids[r.ID] {
			return fmt.Errorf("réponse n° %d : identifiant vide, invalide ou en double", i+1)
		}
		ids[r.ID] = true
		for dim := 0; dim < nDims; dim++ {
			if v := r.dim(dim); v < 0 || v >= len(d.Dims.of(dim)) {
				return fmt.Errorf("réponse %s : « %s » hors des catégories", r.ID, dimNames[dim])
			}
		}
		if r.Base < minSalary || r.Base > maxSalary || r.Total < minSalary || r.Total > maxSalary {
			return fmt.Errorf("réponse %s : salaire hors de %d à %d €", r.ID, minSalary, maxSalary)
		}
		seen := map[int]bool{}
		for _, a := range r.Adv {
			if a < 0 || a >= len(d.Adv) || seen[a] {
				return fmt.Errorf("réponse %s : avantage invalide", r.ID)
			}
			seen[a] = true
		}
		sort.Ints(r.Adv)
		if r.Adv == nil {
			r.Adv = []int{}
		}
	}
	if len(d.Tips) > maxTips {
		return fmt.Errorf("%d conseils au plus", maxTips)
	}
	tids := map[string]bool{}
	for i := range d.Tips {
		t := &d.Tips[i]
		if !idRE.MatchString(t.ID) || tids[t.ID] {
			return fmt.Errorf("conseil n° %d : identifiant vide, invalide ou en double", i+1)
		}
		tids[t.ID] = true
		c, err := cleanText(t.T, 1500, true)
		if err != nil || c == "" {
			return fmt.Errorf("conseil %s vide ou invalide", t.ID)
		}
		t.T = c
	}
	if d.Tips == nil {
		d.Tips = []Tip{}
	}
	return nil
}

// ------------------------------------------------------------ import du sondage brut

// Report : ce que l'import a fait (montré à l'administration).
type Report struct {
	Rows    int                 `json:"rows"`
	Skipped int                 `json:"skipped"`          // réponses illisibles (tranche ou salaire manquant)
	Merged  map[string][]string `json:"merged,omitempty"` // catégories fusionnées, par dimension
	Tips    int                 `json:"tips"`
	Dropped []string            `json:"dropped"` // champs du sondage jamais gardés
}

type surveyRow struct {
	Annee     json.RawMessage `json:"annee_diplome"`
	Poste     string          `json:"poste"`
	Sexe      string          `json:"sexe"`
	XP        string          `json:"xp_group"`
	Secteur   string          `json:"secteur"`
	Structure string          `json:"type_structure"`
	Region    string          `json:"departement"`
	Base      float64         `json:"salaire_base"`
	Total     float64         `json:"salaire_total"`
	Avantages []string        `json:"avantages"`
	Statut    string          `json:"statut_resolution"`
}

type survey struct {
	Metadata struct {
		Extraction string `json:"extraction_date"`
	} `json:"metadata"`
	Rows []surveyRow `json:"reponses_individuelles"`
	Tips []struct {
		Conseil string `json:"conseil"`
	} `json:"conseils_anecdotes"`
}

// IsSurvey : le fichier est l'export brut du sondage (et non le format du Hub).
func IsSurvey(raw []byte) bool {
	var probe struct {
		Rows json.RawMessage `json:"reponses_individuelles"`
	}
	return json.Unmarshal(raw, &probe) == nil && len(probe.Rows) > 0
}

var spaceRE = regexp.MustCompile(`\s+`)

func norm(s string) string {
	return strings.ToLower(spaceRE.ReplaceAllString(strings.TrimSpace(s), " "))
}

func vague(s string) bool {
	switch norm(s) {
	case "", "autre", "autres", "non renseigné", "non renseigne", "nc", "n/a", "-", "autre région", "autre region", "autres régions":
		return true
	}
	return false
}

func xpIndex(s string) int {
	k := strings.ReplaceAll(norm(s), " ", "")
	for i, l := range XPLabels {
		if k == strings.ReplaceAll(norm(l), " ", "") {
			return i
		}
	}
	switch k {
	case "0-1ans", "<1an", "0an", "1an":
		return 0
	case "10ans+", "10ansetplus", "+10ans", "10+":
		return 4
	}
	return -1
}

func regionName(s string) string {
	t := strings.TrimSpace(s)
	if a, ok := regionAliases[norm(t)]; ok {
		return a
	}
	for name := range regionCodes {
		if norm(name) == norm(t) {
			return name
		}
	}
	return t
}

// FromSurvey réduit l'export brut du sondage au format du Hub. Seules les tranches sont gardées.
func FromSurvey(raw []byte, now time.Time) (*Dataset, Report, error) {
	var s survey
	if err := json.Unmarshal(raw, &s); err != nil {
		return nil, Report{}, fmt.Errorf("fichier illisible : %w", err)
	}
	rep := Report{Dropped: []string{"année de diplôme (seules la première et la dernière promo sont gardées)", "années d’expérience exactes", "anecdotes", "statut de reconstitution", "boîte à idées", "statistiques déjà calculées"}}
	type pre struct {
		cat  [nDims]string
		xp   int
		base int
		tot  int
		adv  []string
	}
	var rows []pre
	minY, maxY, grouped := 0, 0, 0
	for _, r := range s.Rows {
		xp := xpIndex(r.XP)
		base, tot := int(r.Base+0.5), int(r.Total+0.5)
		if tot == 0 {
			tot = base
		}
		if xp < 0 || base < minSalary || base > maxSalary || tot < minSalary || tot > maxSalary {
			rep.Skipped++
			continue
		}
		p := pre{xp: xp, base: base, tot: tot, adv: r.Avantages}
		p.cat[dPoste], p.cat[dSecteur], p.cat[dStructure] = r.Poste, r.Secteur, r.Structure
		p.cat[dRegion], p.cat[dSexe] = regionName(r.Region), r.Sexe
		rows = append(rows, p)
		if strings.Contains(norm(r.Statut), "groupe") {
			grouped++
		}
		var y int
		if err := json.Unmarshal(r.Annee, &y); err != nil {
			var ys string
			if json.Unmarshal(r.Annee, &ys) == nil {
				y, _ = strconv.Atoi(strings.TrimSpace(ys))
			}
		}
		if y >= 1990 && y <= 2100 {
			if minY == 0 || y < minY {
				minY = y
			}
			if y > maxY {
				maxY = y
			}
		}
	}
	rep.Rows = len(rows)
	if len(rows) == 0 {
		return nil, rep, errors.New("aucune réponse lisible dans « reponses_individuelles »")
	}

	d := &Dataset{Format: Format, Version: Version, Source: "Sondage alumni ISIS « Panorama des Carrières »", Promos: [2]int{minY, maxY}, Grouped: grouped}
	if e := strings.TrimSpace(s.Metadata.Extraction); len(e) >= 10 && dateRE.MatchString(e[:10]) {
		d.Extracted = e[:10]
	} else {
		d.Extracted = now.Format("2006-01-02")
	}
	if minY == 0 {
		d.Promos = [2]int{}
	}

	// Catégories : imprécises et rares (moins de MinShow réponses) dans « autre » ; plus fréquentes
	// d'abord, « autre » en dernier.
	index := [nDims]map[string]int{}
	for dim := dPoste; dim < nDims; dim++ {
		other := otherLabel[dim]
		if dim == dSecteur { // une catégorie du sondage qui dit déjà « autre » sert de fourre-tout
			for _, p := range rows {
				if c := strings.TrimSpace(p.cat[dim]); !vague(c) && strings.Contains(norm(c), "autre") {
					other = c
					break
				}
			}
		}
		count := map[string]int{}
		for i := range rows {
			c := strings.TrimSpace(rows[i].cat[dim])
			if vague(c) {
				c = other
			}
			rows[i].cat[dim] = c
			count[c]++
		}
		var merged []string
		for c, n := range count {
			if c != other && n < MinShow {
				merged = append(merged, c)
			}
		}
		sort.Strings(merged)
		if len(merged) > 0 {
			if rep.Merged == nil {
				rep.Merged = map[string][]string{}
			}
			rep.Merged[dimNames[dim]] = merged
			for i := range rows {
				for _, m := range merged {
					if rows[i].cat[dim] == m {
						rows[i].cat[dim] = other
						count[other]++
					}
				}
			}
			for _, m := range merged {
				delete(count, m)
			}
		}
		labels := make([]string, 0, len(count))
		for c := range count {
			if c != other {
				labels = append(labels, c)
			}
		}
		sort.Slice(labels, func(a, b int) bool {
			if count[labels[a]] != count[labels[b]] {
				return count[labels[a]] > count[labels[b]]
			}
			return labels[a] < labels[b]
		})
		if count[other] > 0 {
			labels = append(labels, other)
		}
		d.Dims.set(dim, labels)
		index[dim] = map[string]int{}
		for i, l := range labels {
			index[dim][l] = i
		}
	}

	// Avantages : ordre connu, puis les autres par fréquence.
	advCount := map[string]int{}
	for _, p := range rows {
		for _, a := range p.adv {
			if a = strings.TrimSpace(a); a != "" {
				advCount[a]++
			}
		}
	}
	for _, a := range knownAdv {
		if advCount[a] > 0 {
			d.Adv = append(d.Adv, a)
		}
	}
	var extra []string
	for a := range advCount {
		if !contains(knownAdv, a) {
			extra = append(extra, a)
		}
	}
	sort.Slice(extra, func(a, b int) bool {
		if advCount[extra[a]] != advCount[extra[b]] {
			return advCount[extra[a]] > advCount[extra[b]]
		}
		return extra[a] < extra[b]
	})
	if len(extra) > 20-len(d.Adv) {
		extra = extra[:20-len(d.Adv)]
	}
	d.Adv = append(d.Adv, extra...)
	if d.Adv == nil {
		d.Adv = []string{}
	}

	for _, p := range rows {
		r := Row{Xp: p.xp, Base: p.base, Total: p.tot, Adv: []int{}}
		for dim := dPoste; dim < nDims; dim++ {
			r.setDim(dim, index[dim][p.cat[dim]])
		}
		seen := map[int]bool{}
		for _, a := range p.adv {
			if i := indexOf(d.Adv, strings.TrimSpace(a)); i >= 0 && !seen[i] {
				seen[i] = true
				r.Adv = append(r.Adv, i)
			}
		}
		sort.Ints(r.Adv)
		d.Rows = append(d.Rows, r)
	}
	// Ordre des tranches, pas celui du sondage (rangé par année de diplôme) : rien ne relie une
	// réponse à sa promo, même dans le fichier gardé.
	sort.SliceStable(d.Rows, func(a, b int) bool {
		x, y := &d.Rows[a], &d.Rows[b]
		for dim := 0; dim < nDims; dim++ {
			if x.dim(dim) != y.dim(dim) {
				return x.dim(dim) < y.dim(dim)
			}
		}
		if x.Base != y.Base {
			return x.Base < y.Base
		}
		return x.Total < y.Total
	})
	for i := range d.Rows {
		d.Rows[i].ID = "a" + strconv.Itoa(i+1)
	}

	// Conseils : le texte seul (ni poste, ni secteur, ni expérience), à relire avant d'être montré.
	seenTip := map[string]bool{}
	d.Tips = []Tip{}
	for _, t := range s.Tips {
		c, err := cleanText(collapse(t.Conseil), 1500, true)
		if err != nil || c == "" || seenTip[norm(c)] || len(d.Tips) >= maxTips {
			continue
		}
		seenTip[norm(c)] = true
		d.Tips = append(d.Tips, Tip{ID: "t" + strconv.Itoa(len(d.Tips)+1), T: c})
	}
	rep.Tips = len(d.Tips)
	if err := d.Validate(); err != nil {
		return nil, rep, err
	}
	return d, rep, nil
}

var blankLines = regexp.MustCompile(`\n{3,}`)

func collapse(s string) string {
	s = strings.ReplaceAll(strings.ReplaceAll(s, "\r\n", "\n"), "\r", "\n")
	return blankLines.ReplaceAllString(s, "\n\n")
}

func contains(list []string, s string) bool { return indexOf(list, s) >= 0 }

func indexOf(list []string, s string) int {
	for i, x := range list {
		if x == s {
			return i
		}
	}
	return -1
}

// Decode lit un fichier déposé : export brut du sondage ou format du Hub.
func Decode(raw []byte, now time.Time) (*Dataset, *Report, error) {
	if IsSurvey(raw) {
		d, rep, err := FromSurvey(raw, now)
		return d, &rep, err
	}
	var d Dataset
	dec := json.NewDecoder(bytes.NewReader(raw))
	dec.DisallowUnknownFields()
	if err := dec.Decode(&d); err != nil {
		return nil, nil, fmt.Errorf("fichier illisible : %w", err)
	}
	if err := d.Validate(); err != nil {
		return nil, nil, err
	}
	return &d, nil, nil
}
