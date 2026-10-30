<?php
declare(strict_types=1);

namespace RotaFlow;

/**
 * The pure rules of staff documents, with no database: calendar dates in an organisation's timezone, a document's displayed status, the
 * state of one requirement, and which expiry reminder is due. src/lib/compliance.ts is the browser's copy; the tests hold both to the same cases.
 *
 *  - A document is valid up to and including its expiry date, and expired from the next local day.
 *  - An upload never counts until it is approved.
 *  - Reminders: 30, 14 and 7 days before the expiry date, then once the day after it. If runs were missed, only the most urgent is sent.
 */
final class ComplianceRules
{
    public const EXPIRING_DAYS = 30;
    /** Days before expiry, longest first. */
    public const REMINDER_DAYS = [30, 14, 7];
    /** Stored statuses that are still "live" (not withdrawn or superseded). */
    public const LIVE = ['uploaded', 'awaiting_review', 'approved', 'rejected'];

    /** The calendar date (Y-m-d) of a UTC instant in a timezone, or null for bad input. Accepts 'Y-m-d\TH:i:s\Z' and 'Y-m-d H:i:s'. */
    public static function localDate(string $tz, string $utc): ?string
    {
        $z = new \DateTimeZone('UTC');
        $d = \DateTimeImmutable::createFromFormat('!Y-m-d\TH:i:s\Z', $utc, $z) ?: \DateTimeImmutable::createFromFormat('!Y-m-d H:i:s', $utc, $z);
        if ($d === false) {
            return null;
        }
        try {
            return $d->setTimezone(new \DateTimeZone($tz))->format('Y-m-d');
        } catch (\Throwable) {
            return null;
        }
    }

    /** Today in a timezone, at $now (unix seconds; 0 = the real time). */
    public static function today(string $tz, int $now = 0): string
    {
        return (string) (self::localDate($tz, gmdate('Y-m-d\TH:i:s\Z', $now ?: time())) ?? gmdate('Y-m-d', $now ?: time()));
    }

    public static function addDays(string $date, int $n): string
    {
        return (new \DateTimeImmutable($date, new \DateTimeZone('UTC')))->modify(($n >= 0 ? '+' : '') . $n . ' days')->format('Y-m-d');
    }

    public static function daysBetween(string $from, string $to): int
    {
        $a = new \DateTimeImmutable($from, new \DateTimeZone('UTC'));
        $b = new \DateTimeImmutable($to, new \DateTimeZone('UTC'));
        return (int) round(($b->getTimestamp() - $a->getTimestamp()) / 86400);
    }

    /** A date's expiry state on a local date: none (no expiry), valid, expiring (within 30 days), expired (after the expiry date). */
    public static function expiryState(?string $expiresAt, string $today): string
    {
        return match (true) {
            $expiresAt === null => 'none',
            $expiresAt < $today => 'expired',
            $expiresAt <= self::addDays($today, self::EXPIRING_DAYS) => 'expiring',
            default => 'valid',
        };
    }

    /** The status shown for one document row: a stored status, or 'expired' for a live upload or approval whose date has passed. */
    public static function status(string $stored, ?string $expiresAt, string $today): string
    {
        return in_array($stored, ['uploaded', 'awaiting_review', 'approved'], true) && $expiresAt !== null && $expiresAt < $today ? 'expired' : $stored;
    }

    /**
     * The state of one requirement for one person, from their rows of that type (oldest first):
     * approved | expiring | awaiting_review | uploaded | rejected | expired | missing, and the expiry date that state is about.
     * @param list<array{status:string, expires_at:?string}> $rows
     * @return array{0:string, 1:?string}
     */
    public static function stateOf(array $rows, string $today): array
    {
        $best = null;
        $bestExp = null;
        foreach ($rows as $r) {
            if ($r['status'] === 'approved' && ($r['expires_at'] === null || $r['expires_at'] >= $today)) {
                if ($best === null || $r['expires_at'] === null || ($bestExp !== null && $r['expires_at'] > $bestExp)) {
                    $best = $r;
                    $bestExp = $r['expires_at'];
                }
            }
        }
        if ($best !== null) {
            return [self::expiryState($bestExp, $today) === 'expiring' ? 'expiring' : 'approved', $bestExp];
        }
        $live = array_values(array_filter($rows, static fn (array $r): bool => in_array($r['status'], self::LIVE, true)));
        $statuses = array_map(static fn (array $r): string => self::status($r['status'], $r['expires_at'], $today), $live);
        foreach (['awaiting_review', 'uploaded'] as $s) {
            if (in_array($s, $statuses, true)) {
                return [$s, null];
            }
        }
        if ($live === []) {
            return ['missing', null];
        }
        $last = end($statuses);
        return [$last === 'rejected' ? 'rejected' : 'expired', end($live)['expires_at']];
    }

    /** @param list<array{state:string}> $reqs @return array{required:int,approved:int,expiring:int,expired:int,awaiting_review:int,missing:int,eligible:bool} */
    public static function counts(array $reqs): array
    {
        $c = ['required' => count($reqs), 'approved' => 0, 'expiring' => 0, 'expired' => 0, 'awaiting_review' => 0, 'missing' => 0];
        foreach ($reqs as $r) {
            match ($r['state']) {
                'approved' => $c['approved']++,
                'expiring' => $c['expiring']++,
                'expired' => $c['expired']++,
                'awaiting_review' => $c['awaiting_review']++,
                default => $c['missing']++, // missing, rejected, or saved but not sent
            };
        }
        $c['eligible'] = $c['approved'] + $c['expiring'] === $c['required'];
        return $c;
    }

    /** The reminder stage due for an expiry date on a local date ('d30', 'd14', 'd7', 'expired'), or null if none is due. */
    public static function stageFor(string $expiresAt, string $today): ?string
    {
        $left = self::daysBetween($today, $expiresAt);
        if ($left < 0) {
            return 'expired';
        }
        $days = self::REMINDER_DAYS;
        sort($days);
        foreach ($days as $d) {
            if ($left <= $d) {
                return 'd' . $d;
            }
        }
        return null;
    }

    /** The type a file's bytes really are (PDF, JPEG, PNG, WebP or HEIC), or null. Never the name or the claimed type. */
    public static function sniff(string $bytes): ?string
    {
        return match (true) {
            str_starts_with($bytes, '%PDF-') => 'application/pdf',
            str_starts_with($bytes, "\xFF\xD8\xFF") => 'image/jpeg',
            str_starts_with($bytes, "\x89PNG\r\n\x1a\n") => 'image/png',
            strlen($bytes) > 12 && str_starts_with($bytes, 'RIFF') && substr($bytes, 8, 4) === 'WEBP' => 'image/webp',
            strlen($bytes) > 12 && substr($bytes, 4, 4) === 'ftyp' && in_array(substr($bytes, 8, 4), ['heic', 'heix', 'heim', 'heis', 'mif1', 'msf1'], true) => 'image/heic',
            default => null,
        };
    }

    public const EXTENSIONS = ['application/pdf' => 'pdf', 'image/jpeg' => 'jpg', 'image/png' => 'png', 'image/webp' => 'webp', 'image/heic' => 'heic'];
}
