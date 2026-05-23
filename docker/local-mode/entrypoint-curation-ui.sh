#!/bin/sh
# Entrypoint for the curation-ui image. Installs npm deps when the
# named-volume node_modules is empty (first run / after `--force-recreate`)
# then runs the Vite dev server bound to all interfaces so the
# compose port mapping reaches it.
set -eu

cd /ui

# package-lock.json is at the monorepo root. If the workspace's
# node_modules is missing, install from root so the workspace links
# resolve correctly.
if [ ! -d /ui/apps/curation/node_modules ] || [ ! -d /ui/node_modules/.bin ]; then
    echo "[entrypoint] running npm install (workspace root)"
    npm install
fi

# --host 0.0.0.0 is the magic bit: without it Vite binds localhost
# inside the container and the compose port mapping serves nothing.
exec npm --workspace gemma-curation-ui run dev -- \
    --host 0.0.0.0 \
    --port 5173
