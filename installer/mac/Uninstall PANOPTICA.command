#!/bin/bash
# Uninstalls PANOPTICA from this Mac (put here by PANOPTICA Setup): the background service stops and goes, and so do the Node
# and the installer Setup put next to this file. The lab's data stays in the panoptica folder here: delete it too to remove
# everything (keep a backup first).
DIR="$(cd "$(dirname "$0")" && pwd)"
if [ "$(id -u)" != 0 ]; then
  echo "Uninstalling PANOPTICA needs an administrator's password."
  exec sudo "$0" "$@"
fi
"$DIR/node/bin/node" "$DIR/installer/helper.cjs" uninstall --dir "$DIR" 2>/dev/null || {
  launchctl bootout system/com.panoptica.server 2>/dev/null
  rm -f /Library/LaunchDaemons/com.panoptica.server.plist
}
rm -rf "$DIR/node" "$DIR/installer" "$DIR/panoptica/run.sh"
rm -f "$0"
echo "PANOPTICA is uninstalled. The lab's data stays in $DIR/panoptica."
if [ -t 0 ]; then read -rp "Press Enter to close "; fi
