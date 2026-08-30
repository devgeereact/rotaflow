-- =====================================================================
-- 0077_rate_support_case_validates_score.sql — the CSAT function
-- refuses a bad score in its own words (docs/SAAS.md BUG-060)
--
-- `rate_support_case` has had no caller since 0024. BUG-060 is about
-- giving it one, and it is worth tidying the one refusal it left to the
-- table before anything starts calling it.
--
-- Its other two refusals say what is wrong and who may act:
--
--     'Only the person who raised a case can rate it'      42501
--     'Rate a case once it has been resolved'              22023
--
-- A score outside 1-5 fell through to `support_cases.csat`'s CHECK,
-- which surfaces as
--
--     new row for relation "support_cases" violates check constraint
--     "support_cases_csat_check"                           23514
--
-- The UI will never send one — the control offers five buttons — so this
-- is not a bug being fixed, it is the last path through a function that
-- did not explain itself. `open_support_case` and the rest of 0024
-- validate their own inputs; this now matches.
--
-- WHILE HERE: re-rating stays allowed, deliberately. The update is
-- unconditional, so a requester who clicks 2 and means 4 can correct it,
-- and the screen shows the current score rather than pretending the
-- question was never asked. A one-shot rating would need a reason to be
-- one-shot, and "we only want the first impression" is not a reason that
-- survives a customer asking why they cannot change it.
--
-- MIGRATION RISK. One function replaced, same signature, so no grant is
-- dropped or re-created. It is strictly more permissive about nothing
-- and strictly clearer about one case. No table altered, no row
-- rewritten. Reversible by re-applying 0024's body.
-- =====================================================================

create or replace function public.rate_support_case(
  p_case    uuid,
  p_score   integer,
  p_comment text default null
) returns void language plpgsql security definer set search_path = public as $$
declare
  c public.support_cases;
begin
  select * into c from public.support_cases where id = p_case;
  if not found then
    raise exception 'Case not found' using errcode = 'P0002';
  end if;

  -- The requester rates it, not the team that answered it.
  if c.requester_id is distinct from auth.uid() then
    raise exception 'Only the person who raised a case can rate it'
      using errcode = '42501';
  end if;
  if c.resolved_at is null then
    raise exception 'Rate a case once it has been resolved' using errcode = '22023';
  end if;
  if p_score is null or p_score < 1 or p_score > 5 then
    raise exception 'A satisfaction score is 1 to 5, not %', coalesce(p_score::text, 'null')
      using errcode = '22023';
  end if;

  update public.support_cases
     set csat = p_score, csat_comment = nullif(btrim(coalesce(p_comment,'')),'')
   where id = p_case;
end;
$$;

comment on function public.rate_support_case(uuid, integer, text) is
  'The requester''s satisfaction score for a resolved case, 1 to 5. Only the person who raised it, only after resolution. Re-rating is allowed on purpose: a mis-tap should be correctable.';
