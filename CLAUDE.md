# Working on PANOPTICA

Lab management app: a core (accounts, calendar with equipment scheduling, inventory, equipment, comments, backups, updates) plus modules (first: Electronic Devices). One server per lab on a mini PC; not hosted. Owner: Richard. Plans and history live in the Claude project docs: `claude/panoptica-roadmap.md` (what to build next, and the decisions behind it) and `claude/perovskite-lab-releases.md` (what each release did). Read the roadmap before starting a release.

## How to work

- **One session per release.** Start from the roadmap, build that release, update the two project docs at the end. Do not carry a session across releases.
- **Ask before building when a decision is Richard's** (pricing, what a lab sees, anything that removes a feature). Otherwise take the sensible default and say which one.
- **Tell him plainly what was not tested.** "Tested on GitHub's machines, not on a real PC" is the kind of sentence he needs.
- Until 1.0 no lab depends on the app: prefer the clean change over keeping compatibility, but migrate existing data (the LNES database is real).

## Interface work: always

Richard has had to ask for screens to be redone when these were skipped. Before writing or changing any screen:

1. **Load the design skills first** (`design-skills:design-elevation`, `design-skills:ux-writing`, `design-skills:interaction-design`; `frontend-design` for a new surface). Run `design-skills:design-critique` on the result.
2. **Reuse what exists**: `Dialog`, `box-form`, `Seg`, the list/cards switch, the shared Export menu, the drag handle (`apps/web/src/views/common.tsx` and the existing CSS). No new modal, form or button style without a reason.
3. **Look at it.** Run the app, take screenshots at desktop width and at 390 px, and look at them before saying it is done. Check dark mode.
4. Rules he has set:
   - No "AI slop": no side accent bars, no tinted cards, no pills with a little dot. An item's colour is a bar under its name.
   - Sentence case everywhere. Full words in the interface (GB: is the one abbreviation); plots and tables may abbreviate.
   - Dates dd/mm/yyyy, 24 h, English.
   - Anything reorderable uses the drag handle, never arrow buttons.
   - Confirmation only for what cannot be undone (moving to the trash asks nothing).
   - Text is direct and concise: say what happened and what to do next. No instructions on slides.
   - Round colour pickers; multi-pick toggles as plain text with an accent fill when picked.
5. **Figures** (J–V, box plots, comparisons): closed square frame, journal style; forward and backward in the same colour, backward dashed; box plots with square corners, density as a line, scatter beside the box; the lab logo only, never the lab name, placed where it covers no data.

## Data and security: never

- **Never commit lab data.** No real J–V files, inventory exports, batch names, people or sample names, in code, comments, tests or docs. Tests generate synthetic data (`packages/core/src/ivfixtures.ts`). Files Richard attaches are read locally and stay out of the repository.
- **A clean install mentions no lab or institution** and has no prefilled lab data (no equipment, tags, recipes or designs). The storage types are the only seeded list.
- **Never ask for or handle the private signing key.** `release.pub` is the public half; the private key is the repository secret `SIGNING_KEY` and Richard's own file. Tests use throwaway keys (`PANOPTICA_TEST=1`).
- Nothing locks a lab out of its data: licence limits show a notice or refuse one action, never the app.

## Code

- Layout: `apps/server` (Fastify, Node's built-in SQLite), `apps/web` (React 19, Vite 8), `packages/core`, `packages/schema`, `modules/devices/{shared,server,web}`, `installer/`, `tools/`.
- **The core never imports a module.** A module's server imports the core only through `@psc/server/api`; its web through `@web/…`. ESLint enforces it. Module behaviour goes through the registry in `apps/server/src/modules.ts` (subjects, steps, record types, uses, overview).
- **Database changes** are numbered entries, one shared numbering: core in `apps/server/src/schema.ts`, devices in `modules/devices/server/src/schema.ts`. Never alter tables anywhere else. Check a migration against an older database copy, not only a fresh one.
- Comments say why, in plain words, with the version that introduced the behaviour.
- `tsc -p apps/web` always with `--noEmit` (otherwise it writes .js into `src`).
- Kill stray servers before taking screenshots: `pkill -f "node --import tsx src/index.ts"`, `pkill -f dist/server.mjs`.

## Checks

- `npm run check`: format, lint, typecheck, unit tests, server checks with and without modules, build, package, checks against the package.
- `npm run build && npm run test:browser && npm run test:browser:core`: browser flows on the packaged app.
- New behaviour gets a server check in `tools/smoke.mjs`; a new screen or flow gets a browser flow in `tools/browser.mjs`.
- Workflows: Check (Linux and Windows), Update end-to-end, Installer (Windows and macOS, real installs), Release. Installer and update changes are only proven there: read the job log, do not assume.
- A flaky test is fixed, not re-run.

## Releases

1. Branch `release/<version>`; bump `package.json`; add the `CHANGELOG.md` section (written for lab people: what changed for them, no file names); `npm install --package-lock-only`.
2. `npm run check` and the browser tests; commit; push; open the PR.
3. Wait for every run on the last commit; merge with a merge commit.
4. Wait for the Release run; download the assets; `sha256sum -c` and `node tools/verify-package.cjs` on each package; send them to Richard.
5. Update `claude/perovskite-lab-releases.md` and the roadmap in the project. When editing those docs, change the part and keep the rest: read the result back before writing it to the project.

Commits end with the `Co-Authored-By` line of the model in use and **no session link**. PR descriptions end with `🤖 Generated with [Claude Code](https://claude.com/claude-code)` and no URL. The merge commit message is only the `Co-Authored-By` line.
