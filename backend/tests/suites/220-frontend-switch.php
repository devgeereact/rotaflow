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
