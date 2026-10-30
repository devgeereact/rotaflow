<?php
declare(strict_types=1);

// The support desk: cases, replies, internal notes, status, assignment, rating and the response/resolution promises.
use RotaFlow\{Db, SupportRules as S};

// ---- pure decisions -------------------------------------------------------------------------------------------------------
check('references are CASE- and four digits, and a fifth digit is kept, never cut', S::reference(4120) === 'CASE-4120' && S::reference(7) === 'CASE-0007' && S::reference(12345) === 'CASE-12345');
check('deadlines hang off the creation time', S::deadlines('2030-01-01 09:00:00', ['first_response_minutes' => 60, 'resolution_minutes' => 240]) === ['first_response_due_at' => '2030-01-01 10:00:00', 'resolution_due_at' => '2030-01-01 13:00:00']);
check('with no target the fallback is a day and three days', S::deadlines('2030-01-01 00:00:00', null) === ['first_response_due_at' => '2030-01-02 00:00:00', 'resolution_due_at' => '2030-01-04 00:00:00']);
$t0 = strtotime('2030-01-01 09:00:00 UTC');
$case = static fn (array $o = []): array => $o + ['first_response_at' => null, 'first_response_due_at' => '2030-01-01 10:00:00', 'resolved_at' => null, 'resolution_due_at' => '2030-01-01 13:00:00'];
check('unanswered and early is on track', S::slaState($case(), $t0)['first_response_state'] === 'on_track' && S::slaState($case(), $t0)['minutes_to_respond'] === 60);
check('inside the last 30 minutes it is due soon', S::slaState($case(), $t0 + 31 * 60)['first_response_state'] === 'due_soon' && S::slaState($case(), $t0 + 29 * 60)['first_response_state'] === 'on_track');
check('past the promise unanswered is breached, and the minutes go negative', S::slaState($case(), $t0 + 3700)['first_response_state'] === 'breached' && S::slaState($case(), $t0 + 7200)['minutes_to_respond'] === -60);
check('exactly on the deadline is not yet breached', S::slaState($case(), strtotime('2030-01-01 10:00:00 UTC'))['first_response_state'] === 'due_soon');
check('answered in time is met; answered late is breached for good', S::slaState($case(['first_response_at' => '2030-01-01 10:00:00']), $t0 + 99999)['first_response_state'] === 'met' && S::slaState($case(['first_response_at' => '2030-01-01 10:00:01']), $t0)['first_response_state'] === 'breached');
check('resolution is met, breached or on track', S::slaState($case(['resolved_at' => '2030-01-01 12:00:00']), $t0)['resolution_state'] === 'met' && S::slaState($case(['resolved_at' => '2030-01-01 14:00:00']), $t0)['resolution_state'] === 'breached' && S::slaState($case(), $t0 + 4 * 3600 + 60)['resolution_state'] === 'breached' && S::slaState($case(), $t0)['resolution_state'] === 'on_track');
check('minutes round to the nearest, as the old cast did', S::slaState($case(), $t0 + 1790)['minutes_to_respond'] === 30 && S::slaState($case(), $t0 + 1770)['minutes_to_respond'] === 31);

// ---- fixtures -------------------------------------------------------------------------------------------------------------
$api = test_api($pdo);
$role = static function (string $who, string $r) use ($pdo, &$api): void {
    call($api, $who, 'GET', '/me');
    $pdo->prepare('INSERT INTO platform_admins (user_id, role) SELECT id, ? FROM users WHERE email = ?')->execute([$r, "$who@example.test"]);
};
$role('sue', 'platform_support');
$role('adam', 'platform_admin');
$role('fin', 'platform_finance');
$org = call($api, 'olga', 'POST', '/orgs', ['name' => 'Desk Org'])[1]['org']['id'];
$other = call($api, 'zed', 'POST', '/orgs', ['name' => 'Elsewhere'])[1]['org']['id'];
foreach (['mark' => 'manager', 'sam' => 'staff'] as $n => $r) {
    call($api, $n, 'GET', '/me');
    $pdo->prepare("INSERT INTO memberships (id, org_id, user_id, role, status) SELECT ?, ?, id, ?, 'active' FROM users WHERE email = ?")->execute([Db::uuid(), $org, $r, "$n@example.test"]);
}
$open = static fn (string $who, array $b = []) => call($GLOBALS['api'], $who, 'POST', '/support/cases', $b + ['subject' => 'Cannot publish', 'body' => 'The publish button does nothing.', 'category' => 'bug']);
$uid = static fn (string $who): string => (string) $GLOBALS['pdo']->query("SELECT id FROM users WHERE email = '$who@example.test'")->fetchColumn();

// ---- opening --------------------------------------------------------------------------------------------------------------
check('signing in is required', call($api, '', 'POST', '/support/cases', ['subject' => 'x', 'body' => 'y'])[0] === 401);
[$s, $r] = $open('sam', ['org_id' => $org]);
check('a member opens a case; it gets the next reference and a first message', $s === 201 && $r['reference'] === 'CASE-4120' && (int) $pdo->query("SELECT COUNT(*) FROM support_case_messages WHERE case_id = '{$r['id']}' AND author_side = 'customer'")->fetchColumn() === 1, json_encode($r));
$c1 = $r['id'];
check('the next case gets the next number', $open('sam')[1]['reference'] === 'CASE-4121');
check('a case for an organisation you are not in is refused', $open('sam', ['org_id' => $other])[0] === 403 && $open('sam', ['org_id' => '99999999-9999-4999-8999-999999999999'])[0] === 403);
check('an organisation-less case is allowed', $open('nora')[0] === 201);
foreach ([['subject' => ''], ['body' => ''], ['category' => 'rant'], ['priority' => 'asap'], ['subject' => str_repeat('x', 201)], ['body' => ['a']]] as $i => $bad) {
    check("a bad case is 422 ($i)", $open('sam', $bad)[0] === 422);
}
$row = $pdo->query("SELECT * FROM support_cases WHERE id = '$c1'")->fetch();
check('the deadlines come from the priority, anchored on creation', strtotime($row['first_response_due_at'] . ' UTC') - strtotime($row['created_at'] . ' UTC') === 1440 * 60 && strtotime($row['resolution_due_at'] . ' UTC') - strtotime($row['created_at'] . ' UTC') === 4320 * 60);
check('a customer cannot choose another requester', ($x = $open('sam', ['requester_email' => 'boss@example.test'])[1]['id']) && $pdo->query("SELECT requester_email FROM support_cases WHERE id = '$x'")->fetchColumn() === 'sam@example.test');
$sc = $open('sue', ['requester_email' => 'Customer@Example.test', 'org_id' => $other, 'priority' => 'urgent']);
check('staff open a case for a customer: the email is theirs to set, the first message is the platform\'s, the requester stays the staff member', $sc[0] === 201 && ($q = $pdo->query("SELECT requester_email, requester_id, priority FROM support_cases WHERE id = '{$sc[1]['id']}'")->fetch()) && $q['requester_email'] === 'customer@example.test' && $q['requester_id'] === $uid('sue') && $q['priority'] === 'urgent' && $pdo->query("SELECT author_side FROM support_case_messages WHERE case_id = '{$sc[1]['id']}'")->fetchColumn() === 'platform');
check('urgent is promised within the hour', (strtotime($pdo->query("SELECT first_response_due_at FROM support_cases WHERE id = '{$sc[1]['id']}'")->fetchColumn() . ' UTC') - time()) < 3700);
check('opening a case is audited to the organisation', (int) $pdo->query("SELECT COUNT(*) FROM audit_logs WHERE action = 'support_case.opened' AND org_id = '$org' AND visibility = 'org'")->fetchColumn() === 1);

// ---- who can see a case -----------------------------------------------------------------------------------------------------
check('the requester sees it and its messages', ($v = call($api, 'sam', 'GET', "/support/cases/$c1"))[0] === 200 && count($v[1]['messages']) === 1 && isset($v[1]['sla']['first_response_state']) && !isset($v[1]['case']['assigned_to']));
check('an owner of the organisation sees it', call($api, 'olga', 'GET', "/support/cases/$c1")[0] === 200);
check('a manager, a colleague, a stranger and finance all get 404 - not 403, and not different from a case that does not exist', call($api, 'mark', 'GET', "/support/cases/$c1")[0] === 404 && call($api, 'zed', 'GET', "/support/cases/$c1")[0] === 404 && call($api, 'fin', 'GET', "/support/cases/$c1")[0] === 404 && call($api, 'zed', 'GET', '/support/cases/99999999-9999-4999-8999-999999999999')[0] === 404);
check('the list is mine plus my organisation\'s if I own it', count(call($api, 'sam', 'GET', '/support/cases')[1]['cases']) === 3 && count(call($api, 'olga', 'GET', '/support/cases')[1]['cases']) === 1 && count(call($api, 'mark', 'GET', '/support/cases')[1]['cases']) === 0);
check('staff see it, with the assignee', call($api, 'sue', 'GET', "/support/cases/$c1")[0] === 200 && array_key_exists('assigned_to', call($api, 'sue', 'GET', "/support/cases/$c1")[1]['case']));

// ---- replying -----------------------------------------------------------------------------------------------------------------
check('a stranger cannot reply (404)', call($api, 'zed', 'POST', "/support/cases/$c1/reply", ['body' => 'hi'])[0] === 404);
check('an empty reply is 422', call($api, 'sam', 'POST', "/support/cases/$c1/reply", ['body' => '  '])[0] === 422);
check('a customer reply changes neither status nor first response', call($api, 'sam', 'POST', "/support/cases/$c1/reply", ['body' => 'Any news?'])[0] === 201 && $pdo->query("SELECT CONCAT(status, ':', IFNULL(first_response_at, 'none')) FROM support_cases WHERE id = '$c1'")->fetchColumn() === 'open:none');
check('a customer cannot write an internal note', call($api, 'sam', 'POST', "/support/cases/$c1/reply", ['body' => 'x', 'internal' => true])[0] === 403 && call($api, 'sam', 'POST', "/support/cases/$c1/reply", ['body' => 'x', 'internal' => 'yes'])[0] === 422);
check('an internal note neither answers the customer nor starts the clock', call($api, 'sue', 'POST', "/support/cases/$c1/reply", ['body' => 'Looks like the cache', 'internal' => true])[0] === 201 && $pdo->query("SELECT status FROM support_cases WHERE id = '$c1'")->fetchColumn() === 'open' && (int) $pdo->query("SELECT COUNT(*) FROM notification_outbox WHERE event_name = 'support/replied'")->fetchColumn() === 0);
check('internal notes are hidden from the requester and the organisation\'s owner but not from staff', count(call($api, 'sam', 'GET', "/support/cases/$c1")[1]['messages']) === 2 && count(call($api, 'olga', 'GET', "/support/cases/$c1")[1]['messages']) === 2 && count(call($api, 'sue', 'GET', "/support/cases/$c1")[1]['messages']) === 3);
check('and a note is audited to the platform only', (int) $pdo->query("SELECT COUNT(*) FROM audit_logs WHERE action = 'support_case.note' AND visibility = 'platform_only'")->fetchColumn() === 1);
check('finance is not support staff and cannot reply', call($api, 'fin', 'POST', "/support/cases/$c1/reply", ['body' => 'x'])[0] === 404);
check('the first public reply by staff records the response and moves open to pending', call($api, 'sue', 'POST', "/support/cases/$c1/reply", ['body' => 'We are looking into it.'])[0] === 201 && $pdo->query("SELECT status FROM support_cases WHERE id = '$c1'")->fetchColumn() === 'pending' && $pdo->query("SELECT first_response_at FROM support_cases WHERE id = '$c1'")->fetchColumn() !== null);
$first = $pdo->query("SELECT first_response_at FROM support_cases WHERE id = '$c1'")->fetchColumn();
$pdo->exec("UPDATE support_cases SET status = 'on_hold' WHERE id = '$c1'");
call($api, 'adam', 'POST', "/support/cases/$c1/reply", ['body' => 'Update.']);
check('a later reply never moves the first response or the status', $pdo->query("SELECT first_response_at FROM support_cases WHERE id = '$c1'")->fetchColumn() === $first && $pdo->query("SELECT status FROM support_cases WHERE id = '$c1'")->fetchColumn() === 'on_hold');
$n = $pdo->query("SELECT payload FROM notification_outbox WHERE event_name = 'support/replied' ORDER BY created_at LIMIT 1")->fetchColumn();
check('the requester is told of a public reply, with the reference in the title', (int) $pdo->query("SELECT COUNT(*) FROM notification_outbox WHERE event_name = 'support/replied'")->fetchColumn() === 2 && str_contains((string) $n, 'Reply on CASE-4120') && str_contains((string) $n, $uid('sam')));

// ---- status -----------------------------------------------------------------------------------------------------------------
check('only support, admin and owner set status', call($api, 'sam', 'POST', "/platform/support/cases/$c1/status", ['status' => 'resolved'])[0] === 404 && call($api, 'fin', 'POST', "/platform/support/cases/$c1/status", ['status' => 'resolved'])[0] === 404);
check('an unknown status is 422 and an unknown case 404', call($api, 'sue', 'POST', "/platform/support/cases/$c1/status", ['status' => 'wibble'])[0] === 422 && call($api, 'sue', 'POST', '/platform/support/cases/99999999-9999-4999-8999-999999999999/status', ['status' => 'closed'])[0] === 404);
check('resolving stamps the time and can leave an internal note', call($api, 'sue', 'POST', "/platform/support/cases/$c1/status", ['status' => 'resolved', 'note' => 'Fixed in release'])[0] === 200 && $pdo->query("SELECT resolved_at FROM support_cases WHERE id = '$c1'")->fetchColumn() !== null && (int) $pdo->query("SELECT COUNT(*) FROM support_case_messages WHERE case_id = '$c1' AND is_internal = 1 AND body = 'Fixed in release'")->fetchColumn() === 1);
$pdo->exec("UPDATE support_cases SET resolved_at = DATE_SUB(resolved_at, INTERVAL 1 HOUR) WHERE id = '$c1'"); // so an overwrite could not hide inside the same second
$resolvedAt = $pdo->query("SELECT resolved_at FROM support_cases WHERE id = '$c1'")->fetchColumn();
call($api, 'sue', 'POST', "/platform/support/cases/$c1/status", ['status' => 'closed']);
check('closing keeps the first resolution time', $pdo->query("SELECT resolved_at FROM support_cases WHERE id = '$c1'")->fetchColumn() === $resolvedAt);
check('status changes are audited to the platform only, with before and after', ($a = $pdo->query("SELECT metadata FROM audit_logs WHERE action = 'support_case.closed'")->fetchColumn()) && str_contains($a, '"before": "resolved"') || str_contains((string) $a, '"before":"resolved"'));

// ---- rating -------------------------------------------------------------------------------------------------------------------
check('only the requester rates', call($api, 'olga', 'POST', "/support/cases/$c1/rate", ['score' => 5])[0] === 403 && call($api, 'sue', 'POST', "/support/cases/$c1/rate", ['score' => 5])[0] === 403 && call($api, 'zed', 'POST', "/support/cases/$c1/rate", ['score' => 5])[0] === 404);
foreach ([0, 6, '5', 4.5, null] as $bad) { check('score ' . json_encode($bad) . ' is 422', call($api, 'sam', 'POST', "/support/cases/$c1/rate", ['score' => $bad])[0] === 422); }
check('the requester rates a resolved case; a blank comment is nothing', call($api, 'sam', 'POST', "/support/cases/$c1/rate", ['score' => 4, 'comment' => '  '])[0] === 200 && (int) $pdo->query("SELECT csat FROM support_cases WHERE id = '$c1'")->fetchColumn() === 4 && $pdo->query("SELECT csat_comment FROM support_cases WHERE id = '$c1'")->fetchColumn() === null);
check('re-rating overwrites', call($api, 'sam', 'POST', "/support/cases/$c1/rate", ['score' => 2, 'comment' => 'slow'])[0] === 200 && (int) $pdo->query("SELECT csat FROM support_cases WHERE id = '$c1'")->fetchColumn() === 2);
call($api, 'sue', 'POST', "/platform/support/cases/$c1/status", ['status' => 'open']);
check('reopening clears the resolution time and keeps the rating', $pdo->query("SELECT resolved_at FROM support_cases WHERE id = '$c1'")->fetchColumn() === null && (int) $pdo->query("SELECT csat FROM support_cases WHERE id = '$c1'")->fetchColumn() === 2);
check('an unresolved case cannot be rated', ($r2 = call($api, 'sam', 'POST', "/support/cases/$c1/rate", ['score' => 5]))[0] === 422 && $r2[1]['error']['code'] === 'not_resolved');

// ---- assignment and the queue -----------------------------------------------------------------------------------------------------
check('a case can be assigned to platform staff of any role, never to a customer', call($api, 'sue', 'POST', "/platform/support/cases/$c1/assign", ['agent_user_id' => $uid('adam')])[0] === 200 && call($api, 'sue', 'POST', "/platform/support/cases/$c1/assign", ['agent_user_id' => $uid('sam')])[0] === 422 && call($api, 'sue', 'POST', "/platform/support/cases/$c1/assign", ['agent_user_id' => $uid('fin')])[0] === 200);
check('unassigning is allowed, and customers cannot assign', call($api, 'sue', 'POST', "/platform/support/cases/$c1/assign", ['agent_user_id' => null])[0] === 200 && call($api, 'sam', 'POST', "/platform/support/cases/$c1/assign", [])[0] === 404);
call($api, 'sue', 'POST', "/platform/support/cases/$c1/assign", ['agent_user_id' => $uid('sue')]);
[$s, $q] = call($api, 'adam', 'GET', '/platform/support/cases');
check('the queue lists every case, urgent first, each with its SLA state', $s === 200 && count($q['cases']) === 5 && $q['cases'][0]['priority'] === 'urgent' && isset($q['cases'][0]['sla']['resolution_state']));
check('the queue filters and refuses nonsense', count(call($api, 'adam', 'GET', '/platform/support/cases?assigned=me')[1]['cases']) === 0 && count(call($api, 'sue', 'GET', '/platform/support/cases?assigned=me')[1]['cases']) === 1 && count(call($api, 'adam', 'GET', '/platform/support/cases?priority=urgent')[1]['cases']) === 1 && count(call($api, 'adam', 'GET', '/platform/support/cases?q=CASE-4121')[1]['cases']) === 1 && call($api, 'adam', 'GET', '/platform/support/cases?status=wibble')[0] === 422 && call($api, 'adam', 'GET', '/platform/support/cases?assigned=bob')[0] === 422);
check('customers and finance cannot read the queue', call($api, 'sam', 'GET', '/platform/support/cases')[0] === 404 && call($api, 'fin', 'GET', '/platform/support/cases')[0] === 404);
check('a search for a wildcard matches nothing', count(call($api, 'adam', 'GET', '/platform/support/cases?q=%25')[1]['cases']) === 0);

// ---- the promises ---------------------------------------------------------------------------------------------------------------------
check('staff read the targets; customers cannot', count(call($api, 'sue', 'GET', '/platform/support/sla')[1]['targets']) === 4 && call($api, 'sam', 'GET', '/platform/support/sla')[0] === 404);
check('only owner and admin change them; finance and support cannot', call($api, 'sue', 'POST', '/platform/support/sla', ['priority' => 'low', 'first_response_minutes' => 60, 'resolution_minutes' => 120])[0] === 404 && call($api, 'fin', 'POST', '/platform/support/sla', ['priority' => 'low', 'first_response_minutes' => 60, 'resolution_minutes' => 120])[0] === 404);
check('resolution may not be shorter than the first response', call($api, 'adam', 'POST', '/platform/support/sla', ['priority' => 'low', 'first_response_minutes' => 120, 'resolution_minutes' => 60])[0] === 422 && call($api, 'adam', 'POST', '/platform/support/sla', ['priority' => 'low', 'first_response_minutes' => 0, 'resolution_minutes' => 60])[0] === 422);
check('a change applies to cases opened afterwards', call($api, 'adam', 'POST', '/platform/support/sla', ['priority' => 'low', 'first_response_minutes' => 30, 'resolution_minutes' => 90])[0] === 200 && ($lo = $open('sam', ['priority' => 'low'])[1]['id']) && strtotime($pdo->query("SELECT first_response_due_at FROM support_cases WHERE id = '$lo'")->fetchColumn() . ' UTC') - strtotime($pdo->query("SELECT created_at FROM support_cases WHERE id = '$lo'")->fetchColumn() . ' UTC') === 1800);
check('the person who raised a case can read its promise state; nobody else can', isset(call($api, 'sam', 'GET', "/support/cases/$lo")[1]['sla']) && call($api, 'mark', 'GET', "/support/cases/$lo")[0] === 404);
check('opening is rate limited', (function () use ($open): bool { $last = 201; for ($i = 0; $i < 12; $i++) { $last = $open('rapid')[0]; } return $last === 429; })());
