<?php
declare(strict_types=1);

namespace RotaFlow\Mod;

use RotaFlow\{Audit, Ctx, Db, FileStore, HttpError, Input, Module, Scope};

/**
 * Deleting an organisation, finishing the file deletions an erasure or a removal owes, and retention.
 *
 * Deleting an organisation is immediate and cannot be undone: the old system had no grace period either (its "thirty days" was a note, never
 * built), and this does not pretend otherwise. It needs the exact name typed, an owner of that organisation or a platform owner or admin, and
 * it writes the audit row first. The audit trail, support cases, data-subject requests and billing events survive, detached from the tenant.
 */
final class Lifecycle implements Module
{
    private const ATTEMPTS = 5;
    /** Tables that are the child side of a RESTRICT link inside an organisation, in the order they must go. */
    public const CLEAR_FIRST = ['shift_swaps', 'shifts', 'rotas', 'documents', 'staff_profiles', 'departments'];
    private const RETENTION_HOUR_MINUTE = '02:15';

    public function __construct(private readonly Ctx $ctx) {}

    public function routes(): array
    {
        return [
            ['GET', '/orgs/{o}/deletion-preview', $this->orgPreview(...)],
            ['POST', '/orgs/{o}/delete', $this->orgDelete(...)],
            ['GET', '/platform/orgs/{o}/deletion-preview', $this->platformPreview(...)],
            ['POST', '/platform/orgs/{o}/delete', $this->platformDelete(...)],
            ['GET', '/platform/retention', $this->retention(...)],
            ['POST', '/platform/retention/dry-run', $this->dryRun(...)],
        ];
    }

    // ---- deleting an organisation ---------------------------------------------------------------------

    private function orgPreview(array $user, array $in, string $ip, string $o): array
    {
        $m = Scope::membership($this->ctx->pdo, $user['id'], $o);
        Scope::requireReal($m, ['owner']);
        return [200, ['preview' => $this->counts($o)]];
    }

    private function platformPreview(array $user, array $in, string $ip, string $o): array
    {
        $this->platformAdmin($user);
        $this->exists($o);
        return [200, ['preview' => $this->counts($o)]];
    }

    private function orgDelete(array $user, array $in, string $ip, string $o): array
    {
        $m = Scope::membership($this->ctx->pdo, $user['id'], $o);
        Scope::requireReal($m, ['owner']);
        return $this->delete($user, $in, $ip, $o, false);
    }

    private function platformDelete(array $user, array $in, string $ip, string $o): array
    {
        $this->platformAdmin($user);
        $this->exists($o);
        return $this->delete($user, $in, $ip, $o, true);
    }

    private function platformAdmin(array $user): void
    {
        if (!in_array(Scope::platformRole($this->ctx->pdo, $user['id']), ['platform_owner', 'platform_admin'], true)) {
            throw HttpError::notFound();
        }
    }

    private function exists(string $o): void
    {
        $q = $this->ctx->pdo->prepare('SELECT 1 FROM organisations WHERE id = ?');
        $q->execute([$o]);
        if ($q->fetchColumn() === false) {
            throw HttpError::notFound();
        }
    }

    /** @return array<string,int> */
    private function counts(string $o): array
    {
        $out = [];
        foreach (['staff_profiles', 'locations', 'rotas', 'shifts', 'clock_events', 'leave_requests', 'memberships'] as $t) {
            $q = $this->ctx->pdo->prepare("SELECT COUNT(*) FROM $t WHERE org_id = ?"); // $t is one of the literals above
            $q->execute([$o]);
            $out[$t] = (int) $q->fetchColumn();
        }
        return $out;
    }

    /** @return array{0:int,1:array<string,mixed>} */
    private function delete(array $user, array $in, string $ip, string $o, bool $byPlatform): array
    {
        $pdo = $this->ctx->pdo;
        $this->ctx->limits->hit('org-delete', $user['id'], 10, 3600);
        $q = $pdo->prepare('SELECT name, slug, plan, status, created_at FROM organisations WHERE id = ?');
        $q->execute([$o]);
        $org = $q->fetch() ?: throw HttpError::notFound();
        $typed = $in['confirm_name'] ?? null;
        if (!is_string($typed) || $typed !== $org['name']) { // exact: no trimming, no case folding
            throw new HttpError(422, 'name_mismatch', 'The name you typed does not match this organisation.');
        }
        $counts = $this->counts($o);
        $pdo->beginTransaction();
        try {
            Audit::log($pdo, $o, $user['id'], 'org.deleted', 'organisations', $o, ['name' => $org['name'], 'slug' => $org['slug'], 'plan' => $org['plan'], 'status' => $org['status'], 'created_at' => $org['created_at'], 'by_platform_admin' => $byPlatform, 'removed' => $counts], 'critical', 'platform_only', $ip);
            foreach (FileStore::BUCKETS as $bucket) {
                $pdo->prepare("INSERT INTO storage_deletions (id, org_id, bucket, path, is_folder, reason) VALUES (?, ?, ?, ?, 1, 'organisation_deleted')")->execute([Db::uuid(), $o, $bucket, $o]);
            }
            // These tables hold a restricting link to one another (and to places and job titles), so the cascade cannot run in any order. Clear
            // them child-first; everything else cascades from the organisation. A test fails if a new restricting link is not covered here.
            foreach (self::CLEAR_FIRST as $table) {
                $pdo->prepare("DELETE FROM $table WHERE org_id = ?")->execute([$o]); // $table is from the constant above
            }
            $pdo->prepare('DELETE FROM organisations WHERE id = ?')->execute([$o]);
            $pdo->commit();
        } catch (\Throwable $e) {
            $pdo->rollBack();
            throw $e;
        }
        return [200, ['deleted' => true, 'removed' => $counts]];
    }

    // ---- retention -------------------------------------------------------------------------------------------

    private function retention(array $user, array $in, string $ip): array
    {
        $this->anyStaff($user, ['platform_owner', 'platform_admin', 'platform_support', 'platform_finance']);
        return [200, [
            'policies' => $this->ctx->pdo->query('SELECT data_type, label, retain_months, enforced, note FROM retention_policies ORDER BY data_type')->fetchAll(),
            'runs' => $this->ctx->pdo->query('SELECT ran_at, dry_run, data_type, rows_removed, cutoff, error FROM retention_runs ORDER BY id DESC LIMIT 50')->fetchAll(),
        ]];
    }

    /** Counts what the next run would remove, and records it as a dry run. Owner and admin. */
    private function dryRun(array $user, array $in, string $ip): array
    {
        $this->anyStaff($user, ['platform_owner', 'platform_admin']);
        return [200, ['results' => \RotaFlow\Retention::run($this->ctx->pdo, true)]];
    }

    private function anyStaff(array $user, array $roles): void
    {
        if (!in_array(Scope::platformRole($this->ctx->pdo, $user['id']), $roles, true)) {
            throw HttpError::notFound();
        }
    }

    // ---- cron ---------------------------------------------------------------------------------------------------

    /** Removes queued files and folders (a missing one is success), then runs retention once a day after 02:15 UTC. */
    public static function cron(Ctx $ctx, int $now = 0): string
    {
        $now = $now ?: time();
        $pdo = $ctx->pdo;
        $pdo->exec("DELETE FROM storage_deletions WHERE status = 'done' AND completed_at < DATE_SUB(UTC_TIMESTAMP(), INTERVAL 30 DAY)");
        $store = FileStore::forCtx($ctx);
        $done = $failed = 0;
        foreach ($pdo->query("SELECT id, bucket, path, is_folder, attempts FROM storage_deletions WHERE status = 'pending' ORDER BY created_at LIMIT 20")->fetchAll() as $r) {
            try {
                $store->delete($r['bucket'], $r['path'], (bool) $r['is_folder']);
                $pdo->prepare("UPDATE storage_deletions SET status = 'done', completed_at = UTC_TIMESTAMP(), last_error = NULL WHERE id = ?")->execute([$r['id']]);
                $done++;
            } catch (\Throwable $e) {
                $n = (int) $r['attempts'] + 1;
                $pdo->prepare('UPDATE storage_deletions SET attempts = ?, status = ?, last_error = ? WHERE id = ?')->execute([$n, $n >= self::ATTEMPTS ? 'abandoned' : 'pending', substr(get_class($e), 0, 200), $r['id']]);
                $failed++;
            }
        }
        $ret = 'retention: not due';
        $today = gmdate('Y-m-d', $now);
        if (gmdate('H:i', $now) >= self::RETENTION_HOUR_MINUTE) {
            $ran = $pdo->prepare('SELECT 1 FROM retention_runs WHERE dry_run = 0 AND DATE(ran_at) = ? LIMIT 1');
            $ran->execute([$today]);
            if ($ran->fetchColumn() === false) {
                $rows = \RotaFlow\Retention::run($pdo, false, $now);
                $bad = count(array_filter($rows, static fn (array $r): bool => $r['error'] !== null));
                $ret = 'retention: removed=' . array_sum(array_column($rows, 'rows_removed')) . ($bad > 0 ? " FAILED=$bad" : '');
            } else {
                $ret = 'retention: already ran today';
            }
        }
        return "stored files: removed=$done failed=$failed; $ret";
    }
}
