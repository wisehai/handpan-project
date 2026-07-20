#!/usr/bin/env bash
# Local equivalent of codemagic.yaml's iOS workflow, for when the native
# capacitor-handpan-follow plugin (private repo, linked via
# ios-app/package.json's file: dependency) makes cloud builds impossible —
# Codemagic only has access to this public repo, not the sibling private
# checkout the plugin dependency resolves against. Run this on a Mac with
# both repos checked out as siblings, Xcode installed, and App Store
# Connect API credentials configured (see ios-app/README.md).
#
# Usage: scripts/release-ios-local.sh [marketing_version]
# marketing_version defaults to codemagic.yaml's current APP_VERSION.
set -euo pipefail

repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
cd "$repo_root"

APP_VERSION="${1:-$(sed -n 's/.*APP_VERSION: "\(.*\)"/\1/p' codemagic.yaml)}"
APP_ID=6787988917   # App Store Connect numeric id for com.wisehai.handpan

export PATH="$HOME/Library/Python/3.9/bin:$PATH"

if [ -z "${APP_STORE_CONNECT_ISSUER_ID:-}" ] || [ -z "${APP_STORE_CONNECT_KEY_IDENTIFIER:-}" ]; then
  echo "APP_STORE_CONNECT_ISSUER_ID / APP_STORE_CONNECT_KEY_IDENTIFIER not set." >&2
  echo "Export them (and keep the matching AuthKey_<id>.p8 in ~/.appstoreconnect/private_keys/)" >&2
  echo "before running this script — see ios-app/README.md." >&2
  exit 1
fi

echo "== Copy web app into ios-app/www =="
mkdir -p ios-app/www/vendor/pdfjs
cp handpan-player.html ios-app/www/index.html
cp vendor/pdfjs/pdf.min.js ios-app/www/vendor/pdfjs/pdf.min.js
cp vendor/pdfjs/pdf.worker.min.js ios-app/www/vendor/pdfjs/pdf.worker.min.js

echo "== Install npm dependencies =="
(cd ios-app && npm ci)

echo "== Add iOS platform (regenerated fresh — see ios-app/README.md) =="
rm -rf ios-app/ios
(cd ios-app && npx cap add ios)

echo "== Patch the regenerated Info.plist (mic usage, export compliance) =="
plutil -replace NSMicrophoneUsageDescription \
  -string "跟弹模式需要使用麦克风识别你的手碟演奏" \
  ios-app/ios/App/App/Info.plist
plutil -replace ITSAppUsesNonExemptEncryption -bool NO \
  ios-app/ios/App/App/Info.plist

echo "== Restrict target to iPhone only =="
sed -i '' 's/TARGETED_DEVICE_FAMILY = "1,2";/TARGETED_DEVICE_FAMILY = "1";/g' \
  ios-app/ios/App/App.xcodeproj/project.pbxproj

echo "== Generate app icons from assets/ =="
(cd ios-app && npx capacitor-assets generate --ios)

echo "== Sync web assets and Capacitor plugins =="
(cd ios-app && npx cap sync ios)

echo "== Set version and build number =="
build_number=$(( $(app-store-connect get-latest-build-number "$APP_ID" --all-versions) + 1 ))
echo "marketing version: $APP_VERSION, build number: $build_number"
(cd ios-app/ios/App && agvtool new-marketing-version "$APP_VERSION")
(cd ios-app/ios/App && agvtool new-version -all "$build_number")

echo "== Set up code signing (App Store Connect API key must be configured) =="
(cd ios-app && xcode-project use-profiles --archive-method app-store)

echo "== Build .ipa =="
(cd ios-app && xcode-project build-ipa \
  --project "ios/App/App.xcodeproj" \
  --scheme "App" \
  --ipa-directory ios/App/build/ios/ipa)

ipa_path=$(ls ios-app/ios/App/build/ios/ipa/*.ipa | head -1)
echo "== Upload $ipa_path to App Store Connect (lands in TestFlight for internal testers) =="
app-store-connect publish --path "$ipa_path"

echo "Done. Check https://appstoreconnect.apple.com for processing status."
