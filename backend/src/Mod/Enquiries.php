<?php
declare(strict_types=1);

namespace RotaFlow\Mod;

use RotaFlow\{Audit, Ctx, Db, HttpError, Input, Mail, Module, Scope, Str};

/**
 * Website enquiries (the contact form). Public, so it defends itself, in this order: method/Origin, content type, size, JSON, honeypot,
 * validation, Turnstile (if configured), then a rate limit per address and overall. The raw address is never stored, only a keyed hash.
 * A spam submission (the honeypot filled) gets exactly the success reply and writes nothing. The notification to the team carries no visitor
 * text and is sent by cron, so a slow mail server can never make a visitor wait.
 */
final class Enquiries implements Module
{
    private const MAX_BYTES = 16384;
    private const TEAM_SIZES = ['1-25', '26-100', '101-500', '500+'];
    private const SECTORS = ['Healthcare and care homes', 'Hospitality', 'Retail', 'Education', 'Security', 'Facilities management', 'Other'];
    private const STATUSES = ['new', 'replied', 'demo_booked', 'closed'];
    private const OPERATIONAL = ['platform_owner', 'platform_admin', 'platform_support'];
    private const CONTROL = '/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/';

    /** @param ?callable(string $url, array<string,string> $fields):array{0:int,1:string} $turnstile injected by tests */
    public function __construct(private readonly Ctx $ctx, private $turnstile = null) {}

    public function routes(): array
    {
        return [
            ['POST', '/enquiries', $this->receive(...), 'public', 'raw'],
            ['GET', '/platform/enquiries', $this->inbox(...)],
            ['POST', '/platform/enquiries/{e}/status', $this->setStatus(...)],
        ];
    }

    private function receive(?array $user, array $in, string $ip): array
    {
        $raw = (string) ($in['__raw'] ?? '');
        $h = is_array($in['__headers'] ?? null) ? $in['__headers'] : [];
        $origin = $h['origin'] ?? null;
        if ($origin !== null && !in_array($origin, $this->origins(), true)) {
            return [403, ['error' => 'origin_not_allowed']];
        }
        if (!str_starts_with(strtolower((string) ($h['content-type'] ?? '')), 'application/json')) {
            return [415, ['error' => 'unsupported_media_type']];
        }
        if (strlen($raw) > self::MAX_BYTES) {
            return [413, ['error' => 'too_large']];
        }
        $b = json_decode($raw, true);
        if (!is_array($b) || array_is_list($b) && $b !== []) {
            return [400, ['error' => 'invalid', 'fields' => ['body']]];
        }
        if (($b['website'] ?? null) !== null && $b['website'] !== '') {
            return [201, ['ok' => true]]; // the honeypot: indistinguishable from success, and nothing is kept
        }
        [$v, $bad] = $this->validate($b);
        if ($bad !== []) {
            return [400, ['error' => 'invalid', 'fields' => $bad]];
        }
        if (!$this->turnstile($b['turnstileToken'] ?? null, $ip)) {
            return [400, ['error' => 'verification_failed']];
        }
        $hash = hash_hmac('sha256', $ip === '' ? 'unknown' : $ip, $this->salt());
        try {
            $this->ctx->limits->hit('enquiry-ip', $hash, 5, 3600);
            $this->ctx->limits->hit('enquiry-all', 'all', 100, 3600);
        } catch (HttpError) {
            return [429, ['error' => 'rate_limited']];
        }
        $ua = trim((string) ($h['user-agent'] ?? ''));
        $this->ctx->pdo->prepare('INSERT INTO enquiries (id, name, work_email, organisation, team_size, sector, message, wants_demo, marketing_consent, ip_hash, user_agent) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
            ->execute([Db::uuid(), $v['name'], $v['email'], $v['organisation'], $v['teamSize'], $v['sector'], $v['message'], $v['wantsDemo'] ? 1 : 0, $v['marketingConsent'] ? 1 : 0, $hash, $ua === '' ? null : Str::cut($ua, 400)]);
        return [201, ['ok' => true]];
    }

    /** @param array<string,mixed> $b @return array{0:array<string,mixed>,1:list<string>} */
    private function validate(array $b): array
    {
        $bad = [];
        $text = function (string $k, int $min, int $max, bool $control = true) use ($b, &$bad): ?string {
            $v = $b[$k] ?? null;
            $t = is_string($v) ? trim(preg_replace('/^\s+|\s+$/u', '', $v) ?? $v) : '';
            if ($t === '' || Str::len($t) < $min || Str::len($t) > $max || ($control && preg_match(self::CONTROL, $t) === 1)) {
                $bad[] = $k;
                return null;
            }
            return $t;
        };
        $name = $text('name', 1, 120);
        $org = $text('organisation', 1, 160);
        $msg = $text('message', 10, 5000);
        $email = $text('workEmail', 1, 254, false);
        if ($email !== null && preg_match('/^[^\s@]+@[^\s@]+\.[^\s@]+$/', $email) !== 1) {
            $bad[] = 'workEmail';
        }
        $team = $b['teamSize'] ?? null;
        if ($team === '') {
            $team = null;
        }
        if ($team !== null && !in_array($team, self::TEAM_SIZES, true)) {
            $bad[] = 'teamSize';
        }
        $sector = $b['sector'] ?? null;
        if ($sector === '') {
            $sector = null;
        }
        if ($sector !== null && !in_array($sector, self::SECTORS, true)) {
            $bad[] = 'sector';
        }
        foreach (['wantsDemo', 'marketingConsent'] as $k) {
            if (array_key_exists($k, $b) && $b[$k] !== null && !is_bool($b[$k])) {
                $bad[] = $k;
            }
        }
        $tok = $b['turnstileToken'] ?? null;
        if ($tok !== null && (!is_string($tok) || $tok === '' || strlen($tok) > 2048)) {
            $bad[] = 'turnstileToken';
        }
        return [['name' => $name, 'email' => $email, 'organisation' => $org, 'message' => $msg, 'teamSize' => $team, 'sector' => $sector, 'wantsDemo' => ($b['wantsDemo'] ?? false) === true, 'marketingConsent' => ($b['marketingConsent'] ?? false) === true], $bad];
    }

    /** Unconfigured: skipped. Configured: a missing token, a network failure and anything but success:true all fail closed. */
    private function turnstile(mixed $token, string $ip): bool
    {
        $secret = $this->ctx->config['turnstile_secret'] ?? null;
        if (!is_string($secret) || $secret === '') {
            return true;
        }
        if (!is_string($token) || $token === '') {
            return false;
        }
        $fields = ['secret' => $secret, 'response' => $token, 'idempotency_key' => Db::uuid()];
        if ($ip !== '' && $ip !== 'unknown') {
            $fields['remoteip'] = $ip;
        }
        [$status, $body] = ($this->turnstile ?? self::siteverify(...))('https://challenges.cloudflare.com/turnstile/v0/siteverify', $fields);
        $j = json_decode($body, true);
        return $status >= 200 && $status < 300 && is_array($j) && ($j['success'] ?? false) === true;
    }

    /** @param array<string,string> $fields @return array{0:int,1:string} */
    private static function siteverify(string $url, array $fields): array
    {
        $ch = curl_init($url);
        curl_setopt_array($ch, [CURLOPT_POST => true, CURLOPT_POSTFIELDS => $fields, CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 8, CURLOPT_CONNECTTIMEOUT => 5, CURLOPT_FOLLOWLOCATION => false, CURLOPT_PROTOCOLS => CURLPROTO_HTTPS, CURLOPT_SSL_VERIFYPEER => true, CURLOPT_SSL_VERIFYHOST => 2]);
        $out = curl_exec($ch);
        $code = (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
        curl_close($ch);
        return [$code, is_string($out) ? $out : ''];
    }

    /** @return list<string> */
    private function origins(): array
    {
        $app = rtrim($this->ctx->appUrl, '/');
        $out = $app === '' ? [] : [$app];
        $host = (string) parse_url($app, PHP_URL_HOST);
        if ($host !== '' && !str_starts_with($host, 'www.')) {
            $out[] = 'https://www.' . $host;
        }
        $extra = $this->ctx->config['enquiry_origins'] ?? [];
        return array_merge($out, is_array($extra) ? array_values(array_filter($extra, 'is_string')) : []);
    }

    /** A dedicated salt if configured; otherwise one derived from the private secret key, so no address hash can be recomputed without it. */
    private function salt(): string
    {
        $s = $this->ctx->config['enquiry_ip_salt'] ?? null;
        return is_string($s) && $s !== '' ? $s : hash_hmac('sha256', 'enquiry-ip', (string) ($this->ctx->config['secret_key'] ?? 'unconfigured'));
    }

    // ---- the inbox ---------------------------------------------------------------------------------

    /** Operational staff. Never returns the address hash or the user agent. */
    private function inbox(array $user, array $in, string $ip): array
    {
        $this->staff($user);
        $where = '1 = 1';
        $args = [];
        if (($s = Input::optStr($in, 'status', 20)) !== null) {
            if (!in_array($s, self::STATUSES, true)) {
                throw HttpError::invalid('status is not recognised');
            }
            $where = 'status = ?';
            $args[] = $s;
        }
        $q = $this->ctx->pdo->prepare("SELECT id, name, work_email, organisation, team_size, sector, message, wants_demo, marketing_consent, status, created_at, updated_at FROM enquiries WHERE $where ORDER BY created_at DESC, id LIMIT 500");
        $q->execute($args);
        $rows = $q->fetchAll();
        foreach ($rows as &$r) {
            $r['wants_demo'] = (bool) $r['wants_demo'];
            $r['marketing_consent'] = (bool) $r['marketing_consent'];
        }
        return [200, ['enquiries' => $rows]];
    }

    private function setStatus(array $user, array $in, string $ip, string $e): array
    {
        $this->staff($user);
        $status = $in['status'] ?? null;
        if (!is_string($status) || !in_array($status, self::STATUSES, true)) {
            throw HttpError::invalid('status is not recognised');
        }
        $u = $this->ctx->pdo->prepare('UPDATE enquiries SET status = ? WHERE id = ?');
        $u->execute([$status, $e]);
        $exists = $this->ctx->pdo->prepare('SELECT 1 FROM enquiries WHERE id = ?');
        $exists->execute([$e]);
        if ($exists->fetchColumn() === false) {
            throw HttpError::notFound();
        }
        Audit::log($this->ctx->pdo, null, $user['id'], 'enquiry.' . $status, 'enquiries', $e, [], 'info', 'platform_only', $ip);
        return [200, ['id' => $e, 'status' => $status]];
    }

    private function staff(array $user): void
    {
        if (!in_array(Scope::platformRole($this->ctx->pdo, $user['id']), self::OPERATIONAL, true)) {
            throw HttpError::notFound();
        }
    }

    // ---- the team is told (by cron) ----------------------------------------------------------------

    /** One email per new enquiry to enquiry_notify_email, with no visitor text in it. Without a mail account or an address, nothing is sent and nothing fails. */
    public static function cron(Ctx $ctx): string
    {
        $to = $ctx->config['enquiry_notify_email'] ?? null;
        $mail = Mail::platform($ctx);
        if (!is_string($to) || $to === '' || $mail === null) {
            return 'notifications off';
        }
        $rows = $ctx->pdo->query('SELECT id, wants_demo, team_size, sector FROM enquiries WHERE notified_at IS NULL AND created_at > DATE_SUB(UTC_TIMESTAMP(), INTERVAL 1 DAY) ORDER BY created_at LIMIT 20')->fetchAll();
        $sent = 0;
        foreach ($rows as $r) {
            $text = implode("\n", ['A new enquiry has arrived through the contact form on the website.', '', 'Demo requested: ' . ($r['wants_demo'] ? 'yes' : 'no'), 'Team size: ' . ($r['team_size'] ?? 'not given'), 'Sector: ' . ($r['sector'] ?? 'not given'), '',
                'Read and reply from the console: ' . rtrim($ctx->appUrl !== '' ? $ctx->appUrl : 'https://rotaflow.space', '/') . '/admin/enquiries', '', 'The message itself is not included in this email on purpose.']);
            if ($mail['mailer']->send($to, $r['wants_demo'] ? 'New website enquiry: demo requested' : 'New website enquiry', $text)) {
                $ctx->pdo->prepare('UPDATE enquiries SET notified_at = UTC_TIMESTAMP() WHERE id = ?')->execute([$r['id']]);
                $sent++;
            }
        }
        return "enquiry notices sent=$sent";
    }
}
