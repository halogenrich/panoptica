// Prepares PANOPTICA Setup (0.47): installer/build/ with node/node.exe (Node 22 for Windows x64, checked against nodejs.org's
// SHA-256 list) and helper.cjs (installer/helper.mjs bundled with fflate). Then, on Windows with Inno Setup:
//   ISCC.exe /DAppVersion=<version> /DService=<activation service> installer\panoptica.iss   → out\installer\
//   node tools/installer-build.mjs [--node <version>] [--helper-only]
import { createHash } from 'node:crypto';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { unzipSync } from 'fflate';

const root = fileURLToPath(new URL('..', import.meta.url)),
  out = join(root, 'installer/build'),
  args = process.argv.slice(2);
rmSync(out, { recursive: true, force: true });
mkdirSync(join(out, 'node'), { recursive: true });
await build({
  entryPoints: [join(root, 'installer/helper.mjs')],
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'cjs',
  outfile: join(out, 'helper.cjs'),
  logLevel: 'warning',
});
console.log('helper.cjs bundled');
if (!args.includes('--helper-only')) {
  // the newest Node 22, or the one asked for
  const want = args.includes('--node') ? args[args.indexOf('--node') + 1] : 'latest-v22.x';
  const base = `https://nodejs.org/dist/${want.startsWith('latest') ? want : 'v' + want.replace(/^v/, '')}`;
  const sums = await (await fetch(`${base}/SHASUMS256.txt`)).text();
  const line = sums.split('\n').find((l) => /node-v22\.[\d.]+-win-x64\.zip$/.test(l));
  if (!line) throw new Error('no Node 22 for Windows x64 in ' + base);
  const [sum, name] = line.trim().split(/\s+/);
  const zip = Buffer.from(await (await fetch(`${base}/${name}`)).arrayBuffer());
  if (createHash('sha256').update(zip).digest('hex') !== sum) throw new Error(`${name} does not match its SHA-256`);
  const files = unzipSync(new Uint8Array(zip), {
    filter: (f) => /\/(node\.exe|LICENSE)$/.test(f.name) && f.name.split('/').length === 2,
  });
  for (const [n, data] of Object.entries(files)) writeFileSync(join(out, 'node', n.split('/')[1]), data);
  console.log(`${name.replace('.zip', '')}: node.exe and its LICENSE`);
}
