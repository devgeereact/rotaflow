<?php
declare(strict_types=1);

namespace RotaFlow\Mod;

use RotaFlow\{Audit, Ctx, Db, HttpError, Input, Mail, Module, Scope};

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
            ['POST', '/orgs/{o}/invites/{i}/resend', $this->resend(...)],
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
        \RotaFlow\Billing::requireNotReadOnly($pdo, $o);
        $email = strtolower(trim(Input::str($in, 'email')));
        $role = $in['role'] ?? null;
        if (filter_var($email, FILTER_VALIDATE_EMAIL) === false || strlen($email) > 255) {
            throw HttpError::invalid('Enter a valid email address');
        }
        if (!in_array($role, ['manager', 'staff'], true)) {
            throw HttpError::invalid("Role must be 'manager' or 'staff'");
        }
        if ($role === 'manager') {
            // A delegate or a support session acts as manager for a while; it must not mint a permanent manager
            // that outlives the cover or the session (security audit, 1 Nov 2026).
            Scope::requireReal($m, Scope::MANAGERS);
        }
        $dept = Input::optStr($in, 'department_id', 36);
        $loc = Input::optStr($in, 'location_id', 36);
        foreach (['departments' => $dept, 'locations' => $loc] as $table => $id) {
            if ($id !== null) {
                $chk = $pdo->prepare("SELECT 1 FROM $table WHERE id = ? AND org_id = ?"); // $table is a literal key above
                $chk->execute([$id, $o]);
                if ($chk->fetchColumn() === false) {
                    throw HttpError::invalid('That department or location is not in this organisation');
                }
            }
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
            $pdo->prepare('INSERT INTO invites (id, org_id, email, role, token_hash, expires_at, invited_by, department_id, location_id) VALUES (?, ?, ?, ?, ?, DATE_ADD(UTC_TIMESTAMP(), INTERVAL ? DAY), ?, ?, ?)')
                ->execute([$id, $o, $email, $role, hash('sha256', $token), self::TTL_DAYS, $user['id'], $dept, $loc]);
        } catch (\PDOException $e) {
            if ($e->getCode() === '23000') { // invites_pending: one live invitation per address per organisation
                throw HttpError::conflict('invite_pending', 'That address already has a pending invitation');
            }
            throw $e;
        }
        Audit::log($pdo, $o, $user['id'], 'invite.created', 'invites', $id, ['role' => $role], 'info', 'org', $ip);
        // The token is returned once for the copyable link, and emailed best-effort: a refused send never loses the invitation.
        [$sent, $why] = $this->email($o, $id, $email, $role, $token);
        return [201, ['invite' => ['id' => $id, 'email' => $email, 'role' => $role], 'token' => $token, 'email_sent' => $sent, 'email_error' => $why]];
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

    /**
     * Issues a fresh link for a pending invitation and emails it. The old link stops working. (The token is stored only as a hash, so
     * an invitation cannot be re-sent as it was; this is how a lost or unsent one is recovered.)
     */
    private function resend(array $user, array $in, string $ip, string $o, string $i): array
    {
        $pdo = $this->ctx->pdo;
        $m = Scope::membership($pdo, $user['id'], $o);
        Scope::require($m, Scope::MANAGERS);
        Scope::requireWritable($m);
        \RotaFlow\Billing::requireNotReadOnly($pdo, $o);
        $this->ctx->limits->hit('invite-resend', $o, 30, 3600);
        $q = $pdo->prepare("SELECT email, role FROM invites WHERE id = ? AND org_id = ? AND accepted_at IS NULL AND revoked_at IS NULL");
        $q->execute([$i, $o]);
        $inv = $q->fetch() ?: throw HttpError::notFound();
        if ($inv['role'] === 'owner') {
            throw HttpError::forbidden('Owner invitations are issued by the platform');
        }
        $token = rtrim(strtr(base64_encode(random_bytes(32)), '+/', '-_'), '=');
        $pdo->prepare('UPDATE invites SET token_hash = ?, expires_at = DATE_ADD(UTC_TIMESTAMP(), INTERVAL ? DAY) WHERE id = ?')->execute([hash('sha256', $token), self::TTL_DAYS, $i]);
        [$sent, $why] = $this->email($o, $i, $inv['email'], $inv['role'], $token);
        Audit::log($pdo, $o, $user['id'], 'invite.resent', 'invites', $i, [], 'info', 'org', $ip);
        return [200, ['token' => $token, 'email_sent' => $sent, 'email_error' => $why]];
    }

    /**
     * Sends the invitation email through the organisation's mail account, else the platform's. The subject names no organisation (so the
     * message is no use as a phishing template); the body does. Records whether it left, and why not.
     * @return array{0:bool,1:?string}
     */
    private function email(string $o, string $inviteId, string $to, string $role, string $token): array
    {
        $pdo = $this->ctx->pdo;
        $mail = Mail::forOrg($this->ctx, $o);
        $why = null;
        $sent = false;
        if ($mail === null) {
            $why = 'no_mail_account';
        } else {
            $org = $pdo->prepare('SELECT name FROM organisations WHERE id = ?');
            $org->execute([$o]);
            $link = rtrim($this->ctx->appUrl, '/') . '/invite/' . $token;
            $sent = $mail['mailer']->send($to, 'You have been invited to join a team on RotaFlow', "Hello,\n\nYou have been invited to join " . $org->fetchColumn() . " on RotaFlow as " . $role . ".\n\nOpen this link to accept. It works for " . self::TTL_DAYS . " days, and only for this email address:\n" . $link . "\n\nIf you were not expecting this, you can ignore it.");
            $why = $sent ? null : $mail['mailer']->lastError();
        }
        $pdo->prepare('UPDATE invites SET last_sent_at = ?, send_error = ? WHERE id = ?')->execute([$sent ? gmdate('Y-m-d H:i:s') : null, $why, $inviteId]);
        return [$sent, $why];
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
            \RotaFlow\Billing::requireNotReadOnly($pdo, $inv['org_id']);
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
            Staff::linkOnAccept($pdo, $inv['org_id'], $user['id'], $user['email'], $inv['department_id'], $inv['location_id']);
            if ($inv['role'] === 'owner') {
                Staff::ensureForOwner($pdo, $inv['org_id'], $user['id'], $user['email']); // the first owner is also on the rota
            }
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
            'SELECT i.id, i.org_id, i.email, i.role, i.expires_at, i.department_id, i.location_id, o.name AS org_name
               FROM invites i JOIN organisations o ON o.id = i.org_id
              WHERE i.token_hash = ? AND i.accepted_at IS NULL AND i.revoked_at IS NULL AND i.expires_at > UTC_TIMESTAMP() AND o.status <> \'archived\''
            . ($lock ? ' FOR UPDATE' : '')
        );
        $q->execute([hash('sha256', $token)]);
        return $q->fetch() ?: throw new HttpError(404, 'invite_invalid', 'This invitation is not valid');
    }
}
