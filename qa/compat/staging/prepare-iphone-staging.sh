#!/usr/bin/env bash
# Prepares "Afiyeat Staging": Lists V2 from ONE EXACT commit, connected to the PM-APPROVED STAGING
# Supabase project (holding a copy of your own lists), never to production and never to the demo backend.
#
#   STAGING_CONFIRM_PROJECT_REF=<staging ref> bash qa/compat/staging/prepare-iphone-staging.sh <full commit id> <.env.staging.local>
#
#   <.env.staging.local>  three PUBLIC values from the staging project (Project Settings -> API):
#                           VITE_SUPABASE_PROJECT_ID="<ref>"
#                           VITE_SUPABASE_URL="https://<ref>.supabase.co"
#                           VITE_SUPABASE_PUBLISHABLE_KEY="<anon / publishable key>"
#                         A service_role key is refused.
#
# Safety, by construction (same as the trial installer, plus the staging checks):
#   - Approval: qa/compat/staging/approved-target.json must exist (written by the PM), cover "iphone-build",
#     be unexpired, and name a project that is not production; you retype its ref.
#   - Pinned: downloads exactly the commit you pass into a NEW folder ~/AfiyeatStaging/app-<commit>.
#     It never runs git reset, clean, checkout or pull on anything else.
#   - Separate app: bundle id com.afiyeat.app.staging, name "Afiyeat Staging", installed next to Afiyeat
#     and Afiyeat Trial. Push and universal-link entitlements removed.
#   - The finished iOS web files must contain the staging host, and must NOT contain the production
#     project or the demo backend. Any failed check stops the script before Xcode opens.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="https://github.com/cavigidor/afiyeat.git"
PROD_REF="dmlkjpjubneqhbqoxlct"
DEMO_MARK="demo.afiyeat.invalid"
BUNDLE="com.afiyeat.app.staging"
NAME="Afiyeat Staging"

say()  { printf '\n==> %s\n' "$*"; }
ok()   { printf '    ok: %s\n' "$*"; }
fail() { printf '\nSTOPPED: %s\nNothing was installed. Your other folders and apps were not touched.\n' "$*" >&2; exit 1; }

COMMIT="${1:-}"; ENVFILE="${2:-}"
[[ "$COMMIT" =~ ^[0-9a-f]{40}$ ]] || fail "pass the full 40-character commit id first."
[ -f "$ENVFILE" ] || fail "pass the path of your .env.staging.local second."
ENVFILE="$(cd "$(dirname "$ENVFILE")" && pwd)/$(basename "$ENVFILE")"
DEST="${AFIYEAT_STAGING_DIR:-$HOME/AfiyeatStaging/app-${COMMIT:0:12}}"

say "1/8 Checking tools"
command -v git >/dev/null || fail "git is not installed."
command -v node >/dev/null || fail "Node.js 20+ is not installed."
node -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 20 ? 0 : 1)' || fail "Node.js 20 or newer is needed."
ON_MAC=0
if [ "$(uname)" = "Darwin" ]; then ON_MAC=1; xcodebuild -version >/dev/null 2>&1 || fail "Xcode is not installed or not selected."; fi
ok "git, Node $(node -v)"

say "2/8 Checking the PM's approval and the staging settings"
STAGING_URL="$(node --input-type=module -e "
  import { readApproval, checkKeyFor, productionRefs } from '$HERE/lib/target.mjs';
  import { readFileSync } from 'node:fs';
  try {
  const a = readApproval('iphone-build');
  if (a.lab) throw new Error('lab mode cannot build an iPhone app');
  const env = readFileSync(process.argv[1], 'utf8');
  const get = (k) => (env.match(new RegExp('^' + k + '\\\\s*=\\\\s*\"?([^\"\\\\n]+)\"?', 'm')) ?? [])[1];
  const keys = [...env.matchAll(/^([A-Z0-9_]+)\s*=/gm)].map((m) => m[1]);
  const allowed = ['VITE_SUPABASE_PROJECT_ID', 'VITE_SUPABASE_URL', 'VITE_SUPABASE_PUBLISHABLE_KEY'];
  for (const k of keys) if (!allowed.includes(k)) throw new Error('unexpected setting ' + k + ' in the env file (only the three public values belong there)');
  if (get('VITE_SUPABASE_URL') !== a.project_url) throw new Error('VITE_SUPABASE_URL must be exactly ' + a.project_url);
  if (get('VITE_SUPABASE_PROJECT_ID') !== a.project_ref) throw new Error('VITE_SUPABASE_PROJECT_ID must be ' + a.project_ref);
  const key = checkKeyFor(a, get('VITE_SUPABASE_PUBLISHABLE_KEY'), 'anon');
  if (/^sb_secret_/.test(key)) throw new Error('that is a secret key; use the anon / publishable key');
  const parts = key.split('.');
  if (parts.length === 3) { const c = JSON.parse(Buffer.from(parts[1], 'base64url').toString()); if (c.role && c.role !== 'anon') throw new Error('the key has role ' + c.role + '; only the anon / publishable key may go in an app'); }
  if ([...productionRefs()].some((r) => env.includes(r))) throw new Error('the env file mentions the production project');
  console.log(a.project_url);
  } catch (e) { console.log(e.message); process.exit(1); }
" "$ENVFILE" 2>&1)" || fail "$STAGING_URL"
STAGING_HOST="${STAGING_URL#https://}"
ok "approved staging project: $STAGING_URL"

say "3/8 Making a new, separate folder: $DEST"
[ -e "$DEST" ] && fail "$DEST already exists. This script never reuses a folder."
PARENT="$(dirname "$DEST")"; mkdir -p "$PARENT"
git -C "$PARENT" rev-parse --is-inside-work-tree >/dev/null 2>&1 && fail "$PARENT is inside a git repository; choose a folder outside your projects."
mkdir "$DEST"; ok "created (empty)"

say "4/8 Downloading exactly commit $COMMIT"
git -C "$DEST" init -q
git -C "$DEST" remote add origin "$REPO"
git -C "$DEST" fetch -q --depth 1 origin "$COMMIT" || fail "couldn't download commit $COMMIT."
git -C "$DEST" -c advice.detachedHead=false checkout -q FETCH_HEAD
[ "$(git -C "$DEST" rev-parse HEAD)" = "$COMMIT" ] || fail "downloaded a different commit."
ok "HEAD is $COMMIT"
cd "$DEST"

say "5/8 Installing packages"
npm ci --no-audit --no-fund --loglevel=error

say "6/8 Building against the staging project only"
# In this throwaway copy, BOTH env files name staging, so nothing can fall back to production's values.
cp "$ENVFILE" .env.staging.local
cp "$ENVFILE" .env
rm -f .env.demo .env.production .env.local
npx vite build --mode staging --outDir dist --emptyOutDir >/dev/null
grep -rq "$PROD_REF" dist && fail "the web build contains the production project."
grep -rq "$DEMO_MARK" dist && fail "the web build contains the demo backend."
grep -rq "$STAGING_HOST" dist || fail "the web build doesn't contain the staging host."
ok "web build: staging project only"

say "7/8 Making it a separate app ($NAME, $BUNDLE)"
perl -pi -e 's/PRODUCT_BUNDLE_IDENTIFIER = com\.afiyeat\.app;/PRODUCT_BUNDLE_IDENTIFIER = com.afiyeat.app.staging;/g' ios/App/App.xcodeproj/project.pbxproj
perl -0pi -e 's#(<key>CFBundleDisplayName</key>\s*<string>)[^<]*(</string>)#${1}Afiyeat Staging${2}#' ios/App/App/Info.plist
cat > ios/App/App/App.entitlements <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict/>
</plist>
PLIST
npx cap sync ios >/dev/null

say "8/8 Checking the final iOS build target before opening Xcode"
PBX=ios/App/App.xcodeproj/project.pbxproj
[ "$(grep -c "PRODUCT_BUNDLE_IDENTIFIER = $BUNDLE;" "$PBX")" -ge 2 ] || fail "bundle id isn't $BUNDLE in Debug and Release."
grep -q "PRODUCT_BUNDLE_IDENTIFIER = com.afiyeat.app;" "$PBX" && fail "the real app's bundle id is still in the project."
grep -A1 CFBundleDisplayName ios/App/App/Info.plist | grep -q "$NAME" || fail "app name isn't $NAME."
grep -Eq "aps-environment|associated-domains" ios/App/App/App.entitlements && fail "push or universal-link entitlements are still present."
grep -rq "$PROD_REF" ios/App/App/public && fail "the iOS web files contain the production project."
grep -rq "$DEMO_MARK" ios/App/App/public && fail "the iOS web files contain the demo backend."
grep -rq "$STAGING_HOST" ios/App/App/public || fail "the iOS web files don't contain the staging host."
grep -q '"url"' ios/App/App/capacitor.config.json && fail "capacitor.config.json points the app at a remote server."
if [ $ON_MAC = 1 ]; then
  xcodebuild -project ios/App/App.xcodeproj -target App -configuration Debug -showBuildSettings 2>/dev/null | grep -Eq "^\s*PRODUCT_BUNDLE_IDENTIFIER = $BUNDLE$" || fail "Xcode resolves a different bundle id."
fi
ok "bundle $BUNDLE, name $NAME, no entitlements, staging host only"

cat <<DONE

==> Ready: Afiyeat Staging, commit ${COMMIT:0:12}, in $DEST

In Xcode (opening now): pick your iPhone, App target > Signing & Capabilities > your Team, then Run.
Sign in with the STAGING email and password you chose when importing (not your production password).

Works on staging: your lists, items, statuses, categories, photos, editing, Add Item (typed names),
Customize (fields, statuses, who can see it), shared list, privacy between the placeholder accounts.
Does not work on staging unless separately approved: Apple Maps search and map tiles (Edge Function
not deployed), push notifications (no APNs key, entitlements removed), email codes.

After testing: STAGING_CONFIRM_PROJECT_REF=<ref> node qa/compat/staging/compare-staging.mjs --bundle <export folder> --label after-iphone
DONE
if [ $ON_MAC = 1 ]; then open ios/App/App.xcodeproj; fi
