#!/usr/bin/env bash
# Install a Verqury desktop launcher (app menu + optional desktop icon) that runs
# the built AppImage with the droplet icon. Idempotent. No sudo required.
set -euo pipefail

repo="$(cd "$(dirname "$0")/.." && pwd)"
appimage="$(ls -t "$repo"/app/dist/Verqury-*.AppImage 2>/dev/null | head -1 || true)"
if [ -z "$appimage" ]; then
  echo "No AppImage found in app/dist/. Run:  npm run dist -w app" >&2
  exit 1
fi

apps_dir="$HOME/Applications"
icon_dir="$HOME/.local/share/icons"
desk_dir="$HOME/.local/share/applications"
mkdir -p "$apps_dir" "$icon_dir" "$desk_dir"

# Stable copy so rebuilds in app/dist/ don't break the launcher.
install -m 0755 "$appimage" "$apps_dir/Verqury.AppImage"
install -m 0644 "$repo/app/renderer/assets/icon.png" "$icon_dir/verqury.png"

# AppImages need libfuse2; fall back to extract-and-run when it's absent.
if ldconfig -p 2>/dev/null | grep -q 'libfuse\.so\.2'; then
  exec_line="$apps_dir/Verqury.AppImage"
else
  exec_line="$apps_dir/Verqury.AppImage --appimage-extract-and-run"
fi

desktop="$desk_dir/verqury.desktop"
cat > "$desktop" <<EOF
[Desktop Entry]
Type=Application
Name=Verqury
GenericName=AI product workflow layer
Comment=Layer, not IDE — a workflow companion for AI-assisted product development
Exec=$exec_line
Icon=$icon_dir/verqury.png
Terminal=false
Categories=Development;Utility;
StartupWMClass=Verqury
EOF
chmod +x "$desktop"

update-desktop-database "$desk_dir" 2>/dev/null || true
echo "Installed launcher: $desktop"
echo "  runs: $exec_line"
echo "Tip: copy it to ~/Desktop for a clickable desktop icon:  cp \"$desktop\" ~/Desktop/"
