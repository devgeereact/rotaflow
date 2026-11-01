<?php
declare(strict_types=1);

// LOCAL TEST ONLY: the data move against a source in the LIVE project's shape and at a given schema version
// (scripts/datamove-test.sh all runs it for 0156, where production stops, and 0164, the repo's newest; and a dry run for
// every version between). Needs the source built by `datamove-test.sh live-source <db> <version>` and MariaDB on 3308.
//   DATAMOVE_LIVE_DB=rotaflow_source_live_0156 DATAMOVE_LIVE_VERSION=0156 [DATAMOVE_LIVE_MODE=plan] php run-live.php
// Full mode: plan (the version warnings, exactly), apply, verify, a refused second apply, an idempotent --resume, an
// interrupted move finished with --resume, and the counts checked with plain SQL; at a source before 0164, the privacy
// cases too (medical notes never moved, a completed erasure makes its person unlinkable, a pasted document link).
require_once __DIR__ . '/lib.php';

use RotaFlow\{Bootstrap, Db};
use RotaFlow\DataMove\SourceSchema;

$db = (string) getenv('DATAMOVE_LIVE_DB');
$v = (string) getenv('DATAMOVE_LIVE_VERSION');
$planOnly = getenv('DATAMOVE_LIVE_MODE') === 'plan';
if (preg_match('/^rotaflow_source_live_\d{4}$/', $db) !== 1 || preg_match('/^\d{4}$/', $v) !== 1) {
    fwrite(STDERR, "usage: DATAMOVE_LIVE_DB=rotaflow_source_live_NNNN DATAMOVE_LIVE_VERSION=NNNN php run-live.php\n");
    exit(2);
}
$src = pgDb($db);
$tdb = 'rotaflow_test_move_live_' . $v;
$p = target($tdb);
$S = '--source-uri-file=' . escapeshellarg(sourceUri($p, $db));
$dst = Db::connect(Bootstrap::config($p));
$tableCount = static fn (string $t): int => (int) $dst->query("SELECT COUNT(*) FROM `$t`")->fetchColumn();

// What this version lacks, and so which warnings the plan must give: one per feature (the three 0163 columns are one).
$expect = [];
foreach (SourceSchema::FEATURES as $k => [$since, $what]) {
    if ($what !== null && strcmp($v, $since) < 0) {
        $expect[] = "source at $v: $what not present, nothing to move";
    }
}
if (strcmp($v, '0164') < 0) {
    $expect[] = "source at $v: medical notes on emergency contacts (emergency_contacts.medical_notes, purged by 0164) still present, never moved: 0 rows hold a note";
}
// Not about the version: the platform settings row the migrations seed names rotaflow.app, as the live one may.
$other = ["support_email names rotaflow.app (not ours): left at the target's value"];

echo "live-shaped source at $v: plan\n";
[$rc, $r] = move($p, "plan $S");
ok("plan: no errors", $rc === 0 && problemsAt($r, 'error') === [], json_encode(problemsAt($r, 'error')));
ok("plan: the source version is read from its migration record ($v)", ($r['source_schema']['recorded'] ?? null) === $v && ($r['source_schema']['inferred'] ?? null) === (strcmp($v, '0163') >= 0 ? $v : max(array_filter(['0156', '0159', '0162'], static fn ($x) => strcmp($x, $v) <= 0))),
    json_encode($r['source_schema'] ?? null));
$warn = array_column(problemsAt($r, 'warning'), 'what');
$got = array_map(static fn (string $w): string => explode(';', $w)[0], $warn);
ok('plan: exactly one plain warning per feature the source lacks (' . count($expect) . '), and nothing else but the seeded rotaflow.app address', $got === [...$expect, ...$other], json_encode($warn, JSON_UNESCAPED_SLASHES));
$skipT = 'support_cases,support_case_messages,incidents,incident_updates';
[$rc, $rs] = move($p, "plan $S --skip=$skipT");
ok('plan --skip leaves those tables out of the move (the owner keeps old test cases and incidents on Supabase)', $rc === 0
    && array_intersect(array_keys($rs['counts'] ?? []), explode(',', $skipT)) === [] && isset($rs['counts']['shifts']), json_encode(array_keys($rs['counts'] ?? [])));
[$rc, , $out] = move($p, "plan $S --skip=support_casez");
ok('a mistyped --skip table stops with a usage error, nothing read', $rc === 2 && str_contains($out, 'unknown table support_casez'), $out);
ok('plan: every version warning names the source version', array_filter(array_diff($warn, $other), static fn ($w) => !str_starts_with($w, "source at $v: ")) === []);
$c = $r['counts'] ?? [];
ok('plan: 1 organisation, 2 users, 21 staff, 311 shifts, 1006 notifications, 381 audit rows', ($c['organisations']['planned'] ?? 0) === 1 && ($c['users']['planned'] ?? 0) === 2
    && ($c['staff_profiles']['planned'] ?? 0) === 21 && ($c['shifts']['planned'] ?? 0) === 311 && ($c['notifications']['planned'] ?? 0) === 1006 && ($c['audit_logs']['planned'] ?? 0) === 381, json_encode(array_map(static fn ($x) => $x['planned'] ?? null, $c)));
ok('plan: the 54 696 health samples, 3 018 delivery-log rows and 370 retention runs are counted and not moved',
    ($c['(skipped) platform_health_samples']['source'] ?? 0) === 54696 && ($c['(skipped) platform_health_samples']['planned'] ?? -1) === 0
    && ($c['(skipped) notification_deliveries']['source'] ?? 0) === 3018 && ($c['(skipped) retention_runs']['source'] ?? 0) === 370);
ok('plan: a queue table the source does not have is left out of the plan, one it has is planned',
    isset($c['storage_deletions']) === (strcmp($v, '0159') >= 0) && isset($c['account_deletions']) === (strcmp($v, '0162') >= 0));
$md = (string) file_get_contents((string) glob($p . '/datamove/test-*.md')[0]);
ok('the report names the source version', str_contains($md, "Source schema: source at $v ("));

if ($planOnly) {
    finish("DATAMOVE (live-shaped source at $v, dry run)");
}

echo "apply, verify, resume\n";
[$rc, $r] = move($p, "apply $S");
ok('apply: exit 0', $rc === 0, json_encode(problemsAt($r, 'error')));
ok('the target holds 21 staff, 311 shifts, 1006 notifications, 381 moved audit rows, 8 clock events and timesheets (plain SQL)',
    $tableCount('staff_profiles') === 21 && $tableCount('shifts') === 311 && $tableCount('notifications') === 1006 && $tableCount('clock_events') === 8 && $tableCount('timesheets') === 8
    && (int) $dst->query("SELECT COUNT(*) FROM audit_logs WHERE JSON_VALUE(metadata, '$._moved.source_id') IS NOT NULL")->fetchColumn() === 381);
ok('personal preferences are the defaults where the source had none (0163)', $dst->query("SELECT GROUP_CONCAT(DISTINCT CONCAT(time_format, ' ', week_start, ' ', digest_frequency)) FROM app_settings")->fetchColumn() === '24h monday immediate'
    && $tableCount('app_settings') === 2);
ok('the October clock change: a late shift on Sunday 25 October is 8 hours in UTC too', (int) $dst->query("SELECT TIMESTAMPDIFF(MINUTE, starts_at, ends_at) FROM shifts WHERE starts_at = '2026-10-25 14:00:00'")->fetchColumn() === 480);
[$rc, $r] = move($p, "verify $S --sample=40");
$all = array_filter($r['counts'] ?? [], static fn ($c, $t) => !str_starts_with($t, '(skipped)'), ARRAY_FILTER_USE_BOTH);
ok('verify: exit 0, every checksum matches, nothing missing', $rc === 0 && array_filter($all, static fn ($c) => ($c['checksum'] ?? '') !== 'match') === [] && sumCounts($r, 'missing') === 0 && sumCounts($r, 'sample_diffs') === 0,
    json_encode(problemsAt($r, 'error')));
[$rc, $r] = move($p, "apply $S");
ok('a second apply without --resume is refused', $rc === 1);
[$rc, $r] = move($p, "apply --resume $S");
ok('apply --resume changes nothing', $rc === 0 && sumCounts($r, 'inserted') === 0 && sumCounts($r, 'updated') === 0 && sumCounts($r, 'conflict') === 0);

echo "interrupted, finished with --resume\n";
$p2 = target($tdb . '_resume');
$S2 = '--source-uri-file=' . escapeshellarg(sourceUri($p2, $db));
[$rc] = move($p2, "apply $S2 --only=users,organisations,memberships,app_settings,locations,departments,job_titles,staff_profiles,staff_locations");
ok('a partial move lands', $rc === 0);
[$rc, $r] = move($p2, "apply --resume $S2");
ok('--resume finishes it, skipping what is there', $rc === 0 && ($r['counts']['staff_profiles']['unchanged'] ?? 0) === 21 && ($r['counts']['shifts']['inserted'] ?? 0) === 311);
[$rc] = move($p2, "verify $S2");
ok('and the result verifies', $rc === 0);
rootSql("DROP DATABASE IF EXISTS {$tdb}_resume;");

if (strcmp($v, '0164') < 0) {
    echo "privacy at a source before 0164\n";
    [$rc, $o] = psqlFile($db, __DIR__ . '/seed-before-0164.sql');
    ok('the pre-0164 cases are added to the source', $rc === 0, $o);
    $p3 = target($tdb . '_privacy');
    $S3 = '--source-uri-file=' . escapeshellarg(sourceUri($p3, $db));
    [$rc, $r] = move($p3, "plan $S3");
    $warn = array_column(problemsAt($r, 'warning'), 'what');
    ok('plan: the medical notes are counted (2 of 3 contacts), never read out', $rc === 0 && (bool) array_filter($warn, static fn ($w) => str_contains($w, 'never moved: 2 rows hold a note; the move leaves them behind'))
        && !str_contains(json_encode($r), 'Asthma'), json_encode($warn));
    ok('plan: the owner whose erasure case was closed is reported', (bool) array_filter($warn, static fn ($w) => str_contains($w, 'erasure case completed but the person still owns an organisation')));
    [$rc, $r] = move($p3, "apply $S3");
    ok('apply: exit 0', $rc === 0, json_encode(problemsAt($r, 'error')));
    $dst3 = Db::connect(Bootstrap::config($p3));
    $ecCols = $dst3->query("SELECT GROUP_CONCAT(COLUMN_NAME) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'emergency_contacts'")->fetchColumn();
    $ec = $dst3->query('SELECT * FROM emergency_contacts')->fetchAll(PDO::FETCH_ASSOC);
    ok('the three contacts move without their medical notes (no such column, the text nowhere in the target)', count($ec) === 3 && !str_contains((string) $ecCols, 'medical')
        && !str_contains(json_encode($ec, JSON_UNESCAPED_UNICODE), 'Asthma') && !str_contains(json_encode($ec, JSON_UNESCAPED_UNICODE), 'Epilepsy'));
    ok('a person whose erasure case was completed before 0162 is kept only under an address nobody can verify',
        (int) $dst3->query("SELECT COUNT(*) FROM users WHERE email IN ('erased-at-0156@live-shape.test', 'second-owner@live-shape.test')")->fetchColumn() === 0
        && (int) $dst3->query("SELECT COUNT(*) FROM users WHERE email LIKE '%@removed.rotaflow.invalid' AND full_name IS NULL")->fetchColumn() === 2);
    ok('a person who signed up again after an erasure is not caught by it', $dst3->query("SELECT email FROM users WHERE id = '00000001-0000-4000-8000-000000000005'")->fetchColumn() === 'came-back@live-shape.test');
    ok('a pasted document link moves as a link, with no stored file', $dst3->query("SELECT CONCAT(COALESCE(file_url, '-'), ' ', COALESCE(storage_path, '-')) FROM documents")->fetchColumn() === 'https://docs.example.com/dbs-scan.pdf -');
    [$rc, $r] = move($p3, "verify $S3");
    ok('verify: exit 0', $rc === 0, json_encode(problemsAt($r, 'error')));
    $key = $p3 . '/service-key';
    file_put_contents($key, 'not-used-by-a-dry-run');
    chmod($key, 0600);
    [$rc, $r] = move($p3, "files $S3 --supabase-url=http://127.0.0.1:9 --service-key-file=" . escapeshellarg($key));
    ok('files dry run: an object in a bucket of its own is counted, nothing is copied (no stored-file columns before 0159)', $rc === 0
        && ($r['files']['listed'] ?? 0) === 1 && ($r['files']['other_bucket'] ?? 0) === 1 && ($r['files']['would_copy'] ?? -1) === 0, json_encode($r['files'] ?? null));
    rootSql("DROP DATABASE IF EXISTS {$tdb}_privacy;");
}

finish("DATAMOVE (live-shaped source at $v)");
