// Empreintes SHA-256 de tous les fichiers de app/, écrites dans app/checksums.json.
// À relancer après toute modification de app/ :  npm run checksums
// La « version » affichée dans l'appli est l'empreinte de cette liste : deux copies de même version
// contiennent exactement les mêmes fichiers.
import { createHash } from 'node:crypto';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const APP = fileURLToPath(new URL('../app/', import.meta.url));
export const OUTPUT = join(APP, 'checksums.json');
const sha256 = (data) => createHash('sha256').update(data).digest('hex');

async function* walk(dir) {
  for (const entry of (await readdir(dir, { withFileTypes: true })).sort((a, b) => (a.name < b.name ? -1 : 1))) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(path);
    else if (path !== OUTPUT && entry.name !== '.DS_Store') yield path;
  }
}

export async function compute() {
  const files = {};
  for await (const path of walk(APP)) files[relative(APP, path).split(sep).join('/')] = sha256(await readFile(path));
  const version = sha256(Object.entries(files).map(([path, hash]) => `${hash}  ${path}\n`).join('')).slice(0, 12);
  return { version, files };
}

export const serialize = (sums) => `${JSON.stringify(sums, null, 2)}\n`;

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const sums = await compute();
  await writeFile(OUTPUT, serialize(sums));
  console.log(`version ${sums.version} : ${Object.keys(sums.files).length} fichiers`);
}
