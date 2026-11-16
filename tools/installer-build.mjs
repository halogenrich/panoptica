// Prepares PANOPTICA Setup (0.47): installer/build/ with node/node.exe (Node 26 since 0.50.1, for Windows x64; since 0.52 from the
// release's runtime file, panoptica-node-<version>-win-x64.zip, made by tools/runtime-file.mjs), helper.cjs (installer/helper.mjs bundled with fflate) and, since 0.49, packages/: the release's signed
// packages (panoptica-<modules>.zip and .sig, one per combination of modules) with index.json (their version, sizes and
// SHA-256). Setup carries them, so it needs no internet; the lab's licence file decides which one is installed.
//   node tools/installer-build.mjs --packages <folder with the release's packages and runtime file> [--runtime <file>] [--helper-only]
// Then, on Windows with Inno Setup:
//   ISCC.exe /DAppVersion=<version> installer\panoptica.iss   → out\installer\
// (Setup for macOS, 0.48 to 0.50, is gone since 0.51: the lab's server is a Windows mini PC.)
// 0.51: also tray/PANOPTICA-tray.exe (installer/tray/Tray.cs, compiled with Windows' own .NET Framework compiler, or Mono's mcs
// elsewhere) and panoptica.ico, the icon the helper gives PANOPTICA.exe.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { unzipSync } from 'fflate';
import { RUNTIME_FILE } from './runtime-file.mjs';

const root = fileURLToPath(new URL('..', import.meta.url)),
  out = join(root, 'installer/build'),
  args = process.argv.slice(2);
rmSync(out, { recursive: true, force: true });
mkdirSync(join(out, 'node'), { recursive: true });
await build({
  entryPoints: [join(root, 'installer/helper.mjs')],
  bundle: true,
  platform: 'node',
  target: 'node26',
  format: 'cjs',
  outfile: join(out, 'helper.cjs'),
  logLevel: 'warning',
});
console.log('helper.cjs bundled');
// the tray icon (0.51): C# 5, so the compiler every Windows has builds it; the icons go inside it
{
  const src = join(root, 'installer/tray'),
    exe = join(out, 'tray', 'PANOPTICA-tray.exe');
  mkdirSync(join(out, 'tray'), { recursive: true });
  copyFileSync(join(src, 'panoptica.ico'), join(out, 'panoptica.ico'));
  const csc = [
    join(process.env.WINDIR ?? 'C:\\Windows', 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe'),
    '/usr/bin/mcs',
  ].find((f) => existsSync(f));
  if (!csc) {
    if (!args.includes('--helper-only'))
      throw new Error('no C# compiler for the tray icon (Windows has one; elsewhere: mono-mcs)');
  } else {
    const mono = csc.endsWith('mcs');
    execFileSync(
      csc,
      [
        '-nologo',
        ...(mono ? ['-langversion:5'] : []),
        '-target:winexe',
        '-optimize+',
        `-win32icon:${join(src, 'panoptica.ico')}`,
        `-resource:${join(src, 'panoptica.ico')},panoptica.ico`,
        `-resource:${join(src, 'panoptica-stopped.ico')},panoptica-stopped.ico`,
        '-r:System.Windows.Forms.dll',
        '-r:System.Drawing.dll',
        `-out:${exe}`,
        join(src, 'Tray.cs'),
      ].map((a) => (mono ? a : a.replace(/^-/, '/'))),
      { stdio: 'inherit' },
    );
    console.log('tray/PANOPTICA-tray.exe compiled');
  }
}
const arg = (n, d) => (args.includes(n) ? args[args.indexOf(n) + 1] : d);
// the packages Setup carries (0.49): every panoptica-<modules>.zip with its signature (not panoptica.zip, the same bytes as the
// package with every module, kept for labs before 0.46)
if (!args.includes('--helper-only')) {
  const from = arg('--packages');
  if (!from) throw new Error('give the folder with the release’s packages: --packages <folder>');
  const to = join(out, 'packages'),
    files = {};
  let version = '';
  mkdirSync(to, { recursive: true });
  // the runtime file (0.52) sits with them, and is not a package
  for (const f of readdirSync(from).filter((f) => /^panoptica-.+\.zip$/.test(f) && !RUNTIME_FILE.test(f))) {
    if (!existsSync(join(from, f + '.sig'))) throw new Error(`${f} has no signature (${f}.sig)`);
    const data = readFileSync(join(from, f));
    // the version inside the package
    const pkg = unzipSync(new Uint8Array(data), { filter: (x) => x.name === 'panoptica/package.json' })[
      'panoptica/package.json'
    ];
    if (!pkg) throw new Error(`${f} is not a PANOPTICA package`);
    const v = JSON.parse(Buffer.from(pkg).toString('utf8')).version;
    if (version && v !== version) throw new Error(`the packages are of different versions (${version}, ${v})`);
    version = v;
    copyFileSync(join(from, f), join(to, f));
    copyFileSync(join(from, f + '.sig'), join(to, f + '.sig'));
    files[f] = { size: data.length, sha256: createHash('sha256').update(data).digest('hex') };
  }
  if (!version) throw new Error(`no panoptica-<modules>.zip in ${from}`);
  writeFileSync(join(to, 'index.json'), JSON.stringify({ version, files }, null, 2));
  console.log(`packages ${version}: ${Object.keys(files).join(', ')}`);
}
// Setup's Node (0.52): from the release's runtime file (tools/runtime-file.mjs), the same file updates bring, so Setup and the
// in-app update carry the same Node. It sits with the packages (the release's files), or is given with --runtime.
if (!args.includes('--helper-only')) {
  const from = arg('--packages'),
    file =
      arg('--runtime') ??
      readdirSync(from)
        .filter((f) => RUNTIME_FILE.test(f))
        .map((f) => join(from, f))[0];
  if (!file) throw new Error('no runtime file (panoptica-node-<version>-win-x64.zip): give it with --runtime');
  const data = readFileSync(file),
    name = file.split(/[\\/]/).pop();
  // the checksum next to it, when there is one (the release's files have it)
  if (existsSync(file + '.sha256')) {
    const sum = readFileSync(file + '.sha256', 'utf8')
      .trim()
      .split(/\s+/)[0];
    if (createHash('sha256').update(data).digest('hex') !== sum) throw new Error(`${name} does not match its SHA-256`);
  }
  const files = unzipSync(new Uint8Array(data));
  if (!files['node/node.exe']) throw new Error(`${name} is not a PANOPTICA runtime file`);
  for (const n of ['node.exe', 'LICENSE'])
    if (files['node/' + n]) writeFileSync(join(out, 'node', n), files['node/' + n]);
  console.log(`Node ${name.match(RUNTIME_FILE)[1]} from ${name}: node.exe and its LICENSE`);
}
