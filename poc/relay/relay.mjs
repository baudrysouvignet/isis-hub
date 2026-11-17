// Relais aveugle : un WebSocket entrant = une connexion TCP sortante vers l'un des portails autorisés.
// Le TLS est négocié par le navigateur avec le portail ; ce programme ne fait que recopier des octets
// chiffrés. Il ne connaît ni mot de passe, ni cookie, ni contenu, et n'écrit aucun journal.
// Aucune dépendance : tout ce que fait le relais est dans ce fichier.
//
//   node relay/relay.mjs [--debug]
//     PORT=8787                                 port d'écoute (derrière un frontal HTTPS pour offrir wss://)
//     ALLOWED_ORIGINS=https://mon-site.example  seules ces pages peuvent s'y connecter (vide = toutes, en local)
//     TRUST_PROXY=1                             lire l'adresse du client dans X-Forwarded-For (derrière un frontal)
//     MAX_PER_CLIENT=200  MAX_TOTAL=2000        plafonds de connexions simultanées
//   --debug affiche, par connexion, la cible et les premiers octets échangés (pour constater que c'est du TLS).
import { createServer } from 'node:http';
import { connect } from 'node:net';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';

export const PORTALS = new Set([
  'auth.univ-jfc.fr:443',
  'mail.univ-jfc.fr:443',
  'moodle.univ-jfc.fr:443',
  'adecampus.univ-jfc.fr:443',
]);

const MAX_FRAME = 1 << 20; // 1 Mo
const IDLE_MS = 120_000;
const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

function frame(opcode, payload) {
  const n = payload.length;
  const head = Buffer.alloc(n < 126 ? 2 : n < 65536 ? 4 : 10);
  head[0] = 0x80 | opcode;
  if (n < 126) head[1] = n;
  else if (n < 65536) (head[1] = 126), head.writeUInt16BE(n, 2);
  else (head[1] = 127), head.writeBigUInt64BE(BigInt(n), 2);
  return Buffer.concat([head, payload]);
}

/** Recopie les octets dans les deux sens jusqu'à la fermeture d'un des deux côtés. */
function tunnel(client, upstream, label, debug, release) {
  let pending = Buffer.alloc(0);
  let closed = false;
  const seen = { up: 0, down: 0 };
  const close = () => {
    if (closed) return;
    closed = true;
    client.destroy();
    upstream.destroy();
    release();
  };
  const peek = (direction, bytes) => {
    if (debug && seen[direction]++ === 0) {
      console.log(`${label} ${direction === 'up' ? '→' : '←'} ${bytes.subarray(0, 12).toString('hex')}…`);
    }
  };

  client.on('data', (chunk) => {
    pending = pending.length ? Buffer.concat([pending, chunk]) : chunk;
    for (;;) {
      if (pending.length < 2) return;
      const opcode = pending[0] & 0x0f;
      let length = pending[1] & 0x7f;
      let offset = 2;
      if (length === 126) {
        if (pending.length < 4) return;
        length = pending.readUInt16BE(2);
        offset = 4;
      } else if (length === 127) {
        if (pending.length < 10) return;
        length = Number(pending.readBigUInt64BE(2));
        offset = 10;
      }
      if (!(pending[1] & 0x80) || length > MAX_FRAME) return close(); // un navigateur masque toujours ses trames
      if (pending.length < offset + 4 + length) return;

      const mask = pending.subarray(offset, offset + 4);
      const payload = Buffer.from(pending.subarray(offset + 4, offset + 4 + length));
      for (let i = 0; i < length; i++) payload[i] ^= mask[i & 3];
      pending = pending.subarray(offset + 4 + length);

      if (opcode === 0x8) return close();
      if (opcode === 0x9) client.write(frame(0xa, payload));
      else if (opcode <= 0x2 && length) {
        peek('up', payload);
        if (!upstream.write(payload)) client.pause();
      }
    }
  });
  upstream.on('data', (chunk) => {
    peek('down', chunk);
    if (!client.write(frame(0x2, chunk))) upstream.pause();
  });
  upstream.on('drain', () => client.resume());
  client.on('drain', () => upstream.resume());

  for (const socket of [client, upstream]) {
    socket.setTimeout(IDLE_MS, close);
    socket.on('error', close);
    socket.on('end', close); // un côté a raccroché : on ne garde pas l'autre à moitié ouvert
    socket.on('close', close);
  }
}

export function createRelay({
  targets = PORTALS,
  origins = [],
  maxPerClient = 200,
  maxTotal = 2000,
  trustProxy = false,
  debug = false,
} = {}) {
  const perClient = new Map();
  let total = 0;

  const server = createServer((req, res) => {
    res.writeHead(426, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Relais WebSocket uniquement.');
  });

  server.on('upgrade', (req, client) => {
    const refuse = (status) => client.end(`HTTP/1.1 ${status}\r\nConnection: close\r\n\r\n`, () => client.destroy());
    const target = decodeURIComponent(req.url.slice(1).split('?')[0]);
    const key = req.headers['sec-websocket-key'];
    const originOk = !origins.length || origins.includes(req.headers.origin);
    if (!key || !originOk || !targets.has(target)) {
      if (debug) console.log(`refusé : ${target}`);
      return refuse('403 Forbidden');
    }

    const who = (trustProxy && req.headers['x-forwarded-for']?.split(',')[0].trim()) || client.remoteAddress;
    const mine = perClient.get(who) ?? 0;
    if (total >= maxTotal || mine >= maxPerClient) return refuse('429 Too Many Requests');
    total++;
    perClient.set(who, mine + 1);
    const release = () => {
      total--;
      const left = perClient.get(who) - 1;
      if (left) perClient.set(who, left);
      else perClient.delete(who);
    };

    const [host, port] = target.split(':');
    const upstream = connect({ host, port: Number(port) });
    const accept = createHash('sha1').update(key + WS_GUID).digest('base64');
    client.write(
      `HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`,
    );
    tunnel(client, upstream, target, debug, release);
  });

  return server;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const port = Number(process.env.PORT) || 8787;
  createRelay({
    origins: (process.env.ALLOWED_ORIGINS ?? '').split(',').filter(Boolean),
    maxPerClient: Number(process.env.MAX_PER_CLIENT) || undefined,
    maxTotal: Number(process.env.MAX_TOTAL) || undefined,
    trustProxy: process.env.TRUST_PROXY === '1',
    debug: process.argv.includes('--debug'),
  }).listen(port, () => console.log(`Relais aveugle à l'écoute sur le port ${port}`));
}
