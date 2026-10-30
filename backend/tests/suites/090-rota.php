<?php
declare(strict_types=1);

// The rota lifecycle: draft, publish, amend, discard, unpublish, repeat, and the publish-time cover rule.
use RotaFlow\Db;

$api = test_api($pdo);
$org = call($api, 'olga', 'POST', '/orgs', ['name' => 'Rota Org'])[1]['org']['id'];
$other = call($api, 'zed', 'POST', '/orgs', ['name' => 'Elsewhere'])[1]['org']['id'];
$staffOf = [];
foreach (['mark' => 'manager', 'sam' => 'staff', 'pat' => 'staff'] as $name => $role) {
    call($api, $name, 'GET', '/me');
    $pdo->prepare("INSERT INTO memberships (id, org_id, user_id, role, status) SELECT ?, ?, id, ?, 'active' FROM users WHERE email = ?")->execute([Db::uuid(), $org, $role, "$name@example.test"]);
    $staffOf[$name] = call($api, 'olga', 'POST', "/orgs/$org/staff", ['first_name' => ucfirst($name), 'email' => "$name@example.test"])[1]['id'];
}
$site = call($api, 'olga', 'POST', "/orgs/$org/locations", ['name' => 'Oak House', 'timezone' => 'Europe/London'])[1]['id'];
$site2 = call($api, 'olga', 'POST', "/orgs/$org/locations", ['name' => 'Elm Court'])[1]['id'];
$zSite = call($api, 'zed', 'POST', "/orgs/$other/locations", ['name' => 'Z Site'])[1]['id'];
$shift = static fn (string $rota, string $staff, string $start, string $end, array $more = []) => array_replace(['rota_id' => $rota, 'staff_profile_id' => $staff, 'starts_at' => $start, 'ends_at' => $end, 'status' => 'assigned', 'location_id' => $GLOBALS['site']], $more);
$mkRota = static fn (string $name, string $from, string $to, ?string $loc = null) => call($GLOBALS['api'], 'mark', 'POST', "/orgs/{$GLOBALS['org']}/rotas", ['name' => $name, 'period_start' => $from, 'period_end' => $to, 'location_id' => $loc]);

// ---- creating a draft ------------------------------------------------------------------------------------------
[$s, $r] = $mkRota('Week 1', '2029-01-01', '2029-01-07', $site);
check('a manager creates a draft rota', $s === 201 && $r['rota']['status'] === 'draft' && $r['rota']['period_start'] === '2029-01-01', json_encode($r));
$w1 = $r['rota']['id'];
check('staff cannot create a rota', call($api, 'sam', 'POST', "/orgs/$org/rotas", ['name' => 'X', 'period_start' => '2029-01-01', 'period_end' => '2029-01-07'])[0] === 403);
check('a stranger gets 404', call($api, 'zed', 'POST', "/orgs/$org/rotas", ['name' => 'X', 'period_start' => '2029-01-01', 'period_end' => '2029-01-07'])[0] === 404);
foreach ([['name' => 'X', 'period_start' => '2029-01-07', 'period_end' => '2029-01-01'], ['name' => 'X', 'period_start' => '2029-01-01'], ['name' => 'X', 'period_start' => '2029-01-01', 'period_end' => '2031-01-01'], ['name' => '', 'period_start' => '2029-01-01', 'period_end' => '2029-01-07'], ['name' => 'X', 'period_start' => '2029-02-30', 'period_end' => '2029-03-01']] as $i => $bad) {
    check("a bad rota is 422 ($i)", call($api, 'mark', 'POST', "/orgs/$org/rotas", $bad)[0] === 422);
}
check('a site from another organisation is refused', $mkRota('X', '2029-02-01', '2029-02-07', $zSite)[0] === 422);
[$s, $r] = $mkRota('Dup', '2029-01-01', '2029-01-07', $site);
check('a second draft for the same site and period is 409', $s === 409 && $r['error']['code'] === 'rota_exists', json_encode($r));
check('another site, or no site, is a different rota', $mkRota('Elm', '2029-01-01', '2029-01-07', $site2)[0] === 201 && $mkRota('Whole', '2029-01-01', '2029-01-07')[0] === 201);
check('and the whole-organisation draft cannot be duplicated either', $mkRota('Whole 2', '2029-01-01', '2029-01-07')[0] === 409);
check('a draft can be renamed', call($api, 'mark', 'POST', "/orgs/$org/rotas/$w1", ['name' => 'Week one'])[1]['rota']['name'] === 'Week one');
check('a draft can be re-dated, but not onto another draft\'s slot', call($api, 'mark', 'POST', "/orgs/$org/rotas/$w1", ['period_start' => '2029-01-08', 'period_end' => '2029-01-14'])[0] === 200 && call($api, 'mark', 'POST', "/orgs/$org/rotas/$w1", ['period_start' => '2029-01-01', 'period_end' => '2029-01-07'])[0] === 200);

// ---- reading ------------------------------------------------------------------------------------------------------
check('a manager lists drafts', count(call($api, 'mark', 'GET', "/orgs/$org/rotas")[1]['rotas']) === 3);
check('staff do not see drafts', call($api, 'sam', 'GET', "/orgs/$org/rotas")[1]['rotas'] === []);
check('a stranger gets 404', call($api, 'zed', 'GET', "/orgs/$org/rotas")[0] === 404);

// ---- shifts, publishing and immutability -------------------------------------------------------------------------------
$ids = call($api, 'mark', 'POST', "/orgs/$org/shifts/batch", ['shifts' => [
    $shift($w1, $staffOf['sam'], '2029-01-01T09:00:00Z', '2029-01-01T17:00:00Z'),
    $shift($w1, $staffOf['pat'], '2029-01-02T09:00:00Z', '2029-01-02T17:00:00Z'),
    $shift($w1, $staffOf['sam'], '2029-01-03T09:00:00Z', '2029-01-03T17:00:00Z', ['status' => 'cancelled']),
]])[1]['ids'];
check('a draft takes shifts', count($ids) === 3);
check('staff cannot publish', call($api, 'sam', 'POST', "/orgs/$org/rotas/$w1/publish")[0] === 403);
check('a stranger gets 404 publishing', call($api, 'zed', 'POST', "/orgs/$org/rotas/$w1/publish")[0] === 404);
check('publishing another organisation\'s rota id through mine is 404', call($api, 'mark', 'POST', "/orgs/$other/rotas/$w1/publish")[0] === 404);
[$s, $r] = call($api, 'mark', 'POST', "/orgs/$org/rotas/$w1/publish");
check('a manager publishes', $s === 200 && $r['rota']['status'] === 'published' && $r['rota']['published_at'] !== null && $r['rota']['published_by'] !== null, json_encode($r));
check('publishing again is harmless', call($api, 'mark', 'POST', "/orgs/$org/rotas/$w1/publish")[0] === 200);
check('staff now see the published rota', count(call($api, 'sam', 'GET', "/orgs/$org/rotas")[1]['rotas']) === 1);
check('a published rota cannot be renamed', call($api, 'mark', 'POST', "/orgs/$org/rotas/$w1", ['name' => 'X'])[1]['error']['code'] === 'rota_not_draft');
[$s, $r] = call($api, 'mark', 'POST', "/orgs/$org/shifts", $shift($w1, $staffOf['sam'], '2029-01-04T09:00:00Z', '2029-01-04T17:00:00Z'));
check('a shift cannot be added to a published rota', $s === 409 && $r['error']['code'] === 'rota_published', json_encode($r));
check('nor edited', call($api, 'mark', 'POST', "/orgs/$org/shifts/{$ids[0]}", ['notes' => 'x'])[1]['error']['code'] === 'rota_published');
check('nor deleted', call($api, 'mark', 'POST', "/orgs/$org/shifts/{$ids[0]}/delete")[1]['error']['code'] === 'rota_published');
check('a published rota cannot be discarded as an amendment', call($api, 'mark', 'POST', "/orgs/$org/rotas/$w1/discard")[1]['error']['code'] === 'not_an_amendment');

// ---- amending ----------------------------------------------------------------------------------------------------------
$aDraft = (string) $pdo->query("SELECT id FROM rotas WHERE org_id = '$org' AND status = 'draft' LIMIT 1")->fetchColumn();
check('a draft is not amended', call($api, 'mark', 'POST', "/orgs/$org/rotas/$aDraft/revision")[1]['error']['code'] === 'rota_not_published');
check('staff cannot start an amendment', call($api, 'sam', 'POST', "/orgs/$org/rotas/$w1/revision")[0] === 403);
[$s, $r] = call($api, 'mark', 'POST', "/orgs/$org/rotas/$w1/revision");
check('an amendment is a draft that supersedes the published rota', $s === 200 && $r['rota']['status'] === 'draft' && $r['rota']['supersedes_rota_id'] === $w1, json_encode($r));
$rev = $r['rota']['id'];
$copied = call($api, 'mark', 'GET', "/orgs/$org/shifts?rota_ids=$rev")[1]['shifts'];
check('it starts with a copy of the non-cancelled shifts', count($copied) === 2 && $copied[0]['id'] !== $ids[0]);
check('asking again resumes the same amendment', call($api, 'mark', 'POST', "/orgs/$org/rotas/$w1/revision")[1]['rota']['id'] === $rev);
check('the published rota cannot be unpublished while an amendment is open', call($api, 'mark', 'POST', "/orgs/$org/rotas/$w1/unpublish")[1]['error']['code'] === 'open_amendment');
check('staff still see only the published version', count(call($api, 'sam', 'GET', "/orgs/$org/shifts?rota_ids=$w1,$rev")[1]['shifts']) === 3 && call($api, 'sam', 'GET', "/orgs/$org/shifts?rota_ids=$rev")[1]['shifts'] === []);
check('the amendment is editable', call($api, 'mark', 'POST', "/orgs/$org/shifts/{$copied[0]['id']}", ['notes' => 'changed'])[0] === 200);
check('and takes new shifts', call($api, 'mark', 'POST', "/orgs/$org/shifts", $shift($rev, $staffOf['pat'], '2029-01-05T09:00:00Z', '2029-01-05T17:00:00Z'))[0] === 201);

[$s, $r] = call($api, 'mark', 'POST', "/orgs/$org/rotas/$rev/publish");
check('publishing the amendment replaces the published rota', $s === 200 && $r['rota']['status'] === 'published', json_encode($r));
$old = $pdo->query("SELECT status, archived_at IS NOT NULL AS stamped FROM rotas WHERE id = '$w1'")->fetch();
check('the original is archived, with a time', $old['status'] === 'archived' && (int) $old['stamped'] === 1, json_encode($old));
check('there is still exactly one published rota for the week', (int) $pdo->query("SELECT COUNT(*) FROM rotas WHERE org_id = '$org' AND location_id = '$site' AND period_start = '2029-01-01' AND status = 'published'")->fetchColumn() === 1);
check('an archived rota\'s shifts are never edited', call($api, 'mark', 'POST', "/orgs/$org/shifts/{$ids[0]}", ['notes' => 'x'])[1]['error']['code'] === 'rota_archived');
check('an archived rota cannot be unpublished or amended', call($api, 'mark', 'POST', "/orgs/$org/rotas/$w1/unpublish")[1]['error']['code'] === 'rota_not_published' && call($api, 'mark', 'POST', "/orgs/$org/rotas/$w1/revision")[1]['error']['code'] === 'rota_not_published');
check('staff can still read the archive', count(call($api, 'sam', 'GET', "/orgs/$org/rotas")[1]['rotas']) === 2);

// discard
[, $r] = call($api, 'mark', 'POST', "/orgs/$org/rotas/$rev/revision");
$rev2 = $r['rota']['id'];
check('discarding an amendment removes it and its shifts and returns the published rota', call($api, 'mark', 'POST', "/orgs/$org/rotas/$rev2/discard")[1]['rota']['id'] === $rev && (int) $pdo->query("SELECT COUNT(*) FROM rotas WHERE id = '$rev2'")->fetchColumn() === 0 && (int) $pdo->query("SELECT COUNT(*) FROM shifts WHERE rota_id = '$rev2'")->fetchColumn() === 0);
check('staff cannot discard', call($api, 'sam', 'POST', "/orgs/$org/rotas/$rev/discard")[0] === 403);

// an existing draft for the same week is adopted as the amendment
[, $r] = $mkRota('Pre-made', '2029-01-01', '2029-01-07', $site);
$premade = $r['rota']['id'];
[, $r] = call($api, 'mark', 'POST', "/orgs/$org/rotas/$rev/revision");
check('an existing draft for the same week becomes the amendment', $r['rota']['id'] === $premade && $r['rota']['supersedes_rota_id'] === $rev);
check('and received a copy of the shifts because it had none', count(call($api, 'mark', 'GET', "/orgs/$org/shifts?rota_ids=$premade")[1]['shifts']) === 3);
call($api, 'mark', 'POST', "/orgs/$org/rotas/$premade/discard");

// unpublish
check('a published rota with no amendment can be unpublished back to a draft', call($api, 'mark', 'POST', "/orgs/$org/rotas/$rev/unpublish")[1]['rota']['status'] === 'draft');
check('and is editable again', call($api, 'mark', 'POST', "/orgs/$org/shifts/{$copied[0]['id']}", ['notes' => 'again'])[0] === 200);
call($api, 'mark', 'POST', "/orgs/$org/rotas/$rev/publish");
$mkRota('Blocker', '2029-01-01', '2029-01-07', $site);
check('unpublishing onto a slot already held by another draft is refused', call($api, 'mark', 'POST', "/orgs/$org/rotas/$rev/unpublish")[1]['error']['code'] === 'rota_exists');

// ---- minimum cover ---------------------------------------------------------------------------------------------------------
$future = '2031-03-03'; // a Monday
$fut = $mkRota('Future', $future, '2031-03-09', $site2)[1]['rota']['id'];
check('staff cannot set minimum cover', call($api, 'sam', 'POST', "/orgs/$org/minimum-cover", ['location_id' => $site2, 'weekday' => 1, 'min_staff' => 2])[0] === 403);
call($api, 'mark', 'POST', "/orgs/$org/minimum-cover", ['location_id' => $site2, 'weekday' => 1, 'min_staff' => 2]);
call($api, 'mark', 'POST', "/orgs/$org/shifts", ['rota_id' => $fut, 'location_id' => $site2, 'staff_profile_id' => $staffOf['sam'], 'starts_at' => '2031-03-03T09:00:00Z', 'ends_at' => '2031-03-03T17:00:00Z', 'status' => 'assigned']);
[$s, $r] = call($api, 'mark', 'POST', "/orgs/$org/rotas/$fut/publish");
check('publishing is refused while a future day is below its minimum, and says which', $s === 409 && $r['error']['code'] === 'cover_below_minimum' && str_contains($r['error']['message'], 'Elm Court') && str_contains($r['error']['message'], '1 short') && str_contains($r['error']['message'], '2-person'), json_encode($r));
check('the rota stayed a draft', $pdo->query("SELECT status FROM rotas WHERE id = '$fut'")->fetchColumn() === 'draft');
call($api, 'mark', 'POST', "/orgs/$org/shifts", ['rota_id' => $fut, 'location_id' => $site2, 'staff_profile_id' => $staffOf['pat'], 'starts_at' => '2031-03-03T10:00:00Z', 'ends_at' => '2031-03-03T18:00:00Z', 'status' => 'assigned']);
check('with the gap filled it publishes', call($api, 'mark', 'POST', "/orgs/$org/rotas/$fut/publish")[1]['rota']['status'] === 'published');
$pastRule = $mkRota('Past', '2020-03-02', '2020-03-08', $site2)[1]['rota']['id'];
check('a period in the past is not held to the minimum', call($api, 'mark', 'POST', "/orgs/$org/rotas/$pastRule/publish")[0] === 200);

// ---- repeat ------------------------------------------------------------------------------------------------------------------------
$src = $mkRota('Src', '2030-03-25', '2030-03-31', $site)[1]['rota']['id']; // spans the UK clock change on 31 March 2030
call($api, 'mark', 'POST', "/orgs/$org/shifts/batch", ['shifts' => [
    $shift($src, $staffOf['sam'], '2030-03-25T09:00:00Z', '2030-03-25T17:00:00Z'),
    $shift($src, $staffOf['pat'], '2030-03-30T09:00:00Z', '2030-03-30T17:00:00Z'),
    $shift($src, $staffOf['pat'], '2030-03-26T09:00:00Z', '2030-03-26T17:00:00Z', ['status' => 'cancelled']),
]]);
check('weeks outside 1 to 26, and fractions, are refused', call($api, 'mark', 'POST', "/orgs/$org/rotas/$src/repeat", ['weeks' => 0])[0] === 422 && call($api, 'mark', 'POST', "/orgs/$org/rotas/$src/repeat", ['weeks' => 27])[0] === 422 && call($api, 'mark', 'POST', "/orgs/$org/rotas/$src/repeat", ['weeks' => 1.5])[0] === 422);
check('staff cannot repeat a rota', call($api, 'sam', 'POST', "/orgs/$org/rotas/$src/repeat", ['weeks' => 1])[0] === 403);
check('a stranger gets 404', call($api, 'zed', 'POST', "/orgs/$org/rotas/$src/repeat", ['weeks' => 1])[0] === 404);
$pre = $mkRota('Pre-published', '2030-04-08', '2030-04-14', $site)[1]['rota']['id'];
call($api, 'mark', 'POST', "/orgs/$org/rotas/$pre/publish");
[$s, $r] = call($api, 'mark', 'POST', "/orgs/$org/rotas/$src/repeat", ['weeks' => 3]);
check('three weeks: two new rotas, the published week skipped', $s === 200 && $r === ['weeks_created' => 2, 'shifts_created' => 4, 'weeks_skipped' => 1], json_encode($r));
$next = $pdo->query("SELECT id, name FROM rotas WHERE org_id = '$org' AND period_start = '2030-04-01' AND location_id = '$site'")->fetch();
check('new weeks are drafts named by their date', $next['name'] === 'Week of 01 Apr 2030', json_encode($next));
$moved = $pdo->query("SELECT starts_at, ends_at FROM shifts WHERE rota_id = '{$next['id']}' ORDER BY starts_at")->fetchAll();
check('cancelled shifts are not copied', count($moved) === 2);
check('a shift keeps its LOCAL hours across the clock change (09:00 GMT becomes 09:00 BST = 08:00 UTC)', $moved[0]['starts_at'] === '2030-04-01 08:00:00' && $moved[0]['ends_at'] === '2030-04-01 16:00:00', json_encode($moved));
[, $r] = call($api, 'mark', 'POST', "/orgs/$org/rotas/$src/repeat", ['weeks' => 1]);
check('repeating again skips a week that already has shifts', $r === ['weeks_created' => 0, 'shifts_created' => 0, 'weeks_skipped' => 1], json_encode($r));
check('cover, rota and repeat actions are audited', (int) $pdo->query("SELECT COUNT(*) FROM audit_logs WHERE org_id = '$org' AND action IN ('rota.published','rota.amendment_started','rota.amendment_discarded','rota.unpublished','rota.repeated')")->fetchColumn() >= 8);
