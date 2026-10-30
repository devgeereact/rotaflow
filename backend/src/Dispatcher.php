<?php
declare(strict_types=1);

namespace RotaFlow;

/**
 * Empties the notification outbox: for each queued event it writes the in-app inbox rows, sends email and web push, and records every
 * attempt per channel. Replaces the send-notification Edge Function. It runs from cron, one run at a time.
 *
 * Rules carried over: recipients who are no longer active members are dropped; the ORGANISATION's matrix (5 events x 3 channels)
 * decides which channels an event may use, including in-app; a PERSON's own switch mutes only the interrupting channels (email, push)
 * and never their inbox; anything absent or malformed reads as ON, because muting a rota publication over a bad settings blob is worse
 * than sending it. A row that keeps failing is abandoned after five attempts, backing off between them.
 */
final class Dispatcher
{
    public const MAX_ATTEMPTS = 5;
    private const CLAIM_STALE_MINUTES = 10;
    private const EVENT_KEY = ['rota' => 'rota_published', 'leave' => 'leave_updates', 'swap' => 'swap_requests', 'announcement' => 'announcements'];
    /** Built-in wording, used when neither the organisation nor the platform has a template row. */
    private const DEFAULT_EMAIL = ['subject' => '{{title}}', 'body' => "Hi {{staff_name}},\n\n{{title}}{{body_line}}\n\nOpen RotaFlow: {{app_url}}/app\n\n{{org_name}} via RotaFlow"];

    public function __construct(private readonly Ctx $ctx, private readonly Pusher $pusher = new NullPusher()) {}

    /** @return array{sent:int,failed:int,abandoned:int} */
    public function drain(int $limit = 50): array
    {
        $pdo = $this->ctx->pdo;
        $pdo->exec("UPDATE notification_outbox SET status = 'pending' WHERE status = 'sending' AND claimed_at < DATE_SUB(UTC_TIMESTAMP(), INTERVAL " . self::CLAIM_STALE_MINUTES . ' MINUTE)');
        $due = $pdo->prepare("SELECT id FROM notification_outbox WHERE status = 'pending' AND next_attempt_at <= UTC_TIMESTAMP() ORDER BY created_at LIMIT " . max(1, $limit));
        $due->execute();
        $n = ['sent' => 0, 'failed' => 0, 'abandoned' => 0];
        foreach ($due->fetchAll(\PDO::FETCH_COLUMN) as $id) {
            $claim = $pdo->prepare("UPDATE notification_outbox SET status = 'sending', claimed_at = UTC_TIMESTAMP(), attempts = attempts + 1 WHERE id = ? AND status = 'pending'");
            $claim->execute([$id]);
            if ($claim->rowCount() !== 1) {
                continue;
            }
            $row = $pdo->prepare('SELECT * FROM notification_outbox WHERE id = ?');
            $row->execute([$id]);
            $r = $row->fetch();
            try {
                $this->deliver(json_decode((string) $r['payload'], true) ?: []);
                $pdo->prepare("UPDATE notification_outbox SET status = 'sent', dispatched_at = UTC_TIMESTAMP(), last_error = NULL WHERE id = ?")->execute([$id]);
                $n['sent']++;
            } catch (\Throwable $e) {
                $abandon = (int) $r['attempts'] >= self::MAX_ATTEMPTS;
                $backoff = min(3600, 60 * (2 ** ((int) $r['attempts'] - 1)));
                $pdo->prepare('UPDATE notification_outbox SET status = ?, last_error = ?, next_attempt_at = DATE_ADD(UTC_TIMESTAMP(), INTERVAL ? SECOND) WHERE id = ?')
                    ->execute([$abandon ? 'abandoned' : 'pending', get_class($e), $backoff, $id]);
                $this->ctx->log('outbox_failed ' . get_class($e));
                $n[$abandon ? 'abandoned' : 'failed']++;
            }
        }
        return $n;
    }

    /** @param array<string,mixed> $p the queued payload: orgId, userIds, type, title, body */
    public function deliver(array $p): void
    {
        $pdo = $this->ctx->pdo;
        $org = (string) ($p['orgId'] ?? '');
        $type = (string) ($p['type'] ?? '');
        $title = (string) ($p['title'] ?? '');
        $body = isset($p['body']) && is_string($p['body']) ? $p['body'] : null;
        $ids = array_values(array_filter((array) ($p['userIds'] ?? []), 'is_string'));
        if ($org === '' || $type === '' || $title === '' || $ids === []) {
            throw new \InvalidArgumentException('bad_payload');
        }
        $in = implode(',', array_fill(0, count($ids), '?'));
        $m = $pdo->prepare("SELECT u.id, u.email, u.full_name, COALESCE(a.notifications_enabled, 1) AS enabled FROM memberships m JOIN users u ON u.id = m.user_id LEFT JOIN app_settings a ON a.user_id = u.id WHERE m.org_id = ? AND m.status = 'active' AND u.id IN ($in)");
        $m->execute([$org, ...$ids]);
        $members = $m->fetchAll();
        if ($members === []) {
            return; // nobody left to tell
        }
        $o = $pdo->prepare('SELECT name, settings FROM organisations WHERE id = ?');
        $o->execute([$org]);
        $orgRow = $o->fetch() ?: ['name' => 'RotaFlow', 'settings' => '{}'];
        $matrix = self::matrix(json_decode((string) $orgRow['settings'], true), self::EVENT_KEY[$type] ?? null);
        $log = [];
        $note = static function (string $user, string $channel, string $status, ?string $detail = null) use (&$log, $org, $type): void {
            $log[] = [$org, $user, $channel, $status, $type, $detail === null ? null : Str::cut($detail, 500)];
        };

        // In-app: the inbox. Governed by the organisation only; a person's own mute never empties it.
        if ($matrix['in_app']) {
            $ins = $pdo->prepare("INSERT INTO notifications (id, org_id, user_id, type, title, body, channel) VALUES (?, ?, ?, ?, ?, ?, 'in_app')");
            foreach ($members as $u) {
                $ins->execute([Db::uuid(), $org, $u['id'], $type, $title, $body]);
                $note($u['id'], 'in_app', 'sent');
            }
        } else {
            foreach ($members as $u) {
                $note($u['id'], 'in_app', 'skipped', 'in-app disabled for this event by the organisation');
            }
        }

        $reachable = [];
        foreach ($members as $u) {
            if ((int) $u['enabled'] === 0) {
                $note($u['id'], 'email', 'skipped', 'recipient opted out');
                $note($u['id'], 'push', 'skipped', 'recipient opted out');
            } else {
                $reachable[] = $u;
            }
        }
        $wanted = array_values(array_filter((array) ($p['channels'] ?? ['push', 'email']), 'is_string'));

        if (in_array('email', $wanted, true)) {
            if (!$matrix['email']) {
                foreach ($reachable as $u) {
                    $note($u['id'], 'email', 'skipped', 'channel disabled for this event by the organisation');
                }
            } else {
                $this->email($org, (string) $orgRow['name'], $type, $title, $body, $reachable, $note);
            }
        }
        if (in_array('push', $wanted, true)) {
            if (!$matrix['push']) {
                foreach ($reachable as $u) {
                    $note($u['id'], 'push', 'skipped', 'channel disabled for this event by the organisation');
                }
            } else {
                $this->push($title, $body, $reachable, $note);
            }
        }
        $ins = $pdo->prepare('INSERT INTO notification_deliveries (org_id, user_id, channel, status, event_type, detail) VALUES (?, ?, ?, ?, ?, ?)');
        foreach ($log as $row) {
            $ins->execute($row);
        }
    }

    /** @param list<array<string,mixed>> $users @param callable(string,string,string,?string):void $note */
    private function email(string $org, string $orgName, string $type, string $title, ?string $body, array $users, callable $note): void
    {
        if ($users === []) {
            return;
        }
        $mail = Mail::forOrg($this->ctx, $org);
        if ($mail === null) {
            foreach ($users as $u) {
                $note($u['id'], 'email', 'skipped', 'no SMTP configured for this organisation or platform');
            }
            return;
        }
        [$tplSubject, $tplBody] = $this->template($org, $type);
        foreach ($users as $u) {
            $vars = ['org_name' => $orgName, 'staff_name' => $this->firstName($org, $u), 'title' => $title, 'body' => (string) $body, 'body_line' => $body === null || $body === '' ? '' : "\n\n" . $body, 'app_url' => rtrim($this->ctx->appUrl, '/')];
            $subject = self::fill($tplSubject, $vars);
            $text = self::fill($tplBody, $vars);
            if ($mail['mailer']->send((string) $u['email'], $subject, $text)) {
                $note($u['id'], 'email', 'sent');
            } else {
                $note($u['id'], 'email', 'failed', $mail['mailer']->lastError());
            }
        }
    }

    /** @param list<array<string,mixed>> $users @param callable(string,string,string,?string):void $note */
    private function push(string $title, ?string $body, array $users, callable $note): void
    {
        if ($users === []) {
            return;
        }
        $in = implode(',', array_fill(0, count($users), '?'));
        $q = $this->ctx->pdo->prepare("SELECT id, user_id, endpoint, p256dh, auth_key FROM push_subscriptions WHERE user_id IN ($in)");
        $q->execute(array_column($users, 'id'));
        $subs = $q->fetchAll();
        $pushed = [];
        foreach ($subs as $s) {
            $out = $this->pusher->send(['endpoint' => $s['endpoint'], 'p256dh' => $s['p256dh'], 'auth_key' => $s['auth_key']], ['title' => $title, 'body' => $body]);
            $pushed[$s['user_id']] = true;
            if ($out === 'unavailable') {
                $note($s['user_id'], 'push', 'skipped', 'web push is not configured on this deployment');
                continue;
            }
            $note($s['user_id'], 'push', $out);
            if ($out === 'expired') {
                $this->ctx->pdo->prepare('DELETE FROM push_subscriptions WHERE id = ?')->execute([$s['id']]);
            }
        }
        foreach ($users as $u) {
            if (!isset($pushed[$u['id']])) {
                $note($u['id'], 'push', 'skipped', 'no push subscription on any device');
            }
        }
    }

    /** @return array{0:string,1:string} the organisation's wording, else the platform's, else the built-in */
    private function template(string $org, string $type): array
    {
        $q = $this->ctx->pdo->prepare("SELECT subject, body FROM notification_templates WHERE `key` = ? AND channel = 'email' AND org_key IN (?, '-') ORDER BY org_key = '-' LIMIT 1");
        $q->execute([$type, $org]);
        $r = $q->fetch();
        return $r === false ? [self::DEFAULT_EMAIL['subject'], self::DEFAULT_EMAIL['body']] : [(string) $r['subject'], (string) $r['body']];
    }

    /** @param array<string,mixed> $user */
    private function firstName(string $org, array $user): string
    {
        $q = $this->ctx->pdo->prepare('SELECT first_name FROM staff_profiles WHERE org_id = ? AND user_id = ?');
        $q->execute([$org, $user['id']]);
        $n = $q->fetchColumn();
        if (is_string($n) && $n !== '') {
            return $n;
        }
        $full = trim((string) ($user['full_name'] ?? ''));
        return $full !== '' ? explode(' ', $full, 2)[0] : 'there';
    }

    /** Replaces {{name}} with a value in ONE pass, so a value that itself contains "{{x}}" is never expanded again. */
    public static function fill(string $template, array $vars): string
    {
        return preg_replace_callback('/\{\{([a-z_]+)\}\}/', static fn (array $m): string => (string) ($vars[$m[1]] ?? ''), $template) ?? $template;
    }

    /**
     * Which channels the organisation permits for an event. Anything absent or malformed is ON.
     * @param mixed $settings
     * @return array{in_app:bool,email:bool,push:bool}
     */
    public static function matrix(mixed $settings, ?string $eventKey): array
    {
        $on = ['in_app' => true, 'email' => true, 'push' => true];
        $row = is_array($settings) && $eventKey !== null && is_array($settings['notification_defaults'] ?? null) && is_array($settings['notification_defaults'][$eventKey] ?? null) ? $settings['notification_defaults'][$eventKey] : null;
        if ($row === null) {
            return $on;
        }
        foreach ($on as $channel => $_) {
            if (is_bool($row[$channel] ?? null)) {
                $on[$channel] = $row[$channel];
            }
        }
        return $on;
    }
}
