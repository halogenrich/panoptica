# The builder and product keys (PANOPTICA staff only)

**Product keys (0.47)** are how labs install PANOPTICA: they download **PANOPTICA Setup** (the Windows wizard attached to
each release), type their key, and the wizard installs what the key covers. Keys are made and managed with
`tools/builder/keys.mjs` against PANOPTICA's activation service (`services/activation/README.md`):

```
node tools/builder/keys.mjs new --lab "Lab name" --modules devices --updates-until 2027-12-31 --installs 1 --key key.pem
node tools/builder/keys.mjs renew --lab-id <id> [--modules …] [--updates-until …] [--installs …] --key key.pem
node tools/builder/keys.mjs list | move --lab-id <id> --computer <name> | publish <version>
```

(`--service` and `--token`, or `ACTIVATION_URL` and `ACTIVATION_TOKEN`.) The key is shown once and written on the lab's key
card in `out/keys/`; the service keeps only its SHA-256. It also opens the lab's first setup.

## The offline builder

For a lab whose server cannot reach the internet during the install, `builder.mjs` makes the files to carry on a USB stick.

Makes what one lab needs to install PANOPTICA: its signed licence, a one-time setup code and the install sheet for the crew,
and (optionally) the package for its modules. It is not part of the package labs receive.

```
node tools/builder/builder.mjs --lab "Lab name" --modules devices --updates-until 2027-12-31 --key /path/to/key.pem \
     [--lab-id <id>] [--package /path/to/panoptica-devices.zip | --build] [--no-setup] [--out folder]
```

- `--key`: PANOPTICA's private signing key (Ed25519, PEM), or the `SIGNING_KEY` environment variable. It is only read; the
  builder writes it nowhere and checks every signature against `release.pub` before writing anything.
- `--modules`: the modules the lab bought (the core is always there and never installed alone).
- `--updates-until`: the last day a release may be published to be installed. After it the app keeps working and exporting;
  only updates stop.
- `--lab-id`: the lab's id from its first licence (the sheet shows it). A licence for the same lab must carry the same id, or
  the lab's PANOPTICA refuses it. Without it the builder makes a new lab.
- `--package`: a release's package for these modules (`panoptica-devices.zip`, its `.sig` next to it), copied to the lab's
  folder after its signature is checked. `--build` packages this source instead and signs it (needs the `zip` command).
- `--no-setup`: no setup code (renewals and added modules: the lab is set up already).

Output: `out/labs/<lab>-<licence id>/` with `licence.json`, `install-sheet.md` (the setup code is only there) and the
package. Print the sheet for the crew; keep the folder with the lab's records.

**Adding a module later**: run the builder with the lab's `--lab-id`, the larger module set and `--no-setup`. The lab installs
the new licence in Admin settings › Licence; its next update downloads the package with the new module (or install it now
from the update script with the package from the release).
