# Stripe Billing Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace `SettingsBillingPage.tsx`'s "Payment is not connected yet" stub with a real Stripe integration — checkout, a hosted management portal, and webhook-driven sync into the existing `subscriptions`/`invoices` schema — so the Platform Console's MRR reporting (already built, always zero) becomes real.

**Architecture:** Three new Supabase Edge Functions (`create-checkout-session`, `create-portal-session`, `stripe-webhook`) following this repo's existing JWT-forwarding (`ai-rota-assistant`) and signature-authenticated-webhook (`inngest`) patterns. A new client service (`billingCheckoutService.ts`) calls the first two; the third is called only by Stripe. One migration adds the two missing columns the design needs (`plans.stripe_price_id`, `subscriptions.stripe_customer_id`) — everything else the schema needs already exists (`plans`, `invoices`, `subscriptions`, all from `0023_commercials.sql`).

**Tech Stack:** Deno Edge Functions (`npm:stripe@17`, `npm:@supabase/supabase-js@2`), Postgres/Supabase migrations, React/TypeScript client, Vitest.

**Spec:** `docs/superpowers/specs/2026-08-15-stripe-billing-integration-design.md`

## Global Constraints

- Pricing model is `0023_commercials.sql`'s: 4 flat monthly tiers (`starter` £29, `professional` £129, `business` £299, `enterprise` £790), not `marketing.ts`'s old per-seat model.
- No client-side Stripe key anywhere. Checkout and the Portal are both server-created redirects (`session.url`) — the browser never loads Stripe.js. `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` are Supabase Edge Function secrets only.
- `create-checkout-session` and `create-portal-session` forward the caller's JWT (mirror `ai-rota-assistant`) — Postgres RLS scopes every query, never `service_role`. Both additionally verify the caller is their org's `owner` before acting (billing is owner-only, matching `subscriptions`' existing RLS).
- `stripe-webhook` is deployed `--no-verify-jwt` and authenticates via Stripe's own signature (mirror `inngest`) — it is the one function in this feature allowed to use `service_role`, because Stripe's server calls it with no user session to forward.
- Every webhook DB write is an upsert keyed on Stripe's own id (`provider_ref`), so Stripe's documented at-least-once retry delivery cannot create duplicate rows.
- Out of scope, do not build: trial-on-signup automation, `seat_limit`/`location_limit` enforcement, any custom in-app invoice/payment-method UI.
- **Testing note, read before Task 3:** `supabase/functions/**` is Deno and excluded from this repo's `npm run typecheck`/`lint`/`vitest` (per `CLAUDE.md`) — none of the 4 existing Edge Functions have a test file; they're reviewed by hand and verified with real requests (curl / provider CLI) against a live function. Tasks 3–5 follow that existing convention: no fabricated vitest steps for Deno code, but every task still ends in a concrete, runnable verification command with an expected result — never "test appropriately." Task 6 (client service) and Task 7 (page) also have no precedent for unit/component tests anywhere in `src/services` or `src/pages` in this repo (only `src/lib`'s pure-logic modules and one stateful client module, `syncQueue.ts`, are unit-tested) — those two tasks are verified by `npm run typecheck` plus a manual browser check instead of new test files, matching the codebase's actual, established practice rather than introducing a new one mid-feature.

---

### Task 1: Migration — add the two missing columns

**Files:**
- Create: `supabase/migrations/0050_stripe_billing.sql`

**Interfaces:**
- Produces: `public.plans.stripe_price_id` (`text`, nullable), `public.subscriptions.stripe_customer_id` (`text`, nullable) — Task 3–5's Edge Functions read/write these by exact name.

- [ ] **Step 1: Write the migration**

```sql
-- =====================================================================
-- 0050_stripe_billing.sql — the two columns Stripe checkout/portal need
--
-- plans and invoices (0023) and subscriptions' provider/provider_ref seam
-- (0003) already fit a real payment provider. Two things are missing:
-- which Stripe Price each plan sells as (plans has no such column), and
-- which Stripe Customer an org is (subscriptions.provider_ref holds the
-- *subscription* id once one exists, but a Portal session needs the
-- customer id even between subscriptions — e.g. after a cancellation,
-- before a resubscribe, when provider_ref is null but the customer still
-- exists on Stripe's side).
-- =====================================================================

alter table public.plans
  add column if not exists stripe_price_id text;

comment on column public.plans.stripe_price_id is
  'The Stripe Price this plan checks out as. Null until created in Stripe and backfilled by hand — see docs/superpowers/plans/2026-08-15-stripe-billing-integration.md Task 9.';

alter table public.subscriptions
  add column if not exists stripe_customer_id text;

comment on column public.subscriptions.stripe_customer_id is
  'Stripe Customer id, set on first checkout. Survives cancellation (unlike provider_ref, which is the subscription id and goes stale once the subscription ends) so a Portal session can still be created for a former subscriber.';
```

- [ ] **Step 2: Apply locally and verify the columns exist**

Run: `cd supabase && supabase db push --local` (or against the linked dev project if no local Postgres is running — see `docs/superpowers/specs/2026-08-15-stripe-billing-integration-design.md`'s own migration-application history for why to always verify against the live policy afterward, not just the migration-history row).

Verify:

```sql
select column_name from information_schema.columns
 where table_name = 'plans' and column_name = 'stripe_price_id';
select column_name from information_schema.columns
 where table_name = 'subscriptions' and column_name = 'stripe_customer_id';
```

Expected: one row from each query.

- [ ] **Step 3: Regenerate generated types**

Run: `supabase gen types typescript --linked > src/types/database.types.ts`

Verify: `git diff src/types/database.types.ts` shows exactly two new fields added (`stripe_price_id` on `plans`' Row/Insert/Update, `stripe_customer_id` on `subscriptions`' Row/Insert/Update) and nothing else changed.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/0050_stripe_billing.sql src/types/database.types.ts
git commit -m "feat: add stripe_price_id and stripe_customer_id columns"
```

---

### Task 2: `_shared` Stripe client helper

**Files:**
- Create: `supabase/functions/_shared/stripe.ts`

**Interfaces:**
- Produces: `getStripeClient(): Stripe` — Tasks 3, 4, 5 all import this instead of each constructing their own `Stripe` instance.

- [ ] **Step 1: Write the helper**

```typescript
// _shared/stripe.ts. RotaFlow
//
// One Stripe client construction, shared by create-checkout-session,
// create-portal-session and stripe-webhook, so the API version and the
// missing-secret error message can't drift between the three.

import Stripe from 'npm:stripe@17';

export function getStripeClient(): Stripe {
  const key = Deno.env.get('STRIPE_SECRET_KEY');
  if (!key) {
    throw new Error('STRIPE_SECRET_KEY is not set');
  }
  return new Stripe(key, {
    apiVersion: '2024-06-20',
    httpClient: Stripe.createFetchHttpClient(),
  });
}
```

- [ ] **Step 2: Verify it imports cleanly**

Run: `deno check supabase/functions/_shared/stripe.ts` (from repo root; if `deno` isn't on `PATH`, install per Supabase CLI's own Deno bundling — every other function in this directory already assumes a working Deno toolchain, so this is environment setup, not new to this task).

Expected: no output (success). A missing-module or type error here is a real problem — fix before moving on, `npm:stripe@17`'s types must resolve under Deno's npm compat layer the same way `npm:@supabase/supabase-js@2` already does elsewhere in this directory.

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/_shared/stripe.ts
git commit -m "feat: add shared Stripe client helper for Edge Functions"
```

---

### Task 3: `create-checkout-session` Edge Function

**Files:**
- Create: `supabase/functions/create-checkout-session/index.ts`

**Interfaces:**
- Consumes: `getStripeClient()` (Task 2).
- Produces: `POST /functions/v1/create-checkout-session` — request body `{ orgId: string, planCode: string }`, response `{ url: string }` on success, `{ error: string }` with a 4xx/5xx status on failure. Task 6's client service calls this exact shape.

- [ ] **Step 1: Write the function**

```typescript
// create-checkout-session. RotaFlow
//
// Org owner picks a plan on Settings > Billing -> this creates a Stripe
// Checkout Session and returns its URL for a full-page redirect. No
// Stripe.js on the client: Checkout is entirely hosted by Stripe.
//
// Runs as the calling user (their JWT is forwarded into the Supabase
// client below, same pattern as ai-rota-assistant) so RLS scopes the
// plan lookup and the owner-role check queries memberships directly
// under that same RLS-scoped client — never service_role. Billing is
// owner-only, matching subscriptions' own RLS.
//
// Deploy: `supabase functions deploy create-checkout-session`.
// Secret: `supabase secrets set STRIPE_SECRET_KEY=...` (shared with the
// other two Stripe functions).

import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';
import { getStripeClient } from '../_shared/stripe.ts';

const ALLOW_HEADERS = 'authorization, x-client-info, apikey, content-type';
let requestCorsHeaders: Record<string, string> = {};

interface RequestBody {
  orgId: string;
  planCode: string;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...requestCorsHeaders, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req: Request) => {
  requestCorsHeaders = corsHeaders(req, ALLOW_HEADERS);

  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: requestCorsHeaders });
  }

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return jsonResponse({ error: 'Missing Authorization header' }, 401);
    }

    const { orgId, planCode } = (await req.json()) as RequestBody;
    if (!orgId || !planCode) {
      return jsonResponse({ error: 'orgId and planCode are required' }, 400);
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } },
    );

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return jsonResponse({ error: 'Not authenticated' }, 401);
    }

    const { data: membership, error: membershipError } = await supabase
      .from('memberships')
      .select('role')
      .eq('org_id', orgId)
      .eq('user_id', user.id)
      .maybeSingle();
    if (membershipError) throw membershipError;
    if (!membership || membership.role !== 'owner') {
      return jsonResponse(
        { error: 'Only the organisation owner can change billing' },
        403,
      );
    }

    const { data: plan, error: planError } = await supabase
      .from('plans')
      .select('code, name, stripe_price_id')
      .eq('code', planCode)
      .maybeSingle();
    if (planError) throw planError;
    if (!plan) {
      return jsonResponse({ error: `Unknown plan: ${planCode}` }, 400);
    }
    if (!plan.stripe_price_id) {
      return jsonResponse(
        { error: `${plan.name} is not available for checkout yet` },
        409,
      );
    }

    const { data: existingSub } = await supabase
      .from('subscriptions')
      .select('stripe_customer_id')
      .eq('org_id', orgId)
      .maybeSingle();

    const stripe = getStripeClient();
    const origin = req.headers.get('Origin') || 'https://rotaflow.space';

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      line_items: [{ price: plan.stripe_price_id, quantity: 1 }],
      customer: existingSub?.stripe_customer_id || undefined,
      client_reference_id: orgId,
      subscription_data: { metadata: { org_id: orgId, plan: planCode } },
      metadata: { org_id: orgId, plan: planCode },
      success_url: `${origin}/app/settings/billing?checkout=success`,
      cancel_url: `${origin}/app/settings/billing?checkout=cancelled`,
    });

    if (!session.url) {
      return jsonResponse({ error: 'Stripe did not return a checkout URL' }, 502);
    }

    return jsonResponse({ url: session.url });
  } catch (err) {
    console.error('create-checkout-session error:', err);
    return jsonResponse({ error: 'Unexpected error creating checkout session' }, 500);
  }
});
```

- [ ] **Step 2: Type-check**

Run: `deno check supabase/functions/create-checkout-session/index.ts`

Expected: no output.

- [ ] **Step 3: Deploy to the dev project and verify auth is enforced**

Run: `supabase functions deploy create-checkout-session --project-ref vwqqbdvlskngrqrejzxi`

Then, without an Authorization header:

```bash
curl -s -o /dev/null -w '%{http_code}\n' -X POST \
  "https://vwqqbdvlskngrqrejzxi.supabase.co/functions/v1/create-checkout-session" \
  -H "apikey: $VITE_SUPABASE_ANON_KEY" \
  -d '{"orgId":"00000000-0000-0000-0000-000000000000","planCode":"professional"}'
```

Expected: `401` — Supabase's own gateway rejects a missing JWT before this function's code even runs (this function is deployed with the default `verify_jwt: true`, unlike the webhook in Task 5).

Then with a real signed-in owner's session token (obtained via the app or `supabase.auth.signInWithPassword` in a scratch script) for an org whose plan has no `stripe_price_id` yet (true for every plan until Task 9):

Expected: `409` with `{"error":"<Plan name> is not available for checkout yet"}` — proves the owner-check and plan lookup both work end-to-end, ahead of Task 9 making a real checkout possible.

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/create-checkout-session/index.ts
git commit -m "feat: add create-checkout-session Edge Function"
```

---

### Task 4: `create-portal-session` Edge Function

**Files:**
- Create: `supabase/functions/create-portal-session/index.ts`

**Interfaces:**
- Consumes: `getStripeClient()` (Task 2).
- Produces: `POST /functions/v1/create-portal-session` — request body `{ orgId: string }`, response `{ url: string }` or `{ error: string }`. Task 6's client service calls this exact shape.

- [ ] **Step 1: Write the function**

```typescript
// create-portal-session. RotaFlow
//
// Org owner clicks "Manage billing" on Settings > Billing -> this opens
// Stripe's own hosted Customer Portal (invoices, card updates,
// cancellation all handled by Stripe, not built here — see the design
// spec's "Invoice history / payment method UI" decision).
//
// Same JWT-forwarding + owner-check pattern as create-checkout-session.
//
// Deploy: `supabase functions deploy create-portal-session`.
// Secret: shares STRIPE_SECRET_KEY with the other two Stripe functions.

import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';
import { getStripeClient } from '../_shared/stripe.ts';

const ALLOW_HEADERS = 'authorization, x-client-info, apikey, content-type';
let requestCorsHeaders: Record<string, string> = {};

interface RequestBody {
  orgId: string;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...requestCorsHeaders, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req: Request) => {
  requestCorsHeaders = corsHeaders(req, ALLOW_HEADERS);

  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: requestCorsHeaders });
  }

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return jsonResponse({ error: 'Missing Authorization header' }, 401);
    }

    const { orgId } = (await req.json()) as RequestBody;
    if (!orgId) {
      return jsonResponse({ error: 'orgId is required' }, 400);
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } },
    );

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return jsonResponse({ error: 'Not authenticated' }, 401);
    }

    const { data: membership, error: membershipError } = await supabase
      .from('memberships')
      .select('role')
      .eq('org_id', orgId)
      .eq('user_id', user.id)
      .maybeSingle();
    if (membershipError) throw membershipError;
    if (!membership || membership.role !== 'owner') {
      return jsonResponse(
        { error: 'Only the organisation owner can manage billing' },
        403,
      );
    }

    const { data: sub, error: subError } = await supabase
      .from('subscriptions')
      .select('stripe_customer_id')
      .eq('org_id', orgId)
      .maybeSingle();
    if (subError) throw subError;
    if (!sub?.stripe_customer_id) {
      return jsonResponse(
        { error: 'No billing account yet — choose a plan first' },
        404,
      );
    }

    const stripe = getStripeClient();
    const origin = req.headers.get('Origin') || 'https://rotaflow.space';

    const portalSession = await stripe.billingPortal.sessions.create({
      customer: sub.stripe_customer_id,
      return_url: `${origin}/app/settings/billing`,
    });

    return jsonResponse({ url: portalSession.url });
  } catch (err) {
    console.error('create-portal-session error:', err);
    return jsonResponse({ error: 'Unexpected error creating portal session' }, 500);
  }
});
```

- [ ] **Step 2: Type-check**

Run: `deno check supabase/functions/create-portal-session/index.ts`

Expected: no output.

- [ ] **Step 3: Deploy and verify the no-customer-yet path**

Run: `supabase functions deploy create-portal-session --project-ref vwqqbdvlskngrqrejzxi`

With a real owner session token, for an org with no `subscriptions` row yet (true for every org until Task 3's checkout flow is fully wired via Task 9):

Expected: `404` with `{"error":"No billing account yet — choose a plan first"}`.

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/create-portal-session/index.ts
git commit -m "feat: add create-portal-session Edge Function"
```

---

### Task 5: `stripe-webhook` Edge Function

**Files:**
- Create: `supabase/functions/stripe-webhook/index.ts`

**Interfaces:**
- Consumes: `getStripeClient()` (Task 2).
- Produces: `POST /functions/v1/stripe-webhook` — no meaningful response body consumed by anything (Stripe only checks the status code), always `200` once the event is handled or deliberately ignored, non-`200` only on a real failure so Stripe retries.

- [ ] **Step 1: Write the function**

```typescript
// stripe-webhook. RotaFlow
//
// Stripe calls this directly on subscription/invoice lifecycle events.
// Auth is Stripe's own request signature (STRIPE_WEBHOOK_SECRET), exactly
// like inngest's own signing-key check — there is no end-user session for
// a provider webhook to forward, so this is deployed --no-verify-jwt and
// uses service_role, the one function in this feature allowed to.
//
// Every write is an upsert keyed on Stripe's own id (provider_ref),
// because Stripe's delivery is documented at-least-once: a naive insert
// would create duplicate subscriptions/invoices on a retry.
//
// invoice.paid/invoice.payment_failed write into the SAME invoices table
// (0023_commercials.sql) that issue_invoice()/set_invoice_status() write
// manually for platform-finance-issued invoices. This is a second,
// automated writer into that table, not a replacement for the manual path
// (still used for off-Stripe deals).
//
// Deploy: `supabase functions deploy stripe-webhook --no-verify-jwt`.
// Secrets: STRIPE_SECRET_KEY (shared), STRIPE_WEBHOOK_SECRET (from the
// Stripe dashboard's webhook endpoint config, or `stripe listen`'s own
// printed secret for local testing).
//
// After deploying: Stripe dashboard -> Developers -> Webhooks -> Add
// endpoint, pointed at <SUPABASE_URL>/functions/v1/stripe-webhook,
// subscribed to: checkout.session.completed, customer.subscription.updated,
// customer.subscription.deleted, invoice.paid, invoice.payment_failed.

import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'npm:@supabase/supabase-js@2';
import { getStripeClient } from '../_shared/stripe.ts';
import type Stripe from 'npm:stripe@17';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

async function handleCheckoutCompleted(
  supabase: ReturnType<typeof createClient>,
  session: Stripe.Checkout.Session,
): Promise<void> {
  const orgId = session.metadata?.org_id;
  const plan = session.metadata?.plan;
  if (!orgId || !plan) {
    console.error('checkout.session.completed missing org_id/plan metadata', session.id);
    return;
  }

  const stripe = getStripeClient();
  const subscriptionId =
    typeof session.subscription === 'string'
      ? session.subscription
      : session.subscription?.id;
  if (!subscriptionId) return;

  const subscription = await stripe.subscriptions.retrieve(subscriptionId);

  const { error } = await supabase
    .from('subscriptions')
    .upsert(
      {
        org_id: orgId,
        plan,
        status: subscription.status === 'active' ? 'active' : subscription.status,
        provider: 'stripe',
        provider_ref: subscription.id,
        stripe_customer_id:
          typeof session.customer === 'string' ? session.customer : session.customer?.id,
        started_at: new Date(subscription.start_date * 1000).toISOString(),
        current_period_end: new Date(
          subscription.current_period_end * 1000,
        ).toISOString(),
      },
      { onConflict: 'org_id' },
    );
  if (error) console.error('subscriptions upsert failed', error);
}

async function handleSubscriptionUpdated(
  supabase: ReturnType<typeof createClient>,
  subscription: Stripe.Subscription,
): Promise<void> {
  const orgId = subscription.metadata?.org_id;
  if (!orgId) {
    console.error('customer.subscription.updated missing org_id metadata', subscription.id);
    return;
  }

  const { error } = await supabase
    .from('subscriptions')
    .update({
      status: subscription.status,
      current_period_end: new Date(
        subscription.current_period_end * 1000,
      ).toISOString(),
      canceled_at: subscription.canceled_at
        ? new Date(subscription.canceled_at * 1000).toISOString()
        : null,
    })
    .eq('org_id', orgId)
    .eq('provider_ref', subscription.id);
  if (error) console.error('subscriptions update failed', error);
}

async function handleSubscriptionDeleted(
  supabase: ReturnType<typeof createClient>,
  subscription: Stripe.Subscription,
): Promise<void> {
  const orgId = subscription.metadata?.org_id;
  if (!orgId) return;

  const { error } = await supabase
    .from('subscriptions')
    .update({
      status: 'canceled',
      canceled_at: new Date().toISOString(),
    })
    .eq('org_id', orgId)
    .eq('provider_ref', subscription.id);
  if (error) console.error('subscriptions cancel failed', error);
}

function invoiceNumberFrom(invoice: Stripe.Invoice): string {
  // Stripe's own invoice number if set, else fall back to its id — either
  // way this only has to be unique, `invoices.number` has no format check.
  return invoice.number || invoice.id;
}

async function handleInvoicePaid(
  supabase: ReturnType<typeof createClient>,
  invoice: Stripe.Invoice,
): Promise<void> {
  const orgId = invoice.subscription_details?.metadata?.org_id;
  if (!orgId) {
    console.error('invoice.paid missing org_id metadata', invoice.id);
    return;
  }

  const line = invoice.lines.data[0];
  const periodStart = new Date(
    (line?.period.start ?? invoice.period_start) * 1000,
  );
  const periodEnd = new Date((line?.period.end ?? invoice.period_end) * 1000);

  const { error } = await supabase
    .from('invoices')
    .upsert(
      {
        org_id: orgId,
        number: invoiceNumberFrom(invoice),
        period_start: periodStart.toISOString().slice(0, 10),
        period_end: periodEnd.toISOString().slice(0, 10),
        amount_pence: invoice.amount_paid,
        currency: invoice.currency.toUpperCase(),
        status: 'paid',
        issued_on: new Date(invoice.created * 1000).toISOString().slice(0, 10),
        due_on: invoice.due_date
          ? new Date(invoice.due_date * 1000).toISOString().slice(0, 10)
          : new Date(invoice.created * 1000).toISOString().slice(0, 10),
        paid_at: new Date().toISOString(),
        provider: 'stripe',
        provider_ref: invoice.id,
      },
      { onConflict: 'provider_ref' },
    );
  if (error) console.error('invoices upsert (paid) failed', error);
}

async function handleInvoicePaymentFailed(
  supabase: ReturnType<typeof createClient>,
  invoice: Stripe.Invoice,
): Promise<void> {
  const orgId = invoice.subscription_details?.metadata?.org_id;
  if (!orgId) return;

  const failureReason =
    invoice.last_finalization_error?.message || 'Payment failed';

  const { data: existing } = await supabase
    .from('invoices')
    .select('id, attempts')
    .eq('provider_ref', invoice.id)
    .maybeSingle();

  if (existing) {
    const { error } = await supabase
      .from('invoices')
      .update({
        status: 'past_due',
        failure_reason: failureReason,
        attempts: (existing.attempts ?? 0) + 1,
      })
      .eq('id', existing.id);
    if (error) console.error('invoices update (past_due) failed', error);
  } else {
    const line = invoice.lines.data[0];
    const periodStart = new Date(
      (line?.period.start ?? invoice.period_start) * 1000,
    );
    const periodEnd = new Date((line?.period.end ?? invoice.period_end) * 1000);
    const { error } = await supabase.from('invoices').insert({
      org_id: orgId,
      number: invoiceNumberFrom(invoice),
      period_start: periodStart.toISOString().slice(0, 10),
      period_end: periodEnd.toISOString().slice(0, 10),
      amount_pence: invoice.amount_due,
      currency: invoice.currency.toUpperCase(),
      status: 'past_due',
      issued_on: new Date(invoice.created * 1000).toISOString().slice(0, 10),
      due_on: invoice.due_date
        ? new Date(invoice.due_date * 1000).toISOString().slice(0, 10)
        : new Date(invoice.created * 1000).toISOString().slice(0, 10),
      failure_reason: failureReason,
      attempts: 1,
      provider: 'stripe',
      provider_ref: invoice.id,
    });
    if (error) console.error('invoices insert (past_due) failed', error);
  }

  const { error: subError } = await supabase
    .from('subscriptions')
    .update({ status: 'past_due' })
    .eq('org_id', orgId);
  if (subError) console.error('subscriptions update (past_due) failed', subError);
}

Deno.serve(async (req: Request) => {
  const signature = req.headers.get('stripe-signature');
  if (!signature) {
    return jsonResponse({ error: 'Missing stripe-signature header' }, 400);
  }

  const webhookSecret = Deno.env.get('STRIPE_WEBHOOK_SECRET');
  if (!webhookSecret) {
    console.error('STRIPE_WEBHOOK_SECRET is not set');
    return jsonResponse({ error: 'Webhook not configured' }, 500);
  }

  const body = await req.text();
  const stripe = getStripeClient();

  let event: Stripe.Event;
  try {
    // constructEventAsync, not constructEvent: Deno's Web Crypto API is
    // async, unlike Node's, and Stripe's SDK provides this variant
    // specifically for edge runtimes.
    event = await stripe.webhooks.constructEventAsync(body, signature, webhookSecret);
  } catch (err) {
    console.error('Stripe signature verification failed:', err);
    return jsonResponse({ error: 'Invalid signature' }, 400);
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  try {
    switch (event.type) {
      case 'checkout.session.completed':
        await handleCheckoutCompleted(
          supabase,
          event.data.object as Stripe.Checkout.Session,
        );
        break;
      case 'customer.subscription.updated':
        await handleSubscriptionUpdated(
          supabase,
          event.data.object as Stripe.Subscription,
        );
        break;
      case 'customer.subscription.deleted':
        await handleSubscriptionDeleted(
          supabase,
          event.data.object as Stripe.Subscription,
        );
        break;
      case 'invoice.paid':
        await handleInvoicePaid(supabase, event.data.object as Stripe.Invoice);
        break;
      case 'invoice.payment_failed':
        await handleInvoicePaymentFailed(
          supabase,
          event.data.object as Stripe.Invoice,
        );
        break;
      default:
        // Unhandled event types are expected — Stripe's default webhook
        // config sends more than this function subscribes to handling.
        break;
    }
    return jsonResponse({ received: true });
  } catch (err) {
    console.error(`stripe-webhook handler error for ${event.type}:`, err);
    // Non-200 so Stripe retries — this is a real failure, not a signature
    // problem, and retry is the correct behaviour for a transient DB error.
    return jsonResponse({ error: 'Handler error' }, 500);
  }
});
```

- [ ] **Step 2: Type-check**

Run: `deno check supabase/functions/stripe-webhook/index.ts`

Expected: no output.

- [ ] **Step 3: Deploy with the correct flag and verify signature enforcement**

Run: `supabase functions deploy stripe-webhook --no-verify-jwt --project-ref vwqqbdvlskngrqrejzxi`

Then, an unsigned POST:

```bash
curl -s -o /dev/null -w '%{http_code}\n' -X POST \
  "https://vwqqbdvlskngrqrejzxi.supabase.co/functions/v1/stripe-webhook" \
  -d '{"type":"checkout.session.completed"}'
```

Expected: `400` (this function's own signature check, not Supabase's gateway — confirms `--no-verify-jwt` deployed correctly, mirroring how `inngest`'s own status page documents verifying the same distinction).

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/stripe-webhook/index.ts
git commit -m "feat: add stripe-webhook Edge Function"
```

---

### Task 6: Client billing service

**Files:**
- Create: `src/services/billingCheckoutService.ts`

**Interfaces:**
- Consumes: `supabase.functions.invoke` (existing client, `@/lib/supabase`), `plans` table (Task 1's `stripe_price_id` column).
- Produces: `listPlans(): Promise<Plan[]>`, `startCheckout(orgId: string, planCode: string): Promise<void>`, `openBillingPortal(orgId: string): Promise<void>` — Task 7's page imports these three by name.

- [ ] **Step 1: Write the service**

```typescript
import { supabase } from '@/lib/supabase';
import type { Tables } from '@/types/database.types';

export type Plan = Tables<'plans'>;

/**
 * The price list, in display order. RLS allows any signed-in user to read
 * it (0023) — an upgrade screen has to be able to say what the next plan
 * costs before the caller is confirmed as this org's owner.
 */
export async function listPlans(): Promise<Plan[]> {
  const { data, error } = await supabase
    .from('plans')
    .select('*')
    .order('sort_order');
  if (error) throw error;
  return data ?? [];
}

/**
 * Starts a Stripe Checkout for the given plan and redirects the whole page
 * to it — there is no in-app checkout UI, Stripe hosts it entirely.
 */
export async function startCheckout(orgId: string, planCode: string): Promise<void> {
  const result = await supabase.functions.invoke<{ url: string; error?: string }>(
    'create-checkout-session',
    { body: { orgId, planCode } },
  );
  if (result.error) throw result.error;
  if (!result.data?.url) {
    throw new Error(result.data?.error || 'Could not start checkout');
  }
  window.location.href = result.data.url;
}

/**
 * Opens Stripe's hosted Customer Portal for invoices, payment method
 * updates and cancellation. Redirects the whole page, same as checkout.
 */
export async function openBillingPortal(orgId: string): Promise<void> {
  const result = await supabase.functions.invoke<{ url: string; error?: string }>(
    'create-portal-session',
    { body: { orgId } },
  );
  if (result.error) throw result.error;
  if (!result.data?.url) {
    throw new Error(result.data?.error || 'Could not open billing portal');
  }
  window.location.href = result.data.url;
}
```

- [ ] **Step 2: Type-check**

Run: `npm run typecheck`

Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add src/services/billingCheckoutService.ts
git commit -m "feat: add client billing service for checkout and portal"
```

---

### Task 7: Wire `SettingsBillingPage.tsx`'s Payment section

**Files:**
- Modify: `src/pages/app/settings/SettingsBillingPage.tsx`

**Interfaces:**
- Consumes: `listPlans`, `startCheckout`, `openBillingPortal` (Task 6), existing `getSubscription` (unchanged), existing `PLAN_NAMES` map (extended).

- [ ] **Step 1: Add the `'enterprise'` key to `PLAN_NAMES`**

In the existing map (currently `starter`/`professional`/`business` only):

```typescript
const PLAN_NAMES: Record<string, string> = {
  starter: 'Starter',
  professional: 'Professional',
  business: 'Business',
  enterprise: 'Enterprise',
};
```

- [ ] **Step 2: Load plans alongside the existing subscription fetch**

In the existing `useEffect`, add `listPlans()` to the `Promise.all` and a new `plans` state:

```typescript
const [plans, setPlans] = useState<Plan[]>([]);
// ...inside the existing Promise.all, alongside sub/staff/sites/org:
const [sub, staff, sites, org, planList] = await Promise.all([
  getSubscription(orgId),
  listStaff(orgId).catch(() => null),
  listLocations(orgId).catch(() => null),
  getOrganisation(orgId).catch(() => null),
  listPlans().catch(() => []),
]);
// ...alongside the existing setSubscription/setStaffCount/etc:
setPlans(planList);
```

Add the import: `import { listPlans, startCheckout, openBillingPortal, type Plan } from '@/services/billingCheckoutService';`

- [ ] **Step 3: Add checkout/portal handlers with loading and error state**

```typescript
const [actionPending, setActionPending] = useState<string | null>(null);

async function handleUpgrade(planCode: string): Promise<void> {
  if (!orgId) return;
  setActionPending(planCode);
  try {
    await startCheckout(orgId, planCode);
  } catch (err) {
    reportError(err, { area: 'settings-billing:checkout' });
    showError('Could not start checkout. Please try again.');
    setActionPending(null);
  }
}

async function handleManageBilling(): Promise<void> {
  if (!orgId) return;
  setActionPending('manage');
  try {
    await openBillingPortal(orgId);
  } catch (err) {
    reportError(err, { area: 'settings-billing:portal' });
    showError('Could not open the billing portal. Please try again.');
    setActionPending(null);
  }
}
```

(`setActionPending(null)` is deliberately omitted from the success path — the browser is about to navigate away entirely, `window.location.href` in Task 6's service; resetting the pending state right before an unload is dead code, not a bug.)

- [ ] **Step 4: Replace the "Payment" `SettingsSection`'s body**

Replace lines 177–196 (the static "Billing is not connected yet" block) with a conditional render: if `subscription` exists, one "Manage billing" button; otherwise, the plan list with an "Upgrade" button per plan.

```tsx
<SettingsSection title="Payment">
  {subscription ? (
    <div className="flex items-center justify-between gap-4">
      <p className="text-sm text-content-muted dark:text-content-muted-dark">
        Manage your payment method, view invoices or cancel from Stripe's
        secure billing portal.
      </p>
      <Button
        variant="secondary"
        onClick={handleManageBilling}
        disabled={actionPending === 'manage'}
      >
        {actionPending === 'manage' ? 'Opening…' : 'Manage billing'}
      </Button>
    </div>
  ) : (
    <div className="space-y-3">
      <p className="text-sm text-content-muted dark:text-content-muted-dark">
        Choose a plan to add a payment method and activate billing for this
        organisation.
      </p>
      {plans.map((p) => (
        <div
          key={p.code}
          className="flex items-center justify-between gap-4 rounded-xl border border-divider p-4 dark:border-divider-dark"
        >
          <div>
            <p className="font-medium text-content dark:text-content-dark">
              {p.name}
            </p>
            <p className="text-sm text-content-muted dark:text-content-muted-dark">
              £{(p.monthly_price_pence / 100).toFixed(2)} / month
            </p>
          </div>
          <Button
            variant="primary"
            size="sm"
            onClick={() => handleUpgrade(p.code)}
            disabled={actionPending === p.code}
          >
            {actionPending === p.code ? 'Redirecting…' : 'Upgrade'}
          </Button>
        </div>
      ))}
    </div>
  )}
</SettingsSection>
```

Add the import: `import { Button } from '@/components/ui/Button';` (the `CreditCard` icon import from the old stub is no longer used — remove it, or keep it only if it's reused elsewhere in the render; check before deleting).

- [ ] **Step 5: Type-check and manual browser verification**

Run: `npm run typecheck`

Expected: no new errors.

Then, with the dev server running (`npm run dev`), sign in as an org owner and open `/app/settings/billing`:
- Expected (before Task 9 populates real Stripe Price IDs): the plan list renders with real prices from `plans`, clicking "Upgrade" shows "Redirecting…" briefly then an error toast "Could not start checkout" (the `create-checkout-session` function correctly 409s — verified in Task 3 — because no plan has a `stripe_price_id` yet). This is the expected state until Task 9.
- Sign in as a non-owner (manager/staff): confirm the existing `role !== 'owner'` guard at the top of the component still renders `OwnerOnlyNotice` before any of this new code runs — unchanged behaviour, just confirming the new code didn't accidentally move past that guard.

- [ ] **Step 6: Commit**

```bash
git add src/pages/app/settings/SettingsBillingPage.tsx
git commit -m "feat: wire real checkout and billing portal into Settings > Billing"
```

---

### Task 8: Correct stale billing copy

**Files:**
- Modify: `src/lib/marketing.ts`
- Modify: `src/pages/PricingPage.tsx`
- Modify: `docs/SCHEMA.md`

**Interfaces:**
- None — copy-only changes, no new exports or signatures.

- [ ] **Step 1: Rewrite `marketing.ts`'s `PLANS` array to the real 4-tier pricing**

Replace the existing 3-entry array (Starter/Team/Enterprise, per-seat) with 4 entries matching `0023_commercials.sql`'s seeded prices exactly. This intentionally duplicates the numbers from the migration rather than fetching `plans` at runtime — `PricingPage.tsx` is a pre-signup, unauthenticated marketing page rendered outside any org context, and `plans`' RLS (Task-1-unrelated, from 0023) requires `auth.uid() is not null`; fetching it there would need either a public-read carve-out to `plans` (a real RLS change, out of scope here) or an unauthenticated edge function, both bigger than this task. Hardcode with a comment pointing at the source of truth, matching how the design spec's "Marketing copy" section flagged this as an accepted, documented seam:

```typescript
/**
 * Pricing.
 *
 * Mirrors supabase/migrations/0023_commercials.sql's seeded `plans` rows
 * exactly — that table, not this array, is what checkout actually charges.
 * If these ever disagree, the migration is right and this needs updating,
 * not the other way round. Not fetched at runtime: this page is
 * unauthenticated and `plans`' RLS requires a signed-in user (0023).
 */
export const PLANS: readonly Plan[] = [
  {
    name: 'Starter',
    price: '£29',
    cadence: 'per month',
    summary: 'One site, up to 15 staff.',
    features: [
      'One location',
      'Up to 15 staff',
      'Rota builder and published schedules',
      'Leave requests and shift swaps',
      'GPS clock-in with offline queue',
      'CSV export',
    ],
    cta: PRIMARY_CTA,
  },
  {
    name: 'Professional',
    price: '£129',
    cadence: 'per month',
    summary: 'Up to five sites and 60 staff.',
    features: [
      'Everything in Starter',
      'Up to five locations',
      'Up to 60 staff',
      'Availability collection',
      'Timesheets and payroll export',
      'Reports across every site',
      'Announcements',
    ],
    cta: PRIMARY_CTA,
    featured: true,
  },
  {
    name: 'Business',
    price: '£299',
    cadence: 'per month',
    summary: 'Up to twenty sites and 200 staff.',
    features: [
      'Everything in Professional',
      'Up to twenty locations',
      'Up to 200 staff',
      'Custom role labels and permissions',
      'Audit trail and retention policy',
      'Email support',
    ],
    cta: PRIMARY_CTA,
  },
  {
    name: 'Enterprise',
    price: '£790',
    cadence: 'per month',
    summary: 'Unlimited sites and staff, with SSO.',
    features: [
      'Everything in Business',
      'Unlimited locations and staff',
      'SSO with Microsoft 365 or Google',
      'Payroll and HR integrations',
      'Onboarding and migration support',
    ],
    cta: PRIMARY_CTA,
  },
] as const;
```

Remove the old file-level comment above `PLANS` that said "No payment provider is integrated... every plan routes to /signup" — no longer true. Keep `PRIMARY_CTA` routing to `/signup` as-is (Task 9's note below covers why: an anonymous visitor has no `orgId` to check out with yet — checkout only makes sense from inside Settings > Billing, after an org exists).

- [ ] **Step 2: Update `PricingPage.tsx`'s banner and FAQ copy**

Replace the `role="note"` block (lines 60–70) — currently "Billing is not live yet... has no payment provider connected... nothing can be charged" — with:

```tsx
<div
  role="note"
  className="mx-auto mb-12 flex max-w-3xl gap-3 rounded-2xl border border-info/30 bg-info/5 p-4"
>
  <Info size={20} aria-hidden="true" className="mt-0.5 shrink-0 text-info" />
  <p className="text-sm leading-relaxed text-content dark:text-content-dark">
    <span className="font-semibold">No card required to sign up.</span> Signing
    up collects no payment details. You choose and pay for a plan afterwards,
    from your organisation's own Settings once it exists.
  </p>
</div>
```

Replace the `How does billing work during the beta?` FAQ entry's answer:

```typescript
{
  q: 'How does billing work?',
  a: 'Sign up with no card required. Once your organisation exists, its owner picks a plan from Settings and pays through Stripe’s secure checkout. Nothing is charged before that.',
},
```

Replace the `What happens at the end of the trial?` FAQ entry (there is no trial — trial-on-signup is explicitly out of scope for this feature, per the design spec) with a question about changing plans instead, since "Can we move between plans?" already exists right after it and would otherwise be the only plan-change answer — keep both, don't duplicate:

```typescript
{
  q: 'Is there a free trial?',
  a: 'Not yet — every plan is paid from the start. Create your organisation and explore it fully before choosing a plan; nothing is charged until you do.',
},
```

- [ ] **Step 3: Correct `docs/SCHEMA.md`**

Find the line (search `grep -n "pluggable" docs/SCHEMA.md`):

> `subscriptions` | ... | Billing seam. Provider is pluggable (Apple Pay / Google Pay / PayPal); charging is built last.

Replace with:

> `subscriptions` | ... | Billing seam, now wired to Stripe (`0050_stripe_billing.sql`, `supabase/functions/stripe-webhook`). `plans.stripe_price_id` maps each tier to its Stripe Price.

- [ ] **Step 4: Verify and commit**

Run: `npm run typecheck && npm run lint`

Expected: no new errors (this task is copy-only, but `marketing.ts`'s `Plan` type still needs every field present — a missing field is a real type error, not a lint nit).

```bash
git add src/lib/marketing.ts src/pages/PricingPage.tsx docs/SCHEMA.md
git commit -m "docs: correct billing copy now that Stripe is wired in"
```

---

### Task 9: Create Stripe Products/Prices and backfill `stripe_price_id`

This task is partly outside the codebase — it's the point where the user's own Stripe dashboard access is required, per the spec's "Stripe account exists, no Products/Prices yet" starting point. Written out fully rather than left as "TBD" because every other task depends on it being done correctly.

**Files:**
- None created — a data-only `UPDATE`, not a schema migration (the column already exists from Task 1).

- [ ] **Step 1: Create 4 Products in Stripe (test mode)**

In the Stripe dashboard, test mode, Products -> Add product, once per plan, each with one recurring monthly Price in GBP:

| Plan | Product name | Price |
|---|---|---|
| `starter` | RotaFlow Starter | £29.00 / month |
| `professional` | RotaFlow Professional | £129.00 / month |
| `business` | RotaFlow Business | £299.00 / month |
| `enterprise` | RotaFlow Enterprise | £790.00 / month |

Copy each Price's id (starts `price_...`, not the Product id which starts `prod_...`).

- [ ] **Step 2: Backfill `stripe_price_id`**

Using the Management API pattern already established for this project (`docs/superpowers/specs/2026-08-15-stripe-billing-integration-design.md`'s own creation used `security find-generic-password -s "Supabase CLI" -w` for the token — reuse that, do not paste the token into a script file):

```bash
TOKEN=$(security find-generic-password -s "Supabase CLI" -w)
curl -s -X POST "https://api.supabase.com/v1/projects/vwqqbdvlskngrqrejzxi/database/query" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -H "User-Agent: rotaflow-billing-setup/1.0" \
  --data-binary '{"query": "update public.plans set stripe_price_id = '"'"'price_STARTER_ID_HERE'"'"' where code = '"'"'starter'"'"'; update public.plans set stripe_price_id = '"'"'price_PROFESSIONAL_ID_HERE'"'"' where code = '"'"'professional'"'"'; update public.plans set stripe_price_id = '"'"'price_BUSINESS_ID_HERE'"'"' where code = '"'"'business'"'"'; update public.plans set stripe_price_id = '"'"'price_ENTERPRISE_ID_HERE'"'"' where code = '"'"'enterprise'"'"';"}'
```

Replace each `price_..._ID_HERE` with the real id copied in Step 1.

- [ ] **Step 3: Set the two Edge Function secrets**

```bash
supabase secrets set STRIPE_SECRET_KEY=sk_test_... --project-ref vwqqbdvlskngrqrejzxi
```

`STRIPE_WEBHOOK_SECRET` comes from the webhook endpoint's own config — see Task 10, Step 1, which creates that endpoint and its secret together (setting it here first would be a value with nothing to verify against yet).

- [ ] **Step 4: Verify the backfill**

```bash
TOKEN=$(security find-generic-password -s "Supabase CLI" -w)
curl -s -X POST "https://api.supabase.com/v1/projects/vwqqbdvlskngrqrejzxi/database/query" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -H "User-Agent: rotaflow-billing-setup/1.0" \
  --data-binary '{"query": "select code, stripe_price_id from public.plans order by sort_order;"}'
```

Expected: all 4 rows have a non-null `stripe_price_id` starting `price_`.

---

### Task 10: End-to-end verification

**Files:**
- None — this task is entirely manual verification, matching the spec's own "Testing" section.

- [ ] **Step 1: Create the Stripe webhook endpoint and set its secret**

Local: `stripe listen --forward-to https://vwqqbdvlskngrqrejzxi.supabase.co/functions/v1/stripe-webhook` — the CLI prints a `whsec_...` value; run `supabase secrets set STRIPE_WEBHOOK_SECRET=whsec_... --project-ref vwqqbdvlskngrqrejzxi` with it.

(For a persistent, non-CLI-session-dependent endpoint later: Stripe dashboard -> Developers -> Webhooks -> Add endpoint, URL `https://vwqqbdvlskngrqrejzxi.supabase.co/functions/v1/stripe-webhook`, events `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.paid`, `invoice.payment_failed` — that endpoint has its own separate `whsec_...`, re-run the `secrets set` command with that value instead once ready to stop relying on `stripe listen`.)

- [ ] **Step 2: Run a full checkout in Stripe test mode**

With the dev server running and signed in as a real org owner (an org with no existing subscription), go to Settings > Billing, click "Upgrade" on Professional, complete Stripe's hosted Checkout with test card `4242 4242 4242 4242`, any future expiry, any CVC.

Expected: redirected back to `/app/settings/billing?checkout=success`.

- [ ] **Step 3: Verify the subscription row**

```bash
TOKEN=$(security find-generic-password -s "Supabase CLI" -w)
curl -s -X POST "https://api.supabase.com/v1/projects/vwqqbdvlskngrqrejzxi/database/query" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -H "User-Agent: rotaflow-billing-setup/1.0" \
  --data-binary '{"query": "select org_id, plan, status, provider, provider_ref, stripe_customer_id from public.subscriptions where org_id = '"'"'<your test org id>'"'"';"}'
```

Expected: one row, `plan='professional'`, `status='active'`, `provider='stripe'`, `provider_ref` and `stripe_customer_id` both populated with real Stripe ids.

- [ ] **Step 4: Verify the `invoices` row from the real first invoice**

Correction (final whole-branch review, 2026-08-15): `stripe trigger invoice.paid` creates a
**standalone, non-subscription invoice fixture** — `invoice.subscription_details` is `null`
on it, so `handleInvoicePaid` correctly logs "missing org_id metadata" and writes nothing.
That is the handler working as designed, not a bug; don't debug it as one. A `mode:
'subscription'` Checkout already generates a real `invoice.paid` event for the first billing
period as part of completing Step 2 — no separate trigger is needed.

Query `public.invoices` for the `org_id` used in Step 2 (same pattern as Step 3):

```bash
TOKEN=$(security find-generic-password -s "Supabase CLI" -w)
curl -s -X POST "https://api.supabase.com/v1/projects/vwqqbdvlskngrqrejzxi/database/query" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -H "User-Agent: rotaflow-billing-setup/1.0" \
  --data-binary '{"query": "select org_id, status, provider, provider_ref, amount_pence from public.invoices where org_id = '"'"'<your test org id>'"'"';"}'
```

Expected: one row already present from Step 2's checkout, `status='paid'`, `provider='stripe'`,
`amount_pence` matching the plan's price. If it's missing, check the `stripe listen`/webhook
endpoint logs from Step 1 — the more likely cause is a delivery/signature issue during
Step 2, not this step itself.

- [ ] **Step 5: Verify the Platform Console reflects it**

Sign in as a platform admin, open `/admin/billing`. Expected: the MRR figure and revenue-by-plan breakdown now include this test subscription — confirms `subscription_mrr_pence()` and the existing Platform Console UI, unmodified by this feature, correctly pick up real data the moment it exists.

- [ ] **Step 6: Verify the Portal**

Back on Settings > Billing as the same org owner (now with an active subscription), click "Manage billing". Expected: redirected to Stripe's hosted Customer Portal, showing the same subscription and the test invoice from Step 4.

- [ ] **Step 7: Verify payment-failure handling**

Correction (final whole-branch review, 2026-08-15): same issue as Step 4 —
`stripe trigger invoice.payment_failed` is a standalone fixture with no
`subscription_details`, so it won't exercise the org-scoped write path. Use a
real subscription renewal failure instead, via a Stripe test clock attached to
a *new* test subscription (advancing the clock past the current period_end is
what generates a real `invoice.payment_failed` tied to that subscription):

```bash
# Create a test clock a few minutes in the future, then a customer on it
stripe test_helpers test_clocks create --frozen-time "$(date +%s)"
# note the returned clock id (clock_...), then repeat Step 2's checkout for a
# NEW test org, using card 4000 0000 0000 0341 (attaches successfully, then
# fails on the next charge) instead of 4242...
# advance the clock past the subscription's current_period_end:
stripe test_helpers test_clocks advance --clock <clock_id> --frozen-time "$(date -v+35d +%s)"  # macOS date; use `date -d '+35 days' +%s` on Linux
```

Query `public.invoices` and `public.subscriptions` for that second test org.

Expected: the invoice's `status='past_due'` with a non-null, real
`failure_reason` (a card-decline message, not the literal string "Payment
failed" — if it IS that literal string, `handleInvoicePaymentFailed`'s
`payment_intent`-expansion fix from the final review's fix wave didn't take;
check `supabase/functions/stripe-webhook/index.ts` retrieves
`invoice.payment_intent.last_payment_error.message`, not only
`invoice.last_finalization_error?.message`), and the subscription's
`status='past_due'`.

- [ ] **Step 8: Final commit — mark the plan complete**

No code changes in this task; if any verification step surfaced a real bug, fix it in the relevant task's file, re-run that task's own verification, then re-run this task's steps from the point affected. Once all 7 verifications above pass, the feature is done — no separate commit needed for this task itself.
