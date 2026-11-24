// ISIS · TCG : créer une carte (atelier). La photo est recadrée dans la page au format de la carte
// (4:3) : on la fait glisser dans l'aperçu et on zoome. Elle part déjà compressée en deux tailles
// (960 × 720 et 320 × 240, WebP sinon JPEG) : redessinée sur un canevas, elle perd au passage ses
// métadonnées (position GPS, appareil…). Le serveur vérifie de nouveau tout cela.

import { h, toast, motionOK } from '../core/dom.js';
import { api, TcgError } from './api.js';
import { cardEl, ic, quota, tbtn, CATS, dayLong, dateShort, rchip, plural } from './ui.js';
import { peoplePicker } from './people.js';

const W = 960;
const H = 720;
const TW = 320;
const TH = 240;
const MAX = 380 * 1024;
const MAX_THUMB = 76 * 1024;

function canvas(w, hgt) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = hgt;
  return c;
}

const toBlob = (c, type, q) => new Promise((resolve) => c.toBlob(resolve, type, q));

/** Image compressée sous `max` octets : WebP si le navigateur sait le produire, sinon JPEG. */
async function encode(c, max) {
  for (const q of [0.84, 0.76, 0.68, 0.6, 0.5, 0.42]) {
    let b = await toBlob(c, 'image/webp', q);
    if (!b || b.type !== 'image/webp') b = await toBlob(c, 'image/jpeg', q);
    if (b && b.size <= max) return b;
  }
  throw new TcgError('Photo trop détaillée pour être compressée : essaie une autre photo.');
}

/** Recadrage : centre (cx, cy) dans l'image et zoom (1 = la plus grande zone 4:3 possible). */
function cropRect(img, s) {
  const iw = img.naturalWidth;
  const ih = img.naturalHeight;
  const baseW = iw / ih > W / H ? ih * (W / H) : iw;
  const baseH = baseW * (H / W);
  const cw = baseW / s.zoom;
  const ch = baseH / s.zoom;
  s.cx = Math.min(iw - cw / 2, Math.max(cw / 2, s.cx));
  s.cy = Math.min(ih - ch / 2, Math.max(ch / 2, s.cy));
  return { x: s.cx - cw / 2, y: s.cy - ch / 2, w: cw, h: ch };
}

function draw(img, s, w, hgt) {
  const c = canvas(w, hgt);
  const g = c.getContext('2d', { alpha: false });
  g.fillStyle = '#0B1418';
  g.fillRect(0, 0, w, hgt);
  g.imageSmoothingQuality = 'high';
  const r = cropRect(img, s);
  g.drawImage(img, r.x, r.y, r.w, r.h, 0, 0, w, hgt);
  return c;
}

/** En-tête, formulaire et aperçu ; « Mes propositions » en dessous. */
export function createForm(ctx, { launch = false, heading = 'h1' } = {}) {
  const st = ctx.st;
  const pub = ctx.pub;
  const perDay = pub?.perDay ?? 3;
  const left = st ? st.me.proposalsLeft : perDay;
  const muted = st?.me.muted;

  // Aperçu en direct.
  const draft = { id: 'draft', title: '', desc: '', cat: 'meme', author: st?.me.pseudo || ctx.defaultPseudo() || 'toi' };
  const preview = h('div.tcr-preview');
  let card;
  let artImg;
  const renderPreview = () => {
    const next = cardEl(
      { ...draft, title: draft.title || 'Ton titre ici', desc: draft.desc || 'Deux ou trois phrases, courtes. Ce qui rend ce moment unique pour la promo.' },
      { size: 'lg', mystery: true, live: true, artSrc: photo ? photoURL : undefined },
    );
    if (card) card.replaceWith(next);
    else preview.prepend(next);
    card = next;
    artImg = card.querySelector('.tc-art img');
    bindArt(card.querySelector('.tc-art'));
  };
  const release = launch ? (pub?.waves ?? []).find((w) => !w.printed)?.releaseAt : null;
  preview.append(h('p.tcr-note', {}, ic('info'), launch && release ? `La rareté sera révélée au lancement, le ${dayLong(release)}.` : 'La rareté sera décidée à l’impression, après le jury de la semaine.'));

  // Photo.
  let photo = null; // HTMLImageElement chargée
  let photoURL = '';
  let blobURL = '';
  const crop = { zoom: 1, cx: 0, cy: 0 };
  const fileIn = h('input.sr-only', { type: 'file', id: 'tcr-file', accept: 'image/*' });
  const dropTitle = h('b', { text: 'Ajoute une photo' });
  const drop = h('label.tcr-drop', { htmlFor: 'tcr-file' }, ic('photo', 'ic'), h('span', {}, dropTitle, h('small', { text: 'JPG ou PNG · elle sera recadrée au format de la carte' })));
  const zoomIn = h('input', { type: 'range', min: '1', max: '3', step: '0.01', value: '1', id: 'tcr-zoom' });
  const zoom = h('div.tcr-zoom', { hidden: true }, h('label.tlabel', { htmlFor: 'tcr-zoom', text: 'Zoom' }), zoomIn, h('small', { text: 'Fais glisser la photo dans l’aperçu pour la recadrer.' }));

  let raf = 0;
  const repaint = () => {
    if (raf || !photo) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      photoURL = draw(photo, crop, 480, 360).toDataURL('image/jpeg', 0.82);
      if (artImg) artImg.src = photoURL;
    });
  };

  async function loadFile(file) {
    if (!file) return;
    if (!/^image\//.test(file.type) && !/\.(jpe?g|png|webp|heic|heif|gif)$/i.test(file.name)) return showErr('Choisis une image (JPG ou PNG).');
    if (file.size > 40 * 1024 * 1024) return showErr('Photo trop lourde (40 Mo au plus).');
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.decoding = 'async';
    img.src = url;
    try {
      await img.decode();
    } catch {
      URL.revokeObjectURL(url);
      return showErr(/\.hei[cf]$/i.test(file.name) || /hei[cf]/i.test(file.type) ? 'Photo HEIC (iPhone) : ce navigateur ne sait pas la lire. Exporte-la en JPG (Photos → Fichier → Exporter), ou ouvre le Hub dans Safari.' : 'Cette image ne s’ouvre pas dans le navigateur : essaie un JPG ou un PNG.');
    }
    if (img.naturalWidth < 320 || img.naturalHeight < 240) {
      URL.revokeObjectURL(url);
      return showErr('Photo trop petite (320 × 240 pixels au moins).');
    }
    if (blobURL) URL.revokeObjectURL(blobURL);
    blobURL = url;
    photo = img;
    crop.zoom = 1;
    crop.cx = img.naturalWidth / 2;
    crop.cy = img.naturalHeight / 2;
    zoomIn.value = '1';
    zoom.hidden = false;
    dropTitle.textContent = 'Changer la photo';
    err.hidden = true;
    photoURL = draw(photo, crop, 480, 360).toDataURL('image/jpeg', 0.82);
    renderPreview();
  }
  fileIn.addEventListener('change', () => loadFile(fileIn.files[0]));
  drop.addEventListener('dragover', (e) => e.preventDefault());
  drop.addEventListener('drop', (e) => {
    e.preventDefault();
    loadFile(e.dataTransfer?.files?.[0]);
  });
  zoomIn.addEventListener('input', () => {
    crop.zoom = Number(zoomIn.value);
    repaint();
  });

  function bindArt(art) {
    if (!art) return;
    let d = null;
    art.addEventListener('pointerdown', (e) => {
      if (!photo) return fileIn.click();
      e.preventDefault();
      const r = cropRect(photo, crop);
      d = { x: e.clientX, y: e.clientY, cx: crop.cx, cy: crop.cy, k: r.w / art.getBoundingClientRect().width };
      art.setPointerCapture(e.pointerId);
    });
    art.addEventListener('pointermove', (e) => {
      if (!d) return;
      crop.cx = d.cx - (e.clientX - d.x) * d.k;
      crop.cy = d.cy - (e.clientY - d.y) * d.k;
      repaint();
    });
    const up = () => (d = null);
    art.addEventListener('pointerup', up);
    art.addEventListener('pointercancel', up);
    art.addEventListener(
      'wheel',
      (e) => {
        if (!photo) return;
        e.preventDefault();
        crop.zoom = Math.min(3, Math.max(1, crop.zoom * (e.deltaY < 0 ? 1.06 : 0.94)));
        zoomIn.value = String(crop.zoom);
        repaint();
      },
      { passive: false },
    );
  }

  // Texte.
  const counter = (n, max) => {
    const c = h('span.tcount', { text: `${n} / ${max}` });
    return c;
  };
  const titleIn = h('input.tinput', { id: 'tcr-title', maxLength: 28, placeholder: 'Le distributeur du bâtiment B', autocomplete: 'off' });
  const titleCount = counter(0, 28);
  const descIn = h('textarea.tinput.tinput--area', { id: 'tcr-desc', maxLength: 160, rows: 3, placeholder: 'Il avale les pièces de 2 €. Une fois par an, il rend tout.' });
  const descCount = counter(0, 160);
  const count = (input, el, max) => {
    const n = [...input.value].length;
    el.textContent = `${n} / ${max}`;
    el.classList.toggle('is-near', n >= max * 0.85);
  };
  titleIn.addEventListener('input', () => {
    count(titleIn, titleCount, 28);
    draft.title = titleIn.value.trim();
    card.querySelector('.tc-title').textContent = draft.title || 'Ton titre ici';
    card.setAttribute('aria-label', draft.title || 'Ton titre ici');
  });
  descIn.addEventListener('input', () => {
    count(descIn, descCount, 160);
    draft.desc = descIn.value.replace(/\s+/g, ' ').trim();
    card.querySelector('.tc-desc').textContent = draft.desc || 'Deux ou trois phrases, courtes.';
  });

  const chips = h('div.tchips', { attrs: { role: 'radiogroup', 'aria-label': 'Catégorie' } });
  for (const [k, label] of Object.entries(CATS)) {
    const b = h(`button.tchip${k === draft.cat ? '.is-on' : ''}`, { type: 'button', attrs: { role: 'radio', 'aria-checked': String(k === draft.cat) }, text: label });
    b.addEventListener('click', () => {
      draft.cat = k;
      for (const x of chips.children) {
        x.classList.toggle('is-on', x === b);
        x.setAttribute('aria-checked', String(x === b));
      }
      const cat = card.querySelector('.tc-cat');
      if (cat) cat.textContent = label;
    });
    chips.append(b);
  }

  const check = (id, text) => {
    const input = h('input', { type: 'checkbox', id });
    return [input, h('label.tcheck', {}, input, h('span.tcheck-box', {}, ic('check', 'ic ic--xs')), h('span', { text }))];
  };
  const [c2, l2] = check('tcr-c2', 'J’ai pris cette photo ou j’ai le droit de l’utiliser.');
  // Personnes sur la photo : même liste que le champ « Cc » d'un mail (récents, puis annuaire,
  // étudiants d'abord). L'équipe confirme à la validation, puis leur demande leur accord.
  const people = peoplePicker({ id: 'tcr-people', search: ctx.searchContacts, recent: ctx.recentPeople });
  const err = h('p.terr', { hidden: true, attrs: { role: 'alert' } });
  const showErr = (msg) => {
    err.textContent = msg;
    err.hidden = false;
    if (motionOK()) err.animate([{ transform: 'translateX(-4px)' }, { transform: 'translateX(4px)' }, { transform: 'none' }], { duration: 260 });
  };
  const submitLabel = h('span', { text: 'Envoyer en relecture' });
  const submit = h('button.tbtn.tbtn--primary.tbtn--lg', { type: 'submit' }, ic('send'), submitLabel);
  const rules = h(
    'details.tcr-rules',
    {},
    h('summary', {}, ic('info'), 'Ce qui est bloqué à la validation'),
    h(
      'ul',
      {},
      h('li', { text: 'Tout est accepté, sauf ce qui insulte ou dénigre quelqu’un.' }),
      h('li', { text: 'Personne de reconnaissable sans son accord, y compris les enseignants.' }),
      h('li', { text: 'Rien de privé : notes, mails, données de santé, adresses.' }),
      h('li', { text: 'Une photo lisible. Titre de 28 caractères et texte de 160 au plus.' }),
    ),
  );

  const form = h(
    'form.tcr-form',
    { noValidate: true },
    drop,
    fileIn,
    zoom,
    h('div.tfield', {}, h('div.tfield-top', {}, h('label.tlabel', { htmlFor: 'tcr-title', text: 'Titre' }), titleCount), titleIn),
    h('div.tfield', {}, h('div.tfield-top', {}, h('label.tlabel', { htmlFor: 'tcr-desc', text: 'Description' }), descCount), descIn, h('p.thelp', { text: '2 ou 3 phrases. Un mème, un moment, un truc : ce que tout le monde reconnaîtra.' })),
    h('div.tfield', {}, h('p.tlabel', { text: 'Catégorie' }), chips),
    h(
      'div.tfield',
      {},
      h('label.tlabel', { htmlFor: 'tcr-people', text: 'Qui est sur la photo ? (facultatif)' }),
      people.el,
      h('p.thelp', { text: 'Nom ou adresse de l’université, 5 personnes au plus. Après la validation, l’équipe leur demande leur accord par mail (ton nom n’y figure pas) : ta carte attend leur réponse avant d’aller au jury.' }),
    ),
    l2,
    err,
    submit,
    rules,
  );
  if (muted || left <= 0) {
    submit.disabled = true;
    submitLabel.textContent = muted ? 'Propositions suspendues' : 'Reviens demain';
  }

  // Saisie en cours : le rafraîchissement automatique du jeu ne redessine pas la page.
  const touched = () => (ctx.editing = true);
  form.addEventListener('input', touched);
  form.addEventListener('change', touched);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    err.hidden = true;
    if (!photo) return showErr('Ajoute une photo.');
    if ([...draft.title].length < 2) return showErr('Donne un titre à ta carte.') || titleIn.focus();
    if ([...draft.desc].length < 4) return showErr('Écris deux ou trois phrases.') || descIn.focus();
    const tagged = people.list();
    if (tagged === null) return showErr('Une adresse de la liste « Qui est sur la photo ? » n’est pas une adresse de l’université.') || people.focus();
    if (!c2.checked) return showErr('Confirme que tu as le droit d’utiliser cette photo.');
    submit.disabled = true;
    submitLabel.textContent = 'Envoi…';
    try {
      if (!(await ctx.join())) throw new TcgError('Rejoins le jeu pour envoyer ta carte.');
      const [big, small] = await Promise.all([encode(draw(photo, crop, W, H), MAX), encode(draw(photo, crop, TW, TH), MAX_THUMB)]);
      const fd = new FormData();
      fd.append('title', draft.title);
      fd.append('desc', draft.desc);
      fd.append('cat', draft.cat);
      fd.append('consentRights', '1');
      if (tagged.length) fd.append('people', tagged.join(','));
      const ext = big.type === 'image/webp' ? 'webp' : 'jpg';
      fd.append('photo', big, `photo.${ext}`);
      fd.append('thumb', small, `vignette.${small.type === 'image/webp' ? 'webp' : 'jpg'}`);
      await api.propose(fd);
      toast('Carte envoyée en relecture : un admin la valide sous 48 h.', 'check');
      if (blobURL) URL.revokeObjectURL(blobURL);
      await ctx.reload();
    } catch (ex) {
      showErr(ex instanceof TcgError ? ex.message : 'Envoi impossible pour l’instant : réessaie.');
      submit.disabled = false;
      submitLabel.textContent = 'Envoyer en relecture';
    }
  });

  renderPreview();
  const head = h(
    'header.tv-head',
    {},
    h('div', {}, h('p.tk', { text: 'Atelier' }), h(`${heading}.tv-h1`, { tabIndex: -1, text: launch ? 'Propose ta carte' : 'Créer une carte' })),
    h('div.tcr-quota', {}, quota(left, perDay), h('span', { text: muted ? 'Propositions suspendues' : left > 0 ? `${plural(left, 'proposition')} aujourd’hui` : 'Reviens demain' })),
  );
  const frag = document.createDocumentFragment();
  frag.append(head, h('section.tcr', {}, h('div.tcr-grid', {}, form, preview), proposalsList(ctx, launch)));
  return frag;
}

/** « Mes propositions » et leur avancement : validation → jury → impression. */
export function proposalsList(ctx, launch) {
  const st = ctx.st;
  const sec = h('section.tcr-mine', {}, h('h2.tco-sec-h', {}, h('span', { text: 'Mes propositions' }), h('small', { text: launch ? 'validation → jury de lancement → Vague 1' : 'validation → jury → impression' })));
  const list = h('ul.tcr-list');
  const items = st?.proposals ?? [];
  if (!items.length) {
    sec.append(h('p.thelp', { text: st ? 'Tes cartes proposées apparaîtront ici, avec leur avancement.' : 'Rejoins le jeu en envoyant ta première carte : tu suivras ici sa validation.' }));
    return sec;
  }
  const status = {
    pending: ['review', 'clock', 'À valider'],
    accepted: ['accepted', 'check', 'Validée'],
    consent: ['review', 'person', 'Accord'],
    jury: ['jury', 'jury', 'Au jury'],
    printed: ['printed', 'check', 'Imprimée'],
    blocked: ['refused', 'x', 'Bloquée'],
    removed: ['refused', 'x', 'Retirée'],
  };
  for (const p of items) {
    const key = p.status === 'accepted' && p.atJury ? 'jury' : p.status;
    const [cls, icon, label] = status[key] ?? status.pending;
    let text;
    switch (key) {
      case 'pending':
        text = 'En attente de validation · un admin vérifie sous 48 h';
        break;
      case 'consent':
        text = `Acceptée · en attente de l’accord des personnes sur la photo${p.consent ? ` (${p.consent.ok} / ${p.consent.total})` : ''}`;
        break;
      case 'jury':
        text = `Au jury cette semaine · jusqu’au ${dateShort(p.juryEnd)}`;
        break;
      case 'accepted':
        text = launch ? 'Validée · elle passera au jury de lancement' : 'Validée · elle passera au prochain jury';
        break;
      case 'printed':
        text = `Imprimée · Vague ${p.wave} · tirée ${plural(p.issued || 0, 'fois', 'fois')}`;
        break;
      case 'blocked':
        text = `Bloquée · ${(p.reason || 'motif').toLowerCase()}${p.message ? ` : « ${p.message} »` : ''}`;
        break;
      default:
        text = p.reason === 'Accord retiré par une personne sur la photo' ? 'Retirée du jeu : une personne sur la photo a retiré son accord' : 'Retirée du jeu après signalements';
    }
    const it = h('div.tcr-it', {}, h('b', { text: p.title }), h('span', { text }));
    if (['pending', 'consent', 'accepted', 'jury', 'blocked'].includes(key)) {
      const rm = h('button.tcr-rm', { type: 'button', text: 'Retirer' });
      rm.addEventListener('click', async () => {
        if (!confirm(`Retirer « ${p.title} » ? Elle ne sera pas imprimée.`)) return;
        try {
          await api.withdraw(p.id);
          await ctx.reload();
          toast('Proposition retirée.', 'check');
        } catch (e) {
          toast(e.message, 'alert');
        }
      });
      it.append(rm);
    }
    const pill = h(`span.tstatus.tstatus--${cls}`, {}, ic(icon, 'ic ic--xs'), label);
    list.append(h(`li.tcr-item.is-${cls}`, {}, h(`span.tcr-thumb${key === 'blocked' ? '.is-blur' : ''}`, {}, p.thumb ? h('img', { alt: '', src: p.thumb }) : null), it, key === 'printed' && p.rarity ? h('span', {}, rchip(p.rarity)) : pill));
  }
  sec.append(list);
  return sec;
}

/** Vue « Créer » du dock. */
export function renderCreate(ctx) {
  return h('section.tcr-page', {}, createForm(ctx, { launch: ctx.phase === 'soon' }));
}
