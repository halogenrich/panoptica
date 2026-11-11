#!/bin/bash
cd "${PSC_ROOT:-$(dirname "$0")}"
# ./update.command [zip] [restart] [lan]   restart: started by the app (Admin settings › Updates), waits for it to stop, then starts it again
ZIP="$1"; MODE="$2"; NET="$3"
[ -z "$ZIP" ] && ZIP=$(ls -t updates/panoptica*.zip updates/perovskite-lab*.zip "$HOME"/Downloads/panoptica*.zip "$HOME"/Downloads/perovskite-lab*.zip 2>/dev/null | head -1)
if [ "$MODE" = restart ]; then for _ in $(seq 60); do lsof -iTCP:3000 -sTCP:LISTEN >/dev/null 2>&1 || break; sleep 1; done; fi
[ -z "$ZIP" ] && { echo "No panoptica*.zip found in Downloads. Usage: ./update.command [path/to/zip]"; read -p "Press Enter"; exit 1; }
if lsof -iTCP:3000 -sTCP:LISTEN >/dev/null 2>&1; then echo "The app is running. Close its window first, then run the update again."; read -p "Press Enter"; exit 1; fi
OLD=$(node -p "require('./package.json').version")
echo "Current version: $OLD"; echo "Update file:     $ZIP"
# only packages signed by PANOPTICA are installed (the signature file sits next to the zip)
node tools/verify-package.cjs "$ZIP" || { echo "Nothing was changed."; read -p "Press Enter"; exit 1; }
if [ -f apps/server/data.db ]; then
  if [ -f apps/server/db-tools.cjs ]; then (cd apps/server && node db-tools.cjs backup update)
  else mkdir -p backups && cp apps/server/data.db "backups/data-$(date +%Y%m%d-%H%M%S)-update.db" && echo "Database backed up in the backups folder."; fi
fi
TMP=$(mktemp -d)
unzip -q "$ZIP" -d "$TMP" || { echo "Could not read the zip."; read -p "Press Enter"; exit 1; }
# releases before 0.36 were called Perovskite Lab: their zips hold a perovskite-lab folder
NEW="$TMP/panoptica"; [ -d "$NEW" ] || NEW="$TMP/perovskite-lab"
[ -d "$NEW" ] || { echo "This zip is not a PANOPTICA update."; read -p "Press Enter"; exit 1; }
rsync -a --exclude node_modules --exclude backups --exclude config --exclude updates --exclude 'data.db*' "$NEW/" ./
for d in apps/web/dist apps/server/dist; do [ -d "$NEW/$d" ] && rsync -a --delete "$NEW/$d/" "./$d/"; done  # files removed in a release go too
rm -rf "$TMP"
chmod +x ./*.command
echo "Updated: $OLD -> $(node -p "require('./package.json').version")"
rm -f updates/restarting
echo "Starting..."
if [ "$NET" = lan ] && [ -x ./start-network.command ]; then exec ./start-network.command; fi
exec ./start.command
