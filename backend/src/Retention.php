<?php
declare(strict_types=1);

namespace RotaFlow;

use RotaFlow\Mod\Gdpr;

/**
 * Retention: ageing data out on the schedule in retention_policies. Every removal is a plain delete (nothing is anonymised), by the date a
 * thing ended, in whole calendar months. The audit trail is never touched; a data type with no rule here is recorded as an error, not skipped.
 * Each type runs on its own, so one failing rule cannot silently stop the others (the old all-or-nothing run failed fourteen nights unseen);
 * a failure is written to retention_runs and shown in the cron output.
 */
final class Retention
{
    /** @return list<array{data_type:string,rows_removed:int,cutoff:?string,error:?string}> */
    public static function run(\PDO $pdo, bool $dryRun, int $now = 0): array
    {
        $now = $now ?: time();
        $out = [];
        $policies = $pdo->query("SELECT data_type, retain_months FROM retention_policies WHERE retain_months IS NOT NULL AND enforced = 1 AND data_type <> 'deleted_tenant' ORDER BY data_type")->fetchAll();
        foreach ($policies as $p) {
            $cutoff = Gdpr::addMonths(gmdate('Y-m-d', $now), -(int) $p['retain_months']);
            $rows = 0;
            $error = null;
            try {
                $rows = self::one($pdo, (string) $p['data_type'], $cutoff, $dryRun);
            } catch (\Throwable $e) {
                $error = $e instanceof \LogicException ? $e->getMessage() : 'failed: ' . get_class($e);
            }
            $pdo->prepare('INSERT INTO retention_runs (ran_at, dry_run, data_type, rows_removed, cutoff, error) VALUES (?, ?, ?, ?, ?, ?)')->execute([gmdate('Y-m-d H:i:s', $now), $dryRun ? 1 : 0, $p['data_type'], $rows, $cutoff, $error]);
            $out[] = ['data_type' => (string) $p['data_type'], 'rows_removed' => $rows, 'cutoff' => $cutoff, 'error' => $error];
        }
        return $out;
    }

    private static function one(\PDO $pdo, string $type, string $cutoff, bool $dry): int
    {
        // [table, where] pairs, in an order that respects links between them. Counted when $dry, deleted otherwise. The count is of the first
        // table only for rota_history and attendance (shifts, clock events), as before.
        $steps = match ($type) {
            'rota_history' => [['shifts', 'DATE(starts_at) < ?', true], ['rotas', 'period_end < ? AND NOT EXISTS (SELECT 1 FROM shifts s WHERE s.rota_id = rotas.id)', false]],
            'attendance' => [['clock_events', 'DATE(event_at) < ?', true], ['timesheets', 'period_end < ?', false]],
            'leave' => [['leave_requests', 'end_date < ?', true]],
            'support_cases' => [['support_cases', 'resolved_at IS NOT NULL AND DATE(resolved_at) < ?', true]],
            'notifications' => [['notification_deliveries', 'DATE(created_at) < ?', true], ['notification_outbox', "DATE(created_at) < ? AND status IN ('sent','abandoned')", true]],
            'enquiries' => [['enquiries', 'DATE(created_at) < ?', true]],
            default => throw new \LogicException('no rule implemented for this data type'),
        };
        $counted = 0;
        foreach ($steps as [$table, $where, $count]) {
            if ($dry) {
                $q = $pdo->prepare("SELECT COUNT(*) FROM $table WHERE $where"); // $table and $where are the literals above
                $q->execute([$cutoff]);
                $n = (int) $q->fetchColumn();
            } else {
                $d = $pdo->prepare("DELETE FROM $table WHERE $where");
                $d->execute([$cutoff]);
                $n = $d->rowCount();
            }
            $counted += $count ? $n : 0;
        }
        return $counted;
    }
}
