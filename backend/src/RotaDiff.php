<?php
declare(strict_types=1);

namespace RotaFlow;

/**
 * What changed for each person between an amendment and the rota it replaces. Compares by VALUE (who, which local day, which hours at which
 * site), because an amendment is a copy with new ids: it reports a shift present in one version and not the other, and never claims to know
 * that a shift "moved". A first publish has nothing to compare against and yields nothing.
 */
final class RotaDiff
{
    /**
     * @param list<array{staff:string,user:?string,day:string,label:string}> $before the superseded rota's non-cancelled assigned shifts
     * @param list<array{staff:string,user:?string,day:string,label:string}> $after the amendment's
     * @return array<string,array{title:string,body:string,n:int}> notification text per user id (people with no login are omitted)
     */
    public static function messages(array $before, array $after, string $period): array
    {
        $gone = self::minus($before, $after);
        $fresh = self::minus($after, $before);
        $slots = [];
        foreach ($gone as $s) {
            $slots[$s['staff'] . '|' . $s['day']]['g'][] = $s;
        }
        foreach ($fresh as $s) {
            $slots[$s['staff'] . '|' . $s['day']]['f'][] = $s;
        }
        $rows = [];
        foreach ($slots as $slot) {
            $g = $slot['g'] ?? [null];
            $f = $slot['f'] ?? [null];
            foreach ($g as $x) {
                foreach ($f as $y) {
                    $any = $x ?? $y;
                    $rows[] = ['user' => $any['user'], 'day' => $any['day'], 'removed' => $x['label'] ?? null, 'added' => $y['label'] ?? null];
                }
            }
        }
        usort($rows, static fn (array $a, array $b): int => $a['day'] <=> $b['day']);
        $byUser = [];
        foreach ($rows as $r) {
            if ($r['user'] === null) {
                continue;
            }
            $what = $r['removed'] !== null && $r['added'] !== null ? "was {$r['removed']}, now {$r['added']}" : ($r['added'] !== null ? "added {$r['added']}" : "removed {$r['removed']}");
            $byUser[$r['user']][] = date('D d M', (int) strtotime($r['day'])) . ': ' . $what;
        }
        $out = [];
        foreach ($byUser as $user => $lines) {
            $n = count($lines);
            $out[$user] = ['title' => $period . ' — ' . $n . ($n === 1 ? ' change to your shifts' : ' changes to your shifts'), 'body' => implode("\n", $lines), 'n' => $n];
        }
        return $out;
    }

    /** Multiset difference: each element of $a, minus one match in $b per occurrence (EXCEPT ALL). */
    private static function minus(array $a, array $b): array
    {
        $count = [];
        foreach ($b as $s) {
            $k = $s['staff'] . '|' . $s['day'] . '|' . $s['label'];
            $count[$k] = ($count[$k] ?? 0) + 1;
        }
        $out = [];
        foreach ($a as $s) {
            $k = $s['staff'] . '|' . $s['day'] . '|' . $s['label'];
            if (($count[$k] ?? 0) > 0) {
                $count[$k]--;
                continue;
            }
            $out[] = $s;
        }
        return $out;
    }

    /** "05 Nov – 11 Nov 2030" */
    public static function period(string $start, string $end): string
    {
        return date('d M', (int) strtotime($start)) . ' – ' . date('d M Y', (int) strtotime($end));
    }

    /** "5 November 2030", "5-9 November 2030", "28 October-3 November 2030", and across years both in full. */
    public static function range(string $start, string $end): string
    {
        $s = new \DateTimeImmutable($start);
        $e = new \DateTimeImmutable($end);
        return match (true) {
            $start === $end => $s->format('j F Y'),
            $s->format('Y-m') === $e->format('Y-m') => $s->format('j') . '-' . $e->format('j F Y'),
            $s->format('Y') === $e->format('Y') => $s->format('j F') . '-' . $e->format('j F Y'),
            default => $s->format('j F Y') . '-' . $e->format('j F Y'),
        };
    }
}
