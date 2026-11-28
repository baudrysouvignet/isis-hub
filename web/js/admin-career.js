// Administration · Carrière : la rubrique Stages et le simulateur de salaire.
// Pour chacun : le fichier déposé (remplacer, télécharger, supprimer), l'ouverture aux étudiants,
// l'aperçu sur cet appareil, puis l'éditeur des lignes importées (fiches incomplètes, réponses à
// vérifier, conseils à relire). Le serveur revérifie tout le fichier à chaque publication.
//
// Rien sur qui consulte : la fréquentation est dans la Vue d'ensemble, anonyme comme celle du Hub.

import { h, icon, toast } from './core/dom.js';
import { prefs } from './core/store.js';
import { adminApi as stagesApi, StagesError } from './stages/api.js';
import { adminApi as salApi, SalairesError } from './salaires/api.js';
import { createEditor } from './admin-editor.js';

const dayFmt = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Paris' });
const dateFmt = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Paris' });
const nf = new Intl.NumberFormat('fr-FR');
const plural = (n, one, many = `${one}s`) => `${nf.format(n)} ${n > 1 ? many : one}`;
const XP = ['0-1 an', '2-3 ans', '4-5 ans', '6-9 ans', '10+ ans'];

function sw(label, on, onChange) {
  const input = h('input', { type: 'checkbox', checked: on, attrs: { role: 'switch' }, on: { change: () => onChange(input.checked, input) } });
  return h('label.adm-switch', {}, h('span', { text: label }), input, h('span.switch', { attrs: { 'aria-hidden': 'true' } }));
}

function download(name, data) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
  const a = h('a', { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/**
 * Carte du fichier déposé.
 * @param {{ title, kicker, facts, on, onToggle, toggleLabel, preview, onFile, onDownload, onDelete, note, accept }} o
 */
function sourceCard(o) {
  const file = h('input', { type: 'file', accept: 'application/json,.json', hidden: true });
  file.addEventListener('change', async () => {
    const f = file.files?.[0];
    file.value = '';
    if (!f) return;
    if (f.size > o.maxBytes) return toast(`Fichier trop lourd (${Math.round(o.maxBytes / 1048576)} Mo au plus).`, 'alert');
    let text;
    try {
      text = await f.text();
      JSON.parse(text);
    } catch {
      return toast('Ce fichier n’est pas un JSON lisible.', 'alert');
    }
    o.onFile(text, f.name);
  });
  const previewing = prefs.get(o.previewKey) === true;
  return h(
    'section.adm-card.adm-src',
    {},
    h('div.adm-src-h', {}, h('span.adm-src-ic', {}, icon('doc', 'ic ic--sm')), h('div.adm-mod-t', {}, h('b', { text: o.title }), h('span', { text: o.facts })), o.hasData ? sw(o.toggleLabel, o.on, o.onToggle) : null),
    o.note ? h('p.adm-hint', { text: o.note }) : null,
    h(
      'div.adm-actions',
      {},
      h('button.btn.btn--sm', { type: 'button', on: { click: () => file.click() } }, icon('upload', 'ic ic--sm'), o.hasData ? 'Remplacer le fichier' : 'Déposer le fichier JSON'),
      file,
      o.hasData
        ? h(
            'button.btn.btn--ghost.btn--sm',
            {
              type: 'button',
              on: {
                click: () => {
                  if (prefs.get(o.previewKey) === true) {
                    prefs.set(o.previewKey, null);
                    toast('Aperçu arrêté sur cet appareil.', 'check');
                    return o.rerender();
                  }
                  prefs.set(o.previewKey, true);
                  window.open(o.previewUrl, '_blank', 'noopener');
                  o.rerender();
                },
              },
            },
            icon('eye', 'ic ic--sm'),
            o.on ? `Voir ${o.what}` : previewing ? 'Arrêter l’aperçu' : 'Aperçu sur cet appareil',
          )
        : null,
      o.hasData ? h('button.btn.btn--ghost.btn--sm', { type: 'button', on: { click: o.onDownload } }, icon('download', 'ic ic--sm'), 'Télécharger le JSON') : null,
      h('span.spacer'),
      o.hasData ? h('button.btn.btn--ghost.btn--sm.gr-danger', { type: 'button', on: { click: o.onDelete } }, icon('trash', 'ic ic--sm'), 'Supprimer les données') : null,
    ),
    !o.on && previewing && o.hasData ? h('p.adm-hint', { text: 'Aperçu actif : visible sur cet appareil seulement ; le serveur ne sert les données qu’aux identifiants de l’administration tant que c’est fermé.' }) : null,
  );
}

export function setupCareer({ root, onLeave, onCounts }) {
  const st = { tab: 'stages' };
  const tabs = h('div.adm-tabs2', { role: 'tablist', attrs: { 'aria-label': 'Carrière' } });
  const panel = h('div.adm-car', { role: 'tabpanel', id: 'car-p' });
  root.replaceChildren(tabs, panel);
  const views = {};
  const counts = { stages: 0, salaires: 0 };
  const report = () => onCounts?.(counts.stages + counts.salaires, counts);

  const handle = (err) => {
    if ((err instanceof StagesError || err instanceof SalairesError) && err.status === 403) return onLeave();
    toast(`Refusé : ${err.message}`, 'alert');
  };

  function paintTabs() {
    tabs.replaceChildren(
      ...[
        ['stages', 'Stages', 'briefcase'],
        ['salaires', 'Simulateur de salaire', 'chart'],
      ].map(([id, lab, ic]) =>
        h(
          'button.adm-tab2',
          {
            type: 'button',
            role: 'tab',
            id: `car-${id}`,
            attrs: { 'aria-selected': String(st.tab === id), 'aria-controls': 'car-p' },
            tabIndex: st.tab === id ? 0 : -1,
            on: {
              click: () => {
                st.tab = id;
                paint();
              },
            },
          },
          icon(ic, 'ic ic--sm'),
          lab,
        ),
      ),
    );
    panel.setAttribute('aria-labelledby', `car-${st.tab}`);
  }

  function paint() {
    paintTabs();
    views[st.tab] ??= st.tab === 'stages' ? stagesView() : salView();
    panel.replaceChildren(views[st.tab].el);
    views[st.tab].load();
  }

  // ---------------------------------------------------------------- Stages
  function stagesView() {
    const el = h('div.adm-car');
    let status = null;
    let data = null;
    let editor = null;
    const card = h('div');
    const edCard = h('section.adm-card', {}, h('h2.adm-h2', {}, icon('briefcase', 'ic ic--sm'), 'Fiches de stage'), h('p.adm-hint', { text: 'Complète ce qui manque, fiche par fiche, puis publie : le fichier entier est revérifié par le serveur.' }), h('div'));
    el.append(card, edCard);

    const P = () => new Map(data.places.map((p) => [p.id, p]));
    const C = () => new Map(data.companies.map((c) => [c.id, c]));
    const T = () => new Map(data.contacts.map((c) => [c.id, c]));
    const unknown = (p) => !p || p.zone === 'inconnu' || p.id.startsWith('none:');

    function rowsOf() {
      const places = P();
      const cos = C();
      return data.stages.map((s) => {
        const c = cos.get(s.e) || {};
        return { ...s, _co: c.n || '', _p: c.p || '', _city: places.get(c.p)?.n || '' };
      });
    }

    function issues(r) {
      const out = [];
      if (unknown(P().get(r._p))) out.push({ key: '_p', text: 'Ville manquante' });
      if (!(r.mi || '').trim()) out.push({ key: 'mi', text: 'Missions manquantes' });
      if (!r.db) out.push({ key: 'db', text: 'Date de début manquante' });
      if (!r.df) out.push({ key: 'df', text: 'Date de fin manquante' });
      if (!r.tu) out.push({ key: 'tu', text: 'Maître de stage manquant' });
      return out;
    }

    function fields(r) {
      const cos = C();
      const contacts = T();
      const co = cos.get(r.e);
      const known = new Set();
      for (const s of data.stages) if (s.e === r.e) for (const id of [s.tu, s.rh]) if (id) known.add(id);
      const people = [['', 'Aucun'], ...[...known].map((id) => [id, `${contacts.get(id)?.n || id}${contacts.get(id)?.role ? ` · ${contacts.get(id).role}` : ''}`])];
      const places = [...data.places].filter((p) => !unknown(p) || p.id === r._p).sort((a, b) => a.n.localeCompare(b.n, 'fr'));
      const yr = new Date().getFullYear();
      return [
        { key: '_p', label: 'Ville de la structure', type: 'select', options: places.map((p) => [p.id, `${p.n}${p.dep ? ` (${p.dep})` : p.pays ? ` · ${p.pays}` : ''}`]), wide: true, hint: `S’applique aux ${plural(co?.k?.length || 1, 'stage')} de ${co?.n || 'cette structure'}. Ville absente de la liste : à ajouter dans le fichier JSON (avec ses coordonnées).` },
        { key: 'f', label: 'Niveau', type: 'select', num: true, options: [1, 2, 3, 4, 5].map((n) => [n, `FIE ${n}`]) },
        { key: 'au', label: 'Année universitaire', type: 'select', num: true, options: Array.from({ length: 12 }, (_, i) => yr + 1 - i).map((y) => [y, `${y}-${String(y + 1).slice(2)}`]) },
        { key: 'db', label: 'Début', type: 'date' },
        { key: 'df', label: 'Fin', type: 'date' },
        { key: 'mi', label: 'Missions', type: 'textarea', wide: true, rows: 4, max: 4000 },
        { key: 'th', label: 'Thème', max: 200, wide: true },
        { key: 'et', label: 'Étudiant (prénom et nom)', max: 120 },
        { key: 'g', label: 'Gratification', type: 'check', check: 'Stage gratifié' },
        { key: 'tu', label: 'Maître de stage', type: 'select', options: people, hint: 'Parmi les contacts de la structure. Un nouveau contact s’ajoute dans le fichier JSON.' },
        { key: 'rh', label: 'Contact RH', type: 'select', options: people },
      ];
    }

    /** Rend le fichier avec les lignes retouchées (structures et compteurs suivent). */
    function merge(rows) {
      const d = structuredClone(data);
      const byId = new Map(rows.map((r) => [r.id, r]));
      const cos = new Map(d.companies.map((c) => [c.id, c]));
      const before = new Map(data.companies.map((c) => [c.id, c.p])); // ville changée sur une seule fiche : elle vaut pour la structure
      d.stages = d.stages.map((s) => {
        const r = byId.get(s.id);
        if (!r) return s;
        const out = {};
        for (const [k, v] of Object.entries(r)) if (!k.startsWith('_') && v !== '' && v !== null && v !== undefined && v !== 0 && v !== false) out[k] = v;
        out.id = s.id;
        out.e = s.e;
        out.et = (r.et || '').trim() || s.et;
        if (out.db) {
          out.d = out.db.slice(0, 7);
          if (out.df && out.df >= out.db) out.wk = Math.max(1, Math.round((new Date(out.df) - new Date(out.db)) / 6048e5));
        }
        if (r._p && cos.get(s.e) && r._p !== before.get(s.e)) cos.get(s.e).p = r._p;
        return out;
      });
      for (const c of d.companies) c.paid = d.stages.filter((s) => s.e === c.id && s.g === 1).length;
      return d;
    }

    function renderCard() {
      const s = status;
      const facts = s.hasData
        ? `${plural(s.stages, 'stage')} · ${plural(s.companies, 'structure')} · ${plural(s.contacts, 'contact')} (${plural(s.mails, 'avec e-mail', 'avec e-mail')})${s.uploaded ? ` · déposé le ${dateFmt.format(new Date(s.uploaded))}` : ''}`
        : 'Aucun fichier : dépose le JSON des stages (format « isis-hub-stages », version 1).';
      card.replaceChildren(
        sourceCard({
          title: s.hasData ? s.source || 'Stages des étudiants' : 'Rubrique Stages',
          facts,
          hasData: s.hasData,
          on: s.enabled,
          what: 'la rubrique',
          toggleLabel: 'Ouverte à tous',
          previewKey: 'stages-apercu',
          previewUrl: './#stages',
          maxBytes: 12 * 1048576,
          rerender: renderCard,
          note: s.hasData ? `Fichier construit le ${s.built ? dayFmt.format(new Date(`${s.built}T12:00:00`)) : '—'}${s.meta?.merged ? `, ${s.meta.merged} doublons déjà réunis` : ''}. Les contacts (e-mails compris) sont lisibles par tout compte connecté une fois la rubrique ouverte.` : '',
          async onToggle(on, input) {
            if (on && !confirm('Ouvrir la rubrique Stages à tout le monde ? L’onglet apparaît au prochain chargement du Hub ; les contacts (e-mails compris) deviennent lisibles par tout compte connecté.')) return (input.checked = false);
            try {
              status = await stagesApi.enabled(on);
              toast(on ? 'Rubrique Stages ouverte.' : 'Rubrique Stages fermée.', 'check');
            } catch (err) {
              handle(err);
            }
            renderCard();
          },
          async onFile(text, name) {
            const d = JSON.parse(text);
            if (d?.format !== 'isis-hub-stages') return toast('Ce n’est pas un fichier « isis-hub-stages ».', 'alert');
            if (status.hasData && !confirm(`Remplacer les données en ligne par « ${name} » (${(d.stages ?? []).length} stages, ${(d.companies ?? []).length} structures) ? Les retouches non publiées sont perdues.`)) return;
            try {
              status = await stagesApi.upload(text);
              toast(`Fichier déposé : ${plural(status.stages, 'stage')}, ${plural(status.companies, 'structure')}.`, 'check');
              data = null;
              load();
            } catch (err) {
              handle(err);
            }
          },
          async onDownload() {
            try {
              download(`stages-isis-hub-${new Date().toISOString().slice(0, 10)}.json`, await stagesApi.data());
            } catch (err) {
              handle(err);
            }
          },
          async onDelete() {
            if (!confirm('Supprimer les données des stages du serveur ? La rubrique est fermée et le fichier effacé, sans retour possible. Il faudra redéposer un fichier pour la rouvrir.')) return;
            try {
              status = await stagesApi.remove();
              data = null;
              toast('Données des stages supprimées.', 'check');
            } catch (err) {
              handle(err);
            }
            load();
          },
        }),
      );
    }

    async function load() {
      try {
        status = await stagesApi.status();
        renderCard();
        if (!status.hasData) {
          edCard.hidden = true;
          counts.stages = 0;
          return report();
        }
        edCard.hidden = false;
        data ??= await stagesApi.data();
      } catch (err) {
        return handle(err);
      }
      const rows = rowsOf();
      if (editor) editor.replace(rows);
      else
        editor = createEditor(edCard.lastChild, {
          name: 'les stages',
          unit: 'stages',
          placeholder: 'Structure, ville, missions, étudiant…',
          rows,
          id: (r) => r.id,
          title: (r) => r._co,
          kicker: (r) => `Stage ${r.au ? `${r.au}-${String(r.au + 1).slice(2)}` : ''} · FIE ${r.f ?? '?'}`,
          sub: (r) => [P().get(r._p) && !unknown(P().get(r._p)) ? P().get(r._p).n : 'Ville ?', `FIE ${r.f ?? '?'}`, r.et].filter(Boolean).join(' · '),
          search: (r) => `${r._co} ${P().get(r._p)?.n ?? ''} ${r.mi ?? ''} ${r.et ?? ''} ${r.th ?? ''}`,
          issues,
          fields,
          note: () => 'Le nom de la structure se corrige dans le fichier JSON (il est partagé par tous ses stages).',
          check: (d) => (d.db && d.df && d.df < d.db ? 'La fin est avant le début.' : !(d.et || '').trim() ? 'Le nom de l’étudiant ne peut pas être vide.' : null),
          async onPublish(all) {
            const next = merge(all);
            status = await stagesApi.upload(JSON.stringify(next));
            data = next;
            renderCard();
            setTimeout(() => editor.replace(rowsOf())); // les autres fiches d'une structure suivent sa ville
          },
          onChange() {
            counts.stages = editor?.incomplete() ?? rows.filter((r) => issues(r).length).length;
            report();
          },
        });
      counts.stages = editor.incomplete();
      report();
    }
    return { el, load };
  }

  // ---------------------------------------------------------------- Simulateur de salaire
  function salView() {
    const el = h('div.adm-car');
    let status = null;
    let data = null;
    let rowsEd = null;
    let tipsEd = null;
    let lastReport = null;
    const card = h('div');
    const rowsCard = h('section.adm-card', {}, h('h2.adm-h2', {}, icon('chart', 'ic ic--sm'), 'Réponses du sondage'), h('p.adm-hint', { text: 'Chaque réponse, réduite à ses tranches. Corrige une réponse imprécise ou fausse, ou supprime-la ; personne d’autre ne voit ces lignes, les étudiants ne reçoivent que des groupes.' }), h('div'));
    const tipsCard = h('section.adm-card', {}, h('h2.adm-h2', {}, icon('chat', 'ic ic--sm'), 'Conseils des alumni'), h('p.adm-hint', { text: 'Un conseil ne s’affiche qu’une fois relu et publié. Retire tout ce qui pourrait désigner quelqu’un (nom d’entreprise, ville, détail personnel).' }), h('div'));
    el.append(card, rowsCard, tipsCard);

    const label = (k, v) => (k === 'xp' ? XP[v] : data?.dims?.[k]?.[v]) ?? '?';
    const vague = (k, v) => /^(Autre poste|Autres régions)/.test(label(k, v));
    const rowIssues = (r) => {
      const out = [];
      if (vague('poste', r.poste)) out.push({ key: 'poste', text: 'Poste imprécis (« Autre »)' });
      if (vague('region', r.region)) out.push({ key: 'region', text: 'Lieu imprécis' });
      if (r.total < r.base) out.push({ key: 'total', text: 'Total inférieur au fixe' });
      return out;
    };
    const tipIssues = (t) => (t.on ? [] : [{ key: 'on', text: 'À relire' }]);
    const opts = (k) => (data.dims[k] || []).map((n, v) => [v, n]);

    function renderCard() {
      const s = status;
      const rep = lastReport;
      const facts = s.hasData
        ? `${plural(s.rows, 'réponse')}${s.promos?.[0] ? ` · promos ${s.promos[0]} à ${s.promos[1]}` : ''} · ${s.tipsOn}/${plural(s.tips, 'conseil')} publiés${s.uploaded ? ` · déposé le ${dateFmt.format(new Date(s.uploaded))}` : ''}`
        : 'Aucun fichier : dépose l’export du sondage (sondage_isis_alumni_complet.json) ou un fichier « isis-hub-salaires ».';
      card.replaceChildren(
        ...[
        sourceCard({
          title: s.hasData ? s.source : 'Simulateur de salaire',
          facts,
          hasData: s.hasData,
          on: s.enabled,
          what: 'le simulateur',
          toggleLabel: 'Visible des étudiants',
          previewKey: 'salaires-apercu',
          previewUrl: './#salaires',
          maxBytes: 4 * 1048576,
          rerender: renderCard,
          note: `Discrétion appliquée par le serveur : les réponses ne quittent jamais le serveur ; rien ne s’affiche ni ne se filtre sous ${s.min ?? 5} réponses, les quartiles à partir de ${s.spread ?? 10}. Année de diplôme, années d’expérience exactes, anecdotes et boîte à idées ne sont jamais gardées ; les catégories rares sont fusionnées.${s.mdae ? ` Précision du modèle : ±${Math.round(s.mdae * 100)} % une fois sur deux.` : ''}`,
          async onToggle(on, input) {
            if (on && !confirm('Ouvrir le simulateur à tout le monde ? Le bouton apparaît dans la barre des raccourcis au prochain chargement du Hub.')) return (input.checked = false);
            try {
              status = await salApi.enabled(on);
              toast(on ? 'Simulateur ouvert : visible dans la barre des raccourcis.' : 'Simulateur masqué.', 'check');
            } catch (err) {
              handle(err);
            }
            renderCard();
          },
          async onFile(text, name) {
            if (status.hasData && !confirm(`Remplacer les réponses en ligne par « ${name} » ? Les retouches et les conseils relus seront remplacés par ceux du fichier.`)) return;
            try {
              const res = await salApi.upload(text);
              status = res.status;
              lastReport = res.report;
              data = null;
              toast(res.report ? `${name} : ${plural(res.report.rows, 'réponse')} lues${res.report.skipped ? `, ${res.report.skipped} ignorées` : ''}. Relis les conseils avant de les publier.` : 'Fichier déposé.', 'check');
              load();
            } catch (err) {
              handle(err);
            }
          },
          async onDownload() {
            try {
              download(`salaires-isis-hub-${new Date().toISOString().slice(0, 10)}.json`, await salApi.data());
            } catch (err) {
              handle(err);
            }
          },
          async onDelete() {
            if (!confirm('Supprimer les réponses du sondage du serveur ? Le simulateur est fermé et le fichier effacé, sans retour possible.')) return;
            try {
              status = await salApi.remove();
              data = null;
              lastReport = null;
              toast('Réponses du sondage supprimées.', 'check');
            } catch (err) {
              handle(err);
            }
            load();
          },
        }),
        rep?.merged
          ? h(
              'p.adm-foot',
              {},
              icon('check', 'ic ic--sm'),
              `Import : ${Object.entries(rep.merged)
                .map(([k, list]) => `${{ poste: 'postes', secteur: 'secteurs', structure: 'structures', region: 'lieux', sexe: 'sexe' }[k] ?? k} fusionnés (moins de ${status.min} réponses) : ${list.join(', ')}`)
                .join(' · ')}. Jamais gardé : ${rep.dropped.join(', ')}.`,
            )
          : null,
        ].filter(Boolean),
      );
    }

    async function publish() {
      status = (await salApi.save(data)).status;
      renderCard();
    }

    async function load() {
      try {
        status = await salApi.status();
        renderCard();
        if (!status.hasData) {
          rowsCard.hidden = tipsCard.hidden = true;
          counts.salaires = 0;
          return report();
        }
        rowsCard.hidden = tipsCard.hidden = false;
        data ??= await salApi.data();
      } catch (err) {
        return handle(err);
      }
      const rowFields = () => [
        { key: 'poste', label: 'Poste', type: 'select', num: true, options: opts('poste') },
        { key: 'xp', label: 'Expérience', type: 'select', num: true, options: XP.map((n, v) => [v, n]) },
        { key: 'region', label: 'Lieu de travail', type: 'select', num: true, options: opts('region') },
        { key: 'secteur', label: 'Secteur', type: 'select', num: true, options: opts('secteur') },
        { key: 'structure', label: 'Type de structure', type: 'select', num: true, options: opts('structure') },
        { key: 'sexe', label: 'Sexe', type: 'select', num: true, options: opts('sexe') },
        { key: 'base', label: 'Fixe brut annuel (€)', type: 'number', min: 10000, maxv: 500000, step: 500 },
        { key: 'total', label: 'Total avec primes (€)', type: 'number', min: 10000, maxv: 500000, step: 500 },
        { key: 'adv', label: 'Avantages', type: 'checks', wide: true, options: data.adv.map((a, i) => [i, a]) },
      ];
      const rowOpts = {
        name: 'les réponses',
        unit: 'réponses',
        placeholder: 'Poste, secteur, lieu…',
        issueLabel: 'À vérifier',
        okLabel: 'Vérifiée',
        canDelete: true,
        rows: data.rows,
        id: (r) => r.id,
        title: (r) => `${label('poste', r.poste)} · ${nf.format(r.base)} €`,
        kicker: (r) => `Réponse ${r.id.slice(1)}`,
        sub: (r) => `${label('xp', r.xp)} · ${label('region', r.region)} · ${label('secteur', r.secteur)}`,
        search: (r) => `${label('poste', r.poste)} ${label('region', r.region)} ${label('secteur', r.secteur)} ${label('structure', r.structure)}`,
        issues: rowIssues,
        fields: rowFields,
        check: (d) => (!(d.base >= 10000 && d.base <= 500000) || !(d.total >= 10000 && d.total <= 500000) ? 'Salaires attendus entre 10 000 et 500 000 €.' : null),
        async onPublish(all) {
          const prev = data.rows;
          data.rows = all;
          try {
            await publish();
          } catch (err) {
            data.rows = prev;
            throw err;
          }
        },
        onChange: () => tally(),
      };
      const tipOpts = {
        name: 'les conseils',
        unit: 'conseils',
        placeholder: 'Mot du conseil…',
        issueLabel: 'À relire',
        okLabel: 'Publié',
        canDelete: true,
        rows: data.tips,
        id: (t) => t.id,
        title: (t) => (t.t.length > 90 ? `${t.t.slice(0, 88)}…` : t.t),
        kicker: (t) => `Conseil ${t.id.slice(1)}`,
        sub: (t) => (t.on ? 'Montré aux étudiants' : 'Pas encore montré'),
        search: (t) => t.t,
        issues: tipIssues,
        fields: [
          { key: 't', label: 'Texte du conseil', type: 'textarea', wide: true, rows: 6, max: 1500, hint: 'Anonyme : ni poste, ni secteur, ni expérience ne sont affichés avec.' },
          { key: 'on', label: 'Publication', type: 'check', bool: true, check: 'Relu : montrer aux étudiants' },
        ],
        check: (d) => (!(d.t || '').trim() ? 'Le conseil est vide.' : null),
        async onPublish(all) {
          const prev = data.tips;
          data.tips = all.map((t) => ({ ...t, t: t.t.trim() }));
          try {
            await publish();
          } catch (err) {
            data.tips = prev;
            throw err;
          }
        },
        onChange: () => tally(),
      };
      if (rowsEd) {
        rowsEd.replace(data.rows);
        tipsEd.replace(data.tips);
      } else {
        rowsEd = createEditor(rowsCard.lastChild, rowOpts);
        tipsEd = createEditor(tipsCard.lastChild, tipOpts);
      }
      tally();
    }
    // À traiter : les vraies erreurs (total sous le fixe) et les conseils à relire. Un poste
    // « Autre » reste signalé dans l'éditeur, mais la réponse ne dit rien de plus à corriger.
    function tally() {
      counts.salaires = (rowsEd?.rows() ?? []).filter((r) => r.total < r.base).length + (tipsEd?.incomplete() ?? 0);
      report();
    }
    return { el, load };
  }

  return {
    show: paint,
    /** Compteurs « à traiter » sans ouvrir la rubrique (vue d'ensemble, pastille). */
    async counts() {
      try {
        const [a, b] = await Promise.all([stagesApi.status(), salApi.status()]);
        if (a.hasData && !views.stages) {
          const d = await stagesApi.data();
          const places = new Map(d.places.map((p) => [p.id, p]));
          const cos = new Map(d.companies.map((c) => [c.id, c]));
          counts.stages = d.stages.filter((s) => {
            const p = places.get(cos.get(s.e)?.p);
            return !p || p.zone === 'inconnu' || p.id.startsWith('none:') || !(s.mi || '').trim() || !s.db || !s.df || !s.tu;
          }).length;
        }
        if (b.hasData && !views.salaires) counts.salaires = b.errors + (b.tips - b.tipsOn);
        report();
        return { stages: a, salaires: b };
      } catch (err) {
        handle(err);
        return null;
      }
    },
  };
}
