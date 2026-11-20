// Écran de connexion. Le mot de passe ne quitte ce formulaire que pour la requête chiffrée
// adressée au CAS ; le champ est vidé dès l'envoi et rien n'en est gardé.

import { $, $$, h, icon, restartClass, motionOK } from '../core/dom.js';

export function createLogin({ onSubmit, onSkip, onTransparency }) {
  const screen = $('[data-screen="login"]');
  const form = $('[data-login-form]', screen);
  const id = $('#login-id', screen);
  const pw = $('[data-pw]', screen);
  const err = $('[data-login-error]', screen);
  const errText = $('span', err);
  const typed = $('[data-typed]', screen);
  const hex = $('[data-hex]', screen);
  const toggle = $('[data-pw-toggle]', screen);
  const submit = $('[data-login-submit]', screen);
  const label = $('[data-submit-label]', submit);
  let plain = false;

  // ---- « Ce que tu tapes / ce que voit le relais » (illustration, rien n'est envoyé ici)
  const h2 = (n) => n.toString(16).padStart(2, '0');
  function renderTyped() {
    typed.replaceChildren(plain ? pw.value : '•'.repeat(pw.value.length), h('span.caret', { attrs: { 'aria-hidden': 'true' } }));
    typed.classList.toggle('is-plain', plain);
  }
  function renderHex() {
    const bytes = crypto.getRandomValues(new Uint8Array(44));
    const len = 0x4a + pw.value.length; // la longueur d'un enregistrement TLS suit la saisie
    const head = ['17', '03', '03', h2(len >> 8), h2(len & 255)];
    const make = () => [
      ...head.map((b) => h('span.h', { text: b })),
      ...[...bytes].map((b, k) => {
        const s = h('span', { text: h2(b) });
        if (motionOK()) {
          s.className = 'flip';
          s.style.setProperty('animation-delay', `${(k % 22) * 9}ms`);
        }
        return s;
      }),
    ];
    hex.classList.remove('hex-track--static');
    hex.replaceChildren(...make(), ...make());
  }
  pw.addEventListener('input', () => {
    renderTyped();
    renderHex();
  });
  toggle.addEventListener('click', () => {
    plain = !plain;
    pw.type = plain ? 'text' : 'password';
    toggle.setAttribute('aria-pressed', String(plain));
    toggle.setAttribute('aria-label', plain ? 'Masquer le mot de passe' : 'Afficher le mot de passe (sur cet écran seulement)');
    toggle.replaceChildren(icon(plain ? 'eyeOff' : 'eye'));
    renderTyped();
    pw.focus();
  });

  const detailsBtn = $('[data-details-toggle]', screen);
  const details = $('[data-details]', screen);
  detailsBtn.addEventListener('click', () => {
    const open = !details.classList.contains('is-open');
    details.classList.toggle('is-open', open);
    detailsBtn.setAttribute('aria-expanded', String(open));
    $('span', detailsBtn).textContent = open ? 'Masquer les détails' : 'Voir les détails techniques';
    if (open) setTimeout(() => details.scrollIntoView({ behavior: motionOK() ? 'smooth' : 'auto', block: 'nearest' }), 160);
  });

  // Caractères brouillés « vus par le relais » dans l'animation du tunnel.
  const scrambled = $$('[data-scramble]', screen);
  const CH = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789#$%&@!?*+=';
  let scrambleTimer = null;
  const scramble = (on) => {
    clearInterval(scrambleTimer);
    if (on && motionOK()) {
      scrambleTimer = setInterval(() => {
        for (const e of scrambled) e.textContent = Array.from({ length: 8 }, () => CH[Math.floor(Math.random() * CH.length)]).join('');
      }, 90);
    }
  };

  $('[data-skip-login]', screen).addEventListener('click', onSkip);
  $$('[data-open-transparence]', screen).forEach((b) => b.addEventListener('click', onTransparency));

  function busy(on) {
    submit.disabled = on;
    id.readOnly = pw.readOnly = on;
    $('.spinner', submit)?.remove();
    if (on) submit.prepend(h('span.spinner'));
    label.textContent = on ? 'Connexion chiffrée…' : 'Se connecter';
  }

  function showError(message) {
    errText.textContent = message;
    err.hidden = false;
    restartClass(err, 'alert--error');
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!form.reportValidity()) return;
    err.hidden = true;
    [id, pw].forEach((f) => f.removeAttribute('aria-invalid'));
    busy(true);
    const password = pw.value;
    try {
      await onSubmit(id.value.trim(), password);
      pw.value = '';
      renderTyped();
    } catch (error) {
      if (error.name === 'LoginRefused') {
        [id, pw].forEach((f) => f.setAttribute('aria-invalid', 'true'));
        showError(error.message);
        pw.value = '';
        renderTyped();
        pw.focus();
      } else showError(`Connexion impossible : ${error.message}`);
    } finally {
      busy(false);
    }
  });

  renderTyped();

  return {
    /** Étape affichée sur le bouton pendant la connexion (ex. « Récupération de tes données… »). */
    step: (text) => {
      if (submit.disabled) label.textContent = text;
    },
    show(message) {
      scramble(true);
      if (message) showError(message);
      else err.hidden = true;
      setTimeout(() => (id.value ? pw : id).focus({ preventScroll: true }), 60);
    },
    hide() {
      scramble(false);
      pw.value = '';
      renderTyped();
    },
    setVersion(text) {
      $('[data-version-hint]', screen).textContent = text;
    },
  };
}
