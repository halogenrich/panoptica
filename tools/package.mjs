// Makes the release package: the app built, with no source code.
//   node tools/package.mjs [out folder] [--version X.Y.Z] [--modules a,b] [--no-web] [--boot]
// Writes <out>/panoptica/: the server as one JavaScript file with its libraries (apps/server/dist/server.mjs), the built web app
// (apps/web/dist), the start/update/restore scripts and the documents. The lab's computer needs only Node.js: nothing is
// downloaded or built there. --boot starts the packaged server once and asks its version, as a test of the bundle.
// --modules (0.43): the modules in the package, from modules/ (all of them unless given; 'none' for the core alone). Only those are
// bundled into the server and the web app. --no-web takes the web app already built in apps/web/dist (all modules).
import { build } from 'esbuild';
import { spawn, execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const args = process.argv.slice(2),
  flag = (n) => args.includes(n),
  opt = (n) => (args.includes(n) ? args[args.indexOf(n) + 1] : undefined);
const outDir = resolve(
  args.find((a, i) => !a.startsWith('--') && !['--version', '--modules'].includes(args[i - 1])) ?? join(root, 'out'),
);
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')),
  version = opt('--version') ?? pkg.version;
const dest = join(outDir, 'panoptica');
const present = readdirSync(join(root, 'modules')).filter((id) =>
    existsSync(join(root, 'modules', id, 'server/src/index.ts')),
  ),
  mods =
    opt('--modules') === undefined
      ? present
      : opt('--modules')
          .split(',')
          .map((x) => x.trim())
          .filter((x) => x && x !== 'none' && !x.startsWith('--'));
for (const m of mods) if (!present.includes(m)) throw new Error(`module ${m} is not in modules/`);
const all = mods.length === present.length;
if (flag('--no-web') && !all) throw new Error('--no-web takes the web app with every module: build it for --modules');

// 1) the web app, with these modules
const web = flag('--no-web') || all ? join(root, 'apps/web/dist') : join(outDir, 'web');
if (!flag('--no-web'))
  execFileSync(process.platform === 'win32' ? 'npx.cmd' : 'npx', ['vite', 'build', '--outDir', web, '--emptyOutDir'], {
    cwd: join(root, 'apps/web'),
    stdio: 'inherit',
    shell: process.platform === 'win32',
    env: { ...process.env, PANOPTICA_MODULES: mods.join(',') },
  });
if (!existsSync(join(web, 'index.html'))) throw new Error(`${web} is missing: build the web app first`);
const webMods = JSON.parse(readFileSync(join(web, 'modules.json'), 'utf8'));
if (webMods.join() !== mods.join())
  throw new Error(`the web app was built with ${webMods.join() || 'no module'}, not ${mods.join() || 'no module'}`);

// 2) the server and its libraries in one file (Node's own modules stay outside)
rmSync(dest, { recursive: true, force: true });
mkdirSync(join(dest, 'apps/server/dist'), { recursive: true });
// the entry: the modules first (each adds itself and runs its database changes), then the core
const gen = mkdtempSync(join(tmpdir(), 'panoptica-entry-')),
  entry = join(gen, 'entry.ts');
writeFileSync(
  entry,
  [...mods.map((m) => join(root, 'modules', m, 'server/src/index.ts')), join(root, 'apps/server/src/index.ts')]
    .map((f) => `import ${JSON.stringify(f.replace(/\\/g, '/'))};`)
    .join('\n') + '\n',
);
await build({
  entryPoints: [entry],
  define: { __PANOPTICA_MODULES__: JSON.stringify(mods) },
  outfile: join(dest, 'apps/server/dist/server.mjs'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  minify: true,
  legalComments: 'none',
  // libraries written for require(): give the bundle its own require, __filename and __dirname
  banner: {
    js: "import{createRequire as __cr}from'node:module';import{fileURLToPath as __fu}from'node:url';import{dirname as __dn}from'node:path';const require=__cr(import.meta.url),__filename=__fu(import.meta.url),__dirname=__dn(__filename);",
  },
  logLevel: 'warning',
});
rmSync(gen, { recursive: true, force: true });

// 3) everything else the lab's computer uses
cpSync(web, join(dest, 'apps/web/dist'), { recursive: true });
for (const f of ['db-tools.cjs', 'reset-password.cjs'])
  cpSync(join(root, 'apps/server', f), join(dest, 'apps/server', f));
mkdirSync(join(dest, 'tools'));
cpSync(join(root, 'tools/verify-package.cjs'), join(dest, 'tools/verify-package.cjs'));
for (const f of readdirSync(root))
  if (/\.(sh|bat|command)$/.test(f) || ['README.md', 'CHANGELOG.md', 'SECURITY.md', 'release.pub'].includes(f))
    cpSync(join(root, f), join(dest, f));
cpSync(join(root, 'docs'), join(dest, 'docs'), { recursive: true });
rmSync(join(dest, 'docs/architecture.md'), { force: true }); // for developers
writeFileSync(
  join(dest, 'package.json'),
  JSON.stringify(
    { name: 'panoptica', version, private: true, description: 'PANOPTICA, built package', modules: mods },
    null,
    2,
  ) + '\n',
);
// marks a built install: the start scripts run the packaged server and clear what an install from source left behind
writeFileSync(
  join(dest, 'built.json'),
  JSON.stringify({ version, modules: mods, built: new Date().toISOString() }) + '\n',
);
console.log(`packaged PANOPTICA ${version} in ${dest}, modules: ${mods.join(', ') || 'none (the core alone)'}`);

// 4) optional test: the packaged server starts and answers
if (flag('--boot')) {
  const tmp = mkdtempSync(join(tmpdir(), 'panoptica-boot-')),
    port = 4790 + Math.floor(Math.random() * 100);
  const srv = spawn(process.execPath, ['--no-warnings', 'dist/server.mjs'], {
    cwd: join(dest, 'apps/server'),
    env: {
      ...process.env,
      PORT: String(port),
      HOST: '127.0.0.1',
      DB_PATH: join(tmp, 'data.db'),
      BACKUP_DIR: join(tmp, 'backups'),
      CONFIG_DIR: join(tmp, 'config'),
      UPDATES_DIR: join(tmp, 'updates'),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  srv.stdout.on('data', (d) => (log += d));
  srv.stderr.on('data', (d) => (log += d));
  let got = null;
  for (let i = 0; i < 60 && !got; i++) {
    await new Promise((r) => setTimeout(r, 500));
    try {
      const v = await (await fetch(`http://127.0.0.1:${port}/api/version`)).json(),
        page = await (await fetch(`http://127.0.0.1:${port}/`)).text();
      if (page.includes('<div id="root"') && v.modules.join() === mods.join()) got = v.version;
    } catch {
      /* not up yet */
    }
  }
  srv.kill();
  rmSync(tmp, { recursive: true, force: true, maxRetries: 5 });
  if (got !== version) {
    console.error(log);
    throw new Error(`the packaged server did not start (version ${got})`);
  }
  console.log(`packaged server started and served the web app (${got})`);
}
