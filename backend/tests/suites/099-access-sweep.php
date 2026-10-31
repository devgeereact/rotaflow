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
        if ($orgScoped && isset($res['org']) || ($orgScoped && isset($res['members'])) || ($orgScoped && isset($res['invites'])) || ($orgScoped && isset($res['open_shifts']))) { $bad[] = "$label $method $tpl leaked data"; }
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

// An exported period (S13 follow-up, owner decision 31 Oct 2026): a support session can neither reopen it nor approve it again; a stranger
// and a no-organisation user get 404; nothing about it changes.
$sweepStaff = (string) $pdo->query("SELECT s.id FROM staff_profiles s JOIN users u ON u.id = s.user_id WHERE s.org_id = '$org' AND u.email = 'olga@example.test'")->fetchColumn();
$sweepSheet = Db::uuid();
$pdo->prepare("INSERT INTO timesheets (id, org_id, staff_profile_id, period_start, period_end, total_minutes, status, version) VALUES (?, ?, ?, '2026-10-19', '2026-10-25', 600, 'exported', 1)")->execute([$sweepSheet, $org, $sweepStaff]);
$sheet = static fn (): string => (string) $GLOBALS['pdo']->query("SELECT CONCAT(status, '/', total_minutes, '/', version) FROM timesheets WHERE id = '$sweepSheet'")->fetchColumn();
check('exported: a support session cannot reopen it (403 forbidden) or approve it again (409 already_exported)', call($api, 'sue', 'POST', "/orgs/$org/timesheets/$sweepSheet/reopen", ['reason' => 'The customer asked us to'])[1]['error']['code'] === 'forbidden' && call($api, 'sue', 'POST', "/orgs/$org/timesheets/approve", ['period_start' => '2026-10-19', 'period_end' => '2026-10-25', 'approvals' => [['staff_profile_id' => $sweepStaff, 'total_minutes' => 1]]])[1]['error']['code'] === 'already_exported' && $sheet() === 'exported/600/1');
check('exported: a stranger and a no-organisation user get 404 on its reopen; nobody 401', call($api, 'zed', 'POST', "/orgs/$org/timesheets/$sweepSheet/reopen", ['reason' => 'Let me in please'])[0] === 404 && call($api, 'nobody1', 'POST', "/orgs/$org/timesheets/$sweepSheet/reopen", ['reason' => 'Let me in please'])[0] === 404 && call($api, '', 'POST', "/orgs/$org/timesheets/$sweepSheet/reopen")[0] === 401 && $sheet() === 'exported/600/1');

// The open-shifts list's own eligibility (owner decision, 31 Oct 2026): it is about the caller only. A stranger and a no-organisation user
// were refused above with no `open_shifts`; a live support session (no staff record here) sees the board but no eligibility (null on every
// row), and a member with a staff record sees exactly one person's reasons: their own.
$sweepSite = call($api, 'olga', 'POST', "/orgs/$org/locations", ['name' => 'Sweep House', 'timezone' => 'Europe/London'])[1]['id'];
$sweepDay = gmdate('Y-m-d', time() + 5 * 86400);
$sweepRota = call($api, 'olga', 'POST', "/orgs/$org/rotas", ['name' => 'Sweep week', 'period_start' => $sweepDay, 'period_end' => $sweepDay, 'location_id' => $sweepSite])[1]['rota']['id'];
call($api, 'olga', 'POST', "/orgs/$org/shifts", ['rota_id' => $sweepRota, 'location_id' => $sweepSite, 'staff_profile_id' => null, 'starts_at' => $sweepDay . 'T09:00:00Z', 'ends_at' => $sweepDay . 'T17:00:00Z', 'status' => 'open']);
call($api, 'olga', 'POST', "/orgs/$org/rotas/$sweepRota/publish");
[$s, $res] = call($api, 'sue', 'GET', "/orgs/$org/open-shifts");
check('open shifts: a support session sees the board with no eligibility (null on every row, no reasons about anyone)', $s === 200 && count($res['open_shifts'] ?? []) === 1 && array_map(static fn (array $r): mixed => array_key_exists('my_eligibility', $r) ? $r['my_eligibility'] : 'missing', $res['open_shifts']) === [null], json_encode($res));
[$s, $res] = call($api, 'olga', 'GET', "/orgs/$org/open-shifts");
check('open shifts: the owner with a staff record sees only their own eligibility object', $s === 200 && count($res['open_shifts']) === 1 && array_keys($res['open_shifts'][0]['my_eligibility'] ?? []) === ['eligible', 'reasons'], json_encode($res));
foreach (['zed' => 404, 'nobody1' => 404, '' => 401] as $who => $want) {
    [$s, $res] = call($api, $who, 'GET', "/orgs/$org/open-shifts");
    check("open shifts: " . ($who === '' ? 'nobody' : $who) . " gets $want and no rows", $s === $want && !isset($res['open_shifts']));
}

check('no route in the sweep reached Stripe', $stripeReached === 0, "calls=$stripeReached");
