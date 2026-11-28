package salaires

// Les calculs du simulateur, faits ici pour que les réponses ne quittent jamais le serveur. Portés
// de la maquette (« ISIS Hub · maquette Salaires »), avec une discrétion plus stricte :
//
//   - un groupe n'est montré (médiane, effectif) qu'à partir de MinShow réponses ; ses quartiles
//     qu'à partir de MinSpread (avec 5 réponses, médiane et quartiles donneraient 3 salaires) ;
//   - une case ne se coche que si, seule dans son critère et avec le reste du profil, elle garde
//     MinShow réponses : cocher deux postes ne peut pas isoler la seule personne du second ;
//   - le profil reçu est vérifié ici : une case qui ne respecte plus la règle (devenue trop rare
//     parce qu'une autre a été cochée) est décochée, et la page le dit ;
//   - aucune moyenne d'un groupe n'est rendue, seulement des médianes, arrondies à 500 €.
//
// L'estimation vient d'un modèle appris sur toutes les réponses (régression ridge sur le logarithme
// du salaire, sans le sexe), choisi en mettant chaque réponse de côté tour à tour.

import (
	"math"
	"sort"
)

// Critères du profil (et du modèle), dans l'ordre de la maquette.
var factors = []int{dXp, dPoste, dSecteur, dStructure, dRegion}

// Ordre dans lequel un profil trop rare est élargi.
var relaxOrder = []int{dStructure, dSecteur, dPoste, dRegion, dXp}

// Tranches de la répartition (k€).
var bins = []float64{0, 30_000, 35_000, 40_000, 45_000, 50_000, 60_000, 70_000, 80_000, 90_000, 100_000, math.Inf(1)}

// Profile : les cases cochées, par critère (aucune = tous).
type Profile struct {
	Xp        []int `json:"xp"`
	Poste     []int `json:"poste"`
	Secteur   []int `json:"secteur"`
	Structure []int `json:"structure"`
	Region    []int `json:"region"`
}

func (p *Profile) get(d int) []int {
	switch d {
	case dXp:
		return p.Xp
	case dPoste:
		return p.Poste
	case dSecteur:
		return p.Secteur
	case dStructure:
		return p.Structure
	case dRegion:
		return p.Region
	}
	return nil
}

func (p *Profile) put(d int, v []int) {
	if v == nil {
		v = []int{}
	}
	switch d {
	case dXp:
		p.Xp = v
	case dPoste:
		p.Poste = v
	case dSecteur:
		p.Secteur = v
	case dStructure:
		p.Structure = v
	case dRegion:
		p.Region = v
	}
}

func (p Profile) clone() Profile {
	var q Profile
	for _, d := range factors {
		q.put(d, append([]int(nil), p.get(d)...))
	}
	return q
}

func has(s []int, v int) bool {
	for _, x := range s {
		if x == v {
			return true
		}
	}
	return false
}

// ------------------------------------------------------------ outils

func quantile(sorted []float64, p float64) float64 {
	if len(sorted) == 0 {
		return math.NaN()
	}
	i := float64(len(sorted)-1) * p
	lo, hi := int(math.Floor(i)), int(math.Ceil(i))
	return sorted[lo] + (sorted[hi]-sorted[lo])*(i-float64(lo))
}

func round(v, step float64) float64 { return math.Round(v/step) * step }

// Group : un groupe de réponses tel qu'il peut être montré.
type Group struct {
	N      int      `json:"n"`             // 0 : aucun, ou trop peu (Few)
	Few    bool     `json:"few,omitempty"` // entre 1 et MinShow-1 réponses : masqué
	Median *float64 `json:"median,omitempty"`
	Q1     *float64 `json:"q1,omitempty"`
	Q3     *float64 `json:"q3,omitempty"`
}

func describe(vals []float64) Group {
	n := len(vals)
	switch {
	case n == 0:
		return Group{}
	case n < MinShow:
		return Group{Few: true}
	}
	s := append([]float64(nil), vals...)
	sort.Float64s(s)
	m := round(quantile(s, .5), 500)
	g := Group{N: n, Median: &m}
	if n >= MinSpread {
		q1, q3 := round(quantile(s, .25), 500), round(quantile(s, .75), 500)
		g.Q1, g.Q3 = &q1, &q3
	}
	return g
}

// ------------------------------------------------------------ moteur

type engine struct {
	d      *Dataset
	levels [nDims]int
	models [2]*model // fixe, avec primes
}

func newEngine(d *Dataset) *engine {
	e := &engine{d: d}
	for dim := 0; dim < nDims; dim++ {
		e.levels[dim] = len(d.Dims.of(dim))
	}
	e.models[0] = fitModel(d.Rows, e.levels, 0)
	e.models[1] = fitModel(d.Rows, e.levels, 1)
	return e
}

func value(r *Row, target int) float64 {
	if target == 1 {
		return float64(max(r.Total, r.Base))
	}
	return float64(r.Base)
}

// match : réponses du profil, sans tenir compte du critère except (-1 : aucun).
func (e *engine) match(f Profile, except int) []*Row {
	out := make([]*Row, 0, len(e.d.Rows))
	for i := range e.d.Rows {
		r := &e.d.Rows[i]
		ok := true
		for _, d := range factors {
			if s := f.get(d); d != except && len(s) > 0 && !has(s, r.dim(d)) {
				ok = false
				break
			}
		}
		if ok {
			out = append(out, r)
		}
	}
	return out
}

func (e *engine) count(f Profile) int { return len(e.match(f, -1)) }

// only : le profil avec le seul choix v pour le critère d.
func only(f Profile, d, v int) Profile {
	g := f.clone()
	g.put(d, []int{v})
	return g
}

// valid : chaque case cochée, seule dans son critère, garde MinShow réponses avec le reste.
func (e *engine) valid(f Profile) bool {
	for _, d := range factors {
		for _, v := range f.get(d) {
			if e.count(only(f, d, v)) < MinShow {
				return false
			}
		}
	}
	return true
}

// enforce nettoie un profil reçu : valeurs connues, sans doublon, triées ; puis décoche la case la
// plus rare tant que la règle n'est pas respectée.
func (e *engine) enforce(in Profile) Profile {
	var f Profile
	for _, d := range factors {
		var s []int
		for _, v := range in.get(d) {
			if v >= 0 && v < e.levels[d] && !has(s, v) && len(s) < e.levels[d] {
				s = append(s, v)
			}
		}
		sort.Ints(s)
		f.put(d, s)
	}
	for !e.valid(f) {
		bd, bv, bn := -1, -1, math.MaxInt
		for _, d := range factors {
			for _, v := range f.get(d) {
				if n := e.count(only(f, d, v)); n < bn {
					bd, bv, bn = d, v, n
				}
			}
		}
		s := f.get(bd)
		out := make([]int, 0, len(s))
		for _, v := range s {
			if v != bv {
				out = append(out, v)
			}
		}
		f.put(bd, out)
	}
	return f
}

func toggled(f Profile, d, v int) Profile {
	g := f.clone()
	s := g.get(d)
	if has(s, v) {
		out := []int{}
		for _, x := range s {
			if x != v {
				out = append(out, x)
			}
		}
		g.put(d, out)
	} else {
		s = append(s, v)
		sort.Ints(s)
		g.put(d, s)
	}
	return g
}

// Chip : une case du profil. N n'est donné qu'à partir de MinShow ; Ok : elle peut être cochée (elle
// garde MinShow réponses avec le reste du profil) ou décochée.
type Chip struct {
	N  int  `json:"n,omitempty"`
	Ok bool `json:"ok"`
}

func (e *engine) chips(f Profile) map[string][]Chip {
	out := map[string][]Chip{}
	for _, d := range factors {
		list := make([]Chip, e.levels[d])
		for v := range list {
			n := e.count(only(f, d, v))
			c := Chip{}
			if n >= MinShow {
				c.N = n
			}
			// Cochée : on peut toujours la décocher. Sinon : il suffit qu'elle garde MinShow réponses ;
			// si elle rend trop rare une case d'un autre critère, enforce décoche celle-là (la page
			// le dit), jamais celle qu'on vient de cocher.
			c.Ok = has(f.get(d), v) || n >= MinShow
			list[v] = c
		}
		out[dimNames[d]] = list
	}
	return out
}

// Scope : le profil vraiment mesuré par un panneau, après élargissement.
type Scope struct {
	F       Profile  `json:"f"`
	Dropped []string `json:"dropped"`
}

// relax élargit le profil (en retirant des critères, dans relaxOrder) jusqu'à ce que ok soit vrai.
// except : critère ignoré (celui que le panneau fait varier).
func (e *engine) relax(f Profile, except int, ok func([]*Row) bool) ([]*Row, Scope) {
	g := f.clone()
	if except >= 0 {
		g.put(except, []int{})
	}
	rows := e.match(g, -1)
	sc := Scope{Dropped: []string{}}
	for _, d := range relaxOrder {
		if ok(rows) {
			break
		}
		if len(g.get(d)) == 0 || d == except {
			continue
		}
		g.put(d, []int{})
		sc.Dropped = append(sc.Dropped, dimNames[d])
		rows = e.match(g, -1)
	}
	sc.F = g
	return rows, sc
}

func atLeast(n int) func([]*Row) bool { return func(r []*Row) bool { return len(r) >= n } }

// cells : au moins k valeurs de la dimension d ont MinShow réponses.
func cells(d, k int) func([]*Row) bool {
	return func(rows []*Row) bool {
		c := map[int]int{}
		for _, r := range rows {
			c[r.dim(d)]++
		}
		n := 0
		for _, x := range c {
			if x >= MinShow {
				n++
			}
		}
		return n >= k
	}
}

func values(rows []*Row, target int, keep func(*Row) bool) []float64 {
	var out []float64
	for _, r := range rows {
		if keep == nil || keep(r) {
			out = append(out, value(r, target))
		}
	}
	return out
}

// ------------------------------------------------------------ réponse

// Pred : estimation du modèle (et sa fourchette).
type Pred struct {
	Value float64 `json:"value"`
	Q1    float64 `json:"q1"`
	Q3    float64 `json:"q3"`
	P10   float64 `json:"p10"`
	P90   float64 `json:"p90"`
}

type Result struct {
	Pred
	Average float64            `json:"average"` // estimation pour l'alumni « moyen » (modèle)
	Effects map[string]float64 `json:"effects"` // effet de chaque critère coché, en part
	Exact   Group              `json:"exact"`   // réponses qui ont exactement ce profil
}

type XpPoint struct {
	P   Pred  `json:"p"`
	Obs Group `json:"obs"`
}

type Panel struct {
	Scope  Scope   `json:"scope"`
	Groups []Group `json:"groups"` // par valeur de la dimension du panneau
}

type Hist struct {
	Scope Scope  `json:"scope"`
	N     int    `json:"n"`
	Bins  []*int `json:"bins"` // nil : entre 1 et MinShow-1 réponses
	Est   int    `json:"est"`  // tranche de l'estimation
}

type Perks struct {
	Scope       Scope      `json:"scope"`
	N           int        `json:"n"`
	Bonus       *float64   `json:"bonus"`       // part qui touche des primes (nil : trop peu)
	BonusMedian *float64   `json:"bonusMedian"` // primes par an, médiane de ceux qui en ont
	Adv         []*float64 `json:"adv"`         // part de chaque avantage
}

// Estimate : tout ce que la page montre pour un profil.
type Estimate struct {
	F      Profile           `json:"f"` // profil vraiment pris en compte
	Target string            `json:"target"`
	Chips  map[string][]Chip `json:"chips"`
	Result Result            `json:"result"`
	Xp     struct {
		Scope Scope     `json:"scope"`
		Pts   []XpPoint `json:"pts"`
	} `json:"xp"`
	Map   Panel            `json:"map"`
	Cmp   map[string]Panel `json:"cmp"`
	Hist  Hist             `json:"hist"`
	Perks Perks            `json:"perks"`
}

func roundPred(p Pred) Pred {
	return Pred{Value: round(p.Value, 100), Q1: round(p.Q1, 100), Q3: round(p.Q3, 100), P10: round(p.P10, 100), P90: round(p.P90, 100)}
}

func (e *engine) groupsBy(rows []*Row, d, target int) []Group {
	out := make([]Group, e.levels[d])
	for v := range out {
		out[v] = describe(values(rows, target, func(r *Row) bool { return r.dim(d) == v }))
	}
	return out
}

func share(c, n int) *float64 {
	if n == 0 || (c > 0 && c < MinShow) {
		return nil
	}
	v := math.Round(float64(c)/float64(n)*1000) / 1000
	return &v
}

// Estimate calcule tout pour un profil (target 0 : fixe, 1 : avec primes).
func (e *engine) Estimate(in Profile, target int) Estimate {
	f := e.enforce(in)
	m := e.models[target]
	out := Estimate{F: f, Target: map[int]string{0: "base", 1: "total"}[target], Chips: e.chips(f)}

	p := m.predict(f)
	out.Result = Result{Pred: roundPred(p.Pred), Average: round(p.average, 100), Effects: map[string]float64{}, Exact: describe(values(e.match(f, -1), target, nil))}
	for d, v := range p.effects {
		out.Result.Effects[dimNames[d]] = math.Round(v*1000) / 1000
	}

	rows, sc := e.relax(f, dXp, cells(dXp, 4))
	out.Xp.Scope = sc
	for v := range XPLabels {
		g := f.clone()
		g.put(dXp, []int{v})
		out.Xp.Pts = append(out.Xp.Pts, XpPoint{P: roundPred(m.predict(g).Pred), Obs: describe(values(rows, target, func(r *Row) bool { return r.Xp == v }))})
	}

	rows, sc = e.relax(f, dRegion, cells(dRegion, 5))
	out.Map = Panel{Scope: sc, Groups: e.groupsBy(rows, dRegion, target)}

	out.Cmp = map[string]Panel{}
	for _, d := range []int{dPoste, dSecteur, dStructure, dSexe} {
		var except, k = d, 3
		if d == dSexe {
			except, k = -1, 2
		}
		rows, sc := e.relax(f, except, cells(d, k))
		out.Cmp[dimNames[d]] = Panel{Scope: sc, Groups: e.groupsBy(rows, d, target)}
	}

	rows, sc = e.relax(f, -1, atLeast(MinSpread))
	vals := values(rows, target, nil)
	out.Hist = Hist{Scope: sc, N: len(vals), Bins: make([]*int, len(bins)-1), Est: -1}
	for i := 0; i < len(bins)-1; i++ {
		c := 0
		for _, v := range vals {
			if v >= bins[i] && v < bins[i+1] {
				c++
			}
		}
		if c == 0 || c >= MinShow {
			out.Hist.Bins[i] = &c
		}
		if p.Value >= bins[i] && p.Value < bins[i+1] {
			out.Hist.Est = i
		}
	}
	// Une seule tranche masquée se déduirait du total : la plus petite tranche montrée (non vide)
	// est masquée avec elle.
	few, small := 0, -1
	for i, c := range out.Hist.Bins {
		switch {
		case c == nil:
			few++
		case *c > 0 && (small < 0 || *c < *out.Hist.Bins[small]):
			small = i
		}
	}
	if few == 1 && small >= 0 {
		out.Hist.Bins[small] = nil
	}

	rows, sc = e.relax(f, -1, atLeast(15))
	out.Perks = Perks{Scope: sc, N: len(rows), Adv: make([]*float64, len(e.d.Adv))}
	var bonus []float64
	for _, r := range rows {
		if r.Total > r.Base {
			bonus = append(bonus, float64(r.Total-r.Base))
		}
	}
	out.Perks.Bonus = share(len(bonus), len(rows))
	if g := describe(bonus); g.Median != nil {
		out.Perks.BonusMedian = g.Median
	}
	for i := range e.d.Adv {
		c := 0
		for _, r := range rows {
			if has(r.Adv, i) {
				c++
			}
		}
		out.Perks.Adv[i] = share(c, len(rows))
	}
	return out
}

// ------------------------------------------------------------ modèle

type model struct {
	offs   [nDims]int
	w      []float64
	res    []float64 // résidus (réponse mise de côté), triés
	freq   [nDims][]float64
	lambda float64
	mdae   float64 // écart médian à la vraie réponse, en part
}

type predicted struct {
	Pred
	average float64
	effects map[int]float64
}

func solve(A [][]float64, b []float64) []float64 {
	n := len(b)
	M := make([][]float64, n)
	for i := range A {
		M[i] = append(append([]float64(nil), A[i]...), b[i])
	}
	for c := 0; c < n; c++ {
		p := c
		for r := c + 1; r < n; r++ {
			if math.Abs(M[r][c]) > math.Abs(M[p][c]) {
				p = r
			}
		}
		M[c], M[p] = M[p], M[c]
		if M[c][c] == 0 {
			continue
		}
		for r := c + 1; r < n; r++ {
			if k := M[r][c] / M[c][c]; k != 0 {
				for j := c; j <= n; j++ {
					M[r][j] -= k * M[c][j]
				}
			}
		}
	}
	x := make([]float64, n)
	for r := n - 1; r >= 0; r-- {
		s := M[r][n]
		for j := r + 1; j < n; j++ {
			s -= M[r][j] * x[j]
		}
		if M[r][r] != 0 {
			x[r] = s / M[r][r]
		}
	}
	return x
}

func fitModel(rows []Row, levels [nDims]int, target int) *model {
	m := &model{}
	p := 1
	for _, k := range factors {
		m.offs[k] = p
		p += levels[k]
	}
	feats := make([][]int, len(rows)) // indices des colonnes à 1
	y := make([]float64, len(rows))
	for i := range rows {
		f := []int{0}
		for _, k := range factors {
			f = append(f, m.offs[k]+rows[i].dim(k))
		}
		feats[i] = f
		y[i] = math.Log(value(&rows[i], target))
	}
	fit := func(skip int, lambda float64) []float64 {
		A := make([][]float64, p)
		for a := range A {
			A[a] = make([]float64, p)
		}
		b := make([]float64, p)
		for i := range rows {
			if i == skip {
				continue
			}
			for _, a := range feats[i] {
				b[a] += y[i]
				for _, c := range feats[i] {
					A[a][c]++
				}
			}
		}
		for a := 1; a < p; a++ {
			if a < m.offs[dPoste] {
				A[a][a] += lambda / 4 // l'expérience compte beaucoup : peu tirée vers zéro
			} else {
				A[a][a] += lambda
			}
		}
		return solve(A, b)
	}
	dot := func(w []float64, i int) float64 {
		s := 0.
		for _, a := range feats[i] {
			s += w[a]
		}
		return s
	}
	bestMAE := math.Inf(1)
	var bestRes []float64
	for _, lambda := range []float64{2, 4, 7, 12, 20} {
		res := make([]float64, len(rows))
		mae := 0.
		for i := range rows {
			res[i] = y[i] - dot(fit(i, lambda), i)
			mae += math.Abs(res[i])
		}
		if mae /= float64(len(rows)); mae < bestMAE {
			bestMAE, bestRes, m.lambda = mae, res, lambda
		}
	}
	m.w = fit(-1, m.lambda)
	m.res = append([]float64(nil), bestRes...)
	sort.Float64s(m.res)
	abs := make([]float64, len(bestRes))
	for i, r := range bestRes {
		abs[i] = math.Abs(r)
	}
	sort.Float64s(abs)
	m.mdae = math.Exp(quantile(abs, .5)) - 1
	for _, k := range factors {
		m.freq[k] = make([]float64, levels[k])
		for i := range rows {
			m.freq[k][rows[i].dim(k)] += 1 / float64(len(rows))
		}
	}
	return m
}

func (m *model) coef(k, v int) float64 { return m.w[m.offs[k]+v] }

func (m *model) avgCoef(k int) float64 {
	s := 0.
	for v, f := range m.freq[k] {
		s += f * m.coef(k, v)
	}
	return s
}

func (m *model) predict(f Profile) predicted {
	base := m.w[0]
	for _, k := range factors {
		base += m.avgCoef(k)
	}
	out := predicted{average: math.Exp(base), effects: map[int]float64{}}
	lp := base
	for _, k := range factors {
		s := f.get(k)
		if len(s) == 0 {
			continue
		}
		wsum, num := 0., 0.
		for _, v := range s {
			wsum += m.freq[k][v]
		}
		for _, v := range s {
			fr := m.freq[k][v]
			if fr == 0 {
				fr = 1 / float64(len(s))
			}
			num += fr * m.coef(k, v)
		}
		if wsum == 0 {
			wsum = float64(len(s))
		}
		e := num/wsum - m.avgCoef(k)
		out.effects[k] = math.Exp(e) - 1
		lp += e
	}
	at := func(q float64) float64 { return math.Exp(lp + quantile(m.res, q)) }
	out.Pred = Pred{Value: math.Exp(lp), Q1: at(.25), Q3: at(.75), P10: at(.1), P90: at(.9)}
	return out
}
