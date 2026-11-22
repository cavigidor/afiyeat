#!/usr/bin/env bash
# Prepares the "Afiyeat Sign-in Test" iPhone build from ONE EXACT COMMIT of
# the social sign-in branch, for testing Sign in with Apple / Continue with
# Google on a physical iPhone.
#
#   bash prepare-social-auth-trial.sh <full 40-character commit id> [--apple-browser]
#
#   --apple-browser  Run Apple in the secure browser sheet instead of the
#                    native sheet. Use it if the backend's Apple Client ID
#                    list can't include com.afiyeat.app.authtest.
#
# IMPORTANT: sign-in can only be tested against the REAL backend (that's
# where Apple and Google are configured), so this build uses PRODUCTION.
# Accounts you create while testing are real: delete them afterwards from
# Profile > Delete account. Rotate the Afiyeat password before testing
# with real accounts (PM decision 2026-11-20).
#
# Safety, by construction (same rules as prepare-iphone-trial.sh):
#   - Pinned: downloads exactly the commit you pass and stops on mismatch.
#   - Isolated: a NEW folder ~/AfiyeatTrial/social-<commit>; refuses an
#     existing folder or one inside a git repository. Never runs git reset,
#     clean, checkout or pull on anything else, never touches Lovable, your
#     Afiyeat folder, the RC2/RC3 folders, or the installed RC3 app.
#   - Separate app: bundle id com.afiyeat.app.authtest, name "Afiyeat
#     Sign-in Test", installed NEXT TO the real/RC3 app, not over it.
#   - Entitlements: Sign in with Apple only - no push, no afiyeat.com links.
set -euo pipefail

REPO="https://github.com/cavigidor/afiyeat.git"
PROD_REF="dmlkjpjubneqhbqoxlct"          # production backend (MUST appear: sign-in lives there)
TEST_BUNDLE="com.afiyeat.app.authtest"
TEST_NAME="Afiyeat Sign-in Test"

say()  { printf '\n==> %s\n' "$*"; }
ok()   { printf '    ok: %s\n' "$*"; }
fail() { printf '\nSTOPPED: %s\nNothing was installed. Your other folders were not touched.\n' "$*" >&2; exit 1; }

COMMIT="${1:-}"
APPLE_MODE="native"
[ "${2:-}" = "--apple-browser" ] && APPLE_MODE="browser"
[ -n "${2:-}" ] && [ "$APPLE_MODE" != "browser" ] && fail "unknown option ${2}. The only option is --apple-browser."
[[ "$COMMIT" =~ ^[0-9a-f]{40}$ ]] || fail "pass the full 40-character commit id, e.g. bash $0 0123abcd...(40 chars)"
DEST="${AFIYEAT_TRIAL_DIR:-$HOME/AfiyeatTrial/social-${COMMIT:0:12}}"

say "1/7 Checking tools"
command -v git >/dev/null || fail "git is not installed."
command -v node >/dev/null || fail "Node.js is not installed (needs 20 or newer): https://nodejs.org"
node -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 20 ? 0 : 1)' || fail "Node.js 20 or newer is needed (found $(node -v))."
ON_MAC=0
if [ "$(uname)" = "Darwin" ]; then
  ON_MAC=1
  xcodebuild -version >/dev/null 2>&1 || fail "Xcode is not installed or not selected. Install Xcode, open it once, then run: sudo xcode-select -s /Applications/Xcode.app"
fi
ok "git, Node $(node -v)$([ $ON_MAC = 1 ] && echo ", $(xcodebuild -version | head -1)")"

say "2/7 Making a new, separate folder: $DEST"
[ -e "$DEST" ] && fail "$DEST already exists. This script never reuses or overwrites a folder. Delete it yourself if it's an old test, or run with AFIYEAT_TRIAL_DIR=~/AfiyeatTrial/another-name"
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
[ -f "$DEST/ios/App/App/AfiyeatNativeAuth.swift" ] || fail "commit $COMMIT doesn't contain the social sign-in code."
ok "HEAD is $GOT ($(git -C "$DEST" log -1 --format='%s' | cut -c1-70))"
cd "$DEST"

say "4/7 Installing packages (a few minutes the first time)"
npm ci --no-audit --no-fund --loglevel=error

say "5/7 Building the app (production backend; Apple on iPhone: $APPLE_MODE)"
VITE_APPLE_SIGN_IN_IOS="$APPLE_MODE" npm run build --silent
grep -rq "$PROD_REF" dist || fail "the web build doesn't point at the production backend."
grep -rq "demo.afiyeat.invalid" dist && fail "the web build contains the demo backend."
ok "web build: production backend"

say "6/7 Making it a separate app ($TEST_NAME, $TEST_BUNDLE)"
perl -pi -e "s/PRODUCT_BUNDLE_IDENTIFIER = com\.afiyeat\.app;/PRODUCT_BUNDLE_IDENTIFIER = $TEST_BUNDLE;/g" ios/App/App.xcodeproj/project.pbxproj
perl -0pi -e "s#(<key>CFBundleDisplayName</key>\\s*<string>)[^<]*(</string>)#\${1}$TEST_NAME\${2}#" ios/App/App/Info.plist
cat > ios/App/App/App.entitlements <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>com.apple.developer.applesignin</key>
	<array>
		<string>Default</string>
	</array>
</dict>
</plist>
PLIST
npx cap sync ios >/dev/null

say "7/7 Checking the final iOS build target before opening Xcode"
PBX=ios/App/App.xcodeproj/project.pbxproj
[ "$(grep -c "PRODUCT_BUNDLE_IDENTIFIER = $TEST_BUNDLE;" "$PBX")" -ge 2 ] || fail "bundle id isn't $TEST_BUNDLE in both Debug and Release."
grep -q "PRODUCT_BUNDLE_IDENTIFIER = com.afiyeat.app;" "$PBX" && fail "the real app's bundle id is still in the project."
ok "bundle id: $TEST_BUNDLE (Debug and Release)"
grep -A1 "CFBundleDisplayName" ios/App/App/Info.plist | grep -q "$TEST_NAME" || fail "app name isn't $TEST_NAME."
ok "app name on the home screen: $TEST_NAME"
grep -q "applesignin" ios/App/App/App.entitlements || fail "Sign in with Apple entitlement is missing."
grep -Eq "aps-environment|associated-domains" ios/App/App/App.entitlements && fail "push or universal-link entitlements are still present."
ok "entitlements: Sign in with Apple only"
grep -q "AfiyeatNativeAuth.swift in Sources" "$PBX" || fail "the native sign-in plugin isn't in the Xcode target."
grep -q 'customClass="AfiyeatBridgeViewController"' ios/App/App/Base.lproj/Main.storyboard || fail "Main.storyboard doesn't use AfiyeatBridgeViewController."
ok "native sign-in plugin: in target and registered"
[ -f ios/App/App/public/index.html ] || fail "the web build wasn't copied into the iOS project."
grep -q '"url"' ios/App/App/capacitor.config.json && fail "capacitor.config.json points the app at a remote server."
ok "iOS web files present, no remote server"
if [ $ON_MAC = 1 ]; then
  SETTINGS="$(xcodebuild -project ios/App/App.xcodeproj -target App -configuration Debug -showBuildSettings 2>/dev/null || true)"
  echo "$SETTINGS" | grep -Eq "^\s*PRODUCT_BUNDLE_IDENTIFIER = $TEST_BUNDLE$" || fail "Xcode resolves a different bundle id than $TEST_BUNDLE."
  ok "Xcode's own build settings: PRODUCT_BUNDLE_IDENTIFIER = $TEST_BUNDLE"
fi

cat <<DONE

==> Ready: $TEST_NAME, commit ${COMMIT:0:12}, in $DEST
    Apple on iPhone: $APPLE_MODE sheet. Backend: PRODUCTION.

In Xcode (opening now):
  1. Plug in your iPhone and unlock it. Pick it in the device menu (not a simulator).
  2. App target > Signing & Capabilities > Team: your team. Keep
     "Automatically manage signing" on. "Sign in with Apple" should be
     listed; if Xcode reports the App ID lacks it, enable it for
     $TEST_BUNDLE in the Apple Developer portal and retry.
  3. Press Run.

"$TEST_NAME" installs next to Afiyeat / the RC3 build; it doesn't replace them.
Follow docs/social-sign-in/IPHONE_TEST_PLAN.md. Afterwards delete the
test accounts you created (Profile > Delete account), then delete the app
and this folder.
DONE

if [ $ON_MAC = 1 ]; then open ios/App/App.xcodeproj; fi
