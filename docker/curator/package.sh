#!/usr/bin/env bash
# Build + bundle a curator-handoff tarball.
#
# Produces ./curator-handoff-v<TAG>.tar.gz with:
#   - curator/ stack (docker-compose.yml, Dockerfiles, nginx.conf, README)
#   - docker-images.tar.gz   (gzipped `docker save` of local-api + curation-ui)
#   - calibration-packages/  (whatever's currently in ./calibration-packages/)
#
# Curator-side workflow: extract tarball → `docker load -i
# docker-images.tar.gz` → `docker compose up -d` → import a
# calibration package. No internet, no git checkout, no source build
# on the curator's machine.
#
# Usage:
#   TAG=v0.11.2 ./package.sh
#
# Pre-conditions:
#   - ~/Dev/gemma-curation-agents checked out next to this monorepo
#     (build.sh resolves it via the same path).
#   - calibration packages already copied under ./calibration-packages/.
#
# Output:
#   ./curator-handoff-v<TAG>.tar.gz
set -euo pipefail
cd "$(dirname "$0")"

TAG="${TAG:-latest}"
PORTABLE_TAG="$TAG-curator-portable"
OUT_TARBALL="curator-handoff-$TAG.tar.gz"
STAGE_DIR="$(mktemp -d -t curator-handoff-XXXXXX)"
trap 'rm -rf "$STAGE_DIR"' EXIT

echo "[package] tag=$TAG portable_tag=$PORTABLE_TAG stage=$STAGE_DIR"

# ─── Step 1: build the two images via existing build.sh ────────────
TAG="$PORTABLE_TAG" ./build.sh

# Also tag :latest so the bundled .env.example's default
# (LOCAL_API_IMAGE=gemma-curator/local-api:latest) works out-of-the-
# box on the curator's machine. Without this alias, `docker load`
# loads only :$PORTABLE_TAG and compose's :latest default would try
# to pull from a registry that doesn't exist → local-api container
# never starts → UI loads but every /rest call hits a dead upstream
# → curators see a blank page. Real bug from v0.12.0 first ship.
echo "[package] aliasing :$PORTABLE_TAG → :latest so compose defaults resolve"
docker tag "gemma-curator/local-api:$PORTABLE_TAG"   "gemma-curator/local-api:latest"
docker tag "gemma-curator/curation-ui:$PORTABLE_TAG" "gemma-curator/curation-ui:latest"

# ─── Step 2: save images to a single gzipped tar ───────────────────
# Ship both tags in the save so `docker load` lands :latest AND the
# pinned :$PORTABLE_TAG. Compose default resolves; curators who pin
# in their .env still have the explicit version available.
echo "[package] docker save local-api + curation-ui (both tags) → $STAGE_DIR/docker-images.tar.gz"
docker save \
    "gemma-curator/local-api:$PORTABLE_TAG" \
    "gemma-curator/local-api:latest" \
    "gemma-curator/curation-ui:$PORTABLE_TAG" \
    "gemma-curator/curation-ui:latest" \
    | gzip > "$STAGE_DIR/docker-images.tar.gz"

# ─── Step 3: assemble the curator-facing tree ─────────────────────
mkdir -p "$STAGE_DIR/curator"
cp docker-compose.yml      "$STAGE_DIR/curator/"
cp docker-compose.override.yml "$STAGE_DIR/curator/" 2>/dev/null || true
cp nginx.conf              "$STAGE_DIR/curator/"
cp README.md               "$STAGE_DIR/curator/"
cp .env.example            "$STAGE_DIR/curator/"
# Dockerfiles too — let the curator rebuild if they want.
cp Dockerfile.local-api    "$STAGE_DIR/curator/"
cp Dockerfile.curation-ui  "$STAGE_DIR/curator/"
cp import-all.sh           "$STAGE_DIR/curator/"

# Calibration packages (the curator's actual work).
if [ -d calibration-packages ] && [ -n "$(ls -A calibration-packages 2>/dev/null || true)" ]; then
    cp -R calibration-packages "$STAGE_DIR/curator/"
    echo "[package] bundled calibration-packages/ ($(ls calibration-packages | wc -l | tr -d ' ') entries)"
else
    mkdir "$STAGE_DIR/curator/calibration-packages"
    echo "[package] WARNING: ./calibration-packages/ is empty — bundle ships with no packages."
fi

# docker-images.tar.gz was already written to $STAGE_DIR root (peer of
# curator/ subdir) by the docker save step above — nothing to move.

# Loader README at bundle root.
cat > "$STAGE_DIR/HANDOFF_README.md" <<EOF
# Curator handoff — v$TAG

## Quick start (five commands)

\`\`\`sh
# 1) Load the prebuilt docker images
docker load -i docker-images.tar.gz

# 2) Run the curator stack (from the curator/ subdir)
cd curator
cp .env.example .env
docker compose up -d

# 3) Import every bundled calibration package into the local-api
./import-all.sh

# 4) Open http://localhost:5175/ — the review sets should appear
\`\`\`

**Step 3 is mandatory.** The UI renders blank if no packages are
imported, since there are no sets to show on the dashboard.
\`import-all.sh\` is idempotent — safe to re-run.

See \`curator/README.md\` for the longer-form guide (auth, the
optional proposer profile, wiping state, etc.).

## Images included

- \`gemma-curator/local-api:$PORTABLE_TAG\`
- \`gemma-curator/curation-ui:$PORTABLE_TAG\`

## Calibration packages included

$(ls calibration-packages 2>/dev/null | sed 's/^/- /' || echo "(none)")

## Stop / wipe

\`\`\`sh
cd curator
docker compose down              # keep the SQLite + state
docker compose down -v           # wipe state + dispositions
\`\`\`
EOF

# ─── Step 4: tar the stage dir ────────────────────────────────────
echo "[package] writing $OUT_TARBALL"
tar -czf "$OUT_TARBALL" -C "$STAGE_DIR" .

du -sh "$OUT_TARBALL"
echo
echo "[package] done."
echo
echo "Next:"
echo "  scp $(pwd)/$OUT_TARBALL willie:/home/paul/Gemma2.0/"
