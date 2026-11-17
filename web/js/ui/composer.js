// Écrire, répondre, transférer, avec l'annuaire partagé de la messagerie.
// Le message part par la messagerie universitaire de l'étudiant, à travers le tunnel chiffré :
// ISIS Hub ne voit ni le texte, ni les pièces jointes, ni les destinataires.

import { $, $$, h, icon, lockScroll, motionOK, toast, EASE, EASE_IO } from '../core/dom.js';
import * as D from '../core/dates.js';
import * as mail from '../portals/mail.js';
import { normalize } from '../portals/match.js';
import { modal } from './layout.js';

const kb = (n) => (n > 1048576 ? `${(n / 1048576).toFixed(1)} Mo` : `${Math.max(1, Math.round(n / 1024))} Ko`);
const initials = (name) =>
  name
    .split(/[\s@._-]+/)
    .filter((w) => /\p{L}/u.test(w))
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join('') || '?';
const avatarClass = (text) => `av-${([...text].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7) % 6) + 1}`;
const CAT_LABEL = { staff: 'Personnel', etud: 'Étudiant', liste: 'Liste de diffusion', recent: 'Écrit récemment' };

export function createComposer({ app, onSessionLost }) {
  const comp = $('[data-composer]');
  const form = $('[data-cmp-form]', comp);
  const ac = $('[data-ac]', comp);
  const subject = $('[data-cmp-subject]', comp);
  const text = $('[data-cmp-text]', comp);
  const quote = $('[data-cmp-quote]', comp);
  const ccRow = $('[data-cc-row]', comp);
  const ccBtn = $('[data-cc-toggle]', comp);
  const filesBox = $('[data-cmp-files]', comp);
  const fileInput = $('[data-cmp-file]', comp);
  const error = $('[data-cmp-error]', comp);
  const sendBtn = $('[data-cmp-send]', comp);
  const boxes = { to: $('[data-recips="to"]', comp), cc: $('[data-recips="cc"]', comp) };

  let files = []; // { name, type, size, bytes?, source? }
  let context = {}; // { inReplyTo, references, quoted, forwardOf }
  let acState = { items: [], index: -1, input: null, box: null };
  let searchTimer = null;
  let searchToken = 0;

  // ------------------------------------------------------------ destinataires

  const chips = (box) => $$('.rchip', box).map((c) => ({ address: c.dataset.email, name: c.dataset.name }));

  function addChip(box, person) {
    const address = person.email.toLowerCase();
    if (chips(box).some((c) => c.address === address)) return;
    const name = person.name || address;
    const chip = h(
      'span.rchip',
      { title: address, data: { email: address, name } },
      h('span.avatar', { class: avatarClass(address), text: initials(name) }),
      name,
      h('button', {
        type: 'button',
        text: '×',
        attrs: { 'aria-label': `Retirer ${name}` },
        on: { click: () => (chip.remove(), $('[data-recip-input]', box).focus()) },
      }),
    );
    box.insertBefore(chip, $('[data-recip-input]', box));
  }

  function closeAc() {
    ac.hidden = true;
    acState = { items: [], index: -1, input: null, box: null };
    $$('[data-recip-input]', comp).forEach((i) => i.setAttribute('aria-expanded', 'false'));
  }

  function renderAc(input, box, items, note) {
    acState = { items, index: items.length ? 0 : -1, input, box };
    ac.replaceChildren(
      ...items.map((p, k) =>
        h(
          'li.ac-item',
          {
            id: `ac-${k}`,
            attrs: { role: 'option', 'aria-selected': String(k === 0) },
            on: {
              mousedown: (e) => {
                e.preventDefault();
                addChip(box, p);
                input.value = '';
                closeAc();
                input.focus();
              },
            },
          },
          h('span.avatar', { class: avatarClass(p.email), text: initials(p.name) }),
          h('span.link-txt', {}, h('b', { text: p.name }), h('span', { text: `${CAT_LABEL[p.cat] ?? ''} · ${p.email}` })),
          p.cat === 'recent' ? h('span.ac-recent', { attrs: { 'aria-hidden': 'true' } }, icon('clock', 'ic ic--xs')) : null,
        ),
      ),
    );
    if (!items.length) ac.replaceChildren(h('li.ac-item', {}, h('span.cs-none', { text: note })));
    ac.hidden = false;
    input.setAttribute('aria-expanded', 'true');
  }

  /** Destinataires récents (boîte « Envoyés ») qui correspondent à ce qui est tapé. */
  let recents = [];
  const loadRecents = () =>
    mail
      .recentRecipients()
      .then((list) => (recents = list))
      .catch(() => (recents = []));
  function recentMatches(q, box) {
    const n = normalize(q);
    return recents.filter((p) => !chips(box).some((c) => c.address === p.email) && (!n || normalize(`${p.name} ${p.email}`).includes(n)));
  }

  function suggest(input, box) {
    const q = input.value.trim();
    clearTimeout(searchTimer);
    // Champ vide ou une lettre : les dernières personnes à qui l'étudiant a écrit, en premier.
    if (q.length < 2) {
      const mine = recentMatches(q, box).slice(0, 6);
      return mine.length && document.activeElement === input ? renderAc(input, box, mine, '') : closeAc();
    }
    const token = ++searchToken;
    searchTimer = setTimeout(async () => {
      try {
        const mine = recentMatches(q, box).slice(0, 4);
        const dir = (await mail.searchContacts(q, 8)).filter((p) => !chips(box).some((c) => c.address === p.email) && !mine.some((r) => r.email === p.email));
        const found = [...mine, ...dir].slice(0, 10);
        if (token !== searchToken || input.value.trim() !== q) return;
        renderAc(input, box, found, /@/.test(q) ? 'Entrée pour ajouter cette adresse' : 'Aucun contact trouvé');
      } catch (err) {
        if (token === searchToken) renderAc(input, box, [], `Annuaire indisponible (${err.message})`);
      }
    }, 220);
  }

  for (const box of Object.values(boxes)) {
    const input = $('[data-recip-input]', box);
    input.addEventListener('input', () => suggest(input, box));
    input.addEventListener('focus', () => !input.value && suggest(input, box));
    input.addEventListener('blur', () => setTimeout(closeAc, 150));
    input.addEventListener('keydown', (e) => {
      const { items } = acState;
      if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && items.length) {
        e.preventDefault();
        acState.index = (acState.index + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
        $$('.ac-item', ac).forEach((x, k) => x.setAttribute('aria-selected', String(k === acState.index)));
        input.setAttribute('aria-activedescendant', `ac-${acState.index}`);
      }
      if (e.key === 'Enter' || e.key === ',' || e.key === ';') {
        const v = input.value.trim();
        if (!v) return;
        e.preventDefault();
        if (acState.index >= 0 && items[acState.index]) addChip(box, items[acState.index]);
        else if (mail.EMAIL_RE.test(v)) addChip(box, { email: v, name: v });
        else return;
        input.value = '';
        closeAc();
      }
      if (e.key === 'Backspace' && !input.value) $$('.rchip', box).pop()?.remove();
      if (e.key === 'Escape' && !ac.hidden) {
        e.stopPropagation();
        closeAc();
      }
    });
    box.addEventListener('click', (e) => e.target === box && input.focus());
  }
  ccBtn.addEventListener('click', () => {
    ccRow.hidden = !ccRow.hidden;
    ccBtn.setAttribute('aria-pressed', String(!ccRow.hidden));
    if (!ccRow.hidden) $('input', ccRow).focus();
  });

  // ------------------------------------------------------------ pièces jointes

  function renderFiles() {
    filesBox.hidden = !files.length;
    filesBox.replaceChildren(
      ...files.map((f, i) =>
        h(
          'span.cmp-file',
          {},
          icon('clip', 'ic ic--sm'),
          h('span', { text: f.name }),
          h('small', { text: f.source ? `${kb(f.size)} · d’origine` : kb(f.size) }),
          h('button', {
            type: 'button',
            text: '×',
            attrs: { 'aria-label': `Retirer ${f.name}` },
            on: { click: () => (files.splice(i, 1), renderFiles()) },
          }),
        ),
      ),
    );
  }
  async function addFiles(list) {
    for (const file of list) {
      if (!file.size && !file.type) continue; // dossier glissé : ignoré
      const total = files.reduce((n, f) => n + f.size, 0) + file.size;
      if (total > mail.MAX_ATTACHMENTS) {
        toast(`« ${file.name} » dépasse la limite de 15 Mo de pièces jointes.`);
        continue;
      }
      files.push({ name: file.name, type: file.type, size: file.size, bytes: new Uint8Array(await file.arrayBuffer()) });
    }
    renderFiles();
  }
  $('[data-cmp-attach]', comp).addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', async () => {
    await addFiles([...fileInput.files]);
    fileInput.value = '';
  });
  // Glisser des fichiers n'importe où sur le message les ajoute en pièces jointes.
  const hasFiles = (e) => [...(e.dataTransfer?.types ?? [])].includes('Files');
  let dragDepth = 0;
  comp.addEventListener('dragenter', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    dragDepth++;
    comp.classList.add('is-dropping');
  });
  comp.addEventListener('dragover', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  });
  comp.addEventListener('dragleave', () => {
    if (--dragDepth <= 0) {
      dragDepth = 0;
      comp.classList.toggle('is-dropping', false);
    }
  });
  comp.addEventListener('drop', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    dragDepth = 0;
    comp.classList.toggle('is-dropping', false);
    addFiles([...e.dataTransfer.files]);
  });
  // Un fichier lâché à côté ne doit pas remplacer la page (le navigateur l'ouvrirait).
  addEventListener('dragover', (e) => !comp.hidden && hasFiles(e) && e.preventDefault());
  addEventListener('drop', (e) => !comp.hidden && hasFiles(e) && e.preventDefault());

  // ------------------------------------------------------------ affichage

  const reader = $('[data-reader]');
  function show() {
    comp.hidden = false;
    app.classList.add('has-overlay');
    $('[data-bento]').inert = true;
    lockScroll(true);
    if (motionOK()) comp.animate([{ opacity: 0, transform: 'translateY(24px) scale(.985)' }, { opacity: 1, transform: 'none' }], { duration: 380, easing: EASE });
  }
  function hide() {
    const done = () => {
      comp.hidden = true;
      files = [];
      if (reader.hidden) {
        app.classList.remove('has-overlay');
        $('[data-bento]').inert = false;
        if (!app.classList.contains('has-expanded')) lockScroll(false); // messagerie plein écran : reste figée
      }
    };
    if (motionOK()) comp.animate([{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'translateY(24px) scale(.985)' }], { duration: 260, easing: EASE_IO }).onfinish = done;
    else done();
  }
  const dirty = () => text.value.trim() || subject.value.trim() || files.some((f) => !f.source) || chips(boxes.to).length;
  function close() {
    if (comp.hidden) return;
    if (dirty() && !confirm('Abandonner ce message ?')) return;
    hide();
  }
  $$('[data-cmp-close]', comp).forEach((b) => b.addEventListener('click', close));
  comp.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && ac.hidden && !document.querySelector('dialog[open]')) {
      e.stopPropagation();
      close();
    }
  });

  /** Ouvre l'éditeur. `to`, `cc` : [{ email, name }]. */
  async function open({ to = [], cc = [], subject: subj = '', body = '', quoted = null, title = 'Nouveau message', inReplyTo = null, references = [], forwardOf = null, focusRecipient = '' } = {}) {
    $$('.rchip', comp).forEach((c) => c.remove());
    to.forEach((p) => addChip(boxes.to, p));
    cc.forEach((p) => addChip(boxes.cc, p));
    ccRow.hidden = !cc.length;
    ccBtn.setAttribute('aria-pressed', String(Boolean(cc.length)));
    subject.value = subj;
    text.value = body;
    error.hidden = true;
    quote.hidden = !quoted;
    if (quoted) quote.replaceChildren(h('p.cmp-quote-head', { text: quoted.head }), ...quoted.lines.map((l) => h('p', { text: l || ' ' })));
    $('[data-cmp-title]', comp).textContent = title;
    context = { inReplyTo, references, quoted, forwardOf };
    files = [];
    if (forwardOf) {
      files = mail.attachmentParts(forwardOf.structure).map((p) => ({ name: p.fileName || 'pièce jointe', type: p.mime, size: p.size ?? 0, source: p }));
    }
    renderFiles();
    show();
    loadRecents();
    try {
      const from = await mail.me();
      $('[data-cmp-from]', comp).textContent = `Envoyé par ta messagerie universitaire (${from.address}), via le tunnel chiffré.`;
    } catch {}
    setTimeout(() => {
      const input = $('[data-recip-input]', boxes.to);
      if (focusRecipient) {
        input.value = focusRecipient;
        input.focus();
        suggest(input, boxes.to);
      } else (to.length ? text : input).focus();
      if (to.length && !focusRecipient) text.setSelectionRange(0, 0);
    }, 60);
  }

  // ------------------------------------------------------------ envoi

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    // Une adresse tapée sans valider (Entrée) est ajoutée aussi.
    for (const box of Object.values(boxes)) {
      const input = $('[data-recip-input]', box);
      if (mail.EMAIL_RE.test(input.value.trim())) {
        addChip(box, { email: input.value.trim(), name: input.value.trim() });
        input.value = '';
      }
    }
    const to = chips(boxes.to);
    const cc = ccRow.hidden ? [] : chips(boxes.cc);
    error.hidden = true;
    if (!to.length) {
      $('[data-recip-input]', boxes.to).focus();
      error.textContent = 'Ajoute au moins un destinataire.';
      error.hidden = false;
      return;
    }
    if (!subject.value.trim() && !confirm('Envoyer sans objet ?')) return;

    sendBtn.disabled = true;
    const label = $('span', sendBtn);
    label.textContent = 'Envoi…';
    try {
      const ready = [];
      for (const f of files) {
        ready.push({ name: f.name, type: f.type, bytes: f.bytes ?? (await mail.partBytes(context.forwardOf, f.source)) });
      }
      let body = text.value;
      if (context.quoted) {
        body += `\n\n${context.quoted.head}\n${context.quoted.lines.map((l) => (context.forwardOf ? l : `> ${l}`)).join('\n')}`;
      }
      const result = await mail.send({ to, cc, subject: subject.value, text: body, files: ready, inReplyTo: context.inReplyTo, references: context.references });
      files = [];
      hide();
      const first = to[0].name || to[0].address;
      const who = to.length > 1 ? `${first} et ${to.length - 1} autre${to.length > 2 ? 's' : ''}` : first;
      toast(result.confirmed ? `Message envoyé à ${who}` : `Message confié à la messagerie pour ${who} (expédition en cours)`, 'check');
    } catch (err) {
      if (err.name === 'NotSignedIn') {
        hide();
        onSessionLost('mail');
        return;
      }
      error.textContent = `Envoi impossible : ${err.message}`;
      error.hidden = false;
    } finally {
      sendBtn.disabled = false;
      label.textContent = 'Envoyer';
    }
  });

  // ------------------------------------------------------------ annuaire partagé

  const dir = $('[data-dir]');
  const dirSheet = modal(dir);
  const dirList = $('[data-dir-list]', dir);
  const dirSearch = $('[data-dir-search]', dir);
  const dirCount = $('[data-dir-count]', dir);
  let picked = new Map();
  let results = [];
  let dirToken = 0;
  let dirTimer = null;

  function renderDir() {
    const cat = $('[data-dir-cat]:checked', dir)?.value ?? 'all';
    const shown = results.filter((p) => cat === 'all' || p.cat === cat);
    if (dirSearch.value.trim().length < 2) {
      dirList.replaceChildren(h('li.course-empty', { text: 'Tape au moins deux lettres : nom, service ou adresse.' }));
    } else if (!shown.length) {
      dirList.replaceChildren(h('li.course-empty', { text: 'Aucun contact ne correspond.' }));
    } else {
      dirList.replaceChildren(
        ...shown.map((p) => {
          const on = picked.has(p.email);
          return h(
            'li',
            { data: { cat: p.cat } },
            h(
              'button.dir-item',
              {
                type: 'button',
                class: on ? 'is-picked' : '',
                attrs: { 'aria-pressed': String(on) },
                on: {
                  click: () => {
                    if (picked.has(p.email)) picked.delete(p.email);
                    else picked.set(p.email, p);
                    renderDir();
                  },
                },
              },
              h('span.avatar', { class: avatarClass(p.email), text: initials(p.name) }),
              h('span.link-txt', {}, h('b', { text: p.name }), h('span', { text: CAT_LABEL[p.cat] }), h('span.dir-mail', { text: p.email })),
              h('span.dir-check', {}, icon('check', 'ic ic--xs')),
            ),
          );
        }),
      );
    }
    dirCount.textContent = picked.size ? `${picked.size} destinataire${picked.size > 1 ? 's' : ''}` : 'Aucun destinataire';
  }

  dirSearch.addEventListener('input', () => {
    clearTimeout(dirTimer);
    const q = dirSearch.value.trim();
    if (q.length < 2) {
      results = [];
      return renderDir();
    }
    const token = ++dirToken;
    dirTimer = setTimeout(async () => {
      try {
        const found = await mail.searchContacts(q, 40);
        if (token === dirToken) {
          results = found;
          renderDir();
        }
      } catch (err) {
        if (token === dirToken) dirList.replaceChildren(h('li.course-empty', { text: `Annuaire indisponible : ${err.message}` }));
      }
    }, 250);
  });
  $$('[data-dir-cat]', dir).forEach((r) => r.addEventListener('change', renderDir));
  $$('[data-open-dir]', comp).forEach((b) =>
    b.addEventListener('click', () => {
      picked = new Map();
      results = [];
      dirSearch.value = '';
      renderDir();
      dirSheet.open();
      setTimeout(() => dirSearch.focus(), 60);
    }),
  );
  $('[data-dir-ok]', dir).addEventListener('click', () => {
    for (const p of picked.values()) addChip(boxes.to, p);
    dirSheet.close();
  });

  // ------------------------------------------------------------ réponses

  /** Prépare une réponse ou un transfert à partir d'un mail ouvert (avec son texte). */
  async function respond(kind, m, bodyText) {
    const strip = (s) => s.replace(/^((re|tr|fwd?)\s*:\s*)+/i, '');
    const me = await mail.me().catch(() => ({ address: '' }));
    const lines = (bodyText || m.preview || '').replace(/\r\n?/g, '\n').split('\n').slice(0, 400);
    const when = D.fullDate(m.date);
    const fromLabel = m.from.name && m.from.name !== m.from.address ? `${m.from.name} <${m.from.address}>` : m.from.address;
    const person = (p) => ({ email: p.address, name: p.name || p.address });
    if (kind === 'fwd') {
      return open({
        title: 'Transférer',
        subject: `Tr : ${strip(m.subject)}`,
        quoted: { head: `---------- Message transféré ----------\nDe : ${fromLabel}\nDate : ${when}\nObjet : ${m.subject}`, lines },
        forwardOf: m,
      });
    }
    const others = kind === 'all' ? [...m.to, ...m.cc].filter((p) => p.address && p.address.toLowerCase() !== me.address.toLowerCase() && p.address !== m.from.address) : [];
    return open({
      title: kind === 'all' ? 'Répondre à tous' : 'Répondre',
      to: m.from.address ? [person(m.from)] : [],
      cc: others.map(person),
      subject: `Re : ${strip(m.subject)}`,
      body: '\n\n',
      quoted: { head: `Le ${when}, ${fromLabel} a écrit :`, lines },
      inReplyTo: m.messageId,
      references: m.references,
    });
  }

  return { open, respond, close, isOpen: () => !comp.hidden };
}

export { normalize };
