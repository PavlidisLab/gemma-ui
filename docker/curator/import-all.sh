#!/usr/bin/env bash
# Import every calibration package under ./calibration-packages/ into
# the running local-api. Run this once after `docker compose up`.
#
# Idempotent — re-running on an already-imported package returns
# was_existing=True without duplicating findings.
#
# Credentials: ``GEMMA_CURATION_API_KEY`` is resolved on the HOST
# via ``resolve_secrets.sh`` (keychain-first, env-var fallback) and
# passed into the container via ``--api-key``. This avoids the
# in-container ``setup.py`` having to reach the host's keychain
# (it can't — different OS, no `security` binary) and works
# cross-platform: macOS Keychain, Linux Secret Service, Windows
# Credential Manager are all checked.
#
# Usage (from this curator/ dir):
#   ./import-all.sh
set -euo pipefail
cd "$(dirname "$0")"

# shellcheck source=resolve_secrets.sh
. ./resolve_secrets.sh

# Resolve the local-api bearer on the host. The compose file
# already injects the host's ``GEMMA_CURATION_API_KEY`` into the
# local-api container at startup (defaulting to ``dev-token-123``).
# We resolve it again here to make absolutely sure the value the
# setup.py uses matches the value the local-api was started with —
# previously a curator could have the key in their keychain but
# not in their shell at compose-up time, causing the API to
# silently default to ``dev-token-123`` while setup.py picked up
# a different value (or vice versa), leading to 401s on import.
if api_key=$(resolve_secret GEMMA_CURATION_API_KEY \
                "GEMMA_CURATION_API_KEY" "gemma-curation-api-key" \
                2>/dev/null); then
    AUTH_ARGS=("--api-key" "$api_key")
    echo "[import-all] resolved GEMMA_CURATION_API_KEY from keychain/env"
else
    # No key resolved — fall through with no auth. The local-api
    # may be running in --no-auth mode, or the curator may have
    # explicitly skipped this step. setup.py will print
    # "auth=off" and the import will fail loudly if the server
    # is enforcing the bearer.
    AUTH_ARGS=("--no-auth")
    echo "[import-all] no GEMMA_CURATION_API_KEY found — running without auth."
    echo "             If imports return 401, see ./resolve_secrets.sh"
    echo "             for keychain setup instructions."
fi

shopt -s nullglob
pkgs=(./calibration-packages/*/)
shopt -u nullglob

if [ ${#pkgs[@]} -eq 0 ]; then
    echo "[import-all] no packages under ./calibration-packages/ — nothing to do."
    exit 0
fi

echo "[import-all] importing ${#pkgs[@]} package(s):"
for pkg in "${pkgs[@]}"; do
    name=$(basename "$pkg")
    echo "  → $name"
    docker compose exec local-api \
        python "/calibration-packages/$name/setup.py" \
        --base-url http://local-api:8000 \
        "${AUTH_ARGS[@]}"
done

echo
echo "[import-all] done. Open http://localhost:5175/ to review."
