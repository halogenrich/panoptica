// The list of the licences issued (0.50): a folder on the computer of whoever runs the builder, outside the repository, since
// it holds lab names. One folder per licence, `<lab>-<licence id>/` with `licence.json` and `install-sheet.md`, as the command
// line writes them; the list is read from those files, so nothing else can drift from them. `panoptica-licences.json` marks
// the folder as the list.
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';

const MARK = 'panoptica-licences.json';
const ID = /^L-\d{6}-[0-9a-f]{4}$/;

/** Makes `path` the list's folder (created when it is not there). Throws with what is wrong, in words for the page. */
export function openFolder(path, root) {
  const p = String(path ?? '').trim();
  if (!p) throw new Error('Choose a folder.');
  if (!isAbsolute(p))
    throw new Error('Give the folder’s full path, such as ' + join(root, '..', 'PANOPTICA licences') + '.');
  const dir = resolve(p),
    rel = relative(resolve(root), dir);
  // the list holds lab names: never inside the repository, where it could be committed
  if (!rel || (!rel.startsWith('..') && !isAbsolute(rel)))
    throw new Error('That folder is inside the repository. Choose one outside it: the list holds lab names.');
  try {
    mkdirSync(dir, { recursive: true });
    if (!statSync(dir).isDirectory()) throw new Error('not a folder');
    if (!existsSync(join(dir, MARK)))
      writeFileSync(
        join(dir, MARK),
        JSON.stringify({ v: 1, about: 'The licences PANOPTICA issued, one folder each. Keep this folder private.' }) +
          '\n',
      );
  } catch {
    throw new Error('That folder cannot be written to. Choose another.');
  }
  return dir;
}

/** The folder is still there and is the list. */
export const isList = (dir) => !!dir && existsSync(join(dir, MARK));

const read = (dir, name) => {
  try {
    const body = JSON.parse(JSON.parse(readFileSync(join(dir, name, 'licence.json'), 'utf8')).body);
    if (!ID.test(body.id) || typeof body.labId !== 'string') return null;
    return {
      id: body.id,
      labId: body.labId,
      lab: String(body.lab ?? ''),
      acronym: String(body.acronym ?? ''),
      modules: Array.isArray(body.modules) ? body.modules.map(String) : [],
      tier: body.tier ?? null,
      users: body.users ?? null,
      issued: String(body.issued ?? ''),
      made: String(body.made ?? body.issued ?? ''),
      setup: !!body.setup,
      sheet: existsSync(join(dir, name, 'install-sheet.md')),
      dir: name,
    };
  } catch {
    return null; // not a licence folder: left alone
  }
};

/** Every licence in the folder, newest first. */
export const licences = (dir) =>
  readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => read(dir, e.name))
    .filter(Boolean)
    .sort((a, b) => (a.made < b.made ? 1 : -1));

/** The labs, by name, each with its licences newest first; a lab takes the names of its newest licence. */
export function labs(dir) {
  const by = new Map();
  for (const { dir: _d, ...l } of licences(dir)) {
    if (!by.has(l.labId)) by.set(l.labId, { labId: l.labId, lab: l.lab, acronym: l.acronym, licences: [] });
    by.get(l.labId).licences.push(l);
  }
  return [...by.values()].sort((a, b) => a.lab.localeCompare(b.lab));
}

/** Keeps what makeLicence made. */
export function keep(dir, made) {
  const d = join(dir, made.folder);
  mkdirSync(d, { recursive: true });
  writeFileSync(join(d, 'licence.json'), made.file);
  writeFileSync(join(d, 'install-sheet.md'), made.sheet);
}

/** A kept file of the licence `id` ('licence.json' or 'install-sheet.md'), or null. */
export function kept(dir, id, file) {
  if (!ID.test(id)) return null;
  const l = licences(dir).find((x) => x.id === id);
  if (!l) return null;
  try {
    return readFileSync(join(dir, l.dir, file), 'utf8');
  } catch {
    return null;
  }
}
