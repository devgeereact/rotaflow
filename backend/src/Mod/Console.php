<?php
declare(strict_types=1);

namespace RotaFlow\Mod;

use RotaFlow\{Audit, Billing, Ctx, Db, HttpError, Input, Module, Scope};

/**
 * The Super Admin console's core: who the platform staff are, platform settings, the directories and totals, suspending an organisation, and
 * support access (platform staff entering a customer's data, only with the customer's consent, for a stated reason, for a limited time).
 * Everyone who is not platform staff gets 404 from /platform/*, so the routes are not discoverable.
 *
 * Roles: platform_owner (everything, and the only one who changes who is staff), platform_admin, platform_support (support access, cases),
 * platform_finance (billing; never people or tenant data).
 */
final class Console implements Module
{
    private const ALL = ['platform_owner', 'platform_admin', 'platform_support', 'platform_finance'];
    private const ROLES = self::ALL;
    private const SESSION_MIN = 15;
    private const SESSION_MAX = 1440;

    public function __construct(private readonly Ctx $ctx) {}

    public function routes(): array
    {
        return [
            ['GET', '/platform/settings', $this->settings(...)],
            ['POST', '/platform/settings', $this->saveSettings(...)],
            ['GET', '/platform/admins', $this->admins(...)],
            ['POST', '/platform/admins', $this->grant(...)],
            ['POST', '/platform/admins/{u}/revoke', $this->revoke(...)],
            ['GET', '/platform/summary', $this->summary(...)],
            ['GET', '/platform/notifications/activity', $this->notificationActivity(...)],
            ['GET', '/platform/orgs', $this->orgDirectory(...)],
            ['GET', '/platform/orgs/{o}', $this->orgDetail(...)],
            ['GET', '/platform/orgs/{o}/structure', $this->orgStructure(...)],
            ['POST', '/platform/orgs/{o}/status', $this->setStatus(...)],
            ['GET', '/platform/users', $this->userDirectory(...)],
            ['GET', '/platform/users/{u}', $this->userDetail(...)],
            ['GET', '/platform/support-sessions', $this->allSessions(...)],
            ['POST', '/platform/orgs/{o}/support-sessions', $this->requestSession(...)],
            ['POST', '/platform/support-sessions/{s}/revoke', $this->platformRevoke(...)],
            ['POST', '/orgs/{o}/support-access', $this->consent(...)],
            ['GET', '/orgs/{o}/support-sessions', $this->orgSessions(...)],
            ['POST', '/orgs/{o}/support-sessions/{s}/revoke', $this->orgRevoke(...)],
        ];
    }

    /** The caller's live platform role if it is one of $roles, else 404. */
    private function staff(array $user, array $roles = self::ALL): string
    {
        $r = Scope::platformRole($this->ctx->pdo, $user['id']);
        if ($r === null || !in_array($r, $roles, true)) {
            throw HttpError::notFound();
        }
        return $r;
    }

    // ---- settings ------------------------------------------------------------------------------------

    /** Any signed-in person: the app reads the maintenance notice and the support address from here. */
    private function settings(array $user, array $in, string $ip): array
    {
        $r = $this->ctx->pdo->query('SELECT platform_name, support_email, platform_url, default_timezone, registration_enabled, maintenance_mode, maintenance_message, updated_at FROM platform_settings WHERE id = 1')->fetch();
        $r['registration_enabled'] = (bool) $r['registration_enabled'];
        $r['maintenance_mode'] = (bool) $r['maintenance_mode'];
        return [200, ['settings' => $r]];
    }

    private function saveSettings(array $user, array $in, string $ip): array
    {
        $this->staff($user, ['platform_owner', 'platform_admin']);
        $set = [];
        foreach (['platform_name' => 100, 'support_email' => 255, 'platform_url' => 255, 'default_timezone' => 64, 'maintenance_message' => 1000] as $k => $max) {
            if (array_key_exists($k, $in)) {
                $v = Input::optStr($in, $k, $max);
                if ($k !== 'maintenance_message' && $v === null) {
                    throw HttpError::invalid("$k cannot be empty");
                }
                $set[$k] = $v;
            }
        }
        if (isset($set['support_email']) && filter_var($set['support_email'], FILTER_VALIDATE_EMAIL) === false) {
            throw HttpError::invalid('support_email must be an email address');
        }
        if (isset($set['platform_url']) && preg_match('#^https://[a-z0-9.-]+(:\d+)?$#i', $set['platform_url']) !== 1) {
            throw HttpError::invalid('platform_url must be an https address with no path');
        }
        if (isset($set['default_timezone']) && !in_array($set['default_timezone'], \DateTimeZone::listIdentifiers(), true)) {
            throw HttpError::invalid('default_timezone must be an IANA time zone');
        }
        foreach (['registration_enabled', 'maintenance_mode'] as $k) {
            if (array_key_exists($k, $in)) {
                if (!is_bool($in[$k])) {
                    throw HttpError::invalid("$k must be true or false");
                }
                $set[$k] = $in[$k] ? 1 : 0;
            }
        }
        if ($set === []) {
            throw HttpError::invalid('Nothing to change');
        }
        $pdo = $this->ctx->pdo;
        $pdo->prepare('UPDATE platform_settings SET ' . implode(', ', array_map(static fn (string $k): string => "$k = ?", array_keys($set))) . ', updated_by = ? WHERE id = 1')->execute([...array_values($set), $user['id']]);
        Audit::log($pdo, null, $user['id'], 'platform.settings_changed', 'platform_settings', null, ['keys' => array_keys($set)], 'warning', 'platform_only', $ip);
        return $this->settings($user, [], $ip);
    }

    // ---- who is platform staff -----------------------------------------------------------------------

    private function admins(array $user, array $in, string $ip): array
    {
        $this->staff($user);
        $rows = $this->ctx->pdo->query(
            "SELECT pa.user_id, u.email, u.full_name, pa.role, pa.granted_at, pa.granted_by, pa.revoked_at, pa.note
               FROM platform_admins pa JOIN users u ON u.id = pa.user_id ORDER BY (pa.revoked_at IS NOT NULL), pa.granted_at"
        )->fetchAll();
        return [200, ['admins' => $rows]];
    }

    /** Platform owners only. The person must already have signed in once. Never leaves the platform without an owner. */
    private function grant(array $user, array $in, string $ip): array
    {
        $this->staff($user, ['platform_owner']);
        $email = strtolower(trim(Input::str($in, 'email')));
        $role = $in['role'] ?? null;
        if (!is_string($role) || !in_array($role, self::ROLES, true)) {
            throw HttpError::invalid('role must be platform_owner, platform_admin, platform_support or platform_finance');
        }
        $this->ctx->limits->hit('platform-admins', $user['id'], 30, 3600);
        $pdo = $this->ctx->pdo;
        $pdo->beginTransaction();
        try {
            $u = $pdo->prepare('SELECT id FROM users WHERE email = ?');
            $u->execute([$email]);
            $target = $u->fetchColumn();
            if (!is_string($target)) {
                throw new HttpError(404, 'no_such_user', 'That person has not signed in to RotaFlow yet');
            }
            $this->lockOwners();
            if ($role !== 'platform_owner' && $this->isLiveOwner($target) && $this->liveOwnerCount() <= 1) {
                throw HttpError::conflict('last_platform_owner', 'Cannot change the last platform owner to a lesser role');
            }
            $pdo->prepare('INSERT INTO platform_admins (user_id, role, granted_by, granted_at) VALUES (?, ?, ?, UTC_TIMESTAMP())
                           ON DUPLICATE KEY UPDATE role = VALUES(role), granted_by = VALUES(granted_by), granted_at = VALUES(granted_at), revoked_at = NULL, revoked_by = NULL')
                ->execute([$target, $role, $user['id']]);
            Audit::log($pdo, null, $user['id'], 'platform.role_granted', 'platform_admins', $target, ['role' => $role], 'warning', 'platform_only', $ip);
            $pdo->commit();
        } catch (\Throwable $e) {
            $pdo->rollBack();
            throw $e;
        }
        return [200, ['user_id' => $target, 'role' => $role]];
    }

    /** Platform owners only. Also ends any support session the person held, in the same transaction. */
    private function revoke(array $user, array $in, string $ip, string $u): array
    {
        $this->staff($user, ['platform_owner']);
        $pdo = $this->ctx->pdo;
        $pdo->beginTransaction();
        try {
            $this->lockOwners();
            if ($this->isLiveOwner($u) && $this->liveOwnerCount() <= 1) {
                throw HttpError::conflict('last_platform_owner', 'Cannot revoke the last platform owner');
            }
            $r = $pdo->prepare('UPDATE platform_admins SET revoked_at = UTC_TIMESTAMP(), revoked_by = ? WHERE user_id = ? AND revoked_at IS NULL');
            $r->execute([$user['id'], $u]);
            if ($r->rowCount() === 0) {
                throw HttpError::notFound();
            }
            $c = $pdo->prepare("UPDATE support_access_sessions SET revoked_at = UTC_TIMESTAMP(), revoked_by = ?, revoke_reason = 'Platform role revoked' WHERE admin_user_id = ? AND revoked_at IS NULL AND expires_at > UTC_TIMESTAMP()");
            $c->execute([$user['id'], $u]);
            Audit::log($pdo, null, $user['id'], 'platform.role_revoked', 'platform_admins', $u, ['sessions_closed' => $c->rowCount()], 'warning', 'platform_only', $ip);
            $pdo->commit();
        } catch (\Throwable $e) {
            $pdo->rollBack();
            throw $e;
        }
        return [200, ['user_id' => $u]];
    }

    private function lockOwners(): void
    {
        $this->ctx->pdo->query("SELECT user_id FROM platform_admins WHERE role = 'platform_owner' AND revoked_at IS NULL FOR UPDATE")->fetchAll();
    }

    private function liveOwnerCount(): int
    {
        return (int) $this->ctx->pdo->query("SELECT COUNT(*) FROM platform_admins WHERE role = 'platform_owner' AND revoked_at IS NULL")->fetchColumn();
    }

    private function isLiveOwner(string $userId): bool
    {
        $q = $this->ctx->pdo->prepare("SELECT 1 FROM platform_admins WHERE user_id = ? AND role = 'platform_owner' AND revoked_at IS NULL");
        $q->execute([$userId]);
        return $q->fetchColumn() !== false;
    }

    // ---- directories and totals ----------------------------------------------------------------------

    /** Every staff role: counts only, no tenant rows. */
    /**
     * What the notifications console charts: recent notifications as (organisation, channel, type, read, when) with
     * no title or body, and how many devices are subscribed to push. Owner, admin and support.
     */
    private function notificationActivity(array $user, array $in, string $ip): array
    {
        $this->staff($user, ['platform_owner', 'platform_admin', 'platform_support']);
        $limit = (int) (Input::optNum($in, 'limit', 1, 1000) ?? 1000);
        $rows = $this->ctx->pdo->query("SELECT org_id, channel, type, read_at, created_at FROM notifications ORDER BY created_at DESC, id DESC LIMIT $limit")->fetchAll();
        $push = (int) $this->ctx->pdo->query('SELECT COUNT(*) FROM push_subscriptions')->fetchColumn();
        return [200, ['notifications' => $rows, 'push_subscriptions' => $push]];
    }

    private function summary(array $user, array $in, string $ip): array
    {
        $this->staff($user);
        $pdo = $this->ctx->pdo;
        $by = static fn (string $sql): array => $pdo->query($sql)->fetchAll(\PDO::FETCH_KEY_PAIR);
        $mrr = (int) $pdo->query("SELECT COALESCE(SUM(price_pence), 0) FROM subscriptions WHERE status IN ('active','past_due')")->fetchColumn();
        return [200, ['summary' => [
            'organisations' => array_map('intval', $by('SELECT status, COUNT(*) FROM organisations GROUP BY status')),
            'plans' => array_map('intval', $by("SELECT plan, COUNT(*) FROM organisations WHERE status = 'active' GROUP BY plan")),
            'subscriptions' => array_map('intval', $by('SELECT status, COUNT(*) FROM subscriptions GROUP BY status')),
            'users' => (int) $pdo->query('SELECT COUNT(*) FROM users')->fetchColumn(),
            'active_staff' => (int) $pdo->query('SELECT COUNT(*) FROM staff_profiles WHERE active = 1')->fetchColumn(),
            'monthly_recurring_pence' => $mrr,
            'open_support_sessions' => (int) $pdo->query('SELECT COUNT(*) FROM support_access_sessions WHERE revoked_at IS NULL AND expires_at > UTC_TIMESTAMP()')->fetchColumn(),
            'published_rotas' => (int) $pdo->query("SELECT COUNT(*) FROM rotas WHERE status = 'published'")->fetchColumn(),
            'shifts_this_month' => (int) $pdo->query("SELECT COUNT(*) FROM shifts WHERE status <> 'cancelled' AND starts_at >= '" . gmdate('Y-m-01 00:00:00') . "'")->fetchColumn(),
        ]]];
    }

    private function orgDirectory(array $user, array $in, string $ip): array
    {
        $this->staff($user);
        [$limit, $offset] = $this->page($in);
        $where = ['1 = 1'];
        $args = [];
        if (($q = Input::optStr($in, 'q', 100)) !== null) {
            $where[] = 'o.name LIKE ?';
            $args[] = '%' . addcslashes($q, '%_\\') . '%';
        }
        foreach (['status' => ['active', 'suspended', 'archived'], 'plan' => ['starter', 'professional', 'business', 'enterprise']] as $f => $allowed) {
            $v = Input::optStr($in, $f, 20);
            if ($v !== null) {
                if (!in_array($v, $allowed, true)) {
                    throw HttpError::invalid("$f is not recognised");
                }
                $where[] = "o.$f = ?";
                $args[] = $v;
            }
        }
        $sql = "SELECT o.id, o.name, o.slug, o.status, o.plan, o.trial_ends_at, o.created_at, o.support_access_allowed, o.suspended_reason,
                       s.status AS sub_status, s.trial_ends_at AS sub_trial_ends_at, s.grace_until, s.stripe_mode,
                       (SELECT COUNT(*) FROM memberships m WHERE m.org_id = o.id AND m.status = 'active') AS members,
                       (SELECT COUNT(*) FROM staff_profiles sp WHERE sp.org_id = o.id AND sp.active = 1) AS active_staff,
                       (SELECT COUNT(*) FROM locations l WHERE l.org_id = o.id) AS locations
                  FROM organisations o LEFT JOIN subscriptions s ON s.org_id = o.id
                 WHERE " . implode(' AND ', $where) . " ORDER BY o.created_at DESC, o.id LIMIT $limit OFFSET $offset";
        $st = $this->ctx->pdo->prepare($sql);
        $st->execute($args);
        $rows = array_map(fn (array $r): array => $this->present($r), $st->fetchAll());
        return [200, ['organisations' => $rows, 'limit' => $limit, 'offset' => $offset]];
    }

    /** One organisation's counts (never its rows: reading those needs a support session). */
    /**
     * A tenant's people and places for the console's organisation page (owner, admin, support): members with their
     * name and email, sites, departments and this month's activity. No staff records, pay or contact details.
     */
    private function orgStructure(array $user, array $in, string $ip, string $o): array
    {
        $this->staff($user, ['platform_owner', 'platform_admin', 'platform_support']);
        $pdo = $this->ctx->pdo;
        $q = $pdo->prepare('SELECT 1 FROM organisations WHERE id = ?');
        $q->execute([$o]);
        if ($q->fetchColumn() === false) {
            throw HttpError::notFound();
        }
        $all = static function (string $sql, array $args) use ($pdo): array {
            $st = $pdo->prepare($sql);
            $st->execute($args);
            return $st->fetchAll();
        };
        $month = gmdate('Y-m-01 00:00:00');
        return [200, [
            'members' => $all('SELECT m.user_id, m.role, m.status, m.created_at, u.full_name, u.email FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.org_id = ? ORDER BY m.created_at', [$o]),
            'locations' => $all('SELECT id, name, address, timezone, location_type, status, created_at FROM locations WHERE org_id = ? ORDER BY name', [$o]),
            'departments' => $all('SELECT id, location_id, name, created_at FROM departments WHERE org_id = ? ORDER BY name', [$o]),
            'counts' => [
                'staff_total' => (int) $all('SELECT COUNT(*) AS n FROM staff_profiles WHERE org_id = ?', [$o])[0]['n'],
                'published_rotas' => (int) $all("SELECT COUNT(*) AS n FROM rotas WHERE org_id = ? AND status = 'published'", [$o])[0]['n'],
                'shifts_month' => (int) $all("SELECT COUNT(*) AS n FROM shifts WHERE org_id = ? AND starts_at >= ? AND status <> 'cancelled'", [$o, $month])[0]['n'],
            ],
        ]];
    }

    private function orgDetail(array $user, array $in, string $ip, string $o): array
    {
        $this->staff($user);
        $st = $this->ctx->pdo->prepare(
            "SELECT o.id, o.name, o.slug, o.status, o.plan, o.trial_ends_at, o.created_at, o.support_access_allowed, o.suspended_reason,
                    s.status AS sub_status, s.trial_ends_at AS sub_trial_ends_at, s.grace_until, s.stripe_mode,
                    (SELECT COUNT(*) FROM memberships m WHERE m.org_id = o.id AND m.status = 'active') AS members,
                    (SELECT COUNT(*) FROM staff_profiles sp WHERE sp.org_id = o.id AND sp.active = 1) AS active_staff,
                    (SELECT COUNT(*) FROM locations l WHERE l.org_id = o.id) AS locations,
                    (SELECT COUNT(*) FROM departments d WHERE d.org_id = o.id) AS departments,
                    (SELECT COUNT(*) FROM shifts sh WHERE sh.org_id = o.id) AS shifts,
                    (SELECT COUNT(*) FROM invoices i WHERE i.org_id = o.id) AS invoices
               FROM organisations o LEFT JOIN subscriptions s ON s.org_id = o.id WHERE o.id = ?"
        );
        $st->execute([$o]);
        $r = $st->fetch();
        if ($r === false) {
            throw HttpError::notFound();
        }
        return [200, ['organisation' => $this->present($r)]];
    }

    /** @param array<string,mixed> $r @return array<string,mixed> */
    private function present(array $r): array
    {
        $r['billing_state'] = Billing::stateOf(['sub_status' => $r['sub_status'], 'sub_trial_ends_at' => $r['sub_trial_ends_at'], 'grace_until' => $r['grace_until'], 'trial_ends_at' => $r['trial_ends_at']], time());
        unset($r['sub_trial_ends_at']);
        $r['support_access_allowed'] = (bool) $r['support_access_allowed'];
        foreach (['members', 'active_staff', 'locations', 'departments', 'shifts', 'invoices'] as $k) {
            if (isset($r[$k])) {
                $r[$k] = (int) $r[$k];
            }
        }
        return $r;
    }

    /** People are not for the finance role. */
    /** One person and every organisation they belong to (owner, admin, support), for the console's user page. */
    private function userDetail(array $user, array $in, string $ip, string $u): array
    {
        $this->staff($user, ['platform_owner', 'platform_admin', 'platform_support']);
        $pdo = $this->ctx->pdo;
        $q = $pdo->prepare('SELECT u.id, u.email, u.full_name, u.avatar_url, u.created_at, u.last_seen_at, (u.clerk_user_id IS NOT NULL) AS signed_in FROM users u WHERE u.id = ?');
        $q->execute([$u]);
        $row = $q->fetch() ?: throw HttpError::notFound();
        $row['signed_in'] = (bool) $row['signed_in'];
        $m = $pdo->prepare('SELECT m.org_id, o.name AS org_name, o.status AS org_status, m.role, m.status, m.created_at FROM memberships m JOIN organisations o ON o.id = m.org_id WHERE m.user_id = ? ORDER BY m.created_at');
        $m->execute([$u]);
        return [200, ['user' => $row, 'memberships' => $m->fetchAll(), 'platform_role' => Scope::platformRole($pdo, $u)]];
    }

    private function userDirectory(array $user, array $in, string $ip): array
    {
        $this->staff($user, ['platform_owner', 'platform_admin', 'platform_support']);
        [$limit, $offset] = $this->page($in);
        $where = '1 = 1';
        $args = [];
        if (($q = Input::optStr($in, 'q', 100)) !== null) {
            $where = '(u.email LIKE ? OR u.full_name LIKE ?)';
            $like = '%' . addcslashes($q, '%_\\') . '%';
            $args = [$like, $like];
        }
        $st = $this->ctx->pdo->prepare(
            "SELECT u.id, u.email, u.full_name, u.created_at, u.last_seen_at, (u.clerk_user_id IS NOT NULL) AS signed_in,
                    (SELECT COUNT(*) FROM memberships m WHERE m.user_id = u.id AND m.status = 'active') AS organisations,
                    (SELECT pa.role FROM platform_admins pa WHERE pa.user_id = u.id AND pa.revoked_at IS NULL) AS platform_role
               FROM users u WHERE $where ORDER BY u.created_at DESC, u.id LIMIT $limit OFFSET $offset"
        );
        $st->execute($args);
        $rows = $st->fetchAll();
        foreach ($rows as &$r) {
            $r['signed_in'] = (bool) $r['signed_in'];
            $r['organisations'] = (int) $r['organisations'];
        }
        return [200, ['users' => $rows, 'limit' => $limit, 'offset' => $offset]];
    }

    /** @return array{0:int,1:int} */
    private function page(array $in): array
    {
        $limit = (int) (Input::optNum($in, 'limit', 1, 100) ?? 50);
        $offset = (int) (Input::optNum($in, 'offset', 0, 1000000) ?? 0);
        return [$limit, $offset];
    }

    /** Suspend or reinstate. Owner, admin and finance (the manual non-payment path). An archived organisation is not touched. */
    private function setStatus(array $user, array $in, string $ip, string $o): array
    {
        $this->staff($user, ['platform_owner', 'platform_admin', 'platform_finance']);
        $status = $in['status'] ?? null;
        if (!is_string($status) || !in_array($status, ['active', 'suspended'], true)) {
            throw HttpError::invalid("status must be 'active' or 'suspended'");
        }
        $reason = Input::optStr($in, 'reason', 500);
        if ($status === 'suspended' && ($reason === null || \RotaFlow\Str::len($reason) < 5)) {
            throw HttpError::invalid('Give a reason of at least 5 characters for suspending an organisation');
        }
        $pdo = $this->ctx->pdo;
        $q = $pdo->prepare('SELECT status FROM organisations WHERE id = ? FOR UPDATE');
        $pdo->beginTransaction();
        try {
            $q->execute([$o]);
            $cur = $q->fetchColumn();
            if ($cur === false || $cur === 'archived') {
                throw HttpError::notFound();
            }
            $pdo->prepare('UPDATE organisations SET status = ?, suspended_reason = ?, suspended_at = ? WHERE id = ?')
                ->execute([$status, $status === 'suspended' ? $reason : null, $status === 'suspended' ? gmdate('Y-m-d H:i:s') : null, $o]);
            Audit::log($pdo, $o, $user['id'], $status === 'suspended' ? 'platform.org_suspended' : 'platform.org_reinstated', 'organisations', $o, $reason === null ? [] : ['reason' => $reason], 'warning', 'org', $ip);
            $pdo->commit();
        } catch (\Throwable $e) {
            $pdo->rollBack();
            throw $e;
        }
        return [200, ['id' => $o, 'status' => $status]];
    }

    // ---- support access -------------------------------------------------------------------------------

    /** Owner, admin and support may ask; the organisation must have allowed it; one open session per person per organisation. */
    private function requestSession(array $user, array $in, string $ip, string $o): array
    {
        $this->staff($user, ['platform_owner', 'platform_admin', 'platform_support']);
        $reason = Input::reqStr($in, 'reason', 1000);
        $case = Input::reqStr($in, 'case_ref', 100);
        if (\RotaFlow\Str::len($reason) < 15) {
            throw HttpError::invalid('Give a reason of at least 15 characters');
        }
        if (\RotaFlow\Str::len($case) < 3) {
            throw HttpError::invalid('Give a case reference of at least 3 characters');
        }
        $scope = $in['scope'] ?? 'read';
        if (!is_string($scope) || !in_array($scope, ['read', 'read_write'], true)) {
            throw HttpError::invalid("scope must be 'read' or 'read_write'");
        }
        $minutes = $in['minutes'] ?? null;
        if (!is_int($minutes) || $minutes < self::SESSION_MIN || $minutes > self::SESSION_MAX) {
            throw HttpError::invalid('Support access must last between 15 minutes and 24 hours');
        }
        $this->ctx->limits->hit('support-session', $user['id'], 30, 3600);
        $pdo = $this->ctx->pdo;
        $pdo->beginTransaction();
        try {
            $q = $pdo->prepare('SELECT support_access_allowed FROM organisations WHERE id = ? AND status <> \'archived\' FOR UPDATE');
            $q->execute([$o]);
            $allowed = $q->fetchColumn();
            if ($allowed === false) {
                throw HttpError::notFound();
            }
            if ((int) $allowed !== 1) {
                throw new HttpError(403, 'support_access_off', 'This organisation has turned off platform support access. Ask an owner to re-enable it before requesting a session.');
            }
            $open = $pdo->prepare('SELECT 1 FROM support_access_sessions WHERE org_id = ? AND admin_user_id = ? AND revoked_at IS NULL AND expires_at > UTC_TIMESTAMP()');
            $open->execute([$o, $user['id']]);
            if ($open->fetchColumn() !== false) {
                throw HttpError::conflict('session_open', 'You already have an open support session for this organisation');
            }
            $id = Db::uuid();
            $pdo->prepare('INSERT INTO support_access_sessions (id, org_id, admin_user_id, reason, case_ref, scope, expires_at) VALUES (?, ?, ?, ?, ?, ?, DATE_ADD(UTC_TIMESTAMP(), INTERVAL ? MINUTE))')
                ->execute([$id, $o, $user['id'], $reason, $case, $scope, $minutes]);
            Audit::log($pdo, $o, $user['id'], 'support_access.granted', 'support_access_sessions', $id, ['case_ref' => $case, 'scope' => $scope, 'minutes' => $minutes, 'reason' => $reason], 'warning', 'org', $ip);
            $pdo->commit();
        } catch (\Throwable $e) {
            $pdo->rollBack();
            throw $e;
        }
        return [201, ['id' => $id, 'scope' => $scope, 'minutes' => $minutes]];
    }

    private function allSessions(array $user, array $in, string $ip): array
    {
        $this->staff($user, ['platform_owner', 'platform_admin', 'platform_support']);
        return [200, ['sessions' => $this->sessionRows('1 = 1', [], 100)]];
    }

    private function platformRevoke(array $user, array $in, string $ip, string $s): array
    {
        $role = $this->staff($user, ['platform_owner', 'platform_admin', 'platform_support']);
        $row = $this->session($s);
        if ($row['admin_user_id'] !== $user['id'] && !in_array($role, ['platform_owner', 'platform_admin'], true)) {
            throw HttpError::notFound();
        }
        return $this->end($row, $user['id'], $in, $ip);
    }

    /** The customer's consent. Owners only (a support session can never grant itself this). Turning it off ends every session at once. */
    private function consent(array $user, array $in, string $ip, string $o): array
    {
        $pdo = $this->ctx->pdo;
        $m = Scope::membership($pdo, $user['id'], $o);
        Scope::requireReal($m, ['owner']);
        if (!isset($in['allowed']) || !is_bool($in['allowed'])) {
            throw HttpError::invalid('allowed must be true or false');
        }
        $pdo->prepare('UPDATE organisations SET support_access_allowed = ? WHERE id = ?')->execute([$in['allowed'] ? 1 : 0, $o]);
        if (!$in['allowed']) { // withdrawing consent ends every open session for good: allowing again must not revive one
            $pdo->prepare("UPDATE support_access_sessions SET revoked_at = UTC_TIMESTAMP(), revoked_by = ?, revoke_reason = 'Customer withdrew consent' WHERE org_id = ? AND revoked_at IS NULL AND expires_at > UTC_TIMESTAMP()")->execute([$user['id'], $o]);
        }
        Audit::log($pdo, $o, $user['id'], $in['allowed'] ? 'org.support_access_allowed' : 'org.support_access_denied', 'organisations', $o, [], 'warning', 'org', $ip);
        return [200, ['support_access_allowed' => $in['allowed']]];
    }

    /** Who has been, or is, inside this organisation: owners and managers see the history; staff see the live sessions. */
    private function orgSessions(array $user, array $in, string $ip, string $o): array
    {
        $m = Scope::membership($this->ctx->pdo, $user['id'], $o);
        if (!in_array($m['effective_role'], Scope::MANAGERS, true)) {
            // Every member is told that RotaFlow support is inside their organisation, as on Supabase (owner decision,
            // 31 Oct 2026): staff get the live sessions only, with what the banner shows (the agent's name, else their
            // address, as the old banner did) and no history, no agent id, no revoke reason.
            $q = $this->ctx->pdo->prepare(
                "SELECT s.id, s.org_id, COALESCE(NULLIF(u.full_name, ''), u.email) AS admin_name, s.case_ref, s.reason, s.scope, s.granted_at, s.expires_at
                   FROM support_access_sessions s JOIN users u ON u.id = s.admin_user_id
                  WHERE s.org_id = ? AND s.revoked_at IS NULL AND s.expires_at > UTC_TIMESTAMP() ORDER BY s.granted_at DESC LIMIT 10"
            );
            $q->execute([$o]);
            return [200, ['sessions' => $q->fetchAll()]];
        }
        return [200, ['support_access_allowed' => (bool) $this->ctx->pdo->query("SELECT support_access_allowed FROM organisations WHERE id = '$o'")->fetchColumn(), 'sessions' => $this->sessionRows('s.org_id = ?', [$o], 50)]];
    }

    private function orgRevoke(array $user, array $in, string $ip, string $o, string $s): array
    {
        $m = Scope::membership($this->ctx->pdo, $user['id'], $o);
        Scope::requireReal($m, ['owner']);
        $row = $this->session($s);
        if ($row['org_id'] !== $o) {
            throw HttpError::notFound();
        }
        return $this->end($row, $user['id'], $in, $ip);
    }

    /** @return array<string,mixed> */
    private function session(string $s): array
    {
        $q = $this->ctx->pdo->prepare('SELECT id, org_id, admin_user_id, case_ref, revoked_at FROM support_access_sessions WHERE id = ?');
        $q->execute([$s]);
        return $q->fetch() ?: throw HttpError::notFound();
    }

    /** @param array<string,mixed> $row @return array{0:int,1:array<string,mixed>} */
    private function end(array $row, string $by, array $in, string $ip): array
    {
        if ($row['revoked_at'] !== null) {
            return [200, ['id' => $row['id'], 'already_ended' => true]];
        }
        $reason = Input::optStr($in, 'reason', 1000);
        $pdo = $this->ctx->pdo;
        $pdo->prepare('UPDATE support_access_sessions SET revoked_at = UTC_TIMESTAMP(), revoked_by = ?, revoke_reason = ? WHERE id = ? AND revoked_at IS NULL')->execute([$by, $reason, $row['id']]);
        Audit::log($pdo, $row['org_id'], $by, 'support_access.revoked', 'support_access_sessions', $row['id'], ['case_ref' => $row['case_ref']], 'warning', 'org', $ip);
        return [200, ['id' => $row['id']]];
    }

    /** @param list<string> $args @return list<array<string,mixed>> */
    private function sessionRows(string $where, array $args, int $limit): array
    {
        $q = $this->ctx->pdo->prepare(
            "SELECT s.id, s.org_id, o.name AS org_name, s.admin_user_id, u.email AS admin_email, COALESCE(NULLIF(u.full_name, ''), u.email) AS admin_name, s.case_ref, s.reason, s.scope, s.granted_at, s.expires_at, s.revoked_at, s.revoke_reason,
                    CASE WHEN s.revoked_at IS NOT NULL THEN 'revoked' WHEN s.expires_at <= UTC_TIMESTAMP() THEN 'expired' ELSE 'active' END AS status
               FROM support_access_sessions s JOIN organisations o ON o.id = s.org_id JOIN users u ON u.id = s.admin_user_id
              WHERE $where ORDER BY s.granted_at DESC LIMIT $limit"
        );
        $q->execute($args);
        return $q->fetchAll();
    }
}
