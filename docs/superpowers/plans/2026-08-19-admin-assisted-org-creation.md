# Admin-Assisted Organisation Creation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a platform admin create an organisation on behalf of a prospect who
contacted sales directly, without the admin ever holding owner rights in it —
the real contact joins via a real invite, same as any self-serve org's
onboarding.

**Architecture:** One new SECURITY DEFINER RPC,
`admin_create_organisation_with_invite`, does the whole thing atomically in one
transaction (insert org → undo the trigger's auto-granted admin membership →
insert the subscription at the negotiated price → mint the owner invite). A
narrow bootstrap fix to the existing `create_invite()` lets a platform admin
invite the very first owner into a genuinely member-less org. One new client
service function wraps the RPC; one new modal component collects the form;
the existing (currently disabled) "Add organisation" button on
`AdminOrganisationsPage.tsx` wires it in.

**Tech Stack:** Postgres/PL-pgSQL (Supabase migration), React/TypeScript,
existing `Modal`/`Input`/`Select`/`Button`/`Label` UI primitives.

**Spec:** `docs/superpowers/specs/2026-08-19-admin-assisted-org-creation-design.md`

## Global Constraints

- Owner assignment: nobody holds owner rights, not even briefly. The platform
  admin's auto-granted membership (from the `on_org_created` trigger) is
  deleted inside the same RPC transaction, before any client/session can
  observe it.
- Admin configures **plan tier + optional negotiated price override only** —
  not locations, staff, or org profile fields. Those stay the real owner's job.
- Valid plan codes: `'starter' | 'professional' | 'business' | 'enterprise'`
  (`organisations.plan` CHECK, widened in `0023_commercials.sql`).
- `create_invite()`'s bootstrap exception: `is_platform_admin() AND p_role =
  'owner' AND no memberships exist yet for that org`. Both of the function's
  two permission gates need it, not just the first — the plan text below has
  the full corrected body, copied from the spec and verified against the live
  `0006_invites.sql` source during planning.
- Execute grants on the new RPC: `to authenticated`, matching every other
  sensitive RPC in this codebase (`create_invite`, `set_org_status`) — the
  function's own internal `has_platform_role` check is the real gate, not the
  grant.
- Invite delivery: **no automated email.** Verified during planning —
  `create_invite()`'s only existing caller (`TeamInviteManager.tsx`) shows a
  "copy this link" card, it does not send mail. The new admin screen matches
  that behaviour for consistency, per the spec's own instruction to check and
  match rather than assume.
- `subscriptions.status` defaults to `'trialing'`; this RPC inserts
  `status = 'active'` explicitly — a sales-assisted deal starts as a real,
  paying subscription, not a trial.
- ⚠️ **Migration numbering race**: this plan's migration and the
  already-in-review billing/revenue plan's migration (PR #121,
  `0051_org_status_service_role.sql`) were authored on independent branches
  both forked near `0050`. Whichever of the two branches merges to `main`
  second must renumber its migration file to the actual next-free number
  before merging — Task 1, Step 1 below says to check
  `ls supabase/migrations/ | tail -3` at implementation time rather than
  assume a fixed number, for exactly this reason.

---

### Task 1: Migration — `create_invite()` bootstrap fix + `admin_create_organisation_with_invite` RPC

**Files:**
- Create: `supabase/migrations/00XX_admin_assisted_org_creation.sql` (run `ls supabase/migrations/ | tail -3` first for the real next-free number — see the numbering-race note in Global Constraints; do not assume `0051` or `0052`)

**Interfaces:**
- Produces: `admin_create_organisation_with_invite(p_name text, p_slug text, p_plan text, p_owner_email text, p_price_pence integer default null) returns table (org_id uuid, invite_token text, invite_expires_at timestamptz)` — Task 2's service wrapper calls this by exact name/signature.
- Produces: `create_invite(p_org, p_email, p_role)`'s permission checks widened (signature unchanged) — every existing caller (`inviteService.ts`'s `createInvite`) is unaffected.

- [ ] **Step 1: Write the migration**

Check `ls supabase/migrations/ | tail -3` for the actual next-free number, then create the file with this content (substituting the real number into the filename and the header comment):

```sql
-- =====================================================================
-- 00XX_admin_assisted_org_creation.sql — platform-admin-created orgs
--
-- Today the only way an organisation comes into existence is self-serve
-- signup (organisations_insert, 0002), which requires auth.uid() =
-- created_by. There is no path for a platform admin to create an org on
-- behalf of a prospect who contacted sales directly.
--
-- Two changes:
--
-- 1. create_invite()'s permission checks (0006) get a bootstrap
--    alternative — a platform admin inviting the very first owner into a
--    genuinely member-less org. Both gates need it, or the function
--    accepts the admin past the first check and rejects them at the
--    second ("only an owner may hand out ownership").
--
-- 2. A new RPC, admin_create_organisation_with_invite, that atomically:
--    inserts the org, immediately removes the on_org_created trigger's
--    auto-granted admin membership within the same transaction (so no
--    client/session ever observes the admin as owner, not even briefly),
--    creates the subscription at the negotiated price, creates the owner
--    invite for the real contact. All-or-nothing, platform-admin-only.
-- =====================================================================

-- ---------- create_invite(): bootstrap exception on both gates --------
create or replace function public.create_invite(
  p_org   uuid,
  p_email text,
  p_role  text default 'staff'
)
returns table (invite_id uuid, token text, expires_at timestamptz)
language plpgsql security definer set search_path = public as $$
declare
  v_email text := lower(trim(p_email));
  v_token text;
  v_row   public.invites;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;

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

  if p_role not in ('owner','manager','staff') then
    raise exception 'Unknown role: %', p_role using errcode = '22023';
  end if;

  if v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'That does not look like an email address'
      using errcode = '22023';
  end if;

  -- Already a member? Inviting again would create a confusing dead link.
  if exists (
    select 1 from public.memberships m
    join public.profiles p on p.id = m.user_id
    where m.org_id = p_org and lower(p.email) = v_email
  ) then
    raise exception 'That person is already a member of this organisation'
      using errcode = '23505';
  end if;

  -- Supersede any live invite so the partial unique index cannot trip and the
  -- newest link is the only working one.
  update public.invites
     set revoked_at = timezone('utc', now())
   where org_id = p_org
     and lower(email) = v_email
     and accepted_at is null
     and revoked_at is null;

  -- Two UUIDv4s = 244 bits of entropy, no pgcrypto dependency.
  v_token := replace(gen_random_uuid()::text, '-', '')
          || replace(gen_random_uuid()::text, '-', '');

  insert into public.invites (org_id, email, role, token_hash, invited_by)
  values (
    p_org,
    v_email,
    p_role,
    encode(sha256(v_token::bytea), 'hex'),
    auth.uid()
  )
  returning * into v_row;

  return query select v_row.id, v_token, v_row.expires_at;
end;
$$;

-- ---------- admin_create_organisation_with_invite ----------------------
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

  -- on_org_created (0002) just made auth.uid() (this platform admin) the
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

- [ ] **Step 2: Apply and verify — the two things that must both be true**

This touches the live shared Supabase project. Per this session's established
practice, apply it yourself or hand it to the user (do not assume
`supabase db push` succeeds unprompted — it has been blocked by this
environment's own safety classifier before).

After applying, verify with the Management API's SQL endpoint
(`POST /v1/projects/vwqqbdvlskngrqrejzxi/database/query`):

```sql
-- 1. Confirm the bootstrap branch exists on create_invite() without
--    widening ordinary access — read the source back rather than guessing:
select prosrc from pg_proc where proname = 'create_invite';
-- confirm 'is_platform_admin' AND 'has_org_role' both still appear.

-- 2. Confirm the new RPC exists with the right grant:
select p.proname, r.rolname
  from pg_proc p
  join pg_proc_acl_placeholder -- (illustrative; use \df+ or information_schema.role_routine_grants in practice)
 where false; -- replace with:
select grantee, privilege_type
  from information_schema.role_routine_grants
 where routine_name = 'admin_create_organisation_with_invite';
-- confirm 'authenticated' has EXECUTE, and neither 'anon' nor 'PUBLIC' does.
```

Then exercise both real paths (these are genuine live-DB writes, not
read-only checks — get explicit confirmation before running them against
production, same as every other live write this session):

```sql
-- Positive path: create a throwaway org as a real platform admin (run this
-- authenticated as one, e.g. via the Management API with a service-role
-- key that then calls the function — or ask the user to trigger it from a
-- real platform-admin session once Tasks 2-4 ship the UI). Confirm:
--   a) the org exists
--   b) zero membership rows exist for it immediately after:
select count(*) from memberships where org_id = '<the new org id>';
--   c) the subscription row has status='active' and the expected price_pence
--   d) the invite is real and accept_invite()-able (do not actually accept
--      it with a throwaway account unless cleaning up afterward — an
--      unaccepted invite sitting in the table is harmless and expected)

-- Negative path: an authenticated non-platform-admin calling
-- admin_create_organisation_with_invite gets 42501. Confirm by reading the
-- function body's first check (already done in step 1 above) rather than
-- attempting a live call with a non-admin JWT this session may not have on
-- hand — matches this session's established verification pattern for
-- permission-check migrations.
```

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/00XX_admin_assisted_org_creation.sql
git commit -m "feat: let a platform admin create an org with an owner invite"
```

---

### Task 2: Service layer — `createOrganisationWithInvite`

**Files:**
- Modify: `src/services/platformService.ts`

**Interfaces:**
- Consumes: `admin_create_organisation_with_invite` RPC (Task 1); `buildAcceptUrl(token: string): string` (already exists, `src/services/inviteService.ts`).
- Produces: `createOrganisationWithInvite(input: CreateOrganisationWithInviteInput): Promise<CreatedOrganisationInvite>` — Task 3's modal calls this by exact name/signature.

- [ ] **Step 1: Add the wrapper function**

Add to `src/services/platformService.ts` (near `setPlatformAdmin`, the file's other sensitive-write wrapper):

```typescript
import { buildAcceptUrl } from '@/services/inviteService';

export interface CreateOrganisationWithInviteInput {
  name: string;
  slug: string;
  plan: 'starter' | 'professional' | 'business' | 'enterprise';
  ownerEmail: string;
  /** Pence. Omit or null to use the plan's list price. */
  pricePence?: number | null;
}

export interface CreatedOrganisationInvite {
  orgId: string;
  inviteToken: string;
  inviteExpiresAt: string;
  /** Ready-to-send URL for the contact, same shape as inviteService's own. */
  acceptUrl: string;
}

/**
 * Platform-admin-only. Creates an organisation for a prospect who contacted
 * sales directly, at a plan and (optionally) negotiated price the admin
 * sets, and mints an owner invite for the real contact — the admin never
 * holds membership in the org, not even briefly (enforced inside
 * `admin_create_organisation_with_invite`, 00XX_admin_assisted_org_creation.sql).
 *
 * Raises rather than returning empty, same posture as `setPlatformAdmin`
 * above and `platformRoleService`'s grant/revoke functions — a refused
 * write must never look like a successful one.
 */
export async function createOrganisationWithInvite(
  input: CreateOrganisationWithInviteInput,
): Promise<CreatedOrganisationInvite> {
  const { data, error } = await supabase.rpc('admin_create_organisation_with_invite', {
    p_name: input.name,
    p_slug: input.slug,
    p_plan: input.plan,
    p_owner_email: input.ownerEmail,
    p_price_pence: input.pricePence ?? null,
  });
  if (error) throw error;

  const row = data?.[0];
  if (!row) throw new Error('The organisation could not be created.');

  return {
    orgId: row.org_id,
    inviteToken: row.invite_token,
    inviteExpiresAt: row.invite_expires_at,
    acceptUrl: buildAcceptUrl(row.invite_token),
  };
}
```

(`supabase` is already imported at the top of this file — add the
`buildAcceptUrl` import alongside the existing `grantPlatformRole`/
`revokePlatformRole` import from `platformRoleService`.)

- [ ] **Step 2: Type-check**

Run: `npm run typecheck`
Expected: no new errors. If `admin_create_organisation_with_invite` isn't in
the generated `database.types.ts` RPC map yet (Task 1's migration may not be
applied to the project this session's local types were generated against),
`supabase.rpc(...)`'s argument/return types will be untyped (`any`-shaped) —
this is expected until types are regenerated post-migration, not a bug to
work around with a cast. Note it in the report; do not silence it.

- [ ] **Step 3: Commit**

```bash
git add src/services/platformService.ts
git commit -m "feat: add createOrganisationWithInvite to platformService"
```

---

### Task 3: `AdminCreateOrgModal` component

**Files:**
- Create: `src/components/admin/AdminCreateOrgModal.tsx`

**Interfaces:**
- Consumes: `createOrganisationWithInvite` (Task 2), `listPlans` (`src/services/billingCheckoutService.ts`, already exists — returns `Plan[]` with `code`, `name`, `monthly_price_pence`, `sort_order`), `slugify` (`src/services/orgService.ts`, already exists), `isValidEmail` (`src/lib/email.ts`, already exists).
- Produces: `AdminCreateOrgModal({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (result: CreatedOrganisationInvite, orgName: string, email: string) => void }): JSX.Element` — Task 4's page renders this and handles `onCreated`. `orgName`/`email` are echoed back from the form's own submitted values, not from the RPC's return shape (`CreatedOrganisationInvite` only carries `orgId`/`inviteToken`/`inviteExpiresAt`/`acceptUrl`) — the modal already holds the trimmed values right where it calls `onCreated`, so it passes them through rather than making the caller look them up again.

- [ ] **Step 1: Write the component**

```typescript
import { useCallback, useEffect, useState } from 'react';
import { createOrganisationWithInvite } from '@/services/platformService';
import type { CreatedOrganisationInvite } from '@/services/platformService';
import { listPlans, type Plan } from '@/services/billingCheckoutService';
import { slugify } from '@/services/orgService';
import { isValidEmail } from '@/lib/email';
import { reportError } from '@/lib/sentry';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Label } from '@/components/ui/Label';
import { Modal } from '@/components/ui/Modal';
import { Select } from '@/components/ui/Select';

/**
 * Form for a platform admin to create an organisation on behalf of a
 * prospect who contacted sales directly — plan + optional negotiated price,
 * nothing else. Mirrors `TeamInviteManager`'s modal-then-copy-link pattern:
 * this component only handles the form and the RPC call; the caller
 * (`AdminOrganisationsPage`) owns showing the resulting invite link, same
 * split of responsibility as `TeamInviteManager` keeps within one file.
 */
export function AdminCreateOrgModal({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (result: CreatedOrganisationInvite, orgName: string, email: string) => void;
}): JSX.Element {
  const [plans, setPlans] = useState<Plan[]>([]);
  const [plansFailed, setPlansFailed] = useState(false);

  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [slugTouched, setSlugTouched] = useState(false);
  const [plan, setPlan] = useState('');
  const [priceInput, setPriceInput] = useState('');
  const [email, setEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Reopening must not show the previous attempt's values or errors.
  useEffect(() => {
    if (!open) return;
    setName('');
    setSlug('');
    setSlugTouched(false);
    setPriceInput('');
    setEmail('');
    setFormError(null);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    let active = true;
    setPlansFailed(false);
    void (async () => {
      try {
        const rows = await listPlans();
        if (!active) return;
        setPlans(rows);
        setPlan((current) => current || rows[0]?.code || '');
      } catch (err) {
        if (!active) return;
        reportError(err, { area: 'admin:create-org:list-plans' });
        setPlansFailed(true);
      }
    })();
    return () => {
      active = false;
    };
  }, [open]);

  const handleNameChange = useCallback(
    (value: string): void => {
      setName(value);
      if (!slugTouched) setSlug(slugify(value));
    },
    [slugTouched],
  );

  const handleSlugChange = useCallback((value: string): void => {
    setSlugTouched(true);
    setSlug(value);
  }, []);

  const handleSubmit = useCallback(async (): Promise<void> => {
    const trimmedName = name.trim();
    const trimmedSlug = slug.trim();
    const trimmedEmail = email.trim();

    if (!trimmedName) {
      setFormError('Give the organisation a name.');
      return;
    }
    if (!trimmedSlug) {
      setFormError('Give the organisation a slug.');
      return;
    }
    if (!plan) {
      setFormError('Choose a plan.');
      return;
    }
    if (!isValidEmail(trimmedEmail)) {
      setFormError('That does not look like a valid email address.');
      return;
    }

    let pricePence: number | null = null;
    if (priceInput.trim() !== '') {
      const pounds = Number(priceInput);
      if (!Number.isFinite(pounds) || pounds < 0) {
        setFormError('The negotiated price must be a positive number, in pounds.');
        return;
      }
      pricePence = Math.round(pounds * 100);
    }

    setSubmitting(true);
    setFormError(null);
    try {
      const result = await createOrganisationWithInvite({
        name: trimmedName,
        slug: trimmedSlug,
        plan: plan as 'starter' | 'professional' | 'business' | 'enterprise',
        ownerEmail: trimmedEmail,
        pricePence,
      });
      onCreated(result, trimmedName, trimmedEmail);
    } catch (err) {
      reportError(err, { area: 'admin:create-org:submit' });
      // The database raises specific messages (duplicate slug, unknown
      // plan, insufficient role) that are more useful than a generic one.
      const message =
        err instanceof Error && err.message
          ? err.message
          : 'Could not create that organisation.';
      setFormError(message);
    } finally {
      setSubmitting(false);
    }
  }, [name, slug, plan, priceInput, email, onCreated]);

  return (
    <Modal open={open} onClose={onClose} title="Create organisation">
      <div className="space-y-4">
        <div>
          <Label htmlFor="create-org-name">Organisation name</Label>
          <Input
            id="create-org-name"
            value={name}
            onChange={(e) => handleNameChange(e.target.value)}
            placeholder="Acme Facilities Ltd"
          />
        </div>

        <div>
          <Label htmlFor="create-org-slug">Slug</Label>
          <Input
            id="create-org-slug"
            value={slug}
            onChange={(e) => handleSlugChange(e.target.value)}
            placeholder="acme-facilities"
          />
          <p className="mt-1 text-xs text-content-muted dark:text-content-muted-dark">
            Auto-filled from the name. Edit it if the prospect wants something specific.
          </p>
        </div>

        <div>
          <Label htmlFor="create-org-plan">Plan</Label>
          {plansFailed ? (
            <p className="text-sm text-danger">Could not load the plan list.</p>
          ) : (
            <Select
              id="create-org-plan"
              value={plan}
              onChange={(e) => setPlan(e.target.value)}
            >
              {plans.length === 0 && <option value="">Loading…</option>}
              {plans.map((p) => (
                <option key={p.code} value={p.code}>
                  {p.name} — £{(p.monthly_price_pence / 100).toFixed(2)}/mo
                </option>
              ))}
            </Select>
          )}
        </div>

        <div>
          <Label htmlFor="create-org-price">Negotiated price (optional)</Label>
          <Input
            id="create-org-price"
            type="number"
            min="0"
            step="0.01"
            value={priceInput}
            onChange={(e) => setPriceInput(e.target.value)}
            placeholder="Leave blank to use the plan's list price"
          />
          <p className="mt-1 text-xs text-content-muted dark:text-content-muted-dark">
            In pounds. Overrides the plan's list price for this organisation only.
          </p>
        </div>

        <div>
          <Label htmlFor="create-org-email">Contact's email</Label>
          <Input
            id="create-org-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="owner@theircompany.com"
          />
          <p className="mt-1 text-xs text-content-muted dark:text-content-muted-dark">
            They'll join as the organisation's owner once they accept the invite you'll
            get a link for next.
          </p>
        </div>

        {formError && (
          <p className="text-sm text-danger" role="alert">
            {formError}
          </p>
        )}

        <div className="flex justify-end gap-3">
          <Button type="button" variant="ghost" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button
            type="button"
            onClick={() => void handleSubmit()}
            disabled={submitting || plansFailed}
          >
            {submitting ? 'Creating…' : 'Create organisation'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
```

- [ ] **Step 2: Type-check**

Run: `npm run typecheck`
Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/admin/AdminCreateOrgModal.tsx
git commit -m "feat: add AdminCreateOrgModal"
```

---

### Task 4: Wire it into `AdminOrganisationsPage.tsx`

**Files:**
- Modify: `src/pages/admin/AdminOrganisationsPage.tsx`

**Interfaces:**
- Consumes: `AdminCreateOrgModal` (Task 3), `CreatedOrganisationInvite` (Task 2).

- [ ] **Step 1: Replace the disabled "Add organisation" button**

Find this file's `action` prop on `<AdminPage>` (shown in the File Structure
investigation during planning — the disabled button with the comment
explaining organisations are created by their owner at sign-up). Replace:

```tsx
{/* Creating a tenant from the console is not built: an organisation is
    created by its owner during onboarding, which also provisions the
    owner membership by trigger. A console form would have to
    reimplement that and pick an owner who has not signed up. */}
<Button disabled title="Organisations are created by their owner at sign-up">
  <Plus size={15} aria-hidden="true" />
  Add organisation
</Button>
```

with:

```tsx
<Button onClick={() => setCreateModalOpen(true)}>
  <Plus size={15} aria-hidden="true" />
  Add organisation
</Button>
```

- [ ] **Step 2: Add state, the modal, and the post-create link card**

Add near this component's other `useState` declarations:

```typescript
const [createModalOpen, setCreateModalOpen] = useState(false);
const [createdInvite, setCreatedInvite] = useState<{
  orgName: string;
  email: string;
  url: string;
} | null>(null);
```

Import at the top of the file, alongside the existing imports:

```typescript
import { Copy } from 'lucide-react';
import { AdminCreateOrgModal } from '@/components/admin/AdminCreateOrgModal';
import { useToast } from '@/hooks/useToast';
import type { CreatedOrganisationInvite } from '@/services/platformService';
```

(`Plus`, `Download`, `Upload` are already imported from `lucide-react` on this
file's existing import line — add `Copy` to that same line rather than a new
one.)

Add the toast hook alongside this component's other hook calls:

```typescript
const { showSuccess, showError } = useToast();
```

Add a handler, near this file's other `useCallback`s. `AdminCreateOrgModal`'s
`onCreated` (Task 3) is `(result: CreatedOrganisationInvite, orgName: string,
email: string) => void` — it echoes back the form's own submitted
`name`/`email` rather than requiring this page to look them up again, since
the RPC's return shape (`CreatedOrganisationInvite`) only carries
`orgId`/`inviteToken`/`inviteExpiresAt`/`acceptUrl`:

```typescript
const handleOrgCreated = useCallback(
  (result: CreatedOrganisationInvite, orgName: string, email: string) => {
    setCreateModalOpen(false);
    setCreatedInvite({ orgName, email, url: result.acceptUrl });
    setReloadKey((k) => k + 1);
    showSuccess(`${orgName} created. Copy the invite link and send it to ${email}.`);
  },
  [showSuccess],
);

const copyInviteLink = useCallback(
  async (url: string): Promise<void> => {
    try {
      await navigator.clipboard.writeText(url);
      showSuccess('Invitation link copied.');
    } catch (err) {
      reportError(err, { area: 'admin:create-org:copy-link' });
      showError('Could not copy. Select the link and copy it manually.');
    }
  },
  [showError, showSuccess],
);
```

(Confirm this file already has a `reloadKey`/`setReloadKey` state pair driving
its data-loading `useEffect`, per the File Structure investigation — reuse it
rather than adding a second one. `reportError` is already imported in this
file from `@/lib/sentry`.)

`AdminCreateOrgModal`'s `onCreated` prop is `(result: CreatedOrganisationInvite)
=> void`, but `handleOrgCreated` above also needs the org name and email
(`CreatedOrganisationInvite` only carries `orgId`/`inviteToken`/
`inviteExpiresAt`/`acceptUrl` — it does not echo back the name/email the
caller already has in the form). Wrap it inline where the modal is rendered
(next step) rather than changing Task 3's interface — the page already has
these values from its own request, no need to round-trip them through the
RPC's return shape.

- [ ] **Step 3: Render the card and the modal**

Add the invite-link card near the top of this page's success-state JSX
(directly under the `<TileGrid>` summary tiles is a reasonable spot — check
the file's actual layout at implementation time and place it where it reads
naturally as "something just happened", same positioning `TeamInviteManager`
uses for its own `lastLink` card):

```tsx
{createdInvite && (
  <div className="rounded-2xl border border-primary/30 bg-primary/5 p-4">
    <h2 className="mb-1 font-medium text-content dark:text-content-dark">
      Invitation link for {createdInvite.email}
    </h2>
    <p className="mb-3 text-sm text-content-muted dark:text-content-muted-dark">
      {createdInvite.orgName} is created. Send this link to {createdInvite.email} so
      they can accept and become its owner. It is shown once — RotaFlow stores only a
      hash of the token, so it cannot be retrieved again.
    </p>
    <div className="flex flex-wrap items-center gap-2">
      <code className="min-w-0 flex-1 overflow-x-auto rounded-lg border border-surface-border bg-background px-3 py-2 font-mono text-xs text-content dark:border-surface-border-dark dark:bg-background-dark dark:text-content-dark">
        {createdInvite.url}
      </code>
      <Button
        size="sm"
        variant="secondary"
        onClick={() => void copyInviteLink(createdInvite.url)}
      >
        <Copy size={14} aria-hidden="true" className="mr-1.5" />
        Copy
      </Button>
      <Button size="sm" variant="ghost" onClick={() => setCreatedInvite(null)}>
        Done
      </Button>
    </div>
  </div>
)}
```

Render the modal once, near the end of this component's JSX (siblings of any
other modal this page already renders — check for one; if none exists yet,
place it just before the component's closing `</AdminPage>` tag):

```tsx
<AdminCreateOrgModal
  open={createModalOpen}
  onClose={() => setCreateModalOpen(false)}
  onCreated={handleOrgCreated}
/>
```

(`handleOrgCreated`'s signature already matches `onCreated`'s exactly — see
Task 3 and Step 2 above — so it can be passed directly, no wrapper needed.)

- [ ] **Step 4: Type-check and lint**

Run: `npm run typecheck && npm run lint`
Expected: no new errors.

- [ ] **Step 5: Manual check**

`npm run dev`, sign in as a platform admin, `/admin/organisations`. Click
"Add organisation", fill the form (a throwaway name/slug, any plan, a real
email you control), submit. Confirm:
- the invite-link card appears with a real, copyable link
- the organisations list/summary tiles refresh to include the new org
- clicking "Copy" actually copies (paste it somewhere to check)
- opening the copied link in the accept-invite flow (`/invite/:token`,
  already exists, unchanged) shows the right org name and role — do not
  necessarily complete acceptance with a throwaway account unless cleaning
  up the test org afterward

Then confirm the negative path from a non-platform-admin account (or by
temporarily editing the RPC call's role check expectation): the button
should not even be reachable for a non-admin (this page is already gated by
`RequirePlatformAdmin` per every other admin page in this codebase — confirm
this page's own gate, don't add a redundant one).

- [ ] **Step 6: Commit**

```bash
git add src/pages/admin/AdminOrganisationsPage.tsx
git commit -m "feat: wire admin-assisted org creation into the Organisations page"
```

## Self-review notes (from writing this plan)

- **Spec coverage:** every decision in the design spec's brainstorming table
  is implemented — owner assignment (Task 1's trigger-membership deletion),
  admin-configurable scope (Task 3's form: plan + price, nothing else),
  `create_invite()`'s bootstrap gap (Task 1's widened checks, both gates),
  the `on_org_created` conflict (Task 1's same-transaction delete). The
  spec's "Explicitly out of scope" list (locations/staff/org-profile fields,
  automatic transfer/reassignment UI, automated invite email) has no task
  building any of it — confirmed absent by design, not by omission.
- **Placeholder scan:** an earlier draft of Task 4 Step 3 left an
  empty-bodied `onCreated` callback with a comment asking the implementer to
  decide how to thread `orgName`/`email` through, since
  `CreatedOrganisationInvite` doesn't carry them. Caught in this self-review
  as exactly the "describes what to do without showing how" pattern the
  No-Placeholders section forbids — fixed by deciding it here instead:
  `AdminCreateOrgModal`'s `onCreated` prop (Task 3) takes `orgName`/`email`
  as extra arguments, echoed back from the form's own submitted values at
  the point it already has them, so Task 4's wiring is a direct
  `onCreated={handleOrgCreated}` with no wrapper or lookup needed.
- **Type consistency:** `CreatedOrganisationInvite` (Task 2) is the same
  shape referenced by name in Task 3 and Task 4; `AdminCreateOrgModal`'s
  `onCreated` signature (Task 3) matches `handleOrgCreated`'s signature
  (Task 4) exactly, both `(result: CreatedOrganisationInvite, orgName:
  string, email: string) => void`; `admin_create_organisation_with_invite`'s
  RPC parameter names (`p_name`, `p_slug`, `p_plan`, `p_owner_email`,
  `p_price_pence`) match between Task 1's SQL and Task 2's `.rpc()` call
  exactly.
