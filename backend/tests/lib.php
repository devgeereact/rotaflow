<?php
declare(strict_types=1);

// Shared test harness. Each suite runs in its OWN PHP process on a FRESH database (see run.php / suite.php).
// Env: TEST_DB_HOST/PORT/NAME/USER/PASS. The database is dropped and recreated: its name must contain "test".
require_once __DIR__ . '/../src/Autoload.php';

use RotaFlow\{Api, Db, HttpError, RateLimiter, Users};

$host = getenv('TEST_DB_HOST') ?: '127.0.0.1';
$port = getenv('TEST_DB_PORT') ?: '3308';
$name = getenv('TEST_DB_NAME') ?: 'rotaflow_test';
$user = getenv('TEST_DB_USER') ?: 'rf_test';
$pass = getenv('TEST_DB_PASS') ?: 'rf_test_local_only';
if (!str_contains($name, 'test') || !in_array($host, ['127.0.0.1', 'localhost'], true)) {
    fwrite(STDERR, "Refusing to run: database must be local and contain 'test' in its name\n");
    exit(2);
}

$pass_n = 0;
$failures = [];
function check(string $label, bool $ok, string $detail = ''): void
{
    global $pass_n, $failures;
    if ($ok) {
        $pass_n++;
    } else {
        $failures[] = $label . ($detail !== '' ? " [$detail]" : '');
        echo "FAIL: $label $detail\n";
    }
}
function expectError(string $label, callable $fn, int $status, ?string $code = null): void
{
    try {
        $fn();
        check($label, false, 'no error thrown');
    } catch (HttpError $e) {
        check($label, $e->status === $status && ($code === null || $e->errorCode === $code), "got {$e->status} {$e->errorCode}");
    }
}

/** Fresh database with every migration applied by the real runner. */
function fresh_db(): PDO
{
    global $host, $port, $name, $user, $pass;
    $raw = new PDO("mysql:host=$host;port=$port;charset=utf8mb4", $user, $pass, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
    $raw->exec("DROP DATABASE IF EXISTS `$name`");
    $raw->exec("CREATE DATABASE `$name` CHARACTER SET utf8mb4");
    $root = test_private_root();
    file_put_contents($root . '/config/migrate.php', "<?php return ['dsn'=>'mysql:host=$host;port=$port;dbname=$name;charset=utf8mb4','user'=>'$user','password'=>'$pass'];");
    exec('ROTAFLOW_PRIVATE_ROOT=' . escapeshellarg($root) . ' php ' . escapeshellarg(__DIR__ . '/../bin/migrate.php') . ' 2>&1', $out, $rc);
    if ($rc !== 0) {
        fwrite(STDERR, "Migration failed:\n" . implode("\n", $out) . "\n");
        exit(2);
    }
    return Db::connect(['dsn' => "mysql:host=$host;port=$port;dbname=$name;charset=utf8mb4", 'user' => $user, 'password' => $pass]);
}

/** A per-process private root (config, cache, uploads) under .local-test/tmp; removed at exit. */
function test_private_root(): string
{
    static $root = null;
    if ($root === null) {
        $base = dirname(__DIR__, 2) . '/.local-test/tmp';
        $root = $base . '/rotaflow-test-' . getmypid() . '-' . bin2hex(random_bytes(3));
        mkdir($root . '/config', 0700, true);
        mkdir($root . '/cache', 0700, true);
        register_shutdown_function(static function () use ($root): void {
            exec('rm -rf ' . escapeshellarg($root));
        });
    }
    return $root;
}

/**
 * API with a fake verifier: token "tok-<name>" is the signed-in person <name> (<name>@example.test), resolved to a real user row.
 * (JWT verification itself is covered in the core suite.)
 * @param list<RotaFlow\Module> $modules
 */
function test_api(PDO $pdo, ?array $modules = null, string $orgCreation = 'open'): Api
{
    $verify = static function (string $t) use ($pdo): array {
        if (preg_match('/^tok-([a-z0-9]+)$/', $t, $m) !== 1) {
            throw HttpError::unauthorized();
        }
        return Users::resolve($pdo, ['sub' => 'user_' . $m[1], 'email' => $m[1] . '@example.test']);
    };
    $limits = new RateLimiter($pdo);
    if ($modules === null) {
        $ctx = new RotaFlow\Ctx($pdo, $limits, 'https://rotaflow.example.test', test_private_root(), null, $orgCreation);
        $modules = RotaFlow\Modules::all($ctx);
    }
    return new Api($pdo, $verify, $limits, $modules);
}

/** Calls the API as <who> ('' = anonymous). @return array{0:int,1:array<string,mixed>} */
function call(Api $api, string $who, string $method, string $path, array $body = []): array
{
    $query = [];
    if (str_contains($path, '?')) {
        [$path, $qs] = explode('?', $path, 2);
        parse_str($qs, $query);
    }
    $h = $who === '' ? [] : ['authorization' => "Bearer tok-$who"];
    return $api->handle($method, $path, $h, $body !== [] ? json_encode($body) : '', '203.0.113.' . (crc32($who) % 250 + 1), $query);
}
