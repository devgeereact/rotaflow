<?php
declare(strict_types=1);

namespace RotaFlow\Mod;

use RotaFlow\{Audit, Billing, CoverRules as C, Ctx, Db, Flags, HttpError, Input, Module, Notify, Scope, SchedulingRules as R, Time};

/**
 * Cover (R2 slice S12), ported from SiteRelay's Cover module and re-made for RotaFlow's rotas, staff records and roles: absence reports,
 * cover requests, applications, the manager's cover board and ranked candidates with their eligibility reasons.
 *
 *  - "Open" means: on a PUBLISHED rota, status open, nobody on it, not started. RotaFlow has no separate published projection, so a write to
 *    a shift on a published rota is the publish of that one shift and nothing else on the rota moves.
 *  - Absence report: a person says they cannot work one of their own future published shifts; owners and managers are told. Any member with
 *    a staff record may report and apply (an owner who works shifts included). Only owners and managers decide.
 *  - Cover request (owner/manager): takes the person off the shift (it becomes open on the published rota) and offers it to eligible people.
 *  - Approval and direct assignment (owner/manager): one transaction, the organisation row locked FIRST, then the shift row, eligibility
 *    re-checked under the lock (active, no overlap, not the absentee, availability, leave, documents via Compliance::eligible); only that
 *    shift changes. A second approval for the same shift gets 409.
 *  - A shift whose rota has an open amendment is not changed here (409 open_amendment): the amendment would silently undo the change when
 *    it is published.
 *  - Behind the cover_tools flag (seeded off): with it off every route here answers 403 feature_off (after membership, so a stranger still
 *    gets 404), and the open-shift claim, swaps and leave behave exactly as before.
 */
final class Cover implements Module
{
    public const FEATURE = 'cover_tools';
    private const LOOKAHEAD_DAYS = 28;
    private const UNFILLED_HOURS = 72;
    private const MAX_CANDIDATES = 300;
    private const MAX_OFFERS = 50;

    private readonly \PDO $pdo;

    public function __construct(private readonly Ctx $ctx)
    {
        $this->pdo = $ctx->pdo;
    }

    public function routes(): array
    {
        return [
            ['GET', '/orgs/{o}/cover/overview', $this->overview(...)],
            ['GET', '/orgs/{o}/cover/open', $this->openShifts(...)],
            ['GET', '/orgs/{o}/cover/mine', $this->mine(...)],
            ['GET', '/orgs/{o}/cover/shifts/{s}/candidates', $this->candidates(...)],
            ['POST', '/orgs/{o}/cover/shifts/{s}/apply', $this->apply(...)],
            ['POST', '/orgs/{o}/cover/shifts/{s}/assign', $this->assign(...)],
            ['POST', '/orgs/{o}/cover/requests', $this->createRequest(...)],
            ['POST', '/orgs/{o}/cover/requests/{r}/cancel', $this->cancelRequest(...)],
            ['POST', '/orgs/{o}/cover/applications/{a}/withdraw', $this->withdrawApplication(...)],
            ['POST', '/orgs/{o}/cover/applications/{a}/approve', $this->approveApplication(...)],
            ['POST', '/orgs/{o}/cover/applications/{a}/reject', $this->rejectApplication(...)],
            ['POST', '/orgs/{o}/cover/absences', $this->reportAbsence(...)],
            ['POST', '/orgs/{o}/cover/absences/{a}/withdraw', $this->withdrawAbsence(...)],
            ['POST', '/orgs/{o}/cover/absences/{a}/dismiss', $this->dismissAbsence(...)],
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

    /** The first lock every cover writer takes, so approvals, claims and the sweep serialise per organisation and never deadlock. */
    public static function lockOrg(\PDO $pdo, string $o): void
    {
        $q = $pdo->prepare('SELECT id FROM organisations WHERE id = ? FOR UPDATE');
        $q->execute([$o]);
        $q->fetchAll();
    }

    /** Scheduled clean-up for organisations with the module on: close stale cover requests and applications, void stale swaps. */
    public static function cron(Ctx $ctx, int $now = 0): string
    {
        $pdo = $ctx->pdo;
        $now = $now ?: time();
        $orgs = $pdo->query("SELECT DISTINCT org_id FROM cover_requests WHERE status = 'open' UNION SELECT DISTINCT org_id FROM cover_applications WHERE status = 'pending' UNION SELECT DISTINCT org_id FROM shift_swaps WHERE status IN ('pending','accepted')")->fetchAll(\PDO::FETCH_COLUMN);
        $n = 0;
        foreach ($orgs as $o) {
            if (!self::on($pdo, (string) $o)) {
                continue;
            }
            $pdo->beginTransaction();
            try {
                $n += self::sweep($pdo, (string) $o, null, $now);
                $pdo->commit();
            } catch (\Throwable $e) {
                $pdo->rollBack();
                throw $e;
            }
        }
        return "swept $n stale cover record(s)";
    }

    /**
     * Inside the caller's transaction. Closes open cover requests whose shift started, was cancelled or was filled some other way; closes
     * pending applications whose shift is no longer open; voids stale swaps. @return int records changed
     */
    public static function sweep(\PDO $pdo, string $o, ?string $actor, int $now = 0): int
    {
        $now = $now ?: time();
        $at = gmdate('Y-m-d H:i:s', $now);
        self::lockOrg($pdo, $o);
        $n = 0;
        $q = $pdo->prepare("SELECT c.id, s.starts_at, s.status, s.staff_profile_id FROM cover_requests c JOIN shifts s ON s.id = c.shift_id AND s.org_id = c.org_id WHERE c.org_id = ? AND c.status = 'open' FOR UPDATE");
        $q->execute([$o]);
        foreach ($q->fetchAll() as $r) {
            $why = $r['status'] === 'cancelled' ? 'shift_cancelled' : ($r['starts_at'] <= $at ? 'shift_started' : ($r['staff_profile_id'] !== null ? 'filled_elsewhere' : null));
            if ($why === null) {
                continue;
            }
            $pdo->prepare("UPDATE cover_requests SET status = ?, open_shift_id = NULL, close_reason = ?, filled_staff_profile_id = ?, closed_at = UTC_TIMESTAMP() WHERE id = ? AND org_id = ?")
                ->execute([$why === 'filled_elsewhere' ? 'filled' : 'cancelled', $why, $why === 'filled_elsewhere' ? $r['staff_profile_id'] : null, $r['id'], $o]);
            Audit::log($pdo, $o, $actor, 'cover.request_closed', 'cover_requests', (string) $r['id'], ['reason' => $why]);
            $n++;
        }
        $q = $pdo->prepare("SELECT a.id FROM cover_applications a JOIN shifts s ON s.id = a.shift_id AND s.org_id = a.org_id LEFT JOIN rotas x ON x.id = s.rota_id AND x.org_id = s.org_id
                             WHERE a.org_id = ? AND a.status = 'pending' AND (s.status <> 'open' OR s.staff_profile_id IS NOT NULL OR s.starts_at <= ? OR x.status IS NULL OR x.status <> 'published')"); // not FOR UPDATE: that would lock rota rows; the organisation lock serialises cover writers
        $q->execute([$o, $at]);
        foreach ($q->fetchAll(\PDO::FETCH_COLUMN) as $aid) {
            $pdo->prepare("UPDATE cover_applications SET status = 'rejected', decided_at = UTC_TIMESTAMP() WHERE id = ? AND org_id = ?")->execute([$aid, $o]);
            $n++;
        }
        return $n + Swaps::voidStale($pdo, $o, $actor, $now);
    }

    // ---- manager views -----------------------------------------------------------------------------------------------------------------

    /** Everything a manager needs on the cover board. */
    private function overview(array $u, array $in, string $ip, string $o): array
    {
        $this->access($u, $o, true);
        $this->sweepIfNeeded($o, $u['id']);
        $now = gmdate('Y-m-d H:i:s');
        $q = $this->pdo->prepare("SELECT c.* FROM cover_requests c JOIN shifts s ON s.id = c.shift_id AND s.org_id = c.org_id WHERE c.org_id = ? AND c.status = 'open' AND s.starts_at > ? ORDER BY s.starts_at LIMIT 200");
        $q->execute([$o, $now]);
        $requests = $q->fetchAll();
        $q = $this->pdo->prepare("SELECT a.* FROM cover_applications a JOIN shifts s ON s.id = a.shift_id AND s.org_id = a.org_id WHERE a.org_id = ? AND a.status = 'pending' AND s.starts_at > ? ORDER BY s.starts_at, a.created_at LIMIT 300");
        $q->execute([$o, $now]);
        $apps = $q->fetchAll();
        $q = $this->pdo->prepare("SELECT b.* FROM cover_absences b JOIN shifts s ON s.id = b.shift_id AND s.org_id = b.org_id WHERE b.org_id = ? AND b.status = 'open' AND s.starts_at > ? ORDER BY s.starts_at LIMIT 200");
        $q->execute([$o, $now]);
        $absences = $q->fetchAll();
        $q = $this->pdo->prepare("SELECT s.id FROM shifts s JOIN rotas x ON x.id = s.rota_id AND x.org_id = s.org_id WHERE s.org_id = ? AND x.status = 'published' AND s.status = 'open' AND s.staff_profile_id IS NULL AND s.starts_at > ? AND s.starts_at <= ? ORDER BY s.starts_at LIMIT 200");
        $q->execute([$o, $now, gmdate('Y-m-d H:i:s', time() + self::UNFILLED_HOURS * 3600)]);
        $unfilledIds = $q->fetchAll(\PDO::FETCH_COLUMN);

        $shifts = $this->shiftRows($o, array_merge(array_column($requests, 'shift_id'), array_column($apps, 'shift_id'), array_column($absences, 'shift_id'), $unfilledIds));
        $names = $this->names($o);
        $assessed = [];
        $appsOut = [];
        $byShift = [];
        foreach ($apps as $a) {
            $sh = $shifts[$a['shift_id']] ?? null;
            if ($sh === null) {
                continue;
            }
            $assessed[$a['shift_id']] ??= $this->assessMany($o, $sh, $this->appliedPeople($apps, $a['shift_id']), false);
            $ax = $assessed[$a['shift_id']][$a['staff_profile_id']] ?? ['reasons' => [], 'warnings' => []];
            $row = self::presentApplication($a) + ['name' => $names[$a['staff_profile_id']] ?? null, 'eligible' => $ax['reasons'] === [], 'reasons' => $ax['reasons'], 'warnings' => $ax['warnings'], 'shift' => self::presentShift($sh)];
            $appsOut[] = $row;
            $byShift[$a['shift_id']][] = $row;
        }
        $openReq = [];
        $reqOut = [];
        foreach ($requests as $r) {
            $openReq[$r['shift_id']] = $r['id'];
            if (isset($shifts[$r['shift_id']])) {
                $reqOut[] = self::presentRequest($r) + ['absent_name' => $r['absent_staff_profile_id'] !== null ? ($names[$r['absent_staff_profile_id']] ?? null) : null, 'shift' => self::presentShift($shifts[$r['shift_id']]), 'applicants' => $byShift[$r['shift_id']] ?? []];
            }
        }
        $absOut = [];
        foreach ($absences as $b) {
            if (isset($shifts[$b['shift_id']])) {
                $absOut[] = self::presentAbsence($b) + ['name' => $names[$b['staff_profile_id']] ?? null, 'shift' => self::presentShift($shifts[$b['shift_id']])];
            }
        }
        $unfilled = [];
        foreach ($unfilledIds as $sid) {
            if (isset($shifts[$sid])) {
                $unfilled[] = self::presentShift($shifts[$sid]) + ['cover_request_id' => $openReq[$sid] ?? null, 'applicants' => count($byShift[$sid] ?? [])];
            }
        }
        $h = $this->pdo->prepare("SELECT action, entity_type, entity_id, created_at FROM audit_logs WHERE org_id = ? AND action LIKE 'cover.%' ORDER BY created_at DESC LIMIT 30");
        $h->execute([$o]);
        $history = array_map(static fn (array $r): array => ['action' => $r['action'], 'entity_type' => $r['entity_type'], 'entity_id' => $r['entity_id'], 'at' => Time::iso($r['created_at'])], $h->fetchAll());
        return [200, [
            'counts' => ['open_requests' => count($reqOut), 'unfilled_72h' => count($unfilled), 'pending_applications' => count($appsOut), 'open_absences' => count($absOut)],
            'requests' => $reqOut,
            'applications' => $appsOut,
            'absences' => $absOut,
            'unfilled' => $unfilled,
            'history' => $history,
        ]];
    }

    /** Every active staff record for one shift, eligible first, with reasons, warnings, application and hours already that week. */
    private function candidates(array $u, array $in, string $ip, string $o, string $s): array
    {
        $this->access($u, $o, true);
        $sh = $this->shiftRows($o, [$s])[$s] ?? throw HttpError::notFound();
        return [200, ['shift' => self::presentShift($sh), 'candidates' => $this->rank($o, $sh)]];
    }

    // ---- staff views -------------------------------------------------------------------------------------------------------------------

    /** Open shifts in the next four weeks with any cover request; for a person with a staff record, their own eligibility and application. */
    private function openShifts(array $u, array $in, string $ip, string $o): array
    {
        $this->access($u, $o, false);
        $own = Scope::staffProfileId($this->pdo, $o, $u['id']);
        $q = $this->pdo->prepare("SELECT s.id FROM shifts s JOIN rotas x ON x.id = s.rota_id AND x.org_id = s.org_id WHERE s.org_id = ? AND x.status = 'published' AND s.status = 'open' AND s.staff_profile_id IS NULL AND s.starts_at > ? AND s.starts_at < ? ORDER BY s.starts_at LIMIT 200");
        $q->execute([$o, gmdate('Y-m-d H:i:s'), gmdate('Y-m-d H:i:s', time() + self::LOOKAHEAD_DAYS * 86400)]);
        $ids = $q->fetchAll(\PDO::FETCH_COLUMN);
        $rows = $this->shiftRows($o, $ids);
        $out = [];
        foreach ($ids as $id) {
            $sh = $rows[$id];
            $req = $this->openRequest($o, $id, false);
            $row = self::presentShift($sh) + ['cover_request' => $req === null ? null : ['id' => $req['id'], 'note' => $req['note'], 'respond_by' => Time::iso($req['respond_by'])]];
            if ($own !== null) {
                $ax = $this->assessMany($o, $sh, [$own], false)[$own];
                $app = $this->applicationFor($o, $id, $own, false);
                $row += ['eligible' => $ax['reasons'] === [], 'reasons' => $ax['reasons'], 'warnings' => $ax['warnings'], 'application' => $app === null ? null : ['id' => $app['id'], 'status' => $app['status']]];
            }
            $out[] = $row;
        }
        return [200, ['shifts' => $out]];
    }

    /** The caller's absence reports, applications and upcoming published shifts. */
    private function mine(array $u, array $in, string $ip, string $o): array
    {
        $this->access($u, $o, false);
        $own = Scope::staffProfileId($this->pdo, $o, $u['id']);
        if ($own === null) {
            return [200, ['upcoming' => [], 'absences' => [], 'applications' => []]];
        }
        $since = gmdate('Y-m-d H:i:s', time() - 30 * 86400);
        $q = $this->pdo->prepare("SELECT * FROM cover_absences WHERE org_id = ? AND staff_profile_id = ? AND (status = 'open' OR created_at > ?) ORDER BY created_at DESC LIMIT 50");
        $q->execute([$o, $own, $since]);
        $abs = $q->fetchAll();
        $q = $this->pdo->prepare("SELECT * FROM cover_applications WHERE org_id = ? AND staff_profile_id = ? AND (status = 'pending' OR updated_at > ?) ORDER BY updated_at DESC LIMIT 50");
        $q->execute([$o, $own, $since]);
        $apps = $q->fetchAll();
        $q = $this->pdo->prepare("SELECT s.id FROM shifts s JOIN rotas x ON x.id = s.rota_id AND x.org_id = s.org_id WHERE s.org_id = ? AND s.staff_profile_id = ? AND x.status = 'published' AND s.status <> 'cancelled' AND s.starts_at > ? AND s.starts_at < ? ORDER BY s.starts_at LIMIT 100");
        $q->execute([$o, $own, gmdate('Y-m-d H:i:s'), gmdate('Y-m-d H:i:s', time() + self::LOOKAHEAD_DAYS * 86400)]);
        $upIds = $q->fetchAll(\PDO::FETCH_COLUMN);
        $shifts = $this->shiftRows($o, array_merge(array_column($abs, 'shift_id'), array_column($apps, 'shift_id'), $upIds));
        $openAbs = [];
        foreach ($abs as $b) {
            if ($b['status'] === 'open') {
                $openAbs[$b['shift_id']] = $b['id'];
            }
        }
        $pub = static fn (string $id): ?array => isset($shifts[$id]) ? self::presentShift($shifts[$id]) : null;
        return [200, [
            'upcoming' => array_values(array_filter(array_map(static fn (string $id): ?array => ($p = $pub($id)) !== null ? $p + ['absence_id' => $openAbs[$id] ?? null] : null, $upIds))),
            'absences' => array_map(static fn (array $b): array => self::presentAbsence($b) + ['shift' => $pub($b['shift_id'])], $abs),
            'applications' => array_map(static fn (array $a): array => self::presentApplication($a) + ['shift' => $pub($a['shift_id'])], $apps),
        ]];
    }

    // ---- applications ------------------------------------------------------------------------------------------------------------------

    private function apply(array $u, array $in, string $ip, string $o, string $s): array
    {
        $m = $this->access($u, $o, false);
        Scope::requireWritable($m);
        $own = $this->ownStaff($u, $o);
        $note = Input::optStr($in, 'note', 300);
        $id = $this->tx(function () use ($u, $o, $s, $own, $note, $ip): string {
            self::lockOrg($this->pdo, $o);
            $sh = $this->lockShift($o, $s);
            if ($sh['rota_status'] !== 'published') {
                throw HttpError::notFound(); // an unpublished draft does not exist for staff: 404, never a hint
            }
            self::requireOpen($sh);
            $req = $this->openRequest($o, $s, true);
            if ($req !== null && $req['respond_by'] !== null && $req['respond_by'] < gmdate('Y-m-d H:i:s')) {
                throw HttpError::conflict('deadline_passed', 'The deadline to answer this cover request has passed');
            }
            $this->requireEligible($o, $own, $sh, 'You');
            $app = $this->applicationFor($o, $s, $own, true);
            if ($app !== null && $app['status'] === 'pending') {
                throw HttpError::conflict('already_applied', 'You have already applied for this shift');
            }
            if ($app !== null) {
                $this->pdo->prepare("UPDATE cover_applications SET status = 'pending', note = ?, cover_request_id = ?, decided_by = NULL, decided_at = NULL WHERE id = ? AND org_id = ?")->execute([$note, $req['id'] ?? null, $app['id'], $o]);
                $id = (string) $app['id'];
            } else {
                $id = Db::uuid();
                $this->pdo->prepare('INSERT INTO cover_applications (id, org_id, shift_id, staff_profile_id, cover_request_id, note) VALUES (?, ?, ?, ?, ?, ?)')->execute([$id, $o, $s, $own, $req['id'] ?? null, $note]);
            }
            Notify::enqueue($this->pdo, $o, 'cover/applied', Notify::managers($this->pdo, $o), 'swap', 'Cover offered: ' . $this->describe($o, $sh), ($this->names($o)[$own] ?? 'Someone') . ' can cover this shift. Decide on the Cover page.');
            Audit::log($this->pdo, $o, $u['id'], 'cover.applied', 'cover_applications', $id, ['shift_id' => $s], 'info', 'org', $ip);
            return $id;
        });
        return [201, ['application' => self::presentApplication($this->applicationById($o, $id, false))]];
    }

    private function withdrawApplication(array $u, array $in, string $ip, string $o, string $a): array
    {
        $m = $this->access($u, $o, false);
        Scope::requireWritable($m);
        $own = Scope::staffProfileId($this->pdo, $o, $u['id']);
        $this->tx(function () use ($u, $o, $a, $own, $ip): void {
            $app = $this->applicationById($o, $a, true);
            if ($app['staff_profile_id'] !== $own) {
                throw HttpError::notFound();
            }
            if ($app['status'] !== 'pending') {
                throw HttpError::conflict('not_pending', 'Only a pending application can be withdrawn');
            }
            $this->pdo->prepare("UPDATE cover_applications SET status = 'withdrawn' WHERE id = ? AND org_id = ?")->execute([$a, $o]);
            Audit::log($this->pdo, $o, $u['id'], 'cover.application_withdrawn', 'cover_applications', $a, [], 'info', 'org', $ip);
        });
        return [200, ['application' => self::presentApplication($this->applicationById($o, $a, false))]];
    }

    private function approveApplication(array $u, array $in, string $ip, string $o, string $a): array
    {
        $this->managerWrite($u, $o);
        $this->tx(function () use ($u, $o, $a, $ip): void {
            self::lockOrg($this->pdo, $o);
            $app = $this->applicationById($o, $a, true);
            if ($app['status'] !== 'pending') {
                throw HttpError::conflict('not_pending', 'This application has already been decided or withdrawn');
            }
            $this->fill($u, $o, (string) $app['shift_id'], (string) $app['staff_profile_id'], $a, $ip);
        });
        return [200, ['application' => self::presentApplication($this->applicationById($o, $a, false))]];
    }

    /** Assign an eligible person from the candidate list directly (no application needed). */
    private function assign(array $u, array $in, string $ip, string $o, string $s): array
    {
        $this->managerWrite($u, $o);
        $who = Input::reqStr($in, 'staff_profile_id', 36);
        $id = $this->tx(function () use ($u, $o, $s, $who, $ip): string {
            self::lockOrg($this->pdo, $o);
            $t = $this->pdo->prepare('SELECT 1 FROM staff_profiles WHERE id = ? AND org_id = ?');
            $t->execute([$who, $o]);
            if ($t->fetchColumn() === false) {
                throw HttpError::invalid('staff_profile_id is not a staff record in this organisation');
            }
            return $this->fill($u, $o, $s, $who, null, $ip);
        });
        return [200, ['application' => self::presentApplication($this->applicationById($o, $id, false))]];
    }

    private function rejectApplication(array $u, array $in, string $ip, string $o, string $a): array
    {
        $this->managerWrite($u, $o);
        $this->tx(function () use ($u, $o, $a, $ip): void {
            $app = $this->applicationById($o, $a, true);
            if ($app['status'] !== 'pending') {
                throw HttpError::conflict('not_pending', 'This application has already been decided or withdrawn');
            }
            $this->pdo->prepare("UPDATE cover_applications SET status = 'rejected', decided_by = ?, decided_at = UTC_TIMESTAMP() WHERE id = ? AND org_id = ?")->execute([$u['id'], $a, $o]);
            $sh = $this->shiftRows($o, [(string) $app['shift_id']])[$app['shift_id']] ?? null;
            Notify::enqueue($this->pdo, $o, 'cover/rejected', [Notify::userOfStaff($this->pdo, (string) $app['staff_profile_id'])], 'swap', 'Not this time: ' . ($sh !== null ? $this->describe($o, $sh) : 'a shift'));
            Audit::log($this->pdo, $o, $u['id'], 'cover.application_rejected', 'cover_applications', $a, [], 'info', 'org', $ip);
        });
        return [200, ['application' => self::presentApplication($this->applicationById($o, $a, false))]];
    }

    /**
     * Puts $who on an open shift. MUST run inside a transaction that already holds the organisation lock. Locks the shift, re-checks that it
     * is open and that $who is eligible, then writes only that shift. @return string the approved application id
     */
    private function fill(array $u, string $o, string $s, string $who, ?string $appId, string $ip): string
    {
        $sh = $this->lockShift($o, $s);
        self::requireOpen($sh);
        $this->requireNoAmendment($o, $sh);
        $this->requireEligible($o, $who, $sh, 'That person');
        $w = $this->pdo->prepare("UPDATE shifts SET staff_profile_id = ?, status = 'assigned' WHERE id = ? AND org_id = ? AND staff_profile_id IS NULL AND status = 'open'");
        $w->execute([$who, $s, $o]);
        if ($w->rowCount() !== 1) {
            throw HttpError::conflict('already_filled', 'This shift has already been filled');
        }
        if ($appId === null) {
            $existing = $this->applicationFor($o, $s, $who, true);
            if ($existing !== null) {
                $appId = (string) $existing['id'];
            } else {
                $appId = Db::uuid();
                $this->pdo->prepare('INSERT INTO cover_applications (id, org_id, shift_id, staff_profile_id) VALUES (?, ?, ?, ?)')->execute([$appId, $o, $s, $who]);
            }
        }
        $req = $this->openRequest($o, $s, true);
        $this->pdo->prepare("UPDATE cover_applications SET status = 'approved', decided_by = ?, decided_at = UTC_TIMESTAMP(), cover_request_id = COALESCE(cover_request_id, ?) WHERE id = ? AND org_id = ?")->execute([$u['id'], $req['id'] ?? null, $appId, $o]);
        $desc = $this->describe($o, $sh);
        $others = $this->pdo->prepare("SELECT id, staff_profile_id FROM cover_applications WHERE org_id = ? AND shift_id = ? AND status = 'pending' AND id <> ? FOR UPDATE");
        $others->execute([$o, $s, $appId]);
        foreach ($others->fetchAll() as $x) {
            $this->pdo->prepare("UPDATE cover_applications SET status = 'rejected', decided_by = ?, decided_at = UTC_TIMESTAMP() WHERE id = ? AND org_id = ?")->execute([$u['id'], $x['id'], $o]);
            Notify::enqueue($this->pdo, $o, 'cover/filled', [Notify::userOfStaff($this->pdo, (string) $x['staff_profile_id'])], 'swap', 'Covered by someone else: ' . $desc);
        }
        if ($req !== null) {
            $this->pdo->prepare("UPDATE cover_requests SET status = 'filled', open_shift_id = NULL, filled_staff_profile_id = ?, closed_by = ?, close_reason = 'filled', closed_at = UTC_TIMESTAMP() WHERE id = ? AND org_id = ?")->execute([$who, $u['id'], $req['id'], $o]);
        }
        Notify::enqueue($this->pdo, $o, 'cover/approved', [Notify::userOfStaff($this->pdo, $who)], 'swap', 'You are covering: ' . $desc, 'It is on your schedule now.');
        Audit::log($this->pdo, $o, $u['id'], 'cover.filled', 'shifts', $s, ['application_id' => $appId, 'request_id' => $req['id'] ?? null, 'staff_profile_id' => $who], 'info', 'org', $ip);
        self::sweep($this->pdo, $o, $u['id']);
        return $appId;
    }

    // ---- cover requests ----------------------------------------------------------------------------------------------------------------

    /** Turn a shift into a cover request: take the person off it (only this shift changes) and offer it to eligible people. */
    private function createRequest(array $u, array $in, string $ip, string $o): array
    {
        $this->managerWrite($u, $o);
        $s = Input::reqStr($in, 'shift_id', 36);
        $note = Input::optStr($in, 'note', 500);
        $absenceId = Input::optStr($in, 'absence_id', 36);
        [$id, $offered] = $this->tx(function () use ($u, $o, $s, $note, $absenceId, $in, $ip): array {
            self::lockOrg($this->pdo, $o);
            $sh = $this->lockShift($o, $s);
            if ($sh['rota_status'] !== 'published') {
                throw HttpError::conflict('not_published', 'Only a shift on a published rota can be opened for cover');
            }
            if ($sh['status'] === 'cancelled') {
                throw HttpError::conflict('shift_cancelled', 'This shift has been cancelled');
            }
            if ($sh['starts_at'] <= gmdate('Y-m-d H:i:s')) {
                throw HttpError::conflict('shift_started', 'This shift has already started');
            }
            $this->requireNoAmendment($o, $sh);
            $respondBy = C::respondBy($in['respond_by'] ?? null, R::ts((string) $sh['starts_at']), time());
            if ($this->openRequest($o, $s, true) !== null) {
                throw HttpError::conflict('already_requested', 'This shift already has an open cover request');
            }
            $q = $this->pdo->prepare("SELECT * FROM cover_absences WHERE org_id = ? AND shift_id = ? AND status = 'open' FOR UPDATE");
            $q->execute([$o, $s]);
            $absence = $q->fetch() ?: null;
            if ($absenceId !== null && ($absence === null || $absence['id'] !== $absenceId)) {
                throw HttpError::invalid('That absence report is not open for this shift');
            }
            $absent = $sh['staff_profile_id'];
            if ($absent !== null) {
                $this->pdo->prepare("UPDATE shifts SET staff_profile_id = NULL, status = 'open' WHERE id = ? AND org_id = ?")->execute([$s, $o]);
                Audit::log($this->pdo, $o, $u['id'], 'rota.shift_uncovered', 'shifts', $s, ['from' => $absent], 'info', 'org', $ip);
            }
            $id = Db::uuid();
            $this->pdo->prepare('INSERT INTO cover_requests (id, org_id, shift_id, open_shift_id, absence_id, absent_staff_profile_id, note, respond_by, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
                ->execute([$id, $o, $s, $s, $absence['id'] ?? null, $absent, $note, $respondBy === null ? null : gmdate('Y-m-d H:i:s', $respondBy), $u['id']]);
            if ($absence !== null) {
                $this->pdo->prepare("UPDATE cover_absences SET status = 'covered', open_shift_id = NULL, resolved_by = ?, resolved_at = UTC_TIMESTAMP() WHERE id = ? AND org_id = ?")->execute([$u['id'], $absence['id'], $o]);
            }
            if ($absent !== null) {
                Notify::enqueue($this->pdo, $o, 'cover/released', [Notify::userOfStaff($this->pdo, (string) $absent)], 'swap', 'You are off this shift: ' . $this->describe($o, $sh), 'Your manager is finding cover.');
            }
            $sh['staff_profile_id'] = null;
            $sh['status'] = 'open';
            $desc = $this->describe($o, $sh);
            $users = [];
            foreach ($this->rank($o, $sh) as $cand) {
                if ($cand['eligible'] && count($users) < self::MAX_OFFERS && ($uid = Notify::userOfStaff($this->pdo, $cand['staff_profile_id'])) !== null) {
                    $users[] = $uid;
                }
            }
            Notify::enqueue($this->pdo, $o, 'cover/offered', $users, 'swap', 'Cover needed: ' . $desc, $note);
            $this->pdo->prepare('UPDATE cover_requests SET offered_count = ? WHERE id = ? AND org_id = ?')->execute([count($users), $id, $o]);
            Audit::log($this->pdo, $o, $u['id'], 'cover.requested', 'cover_requests', $id, ['shift_id' => $s, 'removed' => $absent], 'info', 'org', $ip);
            self::sweep($this->pdo, $o, $u['id']);
            return [$id, count($users)];
        });
        return [201, ['request' => self::presentRequest($this->requestById($o, $id, false)), 'offered' => $offered]];
    }

    /** Close the request. The shift stays open on the rota and applications already made stay pending. */
    private function cancelRequest(array $u, array $in, string $ip, string $o, string $r): array
    {
        $this->managerWrite($u, $o);
        $this->tx(function () use ($u, $o, $r, $ip): void {
            $req = $this->requestById($o, $r, true);
            if ($req['status'] !== 'open') {
                throw HttpError::conflict('not_open', 'This cover request is already closed');
            }
            $this->pdo->prepare("UPDATE cover_requests SET status = 'cancelled', open_shift_id = NULL, closed_by = ?, close_reason = 'cancelled', closed_at = UTC_TIMESTAMP() WHERE id = ? AND org_id = ?")->execute([$u['id'], $r, $o]);
            Audit::log($this->pdo, $o, $u['id'], 'cover.request_cancelled', 'cover_requests', $r, [], 'info', 'org', $ip);
        });
        return [200, ['request' => self::presentRequest($this->requestById($o, $r, false))]];
    }

    // ---- absence reports ---------------------------------------------------------------------------------------------------------------

    private function reportAbsence(array $u, array $in, string $ip, string $o): array
    {
        $m = $this->access($u, $o, false);
        Scope::requireWritable($m);
        $own = $this->ownStaff($u, $o);
        $s = Input::reqStr($in, 'shift_id', 36);
        $reason = Input::optStr($in, 'reason', 500);
        if ($reason === null || preg_match('/^.{3,}$/us', trim($reason)) !== 1) {
            throw HttpError::invalid('Please give a short reason (at least 3 characters)');
        }
        $id = $this->tx(function () use ($u, $o, $s, $own, $reason, $ip): string {
            $sh = $this->lockShift($o, $s);
            // Only your own shift on a published rota: what you were told you are working.
            if ($sh['rota_status'] !== 'published' || $sh['staff_profile_id'] !== $own) {
                throw HttpError::notFound();
            }
            if ($sh['status'] === 'cancelled') {
                throw HttpError::conflict('shift_cancelled', 'This shift has been cancelled');
            }
            if ($sh['starts_at'] <= gmdate('Y-m-d H:i:s')) {
                throw HttpError::conflict('shift_started', 'This shift has already started. Please call your manager.');
            }
            $q = $this->pdo->prepare("SELECT 1 FROM cover_absences WHERE org_id = ? AND shift_id = ? AND status = 'open'");
            $q->execute([$o, $s]);
            if ($q->fetchColumn() !== false) {
                throw HttpError::conflict('already_reported', 'You have already told your manager you cannot work this shift');
            }
            $id = Db::uuid();
            $this->pdo->prepare('INSERT INTO cover_absences (id, org_id, shift_id, open_shift_id, staff_profile_id, reason) VALUES (?, ?, ?, ?, ?, ?)')->execute([$id, $o, $s, $s, $own, trim($reason)]);
            Notify::enqueue($this->pdo, $o, 'cover/absence', array_values(array_diff(Notify::managers($this->pdo, $o), [$u['id']])), 'swap', 'Cannot work: ' . $this->describe($o, $sh), ($this->names($o)[$own] ?? 'Someone') . ' cannot work this shift. Find cover on the Cover page.');
            Audit::log($this->pdo, $o, $u['id'], 'cover.absence_reported', 'cover_absences', $id, ['shift_id' => $s], 'info', 'org', $ip);
            return $id;
        });
        return [201, ['absence' => self::presentAbsence($this->absenceById($o, $id, false))]];
    }

    private function withdrawAbsence(array $u, array $in, string $ip, string $o, string $a): array
    {
        $m = $this->access($u, $o, false);
        Scope::requireWritable($m);
        $own = Scope::staffProfileId($this->pdo, $o, $u['id']);
        $this->tx(function () use ($u, $o, $a, $own, $ip): void {
            $b = $this->absenceById($o, $a, true);
            if ($b['staff_profile_id'] !== $own) {
                throw HttpError::notFound();
            }
            if ($b['status'] !== 'open') {
                throw HttpError::conflict('not_open', 'This report has already been dealt with');
            }
            $this->pdo->prepare("UPDATE cover_absences SET status = 'withdrawn', open_shift_id = NULL, resolved_at = UTC_TIMESTAMP() WHERE id = ? AND org_id = ?")->execute([$a, $o]);
            Audit::log($this->pdo, $o, $u['id'], 'cover.absence_withdrawn', 'cover_absences', $a, [], 'info', 'org', $ip);
        });
        return [200, ['absence' => self::presentAbsence($this->absenceById($o, $a, false))]];
    }

    /** The manager keeps the person on the shift. */
    private function dismissAbsence(array $u, array $in, string $ip, string $o, string $a): array
    {
        $this->managerWrite($u, $o);
        $this->tx(function () use ($u, $o, $a, $ip): void {
            $b = $this->absenceById($o, $a, true);
            if ($b['status'] !== 'open') {
                throw HttpError::conflict('not_open', 'This report has already been dealt with');
            }
            $this->pdo->prepare("UPDATE cover_absences SET status = 'dismissed', open_shift_id = NULL, resolved_by = ?, resolved_at = UTC_TIMESTAMP() WHERE id = ? AND org_id = ?")->execute([$u['id'], $a, $o]);
            $sh = $this->shiftRows($o, [(string) $b['shift_id']])[$b['shift_id']] ?? null;
            Notify::enqueue($this->pdo, $o, 'cover/absence_dismissed', [Notify::userOfStaff($this->pdo, (string) $b['staff_profile_id'])], 'swap', 'Still on this shift: ' . ($sh !== null ? $this->describe($o, $sh) : 'your shift'), 'Please contact your manager.');
            Audit::log($this->pdo, $o, $u['id'], 'cover.absence_dismissed', 'cover_absences', $a, [], 'info', 'org', $ip);
        });
        return [200, ['absence' => self::presentAbsence($this->absenceById($o, $a, false))]];
    }

    // ---- eligibility (also used by the instant open-shift claim) -----------------------------------------------------------------------

    /**
     * Reasons and warnings for one person taking one shift, read against what is committed (published rotas and shifts with no rota; drafts
     * and archived history are not commitments). With $lock the person's committed shifts are locked too, so an approval cannot race a write.
     * @param array<string,mixed> $sh a shift row with timezone (see shiftRows)
     * @return array{reasons:list<array{code:string,message:string}>, warnings:list<array{code:string,message:string}>}
     */
    public static function assess(\PDO $pdo, string $o, string $staff, array $sh, bool $lock): array
    {
        return self::assessFor($pdo, $o, $sh, [$staff], $lock)[$staff];
    }

    /** @param list<string> $people @return array<string, array{reasons:list<array>, warnings:list<array>}> */
    private static function assessFor(\PDO $pdo, string $o, array $sh, array $people, bool $lock): array
    {
        if ($people === []) {
            return [];
        }
        $orgTz = Compliance::tz($pdo, $o);
        $settings = $pdo->prepare('SELECT settings FROM organisations WHERE id = ?');
        $settings->execute([$o]);
        [$minRest, $maxWeek] = R::limits((string) $settings->fetchColumn());
        $in = implode(',', array_fill(0, count($people), '?'));
        $s = R::ts((string) $sh['starts_at']);
        $e = R::ts((string) $sh['ends_at']);
        $window = [$o, ...$people, (string) $sh['id'], gmdate('Y-m-d H:i:s', $e + 8 * 86400), gmdate('Y-m-d H:i:s', $s - 8 * 86400)];
        if ($lock) {
            // The person's shift rows only (never the rotas they hang off: publishing locks a rota first, and must not wait on cover).
            $lk = $pdo->prepare("SELECT id FROM shifts WHERE org_id = ? AND staff_profile_id IN ($in) AND id <> ? AND starts_at < ? AND ends_at > ? FOR UPDATE");
            $lk->execute($window);
            $lk->fetchAll();
        }
        $q = $pdo->prepare(
            "SELECT s.id, s.staff_profile_id, s.starts_at, s.ends_at, s.break_minutes, s.status FROM shifts s LEFT JOIN rotas x ON x.id = s.rota_id AND x.org_id = s.org_id
              WHERE s.org_id = ? AND s.staff_profile_id IN ($in) AND s.status <> 'cancelled' AND s.id <> ? AND s.starts_at < ? AND s.ends_at > ?
                AND (s.rota_id IS NULL OR x.status = 'published') LIMIT 20000"
        );
        $q->execute($window);
        $others = [];
        foreach ($q->fetchAll() as $x) {
            $others[(string) $x['staff_profile_id']][] = $x;
        }
        $l = $pdo->prepare("SELECT staff_profile_id, start_date, end_date, status, type FROM leave_requests WHERE org_id = ? AND status = 'approved' AND staff_profile_id IN ($in)");
        $l->execute([$o, ...$people]);
        $leave = [];
        foreach ($l->fetchAll() as $x) {
            $leave[(string) $x['staff_profile_id']][] = $x;
        }
        $a = $pdo->prepare("SELECT staff_profile_id, weekday, date, start_time, end_time, status, recurring FROM availability WHERE org_id = ? AND status = 'unavailable' AND staff_profile_id IN ($in)");
        $a->execute([$o, ...$people]);
        $avail = [];
        foreach ($a->fetchAll() as $x) {
            $avail[(string) $x['staff_profile_id']][] = $x;
        }
        $act = $pdo->prepare("SELECT id, active FROM staff_profiles WHERE org_id = ? AND id IN ($in)");
        $act->execute([$o, ...$people]);
        $active = $act->fetchAll(\PDO::FETCH_KEY_PAIR);
        $ab = $pdo->prepare("SELECT staff_profile_id FROM cover_absences WHERE org_id = ? AND shift_id = ? AND status IN ('open','covered') UNION SELECT absent_staff_profile_id FROM cover_requests WHERE org_id = ? AND shift_id = ? AND status = 'open' AND absent_staff_profile_id IS NOT NULL");
        $ab->execute([$o, $sh['id'], $o, $sh['id']]);
        $absent = array_flip(array_map('strval', $ab->fetchAll(\PDO::FETCH_COLUMN)));
        $at = gmdate('Y-m-d\TH:i:s\Z', $s);
        $out = [];
        foreach ($people as $p) {
            $isActive = isset($active[$p]) && (int) $active[$p] === 1;
            $docs = $isActive ? Compliance::eligible($pdo, $o, $p, $at) : null;
            $out[$p] = C::assess($p, $sh, ['active' => $isActive, 'absent' => isset($absent[$p]), 'documents' => $docs], $others[$p] ?? [], $leave[$p] ?? [], $avail[$p] ?? [], $minRest, $maxWeek, $orgTz);
        }
        return $out;
    }

    /** Throws 409 not_eligible with every reason in one sentence. */
    private function requireEligible(string $o, string $who, array $sh, string $label): void
    {
        $r = self::assess($this->pdo, $o, $who, $sh, true)['reasons'];
        if ($r !== []) {
            throw HttpError::conflict('not_eligible', $label . ' cannot take this shift: ' . implode('; ', array_column($r, 'message')));
        }
    }

    // ---- candidates ----------------------------------------------------------------------------------------------------------------------

    /** @return list<array<string,mixed>> */
    private function rank(string $o, array $sh): array
    {
        $q = $this->pdo->prepare("SELECT id, TRIM(CONCAT(first_name, ' ', COALESCE(last_name, ''))) AS name FROM staff_profiles WHERE org_id = ? AND active = 1 AND (? IS NULL OR id <> ?) ORDER BY first_name, last_name LIMIT " . self::MAX_CANDIDATES);
        $q->execute([$o, $sh['staff_profile_id'], $sh['staff_profile_id']]);
        $people = $q->fetchAll(\PDO::FETCH_KEY_PAIR);
        if ($people === []) {
            return [];
        }
        $ids = array_map('strval', array_keys($people));
        $assessed = self::assessFor($this->pdo, $o, $sh, $ids, false);
        $apps = $this->pdo->prepare('SELECT staff_profile_id, id, status FROM cover_applications WHERE org_id = ? AND shift_id = ?');
        $apps->execute([$o, $sh['id']]);
        $applied = [];
        foreach ($apps->fetchAll() as $a) {
            $applied[$a['staff_profile_id']] = ['id' => $a['id'], 'status' => $a['status']];
        }
        $hours = $this->hoursThatWeek($o, $sh, $ids);
        $rows = [];
        foreach ($ids as $p) {
            $rows[] = [
                'staff_profile_id' => $p, 'name' => (string) $people[$p],
                'eligible' => $assessed[$p]['reasons'] === [], 'reasons' => $assessed[$p]['reasons'], 'warnings' => $assessed[$p]['warnings'],
                'application' => $applied[$p] ?? null, 'applied' => ($applied[$p]['status'] ?? '') === 'pending', 'hours' => $hours[$p] ?? 0.0,
            ];
        }
        return array_map(static function (array $r): array {
            $r['hours_that_week'] = $r['hours'];
            unset($r['applied'], $r['hours']);
            return $r;
        }, C::rank($rows));
    }

    /** Hours already committed in the organisation-local Monday-to-Sunday week of the shift. @return array<string,float> */
    private function hoursThatWeek(string $o, array $sh, array $ids): array
    {
        $tz = Compliance::tz($this->pdo, $o);
        $monday = R::weekOf(R::ts((string) $sh['starts_at']), $tz);
        $lo = gmdate('Y-m-d H:i:s', R::localTs($monday, '00:00', $tz));
        $hi = gmdate('Y-m-d H:i:s', R::localTs(R::addDays($monday, 7), '00:00', $tz));
        $in = implode(',', array_fill(0, count($ids), '?'));
        $q = $this->pdo->prepare(
            "SELECT s.staff_profile_id, SUM(GREATEST(0, TIMESTAMPDIFF(MINUTE, s.starts_at, s.ends_at) - s.break_minutes)) FROM shifts s LEFT JOIN rotas x ON x.id = s.rota_id AND x.org_id = s.org_id
              WHERE s.org_id = ? AND s.staff_profile_id IN ($in) AND s.status <> 'cancelled' AND s.starts_at >= ? AND s.starts_at < ? AND (s.rota_id IS NULL OR x.status = 'published') GROUP BY s.staff_profile_id"
        );
        $q->execute([$o, ...$ids, $lo, $hi]);
        $out = [];
        foreach ($q->fetchAll(\PDO::FETCH_KEY_PAIR) as $p => $mins) {
            $out[(string) $p] = round(((int) $mins) / 60, 1);
        }
        return $out;
    }

    // ---- helpers -------------------------------------------------------------------------------------------------------------------------

    /** Membership first (a stranger gets 404), then the flag, then the role. */
    private function access(array $u, string $o, bool $manager): array
    {
        $m = Scope::membership($this->pdo, $u['id'], $o);
        if (!self::on($this->pdo, $o)) {
            throw new HttpError(403, 'feature_off', 'Cover is not switched on for this organisation yet.');
        }
        if ($manager) {
            Scope::require($m, Scope::MANAGERS);
        }
        return $m;
    }

    /** Owners and managers change the published rota; a read-only (billing) organisation cannot. */
    private function managerWrite(array $u, string $o): array
    {
        $m = $this->access($u, $o, true);
        Scope::requireWritable($m);
        Billing::requireNotReadOnly($this->pdo, $o);
        return $m;
    }

    private function ownStaff(array $u, string $o): string
    {
        return Scope::staffProfileId($this->pdo, $o, $u['id']) ?? throw new HttpError(403, 'no_staff_record', 'You do not have a staff record in this organisation');
    }

    private function sweepIfNeeded(string $o, string $actor): void
    {
        $q = $this->pdo->prepare("SELECT 1 FROM cover_requests c JOIN shifts s ON s.id = c.shift_id AND s.org_id = c.org_id WHERE c.org_id = ? AND c.status = 'open' AND (s.starts_at <= UTC_TIMESTAMP() OR s.status = 'cancelled' OR s.staff_profile_id IS NOT NULL) LIMIT 1");
        $q->execute([$o]);
        if ($q->fetchColumn() !== false) {
            $this->tx(fn (): int => self::sweep($this->pdo, $o, $actor));
        }
    }

    /** @param list<array<string,mixed>> $apps @return list<string> */
    private function appliedPeople(array $apps, string $shiftId): array
    {
        return array_values(array_unique(array_map(static fn (array $a): string => (string) $a['staff_profile_id'], array_filter($apps, static fn (array $a): bool => $a['shift_id'] === $shiftId))));
    }

    /** @param list<string> $people @return array<string, array{reasons:list<array>, warnings:list<array>}> */
    private function assessMany(string $o, array $sh, array $people, bool $lock): array
    {
        return self::assessFor($this->pdo, $o, $sh, $people, $lock);
    }

    /** Open = on a published rota, status open, nobody on it, not started. */
    private static function requireOpen(array $sh): void
    {
        if ($sh['rota_status'] !== 'published') {
            throw HttpError::conflict('not_published', 'This shift is not on a published rota');
        }
        if ($sh['status'] === 'cancelled') {
            throw HttpError::conflict('shift_cancelled', 'This shift has been cancelled');
        }
        if ($sh['starts_at'] <= gmdate('Y-m-d H:i:s')) {
            throw HttpError::conflict('shift_started', 'This shift has already started');
        }
        if ($sh['staff_profile_id'] !== null || $sh['status'] !== 'open') {
            throw HttpError::conflict('already_filled', 'This shift has already been filled');
        }
    }

    /** A published rota with an open amendment: a change here would be undone when the amendment is published. */
    private function requireNoAmendment(string $o, array $sh): void
    {
        $q = $this->pdo->prepare("SELECT 1 FROM rotas WHERE org_id = ? AND supersedes_rota_id = ? AND status = 'draft' LIMIT 1");
        $q->execute([$o, $sh['rota_id']]);
        if ($q->fetchColumn() !== false) {
            throw HttpError::conflict('open_amendment', 'This week has an open amendment. Make the change in the amendment, or discard it first.');
        }
    }

    private const SHIFT_SQL = "SELECT s.*, x.status AS rota_status, l.timezone, l.name AS location_name, st.name AS shift_type FROM shifts s LEFT JOIN rotas x ON x.id = s.rota_id AND x.org_id = s.org_id LEFT JOIN locations l ON l.id = s.location_id AND l.org_id = s.org_id LEFT JOIN shift_types st ON st.id = s.shift_type_id AND st.org_id = s.org_id WHERE s.org_id = ?";

    /** The shift row locked (only the shift: its rota and site are read after, unlocked), with its rota status and site zone. */
    private function lockShift(string $o, string $s): array
    {
        $q = $this->pdo->prepare('SELECT id FROM shifts WHERE id = ? AND org_id = ? FOR UPDATE');
        $q->execute([$s, $o]);
        if ($q->fetchColumn() === false) {
            throw HttpError::notFound();
        }
        return $this->shiftRows($o, [$s])[$s];
    }

    /** @param list<string> $ids @return array<string, array<string,mixed>> */
    private function shiftRows(string $o, array $ids): array
    {
        $ids = array_values(array_unique(array_map('strval', $ids)));
        if ($ids === []) {
            return [];
        }
        $tz = Compliance::tz($this->pdo, $o);
        $q = $this->pdo->prepare(self::SHIFT_SQL . ' AND s.id IN (' . implode(',', array_fill(0, count($ids), '?')) . ')');
        $q->execute([$o, ...$ids]);
        $out = [];
        foreach ($q->fetchAll() as $r) {
            $r['timezone'] = R::validZone($r['timezone']) ? $r['timezone'] : $tz;
            $out[(string) $r['id']] = $r;
        }
        return $out;
    }

    /** "Oak House, Mon 2 Nov 09:00–17:00" in the shift's site zone. */
    private function describe(string $o, array $sh): string
    {
        $tz = R::validZone($sh['timezone'] ?? null) ? (string) $sh['timezone'] : Compliance::tz($this->pdo, $o);
        [$d, $a] = R::localParts(R::ts((string) $sh['starts_at']), $tz);
        $b = R::localParts(R::ts((string) $sh['ends_at']), $tz)[1];
        return ($sh['location_name'] ?? null ? $sh['location_name'] . ', ' : '') . R::dayLabel($d) . " {$a}–{$b}";
    }

    /** @return array<string,string> staff record id => name */
    private function names(string $o): array
    {
        $q = $this->pdo->prepare("SELECT id, TRIM(CONCAT(first_name, ' ', COALESCE(last_name, ''))) FROM staff_profiles WHERE org_id = ?");
        $q->execute([$o]);
        return array_map('strval', $q->fetchAll(\PDO::FETCH_KEY_PAIR));
    }

    private function openRequest(string $o, string $s, bool $lock): ?array
    {
        $q = $this->pdo->prepare("SELECT * FROM cover_requests WHERE org_id = ? AND shift_id = ? AND status = 'open'" . ($lock ? ' FOR UPDATE' : ''));
        $q->execute([$o, $s]);
        return $q->fetch() ?: null;
    }

    private function applicationFor(string $o, string $s, string $who, bool $lock): ?array
    {
        $q = $this->pdo->prepare('SELECT * FROM cover_applications WHERE org_id = ? AND shift_id = ? AND staff_profile_id = ?' . ($lock ? ' FOR UPDATE' : ''));
        $q->execute([$o, $s, $who]);
        return $q->fetch() ?: null;
    }

    private function byId(string $table, string $o, string $id, bool $lock): array
    {
        $q = $this->pdo->prepare("SELECT * FROM $table WHERE org_id = ? AND id = ?" . ($lock ? ' FOR UPDATE' : '')); // $table: a literal from the three callers below
        $q->execute([$o, $id]);
        return $q->fetch() ?: throw HttpError::notFound();
    }

    private function applicationById(string $o, string $id, bool $lock): array { return $this->byId('cover_applications', $o, $id, $lock); }
    private function requestById(string $o, string $id, bool $lock): array { return $this->byId('cover_requests', $o, $id, $lock); }
    private function absenceById(string $o, string $id, bool $lock): array { return $this->byId('cover_absences', $o, $id, $lock); }

    /** @template T @param callable():T $fn @return T */
    private function tx(callable $fn): mixed
    {
        $this->pdo->beginTransaction();
        try {
            $r = $fn();
            $this->pdo->commit();
            return $r;
        } catch (\Throwable $e) {
            if ($this->pdo->inTransaction()) {
                $this->pdo->rollBack();
            }
            throw $e;
        }
    }

    // ---- presenters ----------------------------------------------------------------------------------------------------------------------

    private static function presentShift(array $s): array
    {
        return ['id' => $s['id'], 'rota_id' => $s['rota_id'], 'location_id' => $s['location_id'], 'location_name' => $s['location_name'], 'shift_type' => $s['shift_type'], 'staff_profile_id' => $s['staff_profile_id'], 'starts_at' => Time::iso($s['starts_at']), 'ends_at' => Time::iso($s['ends_at']), 'break_minutes' => (int) $s['break_minutes'], 'status' => $s['status'], 'timezone' => $s['timezone'], 'notes' => $s['notes']];
    }

    private static function presentApplication(array $a): array
    {
        return ['id' => $a['id'], 'shift_id' => $a['shift_id'], 'staff_profile_id' => $a['staff_profile_id'], 'cover_request_id' => $a['cover_request_id'], 'status' => $a['status'], 'note' => $a['note'], 'created_at' => Time::iso($a['created_at']), 'updated_at' => Time::iso($a['updated_at'])];
    }

    private static function presentRequest(array $r): array
    {
        return ['id' => $r['id'], 'shift_id' => $r['shift_id'], 'status' => $r['status'], 'note' => $r['note'], 'respond_by' => Time::iso($r['respond_by']), 'absence_id' => $r['absence_id'], 'absent_staff_profile_id' => $r['absent_staff_profile_id'], 'filled_staff_profile_id' => $r['filled_staff_profile_id'], 'offered_count' => (int) $r['offered_count'], 'close_reason' => $r['close_reason'], 'created_at' => Time::iso($r['created_at'])];
    }

    private static function presentAbsence(array $b): array
    {
        return ['id' => $b['id'], 'shift_id' => $b['shift_id'], 'staff_profile_id' => $b['staff_profile_id'], 'reason' => $b['reason'], 'status' => $b['status'], 'created_at' => Time::iso($b['created_at'])];
    }
}
