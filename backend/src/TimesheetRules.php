<?php
declare(strict_types=1);

namespace RotaFlow;

/**
 * Timesheet lines, tolerance flags and the payroll CSV (R2 slice S13). Pure: no database, no clock, no I/O.
 *
 * Ported from SiteRelay backend/src/Mod/Timesheets.php (compute, workedMinutes, csvCell, csv, hours) and re-made for RotaFlow's rows: a
 * line is one shift with a staff record, its recorded times come from paired clock_events (not a visit), and the approved figure stays
 * RotaFlow's per-person period approval (timesheets.total_minutes), so SiteRelay's per-line adjust/unlock model is not ported.
 *
 * Money and hours are integers all the way: instants are UTC milliseconds, minutes are whole minutes (floor of the exact difference),
 * and decimal hours are produced from integer minutes by integer arithmetic, so nothing drifts and the clock changes are exact.
 */
final class TimesheetRules
{
    public const DEFAULT_TOLERANCE = 10;
    public const MAX_TOLERANCE = 120;
    public const MAX_DAYS = 31;
    /** A clock-in from this long before a shift starts up to its scheduled end can belong to it (the browser's pickSegmentForShift rule). */
    public const EARLY_ARRIVAL_MS = 3 * 3600 * 1000;
    public const FLAGS = ['late', 'early_finish', 'overtime', 'no_clock_in', 'missing_clock_out'];

    /** The payroll CSV's columns, in their fixed order. Documented in docs/API-SPEC.md; changing it breaks payroll imports. */
    public const COLUMNS = [
        'Staff name', 'Payroll ID', 'Staff ID', 'Period start', 'Period end', 'Approved minutes', 'Approved hours', 'Status', 'Version',
        'Approved by', 'Approved at', 'Recalculation required', 'Late lines', 'Early finish lines', 'Overtime lines', 'Time zone',
    ];

    // ---- settings -------------------------------------------------------------------------------------------------------------------------

    /** organisations.settings.timesheet_tolerance_minutes: a whole number 0-120, else 10. */
    public static function tolerance(?string $settingsJson): int
    {
        $s = json_decode((string) $settingsJson, true);
        $v = is_array($s) ? ($s['timesheet_tolerance_minutes'] ?? null) : null;
        return is_int($v) && $v >= 0 && $v <= self::MAX_TOLERANCE ? $v : self::DEFAULT_TOLERANCE;
    }

    /** organisations.settings.breaks_are_paid (Settings -> Policies). Unset or not a boolean reads as false, the default. */
    public static function breaksPaid(?string $settingsJson): bool
    {
        $s = json_decode((string) $settingsJson, true);
        return is_array($s) && ($s['breaks_are_paid'] ?? null) === true;
    }

    // ---- time -----------------------------------------------------------------------------------------------------------------------------

    /** UTC milliseconds from a database value ('Y-m-d H:i:s' or 'Y-m-d H:i:s.fff', always UTC) or an ISO instant carrying an offset. */
    public static function ms(string $v): int
    {
        if (preg_match('/^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,6}))?$/', $v, $m) === 1) {
            $sec = gmmktime((int) $m[4], (int) $m[5], (int) $m[6], (int) $m[2], (int) $m[3], (int) $m[1]);
            $frac = isset($m[7]) ? (int) substr(str_pad($m[7], 3, '0'), 0, 3) : 0;
            return $sec * 1000 + $frac;
        }
        $d = new \DateTimeImmutable($v, new \DateTimeZone('UTC'));
        return $d->getTimestamp() * 1000 + intdiv((int) $d->format('u'), 1000);
    }

    public static function isoMs(int $ms): string
    {
        return gmdate('Y-m-d\TH:i:s\Z', intdiv($ms, 1000));
    }

    /** Whole minutes between two instants minus an unpaid break, never below zero. Floor of the exact difference, not of each end. */
    public static function workedMinutes(int $fromMs, int $toMs, int $breakMinutes): int
    {
        return max(0, intdiv(max(0, $toMs - $fromMs), 60000) - $breakMinutes);
    }

    /** Whole minutes a clock-in is after the scheduled start: the floor of the exact difference, never below 0. Mirrors timesheetRules.ts. */
    public static function lateMinutes(int $inMs, int $startMs): int
    {
        return intdiv(max(0, $inMs - $startMs), 60000);
    }

    /**
     * Late beyond the tolerance: more than $tol whole minutes after the start (10 min 59 s is 10, not late at 10). The late flag on a line,
     * and (owner decision, 31 Oct 2026; only with timesheet_tools on) the browser's row status "Late" by its mirror isLate in
     * src/lib/timesheetRules.ts, so the two never disagree.
     */
    public static function isLate(int $inMs, int $startMs, int $tol): bool
    {
        return self::lateMinutes($inMs, $startMs) > $tol;
    }

    /** Minutes as decimal hours with two places, by integer rounding (half up): 450 -> "7.50", 205 -> "3.42", 7 -> "0.12". */
    public static function hours(int $minutes): string
    {
        $neg = $minutes < 0;
        $hundredths = intdiv(abs($minutes) * 100 + 30, 60);
        return ($neg && $hundredths > 0 ? '-' : '') . intdiv($hundredths, 100) . '.' . str_pad((string) ($hundredths % 100), 2, '0', STR_PAD_LEFT);
    }

    /**
     * The local dates a request asks for, as [from, to] when valid, or a sentence when not: both real dates, to on or after from, at most
     * 31 days inclusive.
     * @return array{0:string,1:string}|string
     */
    public static function range(mixed $from, mixed $to): array|string
    {
        if (!SchedulingRules::validDate($from) || !SchedulingRules::validDate($to)) {
            return 'period_start and period_end are required dates, like 2030-04-01';
        }
        $days = SchedulingRules::daysBetween($from, $to) + 1;
        if ($days < 1) {
            return 'The period cannot end before it starts';
        }
        if ($days > self::MAX_DAYS) {
            return 'Choose at most ' . self::MAX_DAYS . ' days';
        }
        return [$from, $to];
    }

    /**
     * The UTC window [start, end) in milliseconds for local dates from..to inclusive in $tz, by S11's localTs (two-pass offset), so a week
     * that contains a clock change is 167 or 169 hours long, not 168.
     * @return array{0:int,1:int}
     */
    public static function window(string $from, string $to, string $tz): array
    {
        return [SchedulingRules::localTs($from, '00:00', $tz) * 1000, SchedulingRules::localTs(SchedulingRules::addDays($to, 1), '00:00', $tz) * 1000];
    }

    // ---- lines ----------------------------------------------------------------------------------------------------------------------------

    /**
     * One person's clock events paired into [in, out] segments, in time order. A second 'in' while one is open closes the first with no
     * clock-out (missing); an 'out' with nothing open is ignored; break events do not pair. Ties in time keep the given order.
     * @param list<array{id?:string,type:string,event_at:string}> $events
     * @return list<array{in:int,out:?int}>
     */
    public static function segments(array $events): array
    {
        $rows = [];
        foreach (array_values($events) as $i => $e) {
            if ($e['type'] === 'in' || $e['type'] === 'out') {
                $rows[] = [self::ms((string) $e['event_at']), $i, $e['type']];
            }
        }
        usort($rows, static fn (array $a, array $b): int => [$a[0], $a[1]] <=> [$b[0], $b[1]]);
        $out = [];
        $open = null;
        foreach ($rows as [$t, , $type]) {
            if ($type === 'in') {
                if ($open !== null) {
                    $out[] = ['in' => $open, 'out' => null];
                }
                $open = $t;
            } elseif ($open !== null) {
                $out[] = ['in' => $open, 'out' => $t];
                $open = null;
            }
        }
        if ($open !== null) {
            $out[] = ['in' => $open, 'out' => null];
        }
        return $out;
    }

    /**
     * Which segment belongs to which shift, for one person. Shifts are taken in start order; each takes the unused segment whose clock-in
     * is from 3 hours before its start to its end, closest to the start (the earlier one on a tie). A segment is used once, so one clock-in
     * never answers for two shifts.
     * @param list<array{id:string,starts_at:string,ends_at:string}> $shifts
     * @param list<array{in:int,out:?int}> $segments
     * @return array<string, array{in:int,out:?int}|null> by shift id
     */
    public static function assign(array $shifts, array $segments): array
    {
        usort($shifts, static fn (array $a, array $b): int => [self::ms($a['starts_at']), $a['id']] <=> [self::ms($b['starts_at']), $b['id']]);
        $used = [];
        $res = [];
        foreach ($shifts as $s) {
            $start = self::ms($s['starts_at']);
            $end = self::ms($s['ends_at']);
            $best = null;
            foreach ($segments as $k => $seg) {
                if (isset($used[$k]) || $seg['in'] < $start - self::EARLY_ARRIVAL_MS || $seg['in'] > $end) {
                    continue;
                }
                if ($best === null || abs($seg['in'] - $start) < abs($segments[$best]['in'] - $start)) {
                    $best = $k;
                }
            }
            if ($best !== null) {
                $used[$best] = true;
            }
            $res[(string) $s['id']] = $best === null ? null : $segments[$best];
        }
        return $res;
    }

    /**
     * One line: the shift's scheduled minutes next to the recorded minutes, with the scheduled break deducted from both (unless the
     * organisation pays breaks), and the flags. Late, early finish and overtime are raised only beyond the tolerance, in whole minutes:
     * late when the clock-in is more than $tol whole minutes after the start; early finish when the clock-out is more than $tol whole
     * minutes before the end; overtime when the recorded minutes exceed the scheduled minutes by more than $tol. No clock-in and a missing
     * clock-out are raised only once the shift has ended.
     * @param array{id:string,staff_profile_id:string,location_id?:?string,starts_at:string,ends_at:string,break_minutes:int|string} $shift
     * @param array{in:int,out:?int}|null $seg
     * @return array<string,mixed>
     */
    public static function line(array $shift, ?array $seg, int $nowMs, int $tol, bool $breaksPaid): array
    {
        $start = self::ms($shift['starts_at']);
        $end = self::ms($shift['ends_at']);
        $break = $breaksPaid ? 0 : max(0, (int) $shift['break_minutes']);
        $in = $seg['in'] ?? null;
        $out = $seg['out'] ?? null;
        $scheduled = self::workedMinutes($start, $end, $break);
        $recorded = $in !== null && $out !== null ? self::workedMinutes($in, $out, $break) : null;
        $late = $in !== null ? self::lateMinutes($in, $start) : 0;
        $early = $out !== null ? intdiv(max(0, $end - $out), 60000) : 0;
        $finished = $nowMs >= $end;
        return [
            'shift_id' => (string) $shift['id'],
            'staff_profile_id' => (string) $shift['staff_profile_id'],
            'location_id' => $shift['location_id'] ?? null,
            'scheduled_start' => self::isoMs($start),
            'scheduled_end' => self::isoMs($end),
            'break_minutes' => $break,
            'clock_in' => $in !== null ? self::isoMs($in) : null,
            'clock_out' => $out !== null ? self::isoMs($out) : null,
            'scheduled_minutes' => $scheduled,
            'recorded_minutes' => $recorded,
            'variance_minutes' => $recorded !== null ? $recorded - $scheduled : null,
            'late_minutes' => $late,
            'early_minutes' => $early,
            'finished' => $finished,
            'flags' => [
                'late' => $in !== null && self::isLate($in, $start, $tol),
                'early_finish' => $out !== null && $early > $tol,
                'overtime' => $recorded !== null && $recorded > $scheduled + $tol,
                'no_clock_in' => $in === null && $finished,
                'missing_clock_out' => $in !== null && $out === null && $finished,
            ],
        ];
    }

    // ---- CSV ------------------------------------------------------------------------------------------------------------------------------

    /**
     * A formula-injection-safe CSV cell with RFC 4180 quoting. Text that starts with = + - @ tab or CR gets a leading apostrophe, so a
     * spreadsheet reads it as text; integers we computed ourselves are written as numbers. A cell is quoted when it holds a comma, a quote,
     * CR or LF, or leading or trailing space.
     */
    public static function csvCell(string|int|null $v): string
    {
        if ($v === null) {
            return '';
        }
        if (is_int($v)) {
            return (string) $v;
        }
        if ($v !== '' && in_array($v[0], ['=', '+', '-', '@', "\t", "\r"], true)) {
            $v = "'" . $v;
        }
        return preg_match('/[",\r\n]/', $v) === 1 || $v !== trim($v) ? '"' . str_replace('"', '""', $v) . '"' : $v;
    }

    /**
     * The payroll download's file name: rotaflow-timesheets-<org slug>-<start>-<end>.csv in safe ASCII. The slug is lower-cased, anything
     * but a-z, 0-9 and '-' becomes '-', runs of '-' collapse, ends are trimmed, at most 60 characters; empty reads as 'organisation'. The
     * dates are the validated range. Mirrored by payrollFilename in src/lib/timesheetRules.ts.
     */
    public static function exportFilename(?string $slug, string $from, string $to): string
    {
        $s = trim((string) preg_replace('/-+/', '-', (string) preg_replace('/[^a-z0-9-]/', '-', strtolower((string) $slug))), '-');
        $s = rtrim(substr($s, 0, 60), '-');
        return 'rotaflow-timesheets-' . ($s === '' ? 'organisation' : $s) . "-$from-$to.csv";
    }

    /** UTF-8 with a byte-order mark (so spreadsheet programs read names correctly) and CRLF line ends. @param list<list<string|int|null>> $rows */
    public static function csv(array $rows): string
    {
        $out = "\xEF\xBB\xBF";
        foreach ($rows as $r) {
            $out .= implode(',', array_map(self::csvCell(...), $r)) . "\r\n";
        }
        return $out;
    }
}
