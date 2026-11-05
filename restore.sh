#!/usr/bin/env bash
# Restore the database from a backup (the app must be stopped). ./restore.sh [backup file name]
cd "$(dirname "$(readlink -f "$0")")" || exit 1
pause() { [ -t 0 ] && [ -t 1 ] && read -rp "Press Enter to close "; }
PORT=${PORT:-3000} node -e "require('net').createServer().once('error',()=>process.exit(1)).listen(+process.env.PORT,'127.0.0.1',function(){this.close(()=>process.exit(0))})" \
  || { echo "The app is running. Stop it first (Ctrl+C in its window, or: systemctl --user stop perovskite-lab)."; pause; exit 1; }
(cd apps/server && node db-tools.cjs restore "$1")
pause
