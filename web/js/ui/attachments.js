// Pièces jointes : vues et téléchargées dans ISIS Hub, sans repasser par la messagerie.
//
// Sécurité : le contenu d'une pièce jointe n'est JAMAIS interprété comme une page. Seuls les
// images (PNG, JPEG, GIF, WebP) et les PDF sont affichés, et seulement si leurs premiers octets
// le confirment (le type annoncé par l'expéditeur ne compte pas). HTML, SVG et tout le reste
// sont seulement proposés au téléchargement, sous le type neutre application/octet-stream.

import { $, h, toast } from '../core/dom.js';
import * as mail from '../portals/mail.js';
import { modal } from './layout.js';
import { kb, sniff, safeName, viewable } from '../portals/files.js';

export { kb, viewable };

const MAX = 25 * 1024 * 1024;

// Une seule visionneuse pour la page (mails et Moodle s'en servent tous les deux).
let shared = null;
export const createAttachmentViewer = () => (shared ??= makeViewer());

function makeViewer() {
  const dialog = $('dialog[data-att-viewer]');
  const body = $('[data-att-body]', dialog);
  const dl = $('[data-att-download]', dialog);
  let urls = [];
  const revoke = () => {
    urls.forEach((u) => URL.revokeObjectURL(u));
    urls = [];
  };
  const sheet = modal(dialog, { onClose: () => (body.replaceChildren(), revoke()) });

  async function bytesOf(m, a) {
    if (a.size > MAX) throw new Error('pièce jointe trop lourde pour être ouverte ici (25 Mo au plus)');
    return mail.partBytes(m, a.part);
  }

  function blobUrl(bytes, type) {
    const u = URL.createObjectURL(new Blob([bytes], { type }));
    urls.push(u);
    return u;
  }

  /** Enregistre des octets sous un type neutre et un nom nettoyé : jamais ouverts par la page. */
  function save(bytes, name) {
    const u = URL.createObjectURL(new Blob([bytes], { type: 'application/octet-stream' }));
    const link = h('a', { href: u, attrs: { download: safeName(name) } });
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(u), 60_000);
  }

  /** Téléchargement direct d'un fichier quelconque : `load()` rend ses octets (et parfois son nom). */
  async function downloadFile({ name, load }, button) {
    if (button?.classList.contains('is-busy')) return;
    button?.classList.add('is-busy');
    button?.setAttribute('aria-busy', 'true');
    try {
      const got = await load();
      const bytes = got?.bytes ?? got;
      save(bytes, got?.name || name);
    } catch (err) {
      toast(`Téléchargement impossible : ${err.message}`, 'alert');
    } finally {
      button?.classList.remove('is-busy');
      button?.removeAttribute('aria-busy');
    }
  }

  /** Aperçu dans le Hub (images et PDF reconnus à leurs premiers octets), sinon proposé au téléchargement. */
  async function viewFile({ name, size, load }) {
    revoke();
    $('[data-att-title]', dialog).textContent = name;
    $('[data-att-meta]', dialog).textContent = size ? kb(size) : '';
    body.replaceChildren(h('p.cs-none', {}, h('span.spinner'), ' Ouverture…'));
    dl.removeAttribute('href');
    sheet.open();
    try {
      const got = await load();
      const bytes = got?.bytes ?? got;
      const fileName = got?.name || name;
      const type = sniff(bytes);
      if (!size) $('[data-att-meta]', dialog).textContent = kb(bytes.length);
      dl.href = blobUrl(bytes, 'application/octet-stream');
      dl.setAttribute('download', safeName(fileName));
      if (type?.startsWith('image/')) {
        body.replaceChildren(h('img.att-img', { src: blobUrl(bytes, type), alt: fileName }));
      } else if (type === 'application/pdf') {
        const pdf = blobUrl(bytes, type);
        // iPhone, iPad : un PDF dans un cadre n'y montre souvent que sa première page.
        body.replaceChildren(
          h('iframe.att-pdf', { src: pdf, title: fileName, attrs: { referrerpolicy: 'no-referrer' } }),
          h('p.hint.att-hint', {}, 'Le PDF s’affiche mal ? ', h('a', { href: pdf, target: '_blank', rel: 'noopener', text: 'Ouvre-le en plein écran' }), ' ou utilise « Télécharger ».'),
        );
      } else {
        body.replaceChildren(h('p.cs-none', { text: 'Ce fichier ne peut pas être affiché ici en toute sécurité : télécharge-le pour l’ouvrir.' }));
      }
    } catch (err) {
      body.replaceChildren(h('p.cs-none', { text: `Ouverture impossible : ${err.message}` }));
    }
  }

  /** Pièce jointe d'un mail. */
  const view = (m, a) => viewFile({ name: a.name, size: a.size, load: () => bytesOf(m, a) });
  const download = (m, a, button) => downloadFile({ name: a.name, load: () => bytesOf(m, a) }, button);

  return { view, download, viewFile, downloadFile };
}
