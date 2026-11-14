#!/bin/bash
# PANOPTICA Setup for macOS (0.48): installs what the Setup app carries in /Library/PANOPTICA (Node for this Mac's processor,
# the helper, PANOPTICA's public key, the uninstaller) and runs the helper, which activates this Mac with the product key,
# downloads the key's package and starts PANOPTICA as a launchd daemon. Needs an administrator: the Setup app runs it after
# macOS asks for the password; IT and tests run it like this:
#   sudo "PANOPTICA Setup.app/Contents/Resources/setup.sh" --key XXXXX-… [--service https://…] [--lan 0] [--dir /Library/PANOPTICA]
set -u
umask 022
RES="$(cd "$(dirname "$0")" && pwd)"
KEY=""; SERVICE="$(cat "$RES/service.txt" 2>/dev/null)"; LAN=1; DIR=/Library/PANOPTICA; PROGRESS=""
while [ $# -gt 0 ]; do
  case "$1" in
    --key) KEY="$2"; shift 2 ;;
    --service) SERVICE="$2"; shift 2 ;;
    --lan) LAN="$2"; shift 2 ;;
    --dir) DIR="$2"; shift 2 ;;
    --progress) PROGRESS="$2"; shift 2 ;;   # the Setup app shows these lines; <file>.done gets the exit code
    *) echo "Unknown option: $1"; exit 2 ;;
  esac
done
say() { echo "$1"; [ -n "$PROGRESS" ] && echo "$1" >> "$PROGRESS"; }
end() { [ -n "$PROGRESS" ] && echo "$1" > "$PROGRESS.done"; exit "$1"; }
[ "$(id -u)" = 0 ] || { say "Failed: run it as an administrator (sudo)"; end 1; }
[ -n "$KEY" ] || { say "Failed: give the product key (--key)"; end 1; }
case "$(uname -m)" in arm64) ARCH=arm64 ;; *) ARCH=x64 ;; esac
[ -x "$RES/node-$ARCH/bin/node" ] || { say "Failed: this Setup has no Node for $(uname -m)"; end 1; }

say "Copying Node and the installer to $DIR"
mkdir -p "$DIR/installer"
# a running PANOPTICA keeps the Node it started with until the helper stops it
rm -rf "$DIR/node.new" && ditto "$RES/node-$ARCH" "$DIR/node.new" && rm -rf "$DIR/node" && mv "$DIR/node.new" "$DIR/node" \
  || { say "Failed: could not copy Node to $DIR"; end 1; }
cp "$RES/helper.cjs" "$RES/release.pub" "$DIR/installer/" || { say "Failed: could not copy the installer to $DIR"; end 1; }
cp "$RES/Uninstall PANOPTICA.command" "$DIR/" && chmod 755 "$DIR/Uninstall PANOPTICA.command"
chown -R root:wheel "$DIR/node" "$DIR/installer"
# downloaded files are marked by macOS; what is installed here is not opened from the internet
xattr -dr com.apple.quarantine "$DIR" 2>/dev/null

"$DIR/node/bin/node" "$DIR/installer/helper.cjs" install --key "$KEY" --service "$SERVICE" --dir "$DIR" --lan "$LAN" 2>&1 \
  | while IFS= read -r l; do say "$l"; done
end "${PIPESTATUS[0]}"
