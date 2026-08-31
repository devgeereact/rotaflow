-- =====================================================================
-- 0111_erasure_misses_email.sql — GDPR erasure left the email address
-- behind (docs/SAAS.md CAP-057 / GAP-013)
--
-- `anonymize_staff_member` (`0011`) replaces a person's name with
-- "Deleted Member", clears their phone, photo and payroll id, and severs
-- the link to their login. It does not clear `staff_profiles.email`,
-- because that column did not exist when the function was written —
-- `0053` added it two months later for account linking, and nothing went
-- back.
--
-- So the record left behind reads "Deleted Member", with the person's
-- email address still on it. That is the strongest identifier of the
-- lot: it names them, it is the key you would use to find them in any
-- other system, and it is what an erasure request is usually made from.
-- Verified against production before writing this — the deployed
-- function's body contains no reference to `email` at all.
--
-- The register recorded this capability as verified clean, and it was:
-- the verification ran before the column existed. That is the shape of
-- this whole class of bug — not a wrong decision, a decision that stopped
-- being true — and it is why the pgTAP test added alongside this asserts
-- over the COLUMN LIST rather than over a fixed set of fields.
--
-- ## The calendar feed had the same problem, and worse
--
-- `0099` gave each person a tokenised URL that serves their shifts to any
-- calendar client. Erasing somebody did not revoke it, so a URL in
-- somebody's phone would keep returning the shifts of a person the
-- organisation had just been asked to erase.
--
-- ## What is deliberately KEPT
--
-- Pay rates, sites, shifts, clock events, leave, swaps and timesheets all
-- stay, attached to the now-anonymous record. That is the same reasoning
-- `0011` gives for the rest: the business still has to be able to say what
-- hours were worked and what a week cost. None of it identifies anybody
-- once the identity is gone, which is the difference between anonymising
-- and deleting.
-- =====================================================================

create or replace function public.anonymize_staff_member(
  p_org uuid,
  p_staff_profile_id uuid
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_exists boolean;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;

  if not public.has_org_role(p_org, array['owner']) then
    raise exception 'Only the organisation owner can erase a staff member''s data'
      using errcode = '42501';
  end if;

  select exists(
    select 1 from public.staff_profiles
    where id = p_staff_profile_id and org_id = p_org
  ) into v_exists;
  if not v_exists then
    raise exception 'Staff member not found in this organisation' using errcode = 'P0002';
  end if;

  -- Pure PII containers — no operational value survives the person being
  -- gone, so these are deleted outright rather than anonymized in place.
  delete from public.emergency_contacts where staff_profile_id = p_staff_profile_id;
  delete from public.documents where staff_profile_id = p_staff_profile_id;

  -- New in 0111. A live feed URL is a standing grant to read this person's
  -- shifts, held by whatever calendar app it was pasted into. Leaving it
  -- working after an erasure request is the one consequence here that keeps
  -- producing new disclosures rather than merely retaining an old one.
  update public.calendar_feed_tokens
     set revoked_at = timezone('utc', now())
   where staff_profile_id = p_staff_profile_id
     and revoked_at is null;

  -- The identity itself. user_id is severed so this row can never be
  -- re-associated with a real login; active=false removes them from future
  -- rota/AI-assistant consideration (same flag deactivateStaffProfile sets).
  --
  -- `email` is new in 0111 and is the reason this migration exists: 0053
  -- added the column for account linking, two months after 0011 was written,
  -- and nothing went back. An erasure that leaves an email address behind
  -- has not erased anybody.
  update public.staff_profiles
     set first_name = 'Deleted',
         last_name = 'Member',
         email = null,
         phone = null,
         photo_url = null,
         payroll_id = null,
         user_id = null,
         active = false
   where id = p_staff_profile_id;

  -- Every row still referencing p_staff_profile_id (shifts, clock_events,
  -- leave_requests, shift_swaps, timesheets, availability, staff_locations,
  -- staff_pay_rates) is left exactly as-is: the FK now resolves to an
  -- anonymized "Deleted Member" record, which is the point — the business
  -- can still say what hours were worked and what they cost, and none of it
  -- identifies anybody once the identity is gone.

  insert into public.audit_logs (org_id, actor_user_id, action, entity_type, entity_id, metadata)
  values (p_org, auth.uid(), 'gdpr_anonymize', 'staff_profile', p_staff_profile_id, '{}'::jsonb);
end;
$$;

revoke all on function public.anonymize_staff_member(uuid, uuid) from public, anon;
grant execute on function public.anonymize_staff_member(uuid, uuid) to authenticated;

-- ── the gate, in the database rather than in a comment ────────────────
--
-- The bug was not a wrong decision. It was a decision that stopped being
-- true when somebody added a column, and no amount of care in `0011` could
-- have prevented that. So the check is over the column LIST: anything on
-- `staff_profiles` that could name a person must be either cleared by the
-- function above or named here as deliberately kept.
--
-- The pgTAP test calls this. A new identifying column with no entry fails
-- the build rather than quietly surviving an erasure.
create or replace function public.erasure_retained_columns()
returns table (column_name text, reason text)
language sql
immutable
as $$
  values
    ('id',                'The row''s own key. Meaningless without the fields around it.'),
    ('org_id',            'Which organisation the anonymous record belongs to.'),
    ('department_id',     'Where the work happened, not who did it.'),
    ('job_title',         'What the role was. Identifying only in an organisation small enough that removing it would not help either.'),
    ('contract_type',     'Employment shape, kept for what the rota and timesheets mean.'),
    ('weekly_hours',      'Same.'),
    ('holiday_allowance', 'Same — a leave balance that cannot be explained is worse than one attached to nobody.'),
    ('skills',            'What the shifts required. Attached to nobody once the identity is gone.'),
    ('start_date',        'When the employment began. Needed to make historical rotas make sense.'),
    ('active',            'Set false BY the erasure.'),
    ('created_at',        'When the record was made.'),
    ('updated_at',        'When it last changed.')
  as t(column_name, reason);
$$;

comment on function public.erasure_retained_columns() is
  'Columns on staff_profiles deliberately kept through anonymisation, with the reason. Anything not here and not cleared by anonymize_staff_member fails the pgTAP test (0111).';

grant execute on function public.erasure_retained_columns() to authenticated;
