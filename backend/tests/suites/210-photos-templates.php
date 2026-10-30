<?php
declare(strict_types=1);

// Staff photos in the private store, with signed links; and the wording of notification emails.
use RotaFlow\{Db, FileStore};
use RotaFlow\Mod\Photos;

$api = test_api($pdo);
$jpeg = "\xFF\xD8\xFF\xE0" . str_repeat('J', 200);
$png = "\x89PNG\r\n\x1a\n" . str_repeat('P', 200);
$webp = 'RIFF' . "\x10\x00\x00\x00" . 'WEBP' . str_repeat('W', 100);
check('the image type comes from the bytes', Photos::sniff($jpeg) === 'image/jpeg' && Photos::sniff($png) === 'image/png' && Photos::sniff($webp) === 'image/webp' && Photos::sniff('<?php echo 1;') === null && Photos::sniff('GIF89a....') === null && Photos::sniff('') === null && Photos::sniff('<svg onload=alert(1)>') === null);

$org = call($api, 'olga', 'POST', '/orgs', ['name' => 'Photo Org'])[1]['org']['id'];
$other = call($api, 'zed', 'POST', '/orgs', ['name' => 'Elsewhere'])[1]['org']['id'];
foreach (['mark' => 'manager', 'sam' => 'staff', 'pat' => 'staff'] as $n => $r) {
    call($api, $n, 'GET', '/me');
    $pdo->prepare("INSERT INTO memberships (id, org_id, user_id, role, status) SELECT ?, ?, id, ?, 'active' FROM users WHERE email = ?")->execute([Db::uuid(), $org, $r, "$n@example.test"]);
}
$staff = [];
foreach (['sam', 'pat'] as $n) { $staff[$n] = call($api, 'olga', 'POST', "/orgs/$org/staff", ['first_name' => ucfirst($n), 'email' => "$n@example.test"])[1]['id']; }
$zStaff = call($api, 'zed', 'POST', "/orgs/$other/staff", ['first_name' => 'Zoe'])[1]['id'];
$up = static fn (string $w, string $s, string $bytes, ?string $o = null) => call($GLOBALS['api'], $w, 'POST', '/orgs/' . ($o ?? $GLOBALS['org']) . "/staff/$s/photo", ['data' => base64_encode($bytes)]);
$store = FileStore::forCtx(new RotaFlow\Ctx($pdo, new RotaFlow\RateLimiter($pdo), 'https://rotaflow.example.test', test_private_root()));

// ---- uploading ---------------------------------------------------------------------------------------------------------------
check('a stranger gets 404; a colleague cannot change someone else\'s photo; anonymous is 401', $up('zed', $staff['sam'], $jpeg)[0] === 404 && $up('pat', $staff['sam'], $jpeg)[0] === 403 && call($api, '', 'POST', "/orgs/$org/staff/{$staff['sam']}/photo", [])[0] === 401);
check('a staff record in another organisation is 404', $up('olga', $zStaff, $jpeg)[0] === 404);
check('not base64, empty, or missing is 422', call($api, 'sam', 'POST', "/orgs/$org/staff/{$staff['sam']}/photo", ['data' => '!!!not base64!!!'])[0] === 422 && call($api, 'sam', 'POST', "/orgs/$org/staff/{$staff['sam']}/photo", ['data' => ''])[0] === 422 && call($api, 'sam', 'POST', "/orgs/$org/staff/{$staff['sam']}/photo", [])[0] === 422);
check('a script, an SVG or a GIF is refused whatever it claims to be', $up('sam', $staff['sam'], '<?php system($_GET["c"]);')[0] === 415 && $up('sam', $staff['sam'], '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>')[0] === 415 && $up('sam', $staff['sam'], 'GIF89a' . str_repeat('x', 50))[0] === 415);
check('over 2 MB is 413', $up('sam', $staff['sam'], $jpeg . str_repeat('x', 2097152))[0] === 413);
check('a picture just under the limit is fine, and the api allows a body that big', $up('sam', $staff['sam'], $jpeg . str_repeat('x', 2097152 - strlen($jpeg) - 1))[0] === 200);
[$s, $r] = $up('sam', $staff['sam'], $png);
$row = $pdo->query("SELECT photo_path, photo_url FROM staff_profiles WHERE id = '{$staff['sam']}'")->fetch();
check('the person uploads their own; the path is in their own folder and the extension follows the bytes', $s === 200 && preg_match('#^' . $org . '/' . $staff['sam'] . '/[0-9a-f]{24}\.png$#', (string) $row['photo_path']) === 1 && $row['photo_url'] === null && $store->get(FileStore::PHOTOS, $row['photo_path']) === $png);
check('the stored file is private (mode 600)', (fileperms(test_private_root() . '/uploads/staff-photos/' . $row['photo_path']) & 0777) === 0600);
$first = $row['photo_path'];
check('a manager and an owner may change anyone\'s', $up('mark', $staff['pat'], $webp)[0] === 200 && $up('olga', $staff['pat'], $jpeg)[0] === 200);
$pdo->exec("UPDATE staff_profiles SET photo_url = 'https://old.example/pic.jpg', photo_path = NULL WHERE id = '{$staff['pat']}'");
check('a stored photo replaces a pasted link', $up('mark', $staff['pat'], $webp)[0] === 200 && $pdo->query("SELECT photo_url FROM staff_profiles WHERE id = '{$staff['pat']}'")->fetchColumn() === null);
$up('sam', $staff['sam'], $jpeg);
check('replacing queues the old picture for deletion', (int) $pdo->query("SELECT COUNT(*) FROM storage_deletions WHERE path = '$first' AND reason = 'photo_removed' AND is_folder = 0")->fetchColumn() === 1);
check('uploading is audited', (int) $pdo->query("SELECT COUNT(*) FROM audit_logs WHERE action = 'staff.photo_changed'")->fetchColumn() >= 3);
check('uploading is rate limited', (function () use ($up, $jpeg, $staff): bool { $last = 0; for ($i = 0; $i < 22; $i++) { $last = $up('mark', $staff['pat'], $jpeg)[0]; } return $last === 429; })());

// ---- links -------------------------------------------------------------------------------------------------------------------------
[$s, $r] = call($api, 'pat', 'GET', "/orgs/$org/staff/{$staff['sam']}/photo-link");
check('any member gets a link to a colleague\'s picture, good for an hour', $s === 200 && str_starts_with($r['url'], 'https://rotaflow.example.test/api/files?') && strtotime($r['expires_at']) - time() > 3500 && strtotime($r['expires_at']) - time() <= 3600);
check('a stranger gets 404; a person with no photo gets null', call($api, 'zed', 'GET', "/orgs/$org/staff/{$staff['sam']}/photo-link")[0] === 404 && ($x = call($api, 'olga', 'GET', "/orgs/$org/staff/" . call($api, 'olga', 'POST', "/orgs/$org/staff", ['first_name' => 'None'])[1]['id'] . '/photo-link')[1]) && $x['url'] === null);
parse_str((string) parse_url($r['url'], PHP_URL_QUERY), $q);
$get = static fn (array $q) => $GLOBALS['api']->handle('GET', '/files', [], '', '198.51.100.5', $q);
[$s, $f] = $get($q);
check('the link serves the picture, with its real type, privately cached, no sign-in needed', $s === 200 && $f['__raw']['mime'] === 'image/jpeg' && $f['__raw']['body'] === $jpeg && str_starts_with($f['__raw']['cache'], 'private'));
check('a changed path, expiry, bucket or signature is 404', $get(['p' => str_replace('/' . $staff['sam'] . '/', '/' . $staff['pat'] . '/', $q['p'])] + $q)[0] === 404 && $get(['e' => (string) ((int) $q['e'] + 60)] + $q)[0] === 404 && $get(['b' => 'staff-documents'] + $q)[0] === 404 && $get(['s' => str_repeat('0', 64)] + $q)[0] === 404 && $get(array_diff_key($q, ['s' => 1]))[0] === 404 && $get([])[0] === 404);
$expired = (int) time() - 10;
check('an expired link is 404', $get(['e' => (string) $expired, 's' => Photos::sign(test_config(), FileStore::PHOTOS, $q['p'], $expired)] + $q)[0] === 404);
check('a signature made with another key does not verify', $get(['s' => Photos::sign(['secret_key' => 'another'], FileStore::PHOTOS, $q['p'], (int) $q['e'])] + $q)[0] === 404);
$traversal = $org . '/' . $staff['sam'] . '/../../x.png';
check('a path that climbs out is refused even with a valid signature', $get(['p' => $traversal, 's' => Photos::sign(test_config(), FileStore::PHOTOS, $traversal, (int) $q['e'])] + $q)[0] === 404);

// ---- removing and erasing --------------------------------------------------------------------------------------------------------------
$cur = $pdo->query("SELECT photo_path FROM staff_profiles WHERE id = '{$staff['sam']}'")->fetchColumn();
check('a colleague cannot remove it; the person can', call($api, 'pat', 'POST', "/orgs/$org/staff/{$staff['sam']}/photo/delete")[0] === 403 && call($api, 'sam', 'POST', "/orgs/$org/staff/{$staff['sam']}/photo/delete")[0] === 200 && $pdo->query("SELECT photo_path FROM staff_profiles WHERE id = '{$staff['sam']}'")->fetchColumn() === null);
check('a link to a removed picture dies at once, though its file may still be on disk for a moment', $store->exists(FileStore::PHOTOS, $cur) && $get(['p' => $cur, 's' => Photos::sign(test_config(), FileStore::PHOTOS, $cur, (int) $q['e'])] + $q)[0] === 404);
check('removing again is harmless', call($api, 'sam', 'POST', "/orgs/$org/staff/{$staff['sam']}/photo/delete")[0] === 200);
$ctx = new RotaFlow\Ctx($pdo, new RotaFlow\RateLimiter($pdo), 'https://rotaflow.example.test', test_private_root(), null, 'open', test_config());
RotaFlow\Mod\Lifecycle::cron($ctx);
check('cron then deletes the file', !$store->exists(FileStore::PHOTOS, $cur) && !$store->exists(FileStore::PHOTOS, $first));
$pp = (string) $pdo->query("SELECT photo_path FROM staff_profiles WHERE id = '{$staff['pat']}'")->fetchColumn();
call($api, 'olga', 'POST', "/orgs/$org/staff/{$staff['pat']}/erase");
RotaFlow\Mod\Lifecycle::cron($ctx);
check('erasing a person removes their picture and its link', !$store->exists(FileStore::PHOTOS, $pp) && $get(['p' => $pp, 's' => Photos::sign(test_config(), FileStore::PHOTOS, $pp, (int) $q['e'])] + $q)[0] === 404);
$suspended = call($api, 'ann', 'POST', '/orgs', ['name' => 'Suspended'])[1]['org']['id'];
$as = call($api, 'ann', 'POST', "/orgs/$suspended/staff", ['first_name' => 'Ann'])[1]['id'];
$pdo->exec("UPDATE organisations SET status = 'suspended' WHERE id = '$suspended'");
check('a suspended organisation cannot change photos', $up('ann', $as, $jpeg, $suspended)[1]['error']['code'] === 'org_not_active');

// ---- notification templates ---------------------------------------------------------------------------------------------------------------
foreach (['root' => 'platform_owner', 'adam' => 'platform_admin', 'sue' => 'platform_support', 'fin' => 'platform_finance'] as $n => $r) {
    call($api, $n, 'GET', '/me');
    $pdo->prepare('INSERT INTO platform_admins (user_id, role) SELECT id, ? FROM users WHERE email = ?')->execute([$r, "$n@example.test"]);
}
$tpl = static fn (string $w, array $b) => call($GLOBALS['api'], $w, 'POST', '/platform/notification-templates', $b);
$good = ['key' => 'announcement', 'subject' => '{{org_name}}: {{title}}', 'body' => "Hello {{staff_name}},\n\n{{body}}\n\n{{app_url}}"];
check('owner and admin write; support reads; finance and customers see nothing', $tpl('sue', $good)[0] === 404 && $tpl('fin', $good)[0] === 404 && $tpl('olga', $good)[0] === 404 && call($api, 'sue', 'GET', '/platform/notification-templates')[0] === 200 && call($api, 'fin', 'GET', '/platform/notification-templates')[0] === 404);
check('a placeholder that is not filled is refused, naming the ones that are', ($e = $tpl('adam', ['body' => 'Hi {{staf_name}}'] + $good)) && $e[0] === 422 && str_contains($e[1]['error']['message'], 'staf_name') && str_contains($e[1]['error']['message'], '{{staff_name}}') && $tpl('adam', ['subject' => '{{nope}}'] + $good)[0] === 422);
check('a subject is one line; a key is lower-case; both are required', $tpl('adam', ['subject' => "a\nBcc: x@evil.example"] + $good)[0] === 422 && $tpl('adam', ['key' => 'Bad Key'] + $good)[0] === 422 && $tpl('adam', ['subject' => ''] + $good)[0] === 422 && $tpl('adam', ['org_id' => '99999999-9999-4999-8999-999999999999'] + $good)[0] === 422);
check('a platform-wide template is saved and replaced, not duplicated', $tpl('adam', $good)[0] === 200 && $tpl('adam', ['subject' => 'New: {{title}}'] + $good)[0] === 200 && (int) $pdo->query("SELECT COUNT(*) FROM notification_templates WHERE `key` = 'announcement' AND org_id IS NULL")->fetchColumn() === 1 && $pdo->query("SELECT subject FROM notification_templates WHERE `key` = 'announcement'")->fetchColumn() === 'New: {{title}}');
check('an organisation can have its own, which sits beside the platform one', $tpl('root', ['org_id' => $org, 'subject' => 'Mine: {{title}}'] + $good)[0] === 200 && (int) $pdo->query("SELECT COUNT(*) FROM notification_templates WHERE `key` = 'announcement'")->fetchColumn() === 2);
check('the listing names the placeholders and the organisation', ($l = call($api, 'sue', 'GET', '/platform/notification-templates')[1]) && count($l['templates']) === 2 && in_array('staff_name', $l['placeholders'], true));
check('it is audited, to the platform only', (int) $pdo->query("SELECT COUNT(*) FROM audit_logs WHERE action = 'notification_template.saved' AND visibility = 'platform_only'")->fetchColumn() === 3);
check('deleting an organisation\'s own template leaves the platform one; deleting what is not there is 404', call($api, 'adam', 'POST', '/platform/notification-templates/delete', ['key' => 'announcement', 'org_id' => $org])[0] === 200 && (int) $pdo->query("SELECT COUNT(*) FROM notification_templates")->fetchColumn() === 1 && call($api, 'adam', 'POST', '/platform/notification-templates/delete', ['key' => 'announcement', 'org_id' => $org])[0] === 404 && call($api, 'sue', 'POST', '/platform/notification-templates/delete', ['key' => 'announcement'])[0] === 404);
// A saved template is really what gets sent.
$captured = [];
$resolved = (new ReflectionMethod(RotaFlow\Dispatcher::class, 'template'));
$resolved->setAccessible(true);
$d = new RotaFlow\Dispatcher($ctx);
check('the Dispatcher uses the saved wording, and the built-in one for a type with none', $resolved->invoke($d, $org, 'announcement')[0] === 'New: {{title}}' && str_contains($resolved->invoke($d, $org, 'rota')[1], 'Open RotaFlow'));
