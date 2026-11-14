// Makes a release's packages (0.46): one per combination of modules a lab can have (the core is never installed alone), each
// zipped, signed with PANOPTICA's key (SIGNING_KEY) and with its SHA-256, plus panoptica.zip (every module) for labs on
// versions before 0.46, which look for that name. A lab's app downloads the package for the modules its licence lists.
//   SIGNING_KEY="$(cat key.pem)" node tools/release-packages.mjs <out folder>
// Needs the web app built with every module (npm run build) and the zip command.
import { execFileSync } from 'node:child_process';
import { copyFileSync, createReadStream, existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url)),
  out = resolve(process.argv[2] ?? join(root, 'release'));
const present = readdirSync(join(root, 'modules'))
  .filter((m) => existsSync(join(root, 'modules', m, 'server/src/index.ts')))
  .sort();
// every non-empty set of modules
const combos = [];
for (let mask = 1; mask < 1 << present.length; mask++) combos.push(present.filter((_, i) => mask & (1 << i)));
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
const node = (...a) => execFileSync(process.execPath, a, { stdio: 'inherit', cwd: root });
const sha = (f) =>
  new Promise((ok) => {
    const h = createHash('sha256');
    createReadStream(f)
      .on('data', (d) => h.update(d))
      .on('end', () => ok(h.digest('hex')));
  });
const files = [];
for (const mods of combos) {
  const name = `panoptica-${mods.join('+')}.zip`,
    tmp = join(out, '.build-' + mods.join('+'));
  const all = mods.length === present.length;
  // every module: the web app already built; fewer: built for those
  node('tools/package.mjs', tmp, '--modules', mods.join(','), ...(all ? ['--no-web'] : []), '--boot');
  execFileSync('zip', ['-qr', join(out, name), 'panoptica'], { cwd: tmp });
  rmSync(tmp, { recursive: true, force: true });
  files.push(name);
  if (all) {
    copyFileSync(join(out, name), join(out, 'panoptica.zip'));
    files.push('panoptica.zip');
  }
}
for (const f of files) {
  node('tools/sign-package.mjs', join(out, f));
  writeFileSync(join(out, f + '.sha256'), `${await sha(join(out, f))}  ${f}\n`);
}
console.log(`release packages in ${out}: ${files.join(', ')}`);
