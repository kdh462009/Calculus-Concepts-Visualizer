#!/usr/bin/env bash
# Build Calc BC Visualizers (.app) and a distributable DMG in dist/.
# Run: ./scripts/build_macos_app.sh
# Optional: SIGN_IDENTITY="Developer ID Application: …" ./scripts/build_macos_app.sh
set -euo pipefail

APP_NAME="CalcBCVisualizers"
VOL_NAME="Concept Visualizers"
ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
DIST_DIR="$ROOT_DIR/dist"
DMG_PATH="$DIST_DIR/${APP_NAME}-macos.dmg"
ZIP_PATH="$DIST_DIR/${APP_NAME}-macos.zip"
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
  --distpath "$DIST_DIR" \
  --workpath "$ROOT_DIR/build" \
  CalcBCVisualizers.spec

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

echo "Creating zip..."
rm -f "$ZIP_PATH"
ditto -c -k --keepParent "$APP_BUNDLE" "$ZIP_PATH"

echo ""
echo "Build complete:"
echo "  App bundle: $APP_BUNDLE"
echo "  DMG image:  $DMG_PATH"
echo "  Zip:        $ZIP_PATH"
echo ""
echo "Share the DMG or zip. Recipients: open, drag ${APP_NAME}.app to Applications."
echo "If Gatekeeper blocks it: right-click the app → Open (unsigned local build)."
