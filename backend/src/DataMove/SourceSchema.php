<?php
declare(strict_types=1);

namespace RotaFlow\DataMove;

/**
 * What the Supabase source actually has. Production stopped at migration 0156 (1 Nov 2026) while the repo goes to 0164,
 * so the move reads the source's own migration record (supabase_migrations.schema_migrations) for the report and probes
 * information_schema for what the SQL may name: the probe decides, the record only explains. A table or column that a
 * later migration added and the source lacks is read as absent (no rows, or the default the app showed before it existed)
 * and reported once as a warning, never an error. docs/AUDIT.md (A-DM-1 to A-DM-6) records each choice.
 */
final class SourceSchema
{
    /** The newest file in supabase/migrations, and the oldest source the move is rehearsed against (production). */
    public const REPO_LATEST = '0164';
    public const OLDEST_SUPPORTED = '0156';

    /**
     * Added after 0156: probe key => [migration, what it is, what the move does without it]. A key is a table or table.column.
     * Every column a Map entry reads through {src:...} must be listed here (suite 275 checks).
     */
    public const FEATURES = [
        'storage_deletions' => ['0159', 'the storage deletion queue (storage_deletions, added by 0159)', 'no file is held back as queued for deletion'],
        'documents.storage_path' => ['0159', 'privately stored documents (documents.storage_path, added by 0159)', 'every document is a pasted link (file_url) and moves as one; there is no document file to copy'],
        'staff_profiles.photo_path' => ['0162', 'privately stored staff photos (staff_profiles.photo_path, added by 0162)', 'photos stay pasted links (photo_url); there is no photo file to copy'],
        'account_deletions' => ['0162', 'the erasure queue (account_deletions, added by 0162)', 'a completed erasure case still makes its person unlinkable, as 0162 would have'],
        'app_settings.time_format' => ['0163', 'personal time and week preferences (app_settings.time_format, week_start, digest_frequency, added by 0163)', 'everyone gets what the app showed before 0163: 24h, monday, immediate'],
        'app_settings.week_start' => ['0163', null, null],
        'app_settings.digest_frequency' => ['0163', null, null],
    ];

    /** Removed by a later migration: probe key => [migration, what it is]. Present at an older source, and never moved. */
    public const PURGED = [
        'emergency_contacts.medical_notes' => ['0164', 'medical notes on emergency contacts (emergency_contacts.medical_notes, purged by 0164)'],
    ];

    /** @param array<string,true> $have tables and table.columns of the public schema */
    private function __construct(private readonly array $have, private readonly ?string $recorded, private readonly int $recordedCount)
    {
    }

    public static function detect(\PDO $src): self
    {
        $have = [];
        foreach ($src->query("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE'")->fetchAll(\PDO::FETCH_COLUMN) as $t) {
            $have[$t] = true;
        }
        foreach ($src->query("SELECT table_name || '.' || column_name FROM information_schema.columns WHERE table_schema = 'public'")->fetchAll(\PDO::FETCH_COLUMN) as $c) {
            $have[$c] = true;
        }
        $recorded = null;
        $n = 0;
        if ($src->query("SELECT to_regclass('supabase_migrations.schema_migrations') IS NOT NULL")->fetchColumn()) {
            // The repo numbers its files 0001_...; the Supabase CLI records that prefix as the version.
            $row = $src->query("SELECT max(version), count(*) FROM supabase_migrations.schema_migrations WHERE version ~ '^[0-9]{4}$'")->fetch(\PDO::FETCH_NUM);
            $recorded = $row[0] !== null ? (string) $row[0] : null;
            $n = (int) $row[1];
        }
        return new self($have, $recorded, $n);
    }

    /** For tests: a schema with exactly these tables and table.columns. @param list<string> $have */
    public static function fixed(array $have, ?string $recorded = null): self
    {
        return new self(array_fill_keys($have, true), $recorded, 0);
    }

    public function has(string $key): bool
    {
        return isset($this->have[$key]);
    }

    /** The version the source's own record names, or null when it keeps none. */
    public function recorded(): ?string
    {
        return $this->recorded;
    }

    /** The newest migration whose effect the schema shows (the probe's view of the version). */
    public function inferred(): string
    {
        if (!$this->has('emergency_contacts.medical_notes')) {
            return '0164';
        }
        $v = self::OLDEST_SUPPORTED;
        foreach (self::FEATURES as $k => [$since]) {
            if ($this->has($k) && strcmp($since, $v) > 0) {
                $v = $since;
            }
        }
        return $v;
    }

    /** "source at 0156", or "source at 0164 (read from the schema; no migration record)". */
    public function label(): string
    {
        return 'source at ' . ($this->recorded ?? $this->inferred() . ' (read from the schema; no migration record)');
    }

    /** @return array{recorded:?string,recorded_migrations:int,inferred:string,absent:list<string>,purged_present:list<string>} */
    public function summary(): array
    {
        return [
            'recorded' => $this->recorded, 'recorded_migrations' => $this->recordedCount, 'inferred' => $this->inferred(),
            'absent' => array_values(array_filter(array_keys(self::FEATURES), fn (string $k): bool => !$this->has($k))),
            'purged_present' => array_values(array_filter(array_keys(self::PURGED), fn (string $k): bool => $this->has($k))),
        ];
    }

    /**
     * The plan report's lines about the source version: one per absent feature, one per purged column still there, and any
     * disagreement between the record and the schema. $count reads a count from the source (never a value).
     * @param \Closure(string):int $count
     * @return list<array{level:string,table:string,what:string}>
     */
    public function problems(\Closure $count): array
    {
        $out = [];
        $at = $this->label();
        $r = $this->recorded;
        if ($r !== null && strcmp($r, self::OLDEST_SUPPORTED) < 0) {
            $out[] = ['level' => 'error', 'table' => '-', 'what' => "$at: older than " . self::OLDEST_SUPPORTED . ', the oldest source this move is rehearsed against; apply the missing migrations on Supabase first'];
        }
        if ($r !== null && strcmp($r, self::REPO_LATEST) > 0) {
            $out[] = ['level' => 'warning', 'table' => '-', 'what' => "$at: newer than the repo's supabase/migrations (" . self::REPO_LATEST . '); the coverage check names anything the map does not know'];
        }
        foreach (self::FEATURES as $k => [$since, $what, $then]) {
            $table = explode('.', $k)[0];
            if (!$this->has($k)) {
                if ($what !== null) {
                    $out[] = ['level' => 'warning', 'table' => $table, 'what' => "$at: $what not present, nothing to move; $then"];
                }
                if ($r !== null && strcmp($r, $since) >= 0) {
                    $out[] = ['level' => 'warning', 'table' => $table, 'what' => "$at: the migration record includes $since but $k is missing; the move follows the schema"];
                }
            } elseif ($r !== null && strcmp($r, $since) < 0) {
                $out[] = ['level' => 'warning', 'table' => $table, 'what' => "$at: $k exists although the migration record stops before $since; the move follows the schema"];
            }
        }
        foreach (self::PURGED as $k => [$since, $what]) {
            [$table, $col] = explode('.', $k);
            if ($this->has($k)) {
                $n = $count("SELECT count(*) FROM public.$table WHERE btrim(coalesce($col::text, '')) <> ''");
                $out[] = ['level' => 'warning', 'table' => $table, 'what' => "$at: $what still present, never moved: $n "
                    . ($n === 1 ? 'row holds' : 'rows hold') . ' a note' . ($n > 0 ? '; the move leaves them behind on Supabase (decision D5): export them first only if the owner decides to (O11)' : '')];
            }
        }
        return $out;
    }

    /** Expands {src:KEY;EXPR;DEFAULT}: EXPR when the source has KEY, else DEFAULT. Neither part may contain ; { or }. */
    public function expand(string $sql): string
    {
        return (string) preg_replace_callback('/\{src:([\w.]+);([^;{}]*);([^;{}]*)\}/', fn (array $m): string => $this->has($m[1]) ? $m[2] : $m[3], $sql);
    }
}
