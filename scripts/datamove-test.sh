#!/usr/bin/env bash
# LOCAL TEST ONLY: the Supabase -> MariaDB data move, end to end, on throwaway databases. Never connects to Supabase.
#   scripts/datamove-test.sh pg-up | pg-down      throwaway PostgreSQL 17 on 127.0.0.1:54329, data in .local-test/postgres
#   scripts/datamove-test.sh source [--shifts=N]  rebuild database rotaflow_source_test from supabase/migrations (with the
#                                                 Supabase shim) and fill it with synthetic data (backend/tests/datamove/seed-source.sql)
#   scripts/datamove-test.sh restore-dump <file> [db]  load a pg_dump (data only, custom format) into a local database built
#                                                 from supabase/migrations: the dump path of bin/datamove.php
#   scripts/datamove-test.sh target               recreate MariaDB database rotaflow_test_move (127.0.0.1:3308), migrations 001-020
#   scripts/datamove-test.sh all                  pg-up, source, target, then backend/tests/datamove/run.php (dry run, apply, verify,
#                                                 re-run, resume, files) and print the report path
# Needs: Homebrew postgresql@17 (initdb, pg_ctl, psql, pg_dump), MariaDB (scripts/test-db.sh), PHP with pdo_pgsql and pdo_mysql.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PGBIN="${PGBIN:-$(brew --prefix postgresql@17 2>/dev/null)/bin}"
PGDIR="$ROOT/.local-test/postgres"
PGPORT="${DATAMOVE_PG_PORT:-54329}"
SRC_DB=rotaflow_source_test
TGT_DB=rotaflow_test_move
PRIV="$ROOT/.local-test/datamove-private"
SOCK="$ROOT/.local-test/mariadb/mysqld.sock"
export PGHOST=127.0.0.1 PGPORT PGUSER=postgres

# Builds database $1 from the Supabase shim and the 164 migrations (the source schema as production has it).
build_schema() {
  local db="$1"
  "$PGBIN/psql" -X -q -d postgres -c "DROP DATABASE IF EXISTS $db" -c "CREATE DATABASE $db" 2>/dev/null
  "$PGBIN/psql" -X -q -d postgres -c "ALTER DATABASE $db SET search_path = public, extensions" >/dev/null
  "$PGBIN/psql" -X -q -v ON_ERROR_STOP=1 -d "$db" -f "$ROOT/backend/tests/datamove/supabase-shim.sql" >/dev/null 2>&1
  local n=0 f
  for f in "$ROOT"/supabase/migrations/*.sql; do
    # pg_cron and pg_net are Supabase's; the shim provides the schemas and the functions the migrations call.
    sed -E '/create extension if not exists (pg_cron|pg_net)/Id' "$f" | "$PGBIN/psql" -X -q -v ON_ERROR_STOP=1 -d "$db" -f - >/dev/null 2>"$PGDIR/last-migration.err" || {
      echo "FAILED applying $(basename "$f")" >&2; cat "$PGDIR/last-migration.err" >&2; exit 1; }
    n=$((n + 1))
  done
  echo "$db: schema from $n migrations"
}

pg_running() { "$PGBIN/pg_ctl" -D "$PGDIR/data" status >/dev/null 2>&1; }
psql_src() { "$PGBIN/psql" -X -q -v ON_ERROR_STOP=1 -d "$SRC_DB" "$@"; }

case "${1:-}" in
  pg-up)
    mkdir -p "$PGDIR"
    if [ ! -d "$PGDIR/data" ]; then
      "$PGBIN/initdb" -D "$PGDIR/data" -U postgres --auth=trust --encoding=UTF8 --locale=en_US.UTF-8 >/dev/null
    fi
    if ! pg_running; then
      "$PGBIN/pg_ctl" -D "$PGDIR/data" -l "$PGDIR/postgres.log" -o "-p $PGPORT -k $PGDIR -c listen_addresses=127.0.0.1 -c fsync=off -c timezone=UTC" -w start >/dev/null
    fi
    echo "postgres up on 127.0.0.1:$PGPORT"
    ;;
  pg-down)
    if pg_running; then "$PGBIN/pg_ctl" -D "$PGDIR/data" -m fast stop >/dev/null; echo "postgres stopped"; else echo "postgres not running"; fi
    ;;
  source)
    "$0" pg-up >/dev/null
    build_schema "$SRC_DB"
    shifts=10000
    for a in "${@:2}"; do case "$a" in --shifts=*) shifts="${a#--shifts=}" ;; esac; done
    psql_src -v shifts="$shifts" -f "$ROOT/backend/tests/datamove/seed-source.sql" >/dev/null
    echo "source seeded ($shifts shifts)"
    ;;
  restore-dump)
    # A pg_dump of the source's DATA (custom format; see docs/CUTOVER.md for the exact pg_dump line) loaded into a local
    # database built from supabase/migrations, so the data move can read it like the live one. Local only.
    dump="${2:?usage: restore-dump <file> [database]}"; db="${3:-rotaflow_source_dump}"
    case "$db" in *source*|*dump*) ;; *) echo "database name must contain source or dump" >&2; exit 2 ;; esac
    "$0" pg-up >/dev/null
    build_schema "$db"
    # The migrations seed reference rows (plans, flags, settings, buckets); the dump holds them too, so start empty.
    "$PGBIN/psql" -X -q -v ON_ERROR_STOP=1 -d "$db" -c "DO \$\$ DECLARE t text; BEGIN
      SELECT string_agg(format('%I.%I', schemaname, tablename), ', ') INTO t FROM pg_tables WHERE schemaname = 'public';
      EXECUTE 'TRUNCATE ' || t || ', auth.users, auth.identities, storage.objects, storage.buckets CASCADE'; END \$\$;"
    "$PGBIN/pg_restore" --data-only --disable-triggers --no-owner --exit-on-error -d "$db" "$dump"
    echo "restored $dump into $db"
    ;;
  target)
    bash "$ROOT/scripts/test-db.sh" up >/dev/null
    mkdir -p "$PRIV/config" "$PRIV/uploads" "$PRIV/logs" "$PRIV/cache"
    chmod 700 "$PRIV"
    SK="$(openssl rand -base64 32)"
    cat >"$PRIV/config/config.php" <<EOF
<?php
// LOCAL DATA-MOVE TEST ONLY (gitignored). Throwaway MariaDB on 127.0.0.1:3308.
return ['dsn' => 'mysql:host=127.0.0.1;port=3308;dbname=$TGT_DB;charset=utf8mb4', 'user' => 'rf_test', 'password' => 'rf_test_local_only',
    'app_url' => 'http://localhost', 'clerk_issuer' => 'https://example.invalid', 'clerk_authorized_parties' => ['http://localhost'], 'secret_key' => '$SK'];
EOF
    cp "$PRIV/config/config.php" "$PRIV/config/migrate.php"
    chmod 600 "$PRIV/config/"*.php
    mariadb --no-defaults --socket="$SOCK" -uroot -e "DROP DATABASE IF EXISTS $TGT_DB; CREATE DATABASE $TGT_DB CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
    rm -rf "$PRIV/uploads" && mkdir -p "$PRIV/uploads"
    ROTAFLOW_PRIVATE_ROOT="$PRIV" php "$ROOT/backend/bin/migrate.php" | tail -1
    ;;
  all)
    "$0" pg-up
    "$0" source "${@:2}"
    "$0" target
    DATAMOVE_PG_PORT="$PGPORT" ROTAFLOW_PRIVATE_ROOT="$PRIV" PGBIN="$PGBIN" php "$ROOT/backend/tests/datamove/run.php"
    ;;
  *) sed -n '2,10p' "$0"; exit 2 ;;
esac
