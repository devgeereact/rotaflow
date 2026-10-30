<?php
declare(strict_types=1);

// Routes and fields added when the React app moved off Supabase (S9): the organisation profile, slug checks and
// the organisation preferences the settings pages keep in `settings`.
use RotaFlow\Db;

$api = test_api($pdo);
$org = call($api, 'olga', 'POST', '/orgs', ['name' => 'Switch Org'])[1]['org']['id'];
$other = call($api, 'zed', 'POST', '/orgs', ['name' => 'Elsewhere Org'])[1]['org']['id'];
call($api, 'mark', 'GET', '/me');
$pdo->prepare("INSERT INTO memberships (id, org_id, user_id, role, status) SELECT ?, ?, id, 'manager', 'active' FROM users WHERE email = 'mark@example.test'")->execute([Db::uuid(), $org]);

// ---- organisation profile ---------------------------------------------------------------------------------------
$profile = ['name' => 'Switch Care', 'industry' => 'Care', 'country' => 'United Kingdom', 'timezone' => 'Europe/London', 'contact_email' => 'office@switch.example.test', 'contact_phone' => '01632 960000'];
[$s] = call($api, 'olga', 'POST', "/orgs/$org", $profile);
[, $r] = call($api, 'olga', 'GET', "/orgs/$org");
check('the owner saves the profile columns and reads them back', $s === 200 && $r['org']['name'] === 'Switch Care' && $r['org']['industry'] === 'Care' && $r['org']['contact_email'] === 'office@switch.example.test' && $r['org']['timezone'] === 'Europe/London' && array_key_exists('onboarding_completed_at', $r['org']), json_encode($r));
call($api, 'olga', 'POST', "/orgs/$org", ['industry' => null]);
check('only the fields sent change, and a field can be cleared', call($api, 'olga', 'GET', "/orgs/$org")[1]['org']['name'] === 'Switch Care' && call($api, 'olga', 'GET', "/orgs/$org")[1]['org']['industry'] === null);
check('a manager cannot edit the profile', call($api, 'mark', 'POST', "/orgs/$org", ['industry' => 'X'])[0] === 403);
check('a stranger gets 404', call($api, 'zed', 'POST', "/orgs/$org", ['industry' => 'X'])[0] === 404);
foreach ([['timezone' => 'Mars/Base'], ['contact_email' => 'not-an-email'], ['name' => 'x'], ['slug' => 'Bad Slug!'], ['country' => ''], []] as $i => $bad) {
    check("a bad profile field is 422 ($i)", call($api, 'olga', 'POST', "/orgs/$org", $bad)[0] === 422);
}
$otherSlug = (string) $pdo->query("SELECT slug FROM organisations WHERE id = '$other'")->fetchColumn();
check('a slug another organisation holds is 409 slug_taken', call($api, 'olga', 'POST', "/orgs/$org", ['slug' => $otherSlug])[0] === 409);
check('a free slug is saved', call($api, 'olga', 'POST', "/orgs/$org", ['slug' => 'switch-care'])[0] === 200 && $pdo->query("SELECT slug FROM organisations WHERE id = '$org'")->fetchColumn() === 'switch-care');

// ---- slug availability ---------------------------------------------------------------------------------------------
check('a taken slug reads as unavailable', call($api, 'mark', 'GET', '/slug-available?slug=switch-care')[1]['available'] === false);
check('an unused slug reads as available', call($api, 'mark', 'GET', '/slug-available?slug=nobody-has-this')[1]['available'] === true);
check('the organisation being edited may keep its own slug', call($api, 'olga', 'GET', "/slug-available?slug=switch-care&exclude=$org")[1]['available'] === true);
check('excluding an organisation you do not belong to is 404, so it cannot probe', call($api, 'zed', 'GET', "/slug-available?slug=switch-care&exclude=$org")[0] === 404);
check('a malformed slug is simply unavailable', call($api, 'olga', 'GET', '/slug-available?slug=' . rawurlencode('NO WAY'))[1]['available'] === false);
check('the check needs a sign-in', call($api, '', 'GET', '/slug-available?slug=x')[0] === 401);

// ---- organisation preferences ------------------------------------------------------------------------------------------
$prefs = ['size' => '11-50', 'org_type' => 'Care home', 'role_labels' => ['owner' => 'Director', 'manager' => 'Team lead', 'staff' => 'Carer'], 'min_rest_hours' => 11, 'breaks_are_paid' => false, 'leave_year_start_month' => 4, 'intended_plan' => 'professional', 'billing_period' => 'annual'];
[$s, $r] = call($api, 'olga', 'POST', "/orgs/$org/settings", $prefs);
check('the owner saves the preferences the settings pages keep', $s === 200 && $r['settings']['role_labels']['manager'] === 'Team lead' && $r['settings']['min_rest_hours'] === 11 && $r['settings']['breaks_are_paid'] === false, json_encode($r));
call($api, 'olga', 'POST', "/orgs/$org/settings", ['website' => 'https://switch.example.test']);
check('a later save keeps the earlier keys', call($api, 'olga', 'GET', "/orgs/$org")[1]['org']['settings']['org_type'] === 'Care home');
check('a manager cannot change them', call($api, 'mark', 'POST', "/orgs/$org/settings", ['size' => '1-10'])[0] === 403);
foreach ([['anything_else' => 1], ['min_rest_hours' => 99], ['breaks_are_paid' => 'yes'], ['intended_plan' => 'free'], ['role_labels' => ['owner' => 'A']], ['size' => str_repeat('x', 41)]] as $i => $bad) {
    check("a bad or unknown preference is 422 ($i)", call($api, 'olga', 'POST', "/orgs/$org/settings", $bad)[0] === 422);
}

// ---- labour cost and current pay rates (the Postgres labour_cost / current_pay_rates) -------------------------------
$site = call($api, 'olga', 'POST', "/orgs/$org/locations", ['name' => 'Ward A'])[1]['id'];
$ann = call($api, 'olga', 'POST', "/orgs/$org/staff", ['first_name' => 'Ann'])[1]['id'];
$bob = call($api, 'olga', 'POST', "/orgs/$org/staff", ['first_name' => 'Bob'])[1]['id'];
call($api, 'olga', 'POST', "/orgs/$org/staff/$ann/pay-rates", ['hourly_rate_pence' => 1200, 'effective_from' => '2029-01-01']);
call($api, 'olga', 'POST', "/orgs/$org/staff/$ann/pay-rates", ['hourly_rate_pence' => 1500, 'effective_from' => '2029-06-06']);
$rota = call($api, 'olga', 'POST', "/orgs/$org/rotas", ['name' => 'W', 'period_start' => '2029-06-04', 'period_end' => '2029-06-10', 'location_id' => $site])[1]['rota']['id'];
$shift = static fn (string $who, string $day, int $break = 30): array => call($api, 'olga', 'POST', "/orgs/$org/shifts", ['rota_id' => $rota, 'location_id' => $site, 'staff_profile_id' => $who, 'starts_at' => "{$day}T09:00:00Z", 'ends_at' => "{$day}T17:00:00Z", 'break_minutes' => $break]);
$shift($ann, '2029-06-05');
$shift($ann, '2029-06-06');
$shift($bob, '2029-06-07');
check('a draft rota costs nothing yet', call($api, 'olga', 'GET', "/orgs/$org/labour-cost?from=2029-06-01&to=2029-06-30")[1]['rows'] === []);
call($api, 'olga', 'POST', "/orgs/$org/rotas/$rota/publish");
[$s, $r] = call($api, 'mark', 'GET', "/orgs/$org/labour-cost?from=2029-06-01&to=2029-06-30");
// Ann: 450 min at 1200 (6th not yet) = 9000, 450 min at 1500 = 11250; Bob has no rate.
check('cost uses the rate in force on the day of each shift and names the unrated', $s === 200 && count($r['rows']) === 1 && $r['rows'][0]['cost_pence'] === 20250 && $r['rows'][0]['scheduled_minutes'] === 1350 && $r['rows'][0]['unrated_staff'] === 1 && $r['rows'][0]['location_name'] === 'Ward A', json_encode($r));
check('paid breaks count the break minutes', call($api, 'olga', 'GET', "/orgs/$org/labour-cost?from=2029-06-01&to=2029-06-30&paid_breaks=1")[1]['rows'][0]['scheduled_minutes'] === 1440);
call($api, 'sam', 'GET', '/me');
$pdo->prepare("INSERT INTO memberships (id, org_id, user_id, role, status) SELECT ?, ?, id, 'staff', 'active' FROM users WHERE email = 'sam@example.test'")->execute([Db::uuid(), $org]);
check('staff cannot see labour cost or rates', call($api, 'sam', 'GET', "/orgs/$org/labour-cost?from=2029-06-01&to=2029-06-30")[0] === 403 && call($api, 'sam', 'GET', "/orgs/$org/pay-rates/current")[0] === 403);
check('a stranger gets 404', call($api, 'zed', 'GET', "/orgs/$org/labour-cost?from=2029-06-01&to=2029-06-30")[0] === 404 && call($api, 'zed', 'GET', "/orgs/$org/pay-rates/current")[0] === 404);
foreach (['?from=2029-06-30&to=2029-06-01', '?from=2029-01-01&to=2031-01-01', '?from=bad&to=2029-06-01', ''] as $i => $qs) {
    check("a bad period is 422 ($i)", call($api, 'olga', 'GET', "/orgs/$org/labour-cost$qs")[0] === 422);
}
call($api, 'olga', 'POST', "/orgs/$org/staff/$bob/pay-rates", ['hourly_rate_pence' => 1000, 'effective_from' => '2020-01-01']);
call($api, 'olga', 'POST', "/orgs/$org/staff/$bob/pay-rates", ['hourly_rate_pence' => 1100, 'effective_from' => '2021-01-01']);
[, $r] = call($api, 'mark', 'GET', "/orgs/$org/pay-rates/current");
check('current rates list the latest rate in force today, and none from the future', count($r['rates']) === 1 && $r['rates'][0]['staff_profile_id'] === $bob && $r['rates'][0]['hourly_rate_pence'] === 1100, json_encode($r));

// ---- actions the app records about itself (the Postgres log_audit_event) ---------------------------------------------
[$s] = call($api, 'sam', 'POST', "/orgs/$org/audit", ['action' => 'report.exported', 'metadata' => ['report' => 'hours']]);
$row = $pdo->query("SELECT actor_user_id, action, visibility FROM audit_logs WHERE action = 'report.exported'")->fetch();
check('a member records an export they made, attributed to them', $s === 201 && $row !== false && $row['visibility'] === 'org' && $row['actor_user_id'] === $pdo->query("SELECT id FROM users WHERE email = 'sam@example.test'")->fetchColumn());
check('an action outside the list is refused', call($api, 'sam', 'POST', "/orgs/$org/audit", ['action' => 'org.deleted'])[0] === 422);
check('oversized metadata is refused', call($api, 'sam', 'POST', "/orgs/$org/audit", ['action' => 'report.exported', 'metadata' => ['x' => str_repeat('a', 2100)]])[0] === 422);
check('a stranger cannot write to another organisation\'s trail', call($api, 'zed', 'POST', "/orgs/$org/audit", ['action' => 'report.exported'])[0] === 404);
