<?php
declare(strict_types=1);

namespace RotaFlow;

/** Writes the append-only audit trail. The organisation's name is copied onto the row so history outlives the tenant. */
final class Audit
{
    /** @param array<string,mixed> $metadata never put secrets, tokens or message bodies in here */
    public static function log(\PDO $pdo, ?string $orgId, ?string $actor, string $action, string $entityType, ?string $entityId = null, array $metadata = [], string $severity = 'info', string $visibility = 'org', ?string $ip = null): void
    {
        $pdo->prepare(
            'INSERT INTO audit_logs (org_id, org_name, actor_user_id, action, entity_type, entity_id, metadata, severity, visibility, ip_address)
             VALUES (?, (SELECT name FROM organisations WHERE id = ?), ?, ?, ?, ?, ?, ?, ?, ?)'
        )->execute([$orgId, $orgId, $actor, $action, $entityType, $entityId, $metadata === [] ? null : json_encode($metadata, JSON_UNESCAPED_SLASHES), $severity, $visibility, $ip]);
    }
}
