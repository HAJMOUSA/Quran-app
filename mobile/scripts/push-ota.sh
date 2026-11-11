#!/bin/bash
# Publish a JS/asset-only OTA update to the preview channel (no rebuild/reinstall).
# Applies only to installed builds with a MATCHING runtime version (= app.json "version").
# For native changes (new native module, permissions, SDK bump) you must rebuild the APK.
# Run from WSL Ubuntu:  bash mobile/scripts/push-ota.sh "what changed"
set -euo pipefail
export PATH=/home/hajmousa/.nvm/versions/node/v26.13.0/bin:/usr/bin:/bin
cd "$(dirname "$0")/.."   # -> mobile/

MSG="${1:-JS update}"
eas update --branch preview --environment preview --message "$MSG" --non-interactive
