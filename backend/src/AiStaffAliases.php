<?php
declare(strict_types=1);

namespace RotaFlow;

/**
 * Short staff aliases for the AI payload (the PHP form of supabase/functions/ai-rota-assistant/staffAliases.ts).
 *
 * Every request to the model used to carry each active staff member's full name, joined by id to their shifts, approved leave and
 * declared unavailability. None of the rules the model follows needs a name: they are about ids, dates and hours. So the model sees
 * S1, S2 and so on, and the names are put back on this side of the wire before anything reaches the manager. Staff ids are aliased too,
 * not only names: the context arrays are joined by id, and an alias that replaced the name while the id stayed would leave two
 * identifiers for one person and nothing gained.
 *
 * Aliases are assigned in staff-id order, not query order, so the same roster gives the same aliases on every request.
 *
 * The manager's own prompt is free text. Full names, and first names only one person has, are swapped for aliases before sending,
 * because otherwise "put Ada on nights" would stop working. A nickname, a misspelling or a shared first name goes through as typed:
 * that is the manager's own text, and guessing who "Jo" is would be worse than sending it.
 *
 * Pure: no database, no config, no network. Needs only PCRE (no mbstring).
 */
final class AiStaffAliases
{
    /** @var array<string,string> staff id => alias */
    private array $aliasById = [];
    /** @var array<string,array{id:string,first_name:string,last_name:string}> alias => staff */
    private array $byAlias = [];
    /** @var list<array{name:string,alias:string}> */
    private array $fullNames = [];
    /** @var list<array{name:string,alias:string}> */
    private array $uniqueFirstNames = [];

    /** @param list<array{id:string,first_name:string,last_name:string}> $staff */
    public function __construct(array $staff)
    {
        $ordered = array_values($staff);
        usort($ordered, static fn (array $a, array $b): int => strcmp($a['id'], $b['id']));
        foreach ($ordered as $i => $member) {
            $alias = 'S' . ($i + 1);
            $this->aliasById[$member['id']] = $alias;
            $this->byAlias[$alias] = $member;
        }

        // First names held by exactly one person. A shared one is ambiguous, so it is left as the manager typed it.
        $counts = [];
        foreach ($ordered as $member) {
            $first = self::trim($member['first_name']);
            if ($first !== '') {
                $counts[$first] = ($counts[$first] ?? 0) + 1;
            }
        }

        // Longest names first, so "Ann Lee" is replaced before "Ann" could split it. (usort is stable, as the original sort was.)
        $full = [];
        $first = [];
        foreach ($ordered as $member) {
            $alias = $this->aliasById[$member['id']];
            $name = self::fullName($member);
            if (str_contains($name, ' ')) {
                $full[] = ['name' => $name, 'alias' => $alias];
            }
            $f = self::trim($member['first_name']);
            if ($f !== '' && ($counts[$f] ?? 0) === 1) {
                $first[] = ['name' => $f, 'alias' => $alias];
            }
        }
        $longest = static fn (array $a, array $b): int => Str::len($b['name']) <=> Str::len($a['name']);
        usort($full, $longest);
        usort($first, $longest);
        $this->fullNames = $full;
        $this->uniqueFirstNames = $first;
    }

    /** Staff profile id to alias, for building the context. */
    public function aliasFor(string $staffProfileId): ?string
    {
        return $this->aliasById[$staffProfileId] ?? null;
    }

    /** Alias back to the real staff profile id, for reading the reply. A real id the model could not have seen is not accepted. */
    public function idFor(string $alias): ?string
    {
        return ($this->byAlias[self::trim($alias)] ?? null)['id'] ?? null;
    }

    /** Replace names in the manager's prompt with aliases. */
    public function maskPrompt(string $text): string
    {
        $masked = $text;
        foreach ($this->fullNames as $e) {
            $masked = self::replaceWord($masked, $e['name'], $e['alias']);
        }
        foreach ($this->uniqueFirstNames as $e) {
            $masked = self::replaceWord($masked, $e['name'], $e['alias']);
        }
        return $masked;
    }

    /** Replace aliases in model prose with the person's full name. An alias that is not ours, and look-alike words, are left alone. */
    public function restoreNames(string $text): string
    {
        $out = preg_replace_callback('/\bS(\d{1,4})\b/', fn (array $m): string => isset($this->byAlias[$m[0]]) ? self::fullName($this->byAlias[$m[0]]) : $m[0], $text);
        return $out ?? $text;
    }

    /** @param array{first_name:string,last_name:string} $s */
    public static function fullName(array $s): string
    {
        return self::trim($s['first_name'] . ' ' . $s['last_name']);
    }

    /** JavaScript's trim(): Unicode whitespace and the byte-order mark, not just ASCII. */
    public static function trim(string $s): string
    {
        return preg_replace('/^[\s\x{FEFF}]+|[\s\x{FEFF}]+$/u', '', $s) ?? $s;
    }

    /**
     * Whole-word, case-sensitive replacement. Case-sensitive on purpose: a first name such as "Will" or "May" is also an ordinary
     * word, and the lower-case word is far more often the ordinary one.
     */
    private static function replaceWord(string $text, string $word, string $replacement): string
    {
        if ($word === '') {
            return $text;
        }
        $pattern = '/(?<![\p{L}\p{N}])' . preg_quote($word, '/') . '(?![\p{L}\p{N}])/u';
        return preg_replace_callback($pattern, static fn (array $m): string => $replacement, $text) ?? $text;
    }
}
