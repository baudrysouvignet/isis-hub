// Messagerie BlueMind 5. Comme sa propre webapp : /session-infos (cookie de session) donne une clé
// `sid`, envoyée ensuite dans l'en-tête X-BM-ApiKey de l'API REST /api. La clé reste en mémoire.
//
// Lire un mail dans ISIS Hub le lit VRAIMENT dans la boîte : le drapeau \Seen est posé sur le
// serveur, donc le mail apparaît lu partout (webmail, téléphone, client de messagerie).

import { HOSTS, NotSignedIn } from './config.js';
import { http } from '../net/http.js';

let session = null; // { sid, domain, userId, defaultEmail, formatedName }
let inbox = null; // { uid }
let folders = null; // nom complet → { uid, id } (INBOX, Outbox, Sent, Trash…)

export const reset = () => {
  session = null;
  inbox = null;
  folders = null;
};

async function readSessionInfos() {
  const res = await http(`${HOSTS.mail}/session-infos`);
  if (new URL(res.url).origin !== HOSTS.mail) return null; // renvoyé vers le formulaire du CAS
  try {
    const infos = await res.json();
    return infos.sid ? infos : null;
  } catch {
    return undefined; // le SSO vient d'aboutir sur la page d'accueil : il faut redemander
  }
}

export async function connect() {
  let infos = await readSessionInfos();
  if (infos === undefined) infos = await readSessionInfos();
  if (!infos) throw new NotSignedIn('messagerie');
  session = infos;
  return { email: infos.defaultEmail ?? '', name: infos.formatedName ?? '', login: infos.login ?? '' };
}

async function api(path, { method, body, bytes, raw = false } = {}, retry = true) {
  if (!session) await connect();
  const json = body !== undefined;
  const res = await http(`${HOSTS.mail}/api/${path}`, {
    method: method ?? (json || bytes ? 'POST' : 'GET'),
    headers: {
      'X-BM-ApiKey': session.sid,
      ...(json && { 'Content-Type': 'application/json' }),
      ...(bytes && { 'Content-Type': 'application/octet-stream' }),
    },
    body: bytes ?? (json ? JSON.stringify(body) : undefined),
  });
  if (res.status === 401 || res.status === 403) {
    session = null;
    if (retry) return api(path, { method, body, bytes, raw }, false);
    throw new NotSignedIn('messagerie');
  }
  if (!res.ok) {
    // Message d'erreur de BlueMind (JSON { message, errorCode }) : utile au diagnostic, sans contenu.
    let detail = '';
    try {
      const err = JSON.parse(await res.text());
      detail = [err.errorCode, err.message].filter(Boolean).join(' : ').slice(0, 200);
    } catch {}
    throw Object.assign(new Error(`La messagerie a répondu HTTP ${res.status}${detail ? ` (${detail})` : ''}`), { status: res.status });
  }
  if (raw) return res;
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

const foldersPath = () => `mail_folders/${session.domain.replaceAll('.', '_')}/user.${session.userId}`;

// Noms possibles de la corbeille selon la configuration de la messagerie.
const ALIASES = {
  Trash: /^(trash|corbeille|deleted( items| messages)?|éléments supprimés)$/i,
  Sent: /^(sent( items| messages)?|envoyés|messages envoyés|éléments envoyés)$/i,
};

async function folder(fullName) {
  if (!session) await connect();
  if (!folders) {
    const all = await api(`${foldersPath()}/_all`);
    folders = new Map(all.map((f) => [f.value?.fullName, { uid: f.uid, id: f.internalId }]));
  }
  let found = folders.get(fullName);
  if (!found && ALIASES[fullName]) {
    const name = [...folders.keys()].find((n) => ALIASES[fullName].test(n ?? ''));
    found = name ? folders.get(name) : null;
  }
  if (!found) throw new Error(`Dossier « ${fullName} » introuvable dans la messagerie`);
  return found;
}
const folderUid = async (fullName) => (await folder(fullName)).uid;
const folderByUid = (uid) => [...(folders?.values() ?? [])].find((f) => f.uid === uid);

async function inboxUid() {
  if (inbox) return inbox.uid;
  inbox = { uid: await folderUid('INBOX') };
  return inbox.uid;
}

export const inboxUrl = () => `${HOSTS.mail}/webapp/mail/`;

/** Boîtes affichées dans le Hub : réception et corbeille. */
export const BOXES = { inbox: 'INBOX', sent: 'Sent', trash: 'Trash' };
const boxUid = (box = 'inbox') => (box === 'inbox' ? inboxUid() : folderUid(BOXES[box]));

/** Tous les identifiants d'une boîte, du plus récent au plus ancien, et le nombre de non-lus. */
export async function listInbox(box = 'inbox') {
  const uid = await boxUid(box);
  const [ids, unread] = await Promise.all([
    api(`mail_items/${uid}/_sorted`, {
      body: { fields: [{ column: 'internal_date', dir: 'Desc' }], filter: { must: [], mustNot: ['Deleted'] } },
    }),
    api(`mail_items/${uid}/_count`, { body: { must: [], mustNot: ['Deleted', 'Seen'] } }),
  ]);
  return { ids, unread: unread?.total ?? 0 };
}

const person = (r = {}) => ({ name: r.dn || r.address || '', address: r.address || '' });

function toMail(item, uid) {
  const v = item.value;
  const body = v.body ?? {};
  const recipients = body.recipients ?? [];
  const from = person(recipients.find((r) => r.kind === 'Originator'));
  return {
    id: item.internalId,
    imapUid: v.imapUid,
    subject: body.subject || '(sans objet)',
    from,
    to: recipients.filter((r) => r.kind === 'Primary').map(person),
    cc: recipients.filter((r) => r.kind === 'CarbonCopy').map(person),
    date: new Date(body.date || v.internalDate || Date.now()),
    preview: (body.preview || '').replace(/\s+/g, ' ').trim(),
    unread: !(item.flags ?? []).includes('Seen'),
    folder: uid,
    structure: body.structure ?? null,
    messageId: body.messageId ?? null,
    references: body.references ?? [],
    url: `${HOSTS.mail}/webapp/mail/.t/${uid}:${item.internalId}`,
  };
}

/** Détails de quelques mails, dans l'ordre des identifiants demandés. */
export async function getMails(ids, box = 'inbox') {
  if (!ids.length) return [];
  const uid = await boxUid(box);
  const items = await api(`mail_items/${uid}/_mgetById`, { body: ids });
  const order = new Map(ids.map((id, i) => [id, i]));
  return items.sort((a, b) => order.get(a.internalId) - order.get(b.internalId)).map((item) => toMail(item, uid));
}

// -------------------------------------------------------------- lecture

function* walk(part) {
  if (!part) return;
  yield part;
  for (const child of part.children ?? []) yield* walk(child);
}

const isAttachment = (p) => /attachment/i.test(p.dispositionType ?? '') || Boolean(p.fileName);

/** Partie à afficher : HTML de préférence, sinon texte brut. Plus la liste des pièces jointes. */
export function pickParts(structure) {
  const parts = [...walk(structure)];
  const html = parts.find((p) => p.mime === 'text/html' && !isAttachment(p));
  const text = parts.find((p) => p.mime === 'text/plain' && !isAttachment(p));
  const attachments = parts
    .filter((p) => isAttachment(p) && !/^multipart\//.test(p.mime ?? ''))
    .map((p) => ({ name: p.fileName || 'pièce jointe', size: p.size ?? 0, mime: p.mime, part: p }));
  return { body: html ?? text ?? null, attachments };
}

function decodeBytes(bytes, charset) {
  try {
    return new TextDecoder(charset || 'utf-8').decode(bytes);
  } catch {
    return new TextDecoder('utf-8').decode(bytes);
  }
}

/** Contenu du mail : { kind: 'html'|'text', content, attachments }. */
export async function fetchBody(mail) {
  const uid = mail.folder ?? (await inboxUid());
  const { body, attachments } = pickParts(mail.structure);
  if (!body) return { kind: 'text', content: mail.preview, attachments };
  const query = new URLSearchParams({ mime: body.mime });
  if (body.encoding) query.set('encoding', body.encoding);
  if (body.charset) query.set('charset', body.charset);
  const res = await api(
    `mail_items/${uid}/part/${mail.imapUid}/${encodeURIComponent(body.address)}?${query}`,
    { raw: true },
  );
  const content = decodeBytes(res.bytes(), body.charset);
  return { kind: body.mime === 'text/html' ? 'html' : 'text', content, attachments };
}

const SEEN = { flag: '\\Seen', value: 16 }; // MailboxItemFlag.System.Seen (5ᵉ drapeau système : 1 << 4)

/** Marque le mail comme lu dans la boîte (drapeau IMAP \Seen posé par le serveur). */
export async function markRead(mail) {
  const uid = mail.folder ?? (await inboxUid());
  await api(`mail_items/${uid}/_addFlag`, { method: 'PUT', body: { itemsId: [mail.id], mailboxItemFlag: SEEN } });
  const [after] = await api(`mail_items/${uid}/_mgetById`, { body: [mail.id] });
  return (after?.flags ?? []).includes('Seen');
}

// ------------------------------------------------- corbeille, suppression

const DELETED = { flag: '\\Deleted', value: 4 }; // MailboxItemFlag.System.Deleted (1 << 2)

/** Mails encore présents (non marqués supprimés) dans un dossier, parmi `ids`. */
async function stillThere(uid, ids) {
  const items = await api(`mail_items/${uid}/_mgetById`, { body: ids });
  return (items ?? []).filter((i) => !(i.flags ?? []).includes('Deleted')).map((i) => i.internalId);
}

/** Journal du dernier déplacement ou de la dernière suppression (étapes et codes, jamais de contenu). */
export const moveTrace = [];

/**
 * Déplace des mails (d'un même dossier) vers une autre boîte. Essaie, dans l'ordre :
 * 1. IItemsTransfer.move de BlueMind : POST `mail_items_transfer/{source}/{destination}/move`,
 *    corps = identifiants ; 2. IMailboxFolders.importItems : PUT `importItems/{destination}` avec
 *    retrait de la source (API BlueMind 5, pkg.bluemind.net/pkg/5.3.2729/javadoc).
 * Le résultat est vérifié : le mail doit avoir quitté le dossier d'origine.
 */
export async function moveTo(mails, box) {
  if (!mails.length) return;
  moveTrace.length = 0;
  const src = mails[0].folder;
  await folder('INBOX'); // charge la liste des dossiers
  const from = folderByUid(src);
  const to = await folder(BOXES[box]);
  if (!from) throw new Error('dossier d’origine inconnu');
  if (to.uid === src) return;
  const ids = mails.map((m) => m.id);
  const attempts = [
    ['transfert', () => api(`mail_items_transfer/${encodeURIComponent(src)}/${encodeURIComponent(to.uid)}/move`, { method: 'POST', body: ids })],
    ['import', () => api(`${foldersPath()}/importItems/${to.id}`, { method: 'PUT', body: { mailboxFolderId: from.id, ids: ids.map((id) => ({ id })), expectedIds: [], deleteFromSource: true } })],
  ];
  let lastError = null;
  for (const [name, run] of attempts) {
    try {
      const out = await run();
      moveTrace.push({ step: name, ok: true, out });
    } catch (err) {
      if (err instanceof NotSignedIn) throw err;
      moveTrace.push({ step: name, ok: false, error: err.message });
      lastError = err;
      continue;
    }
    for (let i = 0; i < 6; i++) {
      if (!(await stillThere(src, ids)).length) return;
      await sleep(400); // la messagerie met parfois un instant à retirer l'original
    }
    lastError = new Error('la messagerie a accepté mais le mail est toujours là');
  }
  const steps = moveTrace.map((t) => `${t.step} → ${t.ok ? 'accepté' : t.error}`).join(' ; ');
  throw new Error(`mail non déplacé (${steps || lastError?.message || 'raison inconnue'})`);
}

/** Supprime définitivement (drapeau \Deleted puis purge du dossier). Irréversible. */
export async function destroy(mails) {
  if (!mails.length) return;
  const uid = mails[0].folder;
  const ids = mails.map((m) => m.id);
  moveTrace.length = 0;
  await api(`mail_items/${uid}/_multipleDelete`, { method: 'DELETE', body: ids }).catch((e) => moveTrace.push({ step: '_multipleDelete', error: e.message }));
  if (!(await stillThere(uid, ids)).length) return;
  for (const id of ids) {
    await api(`mail_items/${uid}/id/${id}`, { method: 'DELETE' }).catch((e) => moveTrace.push({ step: 'deleteById', error: e.message }));
  }
  if (!(await stillThere(uid, ids)).length) return;
  await api(`mail_items/${uid}/_addFlag`, { method: 'PUT', body: { itemsId: ids, mailboxItemFlag: DELETED } });
  await api(`mail_items/${uid}/_expunge`, { method: 'POST' }).catch((e) => moveTrace.push({ step: '_expunge', error: e.message }));
  if ((await stillThere(uid, ids)).length) {
    const steps = moveTrace.map((t) => `${t.step} → ${t.error}`).join(' ; ');
    throw new Error(`mail non supprimé${steps ? ` (${steps})` : ''}`);
  }
}

// -------------------------------------------------------------- annuaire

const STUDENT_DOMAIN = /@etud\./i;

/**
 * Recherche dans les carnets d'adresses de la messagerie (dont l'annuaire partagé de
 * l'université). Rend [{ name, email, cat: 'staff' | 'etud' | 'liste' }].
 */
export async function searchContacts(query, size = 20) {
  const q = query.trim();
  if (q.length < 2) return [];
  const res = await api('addressbooks/_search', { body: { from: 0, size, query: q, escapeQuery: true } });
  const seen = new Set();
  const out = [];
  for (const item of res?.values ?? []) {
    const v = item.value ?? {};
    const email = (v.mail || '').trim().toLowerCase();
    if (!email || seen.has(email)) continue;
    seen.add(email);
    out.push({
      name: v.formatedName || email,
      email,
      cat: v.kind === 'group' ? 'liste' : STUDENT_DOMAIN.test(email) ? 'etud' : 'staff',
    });
  }
  return out;
}

// -------------------------------------------------------------- envoi

export const EMAIL_RE = /^[^@\s<>(),;:"\\]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$/;
export const MAX_ATTACHMENTS = 15 * 1024 * 1024; // 15 Mo au total

/** Identité de l'expéditeur : celle de la session de messagerie. */
export async function me() {
  if (!session) await connect();
  return { address: session.defaultEmail ?? '', name: session.formatedName ?? '' };
}

/** Octets bruts d'une partie (pièce jointe d'un mail transféré). */
export async function partBytes(mail, part) {
  const uid = mail.folder ?? (await inboxUid());
  const query = new URLSearchParams();
  if (part.encoding) query.set('encoding', part.encoding);
  const res = await api(`mail_items/${uid}/part/${mail.imapUid}/${encodeURIComponent(part.address)}?${query}`, { raw: true });
  return res.bytes();
}

/** Partie de pièce jointe telle que décrite par la messagerie (pour la retransmettre). */
export const attachmentParts = (structure) =>
  [...walk(structure)].filter((p) => isAttachment(p) && !/^multipart\//.test(p.mime ?? ''));

async function upload(folder, bytes) {
  const res = await api(`mail_items/${folder}/_part`, { method: 'PUT', bytes, raw: true });
  const text = (await res.text()).trim();
  return text.startsWith('"') ? JSON.parse(text) : text;
}

/**
 * Journal du dernier envoi, pour le diagnostic : étapes et réponses de la messagerie, jamais le
 * contenu du message ni les adresses. Gardé en mémoire seulement.
 */
export const sendTrace = [];
const trace = (step, detail) => sendTrace.push({ t: Math.round(performance.now()), step, detail });

const oneLine = (s) => s.replace(/[\r\n]+/g, ' ').trim();

/**
 * Envoie un message par la messagerie de l'étudiant :
 * pièces déposées sur le serveur, message créé dans la boîte d'envoi, puis expédition demandée.
 * `files` : [{ name, type, bytes: Uint8Array }]. Rend quand le serveur a confirmé l'expédition.
 */
export async function send({ to, cc = [], subject, text, files = [], inReplyTo = null, references = [] }) {
  const all = [...to, ...cc];
  if (!to.length) throw new Error('Ajoute au moins un destinataire.');
  if (all.length > 50) throw new Error('50 destinataires au maximum.');
  const bad = all.find((r) => !EMAIL_RE.test(r.address));
  if (bad) throw new Error(`Adresse invalide : ${bad.address}`);
  const total = files.reduce((n, f) => n + f.bytes.length, 0);
  if (total > MAX_ATTACHMENTS) throw new Error('Pièces jointes trop lourdes (15 Mo au total).');

  sendTrace.length = 0;
  const from = await me();
  trace('identité', { domain: session.domain, userId: session.userId, fromDomain: from.address.split('@')[1] });
  const outbox = await folderUid('Outbox');
  trace('boîte d’envoi', { uid: outbox, dossiers: [...folders.keys()] });
  const textPart = {
    mime: 'text/plain',
    charset: 'utf-8',
    encoding: 'quoted-printable',
    address: await upload(outbox, new TextEncoder().encode(text)),
  };
  const attachments = [];
  for (const f of files) {
    attachments.push({
      mime: f.type || 'application/octet-stream',
      fileName: oneLine(f.name).slice(0, 200),
      encoding: 'base64',
      dispositionType: 'ATTACHMENT',
      size: f.bytes.length,
      address: await upload(outbox, f.bytes),
    });
  }
  const structure = attachments.length ? { mime: 'multipart/mixed', children: [textPart, ...attachments] } : textPart;
  // En-têtes que la webmail BlueMind pose sur tout message à expédier : sans le dossier
  // « Envoyés » et l'identité d'envoi, l'expédition échoue (drapeau BmSendFailure).
  const headers = [
    { name: 'X-Bm-Draft-Sent-Folder', values: [await folderUid('Sent')] },
    { name: 'X-Bm-Draft-Identity', values: ['default'] },
    { name: 'X-Bm-Draft-Refresh-Date', values: [String(Date.now())] },
  ];
  if (inReplyTo) {
    headers.push({ name: 'In-Reply-To', values: [inReplyTo] });
    headers.push({ name: 'References', values: [[...references, inReplyTo].join(' ')] });
  }
  const recipient = (kind) => (r) => ({ kind, address: r.address, dn: oneLine(r.name || r.address) });
  const domain = from.address.split('@')[1] || session.domain;
  const item = {
    body: {
      subject: oneLine(subject).slice(0, 500),
      date: Date.now(),
      messageId: `<${crypto.randomUUID()}@${domain}>`,
      recipients: [recipient('Originator')(from), ...to.map(recipient('Primary')), ...cc.map(recipient('CarbonCopy'))],
      structure,
      headers,
    },
    flags: [],
  };
  const created = await api(`mail_items/${outbox}`, { method: 'PUT', body: item });
  const id = created?.id;
  trace('message créé', created);

  // 1. La boîte d'envoi est mise à jour de façon asynchrone : on attend d'y voir le message,
  //    sinon l'expédition demandée tout de suite trouverait une boîte vide.
  let failed = false; // drapeau BmSendFailure : la messagerie a essayé et refusé
  const inOutbox = async () => {
    if (!id) return null;
    const found = await api(`mail_items/${outbox}/_mgetById`, { body: [id] }).catch(() => null);
    failed = (found?.[0]?.value?.flags ?? []).some((f) => /sendfailure/i.test(f?.flag ?? f));
    return found?.length > 0;
  };
  let seen = 0;
  for (; seen < 20 && id && !(await inOutbox()); seen++) await sleep(500);
  trace('présent dans la boîte d’envoi', { attentes: seen, présent: await inOutbox() });

  // 2. Expédition, suivie jusqu'au bout ; 3. vérification que le message a quitté la boîte d'envoi.
  let lastError = '';
  for (let attempt = 0; attempt < 3; attempt++) {
    const result = await flush();
    trace(`expédition ${attempt + 1}`, result);
    if (result.error) lastError = result.error;
    for (let i = 0; i < 10; i++) {
      const still = await inOutbox();
      if (i === 0 || still === false) trace('encore dans la boîte d’envoi ?', still);
      if (still === false) return { confirmed: true };
      if (still === null) return { confirmed: result.ok }; // identifiant inconnu : on se fie à la tâche
      if (failed) {
        trace('échec signalé par la messagerie', 'BmSendFailure');
        throw new Error(
          'la messagerie a refusé d’expédier ce message (il reste dans ta boîte d’envoi, marqué en échec). ' +
            'Vérifie les adresses, puis supprime-le de la boîte d’envoi dans la messagerie.',
        );
      }
      await sleep(600);
    }
  }
  throw new Error(
    `le message est dans ta boîte d’envoi mais la messagerie ne l’a pas expédié${lastError ? ` (${lastError})` : ''}. ` +
      'Il partira à la prochaine expédition : vérifie-le dans la messagerie.',
  );
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Demande à la messagerie d'expédier la boîte d'envoi et suit la tâche (TaskStatus). */
async function flush() {
  const task = await api(`outbox/${encodeURIComponent(session.domain)}/${encodeURIComponent(session.userId)}/flush`, { method: 'POST' });
  trace('tâche', task);
  if (!task?.id) return { ok: false, error: 'aucune tâche d’expédition renvoyée' };
  const taskPath = `tasks/${encodeURIComponent(task.id)}`;
  for (let i = 0; i < 40; i++) {
    await sleep(500);
    const status = await api(taskPath).catch((e) => ({ erreur: e.message }));
    if (i === 0 || status?.state !== 'InProgress') trace('statut de la tâche', status);
    const state = status?.state ?? '';
    if (/success/i.test(state)) return { ok: true };
    if (/error|fail/i.test(state)) {
      const logs = await api(`${taskPath}/_currentLogs?offset=0`).catch(() => []);
      trace('journal de la tâche', logs);
      const reason = [status.lastLogEntry, status.result, ...(Array.isArray(logs) ? logs.slice(-2) : [])].filter(Boolean).join(' · ');
      return { ok: false, error: reason.slice(0, 300) || 'erreur sans détail' };
    }
  }
  return { ok: false, error: 'pas de réponse de la tâche d’expédition' };
}
