<?php
declare(strict_types=1);

// The notification pipeline: events queue in the same transaction, the Dispatcher delivers by inbox, email and push, and the
// organisation's and the person's preferences are honoured.
use RotaFlow\{Db, Dispatcher, Notify, Pusher, RotaDiff};

// ---- pure pieces ---------------------------------------------------------------------------------------
check('an absent or malformed matrix reads as everything on', Dispatcher::matrix(null, 'rota_published') === ['in_app' => true, 'email' => true, 'push' => true] && Dispatcher::matrix(['notification_defaults' => 'junk'], 'rota_published') === ['in_app' => true, 'email' => true, 'push' => true] && Dispatcher::matrix(['notification_defaults' => ['rota_published' => 'no']], 'rota_published') === ['in_app' => true, 'email' => true, 'push' => true]);
check('a type with no matrix row is unrestricted', Dispatcher::matrix(['notification_defaults' => ['rota_published' => ['email' => false]]], null) === ['in_app' => true, 'email' => true, 'push' => true]);
check('a stored matrix switches only what it says', Dispatcher::matrix(['notification_defaults' => ['leave_updates' => ['email' => false, 'push' => 'x']]], 'leave_updates') === ['in_app' => true, 'email' => false, 'push' => true]);
check('template filling is one pass: a value containing {{x}} is not expanded again', Dispatcher::fill('Hi {{a}} {{b}}', ['a' => '{{b}}', 'b' => 'B']) === 'Hi {{b}} B' && Dispatcher::fill('{{missing}}!', []) === '!');
$d = static fn (string $staff, ?string $user, string $day, string $label): array => ['staff' => $staff, 'user' => $user, 'day' => $day, 'label' => $label];
$msgs = RotaDiff::messages(
    [$d('s1', 'u1', '2030-05-06', '09:00-17:00 at Oak'), $d('s2', 'u2', '2030-05-06', '09:00-17:00 at Oak'), $d('s3', null, '2030-05-07', '09:00-17:00')],
    [$d('s1', 'u1', '2030-05-06', '10:00-18:00 at Oak'), $d('s2', 'u2', '2030-05-06', '09:00-17:00 at Oak'), $d('s1', 'u1', '2030-05-08', '09:00-17:00 at Oak')],
    '06 May – 12 May 2030'
);
check('an amendment tells each person only what changed for them', array_keys($msgs) === ['u1'] && !isset($msgs['u2']) && $msgs['u1']['n'] === 2, json_encode($msgs));
check('a changed shift reads "was ..., now ..." and a new one "added ..."', str_contains($msgs['u1']['body'], 'Mon 06 May: was 09:00-17:00 at Oak, now 10:00-18:00 at Oak') && str_contains($msgs['u1']['body'], 'Wed 08 May: added 09:00-17:00 at Oak'), $msgs['u1']['body']);
check('the title counts changes', $msgs['u1']['title'] === '06 May – 12 May 2030 — 2 changes to your shifts');
check('a removed shift for someone without a login produces nothing', RotaDiff::messages([$d('s3', null, '2030-05-07', 'x')], [], 'p') === []);
check('identical versions produce nothing', RotaDiff::messages([$d('s1', 'u1', '2030-05-06', 'x')], [$d('s1', 'u1', '2030-05-06', 'x')], 'p') === []);
check('leave ranges read naturally', RotaDiff::range('2030-11-05', '2030-11-05') === '5 November 2030' && RotaDiff::range('2030-11-05', '2030-11-09') === '5-9 November 2030' && RotaDiff::range('2030-10-28', '2030-11-03') === '28 October-3 November 2030' && RotaDiff::range('2030-12-30', '2031-01-02') === '30 December 2030-2 January 2031');

// ---- fixtures ------------------------------------------------------------------------------------------
$smtp = start_fake_smtp();
$config = ['smtp' => ['host' => '127.0.0.1', 'port' => $smtp['port'], 'secure' => false, 'user' => 'u', 'password' => 'p', 'from_email' => 'noreply@rotaflow.example.test', 'from_name' => 'RotaFlow']];
$api = test_api($pdo, null, 'open', $config);
$ctx = test_ctx($pdo, $config);
$org = call($api, 'olga', 'POST', '/orgs', ['name' => 'Notify Org'])[1]['org']['id'];
$other = call($api, 'zed', 'POST', '/orgs', ['name' => 'Elsewhere'])[1]['org']['id'];
$user = $staff = [];
foreach (['mark' => 'manager', 'sam' => 'staff', 'pat' => 'staff', 'dee' => 'staff'] as $name => $role) {
    call($api, $name, 'GET', '/me');
    $pdo->prepare("INSERT INTO memberships (id, org_id, user_id, role, status) SELECT ?, ?, id, ?, 'active' FROM users WHERE email = ?")->execute([Db::uuid(), $org, $role, "$name@example.test"]);
    $staff[$name] = call($api, 'olga', 'POST', "/orgs/$org/staff", ['first_name' => ucfirst($name), 'email' => "$name@example.test"])[1]['id'];
}
foreach (['olga', 'mark', 'sam', 'pat', 'dee', 'zed'] as $n) {
    $user[$n] = (string) $pdo->query("SELECT id FROM users WHERE email = '$n@example.test'")->fetchColumn();
}
$outbox = static fn (string $event = '') => $GLOBALS['pdo']->query("SELECT * FROM notification_outbox" . ($event === '' ? '' : " WHERE event_name = '$event'") . ' ORDER BY created_at, id')->fetchAll();
$clear = static function () use ($pdo): void { $pdo->exec('DELETE FROM notification_outbox'); $pdo->exec('DELETE FROM notifications'); $pdo->exec('DELETE FROM notification_deliveries'); };
$dispatch = static fn () => (new Dispatcher($GLOBALS['ctx']))->drain();

// ---- enqueue ----------------------------------------------------------------------------------------------
Notify::enqueue($pdo, $org, 'test/event', [$user['sam'], $user['sam'], '', $user['pat']], 'rota', 'Hello', 'World', 'k1');
Notify::enqueue($pdo, $org, 'test/event', [$user['sam']], 'rota', 'Hello again', null, 'k1');
$rows = $outbox('test/event');
check('a duplicate dedupe key is ignored, and recipients are de-duplicated', count($rows) === 1 && json_decode($rows[0]['payload'], true)['userIds'] === [$user['sam'], $user['pat']]);
Notify::enqueue($pdo, $org, 'test/event', [], 'rota', 'Nobody');
check('no recipients, no row', count($outbox('test/event')) === 1);
$clear();

// ---- rota publication queues its notification -----------------------------------------------------------------
$site = call($api, 'olga', 'POST', "/orgs/$org/locations", ['name' => 'Oak'])[1]['id'];
$rota = call($api, 'mark', 'POST', "/orgs/$org/rotas", ['name' => 'Wk', 'period_start' => '2030-05-06', 'period_end' => '2030-05-12', 'location_id' => $site])[1]['rota']['id'];
$shift = static fn (string $rotaId, string $who, string $start, string $end, string $status = 'assigned') => call($GLOBALS['api'], 'mark', 'POST', "/orgs/{$GLOBALS['org']}/shifts", ['rota_id' => $rotaId, 'location_id' => $GLOBALS['site'], 'staff_profile_id' => $GLOBALS['staff'][$who], 'starts_at' => $start, 'ends_at' => $end, 'status' => $status])[1]['shift']['id'];
$sh1 = $shift($rota, 'sam', '2030-05-06T09:00:00Z', '2030-05-06T17:00:00Z');
$shift($rota, 'pat', '2030-05-07T09:00:00Z', '2030-05-07T17:00:00Z');
$shift($rota, 'dee', '2030-05-08T09:00:00Z', '2030-05-08T17:00:00Z', 'cancelled');
check('creating or editing a draft queues nothing', $outbox() === []);
call($api, 'mark', 'POST', "/orgs/$org/rotas/$rota/publish");
$rows = $outbox('rota/published');
$p = json_decode($rows[0]['payload'], true);
check('publishing queues ONE notification to everyone with a live shift, and nobody else', count($rows) === 1 && $p['type'] === 'rota' && $p['title'] === '06 May – 12 May 2030 published' && $p['userIds'] === [$user['sam'], $user['pat']] || (count($rows) === 1 && array_diff($p['userIds'], [$user['sam'], $user['pat']]) === [] && count($p['userIds']) === 2), json_encode($p));
check('a failed publish (rule refusal) queues nothing', (function () use ($api, $org, $site, $pdo, $outbox): bool { $before = count($outbox()); $r = call($api, 'mark', 'POST', "/orgs/$org/rotas", ['name' => 'F', 'period_start' => '2031-03-03', 'period_end' => '2031-03-09', 'location_id' => $site])[1]['rota']['id']; call($api, 'mark', 'POST', "/orgs/$org/minimum-cover", ['location_id' => $site, 'weekday' => 1, 'min_staff' => 5]); $s = call($api, 'mark', 'POST', "/orgs/$org/rotas/$r/publish")[0]; call($api, 'mark', 'POST', "/orgs/$org/minimum-cover", ['location_id' => $site, 'weekday' => 1, 'min_staff' => 0]); return $s === 409 && count($outbox()) === $before; })());
$clear();
// amendment
$rev = call($api, 'mark', 'POST', "/orgs/$org/rotas/$rota/revision")[1]['rota']['id'];
$copied = call($api, 'mark', 'GET', "/orgs/$org/shifts?rota_ids=$rev")[1]['shifts'];
$samCopy = array_values(array_filter($copied, static fn (array $s): bool => $s['staff_profile_id'] === $GLOBALS['staff']['sam']))[0]['id'];
call($api, 'mark', 'POST', "/orgs/$org/shifts/$samCopy", ['starts_at' => '2030-05-06T10:00:00Z', 'ends_at' => '2030-05-06T18:00:00Z']);
call($api, 'mark', 'POST', "/orgs/$org/rotas/$rev/publish");
$rows = $outbox('rota/published');
check('an amendment queues one message per person whose shifts changed, and none for the others', count($rows) === 1 && json_decode($rows[0]['payload'], true)['userIds'] === [$user['sam']] && str_contains(json_decode($rows[0]['payload'], true)['body'], 'was 10:00-18:00 at Oak, now 11:00-19:00 at Oak'), json_encode(array_map(static fn ($r) => $r['payload'], $rows)));
$clear();

// ---- leave and swaps ----------------------------------------------------------------------------------------------
$lv = call($api, 'sam', 'POST', "/orgs/$org/leave", ['start_date' => '2030-07-01', 'end_date' => '2030-07-03'])[1]['leave']['id'];
call($api, 'mark', 'POST', "/orgs/$org/leave/$lv/review", ['status' => 'rejected']);
$p = json_decode($outbox('leave/reviewed')[0]['payload'] ?? '{}', true);
check('a leave decision tells the requester, with the dates', ($p['userIds'] ?? []) === [$user['sam']] && ($p['title'] ?? '') === 'Your leave request was declined' && ($p['body'] ?? '') === '1-3 July 2030', json_encode($p));
$clear();
$lv2 = call($api, 'mark', 'POST', "/orgs/$org/leave", ['start_date' => '2030-08-01', 'end_date' => '2030-08-01'])[1]['leave']['id'];
call($api, 'mark', 'POST', "/orgs/$org/leave/$lv2/review", ['status' => 'approved']);
check('a manager approving their own leave tells nobody', $outbox('leave/reviewed') === []);
$clear();
// swap decisions
$pdo->prepare("UPDATE shifts SET starts_at = DATE_ADD(UTC_TIMESTAMP(), INTERVAL 3 DAY), ends_at = DATE_ADD(UTC_TIMESTAMP(), INTERVAL 3 DAY) + INTERVAL 8 HOUR WHERE id = (SELECT id FROM (SELECT id FROM shifts WHERE rota_id = '$rev' AND staff_profile_id = '{$staff['sam']}' LIMIT 1) x)")->execute();
$swapShift = (string) $pdo->query("SELECT id FROM shifts WHERE rota_id = '$rev' AND staff_profile_id = '{$staff['sam']}'")->fetchColumn();
$sw = call($api, 'sam', 'POST', "/orgs/$org/swaps", ['shift_id' => $swapShift, 'target_staff_profile_id' => $staff['pat']])[1]['swap']['id'];
call($api, 'pat', 'POST', "/orgs/$org/swaps/$sw/respond", ['status' => 'rejected']);
$p = json_decode($outbox('swap/reviewed')[0]['payload'] ?? '{}', true);
check('a colleague declining a swap tells the requester', ($p['userIds'] ?? []) === [$user['sam']] && ($p['title'] ?? '') === 'Your shift swap was declined', json_encode($p));
$clear();
$sw2 = call($api, 'sam', 'POST', "/orgs/$org/swaps", ['shift_id' => $swapShift, 'target_staff_profile_id' => $staff['pat']])[1]['swap']['id'];
call($api, 'mark', 'POST', "/orgs/$org/swaps/$sw2/decide", ['status' => 'approved']);
check('a manager approving a swap tells the requester', json_decode($outbox('swap/reviewed')[0]['payload'] ?? '{}', true)['title'] === 'Your shift swap was approved');
$clear();

// ---- delivery -----------------------------------------------------------------------------------------------------------
Notify::enqueue($pdo, $org, 'rota/published', [$user['sam'], $user['pat'], $user['zed']], 'rota', 'Rota published', 'Details here');
$r = $dispatch();
check('the drain sends it', $r === ['sent' => 1, 'failed' => 0, 'abandoned' => 0], json_encode($r));
check('members get an inbox row; the person from another organisation does not', (int) $pdo->query("SELECT COUNT(*) FROM notifications WHERE org_id = '$org'")->fetchColumn() === 2 && (int) $pdo->query("SELECT COUNT(*) FROM notifications WHERE user_id = '{$user['zed']}'")->fetchColumn() === 0);
$mail = $smtp['messages']();
check('and an email each, with their first name and the title', count($mail) === 2 && in_array('sam@example.test', array_column($mail, 'rcpt'), true) && str_contains($mail[0]['raw'], 'Subject: Rota published') && str_contains($mail[0]['raw'], 'Hi Sam') || str_contains($mail[0]['raw'], 'Hi Pat'), $mail[0]['raw'] ?? 'none');
check('the outbox row is marked sent', $outbox()[0]['status'] === 'sent' && $outbox()[0]['dispatched_at'] !== null);
$del = $pdo->query("SELECT channel, status, COUNT(*) AS n FROM notification_deliveries WHERE org_id = '$org' GROUP BY channel, status")->fetchAll(PDO::FETCH_GROUP | PDO::FETCH_ASSOC);
check('every attempt is recorded per channel (inbox sent, email sent, push skipped with a reason)', isset($del['in_app']) && isset($del['email']) && isset($del['push']) && $pdo->query("SELECT detail FROM notification_deliveries WHERE channel = 'push' LIMIT 1")->fetchColumn() === 'no push subscription on any device', json_encode($del));
$clear();

// preferences
$pdo->prepare('INSERT INTO app_settings (user_id, notifications_enabled) VALUES (?, 0)')->execute([$user['pat']]);
$before = count($smtp['messages']());
Notify::enqueue($pdo, $org, 'leave/reviewed', [$user['sam'], $user['pat']], 'leave', 'Leave news');
$dispatch();
check('a person who muted notifications still gets the inbox row but no email', (int) $pdo->query("SELECT COUNT(*) FROM notifications WHERE user_id = '{$user['pat']}'")->fetchColumn() === 1 && count($smtp['messages']()) === $before + 1 && $pdo->query("SELECT detail FROM notification_deliveries WHERE user_id = '{$user['pat']}' AND channel = 'email'")->fetchColumn() === 'recipient opted out');
$clear();
$pdo->prepare("UPDATE organisations SET settings = JSON_OBJECT('notification_defaults', JSON_OBJECT('announcements', JSON_OBJECT('email', false), 'swap_requests', JSON_OBJECT('in_app', false))) WHERE id = ?")->execute([$org]);
$before = count($smtp['messages']());
Notify::enqueue($pdo, $org, 'announcement/published', [$user['sam']], 'announcement', 'Notice');
Notify::enqueue($pdo, $org, 'swap/reviewed', [$user['sam']], 'swap', 'Swap news');
$dispatch();
check('the organisation can switch email off for an event; the reason is recorded', count($smtp['messages']()) === $before + 1 && $pdo->query("SELECT detail FROM notification_deliveries WHERE event_type = 'announcement' AND channel = 'email'")->fetchColumn() === 'channel disabled for this event by the organisation');
check('and the inbox off for another, which then writes no inbox row for it', (int) $pdo->query("SELECT COUNT(*) FROM notifications WHERE type = 'swap'")->fetchColumn() === 0 && (int) $pdo->query("SELECT COUNT(*) FROM notifications WHERE type = 'announcement'")->fetchColumn() === 1);
$pdo->prepare("UPDATE organisations SET settings = JSON_OBJECT() WHERE id = ?")->execute([$org]);
$clear();

// no mail account, and a refusing mail server
$ctxNoMail = test_ctx($pdo);
Notify::enqueue($pdo, $org, 'rota/published', [$user['sam']], 'rota', 'No mail');
(new Dispatcher($ctxNoMail))->drain();
check('with no SMTP anywhere email is skipped with the reason, and the inbox still fills', $pdo->query("SELECT detail FROM notification_deliveries WHERE channel = 'email'")->fetchColumn() === 'no SMTP configured for this organisation or platform' && (int) $pdo->query('SELECT COUNT(*) FROM notifications')->fetchColumn() === 1);
$clear();
call($api, 'olga', 'GET', '/me');
$pdo->prepare("UPDATE users SET email = 'bounce@example.test' WHERE id = ?")->execute([$user['dee']]);
Notify::enqueue($pdo, $org, 'rota/published', [$user['dee']], 'rota', 'To a bouncing address');
$r = $dispatch();
check('a refused recipient is a failed delivery, not a failed outbox row', $r['sent'] === 1 && $pdo->query("SELECT status FROM notification_deliveries WHERE channel = 'email'")->fetchColumn() === 'failed' && str_starts_with((string) $pdo->query("SELECT detail FROM notification_deliveries WHERE channel = 'email'")->fetchColumn(), 'smtp_550'));
$pdo->prepare("UPDATE users SET email = 'dee@example.test' WHERE id = ?")->execute([$user['dee']]);
$clear();

// a mute never reaches a person who has left the organisation
$pdo->prepare("UPDATE memberships SET status = 'suspended' WHERE user_id = ? AND org_id = ?")->execute([$user['sam'], $org]);
Notify::enqueue($pdo, $org, 'rota/published', [$user['sam']], 'rota', 'To a suspended member');
$dispatch();
check('a suspended member is dropped', (int) $pdo->query("SELECT COUNT(*) FROM notifications")->fetchColumn() === 0);
$pdo->prepare("UPDATE memberships SET status = 'active' WHERE user_id = ? AND org_id = ?")->execute([$user['sam'], $org]);
$clear();

// ---- web push through the seam ----------------------------------------------------------------------------------------------
$pdo->prepare('UPDATE app_settings SET notifications_enabled = 1 WHERE user_id = ?')->execute([$user['pat']]);
$fakePush = new class implements Pusher {
    public array $sent = [];
    public function send(array $subscription, array $payload): string { $this->sent[] = $payload['title']; return str_contains($subscription['endpoint'], 'gone') ? 'expired' : 'sent'; }
};
$ep = static fn (string $n): string => 'https://push.example.test/' . $n;
foreach ([['ok', 'sam'], ['gone', 'pat']] as [$n, $who]) {
    $pdo->prepare('INSERT INTO push_subscriptions (id, user_id, endpoint, endpoint_hash, p256dh, auth_key) VALUES (?, ?, ?, ?, ?, ?)')->execute([Db::uuid(), $user[$who], $ep($n), hash('sha256', $ep($n)), 'k', 'a']);
}
Notify::enqueue($pdo, $org, 'rota/published', [$user['sam'], $user['pat'], $user['dee']], 'rota', 'Push me');
(new Dispatcher($ctx, $fakePush))->drain();
check('push is sent to each device, an expired subscription is removed, and a person with no device is recorded as skipped', $fakePush->sent === ['Push me', 'Push me'] && (int) $pdo->query('SELECT COUNT(*) FROM push_subscriptions')->fetchColumn() === 1 && $pdo->query("SELECT status FROM notification_deliveries WHERE channel = 'push' AND user_id = '{$user['pat']}'")->fetchColumn() === 'expired' && $pdo->query("SELECT detail FROM notification_deliveries WHERE channel = 'push' AND user_id = '{$user['dee']}'")->fetchColumn() === 'no push subscription on any device');
$clear();
Notify::enqueue($pdo, $org, 'rota/published', [$user['sam']], 'rota', 'Not configured');
$dispatch();
check('with no push sender configured the delivery says so', $pdo->query("SELECT detail FROM notification_deliveries WHERE channel = 'push' AND user_id = '{$user['sam']}'")->fetchColumn() === 'web push is not configured on this deployment');
$clear();

// ---- failure, backoff, abandonment, stale claims --------------------------------------------------------------------------------
$bad = Db::uuid();
$pdo->prepare("INSERT INTO notification_outbox (id, org_id, event_name, payload) VALUES (?, ?, 'broken', ?)")->execute([$bad, $org, json_encode(['orgId' => $org])]);
$dispatch();
$row = $pdo->query("SELECT status, attempts, last_error, next_attempt_at > UTC_TIMESTAMP() AS later FROM notification_outbox WHERE id = '$bad'")->fetch();
check('a payload that cannot be delivered is retried later, not dropped', $row['status'] === 'pending' && (int) $row['attempts'] === 1 && $row['last_error'] === 'InvalidArgumentException' && (int) $row['later'] === 1, json_encode($row));
check('and is not retried before it is due', $dispatch() === ['sent' => 0, 'failed' => 0, 'abandoned' => 0]);
$pdo->prepare("UPDATE notification_outbox SET attempts = 4, next_attempt_at = UTC_TIMESTAMP() WHERE id = ?")->execute([$bad]);
$r = $dispatch();
check('after five attempts it is abandoned', $r['abandoned'] === 1 && $pdo->query("SELECT status FROM notification_outbox WHERE id = '$bad'")->fetchColumn() === 'abandoned');
$pdo->prepare("UPDATE notification_outbox SET status = 'sending', claimed_at = DATE_SUB(UTC_TIMESTAMP(), INTERVAL 30 MINUTE), next_attempt_at = UTC_TIMESTAMP(), attempts = 1, event_name = 'stuck', payload = ? WHERE id = ?")->execute([json_encode(['orgId' => $org, 'userIds' => [$user['sam']], 'type' => 'rota', 'title' => 'Recovered']), $bad]);
$r = $dispatch();
check('a claim older than ten minutes (a crashed run) is reclaimed and delivered', $r['sent'] === 1 && $pdo->query("SELECT status FROM notification_outbox WHERE id = '$bad'")->fetchColumn() === 'sent');
$pdo->prepare("UPDATE notification_outbox SET status = 'sending', claimed_at = UTC_TIMESTAMP() WHERE id = ?")->execute([$bad]);
check('a fresh claim (another run in progress) is left alone', $dispatch()['sent'] === 0);
$clear();

// ---- missed clock-in alert -------------------------------------------------------------------------------------------------------------
$late = Db::uuid();
$pdo->prepare("INSERT INTO shifts (id, org_id, location_id, staff_profile_id, starts_at, ends_at, status) VALUES (?, ?, ?, ?, DATE_SUB(UTC_TIMESTAMP(), INTERVAL 45 MINUTE), DATE_ADD(UTC_TIMESTAMP(), INTERVAL 7 HOUR), 'assigned')")->execute([$late, $org, $site, $staff['sam']]);
$n = RotaFlow\Mod\Notifications::scheduledAlerts($ctx);
$rows = $outbox('alert/missed_clock_in');
$p = json_decode($rows[0]['payload'] ?? '{}', true);
check('a shift 45 minutes old with nobody clocked in alerts the owners and managers, once', $n === 1 && count($rows) === 1 && $p['title'] === 'Sam has not clocked in' && array_diff($p['userIds'], [$user['olga'], $user['mark']]) === [] && str_contains($p['body'], 'Their shift started at'), json_encode($p));
check('running the job again adds nothing', RotaFlow\Mod\Notifications::scheduledAlerts($ctx) === 0 && count($outbox('alert/missed_clock_in')) === 1);
$clear();
$pdo->prepare("INSERT INTO clock_events (id, org_id, staff_profile_id, type, event_at) VALUES (?, ?, ?, 'in', UTC_TIMESTAMP())")->execute([Db::uuid(), $org, $staff['sam']]);
check('once they have clocked in the alert does not fire', RotaFlow\Mod\Notifications::scheduledAlerts($ctx) === 0);
$pdo->exec('DELETE FROM clock_events');
$pdo->prepare("UPDATE shifts SET starts_at = DATE_SUB(UTC_TIMESTAMP(), INTERVAL 10 MINUTE) WHERE id = ?")->execute([$late]);
check('a shift that started only ten minutes ago is not yet missed', RotaFlow\Mod\Notifications::scheduledAlerts($ctx) === 0);
$pdo->prepare("UPDATE shifts SET starts_at = DATE_SUB(UTC_TIMESTAMP(), INTERVAL 14 HOUR), ends_at = DATE_SUB(UTC_TIMESTAMP(), INTERVAL 6 HOUR) WHERE id = ?")->execute([$late]);
check('nor one from yesterday', RotaFlow\Mod\Notifications::scheduledAlerts($ctx) === 0);
$pdo->prepare("UPDATE shifts SET starts_at = DATE_SUB(UTC_TIMESTAMP(), INTERVAL 45 MINUTE), ends_at = DATE_ADD(UTC_TIMESTAMP(), INTERVAL 7 HOUR), status = 'cancelled' WHERE id = ?")->execute([$late]);
check('nor a cancelled shift', RotaFlow\Mod\Notifications::scheduledAlerts($ctx) === 0);
$cron = RotaFlow\Mod\Notifications::cron($ctx);
check('the cron entry point reports what it did', preg_match('/^alerts queued=\d+ sent=\d+ failed=\d+ abandoned=\d+$/', $cron) === 1, $cron);

// ---- the inbox API ------------------------------------------------------------------------------------------------------------------------------
$clear();
foreach (['one', 'two', 'three'] as $t) {
    $pdo->prepare("INSERT INTO notifications (id, org_id, user_id, type, title) VALUES (?, ?, ?, 'rota', ?)")->execute([Db::uuid(), $org, $user['sam'], $t]);
}
$pdo->prepare("INSERT INTO notifications (id, org_id, user_id, type, title) VALUES (?, ?, ?, 'rota', 'Pat only')")->execute([Db::uuid(), $org, $user['pat']]);
[$s, $r] = call($api, 'sam', 'GET', "/orgs/$org/notifications");
check('a person reads their own inbox with the unread count', $s === 200 && count($r['notifications']) === 3 && $r['unread_count'] === 3 && !in_array('Pat only', array_column($r['notifications'], 'title'), true), json_encode($r));
$ids = array_column($r['notifications'], 'id');
check('marking some read changes only theirs', call($api, 'sam', 'POST', "/orgs/$org/notifications/read", ['ids' => [$ids[0], $ids[1]]])[1]['updated'] === 2 && call($api, 'sam', 'GET', "/orgs/$org/notifications")[1]['unread_count'] === 1);
check('a colleague cannot mark mine read', call($api, 'pat', 'POST', "/orgs/$org/notifications/read", ['ids' => [$ids[2]]])[1]['updated'] === 0 && call($api, 'sam', 'GET', "/orgs/$org/notifications")[1]['unread_count'] === 1);
check('unread=1 narrows the list and all:true clears it', count(call($api, 'sam', 'GET', "/orgs/$org/notifications?unread=1")[1]['notifications']) === 1 && call($api, 'sam', 'POST', "/orgs/$org/notifications/read", ['all' => true])[1]['updated'] === 1 && call($api, 'sam', 'GET', "/orgs/$org/notifications")[1]['unread_count'] === 0);
check('bad read requests are 422', call($api, 'sam', 'POST', "/orgs/$org/notifications/read", [])[0] === 422 && call($api, 'sam', 'POST', "/orgs/$org/notifications/read", ['ids' => [1]])[0] === 422 && call($api, 'sam', 'POST', "/orgs/$org/notifications/read", ['ids' => []])[0] === 422);
check('a stranger gets 404', call($api, 'zed', 'GET', "/orgs/$org/notifications")[0] === 404 && call($api, 'zed', 'POST', "/orgs/$org/notifications/read", ['all' => true])[0] === 404);
check('there is no way to write into someone\'s inbox', (function () use ($api, $org): bool { foreach (['/notifications', '/notifications/send'] as $p) { if (call($api, 'sam', 'POST', "/orgs/$org$p", ['title' => 'x'])[0] === 200 && $p === '/notifications/send') { return false; } } return true; })());

// ---- push devices ----------------------------------------------------------------------------------------------------------------------------------
$key = static fn (): array => ['p256dh' => str_repeat('A', 87), 'auth' => str_repeat('b', 22)];
check('a device registers', call($api, 'sam', 'POST', '/me/push-subscriptions', ['endpoint' => 'https://fcm.googleapis.com/fcm/send/abc', 'keys' => $key()])[0] === 200);
check('registering again updates, not duplicates', call($api, 'sam', 'POST', '/me/push-subscriptions', ['endpoint' => 'https://fcm.googleapis.com/fcm/send/abc', 'keys' => $key()])[0] === 200 && (int) $pdo->query("SELECT COUNT(*) FROM push_subscriptions WHERE endpoint = 'https://fcm.googleapis.com/fcm/send/abc'")->fetchColumn() === 1);
check('a second person on the same device takes it over, so the first stops receiving', call($api, 'pat', 'POST', '/me/push-subscriptions', ['endpoint' => 'https://fcm.googleapis.com/fcm/send/abc', 'keys' => $key()])[0] === 200 && $pdo->query("SELECT user_id FROM push_subscriptions WHERE endpoint = 'https://fcm.googleapis.com/fcm/send/abc'")->fetchColumn() === $user['pat']);
check('only the owner can release a device', call($api, 'sam', 'POST', '/me/push-subscriptions/delete', ['endpoint' => 'https://fcm.googleapis.com/fcm/send/abc'])[0] === 200 && (int) $pdo->query("SELECT COUNT(*) FROM push_subscriptions WHERE endpoint = 'https://fcm.googleapis.com/fcm/send/abc'")->fetchColumn() === 1 && call($api, 'pat', 'POST', '/me/push-subscriptions/delete', ['endpoint' => 'https://fcm.googleapis.com/fcm/send/abc'])[0] === 200 && (int) $pdo->query("SELECT COUNT(*) FROM push_subscriptions WHERE endpoint = 'https://fcm.googleapis.com/fcm/send/abc'")->fetchColumn() === 0);
foreach ([['endpoint' => 'http://insecure.example/x', 'keys' => $key()], ['endpoint' => 'https://x.example/y', 'keys' => ['p256dh' => 'short', 'auth' => 'a']], ['endpoint' => 'https://x.example/y'], ['endpoint' => ['a'], 'keys' => $key()]] as $i => $bad) {
    check("a bad push subscription is 422 ($i)", call($api, 'sam', 'POST', '/me/push-subscriptions', $bad)[0] === 422);
}
check('registering needs a sign-in', call($api, '', 'POST', '/me/push-subscriptions', ['endpoint' => 'https://x.example/y', 'keys' => $key()])[0] === 401);
// Only browser push services (audit C-03): the server POSTs to every stored endpoint.
foreach (['https://attacker.example/push', 'https://fcm.googleapis.com.evil.example/x', 'https://fcm.googleapis.com:8443/x', 'https://127.0.0.1/x'] as $i => $bad) {
    check("a non-push-service endpoint is refused ($i)", call($api, 'sam', 'POST', '/me/push-subscriptions', ['endpoint' => $bad, 'keys' => $key()])[0] === 422);
}
check('each browser push service is accepted', RotaFlow\Mod\Notifications::isPushService('https://updates.push.services.mozilla.com/wpush/v2/x') && RotaFlow\Mod\Notifications::isPushService('https://web.push.apple.com/x') && RotaFlow\Mod\Notifications::isPushService('https://wns2-db5p.notify.windows.com/w/?token=x'));
$pdo->prepare('DELETE FROM push_subscriptions WHERE user_id = ?')->execute([$user['sam']]);
for ($i = 0; $i < 12; $i++) {
    call($api, 'sam', 'POST', '/me/push-subscriptions', ['endpoint' => "https://fcm.googleapis.com/fcm/send/cap$i", 'keys' => $key()]);
}
check('a person keeps at most 10 push devices', (function () use ($pdo, $user): bool { $q = $pdo->prepare('SELECT COUNT(*) FROM push_subscriptions WHERE user_id = ?'); $q->execute([$user['sam']]); return (int) $q->fetchColumn() === 10; })());
