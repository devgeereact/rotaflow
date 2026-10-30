<?php
declare(strict_types=1);

namespace RotaFlow\Mod;

use RotaFlow\{Audit, Ctx, Db, FileStore, HttpError, Input, Module, Scope};

/**
 * Staff photos, kept in the private file store and shown through short-lived signed links, so a picture is never at a guessable address and a
 * link stops working once the picture is replaced, removed or erased. The person themself or an owner or manager may change a photo; any member
 * of the organisation may see it (colleagues appear on the rota). A photo is a JPEG, PNG or WebP of at most 2 MiB, judged by its bytes, not its name.
 */
final class Photos implements Module
{
    private const MAX_BYTES = 2097152;
    private const LINK_SECONDS = 3600;
    private const TYPES = ['image/jpeg' => 'jpg', 'image/png' => 'png', 'image/webp' => 'webp'];

    public function __construct(private readonly Ctx $ctx) {}

    public function routes(): array
    {
        return [
            ['POST', '/orgs/{o}/staff/{s}/photo', $this->upload(...), '', '', 'upload'],
            ['POST', '/orgs/{o}/staff/{s}/photo/delete', $this->remove(...)],
            ['GET', '/orgs/{o}/staff/{s}/photo-link', $this->link(...)],
            ['GET', '/files', $this->serve(...), 'public'],
        ];
    }

    /** The image type the bytes really are, or null. */
    public static function sniff(string $bytes): ?string
    {
        return match (true) {
            str_starts_with($bytes, "\xFF\xD8\xFF") => 'image/jpeg',
            str_starts_with($bytes, "\x89PNG\r\n\x1a\n") => 'image/png',
            strlen($bytes) > 12 && str_starts_with($bytes, 'RIFF') && substr($bytes, 8, 4) === 'WEBP' => 'image/webp',
            default => null,
        };
    }

    public static function sign(array $config, string $bucket, string $path, int $expires): string
    {
        return hash_hmac('sha256', "$bucket|$path|$expires", hash_hmac('sha256', 'file-link', (string) ($config['secret_key'] ?? 'unconfigured')));
    }

    /** @return array{0:array<string,mixed>,1:array<string,mixed>} the membership and the staff row */
    private function target(array $user, string $o, string $s, bool $change): array
    {
        $pdo = $this->ctx->pdo;
        $m = Scope::membership($pdo, $user['id'], $o);
        $q = $pdo->prepare('SELECT id, user_id, photo_path FROM staff_profiles WHERE id = ? AND org_id = ?');
        $q->execute([$s, $o]);
        $row = $q->fetch() ?: throw HttpError::notFound();
        if ($change) {
            Scope::requireWritable($m);
            $self = $row['user_id'] !== null && $row['user_id'] === $user['id'];
            if (!$self && !in_array($m['effective_role'], Scope::MANAGERS, true)) {
                throw HttpError::forbidden();
            }
        }
        return [$m, $row];
    }

    private function upload(array $user, array $in, string $ip, string $o, string $s): array
    {
        [, $row] = $this->target($user, $o, $s, true);
        $data = $in['data'] ?? null;
        $bytes = is_string($data) ? base64_decode($data, true) : false;
        if ($bytes === false || $bytes === '') {
            throw HttpError::invalid('data must be the picture, base64 encoded');
        }
        if (strlen($bytes) > self::MAX_BYTES) {
            throw new HttpError(413, 'photo_too_large', 'A photo can be at most 2 MB');
        }
        $type = self::sniff($bytes);
        if ($type === null) {
            throw new HttpError(415, 'photo_type', 'A photo must be a JPEG, PNG or WebP picture');
        }
        $this->ctx->limits->hit('photo-upload', $user['id'], 20, 3600);
        $path = "$o/$s/" . bin2hex(random_bytes(12)) . '.' . self::TYPES[$type];
        $store = FileStore::forCtx($this->ctx);
        $pdo = $this->ctx->pdo;
        $store->put(FileStore::PHOTOS, $path, $bytes);
        $pdo->beginTransaction();
        try {
            $pdo->prepare('UPDATE staff_profiles SET photo_path = ?, photo_url = NULL WHERE id = ? AND org_id = ?')->execute([$path, $s, $o]);
            if ($row['photo_path'] !== null) { // the replaced picture is owed a delete
                $pdo->prepare("INSERT INTO storage_deletions (id, org_id, bucket, path, is_folder, reason) VALUES (?, ?, ?, ?, 0, 'photo_removed')")->execute([Db::uuid(), $o, FileStore::PHOTOS, $row['photo_path']]);
            }
            Audit::log($pdo, $o, $user['id'], 'staff.photo_changed', 'staff_profiles', $s, [], 'info', 'org', $ip);
            $pdo->commit();
        } catch (\Throwable $e) {
            $pdo->rollBack();
            $store->delete(FileStore::PHOTOS, $path, false); // no orphan on a failure
            throw $e;
        }
        return [200, ['id' => $s]];
    }

    private function remove(array $user, array $in, string $ip, string $o, string $s): array
    {
        [, $row] = $this->target($user, $o, $s, true);
        $pdo = $this->ctx->pdo;
        if ($row['photo_path'] !== null) {
            $pdo->beginTransaction();
            try {
                $pdo->prepare('UPDATE staff_profiles SET photo_path = NULL WHERE id = ? AND org_id = ?')->execute([$s, $o]);
                $pdo->prepare("INSERT INTO storage_deletions (id, org_id, bucket, path, is_folder, reason) VALUES (?, ?, ?, ?, 0, 'photo_removed')")->execute([Db::uuid(), $o, FileStore::PHOTOS, $row['photo_path']]);
                Audit::log($pdo, $o, $user['id'], 'staff.photo_removed', 'staff_profiles', $s, [], 'info', 'org', $ip);
                $pdo->commit();
            } catch (\Throwable $e) {
                $pdo->rollBack();
                throw $e;
            }
        }
        return [200, ['id' => $s]];
    }

    /** Any member of the organisation: a link good for an hour, or `url: null` where there is no stored photo. */
    private function link(array $user, array $in, string $ip, string $o, string $s): array
    {
        [, $row] = $this->target($user, $o, $s, false);
        if ($row['photo_path'] === null) {
            return [200, ['url' => null]];
        }
        $exp = time() + self::LINK_SECONDS;
        $base = rtrim($this->ctx->appUrl, '/') . '/api/files';
        $sig = self::sign($this->ctx->config, FileStore::PHOTOS, $row['photo_path'], $exp);
        return [200, ['url' => $base . '?' . http_build_query(['b' => FileStore::PHOTOS, 'p' => $row['photo_path'], 'e' => $exp, 's' => $sig]), 'expires_at' => gmdate('Y-m-d\TH:i:s\Z', $exp)]];
    }

    /** Public, because an <img> cannot send a sign-in; authorised by the signature, the expiry, and the picture still being the person's current one. */
    private function serve(?array $user, array $in, string $ip): array
    {
        $b = $in['b'] ?? null;
        $p = $in['p'] ?? null;
        $e = $in['e'] ?? null;
        $sig = $in['s'] ?? null;
        if ($b !== FileStore::PHOTOS || !is_string($p) || !is_string($e) || !ctype_digit($e) || !is_string($sig) || (int) $e < time() || !FileStore::validObject($p)
            || !hash_equals(self::sign($this->ctx->config, $b, $p, (int) $e), $sig)) {
            throw HttpError::notFound();
        }
        $current = $this->ctx->pdo->prepare('SELECT 1 FROM staff_profiles WHERE org_id = ? AND photo_path = ?');
        $current->execute([explode('/', $p)[0], $p]);
        $bytes = $current->fetchColumn() === false ? null : FileStore::forCtx($this->ctx)->get($b, $p);
        $type = $bytes === null ? null : self::sniff($bytes);
        if ($bytes === null || $type === null) {
            throw HttpError::notFound();
        }
        return [200, ['__raw' => ['mime' => $type, 'body' => $bytes, 'cache' => 'private, max-age=3000', 'filename' => 'photo.' . self::TYPES[$type]]]];
    }
}
