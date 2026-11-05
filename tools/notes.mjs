// Prints the CHANGELOG.md section of a version (release notes): node tools/notes.mjs 0.26.0
import { readFileSync } from 'node:fs';
const v = process.argv[2], lines = readFileSync(new URL('../CHANGELOG.md', import.meta.url), 'utf8').split(/\r?\n/);
const i = lines.findIndex((l) => l.startsWith(`## ${v}`));
if (i < 0) { console.log(`Perovskite Lab ${v}.`); process.exit(0); }
const j = lines.findIndex((l, k) => k > i && l.startsWith('## '));
console.log(lines.slice(i + 1, j < 0 ? undefined : j).join('\n').trim());
