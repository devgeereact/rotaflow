<?php
declare(strict_types=1);

// Organisations are by invitation: the production default. A platform administrator creates the organisation and invites its
// first owner. Also covers the CLI that creates the first administrator, since nothing else can.
$api = test_api($pdo, null, 'invite_only');
$root = test_private_root();
file_put_contents($root . '/config/config.php', "<?php return ['dsn'=>'mysql:host=$host;port=$port;dbname=$name;charset=utf8mb4','user'=>'$user','password'=>'$pass'];");
$cli = static function (string ...$args) use ($root): array {
    exec('ROTAFLOW_PRIVATE_ROOT=' . escapeshellarg($root) . ' php ' . escapeshellarg(__DIR__ . '/../../bin/grant-platform-owner.php') . ' ' . implode(' ', array_map('escapeshellarg', $args)) . ' 2>&1', $out, $rc);
    return [$rc, implode("\n", $out)];
};

// ---- closed to everyone else ---------------------------------------------------------------------------
[$s, $r] = call($api, 'ann', 'POST', '/orgs', ['name' => 'Self Serve Ltd']);
check('an ordinary signed-in person cannot create an organisation', $s === 403 && $r['error']['code'] === 'org_creation_closed', json_encode($r));
check('and nothing was created', (int) $pdo->query('SELECT COUNT(*) FROM organisations')->fetchColumn() === 0);
check('the platform routes do not exist for them (404)', call($api, 'ann', 'POST', '/platform/orgs', ['name' => 'X Ltd', 'owner_email' => 'x@example.test'])[0] === 404);
check('and answer 401 when anonymous', call($api, '', 'POST', '/platform/orgs', [])[0] === 401);

// ---- the first administrator exists only through the CLI -------------------------------------------------
[$rc, $out] = $cli('not-an-email');
check('the CLI refuses a bad address', $rc === 1);
[$rc, $out] = $cli('Root@Example.test');
check('the CLI creates a person who has never signed in, as platform owner', $rc === 0 && $pdo->query("SELECT COUNT(*) FROM users u JOIN platform_admins p ON p.user_id = u.id WHERE u.email = 'root@example.test' AND u.clerk_user_id IS NULL AND p.role = 'platform_owner'")->fetchColumn() == 1, $out);
[$rc] = $cli('root@example.test');
check('running it again changes nothing', $rc === 0 && (int) $pdo->query('SELECT COUNT(*) FROM platform_admins')->fetchColumn() === 1);
check('granting the role is audited as critical and platform-only', (int) $pdo->query("SELECT COUNT(*) FROM audit_logs WHERE action = 'platform.owner_granted' AND severity = 'critical' AND visibility = 'platform_only'")->fetchColumn() >= 1);
[, $r] = call($api, 'root', 'GET', '/me');
check('their first sign-in links the row and they are a platform owner', $r['platform_role'] === 'platform_owner' && $pdo->query("SELECT clerk_user_id FROM users WHERE email = 'root@example.test'")->fetchColumn() === 'user_root');

// a lesser platform role cannot create organisations
$pdo->prepare("INSERT INTO platform_admins (user_id, role) SELECT id, 'platform_support' FROM users WHERE email = 'ann@example.test'")->execute();
check('platform support cannot create organisations', call($api, 'ann', 'POST', '/platform/orgs', ['name' => 'Nope Ltd', 'owner_email' => 'o@example.test'])[0] === 404);

// ---- an administrator creates an organisation and invites its first owner ---------------------------------
check('a bad name or owner email is 422', call($api, 'root', 'POST', '/platform/orgs', ['name' => 'x', 'owner_email' => 'o@example.test'])[0] === 422 && call($api, 'root', 'POST', '/platform/orgs', ['name' => 'Fine Ltd', 'owner_email' => 'nope'])[0] === 422);
[$s, $r] = call($api, 'root', 'POST', '/platform/orgs', ['name' => 'Northwind Care', 'owner_email' => 'Owner@Example.test']);
check('the administrator creates an organisation and gets a one-time owner token', $s === 201 && $r['owner_email'] === 'owner@example.test' && strlen($r['token']) >= 40, json_encode($r));
$org = $r['org']['id']; $tok = $r['token'];
check('the new organisation has no members until the owner accepts', (int) $pdo->query("SELECT COUNT(*) FROM memberships WHERE org_id = '$org'")->fetchColumn() === 0);
check('the administrator is not made a member of it', call($api, 'root', 'GET', "/orgs/$org")[0] === 404);
[$s, $r] = call($api, '', 'POST', '/invites/preview', ['token' => $tok]);
check('the owner sees what they were invited to before signing in', $s === 200 && $r['org_name'] === 'Northwind Care' && $r['role'] === 'owner', json_encode($r));
[$s, $r] = call($api, 'mallory', 'POST', '/invites/accept', ['token' => $tok]);
check('a different email cannot take ownership', $s === 403 && $r['error']['code'] === 'invite_email_mismatch');
[$s, $r] = call($api, 'owner', 'POST', '/invites/accept', ['token' => $tok]);
check('the invited person becomes the owner', $s === 200 && $r['role'] === 'owner', json_encode($r));
check('and can run the organisation', call($api, 'owner', 'GET', "/orgs/$org")[1]['membership']['role'] === 'owner');
check('the token is single use', call($api, 'owner', 'POST', '/invites/accept', ['token' => $tok])[0] === 404);
check('the owner can then invite their own staff through the normal route', call($api, 'owner', 'POST', "/orgs/$org/invites", ['email' => 'staffer@example.test', 'role' => 'staff'])[0] === 201);
check('the creation is audited for the platform only', (int) $pdo->query("SELECT COUNT(*) FROM audit_logs WHERE org_id = '$org' AND action = 'platform.org_created' AND visibility = 'platform_only'")->fetchColumn() === 1);

// ---- re-issuing an owner invitation ------------------------------------------------------------------------
[, $r] = call($api, 'root', 'POST', '/platform/orgs', ['name' => 'Fresh Ltd', 'owner_email' => 'first@example.test']);
$org2 = $r['org']['id']; $first = $r['token'];
[$s, $r] = call($api, 'root', 'POST', "/platform/orgs/$org2/owner-invites", ['owner_email' => 'second@example.test']);
check('an administrator can re-invite an owner for an organisation with no members', $s === 201, json_encode($r));
check('the earlier owner token stops working', call($api, '', 'POST', '/invites/preview', ['token' => $first])[0] === 404);
check('the new one works', call($api, '', 'POST', '/invites/preview', ['token' => $r['token']])[0] === 200);
check('re-inviting an organisation that already has members is 409', call($api, 'root', 'POST', "/platform/orgs/$org/owner-invites", ['owner_email' => 'sneaky@example.test'])[0] === 409);
check('an unknown organisation is 404', call($api, 'root', 'POST', '/platform/orgs/11111111-2222-4333-8444-555555555555/owner-invites', ['owner_email' => 'a@example.test'])[0] === 404);
check('a non-administrator gets 404, even for a real organisation', call($api, 'owner', 'POST', "/platform/orgs/$org2/owner-invites", ['owner_email' => 'a@example.test'])[0] === 404);

// an owner invitation cannot be redeemed into an organisation that gained an owner meanwhile
[, $r] = call($api, 'root', 'POST', '/platform/orgs', ['name' => 'Race Ltd', 'owner_email' => 'late@example.test']);
$org3 = $r['org']['id']; $lateTok = $r['token'];
call($api, 'rival', 'GET', '/me');
$pdo->prepare("INSERT INTO memberships (id, org_id, user_id, role, status) SELECT UUID(), ?, id, 'owner', 'active' FROM users WHERE email = 'rival@example.test'")->execute([$org3]);
[$s, $r] = call($api, 'late', 'POST', '/invites/accept', ['token' => $lateTok]);
check('an owner invitation is refused when the organisation already has an owner', $s === 409 && $r['error']['code'] === 'owner_exists', json_encode($r));
