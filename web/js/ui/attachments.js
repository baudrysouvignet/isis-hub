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

export function createAttachmentViewer() {
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

  /** Téléchargement direct : type neutre, nom nettoyé, jamais ouvert par la page. */
  async function download(m, a, button) {
    button?.classList.add('is-busy');
    try {
      const bytes = await bytesOf(m, a);
      const u = URL.createObjectURL(new Blob([bytes], { type: 'application/octet-stream' }));
      const link = h('a', { href: u, attrs: { download: safeName(a.name) } });
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(u), 60_000);
    } catch (err) {
      toast(`Téléchargement impossible : ${err.message}`, 'alert');
    } finally {
      button?.classList.remove('is-busy');
    }
  }

  async function view(m, a) {
    revoke();
    $('[data-att-title]', dialog).textContent = a.name;
    $('[data-att-meta]', dialog).textContent = a.size ? kb(a.size) : '';
    body.replaceChildren(h('p.cs-none', {}, h('span.spinner'), ' Ouverture…'));
    dl.removeAttribute('href');
    sheet.open();
    try {
      const bytes = await bytesOf(m, a);
      const type = sniff(bytes);
      dl.href = blobUrl(bytes, 'application/octet-stream');
      dl.setAttribute('download', safeName(a.name));
      if (type?.startsWith('image/')) {
        body.replaceChildren(h('img.att-img', { src: blobUrl(bytes, type), alt: a.name }));
      } else if (type === 'application/pdf') {
        body.replaceChildren(
          h('iframe.att-pdf', { src: blobUrl(bytes, type), title: a.name, attrs: { referrerpolicy: 'no-referrer' } }),
          h('p.hint.att-hint', { text: 'Le PDF ne s’affiche pas ? Utilise « Télécharger ».' }),
        );
      } else {
        body.replaceChildren(h('p.cs-none', { text: 'Ce fichier ne peut pas être affiché ici en toute sécurité : télécharge-le pour l’ouvrir.' }));
      }
    } catch (err) {
      body.replaceChildren(h('p.cs-none', { text: `Ouverture impossible : ${err.message}` }));
    }
  }

  return { view, download };
}
