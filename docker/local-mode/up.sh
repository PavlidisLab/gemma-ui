#!/usr/bin/env bash
# Bring up the local-mode docker stack with credentials resolved
# from the macOS Keychain (parallels run_local.sh / run_proposer_service.sh).
#
# Usage:
#   ./up.sh                # core stack: local-api + proposer + curation-ui
#   ./up.sh --gemma        # add Gemma 2.0 (tomcat + mysql) profile
#   ./up.sh --gemma --build  # rebuild images first
#
# Stop with: ./down.sh
#
# Service URLs on the host:
#   local_api      http://localhost:8095
#   proposer       http://localhost:8082
#   curation UI    http://localhost:5175
#   gemma-rest     http://localhost:8080  (only with --gemma)
#   gemma-db       mysql://localhost:3306 (only with --gemma)

set -euo pipefail
cd "$(dirname "$0")"

# Read a credential from macOS Keychain. First entry that hits wins.
keychain_export() {
    local var="$1"; shift
    local val=""
    for entry in "$@"; do
        [ -z "$entry" ] && continue
        if val=$(security find-generic-password -s "$entry" -w 2>/dev/null); then
            export "$var=$val"
            echo "[up] $var ← keychain entry '$entry'" >&2
            return 0
        fi
    done
    return 1
}

# Required: Anthropic key (proposer service won't boot without it).
if [ -z "${ANTHROPIC_API_KEY:-}" ]; then
    keychain_export ANTHROPIC_API_KEY \
        "${ANTHROPIC_KEYCHAIN_ENTRY:-}" \
        "ANTHROPIC_API_KEY" "anthropic" "Anthropic" "anthropic-api-key" \
        || { echo "ERROR: no Anthropic key — set ANTHROPIC_API_KEY or stash one in keychain" >&2; exit 1; }
fi

# Curation API bearer — local_api accepts the dev-token-123 default
# when no keychain entry is present.
if [ -z "${GEMMA_CURATION_API_KEY:-}" ]; then
    keychain_export GEMMA_CURATION_API_KEY \
        "GEMMA_CURATION_API_KEY" "gemma-curation-api-key" \
        || export GEMMA_CURATION_API_KEY="dev-token-123"
fi

# Optional Zotero (biolit fetcher).
if [ "${GEMMA_AGENTS_USE_ZOTERO:-}" = "1" ] \
   || [ "${GEMMA_AGENTS_USE_ZOTERO:-}" = "true" ] \
   || [ "${GEMMA_AGENTS_USE_ZOTERO:-}" = "yes" ]; then
    keychain_export ZOTERO_API_KEY "ZOTERO_API_KEY" "zotero" "Zotero API Key" || true
    keychain_export ZOTERO_USER_ID "ZOTERO_USER_ID" "zotero-user-id" || true
    keychain_export ZOTERO_GROUP_ID "ZOTERO_GROUP_ID" "zotero-group-id" || true
fi

# Optional: enable Gemma 2.0 profile.
PROFILES=()
BUILD_FLAG=()
for arg in "$@"; do
    case "$arg" in
        --gemma)  PROFILES+=("--profile" "gemma") ;;
        --build)  BUILD_FLAG+=("--build") ;;
        *)        echo "[up] unknown flag: $arg" >&2; exit 2 ;;
    esac
done

# If --gemma but the WAR path doesn't exist, warn early.
if printf '%s\n' "${PROFILES[@]+"${PROFILES[@]}"}" | grep -q "gemma"; then
    WAR="${GEMMA_WAR_PATH:-$HOME/Dev/eclipseworkspace/Gemma/gemma-rest/target/gemma-rest.war}"
    if [ ! -f "$WAR" ]; then
        echo "ERROR: --gemma needs a WAR at $WAR — set GEMMA_WAR_PATH" >&2
        exit 1
    fi
fi

echo "[up] starting docker compose"
docker compose "${PROFILES[@]+"${PROFILES[@]}"}" up -d "${BUILD_FLAG[@]+"${BUILD_FLAG[@]}"}"

echo
echo "Services:"
echo "  curation UI    http://localhost:5175/"
echo "  local_api      http://localhost:8095/rest/v2/"
echo "  proposer       http://localhost:8082/health"
if printf '%s\n' "${PROFILES[@]+"${PROFILES[@]}"}" | grep -q "gemma"; then
    echo "  gemma-rest     http://localhost:8080/rest/v2/"
    echo "  gemma-db       mysql://localhost:3306"
fi
echo
echo "Tail logs:"
echo "  docker compose logs -f curation-ui"
echo "  docker compose logs -f local-api"
echo "  docker compose logs -f proposer"
