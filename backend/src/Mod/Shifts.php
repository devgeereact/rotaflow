<?php
declare(strict_types=1);

namespace RotaFlow\Mod;

use RotaFlow\{Audit, Ctx, Db, HttpError, Input, Module, Scope, Time};

/**
 * Shifts. Any member reads the shifts of rotas they may read (published and archived ones, plus loose shifts that belong to no
 * rota); an owner or manager also reads drafts. Only an owner or manager writes, and only into a DRAFT rota: a published rota
 * is immutable (amend it instead) and an archived one is history. Every write takes the rota's row lock, so it queues behind
 * a publish of the same rota rather than racing it.
 */
final class Shifts implements Module
{
    private const MAX_BATCH = 500;
    private const MAX_ROWS = 5000;
    private const STATUSES = ['open', 'assigned', 'confirmed', 'cancelled'];

    public function __construct(private readonly Ctx $ctx) {}

    public function routes(): array
    {
        return [
            ['GET', '/orgs/{o}/shifts', $this->list(...)],
            ['POST', '/orgs/{o}/shifts', $this->create(...)],
            ['POST', '/orgs/{o}/shifts/batch', $this->createBatch(...)],
            ['POST', '/orgs/{o}/shifts/{h}', $this->update(...)],
            ['POST', '/orgs/{o}/shifts/{h}/delete', $this->delete(...)],
        ];
    }

    /**
     * Three ways to ask, all excluding what the caller may not read:
     *   ?rota_ids=a,b,c                      every shift (cancelled included) of those rotas
     *   ?from=ISO&to=ISO[&overlapping=1]     shifts starting in the window, or (overlapping) running during it; cancelled excluded
     * Optional filters: location_id, staff_profile_id.
     */
    private function list(array $user, array $in, string $ip, string $o): array
    {
        $m = Scope::membership($this->ctx->pdo, $user['id'], $o);
        $manager = in_array($m['effective_role'], Scope::MANAGERS, true);
        $sql = 'SELECT s.*, r.status AS rota_status, r.supersedes_rota_id FROM shifts s LEFT JOIN rotas r ON r.id = s.rota_id AND r.org_id = s.org_id WHERE s.org_id = ?';
        $args = [$o];
        if (!$manager) {
            $sql .= " AND (s.rota_id IS NULL OR r.status IN ('published','archived'))";
        }
        if (($ids = Input::optStr($in, 'rota_ids', 2000)) !== null) {
            $list = array_values(array_unique(explode(',', $ids)));
            if (count($list) > 50 || array_filter($list, static fn (string $x): bool => preg_match('/^[0-9a-f-]{36}$/', $x) !== 1) !== []) {
                throw HttpError::invalid('rota_ids must be up to 50 rota ids, comma separated');
            }
            $sql .= ' AND s.rota_id IN (' . implode(',', array_fill(0, count($list), '?')) . ')';
            array_push($args, ...$list);
        } elseif (isset($in['from'], $in['to'])) {
            $from = Time::parseInstant($in['from'], 'from');
            $to = Time::parseInstant($in['to'], 'to');
            $sql .= ($in['overlapping'] ?? '') === '1' ? ' AND s.starts_at < ? AND s.ends_at > ?' : ' AND s.starts_at >= ? AND s.starts_at < ?';
            array_push($args, ...(($in['overlapping'] ?? '') === '1' ? [$to, $from] : [$from, $to]));
            $sql .= " AND s.status <> 'cancelled'";
        } else {
            throw HttpError::invalid('Give rota_ids, or from and to');
        }
        foreach (['location_id', 'staff_profile_id'] as $f) {
            if (($v = Input::optStr($in, $f, 36)) !== null) {
                $sql .= " AND s.$f = ?"; // $f is one of two literals above
                $args[] = $v;
            }
        }
        $q = $this->ctx->pdo->prepare($sql . ' ORDER BY s.rota_id, s.starts_at, s.id LIMIT ' . (self::MAX_ROWS + 1));
        $q->execute($args);
        $rows = $q->fetchAll();
        $truncated = count($rows) > self::MAX_ROWS;
        return [200, ['shifts' => array_map($this->present(...), array_slice($rows, 0, self::MAX_ROWS)), 'truncated' => $truncated]];
    }

    private function create(array $user, array $in, string $ip, string $o): array
    {
        [$ids] = $this->write($user, $o, [$in], $ip);
        return [201, ['shift' => $this->one($o, $ids[0])]];
    }

    private function createBatch(array $user, array $in, string $ip, string $o): array
    {
        $m = Scope::membership($this->ctx->pdo, $user['id'], $o); // membership first: a stranger must never learn what the body should look like
        Scope::require($m, Scope::MANAGERS);
        $rows = $in['shifts'] ?? null;
        if (!is_array($rows) || !array_is_list($rows) || $rows === [] || count($rows) > self::MAX_BATCH) {
            throw HttpError::invalid('shifts must be a list of 1 to ' . self::MAX_BATCH . ' shifts');
        }
        foreach ($rows as $r) {
            if (!is_array($r)) {
                throw HttpError::invalid('each shift must be an object');
            }
        }
        [$ids] = $this->write($user, $o, $rows, $ip);
        return [201, ['ids' => $ids]];
    }

    /** All-or-nothing insert of validated shifts. @return array{0:list<string>} */
    private function write(array $user, string $o, array $rows, string $ip): array
    {
        $pdo = $this->ctx->pdo;
        $m = Scope::membership($pdo, $user['id'], $o);
        Scope::require($m, Scope::MANAGERS);
        Scope::requireWritable($m);
        $ins = $pdo->prepare('INSERT INTO shifts (id, org_id, rota_id, location_id, department_id, staff_profile_id, shift_type_id, starts_at, ends_at, break_minutes, status, colour, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
        $ids = [];
        $pdo->beginTransaction();
        try {
            $this->lockRotas($o, array_map(static fn (array $r): ?string => Input::optStr($r, 'rota_id', 36), $rows));
            foreach ($rows as $r) {
                $f = $this->fields($r, $o, null);
                if (!isset($f['starts_at'], $f['ends_at'])) {
                    throw HttpError::invalid('starts_at and ends_at are required');
                }
                $id = Db::uuid();
                $ins->execute([$id, $o, $f['rota_id'] ?? null, $f['location_id'] ?? null, $f['department_id'] ?? null, $f['staff_profile_id'] ?? null, $f['shift_type_id'] ?? null, $f['starts_at'], $f['ends_at'], $f['break_minutes'] ?? 0, $f['status'] ?? 'open', $f['colour'] ?? null, $f['notes'] ?? null]);
                $ids[] = $id;
            }
            Audit::log($pdo, $o, $user['id'], 'shift.created', 'shifts', count($ids) === 1 ? $ids[0] : null, ['count' => count($ids)], 'info', 'org', $ip);
            $pdo->commit();
        } catch (\Throwable $e) {
            $pdo->rollBack();
            throw $e;
        }
        return [$ids];
    }

    private function update(array $user, array $in, string $ip, string $o, string $h): array
    {
        $pdo = $this->ctx->pdo;
        $m = Scope::membership($pdo, $user['id'], $o);
        Scope::require($m, Scope::MANAGERS);
        Scope::requireWritable($m);
        $pdo->beginTransaction();
        try {
            $q = $pdo->prepare('SELECT * FROM shifts WHERE id = ? AND org_id = ? FOR UPDATE');
            $q->execute([$h, $o]);
            $cur = $q->fetch() ?: throw HttpError::notFound();
            $f = $this->fields($in, $o, $cur);
            $this->lockRotas($o, [$cur['rota_id'], $f['rota_id'] ?? $cur['rota_id']]);
            if (isset($f['starts_at']) || isset($f['ends_at'])) {
                if (($f['ends_at'] ?? $cur['ends_at']) <= ($f['starts_at'] ?? $cur['starts_at'])) {
                    throw HttpError::invalid('ends_at must be after starts_at');
                }
            }
            if ($f !== []) {
                $set = implode(', ', array_map(static fn (string $k): string => "$k = ?", array_keys($f)));
                $pdo->prepare("UPDATE shifts SET $set WHERE id = ? AND org_id = ?")->execute([...array_values($f), $h, $o]);
            }
            Audit::log($pdo, $o, $user['id'], 'shift.updated', 'shifts', $h, ['fields' => array_keys($f)], 'info', 'org', $ip);
            $pdo->commit();
        } catch (\Throwable $e) {
            $pdo->rollBack();
            throw $e;
        }
        return [200, ['shift' => $this->one($o, $h)]];
    }

    private function delete(array $user, array $in, string $ip, string $o, string $h): array
    {
        $pdo = $this->ctx->pdo;
        $m = Scope::membership($pdo, $user['id'], $o);
        Scope::require($m, Scope::MANAGERS);
        Scope::requireWritable($m);
        $pdo->beginTransaction();
        try {
            $q = $pdo->prepare('SELECT rota_id FROM shifts WHERE id = ? AND org_id = ? FOR UPDATE');
            $q->execute([$h, $o]);
            $row = $q->fetch() ?: throw HttpError::notFound();
            $this->lockRotas($o, [$row['rota_id']]);
            $pdo->prepare('DELETE FROM shifts WHERE id = ? AND org_id = ?')->execute([$h, $o]);
            Audit::log($pdo, $o, $user['id'], 'shift.deleted', 'shifts', $h, [], 'info', 'org', $ip);
            $pdo->commit();
        } catch (\Throwable $e) {
            $pdo->rollBack();
            throw $e;
        }
        return [200, ['ok' => true]];
    }

    // ---- helpers ---------------------------------------------------------------------------------------

    /**
     * Takes the row lock of every rota the write touches, in id order (so two writes cannot deadlock), and refuses unless each is a draft:
     * a published rota answers `rota_published` and an archived one `rota_archived`, as the old triggers did.
     * @param list<?string> $rotaIds
     */
    private function lockRotas(string $o, array $rotaIds): void
    {
        $ids = array_values(array_unique(array_filter($rotaIds, static fn (?string $x): bool => $x !== null)));
        sort($ids);
        foreach ($ids as $id) {
            $q = $this->ctx->pdo->prepare('SELECT status FROM rotas WHERE id = ? AND org_id = ? FOR UPDATE');
            $q->execute([$id, $o]);
            $status = $q->fetchColumn();
            if ($status === false) {
                throw HttpError::invalid('That rota is not in this organisation');
            }
            if ($status === 'published') {
                throw HttpError::conflict('rota_published', 'This shift belongs to a published rota, which staff are already working to. Start an amendment and edit that.');
            }
            if ($status === 'archived') {
                throw HttpError::conflict('rota_archived', 'This shift belongs to an archived rota, which is history and is never edited. Edit the rota that superseded it.');
            }
        }
    }

    /**
     * The shift fields that were SENT, validated and ready to store. Every reference must belong to this organisation.
     * @param array<string,mixed>|null $current
     * @return array<string,mixed>
     */
    private function fields(array $in, string $o, ?array $current): array
    {
        $pdo = $this->ctx->pdo;
        $out = [];
        foreach (['rota_id' => 'rotas', 'location_id' => 'locations', 'department_id' => 'departments', 'staff_profile_id' => 'staff_profiles', 'shift_type_id' => 'shift_types'] as $k => $table) {
            if (array_key_exists($k, $in)) {
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
        }
        foreach (['starts_at', 'ends_at'] as $k) {
            if (array_key_exists($k, $in)) {
                $out[$k] = Time::parseInstant($in[$k], $k);
            }
        }
        if (isset($out['starts_at'], $out['ends_at']) && $out['ends_at'] <= $out['starts_at']) {
            throw HttpError::invalid('ends_at must be after starts_at');
        }
        if (array_key_exists('break_minutes', $in)) {
            $b = Input::optNum($in, 'break_minutes', 0, 1440);
            if ($b === null || $b !== floor($b)) {
                throw HttpError::invalid('break_minutes must be a whole number of minutes');
            }
            $out['break_minutes'] = (int) $b;
        }
        if (array_key_exists('status', $in)) {
            if (!in_array($in['status'], self::STATUSES, true)) {
                throw HttpError::invalid('status must be one of ' . implode(', ', self::STATUSES));
            }
            $out['status'] = $in['status'];
        }
        if (array_key_exists('colour', $in)) {
            $c = Input::optStr($in, 'colour', 20);
            if ($c !== null && preg_match('/^[#a-zA-Z0-9(),. %-]{1,20}$/', $c) !== 1) {
                throw HttpError::invalid('colour is not valid');
            }
            $out['colour'] = $c;
        }
        if (array_key_exists('notes', $in)) {
            $out['notes'] = Input::optStr($in, 'notes', 1000);
        }
        return $out;
    }

    /** @return array<string,mixed> */
    private function one(string $o, string $h): array
    {
        $q = $this->ctx->pdo->prepare('SELECT s.*, r.status AS rota_status, r.supersedes_rota_id FROM shifts s LEFT JOIN rotas r ON r.id = s.rota_id AND r.org_id = s.org_id WHERE s.id = ? AND s.org_id = ?');
        $q->execute([$h, $o]);
        return $this->present($q->fetch() ?: throw HttpError::notFound());
    }

    /** @param array<string,mixed> $r */
    private function present(array $r): array
    {
        $r['rota'] = $r['rota_id'] === null ? null : ['status' => $r['rota_status'], 'supersedes_rota_id' => $r['supersedes_rota_id']];
        unset($r['rota_status'], $r['supersedes_rota_id']);
        foreach (['starts_at', 'ends_at', 'created_at', 'updated_at'] as $k) {
            $r[$k] = Time::iso($r[$k]);
        }
        return $r;
    }
}
