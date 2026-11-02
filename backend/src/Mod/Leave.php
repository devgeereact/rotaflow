<?php
declare(strict_types=1);

namespace RotaFlow\Mod;

use RotaFlow\{Audit, Ctx, Db, HttpError, Input, Module, Notify, RotaDiff, Scope, Time};

/**
 * Leave and overtime requests. A person asks for themselves; an owner or manager can ask for anyone and decides. A decision is made
 * once, on a pending request. Nobody is booked off twice for the same day: one person, one live (pending or approved) leave
 * booking per day, whatever its type, checked under a lock on the person's record because the old exclusion constraint has
 * no MariaDB equivalent.
 */
final class Leave implements Module
{
    private const MAX_LEAVE_DAYS = 366; // ASSUMPTION: the old schema had no bound; a year-long request is a typo or a different process

    public function __construct(private readonly Ctx $ctx) {}

    public function routes(): array
    {
        return [
            ['GET', '/orgs/{o}/leave', $this->listLeave(...)],
            ['POST', '/orgs/{o}/leave', $this->createLeave(...)],
            ['POST', '/orgs/{o}/leave/{l}/review', $this->reviewLeave(...)],
            ['POST', '/orgs/{o}/leave/{l}/cancel', $this->cancelLeave(...)],
            ['GET', '/orgs/{o}/overtime', $this->listOvertime(...)],
            ['POST', '/orgs/{o}/overtime', $this->createOvertime(...)],
            ['POST', '/orgs/{o}/overtime/{v}/review', $this->reviewOvertime(...)],
            ['POST', '/orgs/{o}/overtime/{v}/cancel', $this->cancelOvertime(...)],
            ['GET', '/orgs/{o}/overtime/evidence', $this->evidence(...)],
            ['GET', '/orgs/{o}/attention', $this->attention(...)],
        ];
    }

    // ---- leave -----------------------------------------------------------------------------------------

    /** Managers read everyone's (filter: staff_profile_id, status, from, to); a member reads only their own. */
    private function listLeave(array $user, array $in, string $ip, string $o): array
    {
        [$m, $own] = $this->who($user, $o);
        $sql = 'SELECT * FROM leave_requests WHERE org_id = ?';
        $args = [$o];
        $this->scopeToPerson($sql, $args, $m, $own, $in);
        if (($st = Input::optStr($in, 'status', 20)) !== null) {
            $sql .= ' AND status = ?';
            $args[] = $st;
        }
        foreach (['from' => 'end_date >= ?', 'to' => 'start_date <= ?'] as $k => $cond) {
            if (($d = Input::optDate($in, $k)) !== null) {
                $sql .= " AND $cond";
                $args[] = $d;
            }
        }
        $q = $this->ctx->pdo->prepare($sql . ' ORDER BY start_date DESC, created_at DESC LIMIT 1000');
        $q->execute($args);
        return [200, ['leave' => array_map($this->presentLeave(...), $q->fetchAll())]];
    }

    private function createLeave(array $user, array $in, string $ip, string $o): array
    {
        $pdo = $this->ctx->pdo;
        [$m, $own] = $this->who($user, $o);
        Scope::requireWritable($m);
        $staff = $this->subject($in, $m, $own, $o);
        $start = Input::optDate($in, 'start_date');
        $end = Input::optDate($in, 'end_date');
        if ($start === null || $end === null || $end < $start) {
            throw HttpError::invalid('start_date and end_date are required, and the leave cannot end before it starts');
        }
        if ((strtotime($end) - strtotime($start)) / 86400 + 1 > self::MAX_LEAVE_DAYS) {
            throw HttpError::invalid('Leave cannot be longer than a year');
        }
        $type = Input::optStr($in, 'type', 40) ?? 'holiday';
        if (preg_match('/^[a-z][a-z_]{0,39}$/', $type) !== 1) {
            throw HttpError::invalid('type is not valid');
        }
        $sh = ($in['starts_half'] ?? false) === true ? 1 : 0;
        $eh = ($in['ends_half'] ?? false) === true ? 1 : 0;
        $cid = $this->clientId($in);
        if ($cid !== null && ($prior = $this->byClient('leave_requests', $cid)) !== null) {
            return $this->replay($prior, $o, $staff, 'leave', $this->presentLeave(...));
        }
        $id = Db::uuid();
        $pdo->beginTransaction();
        try {
            // The person's staff record is the lock: two requests for the same person queue here, so neither can slip past the other's overlap check.
            $lock = $pdo->prepare('SELECT id FROM staff_profiles WHERE id = ? AND org_id = ? FOR UPDATE');
            $lock->execute([$staff, $o]);
            $lock->fetchColumn();
            $clash = $pdo->prepare("SELECT 1 FROM leave_requests WHERE org_id = ? AND staff_profile_id = ? AND status IN ('pending','approved') AND start_date <= ? AND end_date >= ? LIMIT 1");
            $clash->execute([$o, $staff, $end, $start]);
            if ($clash->fetchColumn() !== false) {
                throw HttpError::conflict('leave_overlap', 'That person already has leave booked on one of those days');
            }
            $pdo->prepare('INSERT INTO leave_requests (id, org_id, staff_profile_id, type, start_date, end_date, starts_half, ends_half, reason, client_event_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
                ->execute([$id, $o, $staff, $type, $start, $end, $sh, $eh, Input::optStr($in, 'reason', 1000), $cid]);
            Audit::log($pdo, $o, $user['id'], 'leave.requested', 'leave_requests', $id, [], 'info', 'org', $ip);
            $pdo->commit();
        } catch (\PDOException $e) {
            $pdo->rollBack();
            if ($cid !== null && $e->getCode() === '23000' && ($prior = $this->byClient('leave_requests', $cid)) !== null) {
                return $this->replay($prior, $o, $staff, 'leave', $this->presentLeave(...));
            }
            throw $e;
        } catch (\Throwable $e) {
            $pdo->rollBack();
            throw $e;
        }
        return [201, ['leave' => $this->presentLeave($this->row('leave_requests', $o, $id)), 'already_applied' => false]];
    }

    /** Owner or manager: a pending request becomes approved or rejected, once. */
    private function reviewLeave(array $user, array $in, string $ip, string $o, string $l): array
    {
        [$status, $body] = $this->review('leave_requests', 'leave', $user, $in, $ip, $o, $l, $this->presentLeave(...));
        // S11: with the scheduling module on, an approval also lists the person's shifts that now clash, so cover can be arranged. Off, the
        // response is exactly as before.
        if (Scheduling::on($this->ctx->pdo, $o)) {
            $body['clashing_shifts'] = $body['leave']['status'] === 'approved' ? Scheduling::leaveClashes($this->ctx->pdo, $o, $this->row('leave_requests', $o, $l)) : [];
        }
        return [$status, $body];
    }

    /** The person (or a manager) withdraws a pending or approved request. */
    private function cancelLeave(array $user, array $in, string $ip, string $o, string $l): array
    {
        return $this->cancel('leave_requests', 'leave', $user, $ip, $o, $l, ['pending', 'approved'], $this->presentLeave(...));
    }

    // ---- overtime --------------------------------------------------------------------------------------

    private function listOvertime(array $user, array $in, string $ip, string $o): array
    {
        [$m, $own] = $this->who($user, $o);
        $sql = 'SELECT * FROM overtime_requests WHERE org_id = ?';
        $args = [$o];
        $this->scopeToPerson($sql, $args, $m, $own, $in);
        if (($st = Input::optStr($in, 'status', 20)) !== null) {
            $sql .= ' AND status = ?';
            $args[] = $st;
        }
        $q = $this->ctx->pdo->prepare($sql . ' ORDER BY date DESC, created_at DESC LIMIT 1000');
        $q->execute($args);
        return [200, ['overtime' => array_map($this->presentOvertime(...), $q->fetchAll())]];
    }

    private function createOvertime(array $user, array $in, string $ip, string $o): array
    {
        $pdo = $this->ctx->pdo;
        [$m, $own] = $this->who($user, $o);
        Scope::requireWritable($m);
        $staff = $this->subject($in, $m, $own, $o);
        $date = Input::optDate($in, 'date');
        $hours = Input::optNum($in, 'hours', 0.25, 24);
        if ($date === null || $hours === null) {
            throw HttpError::invalid('date and hours (0.25 to 24) are required');
        }
        $id = Db::uuid();
        $pdo->prepare('INSERT INTO overtime_requests (id, org_id, staff_profile_id, date, hours, note) VALUES (?, ?, ?, ?, ?, ?)')->execute([$id, $o, $staff, $date, $hours, Input::optStr($in, 'note', 1000)]);
        Audit::log($pdo, $o, $user['id'], 'overtime.requested', 'overtime_requests', $id, [], 'info', 'org', $ip);
        return [201, ['overtime' => $this->presentOvertime($this->row('overtime_requests', $o, $id))]];
    }

    private function reviewOvertime(array $user, array $in, string $ip, string $o, string $v): array
    {
        return $this->review('overtime_requests', 'overtime', $user, $in, $ip, $o, $v, $this->presentOvertime(...));
    }

    private function cancelOvertime(array $user, array $in, string $ip, string $o, string $v): array
    {
        return $this->cancel('overtime_requests', 'overtime', $user, $ip, $o, $v, ['pending'], $this->presentOvertime(...));
    }

    /**
     * What the clock and the rota say about a day, to judge an overtime claim against. It does not replace the typed figure:
     * clock data is thinnest exactly when people stay late. Owner or manager, or the person themselves. (The old function let any
     * member ask about anyone; that is closed.)
     */
    private function evidence(array $user, array $in, string $ip, string $o): array
    {
        $pdo = $this->ctx->pdo;
        [$m, $own] = $this->who($user, $o);
        $staff = Input::optStr($in, 'staff_profile_id', 36) ?? $own;
        $date = Input::optDate($in, 'date');
        if ($staff === null || $date === null) {
            throw HttpError::invalid('staff_profile_id and date are required');
        }
        if ($staff !== $own && !in_array($m['effective_role'], Scope::MANAGERS, true)) {
            throw HttpError::forbidden();
        }
        $this->exists('staff_profiles', $staff, $o);
        $tzq = $pdo->prepare('SELECT timezone FROM locations WHERE org_id = ? ORDER BY created_at LIMIT 1');
        $tzq->execute([$o]);
        $tz = new \DateTimeZone((string) ($tzq->fetchColumn() ?: 'Europe/London'));
        $from = (new \DateTimeImmutable($date . ' 00:00:00', $tz))->setTimezone(new \DateTimeZone('UTC'))->format('Y-m-d H:i:s');
        $to = (new \DateTimeImmutable($date . ' 00:00:00', $tz))->modify('+1 day')->setTimezone(new \DateTimeZone('UTC'))->format('Y-m-d H:i:s');
        $ev = $pdo->prepare("SELECT type, event_at FROM clock_events WHERE org_id = ? AND staff_profile_id = ? AND event_at >= ? AND event_at < ? AND type IN ('in','out') ORDER BY event_at, created_at");
        $ev->execute([$o, $staff, $from, $to]);
        $rows = $ev->fetchAll();
        $worked = 0.0;
        $unpaired = 0;
        foreach ($rows as $i => $r) {
            if ($r['type'] !== 'in') {
                continue;
            }
            $next = $rows[$i + 1] ?? null;
            if ($next !== null && $next['type'] === 'out') {
                $worked += (strtotime($next['event_at'] . ' UTC') - strtotime($r['event_at'] . ' UTC')) / 60;
            } else {
                $unpaired++;
            }
        }
        $sh = $pdo->prepare("SELECT COALESCE(SUM(TIMESTAMPDIFF(MINUTE, starts_at, ends_at) - break_minutes), 0) FROM shifts WHERE org_id = ? AND staff_profile_id = ? AND starts_at >= ? AND starts_at < ? AND status <> 'cancelled'");
        $sh->execute([$o, $staff, $from, $to]);
        return [200, ['scheduled_minutes' => (int) $sh->fetchColumn(), 'worked_minutes' => (int) round($worked), 'unpaired_events' => $unpaired]];
    }

    /**
     * The sidebar's badge counts, polled on every page. A manager's are the organisation's requests waiting for a decision; anyone
     * else's are their own (as RLS scoped the same count on Supabase): their pending leave and overtime, and the swaps they could act
     * on (theirs, offered to them, or open to anyone), the same rows `GET swaps` shows them. No staff record: zeros.
     */
    private function attention(array $user, array $in, string $ip, string $o): array
    {
        [$m, $own] = $this->who($user, $o);
        if (!in_array($m['effective_role'], Scope::MANAGERS, true)) {
            if ($own === null) {
                return [200, ['leave_pending' => 0, 'overtime_pending' => 0, 'swaps_pending' => 0]];
            }
            $mine = function (string $sql, int $times) use ($o, $own): int {
                $q = $this->ctx->pdo->prepare($sql);
                $q->execute([$o, ...array_fill(0, $times, $own)]);
                return (int) $q->fetchColumn();
            };
            return [200, [
                'leave_pending' => $mine("SELECT COUNT(*) FROM leave_requests WHERE org_id = ? AND staff_profile_id = ? AND status = 'pending'", 1),
                'overtime_pending' => $mine("SELECT COUNT(*) FROM overtime_requests WHERE org_id = ? AND staff_profile_id = ? AND status = 'pending'", 1),
                'swaps_pending' => $mine("SELECT COUNT(*) FROM shift_swaps WHERE org_id = ? AND status IN ('pending','accepted')
                    AND (requested_by = ? OR target_staff_profile_id = ? OR (target_staff_profile_id IS NULL AND status = 'pending' AND requested_by <> ?))", 3),
            ]];
        }
        $count = function (string $sql) use ($o): int {
            $q = $this->ctx->pdo->prepare($sql);
            $q->execute([$o]);
            return (int) $q->fetchColumn();
        };
        return [200, [
            'leave_pending' => $count("SELECT COUNT(*) FROM leave_requests WHERE org_id = ? AND status = 'pending'"),
            'overtime_pending' => $count("SELECT COUNT(*) FROM overtime_requests WHERE org_id = ? AND status = 'pending'"),
            // A swap needs someone while it is pending or accepted: the colleague may still answer, the requester or a manager finalises.
            'swaps_pending' => $count("SELECT COUNT(*) FROM shift_swaps WHERE org_id = ? AND status IN ('pending','accepted')"),
        ]];
    }

    // ---- shared ----------------------------------------------------------------------------------------

    /** @return array{0:array<string,mixed>,1:?string} the caller's membership and own staff id */
    private function who(array $user, string $o): array
    {
        $m = Scope::membership($this->ctx->pdo, $user['id'], $o);
        return [$m, Scope::staffProfileId($this->ctx->pdo, $o, $user['id'])];
    }

    /** Whose request: the caller's own, or (owner and manager) any person's in this organisation. */
    private function subject(array $in, array $m, ?string $own, string $o): string
    {
        $staff = Input::optStr($in, 'staff_profile_id', 36) ?? $own;
        if ($staff === null) {
            throw new HttpError(403, 'no_staff_record', 'You do not have a staff record in this organisation');
        }
        if ($staff !== $own && !in_array($m['effective_role'], Scope::MANAGERS, true)) {
            throw HttpError::forbidden();
        }
        $this->exists('staff_profiles', $staff, $o, HttpError::invalid('That staff member is not in this organisation'));
        return $staff;
    }

    /** @param array<int,mixed> $args */
    private function scopeToPerson(string &$sql, array &$args, array $m, ?string $own, array $in): void
    {
        if (in_array($m['effective_role'], Scope::MANAGERS, true)) {
            if (($sp = Input::optStr($in, 'staff_profile_id', 36)) !== null) {
                $sql .= ' AND staff_profile_id = ?';
                $args[] = $sp;
            }
            return;
        }
        $sql .= ' AND staff_profile_id = ?';
        $args[] = $own ?? '';
    }

    private function review(string $table, string $noun, array $user, array $in, string $ip, string $o, string $id, callable $present): array
    {
        $pdo = $this->ctx->pdo;
        $m = Scope::membership($pdo, $user['id'], $o);
        Scope::require($m, Scope::MANAGERS);
        Scope::requireWritable($m);
        $status = $in['status'] ?? null;
        if (!in_array($status, ['approved', 'rejected'], true)) {
            throw HttpError::invalid("status must be 'approved' or 'rejected'");
        }
        $pdo->beginTransaction();
        try {
            $q = $pdo->prepare("SELECT status, staff_profile_id FROM $table WHERE id = ? AND org_id = ? FOR UPDATE"); // $table is a literal from this class
            $q->execute([$id, $o]);
            $req = $q->fetch();
            if ($req === false) {
                throw HttpError::notFound();
            }
            $cur = $req['status'];
            // Four eyes: a manager or delegate does not decide their own request; an owner may (security audit).
            if ($m['role'] !== 'owner' && $req['staff_profile_id'] === Scope::staffProfileId($pdo, $o, $user['id'])) {
                throw new HttpError(403, "own_$noun", "Someone else must decide your own $noun request");
            }
            if ($cur !== 'pending') {
                throw HttpError::conflict('already_decided', "That $noun request has already been $cur");
            }
            $pdo->prepare("UPDATE $table SET status = ?, reviewed_by = ?, reviewed_at = UTC_TIMESTAMP() WHERE id = ?")->execute([$status, $user['id'], $id]);
            Audit::log($pdo, $o, $user['id'], "$noun.$status", $table, $id, [], 'info', 'org', $ip);
            if ($noun === 'leave') {
                $this->tellRequester($o, $id, $status, $user['id']);
            }
            $pdo->commit();
        } catch (\Throwable $e) {
            $pdo->rollBack();
            throw $e;
        }
        return [200, [$noun => $present($this->row($table, $o, $id))]];
    }

    /** @param list<string> $from the states a request may be withdrawn from */
    private function cancel(string $table, string $noun, array $user, string $ip, string $o, string $id, array $from, callable $present): array
    {
        $pdo = $this->ctx->pdo;
        [$m, $own] = $this->who($user, $o);
        Scope::requireWritable($m);
        $pdo->beginTransaction();
        try {
            $q = $pdo->prepare("SELECT staff_profile_id, status FROM $table WHERE id = ? AND org_id = ? FOR UPDATE"); // $table is a literal from this class
            $q->execute([$id, $o]);
            $cur = $q->fetch() ?: throw HttpError::notFound();
            if ($cur['staff_profile_id'] !== $own && !in_array($m['effective_role'], Scope::MANAGERS, true)) {
                throw HttpError::forbidden();
            }
            if (!in_array($cur['status'], $from, true)) {
                throw HttpError::conflict('cannot_cancel', "A {$cur['status']} $noun request cannot be cancelled");
            }
            $pdo->prepare("UPDATE $table SET status = 'cancelled' WHERE id = ?")->execute([$id]);
            Audit::log($pdo, $o, $user['id'], "$noun.cancelled", $table, $id, [], 'info', 'org', $ip);
            $pdo->commit();
        } catch (\Throwable $e) {
            $pdo->rollBack();
            throw $e;
        }
        return [200, [$noun => $present($this->row($table, $o, $id))]];
    }

    /** The person is told of a decision, unless they made it themselves. */
    private function tellRequester(string $o, string $id, string $status, string $reviewer): void
    {
        $q = $this->ctx->pdo->prepare('SELECT staff_profile_id, start_date, end_date FROM leave_requests WHERE id = ?');
        $q->execute([$id]);
        $r = $q->fetch();
        $who = Notify::userOfStaff($this->ctx->pdo, (string) $r['staff_profile_id']);
        if ($who === null || $who === $reviewer) {
            return;
        }
        Notify::enqueue($this->ctx->pdo, $o, 'leave/reviewed', [$who], 'leave', 'Your leave request was ' . ($status === 'approved' ? 'approved' : 'declined'), RotaDiff::range($r['start_date'], $r['end_date']));
    }

    private function clientId(array $in): ?string
    {
        $cid = Input::optStr($in, 'client_event_id', 36);
        if ($cid !== null && preg_match('/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/', $cid) !== 1) {
            throw HttpError::invalid('client_event_id must be a UUID');
        }
        return $cid;
    }

    /** @return array<string,mixed>|null */
    private function byClient(string $table, string $cid): ?array
    {
        $q = $this->ctx->pdo->prepare("SELECT * FROM $table WHERE client_event_id = ?"); // $table is a literal from this class
        $q->execute([$cid]);
        return $q->fetch() ?: null;
    }

    /** @return array{0:int,1:array<string,mixed>} */
    private function replay(array $prior, string $o, string $staff, string $key, callable $present): array
    {
        if ($prior['org_id'] !== $o || $prior['staff_profile_id'] !== $staff) {
            throw HttpError::conflict('client_event_conflict', 'That client_event_id was used for a different record');
        }
        return [200, [$key => $present($prior), 'already_applied' => true]];
    }

    /** @return array<string,mixed> */
    private function row(string $table, string $o, string $id): array
    {
        $q = $this->ctx->pdo->prepare("SELECT * FROM $table WHERE id = ? AND org_id = ?"); // $table is a literal from this class
        $q->execute([$id, $o]);
        return $q->fetch() ?: throw HttpError::notFound();
    }

    private function exists(string $table, string $id, string $org, ?HttpError $else = null): void
    {
        $q = $this->ctx->pdo->prepare("SELECT 1 FROM $table WHERE id = ? AND org_id = ?"); // $table is a literal from this class
        $q->execute([$id, $org]);
        if ($q->fetchColumn() === false) {
            throw $else ?? HttpError::notFound();
        }
    }

    /** @param array<string,mixed> $r */
    private function presentLeave(array $r): array
    {
        $r['starts_half'] = (bool) $r['starts_half'];
        $r['ends_half'] = (bool) $r['ends_half'];
        // Calendar days the request costs, counting half days at either end; never zero.
        $r['days'] = max(0.5, (strtotime($r['end_date']) - strtotime($r['start_date'])) / 86400 + 1 - ($r['starts_half'] ? 0.5 : 0) - ($r['ends_half'] ? 0.5 : 0));
        return $this->stamps($r);
    }

    /** @param array<string,mixed> $r */
    private function presentOvertime(array $r): array
    {
        $r['hours'] = (float) $r['hours'];
        return $this->stamps($r);
    }

    /** @param array<string,mixed> $r */
    private function stamps(array $r): array
    {
        unset($r['client_event_id']);
        foreach (['reviewed_at', 'created_at', 'updated_at'] as $k) {
            $r[$k] = Time::iso($r[$k] ?? null);
        }
        return $r;
    }
}
