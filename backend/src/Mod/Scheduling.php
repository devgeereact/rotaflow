<?php
declare(strict_types=1);

namespace RotaFlow\Mod;

use RotaFlow\{Audit, Billing, Ctx, Db, Flags, HttpError, Input, Module, Scope, SchedulingRules as R, Time};

/**
 * Scheduling tools (R2 slice S11), ported from SiteRelay's Scheduling module and re-made for RotaFlow's rotas: a publish preview with
 * warnings (rest, weekly hours, leave clash, declared unavailability), and recurring patterns that fill one draft rota. Copy-week stays
 * RotaFlow's own `rotas/{r}/repeat`.
 *
 *  - Warnings never block. An overlap (one person in two places at once) does: the preview lists it and, with the module on, publishing
 *    refuses it (Rotas::publish calls overlaps()).
 *  - Pattern times are wall-clock in the shift's site zone (else the organisation's), so 06:00 stays 06:00 across a clock change. One
 *    generation covers at most 92 days and 500 shifts, inside the rota's own period. `preview: true` runs the same generation and rolls it
 *    back, so the preview uses the very same rules.
 *  - Shifts are read with what is already committed elsewhere: this rota's shifts, published rotas (except the one this rota is amending)
 *    and shifts with no rota. Other drafts are not commitments and are not counted.
 *  - Owner and manager only. Behind the `scheduling_tools` feature flag (seeded off): with it off these routes answer 403 feature_off and
 *    every existing route behaves exactly as before.
 */
final class Scheduling implements Module
{
    public const FEATURE = 'scheduling_tools';
    private const MAX_PREVIEW = 500;

    public function __construct(private readonly Ctx $ctx) {}

    public function routes(): array
    {
        return [
            ['GET', '/orgs/{o}/rotas/{r}/publish-preview', $this->preview(...)],
            ['POST', '/orgs/{o}/rotas/{r}/patterns/generate', $this->generate(...)],
        ];
    }

    /** Is the module on for this organisation? Fails closed: a lookup error reads as off. */
    public static function on(\PDO $pdo, string $o): bool
    {
        try {
            return Flags::enabledForOrg($pdo, self::FEATURE, $o);
        } catch (\Throwable) {
            return false;
        }
    }

    // ---- publish preview ----------------------------------------------------------------------------------------------------------------

    /** Everything the next publish of this draft would put in front of staff, each shift with its warnings, and any blocking overlap. */
    private function preview(array $user, array $in, string $ip, string $o, string $r): array
    {
        $pdo = $this->ctx->pdo;
        $this->manager($user, $o, false);
        $rota = $this->rota($o, $r, false);
        if ($rota['status'] !== 'draft') {
            throw HttpError::conflict('rota_not_draft', 'Only a draft rota has a publish preview. Start an amendment to change a published one.');
        }
        $orgTz = Compliance::tz($pdo, $o);
        [$minRest, $maxWeek] = $this->limits($o);
        $shifts = self::rotaShifts($pdo, $o, $r, $orgTz);
        $total = count($shifts);
        $shown = array_slice($shifts, 0, self::MAX_PREVIEW);
        $context = self::context($pdo, $o, $rota, $shifts, $orgTz);
        [$leave, $avail] = self::personal($pdo, $o, $shifts);
        $warn = R::warnings($shown, $context, $leave, $avail, $minRest, $maxWeek, $orgTz);

        // What changes for staff: a first publish shows every shift as new; an amendment compares with the rota it replaces.
        $before = [];
        if ($rota['supersedes_rota_id'] !== null) {
            foreach (self::rotaShifts($pdo, $o, (string) $rota['supersedes_rota_id'], $orgTz) as $s) {
                if ($s['status'] !== 'cancelled') {
                    $before[self::key($s)][] = $s;
                }
            }
        }
        $rows = [];
        $byCode = [];
        $counts = ['new' => 0, 'unchanged' => 0, 'cancelled' => 0, 'removed' => 0];
        foreach ($shifts as $i => $s) {
            if ($s['status'] === 'cancelled') {
                $change = 'cancelled';
            } elseif (($before[self::key($s)] ?? []) !== []) {
                array_pop($before[self::key($s)]);
                $change = 'unchanged';
            } else {
                $change = 'new';
            }
            $counts[$change]++;
            if ($i >= self::MAX_PREVIEW) {
                continue;
            }
            $w = $warn[$s['id']] ?? [];
            foreach ($w as $x) {
                $byCode[$x['code']] = ($byCode[$x['code']] ?? 0) + 1;
            }
            $rows[] = self::present($s) + ['change' => $change, 'warnings' => $w];
        }
        $removed = [];
        foreach ($before as $left) {
            foreach ($left as $s) {
                $removed[] = self::present($s);
            }
        }
        $counts['removed'] = count($removed);
        $overlaps = self::overlapsOf($shifts, $context);
        return [200, [
            'rota' => ['id' => $rota['id'], 'name' => $rota['name'], 'period_start' => $rota['period_start'], 'period_end' => $rota['period_end'], 'supersedes_rota_id' => $rota['supersedes_rota_id']],
            'limits' => ['min_rest_hours' => $minRest, 'max_weekly_hours' => $maxWeek],
            'shifts' => $rows,
            'removed' => array_slice($removed, 0, self::MAX_PREVIEW),
            'total' => $total,
            'truncated' => $total > self::MAX_PREVIEW,
            'counts' => $counts,
            'with_warnings' => count($warn),
            'warnings_by_code' => (object) $byCode,
            'overlaps' => $overlaps,
            'can_publish' => $overlaps === [],
        ]];
    }

    // ---- patterns -----------------------------------------------------------------------------------------------------------------------

    /**
     * A recurring pattern becomes ordinary shifts in this draft rota. kind "weekly" (weekdays 1 = Monday .. 7) or "cycle" (days_on then
     * days_off from cycle_start); one to six time blocks a working day. A shift that would double-book the person, or repeat one already on
     * the rota, is skipped and reported, never forced.
     */
    private function generate(array $user, array $in, string $ip, string $o, string $r): array
    {
        $pdo = $this->ctx->pdo;
        $this->manager($user, $o, true);
        $preview = ($in['preview'] ?? false) === true;
        $orgTz = Compliance::tz($pdo, $o);
        [$minRest, $maxWeek] = $this->limits($o);
        $pdo->beginTransaction();
        try {
            $rota = $this->rota($o, $r, true);
            if ($rota['status'] !== 'draft') {
                throw HttpError::conflict('rota_not_draft', 'Patterns fill a draft rota. Start an amendment to change a published one.');
            }
            $rule = R::patternRule($in, (string) $rota['period_start'], (string) $rota['period_end']);
            $f = $this->fields($in, $o, $rota);
            $tz = $f['tz'] ?? $orgTz;
            $created = [];
            $skipped = [];
            $dup = $pdo->prepare("SELECT 1 FROM shifts WHERE org_id = ? AND rota_id = ? AND staff_profile_id <=> ? AND location_id <=> ? AND starts_at = ? AND ends_at = ? AND status <> 'cancelled' LIMIT 1");
            $clash = $pdo->prepare(
                "SELECT 1 FROM shifts s LEFT JOIN rotas x ON x.id = s.rota_id AND x.org_id = s.org_id
                  WHERE s.org_id = ? AND s.staff_profile_id = ? AND s.status <> 'cancelled' AND s.starts_at < ? AND s.ends_at > ?
                    AND (s.rota_id = ? OR s.rota_id IS NULL OR (x.status = 'published' AND x.id <> ?)) LIMIT 1"
            );
            $ins = $pdo->prepare('INSERT INTO shifts (id, org_id, rota_id, location_id, department_id, staff_profile_id, shift_type_id, starts_at, ends_at, break_minutes, status, colour, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)');
            foreach (R::expand($rule) as $it) {
                $s = R::localTs($it['date'], $it['start'], $tz);
                $e = R::localTs($it['end_date'], $it['end'], $tz);
                $a = gmdate('Y-m-d H:i:s', $s);
                $b = gmdate('Y-m-d H:i:s', $e);
                $report = ['date' => $it['date'], 'starts_at' => Time::iso($a), 'ends_at' => Time::iso($b)];
                if ($e <= $s) { // only possible inside a clock change, for a block of under an hour
                    $skipped[] = $report + ['reason' => 'invalid', 'message' => 'That block has no length on this day (the clocks change)'];
                    continue;
                }
                $dup->execute([$o, $r, $f['staff_profile_id'], $f['location_id'], $a, $b]);
                if ($dup->fetchColumn() !== false) {
                    $skipped[] = $report + ['reason' => 'duplicate', 'message' => 'The same shift is already on this rota'];
                    continue;
                }
                if ($f['staff_profile_id'] !== null) {
                    $clash->execute([$o, $f['staff_profile_id'], $b, $a, $r, (string) ($rota['supersedes_rota_id'] ?? '')]);
                    if ($clash->fetchColumn() !== false) {
                        $skipped[] = $report + ['reason' => 'overlap', 'message' => 'This person is already working then'];
                        continue;
                    }
                }
                $id = Db::uuid();
                $ins->execute([$id, $o, $r, $f['location_id'], $f['department_id'], $f['staff_profile_id'], $f['shift_type_id'], $a, $b, $rule['break_minutes'], $f['staff_profile_id'] !== null ? 'assigned' : 'open', $f['notes']]);
                $created[] = $id;
            }
            $warnings = [];
            if ($created !== []) {
                $all = self::rotaShifts($pdo, $o, $r, $orgTz);
                $mine = array_values(array_filter($all, static fn (array $x): bool => in_array($x['id'], $created, true)));
                [$leave, $avail] = self::personal($pdo, $o, $mine);
                $byId = R::warnings($mine, array_merge($all, self::context($pdo, $o, $rota, $mine, $orgTz)), $leave, $avail, $minRest, $maxWeek, $orgTz);
                foreach ($mine as $x) {
                    if (isset($byId[$x['id']])) {
                        $warnings[] = ['starts_at' => Time::iso($x['starts_at']), 'ends_at' => Time::iso($x['ends_at']), 'warnings' => $byId[$x['id']]];
                    }
                }
            }
            $result = ['created' => count($created), 'shift_ids' => $preview ? [] : $created, 'skipped' => $skipped, 'warnings' => $warnings, 'preview' => $preview];
            if ($preview) {
                $pdo->rollBack();
                return [200, $result];
            }
            Audit::log($pdo, $o, $user['id'], 'rota.pattern_generated', 'rotas', $r, ['kind' => $rule['kind'], 'from' => $rule['from'], 'to' => $rule['to'], 'created' => count($created), 'skipped' => count($skipped)], 'info', 'org', $ip);
            $pdo->commit();
        } catch (\Throwable $e) {
            if ($pdo->inTransaction()) {
                $pdo->rollBack();
            }
            throw $e;
        }
        return [200, $result];
    }

    // ---- services other modules call --------------------------------------------------------------------------------------------------

    /**
     * Pairs of one person's overlapping live shifts where at least one belongs to this rota, read against the committed context. Empty
     * means the rota can go out. Rotas::publish refuses anything else while the module is on.
     * @return list<array<string,mixed>>
     */
    public static function overlaps(\PDO $pdo, string $o, array $rota): array
    {
        $orgTz = Compliance::tz($pdo, $o);
        $shifts = self::rotaShifts($pdo, $o, (string) $rota['id'], $orgTz);
        return self::overlapsOf($shifts, self::context($pdo, $o, $rota, $shifts, $orgTz));
    }

    /**
     * The person's live shifts (drafts, published and loose; not archived history) that fall inside an approved leave request, for the
     * manager to arrange cover. Leave dates are read in each shift's site zone, else the organisation's.
     * @return list<array<string,mixed>>
     */
    public static function leaveClashes(\PDO $pdo, string $o, array $leave): array
    {
        $orgTz = Compliance::tz($pdo, $o);
        $lo = gmdate('Y-m-d H:i:s', R::localTs((string) $leave['start_date'], '00:00', 'Pacific/Kiritimati'));
        $hi = gmdate('Y-m-d H:i:s', R::localTs(R::addDays((string) $leave['end_date'], 1), '00:00', 'Pacific/Pago_Pago'));
        $q = $pdo->prepare(
            "SELECT s.id, s.rota_id, x.status AS rota_status, s.location_id, s.staff_profile_id, s.starts_at, s.ends_at, s.status, l.timezone
               FROM shifts s LEFT JOIN rotas x ON x.id = s.rota_id AND x.org_id = s.org_id LEFT JOIN locations l ON l.id = s.location_id AND l.org_id = s.org_id
              WHERE s.org_id = ? AND s.staff_profile_id = ? AND s.status <> 'cancelled' AND s.starts_at < ? AND s.ends_at > ?
                AND (s.rota_id IS NULL OR x.status IN ('draft','published'))
              ORDER BY s.starts_at, s.id LIMIT 500"
        );
        $q->execute([$o, $leave['staff_profile_id'], $hi, $lo]);
        $out = [];
        foreach ($q->fetchAll() as $s) {
            $tz = R::validZone($s['timezone']) ? (string) $s['timezone'] : $orgTz;
            $one = [['staff_profile_id' => $s['staff_profile_id'], 'status' => 'approved', 'start_date' => $leave['start_date'], 'end_date' => $leave['end_date'], 'type' => '']];
            if (R::leaveHit($one, (string) $s['staff_profile_id'], R::ts($s['starts_at']), R::ts($s['ends_at']), $tz) !== null) {
                $out[] = ['id' => $s['id'], 'rota_id' => $s['rota_id'], 'rota_status' => $s['rota_status'], 'location_id' => $s['location_id'], 'starts_at' => Time::iso($s['starts_at']), 'ends_at' => Time::iso($s['ends_at'])];
            }
        }
        return array_slice($out, 0, 200);
    }

    // ---- helpers ----------------------------------------------------------------------------------------------------------------------

    /** Membership first (a stranger gets 404 before anything else), then role, then the flag. */
    private function manager(array $user, string $o, bool $write): array
    {
        $pdo = $this->ctx->pdo;
        $m = Scope::membership($pdo, $user['id'], $o);
        Scope::require($m, Scope::MANAGERS);
        if (!self::on($pdo, $o)) {
            throw new HttpError(403, 'feature_off', 'Scheduling tools are not switched on for this organisation yet.');
        }
        if ($write) {
            Scope::requireWritable($m);
            Billing::requireNotReadOnly($pdo, $o);
        }
        return $m;
    }

    /** @return array<string,mixed> */
    private function rota(string $o, string $r, bool $lock): array
    {
        $q = $this->ctx->pdo->prepare('SELECT * FROM rotas WHERE id = ? AND org_id = ?' . ($lock ? ' FOR UPDATE' : ''));
        $q->execute([$r, $o]);
        return $q->fetch() ?: throw HttpError::notFound();
    }

    /** @return array{0:int,1:int} */
    private function limits(string $o): array
    {
        $q = $this->ctx->pdo->prepare('SELECT settings FROM organisations WHERE id = ?');
        $q->execute([$o]);
        return R::limits((string) $q->fetchColumn());
    }

    /**
     * The shift fields a pattern carries, every reference checked against this organisation. The site defaults to the rota's own.
     * @return array{location_id:?string,department_id:?string,staff_profile_id:?string,shift_type_id:?string,notes:?string,tz:?string}
     */
    private function fields(array $in, string $o, array $rota): array
    {
        $pdo = $this->ctx->pdo;
        $out = ['location_id' => $rota['location_id'], 'department_id' => null, 'staff_profile_id' => null, 'shift_type_id' => null];
        foreach (['location_id' => 'locations', 'department_id' => 'departments', 'staff_profile_id' => 'staff_profiles', 'shift_type_id' => 'shift_types'] as $k => $table) {
            if (!array_key_exists($k, $in) || $in[$k] === null) {
                continue;
            }
            $v = Input::optStr($in, $k, 36);
            if ($v !== null) {
                $c = $pdo->prepare("SELECT 1 FROM $table WHERE id = ? AND org_id = ?"); // $table comes from the literal map above
                $c->execute([$v, $o]);
                if ($c->fetchColumn() === false) {
                    throw HttpError::invalid("$k is not in this organisation");
                }
            }
            $out[$k] = $v;
        }
        $out['notes'] = Input::optStr($in, 'notes', 1000);
        $out['tz'] = null;
        if ($out['location_id'] !== null) {
            $z = $pdo->prepare('SELECT timezone FROM locations WHERE id = ? AND org_id = ?');
            $z->execute([$out['location_id'], $o]);
            $tz = $z->fetchColumn();
            $out['tz'] = R::validZone($tz) ? (string) $tz : null;
        }
        return $out;
    }

    /** This rota's shifts, each with its site zone (else the organisation's). @return list<array<string,mixed>> */
    private static function rotaShifts(\PDO $pdo, string $o, string $rotaId, string $orgTz): array
    {
        $q = $pdo->prepare('SELECT s.id, s.rota_id, s.location_id, s.staff_profile_id, s.starts_at, s.ends_at, s.break_minutes, s.status, l.timezone FROM shifts s LEFT JOIN locations l ON l.id = s.location_id AND l.org_id = s.org_id WHERE s.org_id = ? AND s.rota_id = ? ORDER BY s.starts_at, s.id');
        $q->execute([$o, $rotaId]);
        return array_map(static fn (array $s): array => ['timezone' => R::validZone($s['timezone']) ? $s['timezone'] : $orgTz, 'break_minutes' => (int) $s['break_minutes']] + $s, $q->fetchAll());
    }

    /**
     * The committed shifts the rota is read against: the same people's live shifts within eight days either side, on published rotas
     * (except the one this rota amends) or on no rota.
     * @param list<array<string,mixed>> $shifts
     * @return list<array<string,mixed>>
     */
    private static function context(\PDO $pdo, string $o, array $rota, array $shifts, string $orgTz): array
    {
        $people = array_values(array_unique(array_filter(array_map(static fn (array $s): ?string => $s['status'] !== 'cancelled' ? $s['staff_profile_id'] : null, $shifts))));
        if ($people === []) {
            return [];
        }
        $lo = min(array_map(static fn (array $s): int => R::ts($s['starts_at']), $shifts)) - 8 * 86400;
        $hi = max(array_map(static fn (array $s): int => R::ts($s['ends_at']), $shifts)) + 8 * 86400;
        $q = $pdo->prepare(
            "SELECT s.id, s.rota_id, s.location_id, s.staff_profile_id, s.starts_at, s.ends_at, s.break_minutes, s.status, l.timezone
               FROM shifts s LEFT JOIN rotas x ON x.id = s.rota_id AND x.org_id = s.org_id LEFT JOIN locations l ON l.id = s.location_id AND l.org_id = s.org_id
              WHERE s.org_id = ? AND s.status <> 'cancelled' AND s.starts_at < ? AND s.ends_at > ?
                AND s.staff_profile_id IN (" . implode(',', array_fill(0, count($people), '?')) . ")
                AND (s.rota_id IS NULL OR (x.status = 'published' AND x.id <> ? AND x.id <> ?))
              LIMIT 5000"
        );
        $q->execute([$o, gmdate('Y-m-d H:i:s', $hi), gmdate('Y-m-d H:i:s', $lo), ...$people, $rota['id'], (string) ($rota['supersedes_rota_id'] ?? '')]);
        return array_map(static fn (array $s): array => ['timezone' => R::validZone($s['timezone']) ? $s['timezone'] : $orgTz, 'break_minutes' => (int) $s['break_minutes']] + $s, $q->fetchAll());
    }

    /** Approved leave and 'unavailable' availability for the people on these shifts. @return array{0:list<array>,1:list<array>} */
    private static function personal(\PDO $pdo, string $o, array $shifts): array
    {
        $people = array_values(array_unique(array_filter(array_map(static fn (array $s): ?string => $s['staff_profile_id'], $shifts))));
        if ($people === []) {
            return [[], []];
        }
        $in = implode(',', array_fill(0, count($people), '?'));
        $l = $pdo->prepare("SELECT staff_profile_id, start_date, end_date, status, type FROM leave_requests WHERE org_id = ? AND status = 'approved' AND staff_profile_id IN ($in)");
        $l->execute([$o, ...$people]);
        $a = $pdo->prepare("SELECT staff_profile_id, weekday, date, start_time, end_time, status, recurring FROM availability WHERE org_id = ? AND status = 'unavailable' AND staff_profile_id IN ($in)");
        $a->execute([$o, ...$people]);
        return [$l->fetchAll(), $a->fetchAll()];
    }

    /**
     * @param list<array<string,mixed>> $shifts this rota's shifts
     * @param list<array<string,mixed>> $context
     * @return list<array<string,mixed>>
     */
    private static function overlapsOf(array $shifts, array $context): array
    {
        $live = array_values(array_filter($shifts, static fn (array $s): bool => $s['status'] !== 'cancelled' && $s['staff_profile_id'] !== null));
        $others = array_merge($live, array_values(array_filter($context, static fn (array $s): bool => $s['staff_profile_id'] !== null)));
        $out = [];
        $seen = [];
        foreach ($live as $a) {
            foreach ($others as $b) {
                if ($a['id'] === $b['id'] || $a['staff_profile_id'] !== $b['staff_profile_id']) {
                    continue;
                }
                $pair = $a['id'] < $b['id'] ? $a['id'] . $b['id'] : $b['id'] . $a['id'];
                if (isset($seen[$pair]) || !(R::ts($a['starts_at']) < R::ts($b['ends_at']) && R::ts($b['starts_at']) < R::ts($a['ends_at']))) {
                    continue;
                }
                $seen[$pair] = true;
                $out[] = ['staff_profile_id' => $a['staff_profile_id'], 'shift' => self::present($a), 'other' => self::present($b) + ['rota_id' => $b['rota_id']]];
                if (count($out) >= 100) {
                    return $out;
                }
            }
        }
        return $out;
    }

    private static function key(array $s): string
    {
        return $s['staff_profile_id'] . '|' . $s['location_id'] . '|' . $s['starts_at'] . '|' . $s['ends_at'];
    }

    /** @return array<string,mixed> */
    private static function present(array $s): array
    {
        return ['id' => $s['id'], 'staff_profile_id' => $s['staff_profile_id'], 'location_id' => $s['location_id'], 'starts_at' => Time::iso($s['starts_at']), 'ends_at' => Time::iso($s['ends_at']), 'break_minutes' => (int) $s['break_minutes'], 'status' => $s['status']];
    }
}
