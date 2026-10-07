import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export async function loadAmmo() {
  const url = new URL('../vendor/ammo.wasm.js', import.meta.url);
  const source = await readFile(url, 'utf8');
  const filename = fileURLToPath(url);
  const context = {
    module: { exports: {} }, require: createRequire(import.meta.url),
    process, console, Buffer, WebAssembly, performance, TextDecoder, TextEncoder,
    setTimeout, clearTimeout, __dirname: path.dirname(filename), __filename: filename,
  };
  vm.runInNewContext(source, context, { filename });
  return context.Ammo({ wasmBinary: await readFile(new URL('../vendor/ammo.wasm.wasm', import.meta.url)) });
}
