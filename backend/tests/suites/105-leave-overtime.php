<?php
declare(strict_types=1);

// Leave and overtime requests: booking once per day, one decision, cancellation, evidence.
use RotaFlow\Db;

$api = test_api($pdo);
$org = call($api, 'olga', 'POST', '/orgs', ['name' => 'Leave Org'])[1]['org']['id'];
$other = call($api, 'zed', 'POST', '/orgs', ['name' => 'Elsewhere'])[1]['org']['id'];
$staff = [];
foreach (['mark' => 'manager', 'sam' => 'staff', 'pat' => 'staff'] as $name => $role) {
    call($api, $name, 'GET', '/me');
    $pdo->prepare("INSERT INTO memberships (id, org_id, user_id, role, status) SELECT ?, ?, id, ?, 'active' FROM users WHERE email = ?")->execute([Db::uuid(), $org, $role, "$name@example.test"]);
    $staff[$name] = call($api, 'olga', 'POST', "/orgs/$org/staff", ['first_name' => ucfirst($name), 'email' => "$name@example.test"])[1]['id'];
}
$zStaff = call($api, 'zed', 'POST', "/orgs/$other/staff", ['first_name' => 'Zoe'])[1]['id'];
$leave = static fn (string $who, array $b) => call($GLOBALS['api'], $who, 'POST', "/orgs/{$GLOBALS['org']}/leave", $b);

// ---- leave: requesting --------------------------------------------------------------------------------------------
[$s, $r] = $leave('sam', ['start_date' => '2030-06-10', 'end_date' => '2030-06-14', 'reason' => 'Holiday']);
check('a person asks for leave for themselves; it starts pending and costs five days', $s === 201 && $r['leave']['status'] === 'pending' && $r['leave']['days'] == 5 && $r['leave']['type'] === 'holiday' && $r['leave']['staff_profile_id'] === $staff['sam'], json_encode($r));
$l1 = $r['leave']['id'];
[$s, $r] = $leave('sam', ['start_date' => '2030-06-14', 'end_date' => '2030-06-20']);
check('a request that shares a day with another live one is refused', $s === 409 && $r['error']['code'] === 'leave_overlap', json_encode($r));
check('a request on the adjacent days is fine', $leave('sam', ['start_date' => '2030-06-15', 'end_date' => '2030-06-16'])[0] === 201);
check('the same dates for someone else are fine', $leave('pat', ['start_date' => '2030-06-10', 'end_date' => '2030-06-14'])[0] === 201);
check('half days at either end reduce the cost', $leave('pat', ['start_date' => '2030-07-01', 'end_date' => '2030-07-03', 'starts_half' => true, 'ends_half' => true])[1]['leave']['days'] == 2);
check('a single half day never costs zero', $leave('pat', ['start_date' => '2030-07-10', 'end_date' => '2030-07-10', 'starts_half' => true, 'ends_half' => true])[1]['leave']['days'] == 0.5);
check('a manager can book leave for someone else', $leave('mark', ['staff_profile_id' => $staff['sam'], 'start_date' => '2030-08-01', 'end_date' => '2030-08-02'])[0] === 201);
check('a person cannot book for a colleague', $leave('sam', ['staff_profile_id' => $staff['pat'], 'start_date' => '2030-09-01', 'end_date' => '2030-09-02'])[0] === 403);
check('nor for someone in another organisation', $leave('mark', ['staff_profile_id' => $zStaff, 'start_date' => '2030-09-01', 'end_date' => '2030-09-02'])[0] === 422);
foreach ([['start_date' => '2030-09-05', 'end_date' => '2030-09-01'], ['start_date' => '2030-09-05'], ['start_date' => '2030-02-30', 'end_date' => '2030-03-01'], ['start_date' => '2030-01-01', 'end_date' => '2031-06-01'], ['start_date' => '2030-09-01', 'end_date' => '2030-09-02', 'type' => 'Annual Leave!'], ['start_date' => '2030-09-01', 'end_date' => '2030-09-02', 'reason' => ['x']]] as $i => $bad) {
    check("a bad leave request is 422 ($i)", $leave('sam', $bad)[0] === 422);
}
check('a member with no staff record cannot ask', (function () use ($api, $org, $pdo): bool { call($api, 'nora', 'GET', '/me'); $pdo->prepare("INSERT INTO memberships (id, org_id, user_id, role, status) SELECT ?, ?, id, 'staff', 'active' FROM users WHERE email = 'nora@example.test'")->execute([Db::uuid(), $org]); return call($api, 'nora', 'POST', "/orgs/$org/leave", ['start_date' => '2030-09-01', 'end_date' => '2030-09-02'])[1]['error']['code'] === 'no_staff_record'; })());
check('a stranger gets 404', call($api, 'zed', 'POST', "/orgs/$org/leave", ['start_date' => '2030-09-01', 'end_date' => '2030-09-02'])[0] === 404);

// idempotent replay
$cid = Db::uuid();
$a = $leave('sam', ['start_date' => '2030-10-01', 'end_date' => '2030-10-02', 'client_event_id' => $cid]);
$b = $leave('sam', ['start_date' => '2030-10-01', 'end_date' => '2030-10-02', 'client_event_id' => $cid]);
check('a replayed offline request answers 200 already_applied with the same record, not an overlap error', $a[0] === 201 && $b[0] === 200 && $b[1]['already_applied'] === true && $b[1]['leave']['id'] === $a[1]['leave']['id'], json_encode($b));
check('another person cannot reuse the key', $leave('pat', ['start_date' => '2031-01-01', 'end_date' => '2031-01-02', 'client_event_id' => $cid])[1]['error']['code'] === 'client_event_conflict');
check('the idempotency key is never exposed', !array_key_exists('client_event_id', $a[1]['leave']));

// ---- leave: reading ---------------------------------------------------------------------------------------------------
check('a person lists only their own', array_unique(array_column(call($api, 'sam', 'GET', "/orgs/$org/leave")[1]['leave'], 'staff_profile_id')) === [$staff['sam']]);
check('and cannot ask for a colleague\'s', array_unique(array_column(call($api, 'sam', 'GET', "/orgs/$org/leave?staff_profile_id={$staff['pat']}")[1]['leave'], 'staff_profile_id')) === [$staff['sam']]);
check('a manager lists everyone\'s and can filter by status and window', count(array_unique(array_column(call($api, 'mark', 'GET', "/orgs/$org/leave")[1]['leave'], 'staff_profile_id'))) === 2 && count(call($api, 'mark', 'GET', "/orgs/$org/leave?from=2030-07-01&to=2030-07-31")[1]['leave']) === 2 && call($api, 'mark', 'GET', "/orgs/$org/leave?status=approved")[1]['leave'] === []);

// ---- leave: deciding and cancelling -------------------------------------------------------------------------------------
check('staff cannot decide', call($api, 'pat', 'POST', "/orgs/$org/leave/$l1/review", ['status' => 'approved'])[0] === 403);
check('a decision must be approved or rejected', call($api, 'mark', 'POST', "/orgs/$org/leave/$l1/review", ['status' => 'maybe'])[0] === 422);
[$s, $r] = call($api, 'mark', 'POST', "/orgs/$org/leave/$l1/review", ['status' => 'approved']);
check('a manager approves, recording who and when', $s === 200 && $r['leave']['status'] === 'approved' && $r['leave']['reviewed_by'] !== null && $r['leave']['reviewed_at'] !== null, json_encode($r));
check('a request is decided once', call($api, 'mark', 'POST', "/orgs/$org/leave/$l1/review", ['status' => 'rejected'])[1]['error']['code'] === 'already_decided');
check('an approved booking still blocks overlapping requests', $leave('sam', ['start_date' => '2030-06-12', 'end_date' => '2030-06-12'])[1]['error']['code'] === 'leave_overlap');
check('a colleague cannot cancel it', call($api, 'pat', 'POST', "/orgs/$org/leave/$l1/cancel")[0] === 403);
check('the person can withdraw an approved request', call($api, 'sam', 'POST', "/orgs/$org/leave/$l1/cancel")[1]['leave']['status'] === 'cancelled');
check('and the days are free again', $leave('sam', ['start_date' => '2030-06-12', 'end_date' => '2030-06-12'])[0] === 201);
check('a cancelled request cannot be cancelled again', call($api, 'sam', 'POST', "/orgs/$org/leave/$l1/cancel")[1]['error']['code'] === 'cannot_cancel');
$rej = $leave('pat', ['start_date' => '2030-11-01', 'end_date' => '2030-11-02'])[1]['leave']['id'];
call($api, 'mark', 'POST', "/orgs/$org/leave/$rej/review", ['status' => 'rejected']);
check('a rejected request frees its days and cannot be cancelled', $leave('pat', ['start_date' => '2030-11-01', 'end_date' => '2030-11-02'])[0] === 201 && call($api, 'pat', 'POST', "/orgs/$org/leave/$rej/cancel")[0] === 409);
check('a stranger gets 404 deciding or cancelling', call($api, 'zed', 'POST', "/orgs/$org/leave/$l1/review", ['status' => 'approved'])[0] === 404 && call($api, 'zed', 'POST', "/orgs/$org/leave/$l1/cancel")[0] === 404);
check('another organisation\'s manager cannot decide through their own org', call($api, 'zed', 'POST', "/orgs/$other/leave/$l1/review", ['status' => 'approved'])[0] === 404);
$pdo->prepare("UPDATE organisations SET status = 'suspended' WHERE id = ?")->execute([$org]);
check('a suspended organisation refuses leave writes', $leave('sam', ['start_date' => '2031-02-01', 'end_date' => '2031-02-02'])[1]['error']['code'] === 'org_not_active');
$pdo->prepare("UPDATE organisations SET status = 'active' WHERE id = ?")->execute([$org]);

// ---- overtime ------------------------------------------------------------------------------------------------------------
$ot = static fn (string $who, array $b) => call($GLOBALS['api'], $who, 'POST', "/orgs/{$GLOBALS['org']}/overtime", $b);
[$s, $r] = $ot('sam', ['date' => '2030-05-06', 'hours' => 2.5, 'note' => 'Stayed for handover']);
check('a person claims overtime', $s === 201 && $r['overtime']['hours'] === 2.5 && $r['overtime']['status'] === 'pending', json_encode($r));
$o1 = $r['overtime']['id'];
foreach ([['date' => '2030-05-06', 'hours' => 0], ['date' => '2030-05-06', 'hours' => 25], ['date' => '2030-05-06'], ['hours' => 1], ['date' => '2030-05-06', 'hours' => 'lots']] as $i => $bad) {
    check("a bad overtime claim is 422 ($i)", $ot('sam', $bad)[0] === 422);
}
check('a person cannot claim for a colleague', $ot('sam', ['staff_profile_id' => $staff['pat'], 'date' => '2030-05-06', 'hours' => 1])[0] === 403 && $ot('mark', ['staff_profile_id' => $staff['pat'], 'date' => '2030-05-06', 'hours' => 1])[0] === 201);
check('a person lists only their own claims', array_unique(array_column(call($api, 'sam', 'GET', "/orgs/$org/overtime")[1]['overtime'], 'staff_profile_id')) === [$staff['sam']]);
check('staff cannot decide a claim', call($api, 'pat', 'POST', "/orgs/$org/overtime/$o1/review", ['status' => 'approved'])[0] === 403);
check('a manager approves once', call($api, 'mark', 'POST', "/orgs/$org/overtime/$o1/review", ['status' => 'approved'])[1]['overtime']['status'] === 'approved' && call($api, 'mark', 'POST', "/orgs/$org/overtime/$o1/review", ['status' => 'rejected'])[1]['error']['code'] === 'already_decided');
check('a decided claim cannot be withdrawn', call($api, 'sam', 'POST', "/orgs/$org/overtime/$o1/cancel")[1]['error']['code'] === 'cannot_cancel');
$o2 = $ot('sam', ['date' => '2030-05-07', 'hours' => 1])[1]['overtime']['id'];
check('a pending claim can be withdrawn by its owner only', call($api, 'pat', 'POST', "/orgs/$org/overtime/$o2/cancel")[0] === 403 && call($api, 'sam', 'POST', "/orgs/$org/overtime/$o2/cancel")[1]['overtime']['status'] === 'cancelled');

// ---- evidence ---------------------------------------------------------------------------------------------------------
$day = '2030-05-06';
$rota = call($api, 'mark', 'POST', "/orgs/$org/rotas", ['name' => 'R', 'period_start' => $day, 'period_end' => '2030-05-12'])[1]['rota']['id'];
call($api, 'mark', 'POST', "/orgs/$org/shifts", ['rota_id' => $rota, 'staff_profile_id' => $staff['sam'], 'starts_at' => "{$day}T08:00:00Z", 'ends_at' => "{$day}T16:00:00Z", 'break_minutes' => 30, 'status' => 'assigned']);
foreach ([['in', "{$day}T08:00:00Z"], ['out', "{$day}T10:00:00Z"], ['in', "{$day}T11:00:00Z"]] as [$t, $at]) {
    call($api, 'mark', 'POST', "/orgs/$org/clock-events", ['type' => $t, 'staff_profile_id' => $staff['sam'], 'event_at' => $at]);
}
[$s, $r] = call($api, 'mark', 'GET', "/orgs/$org/overtime/evidence?staff_profile_id={$staff['sam']}&date=$day");
check('evidence: scheduled minutes less the break, worked minutes from paired in and out, and a forgotten clock-out counted', $s === 200 && $r === ['scheduled_minutes' => 450, 'worked_minutes' => 120, 'unpaired_events' => 1], json_encode($r));
check('the person can see their own evidence', call($api, 'sam', 'GET', "/orgs/$org/overtime/evidence?date=$day")[1]['worked_minutes'] === 120);
check('a colleague cannot see it (the old function let any member)', call($api, 'pat', 'GET', "/orgs/$org/overtime/evidence?staff_profile_id={$staff['sam']}&date=$day")[0] === 403);
check('a stranger gets 404 and a missing date is 422', call($api, 'zed', 'GET', "/orgs/$org/overtime/evidence?date=$day")[0] === 404 && call($api, 'mark', 'GET', "/orgs/$org/overtime/evidence?staff_profile_id={$staff['sam']}")[0] === 422);

// ---- attention badges ----------------------------------------------------------------------------------------------------
[, $r] = call($api, 'mark', 'GET', "/orgs/$org/attention");
check('a manager\'s badge counts are the requests waiting', $r['leave_pending'] >= 3 && $r['overtime_pending'] === 1 && $r['swaps_pending'] === 0, json_encode($r));
// Local-live walk (31 Oct 2026): the sidebar polls this on every page for everyone. On Supabase RLS scoped the same count to the
// caller ("your pending requests" for staff), so staff get their own counts, never a 403 and never the organisation's.
$own = static function (string $sql, string $sid) use ($pdo, $org): int {
    $q = $pdo->prepare($sql);
    $q->execute([$org, $sid]);
    return (int) $q->fetchColumn();
};
[$s, $r] = call($api, 'sam', 'GET', "/orgs/$org/attention");
check('staff read their own badge counts, not the organisation\'s', $s === 200
    && $r['leave_pending'] === $own("SELECT COUNT(*) FROM leave_requests WHERE org_id = ? AND staff_profile_id = ? AND status = 'pending'", $staff['sam'])
    && $r['overtime_pending'] === $own("SELECT COUNT(*) FROM overtime_requests WHERE org_id = ? AND staff_profile_id = ? AND status = 'pending'", $staff['sam'])
    && $r['leave_pending'] < (int) $pdo->query("SELECT COUNT(*) FROM leave_requests WHERE status = 'pending'")->fetchColumn(), json_encode($r));
check('a member with no staff record reads zeros', call($api, 'nora', 'GET', "/orgs/$org/attention")[1] === ['leave_pending' => 0, 'overtime_pending' => 0, 'swaps_pending' => 0]);
check('a stranger still gets 404', call($api, 'zed', 'GET', "/orgs/$org/attention")[0] === 404);

// Four eyes (audit): a manager does not decide their own request; the owner may.
[$s0, $r0] = $leave('mark', ['start_date' => '2031-02-02', 'end_date' => '2031-02-03']);
$own = $r0['leave']['id'] ?? '';
check('a manager cannot approve their own leave', $s0 === 201 && call($api, 'mark', 'POST', "/orgs/$org/leave/$own/review", ['status' => 'approved'])[1]['error']['code'] === 'own_leave');
check('the owner can approve it', call($api, 'olga', 'POST', "/orgs/$org/leave/$own/review", ['status' => 'approved'])[0] === 200);

