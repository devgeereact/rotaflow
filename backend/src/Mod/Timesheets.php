<?php
declare(strict_types=1);

namespace RotaFlow\Mod;

use RotaFlow\{Audit, Ctx, Db, HttpError, Input, Module, Scope, Time};

/**
 * Timesheets: one decision per person per period. A person submits their own; an owner or manager approves a batch atomically
 * or sends one back. An approved or exported period is locked against a new submission. Correcting a clock event inside an approved
 * period flags it (recalculation_required_at) instead of silently changing a figure that has gone to payroll.
 */
final class Timesheets implements Module
{
    private const MAX_BATCH = 500;
    private const MAX_MINUTES = 100000; // ASSUMPTION: about 70 days of continuous work; a ceiling against a typo, not a rule

    public function __construct(private readonly Ctx $ctx) {}

    public function routes(): array
    {
        return [
            ['GET', '/orgs/{o}/timesheets', $this->list(...)],
            ['POST', '/orgs/{o}/timesheets/submit', $this->submit(...)],
            ['POST', '/orgs/{o}/timesheets/approve', $this->approve(...)],
            ['POST', '/orgs/{o}/timesheets/{t}/reopen', $this->reopen(...)],
        ];
    }

    /** Managers read everyone's; a member reads only their own. Filters: period_start, period_end, staff_profile_id, status. */
    private function list(array $user, array $in, string $ip, string $o): array
    {
        $pdo = $this->ctx->pdo;
        $m = Scope::membership($pdo, $user['id'], $o);
        $sql = 'SELECT * FROM timesheets WHERE org_id = ?';
        $args = [$o];
        if (in_array($m['effective_role'], Scope::MANAGERS, true)) {
            if (($sp = Input::optStr($in, 'staff_profile_id', 36)) !== null) {
                $sql .= ' AND staff_profile_id = ?';
                $args[] = $sp;
            }
        } else {
            $sql .= ' AND staff_profile_id = ?';
            $args[] = Scope::staffProfileId($pdo, $o, $user['id']) ?? '';
        }
        foreach (['period_start' => 'period_start >= ?', 'period_end' => 'period_end <= ?'] as $k => $cond) {
            if (($d = Input::optDate($in, $k)) !== null) {
                $sql .= " AND $cond";
                $args[] = $d;
            }
        }
        if (($st = Input::optStr($in, 'status', 20)) !== null) {
            $sql .= ' AND status = ?';
            $args[] = $st;
        }
        $q = $pdo->prepare($sql . ' ORDER BY period_start DESC, staff_profile_id LIMIT 2000');
        $q->execute($args);
        return [200, ['timesheets' => array_map($this->present(...), $q->fetchAll())]];
    }

    /** A person submits their own period total. Refused once the period is approved or exported. */
    private function submit(array $user, array $in, string $ip, string $o): array
    {
        $pdo = $this->ctx->pdo;
        $m = Scope::membership($pdo, $user['id'], $o);
        Scope::requireWritable($m);
        $own = Scope::staffProfileId($pdo, $o, $user['id']);
        if ($own === null) {
            throw new HttpError(403, 'no_staff_record', 'You do not have a staff record in this organisation');
        }
        [$from, $to] = $this->period($in);
        $minutes = $this->minutes($in['total_minutes'] ?? null);
        $pdo->beginTransaction();
        try {
            $q = $pdo->prepare('SELECT id, status FROM timesheets WHERE org_id = ? AND staff_profile_id = ? AND period_start = ? AND period_end = ? FOR UPDATE');
            $q->execute([$o, $own, $from, $to]);
            $cur = $q->fetch();
            if ($cur !== false && in_array($cur['status'], ['approved', 'exported'], true)) {
                throw HttpError::conflict('timesheet_locked', 'That period has already been approved');
            }
            if ($cur === false) {
                $id = Db::uuid();
                $pdo->prepare("INSERT INTO timesheets (id, org_id, staff_profile_id, period_start, period_end, total_minutes, status) VALUES (?, ?, ?, ?, ?, ?, 'submitted')")->execute([$id, $o, $own, $from, $to, $minutes]);
            } else {
                $id = $cur['id'];
                $pdo->prepare("UPDATE timesheets SET total_minutes = ?, status = 'submitted' WHERE id = ?")->execute([$minutes, $id]);
            }
            Audit::log($pdo, $o, $user['id'], 'timesheet.submitted', 'timesheets', (string) $id, [], 'info', 'org', $ip);
            $pdo->commit();
        } catch (\Throwable $e) {
            $pdo->rollBack();
            throw $e;
        }
        return [200, ['timesheet' => $this->present($this->one($o, (string) $id))]];
    }

    /** Owner or manager approves a batch for one period, all or nothing. Re-approving replaces the earlier figure and bumps the version. */
    private function approve(array $user, array $in, string $ip, string $o): array
    {
        $pdo = $this->ctx->pdo;
        $m = Scope::membership($pdo, $user['id'], $o);
        Scope::require($m, Scope::MANAGERS);
        Scope::requireWritable($m);
        [$from, $to] = $this->period($in);
        $rows = $in['approvals'] ?? null;
        if (!is_array($rows) || !array_is_list($rows) || $rows === [] || count($rows) > self::MAX_BATCH) {
            throw HttpError::invalid('approvals must be a list of 1 to ' . self::MAX_BATCH . ' entries');
        }
        $ids = [];
        $pdo->beginTransaction();
        try {
            $ok = $pdo->prepare('SELECT 1 FROM staff_profiles WHERE id = ? AND org_id = ?');
            $ins = $pdo->prepare(
                "INSERT INTO timesheets (id, org_id, staff_profile_id, period_start, period_end, total_minutes, status, approved_by, approved_at, version)
                 VALUES (?, ?, ?, ?, ?, ?, 'approved', ?, UTC_TIMESTAMP(), 1)
                 ON DUPLICATE KEY UPDATE total_minutes = VALUES(total_minutes), status = 'approved', approved_by = VALUES(approved_by), approved_at = UTC_TIMESTAMP(), version = version + 1, recalculation_required_at = NULL"
            );
            foreach ($rows as $r) {
                if (!is_array($r)) {
                    throw HttpError::invalid('each approval must be an object');
                }
                $sp = Input::reqStr($r, 'staff_profile_id', 36);
                $ok->execute([$sp, $o]);
                if ($ok->fetchColumn() === false) {
                    throw HttpError::invalid('A staff member is not in this organisation');
                }
                $ins->execute([Db::uuid(), $o, $sp, $from, $to, $this->minutes($r['total_minutes'] ?? null), $user['id']]);
                $ids[] = $sp;
            }
            Audit::log($pdo, $o, $user['id'], 'timesheet.approved', 'timesheets', null, ['count' => count($ids), 'period_start' => $from, 'period_end' => $to], 'info', 'org', $ip);
            $pdo->commit();
        } catch (\Throwable $e) {
            $pdo->rollBack();
            throw $e;
        }
        $in2 = $pdo->prepare('SELECT * FROM timesheets WHERE org_id = ? AND period_start = ? AND period_end = ? AND staff_profile_id IN (' . implode(',', array_fill(0, count($ids), '?')) . ')');
        $in2->execute([$o, $from, $to, ...$ids]);
        return [200, ['timesheets' => array_map($this->present(...), $in2->fetchAll())]];
    }

    /** Send a decision back: the row returns to open, and keeps its history (who approved it, and when, are left in place). */
    private function reopen(array $user, array $in, string $ip, string $o, string $t): array
    {
        $pdo = $this->ctx->pdo;
        $m = Scope::membership($pdo, $user['id'], $o);
        Scope::require($m, Scope::MANAGERS);
        Scope::requireWritable($m);
        $this->one($o, $t);
        $pdo->prepare("UPDATE timesheets SET status = 'open' WHERE id = ? AND org_id = ?")->execute([$t, $o]);
        Audit::log($pdo, $o, $user['id'], 'timesheet.reopened', 'timesheets', $t, [], 'warning', 'org', $ip);
        return [200, ['timesheet' => $this->present($this->one($o, $t))]];
    }

    // ---- helpers ---------------------------------------------------------------------------------------

    /** @return array{0:string,1:string} */
    private function period(array $in): array
    {
        $from = Input::optDate($in, 'period_start');
        $to = Input::optDate($in, 'period_end');
        if ($from === null || $to === null || $to < $from) {
            throw HttpError::invalid('period_start and period_end are required, and the period cannot end before it starts');
        }
        return [$from, $to];
    }

    private function minutes(mixed $v): int
    {
        if (!is_int($v) || $v < 0 || $v > self::MAX_MINUTES) {
            throw HttpError::invalid('total_minutes must be a whole number of minutes, 0 to ' . self::MAX_MINUTES);
        }
        return $v;
    }

    /** @return array<string,mixed> */
    private function one(string $o, string $t): array
    {
        $q = $this->ctx->pdo->prepare('SELECT * FROM timesheets WHERE id = ? AND org_id = ?');
        $q->execute([$t, $o]);
        return $q->fetch() ?: throw HttpError::notFound();
    }

    /** @param array<string,mixed> $r */
    private function present(array $r): array
    {
        foreach (['approved_at', 'recalculation_required_at', 'created_at', 'updated_at'] as $k) {
            $r[$k] = Time::iso($r[$k] ?? null);
        }
        $r['total_minutes'] = (int) $r['total_minutes'];
        $r['version'] = (int) $r['version'];
        return $r;
    }
}
