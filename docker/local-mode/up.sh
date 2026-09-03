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
#   browser UI     http://localhost:5183
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

# Read-side Gemma host for the proposer + local-api live fetches.
# Keychain is authoritative (matches the agents repo convention); if
# no entry and nothing pre-set, the compose defaults apply.
if [ -z "${GEMMA_BASE_URL:-}" ]; then
    keychain_export GEMMA_BASE_URL "GEMMA_BASE_URL" "gemma-base-url" || true
fi

# Gemma account the proposer + local-api authenticate WITH. Resolved
# the same way as the host above, and for the same reason: the compose
# default is `groupadmin`, the account seeded into local-mode's own
# gemma-rest by `groupadmin-seed.sql`. It does not exist anywhere else.
#
# 🛑 The host flipped and the credentials did not. `GEMMA_BASE_URL`
# came from the keychain while these two kept the sandbox default, so
# the agent pointed at gemma2 holding an account gemma2 has never heard
# of, and every upstream call answered 401 "Provided authentication
# credentials are invalid." Nothing said so: the UI reported "save
# failed: 401" on the draft, which reads as the curator's own session
# expiring. Measured 2026-09-03 — the agent container had served 10,927
# of them and not one successful draft or lock since it started.
#
# Resolve both together or neither: a username that authenticates
# against one Gemma and a host that is a different Gemma is the shape
# of the bug.
if [ -z "${GEMMA_USERNAME:-}" ] && [ -z "${GEMMA_PASSWORD:-}" ]; then
    if keychain_export GEMMA_USERNAME "GEMMA_USERNAME" "gemma-username"; then
        keychain_export GEMMA_PASSWORD "GEMMA_PASSWORD" "gemma-password" \
            || { echo "ERROR: keychain has GEMMA_USERNAME but no GEMMA_PASSWORD — the pair must resolve together, or the agent authenticates as nobody against ${GEMMA_BASE_URL:-the compose default}" >&2; exit 1; }
    fi
fi

# Say which Gemma is about to be reached and as whom, since the pairing
# is what goes wrong and neither half is visible from the UI.
echo "[up] gemma: ${GEMMA_BASE_URL:-<compose default>} as ${GEMMA_USERNAME:-groupadmin (local-mode seed)}" >&2

# Browser UI (apps/browser) proxies /rest to its own backend var.
# Default it to whatever GEMMA_BASE_URL resolved to so the browser
# follows the same Gemma as the rest of the stack; the compose
# default (host.docker.internal:8080) only applies when neither is
# set. Override GEMMA_BROWSER_BACKEND to point the browser elsewhere.
if [ -z "${GEMMA_BROWSER_BACKEND:-}" ] && [ -n "${GEMMA_BASE_URL:-}" ]; then
    export GEMMA_BROWSER_BACKEND="$GEMMA_BASE_URL"
    echo "[up] GEMMA_BROWSER_BACKEND ← GEMMA_BASE_URL ($GEMMA_BASE_URL)" >&2
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
    WAR="${GEMMA_WAR_PATH:-$HOME/gemma/gemma-rest/target/gemma-rest.war}"
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
echo "  browser UI     http://localhost:5183/"
echo "  local_api      http://localhost:8095/rest/v2/"
echo "  proposer       http://localhost:8082/health"
if printf '%s\n' "${PROFILES[@]+"${PROFILES[@]}"}" | grep -q "gemma"; then
    echo "  gemma-rest     http://localhost:8080/rest/v2/"
    echo "  gemma-db       mysql://localhost:3306"
fi
echo
echo "Tail logs:"
echo "  docker compose logs -f curation-ui"
echo "  docker compose logs -f browser-ui"
echo "  docker compose logs -f local-api"
echo "  docker compose logs -f proposer"
