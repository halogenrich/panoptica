#!/bin/bash
cd "$(dirname "$0")"
if ! command -v node >/dev/null || ! node -e "const [a,b]=process.versions.node.split('.').map(Number);process.exit(a>22||(a===22&&b>=13)?0:1)"; then echo "Node.js 22.13 or newer is required (found: $(node -v 2>/dev/null || echo none)): https://nodejs.org"; read -p "Press Enter"; exit 1; fi
echo "Perovskite Lab $(node -p "require('./package.json').version")"
for f in Substrate SolutionPrep Spin OrganicEvap MetalEvap Stack Stack3D; do rm -f "apps/web/src/views/$f.tsx"; done  # removed in 0.3.0
if ! node tools/stamp.cjs check install; then
  echo "Installing dependencies (first run or after an update)..."
  npm install || { read -p "Install failed. Press Enter"; exit 1; }
  node tools/stamp.cjs save install
fi
if ! node tools/stamp.cjs check build; then
  echo "Building the web app..."
  npm run build || { read -p "Build failed. Press Enter"; exit 1; }
  node tools/stamp.cjs save build
fi
export PORT=${PORT:-3000}
export HOST=127.0.0.1
[ "$1" = "lan" ] && export HOST=0.0.0.0
echo; echo "Perovskite Lab is starting at http://localhost:$PORT (close this window to stop it)"; echo
if [ "$1" = "lan" ]; then
  echo "Other computers and phones on the same network can open:"
  for i in en0 en1 en2; do ip=$(ipconfig getifaddr $i 2>/dev/null) && [ -n "$ip" ] && echo "  http://$ip:$PORT"; done
  echo "  http://$(scutil --get LocalHostName 2>/dev/null || hostname).local:$PORT"; echo
fi
(sleep 4; open http://localhost:$PORT) &
npm start
