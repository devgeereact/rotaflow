<?php
declare(strict_types=1);

// CLI only. Moves RotaFlow's data from the Supabase Postgres database into the MariaDB schema (migrations 001-020), once,
// at the cutover. docs/CUTOVER.md is the runbook; its "Table map" section is the source -> target map.
//
//   php bin/datamove.php plan   [options]   dry run (the default): counts per table, problems, nothing written anywhere
//   php bin/datamove.php apply  [options]   write, one transaction per table group in foreign-key order (refuses a non-empty
//                                           target unless --resume; re-running changes nothing)
//   php bin/datamove.php verify [options]   row counts, a checksum per table and a field-by-field sample; files too, if moved
//   php bin/datamove.php files  [--apply]   copy Supabase Storage objects into <private root>/uploads (dry run unless --apply)
//
// Source (read-only: one REPEATABLE READ READ ONLY transaction): --source-uri-file=PATH (a file of mode 0600 holding the
// postgres:// URI) or the SUPABASE_DB_URL environment variable. A pg_dump is restored first into a local database
// (scripts/datamove-test.sh restore-dump) and named the same way. The URI is never printed.
// Target: the API's private config, ROTAFLOW_PRIVATE_ROOT/config/$ROTAFLOW_CONFIG_FILE (default config.php, the runtime user).
// Files: SUPABASE_URL (or --supabase-url=) and the service key from --service-key-file=PATH (0600) or SUPABASE_SERVICE_ROLE_KEY.
// Options: --resume, --exclude-org=<uuid>[,<uuid>], --exclude-demo-orgs, --sample=N (default 25), --report=PATH, --only=table[,table]
// Exit: 0 done and clean, 1 problems found (see the report), 2 usage or configuration.
if (PHP_SAPI !== 'cli') {
    exit(1);
}
require_once __DIR__ . '/../src/Autoload.php';

use RotaFlow\{Bootstrap, Db};
use RotaFlow\DataMove\{Convert, Files, Mover, Report};

$args = array_slice($argv, 1);
$cmd = 'plan';
$opt = [];
foreach ($args as $a) {
    if (preg_match('/^--([a-z-]+)(?:=(.*))?$/', $a, $m) === 1) {
        $opt[$m[1]] = $m[2] ?? true;
    } elseif (in_array($a, ['plan', 'apply', 'verify', 'files'], true)) {
        $cmd = $a;
    } else {
        fwrite(STDERR, "unknown argument: $a\n");
        exit(2);
    }
}
$known = ['source-uri-file', 'resume', 'exclude-org', 'exclude-demo-orgs', 'sample', 'report', 'only', 'apply', 'supabase-url', 'service-key-file'];
foreach (array_keys($opt) as $k) {
    if (!in_array($k, $known, true)) {
        fwrite(STDERR, "unknown option --$k\n");
        exit(2);
    }
}

/** Reads a secret from a file that only its owner can read, else from the environment. Never prints it. */
$secret = static function (?string $file, string $env, string $what): string {
    if (is_string($file) && $file !== '') {
        if (!is_file($file)) {
            fwrite(STDERR, "$what file not found\n");
            exit(2);
        }
        if ((fileperms($file) & 0077) !== 0) {
            fwrite(STDERR, "$what file must be readable by you only (chmod 600)\n");
            exit(2);
        }
        return trim((string) file_get_contents($file));
    }
    $v = getenv($env);
    if (!is_string($v) || $v === '') {
        fwrite(STDERR, "$what missing: give --" . ($env === 'SUPABASE_DB_URL' ? 'source-uri-file' : 'service-key-file') . "=PATH or set $env\n");
        exit(2);
    }
    return trim($v);
};

try {
    $root = Bootstrap::privateRoot();
    $config = Bootstrap::config($root, getenv('ROTAFLOW_CONFIG_FILE') ?: 'config.php');
    $dst = Db::connect($config);
    $pg = Convert::pgUri($secret(is_string($opt['source-uri-file'] ?? null) ? $opt['source-uri-file'] : null, 'SUPABASE_DB_URL', 'source connection'));
    $src = new PDO($pg['dsn'], $pg['user'], $pg['password'], [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
} catch (Throwable $e) {
    fwrite(STDERR, 'cannot connect: ' . Convert::scrub($e->getMessage()) . "\n");
    exit(2);
}
$targetName = (string) preg_replace('/^mysql:/', '', (string) preg_replace('/;?(user|password)=[^;]*/i', '', (string) $config['dsn']));
$meta = ['utc' => gmdate('c'), 'command' => $cmd, 'source' => $pg['host'], 'target' => $targetName];
$opts = [
    'exclude_orgs' => is_string($opt['exclude-org'] ?? null) ? array_filter(explode(',', $opt['exclude-org'])) : [],
    'exclude_demo' => isset($opt['exclude-demo-orgs']),
    'sample' => (int) ($opt['sample'] ?? 25),
    'only' => is_string($opt['only'] ?? null) ? array_filter(explode(',', $opt['only'])) : [],
];
foreach ($opts['exclude_orgs'] as $o) {
    if (preg_match('/^[0-9a-f-]{36}$/i', $o) !== 1) {
        fwrite(STDERR, "--exclude-org takes organisation ids\n");
        exit(2);
    }
}

try {
    $mover = new Mover($src, $dst, $config, $opts);
    $ok = true;
    $files = null;
    if ($cmd === 'plan') {
        $mover->plan();
        $ok = $mover->errors() === 0;
    } elseif ($cmd === 'apply') {
        $ok = $mover->apply(isset($opt['resume']));
    } elseif ($cmd === 'verify') {
        $ok = $mover->verify();
        if (is_file($root . '/datamove/files-manifest.json')) {
            $files = new Files($src, $root, [], static fn (string $u): array => [0, ''], '');
            $ok = $files->verify() && $ok;
        }
    } else {
        $base = is_string($opt['supabase-url'] ?? null) ? $opt['supabase-url'] : (string) getenv('SUPABASE_URL');
        $p = parse_url($base);
        $localHttp = ($p['scheme'] ?? '') === 'http' && in_array($p['host'] ?? '', ['127.0.0.1', 'localhost'], true);
        if (!$localHttp && (($p['scheme'] ?? '') !== 'https' || empty($p['host']))) {
            fwrite(STDERR, "SUPABASE_URL must be the project's https URL (https://<ref>.supabase.co)\n");
            exit(2);
        }
        $key = $secret(is_string($opt['service-key-file'] ?? null) ? $opt['service-key-file'] : null, 'SUPABASE_SERVICE_ROLE_KEY', 'service key');
        $fetch = static function (string $url) use ($key, $localHttp): array {
            $ch = curl_init($url);
            curl_setopt_array($ch, [CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 120, CURLOPT_CONNECTTIMEOUT => 10, CURLOPT_FOLLOWLOCATION => false,
                CURLOPT_PROTOCOLS => $localHttp ? CURLPROTO_HTTP : CURLPROTO_HTTPS, CURLOPT_SSL_VERIFYPEER => true, CURLOPT_SSL_VERIFYHOST => 2,
                CURLOPT_HTTPHEADER => ['Authorization: Bearer ' . $key, 'apikey: ' . $key]]);
            $body = curl_exec($ch);
            $status = (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
            if (!is_string($body)) {
                throw new RuntimeException('transfer failed: ' . curl_error($ch));
            }
            return [$status, $body];
        };
        $files = new Files($src, $root, $mover->blockedObjects(), $fetch, $base);
        $ok = $files->run(isset($opt['apply']));
    }
    $r = $mover->result();
    if ($files !== null) {
        $fr = $files->result();
        $r['files'] = $fr['counts'];
        $r['problems'] = [...($cmd === 'files' ? [] : $r['problems']), ...$fr['problems']];
        if ($cmd === 'files') {
            $r['counts'] = [];
            $r['notes'] = [];
        }
    }
    $meta['result'] = $ok ? 'OK' : 'PROBLEMS FOUND';
    $r['meta'] = $meta;
    $path = Report::write($root, $cmd . ($cmd === 'files' && !isset($opt['apply']) ? '-dry-run' : ''), $r, is_string($opt['report'] ?? null) ? $opt['report'] : null);
} catch (Throwable $e) {
    fwrite(STDERR, 'stopped: ' . Convert::scrub($e->getMessage()) . "\n");
    exit(1);
}

// A short summary on screen; the detail (with masked addresses only) is in the report.
$errors = count(array_filter($r['problems'], static fn (array $p): bool => $p['level'] === 'error'));
$warnings = count(array_filter($r['problems'], static fn (array $p): bool => $p['level'] === 'warning'));
foreach ($r['counts'] as $t => $c) {
    $bits = [];
    foreach ($c as $k => $v) {
        if (!in_array($k, ['source_sha256', 'target_sha256'], true)) {
            $bits[] = "$k=$v";
        }
    }
    printf("  %-34s %s\n", $t, implode(' ', $bits));
}
foreach ($r['files'] ?? [] as $k => $v) {
    printf("  files %-28s %s\n", $k, $v);
}
echo "$cmd: {$meta['result']} ($errors errors, $warnings warnings)\nreport: $path\n";
exit($ok ? 0 : 1);
