<?php
declare(strict_types=1);

// LOCAL TEST ONLY: a stand-in for the Supabase Storage download endpoint, run with `php -S 127.0.0.1:<port> fake-storage.php`.
// GET /storage/v1/object/<bucket>/<name> with "Authorization: Bearer <FAKE_SERVICE_KEY>" (and the same apikey header) answers
// the file under FAKE_STORAGE_DIR/<bucket>/<name>; anything else is 400/401/404, as the real service does.
$key = (string) getenv('FAKE_SERVICE_KEY');
$dir = rtrim((string) getenv('FAKE_STORAGE_DIR'), '/');
$path = (string) parse_url((string) ($_SERVER['REQUEST_URI'] ?? ''), PHP_URL_PATH);
$auth = (string) ($_SERVER['HTTP_AUTHORIZATION'] ?? '');
if ($key === '' || $auth !== 'Bearer ' . $key || ($_SERVER['HTTP_APIKEY'] ?? '') !== $key) {
    http_response_code(401);
    exit('{"statusCode":"401","error":"Unauthorized"}');
}
if (preg_match('#^/storage/v1/object/([a-z0-9-]+)/(.+)$#', $path, $m) !== 1) {
    http_response_code(400);
    exit('{"statusCode":"400","error":"Bad request"}');
}
$name = rawurldecode($m[2]);
if (str_contains($name, '..')) {
    http_response_code(400);
    exit('{"statusCode":"400","error":"Bad request"}');
}
$file = $dir . '/' . $m[1] . '/' . $name;
if (!is_file($file)) {
    http_response_code(404);
    exit('{"statusCode":"404","error":"not_found"}');
}
header('Content-Type: application/octet-stream');
readfile($file);
