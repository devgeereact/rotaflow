<?php
declare(strict_types=1);

namespace RotaFlow;

/**
 * The decisions behind the Stripe integration, as pure functions so each can be tested to the edge. Ported from the Edge Functions'
 * reconcile.ts and guard.ts (which carry the lessons of RF-04 and RF-05: a replayed webhook, and a test event touching a live row).
 * Stripe objects arrive as decoded JSON arrays; times are Unix seconds.
 */
final class BillingRules
{
    private const LIVE_STATUSES = ['trialing', 'active', 'past_due'];
    private const MIN_CHECKOUT_TRIAL_SECONDS = 49 * 3600;

    /** @param array{status:?string,provider_ref:?string,stripe_mode:?string}|null $existing */
    public static function checkoutAllowed(?array $existing, string $mode): bool
    {
        return !($existing !== null
            && !empty($existing['provider_ref'])
            && ($existing['stripe_mode'] ?? null) === $mode
            && in_array($existing['status'] ?? null, self::LIVE_STATUSES, true));
    }

    /**
     * The trial end to carry into Stripe, in Unix seconds, or null to charge now. Stripe rejects a trial_end under 48 hours away, so a trial
     * with under 49 hours left is dropped rather than risk the whole checkout failing.
     */
    public static function checkoutTrialEnd(?string $orgTrialEndsAtUtc, int $now): ?int
    {
        if ($orgTrialEndsAtUtc === null || $orgTrialEndsAtUtc === '') {
            return null;
        }
        $end = strtotime($orgTrialEndsAtUtc . ' UTC');
        return $end === false || $end - $now < self::MIN_CHECKOUT_TRIAL_SECONDS ? null : $end;
    }

    /**
     * What to do with an invoice.payment_failed. A paid invoice is never regressed; a redelivery is not another card attempt; Stripe's own
     * attempt_count wins, but the count never goes backwards.
     * @param array{status:string,paid_at?:?string,attempts?:?int}|null $known
     * @return array{apply:bool,attempts:int,reason:string}
     */
    public static function invoiceFailure(?array $known, ?int $providerAttemptCount): array
    {
        if ($known !== null && ($known['status'] === 'paid' || !empty($known['paid_at']))) {
            return ['apply' => false, 'attempts' => (int) ($known['attempts'] ?? 0), 'reason' => 'already-paid'];
        }
        $held = (int) ($known['attempts'] ?? 0);
        $attempts = $providerAttemptCount !== null && $providerAttemptCount > 0 ? max($providerAttemptCount, $held) : $held + 1;
        if ($known !== null && $attempts === $held) {
            return ['apply' => false, 'attempts' => $held, 'reason' => 'duplicate-delivery'];
        }
        return ['apply' => true, 'attempts' => $attempts, 'reason' => $known !== null ? 'further-failure' : 'first-failure'];
    }

    /**
     * Pins a financial write to ONE subscription in ONE mode. An event that names no organisation or no subscription gets no scope, so it
     * can never widen into "every row for this organisation".
     * @return array{org_id:string,provider_ref:string,stripe_mode:string}|null
     */
    public static function subscriptionScope(?string $orgId, ?string $subscriptionRef, string $mode): ?array
    {
        return ($orgId === null || $orgId === '' || $subscriptionRef === null || $subscriptionRef === '') ? null : ['org_id' => $orgId, 'provider_ref' => $subscriptionRef, 'stripe_mode' => $mode];
    }

    /** The subscription id on an invoice, whether Stripe sent a bare id or an expanded object. @param array<string,mixed> $invoice */
    public static function subscriptionRefOf(array $invoice): ?string
    {
        $s = $invoice['subscription'] ?? null;
        if (is_string($s)) {
            return $s;
        }
        return is_array($s) && is_string($s['id'] ?? null) ? $s['id'] : null;
    }

    /**
     * The state to write for a customer.subscription.updated: the freshly RETRIEVED subscription, never the event's payload (events arrive out of
     * order, and a stale payload would resurrect a cancelled subscription). Null if the retrieval failed or named another subscription.
     * @param array<string,mixed> $fromEvent
     * @param array<string,mixed>|null $retrieved
     * @return array<string,mixed>|null
     */
    public static function freshestSubscription(array $fromEvent, ?array $retrieved): ?array
    {
        return $retrieved !== null && ($retrieved['id'] ?? null) === ($fromEvent['id'] ?? '') ? $retrieved : null;
    }

    public static function mapStatus(string $stripeStatus): string
    {
        return match ($stripeStatus) {
            'active' => 'active',
            'trialing' => 'trialing',
            'canceled', 'paused' => 'canceled',
            default => 'past_due', // past_due, unpaid, incomplete, incomplete_expired, and anything Stripe invents later
        };
    }

    /**
     * @param array<string,mixed> $sub
     * @return array{status:string,current_period_end:?string,canceled_at:?string,trial_ends_at:?string}
     */
    public static function subscriptionUpdate(array $sub): array
    {
        return [
            'status' => self::mapStatus((string) ($sub['status'] ?? '')),
            'current_period_end' => self::utc($sub['current_period_end'] ?? null),
            'canceled_at' => self::utc($sub['canceled_at'] ?? null),
            'trial_ends_at' => self::utc($sub['trial_end'] ?? null),
        ];
    }

    /** Unix seconds to 'Y-m-d H:i:s' UTC; null for missing, zero or not a number. */
    public static function utc(mixed $unix): ?string
    {
        return is_int($unix) && $unix > 0 ? gmdate('Y-m-d H:i:s', $unix) : null;
    }

    /** An organisation is suspended only when WE hold the subscription Stripe deleted and Stripe cancelled it for non-payment. */
    public static function suspendOnDeleted(bool $matchedStoredSubscription, ?string $cancellationReason): bool
    {
        return $matchedStoredSubscription && $cancellationReason === 'payment_failed';
    }

    /** @param list<string> $ownerIds @return array{event:string,type:string,title:string,body:string,dedupe:string}|null */
    public static function trialEndingNotice(array $ownerIds, string $subscriptionId, ?int $trialEnd, string $mode): ?array
    {
        if ($ownerIds === []) {
            return null;
        }
        $when = $trialEnd !== null && $trialEnd > 0 ? 'Your card will first be charged on ' . self::londonDate($trialEnd) . '.' : 'Your card will be charged when the trial ends.';
        return ['event' => 'billing/trial_will_end', 'type' => 'billing', 'title' => 'Your trial ends in 3 days', 'body' => $when . ' To change plan or cancel, open Settings, Billing.', 'dedupe' => "stripe:trial_will_end:$mode:$subscriptionId:" . ($trialEnd ?? 'none')];
    }

    /** One notice per invoice, not per retry. @param list<string> $ownerIds @return array{event:string,type:string,title:string,body:string,dedupe:string}|null */
    public static function paymentFailedNotice(array $ownerIds, string $invoiceId, string $mode): ?array
    {
        if ($ownerIds === []) {
            return null;
        }
        return ['event' => 'billing/payment_failed', 'type' => 'billing', 'title' => 'Payment failed', 'body' => 'We could not take payment for your RotaFlow plan. Your card will be retried. Update it in Settings, Billing to keep your plan active.', 'dedupe' => "stripe:payment_failed:$mode:$invoiceId"];
    }

    /** "1 November 2030" in UK time. */
    public static function londonDate(int $unix): string
    {
        return (new \DateTimeImmutable('@' . $unix))->setTimezone(new \DateTimeZone('Europe/London'))->format('j F Y');
    }

    /** Only a link Stripe documents is ever stored or shown: https on invoice.stripe.com or pay.stripe.com, no whitespace, under 2 KB. */
    public static function documentUrl(mixed $v): ?string
    {
        return is_string($v) && strlen($v) <= 2048 && preg_match('#^https://(invoice|pay)\.stripe\.com/\S*$#', $v) === 1 ? $v : null;
    }

    /** @param array<string,mixed> $invoice @return array{hosted_invoice_url:?string,invoice_pdf:?string} */
    public static function invoiceDocuments(array $invoice): array
    {
        return ['hosted_invoice_url' => self::documentUrl($invoice['hosted_invoice_url'] ?? null), 'invoice_pdf' => self::documentUrl($invoice['invoice_pdf'] ?? null)];
    }

    /** Ask Stripe again only for a finalised invoice that is missing a link. @param array<string,mixed> $invoice */
    public static function needsDocumentRetrieval(array $invoice): bool
    {
        return ($invoice['status'] ?? null) !== 'draft' && (empty($invoice['hosted_invoice_url']) || empty($invoice['invoice_pdf']));
    }

    /**
     * What to write: what Stripe holds now, else what the event said; a missing link is simply left out, so a link already stored is never overwritten with null.
     * @param array{hosted_invoice_url:?string,invoice_pdf:?string} $fromEvent
     * @param array{hosted_invoice_url:?string,invoice_pdf:?string}|null $retrieved
     * @return array<string,string>
     */
    public static function documentsToWrite(array $fromEvent, ?array $retrieved): array
    {
        $out = [];
        $hosted = $retrieved['hosted_invoice_url'] ?? $fromEvent['hosted_invoice_url'];
        $pdf = $retrieved['invoice_pdf'] ?? $fromEvent['invoice_pdf'];
        if ($hosted !== null) {
            $out['hosted_invoice_url'] = $hosted;
        }
        if ($pdf !== null) {
            $out['invoice_pdf'] = $pdf;
        }
        return $out;
    }

    /**
     * invoice.finalized: record an OPEN invoice for a subscription this organisation holds in this mode; otherwise leave it (a paid one is
     * recorded by invoice.paid, an unknown subscription is not ours). An invoice already known only gets its links.
     * @param array{status:string,paid_at?:?string,attempts?:?int}|null $known
     * @param array{status:?string,subscriptionRef:?string} $event
     * @return array{action:string,reason:string}
     */
    public static function invoiceFinalized(?array $known, array $event, bool $holdsSubscription): array
    {
        return match (true) {
            $known !== null => ['action' => 'documents', 'reason' => 'already-known'],
            $event['status'] !== 'open' => ['action' => 'skip', 'reason' => 'not-open'],
            $event['subscriptionRef'] === null => ['action' => 'skip', 'reason' => 'no-subscription'],
            !$holdsSubscription => ['action' => 'skip', 'reason' => 'subscription-not-held'],
            default => ['action' => 'insert', 'reason' => 'first-sight'],
        };
    }

    /**
     * Verifies a Stripe webhook signature: the header is "t=<unix>,v1=<hex>[,v1=<hex>...]" and v1 is HMAC-SHA256 of "<t>.<raw body>" with the endpoint's secret.
     * Any v1 may match (Stripe sends two while a secret is being rotated). A timestamp more than $tolerance seconds from now is refused, so a captured
     * request cannot be replayed later.
     */
    public static function verifySignature(string $rawBody, string $header, string $secret, int $now, int $tolerance = 300): bool
    {
        if ($secret === '' || $header === '' || strlen($header) > 1000) {
            return false;
        }
        $t = null;
        $sigs = [];
        foreach (explode(',', $header) as $part) {
            [$k, $v] = array_pad(explode('=', trim($part), 2), 2, '');
            if ($k === 't') {
                $t = ctype_digit($v) ? (int) $v : null;
            } elseif ($k === 'v1' && preg_match('/^[0-9a-f]{64}$/', $v) === 1) {
                $sigs[] = $v;
            }
        }
        if ($t === null || $sigs === [] || abs($now - $t) > $tolerance) {
            return false;
        }
        $expected = hash_hmac('sha256', $t . '.' . $rawBody, $secret);
        foreach ($sigs as $s) {
            if (hash_equals($expected, $s)) {
                return true;
            }
        }
        return false;
    }
}
