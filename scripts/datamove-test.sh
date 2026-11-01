#!/usr/bin/env bash
# LOCAL TEST ONLY: the Supabase -> MariaDB data move, end to end, on throwaway databases. Never connects to Supabase.
#   scripts/datamove-test.sh pg-up | pg-down      throwaway PostgreSQL 17 on 127.0.0.1:54329, data in .local-test/postgres
#   scripts/datamove-test.sh source [--shifts=N]  rebuild database rotaflow_source_test from supabase/migrations (with the
#                                                 Supabase shim) and fill it with synthetic data (backend/tests/datamove/seed-source.sql)
#   scripts/datamove-test.sh restore-dump <file> [db]  load a pg_dump (data only, custom format) into a local database built
#                                                 from supabase/migrations: the dump path of bin/datamove.php
#   scripts/datamove-test.sh target               recreate MariaDB database rotaflow_test_move (127.0.0.1:3308), migrations 001-020
#   scripts/datamove-test.sh schema <db> [ver]    an empty source schema from migrations 0001 to <ver> (default: all)
#   scripts/datamove-test.sh live-source <db> <ver>  a source at <ver> in the LIVE project's shape (seed-live-shape.sql)
#   scripts/datamove-test.sh live <ver> [plan]    live-source, then backend/tests/datamove/run-live.php at that version
#   scripts/datamove-test.sh all                  pg-up, source, target, then backend/tests/datamove/run.php (dry run, apply, verify,
#                                                 re-run, resume, files); then `live 0156` (production's version) and
#                                                 `live 0164` end to end, and `live <v> plan` for 0157 to 0163
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

# Builds database $1 from the Supabase shim and supabase/migrations up to and including version $2 (default: all of
# them). Production stops at 0156 (1 Nov 2026: 0157-0164 were never applied there), so the rehearsal builds both.
# Each applied file is recorded in supabase_migrations.schema_migrations, as the Supabase CLI records it, so the data
# move reads the source version the way it does on the live project.
build_schema() {
  local db="$1" upto="${2:-9999}"
  "$PGBIN/psql" -X -q -d postgres -c "DROP DATABASE IF EXISTS $db" -c "CREATE DATABASE $db" 2>/dev/null
  "$PGBIN/psql" -X -q -d postgres -c "ALTER DATABASE $db SET search_path = public, extensions" >/dev/null
  "$PGBIN/psql" -X -q -v ON_ERROR_STOP=1 -d "$db" -f "$ROOT/backend/tests/datamove/supabase-shim.sql" >/dev/null 2>&1
  "$PGBIN/psql" -X -q -v ON_ERROR_STOP=1 -d "$db" -c "CREATE SCHEMA IF NOT EXISTS supabase_migrations;
    CREATE TABLE IF NOT EXISTS supabase_migrations.schema_migrations (version text PRIMARY KEY, statements text[], name text);" >/dev/null
  local n=0 f v last=""
  for f in "$ROOT"/supabase/migrations/*.sql; do
    v="$(basename "$f" | cut -d_ -f1)"
    [ "$((10#$v))" -le "$((10#$upto))" ] || continue
    # pg_cron and pg_net are Supabase's; the shim provides the schemas and the functions the migrations call.
    sed -E '/create extension if not exists (pg_cron|pg_net)/Id' "$f" | "$PGBIN/psql" -X -q -v ON_ERROR_STOP=1 -d "$db" -f - >/dev/null 2>"$PGDIR/last-migration.err" || {
      echo "FAILED applying $(basename "$f")" >&2; cat "$PGDIR/last-migration.err" >&2; exit 1; }
    "$PGBIN/psql" -X -q -v ON_ERROR_STOP=1 -d "$db" -c "INSERT INTO supabase_migrations.schema_migrations (version, name) VALUES ('$v', '$(basename "$f" .sql | cut -d_ -f2-)')" >/dev/null
    n=$((n + 1)) last="$v"
  done
  echo "$db: schema from $n migrations (0001 to ${last:-none})"
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
  schema)
    # An empty source schema only: schema <database> [up-to version], e.g. schema rotaflow_source_0156 0156.
    db="${2:?usage: schema <database> [version]}"
    case "$db" in *source*) ;; *) echo "database name must contain source" >&2; exit 2 ;; esac
    "$0" pg-up >/dev/null
    build_schema "$db" "${3:-9999}"
    ;;
  live-source)
    # The live-shaped source: live-source <database> <version>, built from migrations 0001 to <version> and filled with
    # backend/tests/datamove/seed-live-shape.sql (the live project's row counts, synthetic values).
    db="${2:?usage: live-source <database> <version>}"; v="${3:?usage: live-source <database> <version>}"
    case "$db" in *source*) ;; *) echo "database name must contain source" >&2; exit 2 ;; esac
    "$0" pg-up >/dev/null
    build_schema "$db" "$v"
    "$PGBIN/psql" -X -q -v ON_ERROR_STOP=1 --single-transaction -d "$db" -f "$ROOT/backend/tests/datamove/seed-live-shape.sql" >/dev/null
    echo "$db: seeded in the live shape"
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
  mariadb-11.4)
    # The live host runs MariaDB 11.4.13; the harness runs 13.x. This starts a second throwaway server from Homebrew's
    # mariadb@11.4 on 127.0.0.1:3309 (data in .local-test/mariadb-11.4), runs migrations 001-020 and the move there, verifies,
    # and stops it again. Needs the seeded source (`source`).
    B="$(brew --prefix mariadb@11.4)/bin"; D="$ROOT/.local-test/mariadb-11.4"; S4="$D/mysqld.sock"; P4="$ROOT/.local-test/datamove-private-114"
    mkdir -p "$D" "$P4/config"
    [ -d "$D/data/mysql" ] || "$B/mariadb-install-db" --no-defaults --datadir="$D/data" --auth-root-authentication-method=normal >/dev/null
    nohup "$B/mariadbd" --no-defaults --datadir="$D/data" --port=3309 --bind-address=127.0.0.1 --socket="$S4" --pid-file="$D/mysqld.pid" \
      --skip-name-resolve --innodb-flush-log-at-trx-commit=0 >"$D/mysqld.log" 2>&1 &
    for _ in $(seq 1 60); do "$B/mariadb" --no-defaults --socket="$S4" -uroot -e 'SELECT 1' >/dev/null 2>&1 && break; sleep 0.5; done
    "$B/mariadb" --no-defaults --socket="$S4" -uroot -e "SELECT VERSION(); DROP DATABASE IF EXISTS rotaflow_test_move114; CREATE DATABASE rotaflow_test_move114 CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
      CREATE USER IF NOT EXISTS 'rf_test'@'127.0.0.1' IDENTIFIED BY 'rf_test_local_only'; GRANT ALL PRIVILEGES ON rotaflow_test_move114.* TO 'rf_test'@'127.0.0.1'; FLUSH PRIVILEGES;"
    cat >"$P4/config/config.php" <<EOF
<?php
return ['dsn' => 'mysql:host=127.0.0.1;port=3309;dbname=rotaflow_test_move114;charset=utf8mb4', 'user' => 'rf_test', 'password' => 'rf_test_local_only',
    'clerk_issuer' => 'https://example.invalid', 'clerk_authorized_parties' => ['http://localhost'], 'secret_key' => '$(openssl rand -base64 32)'];
EOF
    cp "$P4/config/config.php" "$P4/config/migrate.php"; chmod 600 "$P4/config/"*.php; rm -rf "$P4/datamove"
    printf 'postgres://postgres@127.0.0.1:%s/%s' "$PGPORT" "$SRC_DB" > "$P4/source-uri"; chmod 600 "$P4/source-uri"
    rc=0
    ROTAFLOW_PRIVATE_ROOT="$P4" php "$ROOT/backend/bin/migrate.php" | tail -1 || rc=1
    for c in plan apply verify; do ROTAFLOW_PRIVATE_ROOT="$P4" php "$ROOT/backend/bin/datamove.php" $c --source-uri-file="$P4/source-uri" | tail -2 | head -1 || rc=1; done
    ROTAFLOW_PRIVATE_ROOT="$P4" php "$ROOT/backend/bin/datamove.php" apply --resume --source-uri-file="$P4/source-uri" | { grep -cE "inserted=[1-9]|updated=[1-9]" || true; } | sed 's/^/tables changed by a second apply --resume: /'
    kill "$(cat "$D/mysqld.pid")"
    exit $rc
    ;;
  walk-db)
    # The local-live walk against MOVED data: rebuild the source with the walk's Clerk test addresses on six people, then
    # recreate the walk database (rotaflow_walk), migrate it and fill it with bin/datamove.php instead of seed-demo.php.
    # Then: scripts/walk.sh api, scripts/walk.sh web, WALK_KEEP_DB=1 pnpm run e2e:walk.
    "$0" source "${@:2}"
    psql_src -f "$ROOT/backend/tests/datamove/walk-identities.sql" >/dev/null
    WPRIV="$ROOT/.local-state/walk-private"
    bash "$ROOT/scripts/walk.sh" config >/dev/null
    mariadb --no-defaults --socket="$SOCK" -uroot <<SQL
DROP DATABASE IF EXISTS rotaflow_walk;
CREATE DATABASE rotaflow_walk CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER IF NOT EXISTS 'rf_walk'@'127.0.0.1' IDENTIFIED BY 'rf_walk_local_only';
GRANT ALL PRIVILEGES ON rotaflow_walk.* TO 'rf_walk'@'127.0.0.1';
FLUSH PRIVILEGES;
SQL
    rm -rf "$WPRIV/uploads" "$WPRIV/datamove" "$WPRIV/cache"/rl-* 2>/dev/null || true
    mkdir -p "$WPRIV/uploads"
    ROTAFLOW_PRIVATE_ROOT="$WPRIV" php "$ROOT/backend/bin/migrate.php" | tail -1
    printf 'postgres://postgres@127.0.0.1:%s/%s' "$PGPORT" "$SRC_DB" > "$WPRIV/source-uri" && chmod 600 "$WPRIV/source-uri"
    ROTAFLOW_PRIVATE_ROOT="$WPRIV" php "$ROOT/backend/bin/datamove.php" apply --source-uri-file="$WPRIV/source-uri" | tail -2
    ROTAFLOW_PRIVATE_ROOT="$WPRIV" php "$ROOT/backend/bin/datamove.php" verify --source-uri-file="$WPRIV/source-uri" | tail -2
    ;;
  live)
    # The live-shaped rehearsal at one version: live <version> [plan]. Full (plan, apply, verify, resume, and the
    # pre-0164 privacy cases) unless "plan" is given.
    v="${2:?usage: live <version> [plan]}"
    "$0" live-source "rotaflow_source_live_$v" "$v"
    bash "$ROOT/scripts/test-db.sh" up >/dev/null
    DATAMOVE_PG_PORT="$PGPORT" PGBIN="$PGBIN" DATAMOVE_LIVE_DB="rotaflow_source_live_$v" DATAMOVE_LIVE_VERSION="$v" DATAMOVE_LIVE_MODE="${3:-full}" \
      php "$ROOT/backend/tests/datamove/run-live.php"
    ;;
  all)
    # 1. the full synthetic source at the repo's newest version (0164); 2. the live-shaped source at 0156 (where
    # production stops) and at 0164, end to end; 3. a dry run of the live-shaped source at every version between.
    "$0" pg-up
    "$0" source "${@:2}"
    "$0" target
    rc=0
    DATAMOVE_PG_PORT="$PGPORT" ROTAFLOW_PRIVATE_ROOT="$PRIV" PGBIN="$PGBIN" php "$ROOT/backend/tests/datamove/run.php" || rc=1
    for v in 0156 0164; do "$0" live "$v" || rc=1; done
    for v in 0157 0158 0159 0160 0161 0162 0163; do "$0" live "$v" plan || rc=1; done
    [ "$rc" = 0 ] && echo "DATAMOVE: all rehearsals passed (full synthetic at 0164; live-shaped at 0156 and 0164; dry runs 0157-0163)" || echo "DATAMOVE: a rehearsal FAILED (see above)"
    exit $rc
    ;;
  *) sed -n '2,14p' "$0"; exit 2 ;;
esac
