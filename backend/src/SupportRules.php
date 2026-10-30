<?php
declare(strict_types=1);

namespace RotaFlow;

/** The support desk's decisions as pure functions: reference numbers, SLA deadlines and the SLA state, each testable to the edge. Times are 'Y-m-d H:i:s' UTC. */
final class SupportRules
{
    private const DUE_SOON_MINUTES = 30;
    private const FALLBACK = ['first_response_minutes' => 1440, 'resolution_minutes' => 4320];

    /** CASE-4120, padded to at least four digits and never truncated (a fifth digit must not collide with an old reference). */
    public static function reference(int $n): string
    {
        return 'CASE-' . str_pad((string) $n, 4, '0', STR_PAD_LEFT);
    }

    /**
     * Deadlines hang off created_at, not off "now": escalating a late case cannot restart its clock, and a downgrade recomputes from the same anchor.
     * @param array{first_response_minutes:int,resolution_minutes:int}|null $target
     * @return array{first_response_due_at:string,resolution_due_at:string}
     */
    public static function deadlines(string $createdAt, ?array $target): array
    {
        $t = $target ?? self::FALLBACK;
        $at = strtotime($createdAt . ' UTC');
        return ['first_response_due_at' => gmdate('Y-m-d H:i:s', $at + $t['first_response_minutes'] * 60), 'resolution_due_at' => gmdate('Y-m-d H:i:s', $at + $t['resolution_minutes'] * 60)];
    }

    /**
     * @param array{first_response_at:?string,first_response_due_at:string,resolved_at:?string,resolution_due_at:string} $c
     * @return array{first_response_state:string,resolution_state:string,minutes_to_respond:int,minutes_to_resolve:int}
     */
    public static function slaState(array $c, int $now): array
    {
        $ts = static fn (?string $u): ?int => $u === null ? null : (int) strtotime($u . ' UTC');
        $frDue = (int) $ts($c['first_response_due_at']);
        $resDue = (int) $ts($c['resolution_due_at']);
        $fr = $ts($c['first_response_at']);
        $res = $ts($c['resolved_at']);
        $first = match (true) {
            $fr !== null && $fr <= $frDue => 'met',
            $fr !== null => 'breached',
            $now > $frDue => 'breached',
            $now > $frDue - self::DUE_SOON_MINUTES * 60 => 'due_soon',
            default => 'on_track',
        };
        $resolution = match (true) {
            $res !== null && $res <= $resDue => 'met',
            $res !== null => 'breached',
            $now > $resDue => 'breached',
            default => 'on_track',
        };
        return ['first_response_state' => $first, 'resolution_state' => $resolution, 'minutes_to_respond' => (int) round(($frDue - $now) / 60), 'minutes_to_resolve' => (int) round(($resDue - $now) / 60)];
    }
}
