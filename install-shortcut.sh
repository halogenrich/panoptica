#!/usr/bin/env bash
# Linux desktop integration for Perovskite Lab.
#   ./install-shortcut.sh             app-menu entries "Perovskite Lab" and "Perovskite Lab (network)"
#   ./install-shortcut.sh --service   run in the background as a user service, started at boot (no window to keep open)
#   ./install-shortcut.sh --remove    remove the menu entries and the service
DIR="$(dirname "$(readlink -f "$0")")"; cd "$DIR" || exit 1
APPS="${XDG_DATA_HOME:-$HOME/.local/share}/applications"; UNIT="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user/perovskite-lab.service"
q() { printf '%s' "$1" | sed 's/[\\"`$]/\\&/g'; }  # quoting for Exec=

entry() { # file name, cmd
  cat > "$APPS/$1.desktop" <<DESK
[Desktop Entry]
Type=Application
Name=$2
Comment=Plan and record perovskite solar cell fabrication
Exec=bash -c "cd \\"$(q "$DIR")\\" && ./start.sh $3"
Icon=$DIR/docs/icon.svg
Terminal=true
Categories=Science;Education;
DESK
}

case "$1" in
  --remove)
    rm -f "$APPS/perovskite-lab.desktop" "$APPS/perovskite-lab-lan.desktop"
    if [ -f "$UNIT" ]; then systemctl --user disable --now perovskite-lab 2>/dev/null; rm -f "$UNIT"; systemctl --user daemon-reload; fi
    echo "Removed the menu entries and the background service (your data and backups are untouched)." ;;
  --service)
    LAN=""; [ "$2" = "lan" ] && LAN="lan"
    mkdir -p "$(dirname "$UNIT")"
    cat > "$UNIT" <<SVC
[Unit]
Description=Perovskite Lab
After=network-online.target

[Service]
WorkingDirectory=$DIR
Environment=OPEN_BROWSER=0
Environment=PATH=$(dirname "$(command -v node)"):/usr/local/bin:/usr/bin:/bin
ExecStart=$DIR/start.sh $LAN
Restart=on-failure
RestartSec=5

[Install]
WantedBy=default.target
SVC
    systemctl --user daemon-reload && systemctl --user enable --now perovskite-lab || { echo "Could not start the service."; exit 1; }
    loginctl enable-linger "$USER" 2>/dev/null && echo "It also starts at boot, before anyone logs in." || echo "It starts when you log in. To start it at boot without logging in: sudo loginctl enable-linger $USER"
    echo "Running in the background at http://localhost:${PORT:-3000}"
    echo "  status: systemctl --user status perovskite-lab    log: journalctl --user -u perovskite-lab -f"
    echo "  stop:   systemctl --user stop perovskite-lab      (stop it before ./restore.sh; ./update.sh restarts it)" ;;
  *)
    mkdir -p "$APPS"
    entry perovskite-lab "Perovskite Lab" ""
    entry perovskite-lab-lan "Perovskite Lab (network)" "lan"
    chmod +x "$APPS"/perovskite-lab*.desktop
    update-desktop-database "$APPS" >/dev/null 2>&1
    echo "Added \"Perovskite Lab\" and \"Perovskite Lab (network)\" to the app menu (press Super and type Perovskite)."
    echo "For a lab server that runs without a window: ./install-shortcut.sh --service   (or --service lan)" ;;
esac
