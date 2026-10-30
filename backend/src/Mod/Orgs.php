<?php
declare(strict_types=1);

namespace RotaFlow\Mod;

use RotaFlow\{Audit, Ctx, Db, HttpError, Input, Module, Scope};

/** The signed-in person, organisations, members, ownership transfer and temporary manager cover. */
final class Orgs implements Module
{
    private const MAX_ORGS_PER_HOUR = 5;
    private const MAX_COVER_DAYS = 90; // ASSUMPTION: the Postgres delegate_role bounds only "in the future"; a ceiling stops a forgotten open-ended grant

    public function __construct(private readonly Ctx $ctx) {}

    public function routes(): array
    {
        return [
            ['GET', '/me', $this->me(...)],
            ['POST', '/orgs', $this->createOrg(...)],
            ['GET', '/orgs/{o}', $this->getOrg(...)],
            ['POST', '/orgs/{o}', $this->updateOrg(...)],
            ['GET', '/orgs/{o}/members', $this->listMembers(...)],
            ['POST', '/orgs/{o}/members/{m}/role', $this->setRole(...)],
            ['POST', '/orgs/{o}/members/{m}/status', $this->setStatus(...)],
            ['POST', '/orgs/{o}/transfer-ownership', $this->transferOwnership(...)],
            ['GET', '/orgs/{o}/delegations', $this->listDelegations(...)],
            ['POST', '/orgs/{o}/delegations', $this->delegate(...)],
            ['POST', '/orgs/{o}/delegations/{d}/revoke', $this->revokeDelegation(...)],
        ];
    }

    private function me(array $user): array
    {
        $pdo = $this->ctx->pdo;
        $u = $pdo->prepare('SELECT id, email, full_name, avatar_url FROM users WHERE id = ?');
        $u->execute([$user['id']]);
        $q = $pdo->prepare(
            "SELECT o.id AS org_id, o.name, o.slug, o.status, o.plan, m.id AS membership_id, m.role, m.status AS membership_status
               FROM memberships m JOIN organisations o ON o.id = m.org_id
              WHERE m.user_id = ? AND m.status IN ('active','invited') AND o.status <> 'archived' ORDER BY o.name"
        );
        $q->execute([$user['id']]);
        return [200, ['user' => $u->fetch(), 'memberships' => $q->fetchAll(), 'platform_role' => Scope::platformRole($pdo, $user['id'])]];
    }

    private function createOrg(array $user, array $in, string $ip): array
    {
        $name = trim(Input::str($in, 'name'));
        if (mb_strlen($name) < 2 || mb_strlen($name) > 120) {
            throw HttpError::invalid('Organisation name must be 2 to 120 characters');
        }
        if ($this->ctx->orgCreation !== 'open' && !in_array(Scope::platformRole($this->ctx->pdo, $user['id']), ['platform_owner', 'platform_admin'], true)) {
            // Organisations are by invitation: a platform administrator creates one and invites its first owner (Platform module).
            throw new HttpError(403, 'org_creation_closed', 'New organisations are by invitation only');
        }
        $this->ctx->limits->hit('org-create', $user['id'], self::MAX_ORGS_PER_HOUR, 3600);
        $pdo = $this->ctx->pdo;
        $id = Db::uuid();
        $mid = Db::uuid();
        $pdo->beginTransaction();
        try {
            $slug = self::freeSlug($pdo, $name);
            $pdo->prepare("INSERT INTO organisations (id, name, slug, trial_ends_at, created_by) VALUES (?, ?, ?, DATE_ADD(UTC_TIMESTAMP(), INTERVAL 30 DAY), ?)")
                ->execute([$id, $name, $slug, $user['id']]);
            $pdo->prepare("INSERT INTO memberships (id, org_id, user_id, role, status) VALUES (?, ?, ?, 'owner', 'active')")->execute([$mid, $id, $user['id']]);
            Audit::log($pdo, $id, $user['id'], 'org.created', 'organisations', $id, [], 'info', 'org', $ip);
            // S3 adds the founder's staff record here, as handle_new_org did.
            $pdo->commit();
        } catch (\Throwable $e) {
            $pdo->rollBack();
            throw $e;
        }
        return [201, ['org' => ['id' => $id, 'name' => $name, 'slug' => $slug], 'membership' => ['id' => $mid, 'role' => 'owner']]];
    }

    private function getOrg(array $user, array $in, string $ip, string $o): array
    {
        $m = Scope::membership($this->ctx->pdo, $user['id'], $o);
        $q = $this->ctx->pdo->prepare('SELECT id, name, slug, plan, status, trial_ends_at, support_access_allowed, settings, created_at FROM organisations WHERE id = ?');
        $q->execute([$o]);
        $org = $q->fetch();
        $org['settings'] = json_decode((string) $org['settings'], true) ?: new \stdClass();
        $org['support_access_allowed'] = (bool) $org['support_access_allowed'];
        return [200, ['org' => $org, 'membership' => ['id' => $m['id'], 'role' => $m['role'], 'effective_role' => $m['effective_role']]]];
    }

    private function updateOrg(array $user, array $in, string $ip, string $o): array
    {
        $m = Scope::membership($this->ctx->pdo, $user['id'], $o);
        Scope::require($m, ['owner']);
        Scope::requireWritable($m);
        $name = trim(Input::str($in, 'name'));
        if (mb_strlen($name) < 2 || mb_strlen($name) > 120) {
            throw HttpError::invalid('Organisation name must be 2 to 120 characters');
        }
        $this->ctx->pdo->prepare('UPDATE organisations SET name = ? WHERE id = ?')->execute([$name, $o]);
        Audit::log($this->ctx->pdo, $o, $user['id'], 'org.renamed', 'organisations', $o, [], 'info', 'org', $ip);
        return [200, ['ok' => true]];
    }

    private function listMembers(array $user, array $in, string $ip, string $o): array
    {
        $m = Scope::membership($this->ctx->pdo, $user['id'], $o);
        $sees = in_array($m['effective_role'], Scope::MANAGERS, true);
        // Staff may see who holds which role but not other people's contact details (profiles were readable by their owner only).
        $q = $this->ctx->pdo->prepare(
            'SELECT m.id, m.user_id, m.role, m.status, ' . ($sees ? 'u.email, u.full_name,' : "NULL AS email, NULL AS full_name,") . ' m.created_at
               FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.org_id = ? ORDER BY m.created_at'
        );
        $q->execute([$o]);
        return [200, ['members' => $q->fetchAll()]];
    }

    private function setRole(array $user, array $in, string $ip, string $o, string $mid): array
    {
        $pdo = $this->ctx->pdo;
        $me = Scope::membership($pdo, $user['id'], $o);
        Scope::requireReal($me, ['owner']);
        Scope::requireWritable($me);
        $role = $in['role'] ?? null;
        if (!in_array($role, ['manager', 'staff'], true)) {
            throw HttpError::invalid("Role must be 'manager' or 'staff'. Use transfer-ownership to hand over ownership");
        }
        $t = $this->target($o, $mid);
        if ($t['role'] === 'owner') {
            throw HttpError::forbidden('An owner keeps the owner role. Use transfer-ownership');
        }
        $pdo->prepare('UPDATE memberships SET role = ? WHERE id = ? AND org_id = ?')->execute([$role, $mid, $o]);
        Audit::log($pdo, $o, $user['id'], 'member.role_changed', 'memberships', $mid, ['from' => $t['role'], 'to' => $role], 'warning', 'org', $ip);
        return [200, ['ok' => true]];
    }

    private function setStatus(array $user, array $in, string $ip, string $o, string $mid): array
    {
        $pdo = $this->ctx->pdo;
        $me = Scope::membership($pdo, $user['id'], $o);
        Scope::requireReal($me, ['owner']);
        Scope::requireWritable($me);
        $status = $in['status'] ?? null;
        if (!in_array($status, ['active', 'suspended'], true)) {
            throw HttpError::invalid("Status must be 'active' or 'suspended'");
        }
        $t = $this->target($o, $mid);
        if ($t['role'] === 'owner') {
            throw HttpError::forbidden('An owner cannot be suspended. Transfer ownership first');
        }
        if ($t['status'] === 'invited') {
            throw HttpError::conflict('not_accepted', 'That person has not accepted their invitation yet');
        }
        $pdo->prepare('UPDATE memberships SET status = ? WHERE id = ? AND org_id = ?')->execute([$status, $mid, $o]);
        Audit::log($pdo, $o, $user['id'], 'member.status_changed', 'memberships', $mid, ['to' => $status], 'warning', 'org', $ip);
        return [200, ['ok' => true]];
    }

    /** Promote first, then demote, in one transaction, so there is never a moment without an owner. */
    private function transferOwnership(array $user, array $in, string $ip, string $o): array
    {
        $pdo = $this->ctx->pdo;
        $me = Scope::membership($pdo, $user['id'], $o);
        Scope::requireReal($me, ['owner']);
        Scope::requireWritable($me);
        $to = Input::str($in, 'membership_id');
        if ($to === $me['id']) {
            throw HttpError::invalid('You already own this organisation');
        }
        $pdo->beginTransaction();
        try {
            $q = $pdo->prepare("SELECT id, status FROM memberships WHERE id = ? AND org_id = ? FOR UPDATE");
            $q->execute([$to, $o]);
            $t = $q->fetch();
            if ($t === false || $t['status'] !== 'active') {
                throw HttpError::invalid('That person is not an active member of this organisation');
            }
            $pdo->prepare("UPDATE memberships SET role = 'owner' WHERE id = ?")->execute([$to]);
            $pdo->prepare("UPDATE memberships SET role = 'manager' WHERE id = ?")->execute([$me['id']]);
            Audit::log($pdo, $o, $user['id'], 'org.ownership_transferred', 'organisations', $o, ['to_membership' => $to], 'critical', 'org', $ip);
            $pdo->commit();
        } catch (\Throwable $e) {
            $pdo->rollBack();
            throw $e;
        }
        return [200, ['ok' => true]];
    }

    private function listDelegations(array $user, array $in, string $ip, string $o): array
    {
        Scope::membership($this->ctx->pdo, $user['id'], $o);
        $q = $this->ctx->pdo->prepare('SELECT id, from_user_id, to_user_id, starts_at, ends_at, revoked_at, note FROM role_delegations WHERE org_id = ? AND revoked_at IS NULL AND ends_at > UTC_TIMESTAMP() ORDER BY ends_at');
        $q->execute([$o]);
        return [200, ['delegations' => $q->fetchAll()]];
    }

    /** Reads the caller's REAL membership: a delegate must not delegate onwards. */
    private function delegate(array $user, array $in, string $ip, string $o): array
    {
        $pdo = $this->ctx->pdo;
        $me = Scope::membership($pdo, $user['id'], $o);
        Scope::requireReal($me, Scope::MANAGERS);
        Scope::requireWritable($me);
        $q = $pdo->prepare("SELECT user_id FROM memberships WHERE id = ? AND org_id = ? AND status = 'active'");
        $q->execute([Input::str($in, 'membership_id'), $o]);
        $to = $q->fetchColumn();
        if ($to === false) {
            throw HttpError::invalid('That person is not in this organisation');
        }
        if ($to === $user['id']) {
            throw HttpError::invalid('You cannot lend cover to yourself');
        }
        $until = strtotime(Input::str($in, 'ends_at'));
        if ($until === false || $until <= time()) {
            throw HttpError::invalid('Cover has to end in the future');
        }
        if ($until > time() + self::MAX_COVER_DAYS * 86400) {
            throw HttpError::invalid('Cover can last at most ' . self::MAX_COVER_DAYS . ' days');
        }
        $id = Db::uuid();
        $pdo->beginTransaction();
        try {
            // One live delegation per pair: two overlapping rows make "when does this end" unanswerable.
            $pdo->prepare('UPDATE role_delegations SET revoked_at = UTC_TIMESTAMP() WHERE org_id = ? AND from_user_id = ? AND to_user_id = ? AND revoked_at IS NULL')->execute([$o, $user['id'], $to]);
            $pdo->prepare('INSERT INTO role_delegations (id, org_id, from_user_id, to_user_id, ends_at, note) VALUES (?, ?, ?, ?, ?, ?)')
                ->execute([$id, $o, $user['id'], $to, gmdate('Y-m-d H:i:s', $until), isset($in['note']) ? mb_substr((string) $in['note'], 0, 500) : null]);
            Audit::log($pdo, $o, $user['id'], 'org.role_delegated', 'role_delegations', $id, ['to_user_id' => $to, 'ends_at' => gmdate('c', $until)], 'warning', 'org', $ip);
            $pdo->commit();
        } catch (\Throwable $e) {
            $pdo->rollBack();
            throw $e;
        }
        return [201, ['id' => $id]];
    }

    private function revokeDelegation(array $user, array $in, string $ip, string $o, string $d): array
    {
        $pdo = $this->ctx->pdo;
        $me = Scope::membership($pdo, $user['id'], $o);
        $q = $pdo->prepare('SELECT from_user_id FROM role_delegations WHERE id = ? AND org_id = ? AND revoked_at IS NULL');
        $q->execute([$d, $o]);
        $from = $q->fetchColumn();
        if ($from === false) {
            throw HttpError::notFound();
        }
        // The person who lent it, or a real owner/manager. Deliberately not the effective role, so a delegate cannot end a colleague's cover.
        if ($from !== $user['id'] && !in_array($me['role'], Scope::MANAGERS, true)) {
            throw HttpError::forbidden();
        }
        $pdo->prepare('UPDATE role_delegations SET revoked_at = UTC_TIMESTAMP() WHERE id = ?')->execute([$d]);
        Audit::log($pdo, $o, $user['id'], 'org.role_delegation_revoked', 'role_delegations', $d, [], 'info', 'org', $ip);
        return [200, ['ok' => true]];
    }

    /** @return array{id:string,role:string,status:string} a membership of THIS organisation, or 404 */
    private function target(string $o, string $mid): array
    {
        $q = $this->ctx->pdo->prepare('SELECT id, role, status FROM memberships WHERE id = ? AND org_id = ?');
        $q->execute([$mid, $o]);
        return $q->fetch() ?: throw HttpError::notFound();
    }

    public static function freeSlug(\PDO $pdo, string $name): string
    {
        $base = trim((string) preg_replace('/[^a-z0-9]+/', '-', strtolower((string) iconv('UTF-8', 'ASCII//TRANSLIT//IGNORE', $name))), '-');
        $base = substr($base !== '' ? $base : 'org', 0, 60);
        $q = $pdo->prepare('SELECT 1 FROM organisations WHERE slug = ?');
        for ($i = 0; $i < 20; $i++) {
            $slug = $i === 0 ? $base : $base . '-' . bin2hex(random_bytes(2));
            $q->execute([$slug]);
            if ($q->fetchColumn() === false) {
                return $slug;
            }
        }
        throw HttpError::conflict('slug_taken', 'Could not find a free address for that name');
    }
}
