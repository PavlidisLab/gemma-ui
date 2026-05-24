#!/bin/bash
# Apply every gemma-core MySQL migration to the local-mode gemd schema
# in numeric version order. Runs from MySQL's /docker-entrypoint-initdb.d
# on first container init (empty volume), before the real server
# accepts external connections.
#
# Replaces the manual Flyway step that prod relies on (gemma's
# DatabaseSchemaUpdatePopulator is a no-op stub in this branch — see
# its javadoc).
#
# Source files are bind-mounted from gemma-core at /gemma-migrations
# (see docker-compose.yml's gemma-db volumes block).

set -e

DB="${MYSQL_DATABASE:-gemd}"
SRC=/gemma-migrations

echo "[apply-gemma-migrations] applying migrations under $SRC to $DB..."

# `sort -V` puts V2 before V10 (numeric version sort). Plain `ls` /
# alphabetical sort would not.
for f in $(ls "$SRC"/V*__*.sql | sort -V); do
    echo "  $f"
    mysql --protocol=socket -uroot -p"$MYSQL_ROOT_PASSWORD" "$DB" < "$f"
done

echo "[apply-gemma-migrations] done."
