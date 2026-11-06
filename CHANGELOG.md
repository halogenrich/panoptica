# Changelog

Each section becomes the notes of its GitHub release (the release workflow takes the section whose heading starts with the version).

## 0.33.0 (2026-11-06)

Batches: variants, locking and mentions.

- **Batch variants**: the devices of a batch that differ from the default device. A variant links to a premade variation (another stack; versions of the batch's stack come first) or lists what changes from the default device: another recipe for a layer (versions of that recipe first), an additive, a layer added or left out, or a change in words. Its recipes are frozen when saved, like the batch. Substrates per variant and for the default device. Measured samples link to a variant ("B-12, variant 5 % MACl"); statistics and comparisons keep variants apart, the pixel map and J–V figure use the variant's layers and mask, and **What changed** in Comparisons reads the variant's recipes and additives. The print sheet, the report and the spreadsheet list the variants and their recipes.
- **Finished batches lock** 14 days after they are Done: layers, run data, variants, notes, bookings and name stay as recorded; comments, sharing and measurement links stay open. The batch page shows when it will lock and a notice once it is locked; the list shows a padlock. An admin can unlock a batch for 7 days (or lock it again now); both are in the activity log. Batches already Done get their finishing date from their last change.
- **@mentions in comments**: type @ to pick someone who can open the item; they are notified, and the mention shows as their name. Mentions added by editing a comment notify the person added.
- The batch remembers the stack it was started from (for its variants).

## 0.32.0 (2026-11-06)

Consistency release: the same patterns everywhere, and the batch record taken from the calendar.

- **Colour as a bar under the name** wherever a colour identifies something (comparison groups, What changed, the calendar's equipment filter and picker, the hover card, step outcomes); no coloured side bars, tinted cards or dot pills. Toggle groups (plots to show, ions, solution type) use the same track as the other switches; badges are rectangles, not pills. Section titles and labels in sentence case (no all caps).
- **Glovebox cleanup** drawn as part of its booking: no gap, the booking's bottom corners square, the cleanup below it in a lighter hatch of the same colour.
- **Drag to reorder** with the same handle everywhere: spin steps and dispenses, solvents and additives, stack layers (Review step), comparison groups, inventory divisions and equipment (sets the calendar's column order). Rows are removed with the same ✕.
- **Cards or List** in Batches, Electric measurements and Comparisons, one choice for the whole app.
- **Pixel map: Both** shows backward above forward PCE in every pixel.
- **3D view settings behind the cog** in the stack editor and the stack page, as on the batch page.
- **Batches without checkboxes**: each layer shows its calendar state (not scheduled, booked, concluded); progress on the cards counts concluded booked steps. After **Concluded**, the run data of that step's recipes open with every value required; **Add it later** keeps the batch page listing what is missing and sends a reminder. Report and spreadsheet show the layer states.
- **Perovskite solutions**: Additives right after "Preparation of the precursor solution".
- **Dates** dd/mm/yyyy and times 24 h everywhere, English whatever the browser's language.
- **Move to trash** asks nothing (Undo in the toast, 30 days in Trash); confirmations only for what cannot be undone. Stale "Library › Trash" texts fixed.
- **One Export menu** (statistics, comparisons, Overview slides): titled sections, each row with its formats.
- **Search** also finds measurements, comparisons and containers (by name, CAS or lot; opens the container).
- **Substrate preparation in the scheduler**: a substrate-prep block on the equipment set for it (the UV-ozone cleaner by default).
- **Comparisons**: What changed also reads recipes of devices linked to a stack.

## 0.31.0 (2026-11-06)

- **Glovebox cleanup**: each booking of glovebox equipment (GB:) is followed by 20 minutes of cleanup, shown hatched in the calendar. The equipment stays taken, so nobody can start right after someone else; a booking whose own cleanup would run into the next one is refused too. Per equipment, set by admins under Equipment (Cleanup after).
- **Bookings are at least 1 hour** (calendar, batch scheduler, resizing; an older shorter booking becomes an hour when moved).
- **Comparisons**:
  - Box plots of the parameters you choose, now including R<sub>S</sub> and R<sub>SH</sub> (log axis); the choice is saved with the comparison. Each plot has its own PNG and SVG.
  - Export the box plots all in one image or each plot as its own file, and the J–V curves all in one plot or one file per group.
  - The slide shows the parameters table (devices, pixels, median of each chosen parameter, change against the reference) instead of the median PCE list.
  - Design pass: analysis controls (direction, absolute or relative) on top and figure options with the box plots; headed sections (Box plots, Parameters, Best J–V of each group, What changed); groups show their devices behind a disclosure, "Set as reference" appears on hover; Make a copy and Move to the trash in a ⋯ menu; a new comparison opens with its name selected; box-plot glyphs in the group colours on the list cards; in relative mode a group without a reference in its measurements says so.
- Slides: no blue bar at the top (all exported slides).

## 0.30.0 (2026-11-06)

- **Comparisons** (sidebar › Measurements): groups of devices from any measurements side by side, private until you share them. Pick devices from a list of every measurement (filter by text, measurement, person, dates); group them by name (`batch_mod`: one group per modification, "Padrão"/"ref"/"control" as the reference) with likely typos flagged, or put them in a group yourself. Box plots, the J–V curve of each group's best pixel, a table with medians and the change against the reference, values **relative to the reference of the same measurement**, and **what changed** between the groups' batches (recipes per layer, from the batch snapshots). Export a 16:9 slide, the figures (PNG, SVG) or an Excel file.
- **Check sweeps**: the quick exploratory scan before the real measurement (8-pixel system: 0.05 V, forward only, then 0.02 V with both directions) is recognised from its voltage step and directions, shown greyed with a "check sweep" label and never counted: not as best pixel, best device, record, in the statistics, the Overview or comparisons. Include it by hand in the pixel's table if needed. Existing measurements are checked when the update starts.
- **Best scan, not latest**: when a pixel was measured more than once, the pixel map, the box plots and the statistics use its best scan (highest PCE) in each direction.
- **Show outliers** (box plots): untick it when one far-off value squeezes the boxes. The axis then fits the boxes and whiskers; points beyond it become an arrow at the edge with their number (still counted; exported figures keep the arrows). Remembered, and used in the batch report, comparisons and the presentation export too.
- Import preview: check sweeps counted apart and left out of the best PCE.
- The repository is public: the update settings no longer ask for a token (only needed if it is made private again); documents updated.
- Activity log: J–V measurements and comparisons now have readable labels.

## 0.29.0 (2026-11-06)

- **Fix: the in-app update now installs on Windows.** Since 0.26 the app opened the update window in a form Windows silently ignores, so Install now did nothing. The whole in-app update (start script, download, checksum, install, restart, data kept) now runs on real Windows and Linux machines in CI for every change to the update path (`tools/update-e2e.mjs`). **One manual step is still needed to get this fix**: close the app window and double-click `update.bat`; it finds the downloaded zip in the `updates` folder. From then on Install now works.
- **Update log**: every step of an update is written to `updates/update.log` and shown under Admin settings › Updates (What the last update did).
- **Live updates**: pages show changes made by others without reloading (bookings, batches, recipes, measurements, comments, inventory, users, the Overview). A tab in the background catches up when it becomes visible again.
- **Calendar redesign**: blocks filled with their equipment's colour and white text; the experiment first, then who (you for your own) and the equipment by its short name, then the time; ✓ for concluded, ? for waiting, stripes for canceled or postponed. Hours outside the lab day are shaded, empty weekends narrow; month entries show start time and short equipment names; a tidier toolbar on phones.

## 0.28.0 (2026-11-05)

- **Calendar blocks always carry equipment, user, experiment and time**: tall blocks one per line, one-hour blocks on two lines (equipment and time; user and experiment), short ones on one line.
- **Hover card**: when a block is too small or narrow to show everything, hovering it opens a card with the equipment, experiment, who booked it, date, time and duration, note and outcome.
- **Resize by the edges**: drag the top or bottom edge of your own booking to change its start or end (15-minute steps, no overlaps; Esc cancels). The block fades under the preview while it is moved or resized.

## 0.27.0 (2026-11-05)

- **Name and save**: when a new preset has no name yet, the save button reads "Name and save" and asks for the name in a small box (Enter saves, Esc closes it), instead of refusing to save.
- **Export for a presentation** (Overview › Summary): a 16:9 slide with efficiency over time, the J–V curve of the period's best cell and the box plots (Jsc, FF, Voc, PCE) of that cell's batch, with a preview. Download the full slide or each figure on its own (PNG or SVG) to build a custom slide; the highlights slide is there too.
- **Side menu** grouped as the work goes: Fabrication (stacks, batches, calendar), Measurements, Recipes, Designs, and Lab (inventory) at the bottom. The phone tabs use the same names (Fabrication, Measurements, Recipes).
- Code: the slide pieces moved out of the Overview into `views/overview/slides.tsx`; the box-plot helpers shared by the batch report and the slide are in `iv/boxes.ts`.

## 0.26.0 (2026-11-04)

Security and data safety, and updates from GitHub.

- **Updates from GitHub.** The app checks the repository's releases once a day and notifies admins. Admin settings › Updates downloads the new version (checked against its SHA-256) and installs it: database backup, program files replaced (never the data), restart, page reloads by itself. The repository is private: the app uses a read-only token kept in `config/update.json` on the lab computer only.
- **Activity log** (Admin settings › Activity log): every change, sign-in, failed sign-in and refused request, with who, when and from which address; search, filter by person, CSV export. The content of changes is never stored. Entries form a hash chain, so an entry edited or removed in the database is detected. Kept two years.
- **Security checklist** (Admin settings › Security): encrypted connection, recent checked backup, encrypted second copy, intact activity log, number of admins, temporary passwords, accounts unused for 90 days; each with what to do.
- **Backups**: every backup is opened and checked after it is made. The second copy off the computer is encrypted (AES-256-GCM) by default and read back to check it; the key is in `config/backup.key` and admins can show it to save it. `node db-tools.cjs decrypt` turns an encrypted copy back into a backup.
- **HTTPS**: `TLS_CERT` / `TLS_KEY` for HTTPS in the app, or `TRUST_PROXY=1` behind the university's web server; secure cookies and HSTS when the connection is HTTPS.
- **Browser protections**: strict Content-Security-Policy (only the app's own scripts, no framing), no MIME sniffing, no referrer, no camera/microphone/location; API answers never cached.
- **Requests from other websites refused** (Origin check on every change).
- **Sessions stored as hashes**, so a copy of the database or a backup cannot be used to sign in. Everyone signs in once more after this update.
- **Passwords**: at least 10 characters for new passwords, well-known passwords and passwords containing the username refused. Sign-in paused after 5 failures per username or 30 per address in 10 minutes; unknown usernames take as long as wrong passwords.
- Libraries updated; no known vulnerabilities (`npm audit`).
- Server security checks (`npm run test:server`, 38 checks) run with `npm run check` and on every push.
- Admin settings in tabs: Users, Backups, Security, Activity log, Updates, Figures.
- Documents: `docs/security-and-data.md` (for IT and the group), `SECURITY.md`.

## 0.25.0 (2026-11-04)

- Overview redesigned: Summary (one sentence, record, best/typical cell, batches, setbacks only when there are any, efficiency chart from the first period with data, active people as cards, details folded), People as cards, Equipment simpler; one "Export slide" menu.
- Metal evaporation run data: power and pressure reached at each rate, sensor life (T.V = XX.X %), base pressure; pressures as value × 10^exponent.
- 0.24.1: the recipe editors' output pane was styled as a round badge (class clash); fixed.

## 0.19.0 – 0.24.0 (2026-11-03 – 04)

Overview for the Professor and Managers; J–V comparison and stability tests; equipment calendar with batch scheduling and outcomes; inventory with storage and consumption; tags (Professor, Manager, Inventory), profiles and private comments; Rs/Rsh box plots and figure export with the group logo. Details in the project notes.
