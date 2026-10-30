#!/usr/bin/env bash
# Throwaway local MariaDB for the PHP tests. Never touches live data: it listens on 127.0.0.1 only,
# keeps its data under .local-test/ (gitignored) and holds nothing but test databases.
#   scripts/test-db.sh up | down | status
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DIR="$ROOT/.local-test/mariadb"
PORT="${TEST_DB_PORT:-3308}"
SOCK="$DIR/mysqld.sock"
PIDF="$DIR/mysqld.pid"

running() { [ -f "$PIDF" ] && kill -0 "$(cat "$PIDF")" 2>/dev/null; }

case "${1:-}" in
  up)
    if running; then echo "already running on 127.0.0.1:$PORT"; exit 0; fi
    mkdir -p "$DIR"
    if [ ! -d "$DIR/data/mysql" ]; then
      mariadb-install-db --no-defaults --datadir="$DIR/data" --auth-root-authentication-method=normal >/dev/null
    fi
    nohup mariadbd --no-defaults --datadir="$DIR/data" --port="$PORT" --bind-address=127.0.0.1 \
      --socket="$SOCK" --pid-file="$PIDF" --skip-name-resolve --innodb-flush-log-at-trx-commit=0 \
      >"$DIR/mysqld.log" 2>&1 &
    for _ in $(seq 1 60); do
      mariadb --no-defaults --socket="$SOCK" -uroot -e 'SELECT 1' >/dev/null 2>&1 && break
      sleep 0.5
    done
    mariadb --no-defaults --socket="$SOCK" -uroot <<SQL
CREATE USER IF NOT EXISTS 'rf_test'@'127.0.0.1' IDENTIFIED BY 'rf_test_local_only';
GRANT ALL PRIVILEGES ON \`rotaflow\_test%\`.* TO 'rf_test'@'127.0.0.1';
FLUSH PRIVILEGES;
SQL
    echo "up on 127.0.0.1:$PORT (user rf_test, databases rotaflow_test*)"
    ;;
  down)
    if running; then kill "$(cat "$PIDF")"; echo "stopped"; else echo "not running"; fi
    ;;
  status)
    if running; then echo "running on 127.0.0.1:$PORT"; else echo "stopped"; exit 1; fi
    ;;
  *) echo "usage: $0 up|down|status" >&2; exit 2 ;;
esac
