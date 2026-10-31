<?php
declare(strict_types=1);

namespace RotaFlow;

/**
 * Cover eligibility, candidate ranking and swap staleness (R2 slice S12). Pure: no database, no clock, no I/O.
 *
 * Ported from SiteRelay backend/src/Mod/Cover.php (reasons, rank, staleReason) and re-made for RotaFlow's rows. The rest, weekly-hours,
 * leave and availability arithmetic is S11's SchedulingRules, not a second copy: a person on approved leave or declared unavailable cannot
 * take the shift (those two block here), while short rest and a long week stay warnings, as S11 decided. The browser holds the same rules in
 * src/lib/coverRules.ts, kept in step by mirrored cases (src/lib/coverRules.test.ts and backend/tests/suites/245-cover-rules.php).
 */
final class CoverRules
{
    /** Blocking reasons, in the order they are reported. */
    public const CODES = ['inactive', 'absent', 'overlap', 'leave', 'unavailable', 'documents'];

    /**
     * Why this person cannot take this shift (an empty 'reasons' list means they can), and the warnings that do not block.
     *
     * @param array<string,mixed> $shift the shift being filled: id, starts_at, ends_at, break_minutes, timezone (its site zone, or null)
     * @param array{active:bool, absent:bool, documents:?array{ok:bool, missing:list<string>}} $person
     * @param list<array<string,mixed>> $others the person's other committed shifts (id, staff_profile_id, starts_at, ends_at, break_minutes, status)
     * @param list<array<string,mixed>> $leave the person's leave rows
     * @param list<array<string,mixed>> $availability the person's availability rows
     * @return array{reasons:list<array{code:string,message:string}>, warnings:list<array{code:string,message:string}>}
     */
    public static function assess(string $staff, array $shift, array $person, array $others, array $leave, array $availability, int $minRestHours, int $maxWeeklyHours, string $orgTz): array
    {
        $reasons = [];
        if (!$person['active']) {
            $reasons[] = ['code' => 'inactive', 'message' => 'Not an active member of staff'];
        }
        if ($person['absent']) {
            $reasons[] = ['code' => 'absent', 'message' => 'Said they cannot work this shift'];
        }
        $s = SchedulingRules::ts((string) $shift['starts_at']);
        $e = SchedulingRules::ts((string) $shift['ends_at']);
        $mine = array_values(array_filter($others, static fn (array $x): bool => (string) $x['id'] !== (string) $shift['id'] && ($x['staff_profile_id'] ?? null) === $staff && ($x['status'] ?? '') !== 'cancelled'));
        if (self::overlaps(array_map(static fn (array $x): array => [SchedulingRules::ts((string) $x['starts_at']), SchedulingRules::ts((string) $x['ends_at'])], $mine), $s, $e)) {
            $reasons[] = ['code' => 'overlap', 'message' => 'Already working at this time'];
        }
        // The shift as if this person held it, read with S11's rules.
        $target = ['id' => (string) $shift['id'], 'staff_profile_id' => $staff, 'starts_at' => $shift['starts_at'], 'ends_at' => $shift['ends_at'], 'break_minutes' => (int) ($shift['break_minutes'] ?? 0), 'status' => 'assigned', 'timezone' => $shift['timezone'] ?? null];
        $byCode = [];
        foreach (SchedulingRules::warnings([$target], $mine, $leave, $availability, $minRestHours, $maxWeeklyHours, $orgTz)[$target['id']] ?? [] as $w) {
            $byCode[$w['code']] = $w;
        }
        foreach (['leave', 'unavailable'] as $c) {
            if (isset($byCode[$c])) {
                $reasons[] = $byCode[$c];
            }
        }
        $docs = $person['documents'];
        if ($docs !== null && $docs['ok'] !== true) {
            $missing = array_values(array_map('strval', $docs['missing']));
            $reasons[] = ['code' => 'documents', 'message' => $missing === [] ? 'Required documents are not in order' : 'Missing or expired: ' . Str::cut(implode(', ', $missing), 160)];
        }
        $warnings = [];
        foreach (['rest', 'weekly_hours'] as $c) {
            if (isset($byCode[$c])) {
                $warnings[] = $byCode[$c];
            }
        }
        return ['reasons' => $reasons, 'warnings' => $warnings];
    }

    /** @param list<array{0:int,1:int}> $others */
    public static function overlaps(array $others, int $s, int $e): bool
    {
        foreach ($others as [$a, $b]) {
            if ($a < $e && $b > $s) {
                return true;
            }
        }
        return false;
    }

    /**
     * Candidates in the order a manager should read them: eligible first, then people who applied, then the fewest hours that week, then
     * fewer reasons, then name. Each row needs: eligible (bool), applied (bool), hours (float), reasons (list), name (string).
     * @param list<array<string,mixed>> $rows
     * @return list<array<string,mixed>>
     */
    public static function rank(array $rows): array
    {
        usort($rows, static fn (array $a, array $b): int => [!$a['eligible'], !$a['applied'], $a['hours'], count($a['reasons']), strtolower((string) $a['name'])]
            <=> [!$b['eligible'], !$b['applied'], $b['hours'], count($b['reasons']), strtolower((string) $b['name'])]);
        return $rows;
    }

    /**
     * What a swap holds of its shift when it is raised. Any later change to these (times, site, holder, status, rota) voids the swap.
     * @param array<string,mixed> $shift
     */
    public static function fingerprint(array $shift): string
    {
        return hash('sha256', implode('|', [
            SchedulingRules::ts((string) $shift['starts_at']), SchedulingRules::ts((string) $shift['ends_at']), (string) ($shift['location_id'] ?? ''),
            (string) ($shift['staff_profile_id'] ?? ''), (string) ($shift['status'] ?? ''), (string) ($shift['rota_id'] ?? ''),
        ]));
    }

    /**
     * Why a pending or accepted swap can no longer go ahead, or null. A swap raised before fingerprints existed (null) is judged on the rest.
     * 'shift_changed' wins over 'shift_started' (the same order as SiteRelay).
     */
    public static function staleReason(?string $raisedFingerprint, string $currentFingerprint, string $shiftStatus, ?string $rotaStatus, int $startsAt, int $now): ?string
    {
        if (($raisedFingerprint !== null && !hash_equals($raisedFingerprint, $currentFingerprint)) || $shiftStatus === 'cancelled' || $rotaStatus === 'archived') {
            return 'shift_changed';
        }
        if ($startsAt <= $now) {
            return 'shift_started';
        }
        return null;
    }

    /**
     * A two-way swap (S12d) can go ahead only while BOTH shifts can: 'shift_changed' on either wins over 'shift_started' on either, as for
     * one shift. Each side is staleReason's own answer (null when that side is fine).
     */
    public static function exchangeStale(?string $give, ?string $take): ?string
    {
        if ($give === 'shift_changed' || $take === 'shift_changed') {
            return 'shift_changed';
        }
        return $give ?? $take;
    }

    /**
     * Why a shift cannot be asked for in return, or null. Pure, on the two shift rows as read under lock:
     * @param array{id:string,staff_profile_id:?string,status:string,rota_status:?string,starts_at:string} $give the requester's shift
     * @param array{id:string,staff_profile_id:?string,status:string,rota_status:?string,starts_at:string} $take the shift asked for
     */
    public static function exchangeProblem(array $give, array $take, string $requester, string $target, int $now): ?string
    {
        return match (true) {
            $take['id'] === $give['id'] => 'Ask for a different shift from the one you are offering',
            $take['staff_profile_id'] !== $target => 'The shift asked for in return must be one of your colleague\'s shifts',
            $give['staff_profile_id'] !== $requester => 'You can only offer a shift that is yours',
            $take['status'] === 'cancelled' || $give['status'] === 'cancelled' => 'A cancelled shift cannot be swapped',
            $take['rota_status'] !== 'published' || $give['rota_status'] !== 'published' => 'Both shifts must be on a published rota',
            SchedulingRules::ts($take['starts_at']) <= $now || SchedulingRules::ts($give['starts_at']) <= $now => 'A shift that has started cannot be swapped',
            default => null,
        };
    }

    /** Checks a 'respond by' deadline: an instant in the future and no later than the shift's start. Null when absent; 422 otherwise. */
    public static function respondBy(mixed $v, int $startsAt, int $now): ?int
    {
        if ($v === null || $v === '') {
            return null;
        }
        if (!is_string($v) || preg_match('/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?(\.\d+)?(Z|[+-]\d{2}:\d{2})$/', $v) !== 1) {
            throw HttpError::invalid('respond_by must be a time like 2029-03-20T09:00:00Z');
        }
        $t = strtotime($v);
        if ($t === false || $t <= $now || $t > $startsAt) {
            throw HttpError::invalid('The response deadline must be in the future and no later than the start of the shift');
        }
        return $t;
    }
}
