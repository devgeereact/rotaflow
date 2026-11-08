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

// ---- the dump tool itself failing, in the two ways that matter ------------------------------------------------------------
$fakeBin = test_private_root() . '/fake-bin';
mkdir($fakeBin, 0700, true);
$pathBefore = (string) getenv('PATH');
$leftovers = static fn (string $d): array => array_values(array_diff(is_dir($d) ? (scandir($d) ?: []) : [], ['.', '..', '.lock']));
foreach (['exits non-zero even though it printed the completion marker' => "#!/bin/sh\necho '-- partial dump'\necho 'INSERT INTO t VALUES (1);'\necho '-- Dump completed on 2026-11-08'\nexit 3\n", 'ends early without the completion marker' => "#!/bin/sh\necho '-- partial dump'\necho 'INSERT INTO t VALUES (1);'\nexit 0\n"] as $what => $script) {
    file_put_contents($fakeBin . '/mariadb-dump', $script);
    chmod($fakeBin . '/mariadb-dump', 0700);
    putenv('PATH=' . $fakeBin . ':' . $pathBefore);
    $failDir = test_private_root() . '/backups-fake-' . md5($what);
    $threwHere = $threw(fn () => (new Backup($cfg, $failDir))->create());
    putenv('PATH=' . $pathBefore);
    check("a dump tool that $what throws", $threwHere);
    check("and leaves no file behind, not even a partial one ($what)", $leftovers($failDir) === [], implode(',', $leftovers($failDir)));
}
unlink($fakeBin . '/mariadb-dump');

// a crashed run's partial file is cleared by the next run
$staleDir = test_private_root() . '/backups-stale';
mkdir($staleDir, 0700, true);
file_put_contents($staleDir . '/rotaflow-20200101T000000Z.sql.gz.part', 'half');
(new Backup($cfg, $staleDir))->create();
check('a partial file left by a crashed run is removed by the next run', !is_file($staleDir . '/rotaflow-20200101T000000Z.sql.gz.part'));

// ---- retention -----------------------------------------------------------------------------------------------------------
$keepDir = test_private_root() . '/backups-keep';
mkdir($keepDir, 0700, true);
foreach (['20300101T000000Z', '20300102T000000Z', '20300103T000000Z', '20300104T000000Z'] as $stamp) {
    file_put_contents("$keepDir/rotaflow-$stamp.sql.gz", 'x');
    file_put_contents("$keepDir/rotaflow-$stamp.sql.gz.sha256", 'x');
    file_put_contents("$keepDir/rotaflow-$stamp.sql.gz.counts.json", 'x');
}
file_put_contents("$keepDir/notes.txt", 'keep me');
$gone = (new Backup($cfg, $keepDir))->prune(2);
check('prune removes the oldest dumps with their checksums and counts', count($gone) === 6 && !is_file("$keepDir/rotaflow-20300101T000000Z.sql.gz.counts.json") && !is_file("$keepDir/rotaflow-20300101T000000Z.sql.gz") && !is_file("$keepDir/rotaflow-20300102T000000Z.sql.gz.sha256"));
check('prune keeps the newest dumps', is_file("$keepDir/rotaflow-20300104T000000Z.sql.gz") && is_file("$keepDir/rotaflow-20300103T000000Z.sql.gz"));
check('prune never touches other files', is_file("$keepDir/notes.txt"));
check('prune refuses to keep fewer than one', $threw(fn () => (new Backup($cfg, $keepDir))->prune(0)));

// ---- the restore check ---------------------------------------------------------------------------------------------------
$raw = new PDO("mysql:host=$host;port=$port;charset=utf8mb4", $user, $pass, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
$raw->exec("DROP DATABASE IF EXISTS `$scratch`");
$raw->exec("CREATE DATABASE `$scratch` CHARACTER SET utf8mb4");
$rdir = $dir . '-restore';
$fresh = (new Backup($cfg, $rdir))->create();
check('the dump carries a private counts file recorded at dump time', is_file($fresh['file'] . '.counts.json') && (fileperms($fresh['file'] . '.counts.json') & 0777) === 0600);
$counts = json_decode((string) file_get_contents($fresh['file'] . '.counts.json'), true);
check('the counts file names the dump and holds a range for every table', ($counts['sha256'] ?? '') === $fresh['sha256'] && isset($counts['tables']['users']) && count($counts['tables']['users']) === 2 && count($counts['tables']) > 20);
$ok = (new Backup($cfg, $rdir))->restoreCheck($scratch);
check('a good dump restores and every table matches what was recorded', $ok['ok'] === true && $ok['mismatches'] === [] && $ok['tables'] > 20);
check('the check says which dump it proved', $ok['file'] === $fresh['file']);
check('the scratch database is emptied afterwards', (int) $raw->query("SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = '$scratch'")->fetchColumn() === 0);
$pdo->exec("DELETE FROM users WHERE email = 'backup-b@example.test'");
check('live changes after the dump are not a failure: the check compares with the dump moment', (new Backup($cfg, $rdir))->restoreCheck($scratch)['ok'] === true);

// a dump that silently lost rows (checksum rewritten to match) must be caught even with no tolerance
$lossy = test_private_root() . '/backups-lossy';
mkdir($lossy, 0700, true);
$l = (new Backup($cfg, $lossy))->create();
$kept = [];
$skipping = false;
foreach (explode("\n", (string) gzdecode((string) file_get_contents($l['file']))) as $line) {
    if (str_starts_with($line, 'INSERT INTO `users`')) {
        $skipping = true; // the whole statement: the header line and the rows that follow it, up to the line ending in ;
    }
    if (!$skipping) {
        $kept[] = $line;
    }
    if ($skipping && str_ends_with($line, ';')) {
        $skipping = false;
    }
}
file_put_contents($l['file'], gzencode(implode("\n", $kept)));
file_put_contents($l['file'] . '.sha256', hash_file('sha256', $l['file']) . '  ' . basename($l['file']) . "\n");
// as if the dump tool had produced this short dump in the first place: the recorded hash follows it, the recorded counts do not
$lc = json_decode((string) file_get_contents($l['file'] . '.counts.json'), true);
$lc['sha256'] = hash_file('sha256', $l['file']);
file_put_contents($l['file'] . '.counts.json', json_encode($lc));
$lossy = (new Backup($cfg, $lossy))->restoreCheck($scratch);
check('a dump that lost rows is reported by table', $lossy['ok'] === false && isset($lossy['mismatches']['users']) && $lossy['mismatches']['users']['restored'] === 0 && $lossy['mismatches']['users']['expected_min'] >= 1);

// an old dump with no counts file falls back to the live comparison
$old = test_private_root() . '/backups-old';
mkdir($old, 0700, true);
$o = (new Backup($cfg, $old))->create();
unlink($o['file'] . '.counts.json');
$pdo->exec("INSERT INTO users (id, email, full_name) VALUES ('33333333-3333-4333-8333-333333333333', 'backup-c@example.test', 'Backup C')");
check('without a counts file the live database is the reference, exactly', (new Backup($cfg, $old))->restoreCheck($scratch)['ok'] === false);
check('and a tolerance lets a busy live database pass', (new Backup($cfg, $old))->restoreCheck($scratch, 100.0)['ok'] === true);

check('the check refuses to restore over the source database', $threw(fn () => (new Backup($cfg, $rdir))->restoreCheck($name)));
$nlMsg = '';
try { (new Backup($cfg, $rdir))->restoreCheck($scratch . "\n"); } catch (\Throwable $e) { $nlMsg = $e->getMessage(); }
check('a scratch name with a trailing newline is refused for its name, before any connection', str_contains($nlMsg, 'whose name contains "restorecheck"'), $nlMsg);
check('the check fails clearly when there is no dump', $threw(fn () => (new Backup($cfg, test_private_root() . '/backups-empty'))->restoreCheck($scratch)));

// a scratch database that holds tables of its own is somebody else's data: never wiped
$raw->exec("CREATE TABLE `$scratch`.`not_ours` (id INT)");
check('a scratch database with foreign tables is refused', $threw(fn () => (new Backup($cfg, $rdir))->restoreCheck($scratch)));
check('and its foreign table is still there', (int) $raw->query("SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = '$scratch' AND table_name = 'not_ours'")->fetchColumn() === 1);
$raw->exec("DROP TABLE IF EXISTS `$scratch`.`not_ours`");

// a tampered dump must not be trusted
$tamper = test_private_root() . '/backups-tamper';
mkdir($tamper, 0700, true);
$t = (new Backup($cfg, $tamper))->create();
file_put_contents($t['file'], gzencode('-- not the real dump'));
$msg = '';
try { (new Backup($cfg, $tamper))->restoreCheck($scratch); } catch (\Throwable $e) { $msg = $e->getMessage(); }
check('a dump that no longer matches its checksum is refused, saying why', str_contains($msg, 'checksum'));

// a dump and checksum that were swapped together, behind the counts file's back, are refused too
$swap = test_private_root() . '/backups-swap';
mkdir($swap, 0700, true);
$sw = (new Backup($cfg, $swap))->create();
file_put_contents($sw['file'], gzencode('-- swapped'));
file_put_contents($sw['file'] . '.sha256', hash_file('sha256', $sw['file']) . '  ' . basename($sw['file']) . "\n");
$msg3 = '';
try { (new Backup($cfg, $swap))->restoreCheck($scratch); } catch (\Throwable $e) { $msg3 = $e->getMessage(); }
check('a dump swapped together with its checksum is caught by the counts file', str_contains($msg3, 'counts file'));

// a dump the client cannot load fails cleanly: an error, no PHP warnings, scratch left empty
$bad2 = test_private_root() . '/backups-unloadable';
mkdir($bad2, 0700, true);
$u = (new Backup($cfg, $bad2))->create();
file_put_contents($u['file'], gzencode("THIS secret-person@example.test IS NOT SQL;\n" . str_repeat("-- padding to fill the pipe\n", 100000)));
file_put_contents($u['file'] . '.sha256', hash_file('sha256', $u['file']) . '  ' . basename($u['file']) . "\n");
$uc = json_decode((string) file_get_contents($u['file'] . '.counts.json'), true);
$uc['sha256'] = hash_file('sha256', $u['file']);
file_put_contents($u['file'] . '.counts.json', json_encode($uc));
$warned = false;
set_error_handler(static function (int $no) use (&$warned): bool {
    if (error_reporting() & $no) { // a warning the code deliberately silenced with @ is not shown to anyone
        $warned = true;
    }
    return true;
});
$msg2 = '';
try { (new Backup($cfg, $bad2))->restoreCheck($scratch); } catch (\Throwable $e) { $msg2 = $e->getMessage(); }
restore_error_handler();
check('an unloadable dump throws a clear error without PHP warnings', str_contains($msg2, 'did not restore') && $warned === false, 'message=' . substr($msg2, 0, 160) . ' warned=' . var_export($warned, true));
check('the error never quotes the dump, which holds personal data', !str_contains($msg2, 'secret-person') && str_contains($msg2, 'ERROR 1064'), $msg2);
check('and leaves the scratch database empty', (int) $raw->query("SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = '$scratch'")->fetchColumn() === 0);

// ---- the lock and the self-check ------------------------------------------------------------------------------------------
$lockDir = test_private_root() . '/backups-lock';
mkdir($lockDir, 0700, true);
$held = fopen($lockDir . '/.lock', 'c');
flock($held, LOCK_EX);
check('a second backup while one is running is refused', $threw(fn () => (new Backup($cfg, $lockDir))->create()));
flock($held, LOCK_UN);
check('the dump command asks for triggers but not for routines the schema does not have', in_array('--triggers', $b->dumpCommand('/tmp/x.cnf'), true) && !in_array('--routines', $b->dumpCommand('/tmp/x.cnf'), true));
check('the self-check passes on a healthy machine', (new Backup($cfg, test_private_root() . '/backups-self'))->selfCheck() === []);
$savedPath = (string) getenv('PATH');
putenv('PATH=/nonexistent');
$problems = (new Backup($cfg, test_private_root() . '/backups-self'))->selfCheck();
putenv('PATH=' . $savedPath);
check('the self-check names a missing dump tool', $problems !== [] && str_contains(implode(' ', $problems), 'mariadb-dump'));
check('the self-check reports a database it cannot reach', str_contains(implode(' ', (new Backup(['password' => 'nope'] + $cfg, test_private_root() . '/backups-self'))->selfCheck()), 'connect'));
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

// the command prunes, self-checks and restore-checks for real
$pruneDir = test_private_root() . '/backups-cli-prune';
mkdir($pruneDir, 0700, true);
foreach (['20200101T000000Z', '20200102T000000Z', '20200103T000000Z'] as $stamp) {
    file_put_contents("$pruneDir/rotaflow-$stamp.sql.gz", 'x');
}
[$rc4, $out4] = $run('--dir=' . escapeshellarg($pruneDir) . ' --keep=2');
check('the command prunes old dumps and says how many', $rc4 === 0 && str_contains($out4, 'pruned=2') && count(glob($pruneDir . '/rotaflow-*.sql.gz') ?: []) === 2);
[$rc5, $out5] = $run('--dir=' . escapeshellarg($cliDir) . ' --self-check');
check('the command can self-check and say so', $rc5 === 0 && str_contains($out5, 'self-check ok'));
$raw->exec("CREATE DATABASE IF NOT EXISTS `$scratch` CHARACTER SET utf8mb4");
[$rc6, $out6] = $run('--dir=' . escapeshellarg($cliDir) . ' --restore-check --scratch-db=' . escapeshellarg($scratch));
check('the command restore-checks the newest dump and exits 0', $rc6 === 0 && str_contains($out6, 'restore-check ok') && !str_contains($out6, $pass));
$raw->exec("DROP DATABASE IF EXISTS `$scratch`");
[$rc7, $out7] = $run('--dir=' . escapeshellarg($cliDir) . ' --restore-check --scratch-db=x_restorecheck --tolerance=-1');
check('a negative tolerance is rejected as bad usage', $rc7 === 2 && str_contains($out7, '--tolerance'));
