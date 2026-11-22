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

export function setupChangelog({ onLaunch } = {}) {
  const newsDialog = $('dialog[data-news]');
  const launchDialog = $('dialog[data-launch]');
  let go = false;
  const launch = modal(launchDialog, {
    onOpen: () => requestAnimationFrame(() => (launchDialog.scrollTop = 0)),
    onClose() {
      markSeen('changelog', LATEST);
      if (go) onLaunch?.();
      go = false;
    },
  });
  $('[data-launch-go]', launchDialog).addEventListener('click', () => {
    go = true;
    launch.close();
  });
  const logDialog = $('dialog[data-changelog]');
  const news = modal(newsDialog, { onClose: () => markSeen('changelog', LATEST) });
  const log = modal(logDialog, { onClose: () => markSeen('changelog', LATEST) });

  function openLog() {
    $('[data-changelog-list]', logDialog).replaceChildren(
      ...CHANGELOG.map((e, i) =>
        h('section.log-entry', {},
          h('header.log-head', {},
            h('span.log-ver', { text: tag(e.version) }),
            i === 0 ? h('span.log-now', { text: 'actuelle' }) : null,
            h('time', { text: when(e.date), attrs: { datetime: e.date } })),
          h('h3.log-title', { text: e.title }),
          h('ul.log-points', {}, e.details.map((d) => h('li', { text: d })))),
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
      if (newcomer) return void markSeen('changelog', LATEST);
      const entries = unseen(last);
      if (!entries.length) return;
      const wait = setInterval(() => {
        if (tourActive() || document.querySelector('dialog[open]')) return;
        clearInterval(wait);
        if (seen('changelog') === LATEST) return;
        // Grande version (écran d'arrivée) : présentée seule ; le reste est au journal.
        if (entries[0].launch && launchDialog) launch.open();
        else openNews(entries);
      }, 800);
    },
  };
}
