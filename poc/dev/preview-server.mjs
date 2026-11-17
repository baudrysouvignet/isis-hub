// Serveur local de développement : sert le dossier app/ tel qu'il sera mis en ligne.
//   npm run web                      → http://localhost:4173        l'appli web (lancer aussi `npm run relay`)
//   http://localhost:4173/demo       → l'interface avec des données fictives (dev/mock.js), sans réseau
//   http://localhost:4173/demo?anon  → idem, état « non connecté »
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const port = Number(process.env.PORT) || 4173;
const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.wasm': 'application/wasm',
  '.png': 'image/png',
};

createServer(async (req, res) => {
  const { pathname } = new URL(req.url, 'http://localhost');
  const send = (status, type, body) => {
    res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' });
    res.end(body);
  };
  try {
    if (pathname === '/demo') {
      const html = await readFile(join(root, 'app', 'dashboard.html'), 'utf8');
      return send(200, types['.html'], html.replace('<script type="module"', '<script src="/dev/mock.js"></script>\n    <script type="module"'));
    }
    const file = join(root, pathname.startsWith('/dev/') ? '' : 'app', pathname === '/' ? 'index.html' : pathname);
    if (!file.startsWith(root + (root.endsWith(sep) ? '' : sep))) return send(403, 'text/plain', 'Interdit');
    send(200, types[extname(file)] ?? 'application/octet-stream', await readFile(file));
  } catch {
    send(404, 'text/plain', 'Introuvable');
  }
}).listen(port, () => console.log(`ISIS Hub : http://localhost:${port}  (données fictives : /demo)`));
