<?php
declare(strict_types=1);

// Platform operations: incidents, feature flags and website enquiries.
use RotaFlow\{Ctx, Db, Flags, Modules, RateLimiter};
use RotaFlow\Mod\Enquiries;

// ---- the flag decision ------------------------------------------------------------------------------------------------
check('a disabled flag is off for everyone, whatever else is true', Flags::decide(false, 100, true, true, 'k', 'o') === false);
check('a full rollout is on, before targets or plans are asked', Flags::decide(true, 100, false, false, 'k', 'o') === true);
check('a pilot organisation is on at 0%', Flags::decide(true, 0, true, false, 'k', 'o') === true);
check('a targeted plan is on at 0%', Flags::decide(true, 0, false, true, 'k', 'o') === true);
check('0% with no pilot and no plan is off', Flags::decide(true, 0, false, false, 'k', 'o') === false);
$in35 = 0;
for ($i = 0; $i < 2000; $i++) { $in35 += Flags::decide(true, 35, false, false, 'ai', "org-$i") ? 1 : 0; }
check('a 35% rollout picks roughly 35% of organisations', $in35 > 600 && $in35 < 800, (string) $in35);
check('the bucket is stable, and raising the percentage only adds organisations', (function (): bool { for ($i = 0; $i < 500; $i++) { if (Flags::decide(true, 20, false, false, 'ai', "o$i") && !Flags::decide(true, 40, false, false, 'ai', "o$i")) { return false; } } return Flags::decide(true, 20, false, false, 'ai', 'o1') === Flags::decide(true, 20, false, false, 'ai', 'o1'); })());
check('two flags do not choose the same cohort', (function (): bool { $same = 0; for ($i = 0; $i < 500; $i++) { $same += Flags::decide(true, 50, false, false, 'a', "o$i") === Flags::decide(true, 50, false, false, 'b', "o$i") ? 1 : 0; } return $same < 400; })());

// ---- fixtures ---------------------------------------------------------------------------------------------------------------
$turnstileCalls = [];
$turnstileAnswer = [200, '{"success":true}'];
$ts = static function (string $url, array $f) use (&$turnstileCalls, &$turnstileAnswer): array { $turnstileCalls[] = [$url, $f]; return $turnstileAnswer; };
$cfg = ['smtp' => ['host' => '127.0.0.1', 'port' => 1, 'from_email' => 'noreply@example.test'], 'enquiry_notify_email' => 'team@example.test'];
$ctx = new Ctx($pdo, new RateLimiter($pdo), 'https://rotaflow.example.test', test_private_root(), null, 'open', test_config($cfg));
$mods = array_map(static fn ($m) => $m instanceof Enquiries ? new Enquiries($ctx, $ts) : $m, Modules::all($ctx));
$api = test_api($pdo, $mods);
foreach (['root' => 'platform_owner', 'adam' => 'platform_admin', 'sue' => 'platform_support', 'fin' => 'platform_finance'] as $n => $r) {
    call($api, $n, 'GET', '/me');
    $pdo->prepare('INSERT INTO platform_admins (user_id, role) SELECT id, ? FROM users WHERE email = ?')->execute([$r, "$n@example.test"]);
}
$org = call($api, 'olga', 'POST', '/orgs', ['name' => 'Ops Org'])[1]['org']['id'];
$other = call($api, 'zed', 'POST', '/orgs', ['name' => 'Elsewhere'])[1]['org']['id'];

// ---- incidents ----------------------------------------------------------------------------------------------------------------
$decl = static fn (string $who, array $b = []) => call($GLOBALS['api'], $who, 'POST', '/platform/incidents', $b + ['title' => 'Notifications delayed', 'impact' => 'Emails arrive late.', 'severity' => 'high', 'service' => 'notifications']);
check('customers and finance cannot declare or read incidents', $decl('olga')[0] === 404 && $decl('fin')[0] === 404 && call($api, 'fin', 'GET', '/platform/incidents')[0] === 404 && call($api, 'olga', 'GET', '/platform/incidents')[0] === 404 && call($api, '', 'GET', '/platform/incidents')[0] === 401);
[$s, $r] = $decl('sue');
check('support declares an incident: it gets INC-0138, is investigating, with the impact as the first update', $s === 201 && $r['reference'] === 'INC-0138' && $pdo->query("SELECT status FROM incidents WHERE id = '{$r['id']}'")->fetchColumn() === 'investigating' && (int) $pdo->query("SELECT COUNT(*) FROM incident_updates WHERE incident_id = '{$r['id']}'")->fetchColumn() === 1, json_encode($r));
$inc = $r['id'];
foreach ([['title' => ''], ['impact' => ''], ['service' => ''], ['severity' => 'huge'], ['started_at' => '2099-01-01T00:00:00Z'], ['started_at' => 'yesterday'], ['title' => str_repeat('x', 201)]] as $i => $bad) {
    check("a bad incident is 422 ($i)", $decl('sue', $bad)[0] === 422);
}
check('a past start time is accepted', $decl('sue', ['started_at' => '2030-01-01T00:00:00Z'])[0] === 201 || $decl('sue', ['started_at' => gmdate('Y-m-d\TH:i:s\Z', time() - 3600)])[0] === 201);
check('declaring is audited to the platform', (int) $pdo->query("SELECT COUNT(*) FROM audit_logs WHERE action = 'incident.declared' AND visibility = 'platform_only'")->fetchColumn() >= 1);
$upd = static fn (string $id, array $b) => call($GLOBALS['api'], 'sue', 'POST', "/platform/incidents/$id/updates", $b);
check('an update moves the status and adds to the timeline', $upd($inc, ['status' => 'identified', 'body' => 'Queue worker stuck'])[0] === 201 && $pdo->query("SELECT status FROM incidents WHERE id = '$inc'")->fetchColumn() === 'identified' && (int) $pdo->query("SELECT COUNT(*) FROM incident_updates WHERE incident_id = '$inc'")->fetchColumn() === 2);
check('resolved goes through resolve, and bad updates are refused', $upd($inc, ['status' => 'resolved', 'body' => 'x'])[1]['error']['code'] === 'use_resolve' && $upd($inc, ['status' => 'wibble', 'body' => 'x'])[0] === 422 && $upd($inc, ['status' => 'monitoring', 'body' => ''])[0] === 422 && $upd('99999999-9999-4999-8999-999999999999', ['status' => 'monitoring', 'body' => 'x'])[0] === 404);
check('resolving needs a note', call($api, 'sue', 'POST', "/platform/incidents/$inc/resolve", [])[0] === 422);
check('a customer cannot resolve', call($api, 'olga', 'POST', "/platform/incidents/$inc/resolve", ['resolution' => 'x'])[0] === 404);
check('support resolves it with a note, and the timeline records it', call($api, 'sue', 'POST', "/platform/incidents/$inc/resolve", ['resolution' => 'Restarted the worker'])[0] === 200 && ($row = $pdo->query("SELECT status, resolved_at, resolution FROM incidents WHERE id = '$inc'")->fetch()) && $row['status'] === 'resolved' && $row['resolved_at'] !== null && $row['resolution'] === 'Restarted the worker' && $pdo->query("SELECT status FROM incident_updates WHERE incident_id = '$inc' ORDER BY created_at DESC, id LIMIT 1")->fetchColumn() !== null);
check('a resolved incident cannot be resolved again or half-reopened by an update', call($api, 'sue', 'POST', "/platform/incidents/$inc/resolve", ['resolution' => 'again'])[1]['error']['code'] === 'already_resolved' && $upd($inc, ['status' => 'investigating', 'body' => 'back?'])[1]['error']['code'] === 'already_resolved');
check('the database itself refuses a resolved incident with no note', (function () use ($pdo, $inc): bool { try { $pdo->exec("UPDATE incidents SET resolution = NULL WHERE id = '$inc'"); return false; } catch (PDOException) { return true; } })());
[$s, $d] = call($api, 'adam', 'GET', "/platform/incidents/$inc");
check('staff read an incident and its timeline', $s === 200 && $d['incident']['reference'] === 'INC-0138' && count($d['updates']) === 3);
check('the list can show open incidents only', count(call($api, 'adam', 'GET', '/platform/incidents?open=1')[1]['incidents']) === count(array_filter(call($api, 'adam', 'GET', '/platform/incidents')[1]['incidents'], static fn ($i) => $i['status'] !== 'resolved')));

// ---- feature flags ------------------------------------------------------------------------------------------------------------------
check('every staff role reads the flags; customers cannot', count(call($api, 'fin', 'GET', '/platform/flags')[1]['flags']) >= 1 && call($api, 'olga', 'GET', '/platform/flags')[0] === 404);
$setf = static fn (string $who, array $b) => call($GLOBALS['api'], $who, 'POST', '/platform/flags', $b);
check('only owner and admin change a flag', $setf('sue', ['key' => 'ai_rota_assistant', 'rollout' => 50])[0] === 404 && $setf('fin', ['key' => 'ai_rota_assistant', 'rollout' => 50])[0] === 404 && $setf('olga', ['key' => 'ai_rota_assistant', 'rollout' => 50])[0] === 404);
check('bad changes are refused', $setf('adam', ['key' => 'ai_rota_assistant', 'rollout' => 101])[0] === 422 && $setf('adam', ['key' => 'ai_rota_assistant', 'rollout' => '50'])[0] === 422 && $setf('adam', ['key' => 'ai_rota_assistant', 'enabled' => 'yes'])[0] === 422 && $setf('adam', ['key' => 'ai_rota_assistant', 'plans' => ['gold']])[0] === 422 && $setf('adam', ['key' => 'nope_flag', 'rollout' => 5])[1]['error']['code'] === 'no_such_flag');
[$s, $r] = $setf('adam', ['key' => 'ai_rota_assistant', 'rollout' => 35, 'enabled' => false]);
check('a change records each field that really changed, with before and after and who', $s === 200 && $r['changed'] === ['enabled', 'rollout'] && (int) $pdo->query("SELECT COUNT(*) FROM feature_flag_changes WHERE flag_key = 'ai_rota_assistant' AND field_name IN ('enabled','rollout') AND actor_id IS NOT NULL")->fetchColumn() === 2 && $pdo->query("SELECT CONCAT(before_value, '>', after_value) FROM feature_flag_changes WHERE field_name = 'rollout'")->fetchColumn() === '100%>35%');
check('and is audited as one entry', (int) $pdo->query("SELECT COUNT(*) FROM audit_logs WHERE action = 'feature_flag.updated' AND severity = 'warning'")->fetchColumn() === 1);
check('a no-op changes nothing and writes no history', $setf('adam', ['key' => 'ai_rota_assistant', 'rollout' => 35])[1]['changed'] === [] && (int) $pdo->query("SELECT COUNT(*) FROM feature_flag_changes WHERE flag_key = 'ai_rota_assistant'")->fetchColumn() === 3);
check('a disabled flag is off for every organisation', Flags::enabledForOrg($pdo, 'ai_rota_assistant', $org) === false);
$setf('adam', ['key' => 'ai_rota_assistant', 'enabled' => true, 'rollout' => 0, 'plans' => []]);
check('enabled at 0% with no plans is still off', Flags::enabledForOrg($pdo, 'ai_rota_assistant', $org) === false);
check('targeting a pilot organisation turns it on for that organisation only', call($api, 'adam', 'POST', '/platform/flags/targets', ['key' => 'ai_rota_assistant', 'org_id' => $org, 'targeted' => true])[0] === 200 && Flags::enabledForOrg($pdo, 'ai_rota_assistant', $org) === true && Flags::enabledForOrg($pdo, 'ai_rota_assistant', $other) === false);
check('targeting needs a real flag and organisation, and a boolean', call($api, 'adam', 'POST', '/platform/flags/targets', ['key' => 'nope_flag', 'org_id' => $org, 'targeted' => true])[0] === 404 && call($api, 'adam', 'POST', '/platform/flags/targets', ['key' => 'ai_rota_assistant', 'org_id' => '99999999-9999-4999-8999-999999999999', 'targeted' => true])[0] === 404 && call($api, 'adam', 'POST', '/platform/flags/targets', ['key' => 'ai_rota_assistant', 'org_id' => $org, 'targeted' => 'yes'])[0] === 422 && call($api, 'sue', 'POST', '/platform/flags/targets', ['key' => 'ai_rota_assistant', 'org_id' => $org, 'targeted' => false])[0] === 404);
check('a targeted plan turns it on for organisations on that plan', $setf('adam', ['key' => 'ai_rota_assistant', 'plans' => ['professional']])[1]['changed'] === ['target_plans'] && Flags::enabledForOrg($pdo, 'ai_rota_assistant', $other) === true);
call($api, 'adam', 'POST', '/platform/flags/targets', ['key' => 'ai_rota_assistant', 'org_id' => $org, 'targeted' => false]);
$pdo->exec("UPDATE organisations SET plan = 'starter' WHERE id = '$org'");
check('untargeting turns a pilot off again', Flags::enabledForOrg($pdo, 'ai_rota_assistant', $org) === false);
check('the history lists every change, newest first', ($c = call($api, 'fin', 'GET', '/platform/flags/changes?key=ai_rota_assistant')[1]['changes']) && count($c) >= 7 && call($api, 'olga', 'GET', '/platform/flags/changes?key=ai_rota_assistant')[0] === 404);
$pdo->exec("UPDATE feature_flags SET retired_at = UTC_TIMESTAMP(), retired_reason = 'replaced by a plan feature' WHERE flag_key = 'ai_rota_assistant'");
check('a retired flag cannot be changed', $setf('adam', ['key' => 'ai_rota_assistant', 'rollout' => 10])[1]['error']['code'] === 'flag_retired' && str_contains($setf('adam', ['key' => 'ai_rota_assistant', 'rollout' => 10])[1]['error']['message'], 'replaced by a plan feature'));
$pdo->exec("UPDATE feature_flags SET retired_at = NULL, retired_reason = NULL, enabled = 1, rollout = 100 WHERE flag_key = 'ai_rota_assistant'");
$pdo->exec("UPDATE organisations SET plan = 'business' WHERE id = '$org'");
[$s, $f] = call($api, 'olga', 'GET', "/orgs/$org/features");
check('a member sees what is on for their organisation: the flag, and what the plan includes', $s === 200 && in_array(['feature' => 'ai_rota_assistant', 'source' => 'flag'], $f['features'], true) && in_array(['feature' => 'ai_rota_assistant', 'source' => 'plan'], $f['features'], true), json_encode($f));
check('a stranger gets 404', call($api, 'zed', 'GET', "/orgs/$org/features")[0] === 404);
$pdo->exec("UPDATE feature_flags SET retired_at = UTC_TIMESTAMP() WHERE flag_key = 'ai_rota_assistant'");
check('a retired flag is hidden from members', !in_array(['feature' => 'ai_rota_assistant', 'source' => 'flag'], call($api, 'olga', 'GET', "/orgs/$org/features")[1]['features'], true));

// ---- enquiries ----------------------------------------------------------------------------------------------------------------------------
$good = ['name' => 'Priya Shah', 'workEmail' => 'priya@care.example', 'organisation' => 'Oak Care', 'message' => 'We run four homes and want a demo.', 'teamSize' => '26-100', 'sector' => 'Healthcare and care homes', 'wantsDemo' => true];
$post = static function (array|string $body, array $h = [], string $ip = '203.0.113.9') use ($api): array {
    return $api->handle('POST', '/enquiries', $h + ['content-type' => 'application/json', 'user-agent' => 'TestBrowser/1.0', 'origin' => 'https://rotaflow.example.test'], is_array($body) ? json_encode($body) : $body, $ip);
};
$count = static fn (): int => (int) $GLOBALS['pdo']->query('SELECT COUNT(*) FROM enquiries')->fetchColumn();
[$s, $r] = $post($good);
check('a valid enquiry is stored, and only {ok:true} is said back', $s === 201 && $r === ['ok' => true] && $count() === 1);
$row = $pdo->query('SELECT * FROM enquiries')->fetch();
check('it is stored trimmed, status new, with a keyed hash of the address and the user agent, and never the address itself', $row['status'] === 'new' && $row['team_size'] === '26-100' && (int) $row['wants_demo'] === 1 && (int) $row['marketing_consent'] === 0 && preg_match('/^[0-9a-f]{64}$/', (string) $row['ip_hash']) === 1 && $row['ip_hash'] !== hash('sha256', '203.0.113.9') && !str_contains(json_encode($row), '203.0.113.9') && $row['user_agent'] === 'TestBrowser/1.0');
check('the same address gives the same hash, another address another', (function () use ($post, $pdo, $good): bool { $post($good); $post($good, [], '203.0.113.10'); return (int) $pdo->query('SELECT COUNT(*) FROM (SELECT ip_hash FROM enquiries GROUP BY ip_hash HAVING COUNT(*) = 2) t')->fetchColumn() === 1 && (int) $pdo->query('SELECT COUNT(DISTINCT ip_hash) FROM enquiries')->fetchColumn() === 2; })());
check('a wrong Origin is 403, a missing one is allowed (curl)', $post($good, ['origin' => 'https://evil.example'])[0] === 403 && $api->handle('POST', '/enquiries', ['content-type' => 'application/json'], json_encode($good), '203.0.113.20')[0] === 201);
check('the wrong content type is 415, an oversize body is 413, junk is 400', $post($good, ['content-type' => 'text/plain'])[0] === 415 && $post(array_replace($good, ['message' => str_repeat('x', 17000)]))[0] === 413 && $post('not json')[0] === 400 && $post('"a string"')[0] === 400);
$before = $count();
foreach ([['name' => ''], ['name' => 'a' . "\x01"], ['workEmail' => 'nope'], ['workEmail' => 'a b@c.d'], ['organisation' => ''], ['message' => 'too short'], ['message' => str_repeat('x', 5001)], ['teamSize' => '5'], ['sector' => 'Mining'], ['wantsDemo' => 'true'], ['marketingConsent' => 1], ['turnstileToken' => ''], ['name' => ['x']], ['workEmail' => null]] as $i => $bad) {
    [$s, $r] = $post(array_replace($good, $bad), [], '198.51.100.' . (30 + $i));
    check("an invalid enquiry is 400 naming the field and never echoing the value ($i)", $s === 400 && $r['error'] === 'invalid' && $r['fields'] !== [] && !str_contains(json_encode($r), 'Mining') && !str_contains(json_encode($r), 'nope'), json_encode($r));
}
check('nothing invalid was stored', $count() === $before);
check('empty optional fields are fine, and tab and newline are legal in the message', $post(array_replace($good, ['teamSize' => '', 'sector' => null, 'message' => "Line one\n\tline two here"]), [], '198.51.100.60')[0] === 201 && $pdo->query("SELECT team_size FROM enquiries WHERE message LIKE 'Line one%'")->fetchColumn() === null);
check('accented names are measured in characters, not bytes', $post(array_replace($good, ['name' => str_repeat('é', 120)]), [], '198.51.100.61')[0] === 201 && $post(array_replace($good, ['name' => str_repeat('é', 121)]), [], '198.51.100.62')[0] === 400);
$before = $count();
[$s, $r] = $post(array_replace($good, ['website' => 'http://spam.example']), [], '198.51.100.70');
check('a filled honeypot gets exactly the success reply and stores nothing', $s === 201 && $r === ['ok' => true] && $count() === $before);
check('and spam never spends the address\'s allowance', (function () use ($post, $good): bool { for ($i = 0; $i < 8; $i++) { $post(array_replace($good, ['website' => 'x']), [], '198.51.100.74'); } return $post($good, [], '198.51.100.74')[0] === 201; })());
check('and so does one that is also invalid, and a falsy but present honeypot', $post(['name' => '', 'website' => 'x'], [], '198.51.100.71')[0] === 201 && $post(array_replace($good, ['website' => 0]), [], '198.51.100.72')[0] === 201 && $post(array_replace($good, ['website' => '']), [], '198.51.100.73')[0] === 201);
check('the sixth enquiry in an hour from one address is 429, the fifth is not', (function () use ($post, $good): bool { $codes = []; for ($i = 0; $i < 6; $i++) { $codes[] = $post($good, [], '198.51.100.80')[0]; } return $codes === [201, 201, 201, 201, 201, 429]; })());
check('another address is unaffected', $post($good, [], '198.51.100.81')[0] === 201);

// Turnstile
$ctxT = new Ctx($pdo, new RateLimiter($pdo), 'https://rotaflow.example.test', test_private_root(), null, 'open', test_config(['turnstile_secret' => 'ts-secret-for-tests']));
$apiT = test_api($pdo, [new Enquiries($ctxT, $ts)]);
$postT = static fn (array $b, string $ip = '198.51.100.90') => $apiT->handle('POST', '/enquiries', ['content-type' => 'application/json'], json_encode($b), $ip);
check('with Turnstile configured a missing token is 400 verification_failed and Cloudflare is not asked', $postT($good)[1] === ['error' => 'verification_failed'] && $turnstileCalls === []);
$turnstileCalls = [];
check('a good token passes, and Cloudflare gets the secret, the token, the address and a one-time key', $postT($good + ['turnstileToken' => 'tok123'], '198.51.100.91')[0] === 201 && $turnstileCalls[0][0] === 'https://challenges.cloudflare.com/turnstile/v0/siteverify' && $turnstileCalls[0][1]['response'] === 'tok123' && $turnstileCalls[0][1]['remoteip'] === '198.51.100.91' && $turnstileCalls[0][1]['secret'] === 'ts-secret-for-tests' && strlen($turnstileCalls[0][1]['idempotency_key']) === 36);
$turnstileAnswer = [200, '{"success":false}'];
check('a refused token fails', $postT($good + ['turnstileToken' => 'bad'], '198.51.100.92')[0] === 400);
$turnstileAnswer = [500, '{"success":true}'];
check('a Cloudflare outage fails closed, even if the body says success', $postT($good + ['turnstileToken' => 'x'], '198.51.100.93')[0] === 400);
$turnstileAnswer = [200, 'not json'];
check('and so does an unreadable answer', $postT($good + ['turnstileToken' => 'x'], '198.51.100.94')[0] === 400);
$turnstileAnswer = [200, '{"success":true}'];
$turnstileCalls = [];
check('a token sent when Turnstile is off is ignored', $post($good + ['turnstileToken' => 'x'], [], '198.51.100.95')[0] === 201 && $turnstileCalls === []);

// The inbox
check('operational staff read the inbox; finance and customers cannot', call($api, 'sue', 'GET', '/platform/enquiries')[0] === 200 && call($api, 'fin', 'GET', '/platform/enquiries')[0] === 404 && call($api, 'olga', 'GET', '/platform/enquiries')[0] === 404 && call($api, '', 'GET', '/platform/enquiries')[0] === 401);
$inbox = call($api, 'adam', 'GET', '/platform/enquiries')[1]['enquiries'];
check('the inbox never carries the address hash or the user agent', $inbox !== [] && !str_contains(json_encode($inbox), 'ip_hash') && !str_contains(json_encode($inbox), 'user_agent') && !str_contains(json_encode($inbox), 'TestBrowser'));
$eid = $inbox[0]['id'];
check('staff mark an enquiry handled, and nothing else about it changes', call($api, 'sue', 'POST', "/platform/enquiries/$eid/status", ['status' => 'replied'])[0] === 200 && $pdo->query("SELECT status FROM enquiries WHERE id = '$eid'")->fetchColumn() === 'replied' && count(call($api, 'adam', 'GET', '/platform/enquiries?status=replied')[1]['enquiries']) === 1);
check('a bad status is 422, an unknown enquiry 404, a customer 404', call($api, 'sue', 'POST', "/platform/enquiries/$eid/status", ['status' => 'x'])[0] === 422 && call($api, 'sue', 'POST', '/platform/enquiries/99999999-9999-4999-8999-999999999999/status', ['status' => 'closed'])[0] === 404 && call($api, 'olga', 'POST', "/platform/enquiries/$eid/status", ['status' => 'closed'])[0] === 404);

// The team's notice (cron)
check('with no working mail account the cron notice does nothing and does not fail', Enquiries::cron($ctx) === 'notifications off' || str_contains(Enquiries::cron($ctx), 'sent=0'));
check('with no notify address it is off', Enquiries::cron(new Ctx($pdo, new RateLimiter($pdo), 'https://rotaflow.example.test', test_private_root(), null, 'open', test_config())) === 'notifications off');
