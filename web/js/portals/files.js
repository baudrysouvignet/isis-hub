// Pièces jointes : reconnaissance du type réel et nom de fichier sûr (code pur, testé sous Node).

export const kb = (n) => (n > 1048576 ? `${(n / 1048576).toFixed(1)} Mo` : `${Math.max(1, Math.round(n / 1024))} Ko`);

const starts = (b, sig, at = 0) => sig.every((x, i) => b[at + i] === x);

/** Type réel d'après les premiers octets, parmi ceux qu'on accepte d'afficher ; sinon null. */
export function sniff(b) {
  if (starts(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png';
  if (starts(b, [0xff, 0xd8, 0xff])) return 'image/jpeg';
  if (starts(b, [0x47, 0x49, 0x46, 0x38])) return 'image/gif';
  if (starts(b, [0x52, 0x49, 0x46, 0x46]) && starts(b, [0x57, 0x45, 0x42, 0x50], 8)) return 'image/webp';
  if (starts(b, [0x25, 0x50, 0x44, 0x46, 0x2d])) return 'application/pdf';
  return null;
}

/** Nom de fichier sans chemin ni caractères de contrôle. */
export const safeName = (n) =>
  (n || 'piece-jointe').replace(/[\\/\u0000-\u001f\u007f]+/g, '_').replace(/^\.+/, '').slice(0, 180) || 'piece-jointe';

/** Pièce jointe qu'on propose d'ouvrir (le contenu sera de toute façon vérifié par sniff). */
export const viewable = (a) => /^(image\/(png|jpe?g|gif|webp)|application\/pdf)$/i.test(a.mime ?? '') || /\.(png|jpe?g|gif|webp|pdf)$/i.test(a.name ?? '');
