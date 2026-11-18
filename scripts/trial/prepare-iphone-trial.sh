#!/usr/bin/env bash
# Prepares the "Afiyeat Trial" iPhone build: Lists V2 + daily-notification
# settings + 5-photo cap / native capped picker, running on the in-app DEMO
# backend (fixture data kept on the phone). Nothing in it talks to the real
# Afiyeat database, and no backend change is needed or made.
#
# Run on the Mac, from anywhere:
#   bash prepare-iphone-trial.sh            # builds in ~/afiyeat-trial
#   bash prepare-iphone-trial.sh ~/some/dir
# Then, in the Xcode window it opens: pick your iPhone at the top, press Run.
#
# Safe by construction:
#   - Fresh clone of the trial branch in its own folder. Your existing
#     afiyeat checkout, its branches and Lovable are never touched.
#   - Separate app: bundle id com.afiyeat.app.trial, name "Afiyeat Trial",
#     so it installs NEXT TO the real Afiyeat app instead of replacing it.
#   - Push notifications and universal links are removed from this build's
#     entitlements (the trial can't receive pushes or open afiyeat.com links).
#   - The build is checked to contain the demo backend and NOT the production
#     Supabase project before Xcode is opened.
set -euo pipefail

BRANCH="trial/lists-v2-notifications-photos"
REPO="https://github.com/cavigidor/afiyeat.git"
PROD_REF="dmlkjpjubneqhbqoxlct"
DEST="${1:-$HOME/afiyeat-trial}"
MARKER=".afiyeat-trial-build"

say() { printf '\n==> %s\n' "$*"; }
fail() { printf '\nSTOPPED: %s\n' "$*" >&2; exit 1; }

say "Checking tools"
command -v git >/dev/null || fail "git is not installed."
command -v node >/dev/null || fail "Node.js is not installed (needs 20 or newer)."
node -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 20 ? 0 : 1)' || fail "Node.js 20 or newer is needed (found $(node -v))."
if [ "$(uname)" = "Darwin" ] && [ -z "${SKIP_XCODE_CHECK:-}" ]; then
  xcodebuild -version >/dev/null 2>&1 || fail "Xcode is not installed or not selected (xcode-select -s /Applications/Xcode.app)."
fi

say "Getting the trial code into $DEST"
if [ -d "$DEST" ]; then
  [ -f "$DEST/$MARKER" ] || fail "$DEST already exists and wasn't made by this script. Pass a different folder: bash $0 ~/afiyeat-trial-2"
  git -C "$DEST" fetch --depth 1 origin "$BRANCH"
  git -C "$DEST" reset --hard FETCH_HEAD
  git -C "$DEST" clean -fdx -e node_modules -e "$MARKER"
else
  git clone --depth 1 --branch "$BRANCH" "$REPO" "$DEST"
  touch "$DEST/$MARKER"
fi
cd "$DEST"
echo "Trial commit: $(git log -1 --format='%h %s')"

say "Installing packages (a few minutes the first time)"
npm ci --no-audit --no-fund

say "Building the app with the demo backend"
npm run build:demo
rm -rf dist
cp -R dist-demo dist

say "Checking the build can't reach the real database"
if grep -rq "$PROD_REF" dist; then
  fail "the build contains the production Supabase project ($PROD_REF). Nothing was installed."
fi
grep -rq "demo.afiyeat.invalid" dist || fail "the build doesn't contain the demo backend. Nothing was installed."
echo "OK: demo backend only, no production project in the build."

say "Making it a separate app: Afiyeat Trial (com.afiyeat.app.trial)"
perl -pi -e 's/PRODUCT_BUNDLE_IDENTIFIER = com\.afiyeat\.app;/PRODUCT_BUNDLE_IDENTIFIER = com.afiyeat.app.trial;/g' ios/App/App.xcodeproj/project.pbxproj
perl -0pi -e 's#(<key>CFBundleDisplayName</key>\s*<string>)[^<]*(</string>)#${1}Afiyeat Trial${2}#' ios/App/App/Info.plist
cat > ios/App/App/App.entitlements <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict/>
</plist>
PLIST
grep -q "com.afiyeat.app.trial" ios/App/App.xcodeproj/project.pbxproj || fail "couldn't set the trial bundle id."
grep -q "Afiyeat Trial" ios/App/App/Info.plist || fail "couldn't set the trial app name."

say "Copying the build into the iOS project"
npx cap sync ios

cat <<'DONE'

==> Ready.
In Xcode:
  1. Top bar: choose your iPhone (plugged in, or on the same Wi-Fi with
     "Connect via network" set up), not a simulator.
  2. Press Run (the play button). The first time, Xcode registers the new
     app id under your team (Signing & Capabilities > Team: your team).
  3. On the iPhone, the first time only: Settings > General > VPN & Device
     Management > trust your developer certificate, if asked.

"Afiyeat Trial" appears next to the real Afiyeat app, with a DEMO badge.
Its data lives only on the phone: tap Reset on the DEMO badge to start over.
DONE

if [ "$(uname)" = "Darwin" ]; then npx cap open ios; fi
