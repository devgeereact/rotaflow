<?php
declare(strict_types=1);

namespace RotaFlow\Mod;

use RotaFlow\{Audit, Billing as BillingState, BillingRules, Ctx, HttpError, Input, Module, Scope, StripeClient, StripeError};

/**
 * What an organisation sees and does about billing. Any member may read the state (the app shows a banner and greys out writes); only the
 * real owner sees the account or acts on it. Stripe is reached only here and in the webhook, in the mode set by the private config (test until
 * the owner switches it); no key ever reaches a browser. Checkout and the portal return to the configured app URL, not the Origin header.
 */
final class Billing implements Module
{
    private const PURCHASABLE = ['starter', 'professional', 'business']; // enterprise is by arrangement

    /** @param ?callable $transport Stripe HTTP transport, injected by tests */
    public function __construct(private readonly Ctx $ctx, private $transport = null) {}

    public function routes(): array
    {
        return [
            ['GET', '/plans', $this->plans(...)],
            ['GET', '/orgs/{o}/billing/state', $this->stateRoute(...)],
            ['GET', '/orgs/{o}/billing', $this->account(...)],
            ['POST', '/orgs/{o}/billing/checkout', $this->checkout(...)],
            ['POST', '/orgs/{o}/billing/portal', $this->portal(...)],
            ['POST', '/orgs/{o}/billing/sync-contact', $this->syncContact(...)],
            ['POST', '/orgs/{o}/billing/invoices/{i}/links', $this->invoiceLinks(...)],
        ];
    }

    /** The price list. Any signed-in person may read it (it is shown before an organisation exists). */
    private function plans(array $user, array $in, string $ip): array
    {
        $mode = StripeClient::modeFrom($this->ctx);
        $col = $mode === 'live' ? 'stripe_price_id' : 'stripe_test_price_id';
        $rows = $this->ctx->pdo->query("SELECT code, name, monthly_price_pence, currency, seat_limit, location_limit, description, features, ($col IS NOT NULL) AS has_price FROM plans ORDER BY sort_order")->fetchAll();
        foreach ($rows as &$r) {
            $r['features'] = json_decode((string) $r['features'], true) ?? [];
            $r['purchasable'] = $mode !== null && (bool) $r['has_price'] && in_array($r['code'], self::PURCHASABLE, true);
            unset($r['has_price']);
        }
        return [200, ['plans' => $rows]];
    }

    /** Any member: just enough to show a banner and disable writes. */
    private function stateRoute(array $user, array $in, string $ip, string $o): array
    {
        Scope::membership($this->ctx->pdo, $user['id'], $o);
        $s = BillingState::state($this->ctx->pdo, $o);
        return [200, ['state' => $s['state'], 'plan' => $s['plan'], 'trial_ends_at' => $s['trial_ends_at'], 'grace_until' => $s['grace_until']]];
    }

    /** Owner: the state, the subscription and the invoices. */
    private function account(array $user, array $in, string $ip, string $o): array
    {
        $pdo = $this->ctx->pdo;
        $m = Scope::membership($pdo, $user['id'], $o);
        Scope::require($m, ['owner']);
        $inv = $pdo->prepare("SELECT id, number, period_start, period_end, amount_pence, tax_pence, currency, status, issued_on, due_on, paid_at, failure_reason, attempts, (hosted_invoice_url IS NOT NULL OR invoice_pdf IS NOT NULL) AS has_links FROM invoices WHERE org_id = ? ORDER BY issued_on DESC, created_at DESC LIMIT 36");
        $inv->execute([$o]);
        return [200, ['billing' => BillingState::state($pdo, $o), 'invoices' => $inv->fetchAll(), 'stripe_configured' => StripeClient::modeFrom($this->ctx) !== null]];
    }

    private function checkout(array $user, array $in, string $ip, string $o): array
    {
        $pdo = $this->ctx->pdo;
        $m = Scope::membership($pdo, $user['id'], $o);
        Scope::require($m, ['owner']);
        $this->ctx->limits->hit('billing-checkout', $o, 20, 3600);
        $code = Input::reqStr($in, 'plan', 20);
        if (!in_array($code, self::PURCHASABLE, true)) {
            throw HttpError::invalid('Choose Starter, Professional or Business. Enterprise is by arrangement.');
        }
        $stripe = $this->client();
        $mode = $stripe->mode();
        $col = $mode === 'live' ? 'stripe_price_id' : 'stripe_test_price_id';
        $p = $pdo->prepare("SELECT name, $col AS price FROM plans WHERE code = ?");
        $p->execute([$code]);
        $plan = $p->fetch();
        if ($plan === false || !is_string($plan['price']) || $plan['price'] === '') {
            throw HttpError::conflict('plan_unavailable', $plan === false ? 'Unknown plan' : "{$plan['name']} is not available for checkout yet");
        }
        $s = $pdo->prepare('SELECT status, provider_ref, stripe_mode, stripe_customer_id FROM subscriptions WHERE org_id = ?');
        $s->execute([$o]);
        $existing = $s->fetch() ?: null;
        if (!BillingRules::checkoutAllowed($existing, $mode)) {
            throw HttpError::conflict('already_subscribed', 'This organisation already has a subscription. Change plan from the billing portal.');
        }
        $t = $pdo->prepare('SELECT trial_ends_at FROM organisations WHERE id = ?');
        $t->execute([$o]);
        $trialEnd = BillingRules::checkoutTrialEnd($t->fetchColumn() ?: null, time());
        $customer = $existing !== null && $existing['stripe_mode'] === $mode ? $existing['stripe_customer_id'] : null;
        $app = $this->appUrl();
        $session = $this->stripe(static fn (): array => $stripe->createCheckoutSession([
            'mode' => 'subscription',
            'line_items' => [['price' => $plan['price'], 'quantity' => 1]],
            'customer' => $customer,
            'customer_email' => $customer === null ? $user['email'] : null,
            'client_reference_id' => $o,
            'subscription_data' => ['metadata' => ['org_id' => $o, 'plan' => $code], 'trial_end' => $trialEnd],
            'metadata' => ['org_id' => $o, 'plan' => $code],
            'success_url' => "$app/app/settings/billing?checkout=success",
            'cancel_url' => "$app/app/settings/billing?checkout=cancelled",
        ]));
        $url = $session['url'] ?? null;
        if (!is_string($url) || preg_match('#^https://checkout\.stripe\.com/#', $url) !== 1) {
            throw new HttpError(502, 'billing_provider', 'Stripe did not return a checkout page. Try again shortly.');
        }
        Audit::log($pdo, $o, $user['id'], 'billing.checkout_started', 'organisations', $o, ['plan' => $code, 'mode' => $mode], 'info', 'org', $ip);
        return [200, ['url' => $url]];
    }

    private function portal(array $user, array $in, string $ip, string $o): array
    {
        $pdo = $this->ctx->pdo;
        $m = Scope::membership($pdo, $user['id'], $o);
        Scope::require($m, ['owner']);
        $this->ctx->limits->hit('billing-portal', $o, 30, 3600);
        $stripe = $this->client();
        $customer = $this->customerFor($o, $stripe->mode());
        $app = $this->appUrl();
        $session = $this->stripe(static fn (): array => $stripe->createPortalSession(['customer' => $customer, 'return_url' => "$app/app/settings/billing"]));
        $url = $session['url'] ?? null;
        if (!is_string($url) || preg_match('#^https://billing\.stripe\.com/#', $url) !== 1) {
            throw new HttpError(502, 'billing_provider', 'Stripe did not return a billing page. Try again shortly.');
        }
        return [200, ['url' => $url]];
    }

    /** Writes the organisation's contact email onto the Stripe customer, so receipts go to the address the owner chose. */
    private function syncContact(array $user, array $in, string $ip, string $o): array
    {
        $pdo = $this->ctx->pdo;
        $m = Scope::membership($pdo, $user['id'], $o);
        Scope::require($m, ['owner']);
        $this->ctx->limits->hit('billing-contact', $o, 20, 3600);
        $stripe = $this->client();
        $customer = $this->customerFor($o, $stripe->mode());
        $q = $pdo->prepare('SELECT contact_email, settings FROM organisations WHERE id = ?');
        $q->execute([$o]);
        $org = $q->fetch();
        $settings = json_decode((string) ($org['settings'] ?? ''), true);
        $email = trim((string) ($org['contact_email'] ?? '')) ?: trim((string) (is_array($settings) ? ($settings['contact_email'] ?? '') : ''));
        if ($email === '' || strlen($email) > 255 || preg_match('/^[^\s@]+@[^\s@]+\.[^\s@]+$/', $email) !== 1) {
            throw new HttpError(422, 'no_contact_email', 'Set a contact email in Settings, Organisation first. That address is the billing contact.');
        }
        $this->stripe(static fn (): array => $stripe->updateCustomer($customer, ['email' => $email]));
        return [200, ['email' => $email]];
    }

    /** A fresh hosted-invoice page and PDF link (Stripe expires the stored ones). The invoice is named by our own id, never a Stripe id from the browser. */
    private function invoiceLinks(array $user, array $in, string $ip, string $o, string $i): array
    {
        $pdo = $this->ctx->pdo;
        $m = Scope::membership($pdo, $user['id'], $o);
        Scope::require($m, ['owner']);
        $this->ctx->limits->hit('billing-links', $o, 60, 3600);
        $stripe = $this->client();
        $q = $pdo->prepare('SELECT provider, provider_ref FROM invoices WHERE id = ? AND org_id = ?');
        $q->execute([$i, $o]);
        $inv = $q->fetch();
        if ($inv === false) {
            throw HttpError::notFound();
        }
        $this->customerFor($o, $stripe->mode()); // refuses an organisation whose billing account belongs to the other mode
        if ($inv['provider'] !== 'stripe' || preg_match('/^in_[A-Za-z0-9_]+$/', (string) $inv['provider_ref']) !== 1) {
            throw new HttpError(422, 'not_a_stripe_invoice', 'This invoice was not issued through Stripe, so it has no Stripe link.');
        }
        $fresh = $this->stripe(static fn (): array => $stripe->invoice((string) $inv['provider_ref']));
        return [200, BillingRules::invoiceDocuments($fresh)];
    }

    private function client(): StripeClient
    {
        try {
            $c = StripeClient::fromConfig($this->ctx, $this->transport);
        } catch (\InvalidArgumentException) {
            $this->ctx->log('billing: stripe key does not match the configured mode');
            throw new HttpError(503, 'billing_unavailable', 'Billing is temporarily unavailable. Please contact support.');
        }
        if ($c === null) {
            throw new HttpError(503, 'billing_unavailable', 'Billing is not set up on this deployment yet.');
        }
        return $c;
    }

    private function appUrl(): string
    {
        $u = rtrim($this->ctx->appUrl, '/');
        if (preg_match('#^https://[a-z0-9.-]+(:\d+)?$#i', $u) !== 1) {
            throw new HttpError(503, 'billing_unavailable', 'Billing is not set up on this deployment yet.');
        }
        return $u;
    }

    /** The organisation's Stripe customer id, refused if it was created in the other mode or does not exist. */
    private function customerFor(string $o, string $mode): string
    {
        $q = $this->ctx->pdo->prepare('SELECT stripe_customer_id, stripe_mode FROM subscriptions WHERE org_id = ?');
        $q->execute([$o]);
        $s = $q->fetch();
        if ($s === false || !is_string($s['stripe_customer_id']) || $s['stripe_customer_id'] === '') {
            throw HttpError::notFound();
        }
        if ($s['stripe_mode'] !== $mode) {
            $this->ctx->log('billing: customer mode differs from configured mode');
            throw HttpError::conflict('billing_unavailable', 'Billing is temporarily unavailable. Please contact support.');
        }
        return $s['stripe_customer_id'];
    }

    /** @param callable():array<string,mixed> $call @return array<string,mixed> */
    private function stripe(callable $call): array
    {
        try {
            return $call();
        } catch (StripeError $e) {
            $this->ctx->log('billing: stripe error ' . $e->stripeCode . ' status ' . $e->status);
            throw new HttpError(502, 'billing_provider', 'Stripe could not complete that. Try again shortly.');
        }
    }
}
