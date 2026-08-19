# Admin-assisted organisation creation — design spec

Status: approved by user 2026-08-19, pending implementation plan.

## Context

Today the only way an organisation comes into existence is self-serve
signup (`createOrganisation` in `orgService.ts`, called by the `auth.uid()
= created_by`-gated `organisations_insert` policy, `0002`). There is no
path for a platform admin to create an organisation on behalf of a
prospect who contacted sales/support directly (the "Book a demo" /
"Contact us" CTAs already on the marketing site route to `/contact`, not
to any actual provisioning flow).

## Decisions made during brainstorming (with the user, 2026-08-19)

| Question | Decision |
|---|---|
| Who becomes the org's owner | Nobody, until the real contact accepts an invite — reuses the existing `invites`/`accept_invite()` flow. The platform admin never holds owner rights, not even briefly. |
| What the admin configures at creation time | Plan tier + an optional negotiated price override (`subscriptions.price_pence`, which already exists for exactly this — `0023`'s own comment: "A subscription may override the price; the plan is what the plan costs"). Not locations, staff, or org profile fields — those stay the real owner's job, same as any other org's onboarding. |
| `create_invite()`'s bootstrap gap | It requires the caller to already hold `owner`/`manager` in the target org (and specifically `owner` to invite another `owner`) — impossible for a platform admin in a brand-new, member-less org. Fix: narrow bootstrap exception, `is_platform_admin() AND p_role='owner' AND no memberships exist yet for that org` — mirrors the exact pattern already used for org-creation's own RLS bootstrap (`0005`/`0048`), closes the instant the invite is accepted. |
| `on_org_created` trigger auto-grants ownership to the creator | Conflicts with "nobody holds owner rights, not even briefly." Fix: one new SECURITY DEFINER RPC that inserts the org, immediately removes the trigger's auto-granted membership within the same function call (never observed by any client/session), then creates the subscription and the owner invite — all in one transaction. |

## Scope

**In scope:** one new RPC, one new Platform Console screen (or modal — see
Components) for a platform admin to create an org this way, the
`create_invite()` bootstrap fix.

**Explicitly out of scope:** locations/departments/staff seeding, org
profile fields (industry/country/timezone), anything about the *existing*
self-serve signup path (untouched), and the billing/revenue *display* work
covered by the separate `2026-08-19-admin-billing-real-data-design.md`
spec — though this RPC creates real `subscriptions` rows that spec's MRR
calculations will pick up automatically once both ship.

## Architecture

### New migration: `supabase/migrations/00XX_admin_assisted_org_creation.sql`
(exact number: next free after whatever the billing spec's `set_org_status`
migration claims — implementer resolves the actual sequence at
implementation time, these two specs' migrations are independent of each
other and can land in either order)

Two changes:

1. **`create_invite()`'s permission check** (`0006`) — both gates need the
   bootstrap alternative, not just the first one, or the function accepts
   the platform admin past the first check and then rejects them at the
   second ("only an owner may hand out ownership"). Full corrected body of
   the two checks (everything else in the function is unchanged):

```sql
  -- SECURITY DEFINER bypasses RLS, so the role check must be explicit here.
  if not (
    public.has_org_role(p_org, array['owner','manager'])
    or (
      public.is_platform_admin()
      and p_role = 'owner'
      and not exists (select 1 from public.memberships m where m.org_id = p_org)
    )
  ) then
    raise exception 'Only owners and managers can invite people'
      using errcode = '42501';
  end if;

  -- Only an owner may hand out ownership — the bootstrap case is a platform
  -- admin inviting the very first owner into a genuinely ownerless org,
  -- which is exactly the case above already validated; no separate owner
  -- to check against yet, so it is not a second gate to widen, it is the
  -- same bootstrap fact carried down.
  if p_role = 'owner'
     and not public.has_org_role(p_org, array['owner'])
     and not (
       public.is_platform_admin()
       and not exists (select 1 from public.memberships m where m.org_id = p_org)
     ) then
    raise exception 'Only an owner can invite another owner'
      using errcode = '42501';
  end if;
```

Both alternatives are additive — every existing caller (a real org's own
owner/manager, inviting into an org that already has members) is
completely unaffected; the `not exists (select 1 from memberships...)`
clause is `false` for any org past its first membership, so the bootstrap
branch can never fire again once a real owner exists.

2. **New RPC**, `admin_create_organisation_with_invite`:

```sql
create or replace function public.admin_create_organisation_with_invite(
  p_name          text,
  p_slug          text,
  p_plan          text,
  p_owner_email   text,
  p_price_pence   integer default null  -- null = use the plan's list price
) returns table (org_id uuid, invite_token text, invite_expires_at timestamptz)
language plpgsql security definer set search_path = public as $$
declare
  v_org_id uuid;
  v_invite record;
begin
  if not public.has_platform_role(array['platform_owner','platform_admin']) then
    raise exception 'Only a platform owner or administrator can create an organisation this way'
      using errcode = '42501';
  end if;

  if p_plan not in ('starter','professional','business','enterprise') then
    raise exception 'Unknown plan: %', p_plan using errcode = '22023';
  end if;

  insert into public.organisations (name, slug, plan, created_by)
  values (p_name, p_slug, p_plan, auth.uid())
  returning id into v_org_id;

  -- on_org_created (0003) just made auth.uid() (this platform admin) the
  -- owner. Undo that in the same transaction, before anything else can
  -- observe it — the whole point of this function existing rather than
  -- three separate client calls.
  delete from public.memberships
   where org_id = v_org_id and user_id = auth.uid();

  insert into public.subscriptions (org_id, plan, status, price_pence, started_at)
  values (v_org_id, p_plan, 'active', p_price_pence, timezone('utc', now()));

  select * into v_invite from public.create_invite(v_org_id, p_owner_email, 'owner');

  return query select v_org_id, v_invite.token, v_invite.expires_at;
end;
$$;

revoke all on function public.admin_create_organisation_with_invite(text, text, text, text, integer) from public, anon;
grant execute on function public.admin_create_organisation_with_invite(text, text, text, text, integer) to authenticated;
```

Notes for the implementer, not left implicit:

- `slug` uniqueness: `organisations.slug` already has a `unique` constraint
  (`0002`) — a duplicate raises Postgres's own `23505`, which is an
  acceptable error surface here (matches `create_invite`'s own
  already-a-member check using the same error code), but confirm the
  client-side error message maps it to something readable rather than a
  raw constraint-violation string.
- `subscriptions.org_id` is `unique` (`0002`) — this insert can only ever
  run once per org, which is correct, this function only ever creates a
  brand-new org.
- The function does **not** need to touch `plans.stripe_price_id` or call
  Stripe at all — a negotiated/sales-assisted deal is explicitly meant to
  bypass self-serve Checkout (per `subscriptions.price_pence`'s own design
  intent), invoicing such a customer is a separate, already-existing
  manual path (`issue_invoice()`, `0023`) for platform-finance staff, not
  part of this RPC.
- Execute grant is `to authenticated`, matching every other sensitive RPC
  in this codebase (`create_invite`, `set_org_status`, etc.) — the
  function's own internal `has_platform_role` check is the real gate, not
  the grant.

### Client: new Platform Console screen

A new page or modal (implementer's call which, based on
`docs/PLATFORM_CONSOLE.html`'s existing shape and whatever's least
disruptive to `AdminOrganisationsPage.tsx`'s current layout) with a form:
organisation name (slug auto-derived via the existing `slugify()` in
`orgService.ts`, editable), plan (select from `plans`, reusing
`listPlans()` from `billingCheckoutService.ts` — the same query the
billing spec's pages use), an optional negotiated price override, and the
contact's email. Submits via `supabase.rpc('admin_create_organisation_with_invite', ...)`.
On success, show the invite link/expiry so the admin can pass it to the
contact directly (email delivery of the invite itself — whether this
reuses an existing invite-email Inngest event or is a manual "copy this
link" step — is an implementation-time decision, not a design one; check
whether `create_invite`'s existing self-serve callers already trigger an
email and match that behaviour for consistency).

## Data flow

Platform admin (Platform Console → new screen) → `admin_create_organisation_with_invite`
RPC → org exists, admin never held membership in it, subscription exists
with the negotiated price, invite exists → contact receives the invite
link → `accept_invite()` (existing, unchanged) → contact becomes owner →
normal onboarding continues exactly as any self-serve org's would.

## Error handling

- Every failure mode (unknown plan, duplicate slug, invalid email —
  `create_invite`'s own regex check already covers this) surfaces as a
  specific `raise exception ... using errcode = '...'`, not a generic
  failure — matching this function's own internal call to `create_invite`,
  which already does this.
- The whole function is one transaction: if `create_invite` fails partway
  (e.g. duplicate active invite — though impossible here since this org is
  brand new), the org insert and membership delete roll back too. No
  partial org left behind with no way to invite an owner into it.

## Testing

- No automated test precedent for RPC functions or admin pages in this
  codebase (confirmed repeatedly this session) — verify via the
  Management API's SQL endpoint (the pattern already used throughout this
  session): call the RPC as a real platform admin, confirm the org exists,
  confirm **zero** membership rows exist for it immediately after
  (`select count(*) from memberships where org_id = ...` = 0), confirm the
  subscription row has the right `price_pence`, confirm the invite is
  real and `accept_invite()`-able.
- Explicitly test the negative cases: an `authenticated` non-platform-admin
  calling the RPC gets 42501; calling `create_invite` directly as a
  non-admin non-member still gets 42501 (the bootstrap exception must not
  have widened access for anyone else).

## Explicitly out of scope (not silently dropped)

- Sending the invite email automatically vs. a manual "copy this link" —
  implementation-time detail, not re-litigated here.
- Any UI for the admin to later transfer/reassign an org's owner — out of
  scope, existing `set_org_status`/membership-management screens are
  untouched.
- Locations, departments, staff, or any org-profile field beyond
  name/slug/plan/price — the real owner's job once they accept.
