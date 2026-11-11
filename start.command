#!/bin/bash
cd "$(dirname "$0")"
if ! command -v node >/dev/null || ! node -e "const [a,b]=process.versions.node.split('.').map(Number);process.exit(a>22||(a===22&&b>=13)?0:1)"; then echo "Node.js 22.13 or newer is required (found: $(node -v 2>/dev/null || echo none)): https://nodejs.org"; read -p "Press Enter"; exit 1; fi
echo "PANOPTICA $(node -p "require('./package.json').version")"
# A built package (0.39 and later; built.json marks it) runs as it is: nothing is installed or built on this computer.
BUILT=0; [ -f built.json ] && [ -f apps/server/dist/server.mjs ] && BUILT=1
if [ $BUILT = 1 ] && [ ! -e .git ]; then rm -rf node_modules packages apps/web/src apps/web/public apps/web/node_modules apps/web/index.html apps/web/vite.config.ts apps/web/tsconfig.json apps/web/package.json apps/server/src apps/server/node_modules apps/server/package.json apps/server/tsconfig.json tools/smoke.mjs tools/update-e2e.mjs tools/notes.mjs tools/stamp.cjs tools/package.mjs tools/sign-package.mjs docs/architecture.md package-lock.json tsconfig.base.json eslint.config.js .prettierrc.json .prettierignore .editorconfig .git-blame-ignore-revs 2>/dev/null; fi  # left by an install from source (before 0.39)
if [ $BUILT = 0 ] && ! node tools/stamp.cjs check install; then
  echo "Installing dependencies (first run or after an update)..."
  npm install || { read -p "Install failed. Press Enter"; exit 1; }
  node tools/stamp.cjs save install
fi
if [ $BUILT = 0 ] && ! node tools/stamp.cjs check build; then
  echo "Building the web app..."
  npm run build || { read -p "Build failed. Press Enter"; exit 1; }
  node tools/stamp.cjs save build
fi
export PORT=${PORT:-3000}
export HOST=127.0.0.1
[ "$1" = "lan" ] && export HOST=0.0.0.0
echo; echo "PANOPTICA is starting at http://localhost:$PORT (close this window to stop it)"; echo
if [ "$1" = "lan" ]; then
  echo "Other computers and phones on the same network can open:"
  for i in en0 en1 en2; do ip=$(ipconfig getifaddr $i 2>/dev/null) && [ -n "$ip" ] && echo "  http://$ip:$PORT"; done
  echo "  http://$(scutil --get LocalHostName 2>/dev/null || hostname).local:$PORT"; echo
fi
(sleep 4; open http://localhost:$PORT) &
if [ $BUILT = 1 ]; then cd apps/server && exec node --no-warnings dist/server.mjs; fi
npm start
