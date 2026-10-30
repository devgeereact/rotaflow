<?php
declare(strict_types=1);

// Shift swaps (named colleague and open board) and claiming open shifts.
use RotaFlow\Db;

$api = test_api($pdo);
$org = call($api, 'olga', 'POST', '/orgs', ['name' => 'Swap Org'])[1]['org']['id'];
$other = call($api, 'zed', 'POST', '/orgs', ['name' => 'Elsewhere'])[1]['org']['id'];
$staff = [];
foreach (['mark' => 'manager', 'sam' => 'staff', 'pat' => 'staff', 'dee' => 'staff'] as $name => $role) {
    call($api, $name, 'GET', '/me');
    $pdo->prepare("INSERT INTO memberships (id, org_id, user_id, role, status) SELECT ?, ?, id, ?, 'active' FROM users WHERE email = ?")->execute([Db::uuid(), $org, $role, "$name@example.test"]);
    $staff[$name] = call($api, 'olga', 'POST', "/orgs/$org/staff", ['first_name' => ucfirst($name), 'email' => "$name@example.test"])[1]['id'];
}
$d = static fn (int $days, string $hm = '09:00'): string => gmdate('Y-m-d', time() + $days * 86400) . "T$hm:00Z";
$day = static fn (int $days): string => gmdate('Y-m-d', time() + $days * 86400);
$rota = call($api, 'mark', 'POST', "/orgs/$org/rotas", ['name' => 'Next week', 'period_start' => $day(3), 'period_end' => $day(12)])[1]['rota']['id'];
$mkShift = static fn (string $who, int $offset, string $status = 'assigned', ?string $rotaId = null) => call($GLOBALS['api'], 'mark', 'POST', "/orgs/{$GLOBALS['org']}/shifts", ['rota_id' => $rotaId ?? $GLOBALS['rota'], 'staff_profile_id' => $who === '' ? null : $GLOBALS['staff'][$who], 'starts_at' => $GLOBALS['d']($offset), 'ends_at' => $GLOBALS['d']($offset, '17:00'), 'status' => $status])[1]['shift']['id'];
$sh1 = $mkShift('sam', 4);
$sh2 = $mkShift('sam', 5);
$sh3 = $mkShift('sam', 6);
$sh4 = $mkShift('sam', 7);
$sh5 = $mkShift('sam', 8);
$shPat = $mkShift('pat', 4); // overlaps sh1 in time
$open1 = $mkShift('', 9, 'open');
$open2 = $mkShift('', 4, 'open'); // clashes with Pat's/Sam's day-4 shift
$cancelled = $mkShift('sam', 10, 'cancelled');
call($api, 'mark', 'POST', "/orgs/$org/rotas/$rota/publish");
// Fixture: a shift inside the already-published rota, which the API (rightly) refuses to create.
$directShift = static function (string $who, int $offset) use ($pdo, $org, $rota, $staff, $d): string {
    $id = Db::uuid();
    $pdo->prepare("INSERT INTO shifts (id, org_id, rota_id, staff_profile_id, starts_at, ends_at, status) VALUES (?, ?, ?, ?, ?, ?, 'assigned')")
        ->execute([$id, $org, $rota, $staff[$who], str_replace(['T', 'Z'], [' ', ''], $d($offset)), str_replace(['T', 'Z'], [' ', ''], $d($offset, '17:00'))]);
    return $id;
};
$swap = static fn (string $who, array $b) => call($GLOBALS['api'], $who, 'POST', "/orgs/{$GLOBALS['org']}/swaps", $b);

// ---- requesting ---------------------------------------------------------------------------------------------------
[$s, $r] = $swap('sam', ['shift_id' => $sh1, 'target_staff_profile_id' => $staff['pat'], 'note' => 'Dentist']);
check('a person offers their shift to a colleague', $s === 201 && $r['swap']['status'] === 'pending' && $r['swap']['requested_by'] === $staff['sam'] && $r['swap']['target_staff_profile_id'] === $staff['pat'], json_encode($r));
$w1 = $r['swap']['id'];
check('only a shift that is yours', $swap('pat', ['shift_id' => $sh2, 'target_staff_profile_id' => $staff['dee']])[0] === 422);
check('and not a cancelled one', $swap('sam', ['shift_id' => $cancelled, 'target_staff_profile_id' => $staff['pat']])[0] === 422);
check('not to yourself, nor to someone outside the organisation', $swap('sam', ['shift_id' => $sh2, 'target_staff_profile_id' => $staff['sam']])[0] === 422 && $swap('sam', ['shift_id' => $sh2, 'target_staff_profile_id' => Db::uuid()])[0] === 422);
check('not to someone who has left', (function () use ($api, $org, $staff, $swap, $sh2, $pdo): bool { $pdo->prepare('UPDATE staff_profiles SET active = 0 WHERE id = ?')->execute([$staff['dee']]); $s = $swap('sam', ['shift_id' => $sh2, 'target_staff_profile_id' => $staff['dee']])[0]; $pdo->prepare('UPDATE staff_profiles SET active = 1 WHERE id = ?')->execute([$staff['dee']]); return $s === 422; })());
check('a stranger gets 404', call($api, 'zed', 'POST', "/orgs/$org/swaps", ['shift_id' => $sh1])[0] === 404);
$cid = Db::uuid();
$a = $swap('sam', ['shift_id' => $sh2, 'target_staff_profile_id' => $staff['pat'], 'client_event_id' => $cid]);
$b = $swap('sam', ['shift_id' => $sh2, 'target_staff_profile_id' => $staff['pat'], 'client_event_id' => $cid]);
check('a replayed offline request answers 200 already_applied with the same swap', $a[0] === 201 && $b[0] === 200 && $b[1]['already_applied'] === true && $b[1]['swap']['id'] === $a[1]['swap']['id']);
$wReplay = $a[1]['swap']['id'];

// ---- visibility ----------------------------------------------------------------------------------------------------
check('the requester and the target see it', in_array($w1, array_column(call($api, 'sam', 'GET', "/orgs/$org/swaps")[1]['swaps'], 'id'), true) && in_array($w1, array_column(call($api, 'pat', 'GET', "/orgs/$org/swaps")[1]['swaps'], 'id'), true));
check('a third colleague does not', !in_array($w1, array_column(call($api, 'dee', 'GET', "/orgs/$org/swaps")[1]['swaps'], 'id'), true));
check('a manager sees all', in_array($w1, array_column(call($api, 'mark', 'GET', "/orgs/$org/swaps")[1]['swaps'], 'id'), true));
check('each swap carries its shift\'s times', call($api, 'sam', 'GET', "/orgs/$org/swaps")[1]['swaps'][0]['shift_starts_at'] !== null);

// ---- responding ---------------------------------------------------------------------------------------------------
check('someone other than the target cannot answer', call($api, 'dee', 'POST', "/orgs/$org/swaps/$w1/respond", ['status' => 'accepted'])[0] === 403 && call($api, 'sam', 'POST', "/orgs/$org/swaps/$w1/respond", ['status' => 'accepted'])[0] === 403);
check('an answer must be accepted or rejected', call($api, 'pat', 'POST', "/orgs/$org/swaps/$w1/respond", ['status' => 'approved'])[0] === 422);
check('the target accepts, which moves nothing yet', call($api, 'pat', 'POST', "/orgs/$org/swaps/$w1/respond", ['status' => 'accepted'])[1]['swap']['status'] === 'accepted' && $pdo->query("SELECT staff_profile_id FROM shifts WHERE id = '$sh1'")->fetchColumn() === $staff['sam']);
check('and cannot answer twice', call($api, 'pat', 'POST', "/orgs/$org/swaps/$w1/respond", ['status' => 'rejected'])[0] === 403);

// ---- deciding: the shift moves --------------------------------------------------------------------------------------
check('staff other than the requester cannot decide', call($api, 'dee', 'POST', "/orgs/$org/swaps/$w1/decide", ['status' => 'approved'])[0] === 403 && call($api, 'pat', 'POST', "/orgs/$org/swaps/$w1/decide", ['status' => 'approved'])[0] === 403);
check('a decision must be approved or rejected', call($api, 'mark', 'POST', "/orgs/$org/swaps/$w1/decide", ['status' => 'maybe'])[0] === 422);
[$s, $r] = call($api, 'mark', 'POST', "/orgs/$org/swaps/$w1/decide", ['status' => 'approved']);
check('a manager approves and the shift moves to the colleague in the published rota', $s === 200 && $r['outcome'] === 'approved' && $r['reassigned'] === true && $r['shift_id'] === $sh1, json_encode($r));
$moved = $pdo->query("SELECT staff_profile_id, status FROM shifts WHERE id = '$sh1'")->fetch();
check('the shift is the colleague\'s and assigned', $moved['staff_profile_id'] === $staff['pat'] && $moved['status'] === 'assigned');
check('the swap records when it moved the shift and from whom', $pdo->query("SELECT applied_from_staff_profile_id FROM shift_swaps WHERE id = '$w1'")->fetchColumn() === $staff['sam'] && $pdo->query("SELECT applied_at IS NOT NULL FROM shift_swaps WHERE id = '$w1'")->fetchColumn() == 1);
[$s, $r] = call($api, 'mark', 'POST', "/orgs/$org/swaps/$w1/decide", ['status' => 'approved']);
check('deciding again is harmless and says so', $s === 200 && $r['outcome'] === 'already-decided' && $r['reassigned'] === true);
check('the move is audited', (int) $pdo->query("SELECT COUNT(*) FROM audit_logs WHERE org_id = '$org' AND action = 'rota.shift_reassigned'")->fetchColumn() === 1);
check('an approved swap cannot be cancelled', call($api, 'sam', 'POST', "/orgs/$org/swaps/$w1/cancel")[1]['error']['code'] === 'cannot_cancel');
check('an approved swap cannot be reassigned twice', call($api, 'mark', 'POST', "/orgs/$org/swaps/$w1/reassign")[1]['error']['code'] === 'swap_already_applied');

// the requester finalises a swap the colleague accepted, without a manager
$w2 = $swap('sam', ['shift_id' => $sh3, 'target_staff_profile_id' => $staff['pat']])[1]['swap']['id'];
check('the requester cannot finalise before the colleague accepts', call($api, 'sam', 'POST', "/orgs/$org/swaps/$w2/decide", ['status' => 'approved'])[0] === 403);
call($api, 'pat', 'POST', "/orgs/$org/swaps/$w2/respond", ['status' => 'accepted']);
check('once accepted, the requester can finalise it themselves', call($api, 'sam', 'POST', "/orgs/$org/swaps/$w2/decide", ['status' => 'approved'])[1]['reassigned'] === true && $pdo->query("SELECT staff_profile_id FROM shifts WHERE id = '$sh3'")->fetchColumn() === $staff['pat']);

// rejection moves nothing
$w3 = $swap('sam', ['shift_id' => $sh4, 'target_staff_profile_id' => $staff['pat']])[1]['swap']['id'];
check('a manager can reject a pending swap; the shift stays', call($api, 'mark', 'POST', "/orgs/$org/swaps/$w3/decide", ['status' => 'rejected'])[1]['outcome'] === 'declined' && $pdo->query("SELECT staff_profile_id FROM shifts WHERE id = '$sh4'")->fetchColumn() === $staff['sam']);

// safety: nothing changes when a check fails
$w4 = $swap('sam', ['shift_id' => $sh5, 'target_staff_profile_id' => $staff['pat']])[1]['swap']['id'];
$pdo->prepare("UPDATE shifts SET staff_profile_id = ? WHERE id = ?")->execute([$staff['dee'], $sh5]); // someone else was given it meanwhile
[$s, $r] = call($api, 'mark', 'POST', "/orgs/$org/swaps/$w4/decide", ['status' => 'approved']);
check('if the shift is no longer the requester\'s the approval is refused and nothing changes', $s === 409 && $r['error']['code'] === 'shift_reassigned' && $pdo->query("SELECT status FROM shift_swaps WHERE id = '$w4'")->fetchColumn() === 'pending' && $pdo->query("SELECT staff_profile_id FROM shifts WHERE id = '$sh5'")->fetchColumn() === $staff['dee']);
$pdo->prepare("UPDATE shifts SET staff_profile_id = ? WHERE id = ?")->execute([$staff['sam'], $sh5]);
$pdo->prepare('UPDATE staff_profiles SET active = 0 WHERE id = ?')->execute([$staff['pat']]);
[$s, $r] = call($api, 'mark', 'POST', "/orgs/$org/swaps/$w4/decide", ['status' => 'approved']);
check('if the colleague has left, it is refused and stays pending', $s === 409 && $r['error']['code'] === 'target_inactive' && $pdo->query("SELECT status FROM shift_swaps WHERE id = '$w4'")->fetchColumn() === 'pending');
$pdo->prepare('UPDATE staff_profiles SET active = 1 WHERE id = ?')->execute([$staff['pat']]);
$pdo->prepare("UPDATE rotas SET status = 'archived' WHERE id = ?")->execute([$rota]);
[$s, $r] = call($api, 'mark', 'POST', "/orgs/$org/swaps/$w4/decide", ['status' => 'approved']);
check('a shift on an archived rota cannot be reassigned', $s === 409 && $r['error']['code'] === 'rota_archived' && $pdo->query("SELECT status FROM shift_swaps WHERE id = '$w4'")->fetchColumn() === 'pending');
$pdo->prepare("UPDATE rotas SET status = 'published' WHERE id = ?")->execute([$rota]);

// ---- the open board -----------------------------------------------------------------------------------------------
$wOpen = $swap('sam', ['shift_id' => $sh5, 'note' => 'Anyone?'])[1]['swap']['id'];
check('an open swap shows on the board to every member', in_array($wOpen, array_column(call($api, 'dee', 'GET', "/orgs/$org/swaps")[1]['swaps'], 'id'), true));
check('the requester cannot claim their own', call($api, 'sam', 'POST', "/orgs/$org/swaps/$wOpen/claim")[1]['error']['code'] === 'swap_unavailable');
check('a colleague claims it: they become the target and have accepted', call($api, 'dee', 'POST', "/orgs/$org/swaps/$wOpen/claim")[1]['swap']['status'] === 'accepted');
check('a second claim loses', call($api, 'pat', 'POST', "/orgs/$org/swaps/$wOpen/claim")[1]['error']['code'] === 'swap_unavailable');
check('a manager then approves and the shift moves', call($api, 'mark', 'POST', "/orgs/$org/swaps/$wOpen/decide", ['status' => 'approved'])[1]['reassigned'] === true && $pdo->query("SELECT staff_profile_id FROM shifts WHERE id = '$sh5'")->fetchColumn() === $staff['dee']);
$sh6 = $directShift('dee', 11);
$wNone = $swap('dee', ['shift_id' => $sh6])[1]['swap']['id'];
[, $r] = call($api, 'mark', 'POST', "/orgs/$org/swaps/$wNone/decide", ['status' => 'approved']);
check('an open swap nobody claimed is approved without moving anything', $r['outcome'] === 'approved' && $r['reassigned'] === false && $r['reason'] === 'no-target' && $pdo->query("SELECT staff_profile_id FROM shifts WHERE id = '$sh6'")->fetchColumn() === $staff['dee']);

// ---- cancelling ---------------------------------------------------------------------------------------------------
$sh7 = $directShift('sam', 12);
$w5 = $swap('sam', ['shift_id' => $sh7, 'target_staff_profile_id' => $staff['pat']])[1]['swap']['id'];
check('a colleague cannot cancel it', call($api, 'dee', 'POST', "/orgs/$org/swaps/$w5/cancel")[0] === 403);
check('the requester can', call($api, 'sam', 'POST', "/orgs/$org/swaps/$w5/cancel")[1]['swap']['status'] === 'cancelled');
check('once only', call($api, 'sam', 'POST', "/orgs/$org/swaps/$w5/cancel")[1]['error']['code'] === 'cannot_cancel');
check('a manager can cancel anyone\'s open request', (function () use ($api, $org, $swap, $sh7, $staff): bool { $w = $swap('sam', ['shift_id' => $sh7, 'target_staff_profile_id' => $staff['pat']])[1]['swap']['id']; return call($api, 'mark', 'POST', "/orgs/$org/swaps/$w/cancel")[1]['swap']['status'] === 'cancelled'; })());
check('a stranger gets 404 on every swap action', call($api, 'zed', 'POST', "/orgs/$org/swaps/$w5/cancel")[0] === 404 && call($api, 'zed', 'POST', "/orgs/$org/swaps/$w5/decide", ['status' => 'approved'])[0] === 404 && call($api, 'zed', 'GET', "/orgs/$org/swaps")[0] === 404);
check('another organisation\'s swap id through mine is 404', call($api, 'zed', 'POST', "/orgs/$other/swaps/$w5/cancel")[0] === 404);

// the retry endpoint moves a shift of an approved swap that never moved it
$sh8 = $directShift('sam', 13);
$wR = $swap('sam', ['shift_id' => $sh8, 'target_staff_profile_id' => $staff['pat']])[1]['swap']['id'];
$pdo->prepare("UPDATE shift_swaps SET status = 'approved' WHERE id = ?")->execute([$wR]);
check('reassigning is for the requester or a manager only', call($api, 'dee', 'POST', "/orgs/$org/swaps/$wR/reassign")[0] === 403);
check('an approved, unmoved swap can be reassigned', call($api, 'mark', 'POST', "/orgs/$org/swaps/$wR/reassign")[1]['shift_id'] === $sh8 && $pdo->query("SELECT staff_profile_id FROM shifts WHERE id = '$sh8'")->fetchColumn() === $staff['pat']);
check('a swap that is not approved cannot be reassigned', call($api, 'mark', 'POST', "/orgs/$org/swaps/$w3/reassign")[1]['error']['code'] === 'swap_not_approved');

// ---- open shifts ------------------------------------------------------------------------------------------------------
[, $r] = call($api, 'dee', 'GET', "/orgs/$org/open-shifts");
$ids = array_column($r['open_shifts'], 'shift_id');
check('open shifts on a published rota are listed, soonest first', $ids === [$open2, $open1] || $ids === [$open2, $open1], json_encode($ids));
check('the clash flag says which overlap my own work', array_column($r['open_shifts'], 'clashes_with_mine', 'shift_id')[$open1] === false);
check('cancelled and assigned shifts are not listed', !in_array($cancelled, $ids, true) && !in_array($sh1, $ids, true));
$draftRota = call($api, 'mark', 'POST', "/orgs/$org/rotas", ['name' => 'Draft', 'period_start' => $day(30), 'period_end' => $day(36)])[1]['rota']['id'];
$draftOpen = $mkShift('', 31, 'open', $draftRota);
check('open shifts on an unpublished rota are not offered, and cannot be claimed', !in_array($draftOpen, array_column(call($api, 'dee', 'GET', "/orgs/$org/open-shifts")[1]['open_shifts'], 'shift_id'), true) && call($api, 'dee', 'POST', "/orgs/$org/open-shifts/$draftOpen/claim")[1]['error']['code'] === 'not_published');
[$s, $r] = call($api, 'dee', 'POST', "/orgs/$org/open-shifts/$open1/claim");
check('a person claims an open shift and it becomes theirs', $s === 200 && $pdo->query("SELECT staff_profile_id FROM shifts WHERE id = '$open1'")->fetchColumn() === $staff['dee'] && $pdo->query("SELECT status FROM shifts WHERE id = '$open1'")->fetchColumn() === 'assigned');
[$s, $r] = call($api, 'pat', 'POST', "/orgs/$org/open-shifts/$open1/claim");
check('the second person to claim loses', $s === 409 && $r['error']['code'] === 'shift_taken', json_encode($r));
[$s, $r] = call($api, 'pat', 'POST', "/orgs/$org/open-shifts/$open2/claim");
check('a claim that overlaps your own work is refused', $s === 409 && $r['error']['code'] === 'already_working', json_encode($r));
$past = call($api, 'mark', 'POST', "/orgs/$org/rotas", ['name' => 'Past', 'period_start' => gmdate('Y-m-d', time() - 9 * 86400), 'period_end' => gmdate('Y-m-d', time() - 3 * 86400)])[1]['rota']['id'];
$pastOpen = $mkShift('', -5, 'open', $past);
call($api, 'mark', 'POST', "/orgs/$org/rotas/$past/publish");
check('a shift that has started cannot be claimed, and is not listed', call($api, 'dee', 'POST', "/orgs/$org/open-shifts/$pastOpen/claim")[1]['error']['code'] === 'already_started' && !in_array($pastOpen, array_column(call($api, 'dee', 'GET', "/orgs/$org/open-shifts")[1]['open_shifts'], 'shift_id'), true));
check('a member with no staff record cannot claim', (function () use ($api, $org, $pdo, $open2): bool { call($api, 'nora', 'GET', '/me'); $pdo->prepare("INSERT INTO memberships (id, org_id, user_id, role, status) SELECT ?, ?, id, 'staff', 'active' FROM users WHERE email = 'nora@example.test'")->execute([Db::uuid(), $org]); return call($api, 'nora', 'POST', "/orgs/$org/open-shifts/$open2/claim")[1]['error']['code'] === 'no_staff_record'; })());
check('a stranger gets 404', call($api, 'zed', 'POST', "/orgs/$org/open-shifts/$open2/claim")[0] === 404 && call($api, 'zed', 'GET', "/orgs/$org/open-shifts")[0] === 404);
check('a shift id from another organisation is 404', call($api, 'zed', 'POST', "/orgs/$other/open-shifts/$open2/claim")[0] === 404);
check('the claim is audited', (int) $pdo->query("SELECT COUNT(*) FROM audit_logs WHERE org_id = '$org' AND action = 'shift.claimed'")->fetchColumn() === 1);
check('the manager\'s badge counts the swaps still waiting', call($api, 'mark', 'GET', "/orgs/$org/attention")[1]['swaps_pending'] >= 1);
