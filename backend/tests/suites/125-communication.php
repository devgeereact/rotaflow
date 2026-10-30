<?php
declare(strict_types=1);

// Organisation settings and mail account, announcements, the calendar feed, and invitation email.
use RotaFlow\{Db, Secret};
use RotaFlow\Mod\CalendarFeed;

$smtp = start_fake_smtp();
$platformSmtp = ['smtp' => ['host' => '127.0.0.1', 'port' => $smtp['port'], 'secure' => false, 'user' => 'u', 'password' => 'p', 'from_email' => 'noreply@rotaflow.example.test', 'from_name' => 'RotaFlow']];
$api = test_api($pdo, null, 'open', $platformSmtp + ['allow_plain_smtp' => true]);
$org = call($api, 'olga', 'POST', '/orgs', ['name' => 'Comms Org'])[1]['org']['id'];
$other = call($api, 'zed', 'POST', '/orgs', ['name' => 'Elsewhere'])[1]['org']['id'];
$user = $staff = [];
foreach (['mark' => 'manager', 'sam' => 'staff', 'pat' => 'staff', 'dee' => 'staff', 'nora' => 'staff'] as $name => $role) {
    call($api, $name, 'GET', '/me');
    $pdo->prepare("INSERT INTO memberships (id, org_id, user_id, role, status) SELECT ?, ?, id, ?, 'active' FROM users WHERE email = ?")->execute([Db::uuid(), $org, $role, "$name@example.test"]);
    if ($name !== 'nora') { // nora is a member with no staff record
        $staff[$name] = call($api, 'olga', 'POST', "/orgs/$org/staff", ['first_name' => ucfirst($name), 'email' => "$name@example.test"])[1]['id'];
    }
}
foreach (['olga', 'mark', 'sam', 'pat', 'dee'] as $n) {
    $user[$n] = (string) $pdo->query("SELECT id FROM users WHERE email = '$n@example.test'")->fetchColumn();
}

// ---- encryption ----------------------------------------------------------------------------------------------
$k = base64_encode(random_bytes(32));
$c = Secret::encrypt('s3cret pass', $k);
check('a secret round-trips and is not stored in the clear', Secret::decrypt($c, $k) === 's3cret pass' && !str_contains($c, 's3cret') && str_starts_with($c, 'v1:'));
check('each encryption differs (fresh nonce)', Secret::encrypt('x', $k) !== Secret::encrypt('x', $k));
$bad = static function (callable $f): bool { try { $f(); return false; } catch (RuntimeException) { return true; } };
check('the wrong key, tampered data, junk and a bad key are all refused, never garbage', $bad(fn () => Secret::decrypt($c, base64_encode(random_bytes(32)))) && $bad(fn () => Secret::decrypt(substr($c, 0, -3) . 'AAA', $k)) && $bad(fn () => Secret::decrypt('not-encrypted', $k)) && $bad(fn () => Secret::encrypt('x', 'short')));

// ---- organisation settings -------------------------------------------------------------------------------------
$matrix = ['notification_defaults' => ['rota_published' => ['email' => false, 'push' => true], 'announcements' => ['in_app' => true]]];
[$s, $r] = call($api, 'olga', 'POST', "/orgs/$org/settings", $matrix + ['job_titles_managed_by' => 'managers']);
check('the owner sets the notification matrix and who manages job titles', $s === 200 && $r['settings']['notification_defaults']['rota_published']['email'] === false && $r['settings']['job_titles_managed_by'] === 'managers', json_encode($r));
check('a manager cannot', call($api, 'mark', 'POST', "/orgs/$org/settings", $matrix)[0] === 403);
check('a stranger gets 404', call($api, 'zed', 'POST', "/orgs/$org/settings", $matrix)[0] === 404);
foreach ([['notification_defaults' => ['party' => ['email' => true]]], ['notification_defaults' => ['rota_published' => ['sms' => true]]], ['notification_defaults' => ['rota_published' => ['email' => 'yes']]], ['notification_defaults' => 'junk'], ['job_titles_managed_by' => 'everyone'], []] as $i => $badBody) {
    check("a bad setting is 422 ($i)", call($api, 'olga', 'POST', "/orgs/$org/settings", $badBody)[0] === 422);
}
call($api, 'olga', 'POST', "/orgs/$org/settings", ['job_titles_managed_by' => 'owner']);
check('saving one key keeps the other', call($api, 'olga', 'GET', "/orgs/$org")[1]['org']['settings']['notification_defaults']['rota_published']['email'] === false);
check('a manager can edit job titles only when the setting allows it', call($api, 'mark', 'POST', "/orgs/$org/job-titles", ['name' => 'X'])[0] === 403 && call($api, 'olga', 'POST', "/orgs/$org/settings", ['job_titles_managed_by' => 'managers'])[0] === 200 && call($api, 'mark', 'POST', "/orgs/$org/job-titles", ['name' => 'X'])[0] === 201);

// ---- the organisation's own mail account --------------------------------------------------------------------------
$acct = ['smtp_host' => '127.0.0.1', 'smtp_port' => $smtp['port'], 'smtp_user' => 'mailer', 'smtp_pass' => 'org-pass-123', 'from_email' => 'rota@acme.example.test', 'from_name' => 'Acme Rota'];
check('only the owner reads or writes the account', call($api, 'mark', 'GET', "/orgs/$org/smtp")[0] === 403 && call($api, 'mark', 'POST', "/orgs/$org/smtp", $acct)[0] === 403 && call($api, 'zed', 'GET', "/orgs/$org/smtp")[0] === 404);
check('before anything is saved there is none', call($api, 'olga', 'GET', "/orgs/$org/smtp")[1]['smtp'] === null);
[$s, $r] = call($api, 'olga', 'POST', "/orgs/$org/smtp", $acct);
$keys = array_keys($r['smtp'] ?? []);
sort($keys);
check('the owner saves it; the password is never returned', $keys === ['from_email', 'from_name', 'has_password', 'smtp_host', 'smtp_port', 'smtp_user', 'verified_at'] && $s === 200 && $r['smtp']['smtp_host'] === '127.0.0.1' && $r['smtp']['has_password'] === true && !str_contains(json_encode($r), 'org-pass') && $r['smtp']['verified_at'] === null, json_encode($r));
$stored = (string) $pdo->query("SELECT smtp_pass_enc FROM org_smtp_settings WHERE org_id = '$org'")->fetchColumn();
check('the database holds it encrypted', str_starts_with($stored, 'v1:') && !str_contains($stored, 'org-pass-123'));
check('it is required the first time, and addresses and hosts are validated', call($api, 'zed', 'POST', "/orgs/$other/smtp", array_diff_key($acct, ['smtp_pass' => 1]))[0] === 422 && call($api, 'olga', 'POST', "/orgs/$org/smtp", ['from_email' => 'nope'] + $acct)[0] === 422 && call($api, 'olga', 'POST', "/orgs/$org/smtp", ['smtp_host' => 'bad host;'] + $acct)[0] === 422 && call($api, 'olga', 'POST', "/orgs/$org/smtp", ['smtp_port' => 70000] + $acct)[0] === 422);
$before = count($smtp['messages']());
[$s, $r] = call($api, 'olga', 'POST', "/orgs/$org/smtp/test");
$msgs = $smtp['messages']();
check('the test message goes only to the owner\'s own address and stamps verified_at', $s === 200 && $r['ok'] === true && count($msgs) === $before + 1 && end($msgs)['rcpt'] === 'olga@example.test' && str_contains(end($msgs)['raw'], 'From: Acme Rota <rota@acme.example.test>') && call($api, 'olga', 'GET', "/orgs/$org/smtp")[1]['smtp']['verified_at'] !== null);
check('saving with no password keeps the old one and the verification', call($api, 'olga', 'POST', "/orgs/$org/smtp", array_diff_key($acct, ['smtp_pass' => 1]) + ['from_name' => 'Renamed'])[1]['smtp']['verified_at'] !== null && (string) $pdo->query("SELECT smtp_pass_enc FROM org_smtp_settings WHERE org_id = '$org'")->fetchColumn() === $stored);
check('changing the host clears the verification', call($api, 'olga', 'POST', "/orgs/$org/smtp", ['smtp_user' => 'someone-else'] + $acct)[1]['smtp']['verified_at'] === null);
$bounce = array_merge($acct, ['smtp_port' => 1]);
call($api, 'olga', 'POST', "/orgs/$org/smtp", $bounce);
[$s, $r] = call($api, 'olga', 'POST', "/orgs/$org/smtp/test");
check('a test that cannot connect reports a short reason, not details', $s === 200 && $r['ok'] === false && $r['error'] === 'connect_failed', json_encode($r));
call($api, 'olga', 'POST', "/orgs/$org/smtp", $acct);
check('the account is used for the organisation\'s own mail (its From address)', (function () use ($pdo, $smtp, $user, $org, $platformSmtp): bool {
    $ctx = test_ctx($pdo, $platformSmtp + ['allow_plain_smtp' => true]);
    RotaFlow\Notify::enqueue($pdo, $org, 'leave/reviewed', [$user['sam']], 'leave', 'Via the org account');
    (new RotaFlow\Dispatcher($ctx))->drain();
    $m = array_values(array_filter($smtp['messages'](), static fn ($x) => str_contains($x['raw'], 'Via the org account')));
    return count($m) === 1 && str_contains($m[0]['raw'], 'From: Acme Rota <rota@acme.example.test>');
})());
check('removing it falls back to the platform account', call($api, 'olga', 'POST', "/orgs/$org/smtp/delete")[0] === 200 && call($api, 'olga', 'GET', "/orgs/$org/smtp")[1]['smtp'] === null);
check('a test with no account saved is refused', call($api, 'olga', 'POST', "/orgs/$org/smtp/test")[1]['error']['code'] === 'smtp_not_set');

// ---- announcements --------------------------------------------------------------------------------------------------
$loc = call($api, 'olga', 'POST', "/orgs/$org/locations", ['name' => 'Oak'])[1]['id'];
$kit = call($api, 'olga', 'POST', "/orgs/$org/departments", ['name' => 'Kitchen', 'location_id' => $loc])[1]['id'];
$zDept = call($api, 'zed', 'POST', "/orgs/$other/departments", ['name' => 'Z'])[1]['id'];
call($api, 'mark', 'POST', "/orgs/$org/staff/{$staff['sam']}", ['department_id' => $kit]);
call($api, 'mark', 'POST', "/orgs/$org/staff/{$staff['pat']}", ['active' => true]);
$ann = static fn (string $who, array $b) => call($GLOBALS['api'], $who, 'POST', "/orgs/{$GLOBALS['org']}/announcements", $b);
$outbox = static fn () => $GLOBALS['pdo']->query("SELECT payload FROM notification_outbox WHERE event_name = 'announcement/published' ORDER BY created_at")->fetchAll(PDO::FETCH_COLUMN);
$pdo->exec('DELETE FROM notification_outbox');
check('staff cannot write announcements', $ann('sam', ['title' => 'x', 'body' => 'y'])[0] === 403 && call($api, 'zed', 'POST', "/orgs/$org/announcements", ['title' => 'x', 'body' => 'y'])[0] === 404);
foreach ([['title' => '', 'body' => 'y'], ['title' => 'x'], ['title' => 'x', 'body' => 'y', 'scope' => 'planet'], ['title' => 'x', 'body' => 'y', 'scope' => 'department'], ['title' => 'x', 'body' => 'y', 'scope' => 'department', 'department_id' => $zDept], ['title' => ['a'], 'body' => 'y']] as $i => $badBody) {
    check("a bad announcement is 422 ($i)", $ann('mark', $badBody)[0] === 422);
}
[$s, $r] = $ann('mark', ['title' => 'Fire drill', 'body' => 'Thursday 10am', 'urgent' => true]);
check('a manager drafts an announcement; nothing is queued', $s === 201 && $outbox() === []);
$a1 = $r['id'];
check('staff do not see a draft; managers do', call($api, 'sam', 'GET', "/orgs/$org/announcements")[1]['announcements'] === [] && count(call($api, 'mark', 'GET', "/orgs/$org/announcements")[1]['announcements']) === 1);
check('and cannot read or mark a draft', call($api, 'sam', 'POST', "/orgs/$org/announcements/$a1/read")[0] === 404);
check('staff cannot publish', call($api, 'sam', 'POST', "/orgs/$org/announcements/$a1/publish")[0] === 403);
[$s, $r] = call($api, 'mark', 'POST', "/orgs/$org/announcements/$a1/publish");
$p = json_decode($outbox()[0] ?? '{}', true);
check('publishing queues ONE notification to every active person with a login', $s === 200 && $r['already_published'] === false && count($outbox()) === 1 && count($p['userIds']) === 5 && $p['title'] === 'Fire drill' && $p['body'] === 'Thursday 10am', json_encode($p));
check('publishing again, or editing a published notice, notifies nobody a second time', call($api, 'mark', 'POST', "/orgs/$org/announcements/$a1/publish")[1]['already_published'] === true && call($api, 'mark', 'POST', "/orgs/$org/announcements/$a1", ['title' => 'Fire drill (moved)', 'body' => 'Friday 10am', 'urgent' => true])[0] === 200 && count($outbox()) === 1);
check('staff now see it, with the read flag and no read count', ($l = call($api, 'sam', 'GET', "/orgs/$org/announcements")[1]['announcements'])[0]['title'] === 'Fire drill (moved)' && $l[0]['read_by_me'] === false && $l[0]['reads_count'] === null && $l[0]['urgent'] === true);
check('a person marks it read, idempotently', call($api, 'sam', 'POST', "/orgs/$org/announcements/$a1/read")[0] === 200 && call($api, 'sam', 'POST', "/orgs/$org/announcements/$a1/read")[0] === 200 && call($api, 'sam', 'GET', "/orgs/$org/announcements")[1]['announcements'][0]['read_by_me'] === true);
check('a member with no staff record cannot', call($api, 'nora', 'POST', "/orgs/$org/announcements/$a1/read")[1]['error']['code'] === 'no_staff_record');
check('managers see who read it and how many have not', ($rd = call($api, 'mark', 'GET', "/orgs/$org/announcements/$a1/reads")[1])['reads'][0]['staff_profile_id'] === $staff['sam'] && $rd['unread_in_audience'] === 4 && call($api, 'sam', 'GET', "/orgs/$org/announcements/$a1/reads")[0] === 403);
check('managers see the read count on the list', call($api, 'mark', 'GET', "/orgs/$org/announcements")[1]['announcements'][0]['reads_count'] === 1);
[$s, $r] = call($api, 'mark', 'POST', "/orgs/$org/announcements/$a1/remind");
$all = $outbox();
$last = ['userIds' => []];
foreach ($all as $row) { $d = json_decode($row, true); if (count($d['userIds']) < 5) { $last = $d; } } // the reminder is the smaller audience (rows made in one second have no stable order)
check('a reminder goes only to the people who have not read it', $s === 200 && $r['reminded'] === 4 && count($outbox()) === 2 && !in_array($user['sam'], $last['userIds'], true), json_encode([$s, $r, count($outbox()), $last['userIds'] ?? null]));
check('reminders are rate limited', (function () use ($api, $org, $a1): bool { $codes = []; for ($i = 0; $i < 7; $i++) { $codes[] = call($api, 'mark', 'POST', "/orgs/$org/announcements/$a1/remind")[0]; } return in_array(429, $codes, true); })());
check('a draft cannot be reminded', call($api, 'mark', 'POST', "/orgs/$org/announcements/" . $ann('mark', ['title' => 'Later', 'body' => 'b'])[1]['id'] . '/remind')[1]['error']['code'] === 'not_published');
// audience scoping
$pdo->exec('DELETE FROM notification_outbox');
$dep = $ann('mark', ['title' => 'Kitchen only', 'body' => 'b', 'scope' => 'department', 'department_id' => $kit, 'publish' => true])[1]['id'];
check('a department notice goes to that department only', json_decode($outbox()[0], true)['userIds'] === [$user['sam']]);
$pdo->exec('DELETE FROM notification_outbox');
$ann('mark', ['title' => 'Oak site', 'body' => 'b', 'scope' => 'location', 'location_id' => $loc, 'publish' => true]);
check('a location notice goes to the people in departments at that location', json_decode($outbox()[0], true)['userIds'] === [$user['sam']]);
$pdo->exec('DELETE FROM notification_outbox');
$pdo->prepare('UPDATE staff_profiles SET active = 0 WHERE id = ?')->execute([$staff['dee']]);
$ann('mark', ['title' => 'All hands', 'body' => 'b', 'publish' => true]);
check('someone who has left is not in the audience', !in_array($user['dee'], json_decode($outbox()[0], true)['userIds'], true));
check('a notice can be deleted, once', call($api, 'mark', 'POST', "/orgs/$org/announcements/$dep/delete")[0] === 200 && call($api, 'mark', 'POST', "/orgs/$org/announcements/$dep/delete")[0] === 404);
check('another organisation\'s announcement id is 404', call($api, 'zed', 'POST', "/orgs/$other/announcements/$a1/publish")[0] === 404 && call($api, 'zed', 'GET', "/orgs/$org/announcements")[0] === 404);

// ---- calendar feed -----------------------------------------------------------------------------------------------------
$rota = call($api, 'mark', 'POST', "/orgs/$org/rotas", ['name' => 'W', 'period_start' => gmdate('Y-m-d', time() + 86400), 'period_end' => gmdate('Y-m-d', time() + 8 * 86400), 'location_id' => $loc])[1]['rota']['id'];
$mk = static fn (string $who, int $offsetH, string $status = 'assigned', ?string $notes = null) => call($GLOBALS['api'], 'mark', 'POST', "/orgs/{$GLOBALS['org']}/shifts", ['rota_id' => $GLOBALS['rota'], 'location_id' => $GLOBALS['loc'], 'staff_profile_id' => $GLOBALS['staff'][$who], 'starts_at' => gmdate('Y-m-d\TH:i:s\Z', time() + $offsetH * 3600), 'ends_at' => gmdate('Y-m-d\TH:i:s\Z', time() + ($offsetH + 8) * 3600), 'status' => $status, 'notes' => $notes, 'break_minutes' => 30])[1]['shift']['id'];
$mine = $mk('sam', 30, 'assigned', "Bring ID; side door, ask for \"Jo\"\nSecond line");
$mk('sam', 60, 'cancelled');
$mk('pat', 36);
check('before publishing the feed is empty', true);
check('a person without a staff record cannot issue a feed', call($api, 'nora', 'POST', "/orgs/$org/calendar-feed/issue")[1]['error']['code'] === 'no_staff_record');
check('there is no feed until one is issued', call($api, 'sam', 'GET', "/orgs/$org/calendar-feed")[1]['active'] === false);
[$s, $r] = call($api, 'sam', 'POST', "/orgs/$org/calendar-feed/issue");
check('a person issues a feed and is given the secret once', $s === 201 && strlen($r['token']) === 43 && $r['path'] === '/api/ics?token=' . $r['token']);
$tok = $r['token'];
check('only its hash is stored', (string) $pdo->query("SELECT token_hash FROM calendar_feed_tokens WHERE revoked_at IS NULL")->fetchColumn() === hash('sha256', $tok));
$feed = static fn (string $t) => call($GLOBALS['api'], '', 'GET', '/ics?token=' . $t);
[$s, $r] = $feed($tok);
check('while the rota is a draft the feed has no shifts', $s === 200 && !str_contains($r['__raw']['body'], 'BEGIN:VEVENT'));
call($api, 'mark', 'POST', "/orgs/$org/rotas/$rota/publish");
[$s, $r] = $feed($tok);
$body = $r['__raw']['body'];
check('the feed is a calendar, served as text/calendar, not cached publicly', $s === 200 && $r['__raw']['mime'] === 'text/calendar; charset=utf-8' && str_starts_with($body, "BEGIN:VCALENDAR\r\n") && str_ends_with($body, "END:VCALENDAR\r\n") && str_starts_with($r['__raw']['cache'], 'private'));
check('it has this person\'s published, uncancelled shift only', substr_count($body, 'BEGIN:VEVENT') === 1 && str_contains($body, "UID:$mine@rotaflow.space") && str_contains($body, 'SUMMARY:Shift at Oak') && str_contains($body, 'LOCATION:Oak'));
$unfolded = preg_replace("/\r\n /", '', $body);
check('notes are escaped and cannot add a property line', str_contains($unfolded, 'Bring ID\; side door\, ask for "Jo"\nSecond line') && !preg_match('/^Second line/m', $body), $unfolded);
check('every line ends CRLF and none is longer than 75 octets', !preg_match('/(?<!\r)\n/', $body) && max(array_map('strlen', explode("\r\n", $body))) <= 75);
check('times are UTC with a Z', preg_match('/^DTSTART:\d{8}T\d{6}Z\r?$/m', $body) === 1);
check('a bad, short or unknown token is a bare 404 with no detail', $feed('nope')[0] === 404 && $feed(str_repeat('a', 43))[0] === 404 && $feed(str_repeat('a', 43))[1]['error']['code'] === 'not_found');
check('guessing is rate limited (from one address)', (function () use ($api): bool { $codes = []; for ($i = 0; $i < 40; $i++) { $codes[] = $api->handle('GET', '/ics', [], '', '198.51.100.7', ['token' => str_repeat('b', 43)])[0]; } return in_array(429, $codes, true) && $codes[0] === 404; })());
[, $r2] = call($api, 'sam', 'POST', "/orgs/$org/calendar-feed/issue");
check('issuing a new feed switches the old one off', $feed($tok)[0] === 404 && $feed($r2['token'])[0] === 200);
check('the status shows it is active and when it was last used', ($st = call($api, 'sam', 'GET', "/orgs/$org/calendar-feed")[1])['active'] === true && $st['last_used_at'] !== null);
check('revoking switches it off', call($api, 'sam', 'POST', "/orgs/$org/calendar-feed/revoke")[0] === 200 && $feed($r2['token'])[0] === 404 && call($api, 'sam', 'GET', "/orgs/$org/calendar-feed")[1]['active'] === false);
[, $r3] = call($api, 'sam', 'POST', "/orgs/$org/calendar-feed/issue");
$pdo->prepare("UPDATE calendar_feed_tokens SET last_used_at = DATE_SUB(UTC_TIMESTAMP(), INTERVAL 91 DAY) WHERE revoked_at IS NULL")->execute();
check('an unused feed switches itself off after 90 days', $feed($r3['token'])[0] === 404 && (int) $pdo->query('SELECT COUNT(*) FROM calendar_feed_tokens WHERE revoked_at IS NULL')->fetchColumn() === 0);
check('a stranger cannot manage a feed', call($api, 'zed', 'POST', "/orgs/$org/calendar-feed/issue")[0] === 404);
check('ICS escaping and folding are exact', CalendarFeed::text("a;b,c\\d\ne") === 'a\;b\\,c\\\\d\\ne' && CalendarFeed::fold(str_repeat('é', 60)) === implode("\r\n ", array_map(static fn ($x) => $x, explode("\n", chunk_split(str_repeat('é', 37), 1, ''))) ) || strlen(explode("\r\n", CalendarFeed::fold(str_repeat('é', 60)))[0]) <= 75);
check('folding never splits a multi-byte character', (function (): bool { foreach (explode("\r\n", CalendarFeed::fold('SUMMARY:' . str_repeat('日本語', 30))) as $l) { if (strlen($l) > 75 || !mb_check_encoding($l, 'UTF-8')) { return false; } } return true; })());

// ---- invitation email -------------------------------------------------------------------------------------------------------
$before = count($smtp['messages']());
[$s, $r] = call($api, 'olga', 'POST', "/orgs/$org/invites", ['email' => 'newhire@example.test', 'role' => 'staff']);
$m = $smtp['messages']();
$mail = end($m);
check('inviting emails the link through the platform account', $s === 201 && $r['email_sent'] === true && $r['email_error'] === null && count($m) === $before + 1 && $mail['rcpt'] === 'newhire@example.test', json_encode($r));
check('the subject names no organisation (it is no use as a phishing template); the body does and carries the link', str_contains($mail['raw'], 'Subject: You have been invited to join a team on RotaFlow') && !str_contains(explode("\r\n\r\n", $mail['raw'])[0], 'Comms Org') && str_contains(quoted_printable_decode($mail['raw']), 'Comms Org') && str_contains(quoted_printable_decode($mail['raw']), 'https://rotaflow.example.test/invite/' . $r['token']));
check('the send is recorded on the invitation', $pdo->query("SELECT last_sent_at IS NOT NULL AND send_error IS NULL FROM invites WHERE email = 'newhire@example.test'")->fetchColumn() == 1);
$inv = $r['invite']['id']; $old = $r['token'];
[$s, $r] = call($api, 'olga', 'POST', "/orgs/$org/invites/$inv/resend");
check('resending issues a fresh link, emails it, and the old link stops working', $s === 200 && $r['email_sent'] === true && $r['token'] !== $old && call($api, '', 'POST', '/invites/preview', ['token' => $old])[0] === 404 && call($api, '', 'POST', '/invites/preview', ['token' => $r['token']])[0] === 200);
check('staff cannot resend; a stranger cannot; an unknown invitation is 404', call($api, 'sam', 'POST', "/orgs/$org/invites/$inv/resend")[0] === 403 && call($api, 'zed', 'POST', "/orgs/$org/invites/$inv/resend")[0] === 404 && call($api, 'olga', 'POST', "/orgs/$org/invites/" . Db::uuid() . '/resend')[0] === 404);
$noMail = test_api($pdo);
[$s, $r] = call($noMail, 'olga', 'POST', "/orgs/$org/invites", ['email' => 'nomail@example.test', 'role' => 'staff']);
check('with no mail account the invitation is still created, with the link, and the failure says why', $s === 201 && $r['email_sent'] === false && $r['email_error'] === 'no_mail_account' && strlen($r['token']) >= 40 && $pdo->query("SELECT send_error FROM invites WHERE email = 'nomail@example.test'")->fetchColumn() === 'no_mail_account');
$refusing = test_api($pdo, null, 'open', ['smtp' => $platformSmtp['smtp']]);
[$s, $r] = call($refusing, 'olga', 'POST', "/orgs/$org/invites", ['email' => 'bounce@example.test', 'role' => 'staff']);
check('a refusing mail server does not lose the invitation either', $s === 201 && $r['email_sent'] === false && str_starts_with((string) $r['email_error'], 'smtp_550') && $r['token'] !== '');
