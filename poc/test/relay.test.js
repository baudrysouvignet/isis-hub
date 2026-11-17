import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, connect } from 'node:net';
import { randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { createRelay, PORTALS } from '../relay/relay.mjs';

// Le « portail » du test renvoie tel quel ce qu'il reçoit : on vérifie que le relais ne change pas un octet.
let echo, relay, target, relayPort;

before(async () => {
  echo = createServer((socket) => socket.pipe(socket)).listen(0, '127.0.0.1');
  await once(echo, 'listening');
  target = `127.0.0.1:${echo.address().port}`;
  relay = createRelay({ targets: new Set([target]), origins: ['https://site.example'], maxPerClient: 2 }).listen(0, '127.0.0.1');
  await once(relay, 'listening');
  relayPort = relay.address().port;
});

after(() => {
  echo.close();
  relay.close();
});

/** Client WebSocket minimal (Node 20 n'en fournit pas) : poignée de main puis trames masquées. */
async function open(path, origin = 'https://site.example') {
  const socket = connect(relayPort, '127.0.0.1');
  socket.write(
    `GET /${path} HTTP/1.1\r\nHost: relais\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n` +
      `Sec-WebSocket-Key: ${randomBytes(16).toString('base64')}\r\nSec-WebSocket-Version: 13\r\nOrigin: ${origin}\r\n\r\n`,
  );
  let buffer = Buffer.alloc(0);
  socket.on('data', (chunk) => (buffer = Buffer.concat([buffer, chunk])));
  const until = async (ready) => {
    while (!ready()) await Promise.race([once(socket, 'data'), once(socket, 'close')]).then(() => socket.destroyed && !ready() && Promise.reject(new Error('fermé')));
  };
  await until(() => buffer.includes('\r\n\r\n')).catch(() => {});
  const head = buffer.subarray(0, buffer.indexOf('\r\n\r\n')).toString();
  buffer = buffer.subarray(buffer.indexOf('\r\n\r\n') + 4);

  const send = (payload, opcode = 0x2) => {
    const mask = randomBytes(4);
    const n = payload.length;
    const header = n < 126 ? Buffer.from([0x80 | opcode, 0x80 | n]) : n < 65536 ? Buffer.from([0x80 | opcode, 0xfe, n >> 8, n & 0xff]) : null;
    const masked = Buffer.from(payload.map((byte, i) => byte ^ mask[i & 3]));
    socket.write(Buffer.concat([header, mask, masked]));
  };
  /** Lit des trames jusqu'à avoir `length` octets de charge utile. */
  const receive = async (length) => {
    const parts = [];
    let got = 0;
    while (got < length) {
      await until(() => buffer.length >= 2);
      let n = buffer[1] & 0x7f;
      let offset = 2;
      if (n === 126) {
        await until(() => buffer.length >= 4);
        n = buffer.readUInt16BE(2);
        offset = 4;
      } else if (n === 127) {
        await until(() => buffer.length >= 10);
        n = Number(buffer.readBigUInt64BE(2));
        offset = 10;
      }
      await until(() => buffer.length >= offset + n);
      assert.equal(buffer[1] & 0x80, 0, 'le relais ne masque pas ses trames');
      parts.push({ opcode: buffer[0] & 0x0f, payload: buffer.subarray(offset, offset + n) });
      buffer = buffer.subarray(offset + n);
      got += n;
    }
    return parts;
  };
  const status = head.split('\r\n')[0];
  if (!status.includes(' 101 ')) socket.destroy();
  return { status, socket, send, receive };
}

test('la liste des destinations du relais se limite aux quatre portails', () => {
  assert.deepEqual([...PORTALS].sort(), ['adecampus.univ-jfc.fr:443', 'auth.univ-jfc.fr:443', 'mail.univ-jfc.fr:443', 'moodle.univ-jfc.fr:443']);
});

test('relais : les octets traversent intacts, quelle que soit la taille des trames', async () => {
  const ws = await open(target);
  assert.equal(ws.status, 'HTTP/1.1 101 Switching Protocols');

  for (const size of [1, 125, 126, 4000, 60000]) {
    const sent = randomBytes(size);
    ws.send(sent);
    const frames = await ws.receive(size);
    assert.ok(frames.every((f) => f.opcode === 0x2));
    assert.ok(Buffer.concat(frames.map((f) => f.payload)).equals(sent), `${size} octets`);
  }

  ws.send(Buffer.from('ping'), 0x9);
  const [pong] = await ws.receive(4);
  assert.deepEqual([pong.opcode, pong.payload.toString()], [0xa, 'ping']);
  ws.socket.destroy();
});

test('relais : destination, origine ou surnombre refusés', async () => {
  assert.equal((await open('example.com:443')).status, 'HTTP/1.1 403 Forbidden');
  assert.equal((await open('auth.univ-jfc.fr:22')).status, 'HTTP/1.1 403 Forbidden');
  assert.equal((await open(target, 'https://autre-site.example')).status, 'HTTP/1.1 403 Forbidden');

  const first = await open(target);
  const second = await open(target);
  assert.equal((await open(target)).status, 'HTTP/1.1 429 Too Many Requests');
  first.socket.destroy();
  await once(first.socket, 'close');
  await new Promise((resolve) => setTimeout(resolve, 50));
  const third = await open(target); // la place libérée est rendue
  assert.equal(third.status, 'HTTP/1.1 101 Switching Protocols');
  second.socket.destroy();
  third.socket.destroy();
});
