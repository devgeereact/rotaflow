<?php
declare(strict_types=1);

namespace RotaFlow;

/**
 * Encrypts small secrets stored in the database (an organisation's SMTP password) with AES-256-GCM through OpenSSL, which the
 * host always has. The key is `secret_key` in the private config: 32 random bytes, base64. A database dump without that file
 * reveals nothing. Format: "v1:" + base64(iv 12 | tag 16 | ciphertext).
 */
final class Secret
{
    public static function encrypt(string $plain, string $keyB64): string
    {
        $key = self::key($keyB64);
        $iv = random_bytes(12);
        $ct = openssl_encrypt($plain, 'aes-256-gcm', $key, OPENSSL_RAW_DATA, $iv, $tag, '', 16);
        if ($ct === false) {
            throw new \RuntimeException('encrypt_failed');
        }
        return 'v1:' . base64_encode($iv . $tag . $ct);
    }

    public static function decrypt(string $stored, string $keyB64): string
    {
        $key = self::key($keyB64);
        $raw = str_starts_with($stored, 'v1:') ? base64_decode(substr($stored, 3), true) : false;
        if ($raw === false || strlen($raw) < 29) {
            throw new \RuntimeException('decrypt_failed');
        }
        $plain = openssl_decrypt(substr($raw, 28), 'aes-256-gcm', $key, OPENSSL_RAW_DATA, substr($raw, 0, 12), substr($raw, 12, 16));
        if ($plain === false) {
            throw new \RuntimeException('decrypt_failed'); // wrong key or tampered data; never return garbage
        }
        return $plain;
    }

    /**
     * The private secret_key as text, for HMAC keys (signed file links, the enquiry address salt). Refuses a missing,
     * placeholder or short key instead of falling back to a fixed, public string (security audit, 1 Nov 2026).
     */
    public static function hmacKey(array $config): string
    {
        $k = (string) ($config['secret_key'] ?? '');
        if (strlen($k) < 32 || str_contains($k, 'REPLACE_ME')) {
            throw new HttpError(503, 'unavailable', 'This service is not configured');
        }
        return $k;
    }

    private static function key(string $b64): string
    {
        $k = base64_decode($b64, true);
        if ($k === false || strlen($k) !== 32) {
            throw new \RuntimeException('secret_key_missing');
        }
        return $k;
    }
}
