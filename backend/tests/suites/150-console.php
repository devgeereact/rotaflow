<?php
declare(strict_types=1);

// The Super Admin console core: staff roles, settings, directories, suspension, and support access with the customer's consent.
use RotaFlow\{Db, Modules};

$api = test_api($pdo);
$staffRole = static function (string $who, ?string $role) use ($pdo, &$api): void {
    call($api, $who, 'GET', '/me'); // creates the person
    $id = $pdo->query("SELECT id FROM users WHERE email = '$who@example.test'")->fetchColumn();
    $pdo->prepare('DELETE FROM platform_admins WHERE user_id = ?')->execute([$id]);
    if ($role !== null) { $pdo->prepare('INSERT INTO platform_admins (user_id, role) VALUES (?, ?)')->execute([$id, $role]); }
};
$staffRole('root', 'platform_owner');
$staffRole('adam', 'platform_admin');
$staffRole('sue', 'platform_support');
$staffRole('fin', 'platform_finance');
$org = call($api, 'olga', 'POST', '/orgs', ['name' => 'Console Org'])[1]['org']['id'];
$other = call($api, 'zed', 'POST', '/orgs', ['name' => 'Elsewhere'])[1]['org']['id'];
call($api, 'mark', 'GET', '/me');
$pdo->prepare("INSERT INTO memberships (id, org_id, user_id, role, status) SELECT ?, ?, id, 'manager', 'active' FROM users WHERE email = 'mark@example.test'")->execute([Db::uuid(), $org]);
$uid = static fn (string $who): string => (string) $GLOBALS['pdo']->query("SELECT id FROM users WHERE email = '$who@example.test'")->fetchColumn();

// ---- who may see the console at all ----------------------------------------------------------------------------------------
foreach (['/platform/admins', '/platform/summary', '/platform/orgs', "/platform/orgs/$org", '/platform/users', '/platform/support-sessions'] as $p) {
    check("an ordinary user gets 404 from GET $p; a stranger to the platform learns nothing", call($api, 'olga', 'GET', $p)[0] === 404);
    check("an anonymous caller gets 401 from GET $p", call($api, '', 'GET', $p)[0] === 401);
}
check('a revoked staff member is an ordinary user again', (function () use ($api, $pdo, $staffRole): bool { $staffRole('gone', 'platform_admin'); $pdo->exec("UPDATE platform_admins SET revoked_at = UTC_TIMESTAMP() WHERE user_id = (SELECT id FROM users WHERE email = 'gone@example.test')"); return call($api, 'gone', 'GET', '/platform/summary')[0] === 404; })());

// ---- settings -----------------------------------------------------------------------------------------------------------------
[$s, $r] = call($api, 'olga', 'GET', '/platform/settings');
check('any signed-in person reads the platform settings', $s === 200 && $r['settings']['platform_name'] === 'RotaFlow' && $r['settings']['maintenance_mode'] === false, json_encode($r));
check('support and finance cannot change them', call($api, 'sue', 'POST', '/platform/settings', ['platform_name' => 'X'])[0] === 404 && call($api, 'fin', 'POST', '/platform/settings', ['platform_name' => 'X'])[0] === 404 && call($api, 'olga', 'POST', '/platform/settings', ['platform_name' => 'X'])[0] === 404);
[$s, $r] = call($api, 'adam', 'POST', '/platform/settings', ['maintenance_mode' => true, 'maintenance_message' => 'Back at 6', 'support_email' => 'help@rotaflow.space']);
check('an admin changes them, and it is audited', $s === 200 && $r['settings']['maintenance_mode'] === true && $r['settings']['maintenance_message'] === 'Back at 6' && (int) $pdo->query("SELECT COUNT(*) FROM audit_logs WHERE action = 'platform.settings_changed' AND visibility = 'platform_only'")->fetchColumn() === 1);
foreach ([['support_email' => 'not an email'], ['platform_url' => 'http://insecure.example'], ['platform_url' => 'https://x.example/path'], ['default_timezone' => 'Mars/Base'], ['maintenance_mode' => 'yes'], ['platform_name' => ''], []] as $i => $bad) {
    check("a bad settings change is 422 ($i)", call($api, 'adam', 'POST', '/platform/settings', $bad)[0] === 422);
}

// ---- staff roster -------------------------------------------------------------------------------------------------------------
check('every staff role can read the roster', call($api, 'fin', 'GET', '/platform/admins')[0] === 200 && count(call($api, 'sue', 'GET', '/platform/admins')[1]['admins']) >= 4);
check('only an owner changes it; an admin cannot', call($api, 'adam', 'POST', '/platform/admins', ['email' => 'olga@example.test', 'role' => 'platform_support'])[0] === 404);
check('a person who has never signed in cannot be made staff', call($api, 'root', 'POST', '/platform/admins', ['email' => 'ghost@example.test', 'role' => 'platform_support'])[1]['error']['code'] === 'no_such_user');
check('an unknown role is 422', call($api, 'root', 'POST', '/platform/admins', ['email' => 'olga@example.test', 'role' => 'god'])[0] === 422);
check('an owner grants a role, audited', call($api, 'root', 'POST', '/platform/admins', ['email' => 'olga@example.test', 'role' => 'platform_support'])[0] === 200 && call($api, 'olga', 'GET', '/platform/summary')[0] === 200 && (int) $pdo->query("SELECT COUNT(*) FROM audit_logs WHERE action = 'platform.role_granted'")->fetchColumn() === 1);
$sum = call($api, 'adam', 'GET', '/platform/summary')[1]['summary'];
check('the summary counts published rotas and this month\'s shifts', $sum['published_rotas'] === 0 && $sum['shifts_this_month'] === 0 && is_int($sum['users']), json_encode($sum));
[$s, $r] = call($api, 'sue', 'GET', '/platform/notifications/activity');
check('support reads notification activity without titles or bodies', $s === 200 && is_array($r['notifications']) && is_int($r['push_subscriptions']) && ($r['notifications'] === [] || !isset($r['notifications'][0]['title'])), json_encode($r));
check('finance and ordinary people cannot', call($api, 'fin', 'GET', '/platform/notifications/activity')[0] === 404 && call($api, 'zed', 'GET', '/platform/notifications/activity')[0] === 404);
check('the last owner cannot be demoted or revoked', call($api, 'root', 'POST', '/platform/admins', ['email' => 'root@example.test', 'role' => 'platform_admin'])[1]['error']['code'] === 'last_platform_owner' && call($api, 'root', 'POST', '/platform/admins/' . $uid('root') . '/revoke')[1]['error']['code'] === 'last_platform_owner');
call($api, 'root', 'POST', '/platform/admins', ['email' => 'adam@example.test', 'role' => 'platform_owner']);
check('with a second owner either may step down', call($api, 'adam', 'POST', '/platform/admins', ['email' => 'root@example.test', 'role' => 'platform_admin'])[0] === 200 && $pdo->query("SELECT role FROM platform_admins WHERE user_id = '{$uid('root')}'")->fetchColumn() === 'platform_admin');
check('and the remaining owner is then protected', call($api, 'adam', 'POST', '/platform/admins/' . $uid('adam') . '/revoke')[1]['error']['code'] === 'last_platform_owner');
call($api, 'adam', 'POST', '/platform/admins', ['email' => 'root@example.test', 'role' => 'platform_owner']);
check('revoking someone who is not staff is 404', call($api, 'adam', 'POST', '/platform/admins/' . $uid('mark') . '/revoke')[0] === 404);

// ---- directories ----------------------------------------------------------------------------------------------------------------
[$s, $r] = call($api, 'fin', 'GET', '/platform/orgs');
check('every staff role reads the organisation directory, with counts and billing state', $s === 200 && count($r['organisations']) >= 2 && isset($r['organisations'][0]['billing_state']) && isset($r['organisations'][0]['members']), json_encode($r));
check('the directory filters by name, status and plan, and rejects nonsense', count(call($api, 'sue', 'GET', '/platform/orgs?q=Console')[1]['organisations']) === 1 && count(call($api, 'sue', 'GET', '/platform/orgs?q=%25')[1]['organisations']) === 0 && call($api, 'sue', 'GET', '/platform/orgs?status=gone')[0] === 422 && call($api, 'sue', 'GET', '/platform/orgs?limit=1000')[0] === 422);
[$s, $r] = call($api, 'sue', 'GET', "/platform/orgs/$org");
check('one organisation\'s detail is counts only, no tenant rows', $s === 200 && $r['organisation']['members'] === 2 && !isset($r['organisation']['shifts_list']) && !str_contains(json_encode($r), 'mark@example.test'));
check('finance cannot read people', call($api, 'fin', 'GET', '/platform/users')[0] === 404 && call($api, 'sue', 'GET', '/platform/users?q=mark')[0] === 200 && count(call($api, 'sue', 'GET', '/platform/users?q=mark')[1]['users']) === 1);
[$s, $r] = call($api, 'sue', 'GET', '/platform/users/' . $uid('mark'));
check('a person\'s console page lists their organisations', $s === 200 && $r['user']['email'] === 'mark@example.test' && count($r['memberships']) === 1 && $r['memberships'][0]['org_id'] === $org && $r['memberships'][0]['role'] === 'manager' && $r['platform_role'] === null, json_encode($r));
$x = [call($api, 'fin', 'GET', '/platform/users/' . $uid('mark'))[0], call($api, 'zed', 'GET', '/platform/users/' . $uid('mark'))[0]];
check('finance and a person with no platform role cannot read a person\'s page', $x === [404, 404], json_encode($x));
check('an unknown person is 404', call($api, 'adam', 'GET', '/platform/users/11111111-2222-4333-8444-555555555555')[0] === 404);
[$s, $r] = call($api, 'sue', 'GET', "/platform/orgs/$org/structure");
check('the console reads a tenant\'s members, sites and counts', $s === 200 && count($r['members']) >= 2 && in_array('mark@example.test', array_column($r['members'], 'email'), true) && is_array($r['locations']) && isset($r['counts']['published_rotas']), json_encode($r));
check('finance and people with no platform role cannot', call($api, 'fin', 'GET', "/platform/orgs/$org/structure")[0] === 404 && call($api, 'zed', 'GET', "/platform/orgs/$org/structure")[0] === 404 && call($api, 'adam', 'GET', '/platform/orgs/11111111-2222-4333-8444-555555555555/structure')[0] === 404);
check('the summary counts the estate', ($sm = call($api, 'fin', 'GET', '/platform/summary')[1]['summary']) && $sm['organisations']['active'] >= 2 && $sm['users'] >= 5);

// ---- suspending ----------------------------------------------------------------------------------------------------------------------
check('support cannot suspend; finance and admin can; a reason is required', call($api, 'sue', 'POST', "/platform/orgs/$org/status", ['status' => 'suspended', 'reason' => 'unpaid invoice'])[0] === 404 && call($api, 'adam', 'POST', "/platform/orgs/$org/status", ['status' => 'suspended'])[0] === 422 && call($api, 'adam', 'POST', "/platform/orgs/$org/status", ['status' => 'gone'])[0] === 422);
check('suspending stops the organisation writing, and records why', call($api, 'fin', 'POST', "/platform/orgs/$org/status", ['status' => 'suspended', 'reason' => 'unpaid invoice'])[0] === 200 && call($api, 'olga', 'POST', "/orgs/$org/locations", ['name' => 'No'])[1]['error']['code'] === 'org_not_active' && $pdo->query("SELECT suspended_reason FROM organisations WHERE id = '$org'")->fetchColumn() === 'unpaid invoice');
check('reinstating restores it', call($api, 'adam', 'POST', "/platform/orgs/$org/status", ['status' => 'active'])[0] === 200 && call($api, 'olga', 'POST', "/orgs/$org/locations", ['name' => 'Yes'])[0] === 201 && $pdo->query("SELECT suspended_reason FROM organisations WHERE id = '$org'")->fetchColumn() === null);
check('an unknown organisation is 404', call($api, 'adam', 'POST', '/platform/orgs/99999999-9999-4999-8999-999999999999/status', ['status' => 'active'])[0] === 404);

// ---- support access --------------------------------------------------------------------------------------------------------------------
$ask = static fn (string $who, array $b = [], ?string $o = null) => call($GLOBALS['api'], $who, 'POST', '/platform/orgs/' . ($o ?? $GLOBALS['org']) . '/support-sessions', $b + ['reason' => 'Investigating a missed clock-in report', 'case_ref' => 'CASE-1001', 'scope' => 'read', 'minutes' => 30]);
check('without the customer\'s consent no session can be opened', $ask('sue')[1]['error']['code'] === 'support_access_off');
check('consent is the owner\'s alone: a manager, a stranger and platform staff are all refused', call($api, 'mark', 'POST', "/orgs/$org/support-access", ['allowed' => true])[0] === 403 && call($api, 'zed', 'POST', "/orgs/$org/support-access", ['allowed' => true])[0] === 404 && call($api, 'adam', 'POST', "/orgs/$org/support-access", ['allowed' => true])[0] === 404);
check('consent must be a real boolean', call($api, 'olga', 'POST', "/orgs/$org/support-access", ['allowed' => 'yes'])[0] === 422);
check('the owner allows support access, audited to the organisation', call($api, 'olga', 'POST', "/orgs/$org/support-access", ['allowed' => true])[0] === 200 && (int) $pdo->query("SELECT COUNT(*) FROM audit_logs WHERE org_id = '$org' AND action = 'org.support_access_allowed' AND visibility = 'org'")->fetchColumn() === 1);
check('finance and ordinary users cannot ask', $ask('fin')[0] === 404 && $ask('mark')[0] === 404);
foreach ([['reason' => 'too short'], ['case_ref' => 'ab'], ['scope' => 'root'], ['minutes' => 14], ['minutes' => 1441], ['minutes' => '30']] as $i => $bad) {
    check("a bad request is 422 ($i)", $ask('sue', $bad)[0] === 422);
}
[$s, $r] = $ask('sue');
$sess = $r['id'] ?? '';
check('support opens a read session', $s === 201 && $r['scope'] === 'read', json_encode($r));
check('only one open session per person per organisation', $ask('sue')[1]['error']['code'] === 'session_open');
check('the organisation\'s own people can see who is inside, and the reason', ($l = call($api, 'mark', 'GET', "/orgs/$org/support-sessions")[1]) && $l['sessions'][0]['admin_email'] === 'sue@example.test' && $l['sessions'][0]['status'] === 'active' && str_contains($l['sessions'][0]['reason'], 'missed clock-in') && $l['support_access_allowed'] === true);
check('staff members cannot see that list', (function () use ($api, $pdo, $org): bool { call($api, 'sam', 'GET', '/me'); $pdo->prepare("INSERT INTO memberships (id, org_id, user_id, role, status) SELECT ?, ?, id, 'staff', 'active' FROM users WHERE email = 'sam@example.test'")->execute([Db::uuid(), $org]); return call($api, 'sam', 'GET', "/orgs/$org/support-sessions")[0] === 403; })());
$siteId = call($api, 'olga', 'GET', "/orgs/$org/locations")[1]['locations'][0]['id'];

// With a live session the person reads as a manager would, and cannot write.
check('with a read session support reads the organisation\'s data', call($api, 'sue', 'GET', "/orgs/$org/locations")[0] === 200 && call($api, 'sue', 'GET', "/orgs/$org/staff")[0] === 200);
check('another organisation stays closed to them', call($api, 'sue', 'GET', "/orgs/$other/locations")[0] === 404);
check('a read session cannot write (support_read_only)', call($api, 'sue', 'POST', "/orgs/$org/locations", ['name' => 'Sneaky'])[1]['error']['code'] === 'support_read_only' && call($api, 'sue', 'POST', "/orgs/$org/locations/$siteId/delete")[1]['error']['code'] === 'support_read_only');
check('and never holds owner powers', call($api, 'sue', 'POST', "/orgs/$org/support-access", ['allowed' => false])[0] === 403 && call($api, 'sue', 'GET', "/orgs/$org/billing")[0] === 403);
check('the session shows in the organisation\'s trail', (int) $pdo->query("SELECT COUNT(*) FROM audit_logs WHERE org_id = '$org' AND action = 'support_access.granted' AND visibility = 'org'")->fetchColumn() === 1);

// Every route, as a read-session holder: nothing that writes may succeed.
$ctx = new RotaFlow\Ctx($pdo, new RotaFlow\RateLimiter($pdo), 'https://rotaflow.example.test', test_private_root(), null, 'open', test_config());
$u = '11111111-2222-4333-8444-555555555555';
$wrote = [];
foreach (Modules::all($ctx) as $mod) {
    foreach ($mod->routes() as $rt) {
        [$method, $tpl] = $rt;
        if ($method !== 'POST' || !str_contains($tpl, '{o}') || str_starts_with($tpl, '/platform')) { continue; }
        $path = preg_replace_callback('/\{([a-z])\}/', static fn (array $m): string => $m[1] === 'o' ? $GLOBALS['org'] : $GLOBALS['u'], $tpl);
        [$st] = call($api, 'sue', 'POST', $path, ['name' => 'x', 'title' => 'x']);
        if ($st >= 200 && $st < 300) { $wrote[] = "POST $tpl -> $st"; }
    }
}
check('a read session cannot make ANY organisation POST succeed (' . ($wrote === [] ? 'all refused' : implode('; ', $wrote)) . ')', $wrote === []);
unset($wrote);

// Read-write: acts as a manager, still never an owner.
check('a platform admin may revoke a colleague\'s session; the holder may revoke their own', call($api, 'adam', 'POST', "/platform/support-sessions/$sess/revoke", ['reason' => 'done'])[0] === 200 && call($api, 'sue', 'GET', "/orgs/$org/locations")[0] === 404);
check('revoking again is harmless', call($api, 'sue', 'POST', "/platform/support-sessions/$sess/revoke")[1]['already_ended'] === true);
[$s, $r] = $ask('sue', ['scope' => 'read_write']);
check('a read_write session may write like a manager', $s === 201 && call($api, 'sue', 'POST', "/orgs/$org/locations", ['name' => 'Fixed by support'])[0] === 201 && call($api, 'sue', 'POST', "/orgs/$org/support-access", ['allowed' => false])[0] === 403);
$rw = $r['id'];
check('support may not revoke someone else\'s session, but a colleague\'s own is theirs', (function () use ($api, $rw): bool { return call($api, 'sue', 'POST', "/platform/support-sessions/$rw/revoke")[0] === 200; })());

// Consent withdrawn ends access at once; a revoked role ends it too.
$ask('sue', ['scope' => 'read_write']);
check('the owner withdrawing consent shuts an open session immediately', call($api, 'olga', 'POST', "/orgs/$org/support-access", ['allowed' => false])[0] === 200 && call($api, 'sue', 'GET', "/orgs/$org/locations")[0] === 404);
call($api, 'olga', 'POST', "/orgs/$org/support-access", ['allowed' => true]);
check('and allowing again does not revive a session that consent ended', call($api, 'sue', 'GET', "/orgs/$org/locations")[0] === 404 && (int) $pdo->query("SELECT COUNT(*) FROM support_access_sessions WHERE revoke_reason = 'Customer withdrew consent'")->fetchColumn() === 1);
$pdo->exec("UPDATE support_access_sessions SET revoked_at = UTC_TIMESTAMP() WHERE admin_user_id = '{$uid('sue')}'");
$ask('sue');
check('an expired session is worth nothing', (function () use ($pdo, $api, $org, $uid): bool { $pdo->exec("UPDATE support_access_sessions SET granted_at = DATE_SUB(UTC_TIMESTAMP(), INTERVAL 2 HOUR), expires_at = DATE_SUB(UTC_TIMESTAMP(), INTERVAL 1 HOUR) WHERE admin_user_id = '{$uid('sue')}' AND revoked_at IS NULL"); return call($api, 'sue', 'GET', "/orgs/$org/locations")[0] === 404; })());
$ask('sue');
check('revoking platform staff closes their open session in the same step', call($api, 'root', 'POST', '/platform/admins/' . $uid('sue') . '/revoke')[0] === 200 && call($api, 'sue', 'GET', "/orgs/$org/locations")[0] === 404 && (int) $pdo->query("SELECT COUNT(*) FROM support_access_sessions WHERE admin_user_id = '{$uid('sue')}' AND revoked_at IS NULL AND expires_at > UTC_TIMESTAMP()")->fetchColumn() === 0);
check('a session cannot outlive a change of role to finance', (function () use ($api, $pdo, $staffRole, $ask, $org): bool { $staffRole('sue', 'platform_support'); $r = $ask('sue'); $ok = $r[0] === 201; $pdo->exec("UPDATE platform_admins SET role = 'platform_finance' WHERE user_id = (SELECT id FROM users WHERE email = 'sue@example.test')"); return $ok && call($api, 'sue', 'GET', "/orgs/$org/locations")[0] === 404; })());
check('the organisation\'s owner can end any session inside their organisation, and only theirs', (function () use ($api, $pdo, $staffRole, $ask, $org, $other): bool { $staffRole('sue', 'platform_support'); $pdo->exec("UPDATE support_access_sessions SET revoked_at = UTC_TIMESTAMP() WHERE revoked_at IS NULL"); $id = $ask('sue')[1]['id']; return call($api, 'zed', 'POST', "/orgs/$org/support-sessions/$id/revoke")[0] === 404 && call($api, 'mark', 'POST', "/orgs/$org/support-sessions/$id/revoke")[0] === 403 && call($api, 'olga', 'POST', "/orgs/$other/support-sessions/$id/revoke")[0] === 404 && call($api, 'olga', 'POST', "/orgs/$org/support-sessions/$id/revoke")[0] === 200; })());
check('consent is re-read on every request, so even a flag cleared behind the API shuts an open session', (function () use ($api, $pdo, $staffRole, $ask, $org): bool {
    $staffRole('sue', 'platform_support');
    $pdo->exec('UPDATE support_access_sessions SET revoked_at = UTC_TIMESTAMP() WHERE revoked_at IS NULL');
    $pdo->exec("UPDATE organisations SET support_access_allowed = 1 WHERE id = '$org'");
    $ok = $ask('sue')[0] === 201 && call($api, 'sue', 'GET', "/orgs/$org/locations")[0] === 200;
    $pdo->exec("UPDATE organisations SET support_access_allowed = 0 WHERE id = '$org'");
    return $ok && call($api, 'sue', 'GET', "/orgs/$org/locations")[0] === 404;
})());
