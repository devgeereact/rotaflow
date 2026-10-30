<?php
declare(strict_types=1);

namespace RotaFlow;

/**
 * Whether a feature flag is on for an organisation. First match wins: not enabled is off for everyone; a full rollout is on; an organisation
 * named as a pilot is on; an organisation on a targeted plan is on; no rollout is off; otherwise a stable bucket from the key and the
 * organisation decides (crc32, so raising the percentage only ever adds organisations, and two flags do not pick the same ones).
 */
final class Flags
{
    public static function enabledForOrg(\PDO $pdo, string $key, string $orgId): bool
    {
        $q = $pdo->prepare('SELECT enabled, rollout, target_plans FROM feature_flags WHERE flag_key = ?');
        $q->execute([$key]);
        $f = $q->fetch();
        if ($f === false) {
            return false;
        }
        $t = $pdo->prepare('SELECT 1 FROM feature_flag_targets WHERE flag_key = ? AND org_id = ?');
        $t->execute([$key, $orgId]);
        $p = $pdo->prepare('SELECT plan FROM organisations WHERE id = ?');
        $p->execute([$orgId]);
        $plans = json_decode((string) $f['target_plans'], true);
        return self::decide((bool) $f['enabled'], (int) $f['rollout'], $t->fetchColumn() !== false, is_array($plans) && in_array($p->fetchColumn(), $plans, true), $key, $orgId);
    }

    public static function decide(bool $enabled, int $rollout, bool $targeted, bool $planTargeted, string $key, string $orgId): bool
    {
        return match (true) {
            !$enabled => false,
            $rollout >= 100 => true,
            $targeted => true,
            $planTargeted => true,
            $rollout <= 0 => false,
            default => (crc32($key . ':' . $orgId) % 100) < $rollout,
        };
    }
}
