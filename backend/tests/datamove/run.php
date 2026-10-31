<?php
declare(strict_types=1);

// LOCAL TEST ONLY: the data move end to end (scripts/datamove-test.sh all). Needs the seeded source database
// (rotaflow_source_test on the throwaway PostgreSQL) and the migrated target (rotaflow_test_move on 127.0.0.1:3308).
// Runs the real CLI (bin/datamove.php) for: plan, apply, verify, a refused second apply, an idempotent --resume, an
// interrupted move finished with --resume, a tampered row caught by verify and left alone by --resume, --exclude-demo-orgs,
// the files step (dry run, a corrupt object refused, resume, re-run), a pg_dump of the source restored and verified,
// the freeze and unfreeze scripts, and checks made with plain SQL on both sides (not through the mover's own code).
require_once __DIR__ . '/../../src/Autoload.php';

use RotaFlow\{Bootstrap, Db, FileStore, Secret, Users};

$root = dirname(__DIR__, 3);
$pgPort = getenv('DATAMOVE_PG_PORT') ?: '54329';
$pgBin = rtrim((string) getenv('PGBIN'), '/');
$priv = (string) getenv('ROTAFLOW_PRIVATE_ROOT');
$sock = $root . '/.local-test/mariadb/mysqld.sock';
if ($priv === '' || !str_contains($priv, '.local-test')) {
    fwrite(STDERR, "refusing: ROTAFLOW_PRIVATE_ROOT must be a .local-test folder\n");
    exit(2);
}
$pass = 0;
$fails = [];
function ok(string $label, bool $cond, string $detail = ''): void
{
    global $pass, $fails;
    if ($cond) {
        $pass++;
        echo "  ok   $label\n";
    } else {
        $fails[] = $label;
        echo "  FAIL $label" . ($detail !== '' ? " [$detail]" : '') . "\n";
    }
}
/** Runs the CLI against a private root; returns [exit code, decoded JSON report, output]. */
function move(string $privRoot, string $args, array $env = []): array
{
    global $root;
    $report = $privRoot . '/datamove/test-' . bin2hex(random_bytes(4)) . '.md';
    $e = '';
    foreach (['ROTAFLOW_PRIVATE_ROOT' => $privRoot] + $env as $k => $v) {
        $e .= $k . '=' . escapeshellarg($v) . ' ';
    }
    exec($e . 'php ' . escapeshellarg($root . '/backend/bin/datamove.php') . ' ' . $args . ' --report=' . escapeshellarg($report) . ' 2>&1', $out, $rc);
    $json = preg_replace('/\.md$/', '.json', $report);
    return [$rc, is_file($json) ? json_decode((string) file_get_contents($json), true) : null, implode("\n", $out)];
}
function sumCounts(?array $r, string $k): int
{
    return array_sum(array_map(static fn (array $c): int => (int) ($c[$k] ?? 0), $r['counts'] ?? []));
}
function rootSql(string $sql): void
{
    global $sock;
    exec('mariadb --no-defaults --socket=' . escapeshellarg($sock) . ' -uroot -e ' . escapeshellarg($sql) . ' 2>&1', $out, $rc);
    if ($rc !== 0) {
        throw new RuntimeException(implode("\n", $out));
    }
}
/** A fresh migrated target database with its own private root. */
function target(string $db): string
{
    global $root;
    $p = $root . '/.local-test/datamove-private-' . $db;
    exec('rm -rf ' . escapeshellarg($p));
    mkdir($p . '/config', 0700, true);
    rootSql("DROP DATABASE IF EXISTS $db; CREATE DATABASE $db CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;");
    $cfg = "<?php return ['dsn' => 'mysql:host=127.0.0.1;port=3308;dbname=$db;charset=utf8mb4', 'user' => 'rf_test', 'password' => 'rf_test_local_only', 'secret_key' => '"
        . base64_encode(random_bytes(32)) . "', 'clerk_issuer' => 'https://example.invalid', 'clerk_authorized_parties' => ['http://localhost']];";
    file_put_contents($p . '/config/config.php', $cfg);
    file_put_contents($p . '/config/migrate.php', $cfg);
    chmod($p . '/config/config.php', 0600);
    exec('ROTAFLOW_PRIVATE_ROOT=' . escapeshellarg($p) . ' php ' . escapeshellarg($root . '/backend/bin/migrate.php') . ' 2>&1', $o, $rc);
    if ($rc !== 0) {
        throw new RuntimeException('migrate failed: ' . implode("\n", $o));
    }
    return $p;
}
function pgDb(string $db): PDO
{
    global $pgPort;
    $p = new PDO("pgsql:host=127.0.0.1;port=$pgPort;dbname=$db", 'postgres', '', [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC]);
    $p->exec("SET TIME ZONE 'UTC'");
    return $p;
}
function psqlFile(string $db, string $file): array
{
    global $pgBin, $pgPort;
    exec(escapeshellarg($pgBin . '/psql') . " -X -q -v ON_ERROR_STOP=1 -h 127.0.0.1 -p $pgPort -U postgres -d $db -At -f " . escapeshellarg($file) . ' 2>&1', $out, $rc);
    return [$rc, implode("\n", $out)];
}

$uri = $priv . '/source-uri';
file_put_contents($uri, "postgres://postgres@127.0.0.1:$pgPort/rotaflow_source_test");
chmod($uri, 0600);
$src = pgDb('rotaflow_source_test');
$cfg = Bootstrap::config($priv);
$dst = Db::connect($cfg);
$S = '--source-uri-file=' . escapeshellarg($uri);
exec('rm -rf ' . escapeshellarg($priv . '/datamove') . ' ' . escapeshellarg($priv . '/uploads'));

echo "secrets\n";
chmod($uri, 0644);
[$rc, , $out] = move($priv, "plan $S");
ok('a source URI file readable by others is refused', $rc === 2 && str_contains($out, 'chmod 600'));
chmod($uri, 0600);
ok('no output ever prints the source URI', !str_contains($out, 'postgres://'));

echo "plan, apply, verify\n";
[$rc, $r] = move($priv, "plan $S");
$counts = $r['counts'] ?? [];
ok('plan: no errors', $rc === 0 && count(array_filter($r['problems'], static fn ($p) => $p['level'] === 'error')) === 0, json_encode(array_values(array_filter($r["problems"] ?? [], static fn ($p) => $p["level"] === "error"))));
ok('plan: writes nothing', (int) $dst->query('SELECT COUNT(*) FROM users')->fetchColumn() === 0 && (int) $dst->query('SELECT COUNT(*) FROM shifts')->fetchColumn() === 0);
ok('plan: ~10k shifts planned', ($counts['shifts']['planned'] ?? 0) === (int) $src->query('SELECT count(*) FROM shifts')->fetchColumn() && $counts['shifts']['planned'] >= 10000);
ok('plan: every source table mapped or skipped, every column carried or dropped on purpose', !array_filter($r['problems'], static fn ($p) => str_contains($p['what'], 'neither mapped') || str_contains($p['what'], 'not carried')));
$warn = array_column(array_filter($r['problems'], static fn ($p) => $p['level'] === 'warning'), 'what');
ok('plan: warns about the banned user, the legacy admin flag, the Supabase document link and rotaflow.app', count($warn) === 4, json_encode($warn));
[$rc, $r] = move($priv, "apply $S");
ok('apply: exit 0', $rc === 0, json_encode(array_values(array_filter($r["problems"] ?? [], static fn ($p) => $p["level"] === "error"))));
ok('apply: rows inserted', sumCounts($r, 'inserted') > 15000, (string) sumCounts($r, 'inserted'));
[$rc, $r] = move($priv, "verify $S --sample=40");
$all = array_filter($r['counts'], static fn ($c, $t) => !str_starts_with($t, '(skipped)'), ARRAY_FILTER_USE_BOTH);
ok('verify: exit 0', $rc === 0, json_encode(array_values(array_filter($r["problems"] ?? [], static fn ($p) => $p["level"] === "error"))));
ok('verify: every table checksum matches', count(array_filter($all, static fn ($c) => ($c['checksum'] ?? '') !== 'match')) === 0);
ok('verify: nothing missing, no sampled field differs', sumCounts($r, 'missing') === 0 && sumCounts($r, 'sample_diffs') === 0 && sumCounts($r, 'sampled_fields') > 3000);

echo "idempotent and refusing\n";
$before = $dst->query('SELECT (SELECT COUNT(*) FROM shifts) + (SELECT COUNT(*) FROM audit_logs) + (SELECT COUNT(*) FROM users)')->fetchColumn();
[$rc, $r] = move($priv, "apply $S");
ok('a second apply without --resume is refused', $rc === 1 && (bool) array_filter($r['problems'], static fn ($p) => str_contains($p['what'], 'already holds data')));
[$rc, $r] = move($priv, "apply --resume $S");
ok('apply --resume changes nothing', $rc === 0 && sumCounts($r, 'inserted') === 0 && sumCounts($r, 'updated') === 0 && sumCounts($r, 'conflict') === 0);
ok('row totals unchanged after both', $dst->query('SELECT (SELECT COUNT(*) FROM shifts) + (SELECT COUNT(*) FROM audit_logs) + (SELECT COUNT(*) FROM users)')->fetchColumn() === $before);

echo "a tampered row\n";
$sid = '0000000f-0000-4000-8000-000000000333';
[$note, $stamp] = $dst->query("SELECT notes, updated_at FROM shifts WHERE id = '$sid'")->fetch(PDO::FETCH_NUM);
$dst->exec("UPDATE shifts SET notes = 'edited after the move' WHERE id = '$sid'");
[$rc, $r] = move($priv, "verify $S");
ok('verify catches one changed field', $rc === 1 && ($r['counts']['shifts']['checksum'] ?? '') === 'DIFFERS');
[$rc, $r] = move($priv, "apply --resume $S");
ok('--resume reports the conflict and does not overwrite it', ($r['counts']['shifts']['conflict'] ?? 0) === 1 && $dst->query("SELECT notes FROM shifts WHERE id = '$sid'")->fetchColumn() === 'edited after the move');
$q = $dst->prepare('UPDATE shifts SET notes = ?, updated_at = ? WHERE id = ?'); // put back exactly (updated_at moves on any UPDATE)
$q->execute([$note, $stamp, $sid]);
[$rc] = move($priv, "verify $S");
ok('and verifies again once put back', $rc === 0);

echo "independent checks (plain SQL on both sides)\n";
$night = $src->query("SELECT id::text, to_char(starts_at, 'YYYY-MM-DD HH24:MI:SS') s, to_char(ends_at, 'YYYY-MM-DD HH24:MI:SS') e, extract(epoch FROM ends_at - starts_at) / 3600 h
    FROM shifts WHERE starts_at = timestamptz '2026-10-24 21:00 Europe/London' AND staff_profile_id IS NOT NULL LIMIT 1")->fetch();
$t = $dst->query("SELECT starts_at, ends_at, TIMESTAMPDIFF(MINUTE, starts_at, ends_at) m FROM shifts WHERE id = '{$night['id']}'")->fetch();
ok('the night of the October clock change: same UTC instants, 11 hours', $t['starts_at'] === $night['s'] && $t['ends_at'] === $night['e'] && (int) $t['m'] === 660 && (float) $night['h'] === 11.0, json_encode([$night, $t]));
$spring = $src->query("SELECT id::text FROM shifts WHERE starts_at = timestamptz '2026-03-28 21:00 Europe/London' AND staff_profile_id IS NOT NULL LIMIT 1")->fetchColumn();
ok('the night of the March clock change: 9 hours', (int) $dst->query("SELECT TIMESTAMPDIFF(MINUTE, starts_at, ends_at) FROM shifts WHERE id = '$spring'")->fetchColumn() === 540);
ok('clock times keep milliseconds (DATETIME(3)), cut not rounded', (string) $dst->query("SELECT event_at FROM clock_events ORDER BY id LIMIT 1")->fetchColumn() === substr((string) $src->query("SELECT to_char(event_at, 'YYYY-MM-DD HH24:MI:SS.US') FROM clock_events ORDER BY id LIMIT 1")->fetchColumn(), 0, 23));
ok('money stays integer pence', (int) $dst->query("SELECT amount_pence FROM invoices WHERE number = 'RF-2026-0001'")->fetchColumn() === 29900
    && (int) $dst->query("SELECT SUM(hourly_rate_pence) FROM staff_pay_rates")->fetchColumn() === (int) $src->query('SELECT SUM(hourly_rate_pence) FROM staff_pay_rates')->fetchColumn());
ok('Stripe ids carried', $dst->query("SELECT CONCAT(provider_ref, ' ', stripe_customer_id, ' ', stripe_mode) FROM subscriptions WHERE org_id = '00000002-0000-4000-8000-000000000001'")->fetchColumn() === 'sub_1PxAcmeLive cus_AcmeLive123 live'
    && $dst->query("SELECT stripe_price_id FROM plans WHERE code = 'business'")->fetchColumn() === 'price_live_business');
ok('unicode and emoji names survive', $dst->query("SELECT full_name FROM users WHERE id = '00000001-0000-4000-8000-000000000010'")->fetchColumn() === 'Ana 🌟 Silva'
    && $dst->query("SELECT name FROM organisations WHERE slug = 'cafe-unicode'")->fetchColumn() === 'Café Ünïcode Ltd ☕');
ok('emails lower-cased', $dst->query("SELECT email FROM users WHERE id = '00000001-0000-4000-8000-000000000002'")->fetchColumn() === 'mixed.case@example.test');
ok('deleted and erased people kept under an address nobody can verify', (int) $dst->query("SELECT COUNT(*) FROM users WHERE email LIKE '%@removed.rotaflow.invalid'")->fetchColumn() === 2
    && (int) $dst->query("SELECT COUNT(*) FROM users WHERE email IN ('user4@example.test', 'erased@example.test', 'stray@example.test')")->fetchColumn() === 0);
ok('the SMTP password decrypts with the target key', Secret::decrypt((string) $dst->query('SELECT smtp_pass_enc FROM org_smtp_settings')->fetchColumn(), $cfg['secret_key']) === 'p@ss wörd 🔐');
ok('skills become a JSON array', $dst->query("SELECT skills FROM staff_profiles WHERE id = '0000000a-0000-4000-8000-000000000002'")->fetchColumn() === '["First aid","Manual handling","Médication"]');
ok('audit: source id kept, notice -> info, both -> org', (int) $dst->query("SELECT COUNT(*) FROM audit_logs WHERE JSON_VALUE(metadata, '$._moved.severity') = 'notice' AND severity = 'info'")->fetchColumn() === 600
    && (int) $dst->query("SELECT COUNT(DISTINCT JSON_VALUE(metadata, '$._moved.source_id')) FROM audit_logs")->fetchColumn() === 3000);
ok('a pending invitation still opens with its old token', $dst->query("SELECT token_hash FROM invites WHERE email = 'newstarter@example.test'")->fetchColumn() === hash('sha256', '0123456789abcdef0123456789abcdef'));
ok('old enquiries are not announced again', (int) $dst->query('SELECT COUNT(*) FROM enquiries WHERE notified_at IS NULL')->fetchColumn() === 0);
ok('R2 flags stay off; the AI flag takes the source state', (int) $dst->query("SELECT SUM(enabled) FROM feature_flags WHERE flag_key IN ('staff_documents','scheduling_tools','cover_tools','timesheet_tools','two_way_swaps')")->fetchColumn() === 0
    && (int) $dst->query("SELECT rollout FROM feature_flags WHERE flag_key = 'ai_rota_assistant'")->fetchColumn() === 50);
ok('the new site does not start in maintenance; rotaflow.app not copied', (int) $dst->query('SELECT maintenance_mode FROM platform_settings')->fetchColumn() === 0
    && !str_contains((string) $dst->query('SELECT support_email FROM platform_settings')->fetchColumn(), 'rotaflow.app'));
ok('storage paths made safe for the private store', FileStore::validObject((string) $dst->query("SELECT storage_path FROM documents WHERE id = '0000001d-0000-4000-8000-000000000002'")->fetchColumn())
    && FileStore::validObject((string) $dst->query("SELECT photo_path FROM staff_profiles WHERE id = '0000000a-0000-4000-8000-000000000021'")->fetchColumn()));

echo "interrupted move, finished with --resume\n";
$p2 = target('rotaflow_test_move_resume');
[$rc, $r] = move($p2, "apply $S --only=users,organisations,memberships,locations,departments,job_titles,staff_profiles");
ok('a partial move (two groups) lands', $rc === 0 && ($r['counts']['staff_profiles']['inserted'] ?? 0) === 48);
[$rc, $r] = move($p2, "apply $S");
ok('the rest is refused without --resume', $rc === 1);
[$rc, $r] = move($p2, "apply --resume $S");
ok('--resume finishes it, skipping what is there', $rc === 0 && ($r['counts']['users']['unchanged'] ?? 0) === 51 && ($r['counts']['shifts']['inserted'] ?? 0) > 10000);
[$rc, $r] = move($p2, "verify $S");
ok('and the result verifies', $rc === 0);

echo "first sign-in links by verified email (on the second target, after its verify)\n";
$dst2 = Db::connect(Bootstrap::config($p2));
$u = Users::resolve($dst2, ['sub' => 'user_clerk_7', 'email' => 'USER7@example.test']);
ok('a moved person signing in with Clerk lands on their own row (case-insensitive)', $u['id'] === '00000001-0000-4000-8000-000000000007');
$m = $dst2->query("SELECT COUNT(*) FROM memberships WHERE user_id = '{$u['id']}'")->fetchColumn();
ok('and keeps their membership', (int) $m === 1);
$d = Users::resolve($dst2, ['sub' => 'user_clerk_4', 'email' => 'user4@example.test']);
ok('a person deleted on Supabase signing up again gets a new, empty account', $d['id'] !== '00000001-0000-4000-8000-000000000004'
    && (int) $dst2->query("SELECT COUNT(*) FROM memberships WHERE user_id = '{$d['id']}'")->fetchColumn() === 0);
$g = Users::resolve($dst2, ['sub' => 'user_clerk_6', 'email' => 'user6@example.test']);
ok('a Google-only Supabase login is linked by an email code to the same address', $g['id'] === '00000001-0000-4000-8000-000000000006');

echo "--exclude-demo-orgs\n";
[$rc, $r] = move($priv, "plan --exclude-demo-orgs $S");
ok('plan without the demo organisation: 2 organisations, its rows left behind, no broken reference', $rc === 0 && ($r['counts']['organisations']['planned'] ?? 0) === 2
    && ($r['counts']['shifts']['planned'] ?? 0) === ($counts['shifts']['planned'] - 1) && count($r['excluded_orgs'] ?? []) === 1);

echo "files\n";
$store = $root . '/.local-test/datamove/storage';
exec('rm -rf ' . escapeshellarg($store));
$objs = $src->query('SELECT id::text, bucket_id, name FROM storage.objects ORDER BY name')->fetchAll();
$wrote = [];
foreach ($objs as $o) {
    $f = $store . '/' . $o['bucket_id'] . '/' . $o['name'];
    is_dir(dirname($f)) || mkdir(dirname($f), 0700, true);
    $bytes = '%PDF-1.4 ' . str_repeat(hash('sha256', $o['name']), 50 + crc32($o['name']) % 400);
    file_put_contents($f, $bytes);
    $wrote[$o['bucket_id'] . '/' . $o['name']] = $bytes;
    $etag = str_ends_with($o['name'], 'photo.jpg') ? str_repeat('0', 32) : md5($bytes); // one corrupt in transit
    $src->prepare("UPDATE storage.objects SET metadata = metadata || jsonb_build_object('size', ?::int, 'eTag', ?::text) WHERE id = ?::uuid")->execute([strlen($bytes), '"' . $etag . '"', $o['id']]);
}
$key = 'test-service-key-' . bin2hex(random_bytes(8));
$probe = stream_socket_server('tcp://127.0.0.1:0');
$port = (int) substr((string) stream_socket_get_name($probe, false), strrpos((string) stream_socket_get_name($probe, false), ':') + 1);
fclose($probe);
$server = proc_open(['env', 'FAKE_SERVICE_KEY=' . $key, 'FAKE_STORAGE_DIR=' . $store, PHP_BINARY, '-S', "127.0.0.1:$port", __DIR__ . '/fake-storage.php'], [['pipe', 'r'], ['file', '/dev/null', 'w'], ['file', '/dev/null', 'w']], $pipes);
for ($i = 0; $i < 50 && @fsockopen('127.0.0.1', $port) === false; $i++) {
    usleep(100000);
}
$keyFile = $priv . '/service-key';
file_put_contents($keyFile, $key);
chmod($keyFile, 0600);
$F = "$S --supabase-url=http://127.0.0.1:$port --service-key-file=" . escapeshellarg($keyFile);
exec('rm -rf ' . escapeshellarg($priv . '/uploads') . ' ' . escapeshellarg($priv . '/datamove/files-manifest.json'));
[$rc, $r] = move($priv, "files $F");
ok('files dry run: 5 to copy, 1 queued for deletion, 1 orphan, 1 other bucket, nothing written', $rc === 0 && ($r['files']['would_copy'] ?? 0) === 5 && $r['files']['blocked'] === 1
    && $r['files']['orphan'] === 1 && $r['files']['other_bucket'] === 1 && !is_dir($priv . '/uploads/staff-documents'), json_encode($r['files'] ?? null));
[$rc, $r, $out] = move($priv, "files --apply $S --supabase-url=http://127.0.0.1:$port --service-key-file=" . escapeshellarg($uri));
ok('a wrong service key copies nothing and the key is never printed', $rc === 1 && ($r['files']['copied'] ?? -1) === 0 && $r['files']['failed'] === 5 && !str_contains($out, $key) && !str_contains($out, 'postgres://'), json_encode($r['files'] ?? null));
[$rc, $r] = move($priv, "files --apply $F");
ok('files: a corrupt download is refused and not written; the others are copied', $rc === 1 && ($r['files']['copied'] ?? 0) === 4 && $r['files']['failed'] === 1, json_encode($r['files'] ?? null));
$photo = $src->query("SELECT id::text FROM storage.objects WHERE name LIKE '%/photo.jpg'")->fetchColumn();
$src->prepare("UPDATE storage.objects SET metadata = jsonb_set(metadata, '{eTag}', to_jsonb(?::text)) WHERE id = ?::uuid")->execute(['"' . md5($wrote[array_key_first(array_filter($wrote, static fn ($k) => str_ends_with($k, 'photo.jpg'), ARRAY_FILTER_USE_KEY))]) . '"', $photo]);
[$rc, $r] = move($priv, "files --apply $F");
ok('files: the re-run copies only what is missing', $rc === 0 && ($r['files']['copied'] ?? 0) === 1 && $r['files']['already_there'] === 4, json_encode($r['files'] ?? null));
[$rc, $r] = move($priv, "files --apply $F");
ok('files: a third run copies nothing', $rc === 0 && ($r['files']['copied'] ?? 0) === 0 && $r['files']['already_there'] === 5);
$fs = new FileStore($priv . '/uploads');
$doc = (string) $dst->query("SELECT storage_path FROM documents WHERE id = '0000001d-0000-4000-8000-000000000002'")->fetchColumn();
$srcName = (string) $src->query("SELECT storage_path FROM documents WHERE id = '0000001d-0000-4000-8000-000000000002'")->fetchColumn();
ok('the API reads a renamed document at the path the database now holds, byte for byte', $fs->get(FileStore::DOCUMENTS, $doc) === $wrote['staff-documents/' . $srcName]);
$perm = static fn (string $p): int => fileperms($p) & 0777;
ok('private store modes: folders 0700, files 0600', $perm($priv . '/uploads/' . FileStore::DOCUMENTS . '/' . $doc) === 0600 && $perm(dirname($priv . '/uploads/' . FileStore::DOCUMENTS . '/' . $doc)) === 0700);
ok('the object queued for deletion was not copied', !is_dir($priv . '/uploads/staff-documents/00000002-0000-4000-8000-000000000001/0000000a-0000-4000-8000-000000000009'));
[$rc, $r] = move($priv, "verify $S");
ok('verify also checks every copied file', $rc === 0 && ($r['files']['verified'] ?? 0) === 5);
file_put_contents($priv . '/uploads/' . FileStore::DOCUMENTS . '/' . $doc, 'changed');
[$rc] = move($priv, "verify $S");
ok('verify catches a changed file', $rc === 1);
file_put_contents($priv . '/uploads/' . FileStore::DOCUMENTS . '/' . $doc, $wrote['staff-documents/' . $srcName]);
proc_terminate($server);

echo "from a pg_dump\n";
$dump = $root . '/.local-test/datamove/source.dump';
exec(escapeshellarg($pgBin . '/pg_dump') . " -h 127.0.0.1 -p $pgPort -U postgres --data-only --format=custom --table='public.*' --table=auth.users --table=auth.identities --table=storage.buckets --table=storage.objects -f " . escapeshellarg($dump) . ' rotaflow_source_test 2>&1', $o, $rc);
ok('pg_dump of the data', $rc === 0 && is_file($dump), implode("\n", $o));
exec('bash ' . escapeshellarg($root . '/scripts/datamove-test.sh') . ' restore-dump ' . escapeshellarg($dump) . ' rotaflow_source_dump_test 2>&1', $o2, $rc);
ok('restored into a database built from supabase/migrations', $rc === 0, implode("\n", array_slice($o2, -5)));
$uri2 = $priv . '/source-uri-dump';
file_put_contents($uri2, "postgres://postgres@127.0.0.1:$pgPort/rotaflow_source_dump_test");
chmod($uri2, 0600);
[$rc, $r] = move($priv, 'verify --source-uri-file=' . escapeshellarg($uri2));
ok('the dump verifies against the moved data: same rows, same checksums', $rc === 0, json_encode(array_values(array_filter($r["problems"] ?? [], static fn ($p) => $p["level"] === "error"))));

echo "freeze and unfreeze the old database\n";
$src->exec("INSERT INTO cron.job (jobname, schedule, command) VALUES ('rotaflow-retention', '0 3 * * *', 'select 1') ON CONFLICT (jobname) DO NOTHING");
$src->exec("UPDATE cron.job SET active = (jobname <> 'rotaflow-retention') WHERE jobname LIKE 'rotaflow-%'");
$cronBefore = $src->query("SELECT string_agg(jobname || '=' || active, ',' ORDER BY jobname) FROM cron.job WHERE jobname LIKE 'rotaflow-%'")->fetchColumn();
[$rc, $o] = psqlFile('rotaflow_source_test', $root . '/scripts/cutover/supabase-freeze.sql');
ok('phase 1 runs', $rc === 0, $o);
$tryWrite = static function (string $sql) use ($src): bool {
    $src->beginTransaction();
    try {
        $src->exec($sql);
        $src->rollBack();
        return true;
    } catch (PDOException) {
        $src->rollBack();
        return false;
    }
};
ok('phase 1: writes to rota tables are refused, reads work, the outbox still drains',
    !$tryWrite("UPDATE shifts SET notes = 'x' WHERE id = '$sid'") && (int) $src->query('SELECT count(*) FROM shifts')->fetchColumn() > 0 && $tryWrite("UPDATE notification_outbox SET attempts = attempts"));
[$rc, $o] = psqlFile('rotaflow_source_test', $root . '/scripts/cutover/supabase-freeze-final.sql');
ok('phase 2 freezes the outbox and pauses the cron jobs', $rc === 0 && !$tryWrite('UPDATE notification_outbox SET attempts = attempts')
    && (int) $src->query("SELECT count(*) FROM cron.job WHERE jobname LIKE 'rotaflow-%' AND active")->fetchColumn() === 0, $o);
[$rc, $r] = move($priv, "verify $S");
ok('the data move reads a frozen database', $rc === 0);
[$rc, $o] = psqlFile('rotaflow_source_test', $root . '/scripts/cutover/supabase-unfreeze.sql');
ok('unfreeze restores writes and each cron job as it was', $rc === 0 && $tryWrite("UPDATE shifts SET notes = 'x' WHERE id = '$sid'")
    && $src->query("SELECT string_agg(jobname || '=' || active, ',' ORDER BY jobname) FROM cron.job WHERE jobname LIKE 'rotaflow-%'")->fetchColumn() === $cronBefore && str_contains((string) $cronBefore, 'rotaflow-retention=false'), $o);
[$rc] = psqlFile('rotaflow_source_test', $root . '/scripts/cutover/supabase-unfreeze.sql');
ok('unfreeze is safe to run twice', $rc === 0);

echo "\nDATAMOVE: $pass passed, " . count($fails) . " failed\n";
foreach ($fails as $f) {
    echo "  - $f\n";
}
exit($fails === [] ? 0 : 1);
