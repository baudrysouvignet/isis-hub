// Compare un site en ligne, fichier par fichier, au code de ce dépôt.
//   node tools/verify-deploy.mjs https://mon-site.example/
// N'importe qui peut le lancer : si tout correspond, le site sert exactement le code publié ici.
import { createHash } from 'node:crypto';
import { compute } from './checksums.mjs';

const base = process.argv[2];
if (!base) {
  console.error('Usage : node tools/verify-deploy.mjs <adresse du site>');
  process.exit(2);
}

const { version, files } = await compute();
const root = new URL(base.endsWith('/') ? base : `${base}/`);
let different = 0;

for (const [path, expected] of Object.entries(files)) {
  let verdict;
  try {
    const res = await fetch(new URL(path, root), { cache: 'no-store' });
    const actual = createHash('sha256').update(Buffer.from(await res.arrayBuffer())).digest('hex');
    verdict = !res.ok ? `HTTP ${res.status}` : actual === expected ? null : 'contenu différent';
  } catch (error) {
    verdict = `injoignable (${error.cause?.code ?? error.message})`;
  }
  if (verdict) {
    different++;
    console.log(`✗ ${path} : ${verdict}`);
  }
}

const total = Object.keys(files).length;
if (different) {
  console.log(`\n${different} fichier(s) sur ${total} ne correspondent pas au dépôt (version locale ${version}).`);
  process.exit(1);
}
console.log(`✓ ${total} fichiers identiques au dépôt (version ${version}).`);
