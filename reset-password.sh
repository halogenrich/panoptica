#!/usr/bin/env bash
# ./reset-password.sh USERNAME NEWPASSWORD   (min 10 characters; works while the app runs)
DIR="$(cd "$(dirname "$0")" && pwd -P)"
# installed by PANOPTICA Setup on a Mac: its own Node sits next to the app folder (run it with sudo)
[ -x "$DIR/../node/bin/node" ] && PATH="$DIR/../node/bin:$PATH"
cd "$DIR/apps/server" || exit 1
[ -n "$2" ] || { echo "Usage: ./reset-password.sh USERNAME NEWPASSWORD (min 10 characters)"; exit 1; }
node reset-password.cjs "$1" "$2"
