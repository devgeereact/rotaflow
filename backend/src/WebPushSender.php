<?php
declare(strict_types=1);

namespace RotaFlow;

/**
 * Web Push with no library: RFC 8291 message encryption (aes128gcm) and RFC 8292 VAPID, using only OpenSSL and cURL. Written this way
 * because the host's PHP has shipped without the extensions the usual packages need, and because it is small and checkable against the
 * RFC's own test vector (tests/suites/130-webpush.php).
 *
 * Config (private): vapid.public (base64url uncompressed P-256 point, the same value as VITE_VAPID_PUBLIC_KEY), vapid.private (base64url
 * 32-byte scalar) and vapid.subject (mailto: or https: contact). Without all three, push is reported as not configured.
 */
final class WebPushSender implements Pusher
{
    private const P256_SPKI_PREFIX = '3059301306072a8648ce3d020106082a8648ce3d030107034200';
    private const P256_PRIV_PREFIX = '30770201010420';
    private const P256_PRIV_SUFFIX = 'a00a06082a8648ce3d030107a144034200';

    /** @param callable(string,array<string,string>,string):int|null $transport (url, headers, body) -> HTTP status; injected for tests */
    public function __construct(private readonly string $vapidPublic, private readonly string $vapidPrivate, private readonly string $subject, private $transport = null) {}

    public static function fromConfig(Ctx $ctx): Pusher
    {
        $v = $ctx->config['vapid'] ?? null;
        if (!is_array($v) || empty($v['public']) || empty($v['private']) || empty($v['subject'])) {
            return new NullPusher();
        }
        return new self((string) $v['public'], (string) $v['private'], (string) $v['subject']);
    }

    public function send(array $subscription, array $payload): string
    {
        try {
            $endpoint = $subscription['endpoint'];
            if (preg_match('#^https://[^/\s]+#', $endpoint, $m) !== 1) {
                return 'failed';
            }
            $body = self::encrypt(
                json_encode(['title' => $payload['title'], 'body' => $payload['body'] ?? null], JSON_UNESCAPED_UNICODE),
                self::b64d($subscription['p256dh']),
                self::b64d($subscription['auth_key'])
            );
            $headers = [
                'Content-Encoding' => 'aes128gcm',
                'Content-Type' => 'application/octet-stream',
                'TTL' => '86400',
                'Urgency' => 'normal',
                'Authorization' => 'vapid t=' . $this->jwt($m[0]) . ', k=' . $this->vapidPublic,
            ];
            $status = ($this->transport ?? self::curl(...))($endpoint, $headers, $body);
            return match (true) {
                $status >= 200 && $status < 300 => 'sent',
                $status === 404 || $status === 410 => 'expired',
                default => 'failed',
            };
        } catch (\Throwable) {
            return 'failed';
        }
    }

    /**
     * RFC 8291 section 3-4. Returns the full request body: salt, record size, key id (our public key), then the encrypted record.
     * $salt and $ephemeralPem exist so the RFC's test vector can be reproduced; in use both are fresh and random.
     */
    public static function encrypt(string $plaintext, string $uaPublic, string $authSecret, ?string $salt = null, ?string $ephemeralPem = null): string
    {
        if (strlen($uaPublic) !== 65 || $uaPublic[0] !== "\x04" || strlen($authSecret) !== 16 || strlen($plaintext) > 3993) {
            throw new \InvalidArgumentException('bad_subscription');
        }
        $ephemeral = $ephemeralPem !== null ? openssl_pkey_get_private($ephemeralPem) : openssl_pkey_new(['curve_name' => 'prime256v1', 'private_key_type' => OPENSSL_KEYTYPE_EC]);
        $d = openssl_pkey_get_details($ephemeral)['ec'];
        $asPublic = "\x04" . str_pad($d['x'], 32, "\0", STR_PAD_LEFT) . str_pad($d['y'], 32, "\0", STR_PAD_LEFT);
        $uaKey = openssl_pkey_get_public(self::pem('PUBLIC KEY', hex2bin(self::P256_SPKI_PREFIX) . $uaPublic));
        $shared = openssl_pkey_derive($uaKey, $ephemeral, 32);
        if ($shared === false) {
            throw new \RuntimeException('ecdh_failed');
        }
        $salt ??= random_bytes(16);
        $ikm = hash_hkdf('sha256', $shared, 32, "WebPush: info\0" . $uaPublic . $asPublic, $authSecret);
        $cek = hash_hkdf('sha256', $ikm, 16, "Content-Encoding: aes128gcm\0", $salt);
        $nonce = hash_hkdf('sha256', $ikm, 12, "Content-Encoding: nonce\0", $salt);
        $ct = openssl_encrypt($plaintext . "\x02", 'aes-128-gcm', $cek, OPENSSL_RAW_DATA, $nonce, $tag, '', 16);
        if ($ct === false) {
            throw new \RuntimeException('encrypt_failed');
        }
        return $salt . pack('N', 4096) . chr(65) . $asPublic . $ct . $tag;
    }

    /** A VAPID JWT (ES256) for the push service's origin, valid for twelve hours. */
    private function jwt(string $audience): string
    {
        $head = self::b64e('{"typ":"JWT","alg":"ES256"}');
        $claims = self::b64e(json_encode(['aud' => $audience, 'exp' => time() + 12 * 3600, 'sub' => $this->subject], JSON_UNESCAPED_SLASHES));
        $key = openssl_pkey_get_private(self::privatePem(self::b64d($this->vapidPrivate), self::b64d($this->vapidPublic)));
        if ($key === false || !openssl_sign("$head.$claims", $der, $key, OPENSSL_ALGO_SHA256)) {
            throw new \RuntimeException('sign_failed');
        }
        return "$head.$claims." . self::b64e(self::derToRaw($der));
    }

    /** ECDSA signatures come out of OpenSSL as DER (SEQUENCE of two INTEGERs); JOSE wants the two 32-byte values joined. */
    public static function derToRaw(string $der): string
    {
        $o = 2 + (ord($der[1]) & 0x80 ? (ord($der[1]) & 0x7f) : 0);
        $parts = [];
        for ($i = 0; $i < 2; $i++) {
            if ($der[$o] !== "\x02") {
                throw new \RuntimeException('bad_signature');
            }
            $len = ord($der[$o + 1]);
            $parts[] = str_pad(ltrim(substr($der, $o + 2, $len), "\0"), 32, "\0", STR_PAD_LEFT);
            $o += 2 + $len;
        }
        return $parts[0] . $parts[1];
    }

    private static function privatePem(string $d, string $publicPoint): string
    {
        return self::pem('EC PRIVATE KEY', hex2bin(self::P256_PRIV_PREFIX) . $d . hex2bin(self::P256_PRIV_SUFFIX) . $publicPoint);
    }

    private static function pem(string $label, string $der): string
    {
        return "-----BEGIN $label-----\n" . chunk_split(base64_encode($der), 64, "\n") . "-----END $label-----\n";
    }

    public static function b64e(string $s): string
    {
        return rtrim(strtr(base64_encode($s), '+/', '-_'), '=');
    }

    public static function b64d(string $s): string
    {
        $r = base64_decode(strtr($s, '-_', '+/') . str_repeat('=', (4 - strlen($s) % 4) % 4), true);
        if ($r === false) {
            throw new \InvalidArgumentException('bad_base64');
        }
        return $r;
    }

    /** @param array<string,string> $headers */
    private static function curl(string $url, array $headers, string $body): int
    {
        $ch = curl_init($url);
        curl_setopt_array($ch, [CURLOPT_POST => true, CURLOPT_POSTFIELDS => $body, CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 10, CURLOPT_CONNECTTIMEOUT => 5,
            CURLOPT_FOLLOWLOCATION => false, CURLOPT_PROTOCOLS => CURLPROTO_HTTPS, CURLOPT_SSL_VERIFYPEER => true, CURLOPT_SSL_VERIFYHOST => 2,
            CURLOPT_HTTPHEADER => array_map(static fn (string $k, string $v): string => "$k: $v", array_keys($headers), $headers)]);
        curl_exec($ch);
        $code = (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
        curl_close($ch);
        return $code;
    }
}
