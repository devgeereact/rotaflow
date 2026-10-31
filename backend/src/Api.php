<?php
declare(strict_types=1);

namespace RotaFlow;

/**
 * Transport-independent request handler: routing, sign-in, rate limits and the one error shape.
 * Only GET and POST exist; every mutation is a POST with the verb in the path.
 */
final class Api
{
    private const MAX_BODY = 262144; // 256 KB of JSON: room for a 500-shift batch
    private const MAX_UPLOAD_BODY = 3145728; // 3 MiB for the routes that carry a picture as base64 (6th route element 'upload')
    private const MAX_DOCUMENT_BODY = 14680064; // 14 MiB for a staff document (10 MiB file as base64; 6th route element 'upload-document')

    /** @var list<array{0:string,1:string,2:callable,3:bool,4:bool,5:int}> */
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
            // 4th element 'public': no sign-in. 5th element 'raw': the handler gets the untouched body and headers (a signed webhook needs the exact bytes).
            $this->compiled[] = [$m, $re, $handler, ($r[3] ?? '') === 'public', ($r[4] ?? '') === 'raw', match ($r[5] ?? '') { 'upload' => self::MAX_UPLOAD_BODY, 'upload-document' => self::MAX_DOCUMENT_BODY, default => 0 }];
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
            foreach ($this->compiled as [$m, $re, $handler, $public, $raw]) {
                if ($raw && $public && $m === $method && preg_match($re, $path) === 1) {
                    if (strlen($body) > 1048576) {
                        throw new HttpError(413, 'too_large', 'Request too large');
                    }
                    $this->limits->hit('api-public', $ip, 300, 60);
                    return $handler(null, ['__raw' => $body, '__headers' => $headers], $ip);
                }
            }
            $limit = self::MAX_BODY;
            foreach ($this->compiled as $c) {
                if ($c[5] > 0 && $c[0] === $method && preg_match($c[1], $path) === 1) {
                    $limit = $c[5];
                    break;
                }
            }
            if (strlen($body) > $limit) {
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
            foreach ($this->compiled as [$m, $re, $handler, $public, $raw]) {
                if ($public && $m === $method && preg_match($re, $path, $mt) === 1) {
                    $this->limits->hit('api-public', $ip, 300, 60);
                    return $handler(null, $input, $ip, ...array_values(array_filter($mt, 'is_string', ARRAY_FILTER_USE_KEY)));
                }
            }
            $principal = $this->principal($headers);
            $this->limits->hit('api-user', (string) $principal['sub'], 600, 60);
            foreach ($this->compiled as [$m, $re, $handler, $public, $raw]) {
                if (!$public && $m === $method && preg_match($re, $path, $mt) === 1) {
                    return $handler($principal, $input, $ip, ...array_values(array_filter($mt, 'is_string', ARRAY_FILTER_USE_KEY)));
                }
            }
            throw HttpError::notFound();
        } catch (HttpError $e) {
            return [$e->status, HttpError::body($e->errorCode, $e->getMessage())];
        }
    }

    /**
     * The response headers for a non-JSON body a module built (`__raw`): its type, its cache policy and its Content-Disposition, which is
     * `inline` unless the module asks for `disposition: attachment` (so a direct link downloads, as the payroll CSV does). The file name
     * keeps only ASCII letters, digits, `_`, space, `.`, `(`, `)` and `-` (anything else becomes `_`), so it can never break out of the
     * quotes. Extra `headers` are sent only when the name is `X-RotaFlow-...` and the value plain ASCII (no CR or LF), else dropped.
     * @param array<string,mixed> $raw
     * @return list<string>
     */
    public static function rawHeaders(array $raw): array
    {
        $name = (string) preg_replace('/[^A-Za-z0-9_ .()-]/', '_', (string) ($raw['filename'] ?? 'file'));
        $out = [
            'Content-Type: ' . (string) $raw['mime'],
            'Cache-Control: ' . (string) ($raw['cache'] ?? 'no-store'),
            'Content-Disposition: ' . (($raw['disposition'] ?? null) === 'attachment' ? 'attachment' : 'inline') . '; filename="' . $name . '"',
        ];
        foreach (is_array($raw['headers'] ?? null) ? $raw['headers'] : [] as $k => $v) {
            if (is_string($k) && preg_match('/^X-RotaFlow-[A-Za-z-]{1,40}$/', $k) === 1 && is_scalar($v) && preg_match('/^[ -~]{0,200}$/', (string) $v) === 1) {
                $out[] = "$k: $v";
            }
        }
        return $out;
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
