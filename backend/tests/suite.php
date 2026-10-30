<?php
declare(strict_types=1);

// Runs ONE suite file in this process: php backend/tests/suite.php backend/tests/suites/NNN-name.php
require __DIR__ . '/lib.php';
$pdo = fresh_db();
require $argv[1];
echo "RESULT $pass_n " . count($failures) . "\n";
exit($failures ? 1 : 0);
