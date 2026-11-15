// PANOPTICA.exe (0.51): the Node runtime under PANOPTICA's own name, so Task Manager lists the server as PANOPTICA (with its
// icon) instead of Node.js. The same program, copied from node.exe with its name, description and icon changed; node.exe stays
// beside it for the update and repair scripts. Made by the installer's helper on the lab's computer, so Setup carries Node once.
// Node's own signature does not survive the change (Windows reads the copy as unsigned, as it reads PANOPTICA's other files).
import { readFileSync, renameSync, writeFileSync } from 'node:fs';
import * as ResEdit from 'resedit';

/** Copies `node` to `out` as PANOPTICA: file description, product name, original file name and the icon. */
export function brandRuntime(node, out, ico, version) {
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
  const group = ResEdit.Resource.IconGroupEntry.fromEntries(res.entries)[0];
  const icons = ResEdit.Data.IconFile.from(readFileSync(ico)).icons.map((i) => i.data);
  ResEdit.Resource.IconGroupEntry.replaceIconsForResource(res.entries, group?.id ?? 1, group?.lang ?? 1033, icons);
  res.outputResource(exe);
  // written aside, then moved: a half-written PANOPTICA.exe is never left where the task starts it
  writeFileSync(out + '.new', Buffer.from(exe.generate()));
  renameSync(out + '.new', out);
}
