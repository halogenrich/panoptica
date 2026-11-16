// PANOPTICA.exe (0.51): the Node runtime under PANOPTICA's own name, so Task Manager lists the server as PANOPTICA (with its
// icon) instead of Node.js. The same program, copied from node.exe with its name, description and icon changed; node.exe stays
// beside it for the update and repair scripts. Made on the lab's computer, so the runtime is shipped once: by Setup's helper at
// install (installer/helper.mjs bundles this file), and since 0.52 by the app before an update that brings another Node
// (runtime.ts), from the release's runtime file. Moved here from installer/runtime.mjs in 0.52, so both use the same code.
// Node's own signature does not survive the change (Windows reads the copy as unsigned, as it reads PANOPTICA's other files).
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import * as ResEdit from 'resedit';

/** Copies `node` to `out` as PANOPTICA: file description, product name, original file name and (when there is one) the icon. */
export function brandRuntime(node: string, out: string, ico: string | undefined, version: string) {
  const exe = ResEdit.NtExecutable.from(readFileSync(node), { ignoreCert: true }),
    res = ResEdit.NtExecutableResource.from(exe);
  const vi = ResEdit.Resource.VersionInfo.fromEntries(res.entries)[0];
  if (!vi) throw new Error(`${node} has no version information: is it Node for Windows?`);
  const node_ = vi.getStringValues(vi.getAllLanguagesForStringValues()[0])?.ProductVersion ?? '';
  for (const lang of vi.getAllLanguagesForStringValues())
    vi.setStringValues(lang, {
      FileDescription: 'PANOPTICA',
      ProductName: 'PANOPTICA',
      CompanyName: 'PANOPTICA',
      InternalName: 'PANOPTICA',
      OriginalFilename: 'PANOPTICA.exe',
      ProductVersion: version,
      // what it is underneath, for whoever looks at the file's details
      Comments: `Node.js ${node_.replace(/^v/, '')} runtime`,
    });
  vi.outputToResourceEntries(res.entries);
  // 0.52: the app may not find Setup's icon (an install moved by hand); the copy then keeps Node's
  if (ico && existsSync(ico)) {
    const group = ResEdit.Resource.IconGroupEntry.fromEntries(res.entries)[0];
    const icons = ResEdit.Data.IconFile.from(readFileSync(ico)).icons.map((i) => i.data);
    ResEdit.Resource.IconGroupEntry.replaceIconsForResource(res.entries, group?.id ?? 1, group?.lang ?? 1033, icons);
  }
  res.outputResource(exe);
  // written aside, then moved: a half-written PANOPTICA.exe is never left where the task starts it
  writeFileSync(out + '.new', Buffer.from(exe.generate()));
  renameSync(out + '.new', out);
}
