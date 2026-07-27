#!/usr/bin/env bash
# Start the curator docker stack with credentials resolved from the
# host's keychain (or env vars, as fallback).
#
# Use this INSTEAD of ``docker compose up -d`` so the local-api
# container starts with the SAME ``GEMMA_CURATION_API_KEY`` value
# that ``import-all.sh`` will later pass to setup.py. If the two
# differ, setup.py gets 401s and the calibration package fails to
# load — the most common curator-side error.
#
# Cross-platform: resolves from macOS Keychain, Linux Secret
# Service, or Windows Credential Manager (whichever is available),
# then falls back to the shell environment.
#
# Usage:
#   ./start.sh                  # bring up the default stack
#   ./start.sh --profile agents # include the LLM-backed proposer
set -euo pipefail
cd "$(dirname "$0")"

# shellcheck source=resolve_secrets.sh
. ./resolve_secrets.sh

# Resolve the local-api bearer on the host, then export so docker
# compose's ``${GEMMA_CURATION_API_KEY:-dev-token-123}`` interpolation
# picks it up at compose-up time. If no key is resolved, the local-api
# starts with the public ``dev-token-123`` default — fine for fresh
# curator handoffs; only matters when the lab has rotated the key.
if val=$(resolve_secret GEMMA_CURATION_API_KEY \
            "GEMMA_CURATION_API_KEY" "gemma-curation-api-key" \
            2>/dev/null); then
    export GEMMA_CURATION_API_KEY="$val"
    echo "[start] GEMMA_CURATION_API_KEY resolved from keychain/env."
else
    echo "[start] no GEMMA_CURATION_API_KEY found — local-api will "
    echo "        run with the public 'dev-token-123' default. If "
    echo "        imports fail with 401, see ./resolve_secrets.sh "
    echo "        for keychain setup instructions."
fi

# GEMMA_BASE_URL — required, no fallback. Per design review's project-level
# rule (CLAUDE.md): the keychain entry IS the source of truth for
# the active dev target. Try keychain first; fall through to env /
# .env (compose-up errors loudly if still unset).
if val=$(resolve_secret GEMMA_BASE_URL \
            "GEMMA_BASE_URL" "gemma-base-url" \
            2>/dev/null); then
    export GEMMA_BASE_URL="$val"
    echo "[start] GEMMA_BASE_URL resolved from keychain: $val"
elif [ -n "${GEMMA_BASE_URL:-}" ]; then
    echo "[start] GEMMA_BASE_URL inherited from env: $GEMMA_BASE_URL"
else
    echo "[start] GEMMA_BASE_URL not set in keychain or env;"
    echo "        relying on .env. If unset there too, docker compose"
    echo "        up will error (intentional — no silent fallback)."
fi

# Optional: forward Anthropic key if the curator opted into the
# ``agents`` profile (LLM proposer). Same precedence; the proposer
# image reads ``ANTHROPIC_API_KEY`` from env at startup.
if val=$(resolve_secret ANTHROPIC_API_KEY \
            "ANTHROPIC_API_KEY" "anthropic" "Anthropic" "anthropic-api-key" \
            2>/dev/null); then
    export ANTHROPIC_API_KEY="$val"
    echo "[start] ANTHROPIC_API_KEY resolved (proposer profile usable)."
fi

# Pass through any --profile / -d / etc. flags the curator gave us.
exec docker compose up -d "$@"
