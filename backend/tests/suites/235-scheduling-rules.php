<?php
declare(strict_types=1);

// Scheduling rules (R2 slice S11), pure: zoned time, rest, weekly hours, leave, declared unavailability and recurring patterns.
// The same cases as src/lib/schedulingRules.test.ts and src/lib/zonedTime.test.ts, so the server and the browser cannot drift apart.
use RotaFlow\{HttpError, SchedulingRules as R};

$LON = 'Europe/London';
$H = 3600;
$iso = static fn (string $d, string $t): string => gmdate('Y-m-d\TH:i:s\Z', R::localTs($d, $t, 'Europe/London'));


// ---- pure: zoned time ---------------------------------------------------------------------------------------------------------------------
check('time: London winter equals UTC, summer is an hour ahead', $iso('2026-10-26', '09:00') === '2026-10-26T09:00:00Z' && $iso('2026-07-01', '09:00') === '2026-07-01T08:00:00Z' && $iso('2026-10-24', '09:00') === '2026-10-24T08:00:00Z');
check('time: other zones', gmdate('H:i', R::localTs('2026-07-01', '09:00', 'America/New_York')) === '13:00' && gmdate('H:i', R::localTs('2026-01-15', '09:00', 'Asia/Kolkata')) === '03:30');
check('time: the clock changes agree with the browser (skipped time moves on, repeated time is the second)', $iso('2026-03-29', '01:30') === '2026-03-29T01:30:00Z' && $iso('2026-03-29', '06:00') === '2026-03-29T05:00:00Z' && $iso('2026-10-25', '01:30') === '2026-10-25T01:30:00Z' && $iso('2026-10-25', '06:00') === '2026-10-25T06:00:00Z');
check('time: calendar helpers', R::addDays('2026-10-30', 3) === '2026-11-02' && R::daysBetween('2026-10-19', '2026-10-26') === 7 && R::daysBetween('2026-11-01', '2026-10-31') === -1 && R::isoWeekday('2026-10-25') === 7 && R::weekOf(strtotime('2026-10-25 23:30:00 UTC'), $LON) === '2026-10-19' && R::weekOf(strtotime('2026-10-25 23:30:00 UTC'), 'Europe/Berlin') === '2026-10-26');
check('time: words', R::dayLabel('2026-11-02') === 'Mon 2 Nov' && R::dateSpan('2026-11-04', '2026-11-06') === 'Wed 4 Nov – Fri 6 Nov' && R::hours(8 * $H) === '8h' && R::hours((int) (7.5 * $H)) === '7.5h');

// ---- pure: rules (the same cases as the browser) --------------------------------------------------------------------------------------------
$st = strtotime('2026-11-03 07:00:00 UTC');
check('rest: 9h is short of 11; 12h is fine; nothing in the window is fine', R::restShortfall([[$st - 17 * $H, $st - 9 * $H]], $st, 11 * $H) === 9 * $H && R::restShortfall([[$st - 20 * $H, $st - 12 * $H]], $st, 11 * $H) === null && R::restShortfall([], $st, 11 * $H) === null);
$st = strtotime('2026-11-03 17:00:00 UTC');
check('rest: a split shift is fine when the long rest is still in the window', R::restShortfall([[$st - 11 * $H, $st - 7 * $H]], $st, 11 * $H) === null && R::restShortfall([[$st - 19 * $H, $st - 15 * $H], [$st - 11 * $H, $st - 7 * $H]], $st, 11 * $H) === 7 * $H);
$n = 0;
$sh = static function (string $d, string $s, string $e, array $o = []) use (&$n, $iso): array {
    $n++;
    return $o + ['id' => "s$n", 'staff_profile_id' => 'p1', 'starts_at' => $iso($d, $s), 'ends_at' => $iso($e <= $s ? R::addDays($d, 1) : $d, $e), 'break_minutes' => 0, 'status' => 'assigned'];
};
$a = $sh('2026-10-24', '14:00', '22:00');
$b = $sh('2026-10-25', '08:00', '16:00');
$c = $sh('2026-10-25', '07:30', '16:00');
check('warnings: rest in real hours across the clock change', R::warnings([$b], [$a], [], [], 11, 48, $LON) === [] && R::warnings([$c], [$a], [], [], 11, 48, $LON)[$c['id']][0] === ['code' => 'rest', 'message' => 'Only 10.5h rest before this shift (minimum 11h in any 24 hours)']);
$a = $sh('2026-11-02', '14:00', '23:00');
$b = $sh('2026-11-03', '06:00', '14:00');
check('warnings: zero rest turns the check off; other people, cancelled and open shifts never count', R::warnings([$b], [$a], [], [], 0, 48, $LON) === [] && R::warnings([$b], [['staff_profile_id' => 'p2'] + $a], [], [], 11, 48, $LON) === [] && R::warnings([$b], [['status' => 'cancelled'] + $a], [], [], 11, 48, $LON) === [] && R::warnings([['staff_profile_id' => null] + $b], [$a], [], [], 11, 48, $LON) === [] && isset(R::warnings([$b], [$a], [], [], 11, 48, $LON)[$b['id']]));
$week = array_map(static fn (string $d): array => $sh("2026-11-$d", '08:00', '18:00', ['break_minutes' => 30]), ['02', '03', '04', '05', '06']);
$sat = $sh('2026-11-07', '09:00', '13:00');
$mon = $sh('2026-11-09', '09:00', '13:00');
check('warnings: weekly hours net of breaks, Monday to Sunday', R::warnings($week, $week, [], [], 11, 48, $LON) === [] && R::warnings([$sat], $week, [], [], 11, 48, $LON)[$sat['id']] === [['code' => 'weekly_hours', 'message' => '51.5h scheduled in the week of Mon 2 Nov (limit 48h)']] && R::warnings([$mon], [...$week, $sat], [], [], 11, 48, $LON) === []);
$leave = [['staff_profile_id' => 'p1', 'start_date' => '2026-11-04', 'end_date' => '2026-11-06', 'status' => 'approved', 'type' => 'Holiday'], ['staff_profile_id' => 'p1', 'start_date' => '2026-11-09', 'end_date' => '2026-11-09', 'status' => 'pending', 'type' => 'holiday']];
$in1 = $sh('2026-11-06', '20:00', '23:00');
$night = $sh('2026-11-03', '22:00', '06:00');
$after = $sh('2026-11-07', '00:00', '08:00');
$pend = $sh('2026-11-09', '09:00', '17:00');
$w = R::warnings([$in1, $night, $after, $pend], [], $leave, [], 11, 48, $LON);
check('warnings: approved leave on its local dates; pending leave never', ($w[$in1['id']] ?? null) === [['code' => 'leave', 'message' => 'On approved holiday (Wed 4 Nov – Fri 6 Nov)']] && ($w[$night['id']][0]['code'] ?? '') === 'leave' && !isset($w[$after['id']]) && !isset($w[$pend['id']]), json_encode($w));
$avail = [
    ['staff_profile_id' => 'p1', 'weekday' => '1', 'date' => null, 'start_time' => '18:00:00', 'end_time' => '22:00:00', 'status' => 'unavailable', 'recurring' => '1'],
    ['staff_profile_id' => 'p1', 'weekday' => '0', 'date' => null, 'start_time' => null, 'end_time' => null, 'status' => 'unavailable', 'recurring' => '1'],
    ['staff_profile_id' => 'p1', 'weekday' => null, 'date' => '2026-11-04', 'start_time' => null, 'end_time' => null, 'status' => 'unavailable', 'recurring' => '0'],
    ['staff_profile_id' => 'p1', 'weekday' => '2', 'date' => null, 'start_time' => null, 'end_time' => null, 'status' => 'available', 'recurring' => '1'],
];
$x = [$sh('2026-11-02', '09:00', '17:00'), $sh('2026-11-02', '17:00', '19:00'), $sh('2026-11-07', '22:00', '06:00'), $sh('2026-11-04', '09:00', '12:00'), $sh('2026-11-03', '09:00', '12:00')];
$w = R::warnings($x, [], [], $avail, 11, 48, $LON);
check('warnings: declared unavailability by window, whole day, one-off date and overnight', !isset($w[$x[0]['id']]) && $w[$x[1]['id']] === [['code' => 'unavailable', 'message' => 'Declared unavailable Mondays 18:00–22:00']] && $w[$x[2]['id']] === [['code' => 'unavailable', 'message' => 'Declared unavailable Sundays all day']] && $w[$x[3]['id']] === [['code' => 'unavailable', 'message' => 'Declared unavailable Wed 4 Nov all day']] && !isset($w[$x[4]['id']]), json_encode($w));
$ny = ['id' => 'ny', 'staff_profile_id' => 'p1', 'starts_at' => '2026-11-05 01:00:00', 'ends_at' => '2026-11-05 03:00:00', 'break_minutes' => 0, 'status' => 'assigned', 'timezone' => 'America/New_York'];
$l5 = [['staff_profile_id' => 'p1', 'start_date' => '2026-11-05', 'end_date' => '2026-11-05', 'status' => 'approved', 'type' => 'holiday']];
check('warnings: a site in another zone reads leave in its own zone', R::warnings([$ny], [], $l5, [], 11, 48, $LON) === [] && isset(R::warnings([['timezone' => null] + $ny], [], $l5, [], 11, 48, $LON)['ny']));
check('limits: settings, else 11 and 48', R::limits('{}') === [11, 48] && R::limits('{"min_rest_hours":0,"max_weekly_hours":60}') === [0, 60] && R::limits('{"min_rest_hours":"x","max_weekly_hours":500}') === [11, 48] && R::limits(null) === [11, 48]);

// ---- pure: patterns -----------------------------------------------------------------------------------------------------------------------
$rule = static fn (array $o = []): array => R::patternRule($o + ['kind' => 'weekly', 'weekdays' => [1, 2, 3, 4, 5], 'from_date' => '2026-11-02', 'to_date' => '2026-11-29', 'blocks' => [['start' => '06:00', 'end' => '14:00']], 'break_minutes' => 0], '2026-11-01', '2027-03-31');
$bad = static function (array $o, string $want) use ($rule): bool {
    try {
        $rule($o);
        return false;
    } catch (HttpError $e) {
        return $e->status === 422 && str_contains($e->getMessage(), $want);
    }
};
check('pattern: the browser\'s refusals, word for word', $bad(['weekdays' => []], 'day of the week') && $bad(['kind' => 'cycle', 'days_on' => 0, 'days_off' => 4], 'Days on') && $bad(['kind' => 'cycle', 'days_on' => 4, 'days_off' => 29], 'Days on') && $bad(['kind' => 'cycle', 'days_on' => 4, 'days_off' => 4, 'cycle_start' => '2026-11-03'], 'on or before') && $bad(['to_date' => '2026-11-01'], 'on or after') && $bad(['to_date' => '2027-02-02'], '92 days') && $bad(['blocks' => []], 'time blocks') && $bad(['blocks' => [['start' => '09:00', 'end' => '09:00']]], 'different') && $bad(['break_minutes' => 480], 'shorter') && $bad(['break_minutes' => '30'], 'Break') && $bad(['weekdays' => [6], 'to_date' => '2026-11-06'], 'no working days') && $bad(['kind' => 'daily'], 'kind') && $bad(['weekdays' => [0]], 'day of the week') && $bad(['from_date' => '2026-10-31'], 'period'));
check('pattern: 92 days is allowed; 500 shifts is the cap', count(R::expand($rule(['to_date' => '2027-02-01']))) === 66 && $bad(['weekdays' => [1, 2, 3, 4, 5, 6, 7], 'from_date' => '2026-11-01', 'to_date' => '2027-01-31', 'blocks' => array_map(static fn (int $i): array => ['start' => sprintf('%02d:00', $i * 4), 'end' => sprintf('%02d:00', $i * 4 + 1)], range(0, 5))], 'limit is 500'));
$ex = R::expand($rule(['weekdays' => [1, 3], 'to_date' => '2026-11-08', 'blocks' => [['start' => '06:00', 'end' => '10:00'], ['start' => '22:00', 'end' => '06:00']]]));
check('pattern: weekly expands in date then block order; an overnight block ends the next day', $ex === [
    ['date' => '2026-11-02', 'start' => '06:00', 'end_date' => '2026-11-02', 'end' => '10:00'],
    ['date' => '2026-11-02', 'start' => '22:00', 'end_date' => '2026-11-03', 'end' => '06:00'],
    ['date' => '2026-11-04', 'start' => '06:00', 'end_date' => '2026-11-04', 'end' => '10:00'],
    ['date' => '2026-11-04', 'start' => '22:00', 'end_date' => '2026-11-05', 'end' => '06:00'],
]);
$cy = R::patternRule(['kind' => 'cycle', 'days_on' => 4, 'days_off' => 4, 'cycle_start' => '2026-10-31', 'from_date' => '2026-11-02', 'to_date' => '2026-11-11', 'blocks' => [['start' => '07:00', 'end' => '19:00']]], '2026-11-01', '2026-11-30');
check('pattern: a 4-on 4-off cycle anchored before the range', array_column(R::expand($cy), 'date') === ['2026-11-02', '2026-11-03', '2026-11-08', '2026-11-09', '2026-11-10', '2026-11-11']);
