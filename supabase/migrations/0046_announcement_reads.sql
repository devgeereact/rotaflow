-- =====================================================================
-- 0046_announcement_reads.sql — real read receipts for announcements
--
-- SCREENS.announcements shows a manager a read-progress bar ("Read: X/Y")
-- and a "Remind N unread" button; staff get a real "Mark as read" action.
-- `announcementsMapping.ts`'s own docstring recorded why none of this
-- existed: `notifications` is RLS-scoped to `user_id = auth.uid()`, so a
-- manager could never count another member's reads from the client, and
-- the preview panel hid the Delivery block rather than show a number that
-- was really just "how many of these I read myself".
--
-- This is a small, org-shared table rather than reusing `notifications`:
-- a read receipt is a fact about the announcement (who has seen it), not a
-- personal inbox item, so every member of the org can read every receipt
-- for an announcement in their org, the same shape `minimum_cover_rules`
-- already uses for "any member reads, the value is not personal".
-- =====================================================================

create table if not exists public.announcement_reads (
  id               uuid primary key default gen_random_uuid(),
  org_id           uuid not null references public.organisations(id) on delete cascade,
  announcement_id  uuid not null references public.announcements(id) on delete cascade,
  staff_profile_id uuid not null references public.staff_profiles(id) on delete cascade,
  read_at          timestamptz not null default timezone('utc', now()),

  -- Marking as read twice is a no-op, not a second row.
  unique (announcement_id, staff_profile_id)
);

comment on table public.announcement_reads is
  'One row per person who has opened an announcement. Read by every org member so a manager can see who has not seen a post yet.';

create index if not exists announcement_reads_org_idx
  on public.announcement_reads (org_id);
create index if not exists announcement_reads_announcement_idx
  on public.announcement_reads (announcement_id);

alter table public.announcement_reads enable row level security;

drop policy if exists announcement_reads_select on public.announcement_reads;
create policy announcement_reads_select
  on public.announcement_reads for select
  using (public.is_org_member(org_id));

-- Insert-only: a read receipt is a fact once true, there is nothing to
-- update, and nobody should be able to un-read something on someone else's
-- behalf.
drop policy if exists announcement_reads_insert on public.announcement_reads;
create policy announcement_reads_insert
  on public.announcement_reads for insert
  with check (staff_profile_id = public.my_staff_profile_id(org_id));
