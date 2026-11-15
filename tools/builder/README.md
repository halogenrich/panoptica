# The licence builder (PANOPTICA staff only)

Labs install PANOPTICA with **PANOPTICA Setup** (the Windows `.exe` and the macOS `.dmg` attached to each release). Setup asks
for the lab's licence file, which decides which package it installs. `builder.mjs` makes that file and the install sheet for
the crew. It is not part of the package labs receive.

```
node tools/builder/builder.mjs --lab "Full lab name" [--acronym ABC] --modules devices --tier 1|2|3 [--users N] \
     --key /path/to/key.pem [--lab-id <id>] [--no-setup] [--out folder]
```

- `--lab`, `--acronym`: the lab's full name and acronym, as PANOPTICA records who bought the licence. They show only in the
  lab's Admin settings › Licence; the names the lab shows are the ones it types in its first setup.
- `--modules`: the modules the lab bought (the core is always there and never installed alone).
- `--tier`: 1 covers up to 10 active people, 2 up to 50, 3 more, with `--users` the number agreed with the lab. Updates are
  free.
- `--key`: PANOPTICA's private signing key (Ed25519, PEM), or the `SIGNING_KEY` environment variable. It is only read; the
  builder writes it nowhere and checks the licence against `release.pub` before writing anything.
- `--lab-id`: the lab's id from its first licence (the sheet shows it). A licence for the same lab must carry the same id, or
  the lab's PANOPTICA refuses it. Without it the builder makes a new lab.
- `--no-setup`: no setup code (upgrades, added modules, a copy of a lost file: the lab is set up already).

Output: `out/labs/<acronym or lab>-<licence id>/` with `licence.json` and `install-sheet.md` (the setup code is only there).
Print the sheet for the crew; keep the folder with the lab's records.

**Upgrading a lab, adding a module, or replacing a lost file**: run the builder with the lab's `--lab-id`, the new tier or
module set, and `--no-setup`. The lab's admin installs the new licence in Admin settings › Licence, on the server itself. A lab
whose module set grew gets the package for its modules with its next update.

An install made by Setup needs its licence: if the file is missing or not valid, no one new can be let in until it is installed
again (everyone else keeps working). A manual install (unzipping a package) works without one.
