// « Quoi de neuf ? » (pop-up courte, une fois par étudiant et par version) et « Journal des
// versions » (tout le détail, depuis le menu du compte).

import { $, $$, h } from '../core/dom.js';
import { CHANGELOG, LATEST, unseen } from '../core/changelog.js';
import { seen, markSeen } from '../core/seen.js';
import { modal } from './layout.js';
import { tourActive } from './tour.js';

const dateFmt = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
const when = (iso) => dateFmt.format(new Date(`${iso}T12:00:00`));
const tag = (v) => (v.startsWith('0.') ? `bêta v${v}` : `v${v}`);

export function setupChangelog({ onLaunch, canLaunch = () => true } = {}) {
  const newsDialog = $('dialog[data-news]');
  const launchDialog = $('dialog[data-launch]');
  // Fonction pas ouverte pour ce compte (rubrique Stages fermée, TCG pour un compte du personnel) :
  // ni l'entrée, ni l'étape, ni la ligne qui en parlent.
  const shown = (only) => !only || canLaunch(only);
  // L'entrée telle que ce compte la voit : elle-même, sa variante « closed » tant que sa fonction est
  // fermée (sans écran de lancement), ou rien.
  const view = (e) => (shown(e.only) ? e : e.closed ? { ...e, ...e.closed, only: undefined, launch: undefined, onlyDetails: e.closed.onlyDetails } : null);
  // Dernière version que ce compte peut voir : c'est elle qu'on marque vue. Une version qui présente
  // une fonction encore fermée (3.0.0 tant que Stages l'est) n'est pas marquée : son écran viendra.
  const latestShown = () => CHANGELOG.find((e) => shown(e.only) && (!e.launch?.requires || canLaunch(e.launch.requires)))?.version ?? LATEST;
  const detailsOf = (e) => [...e.details, ...Object.entries(e.onlyDetails ?? {}).flatMap(([k, lines]) => (shown(k) ? lines : []))];
  let go = null; // destination du bouton « Accéder », suivie une fois la fenêtre fermée
  let current = null;
  const launch = modal(launchDialog, {
    onOpen: () => requestAnimationFrame(() => (launchDialog.scrollTop = 0)),
    onClose() {
      markSeen('changelog', latestShown());
      const to = go;
      go = null;
      if (to === 'log') openLog();
      else if (to) onLaunch?.(to);
    },
  });
  $('[data-launch-go]', launchDialog).addEventListener('click', () => {
    go = current?.launch.go?.to ?? null;
    launch.close();
  });
  $('[data-launch-log]', launchDialog).addEventListener('click', () => {
    go = 'log';
    launch.close();
  });

  /** Écran « nouvelle version » rempli depuis le journal (texte seulement, visuel cloné d'un modèle). */
  function openLaunch(entry) {
    const L = entry.launch;
    current = entry;
    $('[data-launch-chip]', launchDialog).textContent = `Nouveau · ${tag(entry.version)}`;
    const tpl = $(`template[data-launch-art-tpl="${L.art}"]`);
    $('[data-launch-art]', launchDialog).replaceChildren(tpl ? tpl.content.cloneNode(true) : '');
    $('[data-launch-title]', launchDialog).textContent = L.title;
    $('[data-launch-sub]', launchDialog).textContent = L.sub ?? '';
    $('[data-launch-steps]', launchDialog).replaceChildren(
      ...(L.steps ?? []).filter(([, , only]) => shown(only)).slice(0, 3).map(([t, d], i) =>
        h('li', {}, h('span.launch-n', { text: String(i + 1) }), h('div', {}, h('h3', { text: t }), h('p', { text: d })))),
    );
    const priv = $('[data-launch-privacy]', launchDialog);
    priv.hidden = !L.privacy;
    $('span', priv).textContent = L.privacy ?? '';
    const goBtn = $('[data-launch-go]', launchDialog);
    goBtn.hidden = !L.go;
    $('[data-launch-go-label]', goBtn).textContent = L.go?.label ?? 'Accéder';
    launch.open();
  }

  const logDialog = $('dialog[data-changelog]');
  const news = modal(newsDialog, { onClose: () => markSeen('changelog', latestShown()) });
  const log = modal(logDialog, { onClose: () => markSeen('changelog', latestShown()) });

  function openLog() {
    $('[data-changelog-list]', logDialog).replaceChildren(
      ...CHANGELOG.map(view).filter(Boolean).map((e, i) =>
        h('section.log-entry', {},
          h('header.log-head', {},
            h('span.log-ver', { text: tag(e.version) }),
            i === 0 ? h('span.log-now', { text: 'actuelle' }) : null,
            h('time', { text: when(e.date), attrs: { datetime: e.date } })),
          h('h3.log-title', { text: e.title }),
          h('ul.log-points', {}, detailsOf(e).map((d) => h('li', { text: d })))),
      ),
    );
    if (newsDialog.open) news.close();
    log.open();
  }

  function openNews(entries) {
    $('[data-news-sub]', newsDialog).textContent = `Depuis ta dernière visite : ${new Intl.ListFormat('fr', { type: 'conjunction' }).format(entries.map((e) => tag(e.version)))}`;
    $('[data-news-list]', newsDialog).replaceChildren(
      ...entries.map((e) =>
        h('section.news-entry', {},
          h('p.news-ver', { text: `${tag(e.version)} · ${e.title}` }),
          h('ul.news-points', {}, e.short.map((d) => h('li', { text: d })))),
      ),
    );
    news.open();
  }

  $('[data-news-all]', newsDialog).addEventListener('click', openLog);
  $$('[data-open-changelog]').forEach((b) => b.addEventListener('click', openLog));

  return {
    openLog,
    /**
     * À l'arrivée sur le tableau de bord, une fois le « déjà vu » connu. Un nouvel étudiant (visite
     * guidée jamais faite) n'a rien à rattraper : tout est marqué vu sans pop-up.
     */
    maybeShow({ newcomer }) {
      const last = seen('changelog');
      if (newcomer) return void markSeen('changelog', latestShown());
      const entries = unseen(last)
        .map(view)
        .filter((e) => e && !e.quiet);
      if (!entries.length) return;
      // Version qui présente une fonction pas encore ouverte (TCG masqué) : rien n'est montré ni
      // marqué vu ; l'écran apparaîtra le jour où la fonction s'ouvre.
      const needs = entries[0].launch?.requires;
      if (needs && !canLaunch(needs)) return;
      const wait = setInterval(() => {
        if (tourActive() || document.querySelector('dialog[open]')) return;
        clearInterval(wait);
        if (seen('changelog') === latestShown()) return;
        // Écran « nouvelle version » de la plus récente ; les précédentes sont dans le changelog.
        if (entries[0].launch && launchDialog) openLaunch(entries[0]);
        else openNews(entries);
      }, 800);
    },
  };
}
