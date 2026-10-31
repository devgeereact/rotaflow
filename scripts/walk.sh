#!/usr/bin/env bash
# LOCAL-LIVE WALK ONLY (docs/AUDIT.md, "Local-live walk"). Never touches the live server, live Clerk or Supabase.
#   scripts/walk.sh config   write the gitignored private config (.local-state/walk-private) for the Clerk DEVELOPMENT instance
#   scripts/walk.sh db       recreate the local database rotaflow_walk on the throwaway MariaDB (127.0.0.1:3308), migrate, seed, grant admin
#   scripts/walk.sh api      run the PHP API on 127.0.0.1:3042 against it (foreground)
#   scripts/walk.sh web      run Vite on localhost:5042 with /api proxied to the local API and the dev Clerk key (foreground)
#   scripts/walk.sh preview  build for production into .local-state/walk-dist and serve it on localhost:5041 (the CSP walk)
#   scripts/walk.sh flag <key> on|off   turn an R2 flag on or off for everyone (local database only)
#   scripts/walk.sh e2e [args]          run the walk specs (e2e/walk) with Playwright; needs `db`, `api` and `web` running
# Sign-in uses Clerk test-mode addresses only (owner/manager/staff/admin/noorg +clerk_test@example.com, code 424242).
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PRIV="$ROOT/.local-state/walk-private"
SOCK="$ROOT/.local-test/mariadb/mysqld.sock"
DB=rotaflow_walk
API_PORT="${WALK_API_PORT:-3042}"
# The RotaFlow Clerk DEVELOPMENT instance (public by design; never the production pk_live key).
PK_TEST="pk_test_ZGlzY3JldGUtd2FscnVzLTE3LmNsZXJrLmFjY291bnRzLmRldiQ"
ISSUER="https://discrete-walrus-17.clerk.accounts.dev"

root_sql() { mariadb --no-defaults --socket="$SOCK" -uroot "$@"; }

case "${1:-}" in
  config)
    mkdir -p "$PRIV/config" "$PRIV/cache" "$PRIV/logs" "$PRIV/uploads"
    chmod 700 "$PRIV"
    if [ ! -f "$PRIV/config/config.php" ]; then
      SK="$(openssl rand -base64 32)"
      cat >"$PRIV/config/config.php" <<EOF
<?php
// LOCAL WALK ONLY (gitignored). Throwaway MariaDB on 127.0.0.1:3308, Clerk DEVELOPMENT instance.
return [
    'dsn' => 'mysql:host=127.0.0.1;port=3308;dbname=$DB;charset=utf8mb4',
    'user' => 'rf_walk',
    'password' => 'rf_walk_local_only',
    'app_url' => 'http://localhost:5042',
    'clerk_issuer' => '$ISSUER',
    'clerk_authorized_parties' => ['http://localhost:5042', 'http://localhost:5041'],
    'trust_cf_connecting_ip' => false,
    'org_creation' => 'invite_only',
    'secret_key' => '$SK',
];
EOF
      cp "$PRIV/config/config.php" "$PRIV/config/migrate.php"
      chmod 600 "$PRIV/config/"*.php
    fi
    echo "config at $PRIV/config"
    ;;
  db)
    "$0" config >/dev/null
    bash "$ROOT/scripts/test-db.sh" up >/dev/null
    root_sql <<SQL
DROP DATABASE IF EXISTS $DB;
CREATE DATABASE $DB CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER IF NOT EXISTS 'rf_walk'@'127.0.0.1' IDENTIFIED BY 'rf_walk_local_only';
GRANT ALL PRIVILEGES ON $DB.* TO 'rf_walk'@'127.0.0.1';
FLUSH PRIVILEGES;
SQL
    rm -rf "$PRIV/uploads" "$PRIV/cache"/rl-* 2>/dev/null || true
    mkdir -p "$PRIV/uploads"
    ROTAFLOW_PRIVATE_ROOT="$PRIV" php "$ROOT/backend/bin/migrate.php" | tail -1
    ROTAFLOW_PRIVATE_ROOT="$PRIV" php "$ROOT/backend/bin/seed-demo.php" "${@:2}"
    ROTAFLOW_PRIVATE_ROOT="$PRIV" php "$ROOT/backend/bin/grant-platform-owner.php" admin+clerk_test@example.com
    ;;
  api)
    cd "$ROOT"
    ROTAFLOW_PRIVATE_ROOT="$PRIV" PHP_CLI_SERVER_WORKERS=4 exec php -S "127.0.0.1:$API_PORT" scripts/walk-router.php
    ;;
  web)
    cd "$ROOT"
    ROTAFLOW_API_PROXY="http://127.0.0.1:$API_PORT" VITE_CLERK_PUBLISHABLE_KEY="$PK_TEST" VITE_APP_URL="" VITE_SENTRY_DSN="" \
      exec pnpm exec vite --port 5042 --strictPort
    ;;
  preview)
    # A production build (no prerender, its own folder, never dist/) served on 5041 with /api proxied: the CSP walk runs here,
    # because the dev server injects inline scripts the production policy rightly refuses.
    cd "$ROOT"
    VITE_CLERK_PUBLISHABLE_KEY="$PK_TEST" VITE_APP_URL="" VITE_SENTRY_DSN="" pnpm exec vite build --outDir .local-state/walk-dist --emptyOutDir >/dev/null
    ROTAFLOW_API_PROXY="http://127.0.0.1:$API_PORT" exec pnpm exec vite preview --outDir .local-state/walk-dist --port 5041 --strictPort
    ;;
  flag)
    key="${2:?flag key}"; state="${3:?on|off}"
    case "$key" in staff_documents|scheduling_tools|cover_tools|timesheet_tools|two_way_swaps) ;; *) echo "unknown flag $key" >&2; exit 2 ;; esac
    v=0; [ "$state" = on ] && v=1
    root_sql "$DB" -e "UPDATE feature_flags SET enabled = $v, rollout = IF($v = 1, 100, 0) WHERE flag_key = '$key'; SELECT flag_key, enabled, rollout FROM feature_flags WHERE flag_key = '$key';"
    ;;
  e2e)
    cd "$ROOT"
    E2E_WALK=1 exec pnpm exec playwright test --config e2e/walk/playwright.walk.config.ts "${@:2}"
    ;;
  *) sed -n '2,10p' "$0"; exit 2 ;;
esac
