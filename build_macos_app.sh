#!/usr/bin/env bash
set -euo pipefail

APP_NAME="TaylorSeries"
ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
DIST_DIR="$ROOT_DIR/dist"
DMG_NAME="${APP_NAME}.dmg"

cd "$ROOT_DIR"

python3 -m pip install -r "requirements-webapp.txt"

pyinstaller \
  --noconfirm \
  --windowed \
  --name "$APP_NAME" \
  --add-data "ui:ui" \
  "app.py"

APP_BUNDLE="$DIST_DIR/${APP_NAME}.app"
if [[ ! -d "$APP_BUNDLE" ]]; then
  echo "Expected app bundle not found at $APP_BUNDLE"
  exit 1
fi

rm -f "$DIST_DIR/$DMG_NAME"
hdiutil create -volname "$APP_NAME" -srcfolder "$APP_BUNDLE" -ov -format UDZO "$DIST_DIR/$DMG_NAME"

echo "Build complete:"
echo "  App bundle: $APP_BUNDLE"
echo "  DMG image:  $DIST_DIR/$DMG_NAME"
