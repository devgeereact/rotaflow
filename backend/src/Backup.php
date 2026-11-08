<?php
declare(strict_types=1);

namespace RotaFlow;

/**
 * A database dump you can trust: private, checksummed, pruned, and provably restorable.
 *
 * create()        mysqldump into rotaflow-<UTC>.sql.gz (mode 0600) plus a .sha256 beside it. The password reaches the dump tool through
 *                 a 0600 defaults file that is removed afterwards, never on a command line. A failed or truncated dump leaves no file.
 * prune()         keeps the newest N dumps (and their checksums); touches nothing else in the folder.
 * restoreCheck()  checks the newest dump against its checksum, loads it into a SCRATCH database (its name must contain "restorecheck";
 *                 the source database and any database that is not empty are refused), compares every table's row
 *                 count with the range recorded around the dump (rotaflow-<UTC>.sql.gz.counts.json), then empties the scratch database.
 * Time limits: a dump or a restore that runs past the deadline is stopped, so a hung tool cannot hold the lock for ever.
 * selfCheck()     lists what would stop a backup on this machine (a disabled proc_open, a missing tool, an unreachable database).
 */
final class Backup
{
    private const NAME = '/^rotaflow-(\d{8}T\d{6}Z)\.sql\.gz\z/';

    /** @param array{dsn:string,user:string,password:string} $config */
    /** @param int $timeoutSeconds how long the dump tool or the restore client may run before it is stopped */
    public function __construct(private readonly array $config, private readonly string $dir, private readonly int $timeoutSeconds = 1800) {}

    /** @return array{file:string,bytes:int,sha256:string} */
    public function create(?int $now = null): array
    {
        $this->ensureDir();
        $lock = fopen($this->dir . '/.lock', 'c');
        if ($lock === false || !flock($lock, LOCK_EX | LOCK_NB)) {
            throw new \RuntimeException('Another backup is already running');
        }
        foreach ([...(glob($this->dir . '/rotaflow-*{.part,.tmp}', GLOB_BRACE) ?: []), ...(glob($this->dir . '/.rotaflow-*') ?: [])] as $stale) {
            @unlink($stale); // we hold the lock, so these are from a crashed run
        }
        $cnf = $this->writeDefaultsFile();
        $final = $this->dir . '/rotaflow-' . gmdate('Ymd\THis\Z', $now ?? time()) . '.sql.gz';
        $part = $final . '.part';
        $sumTmp = $final . '.sha256.tmp';
        $cntTmp = $final . '.counts.json.tmp';
        try {
            if (is_file($final)) {
                throw new \RuntimeException('A dump with this timestamp already exists');
            }
            $live = $this->connect($this->dsn()['dbname']);
            $before = $this->counts($live);
            $this->dumpTo($cnf, $part);
            $after = $this->counts($live);
            chmod($part, 0600);
            self::verifyDumpFile($part); // read it back: a full disk or a cut-off write must never become a "good" dump
            $sha = (string) hash_file('sha256', $part);
            // The dump is one consistent moment somewhere between the two counts, so each table's count in it lies in [min, max] of them.
            $ranges = [];
            foreach (array_unique([...array_keys($before), ...array_keys($after)]) as $table) {
                $seen = array_filter([$before[$table] ?? null, $after[$table] ?? null], static fn ($n): bool => $n !== null);
                $ranges[$table] = [min($seen), max($seen)];
            }
            self::must(file_put_contents($sumTmp, $sha . '  ' . basename($final) . "\n"), 'Cannot write the checksum file');
            self::must(file_put_contents($cntTmp, json_encode(['dump' => basename($final), 'sha256' => $sha, 'at' => gmdate('c'), 'tables' => $ranges], JSON_UNESCAPED_SLASHES) . "\n"), 'Cannot write the counts file');
            self::must(chmod($sumTmp, 0600) && chmod($cntTmp, 0600), 'Cannot make the checksum files private');
            // Publish the sidecars first and the dump LAST: a dump is only ever visible with its checksum and counts beside it.
            self::must(rename($sumTmp, $final . '.sha256') && rename($cntTmp, $final . '.counts.json'), 'Cannot publish the checksum files');
            self::must(rename($part, $final), 'Cannot publish the dump');
            return ['file' => $final, 'bytes' => (int) filesize($final), 'sha256' => $sha];
        } finally {
            @unlink($cnf);
            foreach ([$part, $sumTmp, $cntTmp] as $f) {
                if (is_file($f)) {
                    @unlink($f);
                }
            }
            if (!is_file($final)) {
                // the dump never appeared, so sidecars that were already published would only be orphans
                @unlink($final . '.sha256');
                @unlink($final . '.counts.json');
            }
            flock($lock, LOCK_UN);
            fclose($lock);
        }
    }

    /** @template T @param T|false $result @return T */
    private static function must(mixed $result, string $message): mixed
    {
        if ($result === false) {
            throw new \RuntimeException($message);
        }
        return $result;
    }

    /** Reads a gzipped dump to its end and requires mysqldump's completion marker there. @throws \RuntimeException */
    public static function verifyDumpFile(string $file): void
    {
        $gz = @gzopen($file, 'rb');
        if ($gz === false) {
            throw new \RuntimeException('The dump cannot be read back');
        }
        $tail = '';
        while (!gzeof($gz)) {
            $chunk = gzread($gz, 1 << 16);
            if ($chunk === false) {
                gzclose($gz);
                throw new \RuntimeException('The dump cannot be read back to its end');
            }
            $tail = substr($tail . $chunk, -300);
        }
        gzclose($gz);
        if (!str_contains($tail, 'Dump completed')) {
            throw new \RuntimeException('The dump is incomplete (no completion marker at its end)');
        }
    }

    /**
     * The dump command, with the credentials in $defaultsFile rather than in the arguments. It uses --defaults-file (which reads ONLY that
     * file), not --defaults-extra-file: the extra file is read before the user's ~/.my.cnf, so a ~/.my.cnf on the host (the live server has one
     * for another project's account) silently overrode the configured credentials. --defaults-file must be the first option.
     * @return list<string>
     */
    public function dumpCommand(string $defaultsFile): array
    {
        return [self::tool(['mariadb-dump', 'mysqldump']), '--defaults-file=' . $defaultsFile, '--single-transaction', '--quick',
            '--triggers', '--hex-blob', '--no-tablespaces', '--default-character-set=utf8mb4', $this->dsn()['dbname']];
    }

    /** @return list<string> the files removed */
    public function prune(int $keep): array
    {
        if ($keep < 1) {
            throw new \InvalidArgumentException('Keep at least one dump');
        }
        $removed = [];
        foreach (array_slice($this->dumps(), 0, max(0, count($this->dumps()) - $keep)) as $file) {
            foreach ([$file, $file . '.sha256', $file . '.counts.json'] as $f) {
                if (is_file($f) && unlink($f)) {
                    $removed[] = $f;
                }
            }
        }
        return $removed;
    }

    /**
     * @param float $tolerancePct extra slack, as a share of the larger count, around each table's recorded range. 0 is exact. For a dump
     *                            that has no counts file (made before they existed) the reference is the live database as it is now,
     *                            and a busy one needs some slack.
     * @return array{ok:bool,file:string,tables:int,mismatches:array<string,array{restored:?int,expected_min:?int,expected_max:?int}>}
     */
    public function restoreCheck(string $scratch, float $tolerancePct = 0.0): array
    {
        $dsn = $this->dsn();
        if (preg_match('/^[A-Za-z0-9_]+\z/', $scratch) !== 1 || !str_contains(strtolower($scratch), 'restorecheck') || $scratch === $dsn['dbname']) {
            throw new \InvalidArgumentException('The scratch database must be a different database whose name contains "restorecheck"');
        }
        $file = $this->latest();
        $lock = fopen($this->dir . '/.lock', 'c');
        if ($lock === false || !flock($lock, LOCK_SH | LOCK_NB)) {
            throw new \RuntimeException('A backup is running in this folder; try again when it has finished');
        }
        try {
            return $this->checkAgainst($scratch, $tolerancePct, $file);
        } finally {
            flock($lock, LOCK_UN);
            fclose($lock);
        }
    }

    /** @return array{ok:bool,file:string,tables:int,mismatches:array<string,array{restored:?int,expected_min:?int,expected_max:?int}>} */
    private function checkAgainst(string $scratch, float $tolerancePct, string $file): array
    {
        $dsn = $this->dsn();
        $sha = (string) hash_file('sha256', $file);
        if (!hash_equals(explode('  ', trim((string) file_get_contents($file . '.sha256')))[0], $sha)) {
            throw new \RuntimeException('The newest dump does not match its checksum; it is not trusted');
        }
        $expected = null;
        if (is_file($file . '.counts.json')) {
            $c = json_decode((string) file_get_contents($file . '.counts.json'), true);
            if (!is_array($c) || ($c['sha256'] ?? '') !== $sha || !is_array($c['tables'] ?? null)) {
                throw new \RuntimeException('The counts file does not belong to the newest dump; it is not trusted');
            }
            foreach ($c['tables'] as $range) {
                if (!is_array($range) || count($range) !== 2 || !is_int($range[0] ?? null) || !is_int($range[1] ?? null)) {
                    throw new \RuntimeException('The counts file is malformed; it is not trusted');
                }
            }
            $expected = $c['tables'];
        }
        $liveCounts = $this->counts($this->connect($dsn['dbname']));
        $scratchPdo = $this->connect($scratch);
        $present = (int) $scratchPdo->query('SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = DATABASE()')->fetchColumn();
        if ($present > 0) {
            // Whatever is in there is not ours: a restore of real data into a *_restorecheck database must never be wiped.
            throw new \InvalidArgumentException("The scratch database is not empty ($present tables or views); it will not be touched. Empty it by hand first");
        }
        $cnf = $this->writeDefaultsFile();
        try {
            $this->load($cnf, $scratch, $file);
            $restored = $this->counts($scratchPdo);
            $expected ??= array_map(static fn (int $n): array => [$n, $n], $liveCounts);
            $mismatches = [];
            foreach (array_unique([...array_keys($expected), ...array_keys($restored)]) as $table) {
                $r = $restored[$table] ?? null;
                $e = $expected[$table] ?? null;
                $slack = ($r === null || $e === null) ? 0.0 : ($tolerancePct / 100) * max($e[1], $r);
                if ($r === null || $e === null || $r < $e[0] - $slack || $r > $e[1] + $slack) {
                    $mismatches[$table] = ['restored' => $r, 'expected_min' => $e[0] ?? null, 'expected_max' => $e[1] ?? null];
                }
            }
            return ['ok' => $mismatches === [], 'file' => $file, 'tables' => count($restored), 'mismatches' => $mismatches];
        } finally {
            @unlink($cnf);
            try {
                $this->emptyDatabase($scratchPdo); // it was empty when we started, so only what we loaded is removed
            } catch (\Throwable) {
                // never let a failed cleanup hide the error that matters
            }
        }
    }

    /** @return list<string> what would stop a backup or a restore check on this machine; empty when it is ready */
    public function selfCheck(): array
    {
        $problems = [];
        $disabled = array_map('trim', explode(',', (string) ini_get('disable_functions')));
        if (!function_exists('proc_open') || in_array('proc_open', $disabled, true)) {
            $problems[] = 'proc_open is disabled in this PHP, so the dump tool cannot be started';
        }
        if (!function_exists('gzopen')) {
            $problems[] = 'the zlib extension is missing';
        }
        foreach ([['mariadb-dump', 'mysqldump'], ['mariadb', 'mysql']] as $names) {
            try {
                self::tool($names);
            } catch (\RuntimeException $e) {
                $problems[] = $e->getMessage() . ' (check the PATH cron runs with)';
            }
        }
        try {
            $this->connect($this->dsn()['dbname']);
        } catch (\Throwable) {
            $problems[] = 'cannot connect to the database with the configured account';
        }
        try {
            $this->ensureDir();
            if (!is_writable($this->dir)) {
                $problems[] = 'the backup folder is not writable';
            }
        } catch (\RuntimeException $e) {
            $problems[] = $e->getMessage();
        }
        return $problems;
    }

    /** The newest dump's path; a dump without its checksum beside it is not a candidate. */
    public function latest(): string
    {
        $all = $this->dumps();
        if ($all === []) {
            throw new \RuntimeException('No dump found in ' . $this->dir);
        }
        for ($i = count($all) - 1; $i >= 0; --$i) {
            if (is_file($all[$i] . '.sha256')) {
                return $all[$i];
            }
        }
        throw new \RuntimeException('No dump in ' . $this->dir . ' has a checksum beside it');
    }

    // ---- internals --------------------------------------------------------------------------------------------------------

    /** @return list<string> dump paths, oldest first (the UTC stamp in the name sorts by time) */
    private function dumps(): array
    {
        $out = [];
        foreach (glob($this->dir . '/rotaflow-*.sql.gz') ?: [] as $f) {
            if (preg_match(self::NAME, basename($f)) === 1) {
                $out[] = $f;
            }
        }
        sort($out);
        return $out;
    }

    private function ensureDir(): void
    {
        if (!is_dir($this->dir) && !mkdir($this->dir, 0700, true) && !is_dir($this->dir)) {
            throw new \RuntimeException('Cannot create the backup folder');
        }
    }

    /** @return array{host:string,port:string,dbname:string,unix_socket:string} */
    private function dsn(): array
    {
        $parts = ['host' => '', 'port' => '', 'dbname' => '', 'unix_socket' => ''];
        foreach (explode(';', substr($this->config['dsn'], (int) strpos($this->config['dsn'], ':') + 1)) as $kv) {
            [$k, $v] = array_pad(explode('=', $kv, 2), 2, '');
            if (array_key_exists($k, $parts)) {
                $parts[$k] = $v;
            }
        }
        if ($parts['dbname'] === '') {
            throw new \RuntimeException('The database name is missing from the configuration');
        }
        return $parts;
    }

    private function connect(string $dbname): \PDO
    {
        $d = $this->dsn();
        $dsn = $d['unix_socket'] !== '' ? 'mysql:unix_socket=' . $d['unix_socket'] : 'mysql:host=' . $d['host'] . ($d['port'] !== '' ? ';port=' . $d['port'] : '');
        return Db::connect(['dsn' => $dsn . ';dbname=' . $dbname . ';charset=utf8mb4', 'user' => $this->config['user'], 'password' => $this->config['password']]);
    }

    /** A 0600 file the dump tools read the credentials from. The caller removes it. */
    private function writeDefaultsFile(): string
    {
        $d = $this->dsn();
        $q = static fn (string $v): string => '"' . str_replace(['\\', '"'], ['\\\\', '\\"'], $v) . '"';
        $lines = ['[client]', 'user=' . $q($this->config['user']), 'password=' . $q($this->config['password'])];
        if ($d['unix_socket'] !== '') {
            $lines[] = 'socket=' . $q($d['unix_socket']);
        } else {
            $lines[] = 'host=' . $q($d['host'] !== '' ? $d['host'] : 'localhost');
            if ($d['port'] !== '') {
                $lines[] = 'port=' . (int) $d['port'];
            }
        }
        $this->ensureDir();
        if (!is_writable($this->dir)) {
            throw new \RuntimeException('The backup folder is not writable: ' . $this->dir);
        }
        // tempnam() quietly falls back to the shared temporary folder when it cannot write where it was told: never accept that.
        $path = tempnam($this->dir, '.rotaflow-dump-');
        if ($path === false || realpath(dirname($path)) !== realpath($this->dir)) {
            if ($path !== false) {
                @unlink($path);
            }
            throw new \RuntimeException('Cannot create a temporary credentials file in the backup folder');
        }
        self::must(chmod($path, 0600), 'Cannot make the credentials file private');
        self::must(file_put_contents($path, implode("\n", $lines) . "\n"), 'Cannot write the credentials file');
        register_shutdown_function(static function () use ($path): void {
            @unlink($path);
        });
        return $path;
    }

    /** @param list<string> $names */
    private static function tool(array $names): string
    {
        foreach ($names as $n) {
            foreach (explode(PATH_SEPARATOR, (string) getenv('PATH')) as $p) {
                if ($p !== '' && is_executable($p . '/' . $n)) {
                    return $p . '/' . $n;
                }
            }
        }
        throw new \RuntimeException('Neither ' . implode(' nor ', $names) . ' is installed');
    }

    private function dumpTo(string $cnf, string $part): void
    {
        $errFile = (string) tempnam($this->dir, '.rotaflow-dumperr-');
        try {
            $proc = proc_open($this->dumpCommand($cnf), [1 => ['pipe', 'w'], 2 => ['file', $errFile, 'w']], $pipes);
            if (!is_resource($proc)) {
                throw new \RuntimeException('Cannot start the dump tool');
            }
            touch($part);
            chmod($part, 0600);
            $gz = gzopen($part, 'wb6');
            if ($gz === false) {
                proc_terminate($proc, 9);
                fclose($pipes[1]);
                proc_close($proc);
                throw new \RuntimeException('Cannot write the dump file');
            }
            stream_set_blocking($pipes[1], false);
            $deadline = microtime(true) + $this->timeoutSeconds;
            $tail = '';
            $failure = null;
            while (true) {
                $r = [$pipes[1]];
                $w = $e = null;
                if (@stream_select($r, $w, $e, 1) > 0) {
                    $chunk = fread($pipes[1], 1 << 16);
                    if ($chunk !== false && $chunk !== '') {
                        if (gzwrite($gz, $chunk) !== strlen($chunk)) {
                            $failure = 'The dump could not be written (disk full?)';
                            break;
                        }
                        $tail = substr($tail . $chunk, -300);
                    }
                }
                if (feof($pipes[1])) {
                    break;
                }
                if (microtime(true) > $deadline) {
                    $failure = 'The dump timed out after ' . $this->timeoutSeconds . ' seconds and was stopped';
                    break;
                }
            }
            if ($failure !== null) {
                proc_terminate($proc, 9);
            }
            $closed = gzclose($gz);
            fclose($pipes[1]);
            $rc = proc_close($proc);
            if ($failure === null && !$closed) {
                $failure = 'The dump could not be written (disk full?)';
            }
            $err = trim(str_replace($this->config['password'], '***', (string) file_get_contents($errFile)));
            if ($failure !== null || $rc !== 0 || !str_contains($tail, 'Dump completed')) {
                @unlink($part);
                throw new \RuntimeException($failure ?? 'The dump failed' . ($err !== '' ? ': ' . substr($err, 0, 300) : ' (it ended early)'));
            }
        } finally {
            @unlink($errFile);
        }
    }

    private function load(string $cnf, string $scratch, string $file): void
    {
        $errFile = (string) tempnam($this->dir, '.rotaflow-loaderr-');
        try {
            $proc = proc_open([self::tool(['mariadb', 'mysql']), '--defaults-file=' . $cnf, '--default-character-set=utf8mb4', $scratch],
                [0 => ['pipe', 'r'], 1 => ['file', '/dev/null', 'w'], 2 => ['file', $errFile, 'w']], $pipes);
            if (!is_resource($proc)) {
                throw new \RuntimeException('Cannot start the restore tool');
            }
            $gz = gzopen($file, 'rb');
            if ($gz === false) {
                proc_terminate($proc, 9);
                fclose($pipes[0]);
                proc_close($proc);
                throw new \RuntimeException('Cannot read the dump file');
            }
            stream_set_blocking($pipes[0], false);
            $deadline = microtime(true) + $this->timeoutSeconds;
            $timedOut = false;
            // Feed the client without ever blocking on it: it stops reading at its first error, and a hung one must not hold us.
            // Whole lines only, so a DEFINER clause is never split across two chunks; the last partial line is carried over.
            $carry = '';
            while ((!gzeof($gz) || $carry !== '') && !$timedOut) {
                if (!gzeof($gz)) {
                    $read = gzread($gz, 1 << 16);
                    if ($read === false) {
                        break;
                    }
                    $data = $carry . $read;
                    $cut = strrpos($data, "\n");
                    if ($cut === false) {
                        $carry = $data;
                        continue;
                    }
                    $chunk = self::withoutDefiners(substr($data, 0, $cut + 1));
                    $carry = substr($data, $cut + 1);
                } else {
                    $chunk = self::withoutDefiners($carry);
                    $carry = '';
                }
                for ($off = 0, $len = strlen($chunk); $off < $len;) {
                    $r = null;
                    $w = [$pipes[0]];
                    $e = null;
                    if (@stream_select($r, $w, $e, 1) > 0) {
                        $n = @fwrite($pipes[0], substr($chunk, $off));
                        if ($n === false) {
                            break 2; // the client has gone (its error is read below)
                        }
                        $off += $n;
                    }
                    if (microtime(true) > $deadline) {
                        $timedOut = true;
                        break 2;
                    }
                }
            }
            gzclose($gz);
            @fclose($pipes[0]);
            $exit = null;
            while ($exit === null) {
                $st = proc_get_status($proc);
                if (!$st['running']) {
                    $exit = (int) $st['exitcode'];
                } elseif (microtime(true) > $deadline) {
                    $timedOut = true;
                    break;
                } else {
                    usleep(100000);
                }
            }
            if ($timedOut) {
                proc_terminate($proc, 9);
            }
            proc_close($proc);
            if ($timedOut) {
                throw new \RuntimeException('The restore timed out after ' . $this->timeoutSeconds . ' seconds and was stopped');
            }
            if ($exit !== 0) {
                // The client quotes the SQL near its error, and the dump holds personal data: keep only the error number and line.
                $err = (string) file_get_contents($errFile);
                $brief = preg_match('/ERROR \d+ \(\w+\)( at line \d+)?/', $err, $m) === 1 ? $m[0] : 'the client reported an error';
                throw new \RuntimeException('The dump did not restore: ' . $brief);
            }
        } finally {
            @unlink($errFile);
        }
    }

    /**
     * Drops `DEFINER=`user`@`host`` from the schema statements of a dump (lines that start a conditional comment or a CREATE), never from
     * row data. A dump records which account created each trigger or view; loading it as another, unprivileged account would need SUPER
     * (error 1227). The restore check only has to prove the data and structure come back, so the objects are created by the loading account.
     */
    private static function withoutDefiners(string $text): string
    {
        return (string) preg_replace_callback(
            '/^(?:\/\*!|CREATE ).*$/m',
            static fn (array $m): string => preg_replace('/ ?DEFINER=`[^`]*`@`[^`]*`/', '', $m[0]) ?? $m[0],
            $text,
        );
    }

    private function emptyDatabase(\PDO $pdo): void
    {
        $pdo->exec('SET FOREIGN_KEY_CHECKS = 0');
        foreach ($pdo->query("SELECT table_name, table_type FROM information_schema.tables WHERE table_schema = DATABASE()")->fetchAll(\PDO::FETCH_NUM) as [$t, $type]) {
            $pdo->exec(($type === 'VIEW' ? 'DROP VIEW `' : 'DROP TABLE `') . str_replace('`', '', (string) $t) . '`');
        }
        $pdo->exec('SET FOREIGN_KEY_CHECKS = 1');
    }

    /** @return array<string,int> */
    private function counts(\PDO $pdo): array
    {
        $out = [];
        foreach ($pdo->query("SELECT table_name FROM information_schema.tables WHERE table_schema = DATABASE() AND table_type = 'BASE TABLE'")->fetchAll(\PDO::FETCH_COLUMN) as $t) {
            $out[(string) $t] = (int) $pdo->query('SELECT COUNT(*) FROM `' . str_replace('`', '', (string) $t) . '`')->fetchColumn();
        }
        return $out;
    }
}
