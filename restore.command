#!/bin/bash
cd "$(dirname "$0")"
if lsof -iTCP:3000 -sTCP:LISTEN >/dev/null 2>&1; then echo "The app is running. Close its window first, then run the restore again."; read -p "Press Enter"; exit 1; fi
cd apps/server && node db-tools.cjs restore "$1"
read -p "Press Enter to close"
