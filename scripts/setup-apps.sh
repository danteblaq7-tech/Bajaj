#!/usr/bin/env bash
# Creates the Expo project files (package.json) for both apps using the official Expo template, so every package
# version matches the current Expo SDK, then installs the native modules these apps use.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

setup() {
  local app="$1"; shift
  if [ -f "$ROOT/apps/$app/package.json" ]; then echo "apps/$app already set up (delete its package.json to redo)"; return; fi
  local tmp; tmp="$(mktemp -d)"
  (cd "$tmp" && npx --yes create-expo-app@latest scaffold --template blank --no-install)
  cp "$tmp/scaffold/package.json" "$ROOT/apps/$app/package.json"
  (cd "$ROOT/apps/$app" && node -e "const f=require('fs'),p=JSON.parse(f.readFileSync('package.json'));p.main='index.js';p.name='pwani-ride-$app';f.writeFileSync('package.json',JSON.stringify(p,null,2))")
  (cd "$ROOT/apps/$app" && npm install && npx expo install "$@")
  rm -rf "$tmp"
}

COMMON="expo-location expo-secure-store expo-status-bar react-native-safe-area-context react-native-maps expo-notifications expo-device expo-constants expo-localization"
setup customer $COMMON expo-web-browser
setup driver $COMMON expo-camera expo-image-picker expo-task-manager
echo "Done. Next: set your Google Maps keys and EAS project id in apps/*/app.json, then see README.md."
