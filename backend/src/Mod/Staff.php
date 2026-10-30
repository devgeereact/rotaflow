<?php
declare(strict_types=1);

namespace RotaFlow\Mod;

use RotaFlow\{Audit, Ctx, Db, HttpError, Input, Module, Scope};

/**
 * Staff records, the job-title catalogue, site assignment, pay rates and emergency contacts.
 *
 * Column rule (replaces the column grants and the staff_profiles_visible view): every member reads names, titles, departments,
 * hours, skills and photo; payroll id, start date, phone, email and holiday allowance are returned only to an owner or manager
 * (including a delegate) and to the person themselves. A person edits only their own phone and photo.
 */
final class Staff implements Module
{
    private const PALETTE = ['indigo', 'sky', 'teal', 'moss', 'olive', 'amber', 'clay', 'rose', 'magenta', 'violet', 'slate', 'cocoa'];
    private const SENSITIVE = ['payroll_id', 'start_date', 'phone', 'email', 'holiday_allowance'];
    private const SELF_EDITABLE = ['phone', 'photo_url'];
    private const FIELDS = ['first_name', 'last_name', 'email', 'job_title', 'job_title_id', 'department_id', 'contract_type', 'weekly_hours', 'holiday_allowance', 'skills', 'payroll_id', 'start_date', 'phone', 'photo_url', 'active'];

    public function __construct(private readonly Ctx $ctx) {}

    public function routes(): array
    {
        return [
            ['GET', '/orgs/{o}/job-titles', $this->listTitles(...)],
            ['POST', '/orgs/{o}/job-titles', $this->saveTitle(...)],
            ['POST', '/orgs/{o}/job-titles/{t}', $this->saveTitle(...)],
            ['POST', '/orgs/{o}/job-titles/{t}/delete', $this->deleteTitle(...)],
            ['GET', '/orgs/{o}/staff', $this->listStaff(...)],
            ['POST', '/orgs/{o}/staff', $this->createStaff(...)],
            ['GET', '/orgs/{o}/staff/{s}', $this->getStaff(...)],
            ['POST', '/orgs/{o}/staff/{s}', $this->updateStaff(...)],
            ['POST', '/orgs/{o}/staff/{s}/locations', $this->setLocations(...)],
            ['GET', '/orgs/{o}/staff/{s}/pay-rates', $this->listRates(...)],
            ['POST', '/orgs/{o}/staff/{s}/pay-rates', $this->addRate(...)],
            ['GET', '/orgs/{o}/staff/{s}/emergency-contacts', $this->listContacts(...)],
            ['POST', '/orgs/{o}/staff/{s}/emergency-contacts', $this->saveContact(...)],
            ['POST', '/orgs/{o}/staff/{s}/emergency-contacts/{c}', $this->saveContact(...)],
            ['POST', '/orgs/{o}/staff/{s}/emergency-contacts/{c}/delete', $this->deleteContact(...)],
        ];
    }

    // ---- hooks used by Orgs and Invites ---------------------------------------------------------------

    /** The founder (or first owner) gets a staff record, as handle_new_org did. Idempotent. */
    public static function ensureForOwner(\PDO $pdo, string $orgId, string $userId, string $email): void
    {
        if (Scope::staffProfileId($pdo, $orgId, $userId) !== null) {
            return;
        }
        $name = $pdo->prepare('SELECT full_name FROM users WHERE id = ?');
        $name->execute([$userId]);
        $full = trim((string) $name->fetchColumn());
        if ($full !== '') {
            $first = explode(' ', $full, 2)[0];
            $last = trim(substr($full, strlen($first)));
        } else {
            $first = explode('@', $email)[0];
            $last = '';
        }
        // A record created earlier by email (an owner added by a manager first) is linked rather than duplicated.
        $link = $pdo->prepare('UPDATE staff_profiles SET user_id = ? WHERE org_id = ? AND user_id IS NULL AND LOWER(email) = ? LIMIT 1');
        $link->execute([$userId, $orgId, strtolower($email)]);
        if ($link->rowCount() === 1) {
            return;
        }
        $pdo->prepare('INSERT INTO staff_profiles (id, org_id, user_id, first_name, last_name, email, active) VALUES (?, ?, ?, ?, ?, ?, 1)')
            ->execute([Db::uuid(), $orgId, $userId, mb_substr($first, 0, 100), mb_substr($last, 0, 100), strtolower($email)]);
    }

    /** accept_invite: link an HR record created earlier by email, then apply the place the person was invited to. */
    public static function linkOnAccept(\PDO $pdo, string $orgId, string $userId, string $email, ?string $deptId, ?string $locId): void
    {
        $pdo->prepare('UPDATE staff_profiles SET user_id = ? WHERE org_id = ? AND user_id IS NULL AND LOWER(email) = ? LIMIT 1')->execute([$userId, $orgId, strtolower($email)]);
        $sid = Scope::staffProfileId($pdo, $orgId, $userId);
        if ($sid === null) {
            return;
        }
        if ($deptId !== null) {
            $pdo->prepare('UPDATE staff_profiles SET department_id = ? WHERE id = ? AND department_id IS NULL AND EXISTS (SELECT 1 FROM departments d WHERE d.id = ? AND d.org_id = ?)')->execute([$deptId, $sid, $deptId, $orgId]);
        }
        if ($locId !== null) {
            $pdo->prepare('INSERT IGNORE INTO staff_locations (staff_profile_id, location_id, org_id) SELECT ?, id, org_id FROM locations WHERE id = ? AND org_id = ?')->execute([$sid, $locId, $orgId]);
        }
    }

    // ---- job titles ------------------------------------------------------------------------------------

    private function listTitles(array $user, array $in, string $ip, string $o): array
    {
        Scope::membership($this->ctx->pdo, $user['id'], $o);
        $q = $this->ctx->pdo->prepare('SELECT id, name, colour, active FROM job_titles WHERE org_id = ? ORDER BY active DESC, name');
        $q->execute([$o]);
        return [200, ['job_titles' => array_map(static fn (array $r): array => ['active' => (bool) $r['active']] + $r, $q->fetchAll())]];
    }

    /** Owner always; a manager only where the organisation chose it (settings.job_titles_managed_by = 'managers'). */
    private function titleManager(array $m, string $o): void
    {
        if ($m['effective_role'] === 'owner') {
            return;
        }
        if ($m['effective_role'] === 'manager') {
            $q = $this->ctx->pdo->prepare("SELECT JSON_UNQUOTE(JSON_EXTRACT(settings, '$.job_titles_managed_by')) FROM organisations WHERE id = ?");
            $q->execute([$o]);
            if ($q->fetchColumn() === 'managers') {
                return;
            }
        }
        throw HttpError::forbidden();
    }

    private function saveTitle(array $user, array $in, string $ip, string $o, ?string $t = null): array
    {
        $pdo = $this->ctx->pdo;
        $m = Scope::membership($pdo, $user['id'], $o);
        $this->titleManager($m, $o);
        Scope::requireWritable($m);
        $name = Input::reqStr($in, 'name', 80);
        $colour = Input::optStr($in, 'colour', 16);
        if ($colour !== null && !in_array($colour, self::PALETTE, true)) {
            throw HttpError::invalid('colour is not one of the palette');
        }
        $active = array_key_exists('active', $in) ? ($in['active'] === true || $in['active'] === 1) : true;
        try {
            if ($t === null) {
                $id = Db::uuid();
                $pdo->prepare('INSERT INTO job_titles (id, org_id, name, colour, active) VALUES (?, ?, ?, ?, ?)')->execute([$id, $o, $name, $colour, (int) $active]);
                Audit::log($pdo, $o, $user['id'], 'job_title.created', 'job_titles', $id, [], 'info', 'org', $ip);
                return [201, ['id' => $id]];
            }
            $pdo->beginTransaction();
            $this->exists('job_titles', $t, $o);
            $pdo->prepare('UPDATE job_titles SET name = ?, colour = ?, active = ? WHERE id = ? AND org_id = ?')->execute([$name, $colour, (int) $active, $t, $o]);
            $pdo->prepare('UPDATE staff_profiles SET job_title = ? WHERE org_id = ? AND job_title_id = ?')->execute([$name, $o, $t]); // the free-text copy stays in step
            Audit::log($pdo, $o, $user['id'], 'job_title.updated', 'job_titles', $t, [], 'info', 'org', $ip);
            $pdo->commit();
            return [200, ['id' => $t]];
        } catch (\PDOException $e) {
            if ($pdo->inTransaction()) {
                $pdo->rollBack();
            }
            if ($e->getCode() === '23000') {
                $why = str_contains($e->getMessage(), 'job_titles_colour') ? ['colour_in_use', 'Another active job title already uses that colour'] : ['title_exists', 'A job title with that name already exists'];
                throw HttpError::conflict($why[0], $why[1]);
            }
            throw $e;
        } catch (\Throwable $e) {
            if ($pdo->inTransaction()) {
                $pdo->rollBack();
            }
            throw $e;
        }
    }

    private function deleteTitle(array $user, array $in, string $ip, string $o, string $t): array
    {
        $pdo = $this->ctx->pdo;
        $m = Scope::membership($pdo, $user['id'], $o);
        $this->titleManager($m, $o);
        Scope::requireWritable($m);
        $this->exists('job_titles', $t, $o);
        $pdo->beginTransaction();
        try {
            $pdo->prepare('UPDATE staff_profiles SET job_title_id = NULL WHERE org_id = ? AND job_title_id = ?')->execute([$o, $t]);
            $pdo->prepare('DELETE FROM job_titles WHERE id = ? AND org_id = ?')->execute([$t, $o]);
            Audit::log($pdo, $o, $user['id'], 'job_title.deleted', 'job_titles', $t, [], 'info', 'org', $ip);
            $pdo->commit();
        } catch (\Throwable $e) {
            $pdo->rollBack();
            throw $e;
        }
        return [200, ['ok' => true]];
    }

    // ---- staff records ---------------------------------------------------------------------------------

    private function listStaff(array $user, array $in, string $ip, string $o): array
    {
        $m = Scope::membership($this->ctx->pdo, $user['id'], $o);
        $where = 'org_id = ?';
        if (($in['active'] ?? null) === '1' || ($in['active'] ?? null) === 1) {
            $where .= ' AND active = 1';
        }
        $q = $this->ctx->pdo->prepare("SELECT * FROM staff_profiles WHERE $where ORDER BY first_name, last_name LIMIT 2000");
        $q->execute([$o]);
        $rows = $q->fetchAll();
        $sites = $this->sitesFor($o);
        return [200, ['staff' => array_map(fn (array $r): array => $this->present($r, $m, $sites[$r['id']] ?? []), $rows)]];
    }

    private function getStaff(array $user, array $in, string $ip, string $o, string $s): array
    {
        $m = Scope::membership($this->ctx->pdo, $user['id'], $o);
        $r = $this->row($o, $s);
        return [200, ['staff' => $this->present($r, $m, $this->sitesFor($o, $s)[$s] ?? [])]];
    }

    private function createStaff(array $user, array $in, string $ip, string $o): array
    {
        $pdo = $this->ctx->pdo;
        $m = Scope::membership($pdo, $user['id'], $o);
        Scope::require($m, Scope::MANAGERS);
        Scope::requireWritable($m);
        // Plan seat limits are enforced in S7 (billing); until then there is none.
        $f = $this->fields($in, $o, null);
        $f['first_name'] ??= Input::reqStr($in, 'first_name', 100);
        $id = Db::uuid();
        $cols = array_merge(['id' => $id, 'org_id' => $o, 'last_name' => '', 'active' => 1, 'skills' => '[]'], $f);
        $pdo->beginTransaction();
        try {
            if (($cols['email'] ?? null) !== null) {
                $cols['user_id'] = $this->linkableUser($o, $cols['email']);
            }
            $names = array_keys($cols);
            $pdo->prepare('INSERT INTO staff_profiles (' . implode(', ', $names) . ') VALUES (' . implode(', ', array_fill(0, count($names), '?')) . ')')->execute(array_values($cols));
            Audit::log($pdo, $o, $user['id'], 'staff.created', 'staff_profiles', $id, [], 'info', 'org', $ip);
            $pdo->commit();
        } catch (\PDOException $e) {
            $pdo->rollBack();
            throw $this->duplicate($e);
        } catch (\Throwable $e) {
            $pdo->rollBack();
            throw $e;
        }
        return [201, ['id' => $id]];
    }

    private function updateStaff(array $user, array $in, string $ip, string $o, string $s): array
    {
        $pdo = $this->ctx->pdo;
        $m = Scope::membership($pdo, $user['id'], $o);
        Scope::requireWritable($m);
        $cur = $this->row($o, $s);
        $manager = in_array($m['effective_role'], Scope::MANAGERS, true);
        $self = $cur['user_id'] === $user['id'];
        if (!$manager && !$self) {
            throw HttpError::forbidden();
        }
        $f = $this->fields($in, $o, $cur);
        if (!$manager) {
            foreach ($f as $k => $v) {
                if (!in_array($k, self::SELF_EDITABLE, true) && !$this->same($k, $cur[$k] ?? null, $v)) {
                    throw new HttpError(403, 'self_edit_restricted', 'You can only update your phone number and photo on your own profile');
                }
            }
            $f = array_intersect_key($f, array_flip(self::SELF_EDITABLE));
        }
        if (array_key_exists('payroll_id', $f) && $cur['payroll_id'] !== null && $f['payroll_id'] !== $cur['payroll_id']) {
            throw HttpError::conflict('payroll_id_locked', 'The payroll id cannot be changed once it is set');
        }
        if ($f === []) {
            return [200, ['id' => $s]];
        }
        try {
            $set = implode(', ', array_map(static fn (string $k): string => "$k = ?", array_keys($f)));
            $pdo->prepare("UPDATE staff_profiles SET $set WHERE id = ? AND org_id = ?")->execute([...array_values($f), $s, $o]);
        } catch (\PDOException $e) {
            throw $this->duplicate($e);
        }
        Audit::log($pdo, $o, $user['id'], 'staff.updated', 'staff_profiles', $s, ['fields' => array_keys($f)], 'info', 'org', $ip);
        return [200, ['id' => $s]];
    }

    /**
     * Validates the staff fields that were SENT and returns them ready to store (column => value). A job_title_id keeps the free-text
     * job_title in step. Same-organisation checks stand in for the old triggers; the composite keys back them up.
     * @param array<string,mixed>|null $current
     * @return array<string,mixed>
     */
    private function fields(array $in, string $o, ?array $current): array
    {
        $pdo = $this->ctx->pdo;
        $out = [];
        $has = static fn (string $k): bool => array_key_exists($k, $in);
        if ($has('first_name')) { $out['first_name'] = Input::reqStr($in, 'first_name', 100); }
        if ($has('last_name')) { $out['last_name'] = trim(Input::str($in, 'last_name')) ; if (mb_strlen($out['last_name']) > 100) { throw HttpError::invalid('last_name is too long'); } }
        if ($has('email')) {
            $e = Input::optStr($in, 'email', 255);
            if ($e !== null && filter_var($e, FILTER_VALIDATE_EMAIL) === false) { throw HttpError::invalid('email is not valid'); }
            $out['email'] = $e === null ? null : strtolower($e);
        }
        if ($has('job_title_id')) {
            $jt = Input::optStr($in, 'job_title_id', 36);
            if ($jt !== null) {
                $q = $pdo->prepare('SELECT name FROM job_titles WHERE id = ? AND org_id = ?');
                $q->execute([$jt, $o]);
                $name = $q->fetchColumn();
                if ($name === false) { throw HttpError::invalid('That job title is not in this organisation'); }
                $out['job_title'] = (string) $name;
            }
            $out['job_title_id'] = $jt;
        } elseif ($has('job_title')) {
            $out['job_title'] = Input::optStr($in, 'job_title', 80);
        }
        if ($has('department_id')) {
            $d = Input::optStr($in, 'department_id', 36);
            if ($d !== null) {
                $q = $pdo->prepare('SELECT 1 FROM departments WHERE id = ? AND org_id = ?');
                $q->execute([$d, $o]);
                if ($q->fetchColumn() === false) { throw HttpError::invalid('That department is not in this organisation'); }
            }
            $out['department_id'] = $d;
        }
        if ($has('contract_type')) {
            $c = Input::optStr($in, 'contract_type', 40);
            if ($c !== null && preg_match('/^[a-z][a-z_]{0,39}$/', $c) !== 1) { throw HttpError::invalid('contract_type is not valid'); }
            $out['contract_type'] = $c;
        }
        if ($has('weekly_hours')) { $out['weekly_hours'] = Input::optNum($in, 'weekly_hours', 0, 168); }
        if ($has('holiday_allowance')) { $out['holiday_allowance'] = Input::optNum($in, 'holiday_allowance', 0, 400); }
        if ($has('skills')) {
            $sk = $in['skills'];
            if (!is_array($sk) || !array_is_list($sk) || count($sk) > 30) { throw HttpError::invalid('skills must be a list of up to 30 items'); }
            foreach ($sk as $x) { if (!is_string($x) || trim($x) === '' || mb_strlen($x) > 40) { throw HttpError::invalid('each skill must be text of at most 40 characters'); } }
            $out['skills'] = json_encode(array_values(array_unique(array_map('trim', $sk))), JSON_UNESCAPED_UNICODE);
        }
        if ($has('payroll_id')) { $out['payroll_id'] = Input::optStr($in, 'payroll_id', 60); }
        if ($has('start_date')) { $out['start_date'] = Input::optDate($in, 'start_date'); }
        if ($has('phone')) {
            $p = Input::optStr($in, 'phone', 40);
            if ($p !== null && preg_match('/^[0-9+()\\-. ]{5,40}$/', $p) !== 1) { throw HttpError::invalid('phone is not valid'); }
            $out['phone'] = $p;
        }
        if ($has('photo_url')) {
            $u = Input::optStr($in, 'photo_url', 500);
            if ($u !== null && preg_match('#^https://#', $u) !== 1) { throw HttpError::invalid('photo_url must be an https address'); }
            $out['photo_url'] = $u;
        }
        if ($has('active')) { $out['active'] = ($in['active'] === true || $in['active'] === 1) ? 1 : 0; }
        return $out;
    }

    /** A member of this organisation, with the same email and no staff record yet: the login this HR record belongs to. */
    private function linkableUser(string $o, string $email): ?string
    {
        $q = $this->ctx->pdo->prepare(
            "SELECT u.id FROM users u JOIN memberships m ON m.user_id = u.id AND m.org_id = ? AND m.status = 'active'
              WHERE u.email = ? AND NOT EXISTS (SELECT 1 FROM staff_profiles sp WHERE sp.org_id = ? AND sp.user_id = u.id)"
        );
        $q->execute([$o, $email, $o]);
        $r = $q->fetchColumn();
        return $r === false ? null : (string) $r;
    }

    private function setLocations(array $user, array $in, string $ip, string $o, string $s): array
    {
        $pdo = $this->ctx->pdo;
        $m = Scope::membership($pdo, $user['id'], $o);
        Scope::require($m, Scope::MANAGERS);
        Scope::requireWritable($m);
        $this->row($o, $s);
        $ids = $in['location_ids'] ?? null;
        if (!is_array($ids) || !array_is_list($ids) || count($ids) > 100) { throw HttpError::invalid('location_ids must be a list'); }
        foreach ($ids as $id) { if (!is_string($id)) { throw HttpError::invalid('location_ids must be ids'); } }
        $ids = array_values(array_unique($ids));
        $pdo->beginTransaction();
        try {
            $ok = $pdo->prepare('SELECT 1 FROM locations WHERE id = ? AND org_id = ?');
            foreach ($ids as $id) {
                $ok->execute([$id, $o]);
                if ($ok->fetchColumn() === false) { throw HttpError::invalid('A location is not in this organisation'); }
            }
            $pdo->prepare('DELETE FROM staff_locations WHERE org_id = ? AND staff_profile_id = ?')->execute([$o, $s]);
            $ins = $pdo->prepare('INSERT INTO staff_locations (staff_profile_id, location_id, org_id) VALUES (?, ?, ?)');
            foreach ($ids as $id) { $ins->execute([$s, $id, $o]); }
            Audit::log($pdo, $o, $user['id'], 'staff.sites_set', 'staff_profiles', $s, ['count' => count($ids)], 'info', 'org', $ip);
            $pdo->commit();
        } catch (\Throwable $e) {
            $pdo->rollBack();
            throw $e;
        }
        return [200, ['location_ids' => $ids]];
    }

    // ---- pay rates -------------------------------------------------------------------------------------

    private function listRates(array $user, array $in, string $ip, string $o, string $s): array
    {
        $m = $this->managerOrSelf($user, $o, $s);
        $q = $this->ctx->pdo->prepare('SELECT id, hourly_rate_pence, effective_from FROM staff_pay_rates WHERE org_id = ? AND staff_profile_id = ? ORDER BY effective_from DESC');
        $q->execute([$o, $s]);
        return [200, ['pay_rates' => $q->fetchAll()]];
    }

    private function addRate(array $user, array $in, string $ip, string $o, string $s): array
    {
        $pdo = $this->ctx->pdo;
        $m = Scope::membership($pdo, $user['id'], $o);
        Scope::require($m, Scope::MANAGERS);
        Scope::requireWritable($m);
        $this->row($o, $s);
        $pence = Input::optNum($in, 'hourly_rate_pence', 0, 100000);
        $from = Input::optDate($in, 'effective_from');
        if ($pence === null || $pence !== floor($pence) || $from === null) {
            throw HttpError::invalid('hourly_rate_pence (whole pence) and effective_from are required');
        }
        $id = Db::uuid();
        try {
            $pdo->prepare('INSERT INTO staff_pay_rates (id, org_id, staff_profile_id, hourly_rate_pence, effective_from) VALUES (?, ?, ?, ?, ?)')->execute([$id, $o, $s, (int) $pence, $from]);
        } catch (\PDOException $e) {
            if ($e->getCode() === '23000') { throw HttpError::conflict('rate_exists', 'A rate already starts on that date; rates are a history and are not overwritten'); }
            throw $e;
        }
        Audit::log($pdo, $o, $user['id'], 'staff.pay_rate_added', 'staff_profiles', $s, ['effective_from' => $from], 'warning', 'org', $ip);
        return [201, ['id' => $id]];
    }

    // ---- emergency contacts ----------------------------------------------------------------------------

    private function listContacts(array $user, array $in, string $ip, string $o, string $s): array
    {
        $this->managerOrSelf($user, $o, $s);
        $q = $this->ctx->pdo->prepare('SELECT id, name, relationship, phone, secondary_phone FROM emergency_contacts WHERE org_id = ? AND staff_profile_id = ? ORDER BY created_at');
        $q->execute([$o, $s]);
        return [200, ['emergency_contacts' => $q->fetchAll()]];
    }

    private function saveContact(array $user, array $in, string $ip, string $o, string $s, ?string $c = null): array
    {
        $this->managerOrSelf($user, $o, $s, true);
        $pdo = $this->ctx->pdo;
        $vals = [Input::reqStr($in, 'name', 120), Input::optStr($in, 'relationship', 60), Input::reqStr($in, 'phone', 40), Input::optStr($in, 'secondary_phone', 40)];
        if ($c === null) {
            $id = Db::uuid();
            $pdo->prepare('INSERT INTO emergency_contacts (name, relationship, phone, secondary_phone, id, org_id, staff_profile_id) VALUES (?, ?, ?, ?, ?, ?, ?)')->execute([...$vals, $id, $o, $s]);
            return [201, ['id' => $id]];
        }
        $u = $pdo->prepare('UPDATE emergency_contacts SET name = ?, relationship = ?, phone = ?, secondary_phone = ? WHERE id = ? AND org_id = ? AND staff_profile_id = ?');
        $u->execute([...$vals, $c, $o, $s]);
        $this->contactMustExist($c, $o, $s);
        return [200, ['id' => $c]];
    }

    private function deleteContact(array $user, array $in, string $ip, string $o, string $s, string $c): array
    {
        $this->managerOrSelf($user, $o, $s, true);
        $this->contactMustExist($c, $o, $s);
        $this->ctx->pdo->prepare('DELETE FROM emergency_contacts WHERE id = ? AND org_id = ? AND staff_profile_id = ?')->execute([$c, $o, $s]);
        return [200, ['ok' => true]];
    }

    // ---- helpers ---------------------------------------------------------------------------------------

    /** Owner or manager, or the person the record belongs to. Anyone else in the organisation gets 403; a non-member 404. */
    private function managerOrSelf(array $user, string $o, string $s, bool $write = false): array
    {
        $m = Scope::membership($this->ctx->pdo, $user['id'], $o);
        $r = $this->row($o, $s);
        if (!in_array($m['effective_role'], Scope::MANAGERS, true) && $r['user_id'] !== $user['id']) {
            throw HttpError::forbidden();
        }
        if ($write) {
            Scope::requireWritable($m);
        }
        return $m;
    }

    /** @return array<string,mixed> a staff record of THIS organisation, or 404 */
    private function row(string $o, string $s): array
    {
        $q = $this->ctx->pdo->prepare('SELECT * FROM staff_profiles WHERE id = ? AND org_id = ?');
        $q->execute([$s, $o]);
        return $q->fetch() ?: throw HttpError::notFound();
    }

    private function contactMustExist(string $c, string $o, string $s): void
    {
        $q = $this->ctx->pdo->prepare('SELECT 1 FROM emergency_contacts WHERE id = ? AND org_id = ? AND staff_profile_id = ?');
        $q->execute([$c, $o, $s]);
        if ($q->fetchColumn() === false) { throw HttpError::notFound(); }
    }

    private function exists(string $table, string $id, string $org): void
    {
        $q = $this->ctx->pdo->prepare("SELECT 1 FROM $table WHERE id = ? AND org_id = ?"); // $table is a literal from this class
        $q->execute([$id, $org]);
        if ($q->fetchColumn() === false) { throw HttpError::notFound(); }
    }

    /** @return array<string,list<string>> staff id => location ids */
    private function sitesFor(string $o, ?string $s = null): array
    {
        $q = $this->ctx->pdo->prepare('SELECT staff_profile_id, location_id FROM staff_locations WHERE org_id = ?' . ($s !== null ? ' AND staff_profile_id = ?' : ''));
        $q->execute($s !== null ? [$o, $s] : [$o]);
        $out = [];
        foreach ($q->fetchAll() as $r) { $out[$r['staff_profile_id']][] = $r['location_id']; }
        return $out;
    }

    /** The column rule: sensitive columns only for an owner or manager and for the person themselves. */
    private function present(array $r, array $m, array $sites): array
    {
        $sees = in_array($m['effective_role'], Scope::MANAGERS, true) || $r['user_id'] === $m['user_id'];
        foreach (self::SENSITIVE as $k) {
            if (!$sees) { $r[$k] = null; }
        }
        unset($r['photo_path']);
        $r['skills'] = json_decode((string) $r['skills'], true) ?: [];
        $r['active'] = (bool) $r['active'];
        $r['location_ids'] = $sites;
        return $r;
    }

    private function same(string $key, mixed $a, mixed $b): bool
    {
        if ($key === 'skills') {
            return json_decode((string) $a, true) === json_decode((string) $b, true);
        }
        return $this->norm($a) === $this->norm($b);
    }

    private function norm(mixed $v): string
    {
        if (is_bool($v)) { return $v ? '1' : '0'; }
        if (is_numeric($v) && !is_string($v)) { return rtrim(rtrim(number_format((float) $v, 4, '.', ''), '0'), '.'); }
        if (is_string($v) && is_numeric($v) && str_contains($v, '.')) { return rtrim(rtrim($v, '0'), '.'); }
        return (string) ($v ?? '');
    }

    private function duplicate(\PDOException $e): \Throwable
    {
        if ($e->getCode() === '23000') {
            if (str_contains($e->getMessage(), 'staff_profiles_org_payroll')) { return HttpError::conflict('payroll_id_taken', 'That payroll id is already used'); }
            if (str_contains($e->getMessage(), 'staff_profiles_org_user')) { return HttpError::conflict('account_linked', 'That login already has a staff record'); }
        }
        return $e;
    }
}
