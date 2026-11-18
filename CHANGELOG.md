# Changelog

Each section becomes the notes of its GitHub release (the release workflow takes the section whose heading starts with the version).

## 0.59.0 (2026-11-18)

- **Lab screen**: PANOPTICA on a TV in the lab. An admin turns it on in Admin settings › Lab screen and sets its password; the sign-in screen then offers "Open the lab screen", and the TV stays on it after reloads and power cuts. Names show on it without anyone signing in. A new password, or turning it off, signs every screen out.
- **The time and date** sit at the top middle of the screen, on every page.
- **First page**: each piece of equipment with its state: in use (who, and until when), free (the next booking) or out of service. Beside it, the week's bookings on the lab's working days and hours, each with the name of who booked.
- **Second page**: the best device of the week (the highest PCE measured since Monday, from shared measurements), with Voc, Jsc, FF, the person, the batch and its J–V curve; this month's birthdays; and the O₂ and H₂O of each glovebox over the last 7 days, as typed when its bookings were answered. Above a limit set in Admin settings, the line turns red.
- **Admin settings › Lab screen**: how long each page shows (20 seconds by default), the theme (System, Light or Dark; Light by default), the O₂ and H₂O limits of each glovebox, and how many screens have it open.

## 0.58.0 (2026-11-18)

- **Cleaning role**: substances can have the Cleaning role, beside solvent, salt and the others. Acetone, IPA, ethanol and water get it from their CAS number, including those already in the inventory.
- **Cleaning solutions**: a Custom solution can be marked as a cleaning solution, such as the lab's own soap solution.
- **Substrate preparation lists what the lab cleans with**: each sonication step is chosen from the substances with the Cleaning role (in stock first), then the cleaning solutions; any other name can still be typed. Surface treatment (N₂ dry, UV-ozone, O₂ plasma) is unchanged. Recipes made before keep their steps, and a step that names a substance in the inventory shows its short name, such as IPA for Isopropanol.
- **Edit designs**: a new permission a tag can give. Admins and people with it make, change and remove substrate designs, metal masks and architectures. Everyone else opens them and uses them in recipes and stacks. Designs belong to the lab: there are no private designs, and those saved as private are now visible to everyone.
- **Architectures, under Designs**: each has a name, a type (p-i-n or n-i-p) and its layers in order, each with its method, reordered by dragging. Picking one when making a stack sets the stack's layers. Every lab starts with p-i-n and n-i-p, which can be changed like any other. Stacks and batches made before are unchanged.
- **J–V figures** state p-i-n or n-i-p from the stack's architecture, whatever the architecture is called.

## 0.57.0 (2026-11-18)

- **B-site in the composition**: Pb, Sn and Ge chips beside the A-site and X-site, with fractions for a mixed B-site, such as FA(Pb<sub>0.5</sub>Sn<sub>0.5</sub>)I<sub>3</sub>. The salts follow (SnI₂, SnBr₂, GeI₂…), each halide shared among the B-site salts by their fractions, and the molarity counts the B-site metals together. Layered perovskites work the same way. Recipes made before keep Pb.
- **A new perovskite solution starts as FAPbI₃**: FA, Pb and I are chosen when it opens.
- **Structures from SMILES**: a substance has a SMILES field (from ChemDraw: Edit › Copy As › SMILES), and its structure is drawn at the top of its page as a skeletal formula, with heteroatoms in colour and double bonds as two lines. Common organic compounds get their SMILES from their CAS number: solvents, the organic cations, tBP, Li-TFSI, Spiro-OMeTAD, BCP and the PACz SAMs. The inventory template has a SMILES column. With no formula yet, the page offers the one the SMILES holds.
- **The SAM's structure in the stack builder**: on a spin-coated layer whose solution is not a perovskite, the solute's structure is drawn under the solution. Run sheets do not show structures.
- **Formulas with subscripts** in recipe outputs, on screen and on printed run sheets: PbI₂, SnO₂, C₆₀, FAPbI₃, N₂. Names that are not formulas, such as 2PACz, MeO-2PACz or PC71BM, stay as written.
- **C60's 3D model** in the organic evaporation recipe shows its double bonds.
- **Long names** of substances wrap in their window on a phone, and its buttons move to a second line, instead of making the window wider than the screen.

## 0.56.0 (2026-11-18)

- **Phone, Schedule › Week**: a third choice beside My bookings and By equipment. Each working day of the lab is a row, with a bar over the working hours and every booking as a block in its equipment's colour, so a busy day shows at a glance. Days the lab is off do not show. Bookings at the same time sit one above the other, and a booking that runs past the working hours is cut at the edge with a point. Use ‹ and › to move by week, or tap the dates to pick one. Tap a day to see its bookings.
- **Phone, Schedule › By equipment** opens on **All equipment**: the day's bookings across the lab, in order of time, each with its equipment and who booked it. Pick one piece of equipment to see only its bookings.
- **Weekdays are abbreviated in the Calendar**: "Wed 18/11/2026" on the phone, and Mon, Tue… over the columns of the full app's Week and Month. The Calendar's title now reads "Wed 18/11/2026" for a day and "16/11–22/11/2026" for a week. Sentences, such as a booking's details, still write the day in full.

## 0.55.4 (2026-11-18)

- **Recipes find substances named in full**: a perovskite's salts are worked out as PbI2, MAI, FAI or CsI, while the inventory may call them "Lead(II) iodide" or "Formamidinium iodide". The recipe now finds the substance by its short name, other names, formula or CAS number, so it no longer says "Not in the inventory" for something in stock, uses that substance's molar mass and purity, and batches take the amounts from its containers. An additive that is the same substance as one of the salts is weighed with it.
- **Additives and solvents on one line**: each row of a solution recipe is the handle, the substance, the amount, the unit and the ✕, side by side. With "µL stock/mL", the stock's concentration goes on a line below.
- **C60's structure is back** in the organic evaporation recipe and on its card, also when the substance is called "Fullerene C60".
- **Phone, Schedule › By equipment**: the day reads as "Wednesday 18/11/2026", with Today or Tomorrow under it, and no longer runs into the › button. Tap it to pick another day. The equipment box takes the full width.
- **Phone, full app**: the profile's "Invite a phone" becomes **Phone layout**, so the way back to the phone layout is one tap away.

## 0.55.3 (2026-11-17)

- **Backward-first measurements are read correctly**: the measurement software names its two sweeps by order ("Pixel 1" first, "Pixel 1 Reverse" second), so with the backward sweep measured first the names were the wrong way round. PANOPTICA now takes each sweep's direction from its voltages: a sweep that falls is backward, one that rises is forward. This applies to every import, lifetime runs included. When the names and the voltages disagree, the import says so once.
- **Measurements imported before** are checked once when updating: any curve stored with its direction the wrong way round is corrected, and the activity log says how many. Forward-first measurements do not change.
- **Backward is now the solid line and forward the dashed one**, in every figure that shows both (J–V figures, J–V comparisons, lifetime figures).
- **Lifetime**: the J–V curves over the run are drawn in the pixel's own colour (light for the first reading, full for the last). The time plot uses plain lines like the J–V figures; small marks show each reading only when there are few, a distorted reading still shows as an open mark, and pointing at a reading still shows its value.
- **New equipment**: the colour picker is a circle again (it was stretched into an oval), and the window shows the equipment's drawing, chosen from its name as you type; click it to pick another.

## 0.55.2 (2026-11-17)

- **Lifetime figures look like the J–V figures**: both the parameter-over-time plot and the J–V curves over the run are 7 × 5, with a closed frame, ticks inside on all four sides, the same grid, fonts and line widths, a title, and the legend inside the frame. The J–V curves over the run use the J–V figure's axes (0–1.2 V by 0.2, 0–30 mA/cm² by 5, longer only when the data go beyond) and draw the backward scan dashed. With both directions, backward is dashed and forward solid in the same colour, as everywhere else.
- **Pick the pixels to plot**: toggles above the time plot, one per pixel with its colour under its name, plus All and None. A run opens with its best pixel (highest first-reading PCE), and your choice is remembered for that run. The table below still lists every pixel, and the CSV keeps every reading. The J–V curves over the run also open on the best pixel.

## 0.55.1 (2026-11-17)

- **The Calendar shows before any equipment is added**: days, weeks and months, birthdays and working hours, as soon as the lab is set up. Until there is equipment, it says so and New booking is turned off; once equipment is added, it gets its own column in the Day view as before. The phone's Schedule and Today say the same.

## 0.55.0 (2026-11-17)

- **A layout made for the phone**: on a screen narrower than a tablet, PANOPTICA opens with a bar at the bottom: **Today**, **Run sheet**, **Inventory** and **Schedule**. Buttons are large enough to use with gloves. Tablets and computers keep the layout they had.
- **Today**: your booking now or next, in large figures, the rest of your day, and your batches with how far each has got.
- **Run sheet**: pick a batch (yours first) and follow its layers in the order of the printed run sheet. The layer to do next is open, with its procedure and **Add run data**. Each layer says whether it is booked, concluded or not scheduled; a step is still concluded by answering its booking.
- **Inventory**: one box finds a substance by short name, name, other name, formula, CAS number or a container's barcode, and shows where each container is and how much is left. Where the browser can read barcodes (Chrome on Android, with HTTPS), the camera button scans one. People who manage the inventory can also correct the amount left and mark a container empty, with Undo.
- **Schedule**: your bookings for the next 14 days, or one equipment's day; **Book equipment** opens the Calendar's own booking form, with the same rules. Tap a booking to change or remove it.
- **Notifications** at the top; the account button has **Open the full app** for everything else, and the full app's menu has **Phone layout** to come back.
- **Add to the home screen**: PANOPTICA has its own name and icon and opens without the browser's bars (Android needs HTTPS for this; iPhone does not).

## 0.54.2 (2026-11-17)

- **Purge the inventory**: Admin settings › **Inventory** (admins only) removes in one go either what was **added in the last 7 days** (containers typed in or imported in that time, and substances first added then that have no older containers) or **everything** (every container and substance, also those in the trash). Storage places and divisions stay. Older items stay even when they were edited, past batches keep what they recorded, and recipes show a removed substance as not in the inventory. The counts are shown before anything is removed.
- **Undo an import**: the same tab lists every import (date, file, who, containers, new substances). **Undo** removes what that import added: its containers, also those edited since (the confirmation says how many), and the substances, storage places and divisions it created that nothing else uses. Imports made before this version are not in the list; use "Added in the last 7 days" for those.
- PANOPTICA backs up the lab before every purge or undo (Backups › "Before purge") and removes nothing if the backup fails. Removed items skip the trash. Each purge and undo is in the activity log with what it removed.

## 0.54.1 (2026-11-17)

- **Short names on run sheets and outputs**: printed run sheets of batches and stacks, the spin coating and evaporation outputs, recipe summaries and details, run data fields ("DMF dispensed", "MACl added"), the batch's "From the inventory" list, variant descriptions and the batch report show substances by their short name when they have one. On screen the full name shows on hover; the batch's Excel export has a Substances sheet with each short name and its full name.
- New batches keep each substance's short name; batches started before take it from the inventory. Recipes and run data are unchanged.

## 0.54.0 (2026-11-17)

- **Pick from a list by typing**: every list that grows with the lab's data is now a text box with a ranked list under it: substances (additives, solvents, salts, materials, metals), containers, storage places and divisions, equipment, batches, recipes, designs, people, measurements and groups. Type part of a name, a short name (DMF), another name, a formula or a CAS number; small typos are forgiven ("dimetilformamida" finds dimethylformamide). Arrow keys and Enter pick, Escape gives up. Long names end in "…" and no longer stretch the box past its card. Short fixed choices (units, Before spin / At remaining time, the switches) stay as they were.
- **Solvent fields list every substance**: solvents first, then the other substances, so a solvent whose role was never set can still be picked. Substances in stock come first.
- **A recipe can still name a substance that is not in the inventory** (borrowed, or still to be bought): type its name and choose **Use "…"**. The output says it is not in the inventory, as before.
- **Short names and other names**: a substance has a short name (MeO-2PACz, CB, DMSO) shown wherever there is one (pickers, recipe outputs, lists of substances and containers, consumption), and other names that search also finds. The full name stays on the substance and on hover.
- **Common compounds fill themselves in**: a container of a common solar cell compound (solvents, lead and caesium salts, MAI, FAI, MACl, transport layers, self-assembled monolayers, metals) gets its short name, other names and usual role from its CAS number: ethanol is a solvent without anyone setting it. Nothing people entered is overwritten. With this update, substances the lab already has get the same from their CAS numbers (roles are only added).
- **Possible duplicates**: when two substances may be the same one entered twice (same CAS number, one's name is the other's short or other name, or the same formula with no CAS numbers that differ), the inventory's editors get a notification. It opens **Possible duplicates**: for each pair, **Keep this one** merges the other into it (its containers move, recipes that name it follow, its names become other names; asked first, since it cannot be undone), or **Not a duplicate**. Nothing is merged by itself. **Merge into…** is also on each substance.
- **Move a substance to the trash**, with its containers. Recipes that name it say it is not in the inventory; past batches keep what they recorded. Restoring it brings its containers back. Renaming a substance now renames it in the recipes that name it.
- **Inventory template**: Inventory › Containers › Import › **Download the template** gives an Excel file with one column per field (substance, short name, other names, CAS number, formula, amount left, size, unit, purity, supplier, lot, storage place, division, barcode, opened, expires, Federal Police, Army, notes), an example row and a sheet saying what goes in each column. The import reads it as it is, including dates typed in Excel; the example row is left out if it was not deleted. The review before saving stays.

## 0.53.0 (2026-11-16)

- **Restore the lab from a backup on a new computer**: the first setup has **Restore from a backup**, for moving the lab to another computer or replacing one that failed. Choose a backup file, or a folder of backups (such as the second copy on the network drive) and pick one by date. An encrypted copy needs the recovery file or the backup key. Accounts, data, settings and licence come back; everyone signs in as before. From another computer it needs the setup code on the install sheet, like the first setup.
- A backup that is damaged, from a newer PANOPTICA, of another lab, or opened with the wrong key is refused, and the new install stays as it was.
- **Recovery file**: a small file with the backup key and the lab's id, downloaded from Admin settings › Backups. After the first setup the admin downloads it and confirms it is kept somewhere else before going on. Each download is in the activity log.
- **Node.js 26 is needed now.** Installs made with PANOPTICA Setup have it. An install still on an older Node.js refuses an update that needs a newer one and says what to do: run the newest PANOPTICA Setup over it (the data and settings stay). Installs made by hand need Node.js 26 or newer from nodejs.org.

## 0.52.1 (2026-11-16)

- **Comparisons, median or mean**: the Parameters table has a Median / Mean switch. The table, the slide and the exported table show the chosen value with ± SD (the standard deviation of the counted pixels), and the PCE relative to the reference follows the choice. Each comparison keeps its choice; median as before.
- **Comparison slide**: each value has its ± SD, smaller and in grey as on the screen (under the value when the column is too narrow). The line under the title says which statistic it is.
- **Export › Table › Groups as columns**: the parameters table turned on its side, one column per group with the reference first, one row per parameter (devices, pixels, PCE, Voc, Jsc, FF, Rs, Rsh, PCE relative to the reference). As PNG or SVG for slides and documents, or as an Excel sheet with the same text. It follows the parameters picked for the box plots, Absolute / Relative and the scan direction.

## 0.52.0 (2026-11-16)

- **Updates bring Node.js too**, on a computer installed with PANOPTICA Setup. When a release runs on a newer Node.js (security fixes included), the update downloads it with PANOPTICA (about 40 MB more), checks it like the rest (its checksum and PANOPTICA's signature), and puts it in place while PANOPTICA is stopped. Until now Node.js changed only when PANOPTICA Setup was run again.
- **If PANOPTICA does not start on the new Node.js**, the update puts the old one back and starts PANOPTICA again; the admins are told. If the Node.js file is refused before anything changes, the update installs PANOPTICA and keeps the Node.js it has; the admins are told why.
- **Admin settings › Updates** shows the Node.js version under each PANOPTICA version, says when an update also brings Node.js, and the download size counts both.
- **PANOPTICA Setup** carries the same Node.js file as the updates.
- This starts with the update after 0.52: an install updated to 0.52 from the app keeps its Node.js until then (the update that brings 0.52 is still run by the version before). Running PANOPTICA Setup 0.52 over it gives it Setup's Node.js at once.

## 0.51.2 (2026-11-16)

- **Comparison slide**: the box plots get the room they need (each panel a little wider than tall, wider with more groups), and the J–V figure takes the rest. They were squashed beside a large J–V figure.
- **Comparison slide**: "PCE relative to the reference" is on two lines, like the other headers, and no longer runs over the last columns' headers.
- **3D view**: the ITO no longer disappears at some angles.
- **3D view, flipped**: the layers are drawn in order from the side you look at, and the glass covers what is behind it, so layers below no longer show on top.

## 0.51.1 (2026-11-16)

- **Export PNG of the 3D view makes an image for slides**: about 2000 pixels on its shorter side whatever the size of the window (it was the size of the view on screen, and looked blurred on a slide), cropped to the device.
- **No shadow around the device** in the exported image: the shadow it casts on the floor stays on screen only.
- **The legend is in the image** when it is on, as tags or as lines, in dark text that reads on a white slide. With the legend off, the image is the device alone.
- The fine stripes on the layers and the stepped shadow edges are gone, on screen and in the image.

## 0.51.0 (2026-11-15)

- **Network settings in PANOPTICA**: Admin settings has a **Network** tab, and the first setup a **Network** step: who can open PANOPTICA (this computer, or the network), the lab's address (the name IT gave the computer), the port, and HTTPS with a certificate from IT (a certificate and key file, or one PFX file with its password). Saving applies them at once, without stopping PANOPTICA. If the address, port or certificate is wrong (a key that does not belong to the certificate, a certificate that expired or is for another name, a port another program uses), nothing changes and the reason is shown. These settings are changed on the computer that runs PANOPTICA; from other computers the tab shows them.
- **The lab's address** shows on the sign-in screen, and copied links and the phone invitation use it.
- **HTTPS**: with a certificate, PANOPTICA answers on port 443 and sends people who type `http://` on to it. Admins are told 30 days, and again 7 days, before the certificate expires.
- **The firewall follows the setting** on an install made by PANOPTICA Setup: open to the network, or closed when only this computer may open PANOPTICA.
- **Tray icon** on the computer that runs PANOPTICA: it shows whether PANOPTICA is running, starting or stopped. Right-click for Open PANOPTICA, Copy the lab's address, Check for updates (a newer version opens Admin settings › Updates, where an admin installs it), Make a backup (in the activity log as made from the server computer) and Restart PANOPTICA (Windows asks for an administrator).
- **PANOPTICA in Task Manager**: it runs as `PANOPTICA.exe`, with its own name and icon, instead of Node.js.
- **PANOPTICA Setup** no longer asks whether the network may open PANOPTICA (that is in PANOPTICA now). A new install is open to the network on port 80 until its first setup, so the first setup can be done from another computer with the setup code; the Network step then decides. An install that is upgraded keeps what it had (port 3000). A new page, **What will be installed**, lists PANOPTICA, the Node.js version it runs on and the tray icon; nothing is downloaded.
- **Updates come from PANOPTICA's public releases**, with no token needed. A token saved before keeps working as a fallback.
- **PANOPTICA Setup for macOS is gone**: the lab's server is a Windows computer. A Mac can still run PANOPTICA from the zip with `start.command`.
- At the bottom of the sign-in panel: **Name / Logo / Both** is a toggle, like Full name / Acronym, shown once there is an institution logo.
- Fix: clicking a toggle inside a form no longer saves the form.
- Manual installs keep port 3000 and their start scripts until an admin changes the network settings.

## 0.50.2 (2026-11-15)

- **PANOPTICA Setup on Windows can be run over a PANOPTICA that is running.** It stopped with "DeleteFile failed; code 5. Access is denied." at `node.exe`, because the running PANOPTICA was using that file. Setup now stops PANOPTICA first, replaces it and starts it again; the lab's data stays as before. If PANOPTICA cannot be stopped, Setup says so before changing anything.

## 0.50.1 (2026-11-15)

- **PANOPTICA Setup installs Node 26** instead of Node 22, on Windows and on a Mac. Node 26 receives security fixes until April 2029; Node 22 stops in April 2027. Nothing changes in how PANOPTICA looks or works.
- **A computer that already has PANOPTICA keeps its Node 22** when it updates from Admin settings › Updates: the update replaces PANOPTICA, not Node. To move it to Node 26, run the new PANOPTICA Setup over the install (the data stays). PANOPTICA still runs on Node 22, and a later release will make the update replace Node as well.
- A manual install works with Node 22.13 or newer as before; Node 26 is the one to install now.
- **For PANOPTICA's staff**: the checks run once per commit, on both systems to the end, on Node 26 and also on Node 22; ESLint 10.

## 0.50.0 (2026-11-15)

Nothing changes for labs in this release: it is for PANOPTICA's staff, and the builder is still not in the package labs receive.

- **The licence builder has a page**: `npm run builder` opens it in the browser of the computer it runs on (it answers only there). A form with the lab's full name, acronym, modules and number of people makes the lab's licence file and its install sheet with the setup code.
- **The list of licences issued**: every licence and its install sheet are kept in a folder chosen on that computer, outside the repository. **Download licence** gives a lab that lost its file the same file again; **Install sheet** opens the sheet to print; **New licence** makes an updated one for a lab in the list (an upgrade, a module added), with the same lab id and no setup code.
- **The signing key is asked for with every licence** and is never saved, nor is where it is kept.
- The command-line builder works as before and signs through the same code.

## 0.49.0 (2026-11-14)

- **PANOPTICA Setup takes the lab's licence file**: no product key and no activation service any more. Setup asks for `licence.json`, shows the lab, its modules and how many people it covers, and installs the package for those modules from the ones it carries, checked against PANOPTICA's signature. The internet is not needed during the installation. Silent installs take `/LICENCE=` (Windows) or `--licence` (Mac).
- **Licences by size, updates free**: a licence covers up to 10 active people (tier 1), up to 50 (tier 2), or a number agreed with the lab (tier 3). Updates have no last day any more. At the licence's number, accepting an access request, adding a visitor and enabling an account are refused with "Your licence covers N people. Contact PANOPTICA to upgrade."; Admin settings › Licence and the access requests say so before anyone tries. Everyone who has an account keeps working.
- **The licence file is required on an install made by Setup**: if it is missing or not valid, Admin settings says so on every tab, and no one new can be let in until it is installed again. Nothing else stops. A manual install keeps working without one.
- **A licence is installed only on the computer that runs PANOPTICA**; from another computer the Licence tab says so. Lost the file? PANOPTICA makes a copy for the lab.
- **The lab's full name and acronym**: first setup and Admin settings › Lab setup ask for both and for which one PANOPTICA shows (sign-in screen, top bar, exports, run sheets). The names in the licence are PANOPTICA's record and are shown only under Licence.
- **No scripts to run by hand on an install made by Setup**: the start, update, version and restore scripts are left out (the app keeps its update script for itself), and on Windows the install folder is open only to administrators and the system. `reset-password` stays, for an administrator who lost the admin password, and finds the Node that Setup installed.
- Updates come from GitHub again (Admin settings › Updates, with the read-only token while the repository is private). The Product key section and Check my licence are gone.
- Admin settings' tabs scroll sideways on a narrow screen instead of widening the page.
- **For PANOPTICA's staff**: the builder takes `--lab` (full name), `--acronym`, `--tier` and `--users`, and its install sheet describes the Setup install. `services/activation` and `tools/builder/keys.mjs` are removed.

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
