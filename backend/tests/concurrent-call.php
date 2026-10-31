<?php
declare(strict_types=1);

// Helper for the concurrency cases in suite 250-cover: ONE API call in its own process (its own database connection), started at a given
// instant so several processes race for the same row. Usage: php concurrent-call.php <who> <METHOD> <path> <start-at-unix-float> [json-body]
// Prints the status and body as one JSON line. Same local test database and fake sign-in as the suite (lib.php); never creates or drops it.
require __DIR__ . '/lib.php';

use RotaFlow\Db;

[, $who, $method, $path, $at] = $argv + [null, '', 'GET', '/', '0'];
$body = isset($argv[5]) ? (json_decode($argv[5], true) ?: []) : [];
$pdo = Db::connect(['dsn' => "mysql:host=$host;port=$port;dbname=$name;charset=utf8mb4", 'user' => $user, 'password' => $pass]);
$api = test_api($pdo);
while (microtime(true) < (float) $at) {
    usleep(1000);
}
[$status, $res] = call($api, (string) $who, (string) $method, (string) $path, $body);
echo json_encode([$status, $res]), "\n";
