#!/usr/bin/env bash
# ./reset-password.sh USERNAME NEWPASSWORD   (min 8 characters; works while the app runs)
cd "$(dirname "$(readlink -f "$0")")/apps/server" || exit 1
[ -n "$2" ] || { echo "Usage: ./reset-password.sh USERNAME NEWPASSWORD (min 8 characters)"; exit 1; }
node reset-password.cjs "$1" "$2"
