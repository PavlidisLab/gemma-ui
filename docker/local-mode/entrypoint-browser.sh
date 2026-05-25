#!/bin/sh
# Entrypoint for the browser-ui image. Mirrors entrypoint-curation-ui:
# installs npm deps when the named-volume node_modules is empty, then
# runs the Vite dev server bound to all interfaces.
set -eu

cd /ui

# package-lock.json is at the monorepo root. If the workspace's
# node_modules or the root bin links are missing, install from root
# so the workspace links resolve correctly.
if [ ! -d /ui/apps/browser/node_modules ] || [ ! -d /ui/node_modules/.bin ]; then
    echo "[entrypoint-browser] running npm install (workspace root)"
    npm install
fi

# --host 0.0.0.0 so the compose port mapping reaches Vite. --port 5183
# matches the standalone-dev convention so docs / bookmarks land on
# the same port whether the curator runs through docker or vite
# directly.
exec npm --workspace gembrow run dev -- \
    --host 0.0.0.0 \
    --port 5183
