<?php
declare(strict_types=1);

namespace RotaFlow\Mod;

use RotaFlow\{Ctx, HttpError, Input, Module, Scope};

/**
 * Labour cost without exposing anybody's rate: the Postgres `labour_cost` and `current_pay_rates` functions (0104).
 * Owner and manager only. Cost uses the rate in force on the DAY OF THE SHIFT (the table is a history), rounds per
 * shift, counts only shifts on published or archived rotas that are not cancelled, and names how many rostered
 * people have no rate rather than pricing them at zero.
 */
final class LabourCost implements Module
{
    private const MAX_DAYS = 400; // ASSUMPTION: the Postgres function had no bound; a year and a bit covers every report

    public function __construct(private readonly Ctx $ctx) {}

    public function routes(): array
    {
        return [
            ['GET', '/orgs/{o}/labour-cost', $this->labourCost(...)],
            ['GET', '/orgs/{o}/pay-rates/current', $this->currentRates(...)],
        ];
    }

    private function labourCost(array $user, array $in, string $ip, string $o): array
    {
        $pdo = $this->ctx->pdo;
        Scope::require(Scope::membership($pdo, $user['id'], $o), Scope::MANAGERS);
        $from = Input::optDate($in, 'from');
        $to = Input::optDate($in, 'to');
        if ($from === null || $to === null || $to < $from) {
            throw HttpError::invalid('from and to are required dates, from first');
        }
        if ((strtotime($to) - strtotime($from)) / 86400 > self::MAX_DAYS) {
            throw HttpError::invalid('The period can be at most ' . self::MAX_DAYS . ' days');
        }
        $paidBreaks = in_array($in['paid_breaks'] ?? null, ['1', 'true', 1, true], true);
        $q = $pdo->prepare(
            "SELECT s.location_id, s.staff_profile_id,
                    GREATEST(0, TIMESTAMPDIFF(MINUTE, s.starts_at, s.ends_at) - IF(?, 0, s.break_minutes)) AS minutes,
                    (SELECT pr.hourly_rate_pence FROM staff_pay_rates pr
                      WHERE pr.org_id = s.org_id AND pr.staff_profile_id = s.staff_profile_id AND pr.effective_from <= DATE(s.starts_at)
                      ORDER BY pr.effective_from DESC LIMIT 1) AS rate
               FROM shifts s JOIN rotas r ON r.id = s.rota_id AND r.org_id = s.org_id
              WHERE s.org_id = ? AND s.status <> 'cancelled' AND r.status IN ('published','archived')
                AND DATE(s.starts_at) BETWEEN ? AND ?"
        );
        $q->execute([$paidBreaks ? 1 : 0, $o, $from, $to]);
        $by = [];
        foreach ($q->fetchAll() as $r) {
            $k = $r['location_id'] ?? '';
            $by[$k] ??= ['minutes' => 0, 'cost' => 0, 'unrated' => []];
            $by[$k]['minutes'] += (int) $r['minutes'];
            if ($r['rate'] === null) {
                if ($r['staff_profile_id'] !== null) {
                    $by[$k]['unrated'][$r['staff_profile_id']] = true;
                }
            } else {
                $by[$k]['cost'] += (int) round((int) $r['minutes'] * (int) $r['rate'] / 60);
            }
        }
        $names = $pdo->prepare('SELECT id, name FROM locations WHERE org_id = ?');
        $names->execute([$o]);
        $locName = array_column($names->fetchAll(), 'name', 'id');
        $rows = [];
        foreach ($by as $loc => $v) {
            $rows[] = [
                'location_id' => $loc === '' ? null : $loc,
                'location_name' => $loc === '' ? null : ($locName[$loc] ?? null),
                'scheduled_minutes' => $v['minutes'],
                'cost_pence' => $v['cost'],
                'unrated_staff' => count($v['unrated']),
            ];
        }
        usort($rows, static fn (array $a, array $b): int => [$a['location_name'] === null, $a['location_name']] <=> [$b['location_name'] === null, $b['location_name']]);
        return [200, ['rows' => $rows]];
    }

    /** Each staff member's rate in force today. */
    private function currentRates(array $user, array $in, string $ip, string $o): array
    {
        $pdo = $this->ctx->pdo;
        Scope::require(Scope::membership($pdo, $user['id'], $o), Scope::MANAGERS);
        $q = $pdo->prepare(
            'SELECT pr.staff_profile_id, pr.hourly_rate_pence FROM staff_pay_rates pr
              WHERE pr.org_id = ? AND pr.effective_from = (SELECT MAX(p2.effective_from) FROM staff_pay_rates p2
                    WHERE p2.staff_profile_id = pr.staff_profile_id AND p2.org_id = pr.org_id AND p2.effective_from <= UTC_DATE())'
        );
        $q->execute([$o]);
        return [200, ['rates' => array_map(static fn (array $r): array => ['staff_profile_id' => $r['staff_profile_id'], 'hourly_rate_pence' => (int) $r['hourly_rate_pence']], $q->fetchAll())]];
    }
}
