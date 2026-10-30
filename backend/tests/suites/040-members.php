<?php
declare(strict_types=1);

// Members, roles, ownership transfer and temporary manager cover.
use RotaFlow\Db;

$api = test_api($pdo);
$uuid = '11111111-2222-4333-8444-555555555555';
$uid = static fn (string $n): string => (string) $pdo->query("SELECT id FROM users WHERE email = '$n@example.test'")->fetchColumn();
$join = static function (string $org, string $name, string $role, string $status = 'active') use ($pdo, $api): string {
    call($api, $name, 'GET', '/me'); // creates the user
    $u = (string) $pdo->query("SELECT id FROM users WHERE email = '$name@example.test'")->fetchColumn();
    $id = Db::uuid();
    $pdo->prepare('INSERT INTO memberships (id, org_id, user_id, role, status) VALUES (?, ?, ?, ?, ?)')->execute([$id, $org, $u, $role, $status]);
    return $id;
};
$org = call($api, 'olga', 'POST', '/orgs', ['name' => 'Team Org'])[1]['org']['id'];
$other = call($api, 'zed', 'POST', '/orgs', ['name' => 'Other Org'])[1]['org']['id'];
$mMark = $join($org, 'mark', 'manager');
$mSam = $join($org, 'sam', 'staff');
$mPat = $join($org, 'pat', 'staff');
$mInv = $join($org, 'ivy', 'staff', 'invited');
$ownerM = (string) $pdo->query("SELECT id FROM memberships WHERE org_id = '$org' AND role = 'owner'")->fetchColumn();
$zedM = (string) $pdo->query("SELECT id FROM memberships WHERE org_id = '$other'")->fetchColumn();

// ---- listing ---------------------------------------------------------------------------------------
[$s, $r] = call($api, 'olga', 'GET', "/orgs/$org/members");
check('the owner sees every member with contact details', $s === 200 && count($r['members']) === 5 && $r['members'][0]['email'] !== null, json_encode($r));
[, $r] = call($api, 'sam', 'GET', "/orgs/$org/members");
check('staff see roles but not other people\'s email or name', count($r['members']) === 5 && array_unique(array_column($r['members'], 'email')) === [null]);
check('a stranger gets 404 listing members', call($api, 'zed', 'GET', "/orgs/$org/members")[0] === 404);
check('an invited (not yet active) person has no access', call($api, 'ivy', 'GET', "/orgs/$org/members")[0] === 404);

// ---- roles ---------------------------------------------------------------------------------------
check('a manager cannot change roles', call($api, 'mark', 'POST', "/orgs/$org/members/$mSam/role", ['role' => 'manager'])[0] === 403);
check('staff cannot change roles', call($api, 'sam', 'POST', "/orgs/$org/members/$mPat/role", ['role' => 'manager'])[0] === 403);
check('the owner promotes staff to manager', call($api, 'olga', 'POST', "/orgs/$org/members/$mPat/role", ['role' => 'manager'])[0] === 200);
check('the promoted person now manages', call($api, 'pat', 'GET', "/orgs/$org/invites")[0] === 200);
check('and can be demoted again', call($api, 'olga', 'POST', "/orgs/$org/members/$mPat/role", ['role' => 'staff'])[0] === 200);
check('owner is not a role you can hand out here', call($api, 'olga', 'POST', "/orgs/$org/members/$mSam/role", ['role' => 'owner'])[0] === 422);
check('an invalid role is 422', call($api, 'olga', 'POST', "/orgs/$org/members/$mSam/role", ['role' => 'admin'])[0] === 422);
check('an owner\'s role cannot be changed this way', call($api, 'olga', 'POST', "/orgs/$org/members/$ownerM/role", ['role' => 'staff'])[0] === 403);
check('a membership of another organisation is 404, even for an owner', call($api, 'olga', 'POST', "/orgs/$org/members/$zedM/role", ['role' => 'staff'])[0] === 404);
check('a random membership id is 404', call($api, 'olga', 'POST', "/orgs/$org/members/$uuid/role", ['role' => 'staff'])[0] === 404);

// ---- suspending ----------------------------------------------------------------------------------
check('a manager cannot suspend', call($api, 'mark', 'POST', "/orgs/$org/members/$mSam/status", ['status' => 'suspended'])[0] === 403);
check('the owner suspends staff', call($api, 'olga', 'POST', "/orgs/$org/members/$mSam/status", ['status' => 'suspended'])[0] === 200);
check('a suspended member loses access at once', call($api, 'sam', 'GET', "/orgs/$org")[0] === 404);
check('the owner reactivates them', call($api, 'olga', 'POST', "/orgs/$org/members/$mSam/status", ['status' => 'active'])[0] === 200 && call($api, 'sam', 'GET', "/orgs/$org")[0] === 200);
check('an owner cannot be suspended', call($api, 'olga', 'POST', "/orgs/$org/members/$ownerM/status", ['status' => 'suspended'])[0] === 403);
check('a person who has not accepted cannot be flipped to active', call($api, 'olga', 'POST', "/orgs/$org/members/$mInv/status", ['status' => 'active'])[0] === 409);
check('an invalid status is 422', call($api, 'olga', 'POST', "/orgs/$org/members/$mSam/status", ['status' => 'banned'])[0] === 422);

// ---- temporary cover ---------------------------------------------------------------------------------
$until = gmdate('Y-m-d\TH:i:s\Z', time() + 86400);
check('before cover, staff cannot use a manager route', call($api, 'sam', 'GET', "/orgs/$org/invites")[0] === 403);
check('a manager cannot lend cover to themselves', call($api, 'mark', 'POST', "/orgs/$org/delegations", ['membership_id' => $mMark, 'ends_at' => $until])[0] === 422);
check('staff cannot lend cover', call($api, 'pat', 'POST', "/orgs/$org/delegations", ['membership_id' => $mSam, 'ends_at' => $until])[0] === 403);
check('cover that ends in the past is refused', call($api, 'mark', 'POST', "/orgs/$org/delegations", ['membership_id' => $mSam, 'ends_at' => gmdate('c', time() - 60)])[0] === 422);
check('open-ended cover is refused (ceiling of 90 days)', call($api, 'mark', 'POST', "/orgs/$org/delegations", ['membership_id' => $mSam, 'ends_at' => gmdate('c', time() + 120 * 86400)])[0] === 422);
check('cover to someone outside the organisation is refused', call($api, 'mark', 'POST', "/orgs/$org/delegations", ['membership_id' => $zedM, 'ends_at' => $until])[0] === 422);
[$s, $r] = call($api, 'mark', 'POST', "/orgs/$org/delegations", ['membership_id' => $mSam, 'ends_at' => $until, 'note' => 'on leave']);
check('a manager lends cover', $s === 201, json_encode($r));
$d1 = $r['id'];
check('the delegate now passes manager checks', call($api, 'sam', 'GET', "/orgs/$org/invites")[0] === 200);
check('but is still not an owner', call($api, 'sam', 'POST', "/orgs/$org/members/$mPat/role", ['role' => 'manager'])[0] === 403);
check('cannot lend cover onwards', call($api, 'sam', 'POST', "/orgs/$org/delegations", ['membership_id' => $mPat, 'ends_at' => $until])[0] === 403);
check('cannot transfer ownership', call($api, 'sam', 'POST', "/orgs/$org/transfer-ownership", ['membership_id' => $mSam])[0] === 403);
check('everyone in the organisation can see live cover', count(call($api, 'pat', 'GET', "/orgs/$org/delegations")[1]['delegations']) === 1);
check('a delegate cannot end cover (only the lender or a real owner or manager can)', call($api, 'sam', 'POST', "/orgs/$org/delegations/$d1/revoke")[0] === 403);
check('a stranger cannot end cover', call($api, 'zed', 'POST', "/orgs/$org/delegations/$d1/revoke")[0] === 404);
[$s, $r] = call($api, 'mark', 'POST', "/orgs/$org/delegations", ['membership_id' => $mSam, 'ends_at' => gmdate('c', time() + 7200)]);
$d2 = $r['id'];
check('lending cover again to the same person replaces the first', $s === 201 && (int) $pdo->query("SELECT COUNT(*) FROM role_delegations WHERE id = '$d1' AND revoked_at IS NOT NULL")->fetchColumn() === 1);
check('the lender ends cover and it stops at once', call($api, 'mark', 'POST', "/orgs/$org/delegations/$d2/revoke")[0] === 200 && call($api, 'sam', 'GET', "/orgs/$org/invites")[0] === 403);
check('ending cover that has already ended is 404', call($api, 'mark', 'POST', "/orgs/$org/delegations/$d2/revoke")[0] === 404);
[, $r] = call($api, 'olga', 'POST', "/orgs/$org/delegations", ['membership_id' => $mSam, 'ends_at' => $until]);
$d3 = $r['id'];
check('a real owner can end anyone\'s cover', call($api, 'olga', 'POST', "/orgs/$org/delegations/$d3/revoke")[0] === 200);
// expiry, and the lender losing their own authority
$pdo->prepare('INSERT INTO role_delegations (id, org_id, from_user_id, to_user_id, starts_at, ends_at) VALUES (?, ?, ?, ?, ?, ?)')
    ->execute([Db::uuid(), $org, $uid('mark'), $uid('sam'), gmdate('Y-m-d H:i:s', time() - 7200), gmdate('Y-m-d H:i:s', time() - 3600)]);
check('expired cover confers nothing', call($api, 'sam', 'GET', "/orgs/$org/invites")[0] === 403);
call($api, 'mark', 'POST', "/orgs/$org/delegations", ['membership_id' => $mSam, 'ends_at' => $until]);
check('cover is live again', call($api, 'sam', 'GET', "/orgs/$org/invites")[0] === 200);
call($api, 'olga', 'POST', "/orgs/$org/members/$mMark/role", ['role' => 'staff']);
check('if the lender stops being a manager, the cover dies with it', call($api, 'sam', 'GET', "/orgs/$org/invites")[0] === 403);
call($api, 'olga', 'POST', "/orgs/$org/members/$mMark/role", ['role' => 'manager']);
check('and returns if they are restored while the window is open', call($api, 'sam', 'GET', "/orgs/$org/invites")[0] === 200);

// ---- ownership transfer -------------------------------------------------------------------------------
check('a manager cannot transfer ownership', call($api, 'mark', 'POST', "/orgs/$org/transfer-ownership", ['membership_id' => $mMark])[0] === 403);
check('you cannot transfer to yourself', call($api, 'olga', 'POST', "/orgs/$org/transfer-ownership", ['membership_id' => $ownerM])[0] === 422);
check('you cannot transfer to someone who has not accepted', call($api, 'olga', 'POST', "/orgs/$org/transfer-ownership", ['membership_id' => $mInv])[0] === 422);
check('you cannot transfer to someone in another organisation', call($api, 'olga', 'POST', "/orgs/$org/transfer-ownership", ['membership_id' => $zedM])[0] === 422);
check('you cannot transfer to a suspended member', (function () use ($api, $org, $mPat) { call($api, 'olga', 'POST', "/orgs/$org/members/$mPat/status", ['status' => 'suspended']); $s = call($api, 'olga', 'POST', "/orgs/$org/transfer-ownership", ['membership_id' => $mPat])[0]; call($api, 'olga', 'POST', "/orgs/$org/members/$mPat/status", ['status' => 'active']); return $s === 422; })());
check('the owner hands the organisation to a manager', call($api, 'olga', 'POST', "/orgs/$org/transfer-ownership", ['membership_id' => $mMark])[0] === 200);
$roles = $pdo->query("SELECT role FROM memberships WHERE id IN ('$ownerM','$mMark') ORDER BY id = '$ownerM' DESC")->fetchAll(PDO::FETCH_COLUMN);
check('the outgoing owner becomes a manager and the new owner owns', $roles === ['manager', 'owner'], json_encode($roles));
check('the organisation always has exactly one owner after a transfer', (int) $pdo->query("SELECT COUNT(*) FROM memberships WHERE org_id = '$org' AND role = 'owner' AND status = 'active'")->fetchColumn() === 1);
check('the old owner can no longer act as owner', call($api, 'olga', 'POST', "/orgs/$org/members/$mSam/role", ['role' => 'manager'])[0] === 403);
check('the new owner can', call($api, 'mark', 'POST', "/orgs/$org/members/$mSam/role", ['role' => 'manager'])[0] === 200);
check('the transfer is audited as critical', (int) $pdo->query("SELECT COUNT(*) FROM audit_logs WHERE org_id = '$org' AND action = 'org.ownership_transferred' AND severity = 'critical'")->fetchColumn() === 1);
check('role, status and cover changes are audited', (int) $pdo->query("SELECT COUNT(*) FROM audit_logs WHERE org_id = '$org' AND action IN ('member.role_changed','member.status_changed','org.role_delegated','org.role_delegation_revoked')")->fetchColumn() >= 8);
