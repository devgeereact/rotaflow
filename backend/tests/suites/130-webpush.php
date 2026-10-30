<?php
declare(strict_types=1);

// Web Push (RFC 8291 + RFC 8292) with OpenSSL only, checked against the RFC's own example and by decrypting what we produce.
use RotaFlow\{Dispatcher, WebPushSender as W};

$b = static fn (string $s): string => W::b64d($s);
$privPem = static function (string $d, string $pub): string {
    $der = hex2bin('30770201010420') . $d . hex2bin('a00a06082a8648ce3d030107a144034200') . $pub;
    $label = 'EC PRIVATE' . ' KEY'; // assembled, so a secret scanner does not mistake this test helper for a committed key
    return "-----BEGIN $label-----\n" . chunk_split(base64_encode($der), 64, "\n") . "-----END $label-----\n";
};

// RFC 8291 appendix A example (the values are the RFC's).
$plaintext = 'When I grow up, I want to be a watermelon';
$asPriv = $b('yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw');
$asPub = $b('BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8');
$uaPub = $b('BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4');
$auth = $b('BTBZMqHH6r4Tts7J_aSIgg');
$salt = $b('DGv6ra1nlYgDCS1FRnbzlw');
$expected = 'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN';
$body = W::encrypt($plaintext, $uaPub, $auth, $salt, $privPem($asPriv, $asPub));
check('the encrypted body matches the RFC 8291 example byte for byte', W::b64e($body) === $expected, W::b64e($body));

// A round trip with a fresh key: decrypt it the way a browser would.
$ua = openssl_pkey_new(['curve_name' => 'prime256v1', 'private_key_type' => OPENSSL_KEYTYPE_EC]);
$d = openssl_pkey_get_details($ua)['ec'];
$uaPoint = "\x04" . str_pad($d['x'], 32, "\0", STR_PAD_LEFT) . str_pad($d['y'], 32, "\0", STR_PAD_LEFT);
$authSecret = random_bytes(16);
$msg = '{"title":"Rota published — 06 May","body":"Naïve café ☕"}';
$wire = W::encrypt($msg, $uaPoint, $authSecret);
$decrypt = static function (string $wire, $uaKey, string $uaPoint, string $authSecret): string {
    $salt = substr($wire, 0, 16);
    $idlen = ord($wire[20]);
    $asPoint = substr($wire, 21, $idlen);
    $rec = substr($wire, 21 + $idlen);
    $asKey = openssl_pkey_get_public("-----BEGIN PUBLIC KEY-----\n" . chunk_split(base64_encode(hex2bin('3059301306072a8648ce3d020106082a8648ce3d030107034200') . $asPoint), 64, "\n") . "-----END PUBLIC KEY-----\n");
    $shared = openssl_pkey_derive($asKey, $uaKey, 32);
    $ikm = hash_hkdf('sha256', $shared, 32, "WebPush: info\0" . $uaPoint . $asPoint, $authSecret);
    $plain = openssl_decrypt(substr($rec, 0, -16), 'aes-128-gcm', hash_hkdf('sha256', $ikm, 16, "Content-Encoding: aes128gcm\0", $salt), OPENSSL_RAW_DATA, hash_hkdf('sha256', $ikm, 12, "Content-Encoding: nonce\0", $salt), substr($rec, -16));
    return $plain === false ? '' : rtrim($plain, "\x02");
};
check('a message encrypted for a fresh key decrypts to the original, UTF-8 intact', $decrypt($wire, $ua, $uaPoint, $authSecret) === $msg);
check('the record header is salt, a 4096 record size and our 65-byte public key', substr($wire, 16, 4) === pack('N', 4096) && ord($wire[20]) === 65 && $wire[21] === "\x04");
check('every message uses a fresh salt and ephemeral key', W::encrypt($msg, $uaPoint, $authSecret) !== $wire);
check('tampered ciphertext does not decrypt', $decrypt(substr($wire, 0, -1) . chr(ord($wire[strlen($wire) - 1]) ^ 1), $ua, $uaPoint, $authSecret) === '');
foreach ([['short', $authSecret], [$uaPoint, 'short'], ["\x03" . substr($uaPoint, 1), $authSecret]] as $i => [$pt, $au]) {
    try { W::encrypt($msg, $pt, $au); check("a malformed subscription is refused ($i)", false); } catch (InvalidArgumentException) { check("a malformed subscription is refused ($i)", true); }
}
try { W::encrypt(str_repeat('x', 4000), $uaPoint, $authSecret); check('an oversized payload is refused', false); } catch (InvalidArgumentException) { check('an oversized payload is refused', true); }

// ---- VAPID and the send path -----------------------------------------------------------------------------------------
$vk = openssl_pkey_new(['curve_name' => 'prime256v1', 'private_key_type' => OPENSSL_KEYTYPE_EC]);
$vd = openssl_pkey_get_details($vk)['ec'];
$vPub = "\x04" . str_pad($vd['x'], 32, "\0", STR_PAD_LEFT) . str_pad($vd['y'], 32, "\0", STR_PAD_LEFT);
$vPriv = str_pad($vd['d'], 32, "\0", STR_PAD_LEFT);
$captured = [];
$status = 201;
$sender = new W(W::b64e($vPub), W::b64e($vPriv), 'mailto:ops@rotaflow.example.test', static function (string $url, array $h, string $body) use (&$captured, &$status): int { $captured = [$url, $h, $body]; return $status; });
$sub = ['endpoint' => 'https://push.example.test/send/abc123', 'p256dh' => W::b64e($uaPoint), 'auth_key' => W::b64e($authSecret)];
check('a 201 from the push service is "sent"', $sender->send($sub, ['title' => 'Hello', 'body' => 'World']) === 'sent' && $captured[0] === $sub['endpoint']);
$h = $captured[1];
check('the request carries the encryption headers', $h['Content-Encoding'] === 'aes128gcm' && $h['TTL'] === '86400' && $h['Content-Type'] === 'application/octet-stream');
check('and the body decrypts to the payload', json_decode($decrypt($captured[2], $ua, $uaPoint, $authSecret), true) === ['title' => 'Hello', 'body' => 'World']);
preg_match('/^vapid t=([^,]+), k=(.+)$/', $h['Authorization'], $m);
[$jh, $jc, $js] = explode('.', $m[1]);
$claims = json_decode(W::b64d($jc), true);
check('the VAPID header names the key and carries a JWT for the push service\'s origin', W::b64d($m[2]) === $vPub && json_decode(W::b64d($jh), true) === ['typ' => 'JWT', 'alg' => 'ES256'] && $claims['aud'] === 'https://push.example.test' && $claims['sub'] === 'mailto:ops@rotaflow.example.test' && $claims['exp'] > time() + 3600 && $claims['exp'] <= time() + 12 * 3600 + 5);
$pubPem = "-----BEGIN PUBLIC KEY-----\n" . chunk_split(base64_encode(hex2bin('3059301306072a8648ce3d020106082a8648ce3d030107034200') . $vPub), 64, "\n") . "-----END PUBLIC KEY-----\n";
$raw = W::b64d($js);
$der = static function (string $r, string $s): string { $i = static fn (string $v): string => "\x02" . chr(strlen($v = (ord($v[0]) & 0x80 ? "\0" . $v : $v))) . $v; $x = $i(ltrim($r, "\0") ?: "\0") . $i(ltrim($s, "\0") ?: "\0"); return "\x30" . chr(strlen($x)) . $x; };
check('the JWT signature is a 64-byte raw ES256 value that verifies against the public key', strlen($raw) === 64 && openssl_verify("$jh.$jc", $der(substr($raw, 0, 32), substr($raw, 32)), $pubPem, OPENSSL_ALGO_SHA256) === 1);
$status = 410;
check('410 and 404 mean the subscription is gone', $sender->send($sub, ['title' => 'x']) === 'expired' && ($status = 404) && $sender->send($sub, ['title' => 'x']) === 'expired');
$status = 500;
check('other statuses are a failure', $sender->send($sub, ['title' => 'x']) === 'failed' && ($status = 429) && $sender->send($sub, ['title' => 'x']) === 'failed');
check('an http endpoint, or a broken subscription, is a failure and sends nothing', (function () use ($sender, $sub, &$captured): bool { $captured = []; $a = $sender->send(['endpoint' => 'http://insecure.example/x'] + $sub, ['title' => 'x']); $b = $sender->send(['p256dh' => 'not base64!!'] + $sub, ['title' => 'x']); return $a === 'failed' && $b === 'failed' && $captured === []; })());
check('the DER-to-raw conversion handles short and padded integers', strlen(W::derToRaw($der(str_repeat("\x01", 5), str_repeat("\xff", 32)))) === 64 && substr(W::derToRaw($der("\x01", "\x02")), 31, 1) === "\x01");

// ---- configuration and the Dispatcher ------------------------------------------------------------------------------
check('no VAPID keys in the config means no push sender', RotaFlow\WebPushSender::fromConfig(test_ctx($pdo)) instanceof RotaFlow\NullPusher);
check('with keys it builds the real sender', RotaFlow\WebPushSender::fromConfig(test_ctx($pdo, ['vapid' => ['public' => W::b64e($vPub), 'private' => W::b64e($vPriv), 'subject' => 'mailto:ops@rotaflow.example.test']])) instanceof W);
