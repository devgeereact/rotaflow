<?php
declare(strict_types=1);

namespace RotaFlow\Mod;

use RotaFlow\{Audit, CoverRules, Ctx, Db, HttpError, Input, Module, Notify, Scope, SchedulingRules, Time};

/**
 * Shift swaps and the open-shift board.
 *
 * A swap offers one of your shifts to a named colleague, or to the open board. The colleague (or whoever claims it from the
 * board) accepts; then the requester or a manager finalises. Approving moves the shift in one transaction, and only if the
 * shift is still the requester's, its rota is not archived and the person taking it is still active. An open shift is claimed
 * first come, first served. Both write into a PUBLISHED rota on purpose: that is what a swap or a claim is for.
 *
 * With the cover module on (S12, flag cover_tools; off, all of this is exactly as before):
 *  - a pending or accepted swap whose shift changed (times, site, holder, status, rota), was cancelled, sits on an archived rota or has
 *    started is cancelled automatically (void_reason) when anyone touches it, and by the cover sweep in cron;
 *  - a shift a manager has opened a cover request for is applied for on the Cover page instead of being claimed.
 * Whatever the flag (owner decision, 31 Oct 2026), the instant open-shift claim takes the organisation lock first and checks the cover
 * eligibility (leave, availability, documents, not the absentee, overlap).
 */
final class Swaps implements Module
{
    public function __construct(private readonly Ctx $ctx) {}

    public function routes(): array
    {
        return [
            ['GET', '/orgs/{o}/swaps', $this->list(...)],
            ['POST', '/orgs/{o}/swaps', $this->create(...)],
            ['POST', '/orgs/{o}/swaps/{w}/respond', $this->respond(...)],
            ['POST', '/orgs/{o}/swaps/{w}/claim', $this->claim(...)],
            ['POST', '/orgs/{o}/swaps/{w}/cancel', $this->cancel(...)],
            ['POST', '/orgs/{o}/swaps/{w}/decide', $this->decide(...)],
            ['POST', '/orgs/{o}/swaps/{w}/reassign', $this->reassign(...)],
            ['GET', '/orgs/{o}/open-shifts', $this->openShifts(...)],
            ['POST', '/orgs/{o}/open-shifts/{h}/claim', $this->claimOpenShift(...)],
        ];
    }

    // ---- swaps -----------------------------------------------------------------------------------------

    /** Managers see every swap; a member sees those they asked for or were asked for, plus the open board. ?status= filters. */
    private function list(array $user, array $in, string $ip, string $o): array
    {
        $pdo = $this->ctx->pdo;
        $m = Scope::membership($pdo, $user['id'], $o);
        $own = Scope::staffProfileId($pdo, $o, $user['id']);
        $sql = 'SELECT w.*, s.starts_at AS shift_starts_at, s.ends_at AS shift_ends_at, s.location_id AS shift_location_id, s.staff_profile_id AS shift_staff_profile_id FROM shift_swaps w JOIN shifts s ON s.id = w.shift_id AND s.org_id = w.org_id WHERE w.org_id = ?';
        $args = [$o];
        if (!in_array($m['effective_role'], Scope::MANAGERS, true)) {
            $sql .= " AND (w.requested_by = ? OR w.target_staff_profile_id = ? OR (w.target_staff_profile_id IS NULL AND w.status = 'pending'))";
            array_push($args, $own ?? '', $own ?? '');
        }
        if (($st = Input::optStr($in, 'status', 20)) !== null) {
            $sql .= ' AND w.status = ?';
            $args[] = $st;
        }
        $q = $pdo->prepare($sql . ' ORDER BY w.created_at DESC LIMIT 1000');
        $q->execute($args);
        return [200, ['swaps' => array_map($this->present(...), $q->fetchAll())]];
    }

    private function create(array $user, array $in, string $ip, string $o): array
    {
        $pdo = $this->ctx->pdo;
        $m = Scope::membership($pdo, $user['id'], $o);
        Scope::requireWritable($m);
        $own = Scope::staffProfileId($pdo, $o, $user['id']);
        $manager = in_array($m['effective_role'], Scope::MANAGERS, true);
        $by = Input::optStr($in, 'requested_by', 36) ?? $own;
        if ($by === null) {
            throw new HttpError(403, 'no_staff_record', 'You do not have a staff record in this organisation');
        }
        if ($by !== $own && !$manager) {
            throw HttpError::forbidden();
        }
        $cid = Input::optStr($in, 'client_event_id', 36);
        if ($cid !== null && preg_match('/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/', $cid) !== 1) {
            throw HttpError::invalid('client_event_id must be a UUID');
        }
        if ($cid !== null && ($prior = $this->byClient($cid)) !== null) {
            return $this->replay($prior, $o, $by);
        }
        $shiftId = Input::reqStr($in, 'shift_id', 36);
        $q = $pdo->prepare('SELECT staff_profile_id, status, starts_at, ends_at, location_id, rota_id FROM shifts WHERE id = ? AND org_id = ?');
        $q->execute([$shiftId, $o]);
        $shift = $q->fetch();
        if ($shift === false) {
            throw HttpError::invalid('That shift is not in this organisation');
        }
        if ($shift['staff_profile_id'] !== $by || $shift['status'] === 'cancelled') {
            throw HttpError::invalid('You can only offer a shift that is yours and not cancelled');
        }
        $target = Input::optStr($in, 'target_staff_profile_id', 36);
        if ($target !== null) {
            $t = $pdo->prepare('SELECT active FROM staff_profiles WHERE id = ? AND org_id = ?');
            $t->execute([$target, $o]);
            $active = $t->fetchColumn();
            if ($active === false || (int) $active !== 1 || $target === $by) {
                throw HttpError::invalid('Pick another active colleague in this organisation, or leave it open');
            }
        }
        $id = Db::uuid();
        try {
            // The fingerprint never leaves the server and is only read while the cover module is on (S12).
            $pdo->prepare('INSERT INTO shift_swaps (id, org_id, shift_id, requested_by, target_staff_profile_id, note, client_event_id, shift_fingerprint) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
                ->execute([$id, $o, $shiftId, $by, $target, Input::optStr($in, 'note', 1000), $cid, CoverRules::fingerprint($shift)]);
        } catch (\PDOException $e) {
            if ($cid !== null && $e->getCode() === '23000' && ($prior = $this->byClient($cid)) !== null) {
                return $this->replay($prior, $o, $by);
            }
            throw $e;
        }
        Audit::log($pdo, $o, $user['id'], 'swap.requested', 'shift_swaps', $id, [], 'info', 'org', $ip);
        return [201, ['swap' => $this->present($this->load($o, $id)), 'already_applied' => false]];
    }

    /** The named colleague accepts or declines a pending swap. Accepting changes nothing on the rota yet. */
    private function respond(array $user, array $in, string $ip, string $o, string $w): array
    {
        $pdo = $this->ctx->pdo;
        $m = Scope::membership($pdo, $user['id'], $o);
        Scope::requireWritable($m);
        $status = $in['status'] ?? null;
        if (!in_array($status, ['accepted', 'rejected'], true)) {
            throw HttpError::invalid("status must be 'accepted' or 'rejected'");
        }
        $own = Scope::staffProfileId($pdo, $o, $user['id']);
        $this->guardStale($o, $w);
        $u = $pdo->prepare("UPDATE shift_swaps SET status = ? WHERE id = ? AND org_id = ? AND status = 'pending' AND target_staff_profile_id = ? AND ? IS NOT NULL");
        $u->execute([$status, $w, $o, $own, $own]);
        if ($u->rowCount() !== 1) {
            $this->load($o, $w); // 404 if it is not this organisation's
            throw HttpError::forbidden('Only the colleague it was offered to can answer, and only while it is pending');
        }
        Audit::log($pdo, $o, $user['id'], "swap.$status", 'shift_swaps', $w, [], 'info', 'org', $ip);
        if ($status === 'rejected') {
            $this->tell($o, $this->load($o, $w), 'rejected', null); // the colleague declined: the requester should hear it
        }
        return [200, ['swap' => $this->present($this->load($o, $w))]];
    }

    /** Take a swap off the open board: first come, first served. */
    private function claim(array $user, array $in, string $ip, string $o, string $w): array
    {
        $pdo = $this->ctx->pdo;
        $m = Scope::membership($pdo, $user['id'], $o);
        Scope::requireWritable($m);
        $own = Scope::staffProfileId($pdo, $o, $user['id']);
        if ($own === null) {
            throw new HttpError(403, 'no_staff_record', 'You do not have a staff record in this organisation');
        }
        $this->guardStale($o, $w);
        $u = $pdo->prepare("UPDATE shift_swaps SET target_staff_profile_id = ?, status = 'accepted' WHERE id = ? AND org_id = ? AND status = 'pending' AND target_staff_profile_id IS NULL AND requested_by <> ?");
        $u->execute([$own, $w, $o, $own]);
        if ($u->rowCount() !== 1) {
            $this->load($o, $w);
            throw HttpError::conflict('swap_unavailable', 'That swap is no longer open, or it is your own');
        }
        Audit::log($pdo, $o, $user['id'], 'swap.claimed', 'shift_swaps', $w, [], 'info', 'org', $ip);
        return [200, ['swap' => $this->present($this->load($o, $w))]];
    }

    /** The requester withdraws it, or a manager does. Only before a decision. */
    private function cancel(array $user, array $in, string $ip, string $o, string $w): array
    {
        $pdo = $this->ctx->pdo;
        $m = Scope::membership($pdo, $user['id'], $o);
        Scope::requireWritable($m);
        $own = Scope::staffProfileId($pdo, $o, $user['id']);
        $swap = $this->load($o, $w);
        if ($swap['requested_by'] !== $own && !in_array($m['effective_role'], Scope::MANAGERS, true)) {
            throw HttpError::forbidden();
        }
        $u = $pdo->prepare("UPDATE shift_swaps SET status = 'cancelled' WHERE id = ? AND org_id = ? AND status IN ('pending','accepted')");
        $u->execute([$w, $o]);
        if ($u->rowCount() !== 1) {
            throw HttpError::conflict('cannot_cancel', "A {$swap['status']} swap cannot be cancelled");
        }
        Audit::log($pdo, $o, $user['id'], 'swap.cancelled', 'shift_swaps', $w, [], 'info', 'org', $ip);
        return [200, ['swap' => $this->present($this->load($o, $w))]];
    }

    /**
     * Approve or reject. A manager may decide a pending or accepted swap; the requester may finalise one the colleague has accepted.
     * Approving moves the shift, atomically: if any check fails nothing changes. A swap already decided answers 200 already-decided.
     */
    private function decide(array $user, array $in, string $ip, string $o, string $w): array
    {
        $pdo = $this->ctx->pdo;
        $m = Scope::membership($pdo, $user['id'], $o);
        Scope::requireWritable($m);
        $status = $in['status'] ?? null;
        if (!in_array($status, ['approved', 'rejected'], true)) {
            throw HttpError::invalid("A swap decision is either 'approved' or 'rejected'");
        }
        $own = Scope::staffProfileId($pdo, $o, $user['id']);
        $cover = Cover::on($pdo, $o);
        $pdo->beginTransaction();
        try {
            if ($cover) {
                Cover::lockOrg($pdo, $o); // S12: while cover is on, everything that moves a shift to a person takes this lock first (no deadlocks)
            }
            $q = $pdo->prepare('SELECT * FROM shift_swaps WHERE id = ? AND org_id = ? FOR UPDATE');
            $q->execute([$w, $o]);
            $swap = $q->fetch() ?: throw HttpError::notFound();
            if (!in_array($swap['status'], ['pending', 'accepted'], true)) {
                $pdo->commit();
                return [200, ['outcome' => 'already-decided', 'status' => $swap['status'], 'reassigned' => $swap['applied_at'] !== null, 'applied_at' => Time::iso($swap['applied_at']), 'shift_id' => $swap['applied_shift_id'], 'target_staff_profile_id' => $swap['target_staff_profile_id']]];
            }
            $manager = in_array($m['effective_role'], Scope::MANAGERS, true);
            if (!$manager && !($swap['status'] === 'accepted' && $own !== null && $swap['requested_by'] === $own)) {
                throw HttpError::forbidden('Not allowed to decide this swap.');
            }
            if ($cover && ($why = self::voidIfStale($pdo, $swap, $user['id'], time())) !== null) {
                $pdo->commit();
                throw self::voided($why);
            }
            $pdo->prepare('UPDATE shift_swaps SET status = ?, reviewed_by = ?, reviewed_at = UTC_TIMESTAMP() WHERE id = ?')->execute([$status, $user['id'], $w]);
            if ($status === 'rejected') {
                Audit::log($pdo, $o, $user['id'], 'swap.rejected', 'shift_swaps', $w, [], 'info', 'org', $ip);
                $this->tell($o, $swap, 'rejected', $user['id']);
                $pdo->commit();
                return [200, ['outcome' => 'declined']];
            }
            if ($swap['target_staff_profile_id'] === null) {
                Audit::log($pdo, $o, $user['id'], 'swap.approved', 'shift_swaps', $w, ['reassigned' => false], 'info', 'org', $ip);
                $this->tell($o, $swap, 'approved', $user['id']);
                $pdo->commit();
                return [200, ['outcome' => 'approved', 'reassigned' => false, 'reason' => 'no-target']];
            }
            $applied = $this->applyReassignment($swap, $user['id'], $ip);
            Audit::log($pdo, $o, $user['id'], 'swap.approved', 'shift_swaps', $w, ['reassigned' => true], 'info', 'org', $ip);
            $this->tell($o, $swap, 'approved', $user['id']);
            $pdo->commit();
        } catch (\Throwable $e) {
            if ($pdo->inTransaction()) {
                $pdo->rollBack();
            }
            throw $e;
        }
        return [200, ['outcome' => 'approved', 'reassigned' => true, 'shift_id' => $applied['shift_id'], 'applied_at' => $applied['applied_at'], 'target_staff_profile_id' => $swap['target_staff_profile_id']]];
    }

    /** Move the shift of an APPROVED swap that has not yet moved it (a retry after a failed decide, or a swap approved without a target and since given one). */
    private function reassign(array $user, array $in, string $ip, string $o, string $w): array
    {
        $pdo = $this->ctx->pdo;
        $m = Scope::membership($pdo, $user['id'], $o);
        Scope::requireWritable($m);
        $own = Scope::staffProfileId($pdo, $o, $user['id']);
        $cover = Cover::on($pdo, $o);
        $pdo->beginTransaction();
        try {
            if ($cover) {
                Cover::lockOrg($pdo, $o); // S12: while cover is on, everything that moves a shift to a person takes this lock first (no deadlocks)
            }
            $q = $pdo->prepare('SELECT * FROM shift_swaps WHERE id = ? AND org_id = ? FOR UPDATE');
            $q->execute([$w, $o]);
            $swap = $q->fetch() ?: throw HttpError::notFound();
            if ($swap['status'] !== 'approved') {
                throw HttpError::conflict('swap_not_approved', 'Only an approved swap reassigns its shift.');
            }
            if ($swap['target_staff_profile_id'] === null) {
                throw HttpError::conflict('swap_no_target', 'This swap has nobody to reassign the shift to. Assign it in the rota builder.');
            }
            if ($swap['applied_at'] !== null) {
                throw HttpError::conflict('swap_already_applied', 'This swap has already moved its shift.');
            }
            if (!in_array($m['effective_role'], Scope::MANAGERS, true) && $swap['requested_by'] !== $own) {
                throw HttpError::forbidden('Not allowed to reassign this shift.');
            }
            $applied = $this->applyReassignment($swap, $user['id'], $ip);
            $pdo->commit();
        } catch (\Throwable $e) {
            $pdo->rollBack();
            throw $e;
        }
        return [200, ['shift_id' => $applied['shift_id'], 'applied_at' => $applied['applied_at']]];
    }

    /**
     * Inside the caller's transaction. Locks the shift, then refuses unless it is still the requester's, its rota is not archived, and
     * the new holder is an active member of this organisation. Bypasses the rota-immutability rule on purpose.
     * @param array<string,mixed> $swap
     * @return array{shift_id:string,applied_at:?string}
     */
    private function applyReassignment(array $swap, string $actor, string $ip): array
    {
        $pdo = $this->ctx->pdo;
        $q = $pdo->prepare('SELECT * FROM shifts WHERE id = ? AND org_id = ? FOR UPDATE');
        $q->execute([$swap['shift_id'], $swap['org_id']]);
        $shift = $q->fetch() ?: throw HttpError::conflict('shift_gone', 'The shift in this swap no longer exists.');
        if ($shift['rota_id'] !== null) {
            $r = $pdo->prepare('SELECT status FROM rotas WHERE id = ?');
            $r->execute([$shift['rota_id']]);
            if ($r->fetchColumn() === 'archived') {
                throw HttpError::conflict('rota_archived', 'This shift is on an archived rota and cannot be reassigned. The rota was replaced by an amendment; raise the swap against the current version.');
            }
        }
        if ($shift['staff_profile_id'] !== $swap['requested_by']) {
            throw HttpError::conflict('shift_reassigned', 'This shift is no longer assigned to the person who offered it. Somebody else has taken it since the swap was raised. Nothing was changed.');
        }
        $t = $pdo->prepare('SELECT active FROM staff_profiles WHERE id = ? AND org_id = ?');
        $t->execute([$swap['target_staff_profile_id'], $swap['org_id']]);
        $active = $t->fetchColumn();
        if ($active === false || (int) $active !== 1) {
            throw HttpError::conflict('target_inactive', 'The person taking this shift is no longer an active member of this organisation.');
        }
        $pdo->prepare("UPDATE shifts SET staff_profile_id = ?, status = 'assigned' WHERE id = ?")->execute([$swap['target_staff_profile_id'], $shift['id']]);
        $pdo->prepare('UPDATE shift_swaps SET applied_at = UTC_TIMESTAMP(), applied_shift_id = ?, applied_from_staff_profile_id = ? WHERE id = ? AND applied_at IS NULL')->execute([$shift['id'], $swap['requested_by'], $swap['id']]);
        Audit::log($pdo, $swap['org_id'], $actor, 'rota.shift_reassigned', 'shifts', $shift['id'], ['swap_id' => $swap['id'], 'from' => $swap['requested_by'], 'to' => $swap['target_staff_profile_id']], 'info', 'org', $ip);
        $at = $pdo->prepare('SELECT applied_at FROM shift_swaps WHERE id = ?');
        $at->execute([$swap['id']]);
        return ['shift_id' => (string) $shift['id'], 'applied_at' => Time::iso($at->fetchColumn() ?: null)];
    }

    // ---- open shifts -----------------------------------------------------------------------------------

    /** Future, unassigned, open shifts on a PUBLISHED rota, soonest first; clashes_with_mine says whether it overlaps something the caller already works. */
    private function openShifts(array $user, array $in, string $ip, string $o): array
    {
        $pdo = $this->ctx->pdo;
        Scope::membership($pdo, $user['id'], $o);
        $own = Scope::staffProfileId($pdo, $o, $user['id']);
        $q = $pdo->prepare(
            "SELECT s.id AS shift_id, s.starts_at, s.ends_at, s.break_minutes, s.notes, st.name AS shift_type, l.name AS location_name,
                    (? IS NOT NULL AND EXISTS (SELECT 1 FROM shifts mine WHERE mine.org_id = s.org_id AND mine.staff_profile_id = ? AND mine.status <> 'cancelled' AND mine.starts_at < s.ends_at AND mine.ends_at > s.starts_at)) AS clashes_with_mine
               FROM shifts s JOIN rotas r ON r.id = s.rota_id AND r.org_id = s.org_id
               LEFT JOIN shift_types st ON st.id = s.shift_type_id AND st.org_id = s.org_id
               LEFT JOIN locations l ON l.id = s.location_id AND l.org_id = s.org_id
              WHERE s.org_id = ? AND s.status = 'open' AND s.staff_profile_id IS NULL AND r.status = 'published' AND s.starts_at > UTC_TIMESTAMP()
              ORDER BY s.starts_at LIMIT 500"
        );
        $q->execute([$own, $own, $o]);
        return [200, ['open_shifts' => array_map(static function (array $r): array {
            $r['starts_at'] = Time::iso($r['starts_at']);
            $r['ends_at'] = Time::iso($r['ends_at']);
            $r['clashes_with_mine'] = (bool) $r['clashes_with_mine'];
            return $r;
        }, $q->fetchAll())]];
    }

    /**
     * First come, first served. Refused for a shift that has started, is not on a published rota, or overlaps the caller's own work, and
     * (owner decision, 31 Oct 2026; no longer tied to the cover_tools flag) for a person who is not eligible: inactive, double-booked,
     * the absentee, on approved leave, declared unavailable, or missing a required document (Compliance::eligible, which only bites when
     * the organisation has required document types). The organisation row is locked first, always, as every cover writer does. The 409
     * cover_request_open refusal stays behind cover_tools: cover requests only exist while it is on.
     */
    private function claimOpenShift(array $user, array $in, string $ip, string $o, string $h): array
    {
        $pdo = $this->ctx->pdo;
        $m = Scope::membership($pdo, $user['id'], $o);
        Scope::requireWritable($m);
        $own = Scope::staffProfileId($pdo, $o, $user['id']);
        if ($own === null) {
            throw new HttpError(403, 'no_staff_record', 'You do not have a staff record in this organisation');
        }
        $cover = Cover::on($pdo, $o);
        $pdo->beginTransaction();
        try {
            Cover::lockOrg($pdo, $o); // the same first lock as a cover approval, so the two never both fill one shift
            $q = $pdo->prepare('SELECT s.*, r.status AS rota_status FROM shifts s LEFT JOIN rotas r ON r.id = s.rota_id AND r.org_id = s.org_id WHERE s.id = ? AND s.org_id = ? FOR UPDATE');
            $q->execute([$h, $o]);
            $s = $q->fetch() ?: throw HttpError::notFound();
            if ($s['rota_status'] !== 'published') {
                throw new HttpError(403, 'not_published', 'That shift is on a rota that has not been published');
            }
            if ($s['starts_at'] <= gmdate('Y-m-d H:i:s')) {
                throw new HttpError(403, 'already_started', 'That shift has already started');
            }
            if ($s['status'] !== 'open' || $s['staff_profile_id'] !== null) {
                throw HttpError::conflict('shift_taken', 'Somebody else has just taken that shift');
            }
            $clash = $pdo->prepare("SELECT 1 FROM shifts WHERE org_id = ? AND staff_profile_id = ? AND status <> 'cancelled' AND starts_at < ? AND ends_at > ? LIMIT 1");
            $clash->execute([$o, $own, $s['ends_at'], $s['starts_at']]);
            if ($clash->fetchColumn() !== false) {
                throw HttpError::conflict('already_working', 'You are already working at that time');
            }
            if ($cover) {
                $req = $pdo->prepare("SELECT 1 FROM cover_requests WHERE org_id = ? AND shift_id = ? AND status = 'open'");
                $req->execute([$o, $h]);
                if ($req->fetchColumn() !== false) {
                    throw HttpError::conflict('cover_request_open', 'A manager is choosing who covers this shift. Apply to cover it on the Cover page instead.');
                }
            }
            $s['timezone'] = $this->zoneOf($o, $s['location_id']);
            $why = Cover::assess($pdo, $o, $own, $s, true)['reasons'];
            if ($why !== []) {
                throw HttpError::conflict('not_eligible', 'You cannot take this shift: ' . implode('; ', array_column($why, 'message')));
            }
            $pdo->prepare("UPDATE shifts SET staff_profile_id = ?, status = 'assigned' WHERE id = ?")->execute([$own, $h]);
            Audit::log($pdo, $o, $user['id'], 'shift.claimed', 'shifts', $h, ['staff_profile_id' => $own], 'info', 'org', $ip);
            $pdo->commit();
        } catch (\Throwable $e) {
            $pdo->rollBack();
            throw $e;
        }
        return [200, ['shift_id' => $h]];
    }

    // ---- swaps that void themselves (S12, cover module on) ------------------------------------------------

    /**
     * Why this pending or accepted swap can no longer go ahead (CoverRules::staleReason), or null. Locks the shift row only.
     * @param array<string,mixed> $swap
     */
    private static function staleOf(\PDO $pdo, array $swap, int $now): ?string
    {
        $q = $pdo->prepare('SELECT id, starts_at, ends_at, location_id, staff_profile_id, status, rota_id FROM shifts WHERE id = ? AND org_id = ? FOR UPDATE');
        $q->execute([$swap['shift_id'], $swap['org_id']]);
        $sh = $q->fetch();
        if ($sh === false) {
            return 'shift_changed';
        }
        $rota = null;
        if ($sh['rota_id'] !== null) {
            $r = $pdo->prepare('SELECT status FROM rotas WHERE id = ? AND org_id = ?');
            $r->execute([$sh['rota_id'], $swap['org_id']]);
            $rota = $r->fetchColumn() ?: null;
        }
        $fp = $swap['shift_fingerprint'] ?? null;
        return CoverRules::staleReason(is_string($fp) ? $fp : null, CoverRules::fingerprint($sh), (string) $sh['status'], $rota, SchedulingRules::ts((string) $sh['starts_at']), $now);
    }

    /**
     * Inside the caller's transaction, with the swap row locked: cancels a stale swap, tells both people, audits it. @return ?string the reason
     * @param array<string,mixed> $swap
     */
    private static function voidIfStale(\PDO $pdo, array $swap, ?string $actor, int $now): ?string
    {
        if (!in_array($swap['status'], ['pending', 'accepted'], true) || ($why = self::staleOf($pdo, $swap, $now)) === null) {
            return null;
        }
        $u = $pdo->prepare("UPDATE shift_swaps SET status = 'cancelled', void_reason = ? WHERE id = ? AND org_id = ? AND status IN ('pending','accepted')");
        $u->execute([$why, $swap['id'], $swap['org_id']]);
        if ($u->rowCount() !== 1) {
            return null;
        }
        $who = array_filter([Notify::userOfStaff($pdo, (string) $swap['requested_by']), $swap['target_staff_profile_id'] !== null ? Notify::userOfStaff($pdo, (string) $swap['target_staff_profile_id']) : null]);
        Notify::enqueue($pdo, (string) $swap['org_id'], 'swap/voided', array_values($who), 'swap', $why === 'shift_started' ? 'Swap cancelled: the shift has started' : 'Swap cancelled: the shift changed');
        Audit::log($pdo, (string) $swap['org_id'], $actor, 'swap.voided', 'shift_swaps', (string) $swap['id'], ['reason' => $why]);
        return $why;
    }

    private static function voided(string $why): HttpError
    {
        return HttpError::conflict('swap_void', $why === 'shift_started' ? 'The shift has started, so this swap was cancelled.' : 'The shift changed after this swap was raised, so it was cancelled. Raise a new one if it is still wanted.');
    }

    /** Before an answer or a claim, with the module on: a stale swap is cancelled (committed) and the caller gets 409 swap_void. */
    private function guardStale(string $o, string $w): void
    {
        $pdo = $this->ctx->pdo;
        if (!Cover::on($pdo, $o)) {
            return;
        }
        $pdo->beginTransaction();
        try {
            Cover::lockOrg($pdo, $o);
            $q = $pdo->prepare('SELECT * FROM shift_swaps WHERE id = ? AND org_id = ? FOR UPDATE');
            $q->execute([$w, $o]);
            $swap = $q->fetch();
            $why = $swap === false ? null : self::voidIfStale($pdo, $swap, null, time());
            $pdo->commit();
        } catch (\Throwable $e) {
            $pdo->rollBack();
            throw $e;
        }
        if ($why !== null) {
            throw self::voided($why);
        }
    }

    /** For the cover sweep (inside its transaction, organisation locked): cancels every stale pending or accepted swap. @return int how many */
    public static function voidStale(\PDO $pdo, string $o, ?string $actor, int $now): int
    {
        $q = $pdo->prepare("SELECT * FROM shift_swaps WHERE org_id = ? AND status IN ('pending','accepted') FOR UPDATE");
        $q->execute([$o]);
        $n = 0;
        foreach ($q->fetchAll() as $swap) {
            $n += self::voidIfStale($pdo, $swap, $actor, $now) !== null ? 1 : 0;
        }
        return $n;
    }

    private function zoneOf(string $o, ?string $location): ?string
    {
        if ($location === null) {
            return null;
        }
        $q = $this->ctx->pdo->prepare('SELECT timezone FROM locations WHERE id = ? AND org_id = ?');
        $q->execute([$location, $o]);
        $tz = $q->fetchColumn();
        return SchedulingRules::validZone($tz) ? (string) $tz : null;
    }

    // ---- helpers ---------------------------------------------------------------------------------------

    /** Tells the requester of an outcome, unless they decided it themselves. */
    private function tell(string $o, array $swap, string $status, ?string $by): void
    {
        $who = Notify::userOfStaff($this->ctx->pdo, (string) $swap['requested_by']);
        if ($who === null || $who === $by) {
            return;
        }
        Notify::enqueue($this->ctx->pdo, $o, 'swap/reviewed', [$who], 'swap', 'Your shift swap was ' . ($status === 'approved' ? 'approved' : 'declined'));
    }

    /** @return array<string,mixed> */
    private function load(string $o, string $w): array
    {
        $q = $this->ctx->pdo->prepare('SELECT * FROM shift_swaps WHERE id = ? AND org_id = ?');
        $q->execute([$w, $o]);
        return $q->fetch() ?: throw HttpError::notFound();
    }

    /** @return array<string,mixed>|null */
    private function byClient(string $cid): ?array
    {
        $q = $this->ctx->pdo->prepare('SELECT * FROM shift_swaps WHERE client_event_id = ?');
        $q->execute([$cid]);
        return $q->fetch() ?: null;
    }

    /** @return array{0:int,1:array<string,mixed>} */
    private function replay(array $prior, string $o, string $by): array
    {
        if ($prior['org_id'] !== $o || $prior['requested_by'] !== $by) {
            throw HttpError::conflict('client_event_conflict', 'That client_event_id was used for a different record');
        }
        return [200, ['swap' => $this->present($prior), 'already_applied' => true]];
    }

    /** @param array<string,mixed> $r */
    private function present(array $r): array
    {
        unset($r['client_event_id'], $r['shift_fingerprint']);
        if (array_key_exists('void_reason', $r) && $r['void_reason'] === null) {
            unset($r['void_reason']); // only a swap the cover module cancelled carries it, so responses are as before while the module is off
        }
        foreach (['reviewed_at', 'applied_at', 'created_at', 'updated_at', 'shift_starts_at', 'shift_ends_at'] as $k) {
            if (array_key_exists($k, $r)) {
                $r[$k] = Time::iso($r[$k]);
            }
        }
        return $r;
    }
}
