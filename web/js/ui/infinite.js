// Connexion infinie : case du formulaire, fiche d'explication et d'activation, carte « Continuer »
// de l'écran de connexion, désactivation. La cryptographie est dans net/passkey.js ; ici, l'ordre
// des gestes et ce qui est dit à l'étudiant.
//
// Règles :
//   - rien n'est activé sans avoir lu la fiche et coché « J'ai lu et compris » ;
//   - chaque appel à la passkey part d'un appui de l'étudiant sur un bouton de cette page ;
//   - la clé est créée PUIS vérifiée (second appel) avant de chiffrer quoi que ce soit : ce qui est
//     gardé s'ouvre donc exactement comme au déverrouillage ;
//   - le mot de passe n'est chiffré qu'après une connexion acceptée par le CAS, puis oublié ;
//   - toute anomalie (copie illisible, mauvaise clé, autre site, utilisateur non vérifié, 90 jours
//     sans usage, mot de passe changé) efface la connexion infinie : retour au mot de passe.

import { $, $$, toast } from '../core/dom.js';
import { modal } from './layout.js';
import { createPasskeys, availability, unlockName, InfiniteError } from '../net/passkey.js';

const MESSAGES = {
  unsupported:
    'Cet appareil ou ce navigateur ne sait pas protéger un mot de passe avec une passkey (il faut iOS 18.4 ou plus récent, Android avec Chrome, Windows 11 à jour, ou un Mac récent). Rien n’a été activé.',
  cancelled: 'Annulé, ou délai dépassé. Rien n’a été activé.',
  'not-verified': 'L’appareil n’a pas vérifié ton identité (visage, empreinte ou code) : refusé par sécurité.',
  'wrong-key': 'L’appareil a répondu avec une autre clé : refusé par sécurité.',
  'wrong-site': 'La réponse de l’appareil ne concerne pas ce site : refusé par sécurité.',
  damaged: 'La copie chiffrée de cet appareil était illisible : elle a été effacée par sécurité.',
  expired: 'Connexion infinie inutilisée depuis 90 jours : effacée par sécurité.',
  invalid: 'Identifiant ou mot de passe inattendu : rien n’a été gardé.',
};
const say = (err) => MESSAGES[err?.code] ?? MESSAGES.unsupported;

export async function setupInfinite({ vault, onUnlock }) {
  const pk = createPasskeys();
  const name = unlockName();
  const card = $('[data-infinite-card]');
  const cardStatus = $('[data-infinite-card-status]');
  const unlockBtn = $('[data-infinite-unlock]');
  const opt = $('[data-infinite-opt]');
  const box = $('[data-infinite]');
  const menuItem = $('[data-infinite-menu]');
  const dialog = $('dialog[data-infinite-sheet]');
  const ack = $('[data-inf-ack]', dialog);
  const next = $('[data-inf-next]', dialog);
  const cancel = $('[data-inf-cancel]', dialog);
  const status = $('[data-inf-status]', dialog);
  const text = $('[data-inf-text]', dialog);

  $$('[data-unlock-name]').forEach((el) => (el.textContent = name));
  $('[data-infinite-unlock-label]').textContent = `Continuer avec ${name}`;

  let support = vault.canKeepOnDevice ? await availability() : 'unsupported';
  let blob = null; // copie gardée (chiffrée par la passkey, puis par le coffre de l'appareil)
  let pending = null; // { id, salt, key } : clé vérifiée, en attente du mot de passe
  let created = null; // { id, salt } : clé créée, pas encore vérifiée
  let pendingTimer = 0; // efface `pending` resté inutilisé
  let step = 'read';
  let busy = false;
  let notice = '';

  // Copie relue au démarrage : format strict et 90 jours au plus sans usage, sinon effacée.
  try {
    const saved = await vault.loadInfinite();
    if (saved) {
      if (pk.expired(pk.parse(saved))) throw new InfiniteError('expired');
      blob = saved;
    }
  } catch (err) {
    notice = say(err);
    await vault.forgetInfinite();
  }

  function render() {
    card.hidden = !blob;
    opt.hidden = Boolean(blob) || support === 'unsupported';
    menuItem.hidden = !blob;
    if (!pending) box.checked = false;
  }

  function showCard(message, error = false) {
    cardStatus.hidden = !message;
    cardStatus.textContent = message ?? '';
    cardStatus.classList.toggle('is-error', error);
  }

  /** Efface tout : copie de l'appareil, clé en attente ; la passkey est signalée comme inutile. */
  async function disable() {
    const id = blob ? (() => { try { return pk.idOf(blob); } catch { return null; } })() : null;
    blob = null;
    drop();
    await vault.forgetInfinite();
    if (id) pk.forget(id);
    render();
  }

  /** Abandon avant d'avoir rien chiffré : la passkey créée pour rien est signalée inutile. */
  function drop() {
    clearTimeout(pendingTimer);
    const unused = created ?? pending;
    if (unused) pk.forget(unused.id);
    created = null;
    pending = null;
  }

  // Clé vérifiée mais pas encore utilisée (case cochée, connexion pas faite) : oubliée après 10 min.
  function armPending() {
    clearTimeout(pendingTimer);
    pendingTimer = setTimeout(() => {
      if (!pending) return;
      drop();
      render();
    }, 10 * 60_000);
  }

  // ------------------------------------------------------------- fiche d'activation

  const sheet = modal(dialog, {
    onClose() {
      if (step !== 'done') drop();
      box.checked = Boolean(pending);
      render();
    },
  });

  function show(nextStep, message = '', error = false) {
    step = nextStep;
    for (const sec of $$('[data-inf-step]', dialog)) sec.hidden = !sec.dataset.infStep.split(' ').includes(step);
    const order = ['create', 'confirm', 'done'];
    for (const li of $$('[data-inf-dot]', dialog)) {
      const k = order.indexOf(li.dataset.infDot);
      const at = order.indexOf(step);
      li.classList.toggle('is-done', k < at || step === 'done');
      li.classList.toggle('is-current', k === at && step !== 'done');
    }
    text.textContent = {
      create: `Ton appareil va te demander ${name} pour créer la clé d’ISIS Hub. Elle reste dans sa puce sécurisée.`,
      confirm: `Clé créée. Confirme une fois avec ${name} : ISIS Hub vérifie que la clé protège bien ton mot de passe avant de s’en servir.`,
      done: 'Tout est prêt. Connecte-toi avec ton mot de passe : il sera chiffré par cette clé, sur cet appareil seulement. Ensuite, tu n’auras plus à le retaper.',
    }[step] ?? '';
    status.hidden = !message;
    status.textContent = message;
    status.classList.toggle('is-error', error);
    cancel.hidden = step === 'done';
    next.textContent = { read: 'Créer ma clé', create: `Créer ma clé avec ${name}`, confirm: `Confirmer avec ${name}`, done: 'Continuer' }[step];
    next.disabled = busy || (step === 'read' && !ack.checked) || (step === 'failed');
    if (step === 'failed') {
      next.textContent = 'Fermer';
      next.disabled = false;
    }
  }

  function openSheet() {
    drop();
    ack.checked = false;
    show('read');
    sheet.open();
  }

  ack.addEventListener('change', () => show(step));
  cancel.addEventListener('click', () => sheet.close());

  next.addEventListener('click', async () => {
    if (busy) return;
    if (step === 'done' || step === 'failed') return sheet.close();
    if (step === 'read') return show('create');
    busy = true;
    next.disabled = true;
    try {
      if (step === 'create') {
        created = await pk.createKey();
        busy = false;
        show('confirm');
      } else if (step === 'confirm') {
        const key = await pk.unlockKey(created);
        pending = { ...created, key };
        created = null;
        armPending();
        busy = false;
        show('done');
      }
    } catch (err) {
      busy = false;
      if (err?.code === 'cancelled') return show(step, MESSAGES.cancelled, true); // on peut réessayer
      drop();
      if (err?.code === 'unsupported') support = 'unsupported';
      show('failed', say(err), true);
    }
  });

  // Cocher ouvre la fiche : la case ne reste cochée qu'une fois la clé créée et vérifiée.
  box.addEventListener('change', () => {
    if (box.checked) {
      box.checked = false;
      openSheet();
    } else drop();
  });

  // ------------------------------------------------------------- reprise et désactivation

  unlockBtn.addEventListener('click', async () => {
    if (busy || !blob) return;
    busy = true;
    unlockBtn.disabled = true;
    showCard(`${name}…`);
    try {
      const { username, password } = await pk.unlock(blob);
      showCard('Connexion chiffrée à l’université…');
      await onUnlock(username, password);
      blob = { ...blob, last: Date.now() }; // dernier usage : repousse l'effacement automatique
      await vault.saveInfinite(blob);
      showCard(null);
    } catch (err) {
      if (err instanceof InfiniteError) {
        if (err.code === 'cancelled') showCard(MESSAGES.cancelled.replace(' Rien n’a été activé.', ''), true);
        else {
          notice = say(err);
          await disable(); // la carte disparaît : le message passe par une notification
          toast(`${notice} Connecte-toi avec ton mot de passe.`, 'alert');
        }
      } else if (err?.name !== 'LoginRefused') showCard(`Connexion impossible : ${err?.message ?? 'erreur inconnue'}`, true);
    } finally {
      busy = false;
      unlockBtn.disabled = false;
    }
  });

  $('[data-infinite-off]').addEventListener('click', async () => {
    await disable();
    toast('Connexion infinie désactivée sur cet appareil.', 'lock');
  });
  menuItem.addEventListener('click', async () => {
    await disable();
    toast('Connexion infinie désactivée : ton mot de passe ne sera plus gardé sur cet appareil.', 'lock');
  });

  render();
  if (notice) setTimeout(() => toast(notice, 'lock'), 600); // effacée au démarrage : on le dit

  return {
    enabled: () => Boolean(blob),
    disable,
    /** Après une connexion par mot de passe acceptée par le CAS : chiffre et garde, si demandé. */
    async afterPasswordLogin(username, password) {
      if (!pending || !box.checked) return drop();
      const p = pending;
      pending = null;
      clearTimeout(pendingTimer);
      try {
        blob = await pk.seal(p.key, p, { username, password });
        await vault.saveInfinite(blob);
        notice = '';
        toast(`Connexion infinie activée : ${name} remplacera ton mot de passe sur cet appareil.`, 'lock');
      } catch (err) {
        blob = null;
        await vault.forgetInfinite();
        pk.forget(p.id);
        toast(say(err), 'alert');
      }
      render();
    },
    /** Mot de passe refusé par le CAS au déverrouillage : il a changé, tout est effacé. */
    async passwordChanged() {
      await disable();
    },
  };
}
