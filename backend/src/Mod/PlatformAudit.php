<?php
declare(strict_types=1);

namespace RotaFlow\Mod;

use RotaFlow\{Ctx, HttpError, Input, Module, Scope, Time};

/**
 * The platform's read of the audit trail: every entry, across organisations, for owner, admin and support (finance reads none). A tenant owner
 * reads their own organisation's trail through the organisation routes, and never platform-only entries.
 */
final class PlatformAudit implements Module
{
    private const SEVERITIES = ['info', 'warning', 'critical'];

    public function __construct(private readonly Ctx $ctx) {}

    public function routes(): array
    {
        return [['GET', '/platform/audit', $this->search(...)]];
    }

    /**
     * Filters: scope (`platform` for entries about no organisation, or an organisation id), actor (a person's id), severity (comma list),
     * q (matches the action, the thing it was about, and the actor's name or email), from and to (to is exclusive). Newest first, id as the tie-break.
     */
    private function search(array $user, array $in, string $ip): array
    {
        if (!in_array(Scope::platformRole($this->ctx->pdo, $user['id']), ['platform_owner', 'platform_admin', 'platform_support'], true)) {
            throw HttpError::notFound();
        }
        $where = ['1 = 1'];
        $args = [];
        $scope = Input::optStr($in, 'scope', 36);
        if ($scope === 'platform') {
            $where[] = 'a.org_id IS NULL';
        } elseif ($scope !== null && $scope !== 'all') {
            $where[] = 'a.org_id = ?';
            $args[] = $scope;
        }
        if (($actor = Input::optStr($in, 'actor', 36)) !== null) {
            $where[] = 'a.actor_user_id = ?';
            $args[] = $actor;
        }
        if (($sev = Input::optStr($in, 'severity', 60)) !== null) {
            $list = array_values(array_filter(array_map('trim', explode(',', $sev)), static fn (string $s): bool => $s !== ''));
            if ($list === [] || array_diff($list, self::SEVERITIES) !== []) {
                throw HttpError::invalid('severity must be info, warning or critical');
            }
            $where[] = 'a.severity IN (' . implode(',', array_fill(0, count($list), '?')) . ')';
            array_push($args, ...$list);
        }
        if (($q = Input::optStr($in, 'q', 100)) !== null) {
            $where[] = '(a.action LIKE ? OR a.entity_type LIKE ? OR u.full_name LIKE ? OR u.email LIKE ?)';
            $like = '%' . addcslashes($q, '%_\\') . '%';
            array_push($args, $like, $like, $like, $like);
        }
        if (($f = Input::optStr($in, 'from', 40)) !== null) {
            $where[] = 'a.created_at >= ?';
            $args[] = Time::parseInstant($f, 'from');
        }
        if (($t = Input::optStr($in, 'to', 40)) !== null) {
            $where[] = 'a.created_at < ?';
            $args[] = Time::parseInstant($t, 'to');
        }
        $limit = (int) (Input::optNum($in, 'limit', 1, 200) ?? 50);
        $offset = (int) (Input::optNum($in, 'offset', 0, 1000000) ?? 0);
        $w = implode(' AND ', $where);
        $st = $this->ctx->pdo->prepare(
            "SELECT a.id, a.created_at, a.org_id, a.org_name, a.actor_user_id, u.email AS actor_email, u.full_name AS actor_name, a.action, a.entity_type, a.entity_id, a.severity, a.visibility, a.metadata, a.ip_address
               FROM audit_logs a LEFT JOIN users u ON u.id = a.actor_user_id WHERE $w ORDER BY a.created_at DESC, a.id DESC LIMIT $limit OFFSET $offset"
        );
        $st->execute($args);
        $cnt = $this->ctx->pdo->prepare("SELECT COUNT(*) FROM audit_logs a LEFT JOIN users u ON u.id = a.actor_user_id WHERE $w");
        $cnt->execute($args);
        $rows = $st->fetchAll();
        foreach ($rows as &$r) {
            $r['metadata'] = $r['metadata'] === null ? null : json_decode((string) $r['metadata'], true);
        }
        return [200, ['entries' => $rows, 'total' => (int) $cnt->fetchColumn(), 'limit' => $limit, 'offset' => $offset]];
    }
}
