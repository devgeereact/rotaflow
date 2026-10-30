<?php
declare(strict_types=1);

// Shifts (validation, visibility, queries), shift types, availability and minimum cover.
use RotaFlow\Db;

$api = test_api($pdo);
$org = call($api, 'olga', 'POST', '/orgs', ['name' => 'Shift Org'])[1]['org']['id'];
$other = call($api, 'zed', 'POST', '/orgs', ['name' => 'Elsewhere'])[1]['org']['id'];
$staff = [];
foreach (['mark' => 'manager', 'sam' => 'staff', 'pat' => 'staff'] as $name => $role) {
    call($api, $name, 'GET', '/me');
    $pdo->prepare("INSERT INTO memberships (id, org_id, user_id, role, status) SELECT ?, ?, id, ?, 'active' FROM users WHERE email = ?")->execute([Db::uuid(), $org, $role, "$name@example.test"]);
    $staff[$name] = call($api, 'olga', 'POST', "/orgs/$org/staff", ['first_name' => ucfirst($name), 'email' => "$name@example.test"])[1]['id'];
}
$site = call($api, 'olga', 'POST', "/orgs/$org/locations", ['name' => 'Oak'])[1]['id'];
$site2 = call($api, 'olga', 'POST', "/orgs/$org/locations", ['name' => 'Elm'])[1]['id'];
$zSite = call($api, 'zed', 'POST', "/orgs/$other/locations", ['name' => 'Z'])[1]['id'];
$zStaff = call($api, 'zed', 'POST', "/orgs/$other/staff", ['first_name' => 'Zoe'])[1]['id'];
$zType = call($api, 'zed', 'POST', "/orgs/$other/shift-types", ['name' => 'Z type'])[1]['id'];
$draft = call($api, 'mark', 'POST', "/orgs/$org/rotas", ['name' => 'D', 'period_start' => '2029-06-04', 'period_end' => '2029-06-10', 'location_id' => $site])[1]['rota']['id'];
$draft2 = call($api, 'mark', 'POST', "/orgs/$org/rotas", ['name' => 'D2', 'period_start' => '2029-06-11', 'period_end' => '2029-06-17', 'location_id' => $site])[1]['rota']['id'];
$pub = call($api, 'mark', 'POST', "/orgs/$org/rotas", ['name' => 'P', 'period_start' => '2029-07-02', 'period_end' => '2029-07-08', 'location_id' => $site])[1]['rota']['id'];
$mk = static fn (array $over = []): array => array_replace(['rota_id' => $GLOBALS['draft'], 'location_id' => $GLOBALS['site'], 'staff_profile_id' => $GLOBALS['staff']['sam'], 'starts_at' => '2029-06-04T09:00:00+01:00', 'ends_at' => '2029-06-04T17:00:00+01:00', 'status' => 'assigned', 'break_minutes' => 30], $over);

// ---- creating -------------------------------------------------------------------------------------------------
[$s, $r] = call($api, 'mark', 'POST', "/orgs/$org/shifts", $mk());
check('a manager creates a shift', $s === 201 && $r['shift']['staff_profile_id'] === $staff['sam'] && $r['shift']['break_minutes'] === 30, json_encode($r));
check('times are stored in UTC and returned as ISO with Z', $r['shift']['starts_at'] === '2029-06-04T08:00:00Z' && $r['shift']['ends_at'] === '2029-06-04T16:00:00Z', json_encode($r['shift']));
check('the shift says which rota state it is in', $r['shift']['rota'] === ['status' => 'draft', 'supersedes_rota_id' => null]);
$s1 = $r['shift']['id'];
check('staff cannot create', call($api, 'sam', 'POST', "/orgs/$org/shifts", $mk())[0] === 403);
check('a stranger gets 404', call($api, 'zed', 'POST', "/orgs/$org/shifts", $mk())[0] === 404);
foreach ([
    'a time with no offset' => ['starts_at' => '2029-06-04T09:00:00'],
    'a nonsense time' => ['starts_at' => 'tomorrow'],
    'an end before the start' => ['ends_at' => '2029-06-04T07:00:00Z'],
    'a negative break' => ['break_minutes' => -5],
    'a fractional break' => ['break_minutes' => 10.5],
    'an unknown status' => ['status' => 'maybe'],
    'a bad colour' => ['colour' => '<script>'],
    'overlong notes' => ['notes' => str_repeat('x', 1001)],
    'staff from another organisation' => ['staff_profile_id' => $zStaff],
    'a site from another organisation' => ['location_id' => $zSite],
    'a rota from another organisation' => ['rota_id' => $pub . 'x'],
    'a shift type from another organisation' => ['shift_type_id' => $zType],
    'an array where text belongs' => ['notes' => ['a']],
] as $label => $over) {
    check("$label is 422", call($api, 'mark', 'POST', "/orgs/$org/shifts", $mk($over))[0] === 422, $label);
}
check('start and end are required', call($api, 'mark', 'POST', "/orgs/$org/shifts", ['rota_id' => $draft])[0] === 422);

// batch is all or nothing
$before = (int) $pdo->query("SELECT COUNT(*) FROM shifts WHERE org_id = '$org'")->fetchColumn();
check('a batch with one bad shift inserts nothing', call($api, 'mark', 'POST', "/orgs/$org/shifts/batch", ['shifts' => [$mk(), $mk(['status' => 'maybe']), $mk()]])[0] === 422 && (int) $pdo->query("SELECT COUNT(*) FROM shifts WHERE org_id = '$org'")->fetchColumn() === $before);
check('a good batch inserts them all', count(call($api, 'mark', 'POST', "/orgs/$org/shifts/batch", ['shifts' => [$mk(['starts_at' => '2029-06-05T09:00:00Z', 'ends_at' => '2029-06-05T17:00:00Z']), $mk(['starts_at' => '2029-06-06T09:00:00Z', 'ends_at' => '2029-06-06T17:00:00Z', 'staff_profile_id' => $staff['pat']])]])[1]['ids']) === 2);
check('an empty or oversized batch is 422', call($api, 'mark', 'POST', "/orgs/$org/shifts/batch", ['shifts' => []])[0] === 422 && call($api, 'mark', 'POST', "/orgs/$org/shifts/batch", ['shifts' => array_fill(0, 501, $mk())])[0] === 422);
check('a batch with a published rota inserts nothing', (function () use ($api, $org, $mk, $pub, $pdo, $before): bool { call($api, 'mark', 'POST', "/orgs/$org/rotas/$pub/publish"); $b = (int) $pdo->query("SELECT COUNT(*) FROM shifts WHERE org_id = '$org'")->fetchColumn(); $s = call($api, 'mark', 'POST', "/orgs/$org/shifts/batch", ['shifts' => [$mk(), $mk(['rota_id' => $pub])]])[0]; return $s === 409 && (int) $pdo->query("SELECT COUNT(*) FROM shifts WHERE org_id = '$org'")->fetchColumn() === $b; })());

// ---- updating, moving, deleting ----------------------------------------------------------------------------------
check('a manager edits a shift', call($api, 'mark', 'POST', "/orgs/$org/shifts/$s1", ['notes' => 'Handover at 9', 'status' => 'confirmed'])[1]['shift']['notes'] === 'Handover at 9');
check('moving the end before the start is 422', call($api, 'mark', 'POST', "/orgs/$org/shifts/$s1", ['ends_at' => '2029-06-04T01:00:00Z'])[0] === 422);
check('a shift moves between two drafts', call($api, 'mark', 'POST', "/orgs/$org/shifts/$s1", ['rota_id' => $draft2])[0] === 200);
check('but not into a published rota', call($api, 'mark', 'POST', "/orgs/$org/shifts/$s1", ['rota_id' => $pub])[1]['error']['code'] === 'rota_published');
check('staff cannot edit', call($api, 'sam', 'POST', "/orgs/$org/shifts/$s1", ['notes' => 'x'])[0] === 403);
check('a shift id from another organisation is 404', call($api, 'mark', 'POST', "/orgs/$org/shifts/" . $pdo->query("SELECT id FROM shifts WHERE 1 LIMIT 1")->fetchColumn() . 'x', ['notes' => 'x'])[0] === 404);
$loose = call($api, 'mark', 'POST', "/orgs/$org/shifts", ['location_id' => $site, 'starts_at' => '2029-06-20T09:00:00Z', 'ends_at' => '2029-06-20T17:00:00Z'])[1]['shift'];
check('a loose shift (no rota) is allowed, defaults to open, and stays editable', $loose['rota'] === null && $loose['status'] === 'open' && call($api, 'mark', 'POST', "/orgs/$org/shifts/{$loose['id']}", ['staff_profile_id' => $staff['pat'], 'status' => 'assigned'])[0] === 200);
check('a shift can be deleted from a draft', call($api, 'mark', 'POST', "/orgs/$org/shifts/$s1/delete")[0] === 200 && call($api, 'mark', 'POST', "/orgs/$org/shifts/$s1/delete")[0] === 404);
try { $pdo->prepare("INSERT INTO shifts (id, org_id, starts_at, ends_at) VALUES (?, ?, '2029-06-04 10:00:00', '2029-06-04 09:00:00')")->execute([Db::uuid(), $org]); check('the database refuses an end before a start', false); }
catch (PDOException) { check('the database refuses an end before a start', true); }

// ---- reading ----------------------------------------------------------------------------------------------------------
call($api, 'mark', 'POST', "/orgs/$org/shifts", ['rota_id' => $pub, 'location_id' => $site, 'staff_profile_id' => $staff['sam'], 'starts_at' => '2029-07-02T09:00:00Z', 'ends_at' => '2029-07-02T17:00:00Z', 'status' => 'assigned']) ; // refused: published
$pdo->prepare("UPDATE rotas SET status = 'draft' WHERE id = ?")->execute([$pub]);
call($api, 'mark', 'POST', "/orgs/$org/shifts/batch", ['shifts' => [
    ['rota_id' => $pub, 'location_id' => $site, 'staff_profile_id' => $staff['sam'], 'starts_at' => '2029-07-02T09:00:00Z', 'ends_at' => '2029-07-02T17:00:00Z', 'status' => 'assigned'],
    ['rota_id' => $pub, 'location_id' => $site, 'staff_profile_id' => $staff['pat'], 'starts_at' => '2029-07-02T22:00:00Z', 'ends_at' => '2029-07-03T06:00:00Z', 'status' => 'assigned'],
    ['rota_id' => $pub, 'location_id' => $site, 'staff_profile_id' => $staff['pat'], 'starts_at' => '2029-07-04T09:00:00Z', 'ends_at' => '2029-07-04T17:00:00Z', 'status' => 'cancelled'],
]]);
call($api, 'mark', 'POST', "/orgs/$org/rotas/$pub/publish");
[, $r] = call($api, 'sam', 'GET', "/orgs/$org/shifts?rota_ids=$pub,$draft2");
check('staff read the shifts of a published rota (cancelled included when asking by rota) and nothing from drafts', count($r['shifts']) === 3 && array_unique(array_column(array_column($r['shifts'], 'rota'), 'status')) === ['published']);
check('a manager reads drafts too', count(call($api, 'mark', 'GET', "/orgs/$org/shifts?rota_ids=$draft")[1]['shifts']) >= 1 && call($api, 'sam', 'GET', "/orgs/$org/shifts?rota_ids=$draft")[1]['shifts'] === []);
check('loose shifts are readable by every member', in_array($loose['id'], array_column(call($api, 'sam', 'GET', "/orgs/$org/shifts?from=2029-06-20T00:00:00Z&to=2029-06-21T00:00:00Z")[1]['shifts'], 'id'), true));
[, $r] = call($api, 'sam', 'GET', "/orgs/$org/shifts?from=2029-07-02T00:00:00Z&to=2029-07-03T00:00:00Z");
check('a window query returns shifts that START in it, in time order, cancelled excluded', array_column($r['shifts'], 'starts_at') === ['2029-07-02T09:00:00Z', '2029-07-02T22:00:00Z'], json_encode(array_column($r['shifts'], 'starts_at')));
[, $r] = call($api, 'sam', 'GET', "/orgs/$org/shifts?from=2029-07-03T01:00:00Z&to=2029-07-03T03:00:00Z");
check('a window at 01:00 to 03:00 does not return last night\'s shift by start time', $r['shifts'] === []);
[, $r] = call($api, 'sam', 'GET', "/orgs/$org/shifts?from=2029-07-03T01:00:00Z&to=2029-07-03T03:00:00Z&overlapping=1");
check('but the overlapping query does (who is working now)', count($r['shifts']) === 1 && $r['shifts'][0]['staff_profile_id'] === $staff['pat']);
check('filters by person and by site', count(call($api, 'sam', 'GET', "/orgs/$org/shifts?from=2029-07-01T00:00:00Z&to=2029-07-09T00:00:00Z&staff_profile_id={$staff['sam']}")[1]['shifts']) === 1 && call($api, 'sam', 'GET', "/orgs/$org/shifts?from=2029-07-01T00:00:00Z&to=2029-07-09T00:00:00Z&location_id=$site2")[1]['shifts'] === []);
check('a query needs rota_ids or a window', call($api, 'sam', 'GET', "/orgs/$org/shifts")[0] === 422);
check('a malformed rota id list is 422', call($api, 'sam', 'GET', "/orgs/$org/shifts?rota_ids=nope")[0] === 422);
check('a stranger gets 404 reading', call($api, 'zed', 'GET', "/orgs/$org/shifts?rota_ids=$pub")[0] === 404);
check('shifts of another organisation are never returned', call($api, 'zed', 'GET', "/orgs/$other/shifts?rota_ids=$pub")[1]['shifts'] === []);

// ---- shift types -----------------------------------------------------------------------------------------------------
[$s, $r] = call($api, 'mark', 'POST', "/orgs/$org/shift-types", ['name' => 'Early', 'colour' => '#16a34a', 'default_start' => '07:00', 'default_end' => '15:00', 'category' => 'day']);
check('a manager creates a shift type', $s === 201, json_encode($r));
$early = $r['id'];
check('staff cannot', call($api, 'sam', 'POST', "/orgs/$org/shift-types", ['name' => 'X'])[0] === 403);
check('members read them, with times and the paid flag', call($api, 'sam', 'GET', "/orgs/$org/shift-types")[1]['shift_types'][0]['default_start'] === '07:00:00' && call($api, 'sam', 'GET', "/orgs/$org/shift-types")[1]['shift_types'][0]['is_paid'] === true);
check('a bad time or colour is 422', call($api, 'mark', 'POST', "/orgs/$org/shift-types", ['name' => 'X', 'default_start' => '25:00'])[0] === 422 && call($api, 'mark', 'POST', "/orgs/$org/shift-types", ['name' => 'X', 'colour' => '<b>'])[0] === 422);
check('a shift type is updated', call($api, 'mark', 'POST', "/orgs/$org/shift-types/$early", ['name' => 'Early shift', 'is_paid' => false])[0] === 200 && (int) $pdo->query("SELECT is_paid FROM shift_types WHERE id = '$early'")->fetchColumn() === 0);
check('one from another organisation cannot be updated through mine', call($api, 'mark', 'POST', "/orgs/$org/shift-types/$zType", ['name' => 'Hijack'])[0] === 404);
call($api, 'mark', 'POST', "/orgs/$org/shifts", ['rota_id' => $draft, 'shift_type_id' => $early, 'staff_profile_id' => $staff['sam'], 'starts_at' => '2029-06-08T07:00:00Z', 'ends_at' => '2029-06-08T15:00:00Z']);
check('a shift type in use cannot be deleted', call($api, 'mark', 'POST', "/orgs/$org/shift-types/$early/delete")[1]['error']['code'] === 'shift_type_in_use');
$spare = call($api, 'mark', 'POST', "/orgs/$org/shift-types", ['name' => 'Spare'])[1]['id'];
check('an unused one can', call($api, 'mark', 'POST', "/orgs/$org/shift-types/$spare/delete")[0] === 200);

// ---- deleting places that are in use -----------------------------------------------------------------------------------
check('a location with rotas cannot be deleted', call($api, 'olga', 'POST', "/orgs/$org/locations/$site/delete")[1]['error']['code'] === 'location_in_use');
check('a location with no rotas or shifts can', call($api, 'olga', 'POST', "/orgs/$org/locations/$site2/delete")[0] === 200);

// ---- availability -------------------------------------------------------------------------------------------------------
[$s, $r] = call($api, 'sam', 'POST', "/orgs/$org/availability", ['weekday' => 1, 'start_time' => '09:00', 'end_time' => '17:00', 'status' => 'preferred', 'recurring' => true]);
check('a person sets their own availability', $s === 201, json_encode($r));
$av = $r['id'];
check('a date works too', call($api, 'sam', 'POST', "/orgs/$org/availability", ['date' => '2029-08-01', 'status' => 'unavailable'])[0] === 201);
check('a weekday and a date together are refused, as are neither', call($api, 'sam', 'POST', "/orgs/$org/availability", ['weekday' => 1, 'date' => '2029-08-01'])[0] === 422 && call($api, 'sam', 'POST', "/orgs/$org/availability", ['status' => 'available'])[0] === 422);
check('start and end go together; the weekday has bounds; the status is checked', call($api, 'sam', 'POST', "/orgs/$org/availability", ['weekday' => 2, 'start_time' => '09:00'])[0] === 422 && call($api, 'sam', 'POST', "/orgs/$org/availability", ['weekday' => 9])[0] === 422 && call($api, 'sam', 'POST', "/orgs/$org/availability", ['weekday' => 2, 'status' => 'maybe'])[0] === 422);
check('a person cannot set a colleague\'s availability', call($api, 'sam', 'POST', "/orgs/$org/availability", ['staff_profile_id' => $staff['pat'], 'weekday' => 3])[0] === 403);
check('a manager can set anyone\'s', call($api, 'mark', 'POST', "/orgs/$org/availability", ['staff_profile_id' => $staff['pat'], 'weekday' => 3, 'status' => 'unavailable'])[0] === 201);
check('but not for someone outside the organisation', call($api, 'mark', 'POST', "/orgs/$org/availability", ['staff_profile_id' => $zStaff, 'weekday' => 3])[0] === 422);
check('a person lists only their own', array_unique(array_column(call($api, 'sam', 'GET', "/orgs/$org/availability")[1]['availability'], 'staff_profile_id')) === [$staff['sam']]);
check('and cannot ask for a colleague\'s', array_unique(array_column(call($api, 'sam', 'GET', "/orgs/$org/availability?staff_profile_id={$staff['pat']}")[1]['availability'], 'staff_profile_id')) === [$staff['sam']]);
check('a manager lists everyone\'s, or one person\'s', count(array_unique(array_column(call($api, 'mark', 'GET', "/orgs/$org/availability")[1]['availability'], 'staff_profile_id'))) === 2 && count(call($api, 'mark', 'GET', "/orgs/$org/availability?staff_profile_id={$staff['pat']}")[1]['availability']) === 1);
check('a colleague cannot delete it', call($api, 'pat', 'POST', "/orgs/$org/availability/$av/delete")[0] === 403);
check('its owner can, once', call($api, 'sam', 'POST', "/orgs/$org/availability/$av/delete")[0] === 200 && call($api, 'sam', 'POST', "/orgs/$org/availability/$av/delete")[0] === 404);
check('a stranger gets 404', call($api, 'zed', 'GET', "/orgs/$org/availability")[0] === 404);

// ---- minimum cover ---------------------------------------------------------------------------------------------------------
check('a manager sets a minimum and can change it (one rule per site per weekday)', call($api, 'mark', 'POST', "/orgs/$org/minimum-cover", ['location_id' => $site, 'weekday' => 1, 'min_staff' => 3])[0] === 200 && call($api, 'mark', 'POST', "/orgs/$org/minimum-cover", ['location_id' => $site, 'weekday' => 1, 'min_staff' => 2])[0] === 200 && (int) $pdo->query("SELECT COUNT(*) FROM minimum_cover_rules WHERE location_id = '$site'")->fetchColumn() === 1 && (int) $pdo->query("SELECT min_staff FROM minimum_cover_rules WHERE location_id = '$site'")->fetchColumn() === 2);
check('members read the rules', call($api, 'sam', 'GET', "/orgs/$org/minimum-cover")[1]['rules'][0]['min_staff'] === 2);
check('staff cannot set one', call($api, 'sam', 'POST', "/orgs/$org/minimum-cover", ['location_id' => $site, 'weekday' => 1, 'min_staff' => 0])[0] === 403);
check('a site from another organisation, a bad weekday and a fractional minimum are 422', call($api, 'mark', 'POST', "/orgs/$org/minimum-cover", ['location_id' => $zSite, 'weekday' => 1, 'min_staff' => 1])[0] === 422 && call($api, 'mark', 'POST', "/orgs/$org/minimum-cover", ['location_id' => $site, 'weekday' => 7, 'min_staff' => 1])[0] === 422 && call($api, 'mark', 'POST', "/orgs/$org/minimum-cover", ['location_id' => $site, 'weekday' => 1, 'min_staff' => 1.5])[0] === 422);
