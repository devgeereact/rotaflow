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
 *                 the source database is refused), compares every table's row count with the live one, then empties the scratch database.
 */
final class Backup
{
    private const NAME = '/^rotaflow-(\d{8}T\d{6}Z)\.sql\.gz$/';

    /** @param array{dsn:string,user:string,password:string} $config */
    public function __construct(private readonly array $config, private readonly string $dir) {}

    /** @return array{file:string,bytes:int,sha256:string} */
    public function create(?int $now = null): array
    {
        $this->ensureDir();
        $lock = fopen($this->dir . '/.lock', 'c');
        if ($lock === false || !flock($lock, LOCK_EX | LOCK_NB)) {
            throw new \RuntimeException('Another backup is already running');
        }
        $cnf = $this->writeDefaultsFile();
        $final = $this->dir . '/rotaflow-' . gmdate('Ymd\THis\Z', $now ?? time()) . '.sql.gz';
        $part = $final . '.part';
        try {
            if (is_file($final)) {
                throw new \RuntimeException('A dump with this timestamp already exists');
            }
            $this->dumpTo($cnf, $part);
            chmod($part, 0600);
            rename($part, $final);
            $sha = (string) hash_file('sha256', $final);
            file_put_contents($final . '.sha256', $sha . '  ' . basename($final) . "\n");
            chmod($final . '.sha256', 0600);
            return ['file' => $final, 'bytes' => (int) filesize($final), 'sha256' => $sha];
        } finally {
            @unlink($cnf);
            if (is_file($part)) {
                @unlink($part);
            }
            flock($lock, LOCK_UN);
            fclose($lock);
        }
    }

    /** The dump command, with the credentials in $defaultsFile rather than in the arguments. @return list<string> */
    public function dumpCommand(string $defaultsFile): array
    {
        return [self::tool(['mariadb-dump', 'mysqldump']), '--defaults-extra-file=' . $defaultsFile, '--single-transaction', '--quick',
            '--routines', '--triggers', '--hex-blob', '--no-tablespaces', '--default-character-set=utf8mb4', $this->dsn()['dbname']];
    }

    /** @return list<string> the files removed */
    public function prune(int $keep): array
    {
        if ($keep < 1) {
            throw new \InvalidArgumentException('Keep at least one dump');
        }
        $removed = [];
        foreach (array_slice($this->dumps(), 0, max(0, count($this->dumps()) - $keep)) as $file) {
            foreach ([$file, $file . '.sha256'] as $f) {
                if (is_file($f) && unlink($f)) {
                    $removed[] = $f;
                }
            }
        }
        return $removed;
    }

    /**
     * @param float $tolerancePct how far a table's live count may drift from the dump's, as a share of the larger, before it counts
     *                            as a mismatch. 0 is exact (a quiet database); a busy live one needs a little.
     * @return array{ok:bool,file:string,tables:int,mismatches:array<string,array{dump:?int,live:?int}>}
     */
    public function restoreCheck(string $scratch, float $tolerancePct = 0.0): array
    {
        $dsn = $this->dsn();
        if (preg_match('/^[A-Za-z0-9_]+$/', $scratch) !== 1 || !str_contains(strtolower($scratch), 'restorecheck') || $scratch === $dsn['dbname']) {
            throw new \InvalidArgumentException('The scratch database must be a different database whose name contains "restorecheck"');
        }
        $file = $this->latest();
        $sumFile = $file . '.sha256';
        if (!is_file($sumFile) || !hash_equals(explode('  ', trim((string) file_get_contents($sumFile)))[0], (string) hash_file('sha256', $file))) {
            throw new \RuntimeException('The newest dump does not match its checksum; it is not trusted');
        }
        $scratchPdo = $this->connect($scratch);
        $cnf = $this->writeDefaultsFile();
        try {
            $this->emptyDatabase($scratchPdo);
            $this->load($cnf, $scratch, $file);
            $live = $this->counts($this->connect($dsn['dbname']));
            $dump = $this->counts($scratchPdo);
            $mismatches = [];
            foreach (array_unique([...array_keys($live), ...array_keys($dump)]) as $table) {
                $l = $live[$table] ?? null;
                $d = $dump[$table] ?? null;
                if ($l === null || $d === null || abs($l - $d) > ($tolerancePct / 100) * max($l, $d)) {
                    $mismatches[$table] = ['dump' => $d, 'live' => $l];
                }
            }
            return ['ok' => $mismatches === [], 'file' => $file, 'tables' => count($dump), 'mismatches' => $mismatches];
        } finally {
            @unlink($cnf);
            $this->emptyDatabase($scratchPdo);
        }
    }

    /** The newest dump's path. */
    public function latest(): string
    {
        $all = $this->dumps();
        if ($all === []) {
            throw new \RuntimeException('No dump found in ' . $this->dir);
        }
        return $all[count($all) - 1];
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
        $path = tempnam(sys_get_temp_dir(), 'rotaflow-dump-');
        if ($path === false) {
            throw new \RuntimeException('Cannot create a temporary credentials file');
        }
        chmod($path, 0600);
        file_put_contents($path, implode("\n", $lines) . "\n");
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
        $errFile = tempnam(sys_get_temp_dir(), 'rotaflow-dumperr-');
        $proc = proc_open($this->dumpCommand($cnf), [1 => ['pipe', 'w'], 2 => ['file', (string) $errFile, 'w']], $pipes);
        if (!is_resource($proc)) {
            throw new \RuntimeException('Cannot start the dump tool');
        }
        touch($part);
        chmod($part, 0600);
        $gz = gzopen($part, 'wb6');
        $tail = '';
        while (!feof($pipes[1])) {
            $chunk = fread($pipes[1], 1 << 16);
            if ($chunk === false || $chunk === '') {
                continue;
            }
            gzwrite($gz, $chunk);
            $tail = substr($tail . $chunk, -300);
        }
        gzclose($gz);
        fclose($pipes[1]);
        $rc = proc_close($proc);
        $err = trim(str_replace($this->config['password'], '***', (string) file_get_contents((string) $errFile)));
        @unlink((string) $errFile);
        if ($rc !== 0 || !str_contains($tail, 'Dump completed')) {
            @unlink($part);
            throw new \RuntimeException('The dump failed' . ($err !== '' ? ': ' . substr($err, 0, 300) : ' (it ended early)'));
        }
    }

    private function load(string $cnf, string $scratch, string $file): void
    {
        $proc = proc_open([self::tool(['mariadb', 'mysql']), '--defaults-extra-file=' . $cnf, '--default-character-set=utf8mb4', $scratch],
            [0 => ['pipe', 'r'], 1 => ['pipe', 'w'], 2 => ['pipe', 'w']], $pipes);
        if (!is_resource($proc)) {
            throw new \RuntimeException('Cannot start the restore tool');
        }
        $gz = gzopen($file, 'rb');
        while (!gzeof($gz)) {
            $chunk = gzread($gz, 1 << 16);
            if ($chunk === false) {
                break;
            }
            fwrite($pipes[0], $chunk);
        }
        gzclose($gz);
        fclose($pipes[0]);
        $err = (string) stream_get_contents($pipes[2]);
        stream_get_contents($pipes[1]);
        fclose($pipes[1]);
        fclose($pipes[2]);
        if (proc_close($proc) !== 0) {
            throw new \RuntimeException('The dump did not restore: ' . substr(str_replace($this->config['password'], '***', trim($err)), 0, 300));
        }
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
