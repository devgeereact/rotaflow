<?php
declare(strict_types=1);

namespace RotaFlow;

/**
 * Turns verified Clerk claims into a database user. Identity is the Clerk user id; the email claim
 * (Clerk's primary, code-verified email) is used only to link a row that was created before the person
 * first signed in (for example the first Super Admin) and to match invitations.
 */
final class Users
{
    private const TOUCH_SECONDS = 300; // last_seen_at is written at most this often: one UPDATE per request was SiteRelay's J9

    /**
     * @param array<string,mixed> $claims verified Clerk session claims
     * @return array{id:string,email:string,clerk_id:string,sub:string}
     */
    public static function resolve(\PDO $pdo, array $claims, int $now = 0): array
    {
        $now = $now ?: time();
        $sub = $claims['sub'] ?? null;
        $email = is_string($claims['email'] ?? null) ? strtolower(trim($claims['email'])) : '';
        if (!is_string($sub) || $sub === '' || strlen($sub) > 64 || filter_var($email, FILTER_VALIDATE_EMAIL) === false || strlen($email) > 255) {
            throw HttpError::unauthorized('Session has no usable email');
        }
        $when = gmdate('Y-m-d H:i:s', $now);
        $row = self::byClerk($pdo, $sub);
        if ($row === null) {
            $row = self::linkOrCreate($pdo, $sub, $email, $when);
        } elseif ($row['email'] !== $email || strtotime($row['last_seen_at'] ?? '1970-01-01 UTC') < $now - self::TOUCH_SECONDS) {
            try {
                $pdo->prepare('UPDATE users SET email = ?, last_seen_at = ? WHERE id = ?')->execute([$email, $when, $row['id']]);
            } catch (\PDOException $e) {
                if ($e->getCode() === '23000') { // that email already belongs to a different person
                    throw HttpError::conflict('email_in_use', 'That email address belongs to another account');
                }
                throw $e;
            }
        }
        return ['id' => $row['id'], 'email' => $email, 'clerk_id' => $sub, 'sub' => $sub];
    }

    /** @return array<string,mixed>|null */
    private static function byClerk(\PDO $pdo, string $sub): ?array
    {
        $q = $pdo->prepare('SELECT id, email, last_seen_at FROM users WHERE clerk_user_id = ?');
        $q->execute([$sub]);
        return $q->fetch() ?: null;
    }

    /** @return array<string,mixed> */
    private static function linkOrCreate(\PDO $pdo, string $sub, string $email, string $when): array
    {
        $q = $pdo->prepare('SELECT id, clerk_user_id FROM users WHERE email = ?');
        $q->execute([$email]);
        $existing = $q->fetch();
        if ($existing !== false) {
            if ($existing['clerk_user_id'] !== null) {
                // The address is taken by a different Clerk identity. Never merge two people by email.
                throw HttpError::conflict('email_in_use', 'That email address belongs to another account');
            }
            $u = $pdo->prepare('UPDATE users SET clerk_user_id = ?, last_seen_at = ? WHERE id = ? AND clerk_user_id IS NULL');
            $u->execute([$sub, $when, $existing['id']]);
            return $u->rowCount() === 1 ? ['id' => $existing['id'], 'email' => $email] : (self::byClerk($pdo, $sub) ?? throw HttpError::unauthorized());
        }
        $id = Db::uuid();
        try {
            $pdo->prepare('INSERT INTO users (id, clerk_user_id, email, last_seen_at) VALUES (?, ?, ?, ?)')->execute([$id, $sub, $email, $when]);
        } catch (\PDOException $e) {
            if ($e->getCode() === '23000') { // two first requests raced: the other one won
                return self::byClerk($pdo, $sub) ?? throw HttpError::conflict('email_in_use', 'That email address belongs to another account');
            }
            throw $e;
        }
        return ['id' => $id, 'email' => $email];
    }
}
