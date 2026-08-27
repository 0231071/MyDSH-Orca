#!/bin/bash
# orca-dsh-patch — register DeepSeek Harness (dsh) as a first-class Orca agent.
#
# What it does:
#   1. extracts /Applications/Orca.app's app.asar into a staging dir
#   2. applies the dsh agent patches (apply-patches.js)
#   3. repacks and byte-verifies the archive (repack.js)
#   4. quits Orca, backs up, installs the new asar + unpacked tree,
#      updates the ElectronAsarIntegrity hash in Info.plist, ad-hoc re-signs
#
# Usage:
#   ./patch.sh --stage          # extract+patch+pack+verify only (no install)
#   ./patch.sh --install        # stage, then install into /Applications/Orca.app
#   ./patch.sh --rollback       # restore latest backup
# Env:
#   ORCA_APP=/path/to/Orca.app  # default /Applications/Orca.app
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# Resolve Orca.app: explicit ORCA_APP wins, else the known locations.
if [ -n "${ORCA_APP:-}" ]; then APP="$ORCA_APP"
elif [ -d /Applications/Orca.app ]; then APP=/Applications/Orca.app
elif [ -d "$HOME/Downloads/Orca.app" ]; then APP="$HOME/Downloads/Orca.app"
else
  APP=$(mdfind "kMDItemCFBundleIdentifier == 'com.stablyai.orca'" 2>/dev/null | head -1)
fi
RES="$APP/Contents/Resources"
ASAR="$RES/app.asar"
WORK="${TMPDIR:-/tmp}/orca-dsh-patch-$$"
MODE="${1:---stage}"

log() { printf '\033[1;36m[orca-dsh]\033[0m %s\n' "$*"; }
die() { printf '\033[1;31m[orca-dsh] ERROR:\033[0m %s\n' "$*" >&2; exit 1; }

command -v node >/dev/null || die "node not found"
command -v codesign >/dev/null || die "codesign not found"
[ -x /usr/libexec/PlistBuddy ] || die "PlistBuddy not found"
[ -d "$APP" ] || die "Orca not found at $APP"
node -e 'require("@electron/asar")' 2>/dev/null || \
  NODE_PATH="$SCRIPT_DIR/../node_modules" node -e 'require("@electron/asar")' >/dev/null 2>&1 || \
  die "@electron/asar not resolvable; run: npm install @electron/asar  (in this project root)"

latest_backup() {
  ls -t "$RES"/app.asar.bak-orca-dsh-* 2>/dev/null | head -1 || true
}

do_rollback() {
  BAK="$(latest_backup)"; [ -n "$BAK" ] || die "no backup found"
  TS=$(basename "$BAK" | sed -E 's/.*bak-orca-dsh-(.*)/\1/')
  log "restoring $BAK (suffix $TS)"
  osascript -e 'quit app "Orca"' >/dev/null 2>&1 || true; sleep 2
  cp -p "$BAK" "$ASAR"
  PLIST_BAK="${ASAR}.Info.plist.bak-orca-dsh-$TS"
  [ -f "$PLIST_BAK" ] && cp -p "$PLIST_BAK" "$APP/Contents/Info.plist"
  UNPACKED_BAK="$RES/app.asar.unpacked.bak-orca-dsh-$TS"
  if [ -d "$UNPACKED_BAK" ]; then
    rm -rf "$RES/app.asar.unpacked"
    mv "$UNPACKED_BAK" "$RES/app.asar.unpacked"
  fi
  log "re-signing…"
  codesign --force --deep --sign - "$APP" 2>/dev/null || true
  log "rollback complete. relaunch Orca."
}

if [ "$MODE" = "--rollback" ]; then do_rollback; exit 0; fi

trap 'rm -rf "$WORK"' EXIT

log "extracting $(basename "$ASAR") …"
mkdir -p "$WORK/stage" "$WORK/out"
NODE_PATH="$SCRIPT_DIR/../node_modules:${NODE_PATH:-}" node -e '
const {extractAll} = require("@electron/asar");
extractAll(process.argv[1], process.argv[2]);
' "$ASAR" "$WORK/stage"

log "applying patches…"
NODE_PATH="$SCRIPT_DIR/../node_modules:${NODE_PATH:-}" node "$SCRIPT_DIR/lib/apply-patches.js" "$WORK/stage"

log "repacking + verifying…"
NODE_PATH="$SCRIPT_DIR/../node_modules:${NODE_PATH:-}" node "$SCRIPT_DIR/lib/repack.js" \
  "$WORK/stage" "$ASAR" "$WORK/out" | tee "$WORK/repack.log"
SHA=$(grep -E '^[0-9a-f]{64}$' "$WORK/repack.log" | tail -1)
[ -n "$SHA" ] || die "could not read new asar sha256 from repack output"
log "new asar sha256: $SHA"

if [ "$MODE" = "--stage" ]; then
  KEEP_DIR="$PWD/orca-dsh-build"
  rm -rf "$KEEP_DIR"
  mkdir -p "$KEEP_DIR"
  cp -p "$WORK/out/app.asar" "$KEEP_DIR/"
  cp -Rp "$WORK/out/app.asar.unpacked" "$KEEP_DIR/"
  log "--stage done. artifacts kept in $KEEP_DIR (not installed)."
  exit 0
fi

[ "$MODE" = "--install" ] || die "unknown mode: $MODE"

log "quitting Orca…"
osascript -e 'quit app "Orca"' >/dev/null 2>&1 || true
for i in $(seq 1 20); do pgrep -xq Orca >/dev/null 2>&1 || break; sleep 0.5; done
pgrep -fq "daemon-entry.js.*$APP" >/dev/null 2>&1 && pkill -f "daemon-entry.js" 2>/dev/null || true
sleep 1

TS=$(date +%Y%m%d-%H%M%S)
log "backing up current bundle (suffix .bak-orca-dsh-$TS)…"
cp -p "$ASAR" "$ASAR.bak-orca-dsh-$TS"
cp -p "$APP/Contents/Info.plist" "$ASAR.Info.plist.bak-orca-dsh-$TS"
mv "$RES/app.asar.unpacked" "$RES/app.asar.unpacked.bak-orca-dsh-$TS"

log "installing patched asar + unpacked tree…"
cp -p "$WORK/out/app.asar" "$ASAR"
cp -Rp "$WORK/out/app.asar.unpacked" "$RES/app.asar.unpacked"

log "updating ElectronAsarIntegrity hash in Info.plist…"
/usr/libexec/PlistBuddy -c "Set :ElectronAsarIntegrity:Resources/app.asar:hash $SHA" "$APP/Contents/Info.plist" \
  || die "failed to update Info.plist integrity hash"

log "ad-hoc re-signing (original Developer ID signature is replaced)…"
codesign --force --deep --sign - "$APP" || die "codesign failed"
codesign --verify --deep "$APP" && log "signature verifies."

log "done ✅  launch Orca — DSH should appear in the agent picker (requires ~/.local/bin/dsh on PATH)."
log "backup restore:  $SCRIPT_DIR/patch.sh --rollback"
