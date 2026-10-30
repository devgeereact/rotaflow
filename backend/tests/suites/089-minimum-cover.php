<?php
declare(strict_types=1);

// The publish-time cover rule as a pure function.
use RotaFlow\MinimumCover;

$now = new DateTimeImmutable('2030-01-01 12:00:00', new DateTimeZone('UTC'));
$rule = static fn (string $loc, string $name, int $weekday, int $min, string $tz = 'Europe/London'): array => ['location_id' => $loc, 'location_name' => $name, 'timezone' => $tz, 'weekday' => $weekday, 'min_staff' => $min];
$shift = static fn (string $loc, ?string $staff, string $startsUtc): array => ['location_id' => $loc, 'staff_profile_id' => $staff, 'starts_at' => $startsUtc];
$mon = '2030-01-07'; $sun = '2030-01-13'; // a Monday to the following Sunday

$r = MinimumCover::firstShortfall([$rule('L1', 'Oak', 1, 2)], [$shift('L1', 'a', '2030-01-07 09:00:00')], 'L1', $mon, $sun, $now);
check('one person against a minimum of two is a shortfall on that Monday', $r === ['location_name' => 'Oak', 'day' => '2030-01-07', 'min_staff' => 2, 'on_shift' => 1], json_encode($r));
check('two people meet it', MinimumCover::firstShortfall([$rule('L1', 'Oak', 1, 2)], [$shift('L1', 'a', '2030-01-07 09:00:00'), $shift('L1', 'b', '2030-01-07 10:00:00')], 'L1', $mon, $sun, $now) === null);
check('the same person twice counts once', MinimumCover::firstShortfall([$rule('L1', 'Oak', 1, 2)], [$shift('L1', 'a', '2030-01-07 09:00:00'), $shift('L1', 'a', '2030-01-07 17:00:00')], 'L1', $mon, $sun, $now)['on_shift'] === 1);
check('an unassigned shift counts for nobody', MinimumCover::firstShortfall([$rule('L1', 'Oak', 1, 1)], [$shift('L1', null, '2030-01-07 09:00:00')], 'L1', $mon, $sun, $now)['on_shift'] === 0);
check('a minimum of zero is no minimum', MinimumCover::firstShortfall([$rule('L1', 'Oak', 1, 0)], [], 'L1', $mon, $sun, $now) === null);
check('a rule for a day that is not in the period is ignored', MinimumCover::firstShortfall([$rule('L1', 'Oak', 1, 2)], [], 'L1', '2030-01-08', '2030-01-12', $now) === null);
check('days that have already passed are ignored', MinimumCover::firstShortfall([$rule('L1', 'Oak', 1, 2)], [], 'L1', $mon, $sun, new DateTimeImmutable('2030-01-08 00:00:00', new DateTimeZone('UTC'))) === null);
check('today still counts', MinimumCover::firstShortfall([$rule('L1', 'Oak', 1, 2)], [], 'L1', $mon, $sun, new DateTimeImmutable('2030-01-07 23:00:00', new DateTimeZone('UTC')))['day'] === '2030-01-07');
check('another site\'s rule is ignored unless the rota has shifts at that site', MinimumCover::firstShortfall([$rule('L2', 'Elm', 1, 2)], [$shift('L1', 'a', '2030-01-07 09:00:00')], 'L1', $mon, $sun, $now) === null);
check('but applies once a shift is at that site', MinimumCover::firstShortfall([$rule('L2', 'Elm', 1, 2)], [$shift('L2', 'a', '2030-01-07 09:00:00')], null, $mon, $sun, $now)['location_name'] === 'Elm');
check('a whole-organisation rota (no site) checks the sites its shifts use', MinimumCover::firstShortfall([$rule('L2', 'Elm', 1, 2)], [$shift('L2', 'a', '2030-01-07 09:00:00')], null, $mon, $sun, $now) !== null);

// time zones: a shift at 20:00 UTC on Sunday is 05:00 Monday in Tokyo, so it counts for Monday there and not in London
$tokyo = $rule('L1', 'Oak', 1, 1, 'Asia/Tokyo');
check('the day is the site\'s local day (Tokyo)', MinimumCover::firstShortfall([$tokyo], [$shift('L1', 'a', '2030-01-06 20:00:00')], 'L1', $mon, $sun, $now) === null);
check('and not the UTC day', MinimumCover::firstShortfall([$rule('L1', 'Oak', 1, 1)], [$shift('L1', 'a', '2030-01-06 20:00:00')], 'L1', $mon, $sun, $now)['day'] === '2030-01-07');

// the first shortfall is reported: earliest day, then site name
$rules = [$rule('L1', 'Zed House', 2, 1), $rule('L2', 'Alder', 2, 1), $rule('L1', 'Zed House', 1, 1)];
$r = MinimumCover::firstShortfall($rules, [$shift('L2', 'a', '2030-01-09 09:00:00')], 'L1', $mon, $sun, $now);
check('the earliest day comes first', $r['day'] === '2030-01-07' && $r['location_name'] === 'Zed House', json_encode($r));
$r = MinimumCover::firstShortfall([$rule('L1', 'Zed House', 2, 1), $rule('L2', 'Alder', 2, 1)], [$shift('L2', 'x', '2030-01-09 09:00:00'), $shift('L1', 'y', '2030-01-01 09:00:00')], 'L1', $mon, $sun, $now);
check('on the same day the site name orders the report', $r['location_name'] === 'Zed House' || $r['location_name'] === 'Alder');
$r = MinimumCover::firstShortfall([$rule('L1', 'Zed House', 2, 1), $rule('L2', 'Alder', 2, 1)], [$shift('L1', null, '2030-01-09 09:00:00'), $shift('L2', null, '2030-01-09 09:00:00')], 'L1', $mon, $sun, $now);
check('same day, same shortfall: alphabetical by site', $r['location_name'] === 'Alder', json_encode($r));
