<?php
declare(strict_types=1);

namespace RotaFlow\Mod;

use RotaFlow\{Audit, Billing, Ctx, Db, Flags, HttpError, Input, Module, Scope};

/**
 * Feature flags. Platform staff read them; owners and admins change them. A member reads what is switched on for their own organisation:
 * flags that are on for it, plus what its plan includes. A flag is a switch, never a purchase: what a customer pays for is a plan feature.
 * Flags are created by migration only (there is no create endpoint), and a retired flag cannot be changed.
 */
final class FeatureFlags implements Module
{
    private const ALL = ['platform_owner', 'platform_admin', 'platform_support', 'platform_finance'];
    private const PLANS = ['starter', 'professional', 'business', 'enterprise'];

    public function __construct(private readonly Ctx $ctx) {}

    public function routes(): array
    {
        return [
            ['GET', '/orgs/{o}/features', $this->mine(...)],
            ['GET', '/platform/flags', $this->list(...)],
            ['GET', '/platform/flags/changes', $this->changes(...)],
            ['POST', '/platform/flags', $this->set(...)],
            ['POST', '/platform/flags/targets', $this->target(...)],
        ];
    }

    /** @return string the caller's platform role, or 404 */
    private function staff(array $user, array $roles): string
    {
        $r = Scope::platformRole($this->ctx->pdo, $user['id']);
        if ($r === null || !in_array($r, $roles, true)) {
            throw HttpError::notFound();
        }
        return $r;
    }

    /** What this organisation has: each feature once per source (flag, plan). */
    private function mine(array $user, array $in, string $ip, string $o): array
    {
        $pdo = $this->ctx->pdo;
        Scope::membership($pdo, $user['id'], $o);
        $features = [];
        foreach ($pdo->query('SELECT flag_key FROM feature_flags WHERE retired_at IS NULL ORDER BY flag_key')->fetchAll(\PDO::FETCH_COLUMN) as $key) {
            if (Flags::enabledForOrg($pdo, $key, $o)) {
                $features[] = ['feature' => $key, 'source' => 'flag'];
            }
        }
        if (Billing::state($pdo, $o)['state'] !== 'read_only') {
            $q = $pdo->prepare('SELECT p.features FROM organisations o JOIN plans p ON p.code = o.plan WHERE o.id = ?');
            $q->execute([$o]);
            foreach (json_decode((string) $q->fetchColumn(), true) ?: [] as $f) {
                $features[] = ['feature' => $f, 'source' => 'plan'];
            }
        }
        return [200, ['features' => $features]];
    }

    private function list(array $user, array $in, string $ip): array
    {
        $this->staff($user, self::ALL);
        $rows = $this->ctx->pdo->query(
            'SELECT f.flag_key, f.name, f.description, f.enabled, f.rollout, f.environment, f.critical, f.target_plans, f.retired_at, f.retired_reason, f.updated_at,
                    (SELECT COUNT(*) FROM feature_flag_targets t WHERE t.flag_key = f.flag_key) AS targeted_orgs
               FROM feature_flags f ORDER BY (f.retired_at IS NOT NULL), f.flag_key'
        )->fetchAll();
        foreach ($rows as &$r) {
            $r['enabled'] = (bool) $r['enabled'];
            $r['critical'] = (bool) $r['critical'];
            $r['rollout'] = (int) $r['rollout'];
            $r['targeted_orgs'] = (int) $r['targeted_orgs'];
            $r['target_plans'] = json_decode((string) $r['target_plans'], true) ?? [];
        }
        return [200, ['flags' => $rows]];
    }

    private function changes(array $user, array $in, string $ip): array
    {
        $this->staff($user, self::ALL);
        $key = Input::reqStr($in, 'key', 64);
        $q = $this->ctx->pdo->prepare('SELECT actor_name, field_name AS field, before_value, after_value, created_at FROM feature_flag_changes WHERE flag_key = ? ORDER BY created_at DESC, id LIMIT 100');
        $q->execute([$key]);
        return [200, ['changes' => $q->fetchAll()]];
    }

    /** Owner and admin. Null (absent) means "no change"; only fields that really change are recorded. */
    private function set(array $user, array $in, string $ip): array
    {
        $this->staff($user, ['platform_owner', 'platform_admin']);
        $key = Input::reqStr($in, 'key', 64);
        $enabled = $in['enabled'] ?? null;
        $rollout = $in['rollout'] ?? null;
        $plans = $in['plans'] ?? null;
        if ($enabled !== null && !is_bool($enabled)) {
            throw HttpError::invalid('enabled must be true or false');
        }
        if ($rollout !== null && (!is_int($rollout) || $rollout < 0 || $rollout > 100)) {
            throw HttpError::invalid('rollout must be a whole number from 0 to 100');
        }
        if ($plans !== null && (!is_array($plans) || !array_is_list($plans) || array_diff($plans, self::PLANS) !== [])) {
            throw HttpError::invalid('plans must be a list of plan codes');
        }
        $pdo = $this->ctx->pdo;
        $pdo->beginTransaction();
        try {
            $q = $pdo->prepare('SELECT * FROM feature_flags WHERE flag_key = ? FOR UPDATE');
            $q->execute([$key]);
            $f = $q->fetch() ?: throw new HttpError(404, 'no_such_flag', "No feature flag with key $key");
            if ($f['retired_at'] !== null) {
                throw HttpError::conflict('flag_retired', "Flag $key was retired: " . ($f['retired_reason'] ?? 'no reason recorded'));
            }
            $changes = [];
            if ($enabled !== null && (int) $enabled !== (int) $f['enabled']) {
                $changes['enabled'] = [$f['enabled'] ? 'true' : 'false', $enabled ? 'true' : 'false', (int) $enabled];
            }
            if ($rollout !== null && $rollout !== (int) $f['rollout']) {
                $changes['rollout'] = [$f['rollout'] . '%', $rollout . '%', $rollout];
            }
            if ($plans !== null) {
                $old = json_decode((string) $f['target_plans'], true) ?: [];
                $new = array_values(array_unique($plans));
                if ($old !== $new) {
                    $changes['target_plans'] = [implode(', ', $old), implode(', ', $new), json_encode($new)];
                }
            }
            if ($changes !== []) {
                $col = ['enabled' => 'enabled', 'rollout' => 'rollout', 'target_plans' => 'target_plans'];
                $pdo->prepare('UPDATE feature_flags SET ' . implode(', ', array_map(static fn (string $k): string => "$col[$k] = ?", array_keys($changes))) . ', updated_by = ? WHERE flag_key = ?')
                    ->execute([...array_map(static fn (array $c) => $c[2], array_values($changes)), $user['id'], $key]);
                $name = $pdo->prepare('SELECT full_name FROM users WHERE id = ?');
                $name->execute([$user['id']]);
                $actor = $name->fetchColumn() ?: null;
                foreach ($changes as $field => [$before, $after]) {
                    $pdo->prepare('INSERT INTO feature_flag_changes (id, flag_key, actor_id, actor_name, field_name, before_value, after_value) VALUES (?, ?, ?, ?, ?, ?, ?)')->execute([Db::uuid(), $key, $user['id'], $actor, $field, $before, $after]);
                }
                Audit::log($pdo, null, $user['id'], 'feature_flag.updated', 'feature_flags', null, ['key' => $key, 'changes' => array_map(static fn (array $c): array => [$c[0], $c[1]], $changes)], $f['critical'] ? 'warning' : 'info', 'platform_only', $ip);
            }
            $pdo->commit();
        } catch (\Throwable $e) {
            $pdo->rollBack();
            throw $e;
        }
        return [200, ['key' => $key, 'changed' => array_keys($changes)]];
    }

    /** Opt an organisation in ahead of the rollout (a pilot), or out again. */
    private function target(array $user, array $in, string $ip): array
    {
        $this->staff($user, ['platform_owner', 'platform_admin']);
        $key = Input::reqStr($in, 'key', 64);
        $org = Input::reqStr($in, 'org_id', 36);
        if (!isset($in['targeted']) || !is_bool($in['targeted'])) {
            throw HttpError::invalid('targeted must be true or false');
        }
        $pdo = $this->ctx->pdo;
        $o = $pdo->prepare('SELECT name FROM organisations WHERE id = ?');
        $o->execute([$org]);
        $orgName = $o->fetchColumn();
        if ($orgName === false) {
            throw new HttpError(404, 'no_such_org', 'Organisation not found');
        }
        $f = $pdo->prepare('SELECT critical FROM feature_flags WHERE flag_key = ?');
        $f->execute([$key]);
        if ($f->fetchColumn() === false) {
            throw new HttpError(404, 'no_such_flag', "No feature flag with key $key");
        }
        $pdo->beginTransaction();
        try {
            if ($in['targeted']) {
                $pdo->prepare('INSERT IGNORE INTO feature_flag_targets (flag_key, org_id) VALUES (?, ?)')->execute([$key, $org]);
            } else {
                $pdo->prepare('DELETE FROM feature_flag_targets WHERE flag_key = ? AND org_id = ?')->execute([$key, $org]);
            }
            $pdo->prepare("INSERT INTO feature_flag_changes (id, flag_key, actor_id, field_name, before_value, after_value) VALUES (?, ?, ?, 'targets', ?, ?)")
                ->execute([Db::uuid(), $key, $user['id'], $in['targeted'] ? 'not targeted' : $orgName, $in['targeted'] ? $orgName : 'not targeted']);
            Audit::log($pdo, $org, $user['id'], 'feature_flag.targeted', 'feature_flags', null, ['key' => $key, 'targeted' => $in['targeted']], 'info', 'platform_only', $ip);
            $pdo->commit();
        } catch (\Throwable $e) {
            $pdo->rollBack();
            throw $e;
        }
        return [200, ['key' => $key, 'org_id' => $org, 'targeted' => $in['targeted']]];
    }
}
