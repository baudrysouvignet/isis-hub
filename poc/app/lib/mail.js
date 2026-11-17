import { HOSTS, NotLoggedIn } from './config.js';
import { http } from './http.js';

// Messagerie = BlueMind 5. Sa webapp lit /session-infos (cookie de session) pour obtenir
// l'identifiant de session `sid`, puis appelle l'API REST /api avec l'en-tête X-BM-ApiKey.
// On fait exactement pareil ; `sid` n'est gardé qu'en mémoire.
let session = null;

export const reset = () => {
  session = null;
};

async function readSessionInfos() {
  const res = await http(`${HOSTS.mail}/session-infos`);
  if (new URL(res.url).origin !== HOSTS.mail) return null; // renvoyé vers le formulaire CAS
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
  if (!infos) throw new NotLoggedIn('messagerie');
  session = infos;
  return { email: infos.defaultEmail, name: infos.formatedName };
}

async function api(path, body, retry = true) {
  if (!session) await connect();
  const res = await http(`${HOSTS.mail}/api/${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      'X-BM-ApiKey': session.sid,
      ...(body !== undefined && { 'Content-Type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (res.status === 401 || res.status === 403) {
    session = null;
    if (retry) return api(path, body, false);
    throw new NotLoggedIn('messagerie');
  }
  if (!res.ok) throw new Error(`La messagerie a répondu HTTP ${res.status}`);
  return res.json();
}

/** Les `count` derniers messages de la boîte de réception + le nombre de non-lus. */
export async function latestMails(count) {
  if (!session) await connect();
  const domain = session.domain.replaceAll('.', '_');
  const folders = await api(`mail_folders/${domain}/user.${session.userId}/_all`);
  const inbox = folders.find((f) => f.value?.fullName === 'INBOX');
  if (!inbox) throw new Error('Boîte de réception introuvable');

  const notDeleted = { must: [], mustNot: ['Deleted'] };
  const [ids, unread] = await Promise.all([
    api(`mail_items/${inbox.uid}/_sorted`, {
      fields: [{ column: 'internal_date', dir: 'Desc' }],
      filter: notDeleted,
    }),
    api(`mail_items/${inbox.uid}/_count`, { must: [], mustNot: ['Deleted', 'Seen'] }),
  ]);
  const wanted = ids.slice(0, count);
  const items = wanted.length ? await api(`mail_items/${inbox.uid}/_mgetById`, wanted) : [];

  const mails = items
    .sort((a, b) => wanted.indexOf(a.internalId) - wanted.indexOf(b.internalId))
    .map((item) => {
      const body = item.value.body;
      const from = body.recipients?.find((r) => r.kind === 'Originator') ?? {};
      return {
        id: item.internalId,
        subject: body.subject || '(sans objet)',
        fromName: from.dn || from.address || 'Expéditeur inconnu',
        fromAddress: from.address || '',
        date: new Date(body.date || item.value.internalDate),
        preview: body.preview || '',
        unread: !item.flags?.includes('Seen'),
        url: `${HOSTS.mail}/webapp/mail/.t/${inbox.uid}:${item.internalId}`,
      };
    });

  return { mails, unread: unread.total ?? 0, inboxUrl: `${HOSTS.mail}/webapp/mail/` };
}
