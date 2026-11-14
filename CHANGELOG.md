# Changelog

Each section becomes the notes of its GitHub release (the release workflow takes the section whose heading starts with the version).

## 0.48.0 (2026-11-14)

- **PANOPTICA Setup for macOS**: each release also carries `PANOPTICA-Setup-<version>.dmg`, for Macs with Apple silicon or Intel (macOS 12 or later). It works like the Windows wizard: the lab's product key, what it covers, whether the lab network may open PANOPTICA, then an administrator's password; it downloads only the key's package, checks PANOPTICA's signature, and installs PANOPTICA in `/Library/PANOPTICA` as a service that starts with the Mac (and again if it stops by itself), with Node allowed through the firewall when the lab network may open it. Only the system can read what PANOPTICA writes (the database, backups). Running Setup again upgrades in place and keeps the data; **Uninstall PANOPTICA** in `/Library/PANOPTICA` removes the service and keeps the data.
- Updates installed from Admin settings › Updates start PANOPTICA again through its service on a Mac too.
- The Mac wizard is not signed with an Apple Developer ID yet: the first time, macOS refuses to open it until **Open Anyway** in System Settings › Privacy & Security.

## 0.47.0 (2026-11-14)

- **PANOPTICA Setup with a product key**: one Windows installer for every lab. It asks for the lab's product key, shows what the key covers (the lab, its modules, the last day of updates, how many computers may use it), downloads only the package for those modules, checks PANOPTICA's signature and installs PANOPTICA as a task that starts with the computer, with a firewall rule when the lab network may open it. The finish page opens PANOPTICA; the product key also opens the first setup from any computer. Running it again upgrades in place and keeps the data (the database is backed up first); uninstalling removes the task and the firewall rule and keeps the data.
- **Updates with the key**: Admin settings › Updates fetches releases from PANOPTICA with the lab's product key: only the package its modules need, only versions its licence covers, and no GitHub token on the lab's computer. Each check also brings the key's current licence (a renewal, a module added); Admin settings › Licence has **Check my licence**. An update the app installs restarts PANOPTICA through its task. Installs without a key keep updating from GitHub.
- **Each key has its own number of computers**: a second computer is refused once the key's computers are in use; PANOPTICA can move a key to a replaced computer.
- **For PANOPTICA's staff** (not in the lab's package): the activation service (`services/activation`, plain Node, host to be chosen) keeps keys only as their SHA-256, the signed licences, the computers and the releases; `tools/builder/keys.mjs` makes keys (signing each licence on the staff computer), renews, lists, moves and publishes releases to it.

## 0.46.0 (2026-11-13)

- **Licence**: PANOPTICA gives each lab a licence file it signs: the lab's name and id, the modules it bought, and the last day of updates. Only the modules it lists start; releases published after its last day are shown but not installed. Nothing else stops: after that day the app keeps working and every record can still be exported. A licence that was changed, signed by anyone else, made for another lab, or older than the one installed is refused. It is kept in the database, so a backup restored on another computer keeps it. **Admin settings › Licence** shows it and installs a new one; a `licence.json` left next to the app is installed at the first start. Without a licence, everything works as before.
- **One-time setup code**: an install made by PANOPTICA comes with a setup code on its install sheet. With it, the first admin and the lab can be set up from any computer on the lab network, not only on the server itself. The code works once and is kept only as a hash; wrong codes count like failed sign-ins.
- **A package per combination of modules**: each release carries `panoptica-<modules>.zip` for each set of modules a lab can have (now `panoptica-devices.zip`), each signed and with its SHA-256, plus `panoptica.zip` with every module for labs on older versions. The app downloads the package for the modules its licence lists.
- **Builder** (PANOPTICA staff only, not in the package): `tools/builder/builder.mjs` makes a lab's signed licence, its setup code and the install sheet for the crew, and copies (or builds and signs) the package for its modules. Renewals and added modules reuse the lab's id.

## 0.45.1 (2026-11-13)

- **Run data set the amounts taken from the inventory**: where a batch's run data give what was really weighed or dispensed (a salt weighed, a solvent volume added, an additive, a dispense volume, the substrates coated), that amount is taken from the container instead of the planned one; elsewhere the recipe's amount still counts. Entering, changing or deleting run data takes the new amounts again, from the same containers and under the same date. With several entries for one recipe, the latest value of each field counts.
- The batch page's **From the inventory** marks amounts **From run data** or **Partly from run data**; Consumption uses the same amounts.

## 0.45.0 (2026-11-13)

- **No batch codes**: a batch is known by its name everywhere (batch list, batch page, calendar, outcomes, search, notifications, Overview, J–V links, run sheets, report, spreadsheet, data package, trash). Two batches cannot share a name; the batch page's title is its name and renames it. Run data choose their batch from a list of names instead of a typed code. Older batches without a name take their old code as their name, and repeated names get " (2)", " (3)".
- **Batches take their amounts from the containers**: when a batch starts running, the amounts its recipes plan (solutions as prepared, solvents dispensed in spin programs) are taken from the containers it was started with, so their amount left goes down. If that container is empty by then, the substance's container used in recipes gives instead. Moving the batch to the trash, or back to Planned, puts the amounts back; restoring it takes them again.
- The batch page shows **From the inventory**: while Planned, what it will take and from which container; once running, what it took, and what it could not (no container in stock, or mass to volume without a density).
- Each container lists **Taken by**: the batches that took from it, when, and how much.
- Batches started before 0.45 take nothing, so the amounts people typed for their containers stay as they are. Consumption is unchanged.

## 0.44.0 (2026-11-13)

- **Substances come from the containers**: the separate chemical list is gone. Adding or importing the first container of something makes its substance; the Inventory's **Substances** tab lists them with their CAS number, formula, molar mass (worked out from the formula when it can be), density, melting and boiling points, refractive index, hazard pictograms and roles. Several roles per substance are fine (a salt that is also an additive), and they still filter the lists in recipes and the inventory.
- **Several containers of one substance**: another purity, lot or supplier is a second container of the same substance, found by CAS number, else by name. One is ticked **Used in recipes** (usually the bottle in the glovebox); with none ticked, recipes take the newest. Purity, supplier and lot belong to each container.
- **The solution maker shows which container each mass is for**, and its purity sets the mass. With more than one in stock, people with the Inventory tag switch it right there. A salt with no container says **Not in stock** (the mass assumes 100 % purity); one the lab does not have says **Not in the inventory** and gives no mass instead of 0 mg. A batch keeps the container its recipes used, ready for 0.45.
- **The OpenEnventory import works**: it skips the title line before the table, takes the name in English from the list of names, reads "45 g / 100 g" as 45 g left of a 100 g bottle, CAS number, formula, molar mass, density, melting and boiling points, refractive index, lot, purity, barcode, opened and expiry dates and hazard codes, and ticks **Controlled by the Federal Police** or **by the Army** from the comments. Before saving it shows each substance (name to shorten, roles to tick, and whether the lab has it already) and each place with the storage place and division it goes to ("Cabinet 2 - 07" becomes storage place Cabinet 2, division 07).
- **Controlled substances** are two checkboxes (Federal Police, Army) and a filter, in place of free text.
- **Spin coating dispenses**: choose **Solution** or **Solvent** first, then one from that list only; solutions and solvents no longer share one list.
- Containers have a barcode, and search finds containers by barcode and substances by CAS number.
- An older lab's chemical list becomes its substances: those with containers or used by a recipe stay (with their formula, molar mass and density), the purity and supplier of a chemical move to its containers that had none, and the starter entries nothing used are removed. Consumption is unchanged (checked batch by batch on an older lab database).

## 0.43.0 (2026-11-12)

- **Electronic Devices is its own module** (`modules/devices`): its screens, its server routes, its calculations and its database changes moved out of the core. The core runs without it: the side menu is then Overview, Calendar, Inventory and Equipment, and none of the module's tables, routes, chemicals or screens exist.
- **The core is tested alone before every release**: the server checks, a package built with no module and the browser flows that exist without it. A lab that starts with the core and adds Electronic Devices later ends up with the same database as one that had it from the start (checked).
- The module plugs into the core through the registry: its tray to schedule a batch in the Calendar, the run data asked after a step is concluded, the data package window, the steps a booking for a batch can be for, the "Open batch" link in a booking, the activity-log names of its actions, live updates and backup checks.
- The release package can be built with chosen modules (`tools/package.mjs --modules`), the base for the per-lab packages of 0.44.
- Security: the checks and releases now audit every dependency, including the build and test tools; the lint tools' minimatch advisory (moderate) was fixed on 12/11/2026.
- Nothing changes for people using the app: on an older lab database every Overview, search, trash, comment and calendar answer is the same as in 0.42, and a new database is identical.

## 0.42.0 (2026-11-12)

- **Comments, the trash, search and sharing work through record types the modules register**, not a fixed list of stacks, batches, measurements and comparisons. The trash now names each item's type from its module. One sharing rule is used everywhere: the owner, anyone when it is shared, admins and the Professor.
- **Consumption is reported by the modules**: Electronic Devices reports the planned amounts from each running and done batch, and the Inventory only adds them up. The solution and spin-coating calculations moved into the shared core package, so the recipe screens and the report use the same one. The amounts are unchanged (checked batch by batch on an older lab database).
- **The side menu and the Overview are built from the modules**: the core has the Overview, the Calendar and Lab; Electronic Devices adds its groups and its part of the Overview (batches, cells, the efficiency trend, best cells). The Overview's numbers are unchanged (checked on an older lab database for weeks and months, the lab, one person and a supervisor's students).
- The test module now also has a record type, reports consumption and has an Overview part, all checked before every release. The browser tests add the side menu, search, the Overview, the trash and consumption.
- Small wording changes: the search box says "Search, or go to a page…", an empty trash says "Deleted items appear here until they are removed for good", a quiet period in the Overview says "No activity this week", and a chemical's consumption lists what it was "Used for". A person's page in the Overview no longer lists postponed or canceled steps of deleted batches (the week and month view already left them out).

## 0.41.0 (2026-11-11)

- **Bookings are for a subject a module defines**, not for a batch: the calendar no longer reads batches itself. Who owns a batch, whether it can be booked for, whether it is locked, whether an outcome is asked and what happens after it (Running, Done) now come from the Electronic Devices module. Existing bookings carry over unchanged (checked booking by booking on an older lab database).
- **The steps equipment can do come from the modules**: the Equipment page and the checks use the list the modules give, not a fixed one.
- **A test module** with its own thing to book equipment for, its own steps and its own database change is checked next to Electronic Devices before every release, so the core cannot quietly depend on batches or photovoltaics again.
- Nothing changes for people using the app.

## 0.40.0 (2026-11-11)

- **Database changes in order**: every change to the database is now one numbered entry in a single list, run once in order and recorded in the database, instead of checks spread over the program. Each entry says whether it belongs to the core or to the Electronic Devices module, which the module split will follow. Databases from every earlier version come out the same as before (checked column by column against 0.39.1, on an old lab database and on a new one).
- **Browser tests**: the main flows are clicked through in a real browser before each release: first setup, signing out and in, adding equipment, a booking, a stack's and a batch's run sheet (that the sheet, not the page, is printed, also in the way Safari prints), starting a batch by name, and a J–V import.
- Nothing changes for people using the app.

## 0.39.1 (2026-11-11)

- Fix: in the first setup, the **sign-in screen preview** was squeezed, down to nothing on a short window, once the page had more than fit the window. The page now scrolls and the preview keeps its shape. Its text also showed small, grey and cut off, from a style meant for another part of the app.
- The **institution logo** on the sign-in screen is larger (56 px high, was 36).
- Long lab and institution names wrap on the sign-in screen and in the setup, and no longer run under the page title in the top bar.

## 0.39.0 (2026-11-11)

- **Built packages**: a release is now the app already built, with no source code. Installing or updating downloads and builds nothing on the lab's computer (only Node.js is needed), so it starts in seconds and works without internet once the package is there. The first start after this update clears the source files and libraries the earlier versions left behind.
- **Signed releases**: every release carries PANOPTICA's signature. The app and the update scripts install a package only when the signature is PANOPTICA's; an unsigned package, or one signed by anyone else, is refused. To update by hand, keep `panoptica.zip.sig` next to `panoptica.zip`.
- When the update script refuses a package, the app starts again on the version it had. Under the Linux background service, the script's steps now reach the update log.

## 0.38.1 (2026-11-10)

- Fix: **Print run sheet** printed the page instead of the run sheet in browsers whose print dialog does not hold the page (Safari). The sheet now stays ready to print until you are back in the app.

## 0.38.0 (2026-11-10)

- **Equipment** (side menu, under Lab): the lab's places and its equipment, with equipment that holds other equipment (a glovebox with a spin coater and a hotplate inside). Each equipment says what it can do (the recipe steps), whether it is booked (equipment inside another is booked with it), its shortest booking, cleanup and drawing, and whether it records its atmosphere. **Move** keeps a history of where it was. **Responsible people** train others, edit, move and set it out of service.
- **Training**: booking equipment needs training on it (admins are exempt; people who had booked equipment before count as trained). The person's details list their training.
- **Out of service**: periods when equipment cannot be booked, hatched in the calendar; people with bookings then are told.
- **Atmosphere**: concluding a step in equipment that records its atmosphere asks for O₂ and H₂O in ppm.
- **Scheduler by steps**: each block goes to equipment that can do its steps, chosen per block among those you are trained on. **Anneal elsewhere** moves a spin-coating run's annealing to a block of its own.
- **Tags give permissions**: Private comments, Lab overview, Inventory management, Equipment management, Equipment training. Tags are a list; a tag opens in a window with what it gives and who has it. A person opens in a window with their details and equipment training.
- **Overview for everyone**: your own work; your students' (as supervisor or co-supervisor); with Lab overview, the lab and anyone.
- **Print run sheet** sits left of **Start batch** on a stack and left of **Schedule equipment** on a batch, with the same name on both. The notes boxes are gone.
- **Start batch** asks only for a name; the app numbers the batch by date (B-yymmdd-n).
- **A clean install has no lab content**: no equipment, substrate designs or tags are created, recipes and designs start empty (no spin program, composition, solvents, materials or cleaning steps), the spiro-OMeTAD template is gone, and placeholders, examples and documents name no lab or institution. J–V systems are named by their export format (multi-pixel CSV, per-curve TXT). The data package asks for the funding agency and grant number. The common-chemicals list stays, for the solution calculator.
- The tests use synthetic J–V files made by the tests; no measured data is kept in the repository.

## 0.37.1 (2026-11-10)

- **Logo only**: slides no longer write the lab name next to the logo (plots already did not).
- **Plots and tables abbreviate again** (fwd/bwd, SD, IQR, Q1/Q3, Min/Max); the rest of the interface keeps full words.
- **Photos**: asking for access starts with the photo, a circle you click to add or change, with Remove; it is optional there. Choosing the first password asks only for the birth date (the email for accounts without one) and needs a photo: the one sent with the request shows and can be kept or changed. First setup uses the same circle. Fix: after **Remove photo** the profile and every list showed an empty frame instead of the initials; removed photos are repaired on start.
- **No bookings in the past**: new bookings, dropped scheduler blocks, moves and resized edges must start from now on (the server refuses them too); a booking that has begun keeps its start. Fix: a block dropped in the past could be answered at once and close the batch as Done with blocks still unplaced; a batch now waits until every block of its plan is booked and answered. The red line for now has no dots.
- **Box plots**: a group not linked to a batch or stack is named by its sample alone (no "(not linked)").
- **Stacks**: **Start batch** is a button under the 3D view and opens a window for the batch code and name (the header keeps Print run sheet).
- **Solutions**: additives come right after the composition, before the preparation of the precursor solution. Advice about the chemistry (2D phase stability, halide degradation) removed; the checks that fractions add up stay.
- **Measurements**: the side menu has **J–V curves** and **Lifetime** (each import lands in its list), then Comparisons. Stability tests removed (lifetime runs replace them).
- **3D view**: layers rest on the ITO instead of sharing its bottom plane, so seen from below there is no flicker; the view settings and the actions (Flip, Reset view, Export PNG) sit on two fixed rows, so nothing moves when the legend is switched.
- First setup: the sign-in preview no longer spills over the fields under it (Safari).

## 0.37.0 (2026-11-09)

- **Plots carry the lab logo only**, never the lab name: J–V figures, comparisons, lifetime and stability plots, box plots, the pixel map. The option is now called **Lab logo**.
- **Shorted pixels**: a pixel that shorts in one direction and works in the other is a shorted pixel; neither scan counts in best values, statistics, comparisons or records. Existing measurements are checked once on start. The import preview counts the same way.
- **Pixel map, both directions**: backward / forward PCE on one line under the pixel number ("22.9 / 23.0"), sized to fit; a pixel dead or shorted both ways shows the word once.
- **Bookings outside batches**: choose **No batch** and say what the booking is for. **J–V measurement** is a new procedure for equipment (the solar simulator, set by its name once): it takes a finished (Done) batch, locked ones included, or no batch with the reason. Such bookings ask no outcome and do not count in a batch's progress.
- **Full words**: Substrate preparation, Organic evaporation, Metal evaporation, Evaporated perovskite in the side menu, recipes and stacks; layer methods written out (Spin coating, Organic evaporation…); forward and backward instead of fwd and bwd; standard deviation, interquartile range, minimum and maximum; "for example" instead of e.g.; day and month names in full (chart axes use dd/mm and mm/yyyy).
- Colour pickers are circles everywhere. Dialogs keep their rounded corners when they scroll (slim scrollbar inside the corners instead of the square Windows one).

## 0.36.2 (2026-11-09)

- Box plots carry the lab logo only, without the lab name, on screen, in exports, the batch report, comparisons and slides. With no logo set, box plots have none.

## 0.36.1 (2026-11-09)

- **Sign-in screen**: the lab logo can sit in any corner, in the middle of an edge or in the centre of the picture, with or without its white background. The institution can have a logo too: the foot of the panel shows its name, its logo, or both. All in Lab setup and the first setup, with the preview.
- The photo placeholder on the request form is a circle again (a shared style made it an oval).
- Lab setup: no separate "Name on exported figures"; figures use the lab's name.
- **3D view**: the ITO is a thin coloured film on the glass, so the first layer on it is a flat slab, without the step cut out over the ITO.
- **Comparison slide**: the logo and the lab's name sit top right; the table goes to the bottom, so the box plots and the J–V curve are larger. The note about check sweeps is gone from the slide.
- **Box plots**: the logo sits in the same place on every plot of a set (each plot exported on its own, or the combined figure) whenever one place is free on all of them.
- **Dark mode**: chart colours are brighter than in light mode instead of darker; equipment, tag and group colours are lightened for lines, dots and text, booking blocks are less dark; status colours (Done, Concluded, Postponed) follow the theme.
- Releases carry only panoptica.zip (the repository is private again; updates need the read-only token in Admin settings › Updates).

## 0.36.0 (2026-11-09)

Perovskite Lab is now **PANOPTICA**, shown as PANOPTICA · lab name everywhere. A new install sets itself up; people ask for access.

- **First setup**: a new install opens setup screens on the computer that runs PANOPTICA (other computers say it is not set up yet), instead of printing an admin password in the window: your admin account, the lab (name, institution, the email domains that may ask for access, departments), the sign-in screen (the lab's picture and logo, with a preview) and the working days and hours. Then you land in the app. **Admin settings › Lab setup** changes all of it later.
- **New sign-in screen**: the lab's picture on the left (a drawing of a panopticon until there is one) with the logo in its corner; PANOPTICA · lab name and the sign-in on the right. Typing a username and continuing without a password says what that account needs: its password, a password to choose, a request waiting, a declined request with the reason, or an ended visit.
- **Request access**: name (the username is every first name plus the first letter of a chosen surname, lower case, no accents; when taken, the next letter of the surname, never numbers), institutional email (the lab's domains), birth date, department, supervisor and co-supervisor, photo. Admins are notified and **Accept** (with tags) or **Decline** (with a reason) under **Admin settings › Access requests**. No email is sent: after acceptance the person types the username, leaves the password empty, confirms email and birth date, and chooses a password. **Reset password** works the same way (no more temporary passwords).
- **Visitors**: the only accounts admins create, with the last day of the visit, after which they cannot sign in.
- **Passwords**: at least 8 characters with an upper case letter, a number and a special character, shown as a checklist while typing. Letters of any alphabet count (Ã, Ç, Æ are upper case letters; ã is a letter, not a special character), and an accented letter typed either way (one character, or a letter plus an accent) is the same password. Existing passwords keep working.
- **About you** in the profile: institutional email, birth date, department, supervisor, co-supervisor; accounts from before ask for the missing ones once per session. Admins see them under Users (with age) and can change them (**Details**).
- **Working days and hours** (weekends can be working days): the calendar stripes the hours outside them in red, days off are narrow, **New booking** starts at the next working hour, and the Overview's busy share uses them. Booking outside them is allowed: the booking form says so, and the admins are notified.
- **Birthdays** (day and month) in the calendar's week, day and month views; anyone can hide theirs.
- Releases carry **panoptica.zip** (and perovskite-lab.zip, so installs from before update as usual); the update scripts take either.

## 0.35.1 (2026-11-09)

- **Scheduling substrate preparation**: a recipe with a surface treatment gives two blocks, cleaning (sonication, N<sub>2</sub> dry) on the substrate cleaner and UV-ozone or plasma on the equipment named for it, both set for Substrate preparation. Its run data is asked once, after the surface treatment.
- **Block lengths follow the recipe**: substrate cleaning takes its sonication and drying times, surface treatment its own (rounded up to 5 min, at least 1 hour), instead of a fixed hour. Tray blocks grow to show their text and length.
- **Run sheet**: print with or without a notes box under each layer; the notes box is taller (about five lines); text a size larger; solution preparation in plain text with its values in bold; a long layer continues on the next page instead of leaving half a page blank, without splitting a table, list or notes box.
- Substrate prep: sonication and surface treatment steps one per line, numbered, in the key facts (as on the printed sheet).
- Equipment named "… cleaner", "ultrasonic" or "bath" gets the ultrasonic bath drawing unless one is chosen.

## 0.35.0 (2026-11-07)

- **Lifetime runs** of multi-pixel CSV systems (Ossila lifetime test): import the run's folder or .zip like any measurement. The app picks the copy of the run whose files match (an aborted attempt leaves header-only files), shows the run before saving and asks for the sample and substrate, which the files do not name. The first reading counts in the statistics; the later ones are the ageing and stay out of them. The **Lifetime** tab plots PCE, Voc, Jsc, FF, Rs or Rsh of every pixel against time (backward, forward or both), normalised or absolute, with T90 and T80; a table with first and latest values, ratio, T90 and T80; one pixel's J–V curves over the run from light to dark; PNG, SVG and a CSV of every reading with the instrument software's PCE alongside. Light and temperature readings are kept when those sensors were connected. A run that stopped before its planned length says so.
- Readings whose J–V curve crosses zero twice are drawn hollow and left out of T90, T80 and the latest value, with a note on why the instrument software's value differs. Points with a current of exactly 0 (readings the instrument missed) are left out on import.
- Data package: J–V curves of lifetime runs carry their time (`time_s`).

## 0.34.1 (2026-11-06)

- **Toggles** you can pick several of (parameters to plot, ions, solution type, tags): plain text without a grey track, a light highlight on hover, filled in the accent colour with white text when picked.
- **Comparisons**: the colour bar under a group's name is as wide as the name (groups and What changed), as in the calendar.
- **3D views fit the window**: the stack's page, the stack editor and the batch page size the view to the screen, so nothing needs scrolling and the batch's Schedule button stays in view.
- **Batch layers** listed in the order they are made: substrate first.
- Fix: the stack editor's Review list had its rows out of line (the drag handle took the number's column).

## 0.34.0 (2026-11-06)

Sharing, and the major library updates.

- **A link to everything**: every page and item has its own address (`#/batches/12`, `#/iv/5`, `#/cmp/3`, `#/s1/7`, `#/chem/9`). **Copy link** in the header of batches, measurements, comparisons, recipes, designs and containers; Back and Forward move between what was opened; a link opens the item after signing in. Copying works on plain-HTTP lab addresses too.
- **Data package** for a data repository (data management plans): choose batches, measurements and comparisons (with what they are linked to), describe them (title, description, authors, affiliation, grant, licence, keywords) and download one .zip with a README (what, who, when, folder layout, units, methods), metadata.json with the fields of a Dataverse deposit, CSV and JSON for every item, one CSV per J–V curve, and SHA-256 checksums of every file. Made in the browser; nothing leaves the computer. From a batch's or comparison's **Export**, a measurement's header, or the Batches and Electric measurements lists.
- **Equipment drawings**: line drawings of the equipment (balance, spin coater, small and thermal evaporator, UV-ozone cleaner, hotplate, glovebox, solar simulator, profilometer, ultrasonic bath, other), the working part in the equipment's colour, in the Day view's columns, the booking form, the hover card and the Overview's equipment use (the dot there is gone). Chosen from use and name; admins pick another under Equipment.
- Batch page: **Export** menu (report PDF, spreadsheet, data package) instead of separate buttons.
- Fixes: a measurement day was shown as the day before in some lists (dates without a time are now that calendar day); file names from .zip archives without the UTF-8 flag (accented names shown garbled) are read as UTF-8 on import.
- **Library updates**, each tested on its own before joining: React 19, Vite 8 (with @vitejs/plugin-react 6; builds in under a second), TypeScript 6.0, three.js 0.187, emoji-picker-element 1.29, GitHub actions checkout and setup-node v7. TypeScript 7 waits until typescript-eslint supports it.

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

- **Glovebox cleanup**: each booking of glovebox equipment is followed by 20 minutes of cleanup, shown hatched in the calendar. The equipment stays taken, so nobody can start right after someone else; a booking whose own cleanup would run into the next one is refused too. Per equipment, set by admins under Equipment (Cleanup after).
- **Bookings are at least 1 hour** (calendar, batch scheduler, resizing; an older shorter booking becomes an hour when moved).
- **Comparisons**:
  - Box plots of the parameters you choose, now including R<sub>S</sub> and R<sub>SH</sub> (log axis); the choice is saved with the comparison. Each plot has its own PNG and SVG.
  - Export the box plots all in one image or each plot as its own file, and the J–V curves all in one plot or one file per group.
  - The slide shows the parameters table (devices, pixels, median of each chosen parameter, change against the reference) instead of the median PCE list.
  - Design pass: analysis controls (direction, absolute or relative) on top and figure options with the box plots; headed sections (Box plots, Parameters, Best J–V of each group, What changed); groups show their devices behind a disclosure, "Set as reference" appears on hover; Make a copy and Move to the trash in a ⋯ menu; a new comparison opens with its name selected; box-plot glyphs in the group colours on the list cards; in relative mode a group without a reference in its measurements says so.
- Slides: no blue bar at the top (all exported slides).

## 0.30.0 (2026-11-06)

- **Comparisons** (sidebar › Measurements): groups of devices from any measurements side by side, private until you share them. Pick devices from a list of every measurement (filter by text, measurement, person, dates); group them by name (`batch_mod`: one group per modification, "Padrão"/"ref"/"control" as the reference) with likely typos flagged, or put them in a group yourself. Box plots, the J–V curve of each group's best pixel, a table with medians and the change against the reference, values **relative to the reference of the same measurement**, and **what changed** between the groups' batches (recipes per layer, from the batch snapshots). Export a 16:9 slide, the figures (PNG, SVG) or an Excel file.
- **Check sweeps**: the quick exploratory scan before the real measurement (for example 0.05 V, forward only, then 0.02 V with both directions) is recognised from its voltage step and directions, shown greyed with a "check sweep" label and never counted: not as best pixel, best device, record, in the statistics, the Overview or comparisons. Include it by hand in the pixel's table if needed. Existing measurements are checked when the update starts.
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
