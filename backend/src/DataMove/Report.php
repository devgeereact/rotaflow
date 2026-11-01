<?php
declare(strict_types=1);

namespace RotaFlow\DataMove;

/** Writes the data-move report (Markdown for people, JSON for the record) into <private root>/datamove/, 0700/0600. */
final class Report
{
    /**
     * @param array<string,mixed> $data counts, problems, notes, files, meta
     * @return string the Markdown path
     */
    public static function write(string $privateRoot, string $command, array $data, ?string $path = null): string
    {
        $dir = rtrim($privateRoot, '/') . '/datamove';
        if (!is_dir($dir) && !mkdir($dir, 0700, true) && !is_dir($dir)) {
            throw new \RuntimeException('cannot create the report folder');
        }
        $path ??= $dir . '/report-' . gmdate('Ymd\THis\Z') . '-' . $command . '.md';
        file_put_contents($path, self::markdown($command, $data), LOCK_EX);
        chmod($path, 0600);
        $json = preg_replace('/\.md$/', '.json', $path) ?? ($path . '.json');
        file_put_contents($json, json_encode($data, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE), LOCK_EX);
        chmod($json, 0600);
        return $path;
    }

    /** @param array<string,mixed> $data */
    public static function markdown(string $command, array $data): string
    {
        $m = $data['meta'] ?? [];
        $out = ["# RotaFlow data move: $command", '', 'When (UTC): ' . ($m['utc'] ?? gmdate('c')), 'Source: ' . ($m['source'] ?? '?') . ' (read-only snapshot)',
            'Target: ' . ($m['target'] ?? '?'), 'Result: **' . ($m['result'] ?? '?') . '**'];
        if (!empty($data['source_schema'])) {
            $s = $data['source_schema'];
            $out[] = 'Source schema: ' . $s['label'] . ' (' . ($s['recorded'] !== null ? $s['recorded_migrations'] . ' migrations recorded; ' : '') . 'the schema reads as ' . $s['inferred']
                . ($s['absent'] !== [] ? '; not present: ' . implode(', ', $s['absent']) : '') . ($s['purged_present'] !== [] ? '; still present, never moved: ' . implode(', ', $s['purged_present']) : '') . ')';
        }
        if (!empty($data['excluded_orgs'])) {
            $out[] = 'Organisations left behind (--exclude-org / --exclude-demo-orgs): ' . implode(', ', $data['excluded_orgs']);
        }
        $counts = $data['counts'] ?? [];
        if ($counts !== []) {
            $keys = [];
            foreach ($counts as $c) {
                foreach (array_keys($c) as $k) {
                    $keys[$k] = true;
                }
            }
            $keys = array_keys($keys);
            $out[] = '';
            $out[] = '## Tables';
            $out[] = '';
            $out[] = '| table | ' . implode(' | ', $keys) . ' |';
            $out[] = '| ' . implode(' | ', array_fill(0, count($keys) + 1, '---')) . ' |';
            foreach ($counts as $t => $c) {
                $out[] = "| $t | " . implode(' | ', array_map(static fn (string $k): string => (string) ($c[$k] ?? ''), $keys)) . ' |';
            }
        }
        if (!empty($data['files'])) {
            $out[] = '';
            $out[] = '## Files';
            $out[] = '';
            foreach ($data['files'] as $k => $v) {
                $out[] = "- $k: $v";
            }
        }
        $problems = $data['problems'] ?? [];
        foreach (['error' => 'Errors (block apply)', 'warning' => 'Warnings', 'info' => 'Information'] as $lvl => $title) {
            $list = array_values(array_filter($problems, static fn (array $p): bool => $p['level'] === $lvl));
            if ($list === []) {
                continue;
            }
            $out[] = '';
            $out[] = "## $title (" . count($list) . ')';
            $out[] = '';
            foreach (array_slice($list, 0, 500) as $p) {
                $out[] = "- `{$p['table']}` `{$p['key']}`: {$p['what']}";
            }
            if (count($list) > 500) {
                $out[] = '- ... ' . (count($list) - 500) . ' more in the JSON report';
            }
        }
        if (!empty($data['notes'])) {
            $out[] = '';
            $out[] = '## Mappings applied (counts)';
            $out[] = '';
            foreach ($data['notes'] as $t => $list) {
                foreach ($list as $what => $n) {
                    $out[] = "- `$t`: $what: $n";
                }
            }
        }
        $out[] = '';
        return implode("\n", $out);
    }
}
