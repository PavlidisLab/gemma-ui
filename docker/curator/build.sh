#!/usr/bin/env bash
# Build the two curator-distribution images. Run from a dev machine
# with both repos checked out side-by-side:
#
#   ~/Dev/gemma-curation-ui          (this repo)
#   ~/Dev/gemma-curation-agents      (Python services)
#
# After build, push to a registry (Docker Hub / GHCR / private) so
# curators can ``docker compose pull`` rather than build locally:
#
#   docker push gemma-curator/local-api:$TAG
#   docker push gemma-curator/curation-ui:$TAG

set -euo pipefail
cd "$(dirname "$0")"

REPO_ROOT="$(cd ../.. && pwd)"
AGENTS_REPO="${AGENTS_REPO:-$(cd ../../../gemma-curation-agents 2>/dev/null && pwd || true)}"
TAG="${TAG:-latest}"

if [ -z "$AGENTS_REPO" ] || [ ! -f "$AGENTS_REPO/pyproject.toml" ]; then
    echo "ERROR: gemma-curation-agents repo not found." >&2
    echo "       set AGENTS_REPO=/path/to/gemma-curation-agents" >&2
    exit 1
fi

echo "[build] agents repo: $AGENTS_REPO"
echo "[build] ui repo:     $REPO_ROOT"
echo "[build] tag:         $TAG"

# Enable BuildKit for the named build-context support used by
# local-api (and to get the cleaner layer caching).
export DOCKER_BUILDKIT=1

# ─── local-api image ─────────────────────────────────────────────
docker build \
    --build-context "agents=$AGENTS_REPO" \
    -f Dockerfile.local-api \
    -t "gemma-curator/local-api:$TAG" \
    .

# ─── curation-ui image ───────────────────────────────────────────
# Context is the monorepo root so the multi-stage build can copy
# the workspace manifests + apps/curation source.
docker build \
    -f Dockerfile.curation-ui \
    -t "gemma-curator/curation-ui:$TAG" \
    "$REPO_ROOT"

echo
echo "Built:"
echo "  gemma-curator/local-api:$TAG"
echo "  gemma-curator/curation-ui:$TAG"
echo
echo "Run locally:"
echo "  docker compose up -d"
echo
echo "Publish (point at a registry first):"
echo "  docker tag gemma-curator/local-api:$TAG <registry>/local-api:$TAG"
echo "  docker push <registry>/local-api:$TAG"
echo "  (same for curation-ui)"
