#!/usr/bin/env bash
# Prepares the "Afiyeat Trial" iPhone build from ONE EXACT, VERIFIED COMMIT.
#
#   bash prepare-iphone-trial.sh <full 40-character commit id>
#
# What it builds: Lists V2 + Profile > Notifications + the 5-photo picker fix,
# running on the in-app DEMO backend (sample data kept on the phone only).
#
# Safety, by construction:
#   - Pinned: downloads exactly the commit you pass and stops if what it got
#     is anything else. No branch names.
#   - Isolated: builds in a NEW folder, ~/AfiyeatTrial/<commit>, and refuses
#     to run if that folder already exists or sits inside another git
#     repository. It never runs git reset, clean, checkout or pull on
#     anything, and never touches your existing Afiyeat folder or Lovable.
#   - Separate app: bundle id com.afiyeat.app.trial, name "Afiyeat Trial",
#     installed NEXT TO the real Afiyeat app, not over it.
#   - No real backend, no live pushes: the build must contain the demo
#     backend and must NOT contain the production Supabase project; push and
#     universal-link entitlements are removed. All of this is checked on the
#     final iOS project before Xcode opens. Any failed check stops the script.
set -euo pipefail

REPO="https://github.com/cavigidor/afiyeat.git"
PROD_REF="dmlkjpjubneqhbqoxlct"          # production Supabase project id (must NOT appear)
DEMO_MARK="demo.afiyeat.invalid"         # demo backend host (MUST appear)
TRIAL_BUNDLE="com.afiyeat.app.trial"
TRIAL_NAME="Afiyeat Trial"

say()  { printf '\n==> %s\n' "$*"; }
ok()   { printf '    ok: %s\n' "$*"; }
fail() { printf '\nSTOPPED: %s\nNothing was installed. Your other folders were not touched.\n' "$*" >&2; exit 1; }

COMMIT="${1:-}"
[[ "$COMMIT" =~ ^[0-9a-f]{40}$ ]] || fail "pass the full 40-character commit id, e.g. bash $0 0123abcd...(40 chars)"
DEST="${AFIYEAT_TRIAL_DIR:-$HOME/AfiyeatTrial/${COMMIT:0:12}}"

say "1/7 Checking tools"
command -v git >/dev/null || fail "git is not installed."
command -v node >/dev/null || fail "Node.js is not installed (needs 20 or newer): https://nodejs.org"
node -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 20 ? 0 : 1)' || fail "Node.js 20 or newer is needed (found $(node -v))."
ON_MAC=0
if [ "$(uname)" = "Darwin" ]; then
  ON_MAC=1
  xcodebuild -version >/dev/null 2>&1 || fail "Xcode is not installed or not selected. Install Xcode from the App Store, open it once, then run: sudo xcode-select -s /Applications/Xcode.app"
fi
ok "git, Node $(node -v)$([ $ON_MAC = 1 ] && echo ", $(xcodebuild -version | head -1)")"

say "2/7 Making a new, separate folder: $DEST"
[ -e "$DEST" ] && fail "$DEST already exists. This script never reuses or overwrites a folder. Delete it yourself if it's an old trial, or run with AFIYEAT_TRIAL_DIR=~/AfiyeatTrial/another-name"
PARENT="$(dirname "$DEST")"
mkdir -p "$PARENT"
if git -C "$PARENT" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  fail "$PARENT is inside a git repository ($(git -C "$PARENT" rev-parse --show-toplevel)). Choose a folder outside your projects."
fi
mkdir "$DEST"
ok "created (empty)"

say "3/7 Downloading exactly commit $COMMIT"
git -C "$DEST" init -q
git -C "$DEST" remote add origin "$REPO"
git -C "$DEST" fetch -q --depth 1 origin "$COMMIT" || fail "couldn't download commit $COMMIT from $REPO."
git -C "$DEST" -c advice.detachedHead=false checkout -q FETCH_HEAD
GOT="$(git -C "$DEST" rev-parse HEAD)"
[ "$GOT" = "$COMMIT" ] || fail "downloaded $GOT, expected $COMMIT."
ok "HEAD is $GOT ($(git -C "$DEST" log -1 --format='%s' | cut -c1-70))"
cd "$DEST"

say "4/7 Installing packages (a few minutes the first time)"
npm ci --no-audit --no-fund --loglevel=error

say "5/7 Building the app with the demo backend"
npm run build:demo --silent
rm -rf dist
cp -R dist-demo dist
grep -rq "$PROD_REF" dist && fail "the web build contains the production Supabase project."
grep -rq "$DEMO_MARK" dist || fail "the web build doesn't contain the demo backend."
ok "web build: demo backend only"

say "6/7 Making it a separate app ($TRIAL_NAME, $TRIAL_BUNDLE) and copying it into the iOS project"
perl -pi -e 's/PRODUCT_BUNDLE_IDENTIFIER = com\.afiyeat\.app;/PRODUCT_BUNDLE_IDENTIFIER = com.afiyeat.app.trial;/g' ios/App/App.xcodeproj/project.pbxproj
perl -0pi -e 's#(<key>CFBundleDisplayName</key>\s*<string>)[^<]*(</string>)#${1}Afiyeat Trial${2}#' ios/App/App/Info.plist
cat > ios/App/App/App.entitlements <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict/>
</plist>
PLIST
npx cap sync ios >/dev/null

say "7/7 Checking the final iOS build target before opening Xcode"
PBX=ios/App/App.xcodeproj/project.pbxproj
[ "$(grep -c "PRODUCT_BUNDLE_IDENTIFIER = $TRIAL_BUNDLE;" "$PBX")" -ge 2 ] || fail "bundle id isn't $TRIAL_BUNDLE in both Debug and Release."
grep -q "PRODUCT_BUNDLE_IDENTIFIER = com.afiyeat.app;" "$PBX" && fail "the real app's bundle id is still in the project."
ok "bundle id: $TRIAL_BUNDLE (Debug and Release)"
grep -A1 "CFBundleDisplayName" ios/App/App/Info.plist | grep -q "$TRIAL_NAME" || fail "app name isn't $TRIAL_NAME."
ok "app name on the home screen: $TRIAL_NAME"
grep -Eq "aps-environment|associated-domains" ios/App/App/App.entitlements && fail "push or universal-link entitlements are still present."
ok "entitlements: none (no push, no afiyeat.com links)"
[ -f ios/App/App/public/index.html ] || fail "the web build wasn't copied into the iOS project."
grep -rq "$PROD_REF" ios/App/App/public && fail "the iOS project's web files contain the production Supabase project."
grep -rq "$DEMO_MARK" ios/App/App/public || fail "the iOS project's web files don't contain the demo backend."
grep -q '"url"' ios/App/App/capacitor.config.json && fail "capacitor.config.json points the app at a remote server."
ok "iOS web files: demo backend only, no production project, no remote server"
if [ $ON_MAC = 1 ]; then
  SETTINGS="$(xcodebuild -project ios/App/App.xcodeproj -target App -configuration Debug -showBuildSettings 2>/dev/null || true)"
  echo "$SETTINGS" | grep -Eq "^\s*PRODUCT_BUNDLE_IDENTIFIER = $TRIAL_BUNDLE$" || fail "Xcode resolves a different bundle id than $TRIAL_BUNDLE."
  ok "Xcode's own build settings: PRODUCT_BUNDLE_IDENTIFIER = $TRIAL_BUNDLE"
fi

cat <<DONE

==> Ready: Afiyeat Trial, commit ${COMMIT:0:12}, in $DEST

In Xcode (opening now):
  1. Plug in your iPhone (or have it on the same Wi-Fi with "Connect via
     network" set up). Unlock it.
  2. Top bar, device menu: pick your iPhone (not a simulator).
  3. Click the App target > Signing & Capabilities > Team: choose your team
     if it's blank. Leave "Automatically manage signing" on.
  4. Press Run (the play button).
  5. First time only, on the iPhone: Settings > Privacy & Security >
     Developer Mode > On (restart), and/or Settings > General >
     VPN & Device Management > trust your developer certificate.

"Afiyeat Trial" appears next to the real Afiyeat app, with a DEMO badge.
All its data stays on the phone; tap Reset on the DEMO badge to start over.
To remove it: delete the app from the home screen and this folder.
DONE

if [ $ON_MAC = 1 ]; then open ios/App/App.xcodeproj; fi
