<?php
declare(strict_types=1);

namespace RotaFlow\DataMove;

/**
 * Pure helpers for the Supabase -> MariaDB data move (bin/datamove.php). Every value written to the target goes through
 * value(), driven by the TARGET column's own metadata (information_schema), so a length, an enum list, a range or a
 * precision the target cannot hold is a reported problem, never a silent truncation. The same canonical string is what the
 * verify step hashes on both sides.
 */
final class Convert
{
    /**
     * Converts one source value to the canonical string the target column stores (null stays null).
     * @param array{type:string,len:?int,bytes:?int,precision:?int,scale:?int,dtp:?int,unsigned:bool,enum:?list<string>,nullable:bool} $col
     * @return array{0:?string,1:?string} [value, problem or null]
     */
    public static function value(mixed $v, array $col): array
    {
        if ($v === null) {
            return [null, $col['nullable'] ? null : 'null_not_allowed'];
        }
        if (is_bool($v)) {
            $v = $v ? '1' : '0';
        }
        $s = is_string($v) ? $v : (is_float($v) ? self::float($v) : (string) $v);
        switch ($col['type']) {
            case 'tinyint': case 'smallint': case 'mediumint': case 'int': case 'bigint':
                if ($s === 't' || $s === 'true') {
                    $s = '1';
                } elseif ($s === 'f' || $s === 'false') {
                    $s = '0';
                }
                if (preg_match('/^-?\d+$/', $s) !== 1) {
                    return [null, 'not_an_integer'];
                }
                [$min, $max] = self::intRange($col['type'], $col['unsigned']);
                if (self::cmpInt($s, $min) < 0 || self::cmpInt($s, $max) > 0) {
                    return [null, 'out_of_range'];
                }
                return [$s, null];
            case 'decimal':
                if (preg_match('/^-?\d+(\.\d+)?$/', $s) !== 1) {
                    return [null, 'not_a_number'];
                }
                $scale = (int) ($col['scale'] ?? 0);
                [$int, $frac] = array_pad(explode('.', $s, 2), 2, '');
                if (rtrim(substr($frac, $scale), '0') !== '') {
                    return [null, 'loses_decimals'];
                }
                $frac = str_pad(substr($frac, 0, $scale), $scale, '0');
                $neg = str_starts_with($int, '-');
                $int = ltrim(ltrim($int, '-'), '0');
                $int = $int === '' ? '0' : $int;
                if (($neg && $col['unsigned']) || strlen($int) > (int) ($col['precision'] ?? 65) - $scale) {
                    return [null, 'out_of_range'];
                }
                return [($neg ? '-' : '') . $int . ($scale > 0 ? '.' . $frac : ''), null];
            case 'double': case 'float':
                return is_numeric($s) ? [self::float((float) $s), null] : [null, 'not_a_number'];
            case 'datetime': case 'timestamp':
                return self::datetime($s, (int) ($col['dtp'] ?? 0));
            case 'date':
                return preg_match('/^\d{4}-\d{2}-\d{2}$/', $s) === 1 ? [$s, null] : [null, 'not_a_date'];
            case 'time':
                return preg_match('/^(\d{2}:\d{2}:\d{2})(\.\d+)?$/', $s, $m) === 1 ? [$m[1], null] : [null, 'not_a_time'];
            case 'enum':
                return in_array($s, $col['enum'] ?? [], true) ? [$s, null] : [null, 'not_in_enum'];
            default: // char, varchar, the text family, json (longtext)
                if (!mb_check_encoding($s, 'UTF-8')) {
                    return [null, 'not_utf8'];
                }
                if (($col['len'] !== null && mb_strlen($s, 'UTF-8') > $col['len']) || ($col['bytes'] !== null && strlen($s) > $col['bytes'])) {
                    return [null, 'too_long'];
                }
                return [$s, null];
        }
    }

    /**
     * A UTC instant from the source ("YYYY-MM-DD HH:MM:SS[.ffffff]", as the source query formats it) cut, never rounded,
     * to the target precision.
     * @return array{0:?string,1:?string}
     */
    public static function datetime(string $s, int $precision): array
    {
        if (preg_match('/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})(?:\.(\d{1,6}))?(?:\+00(?::?00)?|Z)?$/', $s, $m) !== 1) {
            return [null, 'not_a_datetime'];
        }
        $out = $m[1] . ' ' . $m[2];
        if ($precision > 0) {
            $out .= '.' . substr(str_pad($m[3] ?? '', 6, '0'), 0, $precision);
        }
        return [$out, null];
    }

    /** Shortest round-trip form of a float, the same on both sides of the comparison. */
    public static function float(float $f): string
    {
        $s = var_export($f, true);
        return str_contains($s, '.') && !str_contains($s, 'E') ? rtrim(rtrim($s, '0'), '.') : $s;
    }

    /** @return array{0:string,1:string} */
    private static function intRange(string $t, bool $unsigned): array
    {
        $bits = ['tinyint' => 8, 'smallint' => 16, 'mediumint' => 24, 'int' => 32, 'bigint' => 64][$t];
        if ($unsigned) {
            return ['0', $bits === 64 ? '18446744073709551615' : (string) (2 ** $bits - 1)];
        }
        return $bits === 64 ? ['-9223372036854775808', '9223372036854775807'] : [(string) (-(2 ** ($bits - 1))), (string) (2 ** ($bits - 1) - 1)];
    }

    /** Compares two integer strings of any length (no bcmath on the host). */
    public static function cmpInt(string $a, string $b): int
    {
        $na = str_starts_with($a, '-');
        $nb = str_starts_with($b, '-');
        if ($na !== $nb) {
            return $na ? -1 : 1;
        }
        $a = ltrim(ltrim($a, '-'), '0');
        $b = ltrim(ltrim($b, '-'), '0');
        $c = (strlen($a) <=> strlen($b)) ?: (strcmp($a, $b) <=> 0);
        return $na ? -$c : $c;
    }

    /**
     * Supabase Storage object names may hold characters FileStore refuses (spaces, accents, brackets). Returns the
     * "<org>/<staff>/<file>" path FileStore accepts: unchanged when it is already valid, otherwise the file name made safe
     * and suffixed with 8 hex of the original's hash, so two names that clean to the same text stay two files. Null when
     * the folder part is not "<uuid>/<uuid>" (such an object has no owner in the target and is reported).
     */
    public static function storagePath(string $name): ?string
    {
        $parts = explode('/', $name);
        $uuid = '/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/';
        if (count($parts) !== 3 || preg_match($uuid, $parts[0]) !== 1 || preg_match($uuid, $parts[1]) !== 1 || $parts[2] === '') {
            return null;
        }
        $file = $parts[2];
        if (preg_match('/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/', $file) === 1) {
            return $name;
        }
        $dot = strrpos($file, '.');
        $ext = $dot !== false && $dot > 0 ? strtolower((string) preg_replace('/[^A-Za-z0-9]/', '', substr($file, $dot + 1))) : '';
        $base = $dot !== false && $dot > 0 ? substr($file, 0, $dot) : $file;
        // Deliberately no transliteration (iconv differs between macOS and Linux): the name must come out the same on any
        // machine, because the data step and the files step may run on different ones.
        $clean = trim((string) preg_replace('/-{2,}/', '-', (string) preg_replace('/[^A-Za-z0-9._-]+/', '-', $base)), '-._');
        $clean = substr($clean === '' ? 'file' : $clean, 0, 100);
        $ext = substr($ext, 0, 10);
        return $parts[0] . '/' . $parts[1] . '/' . $clean . '-' . substr(hash('sha256', $file), 0, 8) . ($ext !== '' ? '.' . $ext : '');
    }

    /**
     * Turns a postgres:// URI into a PDO DSN, user and password without ever echoing it. Throws a message that names
     * the problem, never the URI.
     * @return array{dsn:string,user:string,password:string,host:string}
     */
    public static function pgUri(string $uri): array
    {
        $p = parse_url(trim($uri));
        if ($p === false || !in_array($p['scheme'] ?? '', ['postgres', 'postgresql'], true) || empty($p['host'])) {
            throw new \InvalidArgumentException('the source connection is not a postgres:// URI');
        }
        parse_str($p['query'] ?? '', $q);
        $local = in_array($p['host'], ['127.0.0.1', 'localhost', '::1'], true);
        $dsn = 'pgsql:host=' . $p['host'] . ';port=' . ($p['port'] ?? 5432) . ';dbname=' . (ltrim(rawurldecode($p['path'] ?? ''), '/') ?: 'postgres')
            . ';sslmode=' . (is_string($q['sslmode'] ?? null) ? $q['sslmode'] : ($local ? 'disable' : 'require'));
        return ['dsn' => $dsn, 'user' => rawurldecode($p['user'] ?? 'postgres'), 'password' => rawurldecode($p['pass'] ?? ''), 'host' => $p['host']];
    }

    /** "a***@example.com": enough to recognise a person in the report, not enough to be the address. */
    public static function maskEmail(?string $e): string
    {
        if ($e === null || !str_contains($e, '@')) {
            return '(none)';
        }
        [$l, $d] = explode('@', $e, 2);
        return mb_substr($l, 0, 1) . '***@' . $d;
    }

    /** Removes anything that looks like a connection string, password or key from a message before it is printed. */
    public static function scrub(string $msg): string
    {
        $msg = (string) preg_replace('#postgres(ql)?://\S+#i', 'postgres://[redacted]', $msg);
        $msg = (string) preg_replace('/(password|pass|pwd)\s*[=:]\s*\S+/i', '$1=[redacted]', $msg);
        $msg = (string) preg_replace('/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/', '[redacted-jwt]', $msg);
        return (string) preg_replace('/\b(sk|rk)_(live|test)_[A-Za-z0-9]+/', '[redacted-key]', $msg);
    }
}
