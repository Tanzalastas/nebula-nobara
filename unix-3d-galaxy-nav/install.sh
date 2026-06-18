#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo "NOBARA KDESYNC guided install"
echo "------------------------------"

read -r -p "Create a local .venv with psutil for nicer health stats? [y/N] " venv_answer
if [[ "${venv_answer,,}" == "y" ]]; then
  python3 -m venv .venv
  ./.venv/bin/pip install --upgrade pip >/dev/null
  ./.venv/bin/pip install psutil
  echo "Created .venv with psutil."
fi

read -r -p "Install a KDE application-menu entry (search KDESYNC afterwards)? [y/N] " menu_answer
if [[ "${menu_answer,,}" == "y" ]]; then
  DESKTOP_DIR="$HOME/.local/share/applications"
  mkdir -p "$DESKTOP_DIR"
  sed "s#__INSTALL_DIR__#$SCRIPT_DIR#g" packaging/nobara-kdesync.desktop > "$DESKTOP_DIR/nobara-kdesync.desktop"
  chmod +x "$DESKTOP_DIR/nobara-kdesync.desktop"
  if command -v update-desktop-database >/dev/null 2>&1; then
    update-desktop-database "$DESKTOP_DIR" >/dev/null 2>&1 || true
  fi
  echo "Installed menu entry to $DESKTOP_DIR/nobara-kdesync.desktop"
fi

chmod +x run.sh
echo "Done. Run ./run.sh to start KDESYNC."
