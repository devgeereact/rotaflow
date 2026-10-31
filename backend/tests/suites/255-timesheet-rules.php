<?php
declare(strict_types=1);

// Timesheet rules (R2 slice S13), pure: worked minutes, decimal hours, the UTC window of local dates across the clock changes, pairing clock
// events, matching segments to shifts, the tolerance flags at their exact boundaries, the tolerance setting, and the formula-safe CSV.
// Ports SiteRelay's 081-timesheets pure cases. The endpoint cases are suite 260-timesheets.
use RotaFlow\TimesheetRules as T;

$LON = 'Europe/London';
$ms = static fn (string $utc): int => T::ms($utc);
$shift = static fn (string $s, string $e, int $brk = 0, string $id = 'S1'): array => ['id' => $id, 'staff_profile_id' => 'P1', 'location_id' => null, 'starts_at' => $s, 'ends_at' => $e, 'break_minutes' => $brk];
$later = $ms('2040-01-01 00:00:00');

// ---- minutes and hours ------------------------------------------------------------------------------------------------------------------
check('worked minutes subtract the break and never go below zero', T::workedMinutes(0, 4 * 3600000, 30) === 210 && T::workedMinutes(0, 600000, 30) === 0 && T::workedMinutes(100000, 0, 0) === 0);
check('worked minutes floor the exact difference (59.999 s is 0, 1 min 59.999 s is 1)', T::workedMinutes(0, 59999, 0) === 0 && T::workedMinutes(0, 119999, 0) === 1 && T::workedMinutes(500, 60500, 0) === 1);
check('instants parse as UTC with milliseconds, and ISO with an offset', $ms('2026-10-25 01:30:00') === gmmktime(1, 30, 0, 10, 25, 2026) * 1000 && $ms('2026-10-25 01:30:00.250') === gmmktime(1, 30, 0, 10, 25, 2026) * 1000 + 250 && $ms('2026-10-25T02:30:00+01:00') === gmmktime(1, 30, 0, 10, 25, 2026) * 1000 && $ms('2026-10-25T01:30:00Z') === gmmktime(1, 30, 0, 10, 25, 2026) * 1000);
foreach ([450 => '7.50', 180 => '3.00', 205 => '3.42', 0 => '0.00', 7 => '0.12', 1 => '0.02', 59 => '0.98', 61 => '1.02', 100000 => '1666.67', 2430 => '40.50'] as $min => $want) {
    check("hours: $min minutes -> $want", T::hours($min) === $want, T::hours($min));
}
$drift = true;
for ($m = 0; $m <= 6000; $m++) {
    $exact = intdiv($m * 100 + 30, 60); // reference: round-half-up of m/60 to hundredths in integers
    if (T::hours($m) !== sprintf('%d.%02d', intdiv($exact, 100), $exact % 100)) { $drift = false; break; }
}
check('hours: every minute from 0 to 6000 matches the integer reference (no float drift)', $drift);

// ---- the window of local dates ----------------------------------------------------------------------------------------------------------
[$a, $b] = T::window('2026-10-25', '2026-10-25', $LON);
check('window: Sunday 25 Oct 2026 in London is 25 hours (clocks go back)', $b - $a === 25 * 3600000 && T::isoMs($a) === '2026-10-24T23:00:00Z' && T::isoMs($b) === '2026-10-26T00:00:00Z');
[$a, $b] = T::window('2026-03-29', '2026-03-29', $LON);
check('window: Sunday 29 Mar 2026 in London is 23 hours (clocks go forward)', $b - $a === 23 * 3600000);
[$a, $b] = T::window('2026-10-19', '2026-10-25', $LON);
check('window: the week of 19 Oct 2026 is 169 hours, starting at local midnight (23:00 UTC)', $b - $a === 169 * 3600000 && T::isoMs($a) === '2026-10-18T23:00:00Z');
[$a, $b] = T::window('2026-01-05', '2026-01-11', 'America/New_York');
check('window: another zone uses its own midnight', T::isoMs($a) === '2026-01-05T05:00:00Z' && $b - $a === 168 * 3600000);

// ---- the range a request asks for -----------------------------------------------------------------------------------------------------------
check('range: 31 days inclusive is allowed, 32 is not', T::range('2026-10-01', '2026-10-31') === ['2026-10-01', '2026-10-31'] && is_string(T::range('2026-10-01', '2026-11-01')));
check('range: one day is allowed; to before from, a bad date, a time, or nothing are refused', T::range('2026-10-05', '2026-10-05') === ['2026-10-05', '2026-10-05'] && is_string(T::range('2026-10-25', '2026-10-19')) && is_string(T::range('2026-02-30', '2026-03-01')) && is_string(T::range('2026-10-19T00:00:00Z', '2026-10-25')) && is_string(T::range(null, null)) && is_string(T::range(['x'], '2026-10-25')));

// ---- lines: clock changes and breaks ------------------------------------------------------------------------------------------------------
$dst = T::line($shift('2026-10-24 21:00:00', '2026-10-25 06:00:00', 30), ['in' => $ms('2026-10-24 21:00:00'), 'out' => $ms('2026-10-25 06:00:00')], $later, 10, false);
check('line: 22:00 BST to 06:00 GMT on 24/25 Oct 2026 is 9 hours, 510 minutes after a 30 minute break, on both sides', $dst['scheduled_minutes'] === 510 && $dst['recorded_minutes'] === 510 && $dst['variance_minutes'] === 0 && $dst['flags']['overtime'] === false, json_encode($dst));
$spring = T::line($shift('2026-03-28 22:00:00', '2026-03-29 05:00:00'), null, $later, 10, false);
check('line: 22:00 GMT to 06:00 BST on 28/29 Mar 2026 is 7 hours; no clock-in once finished', $spring['scheduled_minutes'] === 420 && $spring['recorded_minutes'] === null && $spring['flags']['no_clock_in'] === true && $spring['flags']['missing_clock_out'] === false);
$paid = T::line($shift('2030-04-01 08:00:00', '2030-04-01 12:00:00', 30), ['in' => $ms('2030-04-01 08:00:00'), 'out' => $ms('2030-04-01 12:00:00')], $later, 10, true);
check('line: when breaks are paid nothing is deducted from either side', $paid['scheduled_minutes'] === 240 && $paid['recorded_minutes'] === 240 && $paid['break_minutes'] === 0);
$l1 = T::line($shift('2030-04-01 08:00:00', '2030-04-01 12:00:00', 30), ['in' => $ms('2030-04-01 08:05:00'), 'out' => $ms('2030-04-01 12:00:00')], $later, 10, false);
check('line: scheduled vs recorded with a break (210 vs 205, variance -5, five minutes late is within tolerance)', $l1['scheduled_minutes'] === 210 && $l1['recorded_minutes'] === 205 && $l1['variance_minutes'] === -5 && $l1['late_minutes'] === 5 && $l1['flags']['late'] === false);
$open = T::line($shift('2030-04-01 08:00:00', '2030-04-01 12:00:00'), ['in' => $ms('2030-04-01 08:00:00'), 'out' => null], $ms('2030-04-01 10:00:00'), 10, false);
check('line: a shift still running is not missing a clock-out yet, and has no recorded minutes', $open['finished'] === false && $open['flags']['missing_clock_out'] === false && $open['recorded_minutes'] === null);
$gone = T::line($shift('2030-04-01 08:00:00', '2030-04-01 12:00:00'), ['in' => $ms('2030-04-01 08:00:00'), 'out' => null], $ms('2030-04-01 12:00:00'), 10, false);
check('line: at the scheduled end it is finished and the missing clock-out is flagged', $gone['finished'] === true && $gone['flags']['missing_clock_out'] === true);
check('line: a shift not yet ended with no clock-in is not flagged', T::line($shift('2030-04-01 08:00:00', '2030-04-01 12:00:00'), null, $ms('2030-04-01 11:59:59'), 10, false)['flags']['no_clock_in'] === false);

// ---- tolerance boundaries ---------------------------------------------------------------------------------------------------------------------
$at = static fn (string $in, string $out, int $tol = 10): array => T::line($shift('2030-04-01 09:00:00', '2030-04-01 17:00:00'), ['in' => $ms($in), 'out' => $ms($out)], $ms('2040-01-01 00:00:00'), $tol, false)['flags'];
check('late: exactly 10 minutes is within a 10 minute tolerance', $at('2030-04-01 09:10:00', '2030-04-01 17:00:00')['late'] === false);
check('late: 10 min 59 s is still 10 whole minutes, within tolerance', $at('2030-04-01 09:10:59.999', '2030-04-01 17:00:00')['late'] === false);
check('late: 11 minutes is late', $at('2030-04-01 09:11:00', '2030-04-01 17:00:00')['late'] === true);
check('late: early arrival is never late', $at('2030-04-01 08:30:00', '2030-04-01 17:00:00')['late'] === false);
check('late: with no tolerance, one whole minute is late and 59 seconds is not', $at('2030-04-01 09:01:00', '2030-04-01 17:00:00', 0)['late'] === true && $at('2030-04-01 09:00:59', '2030-04-01 17:00:00', 0)['late'] === false);
check('early finish: exactly 10 minutes early is within tolerance, 11 is an early finish', $at('2030-04-01 09:00:00', '2030-04-01 16:50:00')['early_finish'] === false && $at('2030-04-01 09:00:00', '2030-04-01 16:49:00')['early_finish'] === true);
check('early finish: 10 min 59 s early is 10 whole minutes, within tolerance', $at('2030-04-01 09:00:00', '2030-04-01 16:49:00.001')['early_finish'] === false);
check('overtime: 10 minutes over the schedule is within tolerance, 11 is overtime', $at('2030-04-01 09:00:00', '2030-04-01 17:10:00')['overtime'] === false && $at('2030-04-01 09:00:00', '2030-04-01 17:11:00')['overtime'] === true);
check('overtime: arriving early counts too (in at 08:40, out at 17:00 is 20 over)', $at('2030-04-01 08:40:00', '2030-04-01 17:00:00')['overtime'] === true);
check('a larger tolerance widens every flag', $at('2030-04-01 09:20:00', '2030-04-01 16:40:00', 30) === ['late' => false, 'early_finish' => false, 'overtime' => false, 'no_clock_in' => false, 'missing_clock_out' => false]);

// ---- the tolerance setting --------------------------------------------------------------------------------------------------------------------
check('tolerance: unset is 10; a whole number 0-120 is used', T::tolerance(null) === 10 && T::tolerance('{}') === 10 && T::tolerance('{"timesheet_tolerance_minutes":5}') === 5 && T::tolerance('{"timesheet_tolerance_minutes":0}') === 0 && T::tolerance('{"timesheet_tolerance_minutes":120}') === 120);
check('tolerance: a fraction, text, a negative or more than 120 falls back to 10', T::tolerance('{"timesheet_tolerance_minutes":7.5}') === 10 && T::tolerance('{"timesheet_tolerance_minutes":"15"}') === 10 && T::tolerance('{"timesheet_tolerance_minutes":-1}') === 10 && T::tolerance('{"timesheet_tolerance_minutes":121}') === 10 && T::tolerance('not json') === 10);
check('breaks paid: only a true boolean', T::breaksPaid('{"breaks_are_paid":true}') === true && T::breaksPaid('{"breaks_are_paid":1}') === false && T::breaksPaid(null) === false);

// ---- pairing and matching ---------------------------------------------------------------------------------------------------------------------
$ev = static fn (string $type, string $at): array => ['type' => $type, 'event_at' => $at];
$segs = T::segments([
    $ev('out', '2030-04-01 07:00:00'),                // nothing open: ignored
    $ev('in', '2030-04-01 09:00:00'), $ev('break_start', '2030-04-01 12:00:00'), $ev('break_end', '2030-04-01 12:30:00'),
    $ev('out', '2030-04-01 17:00:00'),
    $ev('in', '2030-04-02 09:00:00'),                 // no clock-out: closed by the next clock-in
    $ev('out', '2030-04-03 17:00:00'), $ev('in', '2030-04-03 09:00:00'), // given out of order
    $ev('in', '2030-04-04 09:00:00'),                 // still open
]);
check('pairing: in/out pairs in time order; a second clock-in closes the first with no clock-out; an orphan clock-out and breaks are ignored', $segs === [
    ['in' => $ms('2030-04-01 09:00:00'), 'out' => $ms('2030-04-01 17:00:00')],
    ['in' => $ms('2030-04-02 09:00:00'), 'out' => null],
    ['in' => $ms('2030-04-03 09:00:00'), 'out' => $ms('2030-04-03 17:00:00')],
    ['in' => $ms('2030-04-04 09:00:00'), 'out' => null],
], json_encode($segs));
$split = T::assign(
    [$shift('2030-04-01 17:00:00', '2030-04-01 21:00:00', 0, 'PM'), $shift('2030-04-01 07:00:00', '2030-04-01 11:00:00', 0, 'AM')],
    T::segments([$ev('in', '2030-04-01 06:58:00'), $ev('out', '2030-04-01 11:00:00'), $ev('in', '2030-04-01 16:30:00'), $ev('out', '2030-04-01 21:00:00')]),
);
check('matching: a split day gives each shift its own clock-in', $split['AM']['in'] === $ms('2030-04-01 06:58:00') && $split['PM']['in'] === $ms('2030-04-01 16:30:00'));
$once = T::assign([$shift('2030-04-01 09:00:00', '2030-04-01 10:00:00', 0, 'A'), $shift('2030-04-01 09:30:00', '2030-04-01 11:00:00', 0, 'B')], T::segments([$ev('in', '2030-04-01 09:05:00'), $ev('out', '2030-04-01 11:00:00')]));
check('matching: one clock-in answers for one shift only (the first to start)', $once['A'] !== null && $once['B'] === null);
$win = static fn (string $in): ?array => T::assign([$shift('2030-04-01 09:00:00', '2030-04-01 17:00:00')], [['in' => $ms($in), 'out' => null]])['S1'];
check('matching: a clock-in exactly 3 hours early belongs; a millisecond earlier does not', $win('2030-04-01 06:00:00') !== null && $win('2030-04-01 05:59:59.999') === null);
check('matching: a clock-in at the scheduled end belongs; after it does not', $win('2030-04-01 17:00:00') !== null && $win('2030-04-01 17:00:00.001') === null);
$close = T::assign([$shift('2030-04-01 09:00:00', '2030-04-01 17:00:00')], [['in' => $ms('2030-04-01 07:00:00'), 'out' => null], ['in' => $ms('2030-04-01 09:20:00'), 'out' => null]]);
check('matching: the clock-in closest to the start wins', $close['S1']['in'] === $ms('2030-04-01 09:20:00'));

// ---- CSV ----------------------------------------------------------------------------------------------------------------------------------------
foreach (['=1+1' => "'=1+1", '+44 7700' => "'+44 7700", '-2+3' => "'-2+3", '@SUM(A1)' => "'@SUM(A1)", "\tx" => "'\tx", "\rcmd" => "\"'\rcmd\"", 'a,b' => '"a,b"', 'say "hi"' => '"say ""hi"""', "two\nlines" => "\"two\nlines\"", ' padded' => '" padded"', 'plain' => 'plain', 'Zoë Ñúñez' => 'Zoë Ñúñez', '' => '', '-5' => "'-5"] as $in => $out) {
    check('csv cell: ' . json_encode($in) . ' -> ' . json_encode($out), T::csvCell((string) $in) === $out, json_encode(T::csvCell((string) $in)));
}
check('csv cell: integers we computed stay numbers (no apostrophe, even negative); null is empty', T::csvCell(-5) === '-5' && T::csvCell(0) === '0' && T::csvCell(2430) === '2430' && T::csvCell(null) === '');
check('csv: UTF-8 BOM and CRLF line endings', T::csv([['a', 1], ['b', 2]]) === "\xEF\xBB\xBFa,1\r\nb,2\r\n");
check('csv: the columns are fixed, sixteen of them, staff name first and time zone last', count(T::COLUMNS) === 16 && T::COLUMNS[0] === 'Staff name' && T::COLUMNS[5] === 'Approved minutes' && T::COLUMNS[6] === 'Approved hours' && T::COLUMNS[15] === 'Time zone');
