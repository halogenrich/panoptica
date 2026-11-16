// The runtime file (0.52): the Node that PANOPTICA runs on, as a release file of its own, so an update can bring a newer Node
// to an install made by PANOPTICA Setup, and Setup takes its Node from the same file (both carry the Node the release was
// checked with). panoptica-node-<version>-win-x64.zip holds node/node.exe and node/LICENSE, exactly as nodejs.org ships them
// (checked against nodejs.org's SHA-256 list), with its SHA-256 and, when SIGNING_KEY is set, PANOPTICA's signature.
// PANOPTICA.exe (the runtime under PANOPTICA's name, 0.51) is not in it: it is made on the lab's computer, from this node.exe,
// by Setup's helper or by the app before an update (apps/server/src/runtime.ts).
//   [SIGNING_KEY="$(cat key.pem)"] node tools/runtime-file.mjs <out folder> [--node <version, e.g. 26.13.1 or 24.x>]
// The release workflow runs it after tools/release-packages.mjs; the Installer test makes others (another Node) with its key.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { unzipSync, zipSync } from 'fflate';

/** The Node line PANOPTICA runs on (0.50.1: 26, supported until April 2029). The one place to change at the yearly move. */
export const NODE = 26;
/** panoptica-node-26.13.1-win-x64.zip → 26.13.1 (the app reads a release's Node from the file's name). */
export const RUNTIME_FILE = /^panoptica-node-(\d+\.\d+\.\d+)-win-x64\.zip$/;

/** Node for Windows x64 from nodejs.org: the newest of a line (26, 24.x) or one version, checked against its SHA-256 list. */
export async function nodeForWindows(want = String(NODE)) {
  const exact = /^\d+\.\d+\.\d+$/.test(want.replace(/^v/, '')),
    line = want.replace(/^v/, '').split('.')[0],
    base = `https://nodejs.org/dist/${exact ? 'v' + want.replace(/^v/, '') : `latest-v${line}.x`}`;
  const sums = await (await fetch(`${base}/SHASUMS256.txt`)).text();
  const found = sums.split('\n').find((l) => /node-v[\d.]+-win-x64\.zip$/.test(l.trim()));
  if (!found) throw new Error(`no Node ${want} for Windows x64 in ${base}`);
  const [sum, name] = found.trim().split(/\s+/);
  const data = Buffer.from(await (await fetch(`${base}/${name}`)).arrayBuffer());
  if (createHash('sha256').update(data).digest('hex') !== sum) throw new Error(`${name} does not match its SHA-256`);
  const version = name.match(/node-v([\d.]+)-win-x64/)[1];
  const files = unzipSync(new Uint8Array(data), {
    filter: (f) => /\/(node\.exe|LICENSE)$/.test(f.name) && f.name.split('/').length === 2,
  });
  const pick = (n) => Object.entries(files).find(([k]) => k.endsWith('/' + n))?.[1];
  if (!pick('node.exe')) throw new Error(`${name} has no node.exe`);
  return { version, exe: Buffer.from(pick('node.exe')), licence: Buffer.from(pick('LICENSE') ?? '') };
}

/** Writes the runtime file, its SHA-256 and (with SIGNING_KEY) its signature into `out`; returns its path. */
export function writeRuntimeFile(out, { version, exe, licence }) {
  mkdirSync(out, { recursive: true });
  const name = `panoptica-node-${version}-win-x64.zip`,
    file = join(out, name);
  // node.exe is about 80 MB and zips to about 30 MB, what an install downloads when the Node changes
  const zip = Buffer.from(zipSync({ 'node/node.exe': exe, 'node/LICENSE': licence }, { level: 6 }));
  writeFileSync(file, zip);
  writeFileSync(file + '.sha256', `${createHash('sha256').update(zip).digest('hex')}  ${name}\n`);
  if (process.env.SIGNING_KEY)
    execFileSync(process.execPath, [fileURLToPath(new URL('./sign-package.mjs', import.meta.url)), file], {
      stdio: 'inherit',
    });
  return file;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2),
    out = resolve(args.find((a, i) => !a.startsWith('--') && args[i - 1] !== '--node') ?? 'release'),
    want = args.includes('--node') ? args[args.indexOf('--node') + 1] : String(NODE);
  const node = await nodeForWindows(want);
  const file = writeRuntimeFile(out, node);
  console.log(`runtime file: ${file} (Node ${node.version}, ${(node.exe.length / 1048576).toFixed(1)} MB node.exe)`);
}
