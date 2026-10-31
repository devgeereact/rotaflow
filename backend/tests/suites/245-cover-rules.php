<?php
declare(strict_types=1);

// Cover rules (R2 slice S12), pure: eligibility reasons, warnings, ranking and swap staleness. The same cases as src/lib/coverRules.test.ts,
// so the server and the browser cannot drift apart. Ported from SiteRelay's Cover reasons/rank/staleReason.
use RotaFlow\{CoverRules as C, SchedulingRules as R};

$LON = 'Europe/London';
$iso = static fn (string $d, string $t): string => gmdate('Y-m-d\TH:i:s\Z', R::localTs($d, $t, 'Europe/London'));
$seq = 0;
$sh = static function (string $date, string $start, string $end, array $o = []) use (&$seq, $iso): array {
    $seq++;
    return $o + ['id' => "s$seq", 'staff_profile_id' => 'sam', 'starts_at' => $iso($date, $start), 'ends_at' => $iso($end <= $start ? R::addDays($date, 1) : $date, $end), 'break_minutes' => 0, 'status' => 'assigned', 'timezone' => null];
};
$ok = ['active' => true, 'absent' => false, 'documents' => null];
$codes = static fn (array $r): array => array_column($r['reasons'], 'code');
$target = $sh('2029-03-21', '09:00', '17:00', ['id' => 'target', 'staff_profile_id' => null, 'status' => 'open']);
$run = static fn (array $person, array $others = [], array $leave = [], array $avail = [], int $rest = 11, int $week = 48): array => C::assess('sam', $target, $person, $others, $leave, $avail, $rest, $week, $LON);

check('cover rules: nothing in the way means eligible, no warnings', $run($ok) === ['reasons' => [], 'warnings' => []]);
check('cover rules: inactive and absent come first, in that order', $codes($run(['active' => false, 'absent' => true, 'documents' => null])) === ['inactive', 'absent']);
check('cover rules: an overlapping shift blocks', $codes($run($ok, [$sh('2029-03-21', '16:00', '20:00')])) === ['overlap']);
check('cover rules: back to back is not an overlap; a cancelled shift, another person\'s and the shift itself do not count',
    $codes($run($ok, [$sh('2029-03-21', '17:00', '20:00'), $sh('2029-03-21', '10:00', '12:00', ['status' => 'cancelled']), $sh('2029-03-21', '10:00', '12:00', ['staff_profile_id' => 'pat']), ['id' => 'target', 'staff_profile_id' => 'sam'] + $target])) === []);
$leave = [['staff_profile_id' => 'sam', 'start_date' => '2029-03-21', 'end_date' => '2029-03-22', 'status' => 'approved', 'type' => 'Holiday']];
$r = $run($ok, [], $leave);
check('cover rules: approved leave blocks, with S11\'s words', $codes($r) === ['leave'] && $r['reasons'][0]['message'] === 'On approved holiday (Wed 21 Mar – Thu 22 Mar)', json_encode($r));
check('cover rules: pending leave does not', $run($ok, [], [['status' => 'pending'] + $leave[0]])['reasons'] === []);
$avail = [['staff_profile_id' => 'sam', 'weekday' => 3, 'date' => null, 'start_time' => '16:00:00', 'end_time' => '22:00:00', 'status' => 'unavailable', 'recurring' => 1]];
$r = $run($ok, [], [], $avail);
check('cover rules: declared unavailability blocks', $codes($r) === ['unavailable'] && $r['reasons'][0]['message'] === 'Declared unavailable Wednesdays 16:00–22:00', json_encode($r));
check('cover rules: an "available" row does not', $run($ok, [], [], [['status' => 'available'] + $avail[0]])['reasons'] === []);
$r = $run(['documents' => ['ok' => false, 'missing' => ['DBS check', 'Right to work check']]] + $ok);
check('cover rules: missing documents block and are named', $codes($r) === ['documents'] && $r['reasons'][0]['message'] === 'Missing or expired: DBS check, Right to work check');
check('cover rules: documents not in order without names (unknown record)', $run(['documents' => ['ok' => false, 'missing' => []]] + $ok)['reasons'][0]['message'] === 'Required documents are not in order');
check('cover rules: documents in order add nothing', $run(['documents' => ['ok' => true, 'missing' => []]] + $ok)['reasons'] === []);
$r = $run($ok, [$sh('2029-03-20', '12:00', '02:00')]);
check('cover rules: short rest is a warning, never a reason', $r['reasons'] === [] && array_column($r['warnings'], 'code') === ['rest'] && $r['warnings'][0]['message'] === 'Only 7h rest before this shift (minimum 11h in any 24 hours)', json_encode($r));
check('cover rules: rest 0 turns the warning off', $run($ok, [$sh('2029-03-20', '12:00', '02:00')], [], [], 0)['warnings'] === []);
$week = [$sh('2029-03-19', '08:00', '18:00'), $sh('2029-03-20', '08:00', '18:00'), $sh('2029-03-22', '08:00', '18:00'), $sh('2029-03-23', '08:00', '18:00')];
$r = $run($ok, $week);
check('cover rules: exactly the weekly limit (40h + this 8h = 48h) is not a warning', $r['reasons'] === [] && $r['warnings'] === [], json_encode($r));
$r = $run($ok, [...$week, $sh('2029-03-24', '08:00', '18:00')]);
check('cover rules: over the weekly limit warns with the week named', $r['reasons'] === [] && array_column($r['warnings'], 'code') === ['weekly_hours'] && $r['warnings'][0]['message'] === '58h scheduled in the week of Mon 19 Mar (limit 48h)', json_encode($r));
$r = C::assess('sam', $target, ['active' => false, 'absent' => true, 'documents' => ['ok' => false, 'missing' => ['DBS check']]], [$sh('2029-03-21', '08:00', '10:00')], $leave, $avail, 11, 48, $LON);
check('cover rules: every reason at once, in the fixed order', $codes($r) === C::CODES, json_encode($codes($r)));
check('cover rules: overlaps helper', C::overlaps([[0, 10]], 5, 15) && !C::overlaps([[0, 10]], 10, 15) && !C::overlaps([], 0, 1));

// ---- ranking ------------------------------------------------------------------------------------------------------------------------------
$rows = [
    ['name' => 'Zed', 'eligible' => true, 'applied' => false, 'hours' => 10.0, 'reasons' => []],
    ['name' => 'amy', 'eligible' => true, 'applied' => false, 'hours' => 10.0, 'reasons' => []],
    ['name' => 'Bob', 'eligible' => false, 'applied' => true, 'hours' => 0.0, 'reasons' => [1]],
    ['name' => 'Cat', 'eligible' => true, 'applied' => true, 'hours' => 30.0, 'reasons' => []],
    ['name' => 'Dan', 'eligible' => true, 'applied' => false, 'hours' => 2.5, 'reasons' => []],
    ['name' => 'Eve', 'eligible' => false, 'applied' => false, 'hours' => 0.0, 'reasons' => [1, 2]],
    ['name' => 'Fay', 'eligible' => false, 'applied' => false, 'hours' => 0.0, 'reasons' => [1]],
];
check('rank: eligible, then applied, then fewest hours, then fewer reasons, then name', array_column(C::rank($rows), 'name') === ['Cat', 'Dan', 'amy', 'Zed', 'Bob', 'Fay', 'Eve'], json_encode(array_column(C::rank($rows), 'name')));

// ---- swaps void themselves ------------------------------------------------------------------------------------------------------------------
$base = ['starts_at' => '2029-03-21 09:00:00', 'ends_at' => '2029-03-21 17:00:00', 'location_id' => 'L1', 'staff_profile_id' => 'sam', 'status' => 'assigned', 'rota_id' => 'R1'];
$fp = C::fingerprint($base);
check('fingerprint: the same shift in either time form is the same fingerprint', $fp === C::fingerprint(['starts_at' => '2029-03-21T09:00:00Z', 'ends_at' => '2029-03-21T17:00:00Z'] + $base) && strlen($fp) === 64);
$changed = array_map(static fn (array $o): bool => C::fingerprint($o + $base) !== $fp, [['starts_at' => '2029-03-21 10:00:00'], ['ends_at' => '2029-03-21 18:00:00'], ['location_id' => 'L2'], ['staff_profile_id' => 'pat'], ['status' => 'confirmed'], ['rota_id' => 'R2']]);
check('fingerprint: times, site, holder, status and rota each change it', !in_array(false, $changed, true));
$t = strtotime('2029-03-21 09:00:00 UTC');
check('stale: an unchanged future shift is fine', C::staleReason($fp, $fp, 'assigned', 'published', $t, $t - 1) === null);
check('stale: a changed shift, a cancelled one or an archived rota is shift_changed', C::staleReason($fp, 'x', 'assigned', 'published', $t, 0) === 'shift_changed' && C::staleReason($fp, $fp, 'cancelled', 'published', $t, 0) === 'shift_changed' && C::staleReason($fp, $fp, 'assigned', 'archived', $t, 0) === 'shift_changed');
check('stale: a started shift is shift_started, but a change wins', C::staleReason($fp, $fp, 'assigned', 'published', $t, $t) === 'shift_started' && C::staleReason($fp, 'x', 'assigned', 'published', $t, $t) === 'shift_changed');
check('stale: a swap raised before fingerprints is judged on the rest', C::staleReason(null, $fp, 'assigned', null, $t, 0) === null && C::staleReason(null, $fp, 'assigned', null, $t, $t + 1) === 'shift_started');

// ---- respond-by -------------------------------------------------------------------------------------------------------------------------------
check('respond by: absent is null, a good time is its instant', C::respondBy(null, $t, 0) === null && C::respondBy('', $t, 0) === null && C::respondBy('2029-03-21T08:00:00Z', $t, 0) === $t - 3600);
expectError('respond by: after the shift starts is refused', static fn () => C::respondBy('2029-03-21T10:00:00Z', $t, 0), 422);
expectError('respond by: in the past is refused', static fn () => C::respondBy('2029-03-20T10:00:00Z', $t, $t - 60), 422);
expectError('respond by: not a time is refused', static fn () => C::respondBy('tomorrow', $t, 0), 422);
expectError('respond by: not a string is refused', static fn () => C::respondBy(['x'], $t, 0), 422);

// ---- two-way swaps (S12d) --------------------------------------------------------------------------------------------------------------------
check('exchange stale: both fine is fine; one side started is shift_started', C::exchangeStale(null, null) === null && C::exchangeStale('shift_started', null) === 'shift_started' && C::exchangeStale(null, 'shift_started') === 'shift_started');
check('exchange stale: a change on either side wins over a start on the other', C::exchangeStale('shift_started', 'shift_changed') === 'shift_changed' && C::exchangeStale('shift_changed', 'shift_started') === 'shift_changed' && C::exchangeStale(null, 'shift_changed') === 'shift_changed');
$g = ['id' => 'G', 'staff_profile_id' => 'sam', 'status' => 'assigned', 'rota_status' => 'published', 'starts_at' => '2029-03-21 09:00:00'];
$tk = ['id' => 'T', 'staff_profile_id' => 'pat', 'status' => 'assigned', 'rota_status' => 'published', 'starts_at' => '2029-03-22 09:00:00'];
$now = (int) strtotime('2029-03-20 09:00:00 UTC');
check('exchange: a colleague\'s future published shift for one of yours is fine', C::exchangeProblem($g, $tk, 'sam', 'pat', $now) === null);
check('exchange: the same shift, not the colleague\'s, not yours, cancelled, a draft rota, or started are each refused', C::exchangeProblem($g, ['id' => 'G'] + $tk, 'sam', 'pat', $now) !== null && C::exchangeProblem($g, ['staff_profile_id' => 'dee'] + $tk, 'sam', 'pat', $now) !== null && C::exchangeProblem(['staff_profile_id' => 'dee'] + $g, $tk, 'sam', 'pat', $now) !== null && C::exchangeProblem($g, ['status' => 'cancelled'] + $tk, 'sam', 'pat', $now) !== null && C::exchangeProblem($g, ['rota_status' => 'draft'] + $tk, 'sam', 'pat', $now) !== null && C::exchangeProblem($g, ['rota_status' => null] + $tk, 'sam', 'pat', $now) !== null && C::exchangeProblem($g, ['starts_at' => '2029-03-20 09:00:00'] + $tk, 'sam', 'pat', $now) !== null && C::exchangeProblem(['starts_at' => '2029-03-20 08:59:59'] + $g, $tk, 'sam', 'pat', $now) !== null);
