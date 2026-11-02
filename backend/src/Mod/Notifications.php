<?php
declare(strict_types=1);

namespace RotaFlow\Mod;

use RotaFlow\{Ctx, Db, Dispatcher, HttpError, Input, Module, Notify, Scope, Time};

/**
 * A person's inbox, their web push devices, and the background work that delivers notifications (cron).
 * The inbox is written only by the Dispatcher; nobody can put a row into someone else's inbox through the API.
 */
final class Notifications implements Module
{
    /** Devices kept per person; the oldest beyond this is dropped. */
    private const MAX_DEVICES = 10;
    /** The push services browsers use (Chrome/Edge via FCM, Firefox, Windows, Safari). Host or a subdomain of it. */
    private const PUSH_HOSTS = ['fcm.googleapis.com', 'android.googleapis.com', 'push.services.mozilla.com', 'notify.windows.com', 'push.apple.com'];

    public static function isPushService(string $endpoint): bool
    {
        if (preg_match('#^https://#', $endpoint) !== 1) {
            return false;
        }
        $host = strtolower((string) parse_url($endpoint, PHP_URL_HOST));
        $port = parse_url($endpoint, PHP_URL_PORT);
        if ($host === '' || ($port !== null && $port !== 443)) {
            return false;
        }
        foreach (self::PUSH_HOSTS as $h) {
            if ($host === $h || str_ends_with($host, '.' . $h)) {
                return true;
            }
        }
        return false;
    }

    private const MISSED_AFTER_MIN = 30;
    private const MISSED_WINDOW_HOURS = 12;

    public function __construct(private readonly Ctx $ctx) {}

    public function routes(): array
    {
        return [
            ['GET', '/orgs/{o}/notifications', $this->list(...)],
            ['POST', '/orgs/{o}/notifications/read', $this->markRead(...)],
            ['POST', '/me/push-subscriptions', $this->subscribe(...)],
            ['POST', '/me/push-subscriptions/delete', $this->unsubscribe(...)],
        ];
    }

    /** The caller's own inbox in this organisation, newest first. ?unread=1 narrows it; ?limit up to 100. Includes the unread count. */
    private function list(array $user, array $in, string $ip, string $o): array
    {
        Scope::membership($this->ctx->pdo, $user['id'], $o);
        $limit = (int) (Input::optNum($in, 'limit', 1, 100) ?? 50);
        $sql = 'SELECT id, type, title, body, channel, read_at, created_at FROM notifications WHERE org_id = ? AND user_id = ?';
        if (($in['unread'] ?? '') === '1') {
            $sql .= ' AND read_at IS NULL';
        }
        $q = $this->ctx->pdo->prepare($sql . ' ORDER BY created_at DESC, id DESC LIMIT ' . $limit);
        $q->execute([$o, $user['id']]);
        $c = $this->ctx->pdo->prepare('SELECT COUNT(*) FROM notifications WHERE org_id = ? AND user_id = ? AND read_at IS NULL');
        $c->execute([$o, $user['id']]);
        return [200, ['notifications' => array_map(static function (array $r): array {
            $r['read_at'] = Time::iso($r['read_at']);
            $r['created_at'] = Time::iso($r['created_at']);
            return $r;
        }, $q->fetchAll()), 'unread_count' => (int) $c->fetchColumn()]];
    }

    /** `{all: true}` or `{ids: [...]}` (up to 100). Only the caller's own rows can change. */
    private function markRead(array $user, array $in, string $ip, string $o): array
    {
        Scope::membership($this->ctx->pdo, $user['id'], $o);
        if (($in['all'] ?? false) === true) {
            $u = $this->ctx->pdo->prepare('UPDATE notifications SET read_at = UTC_TIMESTAMP() WHERE org_id = ? AND user_id = ? AND read_at IS NULL');
            $u->execute([$o, $user['id']]);
            return [200, ['updated' => $u->rowCount()]];
        }
        $ids = $in['ids'] ?? null;
        if (!is_array($ids) || !array_is_list($ids) || $ids === [] || count($ids) > 100) {
            throw HttpError::invalid('Give {all: true} or {ids: [up to 100 ids]}');
        }
        foreach ($ids as $id) {
            if (!is_string($id)) {
                throw HttpError::invalid('ids must be text');
            }
        }
        $u = $this->ctx->pdo->prepare('UPDATE notifications SET read_at = UTC_TIMESTAMP() WHERE org_id = ? AND user_id = ? AND read_at IS NULL AND id IN (' . implode(',', array_fill(0, count($ids), '?')) . ')');
        $u->execute([$o, $user['id'], ...$ids]);
        return [200, ['updated' => $u->rowCount()]];
    }

    /** Registers (or re-registers) this device. The endpoint is the device's identity; a second person on the same device takes it over. */
    private function subscribe(array $user, array $in): array
    {
        $endpoint = Input::reqStr($in, 'endpoint', 2000);
        $keys = is_array($in['keys'] ?? null) ? $in['keys'] : [];
        $p256dh = Input::str($keys, 'p256dh');
        $auth = Input::str($keys, 'auth');
        if (preg_match('#^https://#', $endpoint) !== 1 || preg_match('/^[A-Za-z0-9_-]{20,200}$/', $p256dh) !== 1 || preg_match('/^[A-Za-z0-9_-]{8,100}$/', $auth) !== 1) {
            throw HttpError::invalid('endpoint (https) and keys.p256dh / keys.auth are required');
        }
        if (!self::isPushService($endpoint)) {
            // The server POSTs to every stored endpoint, so an arbitrary https URL made it a request forwarder
            // (security audit, 1 Nov 2026). Browsers only ever hand out these push services' endpoints.
            throw HttpError::invalid('endpoint must be a browser push service');
        }
        $this->ctx->limits->hit('push-subscribe', $user['id'], 30, 3600);
        $pdo = $this->ctx->pdo;
        $pdo->prepare('INSERT INTO push_subscriptions (id, user_id, endpoint, endpoint_hash, p256dh, auth_key) VALUES (?, ?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE user_id = VALUES(user_id), p256dh = VALUES(p256dh), auth_key = VALUES(auth_key)')
            ->execute([Db::uuid(), $user['id'], $endpoint, hash('sha256', $endpoint), $p256dh, $auth]);
        // At most MAX_DEVICES per person, newest kept: each one costs the notification cron a request.
        $pdo->prepare('DELETE FROM push_subscriptions WHERE user_id = ? AND id NOT IN (SELECT id FROM (SELECT id FROM push_subscriptions WHERE user_id = ? ORDER BY created_at DESC, id DESC LIMIT ' . self::MAX_DEVICES . ') keep)')
            ->execute([$user['id'], $user['id']]);
        return [200, ['ok' => true]];
    }

    /** Releases this device, but only if it is the caller's. */
    private function unsubscribe(array $user, array $in): array
    {
        $endpoint = Input::reqStr($in, 'endpoint', 2000);
        $this->ctx->pdo->prepare('DELETE FROM push_subscriptions WHERE endpoint_hash = ? AND user_id = ?')->execute([hash('sha256', $endpoint), $user['id']]);
        return [200, ['ok' => true]];
    }

    // ---- cron ------------------------------------------------------------------------------------------

    /** Scheduled alerts first (so they are delivered in the same run), then the outbox. */
    public static function cron(Ctx $ctx): string
    {
        $alerts = self::scheduledAlerts($ctx);
        $r = (new Dispatcher($ctx, self::pusher($ctx)))->drain();
        return "alerts queued=$alerts sent={$r['sent']} failed={$r['failed']} abandoned={$r['abandoned']}";
    }

    private static function pusher(Ctx $ctx): \RotaFlow\Pusher
    {
        return class_exists(\RotaFlow\WebPushSender::class) ? \RotaFlow\WebPushSender::fromConfig($ctx) : new \RotaFlow\NullPusher();
    }

    /**
     * A shift that started more than 30 minutes ago (and less than 12 hours ago) with nobody clocked in tells the organisation's owners
     * and managers, once per shift. A free trial ending within three days tells the owners once per trial end. Expiring documents arrive
     * with documents (S8/S10).
     */
    public static function scheduledAlerts(Ctx $ctx): int
    {
        $pdo = $ctx->pdo;
        $q = $pdo->query(
            "SELECT s.id, s.org_id, s.starts_at, sp.first_name, sp.last_name, COALESCE(l.timezone, 'Europe/London') AS tz
               FROM shifts s
               JOIN staff_profiles sp ON sp.id = s.staff_profile_id AND sp.org_id = s.org_id
               JOIN organisations o ON o.id = s.org_id AND o.status = 'active'
               LEFT JOIN locations l ON l.id = s.location_id AND l.org_id = s.org_id
              WHERE s.status <> 'cancelled' AND s.staff_profile_id IS NOT NULL
                AND s.starts_at < DATE_SUB(UTC_TIMESTAMP(), INTERVAL " . self::MISSED_AFTER_MIN . ' MINUTE)
                AND s.starts_at > DATE_SUB(UTC_TIMESTAMP(), INTERVAL ' . self::MISSED_WINDOW_HOURS . " HOUR)
                AND NOT EXISTS (SELECT 1 FROM clock_events c WHERE c.staff_profile_id = s.staff_profile_id AND c.type = 'in'
                                AND c.event_at BETWEEN DATE_SUB(s.starts_at, INTERVAL 2 HOUR) AND UTC_TIMESTAMP())
              LIMIT 500"
        );
        $n = 0;
        foreach ($q->fetchAll() as $s) {
            $managers = Notify::managers($pdo, $s['org_id']);
            if ($managers === []) {
                continue;
            }
            $at = (new \DateTimeImmutable($s['starts_at'] . ' UTC'))->setTimezone(new \DateTimeZone($s['tz']))->format('H:i');
            $before = (int) $pdo->query('SELECT COUNT(*) FROM notification_outbox')->fetchColumn();
            Notify::enqueue($pdo, $s['org_id'], 'alert/missed_clock_in', $managers, 'attendance', trim($s['first_name'] . ' ' . $s['last_name']) . ' has not clocked in', "Their shift started at $at. Nothing has been recorded since.", 'missed_clock_in:' . $s['id']);
            $n += (int) $pdo->query('SELECT COUNT(*) FROM notification_outbox')->fetchColumn() - $before;
        }
        return $n + self::trialEndingAlerts($ctx);
    }

    /**
     * An active organisation whose own free trial ends within three days, and which has not chosen a plan (its state is still "trial"), tells its
     * owners once. The dedupe key names the trial end, so a trial the platform extends is reminded again before its new end.
     */
    private static function trialEndingAlerts(Ctx $ctx): int
    {
        $pdo = $ctx->pdo;
        $orgs = $pdo->query("SELECT id, trial_ends_at FROM organisations WHERE status = 'active' AND trial_ends_at > UTC_TIMESTAMP() AND trial_ends_at <= DATE_ADD(UTC_TIMESTAMP(), INTERVAL 3 DAY) LIMIT 500")->fetchAll();
        $n = 0;
        foreach ($orgs as $o) {
            if (\RotaFlow\Billing::state($pdo, $o['id'])['state'] !== 'trial') {
                continue;
            }
            $owners = $pdo->prepare("SELECT user_id FROM memberships WHERE org_id = ? AND role = 'owner' AND status = 'active'");
            $owners->execute([$o['id']]);
            $ids = $owners->fetchAll(\PDO::FETCH_COLUMN);
            $before = (int) $pdo->query('SELECT COUNT(*) FROM notification_outbox')->fetchColumn();
            Notify::enqueue($pdo, $o['id'], 'billing/trial_ending', $ids, 'billing', 'Your free trial ends on ' . (new \DateTimeImmutable($o['trial_ends_at'] . ' UTC'))->setTimezone(new \DateTimeZone('Europe/London'))->format('j F'),
                'After that, managers cannot build rotas or invite people until a plan is chosen. Your rotas and records stay as they are. Choose a plan in Settings, Billing.', 'trial_ending:' . $o['id'] . ':' . $o['trial_ends_at']);
            $n += (int) $pdo->query('SELECT COUNT(*) FROM notification_outbox')->fetchColumn() - $before;
        }
        return $n;
    }
}
