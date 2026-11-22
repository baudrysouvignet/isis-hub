// Texte des enseignants (consignes, résumés, zones de texte) affiché dans le Hub.
//
// Même principe que les mails (portals/sanitize.js) : le HTML de Moodle est analysé dans un document
// inerte, puis RECONSTRUIT balise par balise à partir d'une liste fermée. Rien n'est exécuté, aucun
// style ni attribut n'est recopié. En plus :
// - les liens vers Moodle restent dans le Hub quand c'est possible (fichier → aperçu, cours → page
//   du cours, activité → l'élément dans le cours) ;
// - les images déposées sur Moodle sont lues par le tunnel, vérifiées à leurs premiers octets et
//   affichées depuis la mémoire (blob:) ; une image d'un autre site n'est jamais chargée.

import { h } from '../core/dom.js';
import { parse } from '../portals/sanitize.js';
import { moodleUrl, webUrl, courseIdOf, cmIdOf, fetchFile, stripStyles } from '../portals/moodle-course.js';
import { sniff } from '../portals/files.js';

const KEEP = new Set([
  'a', 'b', 'strong', 'i', 'em', 'u', 's', 'small', 'sub', 'sup', 'mark', 'code', 'pre', 'kbd',
  'p', 'br', 'hr', 'blockquote', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'ul', 'ol', 'li', 'dl', 'dt', 'dd', 'table', 'thead', 'tbody', 'tfoot', 'tr', 'td', 'th', 'caption',
  'figure', 'figcaption', 'abbr', 'cite', 'q', 'span', 'div', 'section', 'article',
]);
const DROP = new Set(['script', 'style', 'noscript', 'template', 'iframe', 'frame', 'frameset', 'object', 'embed',
  'form', 'input', 'button', 'select', 'textarea', 'svg', 'math', 'video', 'audio', 'canvas', 'link', 'meta', 'title', 'head', 'base']);
const HEAD = { h1: 'h4', h2: 'h4', h3: 'h4', h4: 'h5', h5: 'h5', h6: 'h5' };
const BLOCK = new Set(['div', 'section', 'article']);

// Textes laissés par défaut par Moodle et jamais remplis : masqués.
export const PLACEHOLDER = /activez le mode édition|Glissez-déposez ici|Quelques lignes de présentation du cours/i;

const nameOfUrl = (u) => {
  try {
    return decodeURIComponent(new URL(u).pathname.split('/').pop() || '');
  } catch {
    return '';
  }
};

/** Lien : rendu dans le Hub quand il pointe vers Moodle, sinon nouvel onglet. */
function linkFor(href) {
  const m = moodleUrl(href);
  if (m) {
    const path = new URL(m).pathname;
    const a = h('a', { href: m, target: '_blank', rel: 'noopener' });
    if (path.startsWith('/pluginfile.php/')) {
      a.dataset.mcFile = m;
      a.dataset.mcFileName = nameOfUrl(m);
    } else if (courseIdOf(m)) a.dataset.mcCourse = courseIdOf(m);
    else if (cmIdOf(m)) a.dataset.mcCm = cmIdOf(m);
    return a;
  }
  const w = webUrl(href) || (/^(mailto:|tel:)/i.test(href) ? href : '');
  return w ? h('a', { href: w, target: '_blank', rel: 'noopener noreferrer nofollow' }) : null;
}

/** Texte brut (recherche, détection des listes de liens). */
export function plainText(html) {
  if (!html) return '';
  return (parse(stripStyles(html)).body?.textContent ?? '').replace(/\s+/g, ' ').trim();
}

/** Le HTML ne contient que des liens (une « zone de texte » qui sert de liste de sites) : [{ name, url }]. */
export function linksOnly(html) {
  if (!html) return null;
  const doc = parse(stripStyles(html));
  const links = [...doc.querySelectorAll('a[href]')].map((a) => ({ name: (a.textContent || '').replace(/\s+/g, ' ').trim(), url: a.getAttribute('href') }));
  if (links.length < 2) return null;
  const rest = (doc.body?.textContent ?? '').replace(/\s+/g, ' ');
  const withoutLinks = links.reduce((t, l) => t.replace(l.name, ''), rest).replace(/[\s·•|,;:\-–—()]+/g, '');
  if (withoutLinks.length > 40 || doc.querySelector('img')) return null;
  return links.filter((l) => l.name && (moodleUrl(l.url) || webUrl(l.url)));
}

/** Fragment sûr à insérer tel quel. Rend null si le texte est vide ou laissé par défaut. */
export function rich(html, { headings = true } = {}) {
  if (!html || PLACEHOLDER.test(html)) return null;
  const source = parse(stripStyles(html));
  const frag = document.createDocumentFragment();
  let images = 0;

  function copy(node, out) {
    for (const child of node.childNodes) {
      if (child.nodeType === 3) {
        out.append(document.createTextNode(child.nodeValue));
        continue;
      }
      if (child.nodeType !== 1) continue;
      const tag = child.localName;
      if (DROP.has(tag)) continue;
      if (tag === 'img') {
        const src = moodleUrl(child.getAttribute('src') ?? '');
        const alt = (child.getAttribute('alt') || '').trim();
        if (src && new URL(src).pathname.startsWith('/pluginfile.php/') && images < 12) {
          images++;
          out.append(h('img.mc-img', { alt, data: { src }, attrs: { loading: 'lazy', decoding: 'async' } }));
        } else if (alt) out.append(document.createTextNode(`[${alt}]`));
        continue;
      }
      if (!KEEP.has(tag)) {
        copy(child, out);
        continue;
      }
      let el;
      if (tag === 'a') {
        el = linkFor((child.getAttribute('href') || '').trim());
        if (!el) {
          copy(child, out);
          continue;
        }
      } else if (HEAD[tag]) el = document.createElement(headings ? HEAD[tag] : 'p');
      else if (BLOCK.has(tag)) el = document.createElement('div');
      else el = document.createElement(tag);
      if ((tag === 'td' || tag === 'th') && /^\d{1,2}$/.test(child.getAttribute('colspan') || '')) el.setAttribute('colspan', child.getAttribute('colspan'));
      copy(child, el);
      // Paragraphes vides laissés par l'éditeur : retirés.
      if ((tag === 'p' || BLOCK.has(tag)) && !el.textContent.trim() && !el.querySelector('img, br + br')) continue;
      if (tag === 'table') out.append(h('div.mc-tablewrap', {}, el));
      else out.append(el);
    }
  }
  copy(source.body ?? source.documentElement, frag);
  if (!frag.textContent.trim() && !frag.querySelector?.('img')) return null;
  return frag;
}

// ------------------------------------------------------------------ images (par le tunnel)

const MAX_IMG = 8 * 1024 * 1024;
const imgCache = new Map(); // adresse → blob: (pendant la vie de la page)
let queue = Promise.resolve();

/** Charge les images de Moodle présentes sous `root`, une à la fois. */
export function loadImages(root) {
  for (const img of root.querySelectorAll('img.mc-img[data-src]:not([src])')) {
    const src = img.dataset.src;
    if (imgCache.has(src)) {
      img.src = imgCache.get(src);
      continue;
    }
    img.classList.add('is-loading');
    queue = queue.then(async () => {
      if (!img.isConnected) return;
      try {
        const { bytes } = await fetchFile({ url: src });
        const type = sniff(bytes);
        if (!type?.startsWith('image/') || bytes.length > MAX_IMG) throw new Error('pas une image');
        const u = URL.createObjectURL(new Blob([bytes], { type }));
        imgCache.set(src, u);
        img.src = u;
      } catch {
        img.replaceWith(document.createTextNode(img.alt ? `[${img.alt}]` : ''));
      } finally {
        img.classList.remove('is-loading');
      }
    });
  }
}
