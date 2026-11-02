<?php
declare(strict_types=1);

namespace RotaFlow;

/**
 * The private file store: plain files under <private root>/uploads, outside every web root, reached only through the API (an owner or the
 * person, after a permission check). Two buckets, both laid out as <org id>/<staff profile id>/<file>. Every path is checked against a strict
 * shape and against the store's root before anything touches the disk, so a crafted name cannot reach another folder.
 */
final class FileStore
{
    private const RESERVE_BYTES = 1073741824;
    public const DOCUMENTS = 'staff-documents';
    public const PHOTOS = 'staff-photos';
    public const BUCKETS = [self::DOCUMENTS, self::PHOTOS];
    private const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';

    public function __construct(private readonly string $root) {}

    public static function forCtx(Ctx $ctx): self
    {
        return new self(rtrim($ctx->privateRoot, '/') . '/uploads');
    }

    public static function validFolder(string $path): bool
    {
        return preg_match('#^' . self::UUID . '(/' . self::UUID . ')?$#', $path) === 1;
    }

    public static function validObject(string $path): bool
    {
        return preg_match('#^' . self::UUID . '/' . self::UUID . '/[A-Za-z0-9][A-Za-z0-9._-]{0,127}$#', $path) === 1;
    }

    public function put(string $bucket, string $path, string $bytes): void
    {
        // Keep 1 GiB free for the database and logs on a shared host (security audit, 1 Nov 2026).
        $free = @disk_free_space(is_dir($this->root) ? $this->root : dirname($this->root));
        if ($free !== false && $free - strlen($bytes) < self::RESERVE_BYTES) {
            throw new HttpError(507, 'storage_full', 'Storage is full. Try again later');
        }
        $abs = $this->resolve($bucket, $path, false);
        if (!is_dir(dirname($abs)) && !mkdir(dirname($abs), 0700, true) && !is_dir(dirname($abs))) {
            throw new \RuntimeException('store not writable');
        }
        if (file_exists($abs)) {
            throw new \RuntimeException('exists'); // an upload never overwrites
        }
        if (file_put_contents($abs, $bytes, LOCK_EX) === false) {
            throw new \RuntimeException('store not writable');
        }
        chmod($abs, 0600);
    }

    public function get(string $bucket, string $path): ?string
    {
        $abs = $this->resolve($bucket, $path, false);
        $b = is_file($abs) ? file_get_contents($abs) : false;
        return $b === false ? null : $b;
    }

    public function exists(string $bucket, string $path): bool
    {
        return is_file($this->resolve($bucket, $path, false));
    }

    /** Removes a file or a whole folder. Not being there is success, so a retry is always safe. */
    public function delete(string $bucket, string $path, bool $folder): void
    {
        $abs = $this->resolve($bucket, $path, $folder);
        if (!file_exists($abs)) {
            return;
        }
        if (is_link($abs)) {
            throw new \RuntimeException('refusing a link');
        }
        $folder ? $this->rmTree($abs) : (unlink($abs) ?: throw new \RuntimeException('could not remove'));  // nosemgrep: php.lang.security.unlink-use.unlink-use -- path comes from resolve(): fixed bucket allowlist plus a strict UUID/UUID/name pattern, symlinks refused
    }

    private function resolve(string $bucket, string $path, bool $folder): string
    {
        if (!in_array($bucket, self::BUCKETS, true) || !($folder ? self::validFolder($path) : self::validObject($path))) {
            throw new \InvalidArgumentException('not a path this store holds');
        }
        return $this->root . '/' . $bucket . '/' . $path;
    }

    private function rmTree(string $dir): void
    {
        foreach (scandir($dir) ?: [] as $e) {
            if ($e === '.' || $e === '..') {
                continue;
            }
            $p = $dir . '/' . $e;
            if (is_link($p)) {
                throw new \RuntimeException('refusing a link');
            }
            is_dir($p) ? $this->rmTree($p) : (unlink($p) ?: throw new \RuntimeException('could not remove'));  // nosemgrep: php.lang.security.unlink-use.unlink-use -- walks a folder already resolved and pattern-checked by resolve(); symlinks refused
        }
        rmdir($dir) ?: throw new \RuntimeException('could not remove');
    }
}
