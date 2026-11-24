// ISIS · TCG : objet et texte du mail d'accord (sans interface : lu aussi par core/hubmails.js,
// qui ne garde que le dernier de ces mails dans la boîte de réception).

const LINK = 'accord'; // #tcg/accord

// Adresse du Hub (« / »), que l'on soit sur le Hub ou sur /admin.
export const consentLink = () => `${new URL('.', globalThis.location?.href ?? 'https://hub.invalid/').href}#tcg/${LINK}`;

/** Texte du mail : le même pour tous (copie cachée), sans nom ni carte. */
export function mailText(senderName) {
  return [
    'Bonjour,',
    '',
    'Tu apparais sur la photo d’une ou plusieurs cartes du TCG de la promo, dans ISIS Hub.',
    'Une carte n’entre dans le jeu qu’avec l’accord de chaque personne indiquée dessus : il nous faut le tien.',
    '',
    `Pour accepter ou refuser, connecte-toi à ISIS Hub, onglet TCG → « Mes apparitions » :`,
    consentLink(),
    '',
    'Personne ne saura qui a refusé. Tu ne recevras pas d’autre mail pour ces cartes.',
    '',
    'Bonne journée,',
    senderName || 'L’équipe ISIS Hub',
  ].join('\n');
}

export const MAIL_SUBJECT = 'TCG de la promo : tu apparais sur une carte, ton accord est demandé';
