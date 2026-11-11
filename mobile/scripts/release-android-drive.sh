#!/bin/bash
# Build the Android release APK on EAS and upload it to Google Drive.
# Run from WSL Ubuntu:  bash mobile/scripts/release-android-drive.sh
# Requires: eas-cli (WSL, logged in as ahajmousa) + rclone (Windows, remote "gdrive:").
set -euo pipefail

RCLONE='/mnt/c/Users/ahajmousa/AppData/Local/Microsoft/WinGet/Packages/Rclone.Rclone_Microsoft.Winget.Source_8wekyb3d8bbwe/rclone-v1.76.0-windows-amd64/rclone.exe'
DRIVE_DIR='gdrive:quran-app-apks'
export PATH=/home/hajmousa/.nvm/versions/node/v26.13.0/bin:/usr/bin:/bin

cd "$(dirname "$0")/.."   # -> mobile/

VER=$(grep -oP '"version":\s*"\K[^"]+' app.json | head -1)
STAMP=$(date +%Y%m%d-%H%M)
NAME="quran-app-v${VER}-${STAMP}.apk"

echo ">> Building Android APK (preview profile) on EAS ..."
JSON=$(eas build -p android --profile preview --non-interactive --json)
URL=$(echo "$JSON" | grep -oP '"applicationArchiveUrl":\s*"\K[^"]+' | head -1)
BID=$(echo "$JSON" | grep -oP '"id":\s*"\K[0-9a-f-]{36}' | head -1)
PAGE="https://expo.dev/accounts/ahajmousa/projects/mobile/builds/${BID}"
if [ -z "$URL" ]; then
  echo "!! Could not find APK URL in build output" >&2
  echo "$JSON" >&2
  exit 1
fi
echo ">> APK: $URL"

echo ">> Uploading to $DRIVE_DIR/$NAME ..."
"$RCLONE" copyurl "$URL" "$DRIVE_DIR/$NAME"
LINK=$("$RCLONE" link "$DRIVE_DIR/$NAME" 2>/dev/null | grep -v NOTICE || true)

echo ""
echo ">> Done."
echo "   Drive file     : $DRIVE_DIR/$NAME"
echo "   Drive link     : $LINK"
echo "   QR install page: $PAGE   <- open on the EAS page, scan the QR with the Android camera to install"
