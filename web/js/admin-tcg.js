// Administration · Cartes TCG : lancement du jeu (réglages, vagues et leurs dates), modération
// des propositions (on valide par défaut, on bloque ce qui insulte, dénigre ou expose quelqu'un),
// cartes signalées par les joueurs, et aperçu de l'impression d'une vague.
//
// Appels à /api/tcg/admin/… avec la session administrateur (cookie HttpOnly) et l'en-tête
// X-Hub-Admin. Tout ce qui vient des étudiants est affiché comme du texte.

import { $, $$, h, toast, isTyping } from './core/dom.js';
import { cardEl, ic, rchip, RLABEL, RARITIES, CATS, ago, dayLong, hourText, plural } from './tcg/ui.js';
import { peoplePicker } from './tcg/people.js';
import { mailBridge, moodleBridge } from './tcg/mailbridge.js';
import { isisMatcher } from './tcg/isis.js';
import { sendConsentMails, mailText, MAIL_SUBJECT } from './tcg/consent.js';

const REASONS = {
  injure: ['Injurieux ou dénigrant', 'Ta carte vise ou rabaisse quelqu’un. Le TCG reste bienveillant : propose une autre version, on la validera avec plaisir.'],
  reconnaissable: ['Personne reconnaissable sans accord', 'On reconnaît quelqu’un sur la photo sans être sûrs de son accord. Renvoie-la avec son accord, ou choisis une autre photo !'],
  prive: ['Données privées', 'La carte montre des informations privées (notes, mails, adresse…). Retire-les et renvoie-la !'],
  choquant: ['Contenu choquant ou illégal', 'Cette carte ne peut pas entrer dans le jeu. Propose-nous autre chose !'],
  illisible: ['Photo illisible', 'On ne voit pas bien la photo : renvoie une version plus nette !'],
  doublon: ['Doublon', 'Cette carte existe déjà, dans le jeu ou en proposition. Une autre idée ?'],
  autre: ['Autre', ''],
};
const REPORTS = { moque: 'Se moque de quelqu’un', reconnaissable: 'Personne reconnaissable sans accord', prive: 'Données privées', choquant: 'Contenu choquant', pasdrole: 'Pas drôle', autre: 'Autre' };
const FILTERS = [
  ['pending', 'À valider', 'clock', 'tad-kpi--pending'],
  ['consent', 'En attente d’accord', 'person', 'tad-kpi--consent'],
  ['reports', 'Signalées', 'flag', 'tad-kpi--reports'],
  ['validated', 'Validées', 'check', 'tad-kpi--validated'],
  ['blocked', 'Bloquées', 'x', 'tad-kpi--blocked'],
];

const pad = (n) => String(n).padStart(2, '0');
/** Date → valeur d'un champ datetime-local (heure de l'appareil). */
const toLocal = (d) => {
  if (!d) return '';
  const x = new Date(d);
  return `${x.getFullYear()}-${pad(x.getMonth() + 1)}-${pad(x.getDate())}T${pad(x.getHours())}:${pad(x.getMinutes())}`;
};
const fromLocal = (v) => (v ? new Date(v).toISOString() : '0001-01-01T00:00:00Z');
const when = (d) => `${dayLong(d)} à ${hourText(d)}`;
const btn = (cls, text, icon, on) => {
  const b = h(`button.btn${cls ? '.' + cls.split(' ').join('.') : ''}`, { type: 'button' }, icon ? ic(icon) : null, h('span', { text }));
  if (on) b.addEventListener('click', on);
  return b;
};

export function setupTcgAdmin({ root, onCount, onLeave }) {
  async function tapi(path, body) {
    const res = await fetch(`api/tcg/admin/${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { 'X-Hub-Admin': '1', ...(body !== undefined && { 'Content-Type': 'application/json' }) },
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: 'same-origin',
      cache: 'no-store',
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401) {
      onLeave?.();
      throw new Error('session terminée');
    }
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    return data;
  }

  let ov = null; // vue d'ensemble
  let filter = 'pending';
  let cards = [];
  let current = null;
  let mode = ''; // '' | block | edit | validate | people
  let shown = false;
  let printWave = 0;

  const launch = h('section.tad-launch');
  const mailing = h('section.tad-mailing', { hidden: true });
  const kpis = h('div.tad-kpis', { attrs: { role: 'tablist', 'aria-label': 'Filtrer' } });
  const list = h('ul.tad-list', { attrs: { 'aria-label': 'Propositions' } });
  const detail = h('section.tad-detail', { tabIndex: -1, attrs: { 'aria-label': 'Détail' } });
  const grid = h('div.tad-grid', {}, list, detail);
  root.replaceChildren(
    h(
      'div.tad-wrap',
      {},
      launch,
      h('div.tad-policy', {}, h('span.tad-policy-ic', {}, ic('check', 'ic')), h('p', {}, h('b', { text: 'Chaque carte attend ta validation avant d’aller au jury.' }), ' En validant, indique qui est sur la photo : la carte attend alors l’accord de chacun et passe au jury d’elle-même à la dernière réponse. On bloque seulement ce qui insulte, dénigre ou expose quelqu’un.')),
      mailing,
      kpis,
      grid,
      h('p.tad-keys', {}, h('kbd', { text: 'V' }), ' valider · ', h('kbd', { text: 'B' }), ' bloquer · ', h('kbd', { text: '↑' }), ' ', h('kbd', { text: '↓' }), ' naviguer'),
    ),
  );

  // ---------------------------------------------------------------- vue d'ensemble, lancement
  async function loadOverview() {
    ov = await tapi('overview');
    const c = ov.counts ?? {};
    onCount?.((c.pending ?? 0) + (c.reports ?? 0));
    return ov;
  }

  function renderLaunch() {
    const s = ov.season;
    const waves = ov.waves ?? [];
    const first = waves[0];
    const phase = ov.phase;
    const status =
      phase === 'live'
        ? h('span.tad-state.tad-state--validated', {}, ic('check'), `En jeu · ${plural(waves.filter((w) => w.printed).length, 'vague imprimée', 'vagues imprimées')}`)
        : phase === 'soon'
          ? h('span.tad-state.tad-state--soon', {}, ic('clock'), `Bientôt · sortie le ${when(waves.find((w) => !w.printed)?.releaseAt ?? first.releaseAt)}`)
          : h('span.tad-state.tad-state--off', {}, ic('eye'), s.enabled ? 'Visible, mais aucune vague programmée' : 'Masqué aux étudiants');

    // Étapes du lancement.
    const steps = [
      [Boolean(first), 'Programme la vague 1', 'Sa date de sortie est celle du compte à rebours de la page d’attente.'],
      [s.enabled, 'Rends le TCG visible', 'La bascule Hub / TCG apparaît alors pour tous (« bientôt » avant la sortie).'],
      [(ov.counts.accepted ?? 0) + (ov.counts.printed ?? 0) > 0, 'Valide les propositions', 'Seules les cartes validées passent au jury puis à l’impression.'],
      [phase === 'live', 'Sortie de la vague 1', 'À sa date, la vague s’imprime seule avec les cartes les plus attendues (ou « Imprimer maintenant »).'],
    ];
    const checklist = h('ol.tad-steps', {}, ...steps.map(([done, t, p]) => h(`li${done ? '.is-done' : ''}`, {}, h('span.tad-step-ic', {}, ic(done ? 'check' : 'clock')), h('div', {}, h('b', { text: t }), h('span', { text: p })))));

    // Réglages de la saison.
    const enabled = h('input', { type: 'checkbox', checked: s.enabled });
    const name = h('input.input', { value: s.name, maxLength: 30 });
    const perDay = h('input.input', { type: 'number', min: 1, max: 10, value: s.perDay });
    const pace = h('input.input', { type: 'number', min: 1, max: 90, value: s.paceDays });
    const auto = h('input', { type: 'checkbox', checked: s.autoWeekly });
    const runs = {};
    for (const r of ['rare', 'epique', 'legendaire', 'unique']) runs[r] = h('input.input', { type: 'number', min: 1, max: 1000, value: s.runs?.[r] ?? 1 });
    const field = (label, input, help) => h('label.field', {}, h('span.label', { text: label }), input, help ? h('span.tad-help', { text: help }) : null);
    const sw = (label, input, help) => h('label.menu-switch.tad-switch', {}, h('span', {}, h('b', { text: label }), help ? h('small', { text: help }) : null), input, h('span.switch', { attrs: { 'aria-hidden': 'true' } }));
    const save = btn('btn--primary btn--sm', 'Enregistrer les réglages', 'check', async () => {
      save.disabled = true;
      try {
        await tapi('season', {
          enabled: enabled.checked,
          name: name.value,
          perDay: Number(perDay.value),
          paceDays: Number(pace.value),
          autoWeekly: auto.checked,
          runs: { commune: 0, rare: Number(runs.rare.value), epique: Number(runs.epique.value), legendaire: Number(runs.legendaire.value), unique: Number(runs.unique.value) },
        });
        toast(enabled.checked ? 'Réglages enregistrés : le TCG est visible des étudiants.' : 'Réglages enregistrés : le TCG est masqué.', 'check');
        await refreshAll();
      } catch (e) {
        toast(e.message, 'alert');
      } finally {
        save.disabled = false;
      }
    });
    const season = h(
      'div.tad-season',
      {},
      sw('TCG visible des étudiants', enabled, 'Masqué, rien n’apparaît dans le Hub.'),
      sw('Une vague chaque semaine', auto, 'À chaque sortie, la vague suivante est programmée 7 jours plus tard.'),
      h('div.tad-fields', {}, field('Nom de la saison', name), field('Propositions par jour et par joueur', perDay), field('Jours pour distribuer les cartes rares', pace, 'Après sa sortie, les exemplaires numérotés d’une vague sont répartis sur cette durée.')),
      h('div.tad-fields.tad-fields--runs', {}, ...['rare', 'epique', 'legendaire', 'unique'].map((r) => field(`${RLABEL[r]} · exemplaires`, runs[r]))),
      h('div.tad-row', {}, save),
    );

    // Vagues.
    const wl = h('ul.tad-waves');
    for (const w of waves) {
      const now = Date.now();
      const juryOpen = w.juryFrom && now >= new Date(w.juryFrom) && now < new Date(w.juryUntil);
      const state = w.printed ? `Imprimée · ${plural(w.total, 'carte')} · ${w.discovered} découvertes` : juryOpen ? `Jury en cours · ${ov.juries?.[w.n] ?? 0} jurés` : 'Programmée';
      const acts = h('div.tad-wave-acts');
      if (!w.printed) {
        acts.append(btn('btn--sm', 'Dates', 'pen', () => waveForm(w)), btn('btn--sm', 'Aperçu de l’impression', 'eye', () => preview(w.n)));
        if (!waves.some((x) => x.n < w.n && !x.printed)) acts.append(btn('btn--ghost btn--sm tad-no', 'Supprimer', 'trash', () => removeWave(w.n)));
      }
      wl.append(
        h(
          `li.tad-wave${w.printed ? '.is-printed' : ''}`,
          {},
          h('div', {}, h('b', { text: `Vague ${w.n}` }), h('span', { text: ` · sortie le ${when(w.releaseAt)}` }), h('small', { text: state })),
          !w.printed && w.juryFrom ? h('p.tad-help', { text: `Jury du ${when(w.juryFrom)} au ${when(w.juryUntil)}${w.proposalsUntil ? ` · propositions jusqu’au ${when(w.proposalsUntil)}` : ''} · ${w.perDay ? `${w.perDay} propositions par jour` : `${s.perDay} propositions par jour (saison)`} · ${w.size} cartes au plus` }) : null,
          acts,
        ),
      );
    }
    const add = btn(first ? 'btn--sm' : 'btn--primary', first ? `Programmer la vague ${waves.length + 1}` : 'Créer la vague 1 (lancement)', 'plus', () => waveForm(null));
    const pv = h('div.tad-print', { hidden: true });

    const kpi = (label, value, sub) => h('div.tad-mini', {}, h('span', { text: label }), h('b', { text: value }), sub ? h('small', { text: sub }) : null);
    const used = ov.used / (1024 * 1024);
    const stats = h(
      'div.tad-minis',
      {},
      kpi('Joueurs', String(ov.players), `${ov.active} actifs cette semaine`),
      kpi('Boosters ouverts aujourd’hui', String(ov.today)),
      kpi('Photos', `${used < 10 ? used.toFixed(1) : Math.round(used)} Mo`, ov.storage === 'r2' ? 'Cloudflare R2' : 'dossier de données du serveur'),
    );

    launch.replaceChildren(
      h('header.tad-launch-head', {}, h('div', {}, h('h2.tad-h', { text: 'Lancement et vagues' }), h('p.tad-help', { text: 'Les dates sont à l’heure de cet appareil.' })), status),
      checklist,
      stats,
      h('details.tad-box', { open: !s.enabled || !first }, h('summary', {}, ic('pen'), 'Réglages de la saison'), season),
      h('div.tad-box', {}, h('h3.tad-sub', { text: 'Vagues' }), waves.length ? wl : h('p.tad-help', { text: 'Aucune vague : crée la vague 1 pour fixer la date de lancement affichée aux étudiants.' }), h('div.tad-row.tad-row--start', {}, add), pv),
    );
    if (printWave) preview(printWave);
  }

  /** Formulaire de dates d'une vague (nouvelle si w est null). */
  function waveForm(w) {
    const waves = ov.waves ?? [];
    const prev = [...waves].reverse().find((x) => !w || x.n < w.n);
    let rel;
    let juryFrom;
    let juryUntil;
    let props;
    if (w) [rel, juryFrom, juryUntil, props] = [w.releaseAt, w.juryFrom, w.juryUntil, w.proposalsUntil];
    else {
      // Par défaut : sortie un lundi à 6 h, jury du lundi précédent au dimanche 20 h.
      const base = prev ? new Date(prev.releaseAt) : new Date();
      const r = new Date(base);
      r.setDate(r.getDate() + (prev ? 7 : 14));
      r.setDate(r.getDate() + ((8 - r.getDay()) % 7));
      r.setHours(6, 0, 0, 0);
      const ju = new Date(r);
      ju.setDate(ju.getDate() - 1);
      ju.setHours(20, 0, 0, 0);
      const jf = new Date(r);
      jf.setDate(jf.getDate() - 7);
      const pu = new Date(jf);
      pu.setDate(pu.getDate() - 1);
      pu.setHours(20, 0, 0, 0);
      [rel, juryFrom, juryUntil, props] = [r, jf, ju, prev ? ju : pu];
    }
    const i = (v) => h('input.input', { type: 'datetime-local', value: toLocal(v) });
    const f = { props: i(props), jf: i(juryFrom), ju: i(juryUntil), rel: i(rel), size: h('input.input', { type: 'number', min: 3, max: 200, value: w?.size ?? 50 }), perDay: h('input.input', { type: 'number', min: 0, max: 20, value: w ? (w.perDay ?? 0) : (waves.length ? 0 : 10) }) };
    const field = (label, input, help) => h('label.field', {}, h('span.label', { text: label }), input, help ? h('span.tad-help', { text: help }) : null);
    const n = w?.n ?? waves.length + 1;
    const box = h('form.tad-edit.tad-waveform', { noValidate: true });
    const err = h('p.tad-help.tad-err', { hidden: true, attrs: { role: 'alert' } });
    box.append(
      h('h3.tad-sub', { text: w ? `Vague ${n} : dates` : n === 1 ? 'Vague 1 : le lancement' : `Vague ${n}` }),
      h(
        'div.tad-fields',
        {},
        field('Propositions jusqu’au', f.props, 'Affiché sur la page d’attente.'),
        field('Jury : début', f.jf, 'Chacun classe 5 cartes validées.'),
        field('Jury : fin', f.ju),
        field(n === 1 ? 'Lancement (sortie de la vague 1)' : 'Sortie de la vague', f.rel, n === 1 ? 'Compte à rebours de la page d’attente, premier booster.' : 'Impression automatique à cette heure.'),
        field('Cartes au plus', f.size),
        field('Propositions par jour pendant cette vague', f.perDay, `0 = réglage de la saison (${ov.season.perDay} par jour).${n === 1 ? ' Vague 1 : 10 par jour pour bien remplir le lancement.' : ''}`),
      ),
      err,
      h('div.tad-row', {}, btn('btn--ghost', 'Annuler', null, () => box.remove()), h('button.btn.btn--primary', { type: 'submit' }, ic('check'), h('span', { text: 'Enregistrer la vague' }))),
    );
    box.addEventListener('submit', async (e) => {
      e.preventDefault();
      err.hidden = true;
      try {
        await tapi('wave', { n: w?.n ?? 0, proposalsUntil: fromLocal(f.props.value), juryFrom: fromLocal(f.jf.value), juryUntil: fromLocal(f.ju.value), releaseAt: fromLocal(f.rel.value), size: Number(f.size.value), perDay: Number(f.perDay.value) || 0 });
        toast(`Vague ${n} enregistrée.`, 'check');
        await refreshAll();
      } catch (ex) {
        err.textContent = ex.message;
        err.hidden = false;
      }
    });
    $('.tad-waveform', launch)?.remove();
    $('.tad-box .tad-row--start', launch).before(box);
    box.querySelector('input').focus();
  }

  async function removeWave(n) {
    if (!confirm(`Supprimer la vague ${n} ? Les votes de son jury seront oubliés.`)) return;
    try {
      await tapi(`wave/${n}/delete`, {});
      toast(`Vague ${n} supprimée.`, 'check');
      await refreshAll();
    } catch (e) {
      toast(e.message, 'alert');
    }
  }

  /** Aperçu de l'impression : cartes validées classées par le jury, rareté prévue, retouches. */
  async function preview(n) {
    const box = $('.tad-print', launch);
    if (!box) return;
    printWave = n;
    box.hidden = false;
    box.replaceChildren(h('p.tad-help', { text: 'Chargement de l’aperçu…' }));
    let data;
    try {
      data = await tapi(`wave/${n}/preview`);
    } catch (e) {
      box.replaceChildren(h('p.tad-help', { text: e.message }));
      return;
    }
    const picked = data.cards.filter((c) => c.planned && c.planned !== 'out');
    const mix = RARITIES.slice()
      .reverse()
      .map((r) => [r, picked.filter((c) => c.planned === r).length])
      .filter(([, k]) => k);
    const rows = h('ol.tad-plan');
    data.cards.forEach((c, i) => {
      const sel = h('select.input.select.select--sm', { attrs: { 'aria-label': `Rareté de « ${c.title} »` } });
      sel.append(h('option', { value: '', text: c.override ? 'Automatique' : `Automatique (${c.planned ? RLABEL[c.planned] : 'non retenue'})` }));
      for (const r of RARITIES) sel.append(h('option', { value: r, text: RLABEL[r], selected: c.override && c.planned === r }));
      sel.append(h('option', { value: 'out', text: 'Écartée', selected: c.override && !c.planned }));
      sel.addEventListener('change', async () => {
        try {
          await tapi(`wave/${n}/rarity`, { card: c.id, rarity: sel.value });
          preview(n);
        } catch (e) {
          toast(e.message, 'alert');
        }
      });
      rows.append(
        h(
          `li${c.planned ? '' : '.is-out'}`,
          {},
          h('span.tad-rank', { text: String(i + 1) }),
          h('span.tad-thumb', {}, h('img', { alt: '', src: c.thumb })),
          h('span.tad-it', {}, h('b', { text: c.title }), h('span', { text: `${c.author.pseudo} · jury ${c.jury >= 0 ? '+' : ''}${c.jury.toFixed(2)} (${plural(c.juryN, 'classement')})` })),
          h('span', {}, c.planned ? rchip(c.planned) : h('span.tad-pill.tad-pill--blocked', { text: 'Non retenue' }), ' ', consentPill(c)),
          sel,
        ),
      );
    });
    const print = btn('btn--primary', `Imprimer la vague ${n} maintenant`, 'check', async () => {
      if (!confirm(`Imprimer la vague ${n} maintenant avec ${plural(picked.length, 'carte')} ? Les boosters s’ouvrent aussitôt ; c’est définitif.`)) return;
      try {
        await tapi(`wave/${n}/print`, {});
        printWave = 0;
        toast(`Vague ${n} imprimée : elle est en jeu.`, 'check');
        await refreshAll();
      } catch (e) {
        toast(e.message, 'alert');
      }
    });
    box.replaceChildren(
      h('h3.tad-sub', { text: `Aperçu de l’impression · vague ${n}` }),
      h('p.tad-help', { text: `Cartes validées, de la plus attendue par le jury à la moins attendue : les premières deviennent les plus rares. ${data.wave.size} cartes au plus. Sans impression manuelle, la vague s’imprime seule le ${when(data.wave.releaseAt)}.` }),
      picked.length ? h('p.tad-mix', {}, ...mix.map(([r, k]) => h('span', {}, rchip(r), ` × ${k}`))) : h('p.tad-help', { text: 'Aucune carte validée pour l’instant.' }),
      data.cards.length ? rows : null,
      h('div.tad-row', {}, btn('btn--ghost btn--sm', 'Fermer l’aperçu', null, () => ((printWave = 0), (box.hidden = true))), picked.length ? print : null),
    );
  }

  // ---------------------------------------------------------------- modération
  function renderKpis() {
    const c = ov.counts ?? {};
    const n = { pending: c.pending ?? 0, consent: c.consent ?? 0, reports: c.reports ?? 0, validated: (c.accepted ?? 0) + (c.printed ?? 0), blocked: c.blocked ?? 0 };
    kpis.replaceChildren(
      ...FILTERS.map(([k, label, icon, cls]) => {
        const b = h(`button.tad-kpi.${cls}${k === filter ? '.is-on' : ''}`, { type: 'button', attrs: { role: 'tab', 'aria-selected': String(k === filter) } }, h('span.tad-kpi-l', {}, ic(icon), label), h('b', { text: String(n[k]) }));
        b.addEventListener('click', () => {
          filter = k;
          current = null;
          mode = '';
          loadCards();
        });
        return b;
      }),
    );
  }

  async function loadCards(keep) {
    renderKpis();
    try {
      cards = (await tapi(`cards?filter=${filter}`)) ?? [];
      if (filter === 'reports') cards = cards.concat((await tapi('cards?filter=removed')) ?? []);
    } catch (e) {
      cards = [];
      toast(e.message, 'alert');
    }
    if (!keep || !cards.some((c) => c.id === current)) current = cards[0]?.id ?? null;
    renderList();
    renderDetail();
  }

  function renderList() {
    list.replaceChildren();
    if (!cards.length) {
      const empty = { pending: 'Rien à valider. Les nouvelles propositions arrivent ici.', consent: 'Aucune carte n’attend d’accord.', reports: 'Aucune carte signalée.', validated: 'Aucune carte validée pour l’instant.', blocked: 'Aucune carte bloquée.' }[filter];
      list.append(h('li.tad-empty', {}, ic('check', 'ic'), h('p', { text: empty })));
      return;
    }
    for (const c of cards) {
      let tag = null;
      if (filter === 'pending' && c.flags?.length) tag = h('span.tad-flag', {}, ic('alert', 'ic ic--xs'), 'À vérifier');
      else if (filter === 'reports') tag = c.status === 'removed' ? h('span.tad-pill.tad-pill--blocked', { text: 'Retirée' }) : h('span.tad-flag', {}, ic('flag', 'ic ic--xs'), plural(c.reportN, 'signalement'));
      else if (filter === 'validated') tag = h('span.tad-pill.tad-pill--ok', { text: c.status === 'printed' ? `V${c.wave}` : 'Validée' });
      else if (filter === 'blocked') tag = h('span.tad-pill.tad-pill--blocked', { text: 'Bloquée' });
      else if (filter === 'consent') tag = consentPill(c);
      const sub = filter === 'reports' && c.lastReport ? `${c.author.pseudo} · ${ago(c.lastReport)}` : `${c.author.pseudo} · ${ago(c.created)}`;
      const b = h(`button.tad-item${c.id === current ? '.is-on' : ''}`, { type: 'button', data: { tad: c.id } }, h('span.tad-thumb', {}, c.thumb ? h('img', { alt: '', src: c.thumb }) : null), h('span.tad-it', {}, h('b', { text: c.title }), h('span', {}, sub, ' ', filter === 'consent' ? null : consentPill(c))), tag);
      b.addEventListener('click', () => {
        current = c.id;
        mode = '';
        renderList();
        renderDetail();
        grid.classList.add('is-detail');
        detail.focus({ preventScroll: true });
      });
      list.append(h('li', {}, b));
    }
  }

  async function act(id, body, msg) {
    try {
      await tapi(`card/${id}`, body);
      toast(msg, 'check');
      const idx = cards.findIndex((c) => c.id === id);
      mode = '';
      await loadOverview();
      await loadCards(true);
      // Après une décision, on passe à la carte suivante de la file.
      if (!cards.some((c) => c.id === id) || filter !== 'pending') {
        current = cards[Math.min(idx, cards.length - 1)]?.id ?? null;
        renderList();
        renderDetail();
      }
      renderLaunch();
    } catch (e) {
      toast(e.message, 'alert');
    }
  }

  function renderDetail() {
    const c = cards.find((x) => x.id === current);
    if (!c) {
      detail.replaceChildren(h('div.tad-none', {}, ic('cards', 'ic'), h('p', { text: 'Choisis une carte dans la liste.' })));
      return;
    }
    const printed = c.status === 'printed' || c.status === 'removed';
    const view = { ...c, author: c.author.pseudo, img: c.img, thumb: c.thumb, removed: false, total: c.total };
    const card = printed ? cardEl(view, { size: 'lg' }) : cardEl(view, { size: 'lg', mystery: true });
    const dl = h('dl.tad-dl');
    const row = (dt, dd) => dl.append(h('dt', { text: dt }), h('dd', {}, dd));
    row('Auteur', h('span.tad-author', {}, h('span.tav.tav--sm', { text: c.author.pseudo.slice(0, 2).toUpperCase() }), c.author.pseudo, c.author.muted ? h('small', { text: ' · propositions suspendues' }) : null));
    row('Historique', `${plural(c.author.validated, 'validée')} · ${plural(c.author.blocked, 'bloquée')}`);
    row('Catégorie', CATS[c.cat] ?? c.cat);
    if (c.consent) row('Sur la photo', h('span', {}, consentPill(c), ' ', `${c.consent.ok} / ${plural(c.consent.total, 'personne')} d’accord`));
    if (printed) {
      row('Rareté', rchip(c.rarity));
      row('En jeu', `Vague ${c.wave} · n° ${String(c.no).padStart(3, '0')} · ${c.run ? `${c.issued} / ${c.run} tirés` : `${c.issued} tirées`}`);
    } else if (c.status === 'accepted') row('Jury', c.juryN ? `${c.jury >= 0 ? '+' : ''}${c.jury.toFixed(2)} · ${plural(c.juryN, 'classement')}` : 'pas encore classée');

    const info = h('div.tad-info', {}, h('p.tad-kick', { text: `P-${String(c.num).padStart(4, '0')} · envoyée ${ago(c.created)}${c.edited ? ' · texte corrigé' : ''}` }), h('h2.tad-h', { text: c.title }), h('p.tad-desc', { text: c.desc }), dl);
    if (c.flags?.length) info.append(h('div.tad-flags', {}, h('p', {}, ic('alert'), h('b', { text: 'Points à vérifier' }), h('small', { text: ' · repérés automatiquement, à toi de juger' })), h('ul', {}, ...c.flags.map((f) => h('li', { text: f })))));
    if (c.reportN || (c.status === 'removed' && c.reports)) {
      info.append(h('ul.tad-reports', {}, ...Object.entries(c.reports ?? {}).map(([k, n]) => h('li', {}, h('b', { text: `×${n}` }), REPORTS[k] ?? k))));
    }
    if (c.status === 'blocked') info.append(h('p.tad-state.tad-state--blocked', {}, ic('x'), `Bloquée · ${REASONS[c.reason]?.[0] ?? c.reason}${c.message ? ` : « ${c.message} »` : ''}`));
    if (c.status === 'accepted') info.append(h('p.tad-state.tad-state--validated', {}, ic('check'), 'Validée · elle passera au jury'));
    if (c.status === 'consent') info.append(h('p.tad-state.tad-state--soon', {}, ic('person'), c.consent?.no ? 'Validée · une personne a refusé : à toi de décider' : 'Validée · en attente de l’accord des personnes sur la photo'));
    if (c.consent?.people?.length) info.append(peopleList(c));

    const acts = h('div.tad-acts');
    const validate = () => ((mode = 'validate'), renderDetail());
    if (c.status === 'pending') acts.append(btn('btn--primary btn--lg tad-ok', 'Valider', 'check', validate), btn('btn--lg tad-no', 'Bloquer…', 'x', () => ((mode = 'block'), renderDetail())));
    if (c.status === 'consent')
      acts.append(
        btn('btn--primary', 'Valider sans attendre', 'check', () => {
          if (confirm('Valider sans attendre les réponses manquantes ? La carte passe au jury.')) act(c.id, { action: 'force' }, 'Carte validée : elle passera au jury.');
        }),
      );
    if (c.status === 'consent' || c.status === 'accepted' || c.status === 'printed') acts.append(btn('', 'Ajouter des personnes…', 'person', () => ((mode = 'people'), renderDetail())));
    if (c.status === 'accepted' || c.status === 'consent') acts.append(btn('tad-no', 'Bloquer…', 'x', () => ((mode = 'block'), renderDetail())));
    if (c.status === 'blocked' && !c.img) acts.append(h('p.tad-help', { text: 'Photo effacée (bloquée depuis plus de 7 jours).' }));
    if (c.status === 'removed' && !c.img) acts.append(h('p.tad-help', { text: 'Photo effacée (retirée depuis plus de 30 jours) : elle ne peut plus revenir en jeu.' }));
    else if (c.status === 'blocked') acts.append(btn('btn--primary', 'Débloquer et valider', 'check', validate));
    if (c.status === 'printed' && c.reportN) acts.append(btn('btn--primary', 'Garder la carte', 'check', () => act(c.id, { action: 'keep' }, 'Carte gardée : signalements classés.')));
    if (c.status === 'printed')
      acts.append(
        btn('tad-no', 'Retirer du jeu', 'x', () => {
          if (confirm(`Retirer « ${c.title} » du jeu ? Elle sort du tirage ; ceux qui l’ont gardent leur exemplaire, avec « Carte retirée » à la place de l’image.`)) act(c.id, { action: 'remove' }, 'Carte retirée du jeu.');
        }),
      );
    if (c.status === 'removed' && c.reason === 'personne') acts.append(h('p.tad-help', { text: 'Accord retiré par une personne sur la photo : les exemplaires restent, marqués « Accord retiré », et la carte ne peut pas revenir en jeu.' }));
    else if (c.status === 'removed') acts.append(btn('', 'Remettre en jeu', 'loop', () => act(c.id, { action: 'restore' }, 'Carte remise en jeu.')));
    if (c.status !== 'removed') acts.append(btn('btn--ghost', 'Corriger le texte', 'pen', () => ((mode = 'edit'), renderDetail())));
    if (c.author.id)
      acts.append(
        btn('btn--ghost btn--sm', c.author.muted ? 'Rétablir ses propositions' : 'Suspendre ses propositions', null, async () => {
          if (!c.author.muted && !confirm(`Suspendre les propositions de ${c.author.pseudo} ? Ses cartes déjà en jeu restent.`)) return;
          try {
            await tapi(`player/${c.author.id}/mute`, { on: !c.author.muted });
            toast(c.author.muted ? 'Propositions rétablies.' : 'Propositions suspendues.', 'check');
            await loadCards(true);
          } catch (e) {
            toast(e.message, 'alert');
          }
        }),
      );
    info.append(acts);
    if (c.status === 'printed' || c.status === 'removed') info.append(h('p.tad-help', { text: 'Retirer : la carte sort du tirage, son image est remplacée par « Carte retirée » chez celles et ceux qui l’ont. Ils gardent l’exemplaire. La photo n’est plus servie à personne ; elle est effacée du stockage après 30 jours (« Restaurer » possible jusque-là).' }));
    if (mode === 'block') info.append(blockForm(c));
    if (mode === 'validate' || mode === 'people') info.append(peopleForm(c, mode));
    if (mode === 'edit') info.append(editForm(c));

    const back = btn('btn--sm tad-back', 'Liste', 'back', () => grid.classList.remove('is-detail'));
    detail.replaceChildren(back, h('div.tad-body', {}, h('div.tad-preview', {}, card, h('p.tad-cap', { text: printed ? 'La carte telle qu’elle est en jeu' : 'Aperçu tel qu’il apparaîtra dans le jeu' })), info));
  }

  function blockForm(c) {
    const form = h('form.tad-block', { noValidate: true });
    const set = h('fieldset.tad-reasons', {}, h('legend.label', { text: 'Motif' }));
    const msg = h('textarea.input.textarea', { rows: 3, id: 'tad-msg', maxLength: 400 });
    let first = true;
    for (const [k, [label, text]] of Object.entries(REASONS)) {
      const input = h('input', { type: 'radio', name: 'tad-r', value: k, checked: first });
      if (first) msg.value = text;
      first = false;
      input.addEventListener('change', () => (msg.value = text));
      set.append(h('label.tad-reason', {}, input, h('span', { text: label })));
    }
    form.append(
      set,
      h('div.field', {}, h('label.label', { htmlFor: 'tad-msg', text: 'Message à l’auteur' }), msg, h('p.tad-help', { text: 'Visible dans « Mes propositions ». Reste bienveillant : la personne peut renvoyer une autre version.' })),
      h('div.tad-row', {}, btn('btn--ghost', 'Annuler', null, () => ((mode = ''), renderDetail())), h('button.btn.tad-no.tad-no--solid', { type: 'submit' }, ic('x'), h('span', { text: 'Confirmer le blocage' }))),
    );
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      act(c.id, { action: 'block', reason: form.querySelector('input[name="tad-r"]:checked').value, message: msg.value }, 'Carte bloquée : l’auteur voit ton message.');
    });
    requestAnimationFrame(() => form.querySelector('input').focus());
    return form;
  }

  // Personnes indiquées sur la photo : état de chacune, et « Retirer » (sans bloquer la carte).
  function peopleList(c) {
    const STATE = { ok: ['is-ok', 'check', 'd’accord'], no: ['is-no', 'x', 'a refusé'], waiting: ['is-wait', 'clock', 'prévenue, sans réponse'], toSend: ['is-send', 'send', 'mail à envoyer'] };
    return h(
      'ul.tad-people',
      {},
      ...c.consent.people.map((p) => {
        const [cls, icon, label] = STATE[p.state] ?? STATE.toSend;
        const rm =
          c.status === 'removed'
            ? null
            : btn('btn--ghost btn--sm', 'Retirer', null, () => {
                if (confirm(`Ne plus demander l’accord de ${p.hint} pour cette carte ? Elle n’est pas bloquée pour autant.`)) act(c.id, { action: 'untag', key: p.key }, 'Personne retirée de la carte.').then(loadMailing);
              });
        return h(`li.${cls}`, {}, ic(icon, 'ic ic--xs'), h('span.tad-people-h', { text: p.hint }), h('span.tad-people-s', { text: `${label}${p.by ? ` · ${p.by}` : ''}` }), rm);
      }),
    );
  }

  // Gens d'ISIS, toutes classes : listes de diffusion ISIS de l'annuaire et participants des cours
  // Moodle « ISIS-… ». Chargés une fois par visite, à la première liste ouverte.
  let isisTest = null;
  const isisLoad = () =>
    (isisTest ??= Promise.all([mailBridge(), moodleBridge(), import('./portals/classes.js')]).then(async ([mail, moodle, cls]) => {
      const data = await cls.loadClasses();
      const t = isisMatcher({ mail, moodle, codes: Object.keys(data?.classes ?? {}) });
      await t.ready;
      return t;
    }));
  let isisReady = null;
  const isIsis = (p) => {
    if (!isisReady) {
      isisLoad()
        .then((t) => (isisReady = t))
        .catch(() => (isisReady = Object.assign(() => false, { info: () => ({ lists: [], emails: 0, names: 0, courses: 0, ready: true, error: true }) })));
      isisReady = Object.assign(() => false, { info: () => ({ ready: false }) });
      isisReady.pending = true;
    }
    return isisReady(p);
  };
  // Ce qui a été reconnu (pour vérifier que les listes ISIS de l'annuaire sont bien trouvées).
  function isisNote() {
    const note = h('p.tad-help.tad-isis-note', { text: 'Gens d’ISIS : recherche dans l’annuaire et Moodle…' });
    const fill = () => {
      const i = isisReady?.info?.() ?? { ready: false };
      if (!i.ready) return setTimeout(fill, 600);
      if (i.error) return (note.textContent = 'Gens d’ISIS : annuaire ou Moodle indisponible (connecte-toi au Hub sur cet appareil).');
      const lists = i.lists.length ? `listes de l’annuaire : ${i.lists.map((l) => `« ${l.name} » (${l.count})`).join(', ')}` : 'aucune liste ISIS trouvée dans l’annuaire';
      note.textContent = `Gens d’ISIS reconnus : ${plural(i.emails, 'adresse')} (${lists}) · ${plural(i.names, 'nom')} de ${plural(i.courses, 'cours', 'cours')} Moodle d’ISIS.`;
    };
    isIsis(null);
    fill();
    return note;
  }

  // « Y a-t-il des personnes sur la photo ? » : personne → validée ; sinon elle attend leur accord.
  function peopleForm(c, kind) {
    const picker = peoplePicker({
      id: 'tad-people',
      initial: kind === 'validate' ? (c.proposed ?? []) : [],
      search: async (q) => (await mailBridge()).searchContacts(q, 12),
      recent: async () => (await mailBridge()).recentRecipients(),
      isIsis,
    });
    const form = h('form.tad-peopleform', { noValidate: true });
    const submit = (alone) => {
      const people = alone ? [] : picker.list();
      if (people === null) return;
      if (!alone && !people.length) return toast('Ajoute au moins une personne, ou choisis « Personne : valider ».', 'alert');
      const msg = kind === 'people' ? 'Personnes ajoutées : leur accord est demandé.' : people.length ? `Carte validée : elle attend l’accord de ${plural(people.length, 'personne')}.` : 'Carte validée : elle passera au jury.';
      act(c.id, { action: kind, people: people.join(',') }, msg).then(loadMailing);
    };
    const none = btn('btn--primary btn--lg tad-ok', 'Personne : valider', 'check', () => submit(true));
    const withPeople = h('button.btn.btn--lg', { type: 'submit' }, ic('person'), h('span', { text: kind === 'people' ? 'Ajouter et demander leur accord' : 'Valider et demander leur accord' }));
    form.append(
      h('p.label', { text: kind === 'people' ? 'Qui ajouter sur la photo ?' : 'Y a-t-il des personnes reconnaissables sur la photo ?' }),
      kind === 'validate' && c.proposed?.length ? h('p.tad-help', { text: `L’auteur a indiqué ${plural(c.proposed.length, 'personne')} : vérifie la liste, retire ou ajoute qui il faut.` }) : null,
      h('label.tad-help', { htmlFor: 'tad-people', text: 'Nom ou adresse de l’université : suggestions de l’annuaire, comme pour un mail. 5 personnes au plus.' }),
      picker.el,
      isisNote(),
      h('div.tad-row', {}, btn('btn--ghost', 'Annuler', null, () => ((mode = ''), renderDetail())), kind === 'validate' ? none : null, withPeople),
      h('p.tad-help', { text: 'Elles reçoivent un mail depuis ta messagerie (copie cachée, quand tu cliques sur « Envoyer les mails ») et répondent dans le TCG. La carte passe au jury dès que toutes ont accepté.' }),
    );
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      submit(false);
    });
    requestAnimationFrame(() => (kind === 'validate' ? none.focus() : picker.focus()));
    return form;
  }

  // ---------------------------------------------------------------- mails d'accord
  let mailState = null;
  async function loadMailing() {
    try {
      mailState = await tapi('mailing');
    } catch {
      mailState = null;
    }
    renderMailing();
  }

  function renderMailing() {
    const m = mailState;
    if (!m || (!m.targets.length && !m.waiting && !m.sent)) {
      mailing.replaceChildren();
      mailing.hidden = true;
      return;
    }
    mailing.hidden = false;
    const n = m.targets.length;
    // Rien ne part tout seul : le mail part quand tu cliques, depuis ta messagerie.
    const status = `${n ? `${plural(n, 'personne')} à prévenir.` : 'Personne à prévenir pour l’instant.'}${m.last ? ` Dernier envoi le ${when(m.last)}.` : ''}`;
    const send = btn('btn--primary', n ? `Envoyer les mails (${n})` : 'Envoyer les mails', 'send', () => sendNow(send));
    send.disabled = !n;
    mailing.replaceChildren(
      h('div.tad-mailing-h', {}, ic('send'), h('b', { text: 'Mails d’accord' }), h('span', { text: `${m.waiting} sans réponse · ${m.ok} d’accord · ${m.no} refus` })),
      h('p.tad-help', { text: status }),
      n ? h('details.tad-mailing-more', {}, h('summary', { text: 'Voir les adresses et le mail' }), h('ul', {}, ...m.targets.map((t) => h('li', { text: `${t.email} · ${plural(t.cards, 'carte')}` }))), h('p', {}, h('b', { text: MAIL_SUBJECT })), h('pre.tad-mailing-text', { text: mailText('') })) : null,
      h('div.tad-row', {}, send),
    );
  }

  async function sendNow(b) {
    if (!confirm(`Envoyer le mail d’accord depuis ta messagerie à ${plural(mailState.targets.length, 'personne')}, en copie cachée ?`)) return;
    b.disabled = true;
    const label = b.querySelector('span');
    try {
      const mail = await mailBridge();
      const me = await mail.me();
      if (!me.address) throw new Error('adresse de ta messagerie introuvable');
      const sent = await sendConsentMails({ m: mailState, me: me.address, name: me.name, send: (msg) => mail.send(msg), markSent: (keys) => tapi('mailing/sent', { keys, force: true }), onProgress: (k, total) => (label.textContent = `Envoi… ${k} / ${total}`) });
      toast(`Mail envoyé à ${plural(sent, 'personne')}, en copie cachée.`, 'check');
    } catch (err) {
      toast(`Envoi impossible : ${err.message}`, 'alert');
    }
    await loadMailing();
  }

  function editForm(c) {
    const form = h('form.tad-edit', { noValidate: true });
    const title = h('input.input', { value: c.title, maxLength: 28, id: 'tad-et' });
    const desc = h('textarea.input.textarea', { rows: 3, maxLength: 160, value: c.desc, id: 'tad-ed' });
    const cat = h('select.input.select', { id: 'tad-ec' }, ...Object.entries(CATS).map(([k, v]) => h('option', { value: k, text: v, selected: k === c.cat })));
    form.append(
      h('div.field', {}, h('label.label', { htmlFor: 'tad-et', text: 'Titre (28 caractères)' }), title),
      h('div.field', {}, h('label.label', { htmlFor: 'tad-ed', text: 'Description (160 caractères)' }), desc),
      h('div.field', {}, h('label.label', { htmlFor: 'tad-ec', text: 'Catégorie' }), cat),
      h('div.tad-row', {}, btn('btn--ghost', 'Annuler', null, () => ((mode = ''), renderDetail())), h('button.btn.btn--primary', { type: 'submit' }, ic('check'), h('span', { text: 'Enregistrer le texte' }))),
    );
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      act(c.id, { action: 'edit', title: title.value, desc: desc.value, cat: cat.value }, 'Texte corrigé.');
    });
    requestAnimationFrame(() => title.focus());
    return form;
  }

  // Raccourcis : V valider, B bloquer, ↑ ↓ naviguer (onglet TCG affiché, hors saisie).
  document.addEventListener('keydown', (e) => {
    if (root.closest('[hidden]') || isTyping(e.target) || e.metaKey || e.ctrlKey || e.altKey || mode) return;
    const c = cards.find((x) => x.id === current);
    if (!c) return;
    const i = cards.indexOf(c);
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      const next = cards[i + (e.key === 'ArrowDown' ? 1 : -1)];
      if (!next) return;
      e.preventDefault();
      current = next.id;
      renderList();
      renderDetail();
      list.querySelector('.is-on')?.scrollIntoView({ block: 'nearest' });
    } else if ((e.key === 'v' || e.key === 'V') && (c.status === 'pending' || c.status === 'blocked')) {
      e.preventDefault();
      mode = 'validate';
      renderDetail();
    } else if ((e.key === 'b' || e.key === 'B') && (c.status === 'pending' || c.status === 'accepted' || c.status === 'consent')) {
      e.preventDefault();
      mode = 'block';
      renderDetail();
    }
  });

  async function refreshAll() {
    await loadOverview();
    renderLaunch();
    await loadCards(true);
    await loadMailing();
  }

  return {
    /** Nombre à traiter (onglet), sans tout charger. */
    counts: () => loadOverview().catch(() => {}),
    async show() {
      if (shown) return;
      shown = true;
      try {
        await refreshAll();
      } catch (e) {
        shown = false;
        toast(`TCG indisponible : ${e.message}`, 'alert');
      }
    },
  };
}

/** Accords des personnes sur la photo : « 2/2 », « 1/2 », « Refus » (rien si personne n'est indiqué). */
function consentPill(c) {
  const k = c.consent;
  if (!k?.total) return null;
  const cls = k.no ? 'is-no' : k.ok === k.total ? 'is-ok' : 'is-wait';
  const text = k.no ? 'Refus' : `${k.ok}/${k.total} d’accord`;
  return h(`span.tad-consent.${cls}`, { attrs: { title: 'Accord des personnes indiquées sur la photo' } }, ic('person', 'ic ic--xs'), text);
}
