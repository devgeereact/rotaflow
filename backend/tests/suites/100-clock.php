<?php
declare(strict_types=1);

// Clock events: what the server decides, idempotent replays, double clock-in, corrections.
use RotaFlow\Db;

$api = test_api($pdo);
$org = call($api, 'olga', 'POST', '/orgs', ['name' => 'Clock Org'])[1]['org']['id'];
$other = call($api, 'zed', 'POST', '/orgs', ['name' => 'Elsewhere'])[1]['org']['id'];
$staff = [];
foreach (['mark' => 'manager', 'sam' => 'staff', 'pat' => 'staff', 'nora' => 'staff'] as $name => $role) {
    call($api, $name, 'GET', '/me');
    $pdo->prepare("INSERT INTO memberships (id, org_id, user_id, role, status) SELECT ?, ?, id, ?, 'active' FROM users WHERE email = ?")->execute([Db::uuid(), $org, $role, "$name@example.test"]);
    if ($name !== 'nora') { // nora is a member with no staff record
        $staff[$name] = call($api, 'olga', 'POST', "/orgs/$org/staff", ['first_name' => ucfirst($name), 'email' => "$name@example.test"])[1]['id'];
    }
}
$zStaff = call($api, 'zed', 'POST', "/orgs/$other/staff", ['first_name' => 'Zoe'])[1]['id'];
$iso = static fn (int $offset): string => gmdate('Y-m-d\TH:i:s\Z', time() + $offset);
$uuid4 = static fn (): string => Db::uuid();

// ---- recording ---------------------------------------------------------------------------------------------
[$s, $r] = call($api, 'sam', 'POST', "/orgs/$org/clock-events", ['type' => 'in', 'method' => 'gps', 'latitude' => 51.5, 'longitude' => -0.12, 'accuracy' => 12.5, 'location_name' => 'Oak House']);
check('a person clocks in; the server supplies the time', $s === 201 && $r['clock_event']['type'] === 'in' && $r['clock_event']['staff_profile_id'] === $staff['sam'] && abs(strtotime($r['clock_event']['event_at']) - time()) < 5 && $r['already_applied'] === false, json_encode($r));
check('no reported time is kept when none was submitted', $r['clock_event']['event_at_reported'] === null);
check('the position is stored, not enforced against any geofence', $r['clock_event']['latitude'] === 51.5 && $r['clock_event']['method'] === 'gps');
[$s, $r] = call($api, 'sam', 'POST', "/orgs/$org/clock-events", ['type' => 'in']);
check('clocking in again straight away is refused', $s === 409 && $r['error']['code'] === 'already_clocked_in', json_encode($r));
check('clocking out is fine', call($api, 'sam', 'POST', "/orgs/$org/clock-events", ['type' => 'out'])[0] === 201);
check('and so is clocking in after that', call($api, 'sam', 'POST', "/orgs/$org/clock-events", ['type' => 'in'])[0] === 201);

// the server decides the time
[, $r] = call($api, 'pat', 'POST', "/orgs/$org/clock-events", ['type' => 'in', 'event_at' => $iso(-3600)]);
check('a time within the last 72 hours is accepted (an offline queue can replay late)', substr($r['clock_event']['event_at'], 0, 16) === substr($iso(-3600), 0, 16) && $r['clock_event']['event_at_reported'] === null, json_encode($r));
[, $r] = call($api, 'nora', 'POST', "/orgs/$org/clock-events", ['type' => 'in']);
check('a member with no staff record cannot clock', call($api, 'nora', 'POST', "/orgs/$org/clock-events", ['type' => 'in'])[1]['error']['code'] === 'no_staff_record');
foreach (['an hour in the future' => 3600, 'four days ago' => -4 * 86400] as $label => $off) {
    $r = call($api, 'sam', 'POST', "/orgs/$org/clock-events", ['type' => 'out', 'event_at' => $iso($off)])[1]['clock_event'];
    check("a person's time $label is replaced by the server's, and the claim is kept", abs(strtotime($r['event_at']) - time()) < 5 && substr((string) $r['event_at_reported'], 0, 16) === substr($iso($off), 0, 16), json_encode($r));
}
check('a time with no offset is refused', call($api, 'sam', 'POST', "/orgs/$org/clock-events", ['type' => 'out', 'event_at' => '2026-01-01T09:00:00'])[0] === 422);
[, $r] = call($api, 'mark', 'POST', "/orgs/$org/clock-events", ['type' => 'in', 'staff_profile_id' => $staff['pat'], 'event_at' => $iso(-10 * 86400)]);
check('a manager records any time for anyone', substr($r['clock_event']['event_at'], 0, 16) === substr($iso(-10 * 86400), 0, 16) && $r['clock_event']['staff_profile_id'] === $staff['pat'] && $r['clock_event']['event_at_reported'] === null);
check('staff cannot record for a colleague', call($api, 'sam', 'POST', "/orgs/$org/clock-events", ['type' => 'in', 'staff_profile_id' => $staff['pat']])[0] === 403);
check('nor for someone in another organisation', call($api, 'mark', 'POST', "/orgs/$org/clock-events", ['type' => 'in', 'staff_profile_id' => $zStaff])[0] === 422);
foreach ([['type' => 'dance'], ['type' => 'in', 'method' => 'telepathy'], ['type' => 'in', 'latitude' => 51.5], ['type' => 'in', 'latitude' => 95, 'longitude' => 0], ['type' => 'in', 'client_event_id' => 'nope'], ['type' => 'in', 'shift_id' => $uuid4()]] as $i => $bad) {
    check("a bad clock event is 422 ($i)", call($api, 'pat', 'POST', "/orgs/$org/clock-events", $bad)[0] === 422);
}
check('a stranger gets 404', call($api, 'zed', 'POST', "/orgs/$org/clock-events", ['type' => 'in'])[0] === 404);
$old = call($api, 'mark', 'POST', "/orgs/$org/clock-events", ['type' => 'in', 'staff_profile_id' => $staff['pat'], 'event_at' => $iso(-20 * 86400)])[1]['clock_event'];
check('a manager may clock someone in twice in a row (corrections of a record)', call($api, 'mark', 'POST', "/orgs/$org/clock-events", ['type' => 'in', 'staff_profile_id' => $staff['pat'], 'event_at' => $iso(-20 * 86400 + 60)])[0] === 201);

// ---- replay (offline queue) ------------------------------------------------------------------------------------------
$cid = $uuid4();
[$s, $r] = call($api, 'pat', 'POST', "/orgs/$org/clock-events", ['type' => 'out', 'client_event_id' => $cid]);
$first = $r['clock_event']['id'];
check('a first attempt with a client id creates the event', $s === 201);
[$s, $r] = call($api, 'pat', 'POST', "/orgs/$org/clock-events", ['type' => 'out', 'client_event_id' => $cid]);
check('replaying it answers 200 already_applied with the same record', $s === 200 && $r['already_applied'] === true && $r['clock_event']['id'] === $first, json_encode($r));
check('and created no second row', (int) $pdo->query("SELECT COUNT(*) FROM clock_events WHERE client_event_id = '$cid'")->fetchColumn() === 1);
check('a replay of an "in" is not refused as a double clock-in', (function () use ($api, $org, $uuid4): bool { $c = $uuid4(); call($api, 'pat', 'POST', "/orgs/$org/clock-events", ['type' => 'in', 'client_event_id' => $c]); return call($api, 'pat', 'POST', "/orgs/$org/clock-events", ['type' => 'in', 'client_event_id' => $c])[0] === 200; })());
[$s, $r] = call($api, 'sam', 'POST', "/orgs/$org/clock-events", ['type' => 'out', 'client_event_id' => $cid]);
check('another person using the same client id is refused, not given the first person\'s record', $s === 409 && $r['error']['code'] === 'client_event_conflict', json_encode($r));

// ---- reading ---------------------------------------------------------------------------------------------------------
[, $r] = call($api, 'sam', 'GET', "/orgs/$org/clock-events");
check('a person reads only their own events', count($r['clock_events']) >= 4 && array_unique(array_column($r['clock_events'], 'staff_profile_id')) === [$staff['sam']]);
check('and cannot ask for a colleague\'s', array_unique(array_column(call($api, 'sam', 'GET', "/orgs/$org/clock-events?staff_profile_id={$staff['pat']}")[1]['clock_events'], 'staff_profile_id')) === [$staff['sam']]);
check('a manager reads anyone\'s, or filters to one person', count(array_unique(array_column(call($api, 'mark', 'GET', "/orgs/$org/clock-events")[1]['clock_events'], 'staff_profile_id'))) >= 2 && array_unique(array_column(call($api, 'mark', 'GET', "/orgs/$org/clock-events?staff_profile_id={$staff['pat']}")[1]['clock_events'], 'staff_profile_id')) === [$staff['pat']]);
check('latest=1 returns the most recent event only', count(call($api, 'sam', 'GET', "/orgs/$org/clock-events?latest=1")[1]['clock_events']) === 1);
check('a time window narrows the list', count(call($api, 'mark', 'GET', "/orgs/$org/clock-events?staff_profile_id={$staff['pat']}&from=" . urlencode($iso(-25 * 86400)) . '&to=' . urlencode($iso(-15 * 86400)))[1]['clock_events']) === 2);
check('a member with no staff record sees nothing', call($api, 'nora', 'GET', "/orgs/$org/clock-events")[1]['clock_events'] === []);
check('a stranger gets 404', call($api, 'zed', 'GET', "/orgs/$org/clock-events")[0] === 404);

// ---- corrections ------------------------------------------------------------------------------------------------------
$ev = $old['id'];
$ts = Db::uuid();
$day = substr($old['event_at'], 0, 10);
$pdo->prepare("INSERT INTO timesheets (id, org_id, staff_profile_id, period_start, period_end, total_minutes, status) VALUES (?, ?, ?, ?, ?, 480, 'approved')")->execute([$ts, $org, $staff['pat'], gmdate('Y-m-d', strtotime($day) - 3 * 86400), gmdate('Y-m-d', strtotime($day) + 3 * 86400)]);
check('staff cannot correct an event', call($api, 'pat', 'POST', "/orgs/$org/clock-events/$ev/correct", ['reason' => 'because', 'type' => 'out'])[0] === 403);
check('a correction needs a reason', call($api, 'mark', 'POST', "/orgs/$org/clock-events/$ev/correct", ['type' => 'out'])[1]['error']['code'] === 'reason_required' && call($api, 'mark', 'POST', "/orgs/$org/clock-events/$ev/correct", ['reason' => 'ab', 'type' => 'out'])[0] === 422);
check('an unknown type is 422', call($api, 'mark', 'POST', "/orgs/$org/clock-events/$ev/correct", ['reason' => 'fixing it', 'type' => 'dance'])[0] === 422);
check('a stale edit is refused', call($api, 'mark', 'POST', "/orgs/$org/clock-events/$ev/correct", ['reason' => 'fixing it', 'type' => 'out', 'expected_updated_at' => '2020-01-01T00:00:00Z'])[1]['error']['code'] === 'record_changed');
[$s, $r] = call($api, 'mark', 'POST', "/orgs/$org/clock-events/$ev/correct", ['reason' => 'Forgot to clock out', 'type' => 'out', 'expected_updated_at' => $old['updated_at']]);
check('a manager corrects an event', $s === 200 && $r['clock_event']['type'] === 'out', json_encode($r));
[, $r] = call($api, 'mark', 'GET', "/orgs/$org/clock-events/$ev/corrections");
check('the correction keeps before, after, who and why', count($r['corrections']) === 1 && $r['corrections'][0]['before_value']['type'] === 'in' && $r['corrections'][0]['after_value']['type'] === 'out' && $r['corrections'][0]['reason'] === 'Forgot to clock out' && $r['corrections'][0]['actor_name'] !== null, json_encode($r));
check('an approved timesheet covering that day is flagged for recalculation', $pdo->query("SELECT recalculation_required_at IS NOT NULL FROM timesheets WHERE id = '$ts'")->fetchColumn() == 1);
check('staff cannot read corrections', call($api, 'pat', 'GET', "/orgs/$org/clock-events/$ev/corrections")[0] === 403);
foreach (["UPDATE clock_event_corrections SET reason = 'x'", 'DELETE FROM clock_event_corrections'] as $sql) {
    try { $pdo->exec($sql); check("corrections refuse: $sql", false); } catch (PDOException) { check("corrections refuse: $sql", true); }
}
check('a stranger cannot correct my event', call($api, 'zed', 'POST', "/orgs/$org/clock-events/$ev/correct", ['reason' => 'hijack', 'type' => 'in'])[0] === 404);

// ---- deleting -----------------------------------------------------------------------------------------------------------
check('staff cannot delete an event', call($api, 'sam', 'POST', "/orgs/$org/clock-events/$first/delete")[0] === 403 || call($api, 'pat', 'POST', "/orgs/$org/clock-events/$first/delete")[0] === 403);
check('a manager can, once', call($api, 'mark', 'POST', "/orgs/$org/clock-events/$first/delete")[0] === 200 && call($api, 'mark', 'POST', "/orgs/$org/clock-events/$first/delete")[0] === 404);
check('corrections and deletions are audited', (int) $pdo->query("SELECT COUNT(*) FROM audit_logs WHERE org_id = '$org' AND action IN ('clock_event.corrected','clock_event.deleted')")->fetchColumn() === 2);
