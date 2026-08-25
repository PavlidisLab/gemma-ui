#!/usr/bin/env bash
# Build apps/browser and publish the static build to a web root.
#
# Nothing about the target is hardcoded here or in the app source. Two
# settings drive a deploy, both read from apps/browser/.env.production
# (and both overridable from the shell for a one-off):
#
#   VITE_BASE_PATH   the sub-path the app is mounted at, e.g. /myapp/
#                    ("/" when served from an origin root). Vite bakes
#                    this into every asset URL at build time.
#   DEPLOY_DEST      the directory to publish into.
#
#   DEPLOY_DEST=/srv/www/app-staging VITE_BASE_PATH=/app-staging/ \
#     scripts/deploy-browser.sh
#
# Flags:
#   -n, --dry-run   show what rsync would change, copy nothing
#
# Note: rsync runs with --delete, so DEST is made to match dist/
# exactly. Stale hashed assets from prior builds are removed — which
# is the point, but it also means DEST must hold nothing but this
# app's build output.
#
# Deep links: the app uses hash routing (see apps/browser/CLAUDE.md),
# so the web server needs no SPA fallback rule — every route resolves
# against index.html on its own.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$REPO_ROOT/apps/browser/.env.production"
DIST="$REPO_ROOT/apps/browser/dist"

DRY_RUN=""
case "${1:-}" in
  -n|--dry-run) DRY_RUN="--dry-run" ;;
  "") ;;
  *) echo "unknown argument: $1" >&2; exit 2 ;;
esac

# Read a var from .env.production unless the shell already set it.
from_env_file() {
  [ -f "$ENV_FILE" ] || return 0
  grep -E "^$1=" "$ENV_FILE" | tail -1 | cut -d= -f2- | tr -d '"'"'"' \r'
}

DEST="${DEPLOY_DEST:-$(from_env_file DEPLOY_DEST)}"
if [ -z "$DEST" ]; then
  echo "ERROR: no destination. Set DEPLOY_DEST in $ENV_FILE" >&2
  echo "       or pass it in the environment." >&2
  exit 2
fi

echo "==> building apps/browser (mode=production)"
npm --prefix "$REPO_ROOT" --workspace gembrow run build

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

echo "==> publishing to $DEST ${DRY_RUN:+(dry run)}"
mkdir -p "$DEST"
# --chmod keeps the tree group-writable so a colleague can redeploy
# over it; -c compares by checksum because a shared network mount
# makes mtimes untrustworthy.
rsync -rlcv --delete $DRY_RUN \
  --chmod=D775,F664 \
  "$DIST/" "$DEST/"

if [ -z "$DRY_RUN" ]; then
  echo "==> deployed $(git -C "$REPO_ROOT" rev-parse --short HEAD) to $DEST"
fi
