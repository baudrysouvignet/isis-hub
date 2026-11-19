// « Une idée ? » : propositions et bugs envoyés à l'équipe ISIS Hub.
// Seule donnée du serveur qui peut être reliée à quelqu'un (si « Envoyer anonymement » n'est pas
// coché). Pas de compte : à l'envoi, le serveur rend un jeton secret, gardé par la page (dans la
// sauvegarde chiffrée si l'étudiant est connecté), qui permet de retrouver ses propositions.

import { $, $$, h, icon, restartClass, motionOK, EASE } from '../core/dom.js';
import { prefs } from '../core/store.js';
import * as UD from '../core/userdata.js';
import { modal } from './layout.js';

const TYPE = { idea: 'Idée', better: 'Amélioration', bug: 'Bug', other: 'Autre' };
const STATUS = { new: 'Nouveau', review: 'À l’étude', planned: 'Planifié', done: 'Fait', declined: 'Refusé' };
const dateFmt = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short' });

async function post(path, body) {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    credentials: 'omit',
    cache: 'no-store',
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

export function setupFeedback({ username, version }) {
  const dialog = $('[data-feedback]');
  const form = $('[data-fb-form]', dialog);
  const sent = $('[data-fb-sent]', dialog);
  const mine = $('[data-fb-mine]', dialog);
  const list = $('[data-fbm-list]', dialog);
  const tabs = $('.fb-tabs', dialog);
  const err = $('[data-fb-error]', dialog);
  const title = $('#fb-title-in', dialog);
  const desc = $('#fb-desc', dialog);
  const submit = $('[data-fb-submit]', dialog);
  const label = $('[data-fb-label]', dialog);
  const mineCount = $('[data-fb-mine-n]', dialog);

  // Jetons « Mes propositions » : dans la sauvegarde chiffrée pour un étudiant connecté (retrouvés
  // sur ses appareils, effacés de l'appareil à la déconnexion), sinon dans le navigateur.
  const valid = (list) => (Array.isArray(list) ? list : []).filter((t) => t && typeof t.token === 'string');
  const tokens = () => {
    const seen = new Set();
    return [...valid(UD.get('feedback')), ...valid(prefs.get('feedback', []))].filter((t) => !seen.has(t.token) && seen.add(t.token));
  };
  const showCount = () => {
    const n = tokens().length;
    mineCount.textContent = n ? ` · ${n}` : '';
  };
  // Connecté (sauvegarde lue) : les propositions suivies dans le navigateur (envoyées avant la 1.0.6
  // ou sans connexion sur cet appareil) rejoignent la sauvegarde chiffrée. Elles suivent alors
  // l'étudiant sur tous ses appareils et ne restent plus dans le navigateur.
  function adopt() {
    const local = valid(prefs.get('feedback', []));
    if (!local.length || !UD.isReady()) return;
    const saved = valid(UD.get('feedback'));
    const known = new Set(saved.map((t) => t.token));
    UD.set('feedback', [...saved, ...local.filter((t) => !known.has(t.token))].slice(-50));
    prefs.set('feedback', null);
  }
  UD.onSyncStatus((status) => {
    if (status === 'ok') adopt();
    showCount();
  });
  UD.onUserData((touched) => touched.includes('feedback') && showCount());

  const ua = navigator.userAgent;
  const browser =
    /Edg\/(\d+)/.exec(ua)?.[0].replace('Edg/', 'Edge ') ||
    /Firefox\/(\d+)/.exec(ua)?.[0].replace('/', ' ') ||
    /Chrome\/(\d+)/.exec(ua)?.[0].replace('/', ' ') ||
    (/Version\/(\d+).*Safari/.exec(ua) && `Safari ${/Version\/(\d+)/.exec(ua)[1]}`) ||
    'Navigateur';
  const tech = () => `${browser} · écran ${innerWidth} × ${innerHeight} · ${version()}`;

  function reset() {
    form.reset();
    err.hidden = true;
    [title, desc].forEach((f) => f.removeAttribute('aria-invalid'));
    $$('[data-count-for]', dialog).forEach((c) => {
      c.textContent = `0 / ${$(`#${c.dataset.countFor}`, dialog).maxLength}`;
      c.classList.remove('is-near');
    });
    sent.hidden = true;
    form.hidden = !mine.hidden;
  }

  function setTab(which) {
    const isMine = which === 'mine';
    tabs.dataset.active = isMine ? 'week' : 'day';
    $$('[data-fb-tab]', dialog).forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.fbTab === which)));
    mine.hidden = !isMine;
    form.hidden = isMine || !sent.hidden;
    if (isMine) {
      sent.hidden = true;
      loadMine();
    }
    if (motionOK()) (isMine ? mine : form).animate([{ opacity: 0, transform: 'translateY(6px)' }, { opacity: 1, transform: 'none' }], { duration: 260, easing: EASE });
  }

  async function loadMine() {
    adopt();
    const own = tokens();
    if (!own.length) {
      list.replaceChildren(h('li.cs-none', { text: UD.isConnected() ? 'Tu n’as encore rien proposé.' : 'Tu n’as encore rien proposé depuis cet appareil.' }));
      return;
    }
    list.replaceChildren(h('li.cs-none', {}, h('span.spinner'), ' Chargement…'));
    try {
      const items = await post('api/feedback/mine', { tokens: own.map((t) => t.token) });
      list.replaceChildren(
        ...items.map((f) =>
          h(
            'li.fbm',
            {},
            h('div.fbm-top', {}, h('span.status', { class: `status--${f.status}`, text: STATUS[f.status] ?? f.status }), h('span.fbm-meta', { text: `#${f.id} · ${TYPE[f.type] ?? ''} · ${dateFmt.format(new Date(f.created))}` })),
            h('b', { text: f.title }),
            f.reply && h('p.fbm-reply', {}, icon('book', 'ic ic--sm'), h('span', {}, h('em', { text: 'Équipe ISIS Hub : ' }), f.reply)),
          ),
        ),
      );
      if (!items.length) list.replaceChildren(h('li.cs-none', { text: 'Aucune proposition retrouvée.' }));
    } catch (e) {
      list.replaceChildren(h('li.cs-none', { text: `Propositions indisponibles : ${e.message}` }));
    }
  }

  const sheet = modal(dialog, {
    onOpen() {
      $('[data-fb-tech-preview]', dialog).textContent = `${tech()}. Utile pour un bug.`;
      showCount();
      setTimeout(() => !form.hidden && title.focus(), 60);
    },
    onClose() {
      if (!sent.hidden) reset();
    },
  });
  $$('[data-open-feedback]').forEach((b) => b.addEventListener('click', sheet.open));
  $$('[data-fb-tab]', dialog).forEach((b) => b.addEventListener('click', () => setTab(b.dataset.fbTab)));
  $$('[data-count-for]', dialog).forEach((c) => {
    const field = $(`#${c.dataset.countFor}`, dialog);
    field.addEventListener('input', () => {
      c.textContent = `${field.value.length} / ${field.maxLength}`;
      c.classList.toggle('is-near', field.value.length > field.maxLength * 0.9);
      if (field.value.trim()) field.removeAttribute('aria-invalid');
    });
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const missing = [title, desc].filter((f) => !f.value.trim());
    missing.forEach((f) => f.setAttribute('aria-invalid', 'true'));
    if (missing.length) {
      $('span', err).textContent = 'Donne au moins un titre et une description.';
      err.hidden = false;
      restartClass(err, 'alert--error');
      missing[0].focus();
      return;
    }
    err.hidden = true;
    submit.disabled = true;
    label.textContent = 'Envoi…';
    const data = new FormData(form);
    try {
      const anonymous = $('[data-fb-anon]', form).checked;
      const res = await post('api/feedback', {
        type: data.get('type'),
        zone: data.get('zone'),
        title: title.value,
        desc: desc.value,
        tech: $('[data-fb-tech]', form).checked ? tech() : '',
        author: anonymous ? '' : username() || '',
      });
      const mine = { id: res.id, token: res.token };
      if (UD.isConnected()) UD.set('feedback', [...valid(UD.get('feedback')), mine].slice(-50));
      else prefs.set('feedback', [...valid(prefs.get('feedback', [])), mine].slice(-50));
      showCount();
      $('[data-fb-ref]', dialog).textContent = `#${res.id}`;
      form.hidden = true;
      sent.hidden = false;
      $('[data-fb-again]', dialog).focus();
    } catch (ex) {
      $('span', err).textContent = `Envoi impossible : ${ex.message}`;
      err.hidden = false;
    } finally {
      submit.disabled = false;
      label.textContent = 'Envoyer';
    }
  });
  $('[data-fb-again]', dialog).addEventListener('click', () => {
    reset();
    title.focus();
  });

  return sheet;
}
