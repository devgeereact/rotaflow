<?php
declare(strict_types=1);

namespace RotaFlow\Mod;

use RotaFlow\{Audit, Ctx, Db, HttpError, Input, Module, Scope};

/** The ingredients of a rota: shift types, people's availability, and each site's minimum cover. */
final class Planning implements Module
{
    private const AVAILABILITY = ['available', 'unavailable', 'preferred'];

    public function __construct(private readonly Ctx $ctx) {}

    public function routes(): array
    {
        return [
            ['GET', '/orgs/{o}/shift-types', $this->listTypes(...)],
            ['POST', '/orgs/{o}/shift-types', $this->saveType(...)],
            ['POST', '/orgs/{o}/shift-types/{y}', $this->saveType(...)],
            ['POST', '/orgs/{o}/shift-types/{y}/delete', $this->deleteType(...)],
            ['GET', '/orgs/{o}/availability', $this->listAvailability(...)],
            ['POST', '/orgs/{o}/availability', $this->addAvailability(...)],
            ['POST', '/orgs/{o}/availability/{a}/delete', $this->deleteAvailability(...)],
            ['GET', '/orgs/{o}/minimum-cover', $this->listCover(...)],
            ['POST', '/orgs/{o}/minimum-cover', $this->setCover(...)],
        ];
    }

    // ---- shift types -----------------------------------------------------------------------------------

    private function listTypes(array $user, array $in, string $ip, string $o): array
    {
        Scope::membership($this->ctx->pdo, $user['id'], $o);
        $q = $this->ctx->pdo->prepare('SELECT id, name, colour, default_start, default_end, is_paid, category FROM shift_types WHERE org_id = ? ORDER BY name');
        $q->execute([$o]);
        return [200, ['shift_types' => array_map(static fn (array $r): array => ['is_paid' => (bool) $r['is_paid']] + $r, $q->fetchAll())]];
    }

    private function saveType(array $user, array $in, string $ip, string $o, ?string $y = null): array
    {
        $pdo = $this->ctx->pdo;
        $this->manager($user, $o);
        $colour = Input::optStr($in, 'colour', 20) ?? '#2563eb';
        if (preg_match('/^[#a-zA-Z0-9(),. %-]{1,20}$/', $colour) !== 1) {
            throw HttpError::invalid('colour is not valid');
        }
        $vals = [Input::reqStr($in, 'name', 80), $colour, $this->time($in, 'default_start'), $this->time($in, 'default_end'), (array_key_exists('is_paid', $in) ? ($in['is_paid'] === true || $in['is_paid'] === 1) : true) ? 1 : 0, Input::optStr($in, 'category', 40)];
        if ($y === null) {
            $id = Db::uuid();
            $pdo->prepare('INSERT INTO shift_types (name, colour, default_start, default_end, is_paid, category, id, org_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')->execute([...$vals, $id, $o]);
            return [201, ['id' => $id]];
        }
        $this->mustExist('shift_types', $y, $o);
        $pdo->prepare('UPDATE shift_types SET name = ?, colour = ?, default_start = ?, default_end = ?, is_paid = ?, category = ? WHERE id = ? AND org_id = ?')->execute([...$vals, $y, $o]);
        return [200, ['id' => $y]];
    }

    /** Refused while any shift uses it: removing it would silently strip the type from published history. */
    private function deleteType(array $user, array $in, string $ip, string $o, string $y): array
    {
        $pdo = $this->ctx->pdo;
        $this->manager($user, $o);
        $this->mustExist('shift_types', $y, $o);
        $used = $pdo->prepare('SELECT 1 FROM shifts WHERE org_id = ? AND shift_type_id = ? LIMIT 1');
        $used->execute([$o, $y]);
        if ($used->fetchColumn() !== false) {
            throw HttpError::conflict('shift_type_in_use', 'Shifts still use this shift type');
        }
        $pdo->prepare('DELETE FROM shift_types WHERE id = ? AND org_id = ?')->execute([$y, $o]);
        Audit::log($pdo, $o, $user['id'], 'shift_type.deleted', 'shift_types', $y, [], 'info', 'org', $ip);
        return [200, ['ok' => true]];
    }

    // ---- availability ----------------------------------------------------------------------------------

    /** Managers read everyone's (optionally for one person); a member reads only their own. */
    private function listAvailability(array $user, array $in, string $ip, string $o): array
    {
        $m = Scope::membership($this->ctx->pdo, $user['id'], $o);
        $sql = 'SELECT id, staff_profile_id, weekday, date, start_time, end_time, status, recurring FROM availability WHERE org_id = ?';
        $args = [$o];
        if (in_array($m['effective_role'], Scope::MANAGERS, true)) {
            if (($sp = Input::optStr($in, 'staff_profile_id', 36)) !== null) {
                $sql .= ' AND staff_profile_id = ?';
                $args[] = $sp;
            }
        } else {
            $own = Scope::staffProfileId($this->ctx->pdo, $o, $user['id']);
            $sql .= ' AND staff_profile_id = ?';
            $args[] = $own ?? '';
        }
        $q = $this->ctx->pdo->prepare($sql . ' ORDER BY COALESCE(date, "9999-12-31"), weekday, start_time LIMIT 2000');
        $q->execute($args);
        return [200, ['availability' => array_map(static fn (array $r): array => ['recurring' => (bool) $r['recurring']] + $r, $q->fetchAll())]];
    }

    private function addAvailability(array $user, array $in, string $ip, string $o): array
    {
        $pdo = $this->ctx->pdo;
        $m = Scope::membership($pdo, $user['id'], $o);
        Scope::requireWritable($m);
        $own = Scope::staffProfileId($pdo, $o, $user['id']);
        $sp = Input::optStr($in, 'staff_profile_id', 36) ?? $own;
        if ($sp === null) {
            throw HttpError::invalid('staff_profile_id is required');
        }
        if ($sp !== $own && !in_array($m['effective_role'], Scope::MANAGERS, true)) {
            throw HttpError::forbidden();
        }
        $this->mustExist('staff_profiles', $sp, $o, HttpError::invalid('That staff member is not in this organisation'));
        $weekday = Input::optNum($in, 'weekday', 0, 6);
        $date = Input::optDate($in, 'date');
        if (($weekday === null) === ($date === null)) {
            throw HttpError::invalid('Give either a weekday (0 = Sunday to 6) or a date');
        }
        $start = $this->time($in, 'start_time');
        $end = $this->time($in, 'end_time');
        if (($start === null) !== ($end === null)) {
            throw HttpError::invalid('start_time and end_time go together');
        }
        $status = Input::optStr($in, 'status', 20) ?? 'available';
        if (!in_array($status, self::AVAILABILITY, true)) {
            throw HttpError::invalid('status must be one of ' . implode(', ', self::AVAILABILITY));
        }
        $id = Db::uuid();
        $pdo->prepare('INSERT INTO availability (id, org_id, staff_profile_id, weekday, date, start_time, end_time, status, recurring) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
            ->execute([$id, $o, $sp, $weekday === null ? null : (int) $weekday, $date, $start, $end, $status, ($in['recurring'] ?? false) === true ? 1 : 0]);
        return [201, ['id' => $id]];
    }

    private function deleteAvailability(array $user, array $in, string $ip, string $o, string $a): array
    {
        $pdo = $this->ctx->pdo;
        $m = Scope::membership($pdo, $user['id'], $o);
        Scope::requireWritable($m);
        $q = $pdo->prepare('SELECT staff_profile_id FROM availability WHERE id = ? AND org_id = ?');
        $q->execute([$a, $o]);
        $sp = $q->fetchColumn();
        if ($sp === false) {
            throw HttpError::notFound();
        }
        if (!in_array($m['effective_role'], Scope::MANAGERS, true) && $sp !== Scope::staffProfileId($pdo, $o, $user['id'])) {
            throw HttpError::forbidden();
        }
        $pdo->prepare('DELETE FROM availability WHERE id = ? AND org_id = ?')->execute([$a, $o]);
        return [200, ['ok' => true]];
    }

    // ---- minimum cover ---------------------------------------------------------------------------------

    private function listCover(array $user, array $in, string $ip, string $o): array
    {
        Scope::membership($this->ctx->pdo, $user['id'], $o);
        $q = $this->ctx->pdo->prepare('SELECT id, location_id, weekday, min_staff FROM minimum_cover_rules WHERE org_id = ? ORDER BY location_id, weekday');
        $q->execute([$o]);
        return [200, ['rules' => $q->fetchAll()]];
    }

    /** Sets one site's minimum for one weekday (0 = Sunday). Zero means no minimum. */
    private function setCover(array $user, array $in, string $ip, string $o): array
    {
        $pdo = $this->ctx->pdo;
        $this->manager($user, $o);
        $loc = Input::reqStr($in, 'location_id', 36);
        $this->mustExist('locations', $loc, $o, HttpError::invalid('That location is not in this organisation'));
        $weekday = Input::optNum($in, 'weekday', 0, 6);
        $min = Input::optNum($in, 'min_staff', 0, 500);
        if ($weekday === null || $min === null || $weekday !== floor($weekday) || $min !== floor($min)) {
            throw HttpError::invalid('weekday (0 to 6) and min_staff (a whole number) are required');
        }
        $pdo->prepare('INSERT INTO minimum_cover_rules (id, org_id, location_id, weekday, min_staff) VALUES (?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE min_staff = VALUES(min_staff)')
            ->execute([Db::uuid(), $o, $loc, (int) $weekday, (int) $min]);
        Audit::log($pdo, $o, $user['id'], 'minimum_cover.set', 'locations', $loc, ['weekday' => (int) $weekday, 'min_staff' => (int) $min], 'info', 'org', $ip);
        return [200, ['ok' => true]];
    }

    // ---- helpers ---------------------------------------------------------------------------------------

    private function manager(array $user, string $o): void
    {
        $m = Scope::membership($this->ctx->pdo, $user['id'], $o);
        Scope::require($m, Scope::MANAGERS);
        Scope::requireWritable($m);
        \RotaFlow\Billing::requireNotReadOnly($this->ctx->pdo, $o);
    }

    /** HH:MM or HH:MM:SS, or null. */
    private function time(array $in, string $key): ?string
    {
        $v = Input::optStr($in, $key, 8);
        if ($v === null) {
            return null;
        }
        if (preg_match('/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/', $v) !== 1) {
            throw HttpError::invalid("$key must be a time such as 09:00");
        }
        return strlen($v) === 5 ? $v . ':00' : $v;
    }

    private function mustExist(string $table, string $id, string $org, ?HttpError $else = null): void
    {
        $q = $this->ctx->pdo->prepare("SELECT 1 FROM $table WHERE id = ? AND org_id = ?"); // $table is a literal from this class
        $q->execute([$id, $org]);
        if ($q->fetchColumn() === false) {
            throw $else ?? HttpError::notFound();
        }
    }
}
