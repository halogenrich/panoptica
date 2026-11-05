# Perovskite Lab

Internal web app to plan and record perovskite solar cell fabrication: substrate and mask designs, recipes, device stacks with a 3D view, batches, run data and electric (J–V) measurements (import, per-pixel curves, statistics). How to use it: [docs/user-guide.md](docs/user-guide.md) (also under **Help** in the app).

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

2. Unzip `perovskite-lab.zip` somewhere in your home folder, e.g. `~/perovskite-lab`.
3. In a terminal in that folder: `./start.sh`. The first run installs and builds (a few minutes); the browser opens http://localhost:3000. Ctrl+C stops it.
4. Optional: `./install-shortcut.sh` adds **Perovskite Lab** and **Perovskite Lab (network)** to the app menu (Super key, type "Perovskite"); they open a terminal window that runs the app.

**Run as a lab server** (no window to keep open, starts with the computer): `./install-shortcut.sh --service`, or `./install-shortcut.sh --service lan` to serve the network. It installs a systemd user service:

- status `systemctl --user status perovskite-lab`, log `journalctl --user -u perovskite-lab -f`
- stop `systemctl --user stop perovskite-lab` (needed before `./restore.sh`; `./update.sh` restarts it by itself)
- remove `./install-shortcut.sh --remove`

To start at boot without anyone logging in, the script runs `loginctl enable-linger`; if that is refused, run `sudo loginctl enable-linger $USER` once.

**Network access on Fedora**: firewalld blocks the port by default. Open it once:
`sudo firewall-cmd --permanent --add-port=3000/tcp && sudo firewall-cmd --reload`

## Start

Double-click the start script (Linux: run `./start.sh` in a terminal). The first run installs dependencies and builds the web app (a few minutes, needs internet); later runs start in seconds. The browser opens http://localhost:3000. Closing the window stops the app.

The first start creates the user **admin** and prints a temporary password once in the window; at the first sign-in the app asks for a new one. Other users are created in the app under **Users and backups** with a temporary password that they replace at their first sign-in. To choose the first admin password instead, set `ADMIN_PASSWORD` before the first start.

Start automatically at login (Windows): Win+R › `shell:startup` › put a shortcut to `start.bat` there. Linux: see *Run as a lab server* above.

## Other computers and phones

By default only the PC itself can open the app. `start-network.bat` / `start-network.command` / `./start-network.sh` (same as `start … lan`) make it reachable on the local network; in the app, **Invite a phone (QR code)** in the profile menu shows the address as a QR code to scan; the window prints the addresses to open (for example `http://192.168.0.23:3000`). Windows asks once to allow Node.js through the firewall: allow it on private networks. On Fedora, open the port with firewalld (see above).

For access beyond the lab network (VPN, institutional network), put the app behind an HTTPS reverse proxy (Caddy or nginx) and set `SECURE_COOKIES=1`. Ask IT; do not expose port 3000 directly to the internet.

## Update

1. Download the new `perovskite-lab.zip` (leave it in Downloads).
2. Close the app window (Linux service: nothing to do).
3. Double-click the update script (Linux: `./update.sh`).

It takes the newest `perovskite-lab*.zip` in Downloads (or a path given as argument), backs up the database, copies the new files over the old ones (your data stays), reinstalls and rebuilds only if the files actually changed (compared by content), and starts the app. The version shows in the profile menu and with the version script.

## Backups

- The app backs up the database **once a day** while it runs, and the update script backs up before every update. **Back up now** (admin, under **Users and backups**) makes one on demand; the same page lists the backups and downloads any of them.
- Files: `backups/data-YYYYMMDD-HHMMSS-<type>.db` in the app folder. The app keeps the last 14 daily, 30 manual, 10 update and 10 before-restore backups and deletes older ones of each type.
- Keep copies off this PC too: in the app, **Users and backups › Second copy off this computer**, choose a folder on a network drive or a cloud-synced folder; every backup is then copied there as well (also the update-script backups, within the hour).

### Restore

1. Close the app window (Linux service: `systemctl --user stop perovskite-lab`).
2. Double-click `restore.bat` / `restore.command`, or run `./restore.sh` on Linux.
3. Type the number of the backup, then `yes`.

The script checks that the file is a valid database and backs up the current one first (type *before-restore*), so a restore can be undone by restoring that file. Then start the app again.

## Where the data is

- Database: `apps/server/data.db` (users, presets, batches, run data). Do not copy it while the app runs; use a backup instead.
- Backups: `backups/`.
- Everything else in the folder can be replaced by an update.

## Troubleshooting

- **"Node.js 22.13 or newer is required"**: install the current Node.js LTS from nodejs.org, then start again.
- **npm is blocked in PowerShell**: use the `.bat` scripts (they call `npm.cmd`), not PowerShell.
- **Install asks to approve install scripts** (newer npm): run `npm.cmd install-scripts approve --all` in the app folder, then start again.
- **Port 3000 already in use**: the app is already running in another window, or another program uses the port. Start with another port: `set PORT=3100` then `start.bat` (Windows), `PORT=3100 ./start.command` (Mac) or `PORT=3100 ./start.sh` (Linux).
- **Forgotten admin password**: see *Reset a password* above (works while the app runs).

## Development

Monorepo (npm workspaces, Node 22+):

- `packages/schema`: validation schemas (zod) shared by server and web
- `packages/core`: pure domain functions (stoichiometry, spin timeline, deposition, geometry, mask analysis and exports, stack geometry) and their tests
- `apps/server`: Fastify API, SQLite (better-sqlite3), sessions, presets with versioning, batches, backups
- `apps/web`: React UI, Three.js stack viewer

```
npm install
npm run dev      # API on :3000, web with hot reload on :5173
npm run check    # typecheck + unit tests + production build
```

Environment variables: `PORT` (3000), `HOST` (127.0.0.1), `DB_PATH` (apps/server/data.db), `BACKUP_DIR` (backups), `ADMIN_USER` / `ADMIN_PASSWORD` (first start only), `SECURE_COOKIES=1` behind HTTPS.
