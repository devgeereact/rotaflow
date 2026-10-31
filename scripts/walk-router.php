<?php
declare(strict_types=1);

// LOCAL ONLY: router for `php -S` (scripts/walk.sh api). Every /api request goes to the real entrypoint, as Apache's
// /api rule does on the host; anything else is 404 (the front end is served by Vite).
$path = (string) parse_url((string) ($_SERVER['REQUEST_URI'] ?? '/'), PHP_URL_PATH);
if (preg_match('#^/api(/|$)#', $path) === 1) {
    $_SERVER['DOCUMENT_ROOT'] = __DIR__ . '/../backend/public';
    require __DIR__ . '/../backend/public/api/index.php';
    return true;
}
http_response_code(404);
echo 'not found';
return true;
