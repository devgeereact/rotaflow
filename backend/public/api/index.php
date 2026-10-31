<?php
declare(strict_types=1);

// Public entrypoint. All other application code and configuration live in the private root.
// Local dev: src/ sits beside public/. On the host: the app is uploaded to <private root>/app/src.
$autoload = is_file(__DIR__ . '/../../src/Autoload.php')
    ? __DIR__ . '/../../src/Autoload.php'
    : dirname(rtrim((string) ($_SERVER['DOCUMENT_ROOT'] ?? ''), '/')) . '/rotaflow-private/app/src/Autoload.php';
if (!is_file($autoload)) {  // nosemgrep: php.lang.security.injection.tainted-filename.tainted-filename -- path comes from server config, never from the request
    http_response_code(503);
    header('Content-Type: application/json');
    exit('{"error":{"code":"unavailable","message":"Service unavailable"}}');
}
require_once $autoload;

use RotaFlow\{Api, Bootstrap, Ctx, Db, HttpError, Modules, RateLimiter, Users};

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');

$root = Bootstrap::privateRoot();
$respond = static function (int $status, array $payload): never {
    http_response_code($status);
    echo json_encode($payload, JSON_UNESCAPED_SLASHES);
    exit;
};

try {
    $path = (string) parse_url((string) ($_SERVER['REQUEST_URI'] ?? '/'), PHP_URL_PATH);
    $path = preg_replace('#^/api#', '', $path) ?? '/';
    $method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
    if (!in_array($method, ['GET', 'POST'], true)) {
        header('Allow: GET, POST');
        $respond(405, HttpError::body('method_not_allowed', 'Method not allowed'));
    }
    if (trim($path, '/') === 'health') {
        $respond(200, ['ok' => true]); // answered before config is read, so it shows the entrypoint is alive
    }
    $config = Bootstrap::config($root);
    $pdo = Db::connect($config);
    $jwt = Bootstrap::jwt($config, $root);
    $headers = [];
    if (isset($_SERVER['HTTP_AUTHORIZATION'])) {
        $headers['authorization'] = (string) $_SERVER['HTTP_AUTHORIZATION'];
    } elseif (isset($_SERVER['REDIRECT_HTTP_AUTHORIZATION'])) {
        $headers['authorization'] = (string) $_SERVER['REDIRECT_HTTP_AUTHORIZATION']; // cPanel/Apache quirk
    }
    if (isset($_SERVER['HTTP_STRIPE_SIGNATURE'])) {
        $headers['stripe-signature'] = (string) $_SERVER['HTTP_STRIPE_SIGNATURE'];
    }
    $remote = (string) ($_SERVER['REMOTE_ADDR'] ?? '');
    $ip = (($config['trust_cf_connecting_ip'] ?? false) && Bootstrap::fromCloudflare($remote) && isset($_SERVER['HTTP_CF_CONNECTING_IP'])) ? (string) $_SERVER['HTTP_CF_CONNECTING_IP'] : $remote;
    $limits = new RateLimiter($pdo);
    $ctx = new Ctx($pdo, $limits, (string) ($config['app_url'] ?? ''), $root, static fn (string $m) => Bootstrap::log($root, $m), (string) ($config['org_creation'] ?? 'invite_only'), $config);
    $api = new Api($pdo, static fn (string $t): array => Users::resolve($pdo, $jwt->verify($t)), $limits, Modules::all($ctx));
    [$status, $payload] = $api->handle($method, $path, $headers, (string) file_get_contents('php://input'), $ip, $_GET);
    if ($status === 200 && isset($payload['__raw']) && is_array($payload['__raw'])) {
        // A non-JSON body built by a module (the calendar feed, a file, the payroll CSV). The module sets its own type, cache policy and
        // disposition; Api::rawHeaders builds the header lines (tested in the suites, which never reach this file).
        $r = $payload['__raw'];
        header_remove('Content-Type');
        foreach (Api::rawHeaders($r) as $line) {
            header($line);
        }
        echo $r['body'];
        exit;
    }
    $respond($status, $payload);
} catch (HttpError $e) {
    $respond($e->status, HttpError::body($e->errorCode, $e->getMessage()));
} catch (Throwable $e) {
    $cid = bin2hex(random_bytes(6));
    Bootstrap::log($root, "$cid " . get_class($e) . ' ' . basename($e->getFile()) . ':' . $e->getLine());
    $respond(500, HttpError::body('internal', 'Something went wrong', $cid));
}
