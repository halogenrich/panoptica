# PANOPTICA

The lab's system (called Perovskite Lab before 0.36). An internal web app to plan and record perovskite solar cell fabrication: substrate and mask designs, recipes, device stacks with a 3D view, batches, run data and electric (J–V) measurements (import, per-pixel curves, statistics). How to use it: [docs/user-guide.md](docs/user-guide.md) (also under **Help** in the app).

This file is for whoever runs the app on the lab PC.

## Requirements

- Windows 10/11, macOS, or Linux (Fedora and others), with **Node.js 22.13 or newer** (https://nodejs.org; any newer version, e.g. 24 or 26, works too). Nothing is compiled during install: the database is SQLite built into Node.
- A current Chrome, Edge, Safari or Firefox. Phones work in their normal browser.

## Scripts

| | Windows | macOS | Linux (Fedora) |
|---|---|---|---|
| Start | `start.bat` | `start.command` | `./start.sh` |
| Start, reachable from the network (phones too) | `start-network.bat` (or `start.bat lan`) | `start-network.command` (or `./start.command lan`) | `./start-network.sh` (or `./start.sh lan`) |
| Update | `update.bat` | `update.command` | `./update.sh` |
| Restore a backup | `restore.bat` | `restore.command` | `./restore.sh` |
| Show version | `version.bat` | `version.command` | `./version.sh` |
| Reset a password | `reset-password.bat USER NEWPASSWORD` | `cd apps/server && node reset-password.cjs USER NEWPASSWORD` | `./reset-password.sh USER NEWPASSWORD` |
| App menu / background service | | | `./install-shortcut.sh`, `./install-shortcut.sh --service` |

On macOS, if a `.command` file will not open: run `chmod +x *.command` once in Terminal in the app folder, and use right-click › Open the first time.

## Linux (Fedora)

1. Install Node.js once:
   - Fedora 41 or newer: `sudo dnf install nodejs npm`
   - Fedora 40: `sudo dnf install nodejs22 nodejs22-npm`

2. Unzip `panoptica.zip` somewhere in your home folder, e.g. `~/panoptica`.
3. In a terminal in that folder: `./start.sh`. The first run installs and builds (a few minutes); the browser opens http://localhost:3000. Ctrl+C stops it.
4. Optional: `./install-shortcut.sh` adds **PANOPTICA** and **PANOPTICA (network)** to the app menu (Super key, type "PANOPTICA"); they open a terminal window that runs the app.

**Run as a lab server** (no window to keep open, starts with the computer): `./install-shortcut.sh --service`, or `./install-shortcut.sh --service lan` to serve the network. It installs a systemd user service:

- status `systemctl --user status perovskite-lab`, log `journalctl --user -u perovskite-lab -f`
- stop `systemctl --user stop perovskite-lab` (needed before `./restore.sh`; `./update.sh` restarts it by itself)
- remove `./install-shortcut.sh --remove`

To start at boot without anyone logging in, the script runs `loginctl enable-linger`; if that is refused, run `sudo loginctl enable-linger $USER` once.

**Network access on Fedora**: firewalld blocks the port by default. Open it once:
`sudo firewall-cmd --permanent --add-port=3000/tcp && sudo firewall-cmd --reload`

## Start

Double-click the start script (Linux: run `./start.sh` in a terminal). The first run installs dependencies and builds the web app (a few minutes, needs internet); later runs start in seconds. The browser opens http://localhost:3000. Closing the window stops the app.

**First setup**: on a new install, open http://localhost:3000 **on the computer that runs the app** (the start script opens it). A few screens create the first admin (you) and set up the lab: its name, institution, the email domains that may ask for access, departments, the sign-in screen's picture and logo, and the working days and hours. Other computers see "Not set up yet" until then, unless the install came with a one-time setup code (an install made by PANOPTICA: the code is on its install sheet), which lets the setup be done from any computer on the network. All of it can be changed later in **Admin settings › Lab setup**.

**Licence** (0.46): PANOPTICA gives each lab a signed `licence.json`: its modules and the last day of updates. Put it next to the start scripts before the first start, or install it later in **Admin settings › Licence**. Without one, every module in the package runs.

**People**: everyone asks for access from the sign-in screen (**Request access**: name, institutional email, birth date, department, supervisor, photo). Admins are notified and accept or decline under **Admin settings › Access requests**. No email is sent: at the first sign-in the person types the username, leaves the password empty, confirms the email and birth date, and chooses a password (8 or more characters with an upper case letter, a number and a special character; accented letters are fine). Admins create accounts themselves only for visitors, with the last day of the visit. **Reset password** works the same way. (For automated installs, `ADMIN_PASSWORD` before the first start still creates an `admin` user and skips the setup.)

Start automatically at login (Windows): Win+R › `shell:startup` › put a shortcut to `start.bat` there. Linux: see *Run as a lab server* above.

## Other computers and phones

By default only the PC itself can open the app. `start-network.bat` / `start-network.command` / `./start-network.sh` (same as `start … lan`) make it reachable on the local network; in the app, **Invite a phone (QR code)** in the profile menu shows the address as a QR code to scan; the window prints the addresses to open (for example `http://192.168.0.23:3000`). Windows asks once to allow Node.js through the firewall: allow it on private networks. On Fedora, open the port with firewalld (see above).

For access beyond one computer, use HTTPS (see *HTTPS* below). Do not expose port 3000 directly to the internet.

## HTTPS

Passwords and lab data must not cross a network unencrypted. Two ways:

- **Behind the university's web server** (recommended when IT hosts it): their nginx/Apache/Caddy terminates HTTPS with the institution's certificate and forwards to `http://127.0.0.1:3000`. Start the app with `TRUST_PROXY=1` (so it sees the real client address and that the connection is HTTPS) and `SECURE_COOKIES=1`. The proxy must pass `Host`, `X-Forwarded-For` and `X-Forwarded-Proto`.
- **The app itself**: set `TLS_CERT` and `TLS_KEY` to the PEM files of a certificate; the app then serves HTTPS on its port.

Admin settings › Security shows whether the connection is encrypted. Details for IT: [docs/security-and-data.md](docs/security-and-data.md).

## Update

**From the app** (0.26 and later): releases are published on GitHub ([halogenrich/panoptica](https://github.com/halogenrich/panoptica/releases)). The app checks once a day and notifies admins. In **Admin settings › Updates**: **Download** (the file is checked against its SHA-256 and installed only when it carries PANOPTICA's signature), then **Install now**: the app backs up the database, stops, the update script replaces the program files (never the data) and starts the app again; the page reloads by itself. Each step is written to `updates/update.log` and shown under Updates. The repository is private: the app needs a read-only token once (the Updates tab explains how to make it; it is kept in `config/update.json` on this computer only).

**By hand**: download the package for your modules (`panoptica-devices.zip` and its `.sig`; `panoptica.zip` has every module) from the release into the same folder (or use the one the app downloaded into `updates/`), close the app window and run the update script (Linux: `./update.sh`). It takes the newest `panoptica*.zip` (or `perovskite-lab*.zip`) in `updates/` or Downloads (or a path given as argument), backs up the database, checks the signature, copies the new files over the old ones (your data stays) and starts the app again. Since 0.39 the package is already built: nothing is downloaded or built on the lab's computer.

## Backups

- The app backs up the database **once a day** while it runs, and before every update, and opens each new backup to check it is a complete database. **Back up now** (Admin settings › Backups) makes one on demand; the same page lists the backups and downloads any of them.
- Files: `backups/data-YYYYMMDD-HHMMSS-<type>.db` in the app folder. The app keeps the last 14 daily, 30 manual, 10 update and 10 before-restore backups and deletes older ones of each type.
- Keep copies off this PC too: **Admin settings › Backups › Second copy off this computer**, choose a folder on a network drive or a cloud-synced folder; every backup is then copied there as well (also the update-script backups, within the hour). The copies are **encrypted** (AES-256-GCM) by default and read back once to check them. The key is in `config/backup.key` on this PC; **Show key** in the same place: save it in a password manager or on paper, because without it the copies cannot be read.
- Restore from an encrypted copy: in `apps/server`, `node db-tools.cjs decrypt path/to/data-….db.enc` (asks for the key if this PC does not have it). It puts the backup into `backups/`; then restore it as below.

### Restore

1. Close the app window (Linux service: `systemctl --user stop perovskite-lab`).
2. Double-click `restore.bat` / `restore.command`, or run `./restore.sh` on Linux.
3. Type the number of the backup, then `yes`.

The script checks that the file is a valid database and backs up the current one first (type *before-restore*), so a restore can be undone by restoring that file. Then start the app again.

## Where the data is

- Database: `apps/server/data.db` (users, presets, batches, run data). Do not copy it while the app runs; use a backup instead.
- Backups: `backups/`.
- This computer's secrets: `config/` (backup key, update token if any). Never shared, never in backups or on GitHub.
- Everything else in the folder can be replaced by an update.

## Troubleshooting

- **"Node.js 22.13 or newer is required"**: install the current Node.js LTS from nodejs.org, then start again.
- **npm is blocked in PowerShell**: use the `.bat` scripts (they call `npm.cmd`), not PowerShell.
- **Install asks to approve install scripts** (newer npm): run `npm.cmd install-scripts approve --all` in the app folder, then start again.
- **Port 3000 already in use**: the app is already running in another window, or another program uses the port. Start with another port: `set PORT=3100` then `start.bat` (Windows), `PORT=3100 ./start.command` (Mac) or `PORT=3100 ./start.sh` (Linux).
- **Forgotten admin password**: see *Reset a password* above (works while the app runs).

## Development

How the code is organised, how a request travels through it, the database and how to change things: [docs/architecture.md](docs/architecture.md).

Monorepo (npm workspaces, Node 22+):

- The core: `apps/server` (Fastify API, SQLite built into Node, sessions, equipment, calendar, inventory, backups, activity log, updates), `apps/web` (React UI), `packages/core` (pure functions and their tests) and `packages/schema` (validation schemas, zod)
- Electronic Devices, the first module: `modules/devices/server` (recipes and stacks with versioning, batches, J–V, comparisons), `modules/devices/web` (their screens, the Three.js stack viewer) and `modules/devices/shared` (stoichiometry, spin timeline, deposition, geometry, mask analysis, stack geometry, J–V analysis, and their tests)
- How they fit together: [docs/architecture.md](docs/architecture.md)

```
npm install
npm run dev      # API on :3000, web with hot reload on :5173
npm run format   # Prettier over the code
npm run lint     # ESLint
npm run check    # format check + lint + typecheck + unit tests + server security checks + production build + package
npm run test:browser  # the main flows in Chromium, on the packaged app (after npm run check; npx playwright install chromium once)
```

GitHub: every push and pull request runs `npm run check`. A push to `main` whose `package.json` version has no release yet builds one package per combination of modules plus `panoptica.zip` with every module (the app built, with no source code: `tools/release-packages.mjs`), each with its SHA-256 and its signature (repository secret `SIGNING_KEY`; the public half is `release.pub`) and publishes the release `v<version>`, with the notes of that version from [CHANGELOG.md](CHANGELOG.md). So a release is: bump the version, add its CHANGELOG section, merge to `main`.

Environment variables: `PORT` (3000), `HOST` (127.0.0.1), `DB_PATH` (apps/server/data.db), `BACKUP_DIR` (backups), `CONFIG_DIR` (config), `ADMIN_USER` / `ADMIN_PASSWORD` (first start only), `SECURE_COOKIES=1` and `TRUST_PROXY=1` behind an HTTPS proxy, `TLS_CERT` / `TLS_KEY` for HTTPS in the app, `UPDATE_REPO` (halogenrich/panoptica).
