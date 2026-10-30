<?php
declare(strict_types=1);

namespace RotaFlow\Mod;

use RotaFlow\{Audit, Ctx, Db, HttpError, Input, Module, Scope};

/**
 * The platform's own acts, for platform administrators only. Everyone else gets 404, so the routes
 * are not discoverable. Organisations are by invitation: an administrator creates the organisation and
 * invites its first owner, who accepts like any other invitation. The rest of the console arrives in S8.
 */
final class Platform implements Module
{
    private const TTL_DAYS = 7;
    private const PER_HOUR = 20;

    public function __construct(private readonly Ctx $ctx) {}

    public function routes(): array
    {
        return [
            ['POST', '/platform/orgs', $this->createOrg(...)],
            ['POST', '/platform/orgs/{o}/owner-invites', $this->inviteOwner(...)],
        ];
    }

    private function admin(array $user): void
    {
        if (!in_array(Scope::platformRole($this->ctx->pdo, $user['id']), ['platform_owner', 'platform_admin'], true)) {
            throw HttpError::notFound();
        }
    }

    private function createOrg(array $user, array $in, string $ip): array
    {
        $this->admin($user);
        $name = trim(Input::str($in, 'name'));
        $email = strtolower(trim(Input::str($in, 'owner_email')));
        if (\RotaFlow\Str::len($name) < 2 || \RotaFlow\Str::len($name) > 120) {
            throw HttpError::invalid('Organisation name must be 2 to 120 characters');
        }
        if (filter_var($email, FILTER_VALIDATE_EMAIL) === false || strlen($email) > 255) {
            throw HttpError::invalid('Enter a valid owner email address');
        }
        $this->ctx->limits->hit('platform-org-create', $user['id'], self::PER_HOUR, 3600);
        $pdo = $this->ctx->pdo;
        $id = Db::uuid();
        $pdo->beginTransaction();
        try {
            $slug = Orgs::freeSlug($pdo, $name);
            $pdo->prepare('INSERT INTO organisations (id, name, slug, trial_ends_at, created_by) VALUES (?, ?, ?, DATE_ADD(UTC_TIMESTAMP(), INTERVAL 30 DAY), ?)')
                ->execute([$id, $name, $slug, $user['id']]);
            $token = $this->ownerInvite($id, $email, $user['id']);
            Audit::log($pdo, $id, $user['id'], 'platform.org_created', 'organisations', $id, [], 'warning', 'platform_only', $ip);
            $pdo->commit();
        } catch (\Throwable $e) {
            $pdo->rollBack();
            throw $e;
        }
        return [201, ['org' => ['id' => $id, 'name' => $name, 'slug' => $slug], 'owner_email' => $email, 'token' => $token]];
    }

    /** Only for an organisation with no members yet; replaces any pending owner invitation. */
    private function inviteOwner(array $user, array $in, string $ip, string $o): array
    {
        $this->admin($user);
        $email = strtolower(trim(Input::str($in, 'owner_email')));
        if (filter_var($email, FILTER_VALIDATE_EMAIL) === false || strlen($email) > 255) {
            throw HttpError::invalid('Enter a valid owner email address');
        }
        $this->ctx->limits->hit('platform-org-create', $user['id'], self::PER_HOUR, 3600);
        $pdo = $this->ctx->pdo;
        $pdo->beginTransaction();
        try {
            $q = $pdo->prepare('SELECT id FROM organisations WHERE id = ? FOR UPDATE');
            $q->execute([$o]);
            if ($q->fetchColumn() === false) {
                throw HttpError::notFound();
            }
            $m = $pdo->prepare('SELECT COUNT(*) FROM memberships WHERE org_id = ?');
            $m->execute([$o]);
            if ((int) $m->fetchColumn() > 0) {
                throw HttpError::conflict('org_has_members', 'This organisation already has members');
            }
            $pdo->prepare("UPDATE invites SET revoked_at = UTC_TIMESTAMP() WHERE org_id = ? AND role = 'owner' AND accepted_at IS NULL AND revoked_at IS NULL")->execute([$o]);
            $token = $this->ownerInvite($o, $email, $user['id']);
            Audit::log($pdo, $o, $user['id'], 'platform.owner_invited', 'invites', null, [], 'warning', 'platform_only', $ip);
            $pdo->commit();
        } catch (\Throwable $e) {
            $pdo->rollBack();
            throw $e;
        }
        return [201, ['owner_email' => $email, 'token' => $token]];
    }

    private function ownerInvite(string $org, string $email, string $by): string
    {
        $token = rtrim(strtr(base64_encode(random_bytes(32)), '+/', '-_'), '=');
        $this->ctx->pdo->prepare("INSERT INTO invites (id, org_id, email, role, token_hash, expires_at, invited_by) VALUES (?, ?, ?, 'owner', ?, DATE_ADD(UTC_TIMESTAMP(), INTERVAL ? DAY), ?)")
            ->execute([Db::uuid(), $org, $email, hash('sha256', $token), self::TTL_DAYS, $by]);
        return $token;
    }
}
