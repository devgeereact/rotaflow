<?php
declare(strict_types=1);

// Scheduling (R2 slice S11): rota warnings (rest, weekly hours, leave, unavailable), the publish preview, overlap as the one blocker,
// recurring patterns, and clashing shifts on leave approval, through the API. The pure rules are suite 235-scheduling-rules;
// the endpoint cases port SiteRelay's 020-scheduling suite to RotaFlow's rotas, staff records and roles.
use RotaFlow\{Db, SchedulingRules as R};

$api = test_api($pdo);
$LON = 'Europe/London';
$iso = static fn (string $d, string $t): string => gmdate('Y-m-d\TH:i:s\Z', R::localTs($d, $t, 'Europe/London'));

// ---- the organisation -----------------------------------------------------------------------------------------------------------------------
$org = call($api, 'olga', 'POST', '/orgs', ['name' => 'Sched Org'])[1]['org']['id'];
$other = call($api, 'zed', 'POST', '/orgs', ['name' => 'Elsewhere'])[1]['org']['id'];
$staff = [];
foreach (['mark' => 'manager', 'sam' => 'staff', 'pat' => 'staff'] as $name => $role) {
    call($api, $name, 'GET', '/me');
    $pdo->prepare("INSERT INTO memberships (id, org_id, user_id, role, status) SELECT ?, ?, id, ?, 'active' FROM users WHERE email = ?")->execute([Db::uuid(), $org, $role, "$name@example.test"]);
    $staff[$name] = call($api, 'olga', 'POST', "/orgs/$org/staff", ['first_name' => ucfirst($name), 'email' => "$name@example.test"])[1]['id'];
}
$site = call($api, 'olga', 'POST', "/orgs/$org/locations", ['name' => 'Oak House', 'timezone' => $LON])[1]['id'];
$site2 = call($api, 'olga', 'POST', "/orgs/$org/locations", ['name' => 'Elm Court', 'timezone' => $LON])[1]['id'];
$rotaOf = static fn (string $from, string $to, string $loc): string => call($GLOBALS['api'], 'mark', 'POST', "/orgs/{$GLOBALS['org']}/rotas", ['name' => "R $from", 'period_start' => $from, 'period_end' => $to, 'location_id' => $loc])[1]['rota']['id'];
$add = static function (string $rota, ?string $who, string $d, string $s, string $e, int $brk = 0, ?string $loc = null) use ($api, $org, $site, $staff, $iso): string {
    [$st, $r] = call($api, 'mark', 'POST', "/orgs/$org/shifts", ['rota_id' => $rota, 'staff_profile_id' => $who === null ? null : $staff[$who], 'location_id' => $loc ?? $site, 'starts_at' => $iso($d, $s), 'ends_at' => $iso($e <= $s ? R::addDays($d, 1) : $d, $e), 'break_minutes' => $brk, 'status' => $who === null ? 'open' : 'assigned']);
    return $st === 201 ? $r['shift']['id'] : 'failed ' . json_encode($r);
};
$flag = static fn (bool $on) => $GLOBALS['pdo']->exec("UPDATE feature_flags SET enabled = " . ($on ? 1 : 0) . ', rollout = ' . ($on ? 100 : 0) . " WHERE flag_key = 'scheduling_tools'");
check('migration 016 seeds the flag off', $pdo->query("SELECT CONCAT(enabled, rollout) FROM feature_flags WHERE flag_key = 'scheduling_tools'")->fetchColumn() === '00');

// ---- with the module off, nothing changes ------------------------------------------------------------------------------------------------
$off = $rotaOf('2029-05-07', '2029-05-13', $site);
$add($off, 'pat', '2029-05-08', '09:00', '17:00');
$add($off, 'pat', '2029-05-08', '12:00', '20:00'); // double-booked
check('off: the preview and patterns answer 403 feature_off to a manager', call($api, 'mark', 'GET', "/orgs/$org/rotas/$off/publish-preview")[1]['error']['code'] === 'feature_off' && call($api, 'mark', 'POST', "/orgs/$org/rotas/$off/patterns/generate", ['kind' => 'weekly'])[1]['error']['code'] === 'feature_off');
check('off: staff 403, a stranger 404, nobody 401 (membership before the flag)', call($api, 'sam', 'GET', "/orgs/$org/rotas/$off/publish-preview")[1]['error']['code'] === 'forbidden' && call($api, 'zed', 'GET', "/orgs/$org/rotas/$off/publish-preview")[0] === 404 && call($api, '', 'GET', "/orgs/$org/rotas/$off/publish-preview")[0] === 401);
check('off: a double-booked rota still publishes, exactly as before', call($api, 'mark', 'POST', "/orgs/$org/rotas/$off/publish")[0] === 200);
$lv = call($api, 'mark', 'POST', "/orgs/$org/leave", ['staff_profile_id' => $staff['pat'], 'start_date' => '2029-05-08', 'end_date' => '2029-05-08'])[1]['leave']['id'];
[$s, $r] = call($api, 'mark', 'POST', "/orgs/$org/leave/$lv/review", ['status' => 'approved']);
check('off: a leave decision answers exactly as before (no clashing_shifts)', $s === 200 && $r['leave']['status'] === 'approved' && !array_key_exists('clashing_shifts', $r) && array_keys($r) === ['leave'], json_encode($r));

// ---- the preview ------------------------------------------------------------------------------------------------------------------------------
$flag(true);
$A = $rotaOf('2029-03-19', '2029-04-01', $site);
$ids = [
    'samMon' => $add($A, 'sam', '2029-03-19', '14:00', '23:00'),
    'samTue' => $add($A, 'sam', '2029-03-20', '06:00', '14:00'), // 7h rest
    'samWed' => $add($A, 'sam', '2029-03-21', '17:00', '19:00'), // unavailable Wednesdays 18:00-22:00
    'samThu' => $add($A, 'sam', '2029-03-22', '09:00', '17:00'), // approved leave 22-23 Mar
    'open' => $add($A, null, '2029-03-24', '09:00', '17:00'),
];
foreach (['26', '27', '28', '29', '30'] as $d) { // 47.5h, then Saturday makes 51.5h (the week after the clock change)
    $ids["pat$d"] = $add($A, 'pat', "2029-03-$d", '08:00', '18:00', 30);
}
$ids['patSat'] = $add($A, 'pat', '2029-03-31', '09:00', '13:00');
check('fixtures: shifts created', count(array_filter($ids, static fn (string $v): bool => str_starts_with($v, 'failed'))) === 0, json_encode($ids));
$pdo->prepare("INSERT INTO availability (id, org_id, staff_profile_id, weekday, start_time, end_time, status, recurring) VALUES (?, ?, ?, 3, '18:00', '22:00', 'unavailable', 1)")->execute([Db::uuid(), $org, $staff['sam']]);
$sl = call($api, 'mark', 'POST', "/orgs/$org/leave", ['staff_profile_id' => $staff['sam'], 'start_date' => '2029-03-22', 'end_date' => '2029-03-23', 'type' => 'holiday'])[1]['leave']['id'];
[$s, $r] = call($api, 'olga', 'POST', "/orgs/$org/leave/$sl/review", ['status' => 'approved']);
check('on: approving leave lists the shifts that now clash', $s === 200 && array_column($r['clashing_shifts'], 'id') === [$ids['samThu']] && $r['clashing_shifts'][0]['rota_status'] === 'draft' && $r['clashing_shifts'][0]['starts_at'] === '2029-03-22T09:00:00Z', json_encode($r));

check('preview: staff 403, a stranger 404, a published rota 409', call($api, 'sam', 'GET', "/orgs/$org/rotas/$A/publish-preview")[0] === 403 && call($api, 'zed', 'GET', "/orgs/$org/rotas/$A/publish-preview")[0] === 404 && call($api, 'mark', 'GET', "/orgs/$org/rotas/$off/publish-preview")[1]['error']['code'] === 'rota_not_draft');
[$s, $p] = call($api, 'mark', 'GET', "/orgs/$org/rotas/$A/publish-preview");
$wOf = static fn (array $p, string $id): array => array_column(array_values(array_filter($p['shifts'], static fn (array $x): bool => $x['id'] === $id))[0]['warnings'] ?? [], 'code');
check('preview: every shift is new on a first publish', $s === 200 && $p['counts'] === ['new' => 11, 'unchanged' => 0, 'cancelled' => 0, 'removed' => 0] && $p['total'] === 11 && $p['can_publish'] === true && $p['limits'] === ['min_rest_hours' => 11, 'max_weekly_hours' => 48], json_encode($p['counts'] ?? $p));
check('preview: rest, unavailable and leave land on the right shifts', $wOf($p, $ids['samTue']) === ['rest'] && $wOf($p, $ids['samWed']) === ['unavailable'] && $wOf($p, $ids['samThu']) === ['leave'] && $wOf($p, $ids['samMon']) === [] && $wOf($p, $ids['open']) === []);
check('preview: weekly hours on every shift of that week, across the clock change', $wOf($p, $ids['pat26']) === ['weekly_hours'] && $wOf($p, $ids['patSat']) === ['weekly_hours'] && str_contains(json_encode(array_values(array_filter($p['shifts'], static fn ($x) => $x['id'] === $ids['patSat']))[0]['warnings'][0]['message'], JSON_UNESCAPED_UNICODE), '51.5h scheduled in the week of Mon 26 Mar (limit 48h)'));
check('preview: counts by code', $p['with_warnings'] === 9 && (array) $p['warnings_by_code'] === ['rest' => 1, 'unavailable' => 1, 'leave' => 1, 'weekly_hours' => 6], json_encode($p['warnings_by_code']));

// The organisation's limits come from Settings -> Policies.
call($api, 'olga', 'POST', "/orgs/$org/settings", ['min_rest_hours' => 0, 'max_weekly_hours' => 60]);
$p2 = call($api, 'mark', 'GET', "/orgs/$org/rotas/$A/publish-preview")[1];
check('preview: no rest check at 0 hours, no weekly warning under 60', $wOf($p2, $ids['samTue']) === [] && $wOf($p2, $ids['patSat']) === [] && $p2['limits'] === ['min_rest_hours' => 0, 'max_weekly_hours' => 60]);
call($api, 'olga', 'POST', "/orgs/$org/settings", ['min_rest_hours' => 11, 'max_weekly_hours' => 48]);

// ---- overlap is the one thing that blocks --------------------------------------------------------------------------------------------------
$dbl = $add($A, 'sam', '2029-03-22', '16:00', '18:00');
$p = call($api, 'mark', 'GET', "/orgs/$org/rotas/$A/publish-preview")[1];
check('overlap: the preview names the pair and says it cannot publish', $p['can_publish'] === false && count($p['overlaps']) === 1 && in_array($p['overlaps'][0]['shift']['id'], [$ids['samThu'], $dbl], true) && in_array($p['overlaps'][0]['other']['id'], [$ids['samThu'], $dbl], true));
[$s, $r] = call($api, 'mark', 'POST', "/orgs/$org/rotas/$A/publish");
check('overlap: publishing refuses it with 409 shift_overlap', $s === 409 && $r['error']['code'] === 'shift_overlap' && $pdo->query("SELECT status FROM rotas WHERE id = '$A'")->fetchColumn() === 'draft', json_encode($r));
call($api, 'mark', 'POST', "/orgs/$org/shifts/$dbl", ['status' => 'cancelled']);
check('overlap: a cancelled shift no longer clashes', call($api, 'mark', 'GET', "/orgs/$org/rotas/$A/publish-preview")[1]['can_publish'] === true);
// Against what is already published: pat is on the published "off" week; a loose shift (no rota) counts too.
$B = $rotaOf('2029-05-07', '2029-05-13', $site2);
$pb = $add($B, 'pat', '2029-05-08', '16:00', '18:00', 0, $site2);
check('overlap: a shift clashing with a published rota elsewhere blocks too', call($api, 'mark', 'GET', "/orgs/$org/rotas/$B/publish-preview")[1]['can_publish'] === false && call($api, 'mark', 'POST', "/orgs/$org/rotas/$B/publish")[1]['error']['code'] === 'shift_overlap');
[$s, $r] = call($api, 'mark', 'POST', "/orgs/$org/rotas/$A/publish");
check('warnings never block: the rota with warnings publishes', $s === 200 && $r['rota']['status'] === 'published', json_encode($r));

// ---- an amendment is compared with the week it replaces -----------------------------------------------------------------------------------
$A2 = call($api, 'mark', 'POST', "/orgs/$org/rotas/$A/revision")[1]['rota']['id'];
$p = call($api, 'mark', 'GET', "/orgs/$org/rotas/$A2/publish-preview")[1];
check('amendment: an untouched copy is all unchanged and does not clash with its own original', $p['counts']['unchanged'] === 11 && $p['counts']['new'] === 0 && $p['counts']['removed'] === 0 && $p['can_publish'] === true && $p['with_warnings'] === 9, json_encode($p['counts']));
$copyMon = $pdo->query("SELECT id FROM shifts WHERE rota_id = '$A2' AND staff_profile_id = '{$staff['sam']}' ORDER BY starts_at LIMIT 1")->fetchColumn();
call($api, 'mark', 'POST', "/orgs/$org/shifts/$copyMon/delete");
$add($A2, 'pat', '2029-03-24', '09:00', '12:00');
$p = call($api, 'mark', 'GET', "/orgs/$org/rotas/$A2/publish-preview")[1];
check('amendment: one removed, one new, the rest unchanged', $p['counts'] === ['new' => 1, 'unchanged' => 10, 'cancelled' => 0, 'removed' => 1], json_encode($p['counts']));
check('amendment: removing the Monday late clears the Tuesday rest warning', (((array) $p['warnings_by_code'])['rest'] ?? 0) === 0 && $p['with_warnings'] === 8);
check('amendment: removed rows name the shift that goes', count($p['removed']) === 1 && $p['removed'][0]['starts_at'] === '2029-03-19T14:00:00Z');

// ---- patterns ----------------------------------------------------------------------------------------------------------------------------------
$C = $rotaOf('2029-03-19', '2029-04-15', $site2);
$G = "/orgs/$org/rotas/$C/patterns/generate";
$body = static fn (array $o = []): array => $o + ['kind' => 'weekly', 'weekdays' => [1, 2, 3, 4, 5], 'from_date' => '2029-03-19', 'to_date' => '2029-03-30', 'blocks' => [['start' => '06:00', 'end' => '14:00']], 'staff_profile_id' => $staff['pat']];
$count = static fn (): int => (int) $GLOBALS['pdo']->query("SELECT COUNT(*) FROM shifts WHERE rota_id = '{$GLOBALS['C']}'")->fetchColumn();
check('patterns: staff 403, a stranger 404, nobody 401', call($api, 'sam', 'POST', $G, $body())[0] === 403 && call($api, 'zed', 'POST', $G, $body())[0] === 404 && call($api, '', 'POST', $G, $body())[0] === 401);
check('patterns: bad bodies are 422 (kind, outside the period, blocks, break, person from elsewhere)', call($api, 'mark', 'POST', $G, $body(['kind' => 'x']))[0] === 422 && call($api, 'mark', 'POST', $G, $body(['to_date' => '2029-04-16']))[0] === 422 && call($api, 'mark', 'POST', $G, $body(['blocks' => []]))[0] === 422 && call($api, 'mark', 'POST', $G, $body(['break_minutes' => 600]))[0] === 422 && call($api, 'mark', 'POST', $G, $body(['staff_profile_id' => call($api, 'zed', 'POST', "/orgs/$other/staff", ['first_name' => 'Zoe'])[1]['id']]))[0] === 422);
[$s, $r] = call($api, 'mark', 'POST', $G, $body(['preview' => true]));
check('patterns: a preview reports and writes nothing', $s === 200 && $r['preview'] === true && $r['created'] === 5 && count($r['skipped']) === 5 && $r['shift_ids'] === [] && $count() === 0, json_encode($r));
check('patterns: the week pat already works (published) is skipped as overlap, never forced', array_unique(array_column($r['skipped'], 'reason')) === ['overlap'] && $r['skipped'][0]['date'] === '2029-03-26');
[$s, $r] = call($api, 'mark', 'POST', $G, $body());
check('patterns: generated for real, as assigned shifts on the rota\'s site', $s === 200 && $r['created'] === 5 && count($r['shift_ids']) === 5 && $count() === 5 && (int) $pdo->query("SELECT COUNT(*) FROM shifts WHERE rota_id = '$C' AND status = 'assigned' AND location_id = '$site2' AND staff_profile_id = '{$staff['pat']}'")->fetchColumn() === 5);
check('patterns: audited', (int) $pdo->query("SELECT COUNT(*) FROM audit_logs WHERE action = 'rota.pattern_generated' AND entity_id = '$C'")->fetchColumn() === 1);
[$s, $r] = call($api, 'mark', 'POST', $G, $body());
check('patterns: running it again skips what is already there', $s === 200 && $r['created'] === 0 && count($r['skipped']) === 10 && in_array('duplicate', array_column($r['skipped'], 'reason'), true) && $count() === 5);
[$s, $r] = call($api, 'mark', 'POST', $G, ['kind' => 'weekly', 'weekdays' => [6, 7], 'from_date' => '2029-03-24', 'to_date' => '2029-03-25', 'blocks' => [['start' => '06:00', 'end' => '14:00']]]);
$open = $pdo->query("SELECT starts_at FROM shifts WHERE rota_id = '$C' AND staff_profile_id IS NULL ORDER BY starts_at")->fetchAll(PDO::FETCH_COLUMN);
check('patterns: 06:00 stays 06:00 across the clock change (GMT Saturday, BST Sunday); no person means open shifts', $s === 200 && $open === ['2029-03-24 06:00:00', '2029-03-25 05:00:00'], json_encode($open));
[$s, $r] = call($api, 'mark', 'POST', $G, ['kind' => 'cycle', 'days_on' => 2, 'days_off' => 2, 'cycle_start' => '2029-04-01', 'from_date' => '2029-04-02', 'to_date' => '2029-04-08', 'blocks' => [['start' => '10:00', 'end' => '12:00']], 'staff_profile_id' => $staff['sam'], 'break_minutes' => 15]);
check('patterns: a cycle (2 on 2 off from 1 Apr) makes 2, 5 and 6 Apr', $s === 200 && $r['created'] === 3 && $pdo->query("SELECT GROUP_CONCAT(DATE(starts_at) ORDER BY starts_at) FROM shifts WHERE rota_id = '$C' AND staff_profile_id = '{$staff['sam']}'")->fetchColumn() === '2029-04-02,2029-04-05,2029-04-06', json_encode($r));
[$s, $r] = call($api, 'mark', 'POST', $G, ['kind' => 'weekly', 'weekdays' => [5], 'from_date' => '2029-03-23', 'to_date' => '2029-03-23', 'blocks' => [['start' => '10:00', 'end' => '12:00']], 'staff_profile_id' => $staff['sam']]);
check('patterns: the result carries the warnings of what it made (sam is on leave that Friday)', $s === 200 && $r['created'] === 1 && ($r['warnings'][0]['warnings'][0]['code'] ?? '') === 'leave', json_encode($r));
check('patterns: a published rota is not filled (409)', call($api, 'mark', 'POST', "/orgs/$org/rotas/$A/patterns/generate", $body(['from_date' => '2029-03-19', 'to_date' => '2029-03-19']))[1]['error']['code'] === 'rota_not_draft');
$D = $rotaOf('2029-06-04', '2029-12-31', $site);
check('patterns: more than 92 days, or more than 500 shifts, is refused', call($api, 'mark', 'POST', "/orgs/$org/rotas/$D/patterns/generate", $body(['from_date' => '2029-06-04', 'to_date' => '2029-09-04']))[0] === 422 && str_contains((string) call($api, 'mark', 'POST', "/orgs/$org/rotas/$D/patterns/generate", $body(['weekdays' => [1, 2, 3, 4, 5, 6, 7], 'from_date' => '2029-06-04', 'to_date' => '2029-09-03', 'blocks' => array_map(static fn (int $i): array => ['start' => sprintf('%02d:00', $i * 4), 'end' => sprintf('%02d:00', $i * 4 + 1)], range(0, 5))]))[1]['error']['message'], 'limit is 500'));

// ---- leave decisions with the module on -------------------------------------------------------------------------------------------------------
$pl = call($api, 'pat', 'POST', "/orgs/$org/leave", ['start_date' => '2029-03-27', 'end_date' => '2029-03-27'])[1]['leave']['id'];
[$s, $r] = call($api, 'mark', 'POST', "/orgs/$org/leave/$pl/review", ['status' => 'approved']);
$statuses = array_column($r['clashing_shifts'] ?? [], 'rota_status');
sort($statuses);
check('leave: the published shift and its open amendment copy both clash', $s === 200 && $statuses === ['draft', 'published'], json_encode($r['clashing_shifts'] ?? $r));
$pl2 = call($api, 'pat', 'POST', "/orgs/$org/leave", ['start_date' => '2029-03-28', 'end_date' => '2029-03-28'])[1]['leave']['id'];
[$s, $r] = call($api, 'mark', 'POST', "/orgs/$org/leave/$pl2/review", ['status' => 'rejected']);
check('leave: a rejection lists nothing', $s === 200 && $r['clashing_shifts'] === []);
$pl3 = call($api, 'sam', 'POST', "/orgs/$org/leave", ['start_date' => '2029-07-01', 'end_date' => '2029-07-02'])[1]['leave']['id'];
check('leave: approval with nothing rostered lists nothing', call($api, 'mark', 'POST', "/orgs/$org/leave/$pl3/review", ['status' => 'approved'])[1]['clashing_shifts'] === []);

// ---- and off again ---------------------------------------------------------------------------------------------------------------------------
$flag(false);
check('off again: routes 403, and the double-booked rota publishes as before', call($api, 'mark', 'GET', "/orgs/$org/rotas/$B/publish-preview")[1]['error']['code'] === 'feature_off' && call($api, 'mark', 'POST', "/orgs/$org/rotas/$B/publish")[0] === 200);
$pdo->exec("DELETE FROM feature_flags WHERE flag_key = 'scheduling_tools'");
check('a missing flag row reads as off (fails closed)', call($api, 'mark', 'GET', "/orgs/$org/rotas/$A2/publish-preview")[1]['error']['code'] === 'feature_off');
