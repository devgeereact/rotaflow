<?php
declare(strict_types=1);

// Cover (R2 slice S12): absence reports, cover requests, applications, approval with the organisation locked first and eligibility re-checked,
// direct assignment, the instant open-shift claim gaining the same eligibility check, swaps that void themselves, the sweep, erasure and the
// concurrency cases (two claims on one shift, two approvals on one shift, a claim waiting on the organisation lock). Ports SiteRelay's
// 030-cover and 095-workflow cases to RotaFlow's rotas, staff records and roles. The pure rules are suite 245-cover-rules.
use RotaFlow\{Db, Mod\Cover};

$api = test_api($pdo);
$org = call($api, 'olga', 'POST', '/orgs', ['name' => 'Cover Org'])[1]['org']['id'];
$other = call($api, 'zed', 'POST', '/orgs', ['name' => 'Elsewhere'])[1]['org']['id'];
$staff = [];
foreach (['mark' => 'manager', 'sam' => 'staff', 'pat' => 'staff', 'dee' => 'staff', 'eve' => 'staff', 'fay' => 'staff', 'gus' => 'staff'] as $who => $role) {
    call($api, $who, 'GET', '/me');
    $pdo->prepare("INSERT INTO memberships (id, org_id, user_id, role, status) SELECT ?, ?, id, ?, 'active' FROM users WHERE email = ?")->execute([Db::uuid(), $org, $role, "$who@example.test"]);
    $staff[$who] = call($api, 'olga', 'POST', "/orgs/$org/staff", ['first_name' => ucfirst($who), 'email' => "$who@example.test"])[1]['id'];
}
$staff['olga'] = $pdo->query("SELECT s.id FROM staff_profiles s JOIN users u ON u.id = s.user_id WHERE s.org_id = '$org' AND u.email = 'olga@example.test'")->fetchColumn();
$site = call($api, 'olga', 'POST', "/orgs/$org/locations", ['name' => 'Oak House', 'timezone' => 'Europe/London'])[1]['id'];
$day = static fn (int $n): string => gmdate('Y-m-d', time() + $n * 86400);
$at = static fn (int $n, string $hm = '09:00'): string => $day($n) . "T$hm:00Z";
$db = static fn (string $iso): string => str_replace(['T', 'Z'], [' ', ''], $iso);
$rota = call($api, 'mark', 'POST', "/orgs/$org/rotas", ['name' => 'Cover weeks', 'period_start' => $day(3), 'period_end' => $day(20), 'location_id' => $site])[1]['rota']['id'];
$mk = static function (string $who, int $n, string $a = '09:00', string $b = '17:00') use ($api, $org, $rota, $staff, $site, $at): string {
    [$s, $r] = call($api, 'mark', 'POST', "/orgs/$org/shifts", ['rota_id' => $rota, 'location_id' => $site, 'staff_profile_id' => $who === '' ? null : $staff[$who], 'starts_at' => $at($n, $a), 'ends_at' => $at($n, $b), 'status' => $who === '' ? 'open' : 'assigned']);
    return $s === 201 ? $r['shift']['id'] : 'failed ' . json_encode($r);
};
$sh = [
    'G' => $mk('sam', 3), 'O0' => $mk('', 16), // flag-off cases
    'A' => $mk('sam', 4), 'B' => $mk('sam', 5), 'O1' => $mk('', 6), 'O2' => $mk('', 7), 'O3' => $mk('', 8),
    'C' => $mk('sam', 9), 'D' => $mk('sam', 10), 'E' => $mk('sam', 11), 'O4' => $mk('', 12), 'O5' => $mk('', 13), 'O6' => $mk('', 14), 'F' => $mk('sam', 15),
    'O7' => $mk('', 17), 'H' => $mk('sam', 18), 'O8' => $mk('', 19),
];
check('fixtures: shifts created', count(array_filter($sh, static fn (string $v): bool => str_starts_with($v, 'failed'))) === 0, json_encode($sh));
check('fixtures: the rota publishes', call($api, 'mark', 'POST', "/orgs/$org/rotas/$rota/publish")[1]['rota']['status'] === 'published');
// dee is on approved leave for the whole period; eve has declared herself unavailable on days 4 and 6; fay lacks a required document.
$lv = call($api, 'mark', 'POST', "/orgs/$org/leave", ['staff_profile_id' => $staff['dee'], 'start_date' => $day(3), 'end_date' => $day(20)])[1]['leave']['id'];
call($api, 'mark', 'POST', "/orgs/$org/leave/$lv/review", ['status' => 'approved']);
foreach ([4, 6] as $n) {
    $pdo->prepare("INSERT INTO availability (id, org_id, staff_profile_id, date, status) VALUES (?, ?, ?, ?, 'unavailable')")->execute([Db::uuid(), $org, $staff['eve'], $day($n)]);
}
$dbs = Db::uuid();
$pdo->prepare("INSERT INTO document_types (id, org_id, name, required) VALUES (?, ?, 'DBS check', 1)")->execute([$dbs, $org]);
foreach (['olga', 'mark', 'sam', 'pat', 'dee', 'eve', 'gus'] as $who) {
    $pdo->prepare("INSERT INTO documents (id, org_id, staff_profile_id, document_type_id, type, name, file_url, status) VALUES (?, ?, ?, ?, 'DBS check', 'DBS', 'https://example.test/dbs.pdf', 'approved')")->execute([Db::uuid(), $org, $staff[$who], $dbs]);
}
$flag = static fn (bool $on) => $GLOBALS['pdo']->exec('UPDATE feature_flags SET enabled = ' . ($on ? 1 : 0) . ', rollout = ' . ($on ? 100 : 0) . " WHERE flag_key = 'cover_tools'");
$holder = static fn (string $id): ?string => $GLOBALS['pdo']->query("SELECT staff_profile_id FROM shifts WHERE id = '$id'")->fetchColumn() ?: null;
$outbox = static fn (string $event): int => (int) $GLOBALS['pdo']->query("SELECT COUNT(*) FROM notification_outbox WHERE org_id = '{$GLOBALS['org']}' AND event_name = '$event'")->fetchColumn();
$C = "/orgs/$org/cover";

// ---- with the module off, nothing changes ---------------------------------------------------------------------------------------------------
check('migration 017 seeds the flag off', $pdo->query("SELECT CONCAT(enabled, rollout) FROM feature_flags WHERE flag_key = 'cover_tools'")->fetchColumn() === '00');
check('off: every cover route answers 403 feature_off to a manager and to staff', call($api, 'mark', 'GET', "$C/overview")[1]['error']['code'] === 'feature_off' && call($api, 'sam', 'GET', "$C/mine")[1]['error']['code'] === 'feature_off' && call($api, 'sam', 'POST', "$C/absences", ['shift_id' => $sh['A'], 'reason' => 'Ill'])[1]['error']['code'] === 'feature_off' && call($api, 'mark', 'POST', "$C/requests", ['shift_id' => $sh['A']])[1]['error']['code'] === 'feature_off');
check('off: a stranger 404 and nobody 401 (membership before the flag)', call($api, 'zed', 'GET', "$C/overview")[0] === 404 && call($api, '', 'GET', "$C/overview")[0] === 401);
[$s, $r] = call($api, 'dee', 'POST', "/orgs/$org/open-shifts/{$sh['O0']}/claim");
check('off: the instant claim has no eligibility check (dee is on leave and still takes it, as before)', $s === 200 && $holder($sh['O0']) === $staff['dee'], json_encode($r));
$wOff = call($api, 'sam', 'POST', "/orgs/$org/swaps", ['shift_id' => $sh['G'], 'target_staff_profile_id' => $staff['pat']])[1]['swap'];
check('off: a swap response carries no new keys', !array_key_exists('shift_fingerprint', $wOff) && !array_key_exists('void_reason', $wOff) && !array_key_exists('shift_fingerprint', call($api, 'mark', 'GET', "/orgs/$org/swaps")[1]['swaps'][0]));
check('off: the fingerprint is still recorded, server side', strlen((string) $pdo->query("SELECT shift_fingerprint FROM shift_swaps WHERE id = '{$wOff['id']}'")->fetchColumn()) === 64);
$pdo->exec("UPDATE shifts SET ends_at = ends_at + INTERVAL 1 HOUR WHERE id = '{$sh['G']}'");
call($api, 'pat', 'POST', "/orgs/$org/swaps/{$wOff['id']}/respond", ['status' => 'accepted']);
[$s, $r] = call($api, 'mark', 'POST', "/orgs/$org/swaps/{$wOff['id']}/decide", ['status' => 'approved']);
check('off: a swap whose shift changed is approved exactly as before', $s === 200 && $r['reassigned'] === true && $holder($sh['G']) === $staff['pat'], json_encode($r));
$pl = call($api, 'pat', 'POST', "/orgs/$org/leave", ['start_date' => $day(30), 'end_date' => $day(30)])[1]['leave']['id'];
[$s, $r] = call($api, 'mark', 'POST', "/orgs/$org/leave/$pl/review", ['status' => 'rejected']);
check('off: a leave decision answers exactly as before', $s === 200 && array_keys($r) === ['leave'] && $r['leave']['status'] === 'rejected', json_encode($r));
check('off: the cron job sweeps nothing', str_contains(Cover::cron(test_ctx($pdo)), 'swept 0'));

// ---- absence reports ------------------------------------------------------------------------------------------------------------------------
$flag(true);
check('on: staff without a staff record cannot report', (function () use ($api, $org, $pdo, $C, $sh): bool { call($api, 'nora', 'GET', '/me'); $pdo->prepare("INSERT INTO memberships (id, org_id, user_id, role, status) SELECT ?, ?, id, 'staff', 'active' FROM users WHERE email = 'nora@example.test'")->execute([Db::uuid(), $org]); return call($api, 'nora', 'POST', "$C/absences", ['shift_id' => $sh['A'], 'reason' => 'Ill today'])[1]['error']['code'] === 'no_staff_record'; })());
check('absence: a reason is needed', call($api, 'sam', 'POST', "$C/absences", ['shift_id' => $sh['A'], 'reason' => 'x'])[0] === 422);
check('absence: only your own shift (someone else\'s is 404)', call($api, 'pat', 'POST', "$C/absences", ['shift_id' => $sh['A'], 'reason' => 'Not mine'])[0] === 404);
[$s, $r] = call($api, 'sam', 'POST', "$C/absences", ['shift_id' => $sh['A'], 'reason' => 'Childcare fell through']);
check('absence: sam reports he cannot work shift A; managers are told', $s === 201 && $r['absence']['status'] === 'open' && $outbox('cover/absence') === 1, json_encode($r));
$absA = $r['absence']['id'];
check('absence: once only while open', call($api, 'sam', 'POST', "$C/absences", ['shift_id' => $sh['A'], 'reason' => 'Again please'])[1]['error']['code'] === 'already_reported');
$mine = call($api, 'sam', 'GET', "$C/mine")[1];
check('mine: the upcoming shift carries its open report', array_column($mine['upcoming'], 'absence_id', 'id')[$sh['A']] === $absA && $mine['absences'][0]['id'] === $absA);
$absB = call($api, 'sam', 'POST', "$C/absences", ['shift_id' => $sh['B'], 'reason' => 'Doctor appointment'])[1]['absence']['id'];
check('absence: a colleague cannot withdraw it (404), sam can, and can report again', call($api, 'pat', 'POST', "$C/absences/$absB/withdraw")[0] === 404 && call($api, 'sam', 'POST', "$C/absences/$absB/withdraw")[1]['absence']['status'] === 'withdrawn' && call($api, 'sam', 'POST', "$C/absences", ['shift_id' => $sh['B'], 'reason' => 'Doctor after all'])[0] === 201);
$absB = $pdo->query("SELECT id FROM cover_absences WHERE shift_id = '{$sh['B']}' AND status = 'open'")->fetchColumn();
check('overview: staff 403; the manager sees both reports', call($api, 'sam', 'GET', "$C/overview")[0] === 403 && count(call($api, 'mark', 'GET', "$C/overview")[1]['absences']) === 2);
check('absence: staff cannot dismiss; the manager keeps sam on shift B and he is told', call($api, 'pat', 'POST', "$C/absences/$absB/dismiss")[0] === 403 && call($api, 'mark', 'POST', "$C/absences/$absB/dismiss")[1]['absence']['status'] === 'dismissed' && $holder($sh['B']) === $staff['sam'] && $outbox('cover/absence_dismissed') === 1);
check('absence: a dealt-with report is not dismissed twice', call($api, 'mark', 'POST', "$C/absences/$absB/dismiss")[1]['error']['code'] === 'not_open');

// ---- cover requests -------------------------------------------------------------------------------------------------------------------------
check('request: staff cannot open one', call($api, 'sam', 'POST', "$C/requests", ['shift_id' => $sh['A']])[0] === 403);
check('request: a deadline after the shift starts is refused', call($api, 'mark', 'POST', "$C/requests", ['shift_id' => $sh['A'], 'respond_by' => $at(5)])[0] === 422);
$before = $pdo->query("SELECT id, staff_profile_id, starts_at, ends_at, status FROM shifts WHERE rota_id = '$rota' AND id <> '{$sh['A']}' ORDER BY id")->fetchAll();
[$s, $r] = call($api, 'mark', 'POST', "$C/requests", ['shift_id' => $sh['A'], 'absence_id' => $absA, 'note' => 'Please help', 'respond_by' => $at(4, '07:00')]);
check('request: opened from the report; sam is off shift A, which is open on the published rota', $s === 201 && $r['request']['status'] === 'open' && $r['request']['absent_staff_profile_id'] === $staff['sam'] && $holder($sh['A']) === null && $pdo->query("SELECT status FROM shifts WHERE id = '{$sh['A']}'")->fetchColumn() === 'open', json_encode($r));
$reqA = $r['request']['id'];
check('request: only that shift changed; the rota stays published', $pdo->query("SELECT id, staff_profile_id, starts_at, ends_at, status FROM shifts WHERE rota_id = '$rota' AND id <> '{$sh['A']}' ORDER BY id")->fetchAll() === $before && $pdo->query("SELECT status FROM rotas WHERE id = '$rota'")->fetchColumn() === 'published' && (int) $pdo->query("SELECT COUNT(*) FROM rotas WHERE org_id = '$org'")->fetchColumn() === 1);
check('request: the report is marked covered, and sam is told he is off', $pdo->query("SELECT status FROM cover_absences WHERE id = '$absA'")->fetchColumn() === 'covered' && $outbox('cover/released') === 1);
check('request: offered to the eligible people with a login (gus, mark, olga, pat)', $r['offered'] === 4 && count(json_decode((string) $pdo->query("SELECT payload FROM notification_outbox WHERE event_name = 'cover/offered'")->fetchColumn(), true)['userIds']) === 4);
check('request: one open request per shift', call($api, 'mark', 'POST', "$C/requests", ['shift_id' => $sh['A']])[1]['error']['code'] === 'already_requested');
[$s, $r] = call($api, 'mark', 'GET', "$C/shifts/{$sh['A']}/candidates");
$cand = array_column($r['candidates'], null, 'staff_profile_id');
check('candidates: staff 403; a stranger 404', call($api, 'sam', 'GET', "$C/shifts/{$sh['A']}/candidates")[0] === 403 && call($api, 'zed', 'GET', "$C/shifts/{$sh['A']}/candidates")[0] === 404);
check('candidates: the absentee, leave, unavailability and documents each carry their reason', array_column($cand[$staff['sam']]['reasons'], 'code') === ['absent'] && array_column($cand[$staff['dee']]['reasons'], 'code') === ['leave'] && array_column($cand[$staff['eve']]['reasons'], 'code') === ['unavailable'] && array_column($cand[$staff['fay']]['reasons'], 'code') === ['documents'] && $cand[$staff['fay']]['reasons'][0]['message'] === 'Missing or expired: DBS check', json_encode($r['candidates']));
check('candidates: eligible people come first', array_column(array_slice($r['candidates'], 0, 4), 'eligible') === [true, true, true, true] && $r['candidates'][4]['eligible'] === false);
$open = array_column(call($api, 'dee', 'GET', "$C/open")[1]['shifts'], null, 'id');
check('open: staff see the request with their own eligibility', isset($open[$sh['A']]) && $open[$sh['A']]['cover_request']['id'] === $reqA && $open[$sh['A']]['eligible'] === false && $open[$sh['A']]['reasons'][0]['code'] === 'leave' && call($api, 'pat', 'GET', "$C/open")[1]['shifts'][0]['eligible'] === true);
check('claim: a shift with an open request is applied for, not grabbed (409 cover_request_open)', call($api, 'pat', 'POST', "/orgs/$org/open-shifts/{$sh['A']}/claim")[1]['error']['code'] === 'cover_request_open' && $holder($sh['A']) === null);

// ---- applications ----------------------------------------------------------------------------------------------------------------------------
[$s, $r] = call($api, 'dee', 'POST', "$C/shifts/{$sh['A']}/apply");
check('apply: someone on leave is refused with the reason', $s === 409 && $r['error']['code'] === 'not_eligible' && str_contains($r['error']['message'], 'On approved '), json_encode($r));
check('apply: the absentee cannot apply for the shift they gave up', str_contains((string) call($api, 'sam', 'POST', "$C/shifts/{$sh['A']}/apply")[1]['error']['message'], 'Said they cannot work this shift'));
check('apply: missing documents refuse it too', str_contains((string) call($api, 'fay', 'POST', "$C/shifts/{$sh['A']}/apply")[1]['error']['message'], 'Missing or expired: DBS check'));
[$s, $r] = call($api, 'pat', 'POST', "$C/shifts/{$sh['A']}/apply", ['note' => 'Happy to']);
check('apply: pat applies; managers are told', $s === 201 && $r['application']['status'] === 'pending' && $r['application']['cover_request_id'] === $reqA && $outbox('cover/applied') === 1, json_encode($r));
$appPat = $r['application']['id'];
check('apply: once while pending', call($api, 'pat', 'POST', "$C/shifts/{$sh['A']}/apply")[1]['error']['code'] === 'already_applied');
check('withdraw: not someone else\'s (404); pat withdraws and applies again on the same row', call($api, 'gus', 'POST', "$C/applications/$appPat/withdraw")[0] === 404 && call($api, 'pat', 'POST', "$C/applications/$appPat/withdraw")[1]['application']['status'] === 'withdrawn' && call($api, 'pat', 'POST', "$C/shifts/{$sh['A']}/apply")[1]['application']['id'] === $appPat);
$appGus = call($api, 'gus', 'POST', "$C/shifts/{$sh['A']}/apply")[1]['application']['id'];
$ov = call($api, 'mark', 'GET', "$C/overview")[1];
check('overview: the request lists both applicants with their eligibility', $ov['counts']['open_requests'] === 1 && count($ov['requests'][0]['applicants']) === 2 && $ov['requests'][0]['applicants'][0]['eligible'] === true, json_encode($ov['counts']));
check('approve: staff cannot', call($api, 'pat', 'POST', "$C/applications/$appPat/approve")[0] === 403);
[$s, $r] = call($api, 'mark', 'POST', "$C/applications/$appPat/approve");
check('approve: pat is on shift A, the request is filled, gus is turned down', $s === 200 && $r['application']['status'] === 'approved' && $holder($sh['A']) === $staff['pat'] && $pdo->query("SELECT CONCAT(status, '/', filled_staff_profile_id) FROM cover_requests WHERE id = '$reqA'")->fetchColumn() === 'filled/' . $staff['pat'] && $pdo->query("SELECT status FROM cover_applications WHERE id = '$appGus'")->fetchColumn() === 'rejected', json_encode($r));
check('approve: both people are told, and it is audited', $outbox('cover/approved') === 1 && $outbox('cover/filled') === 1 && (int) $pdo->query("SELECT COUNT(*) FROM audit_logs WHERE action = 'cover.filled' AND entity_id = '{$sh['A']}'")->fetchColumn() === 1);
check('approve: again is 409 not_pending, and so is the rejected one', call($api, 'mark', 'POST', "$C/applications/$appPat/approve")[1]['error']['code'] === 'not_pending' && call($api, 'mark', 'POST', "$C/applications/$appGus/approve")[1]['error']['code'] === 'not_pending');
check('approve: the shift is still on the one published rota, nothing else moved', $pdo->query("SELECT status FROM rotas WHERE id = '$rota'")->fetchColumn() === 'published' && $pdo->query("SELECT id, staff_profile_id, starts_at, ends_at, status FROM shifts WHERE rota_id = '$rota' AND id <> '{$sh['A']}' ORDER BY id")->fetchAll() === $before);

// Eligibility is re-checked inside the approval: gus applies for O2, then is put on leave that day; the approval refuses and changes nothing.
$reqO2 = call($api, 'mark', 'POST', "$C/requests", ['shift_id' => $sh['O2']])[1]['request']['id'];
$appGus2 = call($api, 'gus', 'POST', "$C/shifts/{$sh['O2']}/apply")[1]['application']['id'];
$gl = call($api, 'mark', 'POST', "/orgs/$org/leave", ['staff_profile_id' => $staff['gus'], 'start_date' => $day(7), 'end_date' => $day(7)])[1]['leave']['id'];
call($api, 'mark', 'POST', "/orgs/$org/leave/$gl/review", ['status' => 'approved']);
[$s, $r] = call($api, 'mark', 'POST', "$C/applications/$appGus2/approve");
check('approve: eligibility is re-checked at approval (gus is now on leave): 409, nothing changed', $s === 409 && $r['error']['code'] === 'not_eligible' && $holder($sh['O2']) === null && $pdo->query("SELECT status FROM cover_applications WHERE id = '$appGus2'")->fetchColumn() === 'pending', json_encode($r));
$pdo->prepare("INSERT INTO shifts (id, org_id, rota_id, location_id, staff_profile_id, starts_at, ends_at, status) VALUES (?, ?, NULL, ?, ?, ?, ?, 'assigned')")->execute([$loose = Db::uuid(), $org, $site, $staff['olga'], $db($at(7, '12:00')), $db($at(7, '13:00'))]);
check('assign: someone already working then is refused (overlap with a loose shift)', call($api, 'mark', 'POST', "$C/shifts/{$sh['O2']}/assign", ['staff_profile_id' => $staff['olga']])[1]['error']['code'] === 'not_eligible');
check('assign: a person from elsewhere is 422', call($api, 'mark', 'POST', "$C/shifts/{$sh['O2']}/assign", ['staff_profile_id' => Db::uuid()])[0] === 422);
[$s, $r] = call($api, 'mark', 'POST', "$C/shifts/{$sh['O2']}/assign", ['staff_profile_id' => $staff['mark']]);
check('assign: a manager puts an eligible person straight on (an approved application is recorded); the request is filled', $s === 200 && $r['application']['status'] === 'approved' && $holder($sh['O2']) === $staff['mark'] && $pdo->query("SELECT status FROM cover_requests WHERE id = '$reqO2'")->fetchColumn() === 'filled' && $pdo->query("SELECT status FROM cover_applications WHERE id = '$appGus2'")->fetchColumn() === 'rejected', json_encode($r));
check('assign: a filled shift cannot be filled again', call($api, 'mark', 'POST', "$C/shifts/{$sh['O2']}/assign", ['staff_profile_id' => $staff['pat']])[1]['error']['code'] === 'already_filled');
$appR = call($api, 'gus', 'POST', "$C/shifts/{$sh['O3']}/apply")[1]['application']['id'];
check('reject: the manager turns gus down for O3 and he is told', call($api, 'mark', 'POST', "$C/applications/$appR/reject")[1]['application']['status'] === 'rejected' && $outbox('cover/rejected') === 1 && call($api, 'mark', 'POST', "$C/applications/$appR/reject")[1]['error']['code'] === 'not_pending');
$reqO3 = call($api, 'mark', 'POST', "$C/requests", ['shift_id' => $sh['O3']])[1]['request']['id'];
check('cancel: closing a request leaves the shift open', call($api, 'mark', 'POST', "$C/requests/$reqO3/cancel")[1]['request']['status'] === 'cancelled' && $holder($sh['O3']) === null && $pdo->query("SELECT status FROM shifts WHERE id = '{$sh['O3']}'")->fetchColumn() === 'open' && call($api, 'mark', 'POST', "$C/requests/$reqO3/cancel")[1]['error']['code'] === 'not_open');
check('request: a shift on a draft rota is refused', (function () use ($api, $org, $C, $day, $at): bool { $d = call($api, 'mark', 'POST', "/orgs/$org/rotas", ['name' => 'Draft', 'period_start' => $day(40), 'period_end' => $day(46)])[1]['rota']['id']; $x = call($api, 'mark', 'POST', "/orgs/$org/shifts", ['rota_id' => $d, 'starts_at' => $at(41), 'ends_at' => $at(41, '17:00'), 'status' => 'open'])[1]['shift']['id']; return call($api, 'mark', 'POST', "$C/requests", ['shift_id' => $x])[1]['error']['code'] === 'not_published'; })());
$rev = call($api, 'mark', 'POST', "/orgs/$org/rotas/$rota/revision")[1]['rota']['id'];
check('request and assign: refused while the week has an open amendment (it would undo the change)', call($api, 'mark', 'POST', "$C/requests", ['shift_id' => $sh['H']])[1]['error']['code'] === 'open_amendment' && call($api, 'mark', 'POST', "$C/shifts/{$sh['O3']}/assign", ['staff_profile_id' => $staff['pat']])[1]['error']['code'] === 'open_amendment');
call($api, 'mark', 'POST', "/orgs/$org/rotas/$rev/discard");
check('fixture: the amendment is discarded', $pdo->query("SELECT COUNT(*) FROM rotas WHERE id = '$rev'")->fetchColumn() == 0 || $pdo->query("SELECT status FROM rotas WHERE id = '$rev'")->fetchColumn() !== 'draft');

// ---- the instant claim gains the eligibility check -------------------------------------------------------------------------------------------
check('claim: on leave is refused with the reason', str_contains((string) call($api, 'dee', 'POST', "/orgs/$org/open-shifts/{$sh['O1']}/claim")[1]['error']['message'], 'On approved '));
check('claim: declared unavailable is refused', call($api, 'eve', 'POST', "/orgs/$org/open-shifts/{$sh['O1']}/claim")[1]['error']['code'] === 'not_eligible');
check('claim: missing documents are refused', str_contains((string) call($api, 'fay', 'POST', "/orgs/$org/open-shifts/{$sh['O1']}/claim")[1]['error']['message'], 'Missing or expired: DBS check'));
check('claim: the existing checks still answer first (already working)', call($api, 'olga', 'POST', "/orgs/$org/open-shifts/{$sh['O1']}/claim")[0] === 200 && call($api, 'gus', 'POST', "/orgs/$org/open-shifts/{$sh['O1']}/claim")[1]['error']['code'] === 'shift_taken');

// ---- swaps void themselves --------------------------------------------------------------------------------------------------------------------
$w = call($api, 'sam', 'POST', "/orgs/$org/swaps", ['shift_id' => $sh['C'], 'target_staff_profile_id' => $staff['pat']])[1]['swap']['id'];
call($api, 'pat', 'POST', "/orgs/$org/swaps/$w/respond", ['status' => 'accepted']);
$pdo->exec("UPDATE shifts SET starts_at = starts_at + INTERVAL 1 HOUR WHERE id = '{$sh['C']}'");
[$s, $r] = call($api, 'mark', 'POST', "/orgs/$org/swaps/$w/decide", ['status' => 'approved']);
check('swap: the shift changed after it was raised, so approval cancels it (409 swap_void) and moves nothing', $s === 409 && $r['error']['code'] === 'swap_void' && $pdo->query("SELECT CONCAT(status, '/', void_reason) FROM shift_swaps WHERE id = '$w'")->fetchColumn() === 'cancelled/shift_changed' && $holder($sh['C']) === $staff['sam'], json_encode($r));
check('swap: both people are told, it is audited, and the list says why', $outbox('swap/voided') === 1 && (int) $pdo->query("SELECT COUNT(*) FROM audit_logs WHERE action = 'swap.voided' AND entity_id = '$w'")->fetchColumn() === 1 && array_column(call($api, 'sam', 'GET', "/orgs/$org/swaps")[1]['swaps'], 'void_reason', 'id')[$w] === 'shift_changed');
$w2 = call($api, 'sam', 'POST', "/orgs/$org/swaps", ['shift_id' => $sh['D'], 'target_staff_profile_id' => $staff['pat']])[1]['swap']['id'];
$pdo->exec("UPDATE shifts SET location_id = NULL WHERE id = '{$sh['D']}'");
check('swap: answering a stale swap cancels it too', call($api, 'pat', 'POST', "/orgs/$org/swaps/$w2/respond", ['status' => 'accepted'])[1]['error']['code'] === 'swap_void' && $pdo->query("SELECT status FROM shift_swaps WHERE id = '$w2'")->fetchColumn() === 'cancelled');
$w3 = call($api, 'sam', 'POST', "/orgs/$org/swaps", ['shift_id' => $sh['E']])[1]['swap']['id'];
$pdo->exec("UPDATE shifts SET starts_at = UTC_TIMESTAMP() - INTERVAL 1 HOUR WHERE id = '{$sh['E']}'");
$pdo->exec("UPDATE shift_swaps SET shift_fingerprint = NULL WHERE id = '$w3'"); // as if raised before fingerprints existed
check('swap: a started shift cancels a claim from the board (shift_started), even without a fingerprint', call($api, 'gus', 'POST', "/orgs/$org/swaps/$w3/claim")[1]['error']['code'] === 'swap_void' && $pdo->query("SELECT void_reason FROM shift_swaps WHERE id = '$w3'")->fetchColumn() === 'shift_started');
$w4 = call($api, 'sam', 'POST', "/orgs/$org/swaps", ['shift_id' => $sh['F'], 'target_staff_profile_id' => $staff['gus']])[1]['swap']['id'];
$w5 = call($api, 'sam', 'POST', "/orgs/$org/swaps", ['shift_id' => $sh['H'], 'target_staff_profile_id' => $staff['gus']])[1]['swap']['id'];
$pdo->exec("UPDATE shifts SET status = 'cancelled' WHERE id = '{$sh['F']}'");
check('sweep: cron cancels the stale swap nobody touched, and leaves the sound one', str_contains(Cover::cron(test_ctx($pdo)), 'swept 1') && $pdo->query("SELECT status FROM shift_swaps WHERE id = '$w4'")->fetchColumn() === 'cancelled' && $pdo->query("SELECT status FROM shift_swaps WHERE id = '$w5'")->fetchColumn() === 'pending');
call($api, 'gus', 'POST', "/orgs/$org/swaps/$w5/respond", ['status' => 'accepted']);
check('swap: an unchanged swap still approves and moves the shift', call($api, 'mark', 'POST', "/orgs/$org/swaps/$w5/decide", ['status' => 'approved'])[1]['reassigned'] === true && $holder($sh['H']) === $staff['gus']);

// ---- the sweep closes requests whose shift started ----------------------------------------------------------------------------------------
$reqO7 = call($api, 'mark', 'POST', "$C/requests", ['shift_id' => $sh['O7']])[1]['request']['id'];
$appO7 = call($api, 'pat', 'POST', "$C/shifts/{$sh['O7']}/apply")[1]['application']['id'];
$pdo->exec("UPDATE shifts SET starts_at = UTC_TIMESTAMP() - INTERVAL 1 HOUR WHERE id = '{$sh['O7']}'");
Cover::cron(test_ctx($pdo));
check('sweep: a request whose shift has started is closed, and its applications with it', $pdo->query("SELECT CONCAT(status, '/', close_reason) FROM cover_requests WHERE id = '$reqO7'")->fetchColumn() === 'cancelled/shift_started' && $pdo->query("SELECT status FROM cover_applications WHERE id = '$appO7'")->fetchColumn() === 'rejected');
check('sweep: idempotent', str_contains(Cover::cron(test_ctx($pdo)), 'swept 0'));

// ---- concurrency ------------------------------------------------------------------------------------------------------------------------------
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
// Two people claim one open shift at the same instant: exactly one wins.
$t0 = microtime(true) + 1.5;
$hs = [$spawn('pat', 'POST', "/orgs/$org/open-shifts/{$sh['O4']}/claim", $t0), $spawn('gus', 'POST', "/orgs/$org/open-shifts/{$sh['O4']}/claim", $t0), $spawn('mark', 'POST', "/orgs/$org/open-shifts/{$sh['O4']}/claim", $t0)];
$res = array_map($collect, $hs);
$codes = array_map(static fn (array $x): int => (int) $x[0], $res);
sort($codes);
check('concurrency: three claims on one shift at once, exactly one wins, the others get 409', $codes === [200, 409, 409] && in_array($holder($sh['O4']), [$staff['pat'], $staff['gus'], $staff['mark']], true), json_encode($res));
// Two managers approve two different applications for one shift at the same instant: exactly one is approved.
call($api, 'mark', 'POST', "$C/requests", ['shift_id' => $sh['O5']]);
$a1 = call($api, 'pat', 'POST', "$C/shifts/{$sh['O5']}/apply")[1]['application']['id'];
$a2 = call($api, 'gus', 'POST', "$C/shifts/{$sh['O5']}/apply")[1]['application']['id'];
$t0 = microtime(true) + 1.5;
$res = array_map($collect, [$spawn('mark', 'POST', "$C/applications/$a1/approve", $t0), $spawn('olga', 'POST', "$C/applications/$a2/approve", $t0)]);
$codes = array_map(static fn (array $x): int => (int) $x[0], $res);
sort($codes);
check('concurrency: two approvals for one shift at once, exactly one goes through', $codes === [200, 409] && (int) $pdo->query("SELECT COUNT(*) FROM cover_applications WHERE shift_id = '{$sh['O5']}' AND status = 'approved'")->fetchColumn() === 1, json_encode($res));
// The organisation row is the first lock: while another connection holds it, a claim waits rather than going ahead.
$lock = Db::connect(['dsn' => "mysql:host=$host;port=$port;dbname=$name;charset=utf8mb4", 'user' => $user, 'password' => $pass]);
$lock->beginTransaction();
$lock->prepare('SELECT id FROM organisations WHERE id = ? FOR UPDATE')->execute([$org]);
$h = $spawn('pat', 'POST', "/orgs/$org/open-shifts/{$sh['O6']}/claim", microtime(true));
usleep(2500000);
$waiting = proc_get_status($h[0])['running'];
// Waiting at the FIRST lock means it has not touched the shift row yet: a third connection can still lock the shift without waiting.
$probe = Db::connect(['dsn' => "mysql:host=$host;port=$port;dbname=$name;charset=utf8mb4", 'user' => $user, 'password' => $pass]);
$probe->beginTransaction();
try {
    $probe->query("SELECT id FROM shifts WHERE id = '{$sh['O6']}' FOR UPDATE NOWAIT")->fetchAll();
    $shiftFree = true;
} catch (PDOException) {
    $shiftFree = false;
}
$probe->rollBack();
$lock->rollBack();
$r = $collect($h);
check('concurrency: a claim waits on the organisation lock BEFORE it locks the shift, then goes through', $waiting && $shiftFree && $r[0] === 200 && $holder($sh['O6']) === $staff['pat'], json_encode([$waiting, $shiftFree, $r]));
// The same for an approval.
call($api, 'mark', 'POST', "$C/requests", ['shift_id' => $sh['O3']]);
$a3 = call($api, 'gus', 'POST', "$C/shifts/{$sh['O3']}/apply")[1]['application']['id'];
$lock->beginTransaction();
$lock->prepare('SELECT id FROM organisations WHERE id = ? FOR UPDATE')->execute([$org]);
$h = $spawn('mark', 'POST', "$C/applications/$a3/approve", microtime(true));
usleep(2500000);
$waiting = proc_get_status($h[0])['running'];
$probe->beginTransaction();
try {
    $probe->query("SELECT id FROM shifts WHERE id = '{$sh['O3']}' FOR UPDATE NOWAIT")->fetchAll();
    $shiftFree = true;
} catch (PDOException) {
    $shiftFree = false;
}
$probe->rollBack();
$lock->rollBack();
$r = $collect($h);
check('concurrency: an approval waits on the organisation lock before the shift, then goes through', $waiting && $shiftFree && $r[0] === 200 && $holder($sh['O3']) === $staff['gus'], json_encode([$waiting, $shiftFree, $r]));

// ---- erasure, tenancy, and off again -----------------------------------------------------------------------------------------------------------
call($api, 'olga', 'POST', "/orgs/$org/staff/{$staff['sam']}/erase");
check('erasure: what sam wrote in his absence reports is removed; the record stays', (int) $pdo->query("SELECT COUNT(*) FROM cover_absences WHERE staff_profile_id = '{$staff['sam']}' AND reason <> '(removed)'")->fetchColumn() === 0 && (int) $pdo->query("SELECT COUNT(*) FROM cover_absences WHERE staff_profile_id = '{$staff['sam']}'")->fetchColumn() >= 2);
check('tenancy: another organisation cannot reach these records through its own id', call($api, 'zed', 'POST', "/orgs/$other/cover/applications/$appPat/approve")[0] === 403 || call($api, 'zed', 'POST', "/orgs/$other/cover/applications/$appPat/approve")[0] === 404);
$flag(true);
$pdo->exec("UPDATE feature_flags SET enabled = 1, rollout = 100 WHERE flag_key = 'cover_tools'");
$pdo->prepare('INSERT INTO feature_flag_targets (flag_key, org_id) VALUES (?, ?)')->execute(['cover_tools', $other]);
check('tenancy: with the module on there too, another organisation\'s ids are 404 through its own path', call($api, 'zed', 'POST', "/orgs/$other/cover/applications/$appPat/approve")[0] === 404 && call($api, 'zed', 'GET', "/orgs/$other/cover/shifts/{$sh['A']}/candidates")[0] === 404);
$flag(false);
check('off again: routes 403 feature_off, and the claim is as before (dee, on leave, takes it)', call($api, 'mark', 'GET', "$C/overview")[1]['error']['code'] === 'feature_off' && call($api, 'dee', 'POST', "/orgs/$org/open-shifts/{$sh['O1']}/claim")[0] === 409 && call($api, 'dee', 'POST', "/orgs/$org/open-shifts/{$sh['O8']}/claim")[0] === 200);
$pdo->exec("DELETE FROM feature_flags WHERE flag_key = 'cover_tools'");
check('a missing flag row reads as off (fails closed)', call($api, 'mark', 'GET', "$C/overview")[1]['error']['code'] === 'feature_off');
