#!/usr/bin/env bash
# Take down the local-mode docker stack.
#
# Usage:
#   ./down.sh                # stop + remove containers, keep volumes
#   ./down.sh --volumes      # also nuke named volumes (node_modules,
#                              gemma-db-data) — does NOT touch the
#                              bind-mounted source / WAR / SQLite
#                              which live on the host
#   ./down.sh --gemma        # include the Gemma 2.0 profile services

set -euo pipefail
cd "$(dirname "$0")"

ARGS=(down)
PROFILES=()
for arg in "$@"; do
    case "$arg" in
        --volumes) ARGS+=("--volumes") ;;
        --gemma)   PROFILES+=("--profile" "gemma") ;;
        *)         echo "[down] unknown flag: $arg" >&2; exit 2 ;;
    esac
done

docker compose "${PROFILES[@]+"${PROFILES[@]}"}" "${ARGS[@]}"
