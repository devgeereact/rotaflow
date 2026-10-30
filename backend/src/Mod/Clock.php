<?php
declare(strict_types=1);

namespace RotaFlow\Mod;

use RotaFlow\{Audit, Ctx, Db, HttpError, Input, Module, Scope, Time};

/**
 * Clock events (in, out, break start, break end) and managers' corrections of them.
 *
 * What the server decides, not the device: a person's event time is trusted only if it is within 5 minutes ahead of the
 * server clock and at most 72 hours behind it (an offline queue can replay late); otherwise the server time is used and
 * the device's claim is kept in event_at_reported. Owners and managers may record any time for anyone. Clocking "in"
 * twice within five minutes is refused. A replayed offline write (same client_event_id) answers 200 already_applied.
 * The geofence is recorded, not enforced here.
 */
final class Clock implements Module
{
    private const TYPES = ['in', 'out', 'break_start', 'break_end'];
    private const METHODS = ['gps', 'qr', 'manual'];
    private const FUTURE_SLACK = 300;
    private const PAST_LIMIT = 72 * 3600;
    private const DOUBLE_IN_WINDOW = 300;

    public function __construct(private readonly Ctx $ctx) {}

    public function routes(): array
    {
        return [
            ['GET', '/orgs/{o}/clock-events', $this->list(...)],
            ['POST', '/orgs/{o}/clock-events', $this->record(...)],
            ['POST', '/orgs/{o}/clock-events/{e}/delete', $this->delete(...)],
            ['POST', '/orgs/{o}/clock-events/{e}/correct', $this->correct(...)],
            ['GET', '/orgs/{o}/clock-events/{e}/corrections', $this->corrections(...)],
        ];
    }

    /** Managers read anyone's; a member reads only their own. ?latest=1 returns the most recent event. Filters: staff_profile_id, from, to, limit. */
    private function list(array $user, array $in, string $ip, string $o): array
    {
        $pdo = $this->ctx->pdo;
        $m = Scope::membership($pdo, $user['id'], $o);
        $manager = in_array($m['effective_role'], Scope::MANAGERS, true);
        $own = Scope::staffProfileId($pdo, $o, $user['id']);
        $sql = 'SELECT * FROM clock_events WHERE org_id = ?';
        $args = [$o];
        if ($manager) {
            if (($sp = Input::optStr($in, 'staff_profile_id', 36)) !== null) {
                $sql .= ' AND staff_profile_id = ?';
                $args[] = $sp;
            }
        } else {
            $sql .= ' AND staff_profile_id = ?';
            $args[] = $own ?? '';
        }
        if (isset($in['from'])) {
            $sql .= ' AND event_at >= ?';
            $args[] = Time::parseInstant($in['from'], 'from', true);
        }
        if (isset($in['to'])) {
            $sql .= ' AND event_at < ?';
            $args[] = Time::parseInstant($in['to'], 'to', true);
        }
        $limit = ($in['latest'] ?? '') === '1' ? 1 : (int) (Input::optNum($in, 'limit', 1, 1000) ?? 200);
        $q = $pdo->prepare($sql . ' ORDER BY event_at DESC, created_at DESC LIMIT ' . $limit);
        $q->execute($args);
        return [200, ['clock_events' => array_map($this->present(...), $q->fetchAll())]];
    }

    private function record(array $user, array $in, string $ip, string $o): array
    {
        $pdo = $this->ctx->pdo;
        $m = Scope::membership($pdo, $user['id'], $o);
        Scope::requireWritable($m);
        $manager = in_array($m['effective_role'], Scope::MANAGERS, true);
        $own = Scope::staffProfileId($pdo, $o, $user['id']);
        $staff = Input::optStr($in, 'staff_profile_id', 36) ?? $own;
        if ($staff === null) {
            throw new HttpError(403, 'no_staff_record', 'You do not have a staff record in this organisation');
        }
        if ($staff !== $own && !$manager) {
            throw HttpError::forbidden();
        }
        $this->exists('staff_profiles', $staff, $o, HttpError::invalid('That staff member is not in this organisation'));
        $type = $in['type'] ?? null;
        if (!in_array($type, self::TYPES, true)) {
            throw HttpError::invalid('type must be one of ' . implode(', ', self::TYPES));
        }
        $method = $in['method'] ?? 'manual';
        if (!in_array($method, self::METHODS, true)) {
            throw HttpError::invalid('method must be gps, qr or manual');
        }
        $shift = Input::optStr($in, 'shift_id', 36);
        if ($shift !== null) {
            $this->exists('shifts', $shift, $o, HttpError::invalid('That shift is not in this organisation'));
        }
        $lat = Input::optNum($in, 'latitude', -90, 90);
        $lng = Input::optNum($in, 'longitude', -180, 180);
        $acc = Input::optNum($in, 'accuracy', 0, 100000);
        if (($lat === null) !== ($lng === null)) {
            throw HttpError::invalid('latitude and longitude go together');
        }
        $cid = Input::optStr($in, 'client_event_id', 36);
        if ($cid !== null && preg_match('/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/', $cid) !== 1) {
            throw HttpError::invalid('client_event_id must be a UUID');
        }
        // A replay of an offline write is answered from the row it already made.
        if ($cid !== null && ($prior = $this->byClientId($cid)) !== null) {
            return $this->replay($prior, $o, $staff);
        }

        $now = microtime(true);
        $submitted = array_key_exists('event_at', $in) && $in['event_at'] !== null ? Time::parseInstant($in['event_at'], 'event_at', true) : null;
        $eventAt = $submitted;
        $reported = null;
        if (!$manager) {
            $t = $submitted === null ? null : (float) (new \DateTimeImmutable($submitted . ' UTC'))->format('U.u');
            if ($t === null || $t > $now + self::FUTURE_SLACK || $t < $now - self::PAST_LIMIT) {
                $reported = $submitted; // what the device claimed, kept for the record
                $eventAt = null;
            }
        }
        $eventAt ??= gmdate('Y-m-d H:i:s', (int) $now) . sprintf('.%03d', (int) (($now - floor($now)) * 1000));

        if (!$manager && $type === 'in') {
            $q = $pdo->prepare('SELECT type FROM clock_events WHERE org_id = ? AND staff_profile_id = ? AND event_at <= ? AND event_at > DATE_SUB(?, INTERVAL ' . self::DOUBLE_IN_WINDOW . ' SECOND) ORDER BY event_at DESC, created_at DESC LIMIT 1');
            $q->execute([$o, $staff, $eventAt, $eventAt]);
            if ($q->fetchColumn() === 'in') {
                throw HttpError::conflict('already_clocked_in', 'You are already clocked in. If this is a second shift, clock out of the first one first.');
            }
        }
        $id = Db::uuid();
        try {
            $pdo->prepare('INSERT INTO clock_events (id, org_id, staff_profile_id, shift_id, type, event_at, event_at_reported, latitude, longitude, accuracy, method, location_name, client_event_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
                ->execute([$id, $o, $staff, $shift, $type, $eventAt, $reported, $lat, $lng, $acc, $method, Input::optStr($in, 'location_name', 200), $cid]);
        } catch (\PDOException $e) {
            if ($cid !== null && $e->getCode() === '23000' && ($prior = $this->byClientId($cid)) !== null) {
                return $this->replay($prior, $o, $staff); // two copies of the same replay raced
            }
            throw $e;
        }
        return [201, ['clock_event' => $this->one($id), 'already_applied' => false]];
    }

    private function delete(array $user, array $in, string $ip, string $o, string $e): array
    {
        $pdo = $this->ctx->pdo;
        $m = Scope::membership($pdo, $user['id'], $o);
        Scope::require($m, Scope::MANAGERS);
        Scope::requireWritable($m);
        $this->load($o, $e);
        $pdo->prepare('DELETE FROM clock_events WHERE id = ? AND org_id = ?')->execute([$e, $o]);
        Audit::log($pdo, $o, $user['id'], 'clock_event.deleted', 'clock_events', $e, [], 'warning', 'org', $ip);
        return [200, ['ok' => true]];
    }

    /** Owner or manager. Needs a reason of 3 to 500 characters; keeps before and after; flags approved timesheets that cover the old or new date. */
    private function correct(array $user, array $in, string $ip, string $o, string $e): array
    {
        $pdo = $this->ctx->pdo;
        $m = Scope::membership($pdo, $user['id'], $o);
        Scope::require($m, Scope::MANAGERS);
        Scope::requireWritable($m);
        $reason = trim(Input::str($in, 'reason'));
        if (\RotaFlow\Str::len($reason) < 3 || \RotaFlow\Str::len($reason) > 500) {
            throw new HttpError(422, 'reason_required', 'A correction needs a reason of 3 to 500 characters.');
        }
        $newAt = array_key_exists('event_at', $in) && $in['event_at'] !== null ? Time::parseInstant($in['event_at'], 'event_at', true) : null;
        $newType = $in['type'] ?? null;
        if ($newType !== null && !in_array($newType, self::TYPES, true)) {
            throw HttpError::invalid('type must be one of ' . implode(', ', self::TYPES));
        }
        $pdo->beginTransaction();
        try {
            $q = $pdo->prepare('SELECT * FROM clock_events WHERE id = ? AND org_id = ? FOR UPDATE');
            $q->execute([$e, $o]);
            $before = $q->fetch() ?: throw HttpError::notFound();
            if (array_key_exists('expected_updated_at', $in) && $in['expected_updated_at'] !== null
                && Time::parseInstant($in['expected_updated_at'], 'expected_updated_at', true) !== $before['updated_at']) {
                throw HttpError::conflict('record_changed', 'This attendance record changed while you were editing it. Reopen it and try again.');
            }
            $pdo->prepare('UPDATE clock_events SET event_at = ?, type = ? WHERE id = ?')->execute([$newAt ?? $before['event_at'], $newType ?? $before['type'], $e]);
            $q->execute([$e, $o]);
            $after = $q->fetch();
            $name = $pdo->prepare('SELECT COALESCE(full_name, email) FROM users WHERE id = ?');
            $name->execute([$user['id']]);
            $pdo->prepare('INSERT INTO clock_event_corrections (id, org_id, clock_event_id, staff_profile_id, actor_user_id, actor_name, reason, before_value, after_value) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
                ->execute([Db::uuid(), $o, $e, $before['staff_profile_id'], $user['id'], $name->fetchColumn() ?: null, $reason, json_encode($this->present($before)), json_encode($this->present($after))]);
            foreach (array_unique([substr($before['event_at'], 0, 10), substr($after['event_at'], 0, 10)]) as $day) {
                $pdo->prepare("UPDATE timesheets SET recalculation_required_at = UTC_TIMESTAMP() WHERE org_id = ? AND staff_profile_id = ? AND status IN ('approved','exported') AND ? BETWEEN period_start AND period_end")
                    ->execute([$o, $before['staff_profile_id'], $day]);
            }
            Audit::log($pdo, $o, $user['id'], 'clock_event.corrected', 'clock_events', $e, [], 'warning', 'org', $ip);
            $pdo->commit();
        } catch (\Throwable $x) {
            $pdo->rollBack();
            throw $x;
        }
        return [200, ['clock_event' => $this->one($e)]];
    }

    private function corrections(array $user, array $in, string $ip, string $o, string $e): array
    {
        $m = Scope::membership($this->ctx->pdo, $user['id'], $o);
        Scope::require($m, Scope::MANAGERS);
        $q = $this->ctx->pdo->prepare('SELECT id, actor_user_id, actor_name, reason, before_value, after_value, created_at FROM clock_event_corrections WHERE org_id = ? AND clock_event_id = ? ORDER BY created_at DESC');
        $q->execute([$o, $e]);
        return [200, ['corrections' => array_map(static function (array $r): array {
            $r['before_value'] = json_decode((string) $r['before_value'], true);
            $r['after_value'] = json_decode((string) $r['after_value'], true);
            $r['created_at'] = Time::iso($r['created_at']);
            return $r;
        }, $q->fetchAll())]];
    }

    // ---- helpers ---------------------------------------------------------------------------------------

    /** @return array{0:int,1:array<string,mixed>} */
    private function replay(array $prior, string $o, string $staff): array
    {
        if ($prior['org_id'] !== $o || $prior['staff_profile_id'] !== $staff) {
            throw HttpError::conflict('client_event_conflict', 'That client_event_id was used for a different record');
        }
        return [200, ['clock_event' => $this->present($prior), 'already_applied' => true]];
    }

    /** @return array<string,mixed>|null */
    private function byClientId(string $cid): ?array
    {
        $q = $this->ctx->pdo->prepare('SELECT * FROM clock_events WHERE client_event_id = ?');
        $q->execute([$cid]);
        return $q->fetch() ?: null;
    }

    /** @return array<string,mixed> */
    private function load(string $o, string $e): array
    {
        $q = $this->ctx->pdo->prepare('SELECT * FROM clock_events WHERE id = ? AND org_id = ?');
        $q->execute([$e, $o]);
        return $q->fetch() ?: throw HttpError::notFound();
    }

    /** @return array<string,mixed> */
    private function one(string $id): array
    {
        $q = $this->ctx->pdo->prepare('SELECT * FROM clock_events WHERE id = ?');
        $q->execute([$id]);
        return $this->present($q->fetch());
    }

    private function exists(string $table, string $id, string $org, HttpError $else): void
    {
        $q = $this->ctx->pdo->prepare("SELECT 1 FROM $table WHERE id = ? AND org_id = ?"); // $table is a literal from this class
        $q->execute([$id, $org]);
        if ($q->fetchColumn() === false) {
            throw $else;
        }
    }

    /** @param array<string,mixed> $r */
    private function present(array $r): array
    {
        foreach (['event_at', 'event_at_reported', 'created_at', 'updated_at'] as $k) {
            $r[$k] = Time::iso($r[$k] ?? null);
        }
        $r['synced'] = (bool) $r['synced'];
        return $r;
    }
}
