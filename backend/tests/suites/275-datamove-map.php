<?php
declare(strict_types=1);

// The Supabase -> MariaDB data move (bin/datamove.php), the parts that need no PostgreSQL: value conversion against the
// target's own column metadata, safe storage paths, the URI parser that never echoes a secret, and the map checked against
// the migrated schema (every target table and key exists, foreign-key order holds). The end-to-end run against a real
// PostgreSQL built from supabase/migrations is scripts/datamove-test.sh all (backend/tests/datamove/run.php).
use RotaFlow\DataMove\{Convert, Map};

$col = static fn (string $type, array $extra = []): array => $extra + ['type' => $type, 'len' => null, 'bytes' => null, 'precision' => null, 'scale' => null, 'dtp' => null, 'unsigned' => false, 'enum' => null, 'nullable' => true];

// ---- values ----
check('a UTC instant keeps its seconds in DATETIME', Convert::value('2026-10-25 01:30:59.999999', $col('datetime', ['dtp' => 0]))[0] === '2026-10-25 01:30:59');
check('DATETIME(3) keeps milliseconds, cut not rounded', Convert::value('2026-10-25 01:30:59.999999', $col('datetime', ['dtp' => 3]))[0] === '2026-10-25 01:30:59.999');
check('DATETIME(6) keeps microseconds', Convert::value('2026-03-29 00:59:59.000001', $col('datetime', ['dtp' => 6]))[0] === '2026-03-29 00:59:59.000001');
check('an instant with an offset other than UTC is refused', Convert::value('2026-10-25 01:30:00+01', $col('datetime'))[1] === 'not_a_datetime');
check('booleans become 1 and 0', Convert::value(true, $col('tinyint'))[0] === '1' && Convert::value(false, $col('tinyint'))[0] === '0' && Convert::value('f', $col('tinyint'))[0] === '0');
check('pence stay integers', Convert::value(29900, $col('int', ['unsigned' => true]))[0] === '29900');
check('a negative into an unsigned column is refused', Convert::value(-1, $col('int', ['unsigned' => true]))[1] === 'out_of_range');
check('a tinyint out of range is refused', Convert::value(300, $col('tinyint', ['unsigned' => true]))[1] === 'out_of_range');
check('a fractional number into an integer column is refused', Convert::value('12.5', $col('int'))[1] === 'not_an_integer');
check('decimals are padded to the scale', Convert::value('37.5', $col('decimal', ['precision' => 5, 'scale' => 2]))[0] === '37.50');
check('decimals that would lose digits are refused', Convert::value('1.255', $col('decimal', ['precision' => 5, 'scale' => 2]))[1] === 'loses_decimals');
check('trailing zeros beyond the scale are fine', Convert::value('1.2500', $col('decimal', ['precision' => 5, 'scale' => 2]))[0] === '1.25');
check('decimals too large are refused', Convert::value('12345.5', $col('decimal', ['precision' => 5, 'scale' => 2]))[1] === 'out_of_range');
check('floats round-trip in their shortest form', Convert::value('51.5033635', $col('double'))[0] === '51.5033635' && Convert::value(51.5033635, $col('double'))[0] === '51.5033635');
check('an enum value outside the target list is refused', Convert::value('notice', $col('enum', ['enum' => ['info', 'warning', 'critical']]))[1] === 'not_in_enum');
check('text longer than the column is refused, counted in characters', Convert::value(str_repeat('é', 81), $col('varchar', ['len' => 80]))[1] === 'too_long'
    && Convert::value(str_repeat('é', 80), $col('varchar', ['len' => 80]))[1] === null);
check('TEXT is limited in bytes', Convert::value(str_repeat('ü', 40000), $col('text', ['bytes' => 65535]))[1] === 'too_long');
check('invalid UTF-8 is refused', Convert::value("\xff\xfe", $col('varchar', ['len' => 10]))[1] === 'not_utf8');
check('NULL into NOT NULL is refused', Convert::value(null, $col('varchar', ['nullable' => false]))[1] === 'null_not_allowed');
check('a time loses only its fraction', Convert::value('09:00:00.5', $col('time'))[0] === '09:00:00');
check('cmpInt compares beyond 64 bits', Convert::cmpInt('18446744073709551616', '18446744073709551615') === 1 && Convert::cmpInt('-5', '3') === -1);

// ---- storage paths ----
$o = '00000002-0000-4000-8000-000000000001';
$p = '0000000a-0000-4000-8000-000000000007';
check('a valid object path is kept', Convert::storagePath("$o/$p/dbs.pdf") === "$o/$p/dbs.pdf");
$safe = (string) Convert::storagePath("$o/$p/Right to Work – Zoë.pdf");
check('an unsafe file name is cleaned, keeps its extension and gains a hash', preg_match('#^' . $o . '/' . $p . '/Right-to-Work-Zo-[0-9a-f]{8}\.pdf$#', $safe) === 1, $safe);
check('the cleaned path is one FileStore accepts', RotaFlow\FileStore::validObject($safe));
check('two names that clean alike stay two files', Convert::storagePath("$o/$p/a b.pdf") !== Convert::storagePath("$o/$p/a_b.pdf") && Convert::storagePath("$o/$p/a b.pdf") !== Convert::storagePath("$o/$p/a(b).pdf"));
check('a path outside <org>/<person>/<file> has no place', Convert::storagePath('documents/visa.pdf') === null && Convert::storagePath("$o/../x.pdf") === null);

// ---- secrets ----
$u = Convert::pgUri('postgresql://postgres.abcd:s3cr%40t@aws-0-eu-west-2.pooler.supabase.com:5432/postgres');
check('the URI parser gives a DSN with TLS required, and the decoded password', $u['dsn'] === 'pgsql:host=aws-0-eu-west-2.pooler.supabase.com;port=5432;dbname=postgres;sslmode=require' && $u['password'] === 's3cr@t' && $u['user'] === 'postgres.abcd');
check('a local URI does not require TLS', str_ends_with(Convert::pgUri('postgres://postgres@127.0.0.1:54329/x')['dsn'], 'sslmode=disable'));
try {
    Convert::pgUri('mysql://u:hunter2@h/db');
    check('a non-postgres URI is refused', false);
} catch (InvalidArgumentException $e) {
    check('a non-postgres URI is refused without echoing it', !str_contains($e->getMessage(), 'hunter2'));
}
$scrubbed = Convert::scrub('could not connect postgres://u:hunter2@h:5432/db password=hunter2 key eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.abc sk_live_123abc');
check('error messages are scrubbed of URIs, passwords, JWTs and Stripe keys', !str_contains($scrubbed, 'hunter2') && !str_contains($scrubbed, 'eyJ') && !str_contains($scrubbed, 'sk_live_123'), $scrubbed);
check('emails are masked in the report', Convert::maskEmail('zoe@example.test') === 'z***@example.test' && Convert::maskEmail(null) === '(none)');

// ---- the map against the migrated target schema ----
$tables = $pdo->query('SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE()')->fetchAll(PDO::FETCH_COLUMN);
$colsOf = static function (string $t) use ($pdo): array {
    $q = $pdo->prepare('SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?');
    $q->execute([$t]);
    return $q->fetchAll(PDO::FETCH_COLUMN);
};
$order = [];
$bad = [];
foreach (Map::tables() as $i => $d) {
    $order[$d['table']] = $i;
    if (!in_array($d['table'], $tables, true)) {
        $bad[] = "no target table {$d['table']}";
        continue;
    }
    if (!in_array($d['group'], Map::GROUPS, true)) {
        $bad[] = "{$d['table']}: unknown group";
    }
    foreach ($d['key'] as $k) {
        if ($k[0] !== '_' && !in_array($k, $colsOf($d['table']), true)) {
            $bad[] = "{$d['table']}: key $k is not a column";
        }
    }
    if (isset(Map::SKIPPED[$d['source']]) && $d['source'] !== 'profiles') {
        $bad[] = "{$d['source']} is both mapped and skipped";
    }
}
check('every mapped table and key exists in the target at migration 020', $bad === [], implode('; ', $bad));
$groupAt = [];
foreach (Map::tables() as $d) {
    $groupAt[$d['table']] = array_search($d['group'], Map::GROUPS, true);
}
$late = [];
foreach ($pdo->query('SELECT TABLE_NAME, REFERENCED_TABLE_NAME FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA = DATABASE() AND REFERENCED_TABLE_NAME IS NOT NULL')->fetchAll(PDO::FETCH_NUM) as [$t, $ref]) {
    if (isset($order[$t], $order[$ref]) && ($order[$ref] > $order[$t] || $groupAt[$ref] > $groupAt[$t])) {
        $late[] = "$ref after $t";
    }
}
check('every parent table is written before its children (foreign-key order)', $late === [], implode('; ', array_unique($late)));
$groups = array_values(array_unique(array_map(static fn (array $d): string => $d['group'], Map::tables())));
check('groups appear in the order they are applied', $groups === array_values(array_intersect(Map::GROUPS, $groups)));
