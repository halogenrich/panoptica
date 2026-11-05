// Decides whether the start scripts must reinstall dependencies or rebuild the web app, from file *contents*
// (not dates: unzipping and copying keep old timestamps, so dates cannot tell an update apart).
//   node tools/stamp.cjs check install|build   exit 0 = up to date, 1 = needed
//   node tools/stamp.cjs save  install|build   record the current state after a successful install/build
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const root = path.join(__dirname, '..');
const walk = (d) => (fs.existsSync(d) ? fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)])) : []);
const sets = {
  install: { stamp: 'node_modules/.stamp', files: () => ['package.json', ...['apps', 'packages'].flatMap((g) => (fs.existsSync(path.join(root, g)) ? fs.readdirSync(path.join(root, g)).map((n) => `${g}/${n}/package.json`) : []))] },
  build: { stamp: 'apps/web/dist/.stamp', files: () => ['package.json', 'apps/web/index.html', 'apps/web/vite.config.ts', ...['apps/web/src', 'packages/core/src', 'packages/schema/src', 'docs'].flatMap((d) => walk(path.join(root, d)).map((f) => path.relative(root, f)))] },
};
const [cmd, what] = process.argv.slice(2), s = sets[what];
if (!s || !['check', 'save'].includes(cmd)) { console.error('usage: node tools/stamp.cjs check|save install|build'); process.exit(2); }
const h = crypto.createHash('sha256');
for (const f of s.files().map((f) => f.split(path.sep).join('/')).sort()) { const p = path.join(root, f); if (fs.existsSync(p)) h.update(f + '\0').update(fs.readFileSync(p)); }
const digest = h.digest('hex'), file = path.join(root, s.stamp);
if (cmd === 'save') { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, digest); process.exit(0); }
const ok = fs.existsSync(file) && fs.readFileSync(file, 'utf8').trim() === digest && (what !== 'build' || fs.existsSync(path.join(root, 'apps/web/dist/index.html')));
process.exit(ok ? 0 : 1);
