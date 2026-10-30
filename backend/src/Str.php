<?php
declare(strict_types=1);

namespace RotaFlow;

/**
 * Character-aware string helpers that need only PCRE, which every PHP build has. The shared host's PHP builds have shipped
 * without mbstring (see bin/doctor.php), so nothing in this API may call an mb_* function.
 */
final class Str
{
    /** Length in characters (UTF-8). Invalid UTF-8 counts bytes, so it can never be shorter than it looks. */
    public static function len(string $s): int
    {
        $n = preg_match_all('/./us', $s);
        return $n === false ? strlen($s) : $n;
    }

    /** The first $max characters. */
    public static function cut(string $s, int $max): string
    {
        return preg_match('/^.{0,' . max(0, $max) . '}/us', $s, $m) === 1 ? $m[0] : substr($s, 0, $max);
    }
}
