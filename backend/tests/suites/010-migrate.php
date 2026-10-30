<?php
declare(strict_types=1);

// The SQL statement splitter and the migration runner.
use RotaFlow\Sql;

check('splits two statements', Sql::split('SELECT 1; SELECT 2;') === ['SELECT 1', 'SELECT 2']);
check('a semicolon inside a string does not split', Sql::split("INSERT INTO t VALUES ('a;b'); SELECT 1") === ["INSERT INTO t VALUES ('a;b')", 'SELECT 1']);
check('a semicolon inside a comment does not split', Sql::split("-- note; with semicolon\nSELECT 1; SELECT 2") === ['SELECT 1', 'SELECT 2']);
check('a doubled quote stays inside the string', Sql::split("SELECT 'it''s; fine'; SELECT 2") === ["SELECT 'it''s; fine'", 'SELECT 2']);
check('a backslash-escaped quote stays inside the string', Sql::split("SELECT 'a\\'; b'; SELECT 2") === ["SELECT 'a\\'; b'", 'SELECT 2']);
check('a semicolon in a backtick identifier does not split', Sql::split('SELECT 1 AS `a;b`; SELECT 2') === ['SELECT 1 AS `a;b`', 'SELECT 2']);
check('block comments are dropped', Sql::split('SELECT /* ; */ 1; SELECT 2') === ['SELECT   1', 'SELECT 2']);
check('a trailing statement without a semicolon is kept', Sql::split('SELECT 1; SELECT 2') === ['SELECT 1', 'SELECT 2']);
check('empty input gives no statements', Sql::split("  \n-- only a comment\n") === []);
check('a double dash directly after an operand is not a comment', count(Sql::split('SELECT 5--1; SELECT 2')) === 2);

// Runner against the real database.
$migrate = static function (string $dir, string $extra = '') use ($host, $port, $name, $user, $pass): array {
    $root = test_private_root();
    file_put_contents($root . '/config/migrate.php', "<?php return ['dsn'=>'mysql:host=$host;port=$port;dbname=$name;charset=utf8mb4','user'=>'$user','password'=>'$pass'];");
    exec('ROTAFLOW_PRIVATE_ROOT=' . escapeshellarg($root) . ' ROTAFLOW_MIGRATIONS_DIR=' . escapeshellarg($dir) . ' php ' . escapeshellarg(__DIR__ . '/../../bin/migrate.php') . " $extra 2>&1", $out, $rc);
    return [$rc, implode("\n", $out)];
};
$real = __DIR__ . '/../../migrations';
check('foundation migration created rate_limits', (int) $pdo->query("SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = 'rate_limits'")->fetchColumn() === 1);
check('foundation migration is logged with a checksum', (int) $pdo->query("SELECT COUNT(*) FROM schema_migrations WHERE name = '001-foundation.sql' AND CHAR_LENGTH(checksum) = 64")->fetchColumn() === 1);
[$rc, $out] = $migrate($real);
check('a second run applies nothing and succeeds', $rc === 0 && !str_contains($out, 'applying'), $out);

$tmp = test_private_root() . '/migs';
mkdir($tmp);
copy($real . '/001-foundation.sql', $tmp . '/001-foundation.sql');
file_put_contents($tmp . '/002-add.sql', "CREATE TABLE t_one (id INT PRIMARY KEY, note VARCHAR(40));\nINSERT INTO t_one VALUES (1, 'a;b');\n");
[$rc, $out] = $migrate($tmp, '--dry-run');
check('dry run lists the pending file and changes nothing', $rc === 0 && str_contains($out, 'would apply 002-add.sql') && (int) $pdo->query("SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = 't_one'")->fetchColumn() === 0, $out);
[$rc, $out] = $migrate($tmp);
check('a new file is applied once, with a semicolon inside a string intact', $rc === 0 && $pdo->query('SELECT note FROM t_one')->fetchColumn() === 'a;b', $out);
file_put_contents($tmp . '/002-add.sql', "CREATE TABLE t_one (id INT PRIMARY KEY, note VARCHAR(40));\n-- edited\n");
file_put_contents($tmp . '/003-next.sql', "CREATE TABLE t_two (id INT PRIMARY KEY);\n");
[$rc, $out] = $migrate($tmp);
check('an edited applied migration aborts with exit 2', $rc === 2 && str_contains($out, 'was modified'), "rc=$rc $out");
check('nothing after the tampered file was applied', (int) $pdo->query("SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = 't_two'")->fetchColumn() === 0);
copy($real . '/001-foundation.sql', $tmp . '/001-foundation.sql');
file_put_contents($tmp . '/002-add.sql', "CREATE TABLE t_one (id INT PRIMARY KEY, note VARCHAR(40));\nINSERT INTO t_one VALUES (1, 'a;b');\n");
file_put_contents($tmp . '/003-next.sql', "CREATE TABLE t_two (id INT PRIMARY KEY);\nCREATE TABLE t_two (id INT PRIMARY KEY);\n");
[$rc, $out] = $migrate($tmp);
check('a failing statement aborts with exit 3 and a category, not the SQL', $rc === 3 && str_contains($out, '003-next.sql failed') && !str_contains($out, 'CREATE TABLE'), "rc=$rc $out");
check('a failed file leaves no log row', (int) $pdo->query("SELECT COUNT(*) FROM schema_migrations WHERE name = '003-next.sql'")->fetchColumn() === 0);
