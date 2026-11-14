# PANOPTICA: security and data management

For a research group that uses PANOPTICA and for its institution's IT. It describes what the app stores, who can see what, how the data is protected, backed up and recovered, what the app needs from a host, and what is not covered yet. Version 0.38.

## 1. What the app is

A web app for one research group: recipes and designs for perovskite solar cell fabrication, device stacks, batches and their run data, an equipment calendar, an inventory of chemicals, and J–V measurements with statistics.

- **Users**: the group's members (tens of people). No public access: people ask for access with an email of the institution's domains, and an admin accepts or declines each request; admins add visitors themselves, with a last day.
- **Deployment**: one server per lab, so each lab's data sits apart from every other lab's.
- **Software**: Node.js 22 (LTS), Fastify web server, SQLite database built into Node, React web interface. One process, one database file. No external services are called, except GitHub when an admin checks for updates.
- **Source**: a private GitHub repository (code only; no data, passwords or keys are in it: those exist only on the lab's server). Every change is checked automatically (types, tests, security checks, build, known-vulnerability scan) before a release is published.

## 2. What is stored

| Data | Examples | Sensitivity |
|---|---|---|
| Research records | recipes, stacks, batches, run data, J–V curves, comments | Unpublished research: confidential to the group |
| Inventory | substances, containers, amounts, places | Internal |
| Calendar | equipment bookings and their outcome | Internal |
| Accounts | username, names, institutional email, birth date, department, supervisors, photo, tags, equipment training, password hash | Personal data |
| Usage | last time seen online, activity log (who changed what, when, from which network address) | Personal data |

**Not stored**: national ID numbers, phone numbers, health data or any other sensitive personal data. Passwords are never stored, only a salted hash.

**Where**: one SQLite file (`apps/server/data.db`) on the computer that runs the app. Backups in `backups/` there, and optionally an encrypted second copy in a folder off that computer. Secrets of that computer (backup key, an update token if one is used) are in `config/`, never in the database, the backups or the repository.

## 3. Who can see what

Permissions are checked on the server for every request; hiding a button in the interface is never the only protection.

Admins make tags; a tag can give permissions:

| Role or permission | Can |
|---|---|
| Member | Create and edit their own work; read work others marked **Shared**; book equipment they are trained on; open their own overview (and their students', for supervisors) |
| **Inventory management** | Edit the substances and the inventory |
| **Equipment management** | Add, arrange and move places and equipment |
| **Equipment training** | Record who is trained on which equipment |
| **Lab overview** | Open the lab's overview and anyone's (activity, people's pages, equipment use) |
| **Private comments** | Read everything, including private work; comment privately to an owner |
| Admin | Everything above, plus accounts, backups, the activity log, updates and app settings |

Private work is visible only to its owner, people with Private comments and admins. Deleting an account blocks sign-in at once and keeps the person's work under "username (former)".

## 4. Protection

### Sign-in and passwords
- Passwords hashed with **scrypt** (memory-hard), a random 16-byte salt each; compared in constant time.
- New passwords: at least 10 characters (a short sentence is encouraged), at most 128; well-known passwords and passwords containing the username are refused (NIST SP 800-63B approach: length and block lists, no composition rules or forced periodic changes).
- Accounts created or reset by an admin get a temporary password that must be changed at the first sign-in.
- Sign-in is paused after 5 failures for a username, or 30 from one network address, within 10 minutes. Unknown usernames take as long as wrong passwords, so accounts cannot be discovered by timing.
- Every sign-in, failed sign-in and pause is in the activity log.

### Sessions
- A random 256-bit token in a cookie that scripts cannot read (`HttpOnly`), not sent from other websites (`SameSite=Lax`), and only over HTTPS when the app is served over HTTPS (`Secure`). Valid 7 days.
- The database keeps only a SHA-256 hash of each token: a copy of the database or a backup cannot be used to sign in.
- Changing a password ends the person's other sessions; disabling or deleting an account ends all of them.

### Requests and the browser
- Every change (POST, PUT, PATCH, DELETE) coming from a page of another website is refused (Origin check), on top of the SameSite cookie.
- All input is validated against a schema (zod) before use; all database queries are parameterised (no SQL injection).
- Security headers on every response: a strict **Content-Security-Policy** (only the app's own scripts; no inline or external scripts; no plugins; the app cannot be framed), `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: same-origin`, a `Permissions-Policy` that turns off camera, microphone and location, `Cross-Origin-Opener-Policy` and `-Resource-Policy: same-origin`, and **HSTS** over HTTPS.
- Answers carrying data are never cached by browsers or proxies (`Cache-Control: no-store`).
- Request bodies are limited in size: 1 MB by default, 3 MB where images are uploaded, 50 MB for importing J–V measurement files.

### Connection (transport)
The app supports HTTPS in two ways (section 7). **Without HTTPS, passwords and data cross the network unencrypted**; on a single computer (the default: the app listens only on `127.0.0.1`) nothing crosses a network. Admin settings › Security shows the state.

### Activity log (audit trail)
- Every accepted change, sign-in, failed sign-in and refused request: time, person, network address, action and the item it concerns (for example "Edited a batch · T-08d"). Sensitive reads are logged too: downloading a backup, showing the backup key, exporting the log.
- The content of changes is not logged, so the log holds no passwords and no research data.
- Each entry carries a SHA-256 hash of its own fields and of the previous entry's hash (a hash chain). Editing, inserting or deleting an entry directly in the database breaks the chain; Admin settings › Activity log and › Security show it and from which entry. (Someone with full control of the computer could rebuild the whole chain; the exported CSV, which includes the hashes, can be kept elsewhere as an independent reference.)
- Kept two years, then removed (the check still works from the oldest kept entry). Export as CSV for any audit.

## 5. Backups and recovery

| | |
|---|---|
| Automatic backups | Once a day while the app runs, and before every update and every restore |
| Method | SQLite `VACUUM INTO`: a consistent copy while the app is in use |
| Check | Every new backup is opened and passes SQLite's `integrity_check`; the result is shown to admins |
| Kept | Last 14 daily, 30 manual, 10 before-update, 10 before-restore |
| Second copy | Every backup is also copied to a folder off the computer (network drive, cloud-synced folder); retried every hour if that folder is offline |
| Encryption of the second copy | **AES-256-GCM** (authenticated: a damaged or altered file is detected), random key per installation in `config/backup.key`. Each copy is read back and decrypted once to check it |
| Recovery point | At most one day of work lost if the computer is lost (less with **Back up now**) |
| Recovery | `restore` script: lists the backups, checks the chosen one, backs up the current state first (so a restore can be undone) and replaces the database. From an encrypted copy: `node db-tools.cjs decrypt <file>` first |

**The backup key must be saved off the computer** (Admin settings › Backups › Show key, into a password manager or a printed sheet kept with the lab's papers). Without it the encrypted copies cannot be read, by anyone.

## 6. Updates and the software supply chain

- Releases are built by GitHub Actions from the repository: typecheck, unit tests, the server security checks (`npm run test:server`), production build and `npm audit` must pass, or no release is published. The release carries one package per combination of modules (`panoptica-devices.zip`; and `panoptica.zip` with every module, for labs on versions before 0.46), each with its SHA-256 and PANOPTICA's signature (Ed25519). The app downloads the package for the modules its licence lists.
- **Licence** (0.46): a file PANOPTICA signs with the same key for one lab: its name and id, its modules, the last day of updates, and the hash of a one-time setup code. The app refuses a licence that was changed, signed by anyone else, made for another lab, or older than the one installed. It decides which modules start and which releases are installed; it never stops the app or hides data. **Product keys** (0.47): the installer and the app's updates authenticate to PANOPTICA's activation service with the lab's product key and the computer's install id; the service keeps each key only as its SHA-256, limits how many computers may use it, slows down wrong keys, and hands out only the licence and the packages the key covers. Everything it hands out is signed by PANOPTICA and checked on the lab's computer, so the service cannot change what is installed. The key is kept in `config/update.json` on the lab's computer, never in the database or the backups. **Setup code**: the first admin can be made from another computer only with the code from the install sheet; it is kept only as a hash, tries are limited like sign-ins, and the setup closes once the first admin exists.
- The package is the app already built: no source code, and nothing is downloaded or built on the lab's server when it is installed or updated (only Node.js is needed there).
- The app downloads a release only when an admin asks, verifies the SHA-256 (a damaged download) and the signature (who made it: the public key is built into the app, the private key is held only by PANOPTICA), backs up the database, and replaces only program files; the data, backups and `config/` are never touched. The update script checks the signature again before it replaces anything. A package that is unsigned, or signed by anyone else, is refused.
- Dependabot opens weekly pull requests for library updates; each runs the same checks.
- The repository is private: the app reads the releases with a fine-grained token limited to reading this one repository, kept in `config/update.json` on the server; it is never sent to browsers and never stored in the database or backups. That token can still read the source code; releases will move to a place of their own so that lab servers hold no such token.
- The repository holds code only, never data: the database, backups, `config/` (backup key, token) and uploaded files stay on the server, and `.gitignore` keeps them out of commits. Tests use synthetic data made by the tests themselves. Releases can only be published by the repository's owner, through the checked workflow.
- Dependencies are few: Fastify (with its cookie and static-file plugins), zod, React, three.js, and small libraries for geometry, zip, QR codes and the emoji picker; all are bundled with the app, nothing loads from other sites at run time. The database engine is part of Node itself (no native modules).

## 7. Hosting: what the app needs

**Recommended**: one virtual machine per lab, run by the PANOPTICA team, with access arranged with the institution's IT.

- Node.js 22 LTS (or newer) and outbound HTTPS to `registry.npmjs.org` (install/update) and `api.github.com` (update check).
- The app on `127.0.0.1:3000`, behind the department's web server (nginx, Apache or Caddy) with the institution's TLS certificate, forwarding `Host`, `X-Forwarded-For` and `X-Forwarded-Proto`. Start the app with `TRUST_PROXY=1 SECURE_COOKIES=1`.
  Alternatively the app serves HTTPS itself with `TLS_CERT` and `TLS_KEY` (PEM files).
- Reachable from the institution's network or its VPN only; not from the internet.
- Disk encryption on the host (BitLocker, LUKS, FileVault) protects the database and local backups if the disk is stolen.
- A network share for the encrypted second copy of the backups.
- Optional: a way to run it as a service (Linux: `./install-shortcut.sh --service`, a systemd user service; Windows: NSSM or a scheduled task at boot).

Example nginx site:

```nginx
server {
  listen 443 ssl;
  server_name panoptica.example.edu;
  ssl_certificate     /etc/ssl/certs/institution.pem;
  ssl_certificate_key /etc/ssl/private/institution.key;
  client_max_body_size 60m;
  location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto https;
  }
}
```

## 8. Personal data (LGPD, GDPR and similar laws)

This section describes the facts; the legal assessment belongs to the institution's data protection officer.

- **Data subjects**: members of the group with an account.
- **Data**: username, names, institutional email, birth date (to confirm a password reset; the birthday shows in the calendar only if the person allows it), department, supervisors, photo, tags, equipment training, last time online, activity log entries (time, action, network address). No sensitive personal data.
- **Purpose**: running the group's research records (who prepared what, equipment use, responsibility for changes) and protecting them (the activity log).
- **Minimisation**: no phone or ID numbers; the log stores actions, not content.
- **Access**: section 3. Each person sees their own overview; supervisors see their students'; people with Lab overview see everyone's.
- **Retention**: activity log two years; accounts until deleted by an admin (the work stays under "username (former)"; the photo and preferences are removed). Backups age out as in section 5.
- **Rights** (access, correction, deletion): a member sees and edits their name and photo in Edit profile; an admin exports a person's activity (Activity log › filter by person › Export CSV) or deletes the account.
- **Data packages** (for depositing research data): built in the browser from what the person can already see, and downloaded to their computer; the app sends nothing anywhere. A package names the authors typed in its dialog and the owners of its items (display names only, no usernames, addresses or log entries). Depositing it in a repository is the authors' decision and follows the repository's terms.
- **Security incidents**: the activity log, refused requests and failed sign-ins support the investigation; the response follows the institution's procedure.

## 9. What is not covered yet

| Gap | Risk | Plan |
|---|---|---|
| No single sign-on or second factor | A stolen password opens that account | Institutional SSO (if IT offers OIDC or SAML), or a second factor for admins |
| Database not encrypted by the app | A stolen disk exposes the data | Host disk encryption (section 7) |
| No independent security review | Unknown issues | Review or penetration test by IT before wider use |
| One server, no automatic failover | Down while the host is down | Acceptable for a group tool; backups bound the data loss |
| Activity log chain can be rebuilt by someone in full control of the host | Undetected log tampering by a host administrator | Keep periodic CSV exports elsewhere |

## 10. Contacts and reporting

Report a suspected vulnerability or incident privately to the app's maintainers (see `SECURITY.md`), not in a public issue.
