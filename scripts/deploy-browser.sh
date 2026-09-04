#!/usr/bin/env bash
# Build apps/browser and publish the static build to a web root.
#
# Two deployments, each with its own env file and its own directory
# under the same parent:
#
#   production  apps/browser/.env.production  → https://gemma.msl.ubc.ca/
#   staging     apps/browser/.env.staging     → https://staging-gemma.msl.ubc.ca/
#
# The target picks both the env file and the Vite build mode, so a
# staging build never sees production's values and vice versa:
# `vite build --mode staging` loads .env.staging (and NOT
# .env.production). Everything else about a target lives in that file,
# nothing here and nothing in the app source.
#
#   VITE_BASE_PATH   the sub-path the app is mounted at, e.g. /myapp/
#                    ("/" when served from an origin root). Vite bakes
#                    this into every asset URL at build time.
#   DEPLOY_DEST      the directory to publish into.
#
# Usage:
#   scripts/deploy-browser.sh                    # production (default)
#   scripts/deploy-browser.sh staging
#   scripts/deploy-browser.sh staging --dry-run
#
# Either var can be overridden from the shell for a one-off, which
# ignores the file's value for that run:
#
#   DEPLOY_DEST=/srv/www/app-test VITE_BASE_PATH=/app-test/ \
#     scripts/deploy-browser.sh staging
#
# Flags:
#   -n, --dry-run   show what rsync would change, copy nothing
#
# Note: rsync runs with --delete, so DEST is made to match dist/
# exactly. Stale hashed assets from prior builds are removed — which
# is the point, but it also means DEST must hold nothing but this
# app's build output. The two targets therefore must not share a
# directory; the script checks and refuses.
#
# Both targets build into the same apps/browser/dist, so that
# directory holds whichever target was built last. Harmless here — a
# deploy always rebuilds first — but don't rsync dist/ by hand without
# checking which build it is.
#
# Deep links: the app uses hash routing (see apps/browser/CLAUDE.md),
# so the web server needs no SPA fallback rule — every route resolves
# against index.html on its own.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DIST="$REPO_ROOT/apps/browser/dist"

TARGET="production"
DRY_RUN=""
while [ $# -gt 0 ]; do
  case "$1" in
    production|staging) TARGET="$1" ;;
    -n|--dry-run) DRY_RUN="--dry-run" ;;
    -h|--help)
      sed -n '2,48p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
      exit 0 ;;
    *) echo "unknown argument: $1 (expected production|staging|--dry-run)" >&2; exit 2 ;;
  esac
  shift
done

ENV_FILE="$REPO_ROOT/apps/browser/.env.$TARGET"
if [ ! -f "$ENV_FILE" ]; then
  echo "ERROR: no env file for target '$TARGET' at $ENV_FILE" >&2
  echo "       copy apps/browser/.env.example and fill in" >&2
  echo "       VITE_BASE_PATH + DEPLOY_DEST for that deployment." >&2
  exit 2
fi

# Read a var out of an env file (no shell sourcing — these files are
# Vite's, not bash's).
var_in_file() {
  [ -f "$1" ] || return 0
  grep -E "^$2=" "$1" | tail -1 | cut -d= -f2- | tr -d '"'"'"' \r'
}

# Same, from the target's env file, unless the shell already set it.
from_env_file() { var_in_file "$ENV_FILE" "$1"; }

DEST="${DEPLOY_DEST:-$(from_env_file DEPLOY_DEST)}"
if [ -z "$DEST" ]; then
  echo "ERROR: no destination. Set DEPLOY_DEST in $ENV_FILE" >&2
  echo "       or pass it in the environment." >&2
  exit 2
fi

# Guard: the targets publish with --delete, so pointing both at one
# directory means each deploy silently wipes the other. Catch a
# copy-paste slip in the env files before rsync acts on it.
OTHER_TARGET="staging"
[ "$TARGET" = "staging" ] && OTHER_TARGET="production"
OTHER_DEST="$(var_in_file "$REPO_ROOT/apps/browser/.env.$OTHER_TARGET" DEPLOY_DEST)"
if [ -n "$OTHER_DEST" ] && [ "${DEST%/}" = "${OTHER_DEST%/}" ]; then
  echo "ERROR: $TARGET and $OTHER_TARGET both publish to $DEST." >&2
  echo "       rsync --delete would make each deploy clobber the other." >&2
  exit 1
fi

echo "==> building apps/browser (target=$TARGET, mode=$TARGET)"
npm --prefix "$REPO_ROOT" --workspace gembrow run build -- --mode "$TARGET"

# Guard: a build that picked up the wrong base emits root-absolute
# asset URLs (/assets/index-*.js), which 404 under a sub-path mount.
# That exact failure is what was live before this script existed, so
# check for it rather than trusting the env file was loaded.
EXPECTED_BASE="${VITE_BASE_PATH:-$(from_env_file VITE_BASE_PATH)}"
EXPECTED_BASE="/$(echo "${EXPECTED_BASE:-/}" | sed -E 's#^/+|/+$##g')/"
EXPECTED_BASE="${EXPECTED_BASE//\/\//\/}"
if ! grep -q "src=\"${EXPECTED_BASE}assets/" "$DIST/index.html"; then
  echo "ERROR: dist/index.html does not reference ${EXPECTED_BASE}assets/ —" >&2
  echo "       built with the wrong base; refusing to deploy." >&2
  grep -o 'src="[^"]*"' "$DIST/index.html" >&2 || true
  exit 1
fi

echo "==> publishing $TARGET to $DEST ${DRY_RUN:+(dry run)}"
mkdir -p "$DEST"
# --chmod keeps the tree group-writable so a colleague can redeploy
# over it; -c compares by checksum because a shared network mount
# makes mtimes untrustworthy.
rsync -rlcv --delete $DRY_RUN \
  --chmod=D775,F664 \
  "$DIST/" "$DEST/"

if [ -z "$DRY_RUN" ]; then
  echo "==> deployed $(git -C "$REPO_ROOT" rev-parse --short HEAD) to $DEST ($TARGET)"
fi
