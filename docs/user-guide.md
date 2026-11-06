# Perovskite Lab user guide

Perovskite Lab keeps the lab's fabrication procedures as reusable presets, assembles them into device stacks, and records what happened in each batch.

## How the pieces fit

1. **Designs** describe hardware: a *substrate* (glass size and ITO pattern) and a *metal mask* drawn for that substrate.
2. **Recipes** describe one process step: substrate prep, solution, spin coating, organic evaporation, metal evaporation.
3. A **stack** lists the layers of a device, each pointing to its recipes.
4. A **batch** is one fabrication run of a stack. It keeps a frozen copy of the stack and its recipes, its bookings, notes and the run data.

The side menu follows the same order: **Fabrication** (stacks, batches, calendar), **Measurements**, **Recipes**, **Designs**, and **Lab** (inventory) at the bottom.

Typical order: make the substrate and mask designs once; make or reuse recipes; build the stack; start a batch from the stack; print the sheet; enter run data afterwards.

## Library screens

Every design, recipe and stack page has the same layout:

- **All / Mine / Shared** filters the cards; the search box matches names and summaries.
- **New …** opens an empty editor. Click a card to open it.
- An open preset has three tabs: **Recipe** (the computed output), **Run data** (entries from real runs) and **History** (versions).
- **Edit** shows inputs on the left and the live output on the right. On a phone, switch between **Inputs** and **Output**.
- Saving needs a name. If the name at the top is still empty, the button reads **Name and save** and asks for the name in a small box; Enter saves.
- **Duplicate** copies a preset under your name. **Private** presets are visible only to you; **Shared** presets are visible to everyone (only the owner edits them).

### Versions

A preset that is used by a stack, a batch or another preset is never changed in place. Saving it creates *Name v2*, linked to the original, and the original stays as it was, so old stacks and batches keep pointing to what was actually used. Saving someone else's shared preset also creates your own version. Unused presets you own are edited in place. **History** shows the family tree and what changed between versions. A preset in use cannot be deleted.

## Designs

### Substrates

Set the glass size, then draw the ITO with rectangles, parallelograms, trapezoids or free quadrilaterals. *Repeat as array* copies a shape in rows and columns. Shapes can be dragged on the canvas or typed in the table (mm). Also recorded: sheet resistance, ITO thickness, supplier and an orientation mark. The output shows ITO area and strip resistance (R = R<sub>s</sub>·L/W).

Canvas: scroll to zoom, drag the background to pan, **Ctrl Z** / **Ctrl Y** undo and redo, **Ctrl D** duplicates the selected shape.

### Metal masks

A wizard in five steps:

1. **Substrate**: pick the substrate design the mask is made for.
2. **Active areas**: draw the pixels (metal meant to sit over the full stack). **Confirm array as … separate pixels** turns a repeated shape into one shape per pixel. Pixels are numbered P1, P2… in the order of the list (array copies row by row); drag a pixel by its handle (⋮⋮) to reorder, so that the numbers match the pixel numbers of the J–V system (for example 4, 5, 3, 6, 2, 7, 1, 8 from top to bottom). The measurement cells always use the newest pixel order of the mask, also for batches started before the reordering (as long as the pixels themselves were not moved). The canvas shows the numbers as you go.
3. **Connections**: strips from each pixel to a pad on ITO-free glass, and the counter electrode.
4. **Scrape area**: where the layers are scraped off to expose ITO. A suggestion under the counter electrode is offered.
5. **Review and export**.

The live check computes the device area of each pixel (metal over unscraped ITO), parasitic area from strips over ITO (**Accept the recalculated area**: unchecked, recipes and sheets use the drawn pixel area instead), and warns about shorts (pixel metal reaching exposed ITO), pads on ITO, a missing counter electrode, islands that a mask cannot hold, openings or bridges thinner than the minimum feature, and openings beyond the glass.

Exports, for the **aperture** (active areas), **evaporation** (all metal) and **scrape stencil** masks: **STL** (plate with holes, optional substrate pocket; open in Tinkercad or a slicer), **SVG** and **DXF** (outlines in mm, for laser cutting or quotations). *Mirror* flips the layout left–right for face-down mounting.

## Recipes

- **Substrate prep**: the substrate design, sonication steps with times, and the surface treatment (N<sub>2</sub> dry first, then UV-ozone or O<sub>2</sub> plasma). Drag a step by its handle (⋮⋮) to change the order; with the handle selected, the arrow keys move it too.
- **Solutions**: for a perovskite, pick the A-site and X-site ions with the chips, then type each fraction directly into the subscripts of the formula (Cs<sub>0.05</sub>FA<sub>0.80</sub>MA<sub>0.15</sub>…). A site with one ion needs no number. **Structure** switches between 3D and layered perovskites, general form RA<sub>n−1</sub>Pb<sub>n</sub>X<sub>3n+1</sub> (R = large organic spacer): **Ruddlesden–Popper**, (L)<sub>2</sub>A<sub>n−1</sub>Pb<sub>n</sub>X<sub>3n+1</sub>, two monovalent spacers (PEA, BA, OA, BzA, EA, DMA, ThMA); **Dion–Jacobson**, (L)A<sub>n−1</sub>Pb<sub>n</sub>X<sub>3n+1</sub>, one divalent spacer (PDA, BDA, EDA, 3AMP, 4AMP). Pick the spacer, then type the spacer and A-cation amounts in the formula (for example BA 2 and MA 3, or BA 0.4 and MA 0.6, which is the same ratio): their ratio sets n (RP n = 1 + 2·A/spacer, DJ n = 1 + A/spacer), and Pb and the halide follow. You can also type Pb directly. **Write with 2 BA** (or 1 for DJ) rewrites the formula in the usual form; the masses do not change. In terms of n: n = 1 is pure 2D, 2–4 quasi-2D, 5 and more often called quasi-3D, n → ∞ is 3D; non-integer values give a nominal ⟨n⟩. Per Pb the solution holds 2/n LX (RP) or 1/n LX<sub>2</sub> (DJ), (n−1)/n AX and one PbX<sub>2</sub>; molarity is mol Pb per litre, as for 3D. Notes appear for mixed halides (2D halide degradation) and for n ≥ 5 (splitting into lower-n phases in humid air). For a 2D passivation layer on a 3D film (spacer salt in IPA, for example), use the Custom solution type. Below the formula, each site's sum is checked; **Make it 1** scales the fractions so they add up to 1. The app allocates halides to PbX<sub>2</sub> first and gives the mass of each salt for the chosen molarity and volume. **All in one vial** or **Separate stock solutions**: with stocks, each salt is dissolved on its own in the solvent mixture (concentration and volume to prepare per salt; by default all stocks at M × total salt per Pb, so they add up exactly to the final volume), then the output lists the mass for each stock, the volume of each stock to pipette, the solvent to make up the volume and the additives for the mixed solution. **Volume of solvent**: the salts are dissolved in that volume of solvent (mol Pb per L of solvent). **Density method**: the volume is the final solution; the dissolved perovskite takes up its mass ÷ density (default 4.1 g/cm³, editable), so the solvent volume is reduced by that amount. The salt masses are the same in both. ETL, HTL and custom solutions use mg/mL or mM. Additives can be given in mol%, wt%, mg/mL, µL/mL or µL of a stock solution per mL. Stirring, heating and cool-down are recorded.
- **Spin coating**: controller steps as time : rpm (time to reach the speed), dispenses before the spin or at *s remaining*, the 0.22 µm filter, annealing and activation steps. While editing, the spin curve above the steps shows the ramps, speeds, N<sub>2</sub> steps and when each dispense happens.
- **Organic evaporation**: material, thickness, rate (Å/s or Å/min), expected temperature and pressure (value × 10<sup>exp</sup> mbar), estimated time. Known materials (C60, BCP, BPhen, TPBi, NPB, TAPC) are shown as a 3D ball-and-stick model; drag it to rotate. Other materials show their name.
- **Metal evaporation**: substrate design and a mask drawn for it, metal, rate stages (Å/s until a thickness), controller thickness in kÅ and starting power. The output shows the scrape zone on the ITO, then the metal pattern over it.

## Stacks

**New stack** opens a wizard: choose **p-i-n** or **n-i-p** (the template sets the layer list; layers can be inserted or removed later), then one step per layer. For each layer pick the method and a preset card, or create a new preset without leaving the wizard. Spin and manual layers take a thickness for the 3D view. Tick **Change layer preview style** to set a layer's colour, opacity, roughness and metallic in the 3D view (for the substrate step: the glass and the ITO); **Default** goes back to the standard look, and unticking resets it. The Schematic view uses only the colour and opacity. **Previous**, **+ New layer** (adds an empty layer after the current one) and **Next** stay at the bottom of the screen while you scroll. **Review** lists all layers with **Edit**, **Insert above** and **Remove**. A metal recipe whose mask was drawn for a different substrate cannot be chosen.

The 3D view is built from the substrate and mask designs. Each layer lies on whatever is below it, so films fill down to the glass where there is no ITO and the counter electrode sits on the exposed ITO in the scrape zone with the same thickness as the rest of the metal; as soon as the view is exploded at all, it rises to the level of the other metal. Glass and ITO share one label; the leader line of the metal points to the nearest metal part. Heights are schematic: glass 1 mm, 100 nm of film = 0.1 mm. On a batch page the view settings (look, exploded, legend, flip, export) open from the cog in the bottom-left corner, as a bar along the bottom of the view; the stack moves up so the bar never covers it. With **Lines**, each line meets its layer at the edge nearest the labels, so layers cut away in the scrape zone and the metal strips are met where they really are.

- Drag to rotate (around the centre, from top view to side view).
- Scroll, pinch or use the slider to separate the layers (exploded view).
- **Realistic / Schematic** switches the look; **Export PNG** saves an image.
- **Legend** shows or hides the layer names; **Tags** puts them in rounded labels, **Lines** draws a line from each layer to its underlined name.

From an open stack: **Print run sheet**, or type a batch code and **Start batch**.

## Batches

A batch freezes the stack, its recipes and the chemical list at the moment it is started. Editing a recipe later does not change the batch.

- **Status**: Planned, Running, Done. Your running batch appears as a chip in the top bar; click it to return to the batch.
- **Layers**: each layer shows where it stands in the Calendar: **Not scheduled**, **Booked** (date and time), **Concluded** (date) or postponed. There is nothing to tick: the outcome you give a booked step is the record.
- **Run data missing**: concluded steps whose recipes have no run data under this batch yet are listed at the top, each with **Add run data**.
- **Add run data** next to each recipe opens the run data form with the batch code filled in.
- **Variants**: the devices of the batch that differ from the default device (the stack the batch was started from). **Add variant**, name it, enter its substrates, then either choose **Another stack** (a premade variation; versions of the batch's stack are listed first) or list what changes from the default device: **Use another recipe** for a layer (versions of the layer's recipe first), **Add an additive**, **Add a layer**, **Leave out a layer** or **Describe another change**. A variant needs one of the two. Its recipes are frozen when saved, like the batch's own. The substrates of the default device and of each variant can be typed straight in the list. Removing a variant asks first: its frozen recipes go, and samples linked to it count as the default device. The print sheet, the report and the spreadsheet list the variants and their recipes.
- **Locked batches**: 14 days after a batch is Done it locks by itself. Its layers, run data, variants, notes, bookings and name stay as recorded (the page says so); comments, sharing and measurement links stay open. The batch page shows the date it will lock. An admin can **Unlock for 7 days** (it locks again by itself, or with **Lock now**); unlocking is written to the activity log. The batch list marks locked batches with a padlock.
- **Batch notes**: anything that applies to the whole batch.
- **Run data for …** lists every entry with this batch code, whether entered from the batch page or from a recipe page.
- **Print sheet** prints the batch on blank paper, with empty fields to fill in by hand at the bench.
- **Report (PDF)** prints a full report of the batch (save it as PDF in the print dialog): stack and layer order, every recipe with its values, the state of each layer from the calendar, batch notes, all run data, and the J–V results of the measurements linked to the batch (table per group, champion device, box plots). **Spreadsheet** downloads the same as an .xlsx file with one sheet each for the batch, layers, recipes, run data, J–V pixels and statistics.

## Electric measurements (J–V)

**Electric measurements** (sidebar) reads the files the lab's J–V systems save and keeps the curves with the samples they belong to.

- **Import measurements**: drop the folder the system saved (or a .zip of it), or choose files. Supported: the 8-pixel system (Padrão: "… J-V Data.csv", "… Metrics.csv" and the Settings folder) and the 1.5 × 2.5 system ("…-JV-Backward-Sun-A1.txt" and "…-Parameters.txt"). Sample, substrate, scan and pixel are read from the file names; area and light intensity from the files.
- Before saving, link each sample to a **batch** or **stack** of the app (a batch with variants lists each variant too: "B-12, variant 5 % MACl"; statistics and comparisons keep variants apart, and What changed reads the variant's recipes), and under **Devices for the plots and device groups** choose which devices (substrates) go into the plots and give them a **device group** to compare modifications (for example "control" and "+ PEAI"). Devices without a group are grouped by their batch or stack. Both can be changed later in the measurement (same section above each sample's cells).
- **Cells**: with a linked batch or stack whose mask has the same number of pixels, every substrate is drawn as in the metal-evaporation recipe (glass, ITO, scrape zone, metal); otherwise the pixels are plain rounded boxes (P1, P2… or A1, A2…). Each pixel shows its number and PCE (darker blue = higher); **black** = dead (no current), **red** = short (current but almost no voltage). A **golden border** marks the best pixel of each substrate and the best device (substrate) of each sample. Click a pixel for its J–V figure in journal style (7 × 5, closed frame, V 0–1.2 V by 0.2, J 0–30 mA/cm² by 5; forward solid and backward dashed in the same colour; the device's layer order with p-i-n or n-i-p; the scan with the pixel's best PCE marked ★ with PCE, FF, Voc, Jsc and Vmpp). **Group logo** adds the lab's logo and name (set by an admin); **Export PNG** (3×, white background) or **Export SVG** for papers and slides. Below the figure: the numbers for every scan, the hysteresis index and the values the instrument software reported.
- **Statistics**: journal-style box plots, one card per parameter. Pick which to show with the chips (J<sub>SC</sub>, FF, V<sub>OC</sub>, PCE, R<sub>s</sub>, R<sub>sh</sub>; R<sub>sh</sub> uses a log axis); each axis is fitted around the data so the boxes sit in the middle, and each plot exports on its own (**PNG**, **SVG** under it); **Export** gives all shown plots as one image, each plot as its own file, or every counted pixel as CSV. With **Group logo** on, the logo sits at the bottom centre of each plot, or moves to the top centre or a corner when data would be under it. Each group (device group, batch or stack) has its own colour: backward box in that colour, forward box a lighter shade joined to it (**Both**), and the pixels as dots in a darker shade (gold ring = best; triangles = outliers beyond 1.5 × IQR). Untick **Show outliers** when one far-off value squeezes the boxes: the axis then fits the boxes and whiskers, and the points beyond it become an arrow at the top or bottom edge with their number (they still count in the box and the table; exported figures keep the arrows; the choice is remembered and also used by the batch report, comparisons and slides). **Density curve** adds the density of the dots beside each box (in the darker shade). Hover a dot or box for its values. Also a table with mean ± sd, median and best, and the champion device; the CSV (in **Export**) opens in Origin or LabPlot. On the Electric measurements page, choose which measurements to include; inside a measurement, only that one.
- **Both** (Cells): every pixel shows its backward PCE above its forward PCE; the colour follows the better one.
- What counts in the statistics: working pixels only, never check sweeps, and when a pixel was measured more than once, its **best** scan (highest PCE) in each direction. The pixel map, the best pixel and device, the box plots, the Overview, records and comparisons all follow the same rule. Change it per curve in the pixel's table (Auto / Include / Exclude).
- **Check sweeps**: a quick exploratory scan run before the real measurement of the same pixel (on the 8-pixel system: 0.05 V steps, forward only, then the real one at 0.02 V with both directions). The app recognises it from the voltage step and the scan directions, not from the scan number: a scan is a check sweep when another scan of the same pixel is clearly finer, or as fine and with both directions. It is shown greyed with a **check sweep** label (scan selector and the pixel's table) and never counts; choose **Include** in the pixel's table if it really should. A pixel measured only once is never a check sweep. Existing measurements were checked when updating to 0.30.
- The numbers are calculated by the app from the curves (they match the instrument software on working pixels): Jsc at 0 V, Voc where the current crosses zero, maximum power on a fine grid, FF, PCE from the light intensity, Rs and Rsh from the slopes at Voc and at 0 V. Isolated glitch points (contact spikes) are ignored and counted in the pixel's table.
- A batch page lists the measurements linked to it, with the same cells, and can import directly for that batch.

## Comments and notifications

- Every stack, recipe, design and batch has **Comments** (a tab on presets, a section at the bottom of a batch). Write a comment, **Reply** to one, react with 👍 ❤️ 🎉 😮 🤔, edit or delete your own. Ctrl + Enter sends.
- **Mention someone** with **@**: type @ and the first letters of a name or username, then pick the person (arrow keys and Enter, or click). Only people who can open the item are offered. The mention shows as their name, and they are notified (instead of the usual comment notice). Adding a mention by editing a comment notifies the person added.
- The bell (top right) shows a red count of unread notifications. You are notified when:
  - someone breaks the **lab record** (best PCE ever on the 8-pixel or the 1.5 × 2.5 system; everyone is told);
  - someone makes a new protocol **based on yours** (a new version or a duplicate of your preset);
  - someone **comments** on your stack, recipe or batch, or **replies** to your comment;
  - someone **mentions** you with @ in a comment.
- Click a notification to open what it is about; **Mark all as read** clears the count.

## Overview (Professor, Managers, admins)

**Overview** (top of the side menu) shows the lab in a **Week** or a **Month**; ‹ › move between periods.

- **Summary**: the period in one sentence, a new lab record if there was one, three numbers (best cell, typical cell = median, batches), postponed or canceled steps if any, efficiency over time (hover for values, or **Show numbers**) and who was active. **Details** at the bottom opens the best cells, the batches started or finished, and the measurements.
- **People**: a card per person with what they did in the period. Open a person for their page: best cell so far, progress measurement by measurement, recent batches and measurements; equipment time and setbacks are folded below.
- **Equipment**: booked hours per equipment and how busy it was (share of weekday working hours, 08:00–18:00), with who booked it.

**Export for a presentation** (Summary) shows a preview of a 16:9 slide with efficiency over time, the J–V curve of the period's best cell and the box plots (Jsc, FF, Voc, PCE) of that cell's batch, with the group logo. Download the full slide, or each figure on its own to build your own slide, as PNG (PowerPoint, Google Slides) or SVG (sharp at any size, editable). The highlights slide (record, batches, best cells in words) is there too. People and Equipment have **Export slide** for their own 16:9 slide. A cell counts with its best working pixel; stability follow-ups are left out.

## Comparing pixels

On a measurement's Cells tab, **Shift-click** pixels on any substrate or sample to compare them; each picked pixel gets a coloured outline. The comparison above the cells shows one J–V figure per pixel side by side (best scan; forward solid, backward dashed; or one direction); tick **All on one plot** to overlay them in one figure, one colour per pixel. It lists their numbers and exports as PNG or SVG (side-by-side figures export as one image). Shift-click a pixel again, or **Remove**, to drop it; **Clear** empties the comparison.

## Comparisons

**Comparisons** (sidebar, under Measurements) puts devices from any measurements side by side, so modifications measured on different days, or imported separately, can be compared. Each comparison is **private** until you switch it to **Shared**; others can then read it (and **Make a copy**) but not change it.

- **Add devices** opens the list of every device you can see (sample and substrate of each measurement), with its batch, measurement, best PCE and counted pixels. Filter by text, measurement, person or dates, tick the devices and **Add**.
- **Groups by name** (the default in Add devices) reads names as `batch_mod`: the part after the first underscore is the modification, so TripleC_Padrao and TripleC_fulerenol_com_aneal make two groups; "Padrão", "ref" or "control" becomes the reference. Names to check are listed: a name without an underscore, or one a letter or two away from a more common one (a likely typo that made a group of its own). Or put the devices straight into a group you choose.
- In the **Groups** list: rename a group, **Set as reference**, reorder, remove, or open the device list (names that differ from most of the group are marked).
- Results: **box plots** of the parameters you choose (PCE, V<sub>OC</sub>, J<sub>SC</sub>, FF, R<sub>S</sub>, R<sub>SH</sub>; the choice is saved with the comparison; R<sub>SH</sub> on a log axis; backward, forward or both; **Show outliers**, **Density curve**), the **J–V curve** of each group's best pixel, and the **parameters** table: devices, pixels and the median ± standard deviation of each chosen parameter per group, and the change in median PCE against the reference. Each box plot has its own PNG and SVG.
- **Relative to reference** divides every value by the median of the reference group in the same measurement and direction, so differences between measurement days cancel out; devices without a reference in their measurement are left out (and counted).
- **What changed** compares the recipes of the groups' batches (from each batch's frozen snapshot) with the reference: method, recipe and each recipe value per layer. A value that differs between a group's own batches shows as varying. Devices in the same batch as the reference have the same recipes, so only the sample names tell them apart.
- **Export**: a 16:9 slide (box plots, J–V curves and the parameters table); the box plots all in one image or each plot as its own file; the J–V curves all in one plot or one file per group (PNG or SVG); and an Excel file with the groups, every counted pixel and what changed.
- A comparison keeps references to the devices, not copies: when a pixel is excluded in its measurement, it is left out here too. Deleting moves it to the Trash.

## Stability tests

Measure the same devices again later and mark the new measurement as a follow-up: tick **Stability test** when importing and choose the first measurement of the series (or set it afterwards under **Stability test** on the measurement), with the date and time it was measured. Pixels are matched by sample, substrate and pixel. Follow-ups are kept out of the statistics and the lab records. The **Stability** tab (on the first measurement and on each follow-up) plots PCE, Voc, Jsc or FF against time since the first reading, normalised to it or in absolute values, for the best pixel of each device or every pixel; the table gives the first and latest values, the ratio, and T90 and T80 interpolated between the readings around the fall. Export as PNG, SVG or CSV.

## Comments and reactions

React to a comment with any emoji: **+** under the comment opens the emoji keyboard (search, categories, skin tones). Click a reaction to add or remove yours.

## Calendar and batch scheduling

**Calendar** (side menu; on a phone, under Fabrication) shows the lab's equipment bookings by **Day** (one column per equipment), **Week** or **Month**. Each booking is a block in its equipment's colour with the experiment (batch and layer), the equipment, who booked it ("you" for your own) and the time; short bookings put them on one or two lines. A ✓ marks a concluded step, a ? a step waiting for its outcome; canceled and postponed steps are striped. Hours outside the lab day (08:00–18:00) and empty weekends are shaded and narrow. When a block is too small or narrow to show everything, hover it: a card with all the details opens next to it. In the week and month views, click an equipment name (its colour is the bar under it) to show or hide it. Keys: ← → previous and next, T today, D W M the views.

**Schedule a batch** (on a computer): on the batch page, **Schedule equipment** (under the 3D view, on the right) opens the Calendar with a tray of the batch's equipment blocks under it. Steps that use the same equipment one after another are one block: substrate cleaning and surface treatment on the equipment set for **Substrate preparation** (the UV-ozone cleaner), all solutions of the stack are prepared in one session on **GB: Scale**, consecutive spin-coated layers share one **GB: Spinner** session, C60 then BCP share one **GB: Minivap (Organic Evaporator)** run, and the metal goes on **GB: Metal Evaporator**. Drag each block onto its day and time in the week or day view; a dashed outline shows where it lands, red when the equipment is not free. Drag a booking to move it; drag its top or bottom edge to change when it starts or ends (a small bar shows the edges on hover). When every block is placed the batch page reads **Scheduled**. On a phone the Calendar is for looking and editing bookings, not for scheduling batches.

**Status follows the schedule**: a batch is Planned until its first booked step starts, then Running. When a booked step has ended, whoever booked it is asked how it went: **Concluded**, **Postponed** (to finish another time) or **Canceled**, with the reason for the last two. After **Concluded**, the run data of the step's recipes open one after the other (the solutions for the scale session, the spin programs for the spinner, the evaporation recipe for an evaporator), with every value required. If the notebook is not at hand, **Add it later**: the batch page lists the missing run data and you get a reminder. The question stays on screen until it is answered. The batch becomes **Done** when every step is answered and no postponed step is waiting for a new time (schedule it again from the batch page).

Single bookings can also be made in the Calendar: drag across empty time in the day or week view (a click books one hour), or **New booking**. Times snap to 15 minutes. **A booking is at least 1 hour** (a shorter older booking becomes an hour when moved). Overlaps cannot be saved (admins can book anyway).

**Cleanup after glovebox bookings**: every booking of glovebox equipment (the **GB:** ones) is followed by **20 minutes of cleanup**, drawn hatched under the block. The equipment stays taken during it, so the next person can only start after it: everyone has time to leave the glovebox clean without someone waiting. A new booking cannot start in someone's cleanup, nor end so late that its own cleanup runs into the next booking. The cleanup is per equipment: the spinner's cleanup does not block the scale. Click a booking to change or remove it (**Undo** brings it back). **Drawings**: each equipment has a line drawing (balance, spin coater, small or thermal evaporator, UV-ozone cleaner, hotplate, glovebox, solar simulator, profilometer, ultrasonic bath or other), its working part in the equipment's colour. They head the Day view's columns, the booking form's equipment choice, the hover card and the Overview's equipment use. The drawing is chosen from what the equipment is used for and its name; admins change it under **Equipment** (click the drawing). Admins manage the equipment under **Equipment**: drag the handle to change the order (the Day view's columns and the pickers follow it), colour, name, procedure (which steps the scheduler books it for), **cleanup after** each booking in minutes (new equipment named GB: starts at 20, others at 0), remove and add.

## Inventory

**Inventory** (side menu, under Lab) has four tabs. Everyone can look; admins and people with the **Inventory** tag edit.

- **Storage**: each cabinet, desiccator, glovebox or fridge is a card drawn from the front, one line per division with a bar for how many containers sit there. **New storage** asks only for the name and the type. Open a card, then **Add division** to split it into shelves, trays, drawers or anything you name; each division is a line with its name, and clicking the name folds its containers away or shows them. Hover a division to add a container to it, rename it or remove it.
- **Containers**: every bottle with how much is left (and of what size), where it is, supplier, lot, purity, opened and expiry dates, and who added it and last changed it, and when. Expired and soon-to-expire containers are marked. **Mark empty** keeps a finished bottle in the history. **Import CSV** reads an export from OpenEnventory or any spreadsheet saved as CSV: columns are matched by their header (check and change them before importing), and storage places and divisions are created by name.
- **Consumption**: reagent use per week or per month from the recipes of running and done batches (each solution as prepared, plus solvents dispensed straight from the bottle in spin programs; planned amounts, not weighed ones). For each chemical: a small bar chart of the last 26 weeks or 12 months, this period, the average over the last 8 weeks or 6 months, the stock in containers that are not empty, and the date it runs out at the average rate (red within 30 days). **Unusual use** marks a week or month above twice the earlier average and well outside its normal spread. Click a chemical for the full chart and the batches behind it. Mass and volume are converted with the density in the chemical list.
- **Chemical list**: the formulas, molar masses, densities and purities used by the recipes.
- **Storage types** (Inventory tag): the options in the type picker. Add one with a name and an icon, rename it, click its icon to choose another, or remove it once no storage uses it.

## Profile, tags and the Professor

**Edit profile** (in the menu under your photo, next to your name): photo (click the photo to choose a picture, then drag and zoom to crop), display name, default visibility of new presets (Shared unless you change it), theme, password and the phone invite.

Admins give tags in **Admin settings → Tags**. Labels (Master's, PhD, Post-doc, Visitor, research topics) only describe people. Three tags give access: **Professor** sees every preset, batch and measurement, can tick **Private, only for …** to comment only to the owner (replies stay private), and her comments come first, highlighted. **Manager** opens student pages, digests and equipment use (coming with the professor dashboard). **Inventory** edits the chemicals and inventory.

Hold **Shift** while opening **Edit profile** to see the **Funny settings** (all off until you turn them on): a red eye next to search while the Professor is online, and breaking news from the lab's alternative universe in the top bar, one headline at a time with a pause between them (admins set the pause for everyone, 30 s by default). With both on, the news also covers the Professor while she is online, and opens at once with a red, shaking border when she arrives.

## Help

The **?** button next to the bell opens the quick start and this guide.

## Trash

Deleting a stack, recipe, design, batch or measurement moves it to the **Trash** (bottom of the side menu; on a phone, ☰ → Account). Right after deleting, **Undo** in the message at the bottom brings it back. From the Trash page you can **Restore** for 30 days, or **Delete for good**; after 30 days items are removed automatically. Admins see everyone's deleted items.

## Lists and conventions

- **Cards or List**: Recipes, Designs, Stacks, Batches, Electric measurements and Comparisons can show cards or a list; the choice is one for the whole app.
- **Reordering**: everything with an order has a handle (six dots) to drag it, or focus the handle and use the arrow keys: substrate-prep steps, spin steps and dispenses, solvents and additives, stack layers (in the stack's Review step; the substrate stays at the bottom), comparison groups, inventory divisions and equipment.
- **Dates** are day/month/year (06/11/2026) and times 24 h, whatever the browser's language. A measurement day is shown as that day everywhere (before 0.34 some lists showed the day before).
- **Moving to the trash** asks nothing: the toast offers **Undo**, and Trash keeps it for 30 days. Only what cannot be undone asks first (removing equipment, deleting users or tags, emptying the trash).

## Links

Every page and item has its own address: a batch (`#/batches/12`), a measurement, a comparison, a recipe or design, a container. **Copy link** (in the item's header) copies it; anyone who can see the item opens it with the link, after signing in if needed. The browser's **Back** and **Forward** buttons move between what you opened, and a bookmark reopens the same item. The address uses the computer's address on the lab network, so links work for everyone on that network.

## Data package

A **data package** is one .zip for a data repository, made from the batches, measurements and comparisons you choose. Open it from a batch (**Export › Data package**), a measurement (**Data package**), a comparison (**Export › Data package**) or the Batches and Electric measurements lists (**Data package**, starting with nothing chosen).

- **What goes in**: tick batches, measurements and comparisons (filter by name or person). With **Also add what they are linked to** on, a batch brings its measurements, a measurement its batches and a comparison its measurements; those are listed as "linked to a chosen item".
- **Describe it**: title, description, authors (separated by ;), affiliation, FAPESP process number, licence (CC BY 4.0, CC0, CC BY-NC 4.0, or not decided yet) and keywords. Affiliation, process, licence and keywords are remembered for the next package.
- **Inside the .zip**: a **README.md** that describes the data (who, when, what, the folder layout, units and methods: how the parameters are calculated and which pixels count), **metadata.json** with the fields a repository deposit asks for (REDU, Unicamp's research data repository, runs Dataverse), and **manifest-sha256.txt** with the SHA-256 of every file (check with `sha256sum -c manifest-sha256.txt`). Each batch has batch.json (the stack and recipes as frozen at the start, variants, bookings, run data) and the batch spreadsheet's tables as CSV; each measurement has measurement.json, pixels.csv (every curve with its parameters, check sweep or not, counted or not) and one CSV per curve (V in volts, J in mA/cm²); each comparison has comparison.json and pixels.csv.
- Files are CSV (UTF-8, comma-separated, decimal point) and JSON, readable without the app. Nothing leaves the computer: the package is made in the browser and downloaded.

## Run data

Run data are structured entries of what really happened: measured masses and volumes, powers, rates, pressures, thicknesses, with the recipe value next to each field, plus deviations and notes. Enter them from a batch (**Add run data**) or from a recipe's **Run data** tab; give the batch code so the entry is listed on the batch page.

Metal evaporation asks, per stage (each rate), for the power and the pressure reached at that rate, plus the sensor life as **T.V = XX.X %**, the final thickness and the base pressure. Pressures are typed as a value and an exponent (2.1 × 10⁻⁶ mbar); the exponent carries over from the previous field, so usually only the value is needed. A comma works as the decimal sign. The printed batch sheet has the same blanks.

## Search

**Ctrl K** (or the search box) finds presets, batches, measurements, comparisons, containers (by name, CAS or lot; opens the container) and chemicals, and jumps to any section. On a phone, use **Menu › Search**.

## Phones and tablets

The app works in a phone browser on the same network as the lab PC. Start the PC with **start-network** (start-network.bat on Windows, start-network.command on Mac, start-network.sh on Linux), then open the profile menu (your initial, top right) › **Invite a phone (QR code)** and scan the code with the phone camera; the link opens the app in the phone's browser. The start window also prints the address. University networks such as eduroam may keep devices from reaching each other; a lab router or a phone hotspot works. The bottom bar has **Fabrication** (stacks, batches, calendar), **Measurements**, **Recipes** (all recipe kinds) and the menu (☰) for designs, the inventory, search, help and your profile. Inside Fabrication and Recipes, the chips at the top switch between their sections, and each tab reopens the section you used last. Phones are best for ticking batch layers and entering run data; drawing designs is easier on a computer.

## Account

Click your photo or initial (top right) for **Edit profile** (photo, name, settings, password), the theme (System, Light, Dark), the phone invite and the app version. Ask an admin to reset a forgotten password: you sign in with the temporary password they give you and then choose your own. New accounts work the same way. After 5 wrong passwords in a row, signing in is blocked for 10 minutes.

## Live updates

The app shows changes made by others as they happen: a booking, a new batch, a comment, a measurement appear without reloading the page. A tab in the background catches up when you return to it.

## For admins

**Admin settings** (profile menu or Menu) has one tab per job:

- **Users**: create users, reset passwords, disable accounts, delete profiles; tags. A deleted profile can no longer sign in and its username is free again; everything the person made stays, shown as “username (former)”. Their private items stay private (visible to admins and the Professor only). New passwords need at least 10 characters (a short sentence works well) and cannot be well-known passwords or contain the username.
- **Backups**: make a backup now, download backups. Each backup is opened and checked after it is made. **Second copy off this computer**: a folder on a network drive or kept in sync by Google Drive, OneDrive or Dropbox, where every backup is also copied, encrypted by default. **Show key** shows the key of the encrypted copies: save it somewhere safe.
- **Security**: a checklist of what keeps the data safe (encrypted connection, recent checked backup, encrypted second copy, intact activity log, number of admins, temporary passwords, unused accounts), each with what to do when it is not in order.
- **Activity log**: every change, sign-in and refused request, with who, when and from which address; search, filter by person, export as CSV. The content of changes is not stored. Each entry is linked to the one before, so an entry edited or removed in the database shows up as a broken log.
- **Updates**: the installed and the latest version, release notes, **Download** and **Install now**; where updates come from (the GitHub repository and its read-only token).
- **Figures**: the group name and logo stamped on exported J–V figures and box plots, one for the whole app. Everyone chooses per export whether to include it.
