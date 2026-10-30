<?php
declare(strict_types=1);

namespace RotaFlow;

/**
 * A small Stripe API client over cURL: no SDK, so it needs nothing the host might lack. Only the calls RotaFlow makes.
 *
 * Mode is explicit (private config stripe.mode: "test" or "live"), never defaulted by guessing, and the secret key must match it: a
 * live key in test mode (or the reverse) is refused before any request is made. RotaFlow runs in test mode until the owner switches it.
 *
 * Private config (names only): stripe.mode, stripe.test_secret_key, stripe.secret_key, stripe.test_webhook_secret, stripe.webhook_secret.
 */
final class StripeClient
{
    private const API_VERSION = '2025-02-24.acacia';

    /** @param ?callable(string $method, string $url, array<string,string> $headers, string $body):array{0:int,1:string} $transport injected for tests */
    public function __construct(private readonly string $secretKey, private readonly string $mode, private $transport = null)
    {
        if (!in_array($mode, ['test', 'live'], true)) {
            throw new \InvalidArgumentException('stripe_mode_invalid');
        }
        $wrong = $mode === 'test' ? ['sk_live_', 'rk_live_'] : ['sk_test_', 'rk_test_'];
        foreach ($wrong as $prefix) {
            if (str_starts_with($secretKey, $prefix)) {
                throw new \InvalidArgumentException('stripe_key_mode_mismatch');
            }
        }
        if (preg_match('/^(sk|rk)_(test|live)_[A-Za-z0-9]{10,}$/', $secretKey) !== 1) {
            throw new \InvalidArgumentException('stripe_key_invalid');
        }
    }

    /** The configured mode, or null when Stripe is not configured on this deployment. */
    public static function modeFrom(Ctx $ctx): ?string
    {
        $m = $ctx->config['stripe']['mode'] ?? null;
        return $m === 'test' || $m === 'live' ? $m : null;
    }

    /** A client for the configured mode, or null if Stripe is not (fully) configured. A key that contradicts the mode is an error, not a silent null. */
    public static function fromConfig(Ctx $ctx, ?callable $transport = null): ?self
    {
        $mode = self::modeFrom($ctx);
        $key = $mode === null ? null : ($ctx->config['stripe'][$mode === 'test' ? 'test_secret_key' : 'secret_key'] ?? null);
        return $mode === null || !is_string($key) || $key === '' ? null : new self($key, $mode, $transport);
    }

    public static function webhookSecret(Ctx $ctx, string $mode): ?string
    {
        $s = $ctx->config['stripe'][$mode === 'test' ? 'test_webhook_secret' : 'webhook_secret'] ?? null;
        return is_string($s) && $s !== '' ? $s : null;
    }

    public function mode(): string
    {
        return $this->mode;
    }

    /**
     * @param array<string,mixed> $params
     * @return array<string,mixed>
     * @throws StripeError
     */
    public function request(string $method, string $path, array $params = []): array
    {
        $body = $method === 'GET' ? '' : self::encode($params);
        $url = 'https://api.stripe.com/v1' . $path . ($method === 'GET' && $params !== [] ? '?' . self::encode($params) : '');
        $headers = ['Authorization' => 'Bearer ' . $this->secretKey, 'Stripe-Version' => self::API_VERSION, 'Content-Type' => 'application/x-www-form-urlencoded'];
        [$status, $raw] = ($this->transport ?? self::curl(...))($method, $url, $headers, $body);
        $json = json_decode($raw, true);
        if ($status < 200 || $status >= 300 || !is_array($json)) {
            $e = is_array($json) && is_array($json['error'] ?? null) ? $json['error'] : [];
            throw new StripeError($status, (string) ($e['code'] ?? $e['type'] ?? 'stripe_error'), (string) ($e['message'] ?? 'Stripe request failed'));
        }
        return $json;
    }

    /** @param array<string,mixed> $params @return array<string,mixed> */
    public function createCheckoutSession(array $params): array { return $this->request('POST', '/checkout/sessions', $params); }
    /** @param array<string,mixed> $params @return array<string,mixed> */
    public function createPortalSession(array $params): array { return $this->request('POST', '/billing_portal/sessions', $params); }
    /** @return array<string,mixed> */
    public function subscription(string $id): array { return $this->request('GET', '/subscriptions/' . rawurlencode($id)); }
    /** @return array<string,mixed> */
    public function invoice(string $id): array { return $this->request('GET', '/invoices/' . rawurlencode($id)); }
    /** @return array<string,mixed> */
    public function paymentIntent(string $id): array { return $this->request('GET', '/payment_intents/' . rawurlencode($id)); }
    /** @param array<string,mixed> $params @return array<string,mixed> */
    public function updateCustomer(string $id, array $params): array { return $this->request('POST', '/customers/' . rawurlencode($id), $params); }

    /** Stripe's form encoding: nested arrays become key[sub][0]=value. Booleans are "true"/"false"; nulls are dropped. @param array<string,mixed> $data */
    public static function encode(array $data, string $prefix = ''): string
    {
        $parts = [];
        foreach ($data as $k => $v) {
            $key = $prefix === '' ? (string) $k : $prefix . '[' . $k . ']';
            if ($v === null) {
                continue;
            }
            if (is_array($v)) {
                $inner = self::encode($v, $key);
                if ($inner !== '') {
                    $parts[] = $inner;
                }
            } else {
                $parts[] = rawurlencode($key) . '=' . rawurlencode(is_bool($v) ? ($v ? 'true' : 'false') : (string) $v);
            }
        }
        return implode('&', $parts);
    }

    /** @param array<string,string> $headers @return array{0:int,1:string} */
    private static function curl(string $method, string $url, array $headers, string $body): array
    {
        $ch = curl_init($url);
        curl_setopt_array($ch, [CURLOPT_CUSTOMREQUEST => $method, CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 20, CURLOPT_CONNECTTIMEOUT => 5, CURLOPT_FOLLOWLOCATION => false,
            CURLOPT_PROTOCOLS => CURLPROTO_HTTPS, CURLOPT_SSL_VERIFYPEER => true, CURLOPT_SSL_VERIFYHOST => 2,
            CURLOPT_HTTPHEADER => array_map(static fn (string $k, string $v): string => "$k: $v", array_keys($headers), $headers)]);
        if ($method !== 'GET') {
            curl_setopt($ch, CURLOPT_POSTFIELDS, $body);
        }
        $out = curl_exec($ch);
        $code = (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
        curl_close($ch);
        return [$code, is_string($out) ? $out : ''];
    }
}
