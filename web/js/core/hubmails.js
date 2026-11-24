// Mails d'ISIS Hub dans la boîte de réception : on ne garde que le dernier.
//
// Le mail d'accord du TCG (« TCG de la promo : tu apparais sur une carte… », tcg/consent.js) peut
// arriver plusieurs fois au fil des cartes. Pour qui utilise ISIS Hub, seul le plus récent sert :
// les plus anciens partent à la corbeille (récupérables). Reconnu à son objet exact ET à un
// expéditeur de l'université ; aucun autre mail n'est touché. Réglable (case dans les mails).
//
// Ce fichier ne touche ni au réseau ni à l'interface : il est testé tel quel sous Node.

import { MAIL_SUBJECT } from '../tcg/consent-text.js';

const SENDER = /@([a-z0-9-]+\.)*univ-jfc\.fr$/i;
const SUBJECTS = new Set([MAIL_SUBJECT].map((s) => s.trim().toLowerCase()));

/** Mail envoyé par ISIS Hub (mail d'accord du TCG) ? */
export const isHubMail = (m) => SUBJECTS.has((m?.subject ?? '').trim().toLowerCase()) && SENDER.test(m?.from?.address ?? '');

const time = (m) => (m?.date instanceof Date ? m.date.getTime() : Number(new Date(m?.date)) || 0);

/**
 * Suivi des mails d'ISIS Hub vus pendant la visite. `pick(batch)` rend ceux à mettre à la corbeille :
 * tous sauf le plus récent vu jusqu'ici (un plus ancien découvert en descendant la boîte part aussi ;
 * si un plus récent arrive, c'est l'ancien « dernier » qui part).
 */
export function createHubMails() {
  let keep = null; // le plus récent vu : { id, t }
  return {
    pick(batch) {
      const hub = (batch ?? []).filter(isHubMail);
      if (!hub.length) return [];
      const out = [];
      for (const m of [...hub].sort((a, b) => time(b) - time(a))) {
        if (!keep) {
          keep = { id: m.id, t: time(m), mail: m };
        } else if (m.id === keep.id) {
          continue;
        } else if (time(m) > keep.t) {
          out.push(keep.mail);
          keep = { id: m.id, t: time(m), mail: m };
        } else {
          out.push(m);
        }
      }
      return out.filter(Boolean);
    },
    forget() {
      keep = null;
    },
  };
}
