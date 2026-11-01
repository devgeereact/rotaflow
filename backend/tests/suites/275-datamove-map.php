<?php
declare(strict_types=1);

// The Supabase -> MariaDB data move (bin/datamove.php), the parts that need no PostgreSQL: value conversion against the
// target's own column metadata, safe storage paths, the URI parser that never echoes a secret, and the map checked against
// the migrated schema (every target table and key exists, foreign-key order holds), and the source-version handling
// (SourceSchema: production stopped at 0156, the repo is at 0164). The end-to-end runs against a real PostgreSQL built
// from supabase/migrations are scripts/datamove-test.sh all (backend/tests/datamove/run.php and run-live.php).
use RotaFlow\DataMove\{Convert, Map, SourceSchema};

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

// ---- the source version (production stopped at 0156; the repo is at 0164) ----
$mig = array_map('basename', glob(dirname(__DIR__, 3) . '/supabase/migrations/*.sql') ?: []);
check('SourceSchema knows the repo\'s newest Supabase migration', $mig !== [] && str_starts_with((string) end($mig), SourceSchema::REPO_LATEST . '_'), (string) end($mig));
$feat = [];
foreach (SourceSchema::FEATURES + SourceSchema::PURGED as $k => [$since]) {
    $file = array_values(preg_grep('/^' . $since . '_/', $mig) ?: [])[0] ?? '';
    $sql = $file !== '' ? strtolower((string) file_get_contents(dirname(__DIR__, 3) . '/supabase/migrations/' . $file)) : '';
    $name = str_contains($k, '.') ? explode('.', $k)[1] : $k;
    if ($sql === '' || !str_contains($sql, $name)) {
        $feat[] = "$k: not in migration $since";
    }
}
check('every optional table or column is named by the migration said to add (or purge) it', $feat === [], implode('; ', $feat));
$opt = [];
foreach (Map::tables() as $d) {
    preg_match_all('/\{src:([\w.]+);/', $d['sql'], $m);
    foreach ($m[1] as $k) {
        if (!isset(SourceSchema::FEATURES[$k])) {
            $opt[] = "{$d['table']}: $k";
        }
    }
    if (in_array($d['source'], ['account_deletions', 'storage_deletions'], true) && !isset(SourceSchema::FEATURES[$d['source']])) {
        $opt[] = "{$d['source']} is mapped but not listed as optional";
    }
}
check('every {src:...} in the map names a listed feature', $opt === [], implode('; ', $opt));
$at156 = SourceSchema::fixed(['app_settings', 'app_settings.theme', 'emergency_contacts', 'emergency_contacts.medical_notes', 'documents', 'documents.file_url'], '0156');
$at164 = SourceSchema::fixed(['app_settings', 'app_settings.time_format', 'app_settings.week_start', 'app_settings.digest_frequency', 'documents', 'documents.storage_path',
    'staff_profiles.photo_path', 'storage_deletions', 'account_deletions', 'emergency_contacts'], '0164');
$appSql = implode(' ', array_column(array_filter(Map::tables(), static fn ($d) => $d['table'] === 'app_settings'), 'sql'));
check('at 0156 the preferences read as the defaults; at 0164 as the columns', str_contains($at156->expand($appSql), "'24h'::text AS time_format") && !str_contains($at156->expand($appSql), 's.time_format')
    && str_contains($at164->expand($appSql), 's.time_format AS time_format'));
$usersSql = implode(' ', array_column(array_filter(Map::tables(), static fn ($d) => $d['table'] === 'users'), 'sql'));
check('at 0156 nothing reads account_deletions, and a completed erasure case is still read', !str_contains($at156->expand($usersSql), 'account_deletions') && str_contains($at156->expand($usersSql), "g.kind = 'erasure'"));
$p156 = $at156->problems(static fn (string $sql): int => 0);
$w = array_column($p156, 'what');
check('at 0156: one warning per missing feature and one for the medical notes, all plain warnings',
    count($p156) === 6 && array_unique(array_column($p156, 'level')) === ['warning'] && count(array_filter($w, static fn ($x) => str_starts_with($x, 'source at 0156: ') && str_contains($x, 'not present, nothing to move'))) === 5
    && count(array_filter($w, static fn ($x) => str_contains($x, 'medical notes') && str_contains($x, 'never moved'))) === 1, json_encode($w));
check('at 0164: nothing to say', $at164->problems(static fn (string $sql): int => 0) === [] && $at164->inferred() === '0164');
$counted = $at156->problems(static fn (string $sql): int => str_contains($sql, 'medical_notes') ? 3 : 0);
check('medical notes still at the source are counted, never read, and left behind', (bool) array_filter(array_column($counted, 'what'), static fn ($x) => str_contains($x, 'never moved: 3 rows hold a note; the move leaves them behind')));
check('a source older than 0156 is refused; one newer than the repo is a warning',
    in_array('error', array_column(SourceSchema::fixed([], '0150')->problems(static fn () => 0), 'level'), true)
    && in_array('warning', array_column(SourceSchema::fixed(['emergency_contacts'], '0170')->problems(static fn () => 0), 'level'), true));
check('a source with no migration record is read from its schema', str_contains(SourceSchema::fixed(['emergency_contacts.medical_notes', 'storage_deletions'])->label(), '0159 (read from the schema'));
check('a record that disagrees with the schema is reported, and the schema wins', (bool) array_filter(array_column(SourceSchema::fixed(['emergency_contacts.medical_notes'], '0162')->problems(static fn () => 0), 'what'), static fn ($x) => str_contains($x, 'the move follows the schema')));
