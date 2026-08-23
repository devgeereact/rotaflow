-- =====================================================================
-- 0060_slug_available_excludes_own_org.sql — let a slug's current owner
-- re-submit it.
--
-- 0007's slug_available answers "does ANY organisation hold this slug",
-- which is right while nobody holds it yet and wrong the moment the
-- caller does. Onboarding creates the organisation at the end of step 1,
-- so pressing Back and returning to step 1 re-checks a slug the caller
-- now owns, gets `false`, and disables Continue permanently — retyping
-- the identical value cannot clear it. The only escape was to invent a
-- different identifier, which the page then silently discarded.
--
-- The overload takes the org to ignore, but does NOT take the caller's
-- word for it: the exclusion applies only where the caller is an active
-- OWNER of that organisation. Otherwise anyone could pass an arbitrary
-- id and probe whether a given slug belongs to it — the tenant
-- enumeration 0007's comment exists to prevent. An id the caller does
-- not own simply does not exclude anything, so the answer degrades to
-- 0007's, never to something more revealing.
--
-- 0007's single-argument form is kept, unchanged, for the sign-up path
-- where no organisation exists yet.
-- =====================================================================

create or replace function public.slug_available(
  p_slug text,
  p_exclude_org_id uuid
)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select not exists (
    select 1 from public.organisations o
     where lower(o.slug) = lower(trim(p_slug))
       and (
         p_exclude_org_id is null
         or o.id <> p_exclude_org_id
         -- Ownership is proven, not asserted. Without this clause the
         -- caller could exclude any org id and learn from the flipped
         -- answer that the slug belongs to it.
         or not exists (
           select 1 from public.memberships m
            where m.org_id = p_exclude_org_id
              and m.user_id = auth.uid()
              and m.role = 'owner'
              and m.status = 'active'
         )
       )
  );
$$;

comment on function public.slug_available(text, uuid) is
  'Is this slug free, ignoring one organisation the caller actively owns? The exclusion is verified against memberships, so passing an org id the caller does not own changes nothing. Used by onboarding step 1, which can be re-entered after the organisation already exists.';

revoke all on function public.slug_available(text, uuid) from public, anon;
grant execute on function public.slug_available(text, uuid) to authenticated;
