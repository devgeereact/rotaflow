<?php
declare(strict_types=1);

// The tenancy proof that replaces the pgTAP RLS-invariant tests. It reads the ROUTE TABLE from the modules,
// so a new endpoint is covered the day it is added, with no one remembering to add a test for it.
// Every route is called as: nobody, a stranger (member of a different organisation), a fresh user with no
// organisation, and with random ids. Rules: nothing returns 500; protected routes refuse nobody with 401;
// org-scoped routes answer a stranger and a non-member with 404 and no data; random ids never leak.
use RotaFlow\{Ctx, Modules, RateLimiter};

$api = test_api($pdo);
$ctx = new Ctx($pdo, new RateLimiter($pdo), 'https://rotaflow.example.test', test_private_root());
$routes = [];
foreach (Modules::all($ctx) as $mod) {
    foreach ($mod->routes() as $r) { $routes[] = $r; }
}
check('the sweep found the route table', count($routes) >= 15, 'routes=' . count($routes));

$org = call($api, 'olga', 'POST', '/orgs', ['name' => 'Sweep Org'])[1]['org']['id'];
call($api, 'zed', 'POST', '/orgs', ['name' => 'Stranger Org']);
call($api, 'nobody1', 'GET', '/me'); // a user with no organisation
$u = '11111111-2222-4333-8444-555555555555';
$subst = static fn (string $path, string $o): string => str_replace(['{o}', '{m}', '{i}', '{d}'], [$o, $u, $u, $u], $path);

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
