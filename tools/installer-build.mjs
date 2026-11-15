// Prepares PANOPTICA Setup (0.47): installer/build/ with node/node.exe (Node 22 for Windows x64, checked against nodejs.org's
// SHA-256 list), helper.cjs (installer/helper.mjs bundled with fflate) and, since 0.49, packages/: the release's signed
// packages (panoptica-<modules>.zip and .sig, one per combination of modules) with index.json (their version, sizes and
// SHA-256). Setup carries them, so it needs no internet; the lab's licence file decides which one is installed.
//   node tools/installer-build.mjs --packages <folder with the release's packages> [--node <version>] [--helper-only]
// Then, on Windows with Inno Setup:
//   ISCC.exe /DAppVersion=<version> installer\panoptica.iss   → out\installer\
// For macOS (0.48), --mac: Node 22 for Apple silicon and for Intel (the processor decides which one is installed), and on a Mac
// the Setup app (installer/mac: the wizard compiled for both, setup.sh, the uninstaller, the packages) in a disk image:
//   node tools/installer-build.mjs --mac --packages <folder> [--version <version>]
//      → out/installer/PANOPTICA Setup.app and out/installer/PANOPTICA-Setup-<version>.dmg
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
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
  for (const f of readdirSync(from).filter((f) => /^panoptica-.+\.zip$/.test(f))) {
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
// the newest Node 22, or the one asked for
const want = arg('--node', 'latest-v22.x'),
  base = `https://nodejs.org/dist/${want.startsWith('latest') ? want : 'v' + want.replace(/^v/, '')}`;
/** A file from nodejs.org, checked against its SHA-256 list. */
async function nodeFile(pattern, what) {
  const sums = await (await fetch(`${base}/SHASUMS256.txt`)).text();
  const line = sums.split('\n').find((l) => pattern.test(l));
  if (!line) throw new Error(`no Node 22 for ${what} in ${base}`);
  const [sum, name] = line.trim().split(/\s+/);
  const data = Buffer.from(await (await fetch(`${base}/${name}`)).arrayBuffer());
  if (createHash('sha256').update(data).digest('hex') !== sum) throw new Error(`${name} does not match its SHA-256`);
  return { name, data };
}

if (args.includes('--mac')) {
  const mac = join(out, 'mac');
  for (const arch of ['arm64', 'x64']) {
    const { name, data } = await nodeFile(new RegExp(`node-v22\\.[\\d.]+-darwin-${arch}\\.tar\\.gz$`), `macOS ${arch}`),
      top = name.replace('.tar.gz', ''),
      to = join(mac, 'node-' + arch);
    mkdirSync(to, { recursive: true });
    writeFileSync(join(mac, name), data);
    execFileSync('tar', [
      '-xzf',
      join(mac, name),
      '-C',
      to,
      '--strip-components=1',
      `${top}/bin/node`,
      `${top}/LICENSE`,
    ]);
    rmSync(join(mac, name));
    console.log(`${top}: bin/node and its LICENSE`);
  }
  if (process.platform === 'darwin') {
    const version = arg('--version', JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version),
      src = join(root, 'installer/mac'),
      dist = join(root, 'out/installer'),
      app = join(dist, 'PANOPTICA Setup.app'),
      exe = join(app, 'Contents/MacOS/PANOPTICA Setup'),
      res = join(app, 'Contents/Resources');
    rmSync(app, { recursive: true, force: true });
    mkdirSync(join(app, 'Contents/MacOS'), { recursive: true });
    mkdirSync(res, { recursive: true });
    // the wizard for Apple silicon and for Intel, in one program
    for (const [t, a] of [
      ['arm64-apple-macos12', 'arm64'],
      ['x86_64-apple-macos12', 'x64'],
    ])
      execFileSync(
        'xcrun',
        [
          'swiftc',
          '-O',
          '-parse-as-library',
          '-swift-version',
          '5',
          '-target',
          t,
          join(src, 'Setup.swift'),
          '-o',
          join(mac, 'setup-' + a),
        ],
        { stdio: 'inherit' },
      );
    execFileSync('lipo', ['-create', '-output', exe, join(mac, 'setup-arm64'), join(mac, 'setup-x64')]);
    writeFileSync(
      join(app, 'Contents/Info.plist'),
      readFileSync(join(src, 'Info.plist'), 'utf8').replaceAll('@VERSION@', version.replace(/[^\w.-]/g, '')),
    );
    for (const f of ['setup.sh', 'Uninstall PANOPTICA.command']) cpSync(join(src, f), join(res, f));
    cpSync(join(out, 'helper.cjs'), join(res, 'helper.cjs'));
    cpSync(join(root, 'release.pub'), join(res, 'release.pub'));
    execFileSync('ditto', [join(out, 'packages'), join(res, 'packages')]);
    for (const arch of ['arm64', 'x64']) execFileSync('ditto', [join(mac, 'node-' + arch), join(res, 'node-' + arch)]);
    // signed for this computer alone (no Apple Developer ID yet): macOS asks once whether to open it
    execFileSync('codesign', ['--force', '--sign', '-', '--timestamp=none', app], { stdio: 'inherit' });
    const stage = join(mac, 'dmg');
    rmSync(stage, { recursive: true, force: true });
    mkdirSync(stage);
    execFileSync('ditto', [app, join(stage, 'PANOPTICA Setup.app')]);
    const dmg = join(dist, `PANOPTICA-Setup-${version}.dmg`);
    rmSync(dmg, { force: true });
    execFileSync(
      'hdiutil',
      ['create', '-volname', 'PANOPTICA Setup', '-srcfolder', stage, '-fs', 'HFS+', '-format', 'UDZO', '-ov', dmg],
      { stdio: 'inherit' },
    );
    console.log(`PANOPTICA Setup ${version} for macOS: ${dmg}`);
  }
} else if (!args.includes('--helper-only')) {
  const { name, data } = await nodeFile(/node-v22\.[\d.]+-win-x64\.zip$/, 'Windows x64');
  const files = unzipSync(new Uint8Array(data), {
    filter: (f) => /\/(node\.exe|LICENSE)$/.test(f.name) && f.name.split('/').length === 2,
  });
  for (const [n, d] of Object.entries(files)) writeFileSync(join(out, 'node', n.split('/')[1]), d);
  console.log(`${name.replace('.zip', '')}: node.exe and its LICENSE`);
}
