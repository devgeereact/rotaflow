<?php
declare(strict_types=1);

namespace RotaFlow\Mod;

use RotaFlow\{Ctx, HttpError, Input, Module, Scope};

/** A person's own settings, finishing an organisation's setup, and the organisation's audit trail. */
final class Account implements Module
{
    public function __construct(private readonly Ctx $ctx) {}

    public function routes(): array
    {
        return [
            ['GET', '/me/settings', $this->getSettings(...)],
            ['POST', '/me/settings', $this->saveSettings(...)],
            ['POST', '/me/profile', $this->saveProfile(...)],
            ['POST', '/orgs/{o}/onboarding/complete', $this->completeOnboarding(...)],
            ['GET', '/orgs/{o}/audit', $this->audit(...)],
            ['POST', '/orgs/{o}/audit', $this->record(...)],
        ];
    }

    private function getSettings(array $user): array
    {
        $q = $this->ctx->pdo->prepare('SELECT theme, time_format, week_start, digest_frequency, notifications_enabled FROM app_settings WHERE user_id = ?');
        $q->execute([$user['id']]);
        $r = $q->fetch() ?: ['theme' => 'dark', 'time_format' => '24h', 'week_start' => 'monday', 'digest_frequency' => 'immediate', 'notifications_enabled' => 1];
        $r['notifications_enabled'] = (bool) $r['notifications_enabled'];
        return [200, ['settings' => $r]];
    }

    /** The person's display name. Their email address is Clerk's (it is the sign-in), so it is not editable here. */
    private function saveProfile(array $user, array $in): array
    {
        $name = Input::optStr($in, 'full_name', 120);
        $this->ctx->pdo->prepare('UPDATE users SET full_name = ? WHERE id = ?')->execute([$name, $user['id']]);
        return [200, ['user' => ['id' => $user['id'], 'full_name' => $name]]];
    }

    private function saveSettings(array $user, array $in): array
    {
        $allowed = ['theme' => ['dark', 'light'], 'time_format' => ['24h', '12h'], 'week_start' => ['monday', 'sunday'], 'digest_frequency' => ['immediate', 'daily', 'weekly']];
        $set = [];
        foreach ($allowed as $k => $values) {
            if (array_key_exists($k, $in)) {
                if (!in_array($in[$k], $values, true)) {
                    throw HttpError::invalid("$k must be one of " . implode(', ', $values));
                }
                $set[$k] = $in[$k];
            }
        }
        if (array_key_exists('notifications_enabled', $in)) {
            if (!is_bool($in['notifications_enabled'])) {
                throw HttpError::invalid('notifications_enabled must be true or false');
            }
            $set['notifications_enabled'] = $in['notifications_enabled'] ? 1 : 0;
        }
        if ($set === []) {
            return $this->getSettings($user);
        }
        $cols = implode(', ', array_keys($set));
        $marks = implode(', ', array_fill(0, count($set), '?'));
        $upd = implode(', ', array_map(static fn (string $k): string => "$k = VALUES($k)", array_keys($set)));
        $this->ctx->pdo->prepare("INSERT INTO app_settings (user_id, $cols) VALUES (?, $marks) ON DUPLICATE KEY UPDATE $upd")->execute([$user['id'], ...array_values($set)]);
        return $this->getSettings($user);
    }

    /** Owner only, idempotent, and the only writer of onboarding_completed_at. */
    private function completeOnboarding(array $user, array $in, string $ip, string $o): array
    {
        $m = Scope::membership($this->ctx->pdo, $user['id'], $o);
        Scope::require($m, ['owner']);
        $this->ctx->pdo->prepare('UPDATE organisations SET onboarding_completed_at = COALESCE(onboarding_completed_at, UTC_TIMESTAMP()) WHERE id = ?')->execute([$o]);
        $q = $this->ctx->pdo->prepare('SELECT onboarding_completed_at FROM organisations WHERE id = ?');
        $q->execute([$o]);
        return [200, ['onboarding_completed_at' => $q->fetchColumn()]];
    }

    /** Owners read the organisation's trail (never the platform-only rows); anyone else reads only what they did themselves. */
    private function audit(array $user, array $in, string $ip, string $o): array
    {
        $m = Scope::membership($this->ctx->pdo, $user['id'], $o);
        $limit = (int) (Input::optNum($in, 'limit', 1, 100) ?? 50);
        $before = Input::optNum($in, 'before_id', 1, 9.0e18);
        $sql = "SELECT id, actor_user_id, action, entity_type, entity_id, metadata, severity, created_at FROM audit_logs WHERE org_id = ? AND visibility = 'org'";
        $args = [$o];
        if ($m['effective_role'] !== 'owner') {
            $sql .= ' AND actor_user_id = ?';
            $args[] = $user['id'];
        }
        if ($before !== null) {
            $sql .= ' AND id < ?';
            $args[] = (int) $before;
        }
        $q = $this->ctx->pdo->prepare($sql . ' ORDER BY id DESC LIMIT ' . $limit);
        $q->execute($args);
        $rows = array_map(static function (array $r): array {
            $r['metadata'] = $r['metadata'] === null ? null : json_decode((string) $r['metadata'], true);
            return $r;
        }, $q->fetchAll());
        return [200, ['entries' => $rows, 'next_before_id' => count($rows) === $limit ? (int) end($rows)['id'] : null]];
    }

    /** What the browser may record about itself: exports and reviews it performed (the Postgres log_audit_event). */
    private const CLIENT_ACTIONS = ['gdpr.export', 'report.exported', 'timesheet.exported', 'staff.exported', 'timesheet.amended', 'leave.reviewed'];

    /** Any member records an action they took, attributed to them. Only the listed actions, small metadata, rate limited. */
    private function record(array $user, array $in, string $ip, string $o): array
    {
        $pdo = $this->ctx->pdo;
        Scope::membership($pdo, $user['id'], $o);
        $action = Input::str($in, 'action');
        if (!in_array($action, self::CLIENT_ACTIONS, true)) {
            throw HttpError::invalid('That action cannot be recorded from the app');
        }
        $type = Input::optStr($in, 'entity_type', 40) ?? 'organisations';
        $id = Input::optStr($in, 'entity_id', 36);
        if ($id !== null && preg_match('/^[0-9a-f-]{36}$/', $id) !== 1) {
            throw HttpError::invalid('entity_id must be an id');
        }
        $meta = $in['metadata'] ?? [];
        if (!is_array($meta) || strlen((string) json_encode($meta)) > 2000) {
            throw HttpError::invalid('metadata must be an object of at most 2000 bytes');
        }
        $this->ctx->limits->hit('client-audit', $user['id'], 120, 3600);
        \RotaFlow\Audit::log($pdo, $o, $user['id'], $action, $type, $id, $meta, 'info', 'org', $ip);
        return [201, ['ok' => true]];
    }

}
