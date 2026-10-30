<?php
declare(strict_types=1);

// Invitations: creation, preview, acceptance and every way they can be refused.
use RotaFlow\Db;

$api = test_api($pdo);
$org = call($api, 'olga', 'POST', '/orgs', ['name' => 'Invite Org'])[1]['org']['id'];
$other = call($api, 'zed', 'POST', '/orgs', ['name' => 'Elsewhere'])[1]['org']['id'];
$join = static function (string $name, string $role) use ($pdo, $api, $org): void {
    call($api, $name, 'GET', '/me');
    $u = (string) $pdo->query("SELECT id FROM users WHERE email = '$name@example.test'")->fetchColumn();
    $pdo->prepare("INSERT INTO memberships (id, org_id, user_id, role, status) VALUES (?, ?, ?, ?, 'active')")->execute([Db::uuid(), $org, $u, $role]);
};
$join('mark', 'manager');
$join('sam', 'staff');

[$s, $r] = call($api, 'olga', 'POST', "/orgs/$org/invites", ['email' => 'NewPerson@Example.test', 'role' => 'staff']);
check('the owner invites by email and gets a one-time token', $s === 201 && strlen($r['token']) >= 40 && $r['invite']['email'] === 'newperson@example.test', json_encode($r));
$tok = $r['token'];
$inviteId = $r['invite']['id'];
$stored = $pdo->query("SELECT token_hash FROM invites WHERE id = '$inviteId'")->fetchColumn();
check('only the SHA-256 of the token is stored', $stored === hash('sha256', $tok) && !str_contains((string) $stored, $tok));
check('a manager can invite', call($api, 'mark', 'POST', "/orgs/$org/invites", ['email' => 'm2@example.test', 'role' => 'manager'])[0] === 201);
check('staff cannot invite', call($api, 'sam', 'POST', "/orgs/$org/invites", ['email' => 'x@example.test', 'role' => 'staff'])[0] === 403);
check('a stranger gets 404', call($api, 'zed', 'POST', "/orgs/$org/invites", ['email' => 'x@example.test', 'role' => 'staff'])[0] === 404);
check('an invalid email is 422', call($api, 'olga', 'POST', "/orgs/$org/invites", ['email' => 'nope', 'role' => 'staff'])[0] === 422);
check('owner cannot be invited through the API', call($api, 'olga', 'POST', "/orgs/$org/invites", ['email' => 'o@example.test', 'role' => 'owner'])[0] === 422);
[$s, $r] = call($api, 'olga', 'POST', "/orgs/$org/invites", ['email' => 'newperson@example.test', 'role' => 'staff']);
check('a second pending invitation to the same address is refused', $s === 409 && $r['error']['code'] === 'invite_pending', json_encode($r));
[$s, $r] = call($api, 'olga', 'POST', "/orgs/$org/invites", ['email' => 'sam@example.test', 'role' => 'staff']);
check('inviting an existing member is refused', $s === 409 && $r['error']['code'] === 'already_member', json_encode($r));
foreach (range(1, 3) as $n) { call($api, 'zed', 'POST', "/orgs/$other/invites", ['email' => 'bombed@example.test', 'role' => 'staff']); call($api, 'zed', 'POST', "/orgs/$other/invites/" . $pdo->query("SELECT id FROM invites WHERE email = 'bombed@example.test' AND revoked_at IS NULL")->fetchColumn() . '/revoke'); }
check('one address cannot be sent more than three invitations a day', call($api, 'olga', 'POST', "/orgs/$org/invites", ['email' => 'bombed@example.test', 'role' => 'staff'])[0] === 429);

[, $r] = call($api, 'olga', 'GET', "/orgs/$org/invites");
check('the list shows state and never a token or hash', count($r['invites']) === 2 && in_array('pending', array_column($r['invites'], 'state'), true) && !str_contains(json_encode($r), 'token'), json_encode($r));
check('staff cannot list invitations', call($api, 'sam', 'GET', "/orgs/$org/invites")[0] === 403);

// ---- preview (public) -----------------------------------------------------------------------------------
[$s, $r] = call($api, '', 'POST', '/invites/preview', ['token' => $tok]);
check('anyone holding the token can preview it without signing in', $s === 200 && $r['org_name'] === 'Invite Org' && $r['role'] === 'staff' && $r['email'] === 'newperson@example.test', json_encode($r));
foreach (['', 'garbage', str_repeat('a', 200), 'has spaces here', $tok . 'x'] as $bad) {
    [$s, $r] = call($api, '', 'POST', '/invites/preview', ['token' => $bad]);
    check('a bad token gets the one uniform 404', $s === 404 && $r['error']['code'] === 'invite_invalid');
}

// ---- accepting -------------------------------------------------------------------------------------------
check('accepting needs a sign-in', call($api, '', 'POST', '/invites/accept', ['token' => $tok])[0] === 401);
[$s, $r] = call($api, 'mallory', 'POST', '/invites/accept', ['token' => $tok]);
check('someone with a different verified email cannot use the token', $s === 403 && $r['error']['code'] === 'invite_email_mismatch', json_encode($r));
check('the failed attempt did not consume the invitation', call($api, '', 'POST', '/invites/preview', ['token' => $tok])[0] === 200);
[$s, $r] = call($api, 'newperson', 'POST', '/invites/accept', ['token' => $tok]);
check('the invited person joins with the invited role', $s === 200 && $r['role'] === 'staff' && $r['org_id'] === $org, json_encode($r));
check('they can now read the organisation', call($api, 'newperson', 'GET', "/orgs/$org")[0] === 200);
[$s, $r] = call($api, 'newperson', 'POST', '/invites/accept', ['token' => $tok]);
check('a used token is the same uniform 404', $s === 404 && $r['error']['code'] === 'invite_invalid');
check('a used token cannot be previewed either', call($api, '', 'POST', '/invites/preview', ['token' => $tok])[0] === 404);

// revoked, expired, suspended, archived
[$s, $r] = call($api, 'olga', 'POST', "/orgs/$org/invites", ['email' => 'rev@example.test', 'role' => 'staff']);
$revTok = $r['token']; $revId = $r['invite']['id'];
check('an invitation can be revoked', call($api, 'olga', 'POST', "/orgs/$org/invites/$revId/revoke")[0] === 200);
check('revoking twice is 404', call($api, 'olga', 'POST', "/orgs/$org/invites/$revId/revoke")[0] === 404);
check('a revoked token cannot be accepted', call($api, 'rev', 'POST', '/invites/accept', ['token' => $revTok])[0] === 404);
check('revoking frees the address for a fresh invitation', call($api, 'olga', 'POST', "/orgs/$org/invites", ['email' => 'rev@example.test', 'role' => 'staff'])[0] === 201);
check('another organisation\'s owner cannot revoke it', call($api, 'zed', 'POST', "/orgs/$org/invites/$revId/revoke")[0] === 404);

[, $r] = call($api, 'olga', 'POST', "/orgs/$org/invites", ['email' => 'late@example.test', 'role' => 'staff']);
$pdo->prepare('UPDATE invites SET expires_at = DATE_SUB(UTC_TIMESTAMP(), INTERVAL 1 MINUTE) WHERE id = ?')->execute([$r['invite']['id']]);
check('an expired token is refused', call($api, 'late', 'POST', '/invites/accept', ['token' => $r['token']])[0] === 404);
check('and the list says expired', in_array('expired', array_column(call($api, 'olga', 'GET', "/orgs/$org/invites")[1]['invites'], 'state'), true));

[, $r] = call($api, 'olga', 'POST', "/orgs/$org/invites", ['email' => 'banned@example.test', 'role' => 'manager']);
call($api, 'banned', 'GET', '/me');
$bu = (string) $pdo->query("SELECT id FROM users WHERE email = 'banned@example.test'")->fetchColumn();
$pdo->prepare("INSERT INTO memberships (id, org_id, user_id, role, status) VALUES (?, ?, ?, 'staff', 'suspended')")->execute([Db::uuid(), $org, $bu]);
check('a suspended member cannot rejoin by invitation', call($api, 'banned', 'POST', '/invites/accept', ['token' => $r['token']])[0] === 403);

[, $r] = call($api, 'olga', 'POST', "/orgs/$org/invites", ['email' => 'sam@example.test', 'role' => 'manager']) + [1 => []];
$pdo->prepare('DELETE FROM invites WHERE email = ?')->execute(['sam@example.test']);
$tokenForMember = rtrim(strtr(base64_encode(random_bytes(32)), '+/', '-_'), '=');
$pdo->prepare('INSERT INTO invites (id, org_id, email, role, token_hash, expires_at) VALUES (?, ?, ?, ?, ?, DATE_ADD(UTC_TIMESTAMP(), INTERVAL 1 DAY))')->execute([Db::uuid(), $org, 'sam@example.test', 'manager', hash('sha256', $tokenForMember)]);
[$s, $r] = call($api, 'sam', 'POST', '/invites/accept', ['token' => $tokenForMember]);
check('an existing member cannot accept an invitation into a role they might not hold', $s === 409 && $r['error']['code'] === 'already_member');

[, $r] = call($api, 'olga', 'POST', "/orgs/$org/invites", ['email' => 'arch@example.test', 'role' => 'staff']);
$pdo->prepare("UPDATE organisations SET status = 'archived' WHERE id = ?")->execute([$org]);
check('an invitation into an archived organisation is invalid', call($api, 'arch', 'POST', '/invites/accept', ['token' => $r['token']])[0] === 404);
$pdo->prepare("UPDATE organisations SET status = 'active' WHERE id = ?")->execute([$org]);
check('acceptance is audited', (int) $pdo->query("SELECT COUNT(*) FROM audit_logs WHERE org_id = '$org' AND action = 'invite.accepted'")->fetchColumn() === 1);
