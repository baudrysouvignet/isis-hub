// ISIS · TCG : créer une carte (atelier). La photo est recadrée dans la page au format de la carte
// (4:3), comme dans les apps photo : grand cadre avec grille, on fait glisser, on zoome (deux
// doigts, molette ou curseur). Par défaut toute la photo est visible (bords flous si besoin). Elle part déjà compressée en deux tailles
// (960 × 720 et 320 × 240, WebP sinon JPEG) : redessinée sur un canevas, elle perd au passage ses
// métadonnées (position GPS, appareil…). Le serveur vérifie de nouveau tout cela.
//
// Vagues qui l'ouvrent (Wave.video) : une vidéo à la place de la photo. On choisit le début, on
// recadre comme une photo, et l'atelier enregistre 2 secondes au format de la carte (640 × 480,
// 800 kbit/s, MP4 si le navigateur sait le produire, sinon WebM), SANS SON : ni voix ni
// conversation captées par mégarde. La photo de la carte est la première image de l'extrait.
// Vagues qui l'ouvrent (Wave.music) : une musique de la bibliothèque, choisie et écoutée ici.

import { h, toast, motionOK } from '../core/dom.js';
import { api, TcgError } from './api.js';
import { cardEl, ic, quota, tbtn, CATS, dayLong, dateShort, plural } from './ui.js';
import { consentLink } from './consent-text.js';
import { peoplePicker } from './people.js';
import { cropRect, fitZoom, MAX_ZOOM } from './crop.js';

const W = 960;
const H = 720;
const TW = 320;
const TH = 240;
const MAX = 380 * 1024;
const MAX_THUMB = 76 * 1024;
const MAX_VIDEO = 340 * 1024;
const CLIP = 2; // secondes
const VW = 640;
const VH = 480;
// Formats d'enregistrement, du plus lisible partout (MP4 H.264) au moins répandu.
const VIDEO_TYPES = ['video/mp4;codecs=avc1.42E01E', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'];
const videoType = () => (typeof MediaRecorder === 'undefined' || !HTMLCanvasElement.prototype.captureStream ? '' : (VIDEO_TYPES.find((t) => MediaRecorder.isTypeSupported(t)) ?? ''));

/** Attend un événement d'un élément média (rejette sur « error »). */
const once = (el, ev) =>
  new Promise((resolve, reject) => {
    const ok = () => {
      el.removeEventListener('error', ko);
      resolve();
    };
    const ko = () => {
      el.removeEventListener(ev, ok);
      reject(new Error(ev));
    };
    el.addEventListener(ev, ok, { once: true });
    el.addEventListener('error', ko, { once: true });
  });
const seek = async (v, t) => {
  if (Math.abs(v.currentTime - t) < 0.02 && v.readyState >= 2) return;
  const p = once(v, 'seeked');
  v.currentTime = t;
  await p;
};

/** L'extrait : CLIP secondes à partir de start, recadrées (crop) en VW × VH, sans son. */
async function recordClip(v, start, crop) {
  const type = videoType();
  if (!type) throw new TcgError('Ce navigateur ne sait pas préparer de vidéo : envoie une photo, ou essaie Chrome ou Safari.');
  const out = canvas(VW, VH);
  const stream = out.captureStream(24);
  try {
    for (const bps of [800e3, 500e3]) {
      await seek(v, start);
      draw(v, crop, VW, VH, out);
      const rec = new MediaRecorder(stream, { mimeType: type, videoBitsPerSecond: bps });
      const chunks = [];
      rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
      const stopped = new Promise((resolve) => (rec.onstop = resolve));
      await v.play();
      rec.start();
      const t0 = performance.now();
      await new Promise((resolve) => {
        const tick = () => {
          draw(v, crop, VW, VH, out);
          if (performance.now() - t0 >= CLIP * 1000 || v.ended) return resolve();
          if (v.requestVideoFrameCallback) v.requestVideoFrameCallback(tick);
          else requestAnimationFrame(tick);
        };
        tick();
      });
      rec.stop();
      v.pause();
      await stopped;
      const blob = new Blob(chunks, { type: type.split(';')[0] });
      if (blob.size && blob.size <= MAX_VIDEO) return blob;
    }
  } finally {
    stream.getTracks().forEach((t) => t.stop());
  }
  throw new TcgError('Extrait trop détaillé pour être compressé : choisis un autre moment de la vidéo.');
}
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
  // Propositions closes (date de la vague passée) : plus de formulaire, seulement le suivi de mes
  // cartes. Le serveur refuse de toute façon une carte envoyée après la date.
  if ((ctx.st ?? ctx.pub)?.proposalsClosed) return closedWorkshop(ctx, { launch, heading });
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
      { size: 'lg', mystery: true, live: true, artSrc: photo ? photoURL : undefined, videoSrc: clip?.blobURL || undefined },
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
  // Vague qui reçoit la carte : vidéo et musique ouvertes ?
  const wv = ((st ?? pub)?.waves ?? []).find((w) => !w.printed && (!w.proposalsUntil || new Date(w.proposalsUntil) > Date.now()));
  const canVideo = Boolean(wv?.video) && Boolean(videoType());
  const tracks = wv?.music ? (st?.tracks ?? []) : [];
  let mode = 'photo'; // photo | video
  let clip = null; // { v, url, start, duration, blob, blobURL }
  const fileIn = h('input.sr-only', { type: 'file', id: 'tcr-file', accept: 'image/*' });
  const dropTitle = h('b', { text: 'Ajoute une photo' });
  let dropSub;
  const drop = h(
    'label.tcr-drop',
    { htmlFor: 'tcr-file' },
    h('span.tcr-drop-ic', {}, ic('camera', 'ic')),
    h('span.tcr-drop-t', {}, dropTitle, (dropSub = h('small', { text: 'Touche pour choisir, ou glisse-la ici · JPG ou PNG' }))),
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
      staleClip();
    });
  };

  // ---------------------------------------------------------------- vidéo (vagues qui l'ouvrent)
  const startIn = h('input', { type: 'range', min: '0', max: '0', step: '0.05', value: '0', id: 'tcr-start' });
  const startTxt = h('span.tcr-start-t', { text: '0,0 s' });
  const startRow = h('div.tcr-crop-tools.tcr-start', { hidden: true }, h('label.tlabel', { htmlFor: 'tcr-start', text: 'Début' }), startIn, startTxt);
  const clipNote = h('small.tcr-clip-note', { text: 'Choisis le moment et le cadre, puis prépare l’extrait : 2 secondes, sans le son.' });
  const clipBtn = tbtn('Préparer l’extrait (2 s)', 'loop', 'tbtn--sm', () => prepareClip().catch((e) => showErr(e instanceof TcgError ? e.message : 'Préparation impossible : essaie un autre moment de la vidéo.')));
  const clipBox = h('div.tcr-clip', { hidden: true }, startRow, h('div.tcr-clip-row', {}, clipBtn, clipNote));
  const frame = canvas(2, 2); // image de début de l'extrait : la photo de la carte
  function dropClip() {
    if (!clip) return;
    clip.v.pause();
    clip.v.remove();
    URL.revokeObjectURL(clip.url);
    if (clip.blobURL) URL.revokeObjectURL(clip.blobURL);
    clip = null;
  }
  function staleClip() {
    if (!clip?.blob) return;
    URL.revokeObjectURL(clip.blobURL);
    clip.blob = null;
    clip.blobURL = '';
    card?.querySelector('.tc-vid')?.remove();
    clipNote.textContent = 'Cadre ou moment changé : prépare de nouveau l’extrait.';
  }
  async function grabFrame(t) {
    await seek(clip.v, t);
    if (frame.width !== clip.v.videoWidth || frame.height !== clip.v.videoHeight) [frame.width, frame.height] = [clip.v.videoWidth, clip.v.videoHeight];
    frame.getContext('2d').drawImage(clip.v, 0, 0);
    frame.naturalWidth = frame.width; // pour le recadreur, comme une photo
    frame.naturalHeight = frame.height;
  }
  async function loadVideo(file) {
    if (!/^video\//.test(file.type) && !/\.(mp4|mov|m4v|webm)$/i.test(file.name)) return showErr('Choisis une vidéo (MP4 ou MOV).');
    if (file.size > 400 * 1024 * 1024) return showErr('Vidéo trop lourde (400 Mo au plus).');
    const url = URL.createObjectURL(file);
    const v = h('video.tcr-src', { muted: true, playsInline: true, preload: 'auto', src: url, attrs: { muted: '', playsinline: '', 'aria-hidden': 'true' } });
    document.body.append(v); // hors champ : certains navigateurs ne dessinent une vidéo qu'affichée
    try {
      await once(v, 'loadedmetadata');
      if (v.readyState < 2) await once(v, 'loadeddata');
    } catch {
      v.remove();
      URL.revokeObjectURL(url);
      return showErr('Cette vidéo ne s’ouvre pas dans ce navigateur : essaie une vidéo MP4, ou ouvre le Hub sur ton téléphone.');
    }
    if (v.videoWidth < 320 || v.videoHeight < 240) {
      v.remove();
      URL.revokeObjectURL(url);
      return showErr('Vidéo trop petite (320 × 240 pixels au moins).');
    }
    v.naturalWidth = v.videoWidth; // le même recadrage, image par image
    v.naturalHeight = v.videoHeight;
    dropClip();
    clip = { v, url, start: 0, duration: Number.isFinite(v.duration) ? v.duration : CLIP, blob: null, blobURL: '' };
    startIn.max = String(Math.max(0, clip.duration - CLIP));
    startIn.value = '0';
    startTxt.textContent = '0,0 s';
    startRow.hidden = clip.duration <= CLIP + 0.05;
    clipBox.hidden = false;
    clipNote.textContent = 'Choisis le moment et le cadre, puis prépare l’extrait : 2 secondes, sans le son.';
    await grabFrame(0);
    usePhoto(frame);
  }
  let seekTimer = 0;
  startIn.addEventListener('input', () => {
    if (!clip) return;
    clip.start = Number(startIn.value);
    startTxt.textContent = `${clip.start.toFixed(1).replace('.', ',')} s`;
    clearTimeout(seekTimer);
    seekTimer = setTimeout(async () => {
      await grabFrame(clip.start);
      repaint();
    }, 90);
  });
  async function prepareClip() {
    if (!clip) return;
    clipBtn.disabled = true;
    clipNote.textContent = 'Enregistrement de l’extrait…';
    try {
      const blob = await recordClip(clip.v, clip.start, { ...crop });
      // La photo de la carte : l'image de début, redessinée tout de suite (pas par repaint, qui
      // marquerait l'extrait comme périmé).
      await grabFrame(clip.start);
      draw(photo, crop, 640, 480, cropCanvas);
      photoURL = cropCanvas.toDataURL('image/jpeg', 0.82);
      if (clip.blobURL) URL.revokeObjectURL(clip.blobURL);
      clip.blob = blob;
      clip.blobURL = URL.createObjectURL(blob);
      clipNote.textContent = `Extrait prêt · ${Math.round(blob.size / 1024)} Ko · sans le son`;
      renderPreview();
    } finally {
      clipBtn.disabled = false;
    }
  }

  async function loadFile(file) {
    if (!file) return;
    ctx.editing = true;
    ctx.draftForm = host;
    if (mode === 'video') return loadVideo(file);
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
    usePhoto(img);
  }

  /** Une photo (ou l'image de début d'une vidéo) dans le recadreur et l'aperçu. */
  function usePhoto(img) {
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
    dropTitle.textContent = mode === 'video' ? 'Changer la vidéo' : 'Changer la photo';
    err.hidden = true;
    photoURL = cropCanvas.toDataURL('image/jpeg', 0.82);
    renderPreview();
    paintRail();
  }
  fileIn.addEventListener('change', () => loadFile(fileIn.files[0]));

  // Photo ou vidéo (vagues qui ouvrent la vidéo).
  const modeSeg = canVideo ? h('div.tcr-mode', { attrs: { role: 'radiogroup', 'aria-label': 'Photo ou vidéo' } }) : null;
  const setMode = (m) => {
    if (m === mode) return;
    mode = m;
    ctx.editing = true; // le rafraîchissement du jeu ne redessine pas un formulaire commencé
    ctx.draftForm = host;
    for (const b of modeSeg.children) {
      const on = b.dataset.mode === m;
      b.classList.toggle('is-on', on);
      b.setAttribute('aria-checked', String(on));
    }
    // On repart d'un cadre vide : une photo ne devient pas une vidéo (ni l'inverse).
    dropClip();
    photo = null;
    photoURL = '';
    zoom.hidden = true;
    clipBox.hidden = true;
    fileIn.value = '';
    fileIn.accept = m === 'video' ? 'video/*' : 'image/*';
    dropTitle.textContent = m === 'video' ? 'Ajoute une vidéo' : 'Ajoute une photo';
    dropSub.textContent = m === 'video' ? 'Touche pour choisir · MP4 ou MOV · on en garde 2 secondes, sans le son' : 'Touche pour choisir, ou glisse-la ici · JPG ou PNG';
    rightsTxt.textContent = m === 'video' ? 'J’ai filmé cette vidéo ou j’ai le droit de l’utiliser.' : 'J’ai pris cette photo ou j’ai le droit de l’utiliser.';
    renderPreview();
    paintRail();
  };
  if (modeSeg) {
    for (const [m, label, icon] of [['photo', 'Photo', 'photo'], ['video', 'Vidéo 2 s', 'camera']]) {
      const b = h(`button.tchip${m === mode ? '.is-on' : ''}`, { type: 'button', data: { mode: m }, attrs: { role: 'radio', 'aria-checked': String(m === mode) } }, ic(icon, 'ic ic--xs'), h('span', { text: label }));
      b.addEventListener('click', () => setMode(m));
      modeSeg.append(b);
    }
  }
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
  const rightsTxt = l2.lastElementChild;

  // Musique (vagues qui l'ouvrent) : un morceau de la bibliothèque, à écouter avant de choisir.
  draft.music = '';
  let audio = null;
  const stopAudio = () => {
    audio?.pause();
    audio = null;
    listenBtn?.querySelector('span') && (listenBtn.querySelector('span').textContent = 'Écouter');
  };
  const musicSel = tracks.length ? h('select.tinput.tcr-music', { id: 'tcr-music' }, h('option', { value: '', text: 'Sans musique' }), ...tracks.map((t) => h('option', { value: t.id, text: t.credit ? `${t.title} · ${t.credit}` : t.title }))) : null;
  const listenBtn = tracks.length
    ? tbtn('Écouter', 'sound', 'tbtn--ghost tbtn--sm', () => {
        if (audio) return stopAudio();
        const t = tracks.find((x) => x.id === musicSel.value);
        if (!t) return;
        audio = new Audio(t.url);
        audio.loop = true;
        audio.play().catch(() => stopAudio());
        listenBtn.querySelector('span').textContent = 'Arrêter';
      })
    : null;
  musicSel?.addEventListener('change', () => {
    stopAudio();
    draft.music = musicSel.value;
    listenBtn.disabled = !musicSel.value;
  });
  if (listenBtn) listenBtn.disabled = true;
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
    step(1, 'photo', canVideo ? 'La photo ou la vidéo' : 'La photo', canVideo ? 'Recadrée au format de la carte : fais-la glisser, zoome. Vidéo : 2 secondes, sans le son.' : 'Recadrée au format de la carte : fais-la glisser, zoome.', modeSeg, drop, fileIn, zoom, clipBox),
    step(
      2,
      'text',
      'Le titre et l’histoire',
      'Ce que toute la promo reconnaîtra en un coup d’œil.',
      h('div.tfield', {}, h('div.tfield-top', {}, h('label.tlabel', { htmlFor: 'tcr-title', text: 'Titre' }), titleCount), titleIn),
      h('div.tfield', {}, h('div.tfield-top', {}, h('label.tlabel', { htmlFor: 'tcr-desc', text: 'Description' }), descCount), descIn, h('p.thelp', { text: '2 ou 3 phrases. Un mème, un moment, un truc : ce que tout le monde reconnaîtra.' })),
    ),
    step(3, 'cat', 'La catégorie', null, chips),
    tracks.length
      ? step(4, 'music', 'La musique', 'Facultatif. Elle se joue quand on ouvre ta carte et qu’on appuie sur lecture.', h('label.sr-only', { htmlFor: 'tcr-music', text: 'Musique' }), h('div.tcr-music-row', {}, musicSel, listenBtn))
      : null,
    step(
      tracks.length ? 5 : 4,
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
    for (const sec of form.querySelectorAll('.tcr-step')) sec.classList.toggle('is-done', sec.dataset.step === 'people' ? people.count() > 0 : sec.dataset.step === 'music' ? Boolean(draft.music) : Boolean(done[sec.dataset.step]));
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
    if (!photo) return showErr(mode === 'video' ? 'Ajoute une vidéo.' : 'Ajoute une photo.');
    if ([...draft.title].length < 2) return showErr('Donne un titre à ta carte.') || titleIn.focus();
    if ([...draft.desc].length < 4) return showErr('Écris deux ou trois phrases.') || descIn.focus();
    const tagged = people.list();
    if (tagged === null) return showErr('Une adresse de la liste « Qui est sur la photo ? » n’est pas une adresse de l’université.') || people.focus();
    if (!c2.checked) return showErr('Confirme que tu as le droit d’utiliser cette photo.');
    submit.disabled = true;
    submitLabel.textContent = 'Envoi…';
    try {
      if (!(await ctx.join())) throw new TcgError('Rejoins le jeu pour envoyer ta carte.');
      if (mode === 'video' && !clip?.blob) {
        submitLabel.textContent = 'Préparation de l’extrait…';
        await prepareClip();
        submitLabel.textContent = 'Envoi…';
      }
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
      if (mode === 'video' && clip?.blob) fd.append('video', clip.blob, `extrait.${clip.blob.type.includes('webm') ? 'webm' : 'mp4'}`);
      if (draft.music) fd.append('music', draft.music);
      await api.propose(fd);
      stopAudio();
      dropClip();
      toast('Carte envoyée : suis son avancement dans « Mes cartes envoyées ».', 'check');
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

// Suivi de mes cartes, sans spoiler : le titre, l'avancement et ce que je peux faire (relancer les
// personnes indiquées, corriger ou retirer une carte bloquée). Ni la description, ni la photo nette,
// ni la rareté, ni le nombre de tirages : le serveur ne les envoie pas (ProposalView).
const STEPS = ['Validation', 'Accords', 'Jury', 'En jeu'];

/** Étape en cours (0 à 3) et libellé, d'après le statut envoyé par le serveur. */
function progress(p, launch) {
  switch (p.status) {
    case 'pending':
      return { at: 0, icon: 'clock', tone: 'wait', text: 'En attente de validation par l’équipe (48 h au plus)' };
    case 'consent':
      return { at: 1, icon: 'person', tone: 'wait', text: p.consent ? `En attente d’accord · ${p.consent.ok} / ${p.consent.total} personnes ont accepté` : 'En attente de l’accord des personnes sur la photo' };
    case 'accepted':
      return p.atJury
        ? { at: 2, icon: 'jury', tone: 'now', text: `Au jury de la promo jusqu’au ${dateShort(p.juryEnd)}` }
        : { at: 2, icon: 'check', tone: 'ok', next: true, text: launch ? 'Validée · elle passera au jury de lancement' : 'Validée · elle passera au prochain jury' };
    case 'printed':
      return { at: 4, icon: 'cards', tone: 'ok', text: `Dans le jeu · Vague ${p.wave} · rareté secrète : tire-la pour la découvrir` };
    case 'blocked':
      return { blocked: true, icon: 'x', tone: 'bad', text: p.reason === 'Refusée par une personne sur la photo' ? 'Une personne sur la photo a refusé' : `Bloquée · ${(p.reason || 'motif').toLowerCase()}` };
    default:
      return { blocked: true, icon: 'x', tone: 'bad', text: p.reason === 'Refusée par une personne sur la photo' ? 'Retirée du jeu : une personne a retiré son accord' : 'Retirée du jeu après signalements' };
  }
}

/** Message à envoyer aux personnes indiquées (partage du téléphone, sinon copié). */
async function remind(p) {
  const text = `Tu apparais sur ma carte « ${p.title} » du TCG de la promo. Pour qu’elle entre dans le jeu, il me faut ton accord : ISIS Hub, onglet TCG, « Mes apparitions ».`;
  const url = consentLink();
  if (navigator.share) {
    try {
      await navigator.share({ title: 'TCG de la promo', text, url });
      return;
    } catch (e) {
      if (e?.name === 'AbortError') return;
    }
  }
  try {
    await navigator.clipboard.writeText(`${text}\n${url}`);
    toast('Message copié : envoie-le aux personnes indiquées.', 'check');
  } catch {
    toast('Copie impossible sur cet appareil.', 'alert');
  }
}

/** « Mes cartes envoyées » : titre et avancement seulement, la carte reste une surprise. */
export function proposalsList(ctx, launch) {
  const st = ctx.st;
  const items = st?.proposals ?? [];
  const sec = h('section.tcr-mine', {}, h('h2.tco-sec-h', {}, h('span', { text: 'Mes cartes envoyées' }), h('small', { text: 'le titre et l’avancement : la carte reste une surprise' })));
  if (!items.length) {
    sec.append(h('p.tcr-sent', {}, ic('lock', 'ic ic--sm'), h('span', { text: st ? 'Tes cartes envoyées apparaîtront ici, avec leur avancement : validation, accords, jury, puis le jeu. Ni leur photo ni leur rareté ne s’affichent : la surprise reste entière.' : 'Rejoins le jeu en envoyant ta première carte : tu suivras ici son avancement.' })));
    return sec;
  }
  const list = h('ul.tcr-cards');
  for (const p of items) {
    const g = progress(p, launch);
    const thumb = g.blocked || !p.thumb ? h('span.tcr-ph', {}, ic(g.blocked ? 'x' : 'photo', 'ic')) : h('span.tcr-ph.is-veil', {}, h('img', { alt: '', src: p.thumb, draggable: false }));
    const body = h('div.tcr-cb', {}, h('b.tcr-ct', { text: p.title }), h(`p.tcr-st.tcr-st--${g.tone}`, {}, ic(g.icon, 'ic ic--xs'), h('span', { text: g.text })));
    if (!g.blocked) {
      const track = h('ol.tcr-track', { attrs: { 'aria-label': `Étape ${Math.min(g.at + 1, 4)} sur 4` } });
      const cls = (i) => (i < g.at ? '.is-done' : i === g.at ? (g.next ? '.is-next' : '.is-now') : '');
      STEPS.forEach((label, i) => track.append(h(`li${cls(i)}`, {}, h('i'), h('span', { text: label }))));
      body.append(track);
    } else if (p.message) {
      body.append(h('q.tcr-msg', { text: p.message }));
    }
    const acts = h('div.tcr-acts');
    if (p.status === 'consent') acts.append(tbtn('Relancer', 'send', 'tbtn--ghost tbtn--sm', () => remind(p)));
    if (p.status === 'pending' || p.status === 'blocked') {
      const rm = h('button.tcr-rm', { type: 'button', text: 'Retirer' });
      rm.addEventListener('click', async () => {
        // Une carte bloquée retirée rend une proposition aujourd'hui ; une carte en attente, non.
        const ask = p.status === 'blocked' ? `Retirer « ${p.title} » ? Elle est supprimée et te rend une proposition aujourd’hui, pour en envoyer une autre version.` : `Retirer « ${p.title} » ? Elle ne sera pas imprimée, et ne te rend pas de proposition aujourd’hui.`;
        if (!confirm(ask)) return;
        try {
          const res = await api.withdraw(p.id);
          await ctx.reload();
          toast(res?.credited ? 'Carte retirée : une proposition de plus aujourd’hui.' : 'Carte retirée.', 'check');
        } catch (e) {
          toast(e.message, 'alert');
        }
      });
      acts.append(rm);
    }
    if (acts.childElementCount) body.append(acts);
    list.append(h(`li.tcr-card.tcr-card--${g.tone}`, {}, thumb, body));
  }
  sec.append(list);
  return sec;
}

/** Vue « Créer » du dock. */
/** Atelier fermé : la date « propositions jusqu'au » est passée. */
function closedWorkshop(ctx, { launch, heading }) {
  const waves = (ctx.st ?? ctx.pub)?.waves ?? [];
  const w = waves.find((x) => !x.printed && x.proposalsUntil && new Date(x.proposalsUntil) <= Date.now());
  const since = w ? ` depuis le ${dateShort(w.proposalsUntil).replace('.', '')}` : '';
  const head = h(
    'header.tv-head.tcr-head',
    {},
    h(
      'div',
      {},
      h('p.tk', { text: 'Atelier' }),
      h(`${heading}.tv-h1`, { tabIndex: -1, text: 'Propositions closes' }),
      h('p.tcr-lead', { text: `Les propositions${w ? ` de la vague ${w.n}` : ''} sont closes${since}. ${launch ? 'Place au jury de lancement, puis au lancement.' : 'Place au jury.'} L’atelier rouvrira avec la prochaine vague.` }),
    ),
  );
  return h('div.tcr-host', {}, head, h('section.tcr', {}, proposalsList(ctx, launch)));
}

export function renderCreate(ctx) {
  return h('section.tcr-page', {}, createForm(ctx, { launch: ctx.phase === 'soon' }));
}
