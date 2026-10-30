<?php
declare(strict_types=1);

namespace RotaFlow;

/**
 * Chooses the mail account for an organisation: its own SMTP account if it configured and saved one, otherwise the platform's
 * (`smtp` in the private config), otherwise none (email is then skipped and the delivery log says why).
 */
final class Mail
{
    /** @return array{mailer:Mailer,from:string}|null */
    public static function forOrg(Ctx $ctx, string $orgId): ?array
    {
        $q = $ctx->pdo->prepare('SELECT smtp_host, smtp_port, smtp_user, smtp_pass_enc, from_email, from_name FROM org_smtp_settings WHERE org_id = ?');
        $q->execute([$orgId]);
        $row = $q->fetch();
        $key = (string) ($ctx->config['secret_key'] ?? '');
        if ($row !== false && $key !== '') {
            try {
                return ['mailer' => new SmtpMailer($row['smtp_host'], (int) $row['smtp_port'], $row['smtp_user'], Secret::decrypt($row['smtp_pass_enc'], $key), $row['from_email'], (string) ($row['from_name'] ?? ''), ($ctx->config['allow_plain_smtp'] ?? false) !== true, 10, self::host($ctx)), 'from' => $row['from_email']];
            } catch (\Throwable) {
                $ctx->log('org_smtp_unusable'); // wrong key or bad row: fall through to the platform account rather than failing every send
            }
        }
        return self::platform($ctx);
    }

    /** @return array{mailer:Mailer,from:string}|null */
    public static function platform(Ctx $ctx): ?array
    {
        $c = $ctx->config['smtp'] ?? null;
        if (!is_array($c) || empty($c['host']) || empty($c['from_email'])) {
            return null;
        }
        try {
            return ['mailer' => new SmtpMailer((string) $c['host'], (int) ($c['port'] ?? 465), (string) ($c['user'] ?? ''), (string) ($c['password'] ?? ''), (string) $c['from_email'], (string) ($c['from_name'] ?? 'RotaFlow'), ($c['secure'] ?? true) !== false, 10, self::host($ctx)), 'from' => (string) $c['from_email']];
        } catch (\Throwable) {
            return null;
        }
    }

    private static function host(Ctx $ctx): string
    {
        $h = (string) parse_url($ctx->appUrl, PHP_URL_HOST);
        return $h !== '' ? $h : 'rotaflow.space';
    }
}
