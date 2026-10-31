<?php
declare(strict_types=1);

// LOCAL / DEMO ONLY. Fills an EMPTY local database with one realistic demo organisation for the local-live walk
// (scripts/walk.sh, e2e/walk/*). Never run it against the live server: it refuses unless the DSN host is 127.0.0.1 or
// localhost AND the database name contains "walk", "demo" or "test", and it refuses a database that already has an
// organisation. Every address is a Clerk test-mode address (+clerk_test, verification code 424242 on a DEVELOPMENT
// instance); no real person or credential is involved.
// Usage: php bin/seed-demo.php [--anchor=YYYY-MM-DD]   (anchor = Monday of the "current" week; default 2026-10-26,
// so the previous week holds the last Sunday of October 2026, a clock change). Env: ROTAFLOW_PRIVATE_ROOT.
if (PHP_SAPI !== 'cli') {
    exit(1);
}
require_once __DIR__ . '/../src/Autoload.php';

use RotaFlow\{Bootstrap, CoverRules, Db, FileStore};

$root = Bootstrap::privateRoot();
$config = Bootstrap::config($root, getenv('ROTAFLOW_CONFIG_FILE') ?: 'config.php');
$dsn = (string) $config['dsn'];
if (preg_match('/host=(127\.0\.0\.1|localhost)[;:]/', $dsn . ';') !== 1 || preg_match('/dbname=[^;]*(walk|demo|test)/', $dsn) !== 1) {
    fwrite(STDERR, "Refusing: seed-demo.php only runs against a LOCAL database whose name contains walk, demo or test\n");
    exit(2);
}
$anchorArg = null;
foreach ($argv as $a) {
    if (str_starts_with($a, '--anchor=')) {
        $anchorArg = substr($a, 9);
    }
}
$anchor = new DateTimeImmutable($anchorArg ?? '2026-10-26', new DateTimeZone('Europe/London'));
if ($anchor->format('N') !== '1') {
    fwrite(STDERR, "--anchor must be a Monday\n");
    exit(1);
}
$pdo = Db::connect($config);
if ((int) $pdo->query('SELECT COUNT(*) FROM organisations')->fetchColumn() > 0) {
    fwrite(STDERR, "Refusing: the database already has an organisation (recreate it first: scripts/walk.sh db)\n");
    exit(2);
}

$tz = new DateTimeZone('Europe/London');
$utc = new DateTimeZone('UTC');
$id = static fn (): string => Db::uuid();
$ins = static function (string $table, array $row) use ($pdo): void {
    $cols = array_keys($row);
    $pdo->prepare('INSERT INTO ' . $table . ' (' . implode(', ', $cols) . ') VALUES (' . implode(', ', array_fill(0, count($cols), '?')) . ')')
        ->execute(array_values($row));
};
/** Local wall-clock time on a date -> UTC SQL datetime. */
$at = static function (DateTimeImmutable $day, string $hm, int $addDays = 0) use ($tz, $utc): string {
    $d = new DateTimeImmutable($day->format('Y-m-d') . ' ' . $hm, $tz);
    return $d->modify("+$addDays day")->setTimezone($utc)->format('Y-m-d H:i:s');
};

$pdo->beginTransaction();

// People with sign-in (Clerk test-mode addresses; clerk_user_id stays NULL so the first sign-in links by email).
$users = [];
foreach (['owner' => 'Olivia Owner', 'manager' => 'Marcus Manager', 'staff' => 'Sam Staff', 'staff2' => 'Priya Patel'] as $k => $name) {
    $users[$k] = $id();
    $ins('users', ['id' => $users[$k], 'email' => "$k+clerk_test@example.com", 'full_name' => $name]);
}

$org = $id();
$ins('organisations', [
    'id' => $org, 'name' => 'Demo Care Group', 'slug' => 'demo-care-group', 'plan' => 'business', 'status' => 'active',
    'trial_ends_at' => (new DateTimeImmutable('+20 days', $utc))->format('Y-m-d H:i:s'), 'created_by' => $users['owner'],
    'settings' => json_encode(['timesheet_tolerance_minutes' => 10]), 'onboarding_completed_at' => gmdate('Y-m-d H:i:s'),
    'industry' => 'Care home', 'country' => 'United Kingdom', 'timezone' => 'Europe/London', 'contact_email' => 'owner+clerk_test@example.com',
]);
foreach (['owner' => 'owner', 'manager' => 'manager', 'staff' => 'staff', 'staff2' => 'staff'] as $k => $role) {
    $ins('memberships', ['id' => $id(), 'org_id' => $org, 'user_id' => $users[$k], 'role' => $role, 'status' => 'active']);
}

// Places.
$loc = [];
foreach ([
    'riverside' => ['Riverside House', '12 River Lane, Reading RG1 2AB', 51.4543, -0.9781, 'Residential'],
    'oak' => ['Oak Lodge', '4 Oak Avenue, Reading RG4 7XY', 51.4700, -0.9600, 'Dementia care'],
    'office' => ['Head Office', '1 Market Place, Reading RG1 2EQ', 51.4560, -0.9710, 'Head office'],
] as $k => [$n, $addr, $lat, $lng, $type]) {
    $loc[$k] = $id();
    $ins('locations', ['id' => $loc[$k], 'org_id' => $org, 'name' => $n, 'address' => $addr, 'latitude' => $lat, 'longitude' => $lng,
        'timezone' => 'Europe/London', 'geofence_radius_m' => 150, 'location_type' => $type, 'status' => 'active']);
}
$dep = [];
foreach (['r_care' => ['Care', 'riverside'], 'r_kitchen' => ['Kitchen', 'riverside'], 'o_care' => ['Care', 'oak'], 'o_night' => ['Night team', 'oak'], 'admin' => ['Admin', 'office']] as $k => [$n, $l]) {
    $dep[$k] = $id();
    $ins('departments', ['id' => $dep[$k], 'org_id' => $org, 'location_id' => $loc[$l], 'name' => $n]);
}
$jt = [];
foreach (['Care Assistant' => 'sky', 'Senior Carer' => 'violet', 'Nurse' => 'teal', 'Cook' => 'amber', 'Administrator' => 'slate', 'Registered Manager' => 'rose'] as $n => $c) {
    $jt[$n] = $id();
    $ins('job_titles', ['id' => $jt[$n], 'org_id' => $org, 'name' => $n, 'colour' => $c, 'active' => 1]);
}

// Fifteen staff records. The first four are the people who sign in.
$staffRows = [
    ['owner', 'Olivia', 'Owner', 'Registered Manager', 'admin', 'office', 2400, 'Permanent', 37.5],
    ['manager', 'Marcus', 'Manager', 'Senior Carer', 'r_care', 'riverside', 1650, 'Permanent', 37.5],
    ['staff', 'Sam', 'Staff', 'Care Assistant', 'r_care', 'riverside', 1250, 'Permanent', 30],
    ['staff2', 'Priya', 'Patel', 'Care Assistant', 'r_care', 'riverside', 1250, 'Permanent', 30],
    [null, 'Tomás', 'García', 'Care Assistant', 'r_care', 'riverside', 1220, 'Zero hours', 0],
    [null, 'Aisha', 'Bello', 'Nurse', 'r_care', 'riverside', 2100, 'Permanent', 36],
    [null, 'Ben', "O'Connor", 'Cook', 'r_kitchen', 'riverside', 1300, 'Part time', 20],
    [null, 'Chloé', 'Dubois', 'Senior Carer', 'o_care', 'oak', 1500, 'Permanent', 37.5],
    [null, 'Daniel', 'Okafor', 'Care Assistant', 'o_care', 'oak', 1230, 'Permanent', 37.5],
    [null, 'Emily', 'Wright', 'Care Assistant', 'o_care', 'oak', 1230, 'Bank', 0],
    [null, 'Faisal', 'Khan', 'Nurse', 'o_night', 'oak', 2150, 'Permanent', 36],
    [null, 'Grace', 'Nowak', 'Care Assistant', 'o_night', 'oak', 1280, 'Permanent', 36],
    [null, 'Hannah', 'Lewis', 'Administrator', 'admin', 'office', 1400, 'Permanent', 37.5],
    [null, '=Ivan', 'Petrov', 'Care Assistant', 'o_care', 'oak', 1220, 'Zero hours', 0], // a name starting with "=" for the CSV check
    [null, 'Jade', 'Thompson', 'Care Assistant', 'r_care', 'riverside', 1220, 'Part time', 24],
];
$sp = [];
foreach ($staffRows as $i => [$uk, $first, $last, $title, $d, $l, $pence, $contract, $hours]) {
    $sid = $id();
    $sp[$i] = $sid;
    $email = $uk !== null ? "$uk+clerk_test@example.com" : strtolower(preg_replace('/[^A-Za-z]/', '', $first) . '.' . preg_replace('/[^A-Za-z]/', '', $last)) . '+clerk_test@example.com';
    $ins('staff_profiles', ['id' => $sid, 'org_id' => $org, 'user_id' => $uk !== null ? $users[$uk] : null, 'email' => $email, 'first_name' => $first,
        'last_name' => $last, 'job_title' => $title, 'job_title_id' => $jt[$title], 'department_id' => $dep[$d], 'contract_type' => $contract,
        'weekly_hours' => $hours, 'holiday_allowance' => 28, 'skills' => json_encode($title === 'Nurse' ? ['Medication', 'Wound care'] : ['Moving and handling']),
        'payroll_id' => sprintf('PR%04d', 1001 + $i), 'start_date' => '2025-0' . (1 + $i % 9) . '-01', 'phone' => sprintf('07700 900%03d', 100 + $i), 'active' => 1]);
    $ins('staff_locations', ['staff_profile_id' => $sid, 'location_id' => $loc[$l], 'org_id' => $org]);
    $ins('staff_pay_rates', ['id' => $id(), 'org_id' => $org, 'staff_profile_id' => $sid, 'hourly_rate_pence' => $pence - 50, 'effective_from' => '2025-04-01']);
    $ins('staff_pay_rates', ['id' => $id(), 'org_id' => $org, 'staff_profile_id' => $sid, 'hourly_rate_pence' => $pence, 'effective_from' => '2026-04-01']);
}
$ins('emergency_contacts', ['id' => $id(), 'org_id' => $org, 'staff_profile_id' => $sp[2], 'name' => 'Alex Staff', 'relationship' => 'Partner', 'phone' => '07700 900999']);
[$OWNER, $MANAGER, $STAFF, $STAFF2] = [$sp[0], $sp[1], $sp[2], $sp[3]];

// Shift types and minimum cover.
$st = [];
foreach (['early' => ['Early', '#22c55e', '07:00', '15:00'], 'late' => ['Late', '#3b82f6', '14:00', '22:00'], 'night' => ['Night', '#6366f1', '21:30', '07:30'], 'office' => ['Office', '#64748b', '09:00', '17:00']] as $k => [$n, $c, $s, $e]) {
    $st[$k] = $id();
    $ins('shift_types', ['id' => $st[$k], 'org_id' => $org, 'name' => $n, 'colour' => $c, 'default_start' => $s, 'default_end' => $e, 'is_paid' => 1, 'category' => 'standard']);
}
for ($wd = 0; $wd < 7; $wd++) {
    $ins('minimum_cover_rules', ['id' => $id(), 'org_id' => $org, 'location_id' => $loc['riverside'], 'weekday' => $wd, 'min_staff' => 3]);
}

// Rotas: previous week (published; holds the clock change on the last Sunday of October), this week and next week
// (published, with open shifts), the week after (draft). Riverside and Oak Lodge each have their own rota.
$weeks = [-1 => 'published', 0 => 'published', 1 => 'published', 2 => 'draft'];
$teams = [
    'riverside' => ['dep' => 'r_care', 'people' => [1, 2, 3, 4, 5, 14], 'kitchen' => 6],
    'oak' => ['dep' => 'o_care', 'people' => [7, 8, 9, 13], 'night' => [10, 11]],
];
$shiftsByWeek = [];
foreach ($weeks as $w => $status) {
    $monday = $anchor->modify(($w * 7) . ' day');
    foreach ($teams as $lk => $team) {
        $rid = $id();
        $ins('rotas', ['id' => $rid, 'org_id' => $org, 'location_id' => $loc[$lk], 'site_key' => $loc[$lk], 'name' => ($lk === 'oak' ? 'Oak Lodge' : 'Riverside') . ' week of ' . $monday->format('j M'),
            'period_start' => $monday->format('Y-m-d'), 'period_end' => $monday->modify('+6 day')->format('Y-m-d'), 'status' => $status,
            'published_at' => $status === 'published' ? $at($monday->modify('-5 day'), '10:00') : null, 'published_by' => $status === 'published' ? $users['manager'] : null,
            'created_by' => $users['manager']]);
        for ($d = 0; $d < 7; $d++) {
            $day = $monday->modify("+$d day");
            $people = $team['people'];
            // Rotate who works: two earlies and one late per day from the team; a weekday off each.
            $pick = static fn (int $n) => $people[($d + $n) % count($people)];
            $plan = [[$pick(0), 'early'], [$pick(1), 'early'], [$pick(2), 'late']];
            if ($lk === 'riverside' && $d < 5) {
                $plan[] = [$team['kitchen'], 'early'];
            }
            if ($lk === 'oak') {
                $plan[] = [$team['night'][$d % 2], 'night'];
            }
            foreach ($plan as [$who, $type]) {
                if ($who === 2 && $day->format('N') === '3') {
                    continue; // Sam is unavailable on Wednesdays
                }
                [$s, $e] = ['early' => ['07:00', '15:00'], 'late' => ['14:00', '22:00'], 'night' => ['21:30', '07:30']][$type];
                $shid = $id();
                $row = ['id' => $shid, 'org_id' => $org, 'rota_id' => $rid, 'location_id' => $loc[$lk], 'department_id' => $dep[$type === 'night' ? 'o_night' : ($who === 6 ? 'r_kitchen' : $team['dep'])],
                    'staff_profile_id' => $sp[$who], 'shift_type_id' => $st[$type], 'starts_at' => $at($day, $s), 'ends_at' => $at($day, $e, $type === 'night' ? 1 : 0),
                    'break_minutes' => $type === 'night' ? 60 : 30, 'status' => 'assigned', 'colour' => null, 'notes' => null];
                $ins('shifts', $row);
                $shiftsByWeek[$w][] = $row;
            }
            if ($w >= 0 && $w <= 1 && $lk === 'riverside' && in_array($d, [4, 5], true)) { // open shifts on Friday and Saturday
                $ins('shifts', ['id' => $id(), 'org_id' => $org, 'rota_id' => $rid, 'location_id' => $loc[$lk], 'department_id' => $dep['r_care'], 'staff_profile_id' => null,
                    'shift_type_id' => $st['late'], 'starts_at' => $at($day, '14:00'), 'ends_at' => $at($day, '22:00'), 'break_minutes' => 30, 'status' => 'open', 'notes' => 'Extra cover needed']);
            }
        }
    }
}
// Head-office hours for the owner and the administrator, this week, outside any rota.
for ($d = 0; $d < 5; $d++) {
    foreach ([0, 12] as $who) {
        $day = $anchor->modify("+$d day");
        $ins('shifts', ['id' => $id(), 'org_id' => $org, 'rota_id' => null, 'location_id' => $loc['office'], 'department_id' => $dep['admin'], 'staff_profile_id' => $sp[$who],
            'shift_type_id' => $st['office'], 'starts_at' => $at($day, '09:00'), 'ends_at' => $at($day, '17:00'), 'break_minutes' => 30, 'status' => 'assigned']);
    }
}

// Clock events: last week in full, and this week up to now (a shift under way has only its clock-in). Each fifth shift is
// on time, late (12 min), left early (20 min), over (25 min) or a little off, so the tolerance chips have something to show.
// Timesheets are for last week.
$prevMonday = $anchor->modify('-7 day');
$nowUtc = new DateTimeImmutable('now', $utc);
$minutesBy = [];
$n = 0;
foreach ([-1, 0] as $w) {
    foreach ($shiftsByWeek[$w] as $s) {
        $n++;
        [$inOff, $outOff] = [[0, 0], [12, 0], [0, -20], [-2, 25], [3, 1]][$n % 5];
        $in = (new DateTimeImmutable($s['starts_at'], $utc))->modify("$inOff minute");
        $out = (new DateTimeImmutable($s['ends_at'], $utc))->modify("$outOff minute");
        if ($in > $nowUtc) {
            continue;
        }
        $events = $out <= $nowUtc ? ['in' => $in, 'out' => $out] : ['in' => $in];
        foreach ($events as $type => $when) {
            $ins('clock_events', ['id' => $id(), 'org_id' => $org, 'staff_profile_id' => $s['staff_profile_id'], 'shift_id' => $s['id'], 'type' => $type,
                'event_at' => $when->format('Y-m-d H:i:s.v'), 'latitude' => 51.4543, 'longitude' => -0.9781, 'accuracy' => 12, 'method' => 'gps',
                'location_name' => 'Riverside House', 'synced' => 1, 'client_event_id' => $id()]);
        }
        if ($w === -1) {
            $minutesBy[$s['staff_profile_id']] = ($minutesBy[$s['staff_profile_id']] ?? 0) + intdiv($out->getTimestamp() - $in->getTimestamp(), 60) - (int) $s['break_minutes'];
        }
    }
}
$k = 0;
foreach ($minutesBy as $sid => $mins) {
    $status = $sid === $STAFF ? 'submitted' : (++$k % 3 === 0 ? 'open' : 'approved');
    $ins('timesheets', ['id' => $id(), 'org_id' => $org, 'staff_profile_id' => $sid, 'period_start' => $prevMonday->format('Y-m-d'), 'period_end' => $prevMonday->modify('+6 day')->format('Y-m-d'),
        'total_minutes' => max(0, $mins), 'status' => $status, 'approved_by' => $status === 'approved' ? $users['manager'] : null,
        'approved_at' => $status === 'approved' ? gmdate('Y-m-d H:i:s') : null, 'version' => $status === 'approved' ? 1 : 0]);
}

// A shift under way right now (whatever the time of the run), with its clock-in, so "today" screens (the dashboard's
// clocked-in count, the timesheet day rows and their CSV) always have a live row.
$liveStart = $nowUtc->setTime((int) $nowUtc->format('H'), 0)->modify('-2 hour');
$liveId = $id();
$ins('shifts', ['id' => $liveId, 'org_id' => $org, 'rota_id' => null, 'location_id' => $loc['oak'], 'department_id' => $dep['o_care'], 'staff_profile_id' => $sp[11],
    'shift_type_id' => $st['early'], 'starts_at' => $liveStart->format('Y-m-d H:i:s'), 'ends_at' => $liveStart->modify('+8 hour')->format('Y-m-d H:i:s'),
    'break_minutes' => 30, 'status' => 'assigned', 'notes' => 'Waking day (demo: always under way)']);
$ins('clock_events', ['id' => $id(), 'org_id' => $org, 'staff_profile_id' => $sp[11], 'shift_id' => $liveId, 'type' => 'in',
    'event_at' => $liveStart->modify('+4 minute')->format('Y-m-d H:i:s.v'), 'latitude' => 51.47, 'longitude' => -0.96, 'accuracy' => 10, 'method' => 'gps',
    'location_name' => 'Oak Lodge', 'synced' => 1, 'client_event_id' => $id()]);

// Availability, leave, overtime, swaps.
$ins('availability', ['id' => $id(), 'org_id' => $org, 'staff_profile_id' => $STAFF, 'weekday' => 3, 'start_time' => '00:00', 'end_time' => '23:59', 'status' => 'unavailable', 'recurring' => 1]);
$ins('availability', ['id' => $id(), 'org_id' => $org, 'staff_profile_id' => $STAFF2, 'weekday' => 6, 'start_time' => '07:00', 'end_time' => '15:00', 'status' => 'preferred', 'recurring' => 1]);
$next = $anchor->modify('+7 day');
$ins('leave_requests', ['id' => $id(), 'org_id' => $org, 'staff_profile_id' => $sp[4], 'type' => 'annual', 'start_date' => $next->modify('+1 day')->format('Y-m-d'), 'end_date' => $next->modify('+3 day')->format('Y-m-d'),
    'status' => 'approved', 'reason' => 'Family visit', 'reviewed_by' => $users['manager'], 'reviewed_at' => gmdate('Y-m-d H:i:s')]);
$ins('leave_requests', ['id' => $id(), 'org_id' => $org, 'staff_profile_id' => $STAFF2, 'type' => 'annual', 'start_date' => $anchor->modify('+5 day')->format('Y-m-d'), 'end_date' => $anchor->modify('+5 day')->format('Y-m-d'),
    'status' => 'approved', 'reason' => 'Wedding', 'reviewed_by' => $users['manager'], 'reviewed_at' => gmdate('Y-m-d H:i:s')]);
$ins('leave_requests', ['id' => $id(), 'org_id' => $org, 'staff_profile_id' => $STAFF, 'type' => 'annual', 'start_date' => $next->modify('+14 day')->format('Y-m-d'), 'end_date' => $next->modify('+18 day')->format('Y-m-d'),
    'status' => 'pending', 'reason' => 'Holiday']);
$ins('leave_requests', ['id' => $id(), 'org_id' => $org, 'staff_profile_id' => $sp[8], 'type' => 'sick', 'start_date' => $prevMonday->format('Y-m-d'), 'end_date' => $prevMonday->modify('+1 day')->format('Y-m-d'),
    'status' => 'approved', 'reason' => 'Flu', 'reviewed_by' => $users['owner'], 'reviewed_at' => gmdate('Y-m-d H:i:s')]);
$ins('leave_requests', ['id' => $id(), 'org_id' => $org, 'staff_profile_id' => $sp[9], 'type' => 'annual', 'start_date' => $next->modify('+2 day')->format('Y-m-d'), 'end_date' => $next->modify('+2 day')->format('Y-m-d'),
    'status' => 'rejected', 'reason' => 'Concert', 'reviewed_by' => $users['manager'], 'reviewed_at' => gmdate('Y-m-d H:i:s')]);
$ins('overtime_requests', ['id' => $id(), 'org_id' => $org, 'staff_profile_id' => $STAFF, 'date' => $prevMonday->modify('+2 day')->format('Y-m-d'), 'hours' => 1.5, 'status' => 'pending', 'note' => 'Stayed for handover']);
$ins('overtime_requests', ['id' => $id(), 'org_id' => $org, 'staff_profile_id' => $sp[5], 'date' => $prevMonday->modify('+3 day')->format('Y-m-d'), 'hours' => 2, 'status' => 'approved', 'note' => 'Covered a late', 'reviewed_by' => $users['manager'], 'reviewed_at' => gmdate('Y-m-d H:i:s')]);
$staffNext = array_values(array_filter([...$shiftsByWeek[0], ...$shiftsByWeek[1]], static fn (array $s): bool => $s['staff_profile_id'] === $STAFF && $s['starts_at'] > gmdate('Y-m-d H:i:s')));
if ($staffNext !== []) {
    $ins('shift_swaps', ['id' => $id(), 'org_id' => $org, 'shift_id' => $staffNext[0]['id'], 'requested_by' => $STAFF, 'target_staff_profile_id' => null, 'status' => 'pending', 'note' => 'Dentist appointment', 'client_event_id' => $id(), 'shift_fingerprint' => CoverRules::fingerprint($staffNext[0])]);
}
$p2 = array_values(array_filter([...$shiftsByWeek[0], ...$shiftsByWeek[1]], static fn (array $s): bool => $s['staff_profile_id'] === $sp[4] && $s['starts_at'] > gmdate('Y-m-d H:i:s')));
if ($p2 !== []) {
    $ins('shift_swaps', ['id' => $id(), 'org_id' => $org, 'shift_id' => $p2[0]['id'], 'requested_by' => $sp[4], 'target_staff_profile_id' => $STAFF, 'status' => 'pending', 'note' => 'Could you take this one?', 'client_event_id' => $id(), 'shift_fingerprint' => CoverRules::fingerprint($p2[0])]);
}

// Documents: two types, a few files (real bytes in the private store, so the signed link can be opened).
$dt = [];
foreach (['dbs' => ['DBS check', 1, 36, 1, 'dbs'], 'rtw' => ['Right to work', 0, null, 0, 'right_to_work'], 'train' => ['Moving and handling training', 1, 12, 0, 'training']] as $key => [$n, $exp, $months, $req, $preset]) {
    $dt[$key] = $id();
    $ins('document_types', ['id' => $dt[$key], 'org_id' => $org, 'name' => $n, 'requires_expiry' => $exp, 'default_validity_months' => $months, 'required' => $req, 'preset_key' => $preset, 'status' => 'active', 'created_by' => $users['owner']]);
}
$store = new FileStore(rtrim($root, '/') . '/uploads');
$pdfBytes = "%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj 3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 100]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n";
foreach ([
    [$STAFF, 'dbs', 'DBS certificate.pdf', '2025-02-01', '2028-02-01', 'approved'],
    [$STAFF, 'train', 'Moving and handling.pdf', '2025-11-20', (new DateTimeImmutable('+20 days'))->format('Y-m-d'), 'approved'],
    [$STAFF2, 'dbs', 'Priya DBS.pdf', '2026-10-01', '2029-10-01', 'awaiting_review'],
    [$sp[4], 'rtw', 'Passport scan.pdf', '2024-06-01', null, 'approved'],
] as [$sid, $key, $name, $issued, $expires, $status]) {
    $did = $id();
    $file = $id() . '.pdf';
    $path = "$org/$sid/$file";
    $store->put(FileStore::DOCUMENTS, $path, $pdfBytes);
    $ins('documents', ['id' => $did, 'org_id' => $org, 'staff_profile_id' => $sid, 'document_type_id' => $dt[$key], 'type' => ['dbs' => 'DBS check', 'rtw' => 'Right to work', 'train' => 'Moving and handling training'][$key],
        'name' => $name, 'storage_path' => $path, 'mime' => 'application/pdf', 'issued_at' => $issued, 'expires_at' => $expires, 'status' => $status, 'uploaded_by' => $users['owner'],
        'submitted_at' => $status === 'awaiting_review' ? gmdate('Y-m-d H:i:s') : null, 'reviewed_by' => $status === 'approved' ? $users['owner'] : null,
        'reviewed_at' => $status === 'approved' ? gmdate('Y-m-d H:i:s') : null]);
}

// An announcement and a few inbox items.
$ins('announcements', ['id' => $id(), 'org_id' => $org, 'author_user_id' => $users['owner'], 'scope' => 'org', 'title' => 'Clocks went back on Sunday',
    'body' => 'Night staff: your Saturday night shift ran an hour longer. Timesheets reflect the real hours.', 'urgent' => 0, 'published_at' => gmdate('Y-m-d H:i:s')]);
foreach ([['staff', 'rota_published', 'This week\'s rota is published'], ['staff', 'swap_requested', 'Tomás asked you to take a shift'], ['manager', 'leave_requested', 'Sam asked for leave']] as [$u, $type, $title]) {
    $ins('notifications', ['id' => $id(), 'org_id' => $org, 'user_id' => $users[$u], 'type' => $type, 'title' => $title, 'body' => null, 'channel' => 'in_app']);
}

$pdo->commit();
$count = static fn (string $t): int => (int) $pdo->query("SELECT COUNT(*) FROM $t")->fetchColumn();
echo sprintf("demo seeded: 1 organisation, %d sites, %d departments, %d staff, %d rotas, %d shifts (%d open), %d leave, %d swaps, %d timesheets, %d documents\n",
    $count('locations'), $count('departments'), $count('staff_profiles'), $count('rotas'), $count('shifts'),
    (int) $pdo->query("SELECT COUNT(*) FROM shifts WHERE status = 'open'")->fetchColumn(), $count('leave_requests'), $count('shift_swaps'), $count('timesheets'), $count('documents'));
