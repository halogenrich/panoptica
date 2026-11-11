#!/usr/bin/env bash
# Update from a downloaded panoptica*.zip (or perovskite-lab*.zip, as releases before 0.36 were called) (newest in the app's updates folder or ~/Downloads, or give the path).
# Keeps the data; backs up the database first.   ./update.sh [zip] [restart] [lan]
#   restart: started by the app itself (Admin settings › Updates): waits for the app to stop, then starts it again.
cd "${PSC_ROOT:-$(dirname "$(readlink -f "$0")")}" || exit 1
pause() { [ -t 0 ] && [ -t 1 ] && read -rp "Press Enter to close "; }
fail() { echo "$1"; pause; exit 1; }
DL=$(xdg-user-dir DOWNLOAD 2>/dev/null); [ -d "$DL" ] || DL="$HOME/Downloads"
ZIP="$1"; MODE="$2"; NET="$3"
[ -z "$ZIP" ] && ZIP=$(ls -t updates/panoptica*.zip updates/perovskite-lab*.zip "$DL"/panoptica*.zip "$DL"/perovskite-lab*.zip 2>/dev/null | head -1)
[ -n "$ZIP" ] && [ -f "$ZIP" ] || fail "No panoptica*.zip found in $DL. Usage: ./update.sh [path/to/panoptica.zip]"
free() { PORT=${PORT:-3000} node -e "require('net').createServer().once('error',()=>process.exit(1)).listen(+process.env.PORT,'127.0.0.1',function(){this.close(()=>process.exit(0))})"; }
if [ "$MODE" = restart ]; then for _ in $(seq 60); do free && break; sleep 1; done; fi
PORT=${PORT:-3000} node -e "require('net').createServer().once('error',()=>process.exit(1)).listen(+process.env.PORT,'127.0.0.1',function(){this.close(()=>process.exit(0))})" \
  || fail "The app is running. Stop it first (Ctrl+C in its window, or: systemctl --user stop perovskite-lab), then run the update again."
OLD=$(node -p "require('./package.json').version")
echo "Current version: $OLD"; echo "Update file:     $ZIP"
# starts the app again: the background service when there is one, this window otherwise
again() {
  rm -f updates/restarting
  if systemctl --user is-enabled perovskite-lab >/dev/null 2>&1; then
    echo "Restarting the background service..."; systemctl --user start perovskite-lab && echo "Running at http://localhost:${PORT:-3000}"; pause; exit "${1:-0}"
  fi
  echo "Starting..."
  exec ./start.sh $NET
}
# only packages signed by PANOPTICA are installed (the signature file sits next to the zip)
if ! node tools/verify-package.cjs "$ZIP"; then
  echo "Nothing was changed."
  [ "$MODE" = restart ] && again 1   # the app stopped for this update: it runs again, on the version it had
  pause; exit 1
fi
if [ -f apps/server/data.db ]; then (cd apps/server && node db-tools.cjs backup update) || fail "Backup failed; nothing was changed."; fi
TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT
if command -v unzip >/dev/null; then unzip -q "$ZIP" -d "$TMP"; else python3 -m zipfile -e "$ZIP" "$TMP"; fi || fail "Could not read the zip."
NEW="$TMP/panoptica"; [ -d "$NEW" ] || NEW="$TMP/perovskite-lab"; [ -f "$NEW/package.json" ] || fail "This zip is not a PANOPTICA update."
rm -rf "$NEW/node_modules" "$NEW/backups" "$NEW"/apps/server/data.db*                 # never overwrite data
# the built folders are mirrored (files removed in a release go too); the old ones are kept aside until the copy succeeds
SRC="apps/web/dist apps/server/dist"
for d in $SRC; do [ -d "$d" ] && mkdir -p "$TMP/old/$(dirname "$d")" && mv "$d" "$TMP/old/$d"; done
if ! cp -a "$NEW/." ./; then
  for d in $SRC; do [ -d "$TMP/old/$d" ] && rm -rf "./$d" && mv "$TMP/old/$d" "./$d"; done
  fail "Copy failed; the previous version was put back."
fi
chmod +x ./*.sh ./*.command 2>/dev/null
echo "Updated: $OLD -> $(node -p "require('./package.json').version")"
again
