<?php
declare(strict_types=1);

namespace RotaFlow\Mod;

use RotaFlow\{Audit, Ctx, Db, HttpError, Input, Module, Notify, Scope, Time};

/**
 * Platform announcements: the platform telling organisations something ("maintenance on Tuesday"). Written and sent by owners and admins; a
 * delivery is one row per organisation, and the organisation's owners and managers are told through the ordinary notification outbox, so the
 * organisation's own channel settings and every person's mute apply. Maintenance and incident notices ignore an organisation's opt-out;
 * product, billing and policy notices respect it. "Sent" means queued: a delivery is stamped delivered only when the outbox row really went.
 */
final class PlatformAnnouncements implements Module
{
    private const KINDS = ['maintenance', 'incident', 'product', 'billing', 'policy'];
    private const ALWAYS = ['maintenance', 'incident'];
    private const PLANS = ['starter', 'professional', 'business', 'enterprise'];

    public function __construct(private readonly Ctx $ctx) {}

    public function routes(): array
    {
        return [
            ['GET', '/platform/announcements', $this->list(...)],
            ['POST', '/platform/announcements', $this->create(...)],
            ['POST', '/platform/announcements/{a}/publish', $this->publishNow(...)],
            ['POST', '/platform/announcements/{a}/cancel', $this->cancel(...)],
            ['GET', '/orgs/{o}/platform-announcements', $this->mine(...)],
            ['POST', '/orgs/{o}/platform-announcements/{a}/read', $this->read(...)],
            ['POST', '/orgs/{o}/platform-announcements/opt-out', $this->optOut(...)],
        ];
    }

    private function staff(array $user, array $roles): string
    {
        $r = Scope::platformRole($this->ctx->pdo, $user['id']);
        if ($r === null || !in_array($r, $roles, true)) {
            throw HttpError::notFound();
        }
        return $r;
    }

    // ---- the platform side -------------------------------------------------------------------------------

    /** Every staff role sees the list; delivery counts only for operational staff. */
    private function list(array $user, array $in, string $ip): array
    {
        $role = $this->staff($user, ['platform_owner', 'platform_admin', 'platform_support', 'platform_finance']);
        $rows = $this->ctx->pdo->query('SELECT id, title, body, kind, audience, audience_plans, status, scheduled_for, sent_at, created_at FROM platform_announcements ORDER BY COALESCE(sent_at, scheduled_for, created_at) DESC, id LIMIT 100')->fetchAll();
        $stats = [];
        if ($role !== 'platform_finance') {
            $q = $this->ctx->pdo->query('SELECT announcement_id, COUNT(*) AS recipients, SUM(sent_at IS NULL AND failed_at IS NULL) AS queued, SUM(sent_at IS NOT NULL) AS delivered, SUM(failed_at IS NOT NULL) AS failed, SUM(read_at IS NOT NULL) AS `read` FROM platform_announcement_deliveries GROUP BY announcement_id');
            foreach ($q->fetchAll() as $s) {
                $stats[$s['announcement_id']] = array_map('intval', array_diff_key($s, ['announcement_id' => 1]));
            }
        }
        foreach ($rows as &$r) {
            $r['audience_plans'] = json_decode((string) $r['audience_plans'], true) ?? [];
            $r['stats'] = $role === 'platform_finance' ? null : ($stats[$r['id']] ?? ['recipients' => 0, 'queued' => 0, 'delivered' => 0, 'failed' => 0, 'read' => 0]);
        }
        return [200, ['announcements' => $rows]];
    }

    private function create(array $user, array $in, string $ip): array
    {
        $this->staff($user, ['platform_owner', 'platform_admin']);
        $title = Input::reqStr($in, 'title', 200);
        $body = Input::reqStr($in, 'body', 10000);
        $kind = $in['kind'] ?? 'product';
        $audience = $in['audience'] ?? 'all';
        if (!is_string($kind) || !in_array($kind, self::KINDS, true)) {
            throw HttpError::invalid('kind is not recognised');
        }
        if (!is_string($audience) || !in_array($audience, ['all', 'plans'], true)) {
            throw HttpError::invalid("audience must be 'all' or 'plans'");
        }
        $plans = $in['plans'] ?? [];
        if (!is_array($plans) || !array_is_list($plans) || array_diff($plans, self::PLANS) !== [] || ($audience === 'plans' && $plans === [])) {
            throw HttpError::invalid($audience === 'plans' ? 'Choose at least one plan to send to' : 'plans must be a list of plan codes');
        }
        $when = array_key_exists('scheduled_for', $in) && $in['scheduled_for'] !== null ? Time::parseInstant($in['scheduled_for'], 'scheduled_for') : null;
        $id = Db::uuid();
        $pdo = $this->ctx->pdo;
        $pdo->prepare('INSERT INTO platform_announcements (id, title, body, kind, audience, audience_plans, status, scheduled_for, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
            ->execute([$id, $title, $body, $kind, $audience, json_encode(array_values(array_unique($plans))), $when === null ? 'draft' : 'scheduled', $when, $user['id']]);
        Audit::log($pdo, null, $user['id'], 'announcement.created', 'platform_announcements', $id, ['title' => $title, 'audience' => $audience], 'info', 'platform_only', $ip);
        return [201, ['id' => $id, 'status' => $when === null ? 'draft' : 'scheduled']];
    }

    private function publishNow(array $user, array $in, string $ip, string $a): array
    {
        $this->staff($user, ['platform_owner', 'platform_admin']);
        $this->ctx->limits->hit('announce-publish', $user['id'], 20, 3600);
        return [200, ['queued' => self::publish($this->ctx->pdo, $a, $user['id'], $ip, false)]];
    }

    private function cancel(array $user, array $in, string $ip, string $a): array
    {
        $this->staff($user, ['platform_owner', 'platform_admin']);
        $pdo = $this->ctx->pdo;
        $pdo->beginTransaction();
        try {
            $q = $pdo->prepare('SELECT title, status FROM platform_announcements WHERE id = ? FOR UPDATE');
            $q->execute([$a]);
            $row = $q->fetch() ?: throw HttpError::notFound();
            if ($row['status'] === 'sent') {
                throw HttpError::conflict('already_sent', 'That announcement has already been sent and cannot be cancelled');
            }
            $pdo->prepare("UPDATE platform_announcements SET status = 'cancelled', scheduled_for = NULL WHERE id = ?")->execute([$a]);
            Audit::log($pdo, null, $user['id'], 'announcement.cancelled', 'platform_announcements', $a, ['title' => $row['title'], 'before' => $row['status']], 'info', 'platform_only', $ip);
            $pdo->commit();
        } catch (\Throwable $e) {
            $pdo->rollBack();
            throw $e;
        }
        return [200, ['id' => $a, 'status' => 'cancelled']];
    }

    /**
     * Queues the announcement for every organisation in its audience that has not had it, in one transaction under a lock on the announcement.
     * Returns how many organisations were reached, counting those with nobody to address (they are recorded as failed, with the reason).
     * @param ?string $actor null when the scheduler sends it
     */
    public static function publish(\PDO $pdo, string $id, ?string $actor, ?string $ip, bool $scheduled): int
    {
        $pdo->beginTransaction();
        try {
            $q = $pdo->prepare('SELECT * FROM platform_announcements WHERE id = ? FOR UPDATE');
            $q->execute([$id]);
            $a = $q->fetch() ?: throw HttpError::notFound();
            if ($a['status'] === 'sent') {
                throw HttpError::conflict('already_sent', 'That announcement has already been sent');
            }
            if ($a['status'] === 'cancelled') {
                throw HttpError::conflict('cancelled', 'That announcement was cancelled');
            }
            if ($scheduled && $a['status'] !== 'scheduled') {
                throw HttpError::conflict('not_scheduled', "Announcement is {$a['status']} rather than scheduled");
            }
            $where = ["o.status = 'active'", 'NOT EXISTS (SELECT 1 FROM platform_announcement_deliveries d WHERE d.announcement_id = ? AND d.org_id = o.id)'];
            $args = [$id];
            if (!in_array($a['kind'], self::ALWAYS, true)) {
                $where[] = 'NOT EXISTS (SELECT 1 FROM platform_announcement_optouts x WHERE x.org_id = o.id)';
            }
            if ($a['audience'] === 'plans') {
                $plans = json_decode((string) $a['audience_plans'], true) ?: [];
                $where[] = 'o.plan IN (' . implode(',', array_fill(0, count($plans), '?')) . ')';
                array_push($args, ...$plans);
            }
            $orgs = $pdo->prepare('SELECT o.id FROM organisations o WHERE ' . implode(' AND ', $where) . ' ORDER BY o.id');
            $orgs->execute($args);
            $n = 0;
            foreach ($orgs->fetchAll(\PDO::FETCH_COLUMN) as $org) {
                $users = Notify::managers($pdo, $org);
                $outbox = Notify::enqueue($pdo, $org, 'platform/announcement', $users, 'announcement', $a['title'], $a['body']);
                $pdo->prepare('INSERT IGNORE INTO platform_announcement_deliveries (id, announcement_id, org_id, outbox_id, failed_at, failure_reason) VALUES (?, ?, ?, ?, ?, ?)')
                    ->execute([Db::uuid(), $id, $org, $outbox, $outbox === null ? gmdate('Y-m-d H:i:s') : null, $outbox === null ? 'No active owner or manager to address' : null]);
                $n++;
            }
            $pdo->prepare("UPDATE platform_announcements SET status = 'sent', sent_at = UTC_TIMESTAMP() WHERE id = ?")->execute([$id]);
            Audit::log($pdo, null, $actor, 'announcement.sent', 'platform_announcements', $id, ['title' => $a['title'], 'before' => $a['status'], 'after' => "$n organisations queued" . ($scheduled ? ' (scheduled)' : '')], 'info', 'platform_only', $ip);
            $pdo->commit();
        } catch (\Throwable $e) {
            $pdo->rollBack();
            throw $e;
        }
        return $n;
    }

    /** Stamps each delivery from what its outbox row really did: sent means delivered, abandoned means failed. Returns the number stamped delivered. */
    public static function reconcile(\PDO $pdo): int
    {
        $sent = $pdo->exec("UPDATE platform_announcement_deliveries d JOIN notification_outbox o ON o.id = d.outbox_id SET d.sent_at = COALESCE(o.dispatched_at, UTC_TIMESTAMP()) WHERE d.sent_at IS NULL AND d.failed_at IS NULL AND o.status = 'sent'");
        $pdo->exec("UPDATE platform_announcement_deliveries d JOIN notification_outbox o ON o.id = d.outbox_id SET d.failed_at = UTC_TIMESTAMP(), d.failure_reason = COALESCE(o.last_error, 'Dispatch abandoned after repeated failures') WHERE d.sent_at IS NULL AND d.failed_at IS NULL AND o.status = 'abandoned'");
        return (int) $sent;
    }

    /** Sends what is due (twenty a run; one that fails is retried next run), then reconciles. Runs after the outbox drain, so a delivery is stamped in the same run it went. */
    public static function cron(Ctx $ctx): string
    {
        $pdo = $ctx->pdo;
        $due = $pdo->query("SELECT id FROM platform_announcements WHERE status = 'scheduled' AND scheduled_for IS NOT NULL AND scheduled_for <= UTC_TIMESTAMP() ORDER BY scheduled_for LIMIT 20")->fetchAll(\PDO::FETCH_COLUMN);
        $sent = $failed = 0;
        foreach ($due as $id) {
            try {
                self::publish($pdo, $id, null, null, true);
                $sent++;
            } catch (\Throwable) {
                $failed++;
            }
        }
        return "announcements: published=$sent failed=$failed reconciled=" . self::reconcile($pdo);
    }

    // ---- the organisation's side --------------------------------------------------------------------------

    /** Owners and managers (the people it was sent to) see what the platform sent their organisation. */
    private function mine(array $user, array $in, string $ip, string $o): array
    {
        $m = Scope::membership($this->ctx->pdo, $user['id'], $o);
        Scope::require($m, Scope::MANAGERS);
        $q = $this->ctx->pdo->prepare("SELECT a.id, a.title, a.body, a.kind, a.sent_at, d.read_at FROM platform_announcement_deliveries d JOIN platform_announcements a ON a.id = d.announcement_id AND a.status = 'sent' WHERE d.org_id = ? ORDER BY a.sent_at DESC, a.id LIMIT 50");
        $q->execute([$o]);
        $opt = $this->ctx->pdo->prepare('SELECT 1 FROM platform_announcement_optouts WHERE org_id = ?');
        $opt->execute([$o]);
        return [200, ['announcements' => $q->fetchAll(), 'opted_out' => $opt->fetchColumn() !== false]];
    }

    /** Idempotent: the first reader's time and name stay. */
    private function read(array $user, array $in, string $ip, string $o, string $a): array
    {
        $m = Scope::membership($this->ctx->pdo, $user['id'], $o);
        Scope::require($m, Scope::MANAGERS);
        $u = $this->ctx->pdo->prepare('UPDATE platform_announcement_deliveries SET read_at = COALESCE(read_at, UTC_TIMESTAMP()), read_by = COALESCE(read_by, ?) WHERE announcement_id = ? AND org_id = ?');
        $u->execute([$user['id'], $a, $o]);
        $e = $this->ctx->pdo->prepare('SELECT 1 FROM platform_announcement_deliveries WHERE announcement_id = ? AND org_id = ?');
        $e->execute([$a, $o]);
        if ($e->fetchColumn() === false) {
            throw HttpError::notFound();
        }
        return [200, ['id' => $a]];
    }

    /** Owner only. Opting out silences product, billing and policy notices; maintenance and incident notices still arrive. */
    private function optOut(array $user, array $in, string $ip, string $o): array
    {
        $m = Scope::membership($this->ctx->pdo, $user['id'], $o);
        Scope::requireReal($m, ['owner']);
        if (!isset($in['opted_out']) || !is_bool($in['opted_out'])) {
            throw HttpError::invalid('opted_out must be true or false');
        }
        $pdo = $this->ctx->pdo;
        if ($in['opted_out']) {
            $pdo->prepare('INSERT IGNORE INTO platform_announcement_optouts (org_id, opted_out_by) VALUES (?, ?)')->execute([$o, $user['id']]);
        } else {
            $pdo->prepare('DELETE FROM platform_announcement_optouts WHERE org_id = ?')->execute([$o]);
        }
        return [200, ['opted_out' => $in['opted_out']]];
    }
}
