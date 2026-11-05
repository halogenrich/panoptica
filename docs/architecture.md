# Architecture

How the code is organised, how a request travels through it, where the data lives and how to change things safely. For what the app does, see the [user guide](user-guide.md); for protection and hosting, [security and data](security-and-data.md).

## In one paragraph

One Node.js process serves both the API (`/api/...`) and the built web app. The browser runs a React single-page app that talks to the API with JSON. The API is a Fastify server that validates every input with zod, checks the person's permission, and reads and writes one SQLite database file. Scientific calculations (stoichiometry, deposition times, geometry, J–V parameters, consumption) live in a separate package with no I/O, used by both the browser and the server, and covered by unit tests.

```
 Browser (React)                     Node.js process                           Disk
 ┌───────────────────┐   JSON over   ┌──────────────────────────────────┐     ┌──────────────────────────┐
 │ apps/web          │  HTTP(S)      │ apps/server (Fastify)            │     │ apps/server/data.db      │
 │  views, recipes,  │ ────────────▶ │  security hooks → auth → handler │ ──▶ │ backups/ (daily, checked)│
 │  3D viewer, plots │ ◀──────────── │  → zod → SQL → JSON              │     │ config/ (key, token)     │
 └───────────────────┘               └──────────────────────────────────┘     └──────────────────────────┘
          │                                       │
          └──────────── packages/core (pure functions) and packages/schema (zod) ──────┘
```

## Repository layout

| Folder | What it holds |
|---|---|
| `packages/core` | Domain logic, no I/O: solution stoichiometry and masses (`index.ts`), spin and evaporation timing, substrate and mask geometry (`geom.ts`, `mask.ts`), 3D stack geometry (`stack3d.ts`), J–V curve parameters (`iv.ts`), inventory consumption and forecasts (`inventory.ts`). Unit tests next to each file (`*.test.ts`, vitest). |
| `packages/schema` | zod schemas for every request body (`src/index.ts`). The server validates with them; the web app uses their types. |
| `apps/server/src` | The API (details below). |
| `apps/server/*.cjs` | Command-line tools for the start/update/restore scripts: `db-tools.cjs` (backup, restore, decrypt) and `reset-password.cjs`. They run with the app stopped or alongside it. |
| `apps/web/src` | The React app (details below). |
| `docs` | User guide (also shown under Help in the app), this file, security and data. |
| `tools` | `smoke.mjs` (server security checks), `stamp.cjs` (decides when start scripts reinstall or rebuild), `notes.mjs` (release notes from the changelog). |
| Root scripts | `start`, `start-network`, `update`, `restore`, `version`, `reset-password` in `.bat` (Windows), `.command` (macOS) and `.sh` (Linux) flavours. |
| `.github` | CI (`check.yml`), releases (`release.yml`), Dependabot. |

Not in the repository (see `.gitignore`): `node_modules`, builds, the database, `backups/`, `config/`, `updates/`.

## Server (`apps/server/src`)

| File | Responsibility |
|---|---|
| `index.ts` | Starts Fastify (HTTP or HTTPS), registers everything below, sign-in and sessions, users, tags, chemicals, batches, preferences, search, backups API, serving the built web app. The place to read first. |
| `db.ts` | Opens the SQLite database, creates the core tables, runs migrations (see below), `tx()` for transactions, `perms()` and `tagsOf()` for access tags. |
| `security.ts` | Security headers, the cross-site (Origin) check, session token hashing, the sign-in limiter, the password policy. |
| `audit.ts` | Activity log: the `audit` table, the hooks that record changes, the hash chain and its check, the admin endpoints. |
| `auth.ts` | Password hashing (scrypt) and verification. |
| `presets.ts` | Recipes, designs and stacks ("presets"): versions, sharing, run data, trash. |
| `iv.ts` | J–V measurement import, curves, statistics inputs, stability series. |
| `calendar.ts` | Equipment, bookings, outcomes, batch scheduling; moves batches to Running and Done. |
| `inventory.ts` | Storage areas and types, shelves, containers, CSV import. |
| `social.ts` | Comments, reactions, notifications, lab records. |
| `dashboard.ts` | The Overview (aggregates over batches, measurements and bookings). |
| `backup.ts` | Backups: make, check, list, prune, the encrypted second copy. |
| `updates.ts` | Update check against GitHub releases, download with checksum, install. |
| `config.ts` | The app root and the `config/` folder for this computer's secrets. |
| `quiet.ts` | Hides Node 22's "SQLite is experimental" warning. |

### A request, step by step

Example: an admin renames a batch, `PATCH /api/batches/12` with `{ "name": "heavy week" }`.

1. **`onRequest` hook** (`security.ts`): a change coming from another website's page (Origin header of another host) is refused with 403.
2. **Route `preHandler`**: `auth()` (in `index.ts`) reads the `sid` cookie, hashes it, finds the session and the user, refreshes presence, and attaches `req.user` with the user's role and tags. `auth(true)` additionally requires an admin; `auth('inventory')` or `auth('manager')` require that tag (or admin). No valid session → 401.
3. **Audit `preHandler`** (`audit.ts`): for changes, notes which route this is and the item's name ("T-08d") before anything changes.
4. **Handler**: validates the body with the zod schema from `@psc/schema` (`BatchPatch.safeParse`) → 400 with the first message if invalid; checks ownership (`batchOf(req, reply, true)`: owner or admin may edit; shared items are readable by all; the Professor reads everything); runs parameterised SQL.
5. **`onSend` hook** (`security.ts`): adds the security headers and `Cache-Control: no-store` to API answers.
6. **`onResponse` hook** (`audit.ts`): writes the activity log entry ("Edited a batch · T-08d", status 200) with the next link of the hash chain.

Errors are returned as `{ "error": "message" }` with a 4xx status; the web app's `api()` helper turns them into exceptions whose message is shown to the person.

### Permissions in one place

| Need | How it is checked |
|---|---|
| Signed in | `auth()` |
| Admin | `auth(true)` |
| Inventory or Manager tag | `auth('inventory')`, `auth('manager')` (admins always pass) |
| Sees everything (admin or Professor) | `req.user.all` |
| Owner of an item | per handler: `owner_id === req.user.id`, or admin; shared items readable by everyone signed in |

### Database

SQLite, one file, WAL mode, foreign keys on, accessed with Node's built-in `node:sqlite` (synchronous; one process, so no connection pool). Every query uses `?` or `@name` parameters.

| Table | Content |
|---|---|
| `users`, `sessions`, `user_prefs`, `tags`, `user_tags` | Accounts, sign-in sessions (token hashes), per-person settings, labels and access tags |
| `presets` | Recipes, designs and stacks: `segment` says which kind, `data` is JSON, `parent_id` links versions, `deleted_at` is the trash |
| `run_data` | What really happened when a recipe was run, linked to a batch by code |
| `batches` | A stack frozen at start (`snapshot` JSON) and what was recorded during the run (`record` JSON) |
| `chemicals` | Reagents with formula, molar mass, density, purity (JSON) |
| `iv_sets`, `iv_curves` | J–V measurements and their curves (data and computed metrics as JSON); `stability_of` links follow-up measurements |
| `equipment`, `bookings` | Calendar; booking times are UTC ISO strings compared as text |
| `storage_types`, `storage_areas`, `shelves`, `containers` | Inventory |
| `comments`, `reactions`, `notifications` | Discussion and notifications |
| `audit` | Activity log with hash chain |
| `meta` | App-wide settings and one-time flags (key/value) |

**Why JSON columns**: recipes, designs and stacks change shape as the lab's methods change; storing them as JSON documents (validated by zod on the way in, normalised with defaults on the way out by the web app's `norm()`) keeps old records readable without a migration for every new field.

**Migrations**: there is no migration framework. Each module creates its tables with `CREATE TABLE IF NOT EXISTS` and adds new columns with a guarded `ALTER TABLE` (`if (!cols('users').includes('photo')) db.exec('ALTER TABLE ...')`), and one-time data changes are guarded by a flag in `meta`. They run at every start and are idempotent, so any older database is brought up to date when the new version starts; the update script makes a backup first. Rules: only add (never rename or drop a column in place), give new columns a default, and keep each step safe to run twice.

## Web app (`apps/web/src`)

| Path | Responsibility |
|---|---|
| `main.tsx`, `App.tsx` | Entry point; sign-in and the forced password change; then `Shell`. |
| `Shell.tsx` | Layout (side menu on computers, bottom bar on phones), search, notifications, and which view is open. Navigation is component state (`view`), not URL routes. |
| `api.ts` | `api(path, method, body)`: the only way the app calls the server. |
| `ctx.tsx` | Shared context: the signed-in user, preferences. |
| `views/` | One file per screen: Batches, Calendar, Inventory, Overview, Admin settings (`Users.tsx` plus `AdminSecurity.tsx`), Trash, Help, Profile, printable sheets and reports. |
| `recipes/` | Each recipe kind (substrate prep, solution, spin, evaporation) as a `Kind`: defaults, editor, output, summary, run-data fields. `types.ts` defines the contract; `lib/Library.tsx` is the generic list/edit/view screen that hosts every kind. |
| `designs/` | Substrate and mask designers (shape editor, canvas, SVG). |
| `stacks/` | Stack model, the stack editor, the Three.js 3D viewer, the run sheet. |
| `iv/` | J–V import, measurement page, figures (J–V, box plots, stability), comparison. |
| `lib/` | Shared pieces: UI primitives (`ui.tsx`), comments, notifications, figures export, spreadsheet export (`xlsx.ts`), presence, the funny settings. |
| `styles.css` | All styles; design tokens (colours, radius, control height) at the top, light and dark themes. |

**Adding a recipe kind**: write a `Kind` in `recipes/` (see `recipes/types.ts`), register it in `recipes/index.ts`, add its navigation entry in `Shell.tsx`. The library, versions, sharing, comments and run data come with the generic screen.

## How to change things

| Task | Where |
|---|---|
| New API endpoint | The module of its area (or a new `registerX(app, auth, bad)` registered in `index.ts`); body schema in `packages/schema`; permission via `auth(...)`; a readable activity-log label in `audit.ts` (`LABEL`) |
| New column | Guarded `ALTER TABLE` next to the table's creation (see Migrations) |
| New calculation | `packages/core`, with a unit test |
| New screen | `apps/web/src/views`, wired in `Shell.tsx` |
| Release | Bump `version` in `package.json`, add a section to `CHANGELOG.md`, merge to `main` (CI publishes the release) |

## Quality checks

`npm run check` runs, in order: Prettier formatting check, ESLint, TypeScript (strict) for all packages, the core unit tests (vitest), the server security checks (`tools/smoke.mjs`: a real server on a temporary database, 38 checks of sign-in, permissions, headers, backups, encryption, activity log and updates), and the production build. CI runs it on Windows and Linux for every push and pull request, plus `npm audit`.

Format before committing with `npm run format`. Formatting-only commits are listed in `.git-blame-ignore-revs`.

## Known debts

Honest list of what a reviewer will notice, roughly in the order worth fixing:

- **`any` in the server**: request handlers type `req` and database rows as `any`. Typed route schemas (Fastify generics, or zod-derived types for params and rows) would catch mistakes at compile time.
- **Large files**: some screens are 1 000–1 700 lines (`Inventory.tsx`, `Overview.tsx`, `Calendar.tsx`) and `styles.css` holds every style. Splitting them by sub-screen would make reviews easier.
- **Tests**: core logic has unit tests and the server has end-to-end security checks, but there are no per-route server tests (permissions per endpoint, calendar rules) and no browser tests of the main workflows.
- **Navigation without URLs**: screens are not addressable by link (no router), so a browser reload returns to the start screen.
- **No migration history**: migrations are idempotent guards rather than numbered steps; fine at this size, but a numbered migration table would make the database version explicit.
- **History**: the repository starts at version 0.25 as one import commit; the reasons behind earlier choices are in the code comments and the changelog, not in commit history.
