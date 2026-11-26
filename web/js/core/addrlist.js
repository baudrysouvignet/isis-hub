// Liste d'adresses collée dans un champ « À », « Cc » ou « Cci » : une liste copiée depuis Outlook,
// BlueMind, un tableur ou un mail (« Baudry SOUVIGNET <baudry.souvignet@etud.univ-jfc.fr>, Léa… »).
// Code pur (testé sous Node) : rend les destinataires reconnus et le texte qui n'en était pas un.
//
// Formats reconnus, mélangés si besoin :
//   Nom Prénom <adresse>        "NOM, Prénom" <adresse>        NOM, Prénom <adresse>
//   adresse                     <adresse>                      Nom Prénom (adresse)
// Séparateurs : virgule, point-virgule, retour à la ligne, tabulation. Une virgule entre guillemets
// ou dans <…> ne sépare pas.

const EMAIL = /^[^@\s<>(),;:"\\]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$/;
const FIND = /[^@\s<>(),;:"'\\]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/;

/** Découpe sur les séparateurs, hors guillemets et hors <…>. */
function tokens(text) {
  const out = [];
  let cur = '';
  let quoted = false;
  let angle = 0;
  for (const ch of text) {
    if (ch === '"') quoted = !quoted;
    else if (ch === '<' && !quoted) angle++;
    else if (ch === '>' && !quoted && angle) angle--;
    if (!quoted && !angle && /[,;\n\r\t]/.test(ch)) {
      out.push(cur);
      cur = '';
      continue;
    }
    cur += ch;
  }
  out.push(cur);
  return out.map((t) => t.trim()).filter(Boolean);
}

const cleanName = (s) =>
  s
    .replace(/^["'\s]+|["'\s]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();

/**
 * Destinataires d'un texte collé : { people: [{ email, name }], rest } (doublons retirés, adresses
 * en minuscules ; rest : ce qui ne contenait aucune adresse, à laisser dans le champ).
 */
export function parseAddresses(text) {
  const people = [];
  const seen = new Set();
  const rest = [];
  let pending = ''; // « SOUVIGNET » avant « Baudry <adresse> » (virgule dans un nom sans guillemets)
  for (const t of tokens(String(text ?? ''))) {
    let email = '';
    let name = '';
    const angle = /^(.*?)<\s*([^<>]+?)\s*>\s*$/.exec(t);
    const paren = /^(.*?)\(\s*([^()]+@[^()]+?)\s*\)\s*$/.exec(t);
    if (angle && EMAIL.test(angle[2])) [, name, email] = angle;
    else if (paren && EMAIL.test(paren[2])) [, name, email] = paren;
    else {
      const m = FIND.exec(t);
      if (m && EMAIL.test(m[0])) {
        email = m[0];
        name = t.replace(m[0], '').replace(/[<>()]/g, ' ');
      }
    }
    if (!email) {
      // Pas d'adresse : début d'un nom « NOM, Prénom <…> », ou texte à garder.
      if (!/@/.test(t) && t.length <= 60) pending = pending ? `${pending}, ${t}` : t;
      else rest.push(t);
      continue;
    }
    name = cleanName(name);
    if (pending) {
      // « SOUVIGNET, Baudry » : on remet le nom dans l'ordre affiché par l'annuaire.
      name = name ? `${cleanName(pending)}, ${name}` : cleanName(pending);
      pending = '';
    }
    email = email.toLowerCase();
    if (seen.has(email)) continue;
    seen.add(email);
    people.push({ email, name: name || email });
  }
  if (pending) rest.push(pending);
  return { people, rest: rest.join(', ') };
}

/** Le texte ressemble-t-il à une liste d'adresses (à découper plutôt qu'à taper) ? */
export const looksLikeList = (text) => {
  const s = String(text ?? '');
  const n = (s.match(new RegExp(FIND.source, 'g')) ?? []).length;
  return n >= 2 || (n === 1 && /[<>,;\n]/.test(s));
};
