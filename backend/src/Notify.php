<?php
declare(strict_types=1);

namespace RotaFlow;

/**
 * Queues a notification. Call it INSIDE the transaction that caused the event, so the outbox row commits with the change or not at all:
 * a crash or a closed tab cannot lose a notification. Delivery happens later, from cron (Mod\Notifications::cron).
 */
final class Notify
{
    /**
     * @param list<string> $userIds recipients (user ids); non-members are dropped at delivery
     * @param string $type rota | leave | swap | announcement | attendance | document | billing
     * @param ?string $dedupe a stable key that makes a scheduled alert once-only
     */
    public static function enqueue(\PDO $pdo, string $orgId, string $event, array $userIds, string $type, string $title, ?string $body = null, ?string $dedupe = null): void
    {
        $userIds = array_values(array_unique(array_filter($userIds, static fn (mixed $u): bool => is_string($u) && $u !== '')));
        if ($userIds === []) {
            return;
        }
        $payload = json_encode(['orgId' => $orgId, 'userIds' => $userIds, 'type' => $type, 'title' => Str::cut($title, 300), 'body' => $body === null ? null : Str::cut($body, 4000)], JSON_UNESCAPED_UNICODE);
        $pdo->prepare('INSERT IGNORE INTO notification_outbox (id, org_id, event_name, payload, dedupe_key) VALUES (?, ?, ?, ?, ?)')
            ->execute([Db::uuid(), $orgId, $event, $payload, $dedupe]);
    }

    /** @return list<string> the active owners and managers of an organisation */
    public static function managers(\PDO $pdo, string $orgId): array
    {
        $q = $pdo->prepare("SELECT user_id FROM memberships WHERE org_id = ? AND status = 'active' AND role IN ('owner','manager')");
        $q->execute([$orgId]);
        return $q->fetchAll(\PDO::FETCH_COLUMN);
    }

    /** The login behind a staff record, or null if that person has none yet. */
    public static function userOfStaff(\PDO $pdo, string $staffProfileId): ?string
    {
        $q = $pdo->prepare('SELECT user_id FROM staff_profiles WHERE id = ?');
        $q->execute([$staffProfileId]);
        $u = $q->fetchColumn();
        return is_string($u) ? $u : null;
    }
}
