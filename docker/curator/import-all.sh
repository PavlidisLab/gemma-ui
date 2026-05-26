#!/usr/bin/env bash
# Import every calibration package under ./calibration-packages/ into
# the running local-api. Run this once after `docker compose up`.
#
# Idempotent — re-running on an already-imported package returns
# was_existing=True without duplicating findings.
#
# Usage (from this curator/ dir):
#   ./import-all.sh
set -euo pipefail
cd "$(dirname "$0")"

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
        --base-url http://local-api:8000
done

echo
echo "[import-all] done. Open http://localhost:5175/ to review."
