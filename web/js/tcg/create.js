// ISIS · TCG : créer une carte (atelier). La photo est recadrée dans la page au format de la carte
// (4:3), comme dans les apps photo : grand cadre avec grille, on fait glisser, on zoome (deux
// doigts, molette ou curseur). Par défaut toute la photo est visible (bords flous si besoin). Elle part déjà compressée en deux tailles
// (960 × 720 et 320 × 240, WebP sinon JPEG) : redessinée sur un canevas, elle perd au passage ses
// métadonnées (position GPS, appareil…). Le serveur vérifie de nouveau tout cela.

import { h, toast, motionOK } from '../core/dom.js';
import { api, TcgError } from './api.js';
import { cardEl, ic, quota, tbtn, CATS, dayLong, dateShort, rchip, plural } from './ui.js';
import { peoplePicker } from './people.js';
import { cropRect, fitZoom, MAX_ZOOM } from './crop.js';

const W = 960;
const H = 720;
const TW = 320;
const TH = 240;
const MAX = 380 * 1024;
const MAX_THUMB = 76 * 1024;
const CAT_ICONS = { meme: 'spark', moment: 'clock', lieu: 'pin', truc: 'cards' };

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

/** La photo recadrée sur un canevas w × hgt ; bords éventuels : la photo floutée et assombrie. */
function draw(img, s, w, hgt, into = null) {
  const c = into ?? canvas(w, hgt);
  const g = c.getContext('2d', { alpha: false });
  g.fillStyle = '#0B1418';
  g.fillRect(0, 0, w, hgt);
  g.imageSmoothingQuality = 'high';
  const iw = img.naturalWidth;
  const ih = img.naturalHeight;
  const r = cropRect(iw, ih, s);
  const k = w / r.w;
  if (r.w > iw || r.h > ih) {
    // Fond : la photo en plein cadre, floutée (si le navigateur sait) et assombrie.
    const cover = Math.max(w / iw, hgt / ih);
    g.save();
    if ('filter' in g) g.filter = 'blur(18px)';
    g.globalAlpha = 0.55;
    g.drawImage(img, (w - iw * cover) / 2, (hgt - ih * cover) / 2, iw * cover, ih * cover);
    g.restore();
  }
  g.drawImage(img, -r.x * k, -r.y * k, iw * k, ih * k);
  return c;
}

/** En-tête, formulaire et aperçu ; « Mes propositions » en dessous. */
export function createForm(ctx, { launch = false, heading = 'h1' } = {}) {
  // Formulaire commencé (photo, texte, personnes) : la page peut être redessinée (rafraîchissement,
  // retour sur l'onglet…), on rend le MÊME formulaire, rien de ce qui a été saisi n'est perdu.
  if (ctx.draftForm) return ctx.draftForm;
  const host = h('div.tcr-host');
  const st = ctx.st;
  const pub = ctx.pub;
  const perDay = pub?.perDay ?? 3;
  const left = st ? st.me.proposalsLeft : perDay;
  const muted = st?.me.muted;

  // Aperçu en direct.
  const draft = { id: 'draft', title: '', desc: '', cat: 'meme', author: st?.me.pseudo || ctx.defaultPseudo() || 'toi' };
  const preview = h('div.tcr-preview', {}, h('p.tcr-live', {}, h('span.tcr-live-dot'), 'Aperçu en direct'));
  let card;
  let artImg;
  const renderPreview = () => {
    const next = cardEl(
      { ...draft, title: draft.title || 'Ton titre ici', desc: draft.desc || 'Deux ou trois phrases, courtes. Ce qui rend ce moment unique pour la promo.' },
      { size: 'lg', mystery: true, live: true, artSrc: photo ? photoURL : undefined },
    );
    if (card) card.replaceWith(next);
    else preview.querySelector('.tcr-live').after(next);
    card = next;
    artImg = card.querySelector('.tc-art img');
    bindArt(card.querySelector('.tc-art'));
  };
  const release = launch ? (pub?.waves ?? []).find((w) => !w.printed)?.releaseAt : null;
  preview.append(
    h('span.tcr-floor', { attrs: { 'aria-hidden': 'true' } }),
    h('p.tcr-secret', {}, h('b', { text: '?' }), h('span', {}, 'Rareté secrète', h('small', { text: launch && release ? `révélée au lancement, le ${dayLong(release)}` : 'décidée par le jury, révélée à l’impression' }))),
  );

  // Photo.
  let photo = null; // HTMLImageElement chargée
  let photoURL = '';
  let blobURL = '';
  const crop = { zoom: 1, cx: 0, cy: 0 };
  const fileIn = h('input.sr-only', { type: 'file', id: 'tcr-file', accept: 'image/*' });
  const dropTitle = h('b', { text: 'Ajoute une photo' });
  const drop = h(
    'label.tcr-drop',
    { htmlFor: 'tcr-file' },
    h('span.tcr-drop-ic', {}, ic('camera', 'ic')),
    h('span.tcr-drop-t', {}, dropTitle, h('small', { text: 'Touche pour choisir, ou glisse-la ici · JPG ou PNG' })),
  );
  // Recadreur (comme dans les apps photo) : grand cadre 4:3 avec la grille des tiers.
  const zoomIn = h('input', { type: 'range', min: '0.3', max: String(MAX_ZOOM), step: '0.005', value: '1', id: 'tcr-zoom' });
  const cropCanvas = canvas(640, 480);
  cropCanvas.className = 'tcr-crop-canvas';
  const stage = h('div.tcr-crop-stage', { attrs: { role: 'img', 'aria-label': 'Recadrage de la photo : fais-la glisser pour choisir ce qui se voit' } }, cropCanvas, h('span.tcr-crop-grid', { attrs: { 'aria-hidden': 'true' } }));
  const setZoom = (z) => {
    if (!photo) return;
    crop.zoom = z;
    cropRect(photo.naturalWidth, photo.naturalHeight, crop); // borne le zoom et recentre
    zoomIn.value = String(crop.zoom);
    repaint();
  };
  const fitBtn = tbtn('Toute la photo', 'photo', 'tbtn--ghost tbtn--sm', () => setZoom(fitZoom(photo.naturalWidth, photo.naturalHeight)));
  const fillBtn = tbtn('Remplir le cadre', 'plus', 'tbtn--ghost tbtn--sm', () => setZoom(1));
  const zoom = h(
    'div.tcr-zoom.tcr-crop',
    { hidden: true },
    stage,
    h('div.tcr-crop-tools', {}, h('label.tlabel', { htmlFor: 'tcr-zoom', text: 'Zoom' }), zoomIn, fitBtn, fillBtn),
    h('small', { text: 'Fais glisser la photo dans le cadre pour choisir ce qui se voit. Zoome avec deux doigts, la molette ou le curseur.' }),
  );

  let raf = 0;
  const repaint = () => {
    if (raf || !photo) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      draw(photo, crop, 640, 480, cropCanvas);
      photoURL = cropCanvas.toDataURL('image/jpeg', 0.82);
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
    // Par défaut : toute la photo (rien n'est coupé) ; « Remplir le cadre » ou le zoom pour recadrer.
    const fit = fitZoom(img.naturalWidth, img.naturalHeight);
    crop.zoom = fit;
    crop.cx = img.naturalWidth / 2;
    crop.cy = img.naturalHeight / 2;
    zoomIn.min = String(fit);
    zoomIn.value = String(fit);
    zoom.hidden = false;
    draw(photo, crop, 640, 480, cropCanvas);
    dropTitle.textContent = 'Changer la photo';
    err.hidden = true;
    photoURL = cropCanvas.toDataURL('image/jpeg', 0.82);
    renderPreview();
    paintRail();
  }
  fileIn.addEventListener('change', () => loadFile(fileIn.files[0]));
  drop.addEventListener('dragover', (e) => e.preventDefault());
  drop.addEventListener('drop', (e) => {
    e.preventDefault();
    loadFile(e.dataTransfer?.files?.[0]);
  });
  zoomIn.addEventListener('input', () => setZoom(Number(zoomIn.value)));

  // Glisser (un doigt ou la souris), pincer (deux doigts), molette : sur le cadre et sur l'aperçu.
  function bindArt(art) {
    if (!art) return;
    const pts = new Map(); // pointeurs posés
    let d = null; // glisser : départ
    let pinch = null; // pincer : écart et zoom de départ
    const gap = () => {
      const [a, b] = [...pts.values()];
      return Math.hypot(a.x - b.x, a.y - b.y) || 1;
    };
    const startDrag = (p) => {
      const r = cropRect(photo.naturalWidth, photo.naturalHeight, crop);
      d = { x: p.x, y: p.y, cx: crop.cx, cy: crop.cy, k: r.w / art.getBoundingClientRect().width };
    };
    art.addEventListener('pointerdown', (e) => {
      if (!photo) return fileIn.click();
      e.preventDefault();
      art.setPointerCapture(e.pointerId);
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pts.size === 2) {
        pinch = { gap: gap(), zoom: crop.zoom };
        d = null;
      } else if (pts.size === 1) startDrag(pts.get(e.pointerId));
      ctx.editing = true;
    });
    art.addEventListener('pointermove', (e) => {
      if (!pts.has(e.pointerId)) return;
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pinch && pts.size >= 2) return setZoom(pinch.zoom * (gap() / pinch.gap));
      if (!d) return;
      crop.cx = d.cx - (e.clientX - d.x) * d.k;
      crop.cy = d.cy - (e.clientY - d.y) * d.k;
      repaint();
    });
    const up = (e) => {
      pts.delete(e.pointerId);
      if (pts.size < 2) pinch = null;
      d = null;
      if (pts.size === 1) startDrag([...pts.values()][0]); // un doigt reste : on continue de glisser
    };
    art.addEventListener('pointerup', up);
    art.addEventListener('pointercancel', up);
    art.addEventListener(
      'wheel',
      (e) => {
        if (!photo) return;
        e.preventDefault();
        setZoom(crop.zoom * (e.deltaY < 0 ? 1.06 : 0.94));
      },
      { passive: false },
    );
  }
  bindArt(stage);

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
    const b = h(`button.tchip.tcr-cat${k === draft.cat ? '.is-on' : ''}`, { type: 'button', attrs: { role: 'radio', 'aria-checked': String(k === draft.cat) } }, ic(CAT_ICONS[k] ?? 'cards', 'ic ic--xs'), h('span', { text: label }));
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
  const people = peoplePicker({ id: 'tcr-people', search: ctx.searchContacts, recent: ctx.recentPeople, onChange: () => paintRail() });
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

  // Étapes numérotées et fil d'avancement : on voit ce qui reste avant l'envoi.
  const step = (n, key, title, sub, ...body) =>
    h(`section.tcr-step`, { data: { step: key } }, h('header.tcr-step-h', {}, h('span.tcr-num', {}, h('b', { text: String(n) }), ic('check', 'ic ic--xs')), h('div', {}, h('h2', { text: title }), sub ? h('p', { text: sub }) : null)), ...body);
  const RAIL = [
    ['photo', 'Photo'],
    ['text', 'Texte'],
    ['cat', 'Catégorie'],
    ['send', 'Envoi'],
  ];
  const rail = h('ol.tcr-rail', { attrs: { 'aria-label': 'Avancement' } }, ...RAIL.map(([k, label]) => h('li', { data: { rail: k } }, h('i'), h('span', { text: label }))));
  const form = h(
    'form.tcr-form',
    { noValidate: true },
    rail,
    step(1, 'photo', 'La photo', 'Recadrée au format de la carte : fais-la glisser, zoome.', drop, fileIn, zoom),
    step(
      2,
      'text',
      'Le titre et l’histoire',
      'Ce que toute la promo reconnaîtra en un coup d’œil.',
      h('div.tfield', {}, h('div.tfield-top', {}, h('label.tlabel', { htmlFor: 'tcr-title', text: 'Titre' }), titleCount), titleIn),
      h('div.tfield', {}, h('div.tfield-top', {}, h('label.tlabel', { htmlFor: 'tcr-desc', text: 'Description' }), descCount), descIn, h('p.thelp', { text: '2 ou 3 phrases. Un mème, un moment, un truc : ce que tout le monde reconnaîtra.' })),
    ),
    step(3, 'cat', 'La catégorie', null, chips),
    step(
      4,
      'people',
      'Qui est sur la photo ?',
      'Facultatif. 10 personnes au plus : l’équipe leur demande leur accord par mail après la validation (ton nom n’y figure pas).',
      h('label.sr-only', { htmlFor: 'tcr-people', text: 'Qui est sur la photo ?' }),
      people.el,
    ),
    h('div.tcr-send', {}, l2, err, submit, rules),
  );
  const paintRail = () => {
    const done = { photo: Boolean(photo), text: [...draft.title].length >= 2 && [...draft.desc].length >= 4, cat: Boolean(draft.cat), send: c2.checked };
    for (const li of rail.children) li.classList.toggle('is-done', done[li.dataset.rail]);
    for (const sec of form.querySelectorAll('.tcr-step')) sec.classList.toggle('is-done', sec.dataset.step === 'people' ? people.count() > 0 : Boolean(done[sec.dataset.step]));
    form.classList.toggle('is-ready', Object.values(done).every(Boolean));
  };
  form.addEventListener('input', paintRail);
  form.addEventListener('change', paintRail);
  form.addEventListener('click', () => requestAnimationFrame(paintRail));
  if (muted || left <= 0) {
    submit.disabled = true;
    submitLabel.textContent = muted ? 'Propositions suspendues' : 'Reviens demain';
  }

  // Saisie en cours : le rafraîchissement automatique du jeu ne redessine pas la page.
  const touched = () => {
    ctx.editing = true;
    ctx.draftForm = host; // gardé tel quel jusqu'à l'envoi
  };
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
      ctx.draftForm = null; // envoyée : le prochain affichage repart d'un formulaire vide
      await ctx.reload();
    } catch (ex) {
      showErr(ex instanceof TcgError ? ex.message : 'Envoi impossible pour l’instant : réessaie.');
      submit.disabled = false;
      submitLabel.textContent = 'Envoyer en relecture';
    }
  });

  renderPreview();
  paintRail();
  const head = h(
    'header.tv-head.tcr-head',
    {},
    h('div', {}, h('p.tk', { text: 'Atelier' }), h(`${heading}.tv-h1`, { tabIndex: -1, text: launch ? 'Propose ta carte' : 'Crée ta carte' }), h('p.tcr-lead', { text: 'Une photo, un titre, deux phrases. La promo joue à « Tu préfères ? » : les cartes préférées deviennent les plus rares.' })),
    h('div.tcr-quota', {}, quota(left, perDay), h('span', { text: muted ? 'Propositions suspendues' : left > 0 ? `${plural(left, 'proposition')} aujourd’hui` : 'Reviens demain' })),
  );
  host.append(head, h('section.tcr', {}, h('div.tcr-grid', {}, form, preview), proposalsList(ctx, launch)));
  return host;
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
        text = `Imprimée · Vague ${p.wave} · tirée ${plural(p.issued || 0, 'fois', 'fois')}${p.rarity ? '' : ' · rareté secrète : tire-la pour la découvrir'}`;
        break;
      case 'blocked':
        text = `Bloquée · ${(p.reason || 'motif').toLowerCase()}${p.message ? ` : « ${p.message} »` : ''}`;
        break;
      default:
        text = p.reason === 'Refusée par une personne sur la photo' ? 'Retirée du jeu : une personne sur la photo a retiré son accord' : 'Retirée du jeu après signalements';
    }
    const it = h('div.tcr-it', {}, h('b', { text: p.title }), h('span', { text }));
    // Une carte validée est dans le jeu : seul ce qui attend la validation (ou a été bloqué) se retire.
    if (['pending', 'blocked'].includes(key)) {
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
