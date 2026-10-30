<?php
declare(strict_types=1);

namespace RotaFlow\Mod;

use RotaFlow\{Audit, Ctx, Db, FileStore, HttpError, Input, Module, Scope};

/**
 * Data-subject requests and erasure. Platform staff keep a register of requests (one month to answer, once extendable by two); a person can
 * also ask for their own data. Closing an ERASURE request as completed queues the person's login to be deleted (from Clerk, then here) by cron,
 * and refuses to close while the person is the only owner of an organisation or still holds a platform role - a refused close leaves the
 * request open. Erasing a staff member's data keeps their rota history on an anonymous row, which is the deliberate retained set below.
 */
final class Gdpr implements Module
{
    private const KINDS = ['access', 'portability', 'rectification', 'erasure', 'restriction', 'objection'];
    private const SELF_KINDS = ['access', 'portability', 'rectification', 'erasure'];
    private const STATUSES = ['received', 'in_progress', 'awaiting_information', 'completed', 'refused'];
    private const OPERATIONAL = ['platform_owner', 'platform_admin', 'platform_support'];
    private const MAX_OPEN_SELF = 5;
    private const ATTEMPTS = 5;

    /** staff_profiles columns an erasure clears. */
    public const ERASURE_CLEARED = ['first_name', 'last_name', 'email', 'phone', 'photo_url', 'photo_path', 'payroll_id', 'user_id', 'active'];
    /** staff_profiles columns an erasure keeps, because rota, pay and attendance history hangs off them and carries no personal detail. A new column must be listed in one of the two. */
    public const ERASURE_RETAINED = ['id', 'org_id', 'job_title', 'job_title_id', 'department_id', 'contract_type', 'weekly_hours', 'holiday_allowance', 'skills', 'start_date', 'created_at', 'updated_at'];

    /** @param ?callable(string $method, string $url, array<string,string> $headers):array{0:int,1:string} $clerk injected by tests */
    public function __construct(private readonly Ctx $ctx, private $clerk = null) {}

    public function routes(): array
    {
        return [
            ['GET', '/platform/gdpr', $this->list(...)],
            ['POST', '/platform/gdpr', $this->log(...)],
            ['POST', '/platform/gdpr/{g}/status', $this->setStatus(...)],
            ['POST', '/platform/gdpr/{g}/extend', $this->extend(...)],
            ['GET', '/orgs/{o}/gdpr', $this->orgList(...)],
            ['POST', '/me/data-requests', $this->requestMine(...)],
            ['GET', '/me/data-requests', $this->mine(...)],
            ['POST', '/orgs/{o}/staff/{s}/erase', $this->eraseStaff(...)],
        ];
    }

    private function staff(array $user, array $roles): void
    {
        if (!in_array(Scope::platformRole($this->ctx->pdo, $user['id']), $roles, true)) {
            throw HttpError::notFound();
        }
    }

    /** Calendar months with end-of-month clamping (31 January plus a month is 28 or 29 February), never the 30-day approximation. */
    public static function addMonths(string $date, int $months): string
    {
        $d = \DateTimeImmutable::createFromFormat('!Y-m-d', $date) ?: throw new \InvalidArgumentException('date');
        $total = (int) $d->format('Y') * 12 + ((int) $d->format('n') - 1) + $months;
        $y = intdiv($total, 12);
        $m = $total % 12 + 1;
        $last = (int) (new \DateTimeImmutable(sprintf('%04d-%02d-01', $y, $m)))->format('t');
        return sprintf('%04d-%02d-%02d', $y, $m, min((int) $d->format('j'), $last));
    }

    // ---- the register ----------------------------------------------------------------------------

    private function list(array $user, array $in, string $ip): array
    {
        $this->staff($user, self::OPERATIONAL);
        $open = ($in['open'] ?? null) === '1' || ($in['open'] ?? null) === 1;
        $rows = $this->ctx->pdo->query('SELECT g.*, o.name AS org_name FROM gdpr_requests g LEFT JOIN organisations o ON o.id = g.org_id' . ($open ? " WHERE g.status NOT IN ('completed','refused')" : '') . ' ORDER BY g.due_on, g.id LIMIT 200')->fetchAll();
        $total = (int) $this->ctx->pdo->query('SELECT COUNT(*) FROM gdpr_requests' . ($open ? " WHERE status NOT IN ('completed','refused')" : ''))->fetchColumn();
        return [200, ['requests' => $rows, 'total' => $total]];
    }

    /** Owner, admin and support log a request received by other means. */
    private function log(array $user, array $in, string $ip): array
    {
        $this->staff($user, self::OPERATIONAL);
        $email = strtolower(trim(Input::str($in, 'email')));
        $kind = $in['kind'] ?? null;
        if (filter_var($email, FILTER_VALIDATE_EMAIL) === false || strlen($email) > 255) {
            throw HttpError::invalid('Enter a valid email address');
        }
        if (!is_string($kind) || !in_array($kind, self::KINDS, true)) {
            throw HttpError::invalid('kind is not recognised');
        }
        $today = gmdate('Y-m-d');
        $received = Input::optDate($in, 'received_on') ?? $today;
        if ($received > $today) {
            throw HttpError::invalid('A request cannot be received in the future');
        }
        $org = Input::optStr($in, 'org_id', 36);
        if ($org !== null) {
            $e = $this->ctx->pdo->prepare('SELECT 1 FROM organisations WHERE id = ?');
            $e->execute([$org]);
            if ($e->fetchColumn() === false) {
                throw HttpError::invalid('That organisation does not exist');
            }
        }
        $id = $this->insert($email, Input::optStr($in, 'name', 200), $kind, $org, $received, $user['id']);
        Audit::log($this->ctx->pdo, $org, $user['id'], 'gdpr.request_logged', 'gdpr_requests', $id, ['kind' => $kind, 'received_on' => $received], 'info', 'org', $ip);
        return [201, ['id' => $id, 'due_on' => self::addMonths($received, 1)]];
    }

    private function insert(string $email, ?string $name, string $kind, ?string $org, string $received, ?string $assignee): string
    {
        $id = Db::uuid();
        $this->ctx->pdo->prepare('INSERT INTO gdpr_requests (id, org_id, subject_email, subject_name, kind, received_on, due_on, assigned_to) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
            ->execute([$id, $org, $email, $name, $kind, $received, self::addMonths($received, 1), $assignee]);
        return $id;
    }

    /**
     * Any status to any other. Completing or refusing needs an outcome note and stamps the close; moving to anything else clears the close but
     * keeps the note. Closing an erasure refuses while the person holds a platform role or is the only owner of an organisation, and otherwise
     * queues the login for deletion - all in one transaction, so a refusal changes nothing.
     */
    private function setStatus(array $user, array $in, string $ip, string $g): array
    {
        $this->staff($user, self::OPERATIONAL);
        $status = $in['status'] ?? null;
        if (!is_string($status) || !in_array($status, self::STATUSES, true)) {
            throw HttpError::invalid('status is not recognised');
        }
        $note = Input::optStr($in, 'note', 2000);
        $closing = in_array($status, ['completed', 'refused'], true);
        if ($closing && $note === null) {
            throw HttpError::invalid('Closing a request needs an outcome note saying what was done');
        }
        $pdo = $this->ctx->pdo;
        $pdo->beginTransaction();
        try {
            $q = $pdo->prepare('SELECT * FROM gdpr_requests WHERE id = ? FOR UPDATE');
            $q->execute([$g]);
            $r = $q->fetch() ?: throw HttpError::notFound();
            $queued = false;
            if ($r['kind'] === 'erasure' && $status === 'completed') {
                $queued = $this->queueLogin($r);
            }
            $pdo->prepare('UPDATE gdpr_requests SET status = ?, closed_at = ?, outcome_note = ? WHERE id = ?')
                ->execute([$status, $closing ? gmdate('Y-m-d H:i:s') : null, $closing ? $note : $r['outcome_note'], $g]);
            Audit::log($pdo, $r['org_id'], $user['id'], 'gdpr.request_' . $status, 'gdpr_requests', $g, ['from' => $r['status'], 'to' => $status, 'account_deletion_queued' => $queued], $status === 'refused' ? 'warning' : 'info', 'org', $ip);
            $pdo->commit();
        } catch (\Throwable $e) {
            $pdo->rollBack();
            throw $e;
        }
        return [200, ['id' => $g, 'status' => $status, 'account_deletion_queued' => $queued]];
    }

    /** @param array<string,mixed> $r the erasure request @return bool whether a login was queued */
    private function queueLogin(array $r): bool
    {
        $pdo = $this->ctx->pdo;
        $u = $pdo->prepare('SELECT id, clerk_user_id FROM users WHERE LOWER(email) = ?');
        $u->execute([strtolower($r['subject_email'])]);
        $person = $u->fetch();
        if ($person === false) {
            return false; // nobody signed in with that address: nothing to remove, and the case still closes
        }
        if (Scope::platformRole($pdo, $person['id']) !== null) {
            throw new HttpError(403, 'holds_platform_role', 'This person holds a platform role. Revoke it before closing the erasure, so the account can be removed');
        }
        $sole = $pdo->prepare("SELECT 1 FROM memberships m WHERE m.user_id = ? AND m.role = 'owner' AND NOT EXISTS (SELECT 1 FROM memberships o WHERE o.org_id = m.org_id AND o.role = 'owner' AND o.user_id <> m.user_id) LIMIT 1");
        $sole->execute([$person['id']]);
        if ($sole->fetchColumn() !== false) {
            throw HttpError::conflict('sole_owner', 'This person is the only owner of an organisation. Transfer ownership or delete the organisation before closing the erasure');
        }
        $pdo->prepare('INSERT INTO account_deletions (id, user_id, clerk_user_id, gdpr_request_id) VALUES (?, ?, ?, ?)')->execute([Db::uuid(), $person['id'], $person['clerk_user_id'], $r['id']]);
        return true;
    }

    /** Once only, by two months from the ORIGINAL due date, for a stated reason. Owner and admin. */
    private function extend(array $user, array $in, string $ip, string $g): array
    {
        $this->staff($user, ['platform_owner', 'platform_admin']);
        $reason = Input::reqStr($in, 'reason', 1000);
        if (\RotaFlow\Str::len($reason) < 15) {
            throw HttpError::invalid('An extension needs a reason of at least 15 characters: complexity or number of requests');
        }
        $pdo = $this->ctx->pdo;
        $pdo->beginTransaction();
        try {
            $q = $pdo->prepare('SELECT due_on, extended_to, org_id FROM gdpr_requests WHERE id = ? FOR UPDATE');
            $q->execute([$g]);
            $r = $q->fetch() ?: throw HttpError::notFound();
            if ($r['extended_to'] !== null) {
                throw HttpError::conflict('already_extended', 'This request has already been extended');
            }
            $to = self::addMonths($r['due_on'], 2);
            $pdo->prepare('UPDATE gdpr_requests SET extended_to = ?, extension_reason = ? WHERE id = ?')->execute([$to, $reason, $g]);
            Audit::log($pdo, $r['org_id'], $user['id'], 'gdpr.request_extended', 'gdpr_requests', $g, ['from' => $r['due_on'], 'to' => $to, 'reason' => $reason], 'warning', 'org', $ip);
            $pdo->commit();
        } catch (\Throwable $e) {
            $pdo->rollBack();
            throw $e;
        }
        return [200, ['extended_to' => $to]];
    }

    /** An owner sees the requests that name their organisation. */
    private function orgList(array $user, array $in, string $ip, string $o): array
    {
        $m = Scope::membership($this->ctx->pdo, $user['id'], $o);
        Scope::requireReal($m, ['owner']);
        $q = $this->ctx->pdo->prepare('SELECT id, subject_email, kind, status, received_on, due_on, extended_to, closed_at FROM gdpr_requests WHERE org_id = ? ORDER BY received_on DESC, id LIMIT 200');
        $q->execute([$o]);
        return [200, ['requests' => $q->fetchAll()]];
    }

    // ---- a person's own requests --------------------------------------------------------------------

    /** Asking again for the same thing returns the open one; at most five stay open. Restriction and objection go through support. */
    private function requestMine(array $user, array $in, string $ip): array
    {
        $pdo = $this->ctx->pdo;
        $kind = $in['kind'] ?? null;
        if (!is_string($kind) || !in_array($kind, self::SELF_KINDS, true)) {
            throw HttpError::invalid('That kind of request cannot be made here');
        }
        $org = Input::optStr($in, 'org_id', 36);
        if ($org !== null) {
            try {
                Scope::membership($pdo, $user['id'], $org);
            } catch (HttpError) {
                throw HttpError::forbidden('You are not a member of that organisation');
            }
        }
        $this->ctx->limits->hit('gdpr-self', $user['id'], 10, 3600);
        $me = $pdo->prepare('SELECT email, full_name FROM users WHERE id = ?');
        $me->execute([$user['id']]);
        $p = $me->fetch() ?: throw HttpError::unauthorized();
        $email = strtolower(trim((string) $p['email']));
        if (!str_contains($email, '@')) {
            throw HttpError::invalid('Your account has no email address to answer to');
        }
        $pdo->beginTransaction();
        try {
            $dup = $pdo->prepare("SELECT id, due_on FROM gdpr_requests WHERE subject_email = ? AND kind = ? AND status NOT IN ('completed','refused') ORDER BY received_on, created_at LIMIT 1 FOR UPDATE");
            $dup->execute([$email, $kind]);
            if (($d = $dup->fetch()) !== false) {
                $pdo->commit();
                return [200, ['id' => $d['id'], 'due_on' => $d['due_on'], 'already_open' => true]];
            }
            $n = $pdo->prepare("SELECT COUNT(*) FROM gdpr_requests WHERE subject_email = ? AND status NOT IN ('completed','refused')");
            $n->execute([$email]);
            if ((int) $n->fetchColumn() >= self::MAX_OPEN_SELF) {
                throw new HttpError(429, 'too_many_open', 'You already have five open requests. We will answer those first.');
            }
            $today = gmdate('Y-m-d');
            $id = $this->insert($email, $p['full_name'], $kind, $org, $today, null);
            Audit::log($pdo, $org, $user['id'], 'gdpr.request_logged', 'gdpr_requests', $id, ['kind' => $kind, 'received_on' => $today, 'self_service' => true], 'info', 'org', $ip);
            $pdo->commit();
        } catch (\Throwable $e) {
            if ($pdo->inTransaction()) {
                $pdo->rollBack();
            }
            throw $e;
        }
        return [201, ['id' => $id, 'due_on' => self::addMonths($today, 1), 'already_open' => false]];
    }

    /** Without the outcome note, the assignee or the name: only where the request stands. */
    private function mine(array $user, array $in, string $ip): array
    {
        $q = $this->ctx->pdo->prepare('SELECT g.id, g.kind, g.status, g.received_on, g.due_on, g.extended_to, g.closed_at FROM gdpr_requests g JOIN users u ON LOWER(u.email) = g.subject_email WHERE u.id = ? ORDER BY g.received_on DESC, g.created_at DESC LIMIT 50');
        $q->execute([$user['id']]);
        return [200, ['requests' => $q->fetchAll()]];
    }

    // ---- erasing a staff member ---------------------------------------------------------------------

    /**
     * Owner only. Deletes the person's emergency contacts, revokes their calendar feed, anonymises the record in place (the rota, pay and
     * attendance history stays attached to "Deleted Member"), and queues their stored files. The login and the membership are NOT touched:
     * removing the login is the tail of a completed erasure request. payroll_id is cleared here, the one sanctioned exception to its lock.
     */
    private function eraseStaff(array $user, array $in, string $ip, string $o, string $s): array
    {
        $pdo = $this->ctx->pdo;
        $m = Scope::membership($pdo, $user['id'], $o);
        Scope::requireReal($m, ['owner']);
        Scope::requireWritable($m);
        $pdo->beginTransaction();
        try {
            $q = $pdo->prepare('SELECT id FROM staff_profiles WHERE id = ? AND org_id = ? FOR UPDATE');
            $q->execute([$s, $o]);
            if ($q->fetchColumn() === false) {
                throw HttpError::notFound();
            }
            $pdo->prepare('DELETE FROM emergency_contacts WHERE org_id = ? AND staff_profile_id = ?')->execute([$o, $s]);
            $pdo->prepare('UPDATE calendar_feed_tokens SET revoked_at = UTC_TIMESTAMP() WHERE org_id = ? AND staff_profile_id = ? AND revoked_at IS NULL')->execute([$o, $s]);
            $pdo->prepare("UPDATE staff_profiles SET first_name = 'Deleted', last_name = 'Member', email = NULL, phone = NULL, photo_url = NULL, photo_path = NULL, payroll_id = NULL, user_id = NULL, active = 0 WHERE id = ? AND org_id = ?")->execute([$s, $o]);
            foreach (FileStore::BUCKETS as $bucket) { // once per folder: erasing again queues nothing new while the first is still owed
                $pdo->prepare("INSERT INTO storage_deletions (id, org_id, bucket, path, is_folder, reason) SELECT ?, ?, ?, ?, 1, 'person_erased' WHERE NOT EXISTS (SELECT 1 FROM storage_deletions WHERE bucket = ? AND path = ? AND status = 'pending')")->execute([Db::uuid(), $o, $bucket, "$o/$s", $bucket, "$o/$s"]);
            }
            Audit::log($pdo, $o, $user['id'], 'gdpr_anonymize', 'staff_profiles', $s, [], 'warning', 'org', $ip);
            $pdo->commit();
        } catch (\Throwable $e) {
            $pdo->rollBack();
            throw $e;
        }
        return [200, ['id' => $s]];
    }

    // ---- cron: finish the logins an erasure owes ------------------------------------------------------

    /**
     * Deletes each queued login from Clerk (a login Clerk no longer has counts as done), then from here, which severs the person from everything
     * that pointed at them. Needs `clerk_secret_key` in private config; without it the queue waits. Five failures abandon a row, visibly.
     */
    public static function cron(Ctx $ctx, ?callable $clerk = null): string
    {
        $pdo = $ctx->pdo;
        $pdo->exec("DELETE FROM account_deletions WHERE status = 'done' AND completed_at < DATE_SUB(UTC_TIMESTAMP(), INTERVAL 1 YEAR)");
        $rows = $pdo->query("SELECT id, user_id, clerk_user_id, attempts FROM account_deletions WHERE status = 'pending' ORDER BY created_at LIMIT 20")->fetchAll();
        if ($rows === []) {
            return 'account deletions: none owed';
        }
        $key = $ctx->config['clerk_secret_key'] ?? null;
        if (!is_string($key) || $key === '') {
            return 'account deletions: ' . count($rows) . ' owed, clerk_secret_key not set';
        }
        $done = $failed = 0;
        foreach ($rows as $r) {
            try {
                if ($r['clerk_user_id'] !== null) {
                    self::clerkDelete($key, (string) $r['clerk_user_id'], $clerk);
                }
                $pdo->beginTransaction();
                $pdo->prepare('DELETE FROM support_access_sessions WHERE admin_user_id = ?')->execute([$r['user_id']]);
                $pdo->prepare('DELETE FROM users WHERE id = ?')->execute([$r['user_id']]);
                $pdo->prepare("UPDATE account_deletions SET status = 'done', completed_at = UTC_TIMESTAMP(), last_error = NULL WHERE id = ?")->execute([$r['id']]);
                $pdo->commit();
                $done++;
            } catch (\Throwable $e) {
                if ($pdo->inTransaction()) {
                    $pdo->rollBack();
                }
                $n = (int) $r['attempts'] + 1;
                $pdo->prepare('UPDATE account_deletions SET attempts = ?, status = ?, last_error = ? WHERE id = ?')->execute([$n, $n >= self::ATTEMPTS ? 'abandoned' : 'pending', substr(get_class($e) . ($e instanceof \RuntimeException ? ': ' . $e->getMessage() : ''), 0, 200), $r['id']]);
                $failed++;
            }
        }
        return "account deletions: done=$done failed=$failed";
    }

    /** @param ?callable $transport */
    private static function clerkDelete(string $key, string $clerkId, ?callable $transport): void
    {
        if (preg_match('/^user_[A-Za-z0-9]+$/', $clerkId) !== 1) {
            throw new \RuntimeException('not a Clerk user id');
        }
        $url = 'https://api.clerk.com/v1/users/' . $clerkId;
        $h = ['Authorization' => 'Bearer ' . $key];
        [$status] = $transport !== null ? $transport('DELETE', $url, $h) : self::curl($url, $h);
        if (($status < 200 || $status >= 300) && $status !== 404) {
            throw new \RuntimeException("clerk status $status");
        }
    }

    /** @param array<string,string> $headers @return array{0:int,1:string} */
    private static function curl(string $url, array $headers): array
    {
        $ch = curl_init($url);
        curl_setopt_array($ch, [CURLOPT_CUSTOMREQUEST => 'DELETE', CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 15, CURLOPT_CONNECTTIMEOUT => 5, CURLOPT_FOLLOWLOCATION => false, CURLOPT_PROTOCOLS => CURLPROTO_HTTPS, CURLOPT_SSL_VERIFYPEER => true, CURLOPT_SSL_VERIFYHOST => 2,
            CURLOPT_HTTPHEADER => array_map(static fn (string $k, string $v): string => "$k: $v", array_keys($headers), $headers)]);
        $out = curl_exec($ch);
        $code = (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
        curl_close($ch);
        return [$code, is_string($out) ? $out : ''];
    }
}
