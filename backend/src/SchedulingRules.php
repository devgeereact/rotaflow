<?php
declare(strict_types=1);

namespace RotaFlow;

/**
 * Scheduling warnings and recurring patterns (R2 slice S11). Pure: no database, no clock, no I/O.
 *
 * Ported from SiteRelay backend/src/Mod/Scheduling.php (warnings, rest, patterns) and re-made for RotaFlow's rows: a shift belongs to a
 * staff record, availability weekdays are 0 = Sunday, leave is leave_requests with inclusive local dates. The browser holds the same rules in
 * src/lib/schedulingRules.ts (so the assign dialog can warn as the manager types); the two are kept in step by mirrored test cases
 * (src/lib/schedulingRules.test.ts and backend/tests/suites/240-scheduling.php).
 *
 * Warnings never block. Times are unix seconds here; shift rows carry starts_at / ends_at as UTC 'Y-m-d H:i:s' (the database form) or ISO.
 */
final class SchedulingRules
{
    public const CODES = ['leave', 'unavailable', 'rest', 'weekly_hours'];
    public const DEFAULT_MIN_REST_HOURS = 11;
    public const DEFAULT_MAX_WEEKLY_HOURS = 48;
    public const MAX_PATTERN_DAYS = 92;
    public const MAX_PATTERN_SHIFTS = 500;
    public const MAX_BLOCKS = 6;

    private const SHORT_DAYS = [1 => 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    private const PLURAL_DAYS = ['Sundays', 'Mondays', 'Tuesdays', 'Wednesdays', 'Thursdays', 'Fridays', 'Saturdays'];
    private const MONTHS = [1 => 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

    // ---- calendar ------------------------------------------------------------------------------------------------------------------------

    /**
     * Local date + HH:MM in $tz to unix seconds, by the same two-pass offset method as the browser's zonedToUtc, so both agree on the
     * clock-change hours: a skipped time moves on an hour, a repeated time resolves to the second (standard-time) occurrence.
     */
    public static function localTs(string $date, string $time, string $tz): int
    {
        [$y, $m, $d] = array_map('intval', explode('-', $date));
        [$h, $i] = array_map('intval', explode(':', substr($time, 0, 5)));
        $guess = gmmktime($h, $i, 0, $m, $d, $y);
        $z = new \DateTimeZone($tz);
        $off = static fn (int $ts): int => $z->getOffset(new \DateTimeImmutable('@' . $ts));
        $ts = $guess - $off($guess);
        return $guess - $off($ts);
    }

    /** @return array{0:string,1:string} local [Y-m-d, H:i] */
    public static function localParts(int $ts, string $tz): array
    {
        $d = (new \DateTimeImmutable('@' . $ts))->setTimezone(new \DateTimeZone($tz));
        return [$d->format('Y-m-d'), $d->format('H:i')];
    }

    public static function addDays(string $date, int $n): string
    {
        return gmdate('Y-m-d', self::dayNumber($date) * 86400 + $n * 86400);
    }

    public static function daysBetween(string $a, string $b): int
    {
        return self::dayNumber($b) - self::dayNumber($a);
    }

    /** 1 = Monday ... 7 = Sunday */
    public static function isoWeekday(string $date): int
    {
        return (int) gmdate('N', self::dayNumber($date) * 86400);
    }

    /** Monday (Y-m-d) of the local week the instant falls in. */
    public static function weekOf(int $ts, string $tz): string
    {
        $date = self::localParts($ts, $tz)[0];
        return self::addDays($date, 1 - self::isoWeekday($date));
    }

    public static function validDate(mixed $v): bool
    {
        return is_string($v) && preg_match('/^\d{4}-\d{2}-\d{2}$/', $v) === 1 && Time::validDate($v);
    }

    public static function validTime(mixed $v): bool
    {
        return is_string($v) && preg_match('/^([01]\d|2[0-3]):[0-5]\d$/', $v) === 1;
    }

    public static function validZone(mixed $tz): bool
    {
        return is_string($tz) && in_array($tz, \DateTimeZone::listIdentifiers(), true);
    }

    // ---- words ----------------------------------------------------------------------------------------------------------------------------

    public static function dayLabel(string $date): string
    {
        return self::SHORT_DAYS[self::isoWeekday($date)] . ' ' . (int) substr($date, 8, 2) . ' ' . self::MONTHS[(int) substr($date, 5, 2)];
    }

    public static function dateSpan(string $a, string $b): string
    {
        return $a === $b ? self::dayLabel($a) : self::dayLabel($a) . ' – ' . self::dayLabel($b);
    }

    /** Hours to one decimal without a trailing '.0': 7.5h, 8h. */
    public static function hours(int $secs): string
    {
        $h = round($secs / 3600, 1);
        return rtrim(rtrim(number_format($h, 1, '.', ''), '0'), '.') . 'h';
    }

    // ---- warnings -------------------------------------------------------------------------------------------------------------------------

    /**
     * Daily rest: in the 24 hours before $start, is there a continuous break of at least $min seconds? Split shifts on one day are fine as
     * long as the long rest falls in that window. Returns the rest immediately before the shift when the rule is broken, else null.
     * @param list<array{0:int,1:int}> $others the person's other shifts as [start, end]
     */
    public static function restShortfall(array $others, int $start, int $min): ?int
    {
        $w0 = $start - 86400;
        $iv = [];
        foreach ($others as [$s, $e]) {
            if ($e > $w0 && $s < $start) {
                $iv[] = [max($s, $w0), min($e, $start)];
            }
        }
        if ($iv === []) {
            return null;
        }
        usort($iv, static fn (array $a, array $b): int => $a[0] <=> $b[0]);
        $cursor = $w0;
        $maxGap = 0;
        foreach ($iv as [$a, $b]) {
            $maxGap = max($maxGap, $a - $cursor);
            $cursor = max($cursor, $b);
        }
        $last = $start - $cursor;
        $maxGap = max($maxGap, $last);
        return $maxGap < $min ? max(0, $last) : null;
    }

    /**
     * Approved leave covering any part of [s, e). Leave dates are inclusive local days in $tz.
     * @param list<array<string,mixed>> $leave rows with staff_profile_id, start_date, end_date, status, type
     */
    public static function leaveHit(array $leave, string $staff, int $s, int $e, string $tz): ?array
    {
        foreach ($leave as $l) {
            if ($l['staff_profile_id'] !== $staff || $l['status'] !== 'approved') {
                continue;
            }
            $from = self::localTs((string) $l['start_date'], '00:00', $tz);
            $to = self::localTs(self::addDays((string) $l['end_date'], 1), '00:00', $tz);
            if ($from < $e && $to > $s) {
                return $l;
            }
        }
        return null;
    }

    /**
     * The first 'unavailable' entry overlapping [s, e), checking each local day the shift touches (at most three). A one-off date matches
     * that day; a recurring weekday (0 = Sunday) matches that weekday. No times means the whole day; an end at or before the start runs
     * past midnight.
     * @param list<array<string,mixed>> $rows availability rows
     * @return array{entry:array<string,mixed>,day:string}|null
     */
    public static function unavailableHit(array $rows, string $staff, int $s, int $e, string $tz): ?array
    {
        $mine = array_values(array_filter($rows, static fn (array $a): bool => $a['staff_profile_id'] === $staff && $a['status'] === 'unavailable'));
        if ($mine === []) {
            return null;
        }
        $day = self::localParts($s, $tz)[0];
        $last = self::localParts($e - 1, $tz)[0];
        for ($i = 0; $i < 3 && self::daysBetween($day, $last) >= 0; $i++, $day = self::addDays($day, 1)) {
            $dow = self::isoWeekday($day) % 7;
            foreach ($mine as $a) {
                $applies = $a['date'] !== null ? $a['date'] === $day : ((bool) $a['recurring'] && $a['weekday'] !== null && (int) $a['weekday'] === $dow);
                if (!$applies) {
                    continue;
                }
                if ($a['start_time'] === null || $a['end_time'] === null) {
                    $ws = self::localTs($day, '00:00', $tz);
                    $we = self::localTs(self::addDays($day, 1), '00:00', $tz);
                } else {
                    $st = substr((string) $a['start_time'], 0, 5);
                    $et = substr((string) $a['end_time'], 0, 5);
                    $ws = self::localTs($day, $st, $tz);
                    $we = self::localTs($et <= $st ? self::addDays($day, 1) : $day, $et, $tz);
                }
                if ($ws < $e && $we > $s) {
                    return ['entry' => $a, 'day' => $day];
                }
            }
        }
        return null;
    }

    /**
     * Warnings for each target shift, measured against the context (the person's other shifts the rota is read with). Cancelled and open
     * shifts never warn and never count. Leave and availability are read in the shift's own zone ('timezone', else $orgTz); weeks run
     * Monday to Sunday in $orgTz.
     * @param list<array<string,mixed>> $targets
     * @param list<array<string,mixed>> $context
     * @param list<array<string,mixed>> $leave
     * @param list<array<string,mixed>> $availability
     * @return array<string, list<array{code:string,message:string}>>
     */
    public static function warnings(array $targets, array $context, array $leave, array $availability, int $minRestHours, int $maxWeeklyHours, string $orgTz): array
    {
        $live = static fn (array $x): bool => ($x['status'] ?? '') !== 'cancelled' && ($x['staff_profile_id'] ?? null) !== null;
        $byId = [];
        foreach ([...$context, ...$targets] as $x) {
            if ($live($x)) {
                $byId[(string) $x['id']] = $x;
            }
        }
        $byPerson = [];
        foreach ($byId as $x) {
            $byPerson[(string) $x['staff_profile_id']][] = ['id' => (string) $x['id'], 's' => self::ts((string) $x['starts_at']), 'e' => self::ts((string) $x['ends_at']), 'b' => (int) ($x['break_minutes'] ?? 0)];
        }
        $out = [];
        foreach ($targets as $t) {
            if (!$live($t)) {
                continue;
            }
            $id = (string) $t['id'];
            $staff = (string) $t['staff_profile_id'];
            $tz = self::validZone($t['timezone'] ?? null) ? (string) $t['timezone'] : $orgTz;
            $s = self::ts((string) $t['starts_at']);
            $e = self::ts((string) $t['ends_at']);
            $mine = $byPerson[$staff] ?? [];
            $w = [];
            if (($l = self::leaveHit($leave, $staff, $s, $e, $tz)) !== null) {
                $kind = trim((string) $l['type']) === '' ? 'leave' : strtolower(trim((string) $l['type']));
                $w[] = ['code' => 'leave', 'message' => "On approved $kind (" . self::dateSpan((string) $l['start_date'], (string) $l['end_date']) . ')'];
            }
            if (($u = self::unavailableHit($availability, $staff, $s, $e, $tz)) !== null) {
                $a = $u['entry'];
                $times = $a['start_time'] !== null && $a['end_time'] !== null ? ' ' . substr((string) $a['start_time'], 0, 5) . '–' . substr((string) $a['end_time'], 0, 5) : ' all day';
                $when = $a['date'] !== null ? self::dayLabel($u['day']) : self::PLURAL_DAYS[(int) $a['weekday']];
                $w[] = ['code' => 'unavailable', 'message' => "Declared unavailable $when$times"];
            }
            if ($minRestHours > 0) {
                $others = [];
                foreach ($mine as $x) {
                    if ($x['id'] !== $id) {
                        $others[] = [$x['s'], $x['e']];
                    }
                }
                if (($gap = self::restShortfall($others, $s, $minRestHours * 3600)) !== null) {
                    $w[] = ['code' => 'rest', 'message' => 'Only ' . self::hours($gap) . " rest before this shift (minimum {$minRestHours}h in any 24 hours)"];
                }
            }
            $week = self::weekOf($s, $orgTz);
            $secs = 0;
            foreach ($mine as $x) {
                if (self::weekOf($x['s'], $orgTz) === $week) {
                    $secs += max(0, $x['e'] - $x['s'] - $x['b'] * 60);
                }
            }
            if ($secs > $maxWeeklyHours * 3600) {
                $w[] = ['code' => 'weekly_hours', 'message' => self::hours($secs) . ' scheduled in the week of ' . self::dayLabel($week) . " (limit {$maxWeeklyHours}h)"];
            }
            if ($w !== []) {
                $out[$id] = $w;
            }
        }
        return $out;
    }

    /**
     * The organisation's two limits from organisations.settings (min_rest_hours 0-24, max_weekly_hours 1-168, as Settings → Policies
     * stores them), falling back to 11 and 48 when unset or out of range.
     * @return array{0:int,1:int} [min rest hours, max weekly hours]
     */
    public static function limits(?string $settingsJson): array
    {
        $s = json_decode((string) $settingsJson, true);
        $s = is_array($s) ? $s : [];
        $rest = $s['min_rest_hours'] ?? null;
        $week = $s['max_weekly_hours'] ?? null;
        return [
            (is_int($rest) || is_float($rest)) && $rest >= 0 && $rest <= 24 ? (int) round($rest) : self::DEFAULT_MIN_REST_HOURS,
            (is_int($week) || is_float($week)) && $week >= 1 && $week <= 168 ? (int) round($week) : self::DEFAULT_MAX_WEEKLY_HOURS,
        ];
    }

    // ---- patterns -------------------------------------------------------------------------------------------------------------------------

    /**
     * Checks a pattern body and returns the rule, or throws 422 with the sentence the browser's patternError would show.
     * @return array{kind:string,weekdays:list<int>,days_on:int,days_off:int,cycle_start:string,from:string,to:string,blocks:list<array{start:string,end:string}>,break_minutes:int}
     */
    public static function patternRule(array $in, string $periodStart, string $periodEnd): array
    {
        $from = $in['from_date'] ?? null;
        $to = $in['to_date'] ?? null;
        if (!self::validDate($from) || !self::validDate($to)) {
            throw HttpError::invalid('Choose the first and last date.');
        }
        $days = self::daysBetween($from, $to) + 1;
        if ($days < 1) {
            throw HttpError::invalid('The last date must be on or after the first date.');
        }
        if ($days > self::MAX_PATTERN_DAYS) {
            throw HttpError::invalid('A pattern can cover at most ' . self::MAX_PATTERN_DAYS . ' days at a time.');
        }
        if ($from < $periodStart || $to > $periodEnd) {
            throw HttpError::invalid('The dates must fall inside this rota’s period.');
        }
        $kind = $in['kind'] ?? null;
        $rule = ['kind' => $kind, 'weekdays' => [], 'days_on' => 0, 'days_off' => 0, 'cycle_start' => $from, 'from' => $from, 'to' => $to];
        if ($kind === 'weekly') {
            $wd = $in['weekdays'] ?? null;
            if (!is_array($wd) || !array_is_list($wd) || $wd === [] || count($wd) > 7 || array_filter($wd, static fn (mixed $d): bool => !is_int($d) || $d < 1 || $d > 7) !== []) {
                throw HttpError::invalid('Choose at least one day of the week (1 = Monday to 7 = Sunday).');
            }
            $wd = array_values(array_unique($wd));
            sort($wd);
            $rule['weekdays'] = $wd;
        } elseif ($kind === 'cycle') {
            $on = $in['days_on'] ?? null;
            $off = $in['days_off'] ?? null;
            if (!is_int($on) || !is_int($off) || $on < 1 || $on > 28 || $off < 1 || $off > 28) {
                throw HttpError::invalid('Days on and days off must be whole numbers from 1 to 28.');
            }
            $anchor = $in['cycle_start'] ?? $from;
            if (!self::validDate($anchor)) {
                throw HttpError::invalid('Choose the day the cycle starts.');
            }
            if ($anchor > $from) {
                throw HttpError::invalid('The cycle must start on or before the first date.');
            }
            $rule['days_on'] = $on;
            $rule['days_off'] = $off;
            $rule['cycle_start'] = $anchor;
        } else {
            throw HttpError::invalid('kind must be "weekly" or "cycle".');
        }
        $blocks = $in['blocks'] ?? null;
        if (!is_array($blocks) || !array_is_list($blocks) || count($blocks) < 1 || count($blocks) > self::MAX_BLOCKS) {
            throw HttpError::invalid('Give one to six time blocks.');
        }
        $clean = [];
        foreach ($blocks as $b) {
            if (!is_array($b) || !self::validTime($b['start'] ?? null) || !self::validTime($b['end'] ?? null) || $b['start'] === $b['end']) {
                throw HttpError::invalid('Each time block needs a start and a different finish time.');
            }
            $clean[] = ['start' => $b['start'], 'end' => $b['end']];
        }
        $brk = $in['break_minutes'] ?? 0;
        if (!is_int($brk) || $brk < 0 || $brk > 1440) {
            throw HttpError::invalid('Break must be a whole number of minutes.');
        }
        foreach ($clean as $b) {
            if ($brk >= self::lengthMinutes($b['start'], $b['end'])) {
                throw HttpError::invalid('The break must be shorter than each time block.');
            }
        }
        $rule['blocks'] = $clean;
        $rule['break_minutes'] = $brk;
        $n = count(self::expand($rule));
        if ($n === 0) {
            throw HttpError::invalid('That pattern has no working days in the chosen dates.');
        }
        if ($n > self::MAX_PATTERN_SHIFTS) {
            throw HttpError::invalid("That pattern would make $n shifts; the limit is " . self::MAX_PATTERN_SHIFTS . ' at a time.');
        }
        return $rule;
    }

    /**
     * Every local shift a checked rule makes, in date then block order.
     * @return list<array{date:string,start:string,end_date:string,end:string}>
     */
    public static function expand(array $rule): array
    {
        $days = self::daysBetween($rule['from'], $rule['to']) + 1;
        $set = array_flip($rule['weekdays']);
        $cycle = $rule['days_on'] + $rule['days_off'];
        $out = [];
        for ($i = 0; $i < $days; $i++) {
            $date = self::addDays($rule['from'], $i);
            $works = $rule['kind'] === 'weekly' ? isset($set[self::isoWeekday($date)]) : ($cycle > 0 && self::daysBetween($rule['cycle_start'], $date) % $cycle < $rule['days_on']);
            if (!$works) {
                continue;
            }
            foreach ($rule['blocks'] as $b) {
                $out[] = ['date' => $date, 'start' => $b['start'], 'end_date' => $b['end'] <= $b['start'] ? self::addDays($date, 1) : $date, 'end' => $b['end']];
            }
        }
        return $out;
    }

    public static function lengthMinutes(string $start, string $end): int
    {
        if (!self::validTime($start) || !self::validTime($end)) {
            return 0;
        }
        $d = ((int) substr($end, 0, 2) * 60 + (int) substr($end, 3, 2)) - ((int) substr($start, 0, 2) * 60 + (int) substr($start, 3, 2));
        return $d < 0 ? $d + 1440 : $d;
    }

    // ---- helpers --------------------------------------------------------------------------------------------------------------------------

    /** Unix seconds from a UTC 'Y-m-d H:i:s' or an ISO instant with an offset. */
    public static function ts(string $v): int
    {
        if (preg_match('/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/', $v) === 1) {
            return (int) strtotime($v . ' UTC');
        }
        return (new \DateTimeImmutable($v))->getTimestamp();
    }

    private static function dayNumber(string $date): int
    {
        [$y, $m, $d] = array_map('intval', explode('-', $date));
        return intdiv(gmmktime(12, 0, 0, $m, $d, $y), 86400);
    }
}
