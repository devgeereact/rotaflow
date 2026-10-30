<?php
declare(strict_types=1);

namespace RotaFlow\Mod;

use RotaFlow\{Audit, Ctx, Db, HttpError, Input, Module, Notify, Scope, SupportRules};

/**
 * The support desk. A customer opens a case and replies; platform staff (owner, admin, support - finance is not "operational") answer, assign,
 * set status and keep internal notes. A case is visible to the person who raised it, to an owner of its organisation, and to operational staff;
 * a case you may not see is a plain 404, never a different error from one that does not exist. Internal notes reach staff only.
 *
 * Tightened from the Postgres version: the case id is not probeable, and subject and body have limits (the old schema had none).
 */
final class Support implements Module
{
    private const CATEGORIES = ['question', 'bug', 'billing', 'feature', 'incident', 'access'];
    private const PRIORITIES = ['urgent', 'high', 'normal', 'low'];
    private const STATUSES = ['open', 'pending', 'on_hold', 'resolved', 'closed'];
    private const OPERATIONAL = ['platform_owner', 'platform_admin', 'platform_support'];

    public function __construct(private readonly Ctx $ctx) {}

    public function routes(): array
    {
        return [
            ['POST', '/support/cases', $this->open(...)],
            ['GET', '/support/cases', $this->mine(...)],
            ['GET', '/support/cases/{c}', $this->show(...)],
            ['POST', '/support/cases/{c}/reply', $this->reply(...)],
            ['POST', '/support/cases/{c}/rate', $this->rate(...)],
            ['GET', '/platform/support/cases', $this->queue(...)],
            ['POST', '/platform/support/cases/{c}/status', $this->setStatus(...)],
            ['POST', '/platform/support/cases/{c}/assign', $this->assign(...)],
            ['GET', '/platform/support/sla', $this->sla(...)],
            ['POST', '/platform/support/sla', $this->saveSla(...)],
        ];
    }

    private function operational(array $user): bool
    {
        return in_array(Scope::platformRole($this->ctx->pdo, $user['id']), self::OPERATIONAL, true);
    }

    private function requireOperational(array $user): void
    {
        if (!$this->operational($user)) {
            throw HttpError::notFound();
        }
    }

    /** @return array<string,mixed> the person */
    private function person(array $user): array
    {
        $q = $this->ctx->pdo->prepare('SELECT id, email, full_name FROM users WHERE id = ?');
        $q->execute([$user['id']]);
        return $q->fetch() ?: throw HttpError::unauthorized();
    }

    // ---- opening and reading ---------------------------------------------------------------------------

    private function open(array $user, array $in, string $ip): array
    {
        $pdo = $this->ctx->pdo;
        $subject = Input::reqStr($in, 'subject', 200);
        $body = Input::reqStr($in, 'body', 10000);
        $category = $in['category'] ?? 'question';
        $priority = $in['priority'] ?? 'normal';
        if (!is_string($category) || !in_array($category, self::CATEGORIES, true)) {
            throw HttpError::invalid('category is not recognised');
        }
        if (!is_string($priority) || !in_array($priority, self::PRIORITIES, true)) {
            throw HttpError::invalid('priority is not recognised');
        }
        $org = Input::optStr($in, 'org_id', 36);
        $staff = $this->operational($user);
        if ($org !== null && !$staff) {
            try {
                Scope::membership($pdo, $user['id'], $org);
            } catch (HttpError) {
                throw HttpError::forbidden('You are not a member of that organisation');
            }
        }
        if ($org !== null) {
            $e = $pdo->prepare('SELECT 1 FROM organisations WHERE id = ?');
            $e->execute([$org]);
            if ($e->fetchColumn() === false) {
                throw HttpError::invalid('That organisation does not exist');
            }
        }
        $this->ctx->limits->hit('support-open', $user['id'], 10, 3600);
        $me = $this->person($user);
        $email = $me['email'];
        if ($staff && ($over = Input::optStr($in, 'requester_email', 255)) !== null) {
            $email = strtolower($over); // staff opening a case on a customer's behalf; the requester id stays the staff member
        }
        if (filter_var($email, FILTER_VALIDATE_EMAIL) === false) {
            throw HttpError::invalid('requester_email must be an email address');
        }
        $id = Db::uuid();
        $pdo->beginTransaction();
        try {
            $pdo->exec('UPDATE support_counter SET n = LAST_INSERT_ID(n + 1) WHERE id = 1');
            $ref = SupportRules::reference((int) $pdo->query('SELECT LAST_INSERT_ID()')->fetchColumn());
            $now = gmdate('Y-m-d H:i:s');
            $due = SupportRules::deadlines($now, $this->target($priority));
            $pdo->prepare('INSERT INTO support_cases (id, reference, org_id, requester_id, requester_name, requester_email, subject, category, priority, first_response_due_at, resolution_due_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
                ->execute([$id, $ref, $org, $user['id'], $me['full_name'], $email, $subject, $category, $priority, $due['first_response_due_at'], $due['resolution_due_at'], $now]);
            $this->message($id, $user['id'], $me['full_name'], $staff ? 'platform' : 'customer', $body, false);
            Audit::log($pdo, $org, $user['id'], 'support_case.opened', 'support_cases', $id, ['reference' => $ref, 'priority' => $priority], $priority === 'urgent' ? 'warning' : 'info', 'org', $ip);
            $pdo->commit();
        } catch (\Throwable $e) {
            $pdo->rollBack();
            throw $e;
        }
        return [201, ['id' => $id, 'reference' => $ref]];
    }

    /** The cases I raised, and those of organisations I own. */
    private function mine(array $user, array $in, string $ip): array
    {
        $q = $this->ctx->pdo->prepare(
            "SELECT c.id, c.reference, c.org_id, c.subject, c.category, c.priority, c.status, c.created_at, c.updated_at, c.resolved_at, c.csat
               FROM support_cases c
              WHERE c.requester_id = ? OR c.org_id IN (SELECT org_id FROM memberships WHERE user_id = ? AND role = 'owner' AND status = 'active')
              ORDER BY c.created_at DESC LIMIT 100"
        );
        $q->execute([$user['id'], $user['id']]);
        return [200, ['cases' => $q->fetchAll()]];
    }

    private function show(array $user, array $in, string $ip, string $c): array
    {
        $case = $this->visible($user, $c);
        $staff = $this->operational($user);
        $m = $this->ctx->pdo->prepare('SELECT id, author_name, author_side, body, is_internal, created_at FROM support_case_messages WHERE case_id = ?' . ($staff ? '' : ' AND is_internal = 0') . ' ORDER BY created_at, id');
        $m->execute([$c]);
        $msgs = $m->fetchAll();
        foreach ($msgs as &$r) {
            $r['is_internal'] = (bool) $r['is_internal'];
        }
        return [200, ['case' => $this->present($case, $staff), 'messages' => $msgs, 'sla' => SupportRules::slaState($case, time())]];
    }

    /** @return array<string,mixed> the case, or a 404 for one the caller may not see */
    private function visible(array $user, string $c): array
    {
        $q = $this->ctx->pdo->prepare('SELECT * FROM support_cases WHERE id = ?');
        $q->execute([$c]);
        $case = $q->fetch();
        if ($case === false) {
            throw HttpError::notFound();
        }
        if ($this->operational($user) || $case['requester_id'] === $user['id']) {
            return $case;
        }
        if ($case['org_id'] !== null) {
            $o = $this->ctx->pdo->prepare("SELECT 1 FROM memberships WHERE org_id = ? AND user_id = ? AND role = 'owner' AND status = 'active'");
            $o->execute([$case['org_id'], $user['id']]);
            if ($o->fetchColumn() !== false) {
                return $case;
            }
        }
        throw HttpError::notFound();
    }

    /** @param array<string,mixed> $case @return array<string,mixed> */
    private function present(array $case, bool $staff): array
    {
        if (!$staff) {
            unset($case['assigned_to']);
        }
        return $case;
    }

    // ---- replying and rating ---------------------------------------------------------------------------

    private function reply(array $user, array $in, string $ip, string $c): array
    {
        $pdo = $this->ctx->pdo;
        $case = $this->visible($user, $c);
        $staff = $this->operational($user);
        $internal = $in['internal'] ?? false;
        if (!is_bool($internal)) {
            throw HttpError::invalid('internal must be true or false');
        }
        if ($internal && !$staff) {
            throw HttpError::forbidden('Only platform staff can write an internal note');
        }
        $body = Input::reqStr($in, 'body', 10000);
        $this->ctx->limits->hit('support-reply', $user['id'], 60, 3600);
        $me = $this->person($user);
        $pdo->beginTransaction();
        try {
            $id = $this->message($c, $user['id'], $me['full_name'], $staff ? 'platform' : 'customer', $body, $internal);
            if ($staff && !$internal && $case['first_response_at'] === null) {
                // the first public answer is the response the promise is measured by; it moves an untouched case to pending, once
                $pdo->prepare("UPDATE support_cases SET first_response_at = UTC_TIMESTAMP(), status = IF(status = 'open', 'pending', status) WHERE id = ? AND first_response_at IS NULL")->execute([$c]);
            }
            Audit::log($pdo, $case['org_id'], $user['id'], $internal ? 'support_case.note' : 'support_case.replied', 'support_cases', $c, ['reference' => $case['reference'], 'internal' => $internal], 'info', $internal ? 'platform_only' : 'org', $ip);
            if ($staff && !$internal && $case['org_id'] !== null && $case['requester_id'] !== null) {
                Notify::enqueue($pdo, $case['org_id'], 'support/replied', [$case['requester_id']], 'support', 'Reply on ' . $case['reference'], \RotaFlow\Str::cut(trim($body), 240));
            }
            $pdo->commit();
        } catch (\Throwable $e) {
            $pdo->rollBack();
            throw $e;
        }
        return [201, ['id' => $id]];
    }

    /** Only the person who raised it, once it has been resolved. A re-rating overwrites; a reopened case keeps its rating. */
    private function rate(array $user, array $in, string $ip, string $c): array
    {
        $case = $this->visible($user, $c);
        if ($case['requester_id'] !== $user['id']) {
            throw HttpError::forbidden('Only the person who raised a case can rate it');
        }
        if ($case['resolved_at'] === null) {
            throw new HttpError(422, 'not_resolved', 'Rate a case once it has been resolved');
        }
        $score = $in['score'] ?? null;
        if (!is_int($score) || $score < 1 || $score > 5) {
            throw HttpError::invalid('A satisfaction score is 1 to 5');
        }
        $comment = Input::optStr($in, 'comment', 2000);
        $this->ctx->pdo->prepare('UPDATE support_cases SET csat = ?, csat_comment = ? WHERE id = ?')->execute([$score, $comment, $c]);
        return [200, ['id' => $c, 'csat' => $score]];
    }

    // ---- the queue and its controls --------------------------------------------------------------------

    private function queue(array $user, array $in, string $ip): array
    {
        $this->requireOperational($user);
        $where = ['1 = 1'];
        $args = [];
        foreach (['status' => self::STATUSES, 'priority' => self::PRIORITIES, 'category' => self::CATEGORIES] as $f => $allowed) {
            $v = Input::optStr($in, $f, 20);
            if ($v !== null) {
                if (!in_array($v, $allowed, true)) {
                    throw HttpError::invalid("$f is not recognised");
                }
                $where[] = "c.$f = ?";
                $args[] = $v;
            }
        }
        if (($a = Input::optStr($in, 'assigned', 40)) !== null) {
            if ($a === 'unassigned') {
                $where[] = 'c.assigned_to IS NULL';
            } elseif ($a === 'me') {
                $where[] = 'c.assigned_to = ?';
                $args[] = $user['id'];
            } else {
                throw HttpError::invalid("assigned must be 'me' or 'unassigned'");
            }
        }
        if (($q = Input::optStr($in, 'q', 100)) !== null) {
            $where[] = '(c.reference LIKE ? OR c.subject LIKE ? OR c.requester_email LIKE ?)';
            $like = '%' . addcslashes($q, '%_\\') . '%';
            array_push($args, $like, $like, $like);
        }
        $limit = (int) (Input::optNum($in, 'limit', 1, 200) ?? 100);
        $st = $this->ctx->pdo->prepare(
            "SELECT c.*, o.name AS org_name FROM support_cases c LEFT JOIN organisations o ON o.id = c.org_id WHERE " . implode(' AND ', $where) . "
              ORDER BY FIELD(c.status, 'open','pending','on_hold','resolved','closed'), FIELD(c.priority, 'urgent','high','normal','low'), c.created_at LIMIT $limit"
        );
        $st->execute($args);
        $now = time();
        $rows = $st->fetchAll();
        foreach ($rows as &$r) {
            $r['sla'] = SupportRules::slaState($r, $now);
        }
        return [200, ['cases' => $rows]];
    }

    /** Any status to any other, as before. Resolving keeps the first resolution time; reopening clears it but keeps the rating. */
    private function setStatus(array $user, array $in, string $ip, string $c): array
    {
        $this->requireOperational($user);
        $status = $in['status'] ?? null;
        if (!is_string($status) || !in_array($status, self::STATUSES, true)) {
            throw HttpError::invalid('status is not recognised');
        }
        $note = Input::optStr($in, 'note', 10000);
        $pdo = $this->ctx->pdo;
        $q = $pdo->prepare('SELECT reference, org_id, status FROM support_cases WHERE id = ? FOR UPDATE');
        $pdo->beginTransaction();
        try {
            $q->execute([$c]);
            $case = $q->fetch() ?: throw HttpError::notFound();
            $done = in_array($status, ['resolved', 'closed'], true);
            $pdo->prepare('UPDATE support_cases SET status = ?, resolved_at = ' . ($done ? 'COALESCE(resolved_at, UTC_TIMESTAMP())' : 'NULL') . ' WHERE id = ?')->execute([$status, $c]);
            if ($note !== null) {
                $pdo->prepare('INSERT INTO support_case_messages (id, case_id, author_id, author_side, body, is_internal) VALUES (?, ?, ?, ?, ?, 1)')->execute([Db::uuid(), $c, $user['id'], 'platform', $note]);
            }
            Audit::log($pdo, $case['org_id'], $user['id'], 'support_case.' . $status, 'support_cases', $c, ['reference' => $case['reference'], 'before' => $case['status'], 'after' => $status], 'info', 'platform_only', $ip);
            $pdo->commit();
        } catch (\Throwable $e) {
            $pdo->rollBack();
            throw $e;
        }
        return [200, ['id' => $c, 'status' => $status]];
    }

    /** To active platform staff of any role, or to nobody (null). */
    private function assign(array $user, array $in, string $ip, string $c): array
    {
        $this->requireOperational($user);
        $agent = $in['agent_user_id'] ?? null;
        $pdo = $this->ctx->pdo;
        if ($agent !== null) {
            if (!is_string($agent) || Scope::platformRole($pdo, $agent) === null) {
                throw HttpError::invalid('A case can only be assigned to platform staff');
            }
        }
        $q = $pdo->prepare('SELECT reference, org_id, assigned_to FROM support_cases WHERE id = ?');
        $q->execute([$c]);
        $case = $q->fetch() ?: throw HttpError::notFound();
        $pdo->prepare('UPDATE support_cases SET assigned_to = ? WHERE id = ?')->execute([$agent, $c]);
        Audit::log($pdo, $case['org_id'], $user['id'], 'support_case.assigned', 'support_cases', $c, ['reference' => $case['reference'], 'before' => $case['assigned_to'] ?? 'unassigned', 'after' => $agent ?? 'unassigned'], 'info', 'platform_only', $ip);
        return [200, ['id' => $c, 'assigned_to' => $agent]];
    }

    // ---- promises ---------------------------------------------------------------------------------------

    private function sla(array $user, array $in, string $ip): array
    {
        $this->requireOperational($user);
        return [200, ['targets' => $this->ctx->pdo->query("SELECT priority, first_response_minutes, resolution_minutes FROM support_sla_targets ORDER BY FIELD(priority, 'urgent','high','normal','low')")->fetchAll()]];
    }

    /** Owner and admin only (the old table let finance write it; that was not a decision). Open cases keep their deadlines until their priority changes. */
    private function saveSla(array $user, array $in, string $ip): array
    {
        if (!in_array(Scope::platformRole($this->ctx->pdo, $user['id']), ['platform_owner', 'platform_admin'], true)) {
            throw HttpError::notFound();
        }
        $p = $in['priority'] ?? null;
        $first = $in['first_response_minutes'] ?? null;
        $res = $in['resolution_minutes'] ?? null;
        if (!is_string($p) || !in_array($p, self::PRIORITIES, true) || !is_int($first) || !is_int($res) || $first < 1 || $res < $first || $res > 525600) {
            throw HttpError::invalid('priority, first_response_minutes and resolution_minutes (not less than the first, at most a year) are required');
        }
        $this->ctx->pdo->prepare('UPDATE support_sla_targets SET first_response_minutes = ?, resolution_minutes = ? WHERE priority = ?')->execute([$first, $res, $p]);
        Audit::log($this->ctx->pdo, null, $user['id'], 'support.sla_changed', 'support_sla_targets', null, ['priority' => $p, 'first' => $first, 'resolution' => $res], 'info', 'platform_only', $ip);
        return [200, ['priority' => $p]];
    }

    /** @return ?array{first_response_minutes:int,resolution_minutes:int} */
    private function target(string $priority): ?array
    {
        $q = $this->ctx->pdo->prepare('SELECT first_response_minutes, resolution_minutes FROM support_sla_targets WHERE priority = ?');
        $q->execute([$priority]);
        $r = $q->fetch();
        return $r === false ? null : ['first_response_minutes' => (int) $r['first_response_minutes'], 'resolution_minutes' => (int) $r['resolution_minutes']];
    }

    private function message(string $caseId, string $author, ?string $name, string $side, string $body, bool $internal): string
    {
        $id = Db::uuid();
        $this->ctx->pdo->prepare('INSERT INTO support_case_messages (id, case_id, author_id, author_name, author_side, body, is_internal) VALUES (?, ?, ?, ?, ?, ?, ?)')->execute([$id, $caseId, $author, $name, $side, $body, $internal ? 1 : 0]);
        return $id;
    }
}
