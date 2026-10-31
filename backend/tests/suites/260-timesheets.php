<?php
declare(strict_types=1);

// Timesheets (R2 slice S13) through the API: with the `timesheet_tools` flag off nothing changes; with it on the list gains lines with
// late / early finish / overtime flags beyond the tolerance (the week of the October 2026 clock change, draft and cancelled shifts left
// out, a person sees only their own), and the payroll CSV of approved periods (BOM, fixed columns, exact minutes and hours, local times,
// formula-injection safe, recalculation flag, audited, read-only, owners and managers only, never platform support). Ports SiteRelay's
// 081-timesheets endpoint cases to RotaFlow's period approvals. The pure rules are suite 255-timesheet-rules.
use RotaFlow\{Db, TimesheetRules as T};

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
check('export: a CSV download with a dated file name and no caching', $s === 200 && $raw['mime'] === 'text/csv; charset=utf-8' && $raw['filename'] === 'rotaflow-payroll-2026-10-19-to-2026-10-25.csv' && $raw['cache'] === 'no-store', json_encode($r));
check('export: starts with the UTF-8 BOM and every line ends CRLF', str_starts_with($body, "\xEF\xBB\xBF") && substr_count($body, "\r\n") === 4 && str_ends_with($body, "\r\n") && substr_count($body, "\n") === 4);
$rows = array_map(static fn (string $l): array => str_getcsv($l, ',', '"', ''), explode("\r\n", rtrim(substr($body, 3), "\r\n")));
$head = array_shift($rows);
$col = array_flip($head);
check('export: the header is the documented column order', $head === T::COLUMNS, json_encode($head));
check('export: approved periods wholly inside the range only (not submitted, not another week, not a fortnight that starts before, not another organisation)', count($rows) === 3 && !str_contains($body, '999') && !str_contains($body, '888') && !str_contains($body, '555') && !str_contains($body, '444') && !str_contains($body, 'Unapproved') && !str_contains($body, 'Zoe'), $body);
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
$uid = static fn (string $n): string => (string) $GLOBALS['pdo']->query("SELECT id FROM users WHERE email = '$n@example.test'")->fetchColumn();
call($api, 'sue', 'GET', '/me');
$pdo->prepare("INSERT INTO platform_admins (user_id, role) VALUES (?, 'platform_support')")->execute([$uid('sue')]);
$pdo->prepare('UPDATE organisations SET support_access_allowed = 1 WHERE id = ?')->execute([$org]);
$pdo->prepare("INSERT INTO support_access_sessions (id, org_id, admin_user_id, reason, case_ref, scope, expires_at) VALUES (?, ?, ?, 'The customer asked for help with payroll', 'CASE-4121', 'read_write', DATE_ADD(UTC_TIMESTAMP(), INTERVAL 1 HOUR))")->execute([Db::uuid(), $org, $uid('sue')]);
check('support: a live support session reads timesheets but cannot export payroll (403)', call($api, 'sue', 'GET', $TS . $week)[0] === 200 && call($api, 'sue', 'GET', "$TS/export$week")[0] === 403);
$flag(false);
check('off again: the export is refused and the list loses its lines', call($api, 'mark', 'GET', "$TS/export$week")[1]['error']['code'] === 'feature_off' && array_keys(call($api, 'mark', 'GET', $TS . $week)[1]) === ['timesheets']);
