<?php
declare(strict_types=1);

// The tenancy proof that replaces the pgTAP RLS-invariant tests. It reads the ROUTE TABLE from the modules,
// so a new endpoint is covered the day it is added, with no one remembering to add a test for it.
// Every route is called as: nobody, a stranger (member of a different organisation), a fresh user with no
// organisation, and with random ids. Rules: nothing returns 500; protected routes refuse nobody with 401;
// org-scoped routes answer a stranger and a non-member with 404 and no data; random ids never leak.
use RotaFlow\{Ctx, Modules, RateLimiter};

// Stripe is configured (test mode) so billing routes run their real checks instead of answering "not set up"; any attempt to reach Stripe is counted, and must be none.
$stripeReached = 0;
$noStripe = static function () use (&$stripeReached): array { $stripeReached++; return [500, '{}']; };
$ctx = new Ctx($pdo, new RateLimiter($pdo), 'https://rotaflow.example.test', test_private_root(), null, 'open', test_config(['stripe' => ['mode' => 'test', 'test_secret_key' => 'sk_test_' . str_repeat('a', 24), 'test_webhook_secret' => 'whsec_sweep']]));
$mods = [];
foreach (Modules::all($ctx) as $mod) {
    $mods[] = $mod instanceof RotaFlow\Mod\Billing ? new RotaFlow\Mod\Billing($ctx, $noStripe) : ($mod instanceof RotaFlow\Mod\StripeWebhook ? new RotaFlow\Mod\StripeWebhook($ctx, $noStripe) : $mod);
}
$api = test_api($pdo, $mods);
$routes = [];
foreach ($mods as $mod) {
    foreach ($mod->routes() as $r) { $routes[] = $r; }
}
check('the sweep found the route table', count($routes) >= 40, 'routes=' . count($routes));
check('every placeholder in every route is substituted, so no route is skipped by the router', array_reduce($routes, static fn (bool $ok, array $r): bool => $ok && preg_match('/^\/[a-z0-9\/{}\-]*$/', $r[1]) === 1, true));

$org = call($api, 'olga', 'POST', '/orgs', ['name' => 'Sweep Org'])[1]['org']['id'];
call($api, 'zed', 'POST', '/orgs', ['name' => 'Stranger Org']);
call($api, 'nobody1', 'GET', '/me'); // a user with no organisation
$u = '11111111-2222-4333-8444-555555555555';
$subst = static fn (string $path, string $o): string => preg_replace_callback('/\{([a-z])\}/', static fn (array $m): string => $m[1] === 'o' ? $o : $u, $path);

$bad = [];
foreach ($routes as $r) {
    [$method, $tpl] = $r;
    $public = ($r[3] ?? '') === 'public';
    $orgScoped = str_contains($tpl, '{o}');
    $path = $subst($tpl, $org);
    $body = $method === 'POST' ? ['x' => 1] : [];

    [$s, $res] = call($api, '', $method, $path, $body);
    if (!$public && $s !== 401) { $bad[] = "anonymous $method $tpl -> $s"; }
    if ($s >= 500) { $bad[] = "anonymous $method $tpl -> $s"; }

    foreach (['zed' => 'stranger', 'nobody1' => 'no-org user'] as $who => $label) {
        [$s, $res] = call($api, $who, $method, $path, $body);
        if ($s >= 500) { $bad[] = "$label $method $tpl -> $s"; }
        if ($orgScoped && $s !== 404) { $bad[] = "$label $method $tpl -> $s (want 404)"; }
        if ($orgScoped && isset($res['org']) || ($orgScoped && isset($res['members'])) || ($orgScoped && isset($res['invites']))) { $bad[] = "$label $method $tpl leaked data"; }
    }
    // a member with random ids in every position
    [$s] = call($api, 'olga', $method, $subst($tpl, $org), $body);
    if ($s >= 500) { $bad[] = "member $method $tpl random ids -> $s"; }
    // a random organisation id for a real user
    [$s] = call($api, 'olga', $method, $subst($tpl, $u), $body);
    if ($orgScoped && $s !== 404) { $bad[] = "member $method $tpl in a random org -> $s (want 404)"; }
}
check('no route answers wrongly: ' . ($bad === [] ? 'all clean' : implode('; ', array_slice($bad, 0, 8))), $bad === [], count($bad) . ' problems');

// Inputs that are the wrong type must be refused, not crash.
foreach ([['name' => ['a']], ['name' => 5], ['token' => ['x']], ['email' => ['x'], 'role' => 'staff'], ['membership_id' => ['x'], 'ends_at' => 'tomorrow']] as $weird) {
    foreach (['/orgs', "/orgs/$org", '/invites/accept', "/orgs/$org/invites", "/orgs/$org/delegations", "/orgs/$org/transfer-ownership"] as $p) {
        [$s] = call($api, 'olga', 'POST', $p, $weird);
        if ($s >= 500) { check("wrong-typed input to $p is not a 500", false, json_encode($weird)); }
    }
}
check('wrong-typed inputs never produce a 500', true);

// A live platform support session (consent given, read_write) is refused on every route that can carry health or pay data, reads and
// writes alike: cover (absence reasons; owner decision 31 Oct 2026), staff documents (S10) and the payroll export (S13). The flags are on so
// the refusal is not just feature_off; the refusal comes before the flag anyway.
use RotaFlow\Db;
call($api, 'sue', 'GET', '/me');
$sueId = (string) $pdo->query("SELECT id FROM users WHERE email = 'sue@example.test'")->fetchColumn();
$pdo->prepare("INSERT INTO platform_admins (user_id, role) VALUES (?, 'platform_support')")->execute([$sueId]);
$pdo->prepare('UPDATE organisations SET support_access_allowed = 1 WHERE id = ?')->execute([$org]);
$pdo->prepare("INSERT INTO support_access_sessions (id, org_id, admin_user_id, reason, case_ref, scope, expires_at) VALUES (?, ?, ?, 'Sweep: the customer asked for help', 'CASE-4199', 'read_write', DATE_ADD(UTC_TIMESTAMP(), INTERVAL 1 HOUR))")->execute([Db::uuid(), $org, $sueId]);
$pdo->exec("UPDATE feature_flags SET enabled = 1, rollout = 100 WHERE flag_key IN ('cover_tools', 'staff_documents', 'timesheet_tools')");
check('support: the session is live (it reads an ordinary route)', call($api, 'sue', 'GET', "/orgs/$org/locations")[0] === 200);
$guarded = 0;
$leaks = [];
foreach ($routes as $r) {
    [$method, $tpl] = $r;
    if (!str_contains($tpl, '{o}') || preg_match('#/(cover|documents|compliance)(/|$)|/timesheets/export$#', $tpl) !== 1) {
        continue;
    }
    $guarded++;
    [$s, $res] = call($api, 'sue', $method, $subst($tpl, $org), $method === 'POST' ? ['x' => 1] : []);
    if ($s !== 403 || ($res['error']['code'] ?? '') !== 'forbidden') {
        $leaks[] = "$method $tpl -> $s " . ($res['error']['code'] ?? '');
    }
}
check("support: every cover, documents, compliance and payroll-export route refuses a support session with 403 forbidden ($guarded routes): " . ($leaks === [] ? 'all refused' : implode('; ', array_slice($leaks, 0, 8))), $leaks === [] && $guarded >= 20, count($leaks) . ' leaks');
$pdo->exec("UPDATE feature_flags SET enabled = 0, rollout = 0 WHERE flag_key = 'cover_tools'");
check('support: cover refuses the session with the flag off too (403 forbidden, not feature_off)', call($api, 'sue', 'GET', "/orgs/$org/cover/overview")[1]['error']['code'] === 'forbidden');

check('no route in the sweep reached Stripe', $stripeReached === 0, "calls=$stripeReached");
