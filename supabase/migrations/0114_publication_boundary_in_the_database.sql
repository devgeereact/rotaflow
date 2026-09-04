-- =====================================================================
-- 0114_publication_boundary_in_the_database.sql — a draft rota is not
-- a published one, and until now only the browser knew that
-- (docs/SAAS.md GAP-039, CAP-004)
--
-- ## What was wrong
--
-- `docs/SAAS.md` and `CLAUDE.md` both say the same thing about this
-- codebase: "a control whose only enforcement is a disabled button is not
-- a control". Publication was one. Every structural rule around it lives
-- in the database — a published rota's shifts are immutable
-- (`shifts_guard_immutable_rota`, 0061), its status cannot be PATCHed
-- (`rotas_guard_status_change`, 0061), only one may be published per
-- scope (0061's partial unique indexes), and minimum cover is checked
-- inside `publish_rota` (0080) precisely because the browser's copy of
-- that rule could be walked around by calling the RPC directly.
--
-- The one rule left in the browser was the one the product is named for.
-- `rotas_select` and `shifts_select` are `using (is_org_member(org_id))`
-- (0002:490-503), and the draft/published boundary for staff was a
-- `.filter()` applied after the rows had already been fetched
-- (`src/services/shiftService.ts:66-89`).
--
-- Verified against a local stack on 2026-09-02, as `authenticated` with a
-- staff member's `sub` claim, which is exactly what PostgREST does:
--
--   select count(*) from rotas where status = 'draft'          -> 1
--   select name     from rotas where status = 'draft'
--     -> 'UNPUBLISHED DRAFT — pay cut week'
--   shifts on that rota                                        -> 1
--
-- and the same again through the amendment flow: publish a week, call
-- `begin_rota_revision`, move a shift to 23:00, and the staff member reads
-- the new time before anybody has published it. That is the sequence the
-- audit standard sets out under "DRAFT ≠ PUBLISHED", and it failed.
--
-- The consequence is not academic for a rota product. Next week's
-- unpublished draft is the most sensitive thing in the schema while it is
-- being written: it is where a manager tries out cutting somebody's hours,
-- moving them to nights, or not rostering them at all.
--
-- ## The rule
--
--   owner / manager     every rota, as now — they build the drafts
--   everybody else      `published` and `archived` only
--
-- `archived` is included deliberately. It is not a third kind of draft: a
-- rota can only reach it by having been published and then superseded
-- (`publish_rota`, 0080:148-153), and `discard_rota_revision` DELETES an
-- abandoned amendment rather than archiving it (0061), so there is no path
-- by which never-published work becomes `archived`. Excluding it would
-- erase every staff member's own history the moment a week was amended.
--
-- `has_org_role` already covers a live delegation and support access
-- (0106), so a delegated manager keeps the manager's view without this
-- migration knowing anything about delegation.
--
-- ## Why `shifts` goes through a function
--
-- The shift's own row does not carry the status; its rota does. A policy
-- that selects from `public.rotas` would have that table's RLS applied
-- inside the check, which is both a second policy evaluation per row and a
-- trap the next person would have to remember. A `security definer`
-- helper reads the status once, and is the same shape as
-- `is_org_member` and `my_staff_profile_id` that every other policy here
-- already calls.
--
-- Its EXECUTE grant is stated explicitly rather than inherited, which is
-- the rule `0113` had to introduce the day before this.
--
-- ## What does NOT change
--
-- Nothing in the client is relaxed. `shiftService.listShiftsForPeriod`
-- keeps its `publishedOnly` filter, still defaulting to true. All four
-- draft-inclusive call sites are inside manager-only branches
-- (`SchedulePage.tsx:93`, `TimesheetsPage.tsx:94`,
-- `dashboardService.ts:319` and `:474`), so no staff screen loses a row
-- it renders today.
--
-- One visible behaviour change, and it is an improvement rather than a
-- side effect: a staff member in a multi-site organisation used to see
-- "draft" for their week whenever ANY site was still drafting, because
-- `rotaWeekStatus` runs `every()` over the rotas it can see. It now runs
-- over the published ones, so another site's unfinished work no longer
-- speaks for their week. `dedupeRotasByScope` already prefers the
-- published row over the archived one it supersedes, so an amended week
-- still reads as published.
--
-- Guarded by `rota_publication_boundary.test.sql`.
-- =====================================================================

-- ── can I see this rota's contents? ──────────────────────────────────
create or replace function public.rota_is_readable(p_rota uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
      from public.rotas r
     where r.id = p_rota
       and public.is_org_member(r.org_id)
       and (
         r.status in ('published', 'archived')
         or public.has_org_role(r.org_id, array['owner', 'manager'])
       )
  );
$$;

comment on function public.rota_is_readable(uuid) is
  'True when the caller may read a rota''s contents: published or archived '
  'for any member, any status for an owner, manager or live delegate. Used '
  'by shifts_select, whose own row does not carry the status.';

revoke execute on function public.rota_is_readable(uuid) from public, anon;
grant execute on function public.rota_is_readable(uuid) to authenticated, service_role;

-- ── rotas ────────────────────────────────────────────────────────────
drop policy if exists rotas_select on public.rotas;
create policy rotas_select on public.rotas for select
  using (
    public.is_org_member(org_id)
    and (
      status in ('published', 'archived')
      or public.has_org_role(org_id, array['owner', 'manager'])
    )
  );

-- ── shifts ───────────────────────────────────────────────────────────
--
-- `rota_id` is nullable (`0002:199`, `on delete set null`), and a shift
-- with no rota has no publication state to hide behind. Those stay
-- visible to the org, which is what happens today.
drop policy if exists shifts_select on public.shifts;
create policy shifts_select on public.shifts for select
  using (
    public.is_org_member(org_id)
    and (rota_id is null or public.rota_is_readable(rota_id))
  );
