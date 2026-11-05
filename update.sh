#!/usr/bin/env bash
# Update from a downloaded perovskite-lab*.zip (newest in ~/Downloads, or give the path). Keeps the data; backs up the database first.
cd "$(dirname "$(readlink -f "$0")")" || exit 1
pause() { [ -t 0 ] && [ -t 1 ] && read -rp "Press Enter to close "; }
fail() { echo "$1"; pause; exit 1; }
DL=$(xdg-user-dir DOWNLOAD 2>/dev/null); [ -d "$DL" ] || DL="$HOME/Downloads"
ZIP="$1"; [ -z "$ZIP" ] && ZIP=$(ls -t "$DL"/perovskite-lab*.zip 2>/dev/null | head -1)
[ -n "$ZIP" ] && [ -f "$ZIP" ] || fail "No perovskite-lab*.zip found in $DL. Usage: ./update.sh [path/to/perovskite-lab.zip]"
PORT=${PORT:-3000} node -e "require('net').createServer().once('error',()=>process.exit(1)).listen(+process.env.PORT,'127.0.0.1',function(){this.close(()=>process.exit(0))})" \
  || fail "The app is running. Stop it first (Ctrl+C in its window, or: systemctl --user stop perovskite-lab), then run the update again."
OLD=$(node -p "require('./package.json').version")
echo "Current version: $OLD"; echo "Update file:     $ZIP"
if [ -f apps/server/data.db ]; then (cd apps/server && node db-tools.cjs backup update) || fail "Backup failed; nothing was changed."; fi
TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT
if command -v unzip >/dev/null; then unzip -q "$ZIP" -d "$TMP"; else python3 -m zipfile -e "$ZIP" "$TMP"; fi || fail "Could not read the zip."
NEW="$TMP/perovskite-lab"; [ -f "$NEW/package.json" ] || fail "This zip is not a Perovskite Lab update."
rm -rf "$NEW/node_modules" "$NEW/backups" "$NEW"/apps/server/data.db*                 # never overwrite data
# source folders are mirrored (files removed in a release go too); the old ones are kept aside until the copy succeeds
SRC="apps/web/src apps/server/src packages/core/src packages/schema/src"
for d in $SRC; do [ -d "$d" ] && mkdir -p "$TMP/old/$(dirname "$d")" && mv "$d" "$TMP/old/$d"; done
if ! cp -a "$NEW/." ./; then
  for d in $SRC; do [ -d "$TMP/old/$d" ] && rm -rf "./$d" && mv "$TMP/old/$d" "./$d"; done
  fail "Copy failed; the previous version was put back."
fi
chmod +x ./*.sh ./*.command 2>/dev/null
echo "Updated: $OLD -> $(node -p "require('./package.json').version")"
if systemctl --user is-enabled perovskite-lab >/dev/null 2>&1; then
  echo "Restarting the background service..."; systemctl --user start perovskite-lab && echo "Running at http://localhost:$PORT"; pause; exit 0
fi
echo "Starting..."
exec ./start.sh
