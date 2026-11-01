<?php
declare(strict_types=1);

// LOCAL TEST ONLY: helpers shared by the data-move rehearsals (run.php: the full synthetic source; run-live.php: the
// live-shaped source at each schema version). Never connects to anything but the throwaway local databases.
require_once __DIR__ . '/../../src/Autoload.php';

$root = dirname(__DIR__, 3);
$pgPort = getenv('DATAMOVE_PG_PORT') ?: '54329';
$pgBin = rtrim((string) getenv('PGBIN'), '/');
$sock = $root . '/.local-test/mariadb/mysqld.sock';
$pass = 0;
$fails = [];

function ok(string $label, bool $cond, string $detail = ''): void
{
    global $pass, $fails;
    if ($cond) {
        $pass++;
        echo "  ok   $label\n";
    } else {
        $fails[] = $label;
        echo "  FAIL $label" . ($detail !== '' ? " [$detail]" : '') . "\n";
    }
}

/** Runs the CLI against a private root; returns [exit code, decoded JSON report, output]. */
function move(string $privRoot, string $args, array $env = []): array
{
    global $root;
    $report = $privRoot . '/datamove/test-' . bin2hex(random_bytes(4)) . '.md';
    $e = '';
    foreach (['ROTAFLOW_PRIVATE_ROOT' => $privRoot] + $env as $k => $v) {
        $e .= $k . '=' . escapeshellarg($v) . ' ';
    }
    exec($e . 'php ' . escapeshellarg($root . '/backend/bin/datamove.php') . ' ' . $args . ' --report=' . escapeshellarg($report) . ' 2>&1', $out, $rc);
    $json = preg_replace('/\.md$/', '.json', $report);
    return [$rc, is_file($json) ? json_decode((string) file_get_contents($json), true) : null, implode("\n", $out)];
}

function sumCounts(?array $r, string $k): int
{
    return array_sum(array_map(static fn (array $c): int => (int) ($c[$k] ?? 0), $r['counts'] ?? []));
}

/** @return list<array{level:string,table:string,key:string,what:string}> */
function problemsAt(?array $r, string $level): array
{
    return array_values(array_filter($r['problems'] ?? [], static fn (array $p): bool => $p['level'] === $level));
}

function rootSql(string $sql): void
{
    global $sock;
    exec('mariadb --no-defaults --socket=' . escapeshellarg($sock) . ' -uroot -e ' . escapeshellarg($sql) . ' 2>&1', $out, $rc);
    if ($rc !== 0) {
        throw new RuntimeException(implode("\n", $out));
    }
}

/** A fresh migrated target database with its own private root. */
function target(string $db): string
{
    global $root;
    $p = $root . '/.local-test/datamove-private-' . $db;
    exec('rm -rf ' . escapeshellarg($p));
    mkdir($p . '/config', 0700, true);
    rootSql("DROP DATABASE IF EXISTS $db; CREATE DATABASE $db CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;");
    $cfg = "<?php return ['dsn' => 'mysql:host=127.0.0.1;port=3308;dbname=$db;charset=utf8mb4', 'user' => 'rf_test', 'password' => 'rf_test_local_only', 'secret_key' => '"
        . base64_encode(random_bytes(32)) . "', 'clerk_issuer' => 'https://example.invalid', 'clerk_authorized_parties' => ['http://localhost']];";
    file_put_contents($p . '/config/config.php', $cfg);
    file_put_contents($p . '/config/migrate.php', $cfg);
    chmod($p . '/config/config.php', 0600);
    exec('ROTAFLOW_PRIVATE_ROOT=' . escapeshellarg($p) . ' php ' . escapeshellarg($root . '/backend/bin/migrate.php') . ' 2>&1', $o, $rc);
    if ($rc !== 0) {
        throw new RuntimeException('migrate failed: ' . implode("\n", $o));
    }
    return $p;
}

function pgDb(string $db): PDO
{
    global $pgPort;
    $p = new PDO("pgsql:host=127.0.0.1;port=$pgPort;dbname=$db", 'postgres', '', [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC]);
    $p->exec("SET TIME ZONE 'UTC'");
    return $p;
}

function psqlFile(string $db, string $file): array
{
    global $pgBin, $pgPort;
    exec(escapeshellarg($pgBin . '/psql') . " -X -q -v ON_ERROR_STOP=1 -h 127.0.0.1 -p $pgPort -U postgres -d $db -At -f " . escapeshellarg($file) . ' 2>&1', $out, $rc);
    return [$rc, implode("\n", $out)];
}

/** A 0600 file holding the local source URI for database $db, inside $privRoot. */
function sourceUri(string $privRoot, string $db): string
{
    global $pgPort;
    $uri = $privRoot . '/source-uri-' . $db;
    file_put_contents($uri, "postgres://postgres@127.0.0.1:$pgPort/$db");
    chmod($uri, 0600);
    return $uri;
}

function finish(string $what): never
{
    global $pass, $fails;
    echo "\n$what: $pass passed, " . count($fails) . " failed\n";
    foreach ($fails as $f) {
        echo "  - $f\n";
    }
    exit($fails === [] ? 0 : 1);
}
