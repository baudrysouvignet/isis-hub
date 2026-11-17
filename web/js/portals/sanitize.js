// Affichage sûr du HTML d'un mail.
//
// Un mail est du contenu étranger : il ne doit rien exécuter, ni charger quoi que ce soit (une image
// distante suffit à prévenir l'expéditeur que le mail a été lu). On analyse donc le HTML dans un
// document inerte, puis on RECONSTRUIT un fragment en ne gardant qu'une liste fermée de balises et
// d'attributs. Scripts, styles, formulaires, cadres et images distantes ne sont jamais recopiés.
// En plus, la politique de sécurité de la page bloquerait tout chargement externe.

const KEEP = new Set([
  'a', 'b', 'strong', 'i', 'em', 'u', 's', 'small', 'sub', 'sup', 'mark', 'code', 'pre', 'kbd',
  'p', 'br', 'hr', 'div', 'span', 'blockquote', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'ul', 'ol', 'li', 'dl', 'dt', 'dd', 'table', 'thead', 'tbody', 'tfoot', 'tr', 'td', 'th', 'caption',
  'center', 'font', 'abbr', 'cite', 'q', 'address', 'figure', 'figcaption', 'section', 'article', 'header', 'footer',
]);
// Contenu entier ignoré (y compris le texte qu'ils contiennent).
const DROP = new Set(['script', 'style', 'noscript', 'template', 'iframe', 'frame', 'frameset', 'object', 'embed',
  'form', 'input', 'button', 'select', 'textarea', 'svg', 'math', 'video', 'audio', 'canvas', 'link', 'meta', 'title', 'head', 'base']);

const SAFE_HREF = /^(https?:|mailto:|tel:)/i;

let policy;
/** Analyse du HTML dans un document inerte (rien n'y est exécuté ni chargé). */
export function parse(html) {
  // Trusted Types : la seule chaîne HTML que la page accepte d'analyser passe par cette politique,
  // et le document produit est inerte (rien n'y est exécuté ni chargé).
  policy ??= globalThis.trustedTypes?.createPolicy?.('hub-mail-parser', { createHTML: (s) => s }) ?? { createHTML: (s) => s };
  return new DOMParser().parseFromString(policy.createHTML(html), 'text/html');
}

/** Rend { fragment, blockedImages } à insérer tel quel dans la page. */
export function sanitizeMail(html, doc = document) {
  const source = parse(html);
  let blockedImages = 0;

  function copy(node, out) {
    for (const child of node.childNodes) {
      if (child.nodeType === 3) {
        out.append(doc.createTextNode(child.nodeValue));
        continue;
      }
      if (child.nodeType !== 1) continue;
      const tag = child.localName;
      if (DROP.has(tag)) continue;
      if (tag === 'img') {
        blockedImages++;
        const alt = (child.getAttribute('alt') || '').trim();
        if (alt) out.append(doc.createTextNode(`[${alt}]`));
        continue;
      }
      if (!KEEP.has(tag)) {
        copy(child, out); // balise inconnue : on garde seulement son contenu
        continue;
      }
      const href = tag === 'a' ? (child.getAttribute('href') || '').trim() : '';
      // Un lien sans adresse sûre (javascript:, data:…) devient du simple texte.
      const unsafeLink = tag === 'a' && !SAFE_HREF.test(href);
      const el = doc.createElement(tag === 'font' || tag === 'center' || unsafeLink ? 'span' : tag);
      if (tag === 'a' && !unsafeLink) {
        el.setAttribute('href', href);
        el.setAttribute('target', '_blank');
        el.setAttribute('rel', 'noopener noreferrer nofollow');
      }
      if ((tag === 'td' || tag === 'th') && /^\d{1,2}$/.test(child.getAttribute('colspan') || '')) {
        el.setAttribute('colspan', child.getAttribute('colspan'));
      }
      copy(child, el);
      out.append(el);
    }
  }

  const fragment = doc.createDocumentFragment();
  copy(source.body ?? source.documentElement, fragment);
  return { fragment, blockedImages };
}

/** Texte brut → paragraphes, avec liens cliquables. */
export function textToFragment(text, doc = document) {
  const fragment = doc.createDocumentFragment();
  for (const block of text.replace(/\r\n?/g, '\n').split(/\n{2,}/)) {
    if (!block.trim()) continue;
    const p = doc.createElement('p');
    block.split('\n').forEach((line, i) => {
      if (i) p.append(doc.createElement('br'));
      let last = 0;
      for (const m of line.matchAll(/https?:\/\/[^\s<>"]+[^\s<>".,;:!?)]/g)) {
        p.append(doc.createTextNode(line.slice(last, m.index)));
        const a = doc.createElement('a');
        a.href = m[0];
        a.target = '_blank';
        a.rel = 'noopener noreferrer nofollow';
        a.textContent = m[0];
        p.append(a);
        last = m.index + m[0].length;
      }
      p.append(doc.createTextNode(line.slice(last)));
    });
    fragment.append(p);
  }
  return fragment;
}
