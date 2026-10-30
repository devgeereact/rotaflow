<?php
declare(strict_types=1);

// CLI only. Checks that THIS php (the one cron and the web server will use) can run the API. Run it from the account's cPanel Terminal
// or over ssh, in the folder the cron entry uses, and before every release: the host's default PHP has changed under us before.
// Usage: php bin/doctor.php        Exit 0 = ready, 1 = something is missing.
if (PHP_SAPI !== 'cli') {
    exit(1);
}
$need = ['pdo_mysql' => 'database', 'openssl' => 'Clerk token check, SMTP, encryption', 'curl' => 'JWKS fetch, Stripe, push', 'json' => 'everything', 'ctype' => 'validation', 'iconv' => 'slugs', 'pcre' => 'validation'];
$nice = ['gd' => 'photo re-encoding (S8)', 'mbstring' => 'not used (src/Str.php)', 'sodium' => 'not used (openssl does the encryption)', 'gmp' => 'faster web push maths', 'bcmath' => 'faster web push maths'];
$bad = 0;
printf("PHP %s (%s)\n", PHP_VERSION, PHP_SAPI);
if (version_compare(PHP_VERSION, '8.4.0', '<')) {
    echo "  FAIL  PHP 8.4 or newer is required\n";
    $bad++;
}
foreach ($need as $ext => $why) {
    $ok = extension_loaded($ext);
    printf("  %s  %-10s %s\n", $ok ? 'ok  ' : 'FAIL', $ext, $ok ? '' : "missing: $why");
    $bad += $ok ? 0 : 1;
}
foreach ($nice as $ext => $why) {
    printf("  %s  %-10s %s\n", extension_loaded($ext) ? 'ok  ' : 'skip', $ext, $why);
}
echo $bad === 0 ? "ready\n" : "NOT READY: $bad problem(s). Fix the account's PHP version or extensions (cPanel, MultiPHP Manager or Select PHP Version).\n";
exit($bad === 0 ? 0 : 1);
