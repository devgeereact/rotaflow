<?php
declare(strict_types=1);

namespace RotaFlow\Mod;

use RotaFlow\{Audit, Ctx, Db, Flags, HttpError, Input, Module, SchedulingRules, Scope, Time, TimesheetRules as R};

/**
 * Timesheets: one decision per person per period. A person submits their own; an owner or manager approves a batch atomically
 * or sends one back. An approved or exported period is locked against a new submission. Correcting a clock event inside an approved
 * period flags it (recalculation_required_at) instead of silently changing a figure that has gone to payroll.
 *
 * R2 slice S13, behind the `timesheet_tools` flag (seeded off; fails closed). With it on:
 *  - the list response gains `lines` (one per shift with a staff record in the asked period, at most 31 days, with its clock events and
 *    the late / early finish / overtime flags beyond the organisation's tolerance) and `tolerance_minutes`. Pure rules: TimesheetRules.
 *  - GET timesheets/export answers the payroll CSV of APPROVED (or exported) periods inside the range, owners and managers only, never a
 *    platform support session. Reading it changes nothing (it does not mark periods exported).
 *  - POST timesheets/export answers the same file and marks the included approved periods `exported`, in one transaction with the
 *    organisation lock first (owner decision, 31 Oct 2026), so a period is not sent to payroll twice without anyone seeing it.
 * With it off the list answers exactly what it did and the export answers 403 feature_off (after membership, so a stranger gets 404).
 */
final class Timesheets implements Module
{
    public const FEATURE = 'timesheet_tools';
    private const MAX_BATCH = 500;
    private const MAX_MINUTES = 100000; // ASSUMPTION: about 70 days of continuous work; a ceiling against a typo, not a rule
    private const MAX_LINES = 5000;
    /** Clock events read this long after the last shift ends, so a late clock-out still pairs; later than that reads as missing. */
    private const LATE_OUT_MS = 12 * 3600 * 1000;

    public function __construct(private readonly Ctx $ctx) {}

    /** Is the module on for this organisation? Fails closed: a lookup error reads as off. */
    public static function on(\PDO $pdo, string $o): bool
    {
        try {
            return Flags::enabledForOrg($pdo, self::FEATURE, $o);
        } catch (\Throwable) {
            return false;
        }
    }

    public function routes(): array
    {
        return [
            ['GET', '/orgs/{o}/timesheets', $this->list(...)],
            ['GET', '/orgs/{o}/timesheets/export', $this->export(...)],
            ['POST', '/orgs/{o}/timesheets/export', $this->exportAndMark(...)],
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
        $out = ['timesheets' => array_map($this->present(...), $q->fetchAll())];
        if (self::on($pdo, $o)) {
            // The same person filter as the rows above: a member only ever sees their own lines.
            $only = in_array($m['effective_role'], Scope::MANAGERS, true) ? Input::optStr($in, 'staff_profile_id', 36) : (Scope::staffProfileId($pdo, $o, $user['id']) ?? '');
            $range = R::range($in['period_start'] ?? null, $in['period_end'] ?? null);
            $settings = $this->settings($o);
            // No lines (null) when the period is missing or longer than 31 days: the list itself still answers as before.
            $out['lines'] = is_array($range) ? $this->lines($o, $range[0], $range[1], $only, $settings) : null;
            $out['tolerance_minutes'] = R::tolerance($settings);
        }
        return [200, $out];
    }

    /**
     * The payroll CSV (owners and managers; never a platform support session, since it is pay data leaving the product). Approved and
     * exported periods that lie wholly inside period_start..period_end (at most 31 days), one row per person per period, in the fixed
     * column order of TimesheetRules::COLUMNS. The figure is the APPROVED total_minutes, not a recalculation; a period whose clock events
     * were corrected after approval says so in "Recalculation required". UTF-8 with a BOM; every text cell formula-safe. Sent as an
     * attachment named rotaflow-timesheets-<org slug>-<start>-<end>.csv. GET only reads: nothing is marked (see exportAndMark).
     */
    private function export(array $user, array $in, string $ip, string $o): array
    {
        return $this->payroll($user, $in, $ip, $o, false);
    }

    /**
     * POST timesheets/export {period_start, period_end} (owner decision, 31 Oct 2026: exporting marks, so payroll is not paid twice). The
     * same file as the GET, and in ONE transaction, the organisation row locked first (the R2 lock order), then the included periods: every
     * included `approved` period becomes `exported`. Periods already `exported` stay so and are still in the file. The Status column says
     * what each period was when this export began, so `approved` is new in this file and `exported` was sent before; the response headers
     * X-RotaFlow-Marked-Exported and X-RotaFlow-Already-Exported give the counts. Two exports at once: the second waits on the lock and
     * then marks nothing. Needs a writable membership; not refused for read-only billing (staff still have to be paid).
     */
    private function exportAndMark(array $user, array $in, string $ip, string $o): array
    {
        return $this->payroll($user, $in, $ip, $o, true);
    }

    private function payroll(array $user, array $in, string $ip, string $o, bool $mark): array
    {
        $pdo = $this->ctx->pdo;
        $m = Scope::membership($pdo, $user['id'], $o);
        if (!self::on($pdo, $o)) {
            throw new HttpError(403, 'feature_off', 'Timesheet tools are not switched on for this organisation yet.');
        }
        Scope::require($m, Scope::MANAGERS);
        if (($m['support'] ?? null) !== null) {
            throw HttpError::forbidden('Platform support cannot export payroll');
        }
        if ($mark) {
            Scope::requireWritable($m);
        }
        $range = R::range($in['period_start'] ?? null, $in['period_end'] ?? null);
        if (is_string($range)) {
            throw HttpError::invalid($range);
        }
        [$from, $to] = $range;
        $slug = $pdo->prepare('SELECT slug FROM organisations WHERE id = ?');
        $slug->execute([$o]);
        $file = ['mime' => 'text/csv; charset=utf-8', 'cache' => 'no-store', 'disposition' => 'attachment', 'filename' => R::exportFilename((string) $slug->fetchColumn(), $from, $to)];
        if (!$mark) {
            [$body, $periods] = $this->payrollCsv($o, $from, $to);
            Audit::log($pdo, $o, $user['id'], 'timesheet.exported', 'timesheets', null, ['period_start' => $from, 'period_end' => $to, 'rows' => count($periods)], 'info', 'org', $ip);
            return [200, ['__raw' => $file + ['body' => $body]]];
        }
        $pdo->beginTransaction();
        try {
            Cover::lockOrg($pdo, $o); // first, as every R2 writer: two exports of one range never both mark, and never deadlock
            $lk = $pdo->prepare("SELECT id FROM timesheets WHERE org_id = ? AND status IN ('approved','exported') AND period_start >= ? AND period_end <= ? ORDER BY id FOR UPDATE");
            $lk->execute([$o, $from, $to]);
            $lk->fetchAll();
            [$body, $periods] = $this->payrollCsv($o, $from, $to);
            $ids = array_values(array_map(static fn (array $p): string => (string) $p['id'], array_filter($periods, static fn (array $p): bool => $p['status'] === 'approved')));
            $marked = 0;
            foreach (array_chunk($ids, 500) as $chunk) {
                $u = $pdo->prepare("UPDATE timesheets SET status = 'exported' WHERE org_id = ? AND status = 'approved' AND id IN (" . implode(',', array_fill(0, count($chunk), '?')) . ')');
                $u->execute([$o, ...$chunk]);
                $marked += $u->rowCount();
            }
            $already = count($periods) - count($ids);
            Audit::log($pdo, $o, $user['id'], 'timesheet.exported', 'timesheets', null, ['period_start' => $from, 'period_end' => $to, 'rows' => count($periods), 'marked' => $marked, 'already_exported' => $already], 'info', 'org', $ip);
            $pdo->commit();
        } catch (\Throwable $e) {
            $pdo->rollBack();
            throw $e;
        }
        return [200, ['__raw' => $file + ['body' => $body, 'headers' => ['X-RotaFlow-Marked-Exported' => (string) $marked, 'X-RotaFlow-Already-Exported' => (string) $already]]]];
    }

    /**
     * The CSV body and the periods in it (each with its id and its status as read now).
     * @return array{0:string,1:list<array<string,mixed>>}
     */
    private function payrollCsv(string $o, string $from, string $to): array
    {
        $pdo = $this->ctx->pdo;
        $tz = Compliance::tz($pdo, $o);
        $q = $pdo->prepare(
            "SELECT t.id, t.staff_profile_id, t.period_start, t.period_end, t.total_minutes, t.status, t.version, t.approved_at, t.recalculation_required_at,
                    sp.first_name, sp.last_name, sp.payroll_id,
                    COALESCE(NULLIF(TRIM(CONCAT(ap.first_name, ' ', ap.last_name)), ''), NULLIF(TRIM(u.full_name), ''), u.email) AS approver
               FROM timesheets t
               JOIN staff_profiles sp ON sp.org_id = t.org_id AND sp.id = t.staff_profile_id
               LEFT JOIN users u ON u.id = t.approved_by
               LEFT JOIN staff_profiles ap ON ap.org_id = t.org_id AND ap.user_id = t.approved_by
              WHERE t.org_id = ? AND t.status IN ('approved','exported') AND t.period_start >= ? AND t.period_end <= ?
              ORDER BY sp.last_name, sp.first_name, sp.id, t.period_start, t.period_end
              LIMIT 5000"
        );
        $q->execute([$o, $from, $to]);
        $periods = $q->fetchAll();
        // Flag counts per person per period, from the same lines the screen shows (any staff record, the whole range, once).
        $byStaff = [];
        if ($periods !== []) {
            foreach ($this->lines($o, $from, $to, null, $this->settings($o)) as $l) {
                $byStaff[$l['staff_profile_id']][] = [SchedulingRules::localParts(intdiv(R::ms($l['scheduled_start']), 1000), $tz)[0], $l['flags']];
            }
        }
        $rows = [R::COLUMNS];
        foreach ($periods as $p) {
            $count = ['late' => 0, 'early_finish' => 0, 'overtime' => 0];
            foreach ($byStaff[$p['staff_profile_id']] ?? [] as [$day, $flags]) {
                if ($day >= $p['period_start'] && $day <= $p['period_end']) {
                    foreach ($count as $k => $_) {
                        $count[$k] += $flags[$k] ? 1 : 0;
                    }
                }
            }
            $minutes = (int) $p['total_minutes'];
            $at = $p['approved_at'] !== null ? SchedulingRules::localParts(intdiv(R::ms((string) $p['approved_at']), 1000), $tz) : null;
            $rows[] = [
                trim($p['first_name'] . ' ' . $p['last_name']), (string) ($p['payroll_id'] ?? ''), (string) $p['staff_profile_id'],
                (string) $p['period_start'], (string) $p['period_end'], $minutes, R::hours($minutes), (string) $p['status'], (int) $p['version'],
                (string) ($p['approver'] ?? ''), $at !== null ? $at[0] . ' ' . $at[1] : '', $p['recalculation_required_at'] !== null ? 'Yes' : 'No',
                $count['late'], $count['early_finish'], $count['overtime'], $tz,
            ];
        }
        return [R::csv($rows), $periods];
    }

    /**
     * Lines for shifts starting in the local dates from..to (the organisation's timezone): shifts with a staff record that are not
     * cancelled and belong to a published or archived rota (or to none), as members read them; paired with that person's clock events.
     * Draft-rota shifts are not lines: nobody is working to them yet.
     * @return list<array<string,mixed>>
     */
    private function lines(string $o, string $from, string $to, ?string $only, ?string $settings): array
    {
        $pdo = $this->ctx->pdo;
        if ($only === '') {
            return [];
        }
        [$a, $b] = R::window($from, $to, Compliance::tz($pdo, $o));
        $db = static fn (int $ms): string => gmdate('Y-m-d H:i:s', intdiv($ms, 1000));
        $sql = "SELECT s.id, s.staff_profile_id, s.location_id, s.starts_at, s.ends_at, s.break_minutes
                  FROM shifts s LEFT JOIN rotas r ON r.org_id = s.org_id AND r.id = s.rota_id
                 WHERE s.org_id = ? AND s.staff_profile_id IS NOT NULL AND s.status <> 'cancelled'
                   AND (s.rota_id IS NULL OR r.status IN ('published','archived')) AND s.starts_at >= ? AND s.starts_at < ?";
        $args = [$o, $db($a), $db($b)];
        if ($only !== null) {
            $sql .= ' AND s.staff_profile_id = ?';
            $args[] = $only;
        }
        $q = $pdo->prepare($sql . ' ORDER BY s.starts_at, s.id LIMIT ' . self::MAX_LINES);
        $q->execute($args);
        $shifts = $q->fetchAll();
        if ($shifts === []) {
            return [];
        }
        $byStaff = [];
        $lo = PHP_INT_MAX;
        $hi = 0;
        foreach ($shifts as $s) {
            $byStaff[$s['staff_profile_id']][] = $s;
            $lo = min($lo, R::ms($s['starts_at']));
            $hi = max($hi, R::ms($s['ends_at']));
        }
        $ids = array_keys($byStaff);
        $e = $pdo->prepare('SELECT staff_profile_id, type, event_at FROM clock_events WHERE org_id = ? AND event_at >= ? AND event_at < ? AND staff_profile_id IN (' . implode(',', array_fill(0, count($ids), '?')) . ') ORDER BY event_at, id');
        $e->execute([$o, $db($lo - R::EARLY_ARRIVAL_MS), $db($hi + self::LATE_OUT_MS), ...array_map('strval', $ids)]);
        $events = [];
        foreach ($e->fetchAll() as $ev) {
            $events[$ev['staff_profile_id']][] = $ev;
        }
        $tol = R::tolerance($settings);
        $paid = R::breaksPaid($settings);
        $now = time() * 1000;
        $segFor = [];
        foreach ($byStaff as $sp => $list) {
            $segFor += R::assign($list, R::segments($events[$sp] ?? []));
        }
        return array_map(static fn (array $s): array => R::line($s, $segFor[$s['id']] ?? null, $now, $tol, $paid), $shifts);
    }

    private function settings(string $o): ?string
    {
        $q = $this->ctx->pdo->prepare('SELECT settings FROM organisations WHERE id = ?');
        $q->execute([$o]);
        $v = $q->fetchColumn();
        return is_string($v) ? $v : null;
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
            if ($cur !== false && $cur['status'] === 'exported' && self::on($pdo, $o)) {
                throw self::alreadyExported();
            }
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
        $tools = self::on($pdo, $o);
        $pdo->beginTransaction();
        try {
            if ($tools) {
                // Owner decision (31 Oct 2026): a period exported to payroll is not approved again (that would put it back to approved
                // with a new figure and send it to payroll a second time). The organisation lock first, as the marking export takes it,
                // so an approval and an export of the same period are ordered, never interleaved. Off, approval is exactly as before.
                Cover::lockOrg($pdo, $o);
                $people = array_values(array_filter(array_map(static fn (mixed $r): ?string => is_array($r) && is_string($r['staff_profile_id'] ?? null) ? $r['staff_profile_id'] : null, $rows)));
                if ($people !== []) {
                    $ex = $pdo->prepare("SELECT 1 FROM timesheets WHERE org_id = ? AND period_start = ? AND period_end = ? AND status = 'exported' AND staff_profile_id IN (" . implode(',', array_fill(0, count($people), '?')) . ') LIMIT 1 FOR UPDATE');
                    $ex->execute([$o, $from, $to, ...$people]);
                    if ($ex->fetchColumn() !== false) {
                        throw self::alreadyExported();
                    }
                }
            }
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
        $cur = $this->one($o, $t);
        if ($cur['status'] === 'exported' && self::on($pdo, $o)) {
            return $this->reopenExported($m, $user, $in, $ip, $o, $t);
        }
        $pdo->prepare("UPDATE timesheets SET status = 'open' WHERE id = ? AND org_id = ?")->execute([$t, $o]);
        Audit::log($pdo, $o, $user['id'], 'timesheet.reopened', 'timesheets', $t, [], 'warning', 'org', $ip);
        return [200, ['timesheet' => $this->present($this->one($o, $t))]];
    }

    /**
     * Owner decision (31 Oct 2026), flag on: the deliberate path for a genuine correction to a period already exported to payroll. Owner
     * only (a manager gets 409 already_exported, which tells them to ask an owner), never a support session, a reason of 3 to 500
     * characters (kept in timesheet_reopenings, not in the audit log). exported -> approved with version + 1, so the corrected figure can be
     * approved again and the next export carries it under a new version. One transaction, the organisation lock first (as export and
     * approval), then the period, re-read: two owners reopening at once reopen once.
     */
    private function reopenExported(array $m, array $user, array $in, string $ip, string $o, string $t): array
    {
        $pdo = $this->ctx->pdo;
        if (($m['support'] ?? null) !== null) {
            throw HttpError::forbidden('Platform support cannot reopen payroll');
        }
        if ($m['effective_role'] !== 'owner') {
            throw self::alreadyExported();
        }
        $reason = trim(is_string($in['reason'] ?? null) ? $in['reason'] : '');
        if (\RotaFlow\Str::len($reason) < 3 || \RotaFlow\Str::len($reason) > 500) {
            throw HttpError::invalid('Say why this exported period must change (3 to 500 characters)');
        }
        $pdo->beginTransaction();
        try {
            Cover::lockOrg($pdo, $o);
            $q = $pdo->prepare('SELECT status, version, period_start, period_end FROM timesheets WHERE id = ? AND org_id = ? FOR UPDATE');
            $q->execute([$t, $o]);
            $row = $q->fetch() ?: throw HttpError::notFound();
            if ($row['status'] !== 'exported') {
                throw HttpError::conflict('not_exported', 'That period is no longer exported; it has already been reopened');
            }
            $version = (int) $row['version'] + 1;
            $pdo->prepare("UPDATE timesheets SET status = 'approved', version = ? WHERE id = ? AND org_id = ? AND status = 'exported'")->execute([$version, $t, $o]);
            $pdo->prepare("INSERT INTO timesheet_reopenings (id, org_id, timesheet_id, actor_user_id, reason, from_status, to_status, version_after) VALUES (?, ?, ?, ?, ?, 'exported', 'approved', ?)")
                ->execute([Db::uuid(), $o, $t, $user['id'], $reason, $version]);
            Audit::log($pdo, $o, $user['id'], 'timesheet.export_reopened', 'timesheets', $t, ['period_start' => (string) $row['period_start'], 'period_end' => (string) $row['period_end'], 'from' => 'exported', 'to' => 'approved', 'version' => $version], 'warning', 'org', $ip);
            $pdo->commit();
        } catch (\Throwable $e) {
            $pdo->rollBack();
            throw $e;
        }
        return [200, ['timesheet' => $this->present($this->one($o, $t))]];
    }

    private static function alreadyExported(): HttpError
    {
        return HttpError::conflict('already_exported', 'This period has been exported to payroll. Ask an owner to reopen it if it must change.');
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
