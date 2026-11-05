#!/usr/bin/env bash
# Perovskite Lab on Linux (made for Fedora; works on other distributions with bash and Node.js 22.13+).
#   ./start.sh        this computer only (http://localhost:3000)
#   ./start.sh lan    also other computers and phones on the network
# Environment: PORT (3000), OPEN_BROWSER=0 to not open the browser.
cd "$(dirname "$(readlink -f "$0")")" || exit 1
pause() { [ -t 0 ] && [ -t 1 ] && read -rp "Press Enter to close "; }
fail() { echo; echo "$1"; pause; exit 1; }

if ! command -v node >/dev/null || ! node -e "const [a,b]=process.versions.node.split('.').map(Number);process.exit(a>22||(a===22&&b>=13)?0:1)"; then
  fail "Node.js 22.13 or newer is required (found: $(node -v 2>/dev/null || echo none)). On Fedora 41 or newer:  sudo dnf install nodejs npm
On Fedora 40:  sudo dnf install nodejs22 nodejs22-npm   (other systems: https://nodejs.org)"
fi
echo "Perovskite Lab $(node -p "require('./package.json').version")"
for f in Substrate SolutionPrep Spin OrganicEvap MetalEvap Stack Stack3D; do rm -f "apps/web/src/views/$f.tsx"; done  # removed in 0.3.0

# 1) dependencies: first run, or after an update changed a package.json
if ! node tools/stamp.cjs check install; then
  echo "Installing dependencies (first run or after an update; needs internet)..."
  npm install || fail "Install failed. Check the internet connection and try again."
  node tools/stamp.cjs save install
fi
# 2) web app: only when it was never built or its source changed
if ! node tools/stamp.cjs check build; then
  echo "Building the web app..."
  npm run build || fail "Build failed."
  node tools/stamp.cjs save build
fi

export PORT=${PORT:-3000} HOST=127.0.0.1
[ "$1" = "lan" ] && export HOST=0.0.0.0
if ! node -e "require('net').createServer().once('error',()=>process.exit(1)).listen(+process.env.PORT,'127.0.0.1',function(){this.close(()=>process.exit(0))})"; then
  fail "Port $PORT is already in use: the app is probably running already (another terminal, or the background service:
  systemctl --user status perovskite-lab). Open http://localhost:$PORT, or start on another port: PORT=3100 ./start.sh"
fi
echo; echo "Perovskite Lab is starting at http://localhost:$PORT (press Ctrl+C or close this window to stop it)"
if [ "$1" = "lan" ]; then
  echo "Other computers and phones on the same network can open:"
  for ip in $(ip -4 -o addr show scope global 2>/dev/null | awk '{print $4}' | cut -d/ -f1); do echo "  http://$ip:$PORT"; done
  echo "  http://$(hostname 2>/dev/null || cat /etc/hostname).local:$PORT"
  if command -v firewall-cmd >/dev/null; then
    echo "If they cannot connect, open the port in the firewall once (Fedora):"
    echo "  sudo firewall-cmd --permanent --add-port=$PORT/tcp && sudo firewall-cmd --reload"
  fi
fi
echo
if [ "${OPEN_BROWSER:-1}" != 0 ] && command -v xdg-open >/dev/null && [ -n "$DISPLAY$WAYLAND_DISPLAY" ]; then
  (sleep 4; xdg-open "http://localhost:$PORT" >/dev/null 2>&1) &
fi
exec npm start
