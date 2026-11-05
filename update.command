#!/bin/bash
cd "$(dirname "$0")"
ZIP="$1"
[ -z "$ZIP" ] && ZIP=$(ls -t "$HOME"/Downloads/perovskite-lab*.zip 2>/dev/null | head -1)
[ -z "$ZIP" ] && { echo "No perovskite-lab*.zip found in Downloads. Usage: ./update.command [path/to/zip]"; read -p "Press Enter"; exit 1; }
if lsof -iTCP:3000 -sTCP:LISTEN >/dev/null 2>&1; then echo "The app is running. Close its window first, then run the update again."; read -p "Press Enter"; exit 1; fi
OLD=$(node -p "require('./package.json').version")
echo "Current version: $OLD"; echo "Update file:     $ZIP"
if [ -f apps/server/data.db ]; then
  if [ -f apps/server/db-tools.cjs ]; then (cd apps/server && node db-tools.cjs backup update)
  else mkdir -p backups && cp apps/server/data.db "backups/data-$(date +%Y%m%d-%H%M%S)-update.db" && echo "Database backed up in the backups folder."; fi
fi
TMP=$(mktemp -d)
unzip -q "$ZIP" -d "$TMP" || { echo "Could not read the zip."; read -p "Press Enter"; exit 1; }
[ -d "$TMP/perovskite-lab" ] || { echo "This zip is not a Perovskite Lab update."; read -p "Press Enter"; exit 1; }
rsync -a --exclude node_modules --exclude backups --exclude 'data.db*' "$TMP/perovskite-lab/" ./
for d in apps/web/src apps/server/src packages/core/src packages/schema/src; do rsync -a --delete "$TMP/perovskite-lab/$d/" "./$d/"; done
rm -rf "$TMP"
chmod +x ./*.command
echo "Updated: $OLD -> $(node -p "require('./package.json').version")"
echo "Starting..."
exec ./start.command
