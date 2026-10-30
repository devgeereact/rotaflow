<?php
declare(strict_types=1);

namespace RotaFlow;

/**
 * The publish-time cover rule, as a pure function so it can be tested to the day. A rota may not be published while
 * any future day in its period is below the site's minimum for that weekday (counting distinct staff with a shift
 * that starts on that local day at that site). Days already past are ignored. The first shortfall by day, then by
 * site name, is reported.
 */
final class MinimumCover
{
    /**
     * @param list<array{location_id:string,location_name:string,timezone:string,weekday:int,min_staff:int}> $rules
     * @param list<array{location_id:?string,staff_profile_id:?string,starts_at:string}> $shifts non-cancelled shifts of the rota, starts_at in UTC
     * @return array{location_name:string,day:string,min_staff:int,on_shift:int}|null
     */
    public static function firstShortfall(array $rules, array $shifts, ?string $rotaLocation, string $periodStart, string $periodEnd, \DateTimeImmutable $now): ?array
    {
        $sites = [];
        foreach ($shifts as $s) {
            if ($s['location_id'] !== null) {
                $sites[$s['location_id']] = true;
            }
        }
        $worst = null;
        foreach ($rules as $r) {
            if ($r['min_staff'] <= 0 || ($r['location_id'] !== $rotaLocation && !isset($sites[$r['location_id']]))) {
                continue;
            }
            $tz = new \DateTimeZone($r['timezone']);
            $today = $now->setTimezone($tz)->format('Y-m-d');
            $counts = [];
            foreach ($shifts as $s) {
                if ($s['location_id'] === $r['location_id'] && $s['staff_profile_id'] !== null) {
                    $day = (new \DateTimeImmutable($s['starts_at'] . ' UTC'))->setTimezone($tz)->format('Y-m-d');
                    $counts[$day][$s['staff_profile_id']] = true;
                }
            }
            for ($d = new \DateTimeImmutable($periodStart); $d->format('Y-m-d') <= $periodEnd; $d = $d->modify('+1 day')) {
                $day = $d->format('Y-m-d');
                if ((int) $d->format('w') !== $r['weekday'] || $day < $today) {
                    continue;
                }
                $on = count($counts[$day] ?? []);
                if ($on < $r['min_staff'] && ($worst === null || [$day, $r['location_name']] < [$worst['day'], $worst['location_name']])) {
                    $worst = ['location_name' => $r['location_name'], 'day' => $day, 'min_staff' => $r['min_staff'], 'on_shift' => $on];
                }
            }
        }
        return $worst;
    }
}
