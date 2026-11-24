// ISIS · TCG : personnes sur la photo.
//
// « Mes apparitions » : les cartes validées où l'on m'a indiqué, avec « D'accord » / « Refuser ».
// « Mails d'accord » (administrateur) : un seul mail, envoyé depuis SA messagerie (dans cette
// page, comme tout mail du Hub) quand il clique sur « Envoyer les mails », tous les destinataires
// en copie cachée ; le serveur marque ensuite ces adresses comme prévenues (jamais renvoyées pour
// ces cartes) et efface leur version en clair.

import { h, toast } from '../core/dom.js';
import { api, adminApi, TcgError } from './api.js';
import { cardEl, ic, sheet, tbtn, dayLong, hourText, plural, CATS } from './ui.js';


export { consentLink } from './consent-text.js';

/** Cartes sans réponse (pastille de l'accueil). */
export const pendingAppear = (st) => (st?.appear ?? []).filter((a) => !a.answer && !a.retired);

// ------------------------------------------------------------------ « Mes apparitions »

export function renderConsent(ctx) {
  const st = ctx.st;
  const list = st?.appear ?? [];
  const head = h('header.tv-head', {}, h('div', {}, h('p.tk', { text: 'Ton accord' }), h('h1.tv-h1', { tabIndex: -1, text: 'Mes apparitions' })));
  const intro = h('p.thelp.tcs-intro', {
    text: 'Quelqu’un t’a indiqué sur la photo de ces cartes. Elles ne restent dans le jeu qu’avec ton accord : un refus retire la carte, sans dire qui a refusé.',
  });
  const sec = h('section.tcs', {}, intro);
  if (!st?.me?.mailLinked) {
    sec.append(h('p.tcs-empty', { text: 'Ta messagerie n’a pas encore été lue : ouvre tes mails dans le Hub, puis reviens ici.' }));
  } else if (!list.length) {
    sec.append(h('p.tcs-empty', { text: 'Aucune carte ne t’indique pour l’instant.' }));
  }
  const ul = h('ul.tcs-list');
  for (const a of list) ul.append(item(ctx, a));
  if (list.length) sec.append(ul);
  const frag = document.createDocumentFragment();
  frag.append(head, sec);
  return frag;
}

const asCard = (a) => ({ id: a.id, title: a.title, desc: a.desc, cat: a.cat, img: a.img, thumb: a.thumb, rarity: a.rarity });

/** La carte en grand (photo en haute définition, texte lisible) avant de répondre. */
function bigCard(a) {
  sheet('consent-card', a.title, [
    h('p.tk', { text: 'Ta réponse porte sur cette carte' }),
    h('div.tcs-big', {}, cardEl(asCard(a), { size: 'xl', mystery: !a.printed, by: '' })),
    h('h2.tdet-h', { text: a.title }),
    h('p.tcs-desc', { text: a.desc }),
  ]);
}

function item(ctx, a) {
  let card;
  if (a.retired) card = h('div.tcs-gone', {}, ic('x'), h('span', { text: 'Carte retirée' }));
  else {
    card = h('button.tcs-zoom', { type: 'button', attrs: { 'aria-label': `Voir « ${a.title} » en grand` } }, cardEl(asCard(a), { size: 'md', mystery: !a.printed, by: '' }));
    card.addEventListener('click', () => bigCard(a));
  }
  const state = a.retired
    ? h('p.tcs-state.is-no', {}, ic('x'), a.printed ? 'Accord retiré : la photo n’est plus montrée, les exemplaires restent marqués « Accord retiré ».' : 'Tu as refusé : la carte n’entrera pas dans le jeu.')
    : a.answer === 'ok'
      ? h('p.tcs-state.is-ok', {}, ic('check'), `Tu as donné ton accord${a.at ? ` le ${dayLong(a.at)}` : ''}.`)
      : h('p.tcs-state', {}, ic('clock'), 'En attente de ta réponse.');
  const acts = h('div.tcs-acts');
  if (!a.retired) {
    if (a.answer !== 'ok') acts.append(tbtn('D’accord', 'check', 'tbtn--primary', () => answer(ctx, a, true)));
    acts.append(
      tbtn(a.answer === 'ok' ? 'Retirer mon accord' : 'Refuser', 'x', 'tbtn--ghost', () => {
        const msg = a.printed
          ? `Retirer ton accord pour « ${a.title} » ? La photo et le texte disparaissent du jeu : ceux qui l’ont gardent leur exemplaire, marqué « Accord retiré ». C’est définitif.`
          : `Refuser « ${a.title} » ? La carte n’entrera pas dans le jeu. C’est définitif.`;
        if (confirm(msg)) answer(ctx, a, false);
      }),
    );
  }
  return h(
    `li.tcs-item${a.answer === 'ok' ? '.is-ok' : ''}${a.retired ? '.is-no' : ''}`,
    {},
    h('div.tcs-card', {}, card),
    h(
      'div.tcs-body',
      {},
      h('b.tcs-title', { text: a.retired ? 'Carte retirée' : a.title }),
      h('span.tcs-meta', { text: `${a.printed ? 'En jeu' : 'Avant le jury'} · ${CATS[a.cat] ?? a.cat ?? ''} · proposée par ${a.author}` }),
      // Ce que dit la carte, en entier : la personne valide le titre, la photo ET la description.
      !a.retired && a.desc ? h('p.tcs-desc', { text: a.desc }) : null,
      !a.retired ? tbtn('Voir en grand', 'eye', 'tbtn--ghost tbtn--sm tcs-see', () => bigCard(a)) : null,
      state,
      acts,
    ),
  );
}

async function answer(ctx, a, ok) {
  try {
    await api.consent(a.id, ok);
    toast(ok ? 'Merci, ton accord est enregistré.' : 'Carte retirée.', 'check');
    await ctx.reload();
  } catch (err) {
    toast(err instanceof TcgError ? err.message : 'Réponse impossible pour l’instant : réessaie.', 'alert');
  }
}

// ------------------------------------------------------------------ envoi des mails (admin)

// Objet et texte du mail d'accord : tcg/consent-text.js (sans interface, lu aussi par core/hubmails.js).
export { mailText, MAIL_SUBJECT } from './consent-text.js';
import { mailText, MAIL_SUBJECT } from './consent-text.js';

/**
 * Envoie le mail d'accord depuis la messagerie de l'administrateur : adressé à lui-même, les
 * personnes en copie cachée, par lots de m.chunk ; chaque lot est marqué « prévenu » dès qu'il est
 * parti (jamais renvoyé, même si la suite échoue). Rend le nombre de personnes prévenues.
 * send({ to, bcc, subject, text }) : mail.send ; markSent(keys, force) : serveur.
 */
export async function sendConsentMails({ m, me, name, send, markSent, force = false, onProgress }) {
  let sent = 0;
  for (let i = 0; i < m.targets.length; i += m.chunk) {
    const lot = m.targets.slice(i, i + m.chunk);
    onProgress?.(sent, m.targets.length);
    await send({ to: [{ address: me, name }], bcc: lot.map((t) => ({ address: t.email, name: '' })), subject: MAIL_SUBJECT, text: mailText(name) });
    await markSent(lot.map((t) => t.key), force || i > 0);
    sent += lot.length;
  }
  return sent;
}

/**
 * Fenêtre « Mails d'accord » : qui prévenir, quand, et l'envoi depuis la messagerie de
 * l'administrateur (par lots de 49 copies cachées, chaque lot marqué dès qu'il est parti).
 */
export async function openMailing(ctx) {
  let m;
  try {
    m = await adminApi.mailing(ctx.adminSession);
  } catch (err) {
    return toast(err instanceof TcgError ? err.message : 'Administration indisponible pour l’instant.', 'alert');
  }
  const body = h('div.tml');
  const s = sheet('mailing', 'Mails d’accord', [h('p.tk', { text: 'Administration' }), h('h2.tdet-h', { text: 'Mails d’accord' }), body]);
  const draw = () => {
    const n = m.targets.length;
    const stats = h('div.tml-stats', {}, stat(n, 'à prévenir'), stat(m.waiting, 'sans réponse'), stat(m.ok, 'd’accord'), stat(m.no, 'refus'));
    const last = m.last ? `Dernier envoi le ${dayLong(m.last)} à ${hourText(m.last)}.` : 'Aucun mail envoyé pour l’instant.';
    // Une personne prévenue il y a moins de 24 h attend : elle n'est pas dans la liste.
    const held = m.held ? ` ${plural(m.held, 'personne')} déjà ${m.held > 1 ? 'prévenues' : 'prévenue'} il y a moins de 24 h ${m.held > 1 ? 'attendent' : 'attend'} (à partir du ${dayLong(m.next)} à ${hourText(m.next)}).` : '';
    const when = h('p.tml-when', {}, ic('clock'), last + held);
    const parts = [stats, when];
    if (n) {
      const lots = Math.ceil(n / m.chunk);
      parts.push(
        h('p.thelp', {
          text: `Un mail depuis ta messagerie${lots > 1 ? ` (en ${lots} envois de ${m.chunk} au plus)` : ''}, adressé à toi-même avec ${plural(n, 'personne')} en copie cachée : personne ne voit les autres adresses. Chacune ne recevra ce mail qu’une fois pour ces cartes.`,
        }),
        h('details.tml-who', {}, h('summary', { text: `Voir les ${plural(n, 'adresse')}` }), h('ul', {}, ...m.targets.map((t) => h('li', {}, h('span', { text: t.email }), h('small', { text: plural(t.cards, 'carte') }))))),
        h('details.tml-who', {}, h('summary', { text: 'Voir le mail' }), h('p.tml-subj', { text: MAIL_SUBJECT }), h('pre.tml-text', { text: mailText(ctx.userName()) })),
      );
    }
    const send = tbtn(n ? `Envoyer les mails (${n})` : 'Rien à envoyer', 'send', 'tbtn--primary tbtn--lg', () => run(send));
    send.disabled = !n;
    parts.push(send);
    body.replaceChildren(...parts);
  };
  const run = async (btn) => {
    const me = ctx.userEmail();
    if (!me) return toast('Ta messagerie n’est pas ouverte : ouvre tes mails dans le Hub, puis réessaie.', 'alert');
    if (!confirm(`Envoyer le mail d’accord depuis ta messagerie à ${plural(m.targets.length, 'personne')}, en copie cachée ?`)) return;
    btn.disabled = true;
    const label = btn.querySelector('span');
    try {
      const sent = await sendConsentMails({
        m,
        me,
        name: ctx.userName(),
        send: ctx.sendMail,
        markSent: (keys) => adminApi.mailingSent(keys, true, ctx.adminSession),
        onProgress: (n, total) => (label.textContent = `Envoi… ${n} / ${total}`),
      });
      toast(`Mail envoyé à ${plural(sent, 'personne')}, en copie cachée.`, 'check');
    } catch (err) {
      toast(err?.message || 'Envoi impossible pour l’instant.', 'alert');
    }
    try {
      m = await adminApi.mailing(ctx.adminSession);
    } catch {
      /* garde l'affichage */
    }
    ctx.setMailing?.(m);
    draw();
  };
  draw();
  ctx.setMailing?.(m);
  return s;
}

const stat = (n, label) => h('div.tml-stat', {}, h('b', { text: String(n) }), h('span', { text: label }));
