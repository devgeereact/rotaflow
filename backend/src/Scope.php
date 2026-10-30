<?php
declare(strict_types=1);

namespace RotaFlow;

/**
 * The tenancy guard that replaces row-level security. Every org-scoped handler starts with
 * Scope::membership(): the organisation id comes from the URL and is never trusted, the role comes
 * from the database, and a non-member gets 404 (not 403) so ids cannot be probed.
 */
final class Scope
{
    public const MANAGERS = ['owner', 'manager'];

    /**
     * A platform administrator holding a live support session (consent given, not expired, not revoked, still staff) is let in as a
     * `support` member with a manager's reach and never an owner's. A `read` session also refuses every write (requireWritable).
     * @return array{id:?string,org_id:string,user_id:string,role:string,effective_role:string,delegated:bool,org_status:string,org_name:string,support:?string}
     */
    public static function membership(\PDO $pdo, string $userId, string $orgId, int $now = 0): array
    {
        if (preg_match('/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/', $orgId) !== 1) {
            throw HttpError::notFound();
        }
        $q = $pdo->prepare(
            "SELECT m.id, m.org_id, m.user_id, m.role, o.status AS org_status, o.name AS org_name
               FROM memberships m JOIN organisations o ON o.id = m.org_id
              WHERE m.org_id = ? AND m.user_id = ? AND m.status = 'active' AND o.status <> 'archived'"
        );
        $q->execute([$orgId, $userId]);
        $m = $q->fetch();
        if ($m === false) {
            return self::supportMembership($pdo, $userId, $orgId, $now) ?? throw HttpError::notFound();
        }
        $m['support'] = null;
        $m['effective_role'] = $m['role'];
        $m['delegated'] = false;
        if ($m['role'] === 'staff' && self::hasLiveDelegation($pdo, $orgId, $userId, $now)) {
            $m['effective_role'] = 'manager'; // lent authority: manager, never owner
            $m['delegated'] = true;
        }
        return $m;
    }

    /** Exact match on the effective role, as `has_org_role(org, [...])` was. Owner means a real owner. */
    public static function require(array $m, array $roles): void
    {
        if (!in_array($m['effective_role'], $roles, true)) {
            throw HttpError::forbidden();
        }
    }

    /** Uses the real role only, for acts a delegate must never perform (delegating onwards, ending a colleague's cover). */
    public static function requireReal(array $m, array $roles): void
    {
        if (!in_array($m['role'], $roles, true)) {
            throw HttpError::forbidden();
        }
    }

    /** Writes are refused for an organisation that is not active (suspended), and during a read-only support session. */
    public static function requireWritable(array $m): void
    {
        if (($m['support'] ?? null) === 'read') {
            throw new HttpError(403, 'support_read_only', 'This support session is read-only');
        }
        if ($m['org_status'] !== 'active') {
            throw new HttpError(403, 'org_not_active', 'This organisation is not active');
        }
    }

    /** @return ?array<string,mixed> */
    private static function supportMembership(\PDO $pdo, string $userId, string $orgId, int $now): ?array
    {
        $at = gmdate('Y-m-d H:i:s', $now ?: time());
        $q = $pdo->prepare(
            "SELECT s.scope, o.status AS org_status, o.name AS org_name
               FROM support_access_sessions s
               JOIN organisations o ON o.id = s.org_id AND o.support_access_allowed = 1 AND o.status <> 'archived'
               JOIN platform_admins pa ON pa.user_id = s.admin_user_id AND pa.revoked_at IS NULL AND pa.role IN ('platform_owner','platform_admin','platform_support')
              WHERE s.org_id = ? AND s.admin_user_id = ? AND s.revoked_at IS NULL AND s.expires_at > ?
              ORDER BY s.expires_at DESC LIMIT 1"
        );
        $q->execute([$orgId, $userId, $at]);
        $r = $q->fetch();
        return $r === false ? null : ['id' => null, 'org_id' => $orgId, 'user_id' => $userId, 'role' => 'support', 'effective_role' => 'manager', 'delegated' => false,
            'org_status' => $r['org_status'], 'org_name' => $r['org_name'], 'support' => $r['scope'] === 'read_write' ? 'read_write' : 'read'];
    }

    /** The caller's staff record id in this organisation (my_staff_profile_id), or null if they have none. */
    public static function staffProfileId(\PDO $pdo, string $orgId, string $userId): ?string
    {
        $q = $pdo->prepare('SELECT id FROM staff_profiles WHERE org_id = ? AND user_id = ?');
        $q->execute([$orgId, $userId]);
        $r = $q->fetchColumn();
        return $r === false ? null : (string) $r;
    }

    public static function platformRole(\PDO $pdo, string $userId): ?string
    {
        $q = $pdo->prepare('SELECT role FROM platform_admins WHERE user_id = ? AND revoked_at IS NULL');
        $q->execute([$userId]);
        $r = $q->fetchColumn();
        return $r === false ? null : (string) $r;
    }

    /** A delegation is live inside its window, and only while the person who lent it is still an owner or manager. */
    private static function hasLiveDelegation(\PDO $pdo, string $orgId, string $userId, int $now): bool
    {
        $at = gmdate('Y-m-d H:i:s', $now ?: time());
        $q = $pdo->prepare(
            "SELECT 1 FROM role_delegations d
               JOIN memberships lender ON lender.org_id = d.org_id AND lender.user_id = d.from_user_id AND lender.status = 'active' AND lender.role IN ('owner','manager')
              WHERE d.org_id = ? AND d.to_user_id = ? AND d.revoked_at IS NULL AND d.starts_at <= ? AND d.ends_at > ?
              LIMIT 1"
        );
        $q->execute([$orgId, $userId, $at, $at]);
        return $q->fetchColumn() !== false;
    }
}
