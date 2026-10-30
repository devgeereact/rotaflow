<?php
declare(strict_types=1);

namespace RotaFlow\Mod;

use RotaFlow\{Audit, Billing, BillingRules, Ctx, Db, HttpError, Module, Notify, StripeClient};

/**
 * The Stripe webhook: the only way a payment changes an organisation. Public by necessity, so it authorises itself:
 *  1. only the mode set in private config is served (an event from the other mode is acknowledged and ignored, never acted on);
 *  2. the signature is HMAC-SHA256 over the exact bytes, with a 300 s tolerance, against that mode's own secret;
 *  3. every event is recorded once per mode in billing_events, so a redelivery does nothing twice;
 *  4. a subscription is never taken from the event payload: it is retrieved from Stripe, because events arrive out of order;
 *  5. every write is pinned to one subscription we hold, in one mode (BillingRules::subscriptionScope).
 * A failure answers 500 so Stripe redelivers; a deliberate non-action answers 200 with a note in the ledger.
 */
final class StripeWebhook implements Module
{
    private const OUT_OF_ORDER_GRACE_SECONDS = 3600;

    /** @param ?callable $transport Stripe HTTP transport, injected by tests */
    public function __construct(private readonly Ctx $ctx, private $transport = null) {}

    public function routes(): array
    {
        return [['POST', '/stripe/webhook', $this->receive(...), 'public', 'raw']];
    }

    private function receive(?array $user, array $in, string $ip): array
    {
        $pdo = $this->ctx->pdo;
        $raw = (string) ($in['__raw'] ?? '');
        $header = (string) (($in['__headers'] ?? [])['stripe-signature'] ?? '');
        $mode = StripeClient::modeFrom($this->ctx);
        $secret = $mode === null ? null : StripeClient::webhookSecret($this->ctx, $mode);
        if ($mode === null || $secret === null) {
            throw new HttpError(503, 'billing_unavailable', 'Billing is not set up on this deployment yet.');
        }
        $event = json_decode($raw, true);
        if (is_array($event) && is_bool($event['livemode'] ?? null) && $event['livemode'] !== ($mode === 'live')) {
            return [200, ['received' => true, 'ignored' => 'mode']]; // acknowledged so Stripe stops retrying; nothing is read or written
        }
        if (!BillingRules::verifySignature($raw, $header, $secret, time())) {
            $this->ctx->log('stripe webhook: signature refused');
            throw new HttpError(400, 'bad_signature', 'Signature could not be verified');
        }
        if (!is_array($event) || !is_string($event['id'] ?? null) || preg_match('/^evt_[A-Za-z0-9_]+$/', $event['id']) !== 1
            || !is_string($event['type'] ?? null) || !is_array($event['data']['object'] ?? null)) {
            throw new HttpError(400, 'bad_event', 'Not a Stripe event');
        }

        $pdo->prepare('INSERT INTO billing_events (id, mode, event_id, event_type, event_created_at) VALUES (?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE deliveries = deliveries + 1')
            ->execute([Db::uuid(), $mode, $event['id'], substr($event['type'], 0, 100), BillingRules::utc($event['created'] ?? null)]);
        $led = $pdo->prepare("SELECT id, processed_at FROM billing_events WHERE provider = 'stripe' AND mode = ? AND event_id = ?");
        $led->execute([$mode, $event['id']]);
        $row = $led->fetch();
        if ($row['processed_at'] !== null) {
            return [200, ['received' => true, 'duplicate' => true]];
        }
        try {
            $result = $this->handle($event, $mode);
        } catch (\Throwable $e) {
            if ($pdo->inTransaction()) {
                $pdo->rollBack();
            }
            $pdo->prepare('UPDATE billing_events SET last_error = ? WHERE id = ?')->execute([substr(get_class($e) . ': ' . $this->safeMessage($e), 0, 500), $row['id']]);
            $this->ctx->log('stripe webhook: ' . $event['type'] . ' failed (' . get_class($e) . ')');
            return [500, HttpError::body('webhook_failed', 'Could not process the event; it will be retried')];
        }
        $pdo->prepare('UPDATE billing_events SET processed_at = UTC_TIMESTAMP(), org_id = ?, last_error = ? WHERE id = ?')->execute([$result['org'], $result['note'], $row['id']]);
        return [200, ['received' => true]];
    }

    /** @param array<string,mixed> $event @return array{org:?string,note:?string} */
    private function handle(array $event, string $mode): array
    {
        $obj = $event['data']['object'];
        return match ($event['type']) {
            'checkout.session.completed' => $this->checkoutCompleted($obj, $mode),
            'customer.subscription.updated' => $this->subscriptionUpdated($obj, $mode),
            'customer.subscription.deleted' => $this->subscriptionDeleted($obj, $mode),
            'customer.subscription.trial_will_end' => $this->trialWillEnd($obj, $mode),
            'invoice.finalized' => $this->invoiceFinalized($obj, $mode),
            'invoice.paid' => $this->invoicePaid($obj, $mode, (int) ($event['created'] ?? 0)),
            'invoice.payment_failed' => $this->invoiceFailed($obj, $mode, (int) ($event['created'] ?? 0)),
            default => ['org' => null, 'note' => 'unhandled-type'],
        };
    }

    // ---- checkout and subscription -------------------------------------------------------------------

    /** @param array<string,mixed> $s @return array{org:?string,note:?string} */
    private function checkoutCompleted(array $s, string $mode): array
    {
        if (($s['mode'] ?? null) !== 'subscription') {
            return ['org' => null, 'note' => 'not-a-subscription'];
        }
        $orgId = $s['client_reference_id'] ?? null;
        $metaOrg = is_array($s['metadata'] ?? null) ? ($s['metadata']['org_id'] ?? null) : null;
        if (!is_string($orgId) || !$this->isUuid($orgId) || ($metaOrg !== null && $metaOrg !== $orgId) || !$this->orgExists($orgId)) {
            return ['org' => null, 'note' => 'no-such-organisation'];
        }
        $subRef = is_string($s['subscription'] ?? null) ? $s['subscription'] : (is_array($s['subscription'] ?? null) ? ($s['subscription']['id'] ?? null) : null);
        $customer = is_string($s['customer'] ?? null) && preg_match('/^cus_[A-Za-z0-9_]+$/', $s['customer']) === 1 ? $s['customer'] : null;
        if (!is_string($subRef) || preg_match('/^sub_[A-Za-z0-9_]+$/', $subRef) !== 1 || $customer === null) {
            return ['org' => $orgId, 'note' => 'no-subscription-on-session'];
        }
        $sub = $this->stripe()->subscription($subRef);
        if (($sub['metadata']['org_id'] ?? $orgId) !== $orgId) {
            return ['org' => $orgId, 'note' => 'subscription-names-another-organisation'];
        }
        $plan = $this->planOf($sub, $mode, is_array($s['metadata'] ?? null) ? ($s['metadata']['plan'] ?? null) : null);
        $pdo = $this->ctx->pdo;
        $pdo->beginTransaction();
        $cur = $pdo->prepare('SELECT provider_ref, stripe_mode, status FROM subscriptions WHERE org_id = ? FOR UPDATE');
        $cur->execute([$orgId]);
        $held = $cur->fetch() ?: null;
        if ($held !== null && $held['provider_ref'] !== $subRef && !BillingRules::checkoutAllowed($held, $mode)) {
            $pdo->rollBack(); // a second live subscription must never overwrite the first, which would keep billing unseen
            return ['org' => $orgId, 'note' => 'second-live-subscription-needs-attention'];
        }
        Billing::applySubscription($pdo, $orgId, $sub, $mode, $plan, $customer, $this->unitAmount($sub));
        Audit::log($pdo, $orgId, null, 'billing.subscribed', 'subscriptions', null, ['plan' => $plan, 'mode' => $mode], 'info', 'org', null);
        $pdo->commit();
        return ['org' => $orgId, 'note' => null];
    }

    /** @param array<string,mixed> $obj @return array{org:?string,note:?string} */
    private function subscriptionUpdated(array $obj, string $mode): array
    {
        $held = $this->held($obj['id'] ?? null, $mode);
        if ($held === null) {
            return ['org' => null, 'note' => 'not-ours'];
        }
        $fresh = BillingRules::freshestSubscription($obj, $this->stripe()->subscription((string) $obj['id']));
        if ($fresh === null) {
            throw new \RuntimeException('subscription could not be retrieved');
        }
        $pdo = $this->ctx->pdo;
        $pdo->beginTransaction();
        Billing::applySubscription($pdo, $held['org_id'], $fresh, $mode, $this->planOf($fresh, $mode, $held['plan']), null, $this->unitAmount($fresh));
        $pdo->commit();
        return ['org' => $held['org_id'], 'note' => null];
    }

    /** @param array<string,mixed> $obj @return array{org:?string,note:?string} */
    private function subscriptionDeleted(array $obj, string $mode): array
    {
        $held = $this->held($obj['id'] ?? null, $mode);
        $reason = is_array($obj['cancellation_details'] ?? null) && is_string($obj['cancellation_details']['reason'] ?? null) ? $obj['cancellation_details']['reason'] : null;
        if ($held === null) {
            return ['org' => null, 'note' => 'not-ours'];
        }
        $pdo = $this->ctx->pdo;
        $pdo->beginTransaction();
        $obj['status'] = 'canceled';
        $obj['canceled_at'] = is_int($obj['canceled_at'] ?? null) ? $obj['canceled_at'] : time();
        Billing::applySubscription($pdo, $held['org_id'], $obj, $mode, $held['plan'], null, null);
        if (BillingRules::suspendOnDeleted(true, $reason)) {
            Billing::setOrgStatus($pdo, $held['org_id'], 'suspended', 'Subscription cancelled after payment failed', 'billing.org_suspended');
        }
        $pdo->commit();
        return ['org' => $held['org_id'], 'note' => null];
    }

    /** @param array<string,mixed> $obj @return array{org:?string,note:?string} */
    private function trialWillEnd(array $obj, string $mode): array
    {
        $held = $this->held($obj['id'] ?? null, $mode);
        if ($held === null) {
            return ['org' => null, 'note' => 'not-ours'];
        }
        $n = BillingRules::trialEndingNotice($this->owners($held['org_id']), (string) $obj['id'], is_int($obj['trial_end'] ?? null) ? $obj['trial_end'] : null, $mode);
        if ($n !== null) {
            Notify::enqueue($this->ctx->pdo, $held['org_id'], $n['event'], $this->owners($held['org_id']), $n['type'], $n['title'], $n['body'], $n['dedupe']);
        }
        return ['org' => $held['org_id'], 'note' => null];
    }

    // ---- invoices ------------------------------------------------------------------------------------

    /** @param array<string,mixed> $inv @return array{org:?string,note:?string} */
    private function invoiceFinalized(array $inv, string $mode): array
    {
        $held = $this->held(BillingRules::subscriptionRefOf($inv), $mode);
        $known = $this->knownInvoice($inv);
        $d = BillingRules::invoiceFinalized($known, ['status' => $inv['status'] ?? null, 'subscriptionRef' => BillingRules::subscriptionRefOf($inv)], $held !== null);
        if ($d['action'] === 'skip') {
            return ['org' => $held['org_id'] ?? null, 'note' => $d['reason']];
        }
        $docs = $this->documents($inv);
        if ($d['action'] === 'documents') {
            $this->updateDocuments((string) $known['id'], $docs);
            return ['org' => $known['org_id'], 'note' => null];
        }
        $this->insertInvoice($held['org_id'], $inv, 'open', $docs, 0, null, null);
        return ['org' => $held['org_id'], 'note' => null];
    }

    /** @param array<string,mixed> $inv @return array{org:?string,note:?string} */
    private function invoicePaid(array $inv, string $mode, int $eventCreated): array
    {
        $held = $this->held(BillingRules::subscriptionRefOf($inv), $mode);
        $known = $this->knownInvoice($inv);
        if ($known === null && $held === null) {
            return $this->orphan($eventCreated);
        }
        $paidAt = BillingRules::utc($inv['status_transitions']['paid_at'] ?? null) ?? gmdate('Y-m-d H:i:s');
        $docs = $this->documents($inv);
        if ($known === null) {
            $this->insertInvoice($held['org_id'], $inv, 'paid', $docs, 0, $paidAt, null);
            return ['org' => $held['org_id'], 'note' => null];
        }
        $this->ctx->pdo->prepare("UPDATE invoices SET status = 'paid', paid_at = COALESCE(paid_at, ?), failure_reason = NULL WHERE id = ? AND status NOT IN ('refunded','void')")->execute([$paidAt, $known['id']]);
        $this->updateDocuments((string) $known['id'], $docs);
        return ['org' => $known['org_id'], 'note' => null];
    }

    /** @param array<string,mixed> $inv @return array{org:?string,note:?string} */
    private function invoiceFailed(array $inv, string $mode, int $eventCreated): array
    {
        $held = $this->held(BillingRules::subscriptionRefOf($inv), $mode);
        $known = $this->knownInvoice($inv);
        if ($known === null && $held === null) {
            return $this->orphan($eventCreated);
        }
        $org = $known['org_id'] ?? $held['org_id'];
        $d = BillingRules::invoiceFailure($known, is_int($inv['attempt_count'] ?? null) ? $inv['attempt_count'] : null);
        if (!$d['apply']) {
            return ['org' => $org, 'note' => $d['reason']];
        }
        $reason = 'The payment could not be taken';
        if ($known === null) {
            $this->insertInvoice($org, $inv, 'past_due', $this->documents($inv), $d['attempts'], null, $reason);
        } else {
            $this->ctx->pdo->prepare("UPDATE invoices SET status = 'past_due', attempts = ?, failure_reason = ? WHERE id = ?")->execute([$d['attempts'], $reason, $known['id']]);
            $this->updateDocuments((string) $known['id'], $this->documents($inv));
        }
        $n = BillingRules::paymentFailedNotice($this->owners($org), (string) $inv['id'], $mode);
        if ($n !== null) {
            Notify::enqueue($this->ctx->pdo, $org, $n['event'], $this->owners($org), $n['type'], $n['title'], $n['body'], $n['dedupe']);
        }
        return ['org' => $org, 'note' => null];
    }

    /**
     * An invoice for a subscription we do not hold yet. The first invoice can outrun checkout.session.completed, so for an hour the event is
     * retried (500); after that it is taken to be someone else's and noted.
     * @return array{org:?string,note:?string}
     */
    private function orphan(int $eventCreated): array
    {
        if ($eventCreated > 0 && time() - $eventCreated < self::OUT_OF_ORDER_GRACE_SECONDS) {
            throw new \RuntimeException('subscription not recorded yet');
        }
        return ['org' => null, 'note' => 'subscription-not-held'];
    }

    /** @param array<string,mixed> $inv @return array{hosted_invoice_url:?string,invoice_pdf:?string} what to store: the event's links, or fresh ones if the event has none */
    private function documents(array $inv): array
    {
        $fromEvent = BillingRules::invoiceDocuments($inv);
        $retrieved = null;
        if (BillingRules::needsDocumentRetrieval($inv) && is_string($inv['id'] ?? null)) {
            try {
                $retrieved = BillingRules::invoiceDocuments($this->stripe()->invoice($inv['id']));
            } catch (\RotaFlow\StripeError) {
                $retrieved = null; // links are a convenience; the invoice itself must still be recorded
            }
        }
        return BillingRules::documentsToWrite($fromEvent, $retrieved) + ['hosted_invoice_url' => null, 'invoice_pdf' => null];
    }

    /** @param array{hosted_invoice_url:?string,invoice_pdf:?string} $docs */
    private function updateDocuments(string $invoiceId, array $docs): void
    {
        $set = [];
        $args = [];
        foreach (['hosted_invoice_url', 'invoice_pdf'] as $k) {
            if (($docs[$k] ?? null) !== null) {
                $set[] = "$k = ?";
                $args[] = $docs[$k];
            }
        }
        if ($set !== []) {
            $this->ctx->pdo->prepare('UPDATE invoices SET ' . implode(', ', $set) . ' WHERE id = ?')->execute([...$args, $invoiceId]);
        }
    }

    /** @param array<string,mixed> $inv @param array{hosted_invoice_url:?string,invoice_pdf:?string} $docs */
    private function insertInvoice(string $orgId, array $inv, string $status, array $docs, int $attempts, ?string $paidAt, ?string $failure): void
    {
        $created = is_int($inv['created'] ?? null) ? $inv['created'] : time();
        $issued = gmdate('Y-m-d', $created);
        $due = is_int($inv['due_date'] ?? null) ? max(gmdate('Y-m-d', $inv['due_date']), $issued) : $issued;
        $start = is_int($inv['period_start'] ?? null) ? gmdate('Y-m-d', $inv['period_start']) : $issued;
        $end = is_int($inv['period_end'] ?? null) ? max(gmdate('Y-m-d', $inv['period_end']), $start) : $start;
        $tax = 0;
        foreach (is_array($inv['total_tax_amounts'] ?? null) ? $inv['total_tax_amounts'] : [] as $t) {
            $tax += is_array($t) && is_int($t['amount'] ?? null) ? $t['amount'] : 0;
        }
        $currency = is_string($inv['currency'] ?? null) && preg_match('/^[a-zA-Z]{3}$/', $inv['currency']) === 1 ? strtoupper($inv['currency']) : 'GBP';
        $number = is_string($inv['number'] ?? null) && $inv['number'] !== '' ? substr($inv['number'], 0, 100) : 'stripe-' . $inv['id'];
        $this->ctx->pdo->prepare(
            "INSERT INTO invoices (id, org_id, number, period_start, period_end, amount_pence, tax_pence, currency, status, issued_on, due_on, paid_at, failure_reason, attempts, provider, provider_ref, hosted_invoice_url, invoice_pdf)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'stripe', ?, ?, ?)"
        )->execute([Db::uuid(), $orgId, $number, $start, $end, max(0, (int) ($inv['total'] ?? $inv['amount_due'] ?? 0)), max(0, $tax), $currency, $status, $issued, $due, $paidAt, $failure, $attempts, (string) $inv['id'], $docs['hosted_invoice_url'] ?? null, $docs['invoice_pdf'] ?? null]);
    }

    // ---- lookups -------------------------------------------------------------------------------------

    /** The subscription row WE hold for this Stripe subscription id in this mode, or null (an id that is not ours, or no id, scopes nothing). @return array{org_id:string,plan:string}|null */
    private function held(mixed $ref, string $mode): ?array
    {
        if (!is_string($ref)) {
            return null;
        }
        $q = $this->ctx->pdo->prepare('SELECT org_id, plan FROM subscriptions WHERE provider_ref = ? AND stripe_mode = ?');
        $q->execute([$ref, $mode]);
        $r = $q->fetch();
        return $r !== false && BillingRules::subscriptionScope($r['org_id'], $ref, $mode) !== null ? $r : null;
    }

    /** @param array<string,mixed> $inv @return array{id:string,org_id:string,status:string,paid_at:?string,attempts:int}|null */
    private function knownInvoice(array $inv): ?array
    {
        if (!is_string($inv['id'] ?? null) || preg_match('/^in_[A-Za-z0-9_]+$/', $inv['id']) !== 1) {
            throw new \RuntimeException('invoice has no usable id');
        }
        $q = $this->ctx->pdo->prepare("SELECT id, org_id, status, paid_at, attempts FROM invoices WHERE provider = 'stripe' AND provider_ref = ?");
        $q->execute([$inv['id']]);
        $r = $q->fetch();
        return $r === false ? null : $r;
    }

    /** @return list<string> */
    private function owners(string $orgId): array
    {
        $q = $this->ctx->pdo->prepare("SELECT user_id FROM memberships WHERE org_id = ? AND role = 'owner' AND status = 'active'");
        $q->execute([$orgId]);
        return $q->fetchAll(\PDO::FETCH_COLUMN);
    }

    /** The plan this subscription is for: the price Stripe holds wins, then our metadata, then what we already had. @param array<string,mixed> $sub */
    private function planOf(array $sub, string $mode, mixed $fallback): string
    {
        $price = $sub['items']['data'][0]['price']['id'] ?? null;
        $pdo = $this->ctx->pdo;
        if (is_string($price)) {
            $q = $pdo->prepare('SELECT code FROM plans WHERE ' . ($mode === 'live' ? 'stripe_price_id' : 'stripe_test_price_id') . ' = ?');
            $q->execute([$price]);
            if (($c = $q->fetchColumn()) !== false) {
                return (string) $c;
            }
        }
        foreach ([is_array($sub['metadata'] ?? null) ? ($sub['metadata']['plan'] ?? null) : null, $fallback] as $candidate) {
            if (is_string($candidate)) {
                $q = $pdo->prepare('SELECT code FROM plans WHERE code = ?');
                $q->execute([$candidate]);
                if (($c = $q->fetchColumn()) !== false) {
                    return (string) $c;
                }
            }
        }
        throw new \RuntimeException('plan could not be determined');
    }

    /** @param array<string,mixed> $sub */
    private function unitAmount(array $sub): ?int
    {
        $a = $sub['items']['data'][0]['price']['unit_amount'] ?? null;
        return is_int($a) && $a >= 0 ? $a : null;
    }

    private function stripe(): StripeClient
    {
        return StripeClient::fromConfig($this->ctx, $this->transport) ?? throw new \RuntimeException('stripe is not configured');
    }

    private function orgExists(string $orgId): bool
    {
        $q = $this->ctx->pdo->prepare('SELECT 1 FROM organisations WHERE id = ?');
        $q->execute([$orgId]);
        return $q->fetchColumn() !== false;
    }

    private function isUuid(string $s): bool
    {
        return preg_match('/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/', $s) === 1;
    }

    /** An error message with anything that looks like a key or a long token taken out, for the ledger. */
    private function safeMessage(\Throwable $e): string
    {
        return preg_replace('/\b(sk|rk|whsec|pk)_[A-Za-z0-9_]+|[A-Za-z0-9_-]{32,}/', '[redacted]', $e->getMessage()) ?? '';
    }
}
