<?php
declare(strict_types=1);

// CLI only. Dumps the database to a private, checksummed, gzipped file and prunes old ones; or proves the newest dump restores.
//   php bin/backup.php [--dir=PATH] [--keep=28]
//   php bin/backup.php --restore-check --scratch-db=NAME [--tolerance=PERCENT] [--dir=PATH]
// Env: ROTAFLOW_PRIVATE_ROOT, ROTAFLOW_CONFIG_FILE (default config.php), ROTAFLOW_BACKUP_DIR (default $HOME/backups/rotaflow/db).
// Exit 0 ok, 1 failed, 2 bad usage. Nothing it prints holds a secret. Schedule it with cron; copy the folder off the server.
// The scratch database must already exist, be EMPTY and have "restorecheck" in its name (cPanel users create it once in the panel).
if (PHP_SAPI !== 'cli') {
    exit(1);
}
require_once __DIR__ . '/../src/Autoload.php';

use RotaFlow\{Backup, Bootstrap};

$opts = ['dir' => null, 'keep' => '28', 'restore-check' => false, 'scratch-db' => null, 'tolerance' => '0'];
foreach (array_slice($argv, 1) as $a) {
    if ($a === '--restore-check') {
        $opts['restore-check'] = true;
    } elseif (preg_match('/^--(dir|keep|scratch-db|tolerance)=(.+)$/', $a, $m) === 1) {
        $opts[$m[1]] = $m[2];
    } else {
        fwrite(STDERR, "unknown option $a\n");
        exit(2);
    }
}
if ($opts['restore-check'] && $opts['scratch-db'] === null) {
    fwrite(STDERR, "--restore-check needs --scratch-db=NAME\n");
    exit(2);
}
if (preg_match('/^\d+$/', (string) $opts['keep']) !== 1 || (int) $opts['keep'] < 1 || !is_numeric($opts['tolerance'])) {
    fwrite(STDERR, "--keep must be a whole number of at least 1 and --tolerance a number\n");
    exit(2);
}
$dir = $opts['dir'] ?? (getenv('ROTAFLOW_BACKUP_DIR') ?: rtrim((string) getenv('HOME'), '/') . '/backups/rotaflow/db');
$backup = new Backup(Bootstrap::config(Bootstrap::privateRoot(), getenv('ROTAFLOW_CONFIG_FILE') ?: 'config.php'), $dir);

try {
    if ($opts['restore-check']) {
        $r = $backup->restoreCheck((string) $opts['scratch-db'], (float) $opts['tolerance']);
        foreach ($r['mismatches'] as $table => $c) {
            echo "mismatch $table dump=" . ($c['dump'] ?? 'absent') . ' live=' . ($c['live'] ?? 'absent') . "\n";
        }
        echo ($r['ok'] ? 'restore-check ok' : 'restore-check FAILED') . ' ' . basename($r['file']) . ' tables=' . $r['tables'] . "\n";
        exit($r['ok'] ? 0 : 1);
    }
    $made = $backup->create();
    $removed = $backup->prune((int) $opts['keep']);
    echo 'backup ok ' . basename($made['file']) . ' bytes=' . $made['bytes'] . ' sha256=' . substr($made['sha256'], 0, 12) . ' pruned=' . count($removed) . "\n";
} catch (Throwable $e) {
    fwrite(STDERR, 'backup FAILED: ' . $e->getMessage() . "\n");
    exit(1);
}
