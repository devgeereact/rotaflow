-- =====================================================================
-- 0152_leave_is_booked_once.sql — the same days cannot be booked off
-- twice (docs/SAAS.md GAP-123)
--
-- ## What was wrong
--
-- Nothing stopped one person holding two live leave requests over the
-- same dates. Observed on 2026-09-10 against a real session: a staff
-- member submitted 21–25 September, then 22–23 September, and both were
-- accepted. Both appeared in the manager's approval queue, and the
-- Leave screen's own "Pending" tile read 7.5 days for 5.5 days of
-- absence, because it sums `leaveDayCount` per request and the
-- overlapping days are counted once per request rather than once.
--
-- Approving both does the same thing to the figure that matters: the
-- entitlement. `sumApprovedLeaveDays` sums approved requests the same
-- way, so a year's allowance is spent twice on days the person is only
-- absent for once, and "Leave remaining" is wrong for the rest of the
-- year. That is a number a manager plans cover from and a person books
-- a holiday on.
--
-- ## The rule
--
-- One person, one live booking per day. Two requests conflict when
-- their date ranges intersect at all and both are still live —
-- `pending` or `approved`. A `rejected` or `cancelled` request blocks
-- nothing, which is what makes withdrawing and re-booking work.
--
-- Three consequences, all deliberate, all chosen rather than fallen
-- into:
--
--   * **Different types still conflict.** Sick leave over a booked
--     holiday is a real situation, and the answer is to withdraw or
--     decline the holiday, not to hold both. A person is absent or
--     they are not, and two overlapping absences double-count the same
--     days however they are labelled.
--
--   * **Two half-days on one date conflict.** The schema records
--     `starts_half` / `ends_half`, not a morning and an afternoon, so
--     there is no way to tell a second half-day from the same one
--     asked for twice. Refusing is the answer that cannot be silently
--     wrong.
--
--   * **A request already decided is out of scope.** The partial
--     predicate is on `status`, so the constraint is re-evaluated when
--     a row's status changes — a pending request cannot be approved
--     into a conflict either.
--
-- ## Why an exclusion constraint and not a trigger
--
-- A trigger that queries for an overlap and then inserts is a
-- read-then-write, and two requests submitted at the same moment both
-- read "no overlap" and both write. This product already carries that
-- lesson twice: BUG-061's approve/approve race and `0142`'s
-- last-platform-owner race were both closed by making the database
-- decide rather than the caller. An exclusion constraint is the same
-- move — Postgres holds the index entry, so exactly one of two racing
-- inserts wins and the other gets `23P01`.
--
-- It is also the only enforcement, on purpose. `docs/RULES.md` and
-- CLAUDE.md are explicit that a control whose only enforcement is a
-- disabled button is not a control: the offline outbox replays leave
-- inserts directly, and `createLeaveRequest` is reachable from any
-- session with a token.
--
-- ## Pre-existing data
--
-- Adding the constraint fails if a live overlap already exists, and a
-- migration that fails on merge is a red deploy rather than lost data.
-- The check below turns that into a message naming the count and the
-- people, instead of a bare `23P01` against a constraint that does not
-- exist yet. Production held no organisations and no staff profiles
-- when this was written, so it is a guard for the local and staging
-- databases that have been played with.
--
-- Nothing is dropped, nothing is rewritten and no grant changes, so
-- there is no destructive statement here to declare.
-- =====================================================================

-- `gist_uuid_ops` lives in btree_gist. Installed into `extensions` to
-- match `pg_net` and `pg_cron`, and named explicitly in the constraint
-- below so the opclass does not have to be found on a search path.
create extension if not exists btree_gist with schema extensions;

do $$
declare
  v_conflicts integer;
  v_sample    text;
begin
  select count(*), string_agg(distinct sample, '; ')
    into v_conflicts, v_sample
  from (
    select a.staff_profile_id,
           format('%s: %s..%s overlaps %s..%s',
                  a.staff_profile_id, a.start_date, a.end_date,
                  b.start_date, b.end_date) as sample
      from public.leave_requests a
      join public.leave_requests b
        on b.staff_profile_id = a.staff_profile_id
       and b.id > a.id
       and b.start_date <= a.end_date
       and b.end_date   >= a.start_date
     where a.status in ('pending', 'approved')
       and b.status in ('pending', 'approved')
  ) clashes;

  if v_conflicts > 0 then
    raise exception using
      errcode = 'data_exception',
      message = format(
        '%s live leave requests already overlap another for the same person, so 0152 cannot add its constraint.',
        v_conflicts),
      detail  = coalesce(v_sample, ''),
      hint    = 'Cancel or reject the duplicate request, then re-apply. This migration changes nothing until the data is one booking per day.';
  end if;
end
$$;

-- Inclusive at both ends: `start_date` and `end_date` are both days the
-- person is away, so 21–25 and 25–26 conflict on the 25th.
alter table public.leave_requests
  add constraint leave_requests_no_live_overlap
  exclude using gist (
    staff_profile_id extensions.gist_uuid_ops with =,
    daterange(start_date, end_date, '[]') with &&
  )
  where (status in ('pending', 'approved'));

comment on constraint leave_requests_no_live_overlap on public.leave_requests is
  'One person, one live booking per day (GAP-123). Two pending-or-approved requests for the same staff member may not share a date, whatever their type. Violations raise 23P01; src/services/leaveService.ts turns that into a sentence.';
