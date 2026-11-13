# Architecture

How the code is organised, how a request travels through it, where the data lives and how to change things safely. For what the app does, see the [user guide](user-guide.md); for protection and hosting, [security and data](security-and-data.md).

## In one paragraph

One Node.js process serves both the API (`/api/...`) and the built web app. The browser runs a React single-page app that talks to the API with JSON. The API is a Fastify server that validates every input with zod, checks the person's permission, and reads and writes one SQLite database file. The app is a **core** (accounts, lab setup, equipment, calendar, inventory, comments, trash, search, Overview, backups, updates) and **modules** that add to it (0.43: Electronic Devices, in `modules/devices`). The core never imports a module: modules register what they add (`apps/server/src/modules.ts`, `apps/web/src/modules/types.ts`) and the build or the server's start puts them in place. Scientific calculations (stoichiometry, deposition times, geometry, J–V parameters, consumption) live in packages with no I/O, used by both the browser and the server, and covered by unit tests.

```
 Browser (React)                     Node.js process                           Disk
 ┌───────────────────┐   JSON over   ┌──────────────────────────────────┐     ┌──────────────────────────┐
 │ apps/web          │  HTTP(S)      │ apps/server (Fastify)            │     │ apps/server/data.db      │
 │  views, recipes,  │ ────────────▶ │  security hooks → auth → handler │ ──▶ │ backups/ (daily, checked)│
 │  3D viewer, plots │ ◀──────────── │  → zod → SQL → JSON              │     │ config/ (key, token)     │
 └───────────────────┘               └──────────────────────────────────┘     └──────────────────────────┘
          │                                       │
          └──────────── packages/core (pure functions) and packages/schema (zod) ──────┘
   modules/devices/{web,server,shared}: Electronic Devices, plugged into each side through the registries
```

## Repository layout

| Folder | What it holds |
|---|---|
| `packages/core` | The core's logic, no I/O: accounts and passwords, working hours, inventory amounts and consumption series (`inventory.ts`), molar mass from a formula, CAS numbers and hazard pictograms (`chem.ts`), reading inventory exports (`inventoryCsv.ts`), equipment inside equipment (`equipment.ts`), SHA-256. Unit tests next to each file (`*.test.ts`, vitest). |
| `packages/schema` | zod schemas for the core's request bodies (`src/index.ts`). The server validates with them; the web app uses their types. |
| `apps/server/src` | The core's API (details below). `api.ts` is what modules may use. |
| `modules/devices/shared` | `@psc/devices`: Electronic Devices' logic, no I/O: solution stoichiometry (`index.ts`), spin and evaporation timing, substrate and mask geometry (`geom.ts`, `mask.ts`), 3D stack geometry (`stack3d.ts`), J–V curve parameters (`iv.ts`), variants, consumption of a batch (`uses.ts`), the photovoltaics steps (`steps.ts`); its zod schemas (`schema.ts`, `@psc/devices/schema`). Unit tests next to each file. |
| `modules/devices/server` | Its API: the manifest (`index.ts`), its database changes (`schema.ts`), recipes and stacks (`presets.ts`), batches (`batches.ts`, `batchlock.ts`), J–V (`iv.ts`, `ivdata.ts`), comparisons, its Overview part (`overview.ts`). |
| `modules/devices/web` | Its screens: the manifest (`index.tsx`: pages, menu groups, Overview part, the Calendar tray, the run data after a step, the data package window), recipes, designs, stacks and the 3D view, batches, J–V, comparisons. |
| `apps/server/*.cjs` | Command-line tools for the start/update/restore scripts: `db-tools.cjs` (backup, restore, decrypt) and `reset-password.cjs`. They run with the app stopped or alongside it. |
| `apps/web/src` | The core's React app (details below). |
| `docs` | User guide (also shown under Help in the app), this file, security and data. |
| `tools` | `smoke.mjs` (server checks), `browser.mjs` (browser flows), `package.mjs` (the release package, with chosen modules), `fake-module.ts` (a module that exists only in the tests), `stamp.cjs` (decides when start scripts reinstall or rebuild), `notes.mjs` (release notes from the changelog). |
| Root scripts | `start`, `start-network`, `update`, `restore`, `version`, `reset-password` in `.bat` (Windows), `.command` (macOS) and `.sh` (Linux) flavours. |
| `.github` | CI (`check.yml`), releases (`release.yml`), Dependabot. |

Not in the repository (see `.gitignore`): `node_modules`, builds, the database, `backups/`, `config/`, `updates/`.

## Server (`apps/server/src`)

| File | Responsibility |
|---|---|
| `index.ts` | Starts Fastify (HTTP or HTTPS), loads the modules, registers everything below and the modules' routes, sign-in and sessions, users, tags, preferences, search, backups API, serving the built web app. The place to read first. |
| `api.ts` | What a module may use (0.43): the database and its change list, the registry, notifications, the calendar's booking rules. A module imports only this (`@psc/server/api`). |
| `db.ts` | Opens the SQLite database and brings it up to date (`schema.ts`, see Migrations), `tx()` for transactions, `perms()` and `tagsOf()` for access tags. |
| `schema.ts` | The core's changes to the database, numbered and in order; each module keeps its own list in the same numbering and runs it when it is loaded. |
| `security.ts` | Security headers, the cross-site (Origin) check, session token hashing, the sign-in limiter, the password policy. |
| `audit.ts` | Activity log: the `audit` table, the hooks that record changes, the hash chain and its check, the admin endpoints. |
| `auth.ts` | Password hashing (scrypt) and verification. |
| `modules.ts` | The module registry: what bookings can be for (subjects, with their page, hint and steps) and the steps equipment can do (0.41); record types for comments, trash, search and sharing, what a module used from the inventory, and its part of the Overview (0.42); equipment procedures, activity-log names, live-update topics and backup lines (0.43). The core knows modules only through it. `canSee` is the one sharing rule. |
| `calendar.ts` | Core calendar: bookings, outcomes, atmosphere, clashes and cleanup, off-hours. A booking is for a subject (`bookings.subject`, `subject_id`) or a stated purpose; everything about the subject (owner, lock, whether an outcome is asked, what happens after it) comes from its module. |
| `inventory.ts` | Storage areas and types, shelves, containers, CSV import, and consumption: the sum of what the modules report they used (`/api/inventory/use`). |
| `chemicals.ts` | Substances (0.44), made from the containers: found by CAS number, else by name, and made when missing (`substanceFor`); the container recipes use (`useBottle`); `substances()` is what recipes and batches read. |
| `social.ts` | Comments, reactions, notifications, lab records, the trash: all over the record types the modules register. |
| `dashboard.ts` | The Overview: people, equipment time and steps that did not go as planned, plus each module's part (`m.<module>`). |
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
| `batches` | A stack frozen at start (`snapshot` JSON), what was recorded during the run (`record` JSON), its variants with their recipes frozen (`variants` JSON; applied to the snapshot by `applyVariant` in `@psc/devices`), and `done_at` / `unlocked_until` for the automatic lock (`batchlock.ts`) |
| `chemicals` | Substances: name, CAS number, and as JSON formula, molar mass, density, melting and boiling point, refractive index, roles, hazard pictograms, Federal Police and Army control. Purity, supplier and lot are each container's; `containers.use` marks the one recipes take. |
| `iv_sets`, `iv_curves` | J–V measurements and their curves (data and computed metrics as JSON); `stability_of` links follow-up measurements; `kind = 'check'` marks check sweeps |
| `comparisons` | Saved comparisons: groups of devices as JSON references (`data`), private by default |
| `equipment`, `bookings` | Calendar; booking times are UTC ISO strings compared as text |
| `storage_types`, `storage_areas`, `shelves`, `containers` | Inventory |
| `comments`, `reactions`, `notifications` | Discussion and notifications |
| `audit` | Activity log with hash chain |
| `meta` | App-wide settings and one-time flags (key/value) |

**Why JSON columns**: recipes, designs and stacks change shape as the lab's methods change; storing them as JSON documents (validated by zod on the way in, normalised with defaults on the way out by the web app's `norm()`) keeps old records readable without a migration for every new field.

**Migrations** (0.40): every change to the database is an entry in `apps/server/src/schema.ts`, numbered and in order, marked `core` or `devices` (the module it belongs to). When the database opens (`db.ts`), the entries it has not had yet run, each in a transaction, and are recorded in the `migrations` table; a failed one leaves the database as it was before it and stops the start (the update script made a backup first). No other file creates or alters tables. Rules: add new entries at the end, never edit or reorder old ones; only add (never rename or drop a column in place) and give new columns a default. Entries 1–33 come from before the list existed and keep their "is this column there yet" guards, so databases from any earlier version end up the same as new ones (checked by comparing both, column by column).

## Web app (`apps/web/src`)

| Path | Responsibility |
|---|---|
| `main.tsx`, `App.tsx` | Entry point; sign-in and the forced password change; then `Shell`. |
| `Shell.tsx` | Layout (side menu on computers, bottom bar on phones), search, notifications, and which page is open (its address is `#/page/id`, `lib/route.ts`). The menu is the core's pages (Overview, Calendar, Lab) plus the installed modules' groups. |
| `modules/` | What each module adds to the screens: `types.ts` is the contract (pages and menu groups, the Overview part, a Calendar tray, what to ask after a concluded step, windows opened from anywhere), `installed.ts` the modules of this build (written by `vite.config.ts`). The server says which are installed (`/api/version`). |
| `api.ts` | `api(path, method, body)`: the only way the app calls the server. |
| `ctx.tsx` | Shared context: the signed-in user, preferences. |
| `views/` | One file per screen: Batches, Calendar, Inventory, Overview (the core frame; `overview/parts.tsx` the pieces module parts share), Admin settings (`Users.tsx` plus `AdminSecurity.tsx`), Trash, Help, Profile, printable sheets and reports. |
| `modules/devices/web/src/recipes/` | Each recipe kind (substrate prep, solution, spin, evaporation) as a `Kind`: defaults, editor, output, summary, run-data fields. `types.ts` defines the contract; `lib/Library.tsx` is the generic list/edit/view screen that hosts every kind. |
| `modules/devices/web/src/designs/` | Substrate and mask designers (shape editor, canvas, SVG). |
| `modules/devices/web/src/stacks/` | Stack model, the stack editor, the Three.js 3D viewer, the run sheet. |
| `modules/devices/web/src/iv/` | J–V import, measurement page, figures (J–V, box plots, lifetime), pixel comparison; `model.ts` holds the counting rule (`inStats`: best scan per pixel and direction, never a check sweep). |
| `modules/devices/web/src/compare/` | Comparisons across measurements: groups, device picker, naming rules and "what changed" (`model.ts`), results and exports (`Comparisons.tsx`). |
| `lib/` | Shared pieces: UI primitives (`ui.tsx`), comments, notifications, figures export, spreadsheet export (`xlsx.ts`), presence, the funny settings. |
| `styles.css` | All styles; design tokens (colours, radius, control height) at the top, light and dark themes. |

**Adding a recipe kind**: write a `Kind` in `modules/devices/web/src/recipes/` (see `recipes/types.ts`), register it in `recipes/index.ts`, add its page in `modules/devices/web/src/index.tsx`.

### Modules (0.43)

A module is a folder `modules/<id>/` with up to three packages: `server` (its manifest in `src/index.ts`: `addModule({...})`, imported only through `@psc/server/api`), `web` (its manifest in `src/index.tsx`, default export a `WebModule`, importing the core's pieces as `@web/…`) and `shared` (its pure logic and schemas). From source, the server loads every module present (or those in `PANOPTICA_MODULES`, `none` for the core alone) and `vite.config.ts` builds the web app with the same list. `tools/package.mjs --modules a,b` makes a package with only those: the server bundle imports them before the core, and the web app is built with them. A module's database changes run when it is loaded, after the core's; a lab that adds a module later gets them then. ESLint enforces the line: the core may not import from `modules/` or `@psc/devices`, and a module's server may not import the core's files except `api.ts`. The library, versions, sharing, comments and run data come with the generic screen.

## How to change things

| Task | Where |
|---|---|
| New API endpoint | The module of its area (or a new `registerX(app, auth, bad)` registered in `index.ts`); body schema in `packages/schema`; permission via `auth(...)`; a readable activity-log label in `audit.ts` (`LABEL`) |
| New table or column | A new entry in the list of its owner (`apps/server/src/schema.ts` for the core, the module's `schema.ts`), with the next number in the shared sequence |
| New calculation | `packages/core` (the core) or the module's `shared`, with a unit test |
| New screen | A page of its module (`modules/<module>/web/src/index.tsx`) or of the core (`CORE` in `Shell.tsx`, the screen in `apps/web/src/views`) |
| New record type (commented, trashed, searched) | An `ItemKind` in the module's `items` (`apps/server/src/modules.ts`) |
| Release | Bump `version` in `package.json`, add a section to `CHANGELOG.md`, merge to `main` (CI publishes the release) |

## Quality checks

`npm run check` runs, in order: Prettier formatting check, ESLint (including the core/module line), TypeScript (strict) for the core and each module package, the unit tests (vitest) of `packages/core` and `modules/devices/shared`, the server checks (`tools/smoke.mjs`: a real server on a temporary database, over 200 checks of sign-in, permissions, headers, backups, encryption, activity log, updates, the calendar and the module registry with a test module) with Electronic Devices and again **with the core alone** (`--core`: no Electronic Devices tables or routes, no substances until a container is added; the test module still works), the production build, packaging the app with Electronic Devices and the server checks on that package, then packaging **the core alone** (`--modules none`) and the core checks on that package. CI runs it on Windows and Linux for every push and pull request, plus `npm audit` of every dependency, including the build and test tools. `npm run test:browser` (`tools/browser.mjs`, Playwright with Chromium) clicks through the main flows on the packaged app with a new database: first setup, signing out and in, the side menu, adding equipment, a booking, a stack's and a batch's run sheet (checking that the sheet, not the page, is what prints, also when the browser prints after `print()` returns, as Safari does), starting a batch by name, booking for it, search, a J–V import of synthetic files, the Overview, the trash, adding a container and importing an export, and consumption. `npm run test:browser:core` does the same flows that exist without the module on the core-alone package. CI runs both on Linux, and every release runs them before publishing.

Format before committing with `npm run format`. Formatting-only commits are listed in `.git-blame-ignore-revs`.

## Known debts

Honest list of what a reviewer will notice, roughly in the order worth fixing:

- **`any` in the server**: request handlers type `req` and database rows as `any`. Typed route schemas (Fastify generics, or zod-derived types for params and rows) would catch mistakes at compile time.
- **Large files**: some screens are 1 000–1 700 lines (`Inventory.tsx`, `Overview.tsx`, `Calendar.tsx`) and `styles.css` holds every style. Splitting them by sub-screen would make reviews easier.
- **Tests**: core logic has unit tests and the server has end-to-end security checks, and the main workflows have browser tests, but there are no per-route server tests (permissions per endpoint, calendar rules).
- **Module split, what is left** (0.44 and after): the core still has the equipment `role` column (derived through the modules, used by the batch scheduler and the drawings) and the chemicals' perovskite roles (salt, solvent, ETL…); some core texts name batches (the outcome question, the first-setup screen, the funny headlines) and the user guide in Help describes Electronic Devices; the API routes of Electronic Devices keep their paths (`/api/batches`, not `/api/m/devices/…`).
- **History**: the repository starts at version 0.25 as one import commit; the reasons behind earlier choices are in the code comments and the changelog, not in commit history.
