#!/bin/bash
cd "${PSC_ROOT:-$(dirname "$0")}"
# ./update.command [zip] [restart] [lan]   restart: started by the app (Admin settings › Updates), waits for it to stop, then starts it again
ZIP="$1"; MODE="$2"; NET="$3"
# starts the app again, in a window
back() {
  rm -f updates/restarting
  echo "Starting..."
  if [ "$NET" = lan ] && [ -x ./start-network.command ]; then exec ./start-network.command; fi
  exec ./start.command
}
fail() { echo "$1"; read -p "Press Enter"; exit 1; }
[ -z "$ZIP" ] && ZIP=$(ls -t updates/panoptica*.zip updates/perovskite-lab*.zip "$HOME"/Downloads/panoptica*.zip "$HOME"/Downloads/perovskite-lab*.zip 2>/dev/null | head -1)
if [ "$MODE" = restart ]; then for _ in $(seq 60); do lsof -iTCP:${PORT:-3000} -sTCP:LISTEN >/dev/null 2>&1 || break; sleep 1; done; fi
[ -z "$ZIP" ] && fail "No panoptica*.zip found in Downloads. Usage: ./update.command [path/to/zip]"
if lsof -iTCP:${PORT:-3000} -sTCP:LISTEN >/dev/null 2>&1; then fail "The app is running. Close its window first, then run the update again."; fi
OLD=$(node -p "require('./package.json').version")
echo "Current version: $OLD"; echo "Update file:     $ZIP"
# only packages signed by PANOPTICA are installed (the signature file sits next to the zip)
if ! node tools/verify-package.cjs "$ZIP"; then
  echo "Nothing was changed."
  [ "$MODE" = restart ] && back 1   # the app stopped for this update: it runs again, on the version it had
  read -p "Press Enter"; exit 1
fi
if [ -f apps/server/data.db ]; then
  if [ -f apps/server/db-tools.cjs ]; then (cd apps/server && node db-tools.cjs backup update)
  else mkdir -p backups && cp apps/server/data.db "backups/data-$(date +%Y%m%d-%H%M%S)-update.db" && echo "Database backed up in the backups folder."; fi
fi
TMP=$(mktemp -d)
unzip -q "$ZIP" -d "$TMP" || fail "Could not read the zip."
# releases before 0.36 were called Perovskite Lab: their zips hold a perovskite-lab folder
NEW="$TMP/panoptica"; [ -d "$NEW" ] || NEW="$TMP/perovskite-lab"
[ -d "$NEW" ] || fail "This zip is not a PANOPTICA update."
rm -rf "$NEW/node_modules" "$NEW/backups" "$NEW/config" "$NEW/updates" "$NEW"/data.db* "$NEW"/apps/server/data.db*   # never overwrite data
# every file is copied (rsync would skip one with the same size and time); the built folders are mirrored, so files removed in
# a release go too, and the old ones are kept aside until the copy succeeds
SRC="apps/web/dist apps/server/dist"
for d in $SRC; do [ -d "$d" ] && mkdir -p "$TMP/old/$(dirname "$d")" && mv "$d" "$TMP/old/$d"; done
if ! cp -R -p "$NEW/." ./; then
  for d in $SRC; do [ -d "$TMP/old/$d" ] && rm -rf "./$d" && mv "$TMP/old/$d" "./$d"; done
  rm -rf "$TMP"; fail "Copy failed; the previous version was put back."
fi
rm -rf "$TMP"
chmod +x ./*.command ./*.sh 2>/dev/null
echo "Updated: $OLD -> $(node -p "require('./package.json').version")"
back
