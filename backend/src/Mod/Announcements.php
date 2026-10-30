<?php
declare(strict_types=1);

namespace RotaFlow\Mod;

use RotaFlow\{Audit, Ctx, Db, HttpError, Input, Module, Notify, Scope, Str, Time};

/**
 * Organisation notices. Owners and managers write them; a member reads the PUBLISHED ones (a draft is not readable by staff: the old
 * policy let any member read drafts, which the screens hid). Publishing for the first time queues one notification to the audience,
 * and editing a published notice notifies nobody a second time. The audience is the active staff with a login: everyone, or one
 * department, or one location (through its departments).
 */
final class Announcements implements Module
{
    private const REMIND_PER_HOUR = 6;

    public function __construct(private readonly Ctx $ctx) {}

    public function routes(): array
    {
        return [
            ['GET', '/orgs/{o}/announcements', $this->list(...)],
            ['POST', '/orgs/{o}/announcements', $this->save(...)],
            ['POST', '/orgs/{o}/announcements/{n}', $this->save(...)],
            ['POST', '/orgs/{o}/announcements/{n}/publish', $this->publish(...)],
            ['POST', '/orgs/{o}/announcements/{n}/delete', $this->delete(...)],
            ['POST', '/orgs/{o}/announcements/{n}/read', $this->read(...)],
            ['GET', '/orgs/{o}/announcements/{n}/reads', $this->reads(...)],
            ['POST', '/orgs/{o}/announcements/{n}/remind', $this->remind(...)],
        ];
    }

    private function list(array $user, array $in, string $ip, string $o): array
    {
        $pdo = $this->ctx->pdo;
        $m = Scope::membership($pdo, $user['id'], $o);
        $manager = in_array($m['effective_role'], Scope::MANAGERS, true);
        $own = Scope::staffProfileId($pdo, $o, $user['id']);
        $q = $pdo->prepare(
            'SELECT a.id, a.author_user_id, a.scope, a.location_id, a.department_id, a.title, a.body, a.urgent, a.published_at, a.created_at,
                    (SELECT COUNT(*) FROM announcement_reads r WHERE r.announcement_id = a.id) AS reads_count,
                    EXISTS (SELECT 1 FROM announcement_reads r WHERE r.announcement_id = a.id AND r.staff_profile_id = ?) AS read_by_me
               FROM announcements a WHERE a.org_id = ?' . ($manager ? '' : ' AND a.published_at IS NOT NULL') . ' ORDER BY COALESCE(a.published_at, a.created_at) DESC LIMIT 200'
        );
        $q->execute([$own ?? '', $o]);
        return [200, ['announcements' => array_map(static function (array $r) use ($manager): array {
            $r['urgent'] = (bool) $r['urgent'];
            $r['read_by_me'] = (bool) $r['read_by_me'];
            $r['reads_count'] = $manager ? (int) $r['reads_count'] : null; // how many have read it is for the people who wrote it
            $r['published_at'] = Time::iso($r['published_at']);
            $r['created_at'] = Time::iso($r['created_at']);
            return $r;
        }, $q->fetchAll())]];
    }

    private function save(array $user, array $in, string $ip, string $o, ?string $n = null): array
    {
        $pdo = $this->ctx->pdo;
        $m = $this->manager($user, $o);
        $scope = Input::optStr($in, 'scope', 20) ?? 'org';
        if (!in_array($scope, ['org', 'location', 'department'], true)) {
            throw HttpError::invalid('scope must be org, location or department');
        }
        $loc = $scope === 'location' ? Input::reqStr($in, 'location_id', 36) : null;
        $dep = $scope === 'department' ? Input::reqStr($in, 'department_id', 36) : null;
        foreach (['locations' => $loc, 'departments' => $dep] as $table => $id) {
            if ($id !== null) {
                $c = $pdo->prepare("SELECT 1 FROM $table WHERE id = ? AND org_id = ?"); // $table is a literal key above
                $c->execute([$id, $o]);
                if ($c->fetchColumn() === false) {
                    throw HttpError::invalid('That location or department is not in this organisation');
                }
            }
        }
        $vals = [$scope, $loc, $dep, Input::reqStr($in, 'title', 200), Input::reqStr($in, 'body', 10000), ($in['urgent'] ?? false) === true ? 1 : 0];
        $pdo->beginTransaction();
        try {
            if ($n === null) {
                $id = Db::uuid();
                $pdo->prepare('INSERT INTO announcements (scope, location_id, department_id, title, body, urgent, id, org_id, author_user_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')->execute([...$vals, $id, $o, $user['id']]);
                if (($in['publish'] ?? false) === true) {
                    $this->doPublish($o, $id);
                }
                Audit::log($pdo, $o, $user['id'], 'announcement.created', 'announcements', $id, [], 'info', 'org', $ip);
                $pdo->commit();
                return [201, ['id' => $id]];
            }
            $this->load($o, $n, true);
            $pdo->prepare('UPDATE announcements SET scope = ?, location_id = ?, department_id = ?, title = ?, body = ?, urgent = ? WHERE id = ? AND org_id = ?')->execute([...$vals, $n, $o]);
            Audit::log($pdo, $o, $user['id'], 'announcement.updated', 'announcements', $n, [], 'info', 'org', $ip);
            $pdo->commit();
        } catch (\Throwable $e) {
            $pdo->rollBack();
            throw $e;
        }
        return [200, ['id' => $n]];
    }

    private function publish(array $user, array $in, string $ip, string $o, string $n): array
    {
        $pdo = $this->ctx->pdo;
        $this->manager($user, $o);
        $pdo->beginTransaction();
        try {
            $a = $this->load($o, $n, true);
            $first = $a['published_at'] === null;
            if ($first) {
                $this->doPublish($o, $n);
                Audit::log($pdo, $o, $user['id'], 'announcement.published', 'announcements', $n, [], 'info', 'org', $ip);
            }
            $pdo->commit();
        } catch (\Throwable $e) {
            $pdo->rollBack();
            throw $e;
        }
        return [200, ['id' => $n, 'already_published' => !$first]];
    }

    private function delete(array $user, array $in, string $ip, string $o, string $n): array
    {
        $pdo = $this->ctx->pdo;
        $this->manager($user, $o);
        $this->load($o, $n, false);
        $pdo->prepare('DELETE FROM announcements WHERE id = ? AND org_id = ?')->execute([$n, $o]);
        Audit::log($pdo, $o, $user['id'], 'announcement.deleted', 'announcements', $n, [], 'warning', 'org', $ip);
        return [200, ['ok' => true]];
    }

    /** A person marks a published notice as read. Idempotent. */
    private function read(array $user, array $in, string $ip, string $o, string $n): array
    {
        $pdo = $this->ctx->pdo;
        $m = Scope::membership($pdo, $user['id'], $o);
        $own = Scope::staffProfileId($pdo, $o, $user['id']);
        if ($own === null) {
            throw new HttpError(403, 'no_staff_record', 'You do not have a staff record in this organisation');
        }
        $a = $this->load($o, $n, false);
        if ($a['published_at'] === null && !in_array($m['effective_role'], Scope::MANAGERS, true)) {
            throw HttpError::notFound(); // a draft does not exist for staff
        }
        $pdo->prepare('INSERT IGNORE INTO announcement_reads (announcement_id, staff_profile_id, org_id) VALUES (?, ?, ?)')->execute([$n, $own, $o]);
        return [200, ['ok' => true]];
    }

    /** Owner and manager: who has read it, and who in the audience has not. */
    private function reads(array $user, array $in, string $ip, string $o, string $n): array
    {
        $pdo = $this->ctx->pdo;
        $this->manager($user, $o, false);
        $this->load($o, $n, false);
        $q = $pdo->prepare('SELECT staff_profile_id, read_at FROM announcement_reads WHERE announcement_id = ? AND org_id = ? ORDER BY read_at');
        $q->execute([$n, $o]);
        $unread = count($this->audience($o, $n, true));
        return [200, ['reads' => array_map(static fn (array $r): array => ['staff_profile_id' => $r['staff_profile_id'], 'read_at' => Time::iso($r['read_at'])], $q->fetchAll()), 'unread_in_audience' => $unread]];
    }

    /** Queue a reminder to everyone in the audience who has not read it. Returns how many. */
    private function remind(array $user, array $in, string $ip, string $o, string $n): array
    {
        $pdo = $this->ctx->pdo;
        $this->manager($user, $o);
        $a = $this->load($o, $n, false);
        if ($a['published_at'] === null) {
            throw HttpError::conflict('not_published', 'Publish the announcement first');
        }
        $this->ctx->limits->hit('announcement-remind', $n, self::REMIND_PER_HOUR, 3600);
        $unread = $this->audience($o, $n, true);
        if ($unread !== []) {
            Notify::enqueue($pdo, $o, 'announcement/published', $unread, 'announcement', $a['title'], $a['body']);
        }
        Audit::log($pdo, $o, $user['id'], 'announcement.reminded', 'announcements', $n, ['count' => count($unread)], 'info', 'org', $ip);
        return [200, ['reminded' => count($unread)]];
    }

    // ---- helpers ---------------------------------------------------------------------------------------

    /** Inside the caller's transaction. */
    private function doPublish(string $o, string $id): void
    {
        $this->ctx->pdo->prepare('UPDATE announcements SET published_at = UTC_TIMESTAMP() WHERE id = ? AND org_id = ? AND published_at IS NULL')->execute([$id, $o]);
        $a = $this->load($o, $id, false);
        $aud = $this->audience($o, $id, false);
        if ($aud !== []) {
            Notify::enqueue($this->ctx->pdo, $o, 'announcement/published', $aud, 'announcement', $a['title'], $a['body']);
        }
    }

    /**
     * The users an announcement is addressed to: active staff with a login, narrowed by its department, or by its location through
     * the departments there. One definition, shared by publishing and the unread reminder.
     * @return list<string>
     */
    private function audience(string $o, string $id, bool $unreadOnly): array
    {
        $q = $this->ctx->pdo->prepare(
            "SELECT sp.user_id FROM announcements a
               JOIN staff_profiles sp ON sp.org_id = a.org_id AND sp.active = 1 AND sp.user_id IS NOT NULL
               LEFT JOIN departments d ON d.id = sp.department_id AND d.org_id = sp.org_id
              WHERE a.id = ? AND a.org_id = ?
                AND CASE WHEN a.department_id IS NOT NULL THEN sp.department_id = a.department_id
                         WHEN a.location_id IS NOT NULL THEN d.location_id = a.location_id ELSE 1 END"
            . ($unreadOnly ? ' AND NOT EXISTS (SELECT 1 FROM announcement_reads r WHERE r.announcement_id = a.id AND r.staff_profile_id = sp.id)' : '')
        );
        $q->execute([$id, $o]);
        return $q->fetchAll(\PDO::FETCH_COLUMN);
    }

    /** @return array<string,mixed> */
    private function load(string $o, string $n, bool $lock): array
    {
        $q = $this->ctx->pdo->prepare('SELECT * FROM announcements WHERE id = ? AND org_id = ?' . ($lock ? ' FOR UPDATE' : ''));
        $q->execute([$n, $o]);
        return $q->fetch() ?: throw HttpError::notFound();
    }

    private function manager(array $user, string $o, bool $write = true): array
    {
        $m = Scope::membership($this->ctx->pdo, $user['id'], $o);
        Scope::require($m, Scope::MANAGERS);
        if ($write) {
            Scope::requireWritable($m);
        }
        return $m;
    }
}
