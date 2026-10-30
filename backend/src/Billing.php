<?php
declare(strict_types=1);

namespace RotaFlow;

/**
 * Billing state and plan limits, the PHP form of org_billing_state, org_is_read_only, org_has_feature, enforce_seat_limit,
 * enforce_location_limit and the subscription triggers. States: active (paid), trialing (Stripe trial), grace (payment failed, inside the
 * 14-day window), trial (the organisation's own 30-day trial), read_only (none of those).
 *
 * Read-only blocks building rotas and inviting people. It never blocks clocking in, leave or swaps: a lapsed bill must not stop a care home
 * recording who is on shift.
 */
final class Billing
{
    public const GRACE_DAYS = 14;

    /** @param array{sub_status:?string,sub_trial_ends_at:?string,grace_until:?string,trial_ends_at:?string} $r */
    public static function stateOf(array $r, int $now): string
    {
        $after = static fn (?string $utc): bool => $utc !== null && strtotime($utc . ' UTC') > $now;
        return match (true) {
            $r['sub_status'] === 'active' => 'active',
            $r['sub_status'] === 'trialing' && ($r['sub_trial_ends_at'] === null || $after($r['sub_trial_ends_at'])) => 'trialing',
            $r['sub_status'] === 'past_due' && $after($r['grace_until']) => 'grace',
            $after($r['trial_ends_at']) => 'trial',
            default => 'read_only',
        };
    }

    /** @return array{state:string,plan:string,trial_ends_at:?string,grace_until:?string,subscription_status:?string,current_period_end:?string,stripe_mode:?string,has_billing_account:bool} */
    public static function state(\PDO $pdo, string $orgId, int $now = 0): array
    {
        $q = $pdo->prepare(
            'SELECT o.plan, o.trial_ends_at, s.status AS sub_status, s.trial_ends_at AS sub_trial_ends_at, s.grace_until, s.current_period_end, s.stripe_mode, s.stripe_customer_id
               FROM organisations o LEFT JOIN subscriptions s ON s.org_id = o.id WHERE o.id = ?'
        );
        $q->execute([$orgId]);
        $r = $q->fetch();
        if ($r === false) {
            throw HttpError::notFound();
        }
        return [
            'state' => self::stateOf($r, $now ?: time()),
            'plan' => $r['plan'],
            'trial_ends_at' => $r['trial_ends_at'],
            'grace_until' => $r['grace_until'],
            'subscription_status' => $r['sub_status'],
            'current_period_end' => $r['current_period_end'],
            'stripe_mode' => $r['stripe_mode'],
            'has_billing_account' => $r['stripe_customer_id'] !== null,
        ];
    }

    /** Refuses a write that needs a paid, trialling or in-grace organisation (rota and shift building, inviting). */
    public static function requireNotReadOnly(\PDO $pdo, string $orgId): void
    {
        if (self::state($pdo, $orgId)['state'] === 'read_only') {
            throw new HttpError(402, 'billing_read_only', 'Your trial or plan has ended, so this organisation is read-only. Choose a plan in Settings, Billing to carry on.');
        }
    }

    /** Whether the organisation's plan includes a feature (and the organisation is not read-only). */
    public static function hasFeature(\PDO $pdo, string $orgId, string $feature): bool
    {
        $q = $pdo->prepare('SELECT p.features FROM organisations o JOIN plans p ON p.code = o.plan WHERE o.id = ?');
        $q->execute([$orgId]);
        $f = $q->fetchColumn();
        $list = is_string($f) ? json_decode($f, true) : null;
        return is_array($list) && in_array($feature, $list, true) && self::state($pdo, $orgId)['state'] !== 'read_only';
    }

    /**
     * Seat limit: active staff may not exceed the plan's. CALL INSIDE A TRANSACTION: it locks the organisation row, so two concurrent
     * additions cannot both take the last seat.
     */
    public static function requireSeat(\PDO $pdo, string $orgId, int $adding = 1): void
    {
        self::requireRoom($pdo, $orgId, $adding, 'seat_limit', 'seat_limit', 'SELECT COUNT(*) FROM staff_profiles WHERE org_id = ? AND active = 1', 'active staff');
    }

    /** Location limit, same locking rule as requireSeat. */
    public static function requireLocationRoom(\PDO $pdo, string $orgId, int $adding = 1): void
    {
        self::requireRoom($pdo, $orgId, $adding, 'location_limit', 'location_limit', 'SELECT COUNT(*) FROM locations WHERE org_id = ?', 'locations');
    }

    private static function requireRoom(\PDO $pdo, string $orgId, int $adding, string $column, string $code, string $countSql, string $noun): void
    {
        if (!$pdo->inTransaction()) {
            throw new \LogicException('Plan limits are checked inside a transaction');
        }
        $q = $pdo->prepare("SELECT p.$column FROM organisations o JOIN plans p ON p.code = o.plan WHERE o.id = ? FOR UPDATE");
        $q->execute([$orgId]);
        $limit = $q->fetchColumn();
        if ($limit === false || $limit === null) {
            return; // unlimited (or no plan row, which the foreign key prevents)
        }
        $n = $pdo->prepare($countSql);
        $n->execute([$orgId]);
        if ((int) $n->fetchColumn() + $adding > (int) $limit) {
            throw new HttpError(402, $code, "Your plan allows $limit $noun. Upgrade in Settings, Billing to add more.");
        }
    }

    /**
     * Records a subscription from a Stripe subscription object we have just retrieved. The grace window starts on the FIRST move to
     * past_due and is cleared by any other status; a further failure never extends it. Then the organisation's plan follows.
     * @param array<string,mixed> $stripeSub
     */
    public static function applySubscription(\PDO $pdo, string $orgId, array $stripeSub, string $mode, string $plan, ?string $customerId, ?int $pricePence, int $now = 0): void
    {
        $now = $now ?: time();
        $u = BillingRules::subscriptionUpdate($stripeSub);
        $q = $pdo->prepare('SELECT id, status, past_due_since, grace_until FROM subscriptions WHERE org_id = ? FOR UPDATE');
        $q->execute([$orgId]);
        $cur = $q->fetch();
        $sinceMode = $cur !== false && $cur['status'] === 'past_due' && $cur['past_due_since'] !== null && $u['status'] === 'past_due';
        $pastDueSince = $u['status'] !== 'past_due' ? null : ($sinceMode ? $cur['past_due_since'] : gmdate('Y-m-d H:i:s', $now));
        $grace = $u['status'] !== 'past_due' ? null : ($sinceMode ? $cur['grace_until'] : gmdate('Y-m-d H:i:s', $now + self::GRACE_DAYS * 86400));
        $vals = [$plan, $u['status'], 'stripe', (string) ($stripeSub['id'] ?? ''), $customerId, $mode, $pricePence, $u['current_period_end'], $u['trial_ends_at'], $u['canceled_at'], $pastDueSince, $grace];
        if ($cur === false) {
            $pdo->prepare('INSERT INTO subscriptions (plan, status, provider, provider_ref, stripe_customer_id, stripe_mode, price_pence, current_period_end, trial_ends_at, canceled_at, past_due_since, grace_until, id, org_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
                ->execute([...$vals, Db::uuid(), $orgId]);
        } else {
            $pdo->prepare('UPDATE subscriptions SET plan = ?, status = ?, provider = ?, provider_ref = ?, stripe_customer_id = COALESCE(?, stripe_customer_id), stripe_mode = ?, price_pence = COALESCE(?, price_pence), current_period_end = ?, trial_ends_at = ?, canceled_at = ?, past_due_since = ?, grace_until = ? WHERE id = ?')
                ->execute([...$vals, $cur['id']]);
        }
        self::syncPlan($pdo, $orgId, $now);
    }

    /** organisations.plan follows the subscription while it entitles the organisation; during the organisation's own trial it is 'professional'. */
    public static function syncPlan(\PDO $pdo, string $orgId, int $now = 0): void
    {
        $s = self::state($pdo, $orgId, $now);
        $sub = $pdo->prepare('SELECT plan FROM subscriptions WHERE org_id = ?');
        $sub->execute([$orgId]);
        $plan = $sub->fetchColumn();
        if (in_array($s['state'], ['active', 'trialing', 'grace'], true) && is_string($plan)) {
            $pdo->prepare('UPDATE organisations SET plan = ? WHERE id = ?')->execute([$plan, $orgId]);
        } elseif ($s['state'] === 'trial') {
            $pdo->prepare("UPDATE organisations SET plan = 'professional' WHERE id = ?")->execute([$orgId]);
        }
    }

    /** Suspends or reinstates an organisation, with the reason, and records it. A webhook is the actor, so the audit row has none. */
    public static function setOrgStatus(\PDO $pdo, string $orgId, string $status, ?string $reason, string $action): void
    {
        $pdo->prepare("UPDATE organisations SET status = ?, suspended_reason = ? WHERE id = ? AND status <> 'archived'")->execute([$status, $reason, $orgId]);
        Audit::log($pdo, $orgId, null, $action, 'organisations', $orgId, ['status' => $status], 'warning', 'org', null);
    }
}
