<?php
declare(strict_types=1);

namespace RotaFlow\Mod;

use RotaFlow\{Audit, Ctx, Db, HttpError, Input, Module, Scope, Time};

/**
 * Platform incidents: declared, updated and resolved by platform staff, read by operational staff (finance does not read them).
 * Tightened from the Postgres version: an incident cannot start in the future, and a resolved incident cannot be half-reopened by an update.
 */
final class Incidents implements Module
{
    private const OPERATIONAL = ['platform_owner', 'platform_admin', 'platform_support'];
    private const SEVERITIES = ['critical', 'high', 'medium', 'low'];
    private const OPEN = ['investigating', 'identified', 'monitoring'];

    public function __construct(private readonly Ctx $ctx) {}

    public function routes(): array
    {
        return [
            ['GET', '/platform/incidents', $this->list(...)],
            ['GET', '/platform/incidents/{i}', $this->show(...)],
            ['POST', '/platform/incidents', $this->declare(...)],
            ['POST', '/platform/incidents/{i}/updates', $this->update(...)],
            ['POST', '/platform/incidents/{i}/resolve', $this->resolve(...)],
        ];
    }

    private function staff(array $user): void
    {
        if (!in_array(Scope::platformRole($this->ctx->pdo, $user['id']), self::OPERATIONAL, true)) {
            throw HttpError::notFound();
        }
    }

    private function list(array $user, array $in, string $ip): array
    {
        $this->staff($user);
        $open = ($in['open'] ?? null) === '1' || ($in['open'] ?? null) === 1;
        $rows = $this->ctx->pdo->query('SELECT id, reference, title, severity, status, service, started_at, resolved_at FROM incidents' . ($open ? " WHERE status <> 'resolved'" : '') . ' ORDER BY started_at DESC LIMIT 100')->fetchAll();
        return [200, ['incidents' => $rows]];
    }

    private function show(array $user, array $in, string $ip, string $i): array
    {
        $this->staff($user);
        $q = $this->ctx->pdo->prepare('SELECT * FROM incidents WHERE id = ?');
        $q->execute([$i]);
        $inc = $q->fetch() ?: throw HttpError::notFound();
        $u = $this->ctx->pdo->prepare('SELECT id, author_id, status, body, created_at FROM incident_updates WHERE incident_id = ? ORDER BY created_at, id');
        $u->execute([$i]);
        return [200, ['incident' => $inc, 'updates' => $u->fetchAll()]];
    }

    private function declare(array $user, array $in, string $ip): array
    {
        $this->staff($user);
        $title = Input::reqStr($in, 'title', 200);
        $impact = Input::reqStr($in, 'impact', 2000);
        $service = Input::reqStr($in, 'service', 100);
        $sev = $in['severity'] ?? null;
        if (!is_string($sev) || !in_array($sev, self::SEVERITIES, true)) {
            throw HttpError::invalid('severity must be critical, high, medium or low');
        }
        $now = gmdate('Y-m-d H:i:s');
        $started = array_key_exists('started_at', $in) && $in['started_at'] !== null ? Time::parseInstant($in['started_at'], 'started_at') : $now;
        if ($started > $now) {
            throw HttpError::invalid('An incident cannot have started in the future');
        }
        $this->ctx->limits->hit('incident-declare', $user['id'], 30, 3600);
        $pdo = $this->ctx->pdo;
        $id = Db::uuid();
        $pdo->beginTransaction();
        try {
            $pdo->exec('UPDATE incident_counter SET n = LAST_INSERT_ID(n + 1) WHERE id = 1');
            $ref = 'INC-' . str_pad((string) $pdo->query('SELECT LAST_INSERT_ID()')->fetchColumn(), 4, '0', STR_PAD_LEFT);
            $pdo->prepare('INSERT INTO incidents (id, reference, title, impact, severity, service, started_at, detected_at, owner_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
                ->execute([$id, $ref, $title, $impact, $sev, $service, $started, $now, $user['id']]);
            $pdo->prepare("INSERT INTO incident_updates (id, incident_id, author_id, status, body) VALUES (?, ?, ?, 'investigating', ?)")->execute([Db::uuid(), $id, $user['id'], $impact]);
            Audit::log($pdo, null, $user['id'], 'incident.declared', 'incidents', $id, ['reference' => $ref, 'severity' => $sev, 'service' => $service], $sev === 'critical' ? 'critical' : 'warning', 'platform_only', $ip);
            $pdo->commit();
        } catch (\Throwable $e) {
            $pdo->rollBack();
            throw $e;
        }
        return [201, ['id' => $id, 'reference' => $ref]];
    }

    private function update(array $user, array $in, string $ip, string $i): array
    {
        $this->staff($user);
        $status = $in['status'] ?? null;
        if ($status === 'resolved') {
            throw new HttpError(422, 'use_resolve', 'Use resolve to close an incident');
        }
        if (!is_string($status) || !in_array($status, self::OPEN, true)) {
            throw HttpError::invalid('status must be investigating, identified or monitoring');
        }
        $body = Input::reqStr($in, 'body', 2000);
        $pdo = $this->ctx->pdo;
        $pdo->beginTransaction();
        try {
            $inc = $this->lock($i);
            if ($inc['status'] === 'resolved') {
                throw HttpError::conflict('already_resolved', "Incident {$inc['reference']} is already resolved");
            }
            $id = Db::uuid();
            $pdo->prepare('INSERT INTO incident_updates (id, incident_id, author_id, status, body) VALUES (?, ?, ?, ?, ?)')->execute([$id, $i, $user['id'], $status, $body]);
            $pdo->prepare('UPDATE incidents SET status = ? WHERE id = ?')->execute([$status, $i]);
            Audit::log($pdo, null, $user['id'], 'incident.updated', 'incidents', $i, ['reference' => $inc['reference'], 'before' => $inc['status'], 'after' => $status], 'info', 'platform_only', $ip);
            $pdo->commit();
        } catch (\Throwable $e) {
            $pdo->rollBack();
            throw $e;
        }
        return [201, ['id' => $id]];
    }

    private function resolve(array $user, array $in, string $ip, string $i): array
    {
        $this->staff($user);
        $note = Input::reqStr($in, 'resolution', 2000);
        $pdo = $this->ctx->pdo;
        $pdo->beginTransaction();
        try {
            $inc = $this->lock($i);
            if ($inc['status'] === 'resolved') {
                throw HttpError::conflict('already_resolved', "Incident {$inc['reference']} is already resolved");
            }
            $pdo->prepare("UPDATE incidents SET status = 'resolved', resolved_at = GREATEST(UTC_TIMESTAMP(), started_at), resolution = ? WHERE id = ?")->execute([$note, $i]);
            $pdo->prepare("INSERT INTO incident_updates (id, incident_id, author_id, status, body) VALUES (?, ?, ?, 'resolved', ?)")->execute([Db::uuid(), $i, $user['id'], $note]);
            Audit::log($pdo, null, $user['id'], 'incident.resolved', 'incidents', $i, ['reference' => $inc['reference'], 'before' => $inc['status']], 'info', 'platform_only', $ip);
            $pdo->commit();
        } catch (\Throwable $e) {
            $pdo->rollBack();
            throw $e;
        }
        return [200, ['id' => $i]];
    }

    /** @return array{reference:string,status:string} the incident, locked for this transaction */
    private function lock(string $i): array
    {
        $q = $this->ctx->pdo->prepare('SELECT reference, status FROM incidents WHERE id = ? FOR UPDATE');
        $q->execute([$i]);
        return $q->fetch() ?: throw HttpError::notFound();
    }
}
