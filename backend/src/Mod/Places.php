<?php
declare(strict_types=1);

namespace RotaFlow\Mod;

use RotaFlow\{Audit, Ctx, Db, HttpError, Input, Module, Scope};

/** Locations (sites with a geofence and a time zone) and the departments inside them. Any member reads; owner and manager write. */
final class Places implements Module
{
    private const TYPES = ['Residential', 'Dementia care', 'Domiciliary', 'Head office'];
    private const STATUSES = ['setup', 'active', 'maintenance', 'inactive'];

    public function __construct(private readonly Ctx $ctx) {}

    public function routes(): array
    {
        return [
            ['GET', '/orgs/{o}/locations', $this->listLocations(...)],
            ['POST', '/orgs/{o}/locations', $this->saveLocation(...)],
            ['POST', '/orgs/{o}/locations/{l}', $this->saveLocation(...)],
            ['POST', '/orgs/{o}/locations/{l}/delete', $this->deleteLocation(...)],
            ['GET', '/orgs/{o}/departments', $this->listDepartments(...)],
            ['POST', '/orgs/{o}/departments', $this->saveDepartment(...)],
            ['POST', '/orgs/{o}/departments/{d}', $this->saveDepartment(...)],
            ['POST', '/orgs/{o}/departments/{d}/delete', $this->deleteDepartment(...)],
        ];
    }

    private function listLocations(array $user, array $in, string $ip, string $o): array
    {
        Scope::membership($this->ctx->pdo, $user['id'], $o);
        $q = $this->ctx->pdo->prepare('SELECT id, name, address, latitude, longitude, timezone, geofence_radius_m, location_type, status, created_at FROM locations WHERE org_id = ? ORDER BY name');
        $q->execute([$o]);
        return [200, ['locations' => $q->fetchAll()]];
    }

    private function saveLocation(array $user, array $in, string $ip, string $o, ?string $l = null): array
    {
        $pdo = $this->ctx->pdo;
        $m = Scope::membership($pdo, $user['id'], $o);
        Scope::require($m, Scope::MANAGERS);
        Scope::requireWritable($m);
        $tz = Input::optStr($in, 'timezone', 64) ?? 'Europe/London';
        if (!in_array($tz, \DateTimeZone::listIdentifiers(), true)) {
            throw HttpError::invalid('timezone must be an IANA time zone, for example Europe/London');
        }
        $type = Input::optStr($in, 'location_type', 40);
        if ($type !== null && !in_array($type, self::TYPES, true)) {
            throw HttpError::invalid('location_type is not recognised');
        }
        $status = Input::optStr($in, 'status', 20) ?? 'setup';
        if (!in_array($status, self::STATUSES, true)) {
            throw HttpError::invalid('status is not recognised');
        }
        $lat = Input::optNum($in, 'latitude', -90, 90);
        $lng = Input::optNum($in, 'longitude', -180, 180);
        if (($lat === null) !== ($lng === null)) {
            throw HttpError::invalid('latitude and longitude go together');
        }
        $radius = (int) (Input::optNum($in, 'geofence_radius_m', 10, 10000) ?? 150); // ASSUMPTION: the old schema had no bounds; these stop a typo disabling the fence
        $vals = [Input::reqStr($in, 'name', 120), Input::optStr($in, 'address', 300), $lat, $lng, $tz, $radius, $type, $status];
        if ($l === null) {
            $id = Db::uuid();
            $pdo->prepare('INSERT INTO locations (name, address, latitude, longitude, timezone, geofence_radius_m, location_type, status, id, org_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
                ->execute([...$vals, $id, $o]);
            Audit::log($pdo, $o, $user['id'], 'location.created', 'locations', $id, [], 'info', 'org', $ip);
            return [201, ['id' => $id]];
        }
        $u = $pdo->prepare('UPDATE locations SET name = ?, address = ?, latitude = ?, longitude = ?, timezone = ?, geofence_radius_m = ?, location_type = ?, status = ? WHERE id = ? AND org_id = ?');
        $u->execute([...$vals, $l, $o]);
        $this->mustExist('locations', $l, $o);
        Audit::log($pdo, $o, $user['id'], 'location.updated', 'locations', $l, [], 'info', 'org', $ip);
        return [200, ['id' => $l]];
    }

    private function deleteLocation(array $user, array $in, string $ip, string $o, string $l): array
    {
        $pdo = $this->ctx->pdo;
        $m = Scope::membership($pdo, $user['id'], $o);
        Scope::require($m, Scope::MANAGERS);
        Scope::requireWritable($m);
        $this->mustExist('locations', $l, $o);
        // A rota or shift at this site is history that must stay readable; archive the site instead (status: inactive).
        $used = $pdo->prepare('SELECT 1 FROM rotas WHERE org_id = ? AND location_id = ? UNION SELECT 1 FROM shifts WHERE org_id = ? AND location_id = ? LIMIT 1');
        $used->execute([$o, $l, $o, $l]);
        if ($used->fetchColumn() !== false) {
            throw HttpError::conflict('location_in_use', 'Rotas or shifts still use this location. Mark it inactive instead of deleting it');
        }
        $pdo->beginTransaction();
        try {
            // The composite key cannot SET NULL one column, so what pointed here is cleared first (departments become unplaced).
            $pdo->prepare('UPDATE departments SET location_id = NULL WHERE org_id = ? AND location_id = ?')->execute([$o, $l]);
            $pdo->prepare('DELETE FROM locations WHERE id = ? AND org_id = ?')->execute([$l, $o]);
            Audit::log($pdo, $o, $user['id'], 'location.deleted', 'locations', $l, [], 'warning', 'org', $ip);
            $pdo->commit();
        } catch (\Throwable $e) {
            $pdo->rollBack();
            throw $e;
        }
        return [200, ['ok' => true]];
    }

    private function listDepartments(array $user, array $in, string $ip, string $o): array
    {
        Scope::membership($this->ctx->pdo, $user['id'], $o);
        $q = $this->ctx->pdo->prepare('SELECT id, location_id, name, created_at FROM departments WHERE org_id = ? ORDER BY name');
        $q->execute([$o]);
        return [200, ['departments' => $q->fetchAll()]];
    }

    private function saveDepartment(array $user, array $in, string $ip, string $o, ?string $d = null): array
    {
        $pdo = $this->ctx->pdo;
        $m = Scope::membership($pdo, $user['id'], $o);
        Scope::require($m, Scope::MANAGERS);
        Scope::requireWritable($m);
        $loc = Input::optStr($in, 'location_id', 36);
        if ($loc !== null) {
            $this->mustExist('locations', $loc, $o, HttpError::invalid('That location is not in this organisation'));
        }
        $name = Input::reqStr($in, 'name', 120);
        if ($d === null) {
            $id = Db::uuid();
            $pdo->prepare('INSERT INTO departments (id, org_id, location_id, name) VALUES (?, ?, ?, ?)')->execute([$id, $o, $loc, $name]);
            Audit::log($pdo, $o, $user['id'], 'department.created', 'departments', $id, [], 'info', 'org', $ip);
            return [201, ['id' => $id]];
        }
        $this->mustExist('departments', $d, $o);
        $pdo->prepare('UPDATE departments SET location_id = ?, name = ? WHERE id = ? AND org_id = ?')->execute([$loc, $name, $d, $o]);
        Audit::log($pdo, $o, $user['id'], 'department.updated', 'departments', $d, [], 'info', 'org', $ip);
        return [200, ['id' => $d]];
    }

    private function deleteDepartment(array $user, array $in, string $ip, string $o, string $d): array
    {
        $pdo = $this->ctx->pdo;
        $m = Scope::membership($pdo, $user['id'], $o);
        Scope::require($m, Scope::MANAGERS);
        Scope::requireWritable($m);
        $this->mustExist('departments', $d, $o);
        $used = $pdo->prepare('SELECT 1 FROM shifts WHERE org_id = ? AND department_id = ? LIMIT 1');
        $used->execute([$o, $d]);
        if ($used->fetchColumn() !== false) {
            throw HttpError::conflict('department_in_use', 'Shifts still use this department');
        }
        $pdo->beginTransaction();
        try {
            $pdo->prepare('UPDATE staff_profiles SET department_id = NULL WHERE org_id = ? AND department_id = ?')->execute([$o, $d]);
            $pdo->prepare('DELETE FROM departments WHERE id = ? AND org_id = ?')->execute([$d, $o]);
            Audit::log($pdo, $o, $user['id'], 'department.deleted', 'departments', $d, [], 'warning', 'org', $ip);
            $pdo->commit();
        } catch (\Throwable $e) {
            $pdo->rollBack();
            throw $e;
        }
        return [200, ['ok' => true]];
    }

    /** 404 (or the given error) unless the row exists in THIS organisation. */
    private function mustExist(string $table, string $id, string $org, ?HttpError $else = null): void
    {
        $q = $this->ctx->pdo->prepare("SELECT 1 FROM $table WHERE id = ? AND org_id = ?"); // $table is a literal from this class, never input
        $q->execute([$id, $org]);
        if ($q->fetchColumn() === false) {
            throw $else ?? HttpError::notFound();
        }
    }
}
