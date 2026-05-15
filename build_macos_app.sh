#!/usr/bin/env bash
# Build Calc BC Visualizers (.app) and a distributable DMG in dist/.
# Run: ./build_macos_app.sh
# Optional: SIGN_IDENTITY="Developer ID Application: …" ./build_macos_app.sh
set -euo pipefail

APP_NAME="CalcBCVisualizers"
VOL_NAME="Calc BC Visualizers"
ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
DIST_DIR="$ROOT_DIR/dist"
DMG_PATH="$DIST_DIR/${APP_NAME}.dmg"
STAGING_DIR="$DIST_DIR/dmg-staging"
APP_BUNDLE="$DIST_DIR/${APP_NAME}.app"
SIGN_IDENTITY="${SIGN_IDENTITY:--}"

cd "$ROOT_DIR"
mkdir -p "$DIST_DIR"

echo "Installing Python dependencies..."
python3 -m pip install -r requirements-webapp.txt

echo "Running PyInstaller..."
pyinstaller \
  --noconfirm \
  --clean \
  --windowed \
  --name "$APP_NAME" \
  --distpath "$DIST_DIR" \
  --workpath "$ROOT_DIR/build" \
  --specpath "$ROOT_DIR" \
  --add-data "ui:ui" \
  --hidden-import graph \
  --hidden-import taylor \
  --hidden-import riemann \
  --hidden-import derivatives \
  app.py

if [[ ! -d "$APP_BUNDLE" ]]; then
  echo "error: app bundle not found at $APP_BUNDLE" >&2
  exit 1
fi

echo "Signing app bundle (identity: ${SIGN_IDENTITY})..."
xattr -cr "$APP_BUNDLE"
codesign --force --deep --sign "$SIGN_IDENTITY" "$APP_BUNDLE"
codesign --verify --deep --strict "$APP_BUNDLE"

echo "Creating DMG..."
rm -rf "$STAGING_DIR"
mkdir -p "$STAGING_DIR"
ditto "$APP_BUNDLE" "$STAGING_DIR/${APP_NAME}.app"
ln -sf /Applications "$STAGING_DIR/Applications"

rm -f "$DMG_PATH"
hdiutil create \
  -volname "$VOL_NAME" \
  -srcfolder "$STAGING_DIR" \
  -ov \
  -format UDZO \
  "$DMG_PATH"

rm -rf "$STAGING_DIR"

echo ""
echo "Build complete:"
echo "  App bundle: $APP_BUNDLE"
echo "  DMG image:  $DMG_PATH"
echo ""
echo "To install: open the DMG, drag ${APP_NAME}.app to Applications, then launch from Applications."
