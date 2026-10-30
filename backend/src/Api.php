<?php
declare(strict_types=1);

namespace RotaFlow;

/**
 * Transport-independent request handler: routing, sign-in, rate limits and the one error shape.
 * Only GET and POST exist; every mutation is a POST with the verb in the path.
 */
final class Api
{
    private const MAX_BODY = 65536;

    /** @var list<array{0:string,1:string,2:callable,3:bool}> */
    private array $compiled = [];

    /**
     * @param callable(string):array<string,mixed> $authenticate verifies a bearer token, returns the principal (S2 resolves the database user)
     * @param list<Module> $modules
     */
    public function __construct(
        private readonly \PDO $pdo,
        private $authenticate,
        private readonly RateLimiter $limits,
        array $modules = [],
    ) {
        $routes = [];
        foreach ($modules as $module) {
            array_push($routes, ...$module->routes());
        }
        foreach ($routes as $r) {
            [$m, $tpl, $handler] = $r;
            // {x} placeholders become named UUID groups; everything else is matched literally.
            $re = '#^' . preg_replace_callback('/\{([a-z])\}|[^{]+/', static fn (array $p): string => ($p[1] ?? '') !== '' ? '(?P<' . $p[1] . '>[0-9a-f-]{36})' : preg_quote($p[0], '#'), $tpl) . '$#';
            $this->compiled[] = [$m, $re, $handler, ($r[3] ?? '') === 'public'];
        }
    }

    /**
     * @param array<string,string> $headers lower-cased header names
     * @param array<string,mixed> $query
     * @return array{0:int,1:array<string,mixed>}
     */
    public function handle(string $method, string $path, array $headers, string $body, string $ip, array $query = []): array
    {
        try {
            $path = '/' . trim($path, '/');
            if ($path === '/health') {
                return [200, ['ok' => true]];
            }
            if (strlen($body) > self::MAX_BODY) {
                throw new HttpError(413, 'too_large', 'Request too large');
            }
            $input = [];
            if ($body !== '') {
                $input = json_decode($body, true);
                if (!is_array($input)) {
                    throw HttpError::invalid('Body must be a JSON object');
                }
            }
            if ($method === 'GET' && $query !== []) {
                $input = $query;
            }
            foreach ($this->compiled as [$m, $re, $handler, $public]) {
                if ($public && $m === $method && preg_match($re, $path, $mt) === 1) {
                    $this->limits->hit('api-public', $ip, 300, 60);
                    return $handler(null, $input, $ip, ...array_values(array_filter($mt, 'is_string', ARRAY_FILTER_USE_KEY)));
                }
            }
            $principal = $this->principal($headers);
            $this->limits->hit('api-user', (string) $principal['sub'], 600, 60);
            foreach ($this->compiled as [$m, $re, $handler, $public]) {
                if (!$public && $m === $method && preg_match($re, $path, $mt) === 1) {
                    return $handler($principal, $input, $ip, ...array_values(array_filter($mt, 'is_string', ARRAY_FILTER_USE_KEY)));
                }
            }
            throw HttpError::notFound();
        } catch (HttpError $e) {
            return [$e->status, HttpError::body($e->errorCode, $e->getMessage())];
        }
    }

    /** @param array<string,string> $headers @return array<string,mixed> */
    private function principal(array $headers): array
    {
        $auth = $headers['authorization'] ?? '';
        if (preg_match('/^Bearer ([A-Za-z0-9._-]+)$/', $auth, $m) !== 1) {
            throw HttpError::unauthorized();
        }
        $principal = ($this->authenticate)($m[1]);
        if (!is_string($principal['sub'] ?? null) || $principal['sub'] === '') {
            throw HttpError::unauthorized();
        }
        return $principal;
    }
}
