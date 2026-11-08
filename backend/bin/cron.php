<?php
declare(strict_types=1);

// CLI only. Runs scheduled module tasks: every class in src/Mod with `public static function cron(Ctx $ctx): string`
// (returns a short, non-sensitive summary). One run at a time, via a lock file. For cPanel cron (live runs it every five minutes; every minute also works):
//   * * * * * ROTAFLOW_PRIVATE_ROOT=$HOME/rotaflow-private php $HOME/rotaflow-private/app/bin/cron.php >> $HOME/rotaflow-private/logs/cron.log 2>&1
// Jobs decide for themselves whether they are due (they are idempotent), so the schedule is only a heartbeat.
if (PHP_SAPI !== 'cli') {
    exit(1);
}
require_once __DIR__ . '/../src/Autoload.php';

use RotaFlow\{Bootstrap, Ctx, Db, Modules, RateLimiter};

$root = Bootstrap::privateRoot();
$lockDir = $root . '/cache';
$lock = is_dir($lockDir) ? fopen($lockDir . '/cron.lock', 'c') : false;
if ($lock === false || !flock($lock, LOCK_EX | LOCK_NB)) {
    echo gmdate('c') . " cron already running or cache dir missing\n";
    exit(0);
}
$config = Bootstrap::config($root, getenv('ROTAFLOW_CONFIG_FILE') ?: 'config.php');
$pdo = Db::connect($config);
$ctx = new Ctx($pdo, new RateLimiter($pdo), (string) ($config['app_url'] ?? ''), $root, static fn (string $m) => Bootstrap::log($root, $m), 'invite_only', $config);
// Build the modules first, as the API does, so listeners they register in their constructors are active for the jobs below.
Modules::all($ctx);
$files = glob(__DIR__ . '/../src/Mod/*.php') ?: [];
sort($files);
$failed = 0;
$ran = 0;
foreach ($files as $f) {
    $class = 'RotaFlow\\Mod\\' . basename($f, '.php');
    if (!class_exists($class) || !method_exists($class, 'cron')) {
        continue;
    }
    $ran++;
    try {
        echo gmdate('c') . ' ' . basename($f, '.php') . ': ' . $class::cron($ctx) . "\n";
    } catch (Throwable $e) {
        $failed++; // one failing job must not stop the others
        echo gmdate('c') . ' ' . basename($f, '.php') . ': FAILED ' . get_class($e) . "\n";
        Bootstrap::log($root, 'cron_failed ' . basename($f, '.php') . ' ' . get_class($e));
    }
}
if ($ran === 0) {
    echo gmdate('c') . " no jobs registered\n";
}
exit($failed ? 1 : 0);
