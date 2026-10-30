<?php
declare(strict_types=1);

// Runs every suite in backend/tests/suites in its own process on a fresh database.
// Usage: php backend/tests/run.php [filter]   e.g. php backend/tests/run.php 000
// Needs the local test database: scripts/test-db.sh up
$filter = $argv[1] ?? '';
// Scratch files stay inside the project (global rule), not the system temp dir.
$tmp = dirname(__DIR__, 2) . '/.local-test/tmp';
is_dir($tmp) || mkdir($tmp, 0700, true);
putenv('TMPDIR=' . $tmp);
$files = glob(__DIR__ . '/suites/*.php') ?: [];
sort($files);
$pass = 0;
$fail = 0;
$bad = [];
foreach ($files as $f) {
    if ($filter !== '' && !str_contains(basename($f), $filter)) {
        continue;
    }
    $out = [];
    exec(escapeshellarg(PHP_BINARY) . ' ' . escapeshellarg(__DIR__ . '/suite.php') . ' ' . escapeshellarg($f) . ' 2>&1', $out, $rc);
    $result = null;
    foreach ($out as $line) {
        if (preg_match('/^RESULT (\d+) (\d+)$/', $line, $m) === 1) {
            $result = [(int) $m[1], (int) $m[2]];
        } else {
            echo $line, "\n";
        }
    }
    if ($result === null) {
        echo "SUITE CRASHED: " . basename($f) . " (exit $rc)\n";
        $bad[] = basename($f);
        $fail++;
        continue;
    }
    [$p, $x] = $result;
    $pass += $p;
    $fail += $x;
    printf("  %-34s %4d passed %3d failed\n", basename($f), $p, $x);
    if ($x > 0) {
        $bad[] = basename($f);
    }
}
echo "\nTOTAL: $pass passed, $fail failed" . ($bad ? ' (' . implode(', ', $bad) . ')' : '') . "\n";
exit($fail > 0 ? 1 : 0);
