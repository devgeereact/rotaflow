<?php
declare(strict_types=1);

namespace RotaFlow\Mod;

use RotaFlow\{Audit, Ctx, Db, HttpError, Input, Module, Scope};

/**
 * Join links. A token is 32 random bytes, shown once; only its SHA-256 is stored. Redeeming needs a signed-in
 * person whose verified email equals the invited address. Every failure to redeem looks the same, so a token
 * cannot be probed for state.
 */
final class Invites implements Module
{
    private const TTL_DAYS = 7;
    private const PER_ORG_PER_HOUR = 60;
    private const PER_ADDRESS_PER_DAY = 3; // one address cannot be mail-bombed across organisations

    public function __construct(private readonly Ctx $ctx) {}

    public function routes(): array
    {
        return [
            ['GET', '/orgs/{o}/invites', $this->list(...)],
            ['POST', '/orgs/{o}/invites', $this->create(...)],
            ['POST', '/orgs/{o}/invites/{i}/revoke', $this->revoke(...)],
            ['POST', '/invites/preview', $this->preview(...), 'public'],
            ['POST', '/invites/accept', $this->accept(...)],
        ];
    }

    private function list(array $user, array $in, string $ip, string $o): array
    {
        $m = Scope::membership($this->ctx->pdo, $user['id'], $o);
        Scope::require($m, Scope::MANAGERS);
        $q = $this->ctx->pdo->prepare(
            "SELECT id, email, role, expires_at, accepted_at, revoked_at, last_sent_at, send_error, created_at,
                    CASE WHEN accepted_at IS NOT NULL THEN 'accepted' WHEN revoked_at IS NOT NULL THEN 'revoked'
                         WHEN expires_at <= UTC_TIMESTAMP() THEN 'expired' ELSE 'pending' END AS state
               FROM invites WHERE org_id = ? ORDER BY created_at DESC LIMIT 200"
        );
        $q->execute([$o]);
        return [200, ['invites' => $q->fetchAll()]];
    }

    private function create(array $user, array $in, string $ip, string $o): array
    {
        $pdo = $this->ctx->pdo;
        $m = Scope::membership($pdo, $user['id'], $o);
        Scope::require($m, Scope::MANAGERS);
        Scope::requireWritable($m);
        $email = strtolower(trim(Input::str($in, 'email')));
        $role = $in['role'] ?? null;
        if (filter_var($email, FILTER_VALIDATE_EMAIL) === false || strlen($email) > 255) {
            throw HttpError::invalid('Enter a valid email address');
        }
        if (!in_array($role, ['manager', 'staff'], true)) {
            throw HttpError::invalid("Role must be 'manager' or 'staff'");
        }
        $this->ctx->limits->hit('invite-org', $o, self::PER_ORG_PER_HOUR, 3600);
        $day = $pdo->prepare('SELECT COUNT(*) FROM invites WHERE email = ? AND created_at > DATE_SUB(UTC_TIMESTAMP(), INTERVAL 1 DAY)');
        $day->execute([$email]);
        if ((int) $day->fetchColumn() >= self::PER_ADDRESS_PER_DAY) {
            throw new HttpError(429, 'rate_limited', 'That address has received too many invitations today');
        }
        $member = $pdo->prepare("SELECT 1 FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.org_id = ? AND u.email = ? AND m.status IN ('active','suspended')");
        $member->execute([$o, $email]);
        if ($member->fetchColumn() !== false) {
            throw HttpError::conflict('already_member', 'That person is already in this organisation');
        }
        $token = rtrim(strtr(base64_encode(random_bytes(32)), '+/', '-_'), '=');
        $id = Db::uuid();
        try {
            $pdo->prepare('INSERT INTO invites (id, org_id, email, role, token_hash, expires_at, invited_by) VALUES (?, ?, ?, ?, ?, DATE_ADD(UTC_TIMESTAMP(), INTERVAL ? DAY), ?)')
                ->execute([$id, $o, $email, $role, hash('sha256', $token), self::TTL_DAYS, $user['id']]);
        } catch (\PDOException $e) {
            if ($e->getCode() === '23000') { // invites_pending: one live invitation per address per organisation
                throw HttpError::conflict('invite_pending', 'That address already has a pending invitation');
            }
            throw $e;
        }
        Audit::log($pdo, $o, $user['id'], 'invite.created', 'invites', $id, ['role' => $role], 'info', 'org', $ip);
        // The token is returned once, for the copyable link. Emailing it arrives with the mailer in S6.
        return [201, ['invite' => ['id' => $id, 'email' => $email, 'role' => $role], 'token' => $token]];
    }

    private function revoke(array $user, array $in, string $ip, string $o, string $i): array
    {
        $pdo = $this->ctx->pdo;
        $m = Scope::membership($pdo, $user['id'], $o);
        Scope::require($m, Scope::MANAGERS);
        $u = $pdo->prepare('UPDATE invites SET revoked_at = UTC_TIMESTAMP() WHERE id = ? AND org_id = ? AND accepted_at IS NULL AND revoked_at IS NULL');
        $u->execute([$i, $o]);
        if ($u->rowCount() !== 1) {
            throw HttpError::notFound();
        }
        Audit::log($pdo, $o, $user['id'], 'invite.revoked', 'invites', $i, [], 'info', 'org', $ip);
        return [200, ['ok' => true]];
    }

    /** Public: the token is the credential. Shows enough to recognise the invitation before signing in. */
    private function preview(?array $user, array $in, string $ip): array
    {
        $this->ctx->limits->hit('invite-preview', $ip, 30, 60);
        $row = $this->pending(Input::str($in, 'token'), false);
        return [200, ['org_name' => $row['org_name'], 'role' => $row['role'], 'email' => $row['email'], 'expires_at' => $row['expires_at']]];
    }

    private function accept(array $user, array $in, string $ip): array
    {
        $pdo = $this->ctx->pdo;
        $this->ctx->limits->hit('invite-accept', $user['id'], 10, 3600);
        $token = Input::str($in, 'token');
        $pdo->beginTransaction();
        try {
            $inv = $this->pending($token, true);
            if (!hash_equals(strtolower($inv['email']), $user['email'])) {
                throw new HttpError(403, 'invite_email_mismatch', 'This invitation was sent to a different email address');
            }
            $existing = $pdo->prepare('SELECT id, status FROM memberships WHERE org_id = ? AND user_id = ?');
            $existing->execute([$inv['org_id'], $user['id']]);
            $had = $existing->fetch();
            if ($had !== false && $had['status'] === 'active') {
                throw HttpError::conflict('already_member', 'You are already in this organisation');
            }
            if ($had !== false && $had['status'] === 'suspended') {
                throw HttpError::forbidden('Your access to this organisation is suspended');
            }
            if ($inv['role'] === 'owner') {
                $owners = $pdo->prepare("SELECT COUNT(*) FROM memberships WHERE org_id = ? AND role = 'owner' AND status = 'active'");
                $owners->execute([$inv['org_id']]);
                if ((int) $owners->fetchColumn() > 0) {
                    throw HttpError::conflict('owner_exists', 'This organisation already has an owner');
                }
            }
            $mid = $had !== false ? $had['id'] : Db::uuid();
            if ($had === false) {
                $pdo->prepare("INSERT INTO memberships (id, org_id, user_id, role, status) VALUES (?, ?, ?, ?, 'active')")->execute([$mid, $inv['org_id'], $user['id'], $inv['role']]);
            } else {
                $pdo->prepare("UPDATE memberships SET role = ?, status = 'active' WHERE id = ?")->execute([$inv['role'], $mid]);
            }
            $pdo->prepare('UPDATE invites SET accepted_at = UTC_TIMESTAMP() WHERE id = ?')->execute([$inv['id']]);
            // S3 links or creates the staff record here, as accept_invite did.
            Audit::log($pdo, $inv['org_id'], $user['id'], 'invite.accepted', 'invites', $inv['id'], ['role' => $inv['role']], 'info', 'org', $ip);
            $pdo->commit();
        } catch (\Throwable $e) {
            $pdo->rollBack();
            throw $e;
        }
        return [200, ['org_id' => $inv['org_id'], 'membership_id' => $mid, 'role' => $inv['role']]];
    }

    /**
     * The pending, unexpired invitation for a token, or one uniform 404. $lock takes the row for update (call inside a transaction).
     * @return array<string,mixed>
     */
    private function pending(string $token, bool $lock): array
    {
        if ($token === '' || strlen($token) > 128 || preg_match('/^[A-Za-z0-9_-]+$/', $token) !== 1) {
            throw new HttpError(404, 'invite_invalid', 'This invitation is not valid');
        }
        $q = $this->ctx->pdo->prepare(
            'SELECT i.id, i.org_id, i.email, i.role, i.expires_at, o.name AS org_name
               FROM invites i JOIN organisations o ON o.id = i.org_id
              WHERE i.token_hash = ? AND i.accepted_at IS NULL AND i.revoked_at IS NULL AND i.expires_at > UTC_TIMESTAMP() AND o.status <> \'archived\''
            . ($lock ? ' FOR UPDATE' : '')
        );
        $q->execute([hash('sha256', $token)]);
        return $q->fetch() ?: throw new HttpError(404, 'invite_invalid', 'This invitation is not valid');
    }
}
