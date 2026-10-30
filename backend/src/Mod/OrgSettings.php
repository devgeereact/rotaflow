<?php
declare(strict_types=1);

namespace RotaFlow\Mod;

use RotaFlow\{Audit, Ctx, HttpError, Input, Mail, Module, Scope, Secret, SmtpMailer, Str};

/**
 * Organisation settings an owner controls: the notification matrix (5 events x 3 channels), who manages job titles, and the
 * organisation's own mail account. The SMTP password is encrypted at rest and is never returned: a read says only whether one is set.
 */
final class OrgSettings implements Module
{
    private const EVENTS = ['rota_published', 'shift_reminder', 'swap_requests', 'leave_updates', 'announcements'];
    private const CHANNELS = ['in_app', 'email', 'push'];

    public function __construct(private readonly Ctx $ctx) {}

    public function routes(): array
    {
        return [
            ['POST', '/orgs/{o}/settings', $this->save(...)],
            ['GET', '/orgs/{o}/smtp', $this->getSmtp(...)],
            ['POST', '/orgs/{o}/smtp', $this->saveSmtp(...)],
            ['POST', '/orgs/{o}/smtp/test', $this->testSmtp(...)],
            ['POST', '/orgs/{o}/smtp/delete', $this->deleteSmtp(...)],
        ];
    }

    /** Owner only. Replaces only the keys sent: `notification_defaults` (matrix) and `job_titles_managed_by` ('owner' or 'managers'). */
    private function save(array $user, array $in, string $ip, string $o): array
    {
        $pdo = $this->ctx->pdo;
        $m = Scope::membership($pdo, $user['id'], $o);
        Scope::require($m, ['owner']);
        Scope::requireWritable($m);
        $set = [];
        if (array_key_exists('notification_defaults', $in)) {
            $set['notification_defaults'] = $this->matrix($in['notification_defaults']);
        }
        if (array_key_exists('job_titles_managed_by', $in)) {
            if (!in_array($in['job_titles_managed_by'], ['owner', 'managers'], true)) {
                throw HttpError::invalid("job_titles_managed_by must be 'owner' or 'managers'");
            }
            $set['job_titles_managed_by'] = $in['job_titles_managed_by'];
        }
        if ($set === []) {
            throw HttpError::invalid('Nothing to change');
        }
        $pdo->beginTransaction();
        try {
            $q = $pdo->prepare('SELECT settings FROM organisations WHERE id = ? FOR UPDATE');
            $q->execute([$o]);
            $cur = json_decode((string) $q->fetchColumn(), true);
            $next = array_merge(is_array($cur) ? $cur : [], $set);
            $pdo->prepare('UPDATE organisations SET settings = ? WHERE id = ?')->execute([json_encode($next, JSON_UNESCAPED_UNICODE), $o]);
            Audit::log($pdo, $o, $user['id'], 'org.settings_changed', 'organisations', $o, ['keys' => array_keys($set)], 'info', 'org', $ip);
            $pdo->commit();
        } catch (\Throwable $e) {
            $pdo->rollBack();
            throw $e;
        }
        return [200, ['settings' => $next]];
    }

    /** @return array<string,array<string,bool>> every event and channel, booleans only */
    private function matrix(mixed $v): array
    {
        if (!is_array($v)) {
            throw HttpError::invalid('notification_defaults must be an object');
        }
        $out = [];
        foreach ($v as $event => $row) {
            if (!in_array($event, self::EVENTS, true) || !is_array($row)) {
                throw HttpError::invalid("Unknown notification event '" . (is_string($event) ? $event : '?') . "'");
            }
            foreach ($row as $channel => $on) {
                if (!in_array($channel, self::CHANNELS, true) || !is_bool($on)) {
                    throw HttpError::invalid('Each channel must be in_app, email or push, set to true or false');
                }
                $out[$event][$channel] = $on;
            }
        }
        return $out;
    }

    // ---- the organisation's own mail account ---------------------------------------------------------------------

    private function getSmtp(array $user, array $in, string $ip, string $o): array
    {
        $this->owner($user, $o, false);
        $q = $this->ctx->pdo->prepare('SELECT smtp_host, smtp_port, smtp_user, from_email, from_name, verified_at FROM org_smtp_settings WHERE org_id = ?');
        $q->execute([$o]);
        $r = $q->fetch();
        if ($r === false) {
            return [200, ['smtp' => null]];
        }
        $r['has_password'] = true;
        $r['verified_at'] = $r['verified_at'] === null ? null : str_replace(' ', 'T', $r['verified_at']) . 'Z';
        return [200, ['smtp' => $r]];
    }

    /** Saves the account. Sending no password keeps the one already stored. Changing the host, port, user or password clears `verified_at`. */
    private function saveSmtp(array $user, array $in, string $ip, string $o): array
    {
        $pdo = $this->ctx->pdo;
        $this->owner($user, $o, true);
        $key = (string) ($this->ctx->config['secret_key'] ?? '');
        if ($key === '') {
            throw new HttpError(503, 'not_configured', 'This deployment has no encryption key, so an SMTP password cannot be stored safely');
        }
        $host = Input::reqStr($in, 'smtp_host', 255);
        $port = Input::optNum($in, 'smtp_port', 1, 65535) ?? 587;
        $suser = Input::reqStr($in, 'smtp_user', 255);
        $from = strtolower(Input::reqStr($in, 'from_email', 254));
        if (preg_match('/^[A-Za-z0-9.-]{1,253}$/', $host) !== 1 || $port !== floor($port) || !SmtpMailer::validEmail($from)) {
            throw HttpError::invalid('smtp_host, smtp_port or from_email is not valid');
        }
        $q = $pdo->prepare('SELECT smtp_host, smtp_port, smtp_user, smtp_pass_enc FROM org_smtp_settings WHERE org_id = ?');
        $q->execute([$o]);
        $cur = $q->fetch();
        $pass = Input::str($in, 'smtp_pass');
        if ($pass === '' && $cur === false) {
            throw HttpError::invalid('smtp_pass is required the first time');
        }
        $enc = $pass !== '' ? Secret::encrypt($pass, $key) : (string) $cur['smtp_pass_enc'];
        $changed = $cur === false || $pass !== '' || $cur['smtp_host'] !== $host || (int) $cur['smtp_port'] !== (int) $port || $cur['smtp_user'] !== $suser;
        $pdo->prepare(
            'INSERT INTO org_smtp_settings (org_id, smtp_host, smtp_port, smtp_user, smtp_pass_enc, from_email, from_name) VALUES (?, ?, ?, ?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE smtp_host = VALUES(smtp_host), smtp_port = VALUES(smtp_port), smtp_user = VALUES(smtp_user), smtp_pass_enc = VALUES(smtp_pass_enc), from_email = VALUES(from_email), from_name = VALUES(from_name)' . ($changed ? ', verified_at = NULL' : '')
        )->execute([$o, $host, (int) $port, $suser, $enc, $from, Input::optStr($in, 'from_name', 200)]);
        Audit::log($pdo, $o, $user['id'], 'org.smtp_saved', 'org_smtp_settings', $o, [], 'warning', 'org', $ip);
        return $this->getSmtp($user, [], $ip, $o);
    }

    /** Sends one message to the owner's own address through the saved account; success stamps `verified_at`. */
    private function testSmtp(array $user, array $in, string $ip, string $o): array
    {
        $pdo = $this->ctx->pdo;
        $this->owner($user, $o, true);
        $this->ctx->limits->hit('smtp-test', $o, 10, 3600);
        $q = $pdo->prepare('SELECT 1 FROM org_smtp_settings WHERE org_id = ?');
        $q->execute([$o]);
        if ($q->fetchColumn() === false) {
            throw HttpError::conflict('smtp_not_set', 'Save an SMTP account first');
        }
        $mail = Mail::forOrg($this->ctx, $o);
        $own = $pdo->prepare('SELECT email FROM users WHERE id = ?');
        $own->execute([$user['id']]);
        if ($mail === null) {
            throw HttpError::conflict('smtp_unusable', 'The saved account cannot be used. Save the password again');
        }
        // Only ever to the signed-in owner's own address: the endpoint cannot be used to mail a third party.
        $ok = $mail['mailer']->send((string) $own->fetchColumn(), 'RotaFlow test email', "This is a test from RotaFlow.\n\nIf you can read it, your organisation's mail settings work.");
        if (!$ok) {
            return [200, ['ok' => false, 'error' => $mail['mailer']->lastError()]];
        }
        $pdo->prepare('UPDATE org_smtp_settings SET verified_at = UTC_TIMESTAMP() WHERE org_id = ?')->execute([$o]);
        return [200, ['ok' => true]];
    }

    private function deleteSmtp(array $user, array $in, string $ip, string $o): array
    {
        $this->owner($user, $o, true);
        $this->ctx->pdo->prepare('DELETE FROM org_smtp_settings WHERE org_id = ?')->execute([$o]);
        Audit::log($this->ctx->pdo, $o, $user['id'], 'org.smtp_removed', 'org_smtp_settings', $o, [], 'warning', 'org', $ip);
        return [200, ['ok' => true]];
    }

    private function owner(array $user, string $o, bool $write): void
    {
        $m = Scope::membership($this->ctx->pdo, $user['id'], $o);
        Scope::require($m, ['owner']);
        if ($write) {
            Scope::requireWritable($m);
        }
    }
}
