#!/bin/sh
# Entrypoint for the agents image. Installs gemma-curation-agents
# from the bind-mounted source (idempotent — pip skips already-
# satisfied requirements) and then execs whatever command compose
# passed in. Two compose services share this image; each gets its
# own command (mock-gemma serve / proposer-service serve).
set -eu

cd /agents

# Marker lives in /var (container layer), NOT under /agents (host
# bind-mount). Bind-mounted markers survive container recreate, which
# means the pip install -e step gets skipped and Python can't find
# the package — observed as ``ModuleNotFoundError: click`` after a
# fresh image rebuild (CAB smoke 2026-05-24).
MARKER=/var/lib/curation-agents-installed
if [ ! -f "$MARKER" ] || [ "${FORCE_REINSTALL:-0}" = "1" ]; then
    echo "[entrypoint] installing gemma-curation-agents (editable)"
    pip install --quiet --upgrade pip
    pip install --quiet -e .
    mkdir -p "$(dirname "$MARKER")"
    touch "$MARKER"
fi

exec "$@"
