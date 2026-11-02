<?php
declare(strict_types=1);

namespace RotaFlow;

/** Wiring: where the private root is, how config is read, how tokens are verified. */
final class Bootstrap
{
    /** Private root: outside every web root. ROTAFLOW_PRIVATE_ROOT, else <parent of DOCUMENT_ROOT>/rotaflow-private. */
    public static function privateRoot(): string
    {
        $env = getenv('ROTAFLOW_PRIVATE_ROOT');
        if (is_string($env) && $env !== '') {
            return rtrim($env, '/');
        }
        return dirname(rtrim((string) ($_SERVER['DOCUMENT_ROOT'] ?? ''), '/')) . '/rotaflow-private';
    }

    /** @return array<string,mixed> */
    public static function config(string $root, string $file = 'config.php'): array
    {
        $path = $root . '/config/' . $file;
        if (!is_file($path)) {
            throw new \RuntimeException('Private configuration missing');
        }
        $c = require $path;
        foreach (['dsn', 'user', 'password'] as $k) {
            if (!is_string($c[$k] ?? null) || $c[$k] === '') {
                throw new \RuntimeException('Private configuration incomplete');
            }
        }
        return $c;
    }

    /** @param array<string,mixed> $c */
    public static function jwt(array $c, string $root): Jwt
    {
        foreach (['clerk_issuer', 'clerk_authorized_parties'] as $k) {
            if (empty($c[$k])) {
                throw new \RuntimeException('Clerk configuration missing');
            }
        }
        return new Jwt((string) $c['clerk_issuer'], (array) $c['clerk_authorized_parties'], $root . '/cache', self::fetchJson(...));
    }

    /** Cloudflare edge ranges (https://www.cloudflare.com/ips/). Only these may set CF-Connecting-IP. Re-check them at each release. */
    private const CF_V4 = ['173.245.48.0/20', '103.21.244.0/22', '103.22.200.0/22', '103.31.4.0/22', '141.101.64.0/18', '108.162.192.0/18', '190.93.240.0/20', '188.114.96.0/20', '197.234.240.0/22', '198.41.128.0/17', '162.158.0.0/15', '104.16.0.0/13', '104.24.0.0/14', '172.64.0.0/13', '131.0.72.0/22'];
    private const CF_V6 = ['2400:cb00::/32', '2606:4700::/32', '2803:f800::/32', '2405:b500::/32', '2405:8100::/32', '2a06:98c0::/29', '2c0f:f248::/32'];

    /**
     * The request headers handlers read, from $_SERVER, with lower-case keys. A handler sees only what is listed here:
     * the enquiry form's Content-Type and Origin checks were dead in production because this list once held only
     * authorization and stripe-signature (security audit, 1 Nov 2026). Tests call it with a fake $_SERVER.
     *
     * @param array<string, mixed> $server
     * @return array<string, string>
     */
    public static function requestHeaders(array $server): array
    {
        $map = [
            'authorization' => ['HTTP_AUTHORIZATION', 'REDIRECT_HTTP_AUTHORIZATION'], // the second: cPanel/Apache quirk
            'stripe-signature' => ['HTTP_STRIPE_SIGNATURE'],
            'content-type' => ['CONTENT_TYPE', 'HTTP_CONTENT_TYPE'],
            'origin' => ['HTTP_ORIGIN'],
            'user-agent' => ['HTTP_USER_AGENT'],
        ];
        $headers = [];
        foreach ($map as $name => $keys) {
            foreach ($keys as $key) {
                if (isset($server[$key]) && is_string($server[$key])) {
                    $headers[$name] = $server[$key];
                    break;
                }
            }
        }
        return $headers;
    }

    public static function fromCloudflare(string $ip): bool
    {
        $bin = @inet_pton($ip);
        if ($bin === false) {
            return false;
        }
        foreach (strlen($bin) === 4 ? self::CF_V4 : self::CF_V6 as $cidr) {
            [$net, $bits] = explode('/', $cidr);
            $n = inet_pton($net);
            $bytes = intdiv((int) $bits, 8);
            $rem = (int) $bits % 8;
            if (strncmp($bin, $n, $bytes) !== 0) {
                continue;
            }
            if ($rem === 0 || ((ord($bin[$bytes]) ^ ord($n[$bytes])) & (0xFF << (8 - $rem)) & 0xFF) === 0) {
                return true;
            }
        }
        return false;
    }

    public static function fetchJson(string $url): string
    {
        $ch = curl_init($url);
        curl_setopt_array($ch, [CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 5, CURLOPT_CONNECTTIMEOUT => 3,
            CURLOPT_SSL_VERIFYPEER => true, CURLOPT_SSL_VERIFYHOST => 2, CURLOPT_PROTOCOLS => CURLPROTO_HTTPS, CURLOPT_FOLLOWLOCATION => false]);
        $out = curl_exec($ch);
        $code = curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
        if (!is_string($out) || $code !== 200) {
            throw new \RuntimeException('JWKS fetch failed');
        }
        return $out;
    }

    public static function log(string $root, string $line): void
    {
        $dir = $root . '/logs';
        if (is_dir($dir) && is_writable($dir)) {
            @file_put_contents($dir . '/api-' . gmdate('Y-m') . '.log', gmdate('c') . ' ' . $line . "\n", FILE_APPEND | LOCK_EX);
        }
    }
}
