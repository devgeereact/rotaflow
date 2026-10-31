<?php
declare(strict_types=1);

// Two-way swaps (R2 slice S12d, owner decision 31 Oct 2026) through the API: behind two_way_swaps AND cover_tools (both seeded off); the
// options view; raising one (validation, both ways eligible, one swap per shift); approving moves both shifts in one transaction or nothing;
// staleness of either shift cancels it (S12's rules); eligibility re-checked at approval; never half-applied (reassign refused; with the
// flags turned off afterwards it is still guarded and moved whole); the sweep; visibility; two approvals at once. Ports SiteRelay's 030-cover
// swap cases (take_shift_id, swap-options) to RotaFlow's swaps. The pure rules are suite 245-cover-rules.
use RotaFlow\Db;
use RotaFlow\Mod\Cover;

$api = test_api($pdo);
$org = call($api, 'olga', 'POST', '/orgs', ['name' => 'Exchange Org'])[1]['org']['id'];
$other = call($api, 'zed', 'POST', '/orgs', ['name' => 'Elsewhere'])[1]['org']['id'];
$staff = [];
foreach (['mark' => 'manager', 'sam' => 'staff', 'pat' => 'staff', 'dee' => 'staff', 'eve' => 'staff', 'gus' => 'staff'] as $who => $role) {
    call($api, $who, 'GET', '/me');
    $pdo->prepare("INSERT INTO memberships (id, org_id, user_id, role, status) SELECT ?, ?, id, ?, 'active' FROM users WHERE email = ?")->execute([Db::uuid(), $org, $role, "$who@example.test"]);
    $staff[$who] = call($api, 'olga', 'POST', "/orgs/$org/staff", ['first_name' => ucfirst($who), 'email' => "$who@example.test"])[1]['id'];
}
$site = call($api, 'olga', 'POST', "/orgs/$org/locations", ['name' => 'Oak House', 'timezone' => 'Europe/London'])[1]['id'];
$site2 = call($api, 'olga', 'POST', "/orgs/$org/locations", ['name' => 'Elm Court', 'timezone' => 'Europe/London'])[1]['id'];
$day = static fn (int $n): string => gmdate('Y-m-d', time() + $n * 86400);
$at = static fn (int $n, string $hm = '09:00'): string => $day($n) . "T$hm:00Z";
$rota = call($api, 'mark', 'POST', "/orgs/$org/rotas", ['name' => 'Weeks', 'period_start' => $day(2), 'period_end' => $day(26), 'location_id' => $site])[1]['rota']['id'];
$draft = call($api, 'mark', 'POST', "/orgs/$org/rotas", ['name' => 'Draft', 'period_start' => $day(2), 'period_end' => $day(26), 'location_id' => $site2])[1]['rota']['id'];
$mk = static function (string $who, int $n, string $a = '09:00', string $b = '17:00', ?string $r = null, ?string $loc = null) use ($api, $org, $rota, $staff, $site, $at): string {
    [$s, $res] = call($api, 'mark', 'POST', "/orgs/$org/shifts", ['rota_id' => $r ?? $rota, 'location_id' => $loc ?? $site, 'staff_profile_id' => $staff[$who], 'starts_at' => $at($n, $a), 'ends_at' => $at($n, $b), 'status' => 'assigned']);
    return $s === 201 ? $res['shift']['id'] : 'failed ' . json_encode($res);
};
$sh = [
    'S3' => $mk('sam', 3), 'P4' => $mk('pat', 4), 'S5' => $mk('sam', 5), 'P6' => $mk('pat', 6), 'S7' => $mk('sam', 7), 'P8' => $mk('pat', 8),
    'S9' => $mk('sam', 9), 'P10' => $mk('pat', 10), 'S11' => $mk('sam', 11), 'P12' => $mk('pat', 12), 'S13' => $mk('sam', 13), 'P14' => $mk('pat', 14),
    'S15' => $mk('sam', 15), 'P16' => $mk('pat', 16), 'S17' => $mk('sam', 17), 'P18' => $mk('pat', 18), 'S19' => $mk('sam', 19), 'P20' => $mk('pat', 20),
    'D21' => $mk('dee', 21), 'S22' => $mk('sam', 22), 'S23' => $mk('sam', 23, '09:00', '17:00'), 'P23' => $mk('pat', 23, '12:00', '20:00'),
    'E24' => $mk('eve', 24), 'S24b' => $mk('sam', 24, '10:00', '12:00'), 'S25' => $mk('sam', 25), 'P26' => $mk('pat', 26),
    'Pcancel' => $mk('pat', 2), 'Pstart' => $mk('pat', 2, '12:00', '13:00'),
];
check('fixtures: shifts created', count(array_filter($sh, static fn (string $v): bool => str_starts_with($v, 'failed'))) === 0, json_encode($sh));
check('fixtures: the rota publishes', call($api, 'mark', 'POST', "/orgs/$org/rotas/$rota/publish")[0] === 200);
$sh['Pdraft'] = $mk('pat', 9, '18:00', '20:00', $draft, $site2);
$pdo->prepare("UPDATE shifts SET status = 'cancelled' WHERE id = ?")->execute([$sh['Pcancel']]);
$pdo->prepare('UPDATE shifts SET starts_at = UTC_TIMESTAMP() - INTERVAL 1 HOUR WHERE id = ?')->execute([$sh['Pstart']]);
$lv = call($api, 'mark', 'POST', "/orgs/$org/leave", ['staff_profile_id' => $staff['dee'], 'start_date' => $day(3), 'end_date' => $day(6)])[1]['leave']['id'];
call($api, 'mark', 'POST', "/orgs/$org/leave/$lv/review", ['status' => 'approved']);
$flags = static function (bool $cover, bool $two) use ($pdo): void {
    $pdo->exec('UPDATE feature_flags SET enabled = ' . (int) $cover . ', rollout = ' . ($cover ? 100 : 0) . " WHERE flag_key = 'cover_tools'");
    $pdo->exec('UPDATE feature_flags SET enabled = ' . (int) $two . ', rollout = ' . ($two ? 100 : 0) . " WHERE flag_key = 'two_way_swaps'");
};
$holder = static fn (string $id): ?string => $GLOBALS['pdo']->query("SELECT staff_profile_id FROM shifts WHERE id = '$id'")->fetchColumn() ?: null;
$swap = static fn (string $id): array => $GLOBALS['pdo']->query("SELECT * FROM shift_swaps WHERE id = '$id'")->fetch();
$ask = static fn (string $give, string $to, string $take, string $who = 'sam') => call($GLOBALS['api'], $who, 'POST', "/orgs/{$GLOBALS['org']}/swaps", ['shift_id' => $give, 'target_staff_profile_id' => $GLOBALS['staff'][$to], 'take_shift_id' => $take]);
$W = "/orgs/$org/swaps";

// ---- with the flags off, nothing changes --------------------------------------------------------------------------------------------------------
check('migration 019 seeds the flag off', $pdo->query("SELECT CONCAT(enabled, rollout) FROM feature_flags WHERE flag_key = 'two_way_swaps'")->fetchColumn() === '00');
check('off: asking for a shift in return is 403 feature_off, and nothing is written', $ask($sh['S3'], 'pat', $sh['P4'])[1]['error']['code'] === 'feature_off' && (int) $pdo->query("SELECT COUNT(*) FROM shift_swaps WHERE org_id = '$org'")->fetchColumn() === 0);
check('off: the options view is 403 feature_off; a stranger 404; nobody 401', call($api, 'sam', 'GET', "$W/options")[1]['error']['code'] === 'feature_off' && call($api, 'zed', 'GET', "$W/options")[0] === 404 && call($api, '', 'GET', "$W/options")[0] === 401);
$flags(true, false);
check('cover on but two-way off: still 403 feature_off', $ask($sh['S3'], 'pat', $sh['P4'])[1]['error']['code'] === 'feature_off');
$flags(false, true);
check('two-way on but cover off: still 403 feature_off (it needs cover\'s locks and rules)', $ask($sh['S3'], 'pat', $sh['P4'])[1]['error']['code'] === 'feature_off' && call($api, 'sam', 'GET', "$W/options")[1]['error']['code'] === 'feature_off');
$flags(false, false);
[$s, $r] = call($api, 'sam', 'POST', $W, ['shift_id' => $sh['S25'], 'target_staff_profile_id' => $staff['gus']]);
$oneWayKeys = array_keys($r['swap'] ?? []);
check('off: a one-way swap answers without any two-way key', $s === 201 && !array_intersect(['take_shift_id', 'take_starts_at', 'take_ends_at', 'take_location_id', 'take_staff_profile_id', 'take_fingerprint'], $oneWayKeys), json_encode($oneWayKeys));
check('off: and the list rows carry none either', !array_intersect(['take_shift_id', 'take_starts_at', 'take_fingerprint'], array_keys(call($api, 'mark', 'GET', $W)[1]['swaps'][0])));
call($api, 'sam', 'POST', "$W/{$r['swap']['id']}/cancel");

// ---- options ----------------------------------------------------------------------------------------------------------------------------------------
$flags(true, true);
[$s, $r] = call($api, 'sam', 'GET', "$W/options");
$optIds = array_column($r['shifts'] ?? [], 'id');
check('options: colleagues (not the caller) and their future published shifts', $s === 200 && in_array($staff['pat'], array_column($r['colleagues'], 'id'), true) && !in_array($staff['sam'], array_column($r['colleagues'], 'id'), true) && in_array($sh['P4'], $optIds, true) && in_array($sh['D21'], $optIds, true), json_encode($r));
check('options: never the caller\'s own shifts, a draft-rota shift, a cancelled one or one that has started', !in_array($sh['S3'], $optIds, true) && !in_array($sh['Pdraft'], $optIds, true) && !in_array($sh['Pcancel'], $optIds, true) && !in_array($sh['Pstart'], $optIds, true));
check('options: only times, site and holder per shift', array_keys($r['shifts'][0]) === ['starts_at', 'ends_at', 'id', 'staff_profile_id', 'location_id'], json_encode(array_keys($r['shifts'][0])));
check('options: a member with no staff record is told so', (function () use ($api, $org, $pdo, $W): bool { call($api, 'nora', 'GET', '/me'); $pdo->prepare("INSERT INTO memberships (id, org_id, user_id, role, status) SELECT ?, ?, id, 'staff', 'active' FROM users WHERE email = 'nora@example.test'")->execute([Db::uuid(), $org]); return call($api, 'nora', 'GET', "$W/options")[1]['error']['code'] === 'no_staff_record'; })());

// ---- raising one ---------------------------------------------------------------------------------------------------------------------------------------
check('raise: a colleague must be named', call($api, 'sam', 'POST', $W, ['shift_id' => $sh['S3'], 'take_shift_id' => $sh['P4']])[0] === 422);
foreach (['a shift that is not the colleague\'s' => $sh['D21'], 'the same shift' => $sh['S3'], 'a draft-rota shift' => $sh['Pdraft'], 'a cancelled shift' => $sh['Pcancel'], 'a shift that has started' => $sh['Pstart'], 'an unknown shift' => Db::uuid()] as $label => $take) {
    check("raise: asking for $label is 422", $ask($sh['S3'], 'pat', $take)[0] === 422);
}
check('raise: a shift from another organisation is 422 and reveals nothing', $ask($sh['S3'], 'pat', (string) $pdo->query("SELECT id FROM shifts WHERE org_id <> '$org' LIMIT 1")->fetchColumn() ?: Db::uuid())[0] === 422);
check('raise: nothing written by the refusals', (int) $pdo->query("SELECT COUNT(*) FROM shift_swaps WHERE org_id = '$org' AND take_shift_id IS NOT NULL")->fetchColumn() === 0);
[$s, $r] = $ask($sh['S3'], 'pat', $sh['P4']);
$x1 = $r['swap']['id'] ?? '';
check('raise: sam offers Monday for pat\'s Tuesday: 201 with the shift asked for, never the fingerprints', $s === 201 && $r['swap']['take_shift_id'] === $sh['P4'] && $r['swap']['take_staff_profile_id'] === $staff['pat'] && isset($r['swap']['take_starts_at']) && !isset($r['swap']['take_fingerprint']) && !isset($r['swap']['shift_fingerprint']) && $r['swap']['status'] === 'pending', json_encode($r));
check('raise: both fingerprints are kept server side', strlen((string) $swap($x1)['take_fingerprint']) === 64 && strlen((string) $swap($x1)['shift_fingerprint']) === 64);
check('raise: pat is told', (int) $pdo->query("SELECT COUNT(*) FROM notification_outbox WHERE org_id = '$org' AND event_name = 'swap/requested'")->fetchColumn() === 1);
check('raise: either shift already in a waiting swap is 409 swap_pending', $ask($sh['S3'], 'pat', $sh['P6'])[1]['error']['code'] === 'swap_pending' && $ask($sh['S5'], 'pat', $sh['P4'])[1]['error']['code'] === 'swap_pending');
check('raise: options no longer offer a shift that is in a waiting swap', !in_array($sh['P4'], array_column(call($api, 'gus', 'GET', "$W/options")[1]['shifts'], 'id'), true));
[$s, $r] = $ask($sh['S5'], 'dee', $sh['D21']);
check('raise: the colleague must be able to take the shift offered (dee is on leave that day): 409 not_eligible', $s === 409 && $r['error']['code'] === 'not_eligible' && str_contains($r['error']['message'], 'Your colleague'), json_encode($r));
[$s, $r] = $ask($sh['S5'], 'eve', $sh['E24']);
check('raise: the person offering must be able to take the shift asked for (sam already works part of that day): 409 not_eligible', $s === 409 && $r['error']['code'] === 'not_eligible' && str_contains($r['error']['message'], 'The person offering'), json_encode($r));
[$s, $r] = $ask($sh['S23'], 'pat', $sh['P23']);
check('raise: two shifts that overlap each other can be exchanged (each gives up the clashing one)', $s === 201, json_encode($r));
$x23 = $r['swap']['id'] ?? '';

// ---- visibility -----------------------------------------------------------------------------------------------------------------------------------------
check('visibility: pat (asked) and the manager see it; eve does not', in_array($x1, array_column(call($api, 'pat', 'GET', $W)[1]['swaps'], 'id'), true) && in_array($x1, array_column(call($api, 'mark', 'GET', $W)[1]['swaps'], 'id'), true) && !in_array($x1, array_column(call($api, 'eve', 'GET', $W)[1]['swaps'], 'id'), true));
check('visibility: nobody can claim a two-way swap off the open board', call($api, 'eve', 'POST', "$W/$x1/claim")[1]['error']['code'] === 'swap_unavailable');

// ---- approving moves both ---------------------------------------------------------------------------------------------------------------------------------
check('respond: pat accepts', call($api, 'pat', 'POST', "$W/$x1/respond", ['status' => 'accepted'])[1]['swap']['status'] === 'accepted');
[$s, $r] = call($api, 'mark', 'POST', "$W/$x1/decide", ['status' => 'approved']);
check('approve: both shifts move in one go (Monday to pat, Tuesday to sam)', $s === 200 && $r['outcome'] === 'approved' && $r['take_shift_id'] === $sh['P4'] && $holder($sh['S3']) === $staff['pat'] && $holder($sh['P4']) === $staff['sam'], json_encode($r));
check('approve: both moves are audited', (int) $pdo->query("SELECT COUNT(*) FROM audit_logs WHERE org_id = '$org' AND action = 'rota.shift_reassigned' AND metadata LIKE '%$x1%'")->fetchColumn() === 2);
check('approve: deciding again is already-decided and moves nothing back', call($api, 'mark', 'POST', "$W/$x1/decide", ['status' => 'approved'])[1]['outcome'] === 'already-decided' && $holder($sh['S3']) === $staff['pat']);
$pdo->prepare('UPDATE shift_swaps SET applied_at = NULL WHERE id = ?')->execute([$x1]);
check('reassign: a two-way swap is never moved one shift at a time (409 swap_two_way)', call($api, 'mark', 'POST', "$W/$x1/reassign")[1]['error']['code'] === 'swap_two_way' && $holder($sh['S3']) === $staff['pat'] && $holder($sh['P4']) === $staff['sam']);
check('approve: the requester can finalise an accepted exchange, as with one-way swaps', (function () use ($api, $W, $x23, $holder, $sh, $staff): bool { call($api, 'pat', 'POST', "$W/$x23/respond", ['status' => 'accepted']); $r = call($api, 'sam', 'POST', "$W/$x23/decide", ['status' => 'approved']); return $r[0] === 200 && $holder($sh['S23']) === $staff['pat'] && $holder($sh['P23']) === $staff['sam']; })());

// ---- staleness: either shift ------------------------------------------------------------------------------------------------------------------------------
$x2 = $ask($sh['S7'], 'pat', $sh['P8'])[1]['swap']['id'];
$pdo->prepare('UPDATE shifts SET ends_at = ends_at + INTERVAL 1 HOUR WHERE id = ?')->execute([$sh['P8']]);
[$s, $r] = call($api, 'mark', 'POST', "$W/$x2/decide", ['status' => 'approved']);
check('stale: the shift asked for changed: 409 swap_void, cancelled shift_changed, nothing moved', $s === 409 && $r['error']['code'] === 'swap_void' && $swap($x2)['status'] === 'cancelled' && $swap($x2)['void_reason'] === 'shift_changed' && $holder($sh['S7']) === $staff['sam'] && $holder($sh['P8']) === $staff['pat'], json_encode($r));
$x3 = $ask($sh['S9'], 'pat', $sh['P10'])[1]['swap']['id'];
$pdo->prepare("UPDATE shifts SET staff_profile_id = ? WHERE id = ?")->execute([$staff['gus'], $sh['P10']]);
check('stale: the shift asked for given to someone else: void on the colleague\'s answer', call($api, 'pat', 'POST', "$W/$x3/respond", ['status' => 'accepted'])[1]['error']['code'] === 'swap_void' && $swap($x3)['void_reason'] === 'shift_changed');
$x4 = $ask($sh['S11'], 'pat', $sh['P12'])[1]['swap']['id'];
$pdo->prepare('UPDATE shifts SET starts_at = UTC_TIMESTAMP() - INTERVAL 1 MINUTE WHERE id = ?')->execute([$sh['S11']]);
check('stale: the offered shift started before the decision: shift_changed (its start moved) wins', call($api, 'mark', 'POST', "$W/$x4/decide", ['status' => 'approved'])[1]['error']['code'] === 'swap_void' && $swap($x4)['void_reason'] === 'shift_changed');
$x5 = $ask($sh['S13'], 'pat', $sh['P14'])[1]['swap']['id'];
$pdo->prepare("UPDATE shift_swaps SET take_fingerprint = NULL WHERE id = ?")->execute([$x5]); // as if raised before fingerprints: judged on the rest
$pdo->prepare('UPDATE shifts SET starts_at = UTC_TIMESTAMP() - INTERVAL 1 MINUTE WHERE id = ?')->execute([$sh['P14']]);
Cover::cron(test_ctx($pdo));
check('sweep: the cover sweep cancels a two-way swap whose shift has started (shift_started)', $swap($x5)['status'] === 'cancelled' && $swap($x5)['void_reason'] === 'shift_started');

// ---- eligibility re-checked at approval ------------------------------------------------------------------------------------------------------------------
$x6 = $ask($sh['S15'], 'pat', $sh['P16'])[1]['swap']['id'];
$lp = call($api, 'mark', 'POST', "/orgs/$org/leave", ['staff_profile_id' => $staff['pat'], 'start_date' => $day(15), 'end_date' => $day(15)])[1]['leave']['id'];
call($api, 'mark', 'POST', "/orgs/$org/leave/$lp/review", ['status' => 'approved']);
[$s, $r] = call($api, 'mark', 'POST', "$W/$x6/decide", ['status' => 'approved']);
check('approve: leave approved since it was raised refuses it (409 not_eligible); nothing moved; the swap is still waiting', $s === 409 && $r['error']['code'] === 'not_eligible' && $holder($sh['S15']) === $staff['sam'] && $holder($sh['P16']) === $staff['pat'] && $swap($x6)['status'] === 'pending', json_encode($r));

// ---- turning the flags off later never half-applies one ------------------------------------------------------------------------------------------------
$x7 = $ask($sh['S17'], 'pat', $sh['P18'])[1]['swap']['id'];
$x8 = $ask($sh['S19'], 'pat', $sh['P20'])[1]['swap']['id'];
$flags(false, false);
[$s, $r] = call($api, 'mark', 'POST', "$W/$x7/decide", ['status' => 'approved']);
check('flags off: an existing two-way swap still moves both shifts', $s === 200 && $holder($sh['S17']) === $staff['pat'] && $holder($sh['P18']) === $staff['sam'], json_encode($r));
$pdo->prepare('UPDATE shifts SET ends_at = ends_at + INTERVAL 1 HOUR WHERE id = ?')->execute([$sh['P20']]);
check('flags off: and is still cancelled when a shift changed', call($api, 'mark', 'POST', "$W/$x8/decide", ['status' => 'approved'])[1]['error']['code'] === 'swap_void' && $holder($sh['S19']) === $staff['sam'] && $holder($sh['P20']) === $staff['pat']);
check('flags off: the colleague\'s answer is guarded too (a changed shift voids it)', (function () use ($api, $W, $sh, $flags, $ask, $pdo, $swap): bool { $flags(true, true); $id = $ask($sh['S19'], 'pat', $sh['P20'])[1]['swap']['id'] ?? null; $flags(false, false); if ($id === null) { return false; } $pdo->prepare('UPDATE shifts SET ends_at = ends_at + INTERVAL 1 HOUR WHERE id = ?')->execute([$sh['P20']]); return call($api, 'pat', 'POST', "$W/$id/respond", ['status' => 'accepted'])[1]['error']['code'] === 'swap_void' && $swap($id)['void_reason'] === 'shift_changed'; })());
check('flags off: rejecting still works and moves nothing', (function () use ($api, $W, $sh, $staff, $flags, $ask, $holder): bool { $flags(true, true); $id = $ask($sh['S22'], 'pat', $sh['P26'])[1]['swap']['id'] ?? null; $flags(false, false); return $id !== null && call($api, 'mark', 'POST', "$W/$id/decide", ['status' => 'rejected'])[1]['outcome'] === 'declined' && $holder($sh['S22']) === $staff['sam'] && $holder($sh['P26']) === $staff['pat']; })());

// ---- two approvals at once --------------------------------------------------------------------------------------------------------------------------------
$flags(true, true);
$xc = $ask($sh['S25'], 'pat', $sh['P26'])[1]['swap']['id'] ?? '';
check('fixture: another exchange', $xc !== '');
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
$t0 = microtime(true) + 1.5;
$res = array_map($collect, [$spawn('mark', 'POST', "$W/$xc/decide", $t0, ['status' => 'approved']), $spawn('olga', 'POST', "$W/$xc/decide", $t0, ['status' => 'approved'])]);
$outcomes = array_map(static fn (array $x): string => (string) ($x[1]['outcome'] ?? 'error'), $res);
sort($outcomes);
check('concurrency: two managers approve one exchange at once: one approves, the other finds it decided; moved exactly once', $outcomes === ['already-decided', 'approved'] && $holder($sh['S25']) === $staff['pat'] && $holder($sh['P26']) === $staff['sam'], json_encode($res));
check('tenancy: another organisation cannot see or decide it', call($api, 'zed', 'POST', "/orgs/$other/swaps/$xc/decide", ['status' => 'rejected'])[0] === 404 && call($api, 'zed', 'POST', "$W/$xc/decide", ['status' => 'rejected'])[0] === 404);
