// Package calendar produit les calendriers filtrés (groupe, langue, parcours) des classes d'ISIS,
// pour l'abonnement des agendas (iPhone, Google, Outlook).
//
// Les règles reprennent EXACTEMENT celles du projet « Calendriers ISIS » : les fichiers produits sont
// comparés octet par octet à sa sortie (testdata/reference.json). La page applique les mêmes règles
// (web/js/portals/classes.js) à partir du même fichier de données (web/data/classes.json).
//
// Seul l'export PUBLIC d'ADE est lu : aucune donnée personnelle, aucun compte.
package calendar

import (
	"errors"
	"fmt"
	"regexp"
	"sort"
	"strings"
	"sync"
	"unicode/utf8"

	"golang.org/x/text/cases"
	"golang.org/x/text/language"
	"golang.org/x/text/unicode/norm"
)

// Class décrit une classe telle que dans web/data/classes.json.
type Class struct {
	Label          string              `json:"label"`
	Resources      []int               `json:"resources"`
	Filter         string              `json:"filter"`
	LinkedLanguage bool                `json:"linkedLanguage"`
	Common         string              `json:"common"`
	Aliases        map[string]string   `json:"aliases"`
	Tracks         map[string][]string `json:"tracks"`
	// CodeYear : chiffre de l'année dans les codes de matières (E4-…, A5-…), pour les parcours.
	CodeYear int `json:"codeYear,omitempty"`
}

type Season struct {
	First string `json:"first"`
	Last  string `json:"last"`
}

type Data struct {
	ProjectID   int               `json:"projectId"`
	Season      Season            `json:"season"`
	TrackLabels map[string]string `json:"trackLabels"`
	Classes     map[string]Class  `json:"classes"`
}

var (
	classKeyRE = regexp.MustCompile(`^[A-Z]{2,5}[0-9]{1,2}$`)
	trackKeyRE = regexp.MustCompile(`^[a-z0-9-]{1,24}$`)
	codeRE     = regexp.MustCompile(`^[A-Z0-9]+(?:-[A-Z0-9]+){1,6}$`)
	markerRE   = regexp.MustCompile(`^[A-Z0-9-]{0,60}$`)
	dateRE     = regexp.MustCompile(`^[0-9]{4}-[0-9]{2}-[0-9]{2}$`)
)

// Validate vérifie une répartition avant de l'accepter (elle vient de la page d'administration).
func (d Data) Validate() error {
	if d.ProjectID < 1 || d.ProjectID > 9999 {
		return errors.New("numéro de projet ADE invalide")
	}
	if !dateRE.MatchString(d.Season.First) || !dateRE.MatchString(d.Season.Last) || d.Season.First >= d.Season.Last {
		return errors.New("période de l'année invalide (AAAA-MM-JJ, début avant fin)")
	}
	if len(d.Classes) == 0 || len(d.Classes) > 30 {
		return errors.New("entre 1 et 30 classes")
	}
	for k, v := range d.TrackLabels {
		if !trackKeyRE.MatchString(k) || strings.TrimSpace(v) == "" || utf8.RuneCountInString(v) > 40 {
			return fmt.Errorf("nom de parcours invalide : %q", k)
		}
	}
	for key, c := range d.Classes {
		if !classKeyRE.MatchString(key) {
			return fmt.Errorf("nom de classe invalide : %q (ex. FIE4)", key)
		}
		if strings.TrimSpace(c.Label) == "" || utf8.RuneCountInString(c.Label) > 60 {
			return fmt.Errorf("%s : description obligatoire (60 caractères au plus)", key)
		}
		if len(c.Resources) == 0 || len(c.Resources) > 10 {
			return fmt.Errorf("%s : entre 1 et 10 ressources ADE", key)
		}
		for _, r := range c.Resources {
			if r < 1 || r > 9_999_999 {
				return fmt.Errorf("%s : ressource ADE invalide (%d)", key, r)
			}
		}
		if len(c.Aliases) > 100 {
			return fmt.Errorf("%s : 100 alias au plus", key)
		}
		for a, b := range c.Aliases {
			if !codeRE.MatchString(a) || !codeRE.MatchString(b) {
				return fmt.Errorf("%s : alias invalide %q → %q", key, a, b)
			}
		}
		switch c.Filter {
		case "all", "groupLanguage":
			if len(c.Tracks) > 0 {
				return fmt.Errorf("%s : ce mode n'a pas de parcours", key)
			}
		case "fie4", "fie5":
			if c.CodeYear < 1 || c.CodeYear > 9 {
				return fmt.Errorf("%s : année des codes de matières entre 1 et 9", key)
			}
			if !markerRE.MatchString(c.Common) {
				return fmt.Errorf("%s : repère des événements communs invalide", key)
			}
			if len(c.Tracks) == 0 || len(c.Tracks) > 8 {
				return fmt.Errorf("%s : entre 1 et 8 parcours", key)
			}
			for t, codes := range c.Tracks {
				if !trackKeyRE.MatchString(t) {
					return fmt.Errorf("%s : nom de parcours invalide %q", key, t)
				}
				if len(codes) == 0 || len(codes) > 200 {
					return fmt.Errorf("%s : parcours %s sans matière", key, t)
				}
				for _, code := range codes {
					if !codeRE.MatchString(code) {
						return fmt.Errorf("%s : code de matière invalide %q", key, code)
					}
				}
			}
		default:
			return fmt.Errorf("%s : mode de répartition inconnu", key)
		}
	}
	return nil
}

// ------------------------------------------------------------ chaînes « comme JavaScript »

var upper = cases.Upper(language.Und)

// jsUpper reproduit String.prototype.toUpperCase (casse complète : « ß » → « SS »).
func jsUpper(s string) string { return upper.String(s) }

// normalize reproduit normalize('NFKC'), le remplacement des tirets, puis toUpperCase.
func normalize(s string) string {
	s = norm.NFKC.String(s)
	s = strings.NewReplacer("‐", "-", "‑", "-", "–", "-", "—", "-", "−", "-").Replace(s)
	return jsUpper(s)
}

func isWord(r rune) bool {
	return r == '_' || r >= '0' && r <= '9' || r >= 'A' && r <= 'Z' || r >= 'a' && r <= 'z'
}
func isDigit(r rune) bool { return r >= '0' && r <= '9' }

// isSpace reproduit \s de JavaScript.
func isSpace(r rune) bool {
	switch r {
	case '\t', '\n', '\v', '\f', '\r', ' ', 0xA0, 0x1680, 0x2028, 0x2029, 0x202F, 0x205F, 0x3000, 0xFEFF:
		return true
	}
	return r >= 0x2000 && r <= 0x200A
}
func isSep(r rune) bool { return isSpace(r) || r == ':' || r == '.' || r == '_' || r == '-' }

// jsTrim reproduit String.prototype.trim.
func jsTrim(s string) string { return strings.TrimFunc(s, isSpace) }

// ------------------------------------------------------------ groupes

var groupWords = []string{"GROUPES", "GROUPE", "GRP", "GR", "G"}

func hasAt(t []rune, i int, w string) bool {
	if i+utf8.RuneCountInString(w) > len(t) {
		return false
	}
	for _, r := range w {
		if t[i] != r {
			return false
		}
		i++
	}
	return true
}

// digitAt reproduit « 0?([12])(?!\d) » à partir de i : rend le chiffre et la fin, ou 0.
func digitAt(t []rune, i int) (rune, int) {
	try := func(k int) (rune, int) {
		if k < len(t) && (t[k] == '1' || t[k] == '2') && (k+1 >= len(t) || !isDigit(t[k+1])) {
			return t[k], k + 1
		}
		return 0, 0
	}
	if i < len(t) && t[i] == '0' {
		if d, e := try(i + 1); d != 0 {
			return d, e
		}
	}
	return try(i)
}

// labelled reproduit « (?:GROUPES?|GRP|GR|G)[\s:._-]*0?([12])(?!\d) » à partir de i.
func labelled(t []rune, i int) (rune, int) {
	for _, w := range groupWords {
		if !hasAt(t, i, w) {
			continue
		}
		k := i + utf8.RuneCountInString(w)
		for k < len(t) && isSep(t[k]) {
			k++
		}
		if d, e := digitAt(t, k); d != 0 {
			return d, e
		}
	}
	return 0, 0
}

// GroupsIn reproduit groupsIn() : seulement les mentions explicites (G1, GROUPE 2, GR 1 ET 2…).
// Les expressions régulières de Go n'ont ni « regarder devant » ni « regarder derrière » : la
// lecture est faite à la main, en suivant pas à pas l'expression d'origine.
func GroupsIn(text string) []int {
	t := []rune(normalize(text))
	found := map[int]bool{}
	for i := 0; i < len(t); {
		if i > 0 && isWord(t[i-1]) { // \b avant G
			i++
			continue
		}
		d, end := labelled(t, i)
		if d == 0 {
			i++
			continue
		}
		found[int(d-'0')] = true
		// (?:\s*(?:ET|OU|\/|&|,|\+)\s*(?:(?:GROUPES?|GRP|GR|G)[\s:._-]*)?0?([12])(?!\d))?
		k := end
		for k < len(t) && isSpace(t[k]) {
			k++
		}
		conj := 0
		switch {
		case hasAt(t, k, "ET"), hasAt(t, k, "OU"):
			conj = 2
		case k < len(t) && strings.ContainsRune("/&,+", t[k]):
			conj = 1
		}
		if conj > 0 {
			k += conj
			for k < len(t) && isSpace(t[k]) {
				k++
			}
			d2, e2 := labelled(t, k)
			if d2 == 0 {
				d2, e2 = digitAt(t, k)
			}
			if d2 != 0 {
				found[int(d2-'0')] = true
				end = e2
			}
		}
		i = end
	}
	out := make([]int, 0, len(found))
	for g := range found {
		out = append(out, g)
	}
	sort.Ints(out)
	return out
}

func hasGroup(groups []int, g int) bool {
	for _, x := range groups {
		if x == g {
			return true
		}
	}
	return false
}

// ------------------------------------------------------------ codes de matières

var (
	codeRegexps sync.Map // clé « 4:fie4 » → *regexp.Regexp
	chinois     = regexp.MustCompile(`(?i)\bchinois\b`)
	espagnol    = regexp.MustCompile(`(?i)\bespagnol\b`)
	exported    = regexp.MustCompile(`(?i)^\(?Exporté le:`)
)

func unique(codes []string, aliases map[string]string) []string {
	seen := map[string]bool{}
	var out []string
	for _, c := range codes {
		if a, ok := aliases[c]; ok && a != "" {
			c = a
		}
		if !seen[c] {
			seen[c] = true
			out = append(out, c)
		}
	}
	return out
}

// codePattern : codes de matières de l'année de la classe. Méthode FIE4 : « E4-1-… » (précédé
// ni d'une lettre ni d'un chiffre, vérifié à part) ; méthode FIE5 : « E5-1-… » ou « A5-1-… ».
func codePattern(c Class) *regexp.Regexp {
	key := fmt.Sprintf("%d:%s", c.CodeYear, c.Filter)
	if re, ok := codeRegexps.Load(key); ok {
		return re.(*regexp.Regexp)
	}
	var re *regexp.Regexp
	if c.Filter == "fie5" {
		re = regexp.MustCompile(fmt.Sprintf(`\b[EA]%d-[12]-[A-Z]+(?:-[0-9]+)*`, c.CodeYear))
	} else {
		re = regexp.MustCompile(fmt.Sprintf(`E%d-[12]-[A-Z]+(?:-[0-9]+)*`, c.CodeYear))
	}
	codeRegexps.Store(key, re)
	return re
}

// fie4Codes : (?<![A-Z0-9])E4-[12]-(?:[A-Z]+)(?:-\d+)* sur le texte normalisé.
func fie4Codes(c Class, text string) []string {
	s := normalize(text)
	var codes []string
	for _, m := range codePattern(c).FindAllStringIndex(s, -1) {
		if m[0] > 0 {
			prev := s[m[0]-1]
			if prev >= 'A' && prev <= 'Z' || prev >= '0' && prev <= '9' {
				continue
			}
		}
		codes = append(codes, s[m[0]:m[1]])
	}
	return unique(codes, c.Aliases)
}

func fie5Codes(c Class, text string) []string {
	return unique(codePattern(c).FindAllString(jsUpper(text), -1), c.Aliases)
}

func withoutExport(description string) string {
	var keep []string
	for _, l := range strings.Split(description, "\n") {
		if !exported.MatchString(jsTrim(l)) {
			keep = append(keep, l)
		}
	}
	return strings.Join(keep, "\n")
}

func firstLine(description string) string {
	for _, l := range strings.Split(description, "\n") {
		if jsTrim(l) != "" {
			return l
		}
	}
	return ""
}

func contains(list []string, x string) bool {
	for _, v := range list {
		if v == x {
			return true
		}
	}
	return false
}

// Choice : ce que l'étudiant a choisi.
type Choice struct {
	Group    int
	Language string
	Track    string
}

// Keep dit si une séance (champs bruts SUMMARY et DESCRIPTION) fait partie du calendrier.
func Keep(c Class, ch Choice, summary, description string) bool {
	switch c.Filter {
	case "groupLanguage":
		lang := ch.Language
		if c.LinkedLanguage {
			lang = map[bool]string{true: "chinois", false: "espagnol"}[ch.Group == 1]
		}
		groups := GroupsIn(summary + "\n" + withoutExport(description))
		evLang := ""
		if chinois.MatchString(summary) {
			evLang = "chinois"
		} else if espagnol.MatchString(summary) {
			evLang = "espagnol"
		}
		return (len(groups) == 0 || hasGroup(groups, ch.Group)) && (evLang == "" || evLang == lang)
	case "fie4":
		codes := fie4Codes(c, summary)
		if len(codes) == 0 {
			codes = fie4Codes(c, firstLine(description))
		}
		common := len(codes) == 0 && strings.Contains(description, c.Common)
		allowed := c.Tracks[ch.Track]
		ok := common
		for _, x := range codes {
			ok = ok || contains(allowed, x)
		}
		if !ok {
			return false
		}
		groups := GroupsIn(summary + "\n" + withoutExport(description))
		return len(groups) == 0 || hasGroup(groups, ch.Group)
	case "fie5":
		codes := fie5Codes(c, summary)
		if len(codes) == 0 {
			codes = fie5Codes(c, firstLine(description))
		}
		if len(codes) == 0 {
			return true
		}
		for _, x := range codes {
			if contains(c.Tracks[ch.Track], x) {
				return true
			}
		}
		return false
	default:
		return true
	}
}
