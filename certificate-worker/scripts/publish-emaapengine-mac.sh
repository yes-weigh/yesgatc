#!/usr/bin/env bash
set -euo pipefail

RID="${1:-osx-arm64}"
CONFIG="${2:-Release}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT="$SCRIPT_DIR/../Yesgatc.EmaapEngine"
PUBLISH_ROOT="$SCRIPT_DIR/../publish"
OUT="$PUBLISH_ROOT/EmaapEngine-$RID"
APP="$OUT/EmaapEngine.app"
ZIP="$PUBLISH_ROOT/EmaapEngine-$RID.zip"

rm -rf "$OUT"
mkdir -p "$PUBLISH_ROOT"

dotnet publish "$PROJECT" \
  -c "$CONFIG" \
  -r "$RID" \
  --self-contained true \
  -o "$OUT/payload" \
  /p:PublishSingleFile=false \
  /p:DebugType=none \
  /p:DebugSymbols=false

NODE_RID="darwin-arm64"
if [[ "$RID" == "osx-x64" ]]; then
  NODE_RID="darwin-x64"
fi
PLAY_NODE="$OUT/payload/.playwright/node/$NODE_RID/node"
PLAY_CLI="$OUT/payload/.playwright/package/cli.js"
export PLAYWRIGHT_BROWSERS_PATH="$OUT/payload/ms-playwright"
if [[ -x "$PLAY_NODE" && -f "$PLAY_CLI" ]]; then
  chmod +x "$PLAY_NODE"
  (cd "$OUT/payload" && "$PLAY_NODE" "$PLAY_CLI" install chromium)
elif [[ -f "$OUT/payload/playwright.sh" ]]; then
  chmod +x "$OUT/payload/playwright.sh"
  (cd "$OUT/payload" && ./playwright.sh install chromium)
fi

mkdir -p "$APP/Contents/MacOS"
mkdir -p "$APP/Contents/Resources"
cp -R "$OUT/payload/." "$APP/Contents/MacOS/"
chmod +x "$APP/Contents/MacOS/EmaapEngine"

cat > "$APP/Contents/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key>
  <string>EmaapEngine</string>
  <key>CFBundleDisplayName</key>
  <string>EmaapEngine</string>
  <key>CFBundleIdentifier</key>
  <string>in.yesgatc.emaapengine</string>
  <key>CFBundleVersion</key>
  <string>1.0.64</string>
  <key>CFBundleShortVersionString</key>
  <string>1.0.64</string>
  <key>CFBundleExecutable</key>
  <string>EmaapEngine</string>
  <key>CFBundlePackageType</key>
  <string>APPL</string>
  <key>LSMinimumSystemVersion</key>
  <string>12.0</string>
  <key>NSHighResolutionCapable</key>
  <true/>
</dict>
</plist>
PLIST

rm -f "$ZIP"
(
  cd "$OUT"
  zip -qry "$ZIP" EmaapEngine.app
)

echo "Mac EmaapEngine: $ZIP"
