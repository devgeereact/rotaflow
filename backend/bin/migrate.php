<?php
declare(strict_types=1);

// CLI only. Applies pending migrations in order using the MIGRATION identity (private config/migrate.php).
// Usage: php bin/migrate.php [--dry-run]    Env: ROTAFLOW_PRIVATE_ROOT, ROTAFLOW_MIGRATIONS_DIR, ROTAFLOW_CONFIG_FILE
// Applied files are never edited: a changed checksum aborts the run (exit 2) before anything else is applied.
// MariaDB commits DDL implicitly, so a file that fails halfway leaves its earlier statements in place and no log row;
// write migrations as additive, re-runnable statements (IF NOT EXISTS) so the fixed file can be applied again.
if (PHP_SAPI !== 'cli') {
    exit(1);
}
require_once __DIR__ . '/../src/Autoload.php';

use RotaFlow\{Bootstrap, Db, Sql};

$dry = in_array('--dry-run', $argv, true);
$root = Bootstrap::privateRoot();
$dir = getenv('ROTAFLOW_MIGRATIONS_DIR') ?: __DIR__ . '/../migrations';
$pdo = Db::connect(Bootstrap::config($root, getenv('ROTAFLOW_CONFIG_FILE') ?: 'migrate.php'));
$pdo->exec('CREATE TABLE IF NOT EXISTS schema_migrations (name VARCHAR(190) PRIMARY KEY, applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, checksum CHAR(64) NOT NULL) ENGINE=InnoDB');
$done = $pdo->query('SELECT name, checksum FROM schema_migrations')->fetchAll(PDO::FETCH_KEY_PAIR);
$files = glob($dir . '/[0-9][0-9][0-9]-*.sql') ?: [];
sort($files);

// Check every applied file first, so a tampered history stops the run before any new file is applied.
foreach ($files as $f) {
    $name = basename($f);
    if (isset($done[$name]) && $done[$name] !== hash_file('sha256', $f)) {
        fwrite(STDERR, "ABORT: applied migration $name was modified\n");
        exit(2);
    }
}
foreach ($files as $f) {
    $name = basename($f);
    if (isset($done[$name])) {
        continue;
    }
    echo ($dry ? 'would apply ' : 'applying ') . $name . "\n";
    if ($dry) {
        continue;
    }
    foreach (Sql::split((string) file_get_contents($f)) as $stmt) {
        try {
            $pdo->exec($stmt);
        } catch (Throwable $e) {
            fwrite(STDERR, "ABORT: $name failed (" . get_class($e) . ")\n");
            exit(3);
        }
    }
    $pdo->prepare('INSERT INTO schema_migrations (name, checksum) VALUES (?, ?)')->execute([$name, hash_file('sha256', $f)]);
}
echo "done\n";
