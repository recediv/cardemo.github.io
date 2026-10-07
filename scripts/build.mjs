import { cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'dist');
const hash = createHash('sha256');
async function hashFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  entries.sort((a, b) => a.name.localeCompare(b.name, 'en'));
  for (const entry of entries) {
    const file = path.join(directory, entry.name);
    hash.update(path.relative(root, file).split(path.sep).join('/'));
    if (entry.isDirectory()) await hashFiles(file);
    else hash.update(await readFile(file));
  }
}
const html = await readFile(path.join(root, 'index.html'), 'utf8');
hash.update(html);
await hashFiles(path.join(root, 'src'));
await hashFiles(path.join(root, 'vendor'));
const version = hash.digest('hex').slice(0, 12);
const assetPath = `./assets/${version}`;
// Only remove this project's generated output, never its source directory.
if (path.dirname(out) !== root || path.basename(out) !== 'dist') throw new Error('Invalid build output directory');
await rm(out, { recursive: true, force: true });
const assets = path.join(out, 'assets', version);
await mkdir(assets, { recursive: true });
for (const entry of ['src', 'vendor']) {
  await cp(path.join(root, entry), path.join(assets, entry), { recursive: true });
  // Keep these routes available for cached pages from earlier deployments.
  await cp(path.join(root, entry), path.join(out, entry), { recursive: true });
}
await writeFile(path.join(out, 'index.html'), html.replaceAll('./src/', `${assetPath}/src/`).replaceAll('./vendor/', `${assetPath}/vendor/`));
await writeFile(path.join(out, '.nojekyll'), '');
console.log('Build ready: dist/.');
