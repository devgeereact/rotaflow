<?php
declare(strict_types=1);

namespace RotaFlow;

/**
 * Minimal authenticated SMTP client, derived from SiteRelay's. Port 465 uses implicit TLS; any other port connects in the clear
 * and upgrades with STARTTLS (587), and refuses to authenticate if the upgrade is not offered. The certificate and host name are
 * always verified. No dependencies. Recipient and header values are validated so user text cannot inject headers or commands.
 * `$secure = false` exists only so tests can talk to a local fake server on 127.0.0.1.
 */
final class SmtpMailer implements Mailer
{
    private string $error = '';

    public function __construct(
        private readonly string $host,
        private readonly int $port,
        private readonly string $user,
        private readonly string $password,
        private readonly string $fromEmail,
        private readonly string $fromName,
        private readonly bool $secure = true,
        private readonly int $timeout = 10,
        private readonly string $ehloName = 'rotaflow.space',
    ) {
        if (!self::validEmail($fromEmail) || preg_match('/^[A-Za-z0-9.-]{1,253}$/', $host) !== 1) {
            throw new \InvalidArgumentException('Invalid sender address or host');
        }
    }

    public function lastError(): string
    {
        return $this->error;
    }

    public function send(string $toEmail, string $subject, string $text, string $html = ''): bool
    {
        $this->error = '';
        $fp = null;
        try {
            if (!self::validEmail($toEmail)) {
                throw new \RuntimeException('bad_recipient');
            }
            $message = self::build($this->fromEmail, $this->fromName, $toEmail, $subject, $text, $html, $this->ehloName);
            $ssl = ['ssl' => ['verify_peer' => true, 'verify_peer_name' => true, 'peer_name' => $this->host, 'SNI_enabled' => true]];
            $implicit = $this->secure && $this->port === 465;
            $fp = @stream_socket_client(($implicit ? 'ssl://' : 'tcp://') . $this->host . ':' . $this->port, $errno, $errstr, $this->timeout, STREAM_CLIENT_CONNECT, stream_context_create($ssl));
            if (!is_resource($fp)) {
                throw new \RuntimeException('connect_failed');
            }
            stream_set_timeout($fp, $this->timeout);
            $this->expect($fp, '220');
            $this->cmd($fp, 'EHLO ' . $this->ehloName, '250');
            if ($this->secure && !$implicit) {
                $this->cmd($fp, 'STARTTLS', '220');
                stream_context_set_option($fp, $ssl);
                if (@stream_socket_enable_crypto($fp, true, STREAM_CRYPTO_METHOD_TLSv1_2_CLIENT | STREAM_CRYPTO_METHOD_TLSv1_3_CLIENT) !== true) {
                    throw new \RuntimeException('tls_failed');
                }
                $this->cmd($fp, 'EHLO ' . $this->ehloName, '250');
            }
            if ($this->user !== '') {
                $this->cmd($fp, 'AUTH PLAIN ' . base64_encode("\0" . $this->user . "\0" . $this->password), '235');
            }
            $this->cmd($fp, 'MAIL FROM:<' . $this->fromEmail . '>', '250');
            $this->cmd($fp, 'RCPT TO:<' . $toEmail . '>', '250');
            $this->cmd($fp, 'DATA', '354');
            // Dot-stuffing: a line starting with "." is doubled so message text cannot end the DATA phase early.
            fwrite($fp, preg_replace('/^\./m', '..', $message) . "\r\n.\r\n");
            $this->expect($fp, '250');
            @fwrite($fp, "QUIT\r\n");
            return true;
        } catch (\Throwable $e) {
            $this->error = preg_replace('/[^a-z_0-9]/', '', strtolower($e->getMessage())) ?: 'smtp_error';
            return false;
        } finally {
            if (is_resource($fp)) {
                @fclose($fp);
            }
        }
    }

    /** @param resource $fp */
    private function cmd($fp, string $line, string $expect): void
    {
        fwrite($fp, $line . "\r\n");
        $this->expect($fp, $expect);
    }

    /** @param resource $fp */
    private function expect($fp, string $code): void
    {
        do {
            $line = fgets($fp, 1024);
            if ($line === false) {
                throw new \RuntimeException('smtp_timeout');
            }
        } while (strlen($line) >= 4 && $line[3] === '-');
        if (strncmp($line, $code, 3) !== 0) {
            throw new \RuntimeException('smtp_' . substr($line, 0, 3));
        }
    }

    public static function validEmail(string $e): bool
    {
        return strlen($e) <= 254 && filter_var($e, FILTER_VALIDATE_EMAIL) !== false && preg_match('/[\r\n<>,;"\s]/', $e) !== 1;
    }

    /** Builds a message with CRLF endings. Header values are stripped of CR/LF; non-ASCII is MIME-encoded (iconv, not mbstring). */
    public static function build(string $fromEmail, string $fromName, string $toEmail, string $subject, string $text, string $html = '', string $domainHint = 'rotaflow.space'): string
    {
        $hdr = static fn (string $v): string => preg_match('/[^\x20-\x7e]/', $v) === 1 ? '=?UTF-8?B?' . base64_encode($v) . '?=' : $v;
        $clean = static fn (string $v): string => trim(preg_replace('/[\r\n\0]+/', ' ', $v) ?? '');
        $domain = substr(strrchr($fromEmail, '@') ?: '@' . $domainHint, 1);
        $qp = static fn (string $v): string => quoted_printable_encode(preg_replace('/\r\n|\r|\n/', "\r\n", $v) ?? '');
        $head = [
            'From: ' . ($fromName === '' ? '' : $hdr($clean($fromName)) . ' ') . '<' . $fromEmail . '>',
            'To: <' . $toEmail . '>',
            'Subject: ' . $hdr($clean($subject)),
            'Date: ' . gmdate('D, d M Y H:i:s') . ' +0000',
            'Message-ID: <' . bin2hex(random_bytes(12)) . '@' . $domain . '>',
            'MIME-Version: 1.0',
            'Auto-Submitted: auto-generated',
            'X-Auto-Response-Suppress: All',
        ];
        if ($html === '') {
            return implode("\r\n", [...$head, 'Content-Type: text/plain; charset=UTF-8', 'Content-Transfer-Encoding: quoted-printable', '', $qp($text)]);
        }
        $boundary = 'rf_' . bin2hex(random_bytes(12));
        return implode("\r\n", [...$head, 'Content-Type: multipart/alternative; boundary="' . $boundary . '"', '', '--' . $boundary, 'Content-Type: text/plain; charset=UTF-8', 'Content-Transfer-Encoding: quoted-printable', '', $qp($text), '--' . $boundary, 'Content-Type: text/html; charset=UTF-8', 'Content-Transfer-Encoding: quoted-printable', '', $qp($html), '--' . $boundary . '--']);
    }
}
