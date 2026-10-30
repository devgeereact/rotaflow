<?php
declare(strict_types=1);

// Timesheets: submit, approve a batch atomically, lock, reopen, recalculation flag.
use RotaFlow\Db;

$api = test_api($pdo);
$org = call($api, 'olga', 'POST', '/orgs', ['name' => 'Timesheet Org'])[1]['org']['id'];
$other = call($api, 'zed', 'POST', '/orgs', ['name' => 'Elsewhere'])[1]['org']['id'];
$staff = [];
foreach (['mark' => 'manager', 'sam' => 'staff', 'pat' => 'staff'] as $name => $role) {
    call($api, $name, 'GET', '/me');
    $pdo->prepare("INSERT INTO memberships (id, org_id, user_id, role, status) SELECT ?, ?, id, ?, 'active' FROM users WHERE email = ?")->execute([Db::uuid(), $org, $role, "$name@example.test"]);
    $staff[$name] = call($api, 'olga', 'POST', "/orgs/$org/staff", ['first_name' => ucfirst($name), 'email' => "$name@example.test"])[1]['id'];
}
$zStaff = call($api, 'zed', 'POST', "/orgs/$other/staff", ['first_name' => 'Zoe'])[1]['id'];
$P = ['period_start' => '2030-04-01', 'period_end' => '2030-04-07'];
$approve = static fn (string $who, array $rows, ?array $period = null) => call($GLOBALS['api'], $who, 'POST', "/orgs/{$GLOBALS['org']}/timesheets/approve", ($period ?? $GLOBALS['P']) + ['approvals' => $rows]);

// ---- submitting ---------------------------------------------------------------------------------------------------
[$s, $r] = call($api, 'sam', 'POST', "/orgs/$org/timesheets/submit", $P + ['total_minutes' => 2400]);
check('a person submits their own period total', $s === 200 && $r['timesheet']['status'] === 'submitted' && $r['timesheet']['total_minutes'] === 2400 && $r['timesheet']['staff_profile_id'] === $staff['sam'], json_encode($r));
$t1 = $r['timesheet']['id'];
check('submitting again updates the same row', call($api, 'sam', 'POST', "/orgs/$org/timesheets/submit", $P + ['total_minutes' => 2460])[1]['timesheet']['id'] === $t1 && (int) $pdo->query("SELECT COUNT(*) FROM timesheets WHERE staff_profile_id = '{$staff['sam']}'")->fetchColumn() === 1);
foreach ([['total_minutes' => -1], ['total_minutes' => 'lots'], ['total_minutes' => 1.5], ['total_minutes' => 999999], []] as $i => $bad) {
    check("a bad total is 422 ($i)", call($api, 'sam', 'POST', "/orgs/$org/timesheets/submit", $P + $bad)[0] === 422);
}
check('a period that ends before it starts is 422', call($api, 'sam', 'POST', "/orgs/$org/timesheets/submit", ['period_start' => '2030-04-07', 'period_end' => '2030-04-01', 'total_minutes' => 1])[0] === 422);
check('a stranger gets 404', call($api, 'zed', 'POST', "/orgs/$org/timesheets/submit", $P + ['total_minutes' => 1])[0] === 404);
check('a member with no staff record cannot submit', (function () use ($api, $org, $pdo, $P): bool { call($api, 'nora', 'GET', '/me'); $pdo->prepare("INSERT INTO memberships (id, org_id, user_id, role, status) SELECT ?, ?, id, 'staff', 'active' FROM users WHERE email = 'nora@example.test'")->execute([Db::uuid(), $org]); return call($api, 'nora', 'POST', "/orgs/$org/timesheets/submit", $P + ['total_minutes' => 1])[1]['error']['code'] === 'no_staff_record'; })());

// ---- approving ------------------------------------------------------------------------------------------------------
check('staff cannot approve', $approve('sam', [['staff_profile_id' => $staff['sam'], 'total_minutes' => 2400]])[0] === 403);
check('a stranger gets 404', $approve('zed', [['staff_profile_id' => $staff['sam'], 'total_minutes' => 2400]])[0] === 404);
check('an empty or malformed batch is 422', $approve('mark', [])[0] === 422 && $approve('mark', ['nope'])[0] === 422 && $approve('mark', [['staff_profile_id' => $staff['sam']]])[0] === 422);
[$s, $r] = $approve('mark', [['staff_profile_id' => $zStaff, 'total_minutes' => 60], ['staff_profile_id' => $staff['pat'], 'total_minutes' => 1000]]);
check('one person from another organisation fails the whole batch and nothing is written', $s === 422 && (int) $pdo->query("SELECT COUNT(*) FROM timesheets WHERE staff_profile_id = '{$staff['pat']}'")->fetchColumn() === 0);
[$s, $r] = $approve('mark', [['staff_profile_id' => $staff['sam'], 'total_minutes' => 2400], ['staff_profile_id' => $staff['pat'], 'total_minutes' => 1800]]);
check('a manager approves a batch, replacing the submitted figure, recording who and when, at version 1', $s === 200 && count($r['timesheets']) === 2 && array_unique(array_column($r['timesheets'], 'status')) === ['approved'] && array_unique(array_column($r['timesheets'], 'version')) === [1] && $r['timesheets'][0]['approved_by'] !== null && $r['timesheets'][0]['approved_at'] !== null, json_encode($r));
check('the person\'s own row was updated, not duplicated', (int) $pdo->query("SELECT COUNT(*) FROM timesheets WHERE staff_profile_id = '{$staff['sam']}' AND period_start = '2030-04-01'")->fetchColumn() === 1 && (int) $pdo->query("SELECT total_minutes FROM timesheets WHERE id = '$t1'")->fetchColumn() === 2400);
[, $r] = $approve('mark', [['staff_profile_id' => $staff['sam'], 'total_minutes' => 2450]]);
check('approving again replaces the figure and bumps the version', $r['timesheets'][0]['total_minutes'] === 2450 && $r['timesheets'][0]['version'] === 2);
[$s, $r] = call($api, 'sam', 'POST', "/orgs/$org/timesheets/submit", $P + ['total_minutes' => 1]);
check('a person cannot resubmit an approved period', $s === 409 && $r['error']['code'] === 'timesheet_locked', json_encode($r));
check('a different period is a different timesheet', call($api, 'sam', 'POST', "/orgs/$org/timesheets/submit", ['period_start' => '2030-04-08', 'period_end' => '2030-04-14', 'total_minutes' => 100])[0] === 200);

// ---- reading ----------------------------------------------------------------------------------------------------------
check('a person lists only their own timesheets', array_unique(array_column(call($api, 'sam', 'GET', "/orgs/$org/timesheets")[1]['timesheets'], 'staff_profile_id')) === [$staff['sam']]);
check('and cannot ask for a colleague\'s', array_unique(array_column(call($api, 'sam', 'GET', "/orgs/$org/timesheets?staff_profile_id={$staff['pat']}")[1]['timesheets'], 'staff_profile_id')) === [$staff['sam']]);
check('a manager lists everyone\'s and can filter by period, person and status', count(call($api, 'mark', 'GET', "/orgs/$org/timesheets")[1]['timesheets']) === 3 && count(call($api, 'mark', 'GET', "/orgs/$org/timesheets?period_start=2030-04-08")[1]['timesheets']) === 1 && count(call($api, 'mark', 'GET', "/orgs/$org/timesheets?staff_profile_id={$staff['pat']}")[1]['timesheets']) === 1 && count(call($api, 'mark', 'GET', "/orgs/$org/timesheets?status=approved")[1]['timesheets']) === 2);
check('a stranger gets 404', call($api, 'zed', 'GET', "/orgs/$org/timesheets")[0] === 404);

// ---- recalculation flag --------------------------------------------------------------------------------------------------------
$ev = call($api, 'mark', 'POST', "/orgs/$org/clock-events", ['type' => 'in', 'staff_profile_id' => $staff['sam'], 'event_at' => '2030-04-03T09:00:00Z'])[1]['clock_event']['id'];
check('a timesheet starts with no recalculation flag', $pdo->query("SELECT recalculation_required_at IS NULL FROM timesheets WHERE id = '$t1'")->fetchColumn() == 1);
call($api, 'mark', 'POST', "/orgs/$org/clock-events/$ev/correct", ['reason' => 'Wrong time recorded', 'event_at' => '2030-04-03T09:30:00Z']);
$flag = call($api, 'sam', 'GET', "/orgs/$org/timesheets?period_start=2030-04-01&period_end=2030-04-07")[1]['timesheets'][0];
check('correcting a clock event in an approved period flags it for recalculation', $flag['recalculation_required_at'] !== null);
check('approving again clears the flag', $approve('mark', [['staff_profile_id' => $staff['sam'], 'total_minutes' => 2430]])[1]['timesheets'][0]['recalculation_required_at'] === null);
call($api, 'mark', 'POST', "/orgs/$org/clock-events/$ev/correct", ['reason' => 'Changed again', 'event_at' => '2030-04-03T09:45:00Z']);
check('a correction to an event OUTSIDE any approved period flags nothing', (function () use ($api, $org, $pdo, $staff): bool { $e = call($api, 'mark', 'POST', "/orgs/$org/clock-events", ['type' => 'in', 'staff_profile_id' => $staff['pat'], 'event_at' => '2031-01-03T09:00:00Z'])[1]['clock_event']['id']; call($api, 'mark', 'POST', "/orgs/$org/clock-events/$e/correct", ['reason' => 'Later fix', 'type' => 'out']); return (int) $pdo->query("SELECT COUNT(*) FROM timesheets WHERE staff_profile_id = '{$staff['pat']}' AND recalculation_required_at IS NOT NULL")->fetchColumn() === 0; })());

// ---- reopening ------------------------------------------------------------------------------------------------------------------
check('staff cannot send a timesheet back', call($api, 'sam', 'POST', "/orgs/$org/timesheets/$t1/reopen")[0] === 403);
[$s, $r] = call($api, 'mark', 'POST', "/orgs/$org/timesheets/$t1/reopen");
check('a manager reopens it; it keeps who approved it and when', $s === 200 && $r['timesheet']['status'] === 'open' && $r['timesheet']['approved_by'] !== null && $r['timesheet']['version'] >= 2, json_encode($r));
check('a reopened period can be submitted again', call($api, 'sam', 'POST', "/orgs/$org/timesheets/submit", $P + ['total_minutes' => 2500])[1]['timesheet']['status'] === 'submitted');
check('another organisation\'s timesheet id is 404', call($api, 'zed', 'POST', "/orgs/$other/timesheets/$t1/reopen")[0] === 404 && call($api, 'zed', 'POST', "/orgs/$org/timesheets/$t1/reopen")[0] === 404);
check('approvals and reopenings are audited', (int) $pdo->query("SELECT COUNT(*) FROM audit_logs WHERE org_id = '$org' AND action IN ('timesheet.approved','timesheet.reopened','timesheet.submitted')")->fetchColumn() >= 6);
