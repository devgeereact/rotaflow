<?php
declare(strict_types=1);

// Personal settings, finishing setup, and reading the audit trail.
use RotaFlow\Db;

$api = test_api($pdo);
$org = call($api, 'olga', 'POST', '/orgs', ['name' => 'Audit Org'])[1]['org']['id'];
$other = call($api, 'zed', 'POST', '/orgs', ['name' => 'Elsewhere'])[1]['org']['id'];
foreach (['mark' => 'manager', 'sam' => 'staff'] as $name => $role) {
    call($api, $name, 'GET', '/me');
    $pdo->prepare("INSERT INTO memberships (id, org_id, user_id, role, status) SELECT ?, ?, id, ?, 'active' FROM users WHERE email = ?")->execute([Db::uuid(), $org, $role, "$name@example.test"]);
}

// ---- personal settings -------------------------------------------------------------------------------------
[, $r] = call($api, 'sam', 'GET', '/me/settings');
check('settings have defaults before anything is saved', $r['settings'] === ['theme' => 'dark', 'time_format' => '24h', 'week_start' => 'monday', 'digest_frequency' => 'immediate'], json_encode($r));
[$s, $r] = call($api, 'sam', 'POST', '/me/settings', ['theme' => 'light', 'week_start' => 'sunday']);
check('a person saves some of them and the rest keep their defaults', $s === 200 && $r['settings']['theme'] === 'light' && $r['settings']['week_start'] === 'sunday' && $r['settings']['time_format'] === '24h', json_encode($r));
call($api, 'sam', 'POST', '/me/settings', ['time_format' => '12h']);
check('saving again keeps the earlier choices', call($api, 'sam', 'GET', '/me/settings')[1]['settings']['theme'] === 'light');
check('settings belong to the person', call($api, 'mark', 'GET', '/me/settings')[1]['settings']['theme'] === 'dark');
foreach ([['theme' => 'neon'], ['time_format' => '36h'], ['week_start' => 'friday'], ['digest_frequency' => 'hourly'], ['theme' => ['dark']]] as $i => $bad) {
    check("an unknown setting value is 422 ($i)", call($api, 'sam', 'POST', '/me/settings', $bad)[0] === 422);
}
check('settings need a sign-in', call($api, '', 'GET', '/me/settings')[0] === 401);

// ---- onboarding ---------------------------------------------------------------------------------------------
check('a new organisation has not finished setup', $pdo->query("SELECT onboarding_completed_at FROM organisations WHERE id = '$org'")->fetchColumn() === null);
check('a manager cannot finish setup', call($api, 'mark', 'POST', "/orgs/$org/onboarding/complete")[0] === 403);
check('a stranger gets 404', call($api, 'zed', 'POST', "/orgs/$org/onboarding/complete")[0] === 404);
[$s, $r] = call($api, 'olga', 'POST', "/orgs/$org/onboarding/complete");
check('the owner finishes setup', $s === 200 && $r['onboarding_completed_at'] !== null, json_encode($r));
$first = $r['onboarding_completed_at'];
check('finishing again is harmless and keeps the first time', call($api, 'olga', 'POST', "/orgs/$org/onboarding/complete")[1]['onboarding_completed_at'] === $first);

// ---- audit trail -----------------------------------------------------------------------------------------------
call($api, 'olga', 'POST', "/orgs/$org/locations", ['name' => 'Audited Site']);
call($api, 'mark', 'POST', "/orgs/$org/departments", ['name' => 'Audited Dept']);
call($api, 'mark', 'POST', "/orgs/$org/departments", ['name' => 'Second Dept']);
[$s, $r] = call($api, 'olga', 'GET', "/orgs/$org/audit");
check('the owner reads the organisation\'s trail, newest first', $s === 200 && count($r['entries']) >= 4 && $r['entries'][0]['id'] > $r['entries'][1]['id'], json_encode(array_column($r['entries'], 'action')));
check('entries carry action, entity, severity and decoded metadata', isset($r['entries'][0]['action'], $r['entries'][0]['severity']) && !is_string($r['entries'][0]['metadata']));
$actors = array_unique(array_column($r['entries'], 'actor_user_id'));
check('the owner sees what others did', count($actors) >= 2);
[, $m] = call($api, 'mark', 'GET', "/orgs/$org/audit");
$mUser = (string) $pdo->query("SELECT id FROM users WHERE email = 'mark@example.test'")->fetchColumn();
check('a manager sees only their own actions', count($m['entries']) === 2 && array_unique(array_column($m['entries'], 'actor_user_id')) === [$mUser], json_encode($m));
check('staff with no actions see nothing', call($api, 'sam', 'GET', "/orgs/$org/audit")[1]['entries'] === []);
check('a stranger gets 404', call($api, 'zed', 'GET', "/orgs/$org/audit")[0] === 404);
$pdo->prepare("INSERT INTO audit_logs (org_id, actor_user_id, action, entity_type, visibility) VALUES (?, ?, 'platform.secret', 'x', 'platform_only')")->execute([$org, $mUser]);
$all = call($api, 'olga', 'GET', "/orgs/$org/audit?limit=100")[1]['entries'];
check('platform-only entries are never shown to the organisation', !in_array('platform.secret', array_column($all, 'action'), true) && !in_array('platform.secret', array_column(call($api, 'mark', 'GET', "/orgs/$org/audit")[1]['entries'], 'action'), true));
[, $page1] = call($api, 'olga', 'GET', "/orgs/$org/audit?limit=2");
[, $page2] = call($api, 'olga', 'GET', "/orgs/$org/audit?limit=2&before_id=" . $page1['next_before_id']);
check('pagination walks back without repeating', count($page1['entries']) === 2 && $page1['next_before_id'] === $page1['entries'][1]['id'] && $page2['entries'][0]['id'] < $page1['entries'][1]['id']);
check('a limit above 100 is refused', call($api, 'olga', 'GET', "/orgs/$org/audit?limit=500")[0] === 422);
check('another organisation\'s trail is not mixed in', count(array_filter($all, static fn (array $e): bool => $e['entity_id'] === $other)) === 0);
