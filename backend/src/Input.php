<?php
declare(strict_types=1);

namespace RotaFlow;

/** Reads request fields strictly: a value of the wrong type is "absent", never cast (an array cast to string is a warning and a bug). */
final class Input
{
    /** @param array<string,mixed> $in */
    public static function str(array $in, string $key): string
    {
        $v = $in[$key] ?? '';
        return is_string($v) ? $v : '';
    }

    /** A string field that is optional: null when absent or empty, trimmed and length-checked when present. */
    public static function optStr(array $in, string $key, int $max): ?string
    {
        if (!array_key_exists($key, $in) || $in[$key] === null || $in[$key] === '') {
            return null;
        }
        if (!is_string($in[$key])) {
            throw HttpError::invalid("$key must be text");
        }
        $v = trim($in[$key]);
        if (\RotaFlow\Str::len($v) > $max) {
            throw HttpError::invalid("$key is too long");
        }
        return $v === '' ? null : $v;
    }

    /** A required string of 1..$max characters. */
    public static function reqStr(array $in, string $key, int $max): string
    {
        $v = trim(self::str($in, $key));
        if ($v === '' || \RotaFlow\Str::len($v) > $max) {
            throw HttpError::invalid("$key is required and at most $max characters");
        }
        return $v;
    }

    /** A number in range, or null when absent. */
    public static function optNum(array $in, string $key, float $min, float $max): ?float
    {
        if (!array_key_exists($key, $in) || $in[$key] === null || $in[$key] === '') {
            return null;
        }
        if (!is_int($in[$key]) && !is_float($in[$key]) && !(is_string($in[$key]) && is_numeric($in[$key]))) {
            throw HttpError::invalid("$key must be a number");
        }
        $n = (float) $in[$key];
        if ($n < $min || $n > $max) {
            throw HttpError::invalid("$key must be between $min and $max");
        }
        return $n;
    }

    /** A calendar date YYYY-MM-DD that exists, or null when absent. */
    public static function optDate(array $in, string $key): ?string
    {
        $v = self::optStr($in, $key, 10);
        if ($v === null) {
            return null;
        }
        $d = \DateTimeImmutable::createFromFormat('!Y-m-d', $v);
        if ($d === false || $d->format('Y-m-d') !== $v) {
            throw HttpError::invalid("$key must be a date (YYYY-MM-DD)");
        }
        return $v;
    }
}
