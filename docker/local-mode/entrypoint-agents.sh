#!/bin/sh
# Entrypoint for the agents image. Installs gemma-curation-agents
# from the bind-mounted source (idempotent — pip skips already-
# satisfied requirements) and then execs whatever command compose
# passed in. Two compose services share this image; each gets its
# own command (mock-gemma serve / proposer-service serve).
set -eu

cd /agents

if [ ! -f /agents/.installed-marker ] || [ "${FORCE_REINSTALL:-0}" = "1" ]; then
    echo "[entrypoint] installing gemma-curation-agents (editable)"
    pip install --quiet --upgrade pip
    pip install --quiet -e .
    touch /agents/.installed-marker
fi

exec "$@"
