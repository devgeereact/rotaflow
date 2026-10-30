<?php
declare(strict_types=1);

// Clerk token verification. Includes the SiteRelay cases plus the four fixes made on the way in.
use RotaFlow\{Bootstrap, HttpError, Jwt};

$b64 = static fn (string $s): string => rtrim(strtr(base64_encode($s), '+/', '-_'), '=');
$newKey = static fn (int $bits = 2048) => openssl_pkey_new(['private_key_bits' => $bits, 'private_key_type' => OPENSSL_KEYTYPE_RSA]);
$jwkOf = static function ($key, string $kid = 'k1', array $extra = []) use ($b64): array {
    $d = openssl_pkey_get_details($key);
    return array_replace(['kty' => 'RSA', 'kid' => $kid, 'alg' => 'RS256', 'use' => 'sig', 'n' => $b64($d['rsa']['n']), 'e' => $b64($d['rsa']['e'])], $extra);
};
$key = $newKey();
$jwk = $jwkOf($key);
$iss = 'https://clerk.example.test';
$azp = 'https://rotaflow.example.test';
$now = 1_800_000_000;
$mint = static function (array $claims, array $hdr = [], $signWith = null) use ($key, $b64): string {
    $header = $b64(json_encode($hdr + ['alg' => 'RS256', 'typ' => 'JWT', 'kid' => 'k1']));
    $payload = $b64(json_encode($claims));
    openssl_sign("$header.$payload", $sig, $signWith ?? $key, OPENSSL_ALGO_SHA256);
    return "$header.$payload." . $b64($sig);
};
$good = ['iss' => $iss, 'sub' => 'user_1', 'azp' => $azp, 'exp' => $now + 60, 'nbf' => $now - 10, 'sid' => 'sess_1'];
$cache = test_private_root() . '/cache';
$fetches = 0;
$fetch = static function (string $url) use ($jwk, &$fetches, $iss): string {
    $fetches++;
    if ($url !== $iss . '/.well-known/jwks.json') {
        throw new RuntimeException('unexpected url');
    }
    return json_encode(['keys' => [$jwk]]);
};
$v = new Jwt($iss, [$azp], $cache, $fetch, $now);

check('valid token verifies', ($v->verify($mint($good))['sub'] ?? '') === 'user_1');
$v->verify($mint($good));
check('JWKS is cached (one fetch for two verifications)', $fetches === 1);
expectError('expired token rejected', fn () => $v->verify($mint(['exp' => $now - 60] + $good)), 401);
expectError('not-yet-valid token rejected', fn () => $v->verify($mint(['nbf' => $now + 600] + $good)), 401);
expectError('wrong issuer rejected', fn () => $v->verify($mint(['iss' => 'https://evil.example'] + $good)), 401);
expectError('wrong authorised party rejected', fn () => $v->verify($mint(['azp' => 'https://evil.example'] + $good)), 401);
$noAzp = $good; unset($noAzp['azp']);
expectError('missing azp rejected', fn () => $v->verify($mint($noAzp)), 401);
$noSub = $good; unset($noSub['sub']);
expectError('missing subject rejected', fn () => $v->verify($mint($noSub)), 401);
expectError('token signed by a different key rejected', fn () => $v->verify($mint($good, [], $newKey())), 401);
$tampered = explode('.', $mint($good));
$tampered[1] = $b64(json_encode(['sub' => 'user_admin'] + $good));
expectError('tampered payload rejected', fn () => $v->verify(implode('.', $tampered)), 401);
$none = $b64('{"alg":"none","typ":"JWT","kid":"k1"}') . '.' . $b64(json_encode($good)) . '.';
expectError('alg=none rejected', fn () => $v->verify($none), 401);
$hs = $b64('{"alg":"HS256","typ":"JWT","kid":"k1"}') . '.' . $b64(json_encode($good)) . '.' . $b64(hash_hmac('sha256', 'x', 'secret', true));
expectError('HS256 (key confusion) rejected', fn () => $v->verify($hs), 401);
expectError('unknown kid rejected', fn () => $v->verify($mint($good, ['kid' => 'zzz'])), 401);
expectError('garbage rejected', fn () => $v->verify('a.b.c'), 401);
expectError('oversized token rejected', fn () => $v->verify(str_repeat('a', 9000)), 401);

// Fix J4: a pending Clerk session must not authenticate.
expectError('pending session (sts=pending) rejected', fn () => $v->verify($mint(['sts' => 'pending'] + $good)), 401);
check('active session (sts=active) accepted', ($v->verify($mint(['sts' => 'active'] + $good))['sts'] ?? '') === 'active');

// Fix J7: weak or mislabelled keys are ignored.
$weak = $newKey(1024);
$weakJwk = $jwkOf($weak, 'weak');
check('a 1024-bit key never becomes a PEM', Jwt::jwkToPem($weakJwk) === null);
$fresh = static function (string $n): string { $d = test_private_root() . '/' . $n; mkdir($d, 0700); return $d; };
$vWeak = new Jwt($iss, [$azp], $fresh('cache-weak'), static fn () => json_encode(['keys' => [$weakJwk]]), $now);
$weakTok = (function () use ($weak, $b64, $good): string {
    $h = $b64(json_encode(['alg' => 'RS256', 'typ' => 'JWT', 'kid' => 'weak']));
    $p = $b64(json_encode($good));
    openssl_sign("$h.$p", $sig, $weak, OPENSSL_ALGO_SHA256);
    return "$h.$p." . $b64($sig);
})();
expectError('token signed by a 1024-bit key rejected', fn () => $vWeak->verify($weakTok), 401);
$rs384 = $jwkOf($key, 'k1', ['alg' => 'RS384']);
$vAlg = new Jwt($iss, [$azp], $fresh('cache-alg'), static fn () => json_encode(['keys' => [$rs384]]), $now);
expectError('a JWK labelled RS384 is not used for RS256', fn () => $vAlg->verify($mint($good)), 401);
$vUse = new Jwt($iss, [$azp], $fresh('cache-use'), static fn () => json_encode(['keys' => [$jwkOf($key, 'k1', ['use' => 'enc'])]]), $now);
expectError('a JWK with use=enc is not used to verify', fn () => $vUse->verify($mint($good)), 401);

// Fix J2: the cache is replaced atomically, so no half-written file and no temp files left behind.
$files = glob($cache . '/*') ?: [];
check('cache holds one JWKS file and no leftover temp files', count(array_filter($files, static fn ($f) => str_ends_with($f, '.tmp'))) === 0 && count(array_filter($files, static fn ($f) => str_contains($f, 'clerk-jwks-') && str_ends_with($f, '.json'))) === 1);

// A failed fetch backs off and serves the stale cache instead of failing every request.
$calls = 0;
$vDown = new Jwt($iss, [$azp], $cache, static function () use (&$calls): string { $calls++; throw new RuntimeException('down'); }, $now + 4000);
check('stale cache still verifies when the JWKS endpoint is down', ($vDown->verify($mint(['exp' => $now + 9000] + $good))['sub'] ?? '') === 'user_1');
$vDown->verify($mint(['exp' => $now + 9000] + $good));
check('the endpoint is not hammered while it is down', $calls === 1, "calls=$calls");

// Fix J1: no silent per-request fetch when the cache directory is unusable.
try {
    new Jwt($iss, [$azp], test_private_root() . '/does-not-exist', $fetch);
    check('missing cache dir is refused at construction', false);
} catch (RuntimeException) {
    check('missing cache dir is refused at construction', true);
}
try {
    Bootstrap::jwt(['clerk_issuer' => $iss, 'clerk_authorized_parties' => [$azp]], test_private_root() . '/nowhere');
    check('Bootstrap::jwt refuses an unusable cache dir', false);
} catch (RuntimeException) {
    check('Bootstrap::jwt refuses an unusable cache dir', true);
}
try { new Jwt('http://insecure.example', [$azp], $cache, $fetch); check('http issuer refused', false); } catch (InvalidArgumentException) { check('http issuer refused', true); }
try { new Jwt($iss . '/', [$azp], $cache, $fetch); check('issuer with trailing slash refused', false); } catch (InvalidArgumentException) { check('issuer with trailing slash refused', true); }
try { new Jwt($iss, [], $cache, $fetch); check('empty authorised-party list refused', false); } catch (InvalidArgumentException) { check('empty authorised-party list refused', true); }

$pemOk = Jwt::jwkToPem($jwk);
check('JWK -> PEM is a usable RSA key', $pemOk !== null && openssl_pkey_get_public($pemOk) !== false);
check('Cloudflare range check accepts an edge address', Bootstrap::fromCloudflare('104.16.0.1') === true);
check('Cloudflare range check rejects a non-edge address', Bootstrap::fromCloudflare('203.0.113.9') === false);
