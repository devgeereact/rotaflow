<?php
declare(strict_types=1);

namespace RotaFlow\DataMove;

use RotaFlow\Secret;

/**
 * Reads the Supabase database (one REPEATABLE READ, READ ONLY snapshot: it cannot write there) and writes the MariaDB
 * schema at migration 020 through the API's own private config. plan() writes nothing; apply() writes one transaction per
 * group in foreign-key order and is idempotent (a row already there and identical is skipped, a row there but different is
 * a reported conflict and is never overwritten); verify() compares counts, a checksum per table and a field-by-field sample.
 */
final class Mover
{
    private const CHUNK = 2000;
    private const BATCH = 200;
    /** Tables that make a target "not empty" for the --resume rule. */
    private const TENANT_TABLES = ['users', 'organisations', 'memberships', 'staff_profiles', 'shifts', 'clock_events', 'documents', 'audit_logs'];

    /** @var array<string,array<string,array<string,mixed>>> target column metadata per table */
    private array $cols = [];
    /** @var array<string,list<array{name:string,cols:list<string>}>> */
    private array $uniques = [];
    /** @var array<string,list<array{name:string,cols:list<string>,ref:string,refcols:list<string>}>> */
    private array $fks = [];
    /** @var array<string,array<string,array<string,?string>>> planned rows per table, keyed by key string */
    private array $rows = [];
    /** @var array<string,array<string,string>> source plaintext of secret columns per table and key */
    private array $secrets = [];
    /** @var array<string,array<string,int>> */
    private array $counts = [];
    /** @var list<array{level:string,table:string,key:string,what:string}> */
    private array $problems = [];
    /** @var array<string,array<string,int>> */
    private array $notes = [];
    /** @var list<string> */
    private array $excluded = [];
    /** @var list<string> */
    private array $targetFlags = [];
    private bool $planned = false;
    /** @var array<string,array<string,true>> */
    private array $parentCache = [];
    /** What the source has: production is at 0156, the repo at 0164 (read inside the snapshot). */
    private SourceSchema $schema;

    /**
     * @param array<string,mixed> $config the API's private config (secret_key encrypts SMTP passwords)
     * @param array{exclude_orgs?:list<string>,exclude_demo?:bool,sample?:int,only?:list<string>} $opts
     */
    public function __construct(private readonly \PDO $src, private readonly \PDO $dst, private readonly array $config, private readonly array $opts = [])
    {
        $this->src->setAttribute(\PDO::ATTR_ERRMODE, \PDO::ERRMODE_EXCEPTION);
        $this->src->setAttribute(\PDO::ATTR_DEFAULT_FETCH_MODE, \PDO::FETCH_ASSOC);
        $this->src->exec("SET TIME ZONE 'UTC'");
        $this->src->exec('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
        $this->schema = SourceSchema::detect($this->src);
        $ex = array_values(array_unique(array_map('strtolower', $opts['exclude_orgs'] ?? [])));
        if (!empty($opts['exclude_demo'])) {
            $ex = array_values(array_unique([...$ex, ...$this->src->query('SELECT id::text FROM public.organisations WHERE is_demo')->fetchAll(\PDO::FETCH_COLUMN)]));
        }
        $this->excluded = $ex;
        $this->src->prepare("SELECT set_config('rotaflow.excluded_orgs', ?, true)")->execute(['{' . implode(',', $ex) . '}']);
        $this->loadTargetSchema();
    }

    // ------------------------------------------------------------------ plan ----

    /** Reads, converts and checks everything; writes nothing anywhere. */
    public function plan(): void
    {
        $this->checkTargetVersion();
        foreach ($this->schema->problems(fn (string $sql): int => (int) $this->src->query($sql)->fetchColumn()) as $p) {
            $this->problem($p['level'], $p['table'], '-', $p['what']);
        }
        $this->checkCoverage();
        $this->targetFlags = $this->dst->query('SELECT flag_key FROM feature_flags')->fetchAll(\PDO::FETCH_COLUMN);
        $order = [];
        foreach ($this->defs() as $i => $d) {
            $order[$d['table']] = $i;
        }
        foreach ($this->defs() as $d) {
            foreach ($this->fks[$d['table']] ?? [] as $fk) {
                if (isset($order[$fk['ref']]) && $order[$fk['ref']] > $order[$d['table']]) {
                    $this->problem('error', $d['table'], '-', "map order: {$fk['ref']} must come before {$d['table']} ({$fk['name']})");
                }
            }
            $this->planTable($d);
        }
        $this->checkUsers();
        foreach ($this->defs() as $d) {
            $this->checkUniques($d);
            $this->checkForeignKeys($d);
        }
        $this->planned = true;
    }

    /** @param array<string,mixed> $d */
    private function planTable(array $d): void
    {
        $t = $d['table'];
        $this->rows[$t] = [];
        $this->counts[$t] = ['source' => 0, 'planned' => 0, 'skipped' => 0];
        $meta = $this->cols[$t] ?? null;
        if ($meta === null) {
            $this->problem('error', $t, '-', 'target table missing (is the target at migration 020?)');
            return;
        }
        $sql = $this->expand($d['sql']) . ' ORDER BY ' . $d['order'];
        $seenCols = null;
        for ($off = 0; ; $off += self::CHUNK) {
            $batch = $this->src->query($sql . ' LIMIT ' . self::CHUNK . ' OFFSET ' . $off)->fetchAll();
            foreach ($batch as $row) {
                $this->counts[$t]['source']++;
                $skip = isset($d['transform']) ? $this->{'t' . ucfirst($d['transform'])}($row) : null;
                if ($skip !== null) {
                    $this->counts[$t]['skipped']++;
                    $this->note($t, 'skipped: ' . $skip);
                    continue;
                }
                $key = $this->keyOf($d, $row);
                if ($seenCols === null) {
                    $seenCols = array_keys($row);
                    $this->checkColumns($d, $seenCols);
                }
                $out = [];
                $bad = false;
                foreach ($row as $c => $v) {
                    if ($c[0] === '_') {
                        continue;
                    }
                    if (!isset($meta[$c])) {
                        continue; // reported once by checkColumns
                    }
                    [$val, $err] = Convert::value($v, $meta[$c]);
                    if ($err !== null) {
                        $this->problem('error', $t, $key, "$c: $err");
                        $bad = true;
                    }
                    $out[$c] = $val;
                }
                foreach ($d['secret'] ?? [] as $col => $plainCol) {
                    $this->secrets[$t][$key] = (string) ($row[$plainCol] ?? '');
                }
                if (($d['mode'] ?? 'insert') === 'audit') {
                    $out['_source_id'] = $row['_source_id'];
                }
                if (isset($this->rows[$t][$key])) {
                    $this->problem('error', $t, $key, 'two source rows for one target key');
                    $bad = true;
                }
                if (!$bad) {
                    $this->rows[$t][$key] = $out;
                    $this->counts[$t]['planned']++;
                }
            }
            if (count($batch) < self::CHUNK) {
                break;
            }
        }
    }

    /** @param array<string,mixed> $d @param list<string> $cols */
    private function checkColumns(array $d, array $cols): void
    {
        $t = $d['table'];
        $meta = $this->cols[$t];
        foreach ($cols as $c) {
            if ($c[0] === '_') {
                continue;
            }
            if (!isset($meta[$c])) {
                $this->problem('error', $t, '-', "column $c does not exist in the target");
            } elseif ($meta[$c]['generated']) {
                $this->problem('error', $t, '-', "column $c is generated in the target and cannot be written");
            }
        }
        if (($d['mode'] ?? 'insert') !== 'insert') {
            return;
        }
        foreach ($meta as $c => $m) {
            if (!in_array($c, $cols, true) && !$m['nullable'] && !$m['has_default'] && !$m['generated'] && !$m['auto']) {
                $this->problem('error', $t, '-', "required target column $c is not supplied");
            }
        }
    }

    // ------------------------------------------------------------------ transforms (return a skip reason or null) ----

    /** @param array<string,mixed> $r */
    private function tUsers(array &$r): ?string
    {
        $placeholder = $r['id'] . '@removed.rotaflow.invalid';
        $why = null;
        if ($r['_pending_erasure']) {
            $why = 'erasure pending on Supabase';
        } elseif ($r['_erasure_closed']) {
            // 0162's rule, applied whatever the source version: a completed erasure case removes the subject's login. Before
            // 0162 (production is at 0156) closing the case left the login, so the account is still there to be moved.
            $why = 'erasure case completed on Supabase while the login stayed (the 0162 rule)';
            if ($r['_owner'] || $r['_platform_admin']) {
                $this->problem('warning', 'users', $r['id'], 'erasure case completed but the person still ' . ($r['_owner'] ? 'owns an organisation' : 'holds a platform role')
                    . ' (0162 would have refused to close it): moved unlinkable, so that role has nobody who can sign in; give it to someone else after the move');
            }
        } elseif ($r['_deleted_at'] !== null) {
            $why = 'deleted on Supabase';
        } elseif (!$r['_has_profile']) {
            $why = 'no profile (referenced only as an author)';
        } elseif ($r['_anonymous'] || $r['email'] === null || filter_var($r['email'], FILTER_VALIDATE_EMAIL) === false) {
            $why = 'no usable email';
        }
        if ($why !== null) {
            // Kept so history that names them stays whole, but under an address nobody can verify: it can never be linked.
            $this->note('users', 'unlinkable placeholder: ' . $why);
            $r['email'] = $placeholder;
            $r['full_name'] = null;
            $r['avatar_url'] = null;
            return null;
        }
        if (!$r['_confirmed']) {
            $this->note('users', 'email never confirmed on Supabase (links only once that address is verified in Clerk)');
        }
        if ($r['_banned']) {
            $this->problem('warning', 'users', $r['id'], 'banned on Supabase: ban the same address in Clerk, or suspend the memberships');
        }
        $prov = array_filter(explode(',', (string) $r['_providers']));
        if ($prov !== [] && !in_array('email', $prov, true)) {
            $this->note('users', 'signed in only with ' . implode('+', $prov) . ' (they now sign in with an email code to the same address)');
        }
        if ($r['_profile_email'] !== null && $r['_profile_email'] !== $r['email']) {
            $this->note('users', 'profile email differs from the login email (the login email is kept)');
        }
        if ($r['_legacy_admin'] && !$r['_platform_admin']) {
            $this->problem('warning', 'users', $r['id'], 'legacy is_platform_admin without a platform_admins row: not made an administrator');
        }
        if ($r['avatar_url'] !== null && (strlen($r['avatar_url']) > 500 || preg_match('#^https://#', $r['avatar_url']) !== 1)) {
            $this->note('users', 'avatar dropped (not https or longer than 500)');
            $r['avatar_url'] = null;
        }
        return null;
    }

    /** @param array<string,mixed> $r */
    private function tOrganisations(array &$r): ?string
    {
        if ($r['_is_demo']) {
            $this->note('organisations', 'demo organisation moved (use --exclude-demo-orgs to leave demo organisations behind)');
        }
        return null;
    }

    /** @param array<string,mixed> $r */
    private function tInvites(array &$r): ?string
    {
        if ($r['accepted_at'] === null && $r['revoked_at'] === null && strcmp((string) $r['expires_at'], gmdate('Y-m-d H:i:s')) > 0) {
            $this->note('invites', 'pending invitation moved (its emailed link keeps working: same SHA-256 token scheme)');
        }
        return null;
    }

    /** @param array<string,mixed> $r */
    private function tStaffProfiles(array &$r): ?string
    {
        if ($r['photo_path'] !== null) {
            $safe = Convert::storagePath($r['photo_path']);
            if ($safe === null || !str_starts_with($safe, $r['org_id'] . '/' . $r['id'] . '/')) {
                $this->problem('warning', 'staff_profiles', $r['id'], 'photo path is not <org>/<person>/<file>: photo dropped');
                $r['photo_path'] = null;
            } elseif ($safe !== $r['photo_path']) {
                $this->note('staff_profiles', 'photo file renamed to a safe name');
                $r['photo_path'] = $safe;
            }
        }
        if ($r['user_id'] === null && $r['email'] === null) {
            $this->note('staff_profiles', 'no login and no email (an erased or never-invited person)');
        }
        return null;
    }

    /** @param array<string,mixed> $r */
    private function tPayRates(array &$r): ?string
    {
        if ($r['_has_note']) {
            $this->note('staff_pay_rates', 'LOSSY: rate note not kept');
        }
        return null;
    }

    /** @param array<string,mixed> $r */
    private function tSmtp(array &$r): ?string
    {
        $key = $this->config['secret_key'] ?? null;
        if (!is_string($key) || $key === '') {
            $this->problem('error', 'org_smtp_settings', $r['org_id'], 'secret_key missing from the private config: the SMTP password cannot be encrypted');
            $r['smtp_pass_enc'] = null;
            return null;
        }
        $r['smtp_pass_enc'] = Secret::encrypt((string) $r['_smtp_pass'], $key);
        $this->note('org_smtp_settings', 'password encrypted with the target secret_key');
        return null;
    }

    /** @param array<string,mixed> $r */
    private function tDocuments(array &$r): ?string
    {
        if ($r['storage_path'] !== null) {
            $safe = Convert::storagePath($r['storage_path']);
            if ($safe === null || !str_starts_with($safe, $r['org_id'] . '/' . $r['staff_profile_id'] . '/')) {
                $this->problem('error', 'documents', $r['id'], 'storage path is not <org>/<person>/<file>');
            } elseif ($safe !== $r['storage_path']) {
                $this->note('documents', 'file renamed to a safe name');
                $r['storage_path'] = $safe;
            }
        }
        if ($r['file_url'] !== null && preg_match('#\.supabase\.(co|in)/#', $r['file_url']) === 1) {
            $this->problem('warning', 'documents', $r['id'], 'links to a Supabase URL that stops working when the project is retired: download it and upload it again');
        }
        if ($r['mime'] !== null && strlen($r['mime']) > 60) {
            $r['mime'] = null;
        }
        return null;
    }

    /** @param array<string,mixed> $r */
    private function tPlatformSettings(array &$r): ?string
    {
        foreach (['support_email', 'platform_url'] as $c) {
            if (is_string($r[$c]) && str_contains(strtolower($r[$c]), 'rotaflow.app')) {
                $this->problem('warning', 'platform_settings', '1', "$c names rotaflow.app (not ours): left at the target's value");
                unset($r[$c]);
            }
        }
        if ($r['maintenance_mode']) {
            $this->note('platform_settings', 'maintenance mode was on at the source; the target keeps its own (off)');
        }
        return null;
    }

    /** @param array<string,mixed> $r */
    private function tFlagChild(array &$r): ?string
    {
        return in_array($r['flag_key'], $this->targetFlags, true) ? null : "flag {$r['flag_key']} does not exist in the target";
    }

    /** @param array<string,mixed> $r */
    private function tSupportCases(array &$r): ?string
    {
        if ($r['_due_filled']) {
            $this->note('support_cases', 'missing SLA due times filled from creation time and the SLA targets');
        }
        return null;
    }

    /** @param array<string,mixed> $r */
    private function tPlatformAnnouncements(array &$r): ?string
    {
        if ($r['_channel'] !== 'in_app') {
            $this->note('platform_announcements', 'LOSSY: channel ' . $r['_channel'] . ' not kept (the target delivers in-app)');
        }
        return null;
    }

    /** @param array<string,mixed> $r */
    private function tAccountDeletions(array &$r): ?string
    {
        if ($r['status'] !== 'done' && $r['status'] !== 'abandoned') {
            // The login it waited to delete was a Supabase one; it goes when the project is retired. The users row was
            // moved under an unverifiable placeholder address, so nobody can sign in to it through Clerk.
            $this->note('account_deletions', 'pending Supabase login deletion closed as abandoned (the Supabase project is retired)');
            $r['status'] = 'abandoned';
            $r['last_error'] = 'moved from Supabase: the Supabase login is removed with the project';
        }
        return null;
    }

    /** @param array<string,mixed> $r */
    private function tStorageDeletions(array &$r): ?string
    {
        if ($r['status'] === 'sent') {
            $r['status'] = 'pending';
            $this->note('storage_deletions', 'in-flight deletion re-queued as pending');
        }
        if ($r['status'] === 'pending') {
            $this->note('storage_deletions', 'pending deletion: the file is not copied by the files step');
        }
        return null;
    }

    /** @param array<string,mixed> $r */
    private function tAudit(array &$r): ?string
    {
        return null;
    }

    // ------------------------------------------------------------------ checks ----

    private function checkTargetVersion(): void
    {
        $have = $this->dst->query('SELECT name FROM schema_migrations')->fetchAll(\PDO::FETCH_COLUMN);
        if (!in_array('020-timesheet-reopenings.sql', $have, true)) {
            $this->problem('error', '-', '-', 'the target is not at migration 020 (run bin/migrate.php first)');
        }
        foreach ($have as $n) {
            if (strcmp($n, '020-timesheet-reopenings.sql') > 0) {
                $this->problem('warning', '-', '-', "the target has a migration newer than 020 ($n): check the map still fits");
            }
        }
    }

    /** Every source table is mapped or skipped on purpose; every source column of a mapped table is used or dropped on purpose. */
    private function checkCoverage(): void
    {
        $tables = $this->src->query("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE'")->fetchAll(\PDO::FETCH_COLUMN);
        $bySource = [];
        foreach (Map::tables() as $d) {
            $bySource[$d['source']][] = $d;
        }
        foreach ($tables as $t) {
            if (!isset($bySource[$t]) && !isset(Map::SKIPPED[$t])) {
                $this->problem('error', $t, '-', 'source table is neither mapped nor skipped (a migration the repo does not know?)');
            }
        }
        $q = $this->src->prepare("SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = ?");
        foreach ($bySource as $t => $defs) {
            $q->execute([$t]);
            $text = implode(' ', array_map(static fn (array $d): string => $d['sql'], $defs));
            $dropped = array_merge(...array_map(static fn (array $d): array => array_keys($d['dropped']), $defs));
            foreach ($q->fetchAll(\PDO::FETCH_COLUMN) as $c) {
                if (!in_array($c, $dropped, true) && preg_match('/(?<![A-Za-z0-9_])' . preg_quote($c, '/') . '(?![A-Za-z0-9_])/', $text) !== 1) {
                    $this->problem('warning', $t, '-', "source column $c is not carried and not listed as dropped");
                }
            }
        }
        foreach (array_keys(Map::SKIPPED) as $t) {
            if (in_array($t, $tables, true) && !isset($bySource[$t])) {
                $n = (int) $this->src->query('SELECT count(*) FROM public.' . $t)->fetchColumn();
                $this->counts['(skipped) ' . $t] = ['source' => $n, 'planned' => 0, 'skipped' => $n];
            }
        }
    }

    /** One account per email, case-insensitive, and no address already owned by another row in the target. */
    private function checkUsers(): void
    {
        $seen = [];
        foreach ($this->rows['users'] ?? [] as $id => $u) {
            $e = (string) $u['email'];
            if (isset($seen[$e])) {
                $this->problem('error', 'users', $id, 'same email (case-insensitive) as user ' . $seen[$e] . ': ' . Convert::maskEmail($e) . ' (merge or rename one on Supabase first)');
            }
            $seen[$e] = $id;
        }
        $q = $this->dst->query('SELECT id, email FROM users');
        foreach ($q->fetchAll() as $row) {
            $e = strtolower((string) $row['email']);
            if (isset($seen[$e]) && $seen[$e] !== $row['id']) {
                $this->problem('error', 'users', $seen[$e], 'the target already has this email under another id (' . Convert::maskEmail($e) . '): was grant-platform-owner run before the move?');
            }
        }
    }

    /** Unique keys of the target, compared case- and trailing-space-insensitively like utf8mb4_unicode_ci. @param array<string,mixed> $d */
    private function checkUniques(array $d): void
    {
        $t = $d['table'];
        if (($d['mode'] ?? 'insert') === 'reference') {
            return;
        }
        foreach ($this->uniques[$t] ?? [] as $u) {
            $first = reset($this->rows[$t]);
            if ($first === false) {
                continue;
            }
            foreach ($u['cols'] as $c) {
                if (!array_key_exists($c, $first)) {
                    continue 2; // a generated column: the source enforced the same rule
                }
            }
            $seen = [];
            foreach ($this->rows[$t] as $key => $row) {
                $parts = [];
                foreach ($u['cols'] as $c) {
                    if ($row[$c] === null) {
                        continue 2;
                    }
                    $parts[] = in_array($this->cols[$t][$c]['type'], ['char', 'varchar', 'text', 'tinytext', 'mediumtext', 'longtext'], true)
                        ? mb_strtolower(rtrim($row[$c], ' ')) : $row[$c];
                }
                $k = implode("\x1f", $parts);
                if (isset($seen[$k])) {
                    $this->problem('error', $t, (string) $key, "breaks target unique key {$u['name']} together with " . $seen[$k] . ' (the target compares text case-insensitively)');
                }
                $seen[$k] = (string) $key;
            }
        }
    }

    /** Each reference resolves to a row being moved or already in the target, with the target's composite (org) keys. @param array<string,mixed> $d */
    private function checkForeignKeys(array $d): void
    {
        $t = $d['table'];
        if (($d['mode'] ?? 'insert') === 'reference' || ($this->rows[$t] ?? []) === []) {
            return;
        }
        foreach ($this->fks[$t] ?? [] as $fk) {
            $have = $this->parentKeys($fk['ref'], $fk['refcols']);
            $missing = 0;
            foreach ($this->rows[$t] as $key => $row) {
                $parts = [];
                foreach ($fk['cols'] as $c) {
                    if (!array_key_exists($c, $row) || $row[$c] === null) {
                        continue 2;
                    }
                    $parts[] = strtolower($row[$c]);
                }
                if (!isset($have[implode("\x1f", $parts)])) {
                    if ($missing++ < 20) {
                        $this->problem('error', $t, (string) $key, "{$fk['name']}: no {$fk['ref']} row for (" . implode(', ', $fk['cols']) . ')');
                    }
                }
            }
            if ($missing > 20) {
                $this->problem('error', $t, '-', "{$fk['name']}: " . ($missing - 20) . ' more rows without a parent');
            }
        }
    }

    /** @param list<string> $cols @return array<string,true> */
    private function parentKeys(string $table, array $cols): array
    {
        $ck = $table . ':' . implode(',', $cols);
        if (isset($this->parentCache[$ck])) {
            return $this->parentCache[$ck];
        }
        $set = [];
        foreach ($this->rows[$table] ?? [] as $row) {
            $parts = [];
            foreach ($cols as $c) {
                if (!isset($row[$c])) {
                    continue 2;
                }
                $parts[] = strtolower($row[$c]);
            }
            $set[implode("\x1f", $parts)] = true;
        }
        $sel = implode(', ', array_map(static fn (string $c): string => "`$c`", $cols));
        foreach ($this->dst->query("SELECT $sel FROM `$table`")->fetchAll(\PDO::FETCH_NUM) as $r) {
            $set[strtolower(implode("\x1f", array_map('strval', $r)))] = true;
        }
        return $this->parentCache[$ck] = $set;
    }

    // ------------------------------------------------------------------ apply ----

    /** @return bool true when every group was written */
    public function apply(bool $resume): bool
    {
        if (!$this->planned) {
            $this->plan();
        }
        if ($this->errors() > 0) {
            $this->problem('error', '-', '-', 'apply refused: the dry run found errors (nothing was written)');
            return false;
        }
        if (!$resume) {
            foreach (self::TENANT_TABLES as $t) {
                if ((int) $this->dst->query("SELECT COUNT(*) FROM `$t`")->fetchColumn() > 0) {
                    $this->problem('error', $t, '-', 'the target already holds data: refused. Re-run with --resume to continue a move into it');
                    return false;
                }
            }
        }
        foreach (Map::GROUPS as $g) {
            $defs = array_values(array_filter($this->defs(), static fn (array $d): bool => $d['group'] === $g));
            if ($defs === []) {
                continue;
            }
            $this->dst->beginTransaction();
            try {
                foreach ($defs as $d) {
                    match ($d['mode'] ?? 'insert') {
                        'reference' => $this->applyReference($d),
                        'audit' => $this->applyAudit($d),
                        default => $this->applyInsert($d),
                    };
                }
                $this->dst->commit();
            } catch (\Throwable $e) {
                $this->dst->rollBack();
                $this->problem('error', $defs[0]['table'], '-', "group $g rolled back: " . Convert::scrub($e->getMessage()));
                return false;
            }
        }
        return true;
    }

    /** @param array<string,mixed> $d */
    private function applyInsert(array $d): void
    {
        $t = $d['table'];
        $rows = $this->rows[$t];
        $this->counts[$t] += ['inserted' => 0, 'unchanged' => 0, 'conflict' => 0];
        if ($rows === []) {
            return;
        }
        $cols = array_keys(reset($rows));
        $existing = $this->targetRows($d, array_keys($rows));
        $pending = [];
        foreach ($rows as $key => $row) {
            if (isset($existing[$key])) {
                if ($this->sameRow($d, (string) $key, $row, $existing[$key])) {
                    $this->counts[$t]['unchanged']++;
                } else {
                    $this->counts[$t]['conflict']++;
                    $this->problem('warning', $t, (string) $key, 'already in the target with different values: left as it is');
                }
                continue;
            }
            $pending[] = $row;
            if (count($pending) === self::BATCH) {
                $this->insert($t, $cols, $pending);
                $pending = [];
            }
        }
        if ($pending !== []) {
            $this->insert($t, $cols, $pending);
        }
    }

    /** @param list<string> $cols @param list<array<string,?string>> $rows */
    private function insert(string $t, array $cols, array $rows): void
    {
        $one = '(' . implode(', ', array_fill(0, count($cols), '?')) . ')';
        $sql = "INSERT INTO `$t` (" . implode(', ', array_map(static fn (string $c): string => "`$c`", $cols)) . ') VALUES ' . implode(', ', array_fill(0, count($rows), $one));
        $vals = [];
        foreach ($rows as $r) {
            foreach ($cols as $c) {
                $vals[] = $r[$c];
            }
        }
        $this->dst->prepare($sql)->execute($vals);
        $this->counts[$t]['inserted'] += count($rows);
    }

    /** @param array<string,mixed> $d */
    private function applyReference(array $d): void
    {
        $t = $d['table'];
        $this->counts[$t] += ['updated' => 0, 'unchanged' => 0, 'not_in_target' => 0];
        $existing = $this->targetRows($d, array_keys($this->rows[$t]));
        foreach ($this->rows[$t] as $key => $row) {
            if (!isset($existing[$key])) {
                $this->counts[$t]['not_in_target']++;
                $this->note($t, 'source row with no target counterpart: not created');
                continue;
            }
            $set = [];
            $vals = [];
            foreach ($d['update'] as $c) {
                if (array_key_exists($c, $row) && $row[$c] !== $existing[$key][$c]) {
                    $set[] = "`$c` = ?";
                    $vals[] = $row[$c];
                }
            }
            foreach ($d['compare'] ?? [] as $c) {
                if (array_key_exists($c, $row) && $row[$c] !== $existing[$key][$c]) {
                    $this->note($t, "differs from the target and kept as the target has it: $c");
                }
            }
            if ($set === []) {
                $this->counts[$t]['unchanged']++;
                continue;
            }
            $where = implode(' AND ', array_map(static fn (string $c): string => "`$c` = ?", $d['key']));
            $this->dst->prepare("UPDATE `$t` SET " . implode(', ', $set) . " WHERE $where")->execute([...$vals, ...$this->keyVals($d, (string) $key)]);
            $this->counts[$t]['updated']++;
        }
    }

    /** @param array<string,mixed> $d */
    private function applyAudit(array $d): void
    {
        $t = $d['table'];
        $this->counts[$t] += ['inserted' => 0, 'unchanged' => 0, 'conflict' => 0];
        $existing = $this->targetRows($d, array_keys($this->rows[$t]));
        $pending = [];
        $cols = null;
        foreach ($this->rows[$t] as $key => $row) {
            if (isset($existing[$key])) {
                $this->counts[$t][$this->sameRow($d, (string) $key, $row, $existing[$key]) ? 'unchanged' : 'conflict']++;
                continue;
            }
            unset($row['_source_id']);
            $cols ??= array_keys($row);
            $pending[] = $row;
            if (count($pending) === self::BATCH) {
                $this->insert($t, $cols, $pending);
                $pending = [];
            }
        }
        if ($pending !== [] && $cols !== null) {
            $this->insert($t, $cols, $pending);
        }
    }

    // ------------------------------------------------------------------ verify ----

    /** Counts, a checksum per table over every moved row, and a field-by-field sample. @return bool true when everything matches */
    public function verify(): bool
    {
        if (!$this->planned) {
            $this->plan();
        }
        $ok = $this->errors() === 0;
        $sample = max(1, (int) ($this->opts['sample'] ?? 25));
        foreach ($this->defs() as $d) {
            $t = $d['table'];
            $src = $this->rows[$t] ?? [];
            $dst = $this->targetRows($d, null);
            if (($d['mode'] ?? 'insert') === 'reference') {
                $src = array_intersect_key($src, $dst); // a reference row the target does not have is reported, never created
            }
            $cmp = $this->compareCols($d, $src);
            $missing = array_diff_key($src, $dst);
            $extra = ($d['mode'] ?? 'insert') === 'reference' ? [] : array_diff_key($dst, $src);
            $hs = $this->checksum($d, $src, $cmp, false);
            $ht = $this->checksum($d, array_intersect_key($dst, $src), $cmp, true);
            $keys = array_keys($src);
            mt_srand(crc32($t));
            shuffle($keys);
            $fields = 0;
            $diffs = [];
            foreach (array_slice($keys, 0, $sample) as $k) {
                if (!isset($dst[$k])) {
                    continue;
                }
                foreach ($cmp as $c) {
                    $fields++;
                    if (!$this->sameValue($d, (string) $k, $c, $src[$k][$c] ?? null, $dst[$k][$c] ?? null)) {
                        $diffs[] = "$k.$c";
                    }
                }
            }
            $this->counts[$t]['target'] = count(array_intersect_key($dst, $src));
            $this->counts[$t]['missing'] = count($missing);
            $this->counts[$t]['extra_in_target'] = count($extra);
            $this->counts[$t]['checksum'] = $hs === $ht ? 'match' : 'DIFFERS';
            $this->counts[$t]['sampled_fields'] = $fields;
            $this->counts[$t]['sample_diffs'] = count($diffs);
            $this->counts[$t]['source_sha256'] = substr($hs, 0, 16);
            $this->counts[$t]['target_sha256'] = substr($ht, 0, 16);
            if ($missing !== [] || $hs !== $ht || $diffs !== []) {
                $ok = false;
                $this->problem('error', $t, '-', sprintf('verify: %d missing, checksum %s, %d sampled fields differ%s', count($missing), $hs === $ht ? 'match' : 'differs', count($diffs), $diffs ? ' (' . implode(', ', array_slice($diffs, 0, 5)) . ')' : ''));
            }
            if ($extra !== []) {
                $this->note($t, 'rows in the target that did not come from the source: ' . count($extra));
            }
        }
        return $ok;
    }

    /** @param array<string,mixed> $d @param array<string,array<string,?string>> $rows @param list<string> $cmp */
    private function checksum(array $d, array $rows, array $cmp, bool $target): string
    {
        ksort($rows, SORT_STRING);
        $h = hash_init('sha256');
        foreach ($rows as $k => $r) {
            $line = [(string) $k];
            foreach ($cmp as $c) {
                $line[] = $this->comparable($d, (string) $k, $c, $r[$c] ?? null, $target) ?? "\0NULL";
            }
            hash_update($h, implode("\x1f", $line) . "\x1e");
        }
        return hash_final($h);
    }

    /** @param array<string,mixed> $d @param array<string,array<string,?string>> $src @return list<string> */
    private function compareCols(array $d, array $src): array
    {
        if (($d['mode'] ?? 'insert') === 'reference') {
            $first = reset($src) ?: [];
            return array_values(array_filter($d['update'], static fn (string $c): bool => array_key_exists($c, $first)));
        }
        $first = reset($src);
        return $first === false ? [] : array_values(array_filter(array_keys($first), static fn (string $c): bool => $c[0] !== '_'));
    }

    /** A secret column is compared by its plaintext (the ciphertext differs on every write). */
    private function comparable(array $d, string $key, string $c, ?string $v, bool $target): ?string
    {
        if (!isset($d['secret'][$c])) {
            return $v;
        }
        if (!$target) {
            return hash('sha256', $this->secrets[$d['table']][$key] ?? '');
        }
        try {
            return hash('sha256', Secret::decrypt((string) $v, (string) ($this->config['secret_key'] ?? '')));
        } catch (\Throwable) {
            return 'undecryptable';
        }
    }

    private function sameValue(array $d, string $key, string $c, ?string $src, ?string $dst): bool
    {
        return $this->comparable($d, $key, $c, $src, false) === $this->comparable($d, $key, $c, $dst, true);
    }

    /** @param array<string,mixed> $d @param array<string,?string> $src @param array<string,?string> $dst */
    private function sameRow(array $d, string $key, array $src, array $dst): bool
    {
        foreach ($src as $c => $v) {
            if ($c[0] !== '_' && !$this->sameValue($d, $key, $c, $v, $dst[$c] ?? null)) {
                return false;
            }
        }
        return true;
    }

    // ------------------------------------------------------------------ target reads ----

    /**
     * Target rows by key, canonicalised exactly like the source values. $keys = null reads the whole table.
     * @param array<string,mixed> $d @param list<string>|null $keys @return array<string,array<string,?string>>
     */
    private function targetRows(array $d, ?array $keys): array
    {
        $t = $d['table'];
        $meta = $this->cols[$t] ?? [];
        $planned = $this->rows[$t] ?? [];
        $first = reset($planned);
        $cols = $first !== false ? array_values(array_filter(array_keys($first), static fn (string $c): bool => $c[0] !== '_' && isset($meta[$c]))) : [];
        $isAudit = ($d['mode'] ?? 'insert') === 'audit';
        $sel = array_map(static fn (string $c): string => "`$c`", array_unique([...($isAudit ? [] : $d['key']), ...$cols]));
        if ($isAudit) {
            $sel[] = "JSON_VALUE(metadata, '$._moved.source_id') AS _source_id";
        }
        if ($sel === []) {
            return [];
        }
        $base = 'SELECT ' . implode(', ', $sel) . " FROM `$t`";
        $out = [];
        $add = function (array $r) use (&$out, $d, $meta): void {
            $row = [];
            foreach ($r as $c => $v) {
                if ($c === '_source_id') {
                    continue;
                }
                $row[$c] = isset($meta[$c]) ? Convert::value($v, ['nullable' => true] + $meta[$c])[0] : ($v === null ? null : (string) $v);
            }
            $key = ($d['mode'] ?? 'insert') === 'audit' ? (string) $r['_source_id'] : $this->keyOf($d, $row);
            $out[$key] = $row;
        };
        if ($keys === null) {
            $q = $this->dst->query($base . ($isAudit ? " WHERE JSON_VALUE(metadata, '$._moved.source_id') IS NOT NULL" : ''));
            while (($r = $q->fetch(\PDO::FETCH_ASSOC)) !== false) {
                $add($r);
            }
            return $out;
        }
        foreach (array_chunk($keys, 500) as $chunk) {
            if ($isAudit) {
                $where = "JSON_VALUE(metadata, '$._moved.source_id') IN (" . implode(', ', array_fill(0, count($chunk), '?')) . ')';
                $vals = $chunk;
            } elseif (count($d['key']) === 1) {
                $where = "`{$d['key'][0]}` IN (" . implode(', ', array_fill(0, count($chunk), '?')) . ')';
                $vals = array_map(fn (string $k): string => $this->keyVals($d, $k)[0], $chunk);
            } else {
                $tuple = '(' . implode(', ', array_fill(0, count($d['key']), '?')) . ')';
                $where = '(' . implode(', ', array_map(static fn (string $c): string => "`$c`", $d['key'])) . ') IN (' . implode(', ', array_fill(0, count($chunk), $tuple)) . ')';
                $vals = array_merge(...array_map(fn (string $k): array => $this->keyVals($d, $k), $chunk));
            }
            $q = $this->dst->prepare("$base WHERE $where");
            $q->execute($vals);
            foreach ($q->fetchAll(\PDO::FETCH_ASSOC) as $r) {
                $add($r);
            }
        }
        return $out;
    }

    private function loadTargetSchema(): void
    {
        $q = $this->dst->query("SELECT TABLE_NAME, COLUMN_NAME, DATA_TYPE, CHARACTER_MAXIMUM_LENGTH, CHARACTER_OCTET_LENGTH, NUMERIC_PRECISION, NUMERIC_SCALE,
            DATETIME_PRECISION, COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT, EXTRA, IS_GENERATED FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE()");
        foreach ($q->fetchAll() as $c) {
            $type = strtolower((string) $c['DATA_TYPE']);
            $text = in_array($type, ['text', 'tinytext', 'mediumtext', 'longtext'], true);
            $enum = null;
            if ($type === 'enum' && preg_match_all("/'((?:[^']|'')*)'/", (string) $c['COLUMN_TYPE'], $m) > 0) {
                $enum = array_map(static fn (string $s): string => str_replace("''", "'", $s), $m[1]);
            }
            $this->cols[$c['TABLE_NAME']][$c['COLUMN_NAME']] = [
                'type' => $type, 'len' => $text ? null : ($c['CHARACTER_MAXIMUM_LENGTH'] !== null ? (int) $c['CHARACTER_MAXIMUM_LENGTH'] : null),
                'bytes' => $text ? (int) $c['CHARACTER_OCTET_LENGTH'] : null, 'precision' => $c['NUMERIC_PRECISION'] !== null ? (int) $c['NUMERIC_PRECISION'] : null,
                'scale' => $c['NUMERIC_SCALE'] !== null ? (int) $c['NUMERIC_SCALE'] : null, 'dtp' => $c['DATETIME_PRECISION'] !== null ? (int) $c['DATETIME_PRECISION'] : null,
                'unsigned' => str_contains((string) $c['COLUMN_TYPE'], 'unsigned'), 'enum' => $enum, 'nullable' => $c['IS_NULLABLE'] === 'YES',
                'has_default' => $c['COLUMN_DEFAULT'] !== null, 'generated' => ($c['IS_GENERATED'] ?? 'NEVER') === 'ALWAYS' || str_contains((string) $c['EXTRA'], 'GENERATED'),
                'auto' => str_contains((string) $c['EXTRA'], 'auto_increment'),
            ];
        }
        $q = $this->dst->query("SELECT TABLE_NAME, INDEX_NAME, GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX) AS cols FROM information_schema.STATISTICS
            WHERE TABLE_SCHEMA = DATABASE() AND NON_UNIQUE = 0 GROUP BY TABLE_NAME, INDEX_NAME");
        foreach ($q->fetchAll() as $u) {
            $this->uniques[$u['TABLE_NAME']][] = ['name' => $u['INDEX_NAME'], 'cols' => explode(',', $u['cols'])];
        }
        $q = $this->dst->query("SELECT TABLE_NAME, CONSTRAINT_NAME, REFERENCED_TABLE_NAME, GROUP_CONCAT(COLUMN_NAME ORDER BY ORDINAL_POSITION) AS cols,
            GROUP_CONCAT(REFERENCED_COLUMN_NAME ORDER BY ORDINAL_POSITION) AS refcols FROM information_schema.KEY_COLUMN_USAGE
            WHERE TABLE_SCHEMA = DATABASE() AND REFERENCED_TABLE_NAME IS NOT NULL GROUP BY TABLE_NAME, CONSTRAINT_NAME, REFERENCED_TABLE_NAME");
        foreach ($q->fetchAll() as $f) {
            $this->fks[$f['TABLE_NAME']][] = ['name' => $f['CONSTRAINT_NAME'], 'cols' => explode(',', $f['cols']), 'ref' => $f['REFERENCED_TABLE_NAME'], 'refcols' => explode(',', $f['refcols'])];
        }
    }

    // ------------------------------------------------------------------ helpers ----

    /** @return list<array<string,mixed>> */
    private function defs(): array
    {
        $only = $this->opts['only'] ?? [];
        $skip = $this->opts['skip'] ?? [];
        // A table a later migration added and this source lacks has nothing to move (reported once by SourceSchema).
        return array_values(array_filter(Map::tables(), fn (array $d): bool => ($only === [] || in_array($d['table'], $only, true)) && !in_array($d['table'], $skip, true) && $this->schema->has($d['source'])));
    }

    private function expand(string $sql): string
    {
        $sql = $this->schema->expand($sql);
        $sql = (string) preg_replace_callback('/\{ts:([^{}]+)\}/', static fn (array $m): string => "to_char(({$m[1]}) AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS.US')", $sql);
        return (string) preg_replace_callback('/\{org:([^{}]+)\}/', static fn (array $m): string => "(({$m[1]}) IS NULL OR NOT (({$m[1]}) = ANY (current_setting('rotaflow.excluded_orgs')::uuid[])))", $sql);
    }

    /** @param array<string,mixed> $d @param array<string,mixed> $row */
    private function keyOf(array $d, array $row): string
    {
        return implode('|', array_map(static fn (string $c): string => strtolower((string) ($row[$c] ?? '')), $d['key']));
    }

    /** @param array<string,mixed> $d @return list<string> */
    private function keyVals(array $d, string $key): array
    {
        return explode('|', $key);
    }

    private function problem(string $level, string $table, string $key, string $what): void
    {
        $this->problems[] = ['level' => $level, 'table' => $table, 'key' => $key, 'what' => $what];
    }

    private function note(string $table, string $what): void
    {
        $this->notes[$table][$what] = ($this->notes[$table][$what] ?? 0) + 1;
    }

    public function errors(): int
    {
        return count(array_filter($this->problems, static fn (array $p): bool => $p['level'] === 'error'));
    }

    /** @return array{counts:array<string,array<string,mixed>>,problems:list<array<string,string>>,notes:array<string,array<string,int>>,excluded_orgs:list<string>} */
    public function result(): array
    {
        return ['counts' => $this->counts, 'problems' => $this->problems, 'notes' => $this->notes, 'excluded_orgs' => $this->excluded,
            'source_schema' => ['label' => $this->schema->label()] + $this->schema->summary()];
    }

    public function schema(): SourceSchema
    {
        return $this->schema;
    }

    /** The source paths the files step must not copy: objects queued for deletion, and those of excluded organisations. @return array<string,true> */
    public function blockedObjects(): array
    {
        $out = [];
        $queued = $this->schema->has('storage_deletions') // the queue exists from 0159
            ? $this->src->query("SELECT bucket, path, is_folder FROM public.storage_deletions WHERE status <> 'done'")->fetchAll() : [];
        foreach ($queued as $r) {
            $out[$r['bucket'] . '/' . $r['path'] . ($r['is_folder'] ? '/' : '')] = true;
        }
        foreach ($this->excluded as $o) {
            $out['staff-documents/' . $o . '/'] = true;
            $out['staff-photos/' . $o . '/'] = true;
        }
        return $out;
    }

    public function source(): \PDO
    {
        return $this->src;
    }
}
