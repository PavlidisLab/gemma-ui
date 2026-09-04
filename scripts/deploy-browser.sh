#!/usr/bin/env bash
# Build apps/browser and publish the static build to a web root.
#
# One deployment per env file, each with its own directory under the
# same parent:
#
#   production  apps/browser/.env.production  → https://gemma.msl.ubc.ca/
#   staging     apps/browser/.env.staging     → https://staging-gemma.msl.ubc.ca/
#   gemma2testing                             → https://gemma2.msl.ubc.ca/
#               apps/browser/.env.gemma2testing
#
# The target picks both the env file and the Vite build mode, so one
# target's build never sees another's values: `vite build --mode
# staging` loads .env.staging and NOT .env.production. Everything
# about a target lives in its env file, nothing here and nothing in
# the app source.
#
# Adding a target is therefore writing apps/browser/.env.<name> — this
# script has no list to extend. `<name>` has to be a plain lowercase
# identifier, since it doubles as the Vite mode.
#
#   VITE_BASE_PATH   the sub-path the app is mounted at, e.g. /myapp/
#                    ("/" when served from an origin root). Vite bakes
#                    this into every asset URL at build time.
#   DEPLOY_DEST      the directory to publish into.
#
# Usage:
#   scripts/deploy-browser.sh                    # production (default)
#   scripts/deploy-browser.sh staging
#   scripts/deploy-browser.sh gemma2testing
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
# app's build output. Two targets therefore must not share a
# directory; the script checks every env file and refuses.
#
# Every target builds into the same apps/browser/dist, so that
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
    -n|--dry-run) DRY_RUN="--dry-run" ;;
    -h|--help)
      sed -n '2,52p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
      exit 0 ;;
    -*) echo "unknown flag: $1 (expected -n/--dry-run or -h/--help)" >&2; exit 2 ;;
    # Any bare word is a target name; it must be a legal Vite mode and
    # have an env file, both checked below. Keeping the names out of
    # this case means a new deployment is one new file, with nothing
    # here to keep in sync -- and one error path for a name that is
    # malformed or simply has no file, rather than two that disagree.
    *) TARGET="$1" ;;
  esac
  shift
done

# The target name doubles as the Vite mode and as a filename suffix,
# so keep it to a plain identifier rather than passing whatever was
# typed to `vite build --mode`.
if ! echo "$TARGET" | grep -qE '^[a-z0-9][a-z0-9._-]*$'; then
  echo "ERROR: bad target name '$TARGET' — lowercase letters, digits," >&2
  echo "       dot, dash, underscore only." >&2
  exit 2
fi

ENV_FILE="$REPO_ROOT/apps/browser/.env.$TARGET"
if [ ! -f "$ENV_FILE" ]; then
  echo "ERROR: no env file for target '$TARGET' at $ENV_FILE" >&2
  echo "       copy apps/browser/.env.example and fill in" >&2
  echo "       VITE_BASE_PATH + DEPLOY_DEST for that deployment." >&2
  # Which names WOULD work. A glob, not `ls` -- these are dotfiles and
  # a bare `ls` does not list them, which made this print nothing at
  # all the first time. Deployment files only: .env.example is the
  # template and .env / .env.local / *.local are dev config.
  echo "       Targets that do have one:" >&2
  for f in "$REPO_ROOT"/apps/browser/.env.*; do
    [ -f "$f" ] || continue
    name="${f##*/.env.}"
    case "$name" in example|local|*.local) continue ;; esac
    echo "         $name" >&2
  done
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

# Guard: every target publishes with --delete, so two of them pointing
# at one directory means each deploy silently wipes the other. Compare
# against all the sibling env files, not just one — a copy-paste slip
# is likeliest in a file just cloned from another target.
for other in "$REPO_ROOT"/apps/browser/.env.*; do
  [ -f "$other" ] || continue
  other_target="${other##*/.env.}"
  case "$other_target" in
    "$TARGET"|example|local|*.local) continue ;;
  esac
  other_dest="$(var_in_file "$other" DEPLOY_DEST)"
  if [ -n "$other_dest" ] && [ "${DEST%/}" = "${other_dest%/}" ]; then
    echo "ERROR: $TARGET and $other_target both publish to $DEST." >&2
    echo "       rsync --delete would make each deploy clobber the other." >&2
    exit 1
  fi
done

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
# Only for real. A --dry-run that created the docroot would leave an
# empty directory behind for a target nobody has deployed yet; rsync's
# own dry run reports "created directory $DEST" without touching disk.
[ -n "$DRY_RUN" ] || mkdir -p "$DEST"
# --chmod keeps the tree group-writable so a colleague can redeploy
# over it; -c compares by checksum because a shared network mount
# makes mtimes untrustworthy.
rsync -rlcv --delete $DRY_RUN \
  --chmod=D775,F664 \
  "$DIST/" "$DEST/"

if [ -z "$DRY_RUN" ]; then
  echo "==> deployed $(git -C "$REPO_ROOT" rev-parse --short HEAD) to $DEST ($TARGET)"
fi
