<?php
declare(strict_types=1);

// Billing (Stripe, test mode): the pure decisions, the client, plan limits, read-only, the owner's endpoints and the signed webhook.
// Nothing here reaches Stripe: a fake transport answers, and records every request it was asked.
use RotaFlow\{Billing as B, BillingRules as R, Ctx, Db, RateLimiter, StripeClient, StripeError};
use RotaFlow\Mod\{Billing as BillingMod, StripeWebhook};

// ---- signatures ---------------------------------------------------------------------------------------------------
$sign = static fn (string $body, string $secret, int $t): string => 't=' . $t . ',v1=' . hash_hmac('sha256', $t . '.' . $body, $secret);
$now = 1_900_000_000;
$body = '{"id":"evt_1","type":"invoice.paid"}';
check('a correct signature verifies', R::verifySignature($body, $sign($body, 'whsec_a', $now), 'whsec_a', $now));
check('a changed body is refused', !R::verifySignature($body . ' ', $sign($body, 'whsec_a', $now), 'whsec_a', $now));
check('another secret is refused', !R::verifySignature($body, $sign($body, 'whsec_b', $now), 'whsec_a', $now));
check('a captured request replayed 6 minutes later is refused', !R::verifySignature($body, $sign($body, 'whsec_a', $now - 360), 'whsec_a', $now));
check('a timestamp from the future is refused', !R::verifySignature($body, $sign($body, 'whsec_a', $now + 360), 'whsec_a', $now));
check('4 minutes either way is allowed', R::verifySignature($body, $sign($body, 'whsec_a', $now - 240), 'whsec_a', $now) && R::verifySignature($body, $sign($body, 'whsec_a', $now + 240), 'whsec_a', $now));
check('no header, an empty secret, junk and an oversize header are refused', !R::verifySignature($body, '', 'whsec_a', $now) && !R::verifySignature($body, $sign($body, '', $now), '', $now) && !R::verifySignature($body, 'garbage', 'whsec_a', $now) && !R::verifySignature($body, str_repeat('a', 1001), 'whsec_a', $now));
check('while a secret rotates either signature is accepted', R::verifySignature($body, 't=' . $now . ',v1=' . str_repeat('0', 64) . ',v1=' . hash_hmac('sha256', $now . '.' . $body, 'whsec_a'), 'whsec_a', $now));
check('a header with no v1, or a short one, is refused', !R::verifySignature($body, "t=$now", 'whsec_a', $now) && !R::verifySignature($body, "t=$now,v1=abcd", 'whsec_a', $now));

// ---- the other pure decisions ---------------------------------------------------------------------------------------------
check('checkout is refused for a live subscription in this mode only', !R::checkoutAllowed(['status' => 'active', 'provider_ref' => 'sub_1', 'stripe_mode' => 'test'], 'test') && R::checkoutAllowed(['status' => 'active', 'provider_ref' => 'sub_1', 'stripe_mode' => 'live'], 'test') && R::checkoutAllowed(['status' => 'canceled', 'provider_ref' => 'sub_1', 'stripe_mode' => 'test'], 'test') && R::checkoutAllowed(null, 'test'));
check('a trial with under 49 hours left is not carried into Stripe (it rejects under 48)', R::checkoutTrialEnd(gmdate('Y-m-d H:i:s', $now + 49 * 3600 - 1), $now) === null && R::checkoutTrialEnd(gmdate('Y-m-d H:i:s', $now + 49 * 3600), $now) === $now + 49 * 3600 && R::checkoutTrialEnd(null, $now) === null);
check('a failure never regresses a paid invoice', R::invoiceFailure(['status' => 'paid', 'attempts' => 1], 2)['apply'] === false);
check('a redelivered failure is not another attempt', R::invoiceFailure(['status' => 'past_due', 'attempts' => 2], 2)['apply'] === false && R::invoiceFailure(['status' => 'past_due', 'attempts' => 2], 3) === ['apply' => true, 'attempts' => 3, 'reason' => 'further-failure']);
check('the attempt count never goes backwards', R::invoiceFailure(['status' => 'past_due', 'attempts' => 3], 1)['attempts'] === 3);
check('an event with no organisation or no subscription is given no scope', R::subscriptionScope(null, 'sub_1', 'test') === null && R::subscriptionScope('o', null, 'test') === null && R::subscriptionScope('o', '', 'test') === null && R::subscriptionScope('o', 'sub_1', 'test') === ['org_id' => 'o', 'provider_ref' => 'sub_1', 'stripe_mode' => 'test']);
check('the subscription on an invoice is read whether bare or expanded', R::subscriptionRefOf(['subscription' => 'sub_1']) === 'sub_1' && R::subscriptionRefOf(['subscription' => ['id' => 'sub_2']]) === 'sub_2' && R::subscriptionRefOf([]) === null);
check('a retrieved subscription for another id is not used', R::freshestSubscription(['id' => 'sub_1'], ['id' => 'sub_2']) === null && R::freshestSubscription(['id' => 'sub_1'], null) === null && R::freshestSubscription(['id' => 'sub_1', 'status' => 'active'], ['id' => 'sub_1', 'status' => 'canceled'])['status'] === 'canceled');
check('Stripe statuses map, and anything new counts as past due', R::mapStatus('active') === 'active' && R::mapStatus('trialing') === 'trialing' && R::mapStatus('canceled') === 'canceled' && R::mapStatus('paused') === 'canceled' && R::mapStatus('unpaid') === 'past_due' && R::mapStatus('incomplete') === 'past_due' && R::mapStatus('something_new') === 'past_due');
check('an organisation is suspended only for a subscription we hold that Stripe cancelled for non-payment', R::suspendOnDeleted(true, 'payment_failed') && !R::suspendOnDeleted(true, 'cancellation_requested') && !R::suspendOnDeleted(false, 'payment_failed') && !R::suspendOnDeleted(true, null));
check('only Stripe\'s own invoice links are ever stored', R::documentUrl('https://invoice.stripe.com/i/x') !== null && R::documentUrl('https://pay.stripe.com/x') !== null && R::documentUrl('http://invoice.stripe.com/x') === null && R::documentUrl('https://evil.example/invoice.stripe.com/') === null && R::documentUrl('https://invoice.stripe.com.evil.example/x') === null && R::documentUrl("https://invoice.stripe.com/x y") === null && R::documentUrl(null) === null);
check('a stored link is not overwritten by a missing one', R::documentsToWrite(['hosted_invoice_url' => 'https://pay.stripe.com/a', 'invoice_pdf' => null], null) === ['hosted_invoice_url' => 'https://pay.stripe.com/a'] && R::documentsToWrite(['hosted_invoice_url' => null, 'invoice_pdf' => null], ['hosted_invoice_url' => null, 'invoice_pdf' => 'https://pay.stripe.com/p']) === ['invoice_pdf' => 'https://pay.stripe.com/p']);
check('the notices are once per subscription / per invoice, and none without owners', R::paymentFailedNotice([], 'in_1', 'test') === null && R::paymentFailedNotice(['u'], 'in_1', 'test')['dedupe'] === 'stripe:payment_failed:test:in_1' && R::trialEndingNotice(['u'], 'sub_1', 1_900_000_000, 'test')['dedupe'] === 'stripe:trial_will_end:test:sub_1:1900000000');

// ---- the client ---------------------------------------------------------------------------------------------------------
check('nested parameters are form-encoded the way Stripe reads them', StripeClient::encode(['mode' => 'subscription', 'line_items' => [['price' => 'price_1', 'quantity' => 1]], 'metadata' => ['org_id' => 'o'], 'skip' => null, 'flag' => true]) === 'mode=subscription&line_items%5B0%5D%5Bprice%5D=price_1&line_items%5B0%5D%5Bquantity%5D=1&metadata%5Borg_id%5D=o&flag=true');
$refuses = static function (callable $f): bool { try { $f(); return false; } catch (\InvalidArgumentException) { return true; } };
check('a live key in test mode, a test key in live mode and a malformed key are all refused before any request', $refuses(fn () => new StripeClient('sk_live_' . str_repeat('a', 24), 'test')) && $refuses(fn () => new StripeClient('sk_test_' . str_repeat('a', 24), 'live')) && $refuses(fn () => new StripeClient('nonsense', 'test')) && $refuses(fn () => new StripeClient('sk_test_' . str_repeat('a', 24), 'staging')));
$err = null;
try { (new StripeClient('sk_test_' . str_repeat('a', 24), 'test', static fn (): array => [402, '{"error":{"code":"card_declined","message":"Your card was declined."}}']))->subscription('sub_1'); } catch (StripeError $e) { $err = $e; }
check('a Stripe error becomes a StripeError with its status and code', $err !== null && $err->status === 402 && $err->stripeCode === 'card_declined');
$sent = [];
(new StripeClient('sk_test_' . str_repeat('a', 24), 'test', static function (string $m, string $u, array $h, string $b) use (&$sent): array { $sent = [$m, $u, $h, $b]; return [200, '{"id":"sub_1"}']; }))->subscription('sub_1');
check('a request carries the key as a bearer token and a pinned API version', $sent[0] === 'GET' && $sent[1] === 'https://api.stripe.com/v1/subscriptions/sub_1' && str_starts_with($sent[2]['Authorization'], 'Bearer sk_test_') && isset($sent[2]['Stripe-Version']));

// ---- fixtures -----------------------------------------------------------------------------------------------------------
$calls = [];
$responses = [];
$transport = static function (string $m, string $url, array $h, string $b) use (&$calls, &$responses): array {
    $calls[] = [$m, preg_replace('#^https://api\.stripe\.com/v1#', '', $url), $b];
    $key = $m . ' ' . preg_replace('#^https://api\.stripe\.com/v1#', '', $url);
    $r = $responses[$key] ?? null;
    if ($r === null) { return [404, '{"error":{"code":"resource_missing","message":"No such thing"}}']; }
    return $r instanceof Closure ? $r($b) : [200, json_encode($r)];
};
$cfg = ['stripe' => ['mode' => 'test', 'test_secret_key' => 'sk_test_' . str_repeat('k', 24), 'test_webhook_secret' => 'whsec_unit', 'webhook_secret' => 'whsec_live_unit']];
$ctx = new Ctx($pdo, new RateLimiter($pdo), 'https://rotaflow.example.test', test_private_root(), null, 'open', test_config($cfg));
$api = test_api($pdo, [new BillingMod($ctx, $transport), new StripeWebhook($ctx, $transport), ...array_filter(RotaFlow\Modules::all($ctx), static fn ($m) => !$m instanceof BillingMod && !$m instanceof StripeWebhook)]);
$org = call($api, 'olga', 'POST', '/orgs', ['name' => 'Bill Org'])[1]['org']['id'];
$other = call($api, 'zed', 'POST', '/orgs', ['name' => 'Elsewhere'])[1]['org']['id'];
call($api, 'mark', 'GET', '/me');
$pdo->prepare("INSERT INTO memberships (id, org_id, user_id, role, status) SELECT ?, ?, id, 'manager', 'active' FROM users WHERE email = 'mark@example.test'")->execute([Db::uuid(), $org]);
call($api, 'sam', 'GET', '/me');
$pdo->prepare("INSERT INTO memberships (id, org_id, user_id, role, status) SELECT ?, ?, id, 'staff', 'active' FROM users WHERE email = 'sam@example.test'")->execute([Db::uuid(), $org]);
$samStaff = call($api, 'olga', 'POST', "/orgs/$org/staff", ['first_name' => 'Sam', 'email' => 'sam@example.test'])[1]['id'];
$pdo->exec("UPDATE plans SET stripe_test_price_id = CONCAT('price_test_', code) WHERE code IN ('starter','professional','business')");
$sub = static fn (array $over = []): array => array_replace_recursive(['id' => 'sub_t1', 'status' => 'active', 'customer' => 'cus_t1', 'current_period_end' => $GLOBALS['now'] + 30 * 86400, 'trial_end' => null, 'canceled_at' => null,
    'metadata' => ['org_id' => $GLOBALS['org'], 'plan' => 'business'], 'items' => ['data' => [['price' => ['id' => 'price_test_business', 'unit_amount' => 29900]]]]], $over);
$inv = static fn (array $over = []): array => array_replace(['id' => 'in_t1', 'number' => 'ABC-0001', 'subscription' => 'sub_t1', 'status' => 'open', 'created' => time() - 60, 'due_date' => null, 'period_start' => time() - 86400, 'period_end' => time() + 86400 * 29,
    'total' => 29900, 'currency' => 'gbp', 'total_tax_amounts' => [['amount' => 4983]], 'hosted_invoice_url' => 'https://invoice.stripe.com/i/acct/test_1', 'invoice_pdf' => 'https://pay.stripe.com/invoice/test_1/pdf', 'attempt_count' => 0, 'status_transitions' => ['paid_at' => null]], $over);
$evt = static fn (string $type, array $object, array $over = []): array => array_replace(['id' => 'evt_' . bin2hex(random_bytes(6)), 'type' => $type, 'livemode' => false, 'created' => time(), 'data' => ['object' => $object]], $over);
$hook = static function (array $event, ?string $secret = 'whsec_unit', ?int $t = null, ?string $rawOverride = null) use ($api, $sign): array {
    $raw = $rawOverride ?? json_encode($event);
    $headers = $secret === null ? [] : ['stripe-signature' => $sign($raw, $secret, $t ?? time())];
    return $api->handle('POST', '/stripe/webhook', $headers, $raw, '198.51.100.7');
};
$ledger = static fn (string $id): array|false => ($q = $GLOBALS['pdo']->prepare("SELECT * FROM billing_events WHERE event_id = ?")) && $q->execute([$id]) ? $q->fetch() : false;
$subRow = static fn (): array|false => $GLOBALS['pdo']->query("SELECT * FROM subscriptions WHERE org_id = '{$GLOBALS['org']}'")->fetch();
$orgRow = static fn (): array => $GLOBALS['pdo']->query("SELECT plan, status, suspended_reason FROM organisations WHERE id = '{$GLOBALS['org']}'")->fetch();
$sweepCalls = static fn (): int => count($GLOBALS['calls']);

// ---- state and read-only --------------------------------------------------------------------------------------------------
check('a new organisation is on its own trial', B::state($pdo, $org)['state'] === 'trial' && call($api, 'sam', 'GET', "/orgs/$org/billing/state")[1]['state'] === 'trial');
check('any member reads the state; a stranger gets 404; the owner-only account is refused to a manager', call($api, 'zed', 'GET', "/orgs/$org/billing/state")[0] === 404 && call($api, 'mark', 'GET', "/orgs/$org/billing")[0] === 403 && call($api, 'olga', 'GET', "/orgs/$org/billing")[0] === 200);
check('the price list needs a sign-in and hides the Stripe price ids', call($api, '', 'GET', '/plans')[0] === 401 && ($p = call($api, 'sam', 'GET', '/plans')[1]['plans']) && count($p) === 4 && !str_contains(json_encode($p), 'price_test') && $p[0]['code'] === 'starter' && $p[0]['purchasable'] === true && end($p)['purchasable'] === false);
$site = call($api, 'olga', 'POST', "/orgs/$org/locations", ['name' => 'Oak'])[1]['id'];
$rota = call($api, 'mark', 'POST', "/orgs/$org/rotas", ['name' => 'R', 'period_start' => '2030-06-03', 'period_end' => '2030-06-09', 'location_id' => $site]);
check('during the trial a manager builds a rota', $rota[0] === 201, json_encode($rota[1]));
$rotaId = $rota[1]['rota']['id'];
$shiftBody = ['rota_id' => $rotaId, 'location_id' => $site, 'staff_profile_id' => $samStaff, 'starts_at' => '2030-06-03T09:00:00Z', 'ends_at' => '2030-06-03T17:00:00Z'];
$first = call($api, 'mark', 'POST', "/orgs/$org/shifts", $shiftBody);
check('and adds a shift', $first[0] === 201, json_encode($first[1]));

$pdo->exec("UPDATE organisations SET trial_ends_at = DATE_SUB(UTC_TIMESTAMP(), INTERVAL 1 DAY) WHERE id = '$org'");
check('when the trial has ended the organisation is read-only', B::state($pdo, $org)['state'] === 'read_only');
foreach ([['create a rota', 'POST', "/orgs/$org/rotas", ['name' => 'R2', 'period_start' => '2030-07-01', 'period_end' => '2030-07-07', 'location_id' => $site]], ['publish a rota', 'POST', "/orgs/$org/rotas/$rotaId/publish", []],
    ['add a shift', 'POST', "/orgs/$org/shifts", $shiftBody], ['edit a shift', 'POST', "/orgs/$org/shifts/{$first[1]['shift']['id']}", ['notes' => 'x']], ['delete a shift', 'POST', "/orgs/$org/shifts/{$first[1]['shift']['id']}/delete", []],
    ['invite someone', 'POST', "/orgs/$org/invites", ['email' => 'new@example.test', 'role' => 'staff']]] as [$what, $m, $path, $b]) {
    [$s, $r] = call($api, 'olga', $m, $path, $b);
    check("read-only: cannot $what (402 billing_read_only)", $s === 402 && ($r['error']['code'] ?? '') === 'billing_read_only', "$s " . json_encode($r));
}
check('read-only still lets staff ask for leave and clock in', call($api, 'sam', 'POST', "/orgs/$org/leave", ['start_date' => '2030-09-01', 'end_date' => '2030-09-02'])[0] === 201 && call($api, 'sam', 'POST', "/orgs/$org/clock-events", ['type' => 'in', 'method' => 'manual'])[0] === 201);
[$s, $r] = call($api, 'mark', 'GET', "/orgs/$org/shifts?rota_ids=$rotaId");
check('and reading the rota still works', $s === 200, "$s " . json_encode($r));

// ---- owner endpoints with a fake Stripe -------------------------------------------------------------------------------------
$responses['POST /checkout/sessions'] = ['id' => 'cs_test_1', 'url' => 'https://checkout.stripe.com/c/pay/cs_test_1'];
check('checkout: a manager is refused, a stranger gets 404', call($api, 'mark', 'POST', "/orgs/$org/billing/checkout", ['plan' => 'starter'])[0] === 403 && call($api, 'zed', 'POST', "/orgs/$org/billing/checkout", ['plan' => 'starter'])[0] === 404 && $sweepCalls() === 0);
check('checkout: enterprise, an unknown plan and no plan are 422', call($api, 'olga', 'POST', "/orgs/$org/billing/checkout", ['plan' => 'enterprise'])[0] === 422 && call($api, 'olga', 'POST', "/orgs/$org/billing/checkout", ['plan' => 'gold'])[0] === 422 && call($api, 'olga', 'POST', "/orgs/$org/billing/checkout", [])[0] === 422);
$pdo->exec("UPDATE plans SET stripe_test_price_id = NULL WHERE code = 'starter'");
check('checkout: a plan with no test price is 409 and nothing is sent', call($api, 'olga', 'POST', "/orgs/$org/billing/checkout", ['plan' => 'starter'])[1]['error']['code'] === 'plan_unavailable' && $sweepCalls() === 0);
$pdo->exec("UPDATE plans SET stripe_test_price_id = 'price_test_starter' WHERE code = 'starter'");
[$s, $r] = call($api, 'olga', 'POST', "/orgs/$org/billing/checkout", ['plan' => 'business']);
parse_str($calls[0][2] ?? '', $sentBody);
check('checkout returns a Stripe checkout URL', $s === 200 && $r['url'] === 'https://checkout.stripe.com/c/pay/cs_test_1', json_encode($r));
check('the session names the price, the organisation and the plan, and comes back to the configured app URL', ($sentBody['line_items'][0]['price'] ?? '') === 'price_test_business' && ($sentBody['client_reference_id'] ?? '') === $org && ($sentBody['metadata']['org_id'] ?? '') === $org && ($sentBody['subscription_data']['metadata']['plan'] ?? '') === 'business'
    && str_starts_with($sentBody['success_url'] ?? '', 'https://rotaflow.example.test/app/settings/billing') && str_starts_with($sentBody['cancel_url'] ?? '', 'https://rotaflow.example.test/'), json_encode($sentBody));
check('an organisation whose trial ended gets no trial_end (it would charge now), and a new customer is identified by email', !isset($sentBody['subscription_data']['trial_end']) && ($sentBody['customer_email'] ?? '') === 'olga@example.test' && !isset($sentBody['customer']));
$pdo->exec("UPDATE organisations SET trial_ends_at = DATE_ADD(UTC_TIMESTAMP(), INTERVAL 10 DAY) WHERE id = '$org'");
$calls = [];
call($api, 'olga', 'POST', "/orgs/$org/billing/checkout", ['plan' => 'professional']);
parse_str($calls[0][2] ?? '', $sentBody);
check('a trial with more than 49 hours left is carried into Stripe', isset($sentBody['subscription_data']['trial_end']) && abs((int) $sentBody['subscription_data']['trial_end'] - (time() + 10 * 86400)) < 10, json_encode($sentBody['subscription_data'] ?? null));
$responses['POST /checkout/sessions'] = ['id' => 'cs_test_2', 'url' => 'https://evil.example/pay'];
check('a checkout URL that is not Stripe\'s is not passed on', call($api, 'olga', 'POST', "/orgs/$org/billing/checkout", ['plan' => 'business'])[0] === 502);
$leakyKey = 'sk_' . 'test_' . 'secretvalue1234567890'; // assembled, so a secret scanner does not mistake a test fixture for a committed key
$responses['POST /checkout/sessions'] = static fn (): array => [500, '{"error":{"code":"api_error","message":"internal ' . $leakyKey . '"}}'];
[$s, $r] = call($api, 'olga', 'POST', "/orgs/$org/billing/checkout", ['plan' => 'business']);
check('a Stripe failure is a 502 that says nothing about Stripe\'s reply', $s === 502 && !str_contains(json_encode($r), 'sk_test') && !str_contains(json_encode($r), 'internal'));
$mismatch = new Ctx($pdo, new RateLimiter($pdo), 'https://rotaflow.example.test', test_private_root(), null, 'open', test_config(['stripe' => ['mode' => 'test', 'test_secret_key' => 'sk_live_' . str_repeat('k', 24)]]));
$calls = [];
check('a live key while in test mode is a 503 and sends nothing', (new BillingMod($mismatch, $transport))->routes() && call(test_api($pdo, [new BillingMod($mismatch, $transport)]), 'olga', 'POST', "/orgs/$org/billing/checkout", ['plan' => 'business'])[0] === 503 && $calls === []);
$none = new Ctx($pdo, new RateLimiter($pdo), 'https://rotaflow.example.test', test_private_root(), null, 'open', test_config());
check('with no Stripe configuration billing says it is not set up', call(test_api($pdo, [new BillingMod($none, $transport)]), 'olga', 'POST', "/orgs/$org/billing/checkout", ['plan' => 'business'])[0] === 503 && call(test_api($pdo, [new BillingMod($none, $transport)]), 'olga', 'GET', "/orgs/$org/billing")[1]['stripe_configured'] === false);

// ---- the webhook: refusals -------------------------------------------------------------------------------------------------------
$responses['GET /subscriptions/sub_t1'] = $sub();
$e = $evt('checkout.session.completed', ['mode' => 'subscription', 'client_reference_id' => $org, 'metadata' => ['org_id' => $org, 'plan' => 'business'], 'subscription' => 'sub_t1', 'customer' => 'cus_t1']);
$calls = [];
check('an unsigned request is 400 and nothing is recorded', $hook($e, null)[0] === 400 && $ledger($e['id']) === false && $calls === []);
check('a wrong secret is 400', $hook($e, 'whsec_wrong')[0] === 400 && $ledger($e['id']) === false);
check('a captured request replayed an hour later is 400', $hook($e, 'whsec_unit', time() - 3600)[0] === 400);
$raw = json_encode($e);
$tampered = $api->handle('POST', '/stripe/webhook', ['stripe-signature' => $sign($raw, 'whsec_unit', time())], str_replace($org, $other, $raw), '198.51.100.7');
check('tampering with the organisation in a signed body is caught', $tampered[0] === 400 && $subRow() === false);
check('a live-mode event while in test mode is acknowledged and ignored, even unsigned', ($r = $hook($evt('checkout.session.completed', ['mode' => 'subscription'], ['livemode' => true]), null))[0] === 200 && ($r[1]['ignored'] ?? '') === 'mode' && (int) $pdo->query('SELECT COUNT(*) FROM billing_events')->fetchColumn() === 0);
check('a signed non-JSON body is 400', $hook([], 'whsec_unit', null, 'not json')[0] === 400);
check('an event with no id is 400', $hook(['type' => 'x', 'livemode' => false, 'data' => ['object' => []]])[0] === 400);

// ---- checkout completes ------------------------------------------------------------------------------------------------------------
$calls = [];
[$s, $r] = $hook($e);
check('a signed checkout.session.completed is accepted', $s === 200 && ($r['received'] ?? false) === true, json_encode($r));
$row = $subRow();
check('it records the subscription as Stripe holds it, in test mode', $row !== false && $row['status'] === 'active' && $row['plan'] === 'business' && $row['provider_ref'] === 'sub_t1' && $row['stripe_customer_id'] === 'cus_t1' && $row['stripe_mode'] === 'test' && (int) $row['price_pence'] === 29900 && $row['grace_until'] === null, json_encode($row));
check('the organisation follows the plan and is no longer in trial or read-only', $orgRow()['plan'] === 'business' && B::state($pdo, $org)['state'] === 'active');
check('the subscription was retrieved from Stripe, not trusted from the event', in_array(['GET', '/subscriptions/sub_t1', ''], $calls, true));
check('the event is in the ledger once, processed, with the organisation', ($l = $ledger($e['id'])) && $l['processed_at'] !== null && $l['org_id'] === $org && $l['mode'] === 'test' && (int) $l['deliveries'] === 1);
$calls = [];
[$s, $r] = $hook($e);
check('a redelivery changes nothing and calls Stripe no more', $s === 200 && ($r['duplicate'] ?? false) === true && $calls === [] && (int) $pdo->query("SELECT COUNT(*) FROM subscriptions WHERE org_id = '$org'")->fetchColumn() === 1 && (int) $ledger($e['id'])['deliveries'] === 2);
check('now writes are allowed again', call($api, 'mark', 'POST', "/orgs/$org/shifts", array_replace($shiftBody, ['starts_at' => '2030-06-04T09:00:00Z', 'ends_at' => '2030-06-04T17:00:00Z']))[0] === 201);
$again = $evt('checkout.session.completed', ['mode' => 'subscription', 'client_reference_id' => $org, 'metadata' => ['org_id' => $org, 'plan' => 'starter'], 'subscription' => 'sub_t2', 'customer' => 'cus_t2']);
$responses['GET /subscriptions/sub_t2'] = $sub(['id' => 'sub_t2', 'customer' => 'cus_t2']);
$hook($again);
check('a second live subscription never overwrites the first; it is noted for attention', $subRow()['provider_ref'] === 'sub_t1' && str_contains((string) $ledger($again['id'])['last_error'], 'second-live-subscription') && $ledger($again['id'])['processed_at'] !== null);
foreach ([['no such organisation', ['client_reference_id' => '99999999-9999-4999-8999-999999999999', 'metadata' => ['org_id' => '99999999-9999-4999-8999-999999999999']]], ['metadata disagrees with the reference', ['metadata' => ['org_id' => $other]]], ['not a subscription session', ['mode' => 'payment']]] as [$why, $over]) {
    $x = $evt('checkout.session.completed', array_replace(['mode' => 'subscription', 'client_reference_id' => $org, 'metadata' => ['org_id' => $org], 'subscription' => 'sub_zz', 'customer' => 'cus_zz'], $over));
    $before = $subRow();
    check("checkout.session.completed ($why) is acknowledged and changes nothing", $hook($x)[0] === 200 && $subRow() == $before && $ledger($x['id'])['processed_at'] !== null);
}

// ---- subscription lifecycle ------------------------------------------------------------------------------------------------------------
$upd = static fn (string $status, array $extra = []): array => $GLOBALS['evt']('customer.subscription.updated', ['id' => 'sub_t1', 'status' => 'active'] + $extra);
$responses['GET /subscriptions/sub_t1'] = $sub(['status' => 'past_due']);
$hook($upd('past_due'));
$row = $subRow();
$graceDays = (int) ((strtotime($row['grace_until'] . ' UTC') - strtotime($row['past_due_since'] . ' UTC')) / 86400);
check('past_due starts a 14-day grace window and the organisation is in grace, still writable', $row['status'] === 'past_due' && $graceDays === 14 && B::state($pdo, $org)['state'] === 'grace', json_encode([$row, B::state($pdo, $org)]));
$graceBefore = $row['grace_until'];
$pdo->exec("UPDATE subscriptions SET past_due_since = DATE_SUB(past_due_since, INTERVAL 5 DAY), grace_until = DATE_SUB(grace_until, INTERVAL 5 DAY) WHERE org_id = '$org'");
$graceBefore = $subRow()['grace_until'];
$hook($upd('past_due'));
check('a further failure does not extend the window', $subRow()['grace_until'] === $graceBefore);
$pdo->exec("UPDATE subscriptions SET grace_until = DATE_SUB(UTC_TIMESTAMP(), INTERVAL 1 HOUR) WHERE org_id = '$org'");
$pdo->exec("UPDATE organisations SET trial_ends_at = DATE_SUB(UTC_TIMESTAMP(), INTERVAL 1 DAY) WHERE id = '$org'"); // the organisation's own trial is over too, or it would still be writable
[$s402] = call($api, 'mark', 'POST', "/orgs/$org/shifts", $shiftBody);
check('once the window has passed the organisation is read-only', B::state($pdo, $org)['state'] === 'read_only' && $s402 === 402, B::state($pdo, $org)['state'] . " $s402");
$responses['GET /subscriptions/sub_t1'] = $sub();
$hook($upd('active'));
$row = $subRow();
check('paying again clears the window', $row['status'] === 'active' && $row['grace_until'] === null && $row['past_due_since'] === null && B::state($pdo, $org)['state'] === 'active');
$responses['GET /subscriptions/sub_t1'] = $sub(['status' => 'canceled', 'canceled_at' => time() - 10]);
$hook($upd('active')); // the event's own payload claims active; Stripe now says cancelled
check('events arrive out of order, so the state is the one retrieved from Stripe, not the event payload', $subRow()['status'] === 'canceled' && $subRow()['canceled_at'] !== null);
$responses['GET /subscriptions/sub_t1'] = $sub(['status' => 'active', 'items' => ['data' => [['price' => ['id' => 'price_test_professional', 'unit_amount' => 12900]]]]]);
$hook($upd('active'));
check('a plan change in the portal is followed through the price', $subRow()['plan'] === 'professional' && $orgRow()['plan'] === 'professional' && (int) $subRow()['price_pence'] === 12900);
$before = $subRow();
$x = $evt('customer.subscription.updated', ['id' => 'sub_other', 'status' => 'canceled']);
$calls = [];
check('a subscription that is not ours changes nothing and is not even retrieved', $hook($x)[0] === 200 && $subRow() == $before && $calls === [] && $ledger($x['id'])['last_error'] === 'not-ours');
$pdo->exec("UPDATE subscriptions SET stripe_mode = 'live' WHERE org_id = '$org'");
$x = $evt('customer.subscription.updated', ['id' => 'sub_t1', 'status' => 'canceled']);
check('a test-mode event never touches a row created in live mode', $hook($x)[0] === 200 && $subRow()['stripe_mode'] === 'live' && $subRow()['status'] !== 'canceled' && $ledger($x['id'])['last_error'] === 'not-ours');
$pdo->exec("UPDATE subscriptions SET stripe_mode = 'test' WHERE org_id = '$org'");

$x = $evt('customer.subscription.deleted', ['id' => 'sub_t1', 'status' => 'canceled', 'canceled_at' => time(), 'cancellation_details' => ['reason' => 'cancellation_requested']]);
$hook($x);
check('a cancellation the customer asked for ends the subscription and does not suspend', $subRow()['status'] === 'canceled' && $orgRow()['status'] === 'active');
$pdo->exec("UPDATE subscriptions SET status = 'active', canceled_at = NULL WHERE org_id = '$org'");
$x = $evt('customer.subscription.deleted', ['id' => 'sub_t1', 'status' => 'canceled', 'canceled_at' => time(), 'cancellation_details' => ['reason' => 'payment_failed']]);
$hook($x);
check('Stripe cancelling for non-payment suspends the organisation, with the reason and an audit row', $orgRow()['status'] === 'suspended' && str_contains((string) $orgRow()['suspended_reason'], 'payment') && (int) $pdo->query("SELECT COUNT(*) FROM audit_logs WHERE org_id = '$org' AND action = 'billing.org_suspended'")->fetchColumn() === 1);
check('a suspended organisation cannot write', call($api, 'olga', 'POST', "/orgs/$org/locations", ['name' => 'No'])[1]['error']['code'] === 'org_not_active');
$pdo->exec("UPDATE organisations SET status = 'active', suspended_reason = NULL WHERE id = '$org'");
$x = $evt('customer.subscription.deleted', ['id' => 'sub_elsewhere', 'status' => 'canceled', 'cancellation_details' => ['reason' => 'payment_failed']]);
check('a payment_failed cancellation of a subscription we do not hold suspends nobody', $hook($x)[0] === 200 && $orgRow()['status'] === 'active');

$pdo->exec("UPDATE subscriptions SET status = 'trialing', canceled_at = NULL WHERE org_id = '$org'");
$x = $evt('customer.subscription.trial_will_end', ['id' => 'sub_t1', 'trial_end' => time() + 3 * 86400]);
$hook($x);
$notice = $pdo->query("SELECT payload, dedupe_key FROM notification_outbox WHERE event_name = 'billing/trial_will_end'")->fetchAll();
check('three days before the trial ends the owner is told, once', count($notice) === 1 && str_contains($notice[0]['payload'], 'Your trial ends in 3 days') && str_contains($notice[0]['payload'], ($pdo->query("SELECT id FROM users WHERE email = 'olga@example.test'")->fetchColumn())));
$hook($evt('customer.subscription.trial_will_end', ['id' => 'sub_t1', 'trial_end' => $x['data']['object']['trial_end']]));
check('a second event for the same trial queues no second notice', (int) $pdo->query("SELECT COUNT(*) FROM notification_outbox WHERE event_name = 'billing/trial_will_end'")->fetchColumn() === 1);
$pdo->exec("UPDATE subscriptions SET status = 'active' WHERE org_id = '$org'");

// ---- invoices --------------------------------------------------------------------------------------------------------------------------
$f = $evt('invoice.finalized', $inv());
$hook($f);
$i = $pdo->query("SELECT * FROM invoices WHERE provider_ref = 'in_t1'")->fetch();
check('a finalised invoice for our subscription is recorded open, with Stripe\'s links, in pence', $i !== false && $i['status'] === 'open' && (int) $i['amount_pence'] === 29900 && (int) $i['tax_pence'] === 4983 && $i['currency'] === 'GBP' && $i['number'] === 'ABC-0001' && str_starts_with((string) $i['hosted_invoice_url'], 'https://invoice.stripe.com/') && $i['org_id'] === $org, json_encode($i));
$hook($evt('invoice.finalized', $inv(['hosted_invoice_url' => 'https://evil.example/x'])));
check('finalised twice is still one invoice, and a link that is not Stripe\'s does not replace the stored one', (int) $pdo->query("SELECT COUNT(*) FROM invoices WHERE provider_ref = 'in_t1'")->fetchColumn() === 1 && str_starts_with((string) $pdo->query("SELECT hosted_invoice_url FROM invoices WHERE provider_ref = 'in_t1'")->fetchColumn(), 'https://invoice.stripe.com/'));
$x = $evt('invoice.finalized', $inv(['id' => 'in_foreign', 'subscription' => 'sub_not_ours']));
check('an invoice for a subscription we do not hold is not recorded', $hook($x)[0] === 200 && (int) $pdo->query("SELECT COUNT(*) FROM invoices WHERE provider_ref = 'in_foreign'")->fetchColumn() === 0);
check('a draft is not recorded', $hook($evt('invoice.finalized', $inv(['id' => 'in_draft', 'status' => 'draft'])))[0] === 200 && (int) $pdo->query("SELECT COUNT(*) FROM invoices WHERE provider_ref = 'in_draft'")->fetchColumn() === 0);

$failed = $evt('invoice.payment_failed', $inv(['id' => 'in_t2', 'number' => 'ABC-0002', 'attempt_count' => 1]));
$hook($failed);
$i2 = $pdo->query("SELECT * FROM invoices WHERE provider_ref = 'in_t2'")->fetch();
check('a failed payment records the invoice past due with the attempt count', $i2 !== false && $i2['status'] === 'past_due' && (int) $i2['attempts'] === 1 && $i2['failure_reason'] !== null);
check('and tells the owner once', (int) $pdo->query("SELECT COUNT(*) FROM notification_outbox WHERE event_name = 'billing/payment_failed'")->fetchColumn() === 1);
$hook($evt('invoice.payment_failed', $inv(['id' => 'in_t2', 'attempt_count' => 1])));
check('the same failure delivered again is not another attempt or another notice', (int) $pdo->query("SELECT attempts FROM invoices WHERE provider_ref = 'in_t2'")->fetchColumn() === 1 && (int) $pdo->query("SELECT COUNT(*) FROM notification_outbox WHERE event_name = 'billing/payment_failed'")->fetchColumn() === 1);
$hook($evt('invoice.payment_failed', $inv(['id' => 'in_t2', 'attempt_count' => 2])));
check('a further failure raises the count', (int) $pdo->query("SELECT attempts FROM invoices WHERE provider_ref = 'in_t2'")->fetchColumn() === 2);
$hook($evt('invoice.paid', $inv(['id' => 'in_t2', 'status' => 'paid', 'status_transitions' => ['paid_at' => time()]])));
$i2 = $pdo->query("SELECT * FROM invoices WHERE provider_ref = 'in_t2'")->fetch();
check('paying settles it and clears the failure', $i2['status'] === 'paid' && $i2['paid_at'] !== null && $i2['failure_reason'] === null);
$hook($evt('invoice.payment_failed', $inv(['id' => 'in_t2', 'attempt_count' => 3])));
check('a late failure event never regresses a paid invoice', $pdo->query("SELECT status FROM invoices WHERE provider_ref = 'in_t2'")->fetchColumn() === 'paid');
$hook($evt('invoice.paid', $inv(['id' => 'in_t3', 'number' => null, 'status' => 'paid', 'status_transitions' => ['paid_at' => time()]])));
check('a paid invoice we never saw open is recorded paid, with a number made from its id', $pdo->query("SELECT CONCAT(status, ':', number) FROM invoices WHERE provider_ref = 'in_t3'")->fetchColumn() === 'paid:stripe-in_t3');

$orphan = $evt('invoice.paid', $inv(['id' => 'in_o', 'subscription' => 'sub_later', 'status' => 'paid']));
[$s] = $hook($orphan);
check('an invoice that outruns its checkout is answered 500 so Stripe retries, and the event stays unprocessed', $s === 500 && $ledger($orphan['id'])['processed_at'] === null && $ledger($orphan['id'])['last_error'] !== null);
$old = $evt('invoice.paid', $inv(['id' => 'in_old', 'subscription' => 'sub_never', 'status' => 'paid']), ['created' => time() - 7200]);
check('one that is two hours old is taken to be someone else\'s and noted', $hook($old)[0] === 200 && $ledger($old['id'])['last_error'] === 'subscription-not-held');

$responses['GET /subscriptions/sub_t1'] = static fn (): array => [500, '{"error":{"code":"api_error","message":"boom whsec_unit ' . $leakyKey . '"}}'];
$x = $evt('customer.subscription.updated', ['id' => 'sub_t1', 'status' => 'active']);
[$s] = $hook($x);
check('when Stripe cannot be reached the event is answered 500 and left to be retried', $s === 500 && $ledger($x['id'])['processed_at'] === null);
check('the ledger keeps the failure without any key or secret in it', ($le = (string) $ledger($x['id'])['last_error']) !== '' && !str_contains($le, 'sk_test_') && !str_contains($le, 'whsec_'), $le);
$responses['GET /subscriptions/sub_t1'] = $sub();
check('and the redelivery then succeeds', $hook($x)[0] === 200 && $ledger($x['id'])['processed_at'] !== null && $ledger($x['id'])['last_error'] === null);
$unhandled = $evt('customer.created', ['id' => 'cus_x']);
check('an event type we do not handle is acknowledged and noted', $hook($unhandled)[0] === 200 && $ledger($unhandled['id'])['last_error'] === 'unhandled-type');
check('the same event id in the other mode is a separate event', (function () use ($pdo): bool { $n = (int) $pdo->query("SELECT COUNT(*) FROM billing_events")->fetchColumn(); $pdo->prepare("INSERT INTO billing_events (id, mode, event_id, event_type) VALUES (?, 'live', 'evt_samedeal', 'x'), (?, 'test', 'evt_samedeal', 'x')")->execute([Db::uuid(), Db::uuid()]); return (int) $pdo->query("SELECT COUNT(*) FROM billing_events")->fetchColumn() === $n + 2; })());
check('and within one mode a repeat is refused by the database itself', (function () use ($pdo): bool { try { $pdo->prepare("INSERT INTO billing_events (id, mode, event_id, event_type) VALUES (?, 'test', 'evt_samedeal', 'x')")->execute([Db::uuid()]); return false; } catch (PDOException) { return true; } })());

// ---- the owner's account, portal and links ---------------------------------------------------------------------------------------------------
[$s, $r] = call($api, 'olga', 'GET', "/orgs/$org/billing");
check('the owner sees the state and the invoices, and the account has no Stripe ids or keys in it', $s === 200 && $r['billing']['state'] === 'active' && count($r['invoices']) === 3 && !str_contains(json_encode($r), 'cus_t1') && !str_contains(json_encode($r), 'sk_test') && !str_contains(json_encode($r), 'sub_t1'), json_encode($r));
$responses['POST /billing_portal/sessions'] = ['url' => 'https://billing.stripe.com/p/session/test_1'];
check('portal: owner only, a stranger gets 404', call($api, 'mark', 'POST', "/orgs/$org/billing/portal")[0] === 403 && call($api, 'zed', 'POST', "/orgs/$org/billing/portal")[0] === 404);
$calls = [];
[$s, $r] = call($api, 'olga', 'POST', "/orgs/$org/billing/portal");
parse_str($calls[0][2] ?? '', $pb);
check('the portal opens for the organisation\'s own customer and returns to the app', $s === 200 && str_starts_with($r['url'], 'https://billing.stripe.com/') && ($pb['customer'] ?? '') === 'cus_t1' && ($pb['return_url'] ?? '') === 'https://rotaflow.example.test/app/settings/billing', json_encode([$s, $r, $pb]));
check('an organisation with no billing account gets 404 from the portal', call($api, 'zed', 'POST', "/orgs/$other/billing/portal")[0] === 404);
$pdo->exec("UPDATE subscriptions SET stripe_mode = 'live' WHERE org_id = '$org'");
$calls = [];
check('a customer created in the other mode is never sent to the portal', call($api, 'olga', 'POST', "/orgs/$org/billing/portal")[0] === 409 && $calls === []);
$pdo->exec("UPDATE subscriptions SET stripe_mode = 'test' WHERE org_id = '$org'");

$responses['POST /customers/cus_t1'] = ['id' => 'cus_t1'];
check('syncing the billing contact needs an address first', call($api, 'olga', 'POST', "/orgs/$org/billing/sync-contact")[1]['error']['code'] === 'no_contact_email');
$pdo->exec("UPDATE organisations SET contact_email = 'accounts@bill.example' WHERE id = '$org'");
$calls = [];
[$s, $r] = call($api, 'olga', 'POST', "/orgs/$org/billing/sync-contact");
parse_str($calls[0][2] ?? '', $cb);
check('it writes that address to the Stripe customer', $s === 200 && $r['email'] === 'accounts@bill.example' && ($cb['email'] ?? '') === 'accounts@bill.example');
$pdo->exec("UPDATE organisations SET contact_email = 'not an address' WHERE id = '$org'");
check('an unusable address is refused, not sent', call($api, 'olga', 'POST', "/orgs/$org/billing/sync-contact")[0] === 422);

$invId = $pdo->query("SELECT id FROM invoices WHERE provider_ref = 'in_t1'")->fetchColumn();
$responses['GET /invoices/in_t1'] = ['id' => 'in_t1', 'hosted_invoice_url' => 'https://invoice.stripe.com/i/fresh', 'invoice_pdf' => 'https://evil.example/pdf'];
[$s, $r] = call($api, 'olga', 'POST', "/orgs/$org/billing/invoices/$invId/links");
check('fresh invoice links come from Stripe, and only Stripe\'s own are returned', $s === 200 && $r['hosted_invoice_url'] === 'https://invoice.stripe.com/i/fresh' && $r['invoice_pdf'] === null, json_encode($r));
check('an invoice of another organisation is 404, even by its real id', call($api, 'zed', 'POST', "/orgs/$other/billing/invoices/$invId/links")[0] === 404 && call($api, 'zed', 'POST', "/orgs/$org/billing/invoices/$invId/links")[0] === 404);
check('a manager cannot fetch invoice links', call($api, 'mark', 'POST', "/orgs/$org/billing/invoices/$invId/links")[0] === 403);

// ---- plan limits -----------------------------------------------------------------------------------------------------------------------------
$pdo->exec("UPDATE plans SET seat_limit = 3, location_limit = 2 WHERE code = 'starter'");
$pdo->exec("UPDATE subscriptions SET plan = 'starter' WHERE org_id = '$org'");
$pdo->exec("UPDATE organisations SET plan = 'starter' WHERE id = '$org'");
$active = (int) $pdo->query("SELECT COUNT(*) FROM staff_profiles WHERE org_id = '$org' AND active = 1")->fetchColumn();
for ($n = $active; $n < 3; $n++) { check('staff up to the seat limit can be added', call($api, 'olga', 'POST', "/orgs/$org/staff", ['first_name' => "S$n"])[0] === 201); }
[$s, $r] = call($api, 'olga', 'POST', "/orgs/$org/staff", ['first_name' => 'OneTooMany']);
check('the staff member over the limit is refused with 402 seat_limit, and not created', $s === 402 && $r['error']['code'] === 'seat_limit' && (int) $pdo->query("SELECT COUNT(*) FROM staff_profiles WHERE first_name = 'OneTooMany'")->fetchColumn() === 0, json_encode($r));
check('an inactive person does not take a seat', call($api, 'olga', 'POST', "/orgs/$org/staff", ['first_name' => 'Leaver', 'active' => false])[0] === 201);
$leaver = $pdo->query("SELECT id FROM staff_profiles WHERE first_name = 'Leaver'")->fetchColumn();
[$s, $r] = call($api, 'olga', 'POST', "/orgs/$org/staff/$leaver", ['active' => true]);
check('reactivating over the limit is refused too', $s === 402 && $r['error']['code'] === 'seat_limit', json_encode($r));
$other1 = $pdo->query("SELECT id FROM staff_profiles WHERE first_name = 'S2'")->fetchColumn();
call($api, 'olga', 'POST', "/orgs/$org/staff/$other1", ['active' => false]);
[$s, $r] = call($api, 'olga', 'POST', "/orgs/$org/staff/$leaver", ['active' => true]);
check('after someone leaves the seat is free again', $s === 200, "$s " . json_encode($r));
check('other organisations are counted separately', call($api, 'zed', 'POST', "/orgs/$other/staff", ['first_name' => 'Zoe'])[0] === 201);
call($api, 'olga', 'POST', "/orgs/$org/locations", ['name' => 'Second']);
[$s, $r] = call($api, 'olga', 'POST', "/orgs/$org/locations", ['name' => 'Third']);
check('locations are limited the same way', $s === 402 && $r['error']['code'] === 'location_limit', json_encode($r));
$pdo->exec("UPDATE plans SET seat_limit = NULL, location_limit = NULL WHERE code = 'starter'");
check('a plan with no limit adds no limit', call($api, 'olga', 'POST', "/orgs/$org/locations", ['name' => 'Third'])[0] === 201);
check('features follow the plan', B::hasFeature($pdo, $org, 'advanced_reporting') === false && ($pdo->exec("UPDATE organisations SET plan = 'business' WHERE id = '$org'") !== false) && B::hasFeature($pdo, $org, 'ai_rota_assistant') === true && B::hasFeature($pdo, $org, 'not_a_feature') === false);
$threw = false;
try { B::requireSeat($pdo, $org); } catch (LogicException) { $threw = true; }
check('a limit check outside a transaction is refused, because without the lock two requests could both take the last seat', $threw);

// ---- scheduling a state at the edges ----------------------------------------------------------------------------------------------------------------
$edge = static fn (array $r, int $t): string => B::stateOf($r + ['sub_status' => null, 'sub_trial_ends_at' => null, 'grace_until' => null, 'trial_ends_at' => null], $t);
check('state at the edges', $edge(['sub_status' => 'trialing', 'sub_trial_ends_at' => gmdate('Y-m-d H:i:s', $now + 5)], $now) === 'trialing' && $edge(['sub_status' => 'trialing', 'sub_trial_ends_at' => gmdate('Y-m-d H:i:s', $now - 5)], $now) === 'read_only' && $edge(['sub_status' => 'trialing', 'sub_trial_ends_at' => null], $now) === 'trialing'
    && $edge(['sub_status' => 'past_due', 'grace_until' => gmdate('Y-m-d H:i:s', $now)], $now) === 'read_only' && $edge(['sub_status' => 'canceled', 'trial_ends_at' => gmdate('Y-m-d H:i:s', $now + 60)], $now) === 'trial' && $edge(['sub_status' => 'canceled'], $now) === 'read_only');

// ---- the free trial running out ------------------------------------------------------------------------------------------------------------------
$fresh = call($api, 'tina', 'POST', '/orgs', ['name' => 'Trial Org'])[1]['org']['id'];
$trialAlerts = static fn (): int => (int) $GLOBALS['pdo']->query("SELECT COUNT(*) FROM notification_outbox WHERE event_name = 'billing/trial_ending'")->fetchColumn();
RotaFlow\Mod\Notifications::scheduledAlerts($ctx);
check('a trial with 30 days left sends no reminder', $trialAlerts() === 0);
$pdo->exec("UPDATE organisations SET trial_ends_at = DATE_ADD(UTC_TIMESTAMP(), INTERVAL 2 DAY) WHERE id = '$fresh'");
RotaFlow\Mod\Notifications::scheduledAlerts($ctx);
check('within three days the owner is told once', $trialAlerts() === 1 && str_contains((string) $pdo->query("SELECT payload FROM notification_outbox WHERE event_name = 'billing/trial_ending'")->fetchColumn(), 'Your free trial ends on'));
RotaFlow\Mod\Notifications::scheduledAlerts($ctx);
check('and not again on the next run', $trialAlerts() === 1);
$pdo->exec("UPDATE organisations SET trial_ends_at = DATE_ADD(UTC_TIMESTAMP(), INTERVAL 1 DAY) WHERE id = '$fresh'");
RotaFlow\Mod\Notifications::scheduledAlerts($ctx);
check('an extended or moved trial end is a new fact and is told again', $trialAlerts() === 2);
$pdo->exec("UPDATE organisations SET trial_ends_at = DATE_ADD(UTC_TIMESTAMP(), INTERVAL 2 DAY) WHERE id = '$org'");
RotaFlow\Mod\Notifications::scheduledAlerts($ctx);
check('an organisation already paying is not chased', $trialAlerts() === 2);
