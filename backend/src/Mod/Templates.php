<?php
declare(strict_types=1);

namespace RotaFlow\Mod;

use RotaFlow\{Audit, Ctx, Db, HttpError, Input, Module, Scope};

/**
 * The wording of notification emails, written by platform owners and admins: a platform-wide row, or one for a single organisation, which wins.
 * Only the placeholders the Dispatcher fills may appear, so a typo cannot ship a literal "{{staff_nmae}}" to a customer's staff.
 */
final class Templates implements Module
{
    private const VARS = ['org_name', 'staff_name', 'title', 'body', 'body_line', 'app_url'];

    public function __construct(private readonly Ctx $ctx) {}

    public function routes(): array
    {
        return [
            ['GET', '/platform/notification-templates', $this->list(...)],
            ['POST', '/platform/notification-templates', $this->save(...)],
            ['POST', '/platform/notification-templates/delete', $this->delete(...)],
        ];
    }

    private function staff(array $user, array $roles): void
    {
        if (!in_array(Scope::platformRole($this->ctx->pdo, $user['id']), $roles, true)) {
            throw HttpError::notFound();
        }
    }

    private function list(array $user, array $in, string $ip): array
    {
        $this->staff($user, ['platform_owner', 'platform_admin', 'platform_support']);
        return [200, ['templates' => $this->ctx->pdo->query("SELECT t.id, t.org_id, o.name AS org_name, t.`key`, t.channel, t.subject, t.body, t.updated_at FROM notification_templates t LEFT JOIN organisations o ON o.id = t.org_id ORDER BY t.`key`, t.org_key")->fetchAll(), 'placeholders' => self::VARS]];
    }

    private function save(array $user, array $in, string $ip): array
    {
        $this->staff($user, ['platform_owner', 'platform_admin']);
        $key = Input::reqStr($in, 'key', 60);
        if (preg_match('/^[a-z][a-z_]{1,59}$/', $key) !== 1) {
            throw HttpError::invalid('key must be lower-case letters and underscores');
        }
        $subject = Input::reqStr($in, 'subject', 300);
        $body = Input::reqStr($in, 'body', 10000);
        if (preg_match('/[\r\n]/', $subject) === 1) {
            throw HttpError::invalid('A subject is one line');
        }
        foreach ([$subject, $body] as $text) {
            preg_match_all('/\{\{([^}]*)\}\}/', $text, $m);
            $bad = array_diff($m[1], self::VARS);
            if ($bad !== []) {
                throw HttpError::invalid('Unknown placeholder {{' . reset($bad) . '}}. You can use: ' . implode(', ', array_map(static fn (string $v): string => '{{' . $v . '}}', self::VARS)));
            }
        }
        $org = Input::optStr($in, 'org_id', 36);
        $pdo = $this->ctx->pdo;
        if ($org !== null) {
            $e = $pdo->prepare('SELECT 1 FROM organisations WHERE id = ?');
            $e->execute([$org]);
            if ($e->fetchColumn() === false) {
                throw HttpError::invalid('That organisation does not exist');
            }
        }
        $pdo->prepare("INSERT INTO notification_templates (id, org_id, org_key, `key`, channel, subject, body) VALUES (?, ?, ?, ?, 'email', ?, ?) ON DUPLICATE KEY UPDATE subject = VALUES(subject), body = VALUES(body)")
            ->execute([Db::uuid(), $org, $org ?? '-', $key, $subject, $body]);
        Audit::log($pdo, $org, $user['id'], 'notification_template.saved', 'notification_templates', null, ['key' => $key], 'info', 'platform_only', $ip);
        return [200, ['key' => $key, 'org_id' => $org]];
    }

    private function delete(array $user, array $in, string $ip): array
    {
        $this->staff($user, ['platform_owner', 'platform_admin']);
        $key = Input::reqStr($in, 'key', 60);
        $org = Input::optStr($in, 'org_id', 36);
        $d = $this->ctx->pdo->prepare("DELETE FROM notification_templates WHERE `key` = ? AND channel = 'email' AND org_key = ?");
        $d->execute([$key, $org ?? '-']);
        if ($d->rowCount() === 0) {
            throw HttpError::notFound();
        }
        Audit::log($this->ctx->pdo, $org, $user['id'], 'notification_template.deleted', 'notification_templates', null, ['key' => $key], 'info', 'platform_only', $ip);
        return [200, ['key' => $key]];
    }
}
