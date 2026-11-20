// Connexion infinie : case du formulaire, fiche d'activation, carte « identifiant + passkey » de
// l'écran de connexion, désactivation. La cryptographie est dans net/passkey.js ; ici, l'ordre des
// gestes et ce qui est dit à l'étudiant.
//
// Règles :
//   - rien n'est activé sans la fiche, qui dit en une ligne pourquoi c'est plus risqué ;
//   - chaque appel à la passkey part d'un appui de l'étudiant sur un bouton de cette page ;
//   - la clé n'est gardée qu'après contrôle de la réponse de l'appareil (site, utilisateur
//     vérifié), dès la création si l'appareil le permet, sinon par un second geste ;
//   - le mot de passe n'est chiffré qu'après une connexion acceptée par le CAS, puis oublié ;
//   - « Se déconnecter » garde la connexion infinie (au retour : identifiant + passkey) ; elle
//     s'efface par « Désactiver », « Supprimer mes données », et d'elle-même à toute anomalie
//     (copie illisible, mauvaise clé, autre site, utilisateur non vérifié), mot de passe changé
//     ou 90 jours sans usage.

import { $, $$, toast } from '../core/dom.js';
import { modal } from './layout.js';
import { createPasskeys, availability, unlockName, InfiniteError } from '../net/passkey.js';

const MESSAGES = {
  unsupported:
    'Cet appareil ou ce navigateur ne sait pas verrouiller un mot de passe avec une passkey (il faut iOS 18.4 ou plus récent, Android avec Chrome, Windows 11 à jour ou un Mac récent).',
  cancelled: 'Annulé, ou délai dépassé.',
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
  const userEl = $('[data-infinite-user]');
  const back = $('[data-infinite-back]');
  const form = $('[data-login-form]');
  const opt = $('[data-infinite-opt]');
  const box = $('[data-infinite]');
  const menuItem = $('[data-infinite-menu]');
  const dialog = $('dialog[data-infinite-sheet]');
  const next = $('[data-inf-next]', dialog);
  const cancel = $('[data-inf-cancel]', dialog);
  const status = $('[data-inf-status]', dialog);

  $$('[data-unlock-name]').forEach((el) => (el.textContent = name));
  $('[data-infinite-unlock-label]').textContent = `Continuer avec ${name}`;

  let support = vault.canKeepOnDevice ? await availability() : 'unsupported';
  let blob = null; // copie gardée (chiffrée par la passkey, puis par le coffre de l'appareil)
  let pending = null; // { id, salt, key } : clé contrôlée, en attente du mot de passe
  let created = null; // { id, salt } : clé créée, à contrôler par un second geste
  let pendingTimer = 0; // efface `pending` resté inutilisé
  let mode = 'passkey'; // écran de connexion : 'passkey' (carte) ou 'password' (formulaire)
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
    const on = Boolean(blob);
    card.hidden = !on || mode === 'password';
    form.hidden = on && mode === 'passkey';
    back.hidden = !on || mode !== 'password';
    opt.hidden = on || support === 'unsupported';
    menuItem.hidden = !on;
    userEl.textContent = on ? pk.userOf(blob) : '';
    if (!pending) box.checked = false;
  }

  function showCard(message, error = false) {
    cardStatus.hidden = !message;
    cardStatus.textContent = message ?? '';
    cardStatus.classList.toggle('is-error', error);
  }

  /** Abandon avant d'avoir rien chiffré : la passkey créée pour rien est signalée inutile. */
  function drop() {
    clearTimeout(pendingTimer);
    const unused = created ?? pending;
    if (unused) pk.forget(unused.id);
    created = null;
    pending = null;
  }

  // Clé contrôlée mais pas encore utilisée (case cochée, connexion pas faite) : oubliée après 10 min.
  function armPending() {
    clearTimeout(pendingTimer);
    pendingTimer = setTimeout(() => {
      if (!pending) return;
      drop();
      render();
    }, 10 * 60_000);
  }

  /** Efface tout : copie de l'appareil, clé en attente ; la passkey est signalée comme inutile. */
  async function disable() {
    let id = null;
    try {
      id = blob ? pk.idOf(blob) : null;
    } catch {}
    blob = null;
    drop();
    mode = 'passkey';
    await vault.forgetInfinite();
    if (id) pk.forget(id);
    render();
  }

  // ------------------------------------------------------------- fiche d'activation

  const sheet = modal(dialog, {
    onClose() {
      if (!pending) drop();
      box.checked = Boolean(pending);
      render();
    },
  });

  function show(nextStep, message = '', error = false) {
    step = nextStep;
    status.hidden = !message;
    status.textContent = message;
    status.classList.toggle('is-error', error);
    cancel.hidden = step === 'failed';
    next.disabled = busy;
    next.textContent = step === 'confirm' ? `Confirmer avec ${name}` : step === 'failed' ? 'Fermer' : `Activer avec ${name}`;
  }

  function ready(meta) {
    pending = meta;
    created = null;
    armPending();
    sheet.close();
    box.checked = true;
    toast('C’est prêt : connecte-toi, ton mot de passe sera verrouillé sur cet appareil.', 'lock');
  }

  cancel.addEventListener('click', () => sheet.close());

  next.addEventListener('click', async () => {
    if (busy) return;
    if (step === 'failed') return sheet.close();
    busy = true;
    next.disabled = true;
    try {
      if (step === 'read') {
        const meta = await pk.createKey();
        busy = false;
        if (meta.key) ready(meta);
        else {
          created = meta;
          show('confirm', `Encore une fois ${name} : ISIS Hub vérifie la clé avant de s’en servir.`);
        }
      } else if (step === 'confirm') {
        const key = await pk.unlockKey(created);
        busy = false;
        ready({ ...created, key });
      }
    } catch (err) {
      busy = false;
      if (err?.code === 'cancelled') return show(step, MESSAGES.cancelled, true); // on peut réessayer
      drop();
      if (err?.code === 'unsupported') support = 'unsupported';
      show('failed', say(err), true);
    }
  });

  // Cocher ouvre la fiche : la case ne reste cochée qu'une fois la clé créée et contrôlée.
  box.addEventListener('change', () => {
    if (box.checked) {
      box.checked = false;
      drop();
      show('read');
      sheet.open();
    } else drop();
  });

  // ------------------------------------------------------------- écran de connexion

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
        if (err.code === 'cancelled') showCard(MESSAGES.cancelled, true);
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

  // « Me connecter avec mon mot de passe » : le formulaire, identifiant prérempli.
  $('[data-infinite-password]').addEventListener('click', () => {
    mode = 'password';
    showCard(null);
    render();
    const id = $('#login-id');
    if (!id.value && blob) id.value = pk.userOf(blob);
    (id.value ? $('[data-pw]') : id).focus();
  });
  back.addEventListener('click', () => {
    mode = 'passkey';
    render();
    unlockBtn.focus();
  });

  $('[data-infinite-off]').addEventListener('click', async () => {
    await disable();
    toast('Connexion infinie désactivée : ton mot de passe ne sera plus gardé sur cet appareil.', 'lock');
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
    /** Écran de connexion affiché : la carte « identifiant + passkey » d'abord. */
    loginShown() {
      mode = 'passkey';
      showCard(null);
      render();
    },
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
      mode = 'passkey';
      render();
    },
    /** Mot de passe refusé par le CAS au déverrouillage : il a changé, tout est effacé. */
    async passwordChanged() {
      await disable();
    },
  };
}
