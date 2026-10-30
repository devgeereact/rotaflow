<?php
declare(strict_types=1);

// People, organisations, tenancy and the audit trail.
use RotaFlow\{Db, HttpError, Users};

$api = test_api($pdo);
$uuid = '11111111-2222-4333-8444-555555555555';

// ---- resolving a person ------------------------------------------------------------------------
[$s, $r] = call($api, 'ann', 'GET', '/me');
check('a first request creates the user and /me works with no organisations', $s === 200 && $r['user']['email'] === 'ann@example.test' && $r['memberships'] === [] && $r['platform_role'] === null, json_encode($r));
$annId = $r['user']['id'];
[, $r] = call($api, 'ann', 'GET', '/me');
check('the same Clerk id is the same user', $r['user']['id'] === $annId && (int) $pdo->query("SELECT COUNT(*) FROM users WHERE email = 'ann@example.test'")->fetchColumn() === 1);

$seedId = Db::uuid();
$pdo->prepare("INSERT INTO users (id, email) VALUES (?, 'seed@example.test')")->execute([$seedId]);
[, $r] = call($api, 'seed', 'GET', '/me');
check('a row created before first sign-in is linked by verified email', $r['user']['id'] === $seedId && $pdo->query("SELECT clerk_user_id FROM users WHERE id = '$seedId'")->fetchColumn() === 'user_seed');

$pdo->prepare("INSERT INTO users (id, clerk_user_id, email) VALUES (?, 'user_original', 'dup@example.test')")->execute([Db::uuid()]);
[$s, $r] = call($api, 'dup', 'GET', '/me');
check('an email held by another Clerk identity is refused, never merged', $s === 409 && $r['error']['code'] === 'email_in_use', json_encode($r));

foreach ([['sub' => 'user_x'], ['sub' => 'user_x', 'email' => 'not-an-email'], ['email' => 'a@example.test'], ['sub' => '', 'email' => 'a@example.test']] as $i => $claims) {
    expectError("claims without a usable sub and email are refused ($i)", fn () => Users::resolve($pdo, $claims), 401);
}
$before = $pdo->query("SELECT last_seen_at FROM users WHERE id = '$annId'")->fetchColumn();
Users::resolve($pdo, ['sub' => 'user_ann', 'email' => 'ann@example.test'], time() + 10);
check('last_seen_at is not rewritten on every request', $pdo->query("SELECT last_seen_at FROM users WHERE id = '$annId'")->fetchColumn() === $before);
Users::resolve($pdo, ['sub' => 'user_ann', 'email' => 'ann@example.test'], time() + 400);
check('last_seen_at moves on after five minutes', $pdo->query("SELECT last_seen_at FROM users WHERE id = '$annId'")->fetchColumn() !== $before);
Users::resolve($pdo, ['sub' => 'user_ann', 'email' => 'Ann@Example.test'], time() + 800);
check('email is stored lower-case', $pdo->query("SELECT email FROM users WHERE id = '$annId'")->fetchColumn() === 'ann@example.test');

// ---- organisations -----------------------------------------------------------------------------
[$s, $r] = call($api, 'ann', 'POST', '/orgs', ['name' => 'Acme Care']);
check('anyone signed in can create an organisation and becomes its owner', $s === 201 && $r['membership']['role'] === 'owner' && $r['org']['slug'] === 'acme-care', json_encode($r));
$acme = $r['org']['id'];
[$s, $r] = call($api, 'bob', 'POST', '/orgs', ['name' => 'Acme Care']);
check('a clashing name gets its own slug', $s === 201 && str_starts_with($r['org']['slug'], 'acme-care-') && $r['org']['slug'] !== 'acme-care', json_encode($r));
$bobs = $r['org']['id'];
foreach (['', 'A', str_repeat('x', 121)] as $bad) {
    check('an organisation name of the wrong length is 422', call($api, 'ann', 'POST', '/orgs', ['name' => $bad])[0] === 422);
}
$trial = $pdo->prepare('SELECT plan, status, support_access_allowed, TIMESTAMPDIFF(DAY, UTC_TIMESTAMP(), trial_ends_at) AS d FROM organisations WHERE id = ?');
$trial->execute([$acme]);
$t = $trial->fetch();
check('a new organisation starts on a thirty-day trial, active, with support access OFF', $t['plan'] === 'professional' && $t['status'] === 'active' && (int) $t['support_access_allowed'] === 0 && in_array((int) $t['d'], [29, 30], true), json_encode($t));
for ($n = 0; $n < 4; $n++) { call($api, 'carl', 'POST', '/orgs', ['name' => "Carl $n"]); }
[$s, $r] = call($api, 'carl', 'POST', '/orgs', ['name' => 'Carl five']);
$sixth = call($api, 'carl', 'POST', '/orgs', ['name' => 'Carl six']);
check('the sixth organisation in an hour is rate limited', $sixth[0] === 429 && $sixth[1]['error']['code'] === 'rate_limited', json_encode($sixth));

[, $r] = call($api, 'ann', 'GET', '/me');
check('/me lists the organisation and the role', count($r['memberships']) === 1 && $r['memberships'][0]['org_id'] === $acme && $r['memberships'][0]['role'] === 'owner');

// ---- tenancy: the guard that replaces RLS ----------------------------------------------------------
[$s, $r] = call($api, 'ann', 'GET', "/orgs/$acme");
check('a member reads their organisation', $s === 200 && $r['org']['name'] === 'Acme Care' && $r['membership']['role'] === 'owner');
check('the guard hands back settings as an object, not a string', is_array($r['org']['settings']) || $r['org']['settings'] instanceof stdClass);
check('another organisation owner gets 404, not 403', call($api, 'bob', 'GET', "/orgs/$acme")[0] === 404);
check('a stranger with no organisations gets 404', call($api, 'dave', 'GET', "/orgs/$acme")[0] === 404);
check('a random UUID is 404', call($api, 'ann', 'GET', "/orgs/$uuid")[0] === 404);
check('a malformed id is 404', call($api, 'ann', 'GET', '/orgs/not-an-id')[0] === 404);
check('anonymous is 401', call($api, '', 'GET', "/orgs/$acme")[0] === 401);

check('the owner renames the organisation', call($api, 'ann', 'POST', "/orgs/$acme", ['name' => 'Acme Care Ltd'])[0] === 200);
check('an invalid rename is 422', call($api, 'ann', 'POST', "/orgs/$acme", ['name' => 'x'])[0] === 422);
check('a non-member cannot rename', call($api, 'bob', 'POST', "/orgs/$acme", ['name' => 'Hijack'])[0] === 404);

// ---- suspended and archived organisations -----------------------------------------------------------
$pdo->prepare("UPDATE organisations SET status = 'suspended' WHERE id = ?")->execute([$acme]);
check('a suspended organisation can still be read by its members', call($api, 'ann', 'GET', "/orgs/$acme")[0] === 200);
[$s, $r] = call($api, 'ann', 'POST', "/orgs/$acme", ['name' => 'Still renaming']);
check('a suspended organisation refuses writes', $s === 403 && $r['error']['code'] === 'org_not_active', json_encode($r));
$pdo->prepare("UPDATE organisations SET status = 'archived' WHERE id = ?")->execute([$acme]);
check('an archived organisation is invisible', call($api, 'ann', 'GET', "/orgs/$acme")[0] === 404);
$pdo->prepare("UPDATE organisations SET status = 'active' WHERE id = ?")->execute([$acme]);

// ---- platform role ----------------------------------------------------------------------------------
$pdo->prepare("INSERT INTO platform_admins (user_id, role) VALUES (?, 'platform_owner')")->execute([$annId]);
check('/me reports a platform role', call($api, 'ann', 'GET', '/me')[1]['platform_role'] === 'platform_owner');
$pdo->prepare('UPDATE platform_admins SET revoked_at = UTC_TIMESTAMP() WHERE user_id = ?')->execute([$annId]);
check('a revoked platform role is gone', call($api, 'ann', 'GET', '/me')[1]['platform_role'] === null);

// ---- audit trail --------------------------------------------------------------------------------------
$n = (int) $pdo->query("SELECT COUNT(*) FROM audit_logs WHERE org_id = '$acme' AND action IN ('org.created','org.renamed')")->fetchColumn();
check('creating and renaming are audited', $n === 2, "n=$n");
$name = $pdo->query("SELECT org_name FROM audit_logs WHERE org_id = '$acme' AND action = 'org.created'")->fetchColumn();
check('the organisation name is copied onto the audit row', $name === 'Acme Care', (string) $name);
foreach (["UPDATE audit_logs SET action = 'x'", 'DELETE FROM audit_logs'] as $sql) {
    try { $pdo->exec($sql); check("audit_logs refuses: $sql", false); } catch (PDOException) { check("audit_logs refuses: $sql", true); }
}
$pdo->prepare('DELETE FROM organisations WHERE id = ?')->execute([$bobs]);
check('deleting an organisation cascades its memberships but keeps its audit trail', (int) $pdo->query("SELECT COUNT(*) FROM memberships WHERE org_id = '$bobs'")->fetchColumn() === 0 && (int) $pdo->query("SELECT COUNT(*) FROM audit_logs WHERE org_id = '$bobs'")->fetchColumn() === 1);
