#!/bin/sh
set -eu

# Runs automatically on first PostgreSQL volume initialization.
# POSTGRES_DB is already created by the official postgres entrypoint;
# this script also ensures the dedicated test database exists.

TEST_DB="${DB_NAME_TEST:-odyssey-test}"

if [ -n "$TEST_DB" ] && [ "$TEST_DB" != "${POSTGRES_DB:-}" ]; then
  echo "[odyssey-init] Ensuring test database '$TEST_DB' exists..."
  psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname postgres <<-EOSQL
    SELECT 'CREATE DATABASE "' || replace('${TEST_DB}', '"', '""') || '"'
    WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = '${TEST_DB}')\gexec
EOSQL
fi

echo "[odyssey-init] PostgreSQL initialization complete."
