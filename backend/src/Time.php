<?php
declare(strict_types=1);

namespace RotaFlow;

/** Instants are stored as UTC DATETIME and exchanged as ISO 8601 with an explicit offset. A time with no offset is refused: it would be a guess. */
final class Time
{
    /** @return string 'Y-m-d H:i:s' in UTC, or 'Y-m-d H:i:s.v' (milliseconds) when $ms */
    public static function parseInstant(mixed $v, string $field, bool $ms = false): string
    {
        if (!is_string($v) || preg_match('/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})$/', $v) !== 1) {
            throw HttpError::invalid("$field must be an ISO 8601 time with an offset, for example 2026-11-02T09:00:00Z");
        }
        try {
            return (new \DateTimeImmutable($v))->setTimezone(new \DateTimeZone('UTC'))->format($ms ? 'Y-m-d H:i:s.v' : 'Y-m-d H:i:s');
        } catch (\Exception) {
            throw HttpError::invalid("$field is not a valid time");
        }
    }

    public static function iso(?string $utc): ?string
    {
        if ($utc === null) {
            return null;
        }
        $utc = preg_replace('/\.000$/', '', $utc) ?? $utc;
        return str_replace(' ', 'T', $utc) . 'Z';
    }

    /** The same wall-clock time $days later in $tz (so a shift keeps its local hours across a clock change). Returns UTC 'Y-m-d H:i:s'. */
    public static function plusLocalDays(string $utc, string $tz, int $days): string
    {
        $z = new \DateTimeZone($tz);
        $local = (new \DateTimeImmutable($utc . ' UTC'))->setTimezone($z);
        return $local->modify(($days >= 0 ? '+' : '') . $days . ' days')->setTimezone(new \DateTimeZone('UTC'))->format('Y-m-d H:i:s');
    }

    public static function validDate(string $d): bool
    {
        $x = \DateTimeImmutable::createFromFormat('!Y-m-d', $d);
        return $x !== false && $x->format('Y-m-d') === $d;
    }
}
