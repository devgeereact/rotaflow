<?php
declare(strict_types=1);

// The API shell: health, sign-in gate, routing, error shape, limits.
use RotaFlow\{Api, Ctx, HttpError, Module, RateLimiter};

$mod = new class implements Module {
    public function routes(): array
    {
        return [
            ['GET', '/orgs/{o}/ping', static fn ($p, array $in, string $ip, string $o): array => [200, ['org' => $o, 'who' => $p['sub']]]],
            ['POST', '/echo', static fn ($p, array $in): array => [200, ['got' => $in]]],
            ['GET', '/open', static fn ($p): array => [200, ['signed_in' => $p !== null]], 'public'],
        ];
    }
};
$api = test_api($pdo, [$mod]);
$org = '11111111-1111-4111-8111-111111111111';

[$s, $r] = call($api, '', 'GET', '/health');
check('health answers without sign-in', $s === 200 && $r === ['ok' => true]);
[$s, $r] = call($api, '', 'GET', "/orgs/$org/ping");
check('a protected route without a token is 401 in the standard error shape', $s === 401 && $r['error']['code'] === 'unauthorized' && is_string($r['error']['message']), json_encode($r));
[$s, $r] = call($api, 'ann', 'GET', "/orgs/$org/ping");
check('a protected route with a token reaches the handler with the placeholder', $s === 200 && $r === ['org' => $org, 'who' => 'user_ann'], json_encode($r));
[$s, $r] = call($api, 'ann', 'GET', '/orgs/not-a-uuid/ping');
check('a non-UUID placeholder is a 404, not a handler call', $s === 404 && $r['error']['code'] === 'not_found');
[$s, $r] = call($api, 'ann', 'GET', '/nowhere');
check('an unknown route is 404 once signed in', $s === 404);
[$s, $r] = call($api, '', 'GET', '/nowhere');
check('an unknown route is 401 when anonymous, so routes cannot be probed', $s === 401);
[$s, $r] = $api->handle('GET', "/orgs/$org/ping", ['authorization' => 'Bearer not valid!'], '', '203.0.113.1');
check('a malformed Authorization header is 401', $s === 401);
[$s, $r] = $api->handle('GET', "/orgs/$org/ping", ['authorization' => 'Bearer bad-token'], '', '203.0.113.1');
check('a token the verifier rejects is 401', $s === 401);
[$s, $r] = call($api, '', 'GET', '/open');
check('a public route needs no sign-in', $s === 200 && $r === ['signed_in' => false]);
[$s, $r] = call($api, 'ann', 'POST', '/echo', ['a' => 1]);
check('a JSON body reaches the handler', $s === 200 && $r === ['got' => ['a' => 1]]);
[$s, $r] = $api->handle('POST', '/echo', ['authorization' => 'Bearer tok-ann'], '[1,2', '203.0.113.1');
check('invalid JSON is 422 invalid_input', $s === 422 && $r['error']['code'] === 'invalid_input');
[$s, $r] = $api->handle('POST', '/echo', ['authorization' => 'Bearer tok-ann'], str_repeat('x', 300000), '203.0.113.1');
check('an oversized body is 413', $s === 413 && $r['error']['code'] === 'too_large');
[$s, $r] = call($api, 'ann', 'POST', "/orgs/$org/ping");
check('the wrong method on a known path is 404', $s === 404);

// Rate limiter, with an injected clock.
$rl = new RateLimiter($pdo, 1_800_000_000);
$rl->hit('t', 'a', 2, 60);
$rl->hit('t', 'a', 2, 60);
expectError('the third hit in a window is 429', fn () => $rl->hit('t', 'a', 2, 60), 429, 'rate_limited');
$rl->hit('t', 'b', 2, 60);
check('another subject has its own bucket', true);
$later = new RateLimiter($pdo, 1_800_000_000 + 61);
$later->hit('t', 'a', 2, 60);
check('a new window resets the count', true);

// Ctx never throws when no logger is set; log is category-only by convention.
$ctx = new Ctx($pdo, $rl);
$ctx->log('noop');
check('Ctx logging without a logger is a no-op', true);
check('the error body helper nests code and message', HttpError::body('x', 'y') === ['error' => ['code' => 'x', 'message' => 'y']]);

// The headers a handler can see come from Bootstrap::requestHeaders, the function index.php calls. The enquiry
// form's Content-Type and Origin checks were dead in production because this list once lacked them (audit C-01).
$h = RotaFlow\Bootstrap::requestHeaders([
    'CONTENT_TYPE' => 'application/json', 'HTTP_ORIGIN' => 'https://rotaflow.space', 'HTTP_USER_AGENT' => 'UA/1',
    'REDIRECT_HTTP_AUTHORIZATION' => 'Bearer abc', 'HTTP_STRIPE_SIGNATURE' => 't=1,v1=x', 'HTTP_COOKIE' => 'secret=1',
]);
check('request headers include content-type, origin and user-agent for handlers', ($h['content-type'] ?? '') === 'application/json' && ($h['origin'] ?? '') === 'https://rotaflow.space' && ($h['user-agent'] ?? '') === 'UA/1', json_encode($h));
check('request headers keep the cPanel authorization fallback and the Stripe signature', ($h['authorization'] ?? '') === 'Bearer abc' && ($h['stripe-signature'] ?? '') === 't=1,v1=x');
check('request headers pass nothing that is not listed (no cookies)', !isset($h['cookie']) && count($h) === 5, json_encode(array_keys($h)));

