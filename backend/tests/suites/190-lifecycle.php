<?php
declare(strict_types=1);

// Data lifecycle: data-subject requests, erasure, deleting an organisation, the file store and its queue, and retention.
use RotaFlow\{Ctx, Db, FileStore, Modules, RateLimiter, Retention};
use RotaFlow\Mod\{Gdpr, Lifecycle};

// ---- calendar months -------------------------------------------------------------------------------------------------
check('a month later clamps to the end of a short month', Gdpr::addMonths('2030-01-31', 1) === '2030-02-28' && Gdpr::addMonths('2032-01-31', 1) === '2032-02-29' && Gdpr::addMonths('2030-03-31', 1) === '2030-04-30');
check('the extension counts from the original due date', Gdpr::addMonths('2030-02-28', 2) === '2030-04-28' && Gdpr::addMonths('2030-12-15', 1) === '2031-01-15');
check('subtracting months works across years and clamps', Gdpr::addMonths('2030-03-31', -1) === '2030-02-28' && Gdpr::addMonths('2030-01-15', -36) === '2027-01-15' && Gdpr::addMonths('2030-02-10', -13) === '2029-01-10');

// ---- the file store ----------------------------------------------------------------------------------------------------
$u1 = 'abcdefab-1111-4111-8111-111111111111';
$u2 = '22222222-2222-4222-8222-222222222222';
$root = test_private_root() . '/uploads-test';
$fs = new FileStore($root);
check('only paths of the right shape are accepted', FileStore::validObject("$u1/$u2/passport.pdf") && FileStore::validFolder($u1) && FileStore::validFolder("$u1/$u2") && !FileStore::validObject("$u1/$u2") && !FileStore::validObject("$u1/$u2/../x") && !FileStore::validObject("$u1/$u2/a/b") && !FileStore::validObject("../$u2/x.pdf") && !FileStore::validObject("$u1/$u2/.hidden") && !FileStore::validFolder('..') && !FileStore::validFolder("$u1/") && !FileStore::validFolder(strtoupper($u1)));
$threw = static function (callable $f): bool { try { $f(); return false; } catch (\Throwable) { return true; } };
check('a bad bucket or path is refused before touching the disk', $threw(fn () => $fs->put('elsewhere', "$u1/$u2/a.pdf", 'x')) && $threw(fn () => $fs->put(FileStore::DOCUMENTS, "$u1/$u2/../../etc", 'x')) && $threw(fn () => $fs->delete(FileStore::DOCUMENTS, '..', true)) && !is_dir($root . '/elsewhere'));
$fs->put(FileStore::DOCUMENTS, "$u1/$u2/a.pdf", 'PDFBYTES');
check('a file is stored privately and read back', $fs->get(FileStore::DOCUMENTS, "$u1/$u2/a.pdf") === 'PDFBYTES' && (fileperms("$root/staff-documents/$u1/$u2/a.pdf") & 0777) === 0600 && $fs->exists(FileStore::DOCUMENTS, "$u1/$u2/a.pdf") && !$fs->exists(FileStore::PHOTOS, "$u1/$u2/a.pdf"));
check('an upload never overwrites', $threw(fn () => $fs->put(FileStore::DOCUMENTS, "$u1/$u2/a.pdf", 'other')) && $fs->get(FileStore::DOCUMENTS, "$u1/$u2/a.pdf") === 'PDFBYTES');
$fs->put(FileStore::DOCUMENTS, "$u1/$u2/b.pdf", 'B');
$fs->delete(FileStore::DOCUMENTS, "$u1/$u2/a.pdf", false);
check('deleting one file leaves its neighbour', !$fs->exists(FileStore::DOCUMENTS, "$u1/$u2/a.pdf") && $fs->exists(FileStore::DOCUMENTS, "$u1/$u2/b.pdf"));
$fs->delete(FileStore::DOCUMENTS, $u1, true);
check('deleting a folder removes everything under it', !is_dir("$root/staff-documents/$u1"));
$fs->delete(FileStore::DOCUMENTS, $u1, true);
$fs->delete(FileStore::DOCUMENTS, "$u1/$u2/gone.pdf", false);
check('deleting what is not there is success, so a retry is always safe', true);
mkdir("$root/staff-photos/$u1", 0700, true);
symlink(sys_get_temp_dir(), "$root/staff-photos/$u1/link");
check('a symbolic link inside a folder is never followed', $threw(fn () => $fs->delete(FileStore::PHOTOS, $u1, true)) && is_dir(sys_get_temp_dir()));
unlink("$root/staff-photos/$u1/link");

// ---- fixtures ------------------------------------------------------------------------------------------------------------------
$clerkCalls = [];
$clerkStatus = 200;
$clerk = static function (string $m, string $url, array $h) use (&$clerkCalls, &$clerkStatus): array { $clerkCalls[] = [$m, $url, $h]; return [$clerkStatus, '{}']; };
$ctx = new Ctx($pdo, new RateLimiter($pdo), 'https://rotaflow.example.test', test_private_root(), null, 'open', test_config(['clerk_secret_key' => 'clerk-test-secret-not-real']));
$api = test_api($pdo, array_map(static fn ($m) => $m instanceof Gdpr ? new Gdpr($ctx, $clerk) : $m, Modules::all($ctx)));
foreach (['root' => 'platform_owner', 'adam' => 'platform_admin', 'sue' => 'platform_support', 'fin' => 'platform_finance'] as $n => $r) {
    call($api, $n, 'GET', '/me');
    $pdo->prepare('INSERT INTO platform_admins (user_id, role) SELECT id, ? FROM users WHERE email = ?')->execute([$r, "$n@example.test"]);
}
$org = call($api, 'olga', 'POST', '/orgs', ['name' => 'Life Org'])[1]['org']['id'];
$other = call($api, 'zed', 'POST', '/orgs', ['name' => 'Elsewhere'])[1]['org']['id'];
foreach (['mark' => 'manager', 'sam' => 'staff', 'pat' => 'staff'] as $n => $r) {
    call($api, $n, 'GET', '/me');
    $pdo->prepare("INSERT INTO memberships (id, org_id, user_id, role, status) SELECT ?, ?, id, ?, 'active' FROM users WHERE email = ?")->execute([Db::uuid(), $org, $r, "$n@example.test"]);
}
$uid = static fn (string $w): string => (string) $GLOBALS['pdo']->query("SELECT id FROM users WHERE email = '$w@example.test'")->fetchColumn();

// ---- the register ---------------------------------------------------------------------------------------------------------------
$log = static fn (string $w, array $b = []) => call($GLOBALS['api'], $w, 'POST', '/platform/gdpr', $b + ['email' => 'Subject@Example.test', 'kind' => 'access']);
check('only owner, admin and support log requests; customers and finance cannot even see the route', $log('olga')[0] === 404 && $log('fin')[0] === 404 && call($api, 'fin', 'GET', '/platform/gdpr')[0] === 404 && call($api, '', 'GET', '/platform/gdpr')[0] === 401);
foreach ([['email' => 'nope'], ['kind' => 'wibble'], ['received_on' => '2999-01-01'], ['received_on' => '2030-02-31'], ['org_id' => '99999999-9999-4999-8999-999999999999']] as $i => $bad) { check("a bad request is 422 ($i)", $log('sue', $bad)[0] === 422); }
[$s, $r] = $log('sue', ['received_on' => '2026-01-31']);
check('a logged request is due a calendar month after it was received, with the email lower-cased', $s === 201 && $r['due_on'] === '2026-02-28' && $pdo->query("SELECT subject_email FROM gdpr_requests WHERE id = '{$r['id']}'")->fetchColumn() === 'subject@example.test', json_encode($r));
$g1 = $r['id'];
$st = static fn (string $w, string $id, array $b) => call($GLOBALS['api'], $w, 'POST', "/platform/gdpr/$id/status", $b);
check('closing needs an outcome note; a bad status is 422; an unknown request 404', $st('sue', $g1, ['status' => 'completed'])[0] === 422 && $st('sue', $g1, ['status' => 'wibble'])[0] === 422 && $st('sue', '99999999-9999-4999-8999-999999999999', ['status' => 'in_progress'])[0] === 404);
check('moving to in progress leaves it open', $st('sue', $g1, ['status' => 'in_progress'])[0] === 200 && $pdo->query("SELECT closed_at FROM gdpr_requests WHERE id = '$g1'")->fetchColumn() === null);
check('completing an access request stamps the close and queues no login', $st('sue', $g1, ['status' => 'completed', 'note' => 'Sent the export by email'])[1]['account_deletion_queued'] === false && $pdo->query("SELECT closed_at FROM gdpr_requests WHERE id = '$g1'")->fetchColumn() !== null);
check('reopening clears the close but keeps the old outcome note', $st('sue', $g1, ['status' => 'awaiting_information'])[0] === 200 && $pdo->query("SELECT CONCAT(IFNULL(closed_at, 'open'), '|', outcome_note) FROM gdpr_requests WHERE id = '$g1'")->fetchColumn() === 'open|Sent the export by email');
check('the transition is audited with from and to', (int) $pdo->query("SELECT COUNT(*) FROM audit_logs WHERE action = 'gdpr.request_completed'")->fetchColumn() === 1);
$ext = static fn (string $w, string $id, array $b) => call($GLOBALS['api'], $w, 'POST', "/platform/gdpr/$id/extend", $b);
check('support cannot extend; a short reason is refused', $ext('sue', $g1, ['reason' => 'complexity of the request'])[0] === 404 && $ext('adam', $g1, ['reason' => 'too short'])[0] === 422);
check('an extension is two months from the ORIGINAL due date, and once only', $ext('adam', $g1, ['reason' => 'complexity of the request and volume'])[1]['extended_to'] === '2026-04-28' && $ext('adam', $g1, ['reason' => 'complexity of the request and volume'])[1]['error']['code'] === 'already_extended');
[$s, $l] = call($api, 'sue', 'GET', '/platform/gdpr?open=1');
check('the register lists open requests by due date', $s === 200 && $l['total'] >= 1 && $l['requests'][0]['id'] === $g1);
check('an organisation owner sees the requests that name their organisation, nobody else does', ($x = $log('sue', ['org_id' => $org, 'email' => 'sam@example.test'])) && count(call($api, 'olga', 'GET', "/orgs/$org/gdpr")[1]['requests']) === 1 && call($api, 'mark', 'GET', "/orgs/$org/gdpr")[0] === 403 && call($api, 'zed', 'GET', "/orgs/$org/gdpr")[0] === 404);

// ---- a person's own request --------------------------------------------------------------------------------------------------------
$mine = static fn (string $w, array $b) => call($GLOBALS['api'], $w, 'POST', '/me/data-requests', $b);
check('signing in is required; restriction and objection are not self-service', call($api, '', 'POST', '/me/data-requests', ['kind' => 'access'])[0] === 401 && $mine('sam', ['kind' => 'restriction'])[0] === 422 && $mine('sam', ['kind' => 'objection'])[0] === 422);
check('a stranger\'s organisation is refused', $mine('sam', ['kind' => 'access', 'org_id' => $other])[0] === 403);
[$s, $r] = $mine('sam', ['kind' => 'portability', 'org_id' => $org]);
check('a member asks; it is due in a month and is theirs', $s === 201 && $r['already_open'] === false && $r['due_on'] === Gdpr::addMonths(gmdate('Y-m-d'), 1));
$first = $r['id'];
check('asking for the same thing again returns the open one', ($again = $mine('sam', ['kind' => 'portability']))[0] === 200 && $again[1]['already_open'] === true && $again[1]['id'] === $first && (int) $pdo->query("SELECT COUNT(*) FROM gdpr_requests WHERE subject_email = 'sam@example.test' AND kind = 'portability'")->fetchColumn() === 1);
check('five open requests is the limit', (function () use ($mine, $pdo): bool { foreach (['access', 'rectification', 'erasure'] as $k) { $mine('sam', ['kind' => $k]); } $pdo->exec("INSERT INTO gdpr_requests (id, subject_email, kind, received_on, due_on) VALUES (UUID(), 'sam@example.test', 'restriction', CURDATE(), CURDATE())"); return $mine('sam', ['kind' => 'access'])[0] === 200 && (int) $pdo->query("SELECT COUNT(*) FROM gdpr_requests WHERE subject_email = 'sam@example.test'")->fetchColumn() === 5 && $mine('sam', ['kind' => 'objection'])[0] === 422; })());
$pdo->exec("UPDATE gdpr_requests SET status = 'completed', closed_at = UTC_TIMESTAMP(), outcome_note = 'secret internal note' WHERE subject_email = 'sam@example.test' AND kind = 'restriction'");
[$s, $l] = call($api, 'sam', 'GET', '/me/data-requests');
check('a person sees where their requests stand, without the outcome note, the assignee or anyone else\'s', $s === 200 && count($l['requests']) === 5 && !str_contains(json_encode($l), 'secret internal note') && !str_contains(json_encode($l), 'assigned') && count(call($api, 'pat', 'GET', '/me/data-requests')[1]['requests']) === 0);

// ---- closing an erasure ---------------------------------------------------------------------------------------------------------------
$erasure = static fn (string $email) => call($GLOBALS['api'], 'sue', 'POST', '/platform/gdpr', ['email' => $email, 'kind' => 'erasure'])[1]['id'];
$e1 = $erasure('root@example.test');
check('an erasure of someone who holds a platform role cannot be closed, and stays open', $st('sue', $e1, ['status' => 'completed', 'note' => 'Erased all of it'])[1]['error']['code'] === 'holds_platform_role' && $pdo->query("SELECT status FROM gdpr_requests WHERE id = '$e1'")->fetchColumn() === 'received' && (int) $pdo->query('SELECT COUNT(*) FROM account_deletions')->fetchColumn() === 0);
$e2 = $erasure('olga@example.test');
check('an erasure of the only owner of an organisation cannot be closed', $st('sue', $e2, ['status' => 'completed', 'note' => 'Erased all of it'])[1]['error']['code'] === 'sole_owner' && (int) $pdo->query('SELECT COUNT(*) FROM account_deletions')->fetchColumn() === 0);
$e3 = $erasure('nobody-signed-in@example.test');
check('an erasure of an address with no login closes, and queues nothing', $st('sue', $e3, ['status' => 'completed', 'note' => 'We held nothing'])[1]['account_deletion_queued'] === false);

// A leaving manager with a trail across the system.
call($api, 'leaver', 'GET', '/me');
$pdo->prepare("UPDATE users SET clerk_user_id = 'user_leaver' WHERE email = 'leaver@example.test'")->execute();
$pdo->prepare("INSERT INTO memberships (id, org_id, user_id, role, status) SELECT ?, ?, id, 'manager', 'active' FROM users WHERE email = 'leaver@example.test'")->execute([Db::uuid(), $org]);
$leaverStaff = call($api, 'olga', 'POST', "/orgs/$org/staff", ['first_name' => 'Lee', 'last_name' => 'Ver', 'email' => 'leaver@example.test'])[1]['id'];
[$cs, $cr] = call($api, 'leaver', 'POST', '/support/cases', ['subject' => 'Help', 'body' => 'Please help', 'org_id' => $org]);
$caseId = $cr['id'] ?? ''; check('the leaver can raise a case', $cs === 201, json_encode($cr));
$e4 = $erasure('leaver@example.test');
[$s, $r] = $st('sue', $e4, ['status' => 'completed', 'note' => 'Erased, login to follow']);
check('an erasure of an ordinary member closes and queues their login with its Clerk id', $s === 200 && $r['account_deletion_queued'] === true && ($q = $pdo->query('SELECT clerk_user_id, status FROM account_deletions')->fetch()) && $q['clerk_user_id'] === 'user_leaver' && $q['status'] === 'pending');
$noKey = new Ctx($pdo, new RateLimiter($pdo), 'https://rotaflow.example.test', test_private_root(), null, 'open', test_config());
check('without a Clerk key the queue waits and nothing is deleted', str_contains(Gdpr::cron($noKey, $clerk), 'clerk_secret_key not set') && $clerkCalls === [] && (int) $pdo->query("SELECT COUNT(*) FROM users WHERE email = 'leaver@example.test'")->fetchColumn() === 1);
$clerkStatus = 500;
Gdpr::cron($ctx, $clerk);
check('a Clerk failure keeps the person and counts the attempt', (int) $pdo->query("SELECT COUNT(*) FROM users WHERE email = 'leaver@example.test'")->fetchColumn() === 1 && (int) $pdo->query('SELECT attempts FROM account_deletions')->fetchColumn() === 1 && $pdo->query('SELECT status FROM account_deletions')->fetchColumn() === 'pending');
$clerkStatus = 404;
$clerkCalls = [];
Gdpr::cron($ctx, $clerk);
check('Clerk not having the login any more counts as done; the call was a DELETE of that user with the key', $clerkCalls[0][0] === 'DELETE' && $clerkCalls[0][1] === 'https://api.clerk.com/v1/users/user_leaver' && $clerkCalls[0][2]['Authorization'] === 'Bearer clerk-test-secret-not-real' && $pdo->query('SELECT status FROM account_deletions')->fetchColumn() === 'done');
check('the local person is gone, and what pointed at them is detached, not lost', (int) $pdo->query("SELECT COUNT(*) FROM users WHERE email = 'leaver@example.test'")->fetchColumn() === 0 && (int) $pdo->query("SELECT COUNT(*) FROM memberships WHERE org_id = '$org'")->fetchColumn() === 4 && $pdo->query("SELECT user_id FROM staff_profiles WHERE id = '$leaverStaff'")->fetchColumn() === null && $pdo->query("SELECT requester_id FROM support_cases WHERE id = '$caseId'")->fetchColumn() === null);
check('the audit trail keeps what they did', (int) $pdo->query("SELECT COUNT(*) FROM audit_logs WHERE entity_id = '$caseId'")->fetchColumn() === 1);
$pdo->exec("UPDATE users SET clerk_user_id = 'not a clerk id' WHERE email = 'pat@example.test'");
$pdo->prepare("INSERT INTO account_deletions (id, user_id, clerk_user_id) VALUES (UUID(), ?, 'not a clerk id')")->execute([$uid('pat')]);
for ($i = 0; $i < 5; $i++) { Gdpr::cron($ctx, $clerk); }
check('five failures abandon a row where it can be seen, and the person is untouched', $pdo->query("SELECT status FROM account_deletions WHERE clerk_user_id = 'not a clerk id'")->fetchColumn() === 'abandoned' && (int) $pdo->query("SELECT COUNT(*) FROM users WHERE email = 'pat@example.test'")->fetchColumn() === 1);
$pdo->exec("UPDATE users SET clerk_user_id = NULL WHERE email = 'pat@example.test'");
$sueSession = null;
$pdo->prepare("INSERT INTO account_deletions (id, user_id, clerk_user_id) VALUES (UUID(), ?, NULL)")->execute([$uid('fin')]);
$pdo->exec("DELETE FROM platform_admins WHERE user_id = '{$uid('fin')}'");
check('a person who never signed in to Clerk needs no Clerk call', (function () use ($ctx, $clerk, &$clerkCalls, $pdo): bool { $clerkCalls = []; Gdpr::cron($ctx, $clerk); return $clerkCalls === [] && (int) $pdo->query("SELECT COUNT(*) FROM users WHERE email = 'fin@example.test'")->fetchColumn() === 0; })());
check('a finished row is kept a year, no more', (function () use ($pdo, $ctx, $clerk): bool { $pdo->exec("UPDATE account_deletions SET completed_at = DATE_SUB(UTC_TIMESTAMP(), INTERVAL 13 MONTH) WHERE status = 'done' LIMIT 1"); Gdpr::cron($ctx, $clerk); return (int) $pdo->query("SELECT COUNT(*) FROM account_deletions WHERE status = 'done'")->fetchColumn() === 1; })());

// ---- erasing a staff member ------------------------------------------------------------------------------------------------------------
$site = call($api, 'olga', 'POST', "/orgs/$org/locations", ['name' => 'Oak'])[1]['id'];
$samStaff = call($api, 'olga', 'POST', "/orgs/$org/staff", ['first_name' => 'Sam', 'last_name' => 'Smith', 'email' => 'sam@example.test', 'phone' => '07700900123', 'payroll_id' => 'P-100'])[1]['id'];
$pdo->prepare('UPDATE staff_profiles SET photo_path = ? WHERE id = ?')->execute(["$org/$samStaff/me.jpg", $samStaff]);
call($api, 'olga', 'POST', "/orgs/$org/staff/$samStaff/emergency-contacts", ['name' => 'Mum', 'phone' => '07700900999']);
call($api, 'sam', 'POST', "/orgs/$org/calendar-feed/issue");
$rota = call($api, 'olga', 'POST', "/orgs/$org/rotas", ['name' => 'R', 'period_start' => '2030-06-03', 'period_end' => '2030-06-09', 'location_id' => $site])[1]['rota']['id'];
$shift = call($api, 'olga', 'POST', "/orgs/$org/shifts", ['rota_id' => $rota, 'location_id' => $site, 'staff_profile_id' => $samStaff, 'starts_at' => '2030-06-03T09:00:00Z', 'ends_at' => '2030-06-03T17:00:00Z'])[1]['shift']['id'] ?? null;
$erase = static fn (string $w, string $s) => call($GLOBALS['api'], $w, 'POST', "/orgs/{$GLOBALS['org']}/staff/$s/erase");
check('only the organisation\'s owner erases; a manager, a stranger and platform staff cannot', $erase('mark', $samStaff)[0] === 403 && $erase('zed', $samStaff)[0] === 404 && $erase('sue', $samStaff)[0] === 404 && $erase('olga', '99999999-9999-4999-8999-999999999999')[0] === 404);
check('erasing succeeds', $erase('olga', $samStaff)[0] === 200);
$row = $pdo->query("SELECT * FROM staff_profiles WHERE id = '$samStaff'")->fetch();
check('the record is anonymised in place: name, email, phone, photo, payroll id, login link and active are cleared', $row['first_name'] === 'Deleted' && $row['last_name'] === 'Member' && $row['email'] === null && $row['phone'] === null && $row['photo_path'] === null && $row['photo_url'] === null && $row['payroll_id'] === null && $row['user_id'] === null && (int) $row['active'] === 0);
check('their emergency contacts are deleted and their calendar feed revoked', (int) $pdo->query("SELECT COUNT(*) FROM emergency_contacts WHERE staff_profile_id = '$samStaff'")->fetchColumn() === 0 && (int) $pdo->query("SELECT COUNT(*) FROM calendar_feed_tokens WHERE staff_profile_id = '$samStaff' AND revoked_at IS NULL")->fetchColumn() === 0);
check('the rota history stays attached to the anonymous record', $shift !== null && $pdo->query("SELECT staff_profile_id FROM shifts WHERE id = '$shift'")->fetchColumn() === $samStaff);
check('both stores are queued to lose the person\'s folder', (int) $pdo->query("SELECT COUNT(*) FROM storage_deletions WHERE path = '$org/$samStaff' AND is_folder = 1 AND reason = 'person_erased'")->fetchColumn() === 2);
check('it is audited, and the login and membership are NOT touched', (int) $pdo->query("SELECT COUNT(*) FROM audit_logs WHERE action = 'gdpr_anonymize' AND entity_id = '$samStaff'")->fetchColumn() === 1 && (int) $pdo->query("SELECT COUNT(*) FROM users WHERE email = 'sam@example.test'")->fetchColumn() === 1 && (int) $pdo->query("SELECT COUNT(*) FROM memberships WHERE user_id = '{$uid('sam')}' AND org_id = '$org'")->fetchColumn() === 1);
check('erasing twice is harmless', $erase('olga', $samStaff)[0] === 200);
$cols = $pdo->query("SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'staff_profiles'")->fetchAll(PDO::FETCH_COLUMN);
$known = array_merge(Gdpr::ERASURE_CLEARED, Gdpr::ERASURE_RETAINED);
check('every staff_profiles column is either cleared by an erasure or deliberately kept (add a column and this fails until you decide)', array_diff($cols, $known) === [] && array_diff($known, $cols) === [], 'unlisted: ' . implode(',', array_diff($cols, $known)) . ' gone: ' . implode(',', array_diff($known, $cols)));

// ---- the files an erasure owes ---------------------------------------------------------------------------------------------------------------
$store = FileStore::forCtx($ctx);
$store->put(FileStore::PHOTOS, "$org/$samStaff/me.jpg", 'JPG');
$store->put(FileStore::DOCUMENTS, "$org/$samStaff/rtw.pdf", 'PDF');
$store->put(FileStore::DOCUMENTS, "$org/$leaverStaff/other.pdf", 'KEEP');
$out = Lifecycle::cron($ctx);
check('cron removes the erased person\'s files from both stores and no one else\'s', !$store->exists(FileStore::PHOTOS, "$org/$samStaff/me.jpg") && !$store->exists(FileStore::DOCUMENTS, "$org/$samStaff/rtw.pdf") && $store->exists(FileStore::DOCUMENTS, "$org/$leaverStaff/other.pdf") && str_contains($out, 'removed=2'), $out);
check('the queue rows are marked done', (int) $pdo->query("SELECT COUNT(*) FROM storage_deletions WHERE path = '$org/$samStaff' AND status = 'done'")->fetchColumn() === 2);
$pdo->exec("INSERT INTO storage_deletions (id, org_id, bucket, path, is_folder, reason, attempts) VALUES (UUID(), '$org', 'staff-documents', '../../etc', 0, 'document_removed', 4)");
Lifecycle::cron($ctx);
check('a path the store refuses is abandoned after five tries, never executed', $pdo->query("SELECT status FROM storage_deletions WHERE path = '../../etc'")->fetchColumn() === 'abandoned');
$pdo->exec("UPDATE storage_deletions SET completed_at = DATE_SUB(UTC_TIMESTAMP(), INTERVAL 31 DAY) WHERE status = 'done'");
Lifecycle::cron($ctx);
check('finished rows are kept thirty days', (int) $pdo->query("SELECT COUNT(*) FROM storage_deletions WHERE status = 'done'")->fetchColumn() === 0);

// ---- deleting an organisation ------------------------------------------------------------------------------------------------------------------
$del = static fn (string $w, array $b, ?string $o = null) => call($GLOBALS['api'], $w, 'POST', '/orgs/' . ($o ?? $GLOBALS['org']) . '/delete', $b);
check('a preview of what would go: owner only', call($api, 'olga', 'GET', "/orgs/$org/deletion-preview")[1]['preview']['shifts'] === 1 && call($api, 'mark', 'GET', "/orgs/$org/deletion-preview")[0] === 403 && call($api, 'zed', 'GET', "/orgs/$org/deletion-preview")[0] === 404);
check('a manager cannot delete; a stranger gets 404 (not "no such organisation")', $del('mark', ['confirm_name' => 'Life Org'])[0] === 403 && $del('zed', ['confirm_name' => 'Life Org'])[0] === 404 && $del('sue', ['confirm_name' => 'Life Org'])[0] === 404);
foreach ([[], ['confirm_name' => 'life org'], ['confirm_name' => 'Life Org '], ['confirm_name' => ' Life Org'], ['confirm_name' => ['Life Org']]] as $i => $bad) {
    check("the wrong name changes nothing ($i)", $del('olga', $bad)[1]['error']['code'] === 'name_mismatch' && (int) $pdo->query("SELECT COUNT(*) FROM organisations WHERE id = '$org'")->fetchColumn() === 1);
}
$ev = call($api, 'olga', 'POST', "/orgs/$org/clock-events", ['type' => 'in', 'method' => 'manual']);
call($api, 'olga', 'POST', "/orgs/$org/leave", ['start_date' => '2030-09-01', 'end_date' => '2030-09-02']);
call($api, 'olga', 'POST', "/orgs/$org/announcements", ['title' => 'Hello', 'body' => 'World', 'scope' => 'org']);
$rid = call($api, 'zed', 'POST', '/platform/gdpr', [])[0]; // not staff: a no-op
$gOrg = $log('sue', ['org_id' => $org, 'email' => 'someone@example.test'])[1]['id'];
$orgCase = call($api, 'olga', 'POST', '/support/cases', ['subject' => 'Org case', 'body' => 'Hello there', 'org_id' => $org])[1]['id'];
[$s, $r] = $del('olga', ['confirm_name' => 'Life Org']);
check('the owner deletes the organisation with the exact name', $s === 200 && $r['deleted'] === true && $r['removed']['shifts'] === 1, json_encode($r));
check('the organisation is gone, and so is every row in every table that belonged to it', (function () use ($pdo, $org): bool {
    $left = [];
    foreach ($pdo->query("SELECT TABLE_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND COLUMN_NAME = 'org_id'")->fetchAll(PDO::FETCH_COLUMN) as $t) {
        if (in_array($t, ['audit_logs', 'storage_deletions', 'support_cases', 'gdpr_requests', 'billing_events'], true)) { continue; }
        $n = (int) $pdo->query("SELECT COUNT(*) FROM `$t` WHERE org_id = '$org'")->fetchColumn();
        if ($n > 0) { $left[] = "$t=$n"; }
    }
    return $left === [] && (int) $pdo->query("SELECT COUNT(*) FROM organisations WHERE id = '$org'")->fetchColumn() === 0;
})(), 'left behind');
check('the audit trail survives, with a critical platform-only entry carrying the name and counts', ($a = $pdo->query("SELECT severity, visibility, metadata FROM audit_logs WHERE action = 'org.deleted'")->fetch()) && $a['severity'] === 'critical' && $a['visibility'] === 'platform_only' && str_contains($a['metadata'], 'Life Org') && (int) $pdo->query("SELECT COUNT(*) FROM audit_logs WHERE org_id = '$org'")->fetchColumn() > 3);
check('support cases and data-subject requests survive, detached from the tenant', $pdo->query("SELECT org_id FROM support_cases WHERE id = '$orgCase'")->fetchColumn() === null && $pdo->query("SELECT org_id FROM gdpr_requests WHERE id = '$gOrg'")->fetchColumn() === null);
check('both stores are queued to lose the organisation\'s folder', (int) $pdo->query("SELECT COUNT(*) FROM storage_deletions WHERE path = '$org' AND is_folder = 1 AND reason = 'organisation_deleted'")->fetchColumn() === 2);
check('the people are not deleted - they may belong elsewhere', (int) $pdo->query("SELECT COUNT(*) FROM users WHERE email IN ('olga@example.test','mark@example.test')")->fetchColumn() === 2);
check('the other organisation is untouched', (int) $pdo->query("SELECT COUNT(*) FROM organisations WHERE id = '$other'")->fetchColumn() === 1 && call($api, 'zed', 'GET', "/orgs/$other/locations")[0] === 200);
$org2 = call($api, 'ann', 'POST', '/orgs', ['name' => 'Second'])[1]['org']['id'];
check('a platform owner or admin can delete too, with the name; support and finance cannot', call($api, 'sue', 'POST', "/platform/orgs/$org2/delete", ['confirm_name' => 'Second'])[0] === 404 && call($api, 'adam', 'POST', "/platform/orgs/$org2/delete", ['confirm_name' => 'second'])[0] === 422 && call($api, 'adam', 'GET', "/platform/orgs/$org2/deletion-preview")[0] === 200 && call($api, 'adam', 'POST', "/platform/orgs/$org2/delete", ['confirm_name' => 'Second'])[0] === 200 && str_contains((string) $pdo->query("SELECT metadata FROM audit_logs WHERE action = 'org.deleted' ORDER BY id DESC LIMIT 1")->fetchColumn(), '"by_platform_admin":true'));
check('deleting is rate limited', (function () use ($api): bool { $last = 0; for ($i = 0; $i < 7; $i++) { $last = call($api, 'adam', 'POST', '/platform/orgs/99999999-9999-4999-8999-999999999999/delete', ['confirm_name' => 'x'])[0]; } return in_array($last, [404, 429], true); })());

// ---- retention -------------------------------------------------------------------------------------------------------------------------------------
$org3 = call($api, 'rita', 'POST', '/orgs', ['name' => 'Ageing Org'])[1]['org']['id'];
$site3 = call($api, 'rita', 'POST', "/orgs/$org3/locations", ['name' => 'Elm'])[1]['id'];
$staff3 = call($api, 'rita', 'POST', "/orgs/$org3/staff", ['first_name' => 'Rita'])[1]['id'];
$mkShift = static function (string $rotaStart, string $start) use ($api, $org3, $site3, $staff3): array {
    $end = (new DateTimeImmutable($rotaStart))->modify('+6 days')->format('Y-m-d');
    $rota = call($api, 'rita', 'POST', "/orgs/$org3/rotas", ['name' => "R $rotaStart", 'period_start' => $rotaStart, 'period_end' => $end, 'location_id' => $site3])[1]['rota']['id'];
    $sh = call($api, 'rita', 'POST', "/orgs/$org3/shifts", ['rota_id' => $rota, 'location_id' => $site3, 'staff_profile_id' => $staff3, 'starts_at' => $start . 'T09:00:00Z', 'ends_at' => $start . 'T17:00:00Z'])[1]['shift']['id'];
    return [$rota, $sh];
};
[$newRota, $newShift] = $mkShift('2030-06-03', '2030-06-03');
[$oldRota, $oldShift] = $mkShift('2019-01-07', '2019-01-07');
[$halfRota, $halfShift] = $mkShift('2029-12-31', '2029-12-31');
$pdo->exec("UPDATE rotas SET status = 'draft' WHERE id IN ('$oldRota','$halfRota')");
// an old rota that still has a recent shift keeps the rota
$pdo->exec("UPDATE shifts SET rota_id = '$oldRota' WHERE id = '$halfShift'");
$oldEvent = call($api, 'rita', 'POST', "/orgs/$org3/clock-events", ['type' => 'in', 'method' => 'manual'])[1]['clock_event']['id'] ?? null;
$pdo->exec("UPDATE clock_events SET event_at = '2019-01-07 09:00:00.000', shift_id = '$oldShift' WHERE id = '$oldEvent'");
$pdo->prepare("INSERT INTO clock_event_corrections (id, org_id, clock_event_id, staff_profile_id, reason, before_value, after_value) SELECT UUID(), org_id, id, staff_profile_id, 'test correction here', '{}', '{}' FROM clock_events WHERE id = ?")->execute([$oldEvent]);
check('a correction cannot be deleted directly - it is append-only', (function () use ($pdo): bool { try { $pdo->exec('DELETE FROM clock_event_corrections'); return false; } catch (PDOException) { return true; } })());
$pdo->exec("INSERT INTO leave_requests (id, org_id, staff_profile_id, type, start_date, end_date, status) VALUES (UUID(), '$org3', '$staff3', 'holiday', '2015-01-05', '2015-01-09', 'approved'), (UUID(), '$org3', '$staff3', 'holiday', '2030-09-01', '2030-09-02', 'pending')");
$pdo->exec("INSERT INTO support_cases (id, reference, requester_email, subject, status, resolved_at, first_response_due_at, resolution_due_at, created_at) VALUES (UUID(), 'CASE-0001', 'a@b.example', 'old resolved', 'resolved', '2015-01-01 00:00:00', NOW(), NOW(), '2015-01-01'), (UUID(), 'CASE-0002', 'a@b.example', 'old open', 'open', NULL, NOW(), NOW(), '2015-01-01')");
$pdo->exec("INSERT INTO enquiries (id, name, work_email, organisation, message, status, created_at) VALUES (UUID(), 'Old', 'o@b.example', 'X', 'a message that is long enough', 'new', '2015-01-01')");
$pdo->exec("INSERT INTO notification_outbox (id, org_id, event_name, payload, status, created_at) VALUES (UUID(), '$org3', 'old/sent', '{}', 'sent', '2015-01-01'), (UUID(), '$org3', 'old/pending', '{}', 'pending', '2015-01-01'), (UUID(), '$org3', 'old/abandoned', '{}', 'abandoned', '2015-01-01')");
$audit = (int) $pdo->query('SELECT COUNT(*) FROM audit_logs')->fetchColumn();
check('eight policies are seeded and the grace-period one is not enforced', (int) $pdo->query('SELECT COUNT(*) FROM retention_policies')->fetchColumn() === 8 && (int) $pdo->query("SELECT enforced FROM retention_policies WHERE data_type = 'deleted_tenant'")->fetchColumn() === 0);
$dry = Retention::run($pdo, true);
$byType = array_column($dry, 'rows_removed', 'data_type');
check('a dry run counts what would go, removes nothing, and never mentions the audit trail', count($dry) === 6 && !isset($byType['audit_log']) && !isset($byType['deleted_tenant']) && $byType['leave'] === 1 && $byType['support_cases'] === 1 && $byType['enquiries'] === 1 && $byType['notifications'] === 2 && (int) $pdo->query("SELECT COUNT(*) FROM leave_requests WHERE start_date = '2015-01-05'")->fetchColumn() === 1 && (int) $pdo->query("SELECT COUNT(*) FROM retention_runs WHERE dry_run = 1")->fetchColumn() === 6, json_encode($byType));
$real = Retention::run($pdo, false);
check('a real run reports no errors', array_filter($real, static fn ($r) => $r['error'] !== null) === [], json_encode($real));
check('old shifts go; recent ones stay', $pdo->query("SELECT COUNT(*) FROM shifts WHERE id = '$oldShift'")->fetchColumn() == 0 && $pdo->query("SELECT COUNT(*) FROM shifts WHERE id IN ('$newShift','$halfShift')")->fetchColumn() == 2);
check('an old rota goes only when nothing still hangs off it', $pdo->query("SELECT COUNT(*) FROM rotas WHERE id = '$oldRota'")->fetchColumn() == 1 && $pdo->query("SELECT COUNT(*) FROM rotas WHERE id = '$newRota'")->fetchColumn() == 1);
$pdo->exec("DELETE FROM shifts WHERE id = '$halfShift'");
check('and a rota with no shifts left is removed on the next run', Retention::run($pdo, false) !== [] && (int) $pdo->query("SELECT COUNT(*) FROM rotas WHERE id = '$oldRota'")->fetchColumn() === 0);
check('old clock events go with their corrections (a cascade is the one way past the append-only rule)', (int) $pdo->query("SELECT COUNT(*) FROM clock_events WHERE id = '$oldEvent'")->fetchColumn() === 0 && (int) $pdo->query('SELECT COUNT(*) FROM clock_event_corrections')->fetchColumn() === 0);
check('old leave goes, upcoming leave stays', (int) $pdo->query("SELECT COUNT(*) FROM leave_requests WHERE start_date = '2015-01-05'")->fetchColumn() === 0 && (int) $pdo->query("SELECT COUNT(*) FROM leave_requests WHERE start_date = '2030-09-01'")->fetchColumn() === 1);
check('only RESOLVED old cases go', (int) $pdo->query("SELECT COUNT(*) FROM support_cases WHERE reference = 'CASE-0001'")->fetchColumn() === 0 && (int) $pdo->query("SELECT COUNT(*) FROM support_cases WHERE reference = 'CASE-0002'")->fetchColumn() === 1);
check('old enquiries go whatever their status', (int) $pdo->query("SELECT COUNT(*) FROM enquiries WHERE name = 'Old'")->fetchColumn() === 0);
check('sent and abandoned notifications go; a pending one is work still owed and stays', (int) $pdo->query("SELECT COUNT(*) FROM notification_outbox WHERE event_name = 'old/pending'")->fetchColumn() === 1 && (int) $pdo->query("SELECT COUNT(*) FROM notification_outbox WHERE event_name IN ('old/sent','old/abandoned')")->fetchColumn() === 0);
check('the audit trail is never removed by retention', (int) $pdo->query('SELECT COUNT(*) FROM audit_logs')->fetchColumn() >= $audit);
$pdo->exec("INSERT INTO retention_policies (data_type, label, retain_months, enforced) VALUES ('mystery', 'Mystery', 12, 1)");
$res = Retention::run($pdo, true);
check('an enforced type with no rule is recorded as an error, not skipped, and the others still run', count($res) === 7 && array_values(array_filter($res, static fn ($r) => $r['data_type'] === 'mystery'))[0]['error'] === 'no rule implemented for this data type' && count(array_filter($res, static fn ($r) => $r['error'] === null)) === 6);
$pdo->exec("DELETE FROM retention_policies WHERE data_type = 'mystery'");
$pdo->exec('DELETE FROM retention_runs');
$t = strtotime(gmdate('Y-m-d') . ' 01:00:00 UTC');
check('cron runs retention once a day, after 02:15 UTC', str_contains(Lifecycle::cron($ctx, $t), 'retention: not due') && str_contains(Lifecycle::cron($ctx, $t + 3 * 3600), 'retention: removed=') && str_contains(Lifecycle::cron($ctx, $t + 4 * 3600), 'already ran today'));
$pdo->exec("INSERT INTO retention_policies (data_type, label, retain_months, enforced) VALUES ('mystery', 'Mystery', 12, 1)");
$pdo->exec('DELETE FROM retention_runs');
check('a failing type is loud in the cron output', str_contains(Lifecycle::cron($ctx, $t + 5 * 3600), 'FAILED=1'));
$pdo->exec("DELETE FROM retention_policies WHERE data_type = 'mystery'");

// who sees retention
call($api, 'fin2', 'GET', '/me'); $pdo->exec("INSERT INTO platform_admins (user_id, role) SELECT id, 'platform_finance' FROM users WHERE email = 'fin2@example.test'");
check('staff read the schedule and runs; only owner and admin run a dry run; customers see nothing', call($api, 'fin2', 'GET', '/platform/retention')[0] === 200 && count(call($api, 'sue', 'GET', '/platform/retention')[1]['policies']) === 8 && call($api, 'sue', 'POST', '/platform/retention/dry-run')[0] === 404 && call($api, 'adam', 'POST', '/platform/retention/dry-run')[0] === 200 && call($api, 'rita', 'GET', '/platform/retention')[0] === 404);

// ---- a guard for the schema: a new restricting link must be handled by organisation deletion ------------------------------------------------
$children = $pdo->query("SELECT DISTINCT TABLE_NAME FROM information_schema.REFERENTIAL_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = DATABASE() AND DELETE_RULE IN ('RESTRICT','NO ACTION') AND REFERENCED_TABLE_NAME <> 'users'")->fetchAll(PDO::FETCH_COLUMN);
check('every table that restricts another inside an organisation is cleared first by organisation deletion (add yours to Lifecycle::CLEAR_FIRST)', array_diff($children, Lifecycle::CLEAR_FIRST) === [], implode(',', array_diff($children, Lifecycle::CLEAR_FIRST)));
