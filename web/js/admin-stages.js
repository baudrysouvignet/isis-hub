// Administration · rubrique Stages : dépôt du fichier JSON (format isis-hub-stages, voir README),
// aperçu sur cet appareil, ouverture à tout le monde, suppression. Rien sur qui consulte : la
// fréquentation de la rubrique est dans l'onglet Fréquentation, anonyme comme celle du Hub.

import { $, h, toast } from './core/dom.js';
import { prefs } from './core/store.js';
import { adminApi, StagesError } from './stages/api.js';

const dateFmt = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Paris' });
const dayFmt = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Paris' });
const plural = (n, one, many = `${one}s`) => `${n.toLocaleString('fr-FR')} ${n > 1 ? many : one}`;

export function setupStagesAdmin({ root, onLeave }) {
  const file = h('input', { type: 'file', accept: 'application/json,.json', hidden: true });
  let status = null;
  let busy = false;
  const previewing = () => prefs.get('stages-apercu') === true;

  const handle = (err) => {
    if (err instanceof StagesError && err.status === 403) return onLeave();
    toast(`Refusé : ${err.message}`);
  };

  async function load() {
    try {
      status = await adminApi.status();
    } catch (err) {
      return handle(err);
    }
    render();
  }

  function render() {
    const s = status;
    const state = h(`span.adm-amb-state${s.enabled ? '.is-on' : ''}`, { text: s.enabled ? 'Ouverte à tout le monde' : s.hasData ? 'Fermée (données déposées)' : 'Fermée, aucune donnée' });
    const facts = s.hasData
      ? `${plural(s.companies, 'structure')}, ${plural(s.stages, 'stage')}, ${plural(s.contacts, 'contact')} (${plural(s.mails, 'avec e-mail', 'avec e-mail')}), ${plural(s.places, 'lieu', 'lieux')}. Fichier construit le ${s.built ? dayFmt.format(new Date(`${s.built}T12:00:00`)) : '—'}, déposé le ${s.uploaded ? dateFmt.format(new Date(s.uploaded)) : '—'}${s.source ? ` · ${s.source}` : ''}.`
      : 'Dépose le fichier JSON des stages (format « isis-hub-stages », version 1) : le serveur le vérifie en entier avant de le garder.';
    const upload = h('button.btn.btn--sm', { type: 'button', text: s.hasData ? 'Remplacer le fichier' : 'Déposer le fichier JSON', on: { click: () => file.click() } });
    const preview = h('button.btn.btn--sm', { type: 'button', text: previewing() ? 'Arrêter l’aperçu' : 'Aperçu sur cet appareil', disabled: !s.hasData, on: { click: togglePreview } });
    const toggle = h(`button.btn.btn--sm${s.enabled ? '' : '.btn--primary'}`, { type: 'button', text: s.enabled ? 'Fermer la rubrique' : 'Ouvrir à tout le monde', disabled: !s.hasData, on: { click: toggleOpen } });
    const remove = h('button.btn.btn--sm.btn--ghost.gr-danger', { type: 'button', text: 'Supprimer les données', hidden: !s.hasData, on: { click: removeData } });
    const note = s.enabled
      ? 'Les étudiants voient l’onglet Stages et la tuile au prochain chargement du Hub.'
      : previewing()
        ? 'Aperçu actif : l’onglet Stages se montre sur cet appareil seulement ; le serveur ne sert les données qu’aux identifiants de l’administration tant que la rubrique est fermée.'
        : 'Tant que la rubrique est fermée, personne ne voit rien : ni onglet, ni tuile.';
    root.replaceChildren(
      h('p.hint', { text: 'Rubrique Stages : tous les stages des étudiants d’ISIS, sur une carte, avec les sujets, les maîtres de stage et les contacts RH (adresses e-mail comprises). Réservée aux comptes de l’université connectés. Rien n’est gardé sur qui consulte ni sur ce qui est ouvert : la fréquentation de la rubrique est comptée anonymement, dans l’onglet Fréquentation.' }),
      h(
        'div.adm-amb.adm-stg',
        {},
        h('div.adm-amb-art.adm-stg-art', { attrs: { 'aria-hidden': 'true' } }, svgBriefcase()),
        h('div.adm-amb-t', {}, h('b', { text: 'Stages' }), h('span', { text: facts }), state),
        h('div.adm-amb-acts', {}, upload, preview, toggle, remove),
      ),
      h('p.hint', { text: note }),
      h('div.adm-stg-err', { hidden: true, attrs: { role: 'alert' }, data: { stgErr: '' } }),
      file,
    );
  }

  function svgBriefcase() {
    const NS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    for (const d of ['M3 9.5a2.5 2.5 0 0 1 2.5-2.5h13A2.5 2.5 0 0 1 21 9.5v8a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 17.5z', 'M8.5 7V5.5a2 2 0 0 1 2-2h3a2 2 0 0 1 2 2V7M3 12.5h18']) {
      const p = document.createElementNS(NS, 'path');
      p.setAttribute('d', d);
      svg.append(p);
    }
    return svg;
  }

  function showError(msg) {
    const el = $('[data-stg-err]', root);
    if (!el) return toast(msg);
    el.textContent = msg;
    el.hidden = !msg;
  }

  file.addEventListener('change', async () => {
    const f = file.files?.[0];
    file.value = '';
    if (!f || busy) return;
    if (f.size > 12 * 1024 * 1024) return showError('Fichier trop lourd (12 Mo au plus).');
    let text;
    try {
      text = await f.text();
      const d = JSON.parse(text);
      if (d?.format !== 'isis-hub-stages') throw new Error('ce n’est pas un fichier « isis-hub-stages »');
      if (status?.hasData && !confirm(`Remplacer les données en ligne par « ${f.name} » (${(d.stages ?? []).length} stages, ${(d.companies ?? []).length} structures) ?`)) return;
    } catch (err) {
      return showError(`Fichier illisible : ${err.message}`);
    }
    busy = true;
    showError('');
    try {
      status = await adminApi.upload(text);
      toast(`Fichier déposé : ${plural(status.stages, 'stage')}, ${plural(status.companies, 'structure')}.`, 'check');
      render();
    } catch (err) {
      if (err instanceof StagesError && err.status === 403) return onLeave();
      showError(`Fichier refusé par le serveur : ${err.message}`);
    } finally {
      busy = false;
    }
  });

  function togglePreview() {
    if (previewing()) prefs.set('stages-apercu', null);
    else {
      prefs.set('stages-apercu', true);
      window.open('./#stages', '_blank', 'noopener');
    }
    render();
  }

  async function toggleOpen(e) {
    const on = !status.enabled;
    if (on && !confirm('Ouvrir la rubrique Stages à tout le monde ? L’onglet et la tuile apparaissent au prochain chargement du Hub ; les contacts (e-mails compris) deviennent lisibles par tout compte connecté.')) return;
    e.currentTarget.disabled = true;
    try {
      status = await adminApi.enabled(on);
      toast(on ? 'Rubrique Stages ouverte.' : 'Rubrique Stages fermée.', 'check');
    } catch (err) {
      handle(err);
    }
    render();
  }

  async function removeData(e) {
    if (!confirm('Supprimer les données des stages du serveur ? La rubrique est fermée et le fichier effacé. Il faudra redéposer un fichier pour la rouvrir.')) return;
    e.currentTarget.disabled = true;
    try {
      status = await adminApi.remove();
      toast('Données des stages supprimées.', 'check');
    } catch (err) {
      handle(err);
    }
    render();
  }

  return { show: load };
}
