<?php
declare(strict_types=1);

namespace RotaFlow\DataMove;

use RotaFlow\FileStore;

/**
 * Copies Supabase Storage objects (buckets staff-documents and staff-photos) into the private store FileStore reads:
 * <private root>/uploads/<bucket>/<org>/<person>/<file>, dirs 0700, files 0600. The object list comes from the source
 * database (storage.objects, read-only); the bytes from the Storage API with the service key. Each file is checked
 * against the size and MD5 (ETag) Storage recorded, written to a temporary name and renamed, and its SHA-256 kept in a
 * manifest, so a re-run skips what is already there and intact (resumable). Dry run by default.
 * Not copied: objects queued for deletion, objects of excluded organisations, objects nothing in the database points to,
 * and other buckets (all counted in the report).
 */
final class Files
{
    /** @var array<string,int> */
    private array $counts = ['listed' => 0, 'copied' => 0, 'already_there' => 0, 'would_copy' => 0, 'blocked' => 0, 'orphan' => 0, 'failed' => 0, 'other_bucket' => 0, 'renamed' => 0];
    /** @var list<array{level:string,table:string,key:string,what:string}> */
    private array $problems = [];
    /** @var array<string,array{path:string,sha256:string,size:int}> */
    private array $manifest = [];

    /**
     * @param array<string,true> $blocked "<bucket>/<path>" (or a folder ending in "/") that must not be copied
     * @param \Closure(string):array{0:int,1:string} $fetch GET a URL with the service key: [status, body]
     */
    public function __construct(private readonly \PDO $src, private readonly string $privateRoot, private readonly array $blocked, private readonly \Closure $fetch, private readonly string $baseUrl)
    {
        $mf = $this->manifestPath();
        if (is_file($mf)) {
            $this->manifest = json_decode((string) file_get_contents($mf), true) ?: [];
        }
    }

    public function run(bool $apply): bool
    {
        $refs = [];
        // documents.storage_path is from 0159 and staff_profiles.photo_path from 0162: before them (production is at 0156)
        // nothing in the database points at a stored object, so every object in these buckets is reported as an orphan.
        $schema = SourceSchema::detect($this->src);
        $sel = [];
        if ($schema->has('documents.storage_path')) {
            $sel[] = "SELECT 'staff-documents/' || storage_path FROM public.documents WHERE storage_path IS NOT NULL";
        }
        if ($schema->has('staff_profiles.photo_path')) {
            $sel[] = "SELECT 'staff-photos/' || photo_path FROM public.staff_profiles WHERE photo_path IS NOT NULL";
        }
        foreach ($sel === [] ? [] : $this->src->query(implode(' UNION ALL ', $sel))->fetchAll(\PDO::FETCH_COLUMN) as $r) {
            $refs[$r] = true;
        }
        $q = $this->src->query("SELECT bucket_id, name, metadata->>'size' AS size, metadata->>'eTag' AS etag FROM storage.objects ORDER BY bucket_id, name");
        foreach ($q->fetchAll() as $o) {
            $this->counts['listed']++;
            $id = $o['bucket_id'] . '/' . $o['name'];
            if (!in_array($o['bucket_id'], FileStore::BUCKETS, true)) {
                $this->counts['other_bucket']++;
                $this->problem('warning', $id, 'bucket ' . $o['bucket_id'] . ' is not moved');
                continue;
            }
            if ($this->isBlocked($id)) {
                $this->counts['blocked']++;
                continue;
            }
            if (!isset($refs[$id])) {
                $this->counts['orphan']++;
                $this->problem('warning', $id, 'nothing in the database points to this object: not copied');
                continue;
            }
            $path = Convert::storagePath((string) $o['name']);
            if ($path === null) {
                $this->counts['failed']++;
                $this->problem('error', $id, 'object name is not <org>/<person>/<file>');
                continue;
            }
            if ($path !== $o['name']) {
                $this->counts['renamed']++;
            }
            $dest = rtrim($this->privateRoot, '/') . '/uploads/' . $o['bucket_id'] . '/' . $path;
            if (is_file($dest)) {
                $m = $this->manifest[$id] ?? null;
                if ($m !== null && hash_file('sha256', $dest) === $m['sha256']) {
                    $this->counts['already_there']++;
                    continue;
                }
                // Written by a run that stopped before saving its manifest, or something else: compare the bytes.
            }
            if (!$apply) {
                $this->counts['would_copy']++;
                continue;
            }
            $this->copy($id, $o, $path, $dest);
        }
        if ($apply) {
            $this->saveManifest();
        }
        return $this->errors() === 0;
    }

    /** @param array<string,mixed> $o */
    private function copy(string $id, array $o, string $path, string $dest): void
    {
        $url = rtrim($this->baseUrl, '/') . '/storage/v1/object/' . rawurlencode((string) $o['bucket_id']) . '/' . implode('/', array_map('rawurlencode', explode('/', (string) $o['name'])));
        try {
            [$status, $body] = ($this->fetch)($url);
        } catch (\Throwable $e) {
            $this->counts['failed']++;
            $this->problem('error', $id, 'download failed: ' . Convert::scrub($e->getMessage()));
            return;
        }
        if ($status !== 200) {
            $this->counts['failed']++;
            $this->problem('error', $id, "download answered HTTP $status");
            return;
        }
        if ($o['size'] !== null && (int) $o['size'] !== strlen($body)) {
            $this->counts['failed']++;
            $this->problem('error', $id, 'size differs from what Storage recorded: not written');
            return;
        }
        $etag = trim((string) $o['etag'], '"');
        if (preg_match('/^[0-9a-f]{32}$/', $etag) === 1 && md5($body) !== $etag) {
            $this->counts['failed']++;
            $this->problem('error', $id, 'MD5 differs from the ETag Storage recorded: not written');
            return;
        }
        if (is_file($dest)) {
            if (hash_file('sha256', $dest) === hash('sha256', $body)) {
                $this->manifest[$id] = ['path' => $o['bucket_id'] . '/' . $path, 'sha256' => hash('sha256', $body), 'size' => strlen($body)];
                $this->counts['already_there']++;
            } else {
                $this->counts['failed']++;
                $this->problem('error', $id, 'a different file is already at the destination: left as it is');
            }
            return;
        }
        $dir = dirname($dest);
        $uploads = rtrim($this->privateRoot, '/') . '/uploads';
        foreach ([$uploads, $uploads . '/' . $o['bucket_id'], dirname($dir), $dir] as $d) {
            if (!is_dir($d) && !mkdir($d, 0700) && !is_dir($d)) {
                throw new \RuntimeException('cannot create ' . $d);
            }
        }
        $tmp = $dest . '.part-' . bin2hex(random_bytes(4));
        if (file_put_contents($tmp, $body, LOCK_EX) === false || !chmod($tmp, 0600) || !rename($tmp, $dest)) {
            @unlink($tmp);
            throw new \RuntimeException('cannot write into the private store');
        }
        $this->manifest[$id] = ['path' => $o['bucket_id'] . '/' . $path, 'sha256' => hash('sha256', $body), 'size' => strlen($body)];
        $this->counts['copied']++;
        if (count($this->manifest) % 50 === 0) {
            $this->saveManifest(); // a crash loses at most the last few, and those are re-checked on the next run
        }
    }

    /**
     * The final backup of Supabase Storage: EVERY object of EVERY bucket (orphans and objects queued for deletion included),
     * under its own name, into $dir/<bucket>/<name>, each checked against the recorded size and MD5. Resumable: an object
     * already there with the right size and MD5 is skipped. Writes a SHA256SUMS file. Never touches the private store.
     */
    public function backup(string $dir): bool
    {
        $dir = rtrim($dir, '/');
        $sums = [];
        foreach ($this->src->query("SELECT bucket_id, name, metadata->>'size' AS size, metadata->>'eTag' AS etag FROM storage.objects ORDER BY bucket_id, name")->fetchAll() as $o) {
            $this->counts['listed']++;
            $rel = $o['bucket_id'] . '/' . $o['name'];
            if (str_contains('/' . $rel . '/', '/../') || str_contains($rel, "\0") || str_starts_with((string) $o['name'], '/')) {
                $this->counts['failed']++;
                $this->problem('error', $rel, 'object name is not a safe relative path: not backed up');
                continue;
            }
            $dest = $dir . '/' . $rel;
            $etag = trim((string) $o['etag'], '"');
            $md5ok = static fn (string $b): bool => preg_match('/^[0-9a-f]{32}$/', $etag) !== 1 || md5($b) === $etag;
            if (is_file($dest) && ($o['size'] === null || (int) $o['size'] === filesize($dest)) && $md5ok((string) file_get_contents($dest))) {
                $this->counts['already_there']++;
                $sums[] = hash_file('sha256', $dest) . '  ' . $rel;
                continue;
            }
            $url = rtrim($this->baseUrl, '/') . '/storage/v1/object/' . rawurlencode((string) $o['bucket_id']) . '/' . implode('/', array_map('rawurlencode', explode('/', (string) $o['name'])));
            try {
                [$status, $body] = ($this->fetch)($url);
            } catch (\Throwable $e) {
                $this->counts['failed']++;
                $this->problem('error', $rel, 'download failed: ' . Convert::scrub($e->getMessage()));
                continue;
            }
            if ($status !== 200 || ($o['size'] !== null && (int) $o['size'] !== strlen($body)) || !$md5ok($body)) {
                $this->counts['failed']++;
                $this->problem('error', $rel, $status !== 200 ? "download answered HTTP $status" : 'size or MD5 differs from what Storage recorded');
                continue;
            }
            is_dir(dirname($dest)) || mkdir(dirname($dest), 0700, true);
            file_put_contents($dest . '.part', $body, LOCK_EX);
            chmod($dest . '.part', 0600);
            rename($dest . '.part', $dest);
            $this->counts['copied']++;
            $sums[] = hash('sha256', $body) . '  ' . $rel;
        }
        if (is_dir($dir)) {
            file_put_contents($dir . '/SHA256SUMS', implode("\n", $sums) . "\n");
            chmod($dir . '/SHA256SUMS', 0600);
        }
        return $this->errors() === 0;
    }

    /** Every file in the manifest is still there with the same SHA-256. */
    public function verify(): bool
    {
        $ok = 0;
        foreach ($this->manifest as $id => $m) {
            $f = rtrim($this->privateRoot, '/') . '/uploads/' . $m['path'];
            if (!is_file($f) || hash_file('sha256', $f) !== $m['sha256']) {
                $this->problem('error', $id, 'missing or changed in the private store');
            } else {
                $ok++;
            }
        }
        $this->counts['verified'] = $ok;
        return $this->errors() === 0;
    }

    private function isBlocked(string $id): bool
    {
        if (isset($this->blocked[$id])) {
            return true;
        }
        foreach ($this->blocked as $b => $_) {
            if (str_ends_with($b, '/') && str_starts_with($id, $b)) {
                return true;
            }
        }
        return false;
    }

    private function manifestPath(): string
    {
        return rtrim($this->privateRoot, '/') . '/datamove/files-manifest.json';
    }

    private function saveManifest(): void
    {
        $dir = dirname($this->manifestPath());
        is_dir($dir) || mkdir($dir, 0700, true);
        file_put_contents($this->manifestPath(), json_encode($this->manifest, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES), LOCK_EX);
        chmod($this->manifestPath(), 0600);
    }

    private function problem(string $level, string $id, string $what): void
    {
        $this->problems[] = ['level' => $level, 'table' => 'storage', 'key' => $id, 'what' => $what];
    }

    public function errors(): int
    {
        return count(array_filter($this->problems, static fn (array $p): bool => $p['level'] === 'error'));
    }

    /** @return array{counts:array<string,int>,problems:list<array<string,string>>} */
    public function result(): array
    {
        return ['counts' => $this->counts, 'problems' => $this->problems];
    }
}
