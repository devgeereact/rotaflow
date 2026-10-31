<?php
declare(strict_types=1);

// Timesheets (R2 slice S13) through the API: with the `timesheet_tools` flag off nothing changes; with it on the list gains lines with
// late / early finish / overtime flags beyond the tolerance (the week of the October 2026 clock change, draft and cancelled shifts left
// out, a person sees only their own), and the payroll CSV of approved periods (BOM, fixed columns, exact minutes and hours, local times,
// formula-injection safe, recalculation flag, audited, read-only, owners and managers only, never platform support). Ports SiteRelay's
// 081-timesheets endpoint cases to RotaFlow's period approvals. The pure rules are suite 255-timesheet-rules. Owner follow-ups (31 Oct 2026):
// the file is an attachment named by organisation and dates, and POST timesheets/export marks the included approved periods exported in one
// transaction with the organisation lock first (idempotent, two at once mark once, the GET stays read-only).
use RotaFlow\{Api, Db, TimesheetRules as T};

// The test database, taken before the fixtures below reuse $name and $user as loop variables (the concurrency cases open their own connections).
$dbConf = ['dsn' => "mysql:host=$host;port=$port;dbname=$name;charset=utf8mb4", 'user' => $user, 'password' => $pass];

$api = test_api($pdo);
$org = call($api, 'olga', 'POST', '/orgs', ['name' => 'Payroll Org'])[1]['org']['id'];
$other = call($api, 'zed', 'POST', '/orgs', ['name' => 'Elsewhere'])[1]['org']['id'];
$pdo->prepare("UPDATE organisations SET timezone = 'Europe/London' WHERE id IN (?, ?)")->execute([$org, $other]);
$staff = [];
foreach (['mark' => 'manager', 'sam' => 'staff', 'pat' => 'staff'] as $name => $role) {
    call($api, $name, 'GET', '/me');
    $pdo->prepare("INSERT INTO memberships (id, org_id, user_id, role, status) SELECT ?, ?, id, ?, 'active' FROM users WHERE email = ?")->execute([Db::uuid(), $org, $role, "$name@example.test"]);
    $staff[$name] = call($api, 'olga', 'POST', "/orgs/$org/staff", ['first_name' => ucfirst($name), 'last_name' => ['mark' => 'Manning', 'sam' => 'Smith', 'pat' => 'Patel'][$name], 'email' => "$name@example.test"])[1]['id'];
}
$evil = call($api, 'olga', 'POST', "/orgs/$org/staff", ['first_name' => '=HYPERLINK("http://evil.example")', 'last_name' => 'Aardvark'])[1]['id'];
$pdo->prepare("UPDATE staff_profiles SET payroll_id = ? WHERE id = ?")->execute(['+44 7700', $evil]);
$pdo->prepare("UPDATE staff_profiles SET payroll_id = 'P-SAM-1' WHERE id = ?")->execute([$staff['sam']]);
$site = call($api, 'olga', 'POST', "/orgs/$org/locations", ['name' => 'Oak House', 'timezone' => 'Europe/London'])[1]['id'];
$flag = static fn (bool $on) => $GLOBALS['pdo']->exec('UPDATE feature_flags SET enabled = ' . ($on ? 1 : 0) . ', rollout = ' . ($on ? 100 : 0) . " WHERE flag_key = 'timesheet_tools'");
$TS = "/orgs/$org/timesheets";
$week = '?period_start=2026-10-19&period_end=2026-10-25';

// Rotas and shifts. Times are UTC; 19-24 Oct is BST (UTC+1), 25 Oct onwards GMT.
$rota = static function (string $from, string $to) use ($api, $org, $site): string {
    return call($api, 'mark', 'POST', "/orgs/$org/rotas", ['name' => "R $from", 'period_start' => $from, 'period_end' => $to, 'location_id' => $site])[1]['rota']['id'];
};
$add = static function (string $r, string $who, string $s, string $e, int $brk = 0) use ($api, $org, $site, $staff): string {
    [$st, $res] = call($api, 'mark', 'POST', "/orgs/$org/shifts", ['rota_id' => $r, 'staff_profile_id' => $staff[$who], 'location_id' => $site, 'starts_at' => $s, 'ends_at' => $e, 'break_minutes' => $brk, 'status' => 'assigned']);
    return $st === 201 ? $res['shift']['id'] : 'failed ' . json_encode($res);
};
$R = $rota('2026-10-18', '2026-10-26');
$L = [
    'early' => $add($R, 'sam', '2026-10-18T22:30:00Z', '2026-10-18T23:30:00Z'),     // 23:30 BST Sun 18th: the week before
    'mon0030' => $add($R, 'sam', '2026-10-18T23:30:00Z', '2026-10-19T01:00:00Z'),   // 00:30 BST Mon 19th: this week
    'L1' => $add($R, 'sam', '2026-10-19T08:00:00Z', '2026-10-19T12:00:00Z', 30),    // 09:00-13:00, 30 min break
    'L3' => $add($R, 'pat', '2026-10-20T09:00:00Z', '2026-10-20T11:00:00Z'),        // late, no clock-out
    'L4' => $add($R, 'sam', '2026-10-21T17:00:00Z', '2026-10-21T19:00:00Z'),        // overtime
    'L5' => $add($R, 'pat', '2026-10-22T08:00:00Z', '2026-10-22T09:00:00Z'),        // no clock-in
    'L7' => $add($R, 'sam', '2026-10-22T12:00:00Z', '2026-10-22T13:00:00Z'),        // 11 minutes late
    'L6' => $add($R, 'sam', '2026-10-23T08:00:00Z', '2026-10-23T12:00:00Z'),        // early finish
    'L2' => $add($R, 'sam', '2026-10-24T22:30:00Z', '2026-10-25T01:30:00Z'),        // 23:30 BST Sat -> 01:30 GMT Sun: 3 hours
    'sun2330' => $add($R, 'pat', '2026-10-25T23:30:00Z', '2026-10-26T00:30:00Z'),   // 23:30 GMT Sun 25th: still this week
    'next' => $add($R, 'pat', '2026-10-26T00:30:00Z', '2026-10-26T02:00:00Z'),      // 00:30 GMT Mon 26th: next week
    'gone' => $add($R, 'sam', '2026-10-20T13:00:00Z', '2026-10-20T14:00:00Z'),      // cancelled below
];
check('fixtures: shifts created', count(array_filter($L, static fn (string $v): bool => str_starts_with($v, 'failed'))) === 0, json_encode($L));
check('fixtures: the rota publishes', call($api, 'mark', 'POST', "/orgs/$org/rotas/$R/publish")[0] === 200);
$pdo->prepare("UPDATE shifts SET status = 'cancelled' WHERE id = ?")->execute([$L['gone']]);
$D = $rota('2026-10-19', '2026-10-25');
$draft = $add($D, 'sam', '2026-10-20T15:00:00Z', '2026-10-20T16:00:00Z');
$ev = static function (string $who, string $type, string $at) use ($pdo, $org, $staff): void {
    $pdo->prepare("INSERT INTO clock_events (id, org_id, staff_profile_id, type, event_at, method) VALUES (?, ?, ?, ?, ?, 'manual')")->execute([Db::uuid(), $org, $staff[$who], $type, $at]);
};
$ev('sam', 'in', '2026-10-19 08:05:00.000'); $ev('sam', 'out', '2026-10-19 12:00:00.000');
$ev('pat', 'in', '2026-10-20 09:20:00.000');
$ev('sam', 'in', '2026-10-21 16:55:00.000'); $ev('sam', 'out', '2026-10-21 19:40:00.000');
$ev('sam', 'in', '2026-10-22 12:11:00.000'); $ev('sam', 'out', '2026-10-22 13:00:00.000');
$ev('sam', 'in', '2026-10-23 08:00:00.000'); $ev('sam', 'out', '2026-10-23 11:00:00.000');
$ev('sam', 'in', '2026-10-24 22:30:00.000'); $ev('sam', 'out', '2026-10-25 01:30:00.000');
$ev('pat', 'in', '2026-10-25 23:30:00.000'); $ev('pat', 'out', '2026-10-26 00:45:00.000'); // after the last shift in the window ends

// ---- flag off: exactly as before --------------------------------------------------------------------------------------------------------------------
check('migration 018 seeds the flag off', $pdo->query("SELECT CONCAT(enabled, rollout) FROM feature_flags WHERE flag_key = 'timesheet_tools'")->fetchColumn() === '00');
[$s, $r] = call($api, 'mark', 'GET', $TS . $week);
check('off: the list answers only timesheets, no lines and no tolerance', $s === 200 && array_keys($r) === ['timesheets'], json_encode(array_keys($r)));
check('off: the export answers 403 feature_off to a manager and to staff', call($api, 'mark', 'GET', "$TS/export$week")[1]['error']['code'] === 'feature_off' && call($api, 'sam', 'GET', "$TS/export$week")[1]['error']['code'] === 'feature_off');
check('off: a stranger 404 and nobody 401 (membership before the flag)', call($api, 'zed', 'GET', "$TS/export$week")[0] === 404 && call($api, '', 'GET', "$TS/export$week")[0] === 401);
$wk = ['period_start' => '2026-10-19', 'period_end' => '2026-10-25'];
check('off: the marking export (POST) answers 403 feature_off too; a stranger 404, nobody 401', call($api, 'mark', 'POST', "$TS/export", $wk)[1]['error']['code'] === 'feature_off' && call($api, 'zed', 'POST', "$TS/export", $wk)[0] === 404 && call($api, '', 'POST', "$TS/export", $wk)[0] === 401);
check('off: approving still works exactly as before', call($api, 'mark', 'POST', "$TS/approve", ['period_start' => '2026-10-19', 'period_end' => '2026-10-25', 'approvals' => [['staff_profile_id' => $staff['pat'], 'total_minutes' => 61]]])[0] === 200);

// ---- the tolerance setting ------------------------------------------------------------------------------------------------------------------------------
check('settings: the tolerance is a whole number 0-120 (a fraction, text, negative or 121 is 422)', call($api, 'olga', 'POST', "/orgs/$org/settings", ['timesheet_tolerance_minutes' => 7.5])[0] === 422 && call($api, 'olga', 'POST', "/orgs/$org/settings", ['timesheet_tolerance_minutes' => '15'])[0] === 422 && call($api, 'olga', 'POST', "/orgs/$org/settings", ['timesheet_tolerance_minutes' => -1])[0] === 422 && call($api, 'olga', 'POST', "/orgs/$org/settings", ['timesheet_tolerance_minutes' => 121])[0] === 422);
check('settings: only the owner sets it', call($api, 'mark', 'POST', "/orgs/$org/settings", ['timesheet_tolerance_minutes' => 15])[0] === 403);

// ---- flag on: lines -----------------------------------------------------------------------------------------------------------------------------------
$flag(true);
[$s, $r] = call($api, 'mark', 'GET', $TS . $week);
$lines = array_column($r['lines'] ?? [], null, 'shift_id');
check('on: the list keeps its timesheets and gains lines and the tolerance (default 10)', $s === 200 && array_keys($r) === ['timesheets', 'lines', 'tolerance_minutes'] && $r['tolerance_minutes'] === 10 && count($r['timesheets']) === 1, json_encode(array_keys($r)));
check('lines: the week by local dates across the clock change (00:30 BST Monday and 23:30 GMT Sunday are in; 23:30 BST the Sunday before and 00:30 GMT the Monday after are out)', isset($lines[$L['mon0030']], $lines[$L['sun2330']]) && !isset($lines[$L['early']]) && !isset($lines[$L['next']]), json_encode(array_keys($lines)));
check('lines: cancelled and draft-rota shifts are not lines', !isset($lines[$L['gone']]) && !isset($lines[$draft]) && count($lines) === 9);
check('lines: scheduled vs recorded with the break deducted both sides (210 vs 205), five minutes late is not flagged', $lines[$L['L1']]['scheduled_minutes'] === 210 && $lines[$L['L1']]['recorded_minutes'] === 205 && $lines[$L['L1']]['variance_minutes'] === -5 && $lines[$L['L1']]['flags']['late'] === false && $lines[$L['L1']]['clock_in'] === '2026-10-19T08:05:00Z');
check('lines: the overnight shift across the clock change counts 180 minutes, not 120 or 240', $lines[$L['L2']]['scheduled_minutes'] === 180 && $lines[$L['L2']]['recorded_minutes'] === 180 && $lines[$L['L2']]['variance_minutes'] === 0);
check('lines: late with no clock-out (20 minutes late, missing clock-out, nothing recorded)', $lines[$L['L3']]['flags']['late'] === true && $lines[$L['L3']]['late_minutes'] === 20 && $lines[$L['L3']]['flags']['missing_clock_out'] === true && $lines[$L['L3']]['recorded_minutes'] === null);
check('lines: overtime (165 against 120); early arrival is not late', $lines[$L['L4']]['flags']['overtime'] === true && $lines[$L['L4']]['variance_minutes'] === 45 && $lines[$L['L4']]['flags']['late'] === false);
check('lines: no clock-in', $lines[$L['L5']]['flags']['no_clock_in'] === true && $lines[$L['L5']]['clock_in'] === null);
check('lines: early finish (60 minutes)', $lines[$L['L6']]['flags']['early_finish'] === true && $lines[$L['L6']]['early_minutes'] === 60 && $lines[$L['L6']]['flags']['overtime'] === false);
check('lines: a clock-out after the last shift of the window has ended still pairs (75 against 60, overtime)', $lines[$L['sun2330']]['recorded_minutes'] === 75 && $lines[$L['sun2330']]['flags']['overtime'] === true && $lines[$L['sun2330']]['flags']['missing_clock_out'] === false);
check('lines: 11 minutes late is late at the default tolerance', $lines[$L['L7']]['flags']['late'] === true && $lines[$L['L7']]['late_minutes'] === 11);
check('settings: the owner sets a 15 minute tolerance', call($api, 'olga', 'POST', "/orgs/$org/settings", ['timesheet_tolerance_minutes' => 15])[0] === 200);
$r15 = call($api, 'mark', 'GET', $TS . $week)[1];
$l15 = array_column($r15['lines'], null, 'shift_id');
check('lines: with 15 minutes, 11 minutes late is no longer flagged and 20 still is', $r15['tolerance_minutes'] === 15 && $l15[$L['L7']]['flags']['late'] === false && $l15[$L['L3']]['flags']['late'] === true);
call($api, 'olga', 'POST', "/orgs/$org/settings", ['breaks_are_paid' => true]);
check('lines: when breaks are paid nothing is deducted', array_column(call($api, 'mark', 'GET', $TS . $week)[1]['lines'], null, 'shift_id')[$L['L1']]['scheduled_minutes'] === 240);
call($api, 'olga', 'POST', "/orgs/$org/settings", ['breaks_are_paid' => false, 'timesheet_tolerance_minutes' => 10]);

// ---- who sees which lines ---------------------------------------------------------------------------------------------------------------------------
$mine = call($api, 'sam', 'GET', $TS . $week)[1];
check('staff: a person sees only their own lines, and cannot ask for a colleague\'s', array_unique(array_column($mine['lines'], 'staff_profile_id')) === [$staff['sam']] && array_unique(array_column(call($api, 'sam', 'GET', $TS . $week . "&staff_profile_id={$staff['pat']}")[1]['lines'], 'staff_profile_id')) === [$staff['sam']]);
check('staff: a member with no staff record gets no lines', (function () use ($api, $org, $pdo, $TS, $week): bool { call($api, 'nora', 'GET', '/me'); $pdo->prepare("INSERT INTO memberships (id, org_id, user_id, role, status) SELECT ?, ?, id, 'staff', 'active' FROM users WHERE email = 'nora@example.test'")->execute([Db::uuid(), $org]); return call($api, 'nora', 'GET', $TS . $week)[1]['lines'] === []; })());
check('manager: filters lines by person', array_unique(array_column(call($api, 'mark', 'GET', $TS . $week . "&staff_profile_id={$staff['pat']}")[1]['lines'], 'staff_profile_id')) === [$staff['pat']]);
check('a stranger gets 404 and no lines', call($api, 'zed', 'GET', $TS . $week)[0] === 404);
check('another organisation sees none of these lines', call($api, 'zed', 'GET', "/orgs/$other/timesheets$week")[1]['lines'] === []);
[$s, $r] = call($api, 'mark', 'GET', "$TS?period_start=2026-10-01&period_end=2026-11-01");
check('lines: more than 31 days gives no lines (null) but the list still answers', $s === 200 && $r['lines'] === null && is_array($r['timesheets']));
check('lines: without a period there are no lines', call($api, 'mark', 'GET', $TS)[1]['lines'] === null);

// ---- export ----------------------------------------------------------------------------------------------------------------------------------------
call($api, 'mark', 'POST', "$TS/approve", ['period_start' => '2026-10-19', 'period_end' => '2026-10-25', 'approvals' => [['staff_profile_id' => $staff['sam'], 'total_minutes' => 2430], ['staff_profile_id' => $evil, 'total_minutes' => 7]]]);
call($api, 'mark', 'POST', "$TS/approve", ['period_start' => '2026-11-02', 'period_end' => '2026-11-08', 'approvals' => [['staff_profile_id' => $staff['sam'], 'total_minutes' => 999]]]);
call($api, 'mark', 'POST', "$TS/approve", ['period_start' => '2026-10-12', 'period_end' => '2026-10-25', 'approvals' => [['staff_profile_id' => $staff['pat'], 'total_minutes' => 888]]]);
call($api, 'mark', 'POST', "/orgs/$org/staff", ['first_name' => 'Una', 'last_name' => 'Unapproved']);
$pdo->prepare("INSERT INTO timesheets (id, org_id, staff_profile_id, period_start, period_end, total_minutes, status) VALUES (?, ?, ?, '2026-10-19', '2026-10-25', 555, 'submitted')")->execute([Db::uuid(), $org, $staff['mark']]);
$zs = call($api, 'zed', 'POST', "/orgs/$other/staff", ['first_name' => 'Zoe'])[1]['id'];
call($api, 'zed', 'POST', "/orgs/$other/timesheets/approve", ['period_start' => '2026-10-19', 'period_end' => '2026-10-25', 'approvals' => [['staff_profile_id' => $zs, 'total_minutes' => 444]]]);
$corr = $pdo->query("SELECT id FROM clock_events WHERE staff_profile_id = '{$staff['sam']}' AND event_at = '2026-10-23 11:00:00.000'")->fetchColumn();
call($api, 'mark', 'POST', "/orgs/$org/clock-events/$corr/correct", ['reason' => 'Left at 11:30 really', 'event_at' => '2026-10-23T11:30:00Z']);

[$s, $r] = call($api, 'mark', 'GET', "$TS/export$week");
$raw = $r['__raw'] ?? [];
$body = (string) ($raw['body'] ?? '');
check('export: a CSV download named by organisation and dates, no caching', $s === 200 && $raw['mime'] === 'text/csv; charset=utf-8' && $raw['filename'] === 'rotaflow-timesheets-payroll-org-2026-10-19-2026-10-25.csv' && $raw['cache'] === 'no-store', json_encode(array_diff_key($raw, ['body' => 1])));
// What the entrypoint sends (backend/public/api/index.php writes exactly Api::rawHeaders): an attachment, so a direct link downloads.
check('export: the response headers say attachment with the safe ASCII file name (owner decision)', Api::rawHeaders($raw) === ['Content-Type: text/csv; charset=utf-8', 'Cache-Control: no-store', 'Content-Disposition: attachment; filename="rotaflow-timesheets-payroll-org-2026-10-19-2026-10-25.csv"'], json_encode(Api::rawHeaders($raw)));
check('export: the organisation slug in the name is the stored one', $pdo->query("SELECT slug FROM organisations WHERE id = '$org'")->fetchColumn() === 'payroll-org');
check('raw files other than the export keep inline, as before (the calendar feed, a photo)', Api::rawHeaders(['mime' => 'text/calendar; charset=utf-8', 'cache' => 'private, max-age=900', 'filename' => 'rotaflow.ics'])[2] === 'Content-Disposition: inline; filename="rotaflow.ics"' && Api::rawHeaders(['mime' => 'image/jpeg', 'filename' => 'photo.jpg'])[1] === 'Cache-Control: no-store');
check('raw headers: a file name cannot break out of its quotes, and only plain X-RotaFlow- extras are sent', Api::rawHeaders(['mime' => 'text/csv', 'disposition' => 'attachment', 'filename' => "a\"b\r\nSet-Cookie: x=1;é.csv", 'headers' => ['X-RotaFlow-Marked-Exported' => '3', 'Set-Cookie' => 'x=1', 'X-RotaFlow-Bad' => "1\r\nSet-Cookie: y", 'X-Other' => '1']]) === ['Content-Type: text/csv', 'Cache-Control: no-store', 'Content-Disposition: attachment; filename="a_b__Set-Cookie_ x_1___.csv"', 'X-RotaFlow-Marked-Exported: 3']);
check('export: starts with the UTF-8 BOM and every line ends CRLF', str_starts_with($body, "\xEF\xBB\xBF") && substr_count($body, "\r\n") === 4 && str_ends_with($body, "\r\n") && substr_count($body, "\n") === 4);
$rows = array_map(static fn (string $l): array => str_getcsv($l, ',', '"', ''), explode("\r\n", rtrim(substr($body, 3), "\r\n")));
$head = array_shift($rows);
$col = array_flip($head);
check('export: the header is the documented column order', $head === T::COLUMNS, json_encode($head));
check('export: approved periods wholly inside the range only (not submitted, not another week, not a fortnight that starts before, not another organisation)', count($rows) === 3 && array_column($rows, $col['Approved minutes']) === ['7', '61', '2430'] && !str_contains($body, 'Unapproved') && !str_contains($body, 'Zoe'), $body);
check('export: sorted by last name (Aardvark, Patel, Smith)', array_column($rows, $col['Staff name']) === ['\'=HYPERLINK("http://evil.example") Aardvark', 'Pat Patel', 'Sam Smith'], json_encode(array_column($rows, 0)));
$sam = $rows[2];
check('export: exact minutes and hours from the approved figure (2430 = 40.50; 7 = 0.12; 61 = 1.02)', $sam[$col['Approved minutes']] === '2430' && $sam[$col['Approved hours']] === '40.50' && $rows[0][$col['Approved hours']] === '0.12' && $rows[1][$col['Approved minutes']] === '61' && $rows[1][$col['Approved hours']] === '1.02');
check('export: the person, payroll id, period, status, version and approver', $sam[$col['Payroll ID']] === 'P-SAM-1' && $sam[$col['Staff ID']] === $staff['sam'] && $sam[$col['Period start']] === '2026-10-19' && $sam[$col['Period end']] === '2026-10-25' && $sam[$col['Status']] === 'approved' && $sam[$col['Version']] === '1' && $sam[$col['Approved by']] === 'Mark Manning' && $sam[$col['Time zone']] === 'Europe/London', json_encode($sam));
$approvedAt = (string) $pdo->query("SELECT approved_at FROM timesheets WHERE staff_profile_id = '{$staff['sam']}' AND period_start = '2026-10-19'")->fetchColumn();
check('export: approved at in the organisation\'s local time', $sam[$col['Approved at']] === (new DateTimeImmutable($approvedAt, new DateTimeZone('UTC')))->setTimezone(new DateTimeZone('Europe/London'))->format('Y-m-d H:i'));
check('export: a period corrected after approval says recalculation required; one untouched does not', $sam[$col['Recalculation required']] === 'Yes' && $rows[1][$col['Recalculation required']] === 'No');
check('export: flag counts per person (Sam: late 1, early finish 1, overtime 1; Pat: late 1, overtime 1)', $sam[$col['Late lines']] === '1' && $sam[$col['Early finish lines']] === '1' && $sam[$col['Overtime lines']] === '1' && $rows[1][$col['Late lines']] === '1' && $rows[1][$col['Overtime lines']] === '1', json_encode([$sam, $rows[1]]));
check('export: formula injection is neutralised in names and payroll ids', $rows[0][$col['Staff name']] === '\'=HYPERLINK("http://evil.example") Aardvark' && $rows[0][$col['Payroll ID']] === "'+44 7700");
$unsafe = [];
foreach ($rows as $row) {
    foreach ($row as $cell) {
        if ($cell !== '' && in_array($cell[0], ['=', '+', '-', '@', "\t", "\r"], true)) { $unsafe[] = $cell; }
    }
}
check('export: no cell in the file starts with = + - @ tab or CR', $unsafe === [], json_encode($unsafe));
check('export: reading it changes nothing (periods stay approved, not exported)', (int) $pdo->query("SELECT COUNT(*) FROM timesheets WHERE org_id = '$org' AND status = 'exported'")->fetchColumn() === 0);
check('export: audited with dates and a count, no personal data', (int) $pdo->query("SELECT COUNT(*) FROM audit_logs WHERE org_id = '$org' AND action = 'timesheet.exported'")->fetchColumn() === 1 && !str_contains((string) $pdo->query("SELECT CONCAT_WS(' ', metadata) FROM audit_logs WHERE org_id = '$org' AND action = 'timesheet.exported'")->fetchColumn(), 'Smith'));
$pdo->prepare("UPDATE timesheets SET status = 'exported' WHERE staff_profile_id = ? AND period_start = '2026-10-19'")->execute([$staff['pat']]);
check('export: a period already marked exported is still exported (approved and locked)', str_contains((string) call($api, 'mark', 'GET', "$TS/export$week")[1]['__raw']['body'], 'Pat Patel,,'));
check('export: an empty range is just the header', call($api, 'mark', 'GET', "$TS/export?period_start=2027-01-04&period_end=2027-01-10")[1]['__raw']['body'] === "\xEF\xBB\xBF" . implode(',', T::COLUMNS) . "\r\n");

// ---- export: who may, and validation ------------------------------------------------------------------------------------------------------------------
check('export: the owner may', call($api, 'olga', 'GET', "$TS/export$week")[0] === 200);
check('export: staff 403, a stranger 404, nobody 401', call($api, 'sam', 'GET', "$TS/export$week")[0] === 403 && call($api, 'zed', 'GET', "$TS/export$week")[0] === 404 && call($api, '', 'GET', "$TS/export$week")[0] === 401);
foreach (['no dates' => '', 'more than 31 days' => '?period_start=2026-10-01&period_end=2026-11-01', 'to before from' => '?period_start=2026-10-25&period_end=2026-10-19', 'a bad date' => '?period_start=2026-02-30&period_end=2026-03-01', 'a time' => '?period_start=2026-10-19T00:00:00Z&period_end=2026-10-25'] as $label => $q) {
    check("export validation: $label -> 422", call($api, 'mark', 'GET', "$TS/export$q")[0] === 422);
}
check('export: 31 days is allowed', call($api, 'mark', 'GET', "$TS/export?period_start=2026-10-01&period_end=2026-10-31")[0] === 200);
call($api, 'mark', 'POST', "$TS/approve", ['period_start' => '2026-10-26', 'period_end' => '2026-11-01', 'approvals' => [['staff_profile_id' => $staff['sam'], 'total_minutes' => 300]]]);
$two = array_map(static fn (string $l): array => str_getcsv($l, ',', '"', ''), explode("\r\n", rtrim(substr((string) call($api, 'mark', 'GET', "$TS/export?period_start=2026-10-19&period_end=2026-11-01")[1]['__raw']['body'], 3), "\r\n")));
$samRows = array_values(array_filter($two, static fn (array $r): bool => $r[0] === 'Sam Smith'));
check('export: two periods for one person each count only their own lines', count($samRows) === 2 && $samRows[0][12] === '1' && $samRows[0][14] === '1' && $samRows[1][3] === '2026-10-26' && $samRows[1][12] === '0' && $samRows[1][13] === '0' && $samRows[1][14] === '0', json_encode($samRows));
// ---- the marking export: POST timesheets/export (owner decision, 31 Oct 2026) -----------------------------------------------------------------------
$status = static fn (string $who, string $from): string => (string) $GLOBALS['pdo']->query("SELECT status FROM timesheets WHERE org_id = '{$GLOBALS['org']}' AND staff_profile_id = '$who' AND period_start = '$from'")->fetchColumn();
$audits = static fn (): int => (int) $GLOBALS['pdo']->query("SELECT COUNT(*) FROM audit_logs WHERE org_id = '{$GLOBALS['org']}' AND action = 'timesheet.exported'")->fetchColumn();
$csvRows = static fn (string $b): array => array_map(static fn (string $l): array => str_getcsv($l, ',', '"', ''), explode("\r\n", rtrim(substr($b, 3), "\r\n")));
check('mark: staff 403, a stranger 404, nobody 401', call($api, 'sam', 'POST', "$TS/export", $wk)[0] === 403 && call($api, 'zed', 'POST', "$TS/export", $wk)[0] === 404 && call($api, '', 'POST', "$TS/export", $wk)[0] === 401);
check('mark: the same range rules (no dates, 32 days, to before from: 422) and nothing is marked by a refusal', call($api, 'mark', 'POST', "$TS/export", [])[0] === 422 && call($api, 'mark', 'POST', "$TS/export", ['period_start' => '2026-10-01', 'period_end' => '2026-11-01'])[0] === 422 && call($api, 'mark', 'POST', "$TS/export", ['period_start' => '2026-10-25', 'period_end' => '2026-10-19'])[0] === 422 && $status($staff['sam'], '2026-10-19') === 'approved');
check('mark: the GET is still read-only (Sam and the evil row stay approved after another GET)', call($api, 'mark', 'GET', "$TS/export$week")[0] === 200 && $status($staff['sam'], '2026-10-19') === 'approved' && $status($evil, '2026-10-19') === 'approved');
$before = (string) call($api, 'mark', 'GET', "$TS/export$week")[1]['__raw']['body'];
$a0 = $audits();
[$s, $r] = call($api, 'mark', 'POST', "$TS/export", $wk);
$mraw = $r['__raw'] ?? [];
check('mark: 200, the same file the GET gave a moment before (the Status column says what each period was when the export began)', $s === 200 && ($mraw['body'] ?? null) === $before, json_encode(array_diff_key($mraw, ['body' => 1])));
$mrows = $csvRows((string) $mraw['body']);
check('mark: Status shows approved for the two marked now and exported for the one sent before', array_column(array_slice($mrows, 1), 7) === ['approved', 'exported', 'approved'], json_encode(array_column($mrows, 7)));
check('mark: an attachment with the counts in headers (2 marked, 1 already exported)', Api::rawHeaders($mraw) === ['Content-Type: text/csv; charset=utf-8', 'Cache-Control: no-store', 'Content-Disposition: attachment; filename="rotaflow-timesheets-payroll-org-2026-10-19-2026-10-25.csv"', 'X-RotaFlow-Marked-Exported: 2', 'X-RotaFlow-Already-Exported: 1'], json_encode(Api::rawHeaders($mraw)));
check('mark: exactly the included approved periods are now exported', $status($staff['sam'], '2026-10-19') === 'exported' && $status($evil, '2026-10-19') === 'exported' && $status($staff['pat'], '2026-10-19') === 'exported');
check('mark: nothing outside the file changes (the fortnight starting before, the next weeks, a submitted period, another organisation)', $status($staff['pat'], '2026-10-12') === 'approved' && $status($staff['sam'], '2026-11-02') === 'approved' && $status($staff['sam'], '2026-10-26') === 'approved' && $status($staff['mark'], '2026-10-19') === 'submitted' && $pdo->query("SELECT status FROM timesheets WHERE org_id = '$other'")->fetchColumn() === 'approved');
check('mark: the figures, versions and approvals are untouched', $pdo->query("SELECT CONCAT(total_minutes, '/', version, '/', approved_by IS NOT NULL) FROM timesheets WHERE staff_profile_id = '{$staff['sam']}' AND period_start = '2026-10-19'")->fetchColumn() === '2430/1/1');
$metas = array_values(array_filter(array_map(static fn (string $j): mixed => json_decode($j, true), $pdo->query("SELECT metadata FROM audit_logs WHERE org_id = '$org' AND action = 'timesheet.exported'")->fetchAll(PDO::FETCH_COLUMN)), static fn (mixed $m): bool => is_array($m) && array_key_exists('marked', $m)));
$meta = count($metas) === 1 ? $metas[0] : $metas;
check('mark: audited once, with dates and counts only (no names, no staff ids)', $audits() === $a0 + 1 && $meta === ['period_start' => '2026-10-19', 'period_end' => '2026-10-25', 'rows' => 3, 'marked' => 2, 'already_exported' => 1], json_encode($meta));
[$s, $r] = call($api, 'mark', 'POST', "$TS/export", $wk);
check('mark: idempotent: again marks nothing, every row says exported, the counts say so', $s === 200 && array_column(array_slice($csvRows((string) $r['__raw']['body']), 1), 7) === ['exported', 'exported', 'exported'] && ($r['__raw']['headers'] ?? null) === ['X-RotaFlow-Marked-Exported' => '0', 'X-RotaFlow-Already-Exported' => '3'] && $audits() === $a0 + 2);
check('mark: an exported period stays locked against a new submission (409 already_exported with the flag on)', call($api, 'sam', 'POST', "$TS/submit", ['period_start' => '2026-10-19', 'period_end' => '2026-10-25', 'total_minutes' => 1])[1]['error']['code'] === 'already_exported');
check('mark: the owner may too; the GET afterwards shows them exported', call($api, 'olga', 'POST', "$TS/export", ['period_start' => '2026-10-26', 'period_end' => '2026-11-01'])[1]['__raw']['headers']['X-RotaFlow-Marked-Exported'] === '1' && $status($staff['sam'], '2026-10-26') === 'exported' && str_contains((string) call($api, 'mark', 'GET', "$TS/export?period_start=2026-10-26&period_end=2026-11-01")[1]['__raw']['body'], ',exported,'));
check('mark: an empty range marks nothing and is just the header', call($api, 'mark', 'POST', "$TS/export", ['period_start' => '2027-01-04', 'period_end' => '2027-01-10'])[1]['__raw']['headers'] === ['X-RotaFlow-Marked-Exported' => '0', 'X-RotaFlow-Already-Exported' => '0']);

// Two exports of one range at the same instant, on their own connections: both answer the file, exactly one marks.
call($api, 'mark', 'POST', "$TS/approve", ['period_start' => '2026-11-09', 'period_end' => '2026-11-15', 'approvals' => [['staff_profile_id' => $staff['sam'], 'total_minutes' => 120], ['staff_profile_id' => $staff['pat'], 'total_minutes' => 240]]]);
$spawn = static function (string $who, string $method, string $path, float $start, array $body = []): array {
    $p = proc_open([PHP_BINARY, dirname(__DIR__) . '/concurrent-call.php', $who, $method, $path, sprintf('%.6f', $start), json_encode($body ?: new stdClass())], [1 => ['pipe', 'w'], 2 => ['pipe', 'w']], $pipes);
    return [$p, $pipes];
};
$collect = static function (array $h): array {
    $out = stream_get_contents($h[1][1]);
    $err = stream_get_contents($h[1][2]);
    proc_close($h[0]);
    return json_decode(trim((string) $out), true) ?: [0, ['crash' => $out . $err]];
};
$nov = ['period_start' => '2026-11-09', 'period_end' => '2026-11-15'];
$a0 = $audits();
$t0 = microtime(true) + 1.5;
$res = array_map($collect, [$spawn('mark', 'POST', "$TS/export", $t0, $nov), $spawn('olga', 'POST', "$TS/export", $t0, $nov)]);
$marks = array_map(static fn (array $x): string => (string) ($x[1]['__raw']['headers']['X-RotaFlow-Marked-Exported'] ?? 'x'), $res);
sort($marks);
check('concurrency: two marking exports at once both answer 200 with both periods; one marks 2, the other 0; both periods exported once; two audits', array_map(static fn (array $x): int => (int) $x[0], $res) === [200, 200] && $marks === ['0', '2'] && count($csvRows((string) $res[0][1]['__raw']['body'])) === 3 && count($csvRows((string) $res[1][1]['__raw']['body'])) === 3 && $status($staff['sam'], '2026-11-09') === 'exported' && $status($staff['pat'], '2026-11-09') === 'exported' && $audits() === $a0 + 2, json_encode(array_map(static fn (array $x): array => [$x[0], $x[1]['__raw']['headers'] ?? $x[1]], $res)));
// The organisation row is the first lock: while another connection holds it, the export waits BEFORE it locks any timesheet row.
call($api, 'mark', 'POST', "$TS/approve", ['period_start' => '2026-11-16', 'period_end' => '2026-11-22', 'approvals' => [['staff_profile_id' => $staff['sam'], 'total_minutes' => 60]]]);
$tsRow = (string) $pdo->query("SELECT id FROM timesheets WHERE staff_profile_id = '{$staff['sam']}' AND period_start = '2026-11-16'")->fetchColumn();
$lock = Db::connect($dbConf);
$lock->beginTransaction();
$lock->prepare('SELECT id FROM organisations WHERE id = ? FOR UPDATE')->execute([$org]);
$h = $spawn('mark', 'POST', "$TS/export", microtime(true), ['period_start' => '2026-11-16', 'period_end' => '2026-11-22']);
usleep(2500000);
$waiting = proc_get_status($h[0])['running'];
$probe = Db::connect($dbConf);
$probe->beginTransaction();
try {
    $probe->query("SELECT id FROM timesheets WHERE id = '$tsRow' FOR UPDATE NOWAIT")->fetchAll();
    $rowFree = true;
} catch (PDOException) {
    $rowFree = false;
}
$probe->rollBack();
$stillApproved = $status($staff['sam'], '2026-11-16') === 'approved';
$lock->rollBack();
$r = $collect($h);
check('concurrency: the marking export waits on the organisation lock before it locks the period, then marks it', $waiting && $rowFree && $stillApproved && $r[0] === 200 && ($r[1]['__raw']['headers']['X-RotaFlow-Marked-Exported'] ?? '') === '1' && $status($staff['sam'], '2026-11-16') === 'exported', json_encode([$waiting, $rowFree, $stillApproved, $r[0], $r[1]['__raw']['headers'] ?? $r[1]]));

// ---- an exported period is final until an owner reopens it (owner decision, 31 Oct 2026) -----------------------------------------------------------
$EXP = 'This period has been exported to payroll. Ask an owner to reopen it if it must change.';
$fig = static fn (string $who, string $from): string => (string) $GLOBALS['pdo']->query("SELECT CONCAT(status, '/', total_minutes, '/', version) FROM timesheets WHERE org_id = '{$GLOBALS['org']}' AND staff_profile_id = '$who' AND period_start = '$from'")->fetchColumn();
$samWeek = (string) $pdo->query("SELECT id FROM timesheets WHERE staff_profile_id = '{$staff['sam']}' AND period_start = '2026-10-19'")->fetchColumn();
[$s, $r] = call($api, 'mark', 'POST', "$TS/approve", $wk + ['approvals' => [['staff_profile_id' => $staff['sam'], 'total_minutes' => 9999]]]);
check('final: approving an exported period again is 409 already_exported with the plain sentence; nothing changes', $s === 409 && $r['error']['code'] === 'already_exported' && $r['error']['message'] === $EXP && $fig($staff['sam'], '2026-10-19') === 'exported/2430/1', json_encode($r));
[$s, $r] = call($api, 'olga', 'POST', "$TS/approve", $wk + ['approvals' => [['staff_profile_id' => $staff['mark'], 'total_minutes' => 600], ['staff_profile_id' => $staff['sam'], 'total_minutes' => 1]]]);
check('final: a batch with one exported period is refused whole (the submitted one beside it is not approved either), even for the owner', $s === 409 && $r['error']['code'] === 'already_exported' && $fig($staff['mark'], '2026-10-19') === 'submitted/555/0', json_encode($r));
check('final: approving a period that is not exported still works', call($api, 'mark', 'POST', "$TS/approve", ['period_start' => '2026-11-30', 'period_end' => '2026-12-06', 'approvals' => [['staff_profile_id' => $staff['sam'], 'total_minutes' => 30]]])[0] === 200 && $fig($staff['sam'], '2026-11-30') === 'approved/30/1');
[$s, $r] = call($api, 'mark', 'POST', "$TS/$samWeek/reopen");
check('final: a manager cannot reopen an exported period (409 already_exported, it stays exported)', $s === 409 && $r['error']['code'] === 'already_exported' && $fig($staff['sam'], '2026-10-19') === 'exported/2430/1', json_encode($r));
check('final: staff 403 and a stranger 404 on reopen', call($api, 'sam', 'POST', "$TS/$samWeek/reopen", ['reason' => 'Please change it'])[0] === 403 && call($api, 'zed', 'POST', "$TS/$samWeek/reopen", ['reason' => 'Please change it'])[0] === 404);
check('final: the owner must give a reason of 3 to 500 characters (none, 2, 501: 422, nothing changes)', call($api, 'olga', 'POST', "$TS/$samWeek/reopen")[0] === 422 && call($api, 'olga', 'POST', "$TS/$samWeek/reopen", ['reason' => ' ab '])[0] === 422 && call($api, 'olga', 'POST', "$TS/$samWeek/reopen", ['reason' => str_repeat('x', 501)])[0] === 422 && $fig($staff['sam'], '2026-10-19') === 'exported/2430/1' && (int) $pdo->query('SELECT COUNT(*) FROM timesheet_reopenings')->fetchColumn() === 0);
// A clock correction inside an exported period does not change its status or figure; it only raises the recalculation flag, as before.
$patIn = (string) $pdo->query("SELECT id FROM clock_events WHERE staff_profile_id = '{$staff['pat']}' AND event_at = '2026-10-20 09:20:00.000'")->fetchColumn();
$pdo->exec("UPDATE timesheets SET recalculation_required_at = NULL WHERE staff_profile_id = '{$staff['pat']}' AND period_start = '2026-10-19'");
check('final: a clock correction in an exported period keeps it exported with its figure, and flags recalculation', call($api, 'mark', 'POST', "/orgs/$org/clock-events/$patIn/correct", ['reason' => 'Arrived at 09:15', 'event_at' => '2026-10-20T09:15:00Z'])[0] === 200 && $fig($staff['pat'], '2026-10-19') === 'exported/61/1' && $pdo->query("SELECT recalculation_required_at IS NOT NULL FROM timesheets WHERE staff_profile_id = '{$staff['pat']}' AND period_start = '2026-10-19'")->fetchColumn() == 1);
$ra0 = (int) $pdo->query("SELECT COUNT(*) FROM audit_logs WHERE org_id = '$org' AND action = 'timesheet.export_reopened'")->fetchColumn();
[$s, $r] = call($api, 'olga', 'POST', "$TS/$samWeek/reopen", ['reason' => 'Sam Smith worked an extra Sunday shift we missed']);
check('reopen: the owner moves it exported -> approved, version + 1, the approval kept', $s === 200 && $r['timesheet']['status'] === 'approved' && $r['timesheet']['version'] === 2 && $r['timesheet']['total_minutes'] === 2430 && $r['timesheet']['approved_by'] !== null, json_encode($r));
$reo = $pdo->query("SELECT reason, from_status, to_status, version_after, timesheet_id FROM timesheet_reopenings")->fetchAll();
check('reopen: the reason is kept with the period (timesheet_reopenings), once', count($reo) === 1 && $reo[0]['reason'] === 'Sam Smith worked an extra Sunday shift we missed' && $reo[0]['from_status'] === 'exported' && $reo[0]['to_status'] === 'approved' && (int) $reo[0]['version_after'] === 2 && $reo[0]['timesheet_id'] === $samWeek, json_encode($reo));
$rm = json_decode((string) $pdo->query("SELECT metadata FROM audit_logs WHERE org_id = '$org' AND action = 'timesheet.export_reopened'")->fetchColumn(), true);
check('reopen: audited once without personal data (dates, from, to, version; not the reason, no names)', (int) $pdo->query("SELECT COUNT(*) FROM audit_logs WHERE org_id = '$org' AND action = 'timesheet.export_reopened'")->fetchColumn() === $ra0 + 1 && $rm === ['period_start' => '2026-10-19', 'period_end' => '2026-10-25', 'from' => 'exported', 'to' => 'approved', 'version' => 2], json_encode($rm));
check('reopen: the corrected figure is then approved (version 3) and the next marking export sends it under the new version', call($api, 'mark', 'POST', "$TS/approve", $wk + ['approvals' => [['staff_profile_id' => $staff['sam'], 'total_minutes' => 2490]]])[0] === 200 && $fig($staff['sam'], '2026-10-19') === 'approved/2490/3' && call($api, 'mark', 'POST', "$TS/export", $wk)[1]['__raw']['headers']['X-RotaFlow-Marked-Exported'] === '1' && $fig($staff['sam'], '2026-10-19') === 'exported/2490/3');
// With the flag on, approval takes the organisation lock first (as the marking export does), so the two are ordered.
$lock = Db::connect($dbConf);
$lock->beginTransaction();
// A shared lock: a plain insert's foreign-key check can share it; only the organisation lock (FOR UPDATE) has to wait.
$lock->prepare('SELECT id FROM organisations WHERE id = ? LOCK IN SHARE MODE')->execute([$org]);
$h = $spawn('mark', 'POST', "$TS/approve", microtime(true), ['period_start' => '2026-12-07', 'period_end' => '2026-12-13', 'approvals' => [['staff_profile_id' => $staff['sam'], 'total_minutes' => 45]]]);
usleep(2500000);
$waiting = proc_get_status($h[0])['running'];
$lock->rollBack();
$r = $collect($h);
check('lock: with the flag on, an approval waits on the organisation lock, then goes through', $waiting && $r[0] === 200 && $fig($staff['sam'], '2026-12-07') === 'approved/45/1', json_encode([$waiting, $r[0]]));
// An approval and a marking export of the same period at the same instant: whichever is first, the period ends exported with the figure
// the file carried, never approved again after it was sent.
$t0 = microtime(true) + 1.5;
$res = array_map($collect, [$spawn('mark', 'POST', "$TS/approve", $t0, ['period_start' => '2026-12-07', 'period_end' => '2026-12-13', 'approvals' => [['staff_profile_id' => $staff['sam'], 'total_minutes' => 50]]]), $spawn('olga', 'POST', "$TS/export", $t0, ['period_start' => '2026-12-07', 'period_end' => '2026-12-13'])]);
$sent = $csvRows((string) ($res[1][1]['__raw']['body'] ?? ''))[1][5] ?? null;
check('race: approval and export at once end exported with the exported figure (approval 200 before, or 409 already_exported after)', $res[1][0] === 200 && in_array($res[0][0], [200, 409], true) && ($res[0][0] === 200 || ($res[0][1]['error']['code'] ?? '') === 'already_exported') && $fig($staff['sam'], '2026-12-07') === "exported/$sent/" . ($res[0][0] === 200 ? '2' : '1') && $sent === ($res[0][0] === 200 ? '50' : '45'), json_encode([$res[0][0], $res[0][1]['error'] ?? null, $sent, $fig($staff['sam'], '2026-12-07')]));

$uid = static fn (string $n): string => (string) $GLOBALS['pdo']->query("SELECT id FROM users WHERE email = '$n@example.test'")->fetchColumn();
call($api, 'sue', 'GET', '/me');
$pdo->prepare("INSERT INTO platform_admins (user_id, role) VALUES (?, 'platform_support')")->execute([$uid('sue')]);
$pdo->prepare('UPDATE organisations SET support_access_allowed = 1 WHERE id = ?')->execute([$org]);
$pdo->prepare("INSERT INTO support_access_sessions (id, org_id, admin_user_id, reason, case_ref, scope, expires_at) VALUES (?, ?, ?, 'The customer asked for help with payroll', 'CASE-4121', 'read_write', DATE_ADD(UTC_TIMESTAMP(), INTERVAL 1 HOUR))")->execute([Db::uuid(), $org, $uid('sue')]);
check('support: a live support session reads timesheets but cannot export payroll (403)', call($api, 'sue', 'GET', $TS . $week)[0] === 200 && call($api, 'sue', 'GET', "$TS/export$week")[0] === 403);
call($api, 'mark', 'POST', "$TS/approve", ['period_start' => '2026-11-23', 'period_end' => '2026-11-29', 'approvals' => [['staff_profile_id' => $staff['sam'], 'total_minutes' => 60]]]);
check('support: nor mark payroll exported (403 forbidden, nothing marked)', call($api, 'sue', 'POST', "$TS/export", ['period_start' => '2026-11-23', 'period_end' => '2026-11-29'])[1]['error']['code'] === 'forbidden' && $status($staff['sam'], '2026-11-23') === 'approved');
check('support: nor reopen an exported period (403 forbidden, it stays exported)', call($api, 'sue', 'POST', "$TS/$samWeek/reopen", ['reason' => 'Asked to by the customer'])[1]['error']['code'] === 'forbidden' && str_starts_with($fig($staff['sam'], '2026-10-19'), 'exported/'));
$flag(false);
check('off again: the export is refused and the list loses its lines', call($api, 'mark', 'GET', "$TS/export$week")[1]['error']['code'] === 'feature_off' && array_keys(call($api, 'mark', 'GET', $TS . $week)[1]) === ['timesheets']);
check('off again: the marking export is refused and marks nothing', call($api, 'mark', 'POST', "$TS/export", ['period_start' => '2026-11-23', 'period_end' => '2026-11-29'])[1]['error']['code'] === 'feature_off' && $status($staff['sam'], '2026-11-23') === 'approved');

// ---- with the flag off, an exported period is handled exactly as before (S5): nothing new refuses it --------------------------------------------
check('off: approving an exported period puts it back to approved with version + 1, as before (no already_exported)', call($api, 'mark', 'POST', "$TS/approve", ['period_start' => '2026-11-09', 'period_end' => '2026-11-15', 'approvals' => [['staff_profile_id' => $staff['pat'], 'total_minutes' => 250]]])[0] === 200 && $fig($staff['pat'], '2026-11-09') === 'approved/250/2');
check('off: submitting over an exported period is timesheet_locked, as before', call($api, 'sam', 'POST', "$TS/submit", ['period_start' => '2026-10-26', 'period_end' => '2026-11-01', 'total_minutes' => 1])[1]['error']['code'] === 'timesheet_locked');
$evilWeek = (string) $pdo->query("SELECT id FROM timesheets WHERE staff_profile_id = '$evil' AND period_start = '2026-10-19'")->fetchColumn();
[$s, $r] = call($api, 'mark', 'POST', "$TS/$evilWeek/reopen");
check('off: a manager reopens an exported period to open, without a reason, as before', $s === 200 && $r['timesheet']['status'] === 'open' && (int) $pdo->query('SELECT COUNT(*) FROM timesheet_reopenings')->fetchColumn() === 1, json_encode($r));
$lock = Db::connect($dbConf);
$lock->beginTransaction();
$lock->prepare('SELECT id FROM organisations WHERE id = ? LOCK IN SHARE MODE')->execute([$org]);
$h = $spawn('mark', 'POST', "$TS/approve", microtime(true), ['period_start' => '2026-12-14', 'period_end' => '2026-12-20', 'approvals' => [['staff_profile_id' => $staff['sam'], 'total_minutes' => 15]]]);
$t1 = microtime(true);
$r = $collect($h);
$took = microtime(true) - $t1;
$lock->rollBack();
check('off: approval does not take the organisation lock (it answers while another connection holds a shared lock on it), as before', $r[0] === 200 && $took < 2.0, json_encode([$r[0], $took]));
