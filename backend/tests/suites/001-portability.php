<?php
declare(strict_types=1);

// The shared host's PHP has shipped without mbstring, sodium, gmp and bcmath (and once without pdo_mysql). The API must run on what
// is guaranteed, so none of the optional extensions' functions may be called from application code.
$root = dirname(__DIR__, 2);
$files = array_merge(glob($root . '/src/*.php') ?: [], glob($root . '/src/Mod/*.php') ?: [], glob($root . '/bin/*.php') ?: [], glob($root . '/public/api/*.php') ?: []);
check('the portability scan found the application code', count($files) >= 20, 'files=' . count($files));
$bad = [];
foreach ($files as $f) {
    $code = (string) file_get_contents($f);
    $code = preg_replace('~/\*.*?\*/|//[^\n]*|#[^\n]*~s', '', $code) ?? $code; // ignore comments
    if (preg_match_all('/\b(mb_[a-z_]+|sodium_[a-z_0-9]+|gmp_[a-z_]+|bc(?:add|sub|mul|div|mod|pow|comp)|ctype_[a-z]+\s*\(\s*\)|random_int_unsafe)\s*\(/i', $code, $m) > 0) {
        $bad[] = basename($f) . ': ' . implode(',', array_unique($m[1]));
    }
}
check('no mb_*, sodium_*, gmp_* or bc* call in application code' . ($bad ? ' (' . implode('; ', $bad) . ')' : ''), $bad === []);
check('Str::len counts characters, not bytes', RotaFlow\Str::len('héllo') === 5 && RotaFlow\Str::len('日本語') === 3 && RotaFlow\Str::len('') === 0);
check('Str::cut cuts on a character boundary', RotaFlow\Str::cut('héllo wörld', 7) === 'héllo w' && RotaFlow\Str::cut('日本語です', 2) === '日本' && RotaFlow\Str::cut('ab', 10) === 'ab');
check('Str survives invalid UTF-8 without throwing', is_int(RotaFlow\Str::len("\xff\xfe")) && is_string(RotaFlow\Str::cut("\xff\xfe", 1)));
exec(escapeshellarg(PHP_BINARY) . ' ' . escapeshellarg($root . '/bin/doctor.php') . ' 2>&1', $out, $rc);
check('the doctor script runs and reports readiness on a complete PHP', $rc === 0 && str_contains(implode("\n", $out), 'ready'), implode(' | ', $out));
