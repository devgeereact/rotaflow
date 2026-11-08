<?php
declare(strict_types=1);

// The database backup: a private, verified, pruned dump, and a restore check that proves it loads. Runs against the throwaway
// local test database only (lib.php refuses anything else).
use RotaFlow\Backup;

$cfg = ['dsn' => "mysql:host=$host;port=$port;dbname=$name;charset=utf8mb4", 'user' => $user, 'password' => $pass];
$dir = test_private_root() . '/backups-test';
$scratch = $name . '_restorecheck';
$threw = static function (callable $f): bool { try { $f(); return false; } catch (\Throwable) { return true; } };

$pdo->exec("INSERT INTO users (id, email, full_name) VALUES ('11111111-1111-4111-8111-111111111111', 'backup-a@example.test', 'Backup A'), ('22222222-2222-4222-8222-222222222222', 'backup-b@example.test', 'Backup B')");

// ---- the dump ------------------------------------------------------------------------------------------------------------
$b = new Backup($cfg, $dir);
$made = $b->create();
check('a dump is written with the agreed name', preg_match('/^rotaflow-\d{8}T\d{6}Z\.sql\.gz$/', basename($made['file'])) === 1 && is_file($made['file']));
check('the dump is private to its owner', (fileperms($made['file']) & 0777) === 0600);
check('a checksum file sits beside it and matches', is_file($made['file'] . '.sha256') && trim((string) file_get_contents($made['file'] . '.sha256')) === hash_file('sha256', $made['file']) . '  ' . basename($made['file']));
$sql = (string) gzdecode((string) file_get_contents($made['file']));
check('the dump holds the schema and the rows', str_contains($sql, 'CREATE TABLE `users`') && str_contains($sql, 'backup-a@example.test'));
check('a dump of a second moment is a second file', $b->create(time() + 1)['file'] !== $made['file']);

// ---- the password stays out of sight -------------------------------------------------------------------------------------
check('the password is not on the command line', !str_contains(implode(' ', $b->dumpCommand('/tmp/x.cnf')), $pass));
check('no credentials file is left behind', glob($dir . '/*.cnf') === [] && glob(sys_get_temp_dir() . '/rotaflow-dump-*') === []);
check('the summary never carries the password', !str_contains(json_encode($made), $pass));

// ---- a failed dump leaves nothing ----------------------------------------------------------------------------------------
$bad = new Backup(['password' => 'wrong-password-for-test'] + $cfg, $dir . '-bad');
check('a failing dump throws', $threw(fn () => $bad->create()));
check('a failing dump leaves no file behind', (glob($dir . '-bad/*') ?: []) === []);

// ---- retention -----------------------------------------------------------------------------------------------------------
$keepDir = test_private_root() . '/backups-keep';
mkdir($keepDir, 0700, true);
foreach (['20300101T000000Z', '20300102T000000Z', '20300103T000000Z', '20300104T000000Z'] as $stamp) {
    file_put_contents("$keepDir/rotaflow-$stamp.sql.gz", 'x');
    file_put_contents("$keepDir/rotaflow-$stamp.sql.gz.sha256", 'x');
}
file_put_contents("$keepDir/notes.txt", 'keep me');
$gone = (new Backup($cfg, $keepDir))->prune(2);
check('prune removes the oldest dumps and their checksums', count($gone) === 4 && !is_file("$keepDir/rotaflow-20300101T000000Z.sql.gz") && !is_file("$keepDir/rotaflow-20300102T000000Z.sql.gz.sha256"));
check('prune keeps the newest dumps', is_file("$keepDir/rotaflow-20300104T000000Z.sql.gz") && is_file("$keepDir/rotaflow-20300103T000000Z.sql.gz"));
check('prune never touches other files', is_file("$keepDir/notes.txt"));
check('prune refuses to keep fewer than one', $threw(fn () => (new Backup($cfg, $keepDir))->prune(0)));

// ---- the restore check ---------------------------------------------------------------------------------------------------
$raw = new PDO("mysql:host=$host;port=$port;charset=utf8mb4", $user, $pass, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
$raw->exec("DROP DATABASE IF EXISTS `$scratch`");
$raw->exec("CREATE DATABASE `$scratch` CHARACTER SET utf8mb4");
$fresh = (new Backup($cfg, $dir . '-restore'))->create();
$ok = (new Backup($cfg, $dir . '-restore'))->restoreCheck($scratch);
check('a good dump restores and every table matches', $ok['ok'] === true && $ok['mismatches'] === [] && $ok['tables'] > 20);
check('the check says which dump it proved', $ok['file'] === $fresh['file']);
check('the scratch database is emptied afterwards', (int) $raw->query("SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = '$scratch'")->fetchColumn() === 0);
$pdo->exec("DELETE FROM users WHERE email = 'backup-b@example.test'");
$drift = (new Backup($cfg, $dir . '-restore'))->restoreCheck($scratch);
check('rows missing from the source are reported by table', $drift['ok'] === false && isset($drift['mismatches']['users']) && $drift['mismatches']['users'] === ['dump' => $drift['mismatches']['users']['dump'], 'live' => $drift['mismatches']['users']['live']] && $drift['mismatches']['users']['dump'] === $drift['mismatches']['users']['live'] + 1);
$loose = (new Backup($cfg, $dir . '-restore'))->restoreCheck($scratch, 100.0);
check('a tolerance lets a busy live database pass', $loose['ok'] === true);
check('the check refuses to restore over the source database', $threw(fn () => (new Backup($cfg, $dir . '-restore'))->restoreCheck($name)));
check('the check fails clearly when there is no dump', $threw(fn () => (new Backup($cfg, test_private_root() . '/backups-empty'))->restoreCheck($scratch)));

// a tampered dump must not be trusted
$tamper = test_private_root() . '/backups-tamper';
mkdir($tamper, 0700, true);
$t = (new Backup($cfg, $tamper))->create();
file_put_contents($t['file'], gzencode('-- not the real dump'));
check('a dump that no longer matches its checksum is refused', $threw(fn () => (new Backup($cfg, $tamper))->restoreCheck($scratch)));
$raw->exec("DROP DATABASE IF EXISTS `$scratch`");

// ---- the command ---------------------------------------------------------------------------------------------------------
$cliRoot = test_private_root();
file_put_contents($cliRoot . '/config/config.php', "<?php return " . var_export($cfg, true) . ";\n");
chmod($cliRoot . '/config/config.php', 0600);
$cliDir = test_private_root() . '/backups-cli';
$run = static function (string $args) use ($cliRoot): array {
    $out = [];
    exec('ROTAFLOW_PRIVATE_ROOT=' . escapeshellarg($cliRoot) . ' ' . escapeshellarg(PHP_BINARY) . ' ' . escapeshellarg(__DIR__ . '/../../bin/backup.php') . ' ' . $args . ' 2>&1', $out, $rc);
    return [$rc, implode("\n", $out)];
};
[$rc, $out] = $run('--dir=' . escapeshellarg($cliDir) . ' --keep=3');
check('the command makes a dump and exits 0', $rc === 0 && count(glob($cliDir . '/rotaflow-*.sql.gz') ?: []) === 1);
check('the command prints a summary and no secret', str_contains($out, 'backup ok') && !str_contains($out, $pass));
[$rc2, $out2] = $run('--dir=' . escapeshellarg($cliDir) . ' --bogus');
check('the command rejects an unknown option', $rc2 === 2 && str_contains($out2, 'unknown option'));
[$rc3, $out3] = $run('--dir=' . escapeshellarg($cliDir) . ' --restore-check');
check('the restore check asks for a scratch database', $rc3 === 2 && str_contains($out3, '--scratch-db'));
