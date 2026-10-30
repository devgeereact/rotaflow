<?php
declare(strict_types=1);

namespace RotaFlow\Mod;

use RotaFlow\{Audit, Ctx, Db, HttpError, Input, Module, Scope, Time};

/**
 * A private iCalendar feed of a person's PUBLISHED shifts, to subscribe to from a phone calendar. The feed URL carries a secret token
 * (only its SHA-256 is stored); anyone holding the URL can read that one person's shifts, so a person can issue a new one (which
 * revokes the old) or revoke it, and an unused feed switches itself off after 90 days. A bad token is a bare 404 with no detail.
 */
final class CalendarFeed implements Module
{
    private const IDLE_DAYS = 90;

    public function __construct(private readonly Ctx $ctx) {}

    public function routes(): array
    {
        return [
            ['GET', '/orgs/{o}/calendar-feed', $this->status(...)],
            ['POST', '/orgs/{o}/calendar-feed/issue', $this->issue(...)],
            ['POST', '/orgs/{o}/calendar-feed/revoke', $this->revoke(...)],
            ['GET', '/ics', $this->feed(...), 'public'],
        ];
    }

    private function status(array $user, array $in, string $ip, string $o): array
    {
        Scope::membership($this->ctx->pdo, $user['id'], $o);
        $own = Scope::staffProfileId($this->ctx->pdo, $o, $user['id']);
        $q = $this->ctx->pdo->prepare('SELECT created_at, last_used_at FROM calendar_feed_tokens WHERE org_id = ? AND staff_profile_id = ? AND revoked_at IS NULL');
        $q->execute([$o, $own ?? '']);
        $r = $q->fetch();
        return [200, ['active' => $r !== false, 'created_at' => $r === false ? null : Time::iso($r['created_at']), 'last_used_at' => $r === false ? null : Time::iso($r['last_used_at'])]];
    }

    /** Returns the token ONCE; the person subscribes with `<site>/api/ics?token=<token>`. Any earlier feed stops working. */
    private function issue(array $user, array $in, string $ip, string $o): array
    {
        $pdo = $this->ctx->pdo;
        $m = Scope::membership($pdo, $user['id'], $o);
        Scope::requireWritable($m);
        $own = Scope::staffProfileId($pdo, $o, $user['id']);
        if ($own === null) {
            throw new HttpError(403, 'no_staff_record', 'You do not have a staff record in this organisation');
        }
        $this->ctx->limits->hit('calendar-issue', $user['id'], 10, 3600);
        $token = rtrim(strtr(base64_encode(random_bytes(32)), '+/', '-_'), '=');
        $pdo->beginTransaction();
        try {
            $pdo->prepare('UPDATE calendar_feed_tokens SET revoked_at = UTC_TIMESTAMP() WHERE org_id = ? AND staff_profile_id = ? AND revoked_at IS NULL')->execute([$o, $own]);
            $pdo->prepare('INSERT INTO calendar_feed_tokens (id, org_id, staff_profile_id, token_hash) VALUES (?, ?, ?, ?)')->execute([Db::uuid(), $o, $own, hash('sha256', $token)]);
            Audit::log($pdo, $o, $user['id'], 'calendar_feed.issued', 'calendar_feed_tokens', null, [], 'info', 'org', $ip);
            $pdo->commit();
        } catch (\Throwable $e) {
            $pdo->rollBack();
            throw $e;
        }
        return [201, ['token' => $token, 'path' => '/api/ics?token=' . $token]];
    }

    private function revoke(array $user, array $in, string $ip, string $o): array
    {
        $m = Scope::membership($this->ctx->pdo, $user['id'], $o);
        Scope::requireWritable($m);
        $own = Scope::staffProfileId($this->ctx->pdo, $o, $user['id']);
        $this->ctx->pdo->prepare('UPDATE calendar_feed_tokens SET revoked_at = UTC_TIMESTAMP() WHERE org_id = ? AND staff_profile_id = ? AND revoked_at IS NULL')->execute([$o, $own ?? '']);
        return [200, ['ok' => true]];
    }

    /** Public. Published, uncancelled shifts from 30 days ago to 180 days ahead. */
    private function feed(?array $user, array $in, string $ip): array
    {
        $pdo = $this->ctx->pdo;
        $this->ctx->limits->hit('calendar-miss-guard', $ip, 600, 3600);
        $token = Input::str($in, 'token');
        if (preg_match('/^[A-Za-z0-9_-]{43}$/', $token) !== 1) {
            throw HttpError::notFound();
        }
        $q = $pdo->prepare('SELECT id, org_id, staff_profile_id, COALESCE(last_used_at, created_at) AS seen FROM calendar_feed_tokens WHERE token_hash = ? AND revoked_at IS NULL');
        $q->execute([hash('sha256', $token)]);
        $t = $q->fetch();
        if ($t === false) {
            $this->ctx->limits->hit('calendar-miss', $ip, 30, 3600); // a guessing client runs out quickly
            throw HttpError::notFound();
        }
        if (strtotime($t['seen'] . ' UTC') < time() - self::IDLE_DAYS * 86400) {
            $pdo->prepare('UPDATE calendar_feed_tokens SET revoked_at = UTC_TIMESTAMP() WHERE id = ?')->execute([$t['id']]);
            throw HttpError::notFound();
        }
        $this->ctx->limits->hit('calendar-feed', (string) $t['staff_profile_id'], 120, 3600);
        $pdo->prepare('UPDATE calendar_feed_tokens SET last_used_at = UTC_TIMESTAMP() WHERE id = ?')->execute([$t['id']]);
        $s = $pdo->prepare(
            "SELECT s.id, s.starts_at, s.ends_at, s.break_minutes, s.notes, s.updated_at, st.name AS shift_type, l.name AS location_name
               FROM shifts s JOIN rotas r ON r.id = s.rota_id AND r.org_id = s.org_id
               LEFT JOIN shift_types st ON st.id = s.shift_type_id AND st.org_id = s.org_id
               LEFT JOIN locations l ON l.id = s.location_id AND l.org_id = s.org_id
              WHERE s.org_id = ? AND s.staff_profile_id = ? AND s.status <> 'cancelled' AND r.status = 'published'
                AND s.starts_at > DATE_SUB(UTC_TIMESTAMP(), INTERVAL 30 DAY) AND s.starts_at < DATE_ADD(UTC_TIMESTAMP(), INTERVAL 180 DAY)
              ORDER BY s.starts_at"
        );
        $s->execute([$t['org_id'], $t['staff_profile_id']]);
        return [200, ['__raw' => ['mime' => 'text/calendar; charset=utf-8', 'body' => self::ics($s->fetchAll()), 'cache' => 'private, max-age=900', 'filename' => 'rotaflow.ics']]];
    }

    /** @param list<array<string,mixed>> $shifts */
    public static function ics(array $shifts, ?int $now = null): string
    {
        $stamp = gmdate('Ymd\THis\Z', $now ?? time());
        $lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//RotaFlow//Shifts//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', 'X-WR-CALNAME:RotaFlow shifts'];
        foreach ($shifts as $s) {
            $desc = [];
            if (!empty($s['break_minutes'])) {
                $desc[] = 'Break: ' . (int) $s['break_minutes'] . ' minutes';
            }
            if (!empty($s['notes'])) {
                $desc[] = (string) $s['notes'];
            }
            array_push(
                $lines,
                'BEGIN:VEVENT',
                'UID:' . $s['id'] . '@rotaflow.space',
                'DTSTAMP:' . $stamp,
                'DTSTART:' . gmdate('Ymd\THis\Z', strtotime($s['starts_at'] . ' UTC')),
                'DTEND:' . gmdate('Ymd\THis\Z', strtotime($s['ends_at'] . ' UTC')),
                'SEQUENCE:' . (int) strtotime(($s['updated_at'] ?? $s['starts_at']) . ' UTC'),
                'SUMMARY:' . self::text(($s['shift_type'] ?: 'Shift') . (!empty($s['location_name']) ? ' at ' . $s['location_name'] : '')),
            );
            if (!empty($s['location_name'])) {
                $lines[] = 'LOCATION:' . self::text((string) $s['location_name']);
            }
            if ($desc !== []) {
                $lines[] = 'DESCRIPTION:' . self::text(implode("\n", $desc));
            }
            array_push($lines, 'STATUS:CONFIRMED', 'END:VEVENT');
        }
        $lines[] = 'END:VCALENDAR';
        return implode("\r\n", array_map(self::fold(...), $lines)) . "\r\n";
    }

    /** RFC 5545 text escaping; control characters are removed so a note cannot add a property line. */
    public static function text(string $v): string
    {
        $v = preg_replace('/[\x00-\x09\x0B-\x1F\x7F]/', '', $v) ?? '';
        return str_replace(["\\", ';', ',', "\n"], ['\\\\', '\;', '\\,', '\\n'], $v);
    }

    /** Folds a content line at 75 octets, on a character boundary, continuing with a single space. */
    public static function fold(string $line): string
    {
        if (strlen($line) <= 75) {
            return $line;
        }
        $out = '';
        $cur = '';
        foreach (preg_split('//u', $line, -1, PREG_SPLIT_NO_EMPTY) ?: [] as $ch) {
            $limit = $out === '' ? 75 : 74;
            if (strlen($cur) + strlen($ch) > $limit) {
                $out .= ($out === '' ? '' : "\r\n ") . $cur;
                $cur = '';
            }
            $cur .= $ch;
        }
        return $out . ($cur === '' ? '' : ($out === '' ? '' : "\r\n ") . $cur);
    }
}
