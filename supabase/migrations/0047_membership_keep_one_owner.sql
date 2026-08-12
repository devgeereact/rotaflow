-- =====================================================================
-- 0047_membership_keep_one_owner.sql — an organisation can't end up ownerless
--
-- SCREENS.settings's Permissions tab shows "Change role" and "Remove"
-- disabled on the row whose role is Owner, "An organisation must keep one
-- owner". `memberships_write` (0002) already lets an owner update or delete
-- any row in their org, including the last owner's own — nothing stopped
-- that today. `memberships_audit` (0016) would faithfully log the mistake,
-- not prevent it.
--
-- This is a database-level guard rather than a client-side disabled button:
-- the button is a courtesy, this is the actual boundary. It fires on the
-- specific transitions that could remove the last owner — demoting one, or
-- deleting one — not on every write, so a same-role update (still just
-- editing status, say) is untouched.
-- =====================================================================

create or replace function public.memberships_keep_one_owner()
returns trigger language plpgsql as $$
declare
  remaining_owners integer;
begin
  if tg_op = 'DELETE' then
    if old.role <> 'owner' then
      return old;
    end if;
    select count(*) into remaining_owners
      from public.memberships
      where org_id = old.org_id and role = 'owner' and id <> old.id;
  else -- UPDATE
    if old.role <> 'owner' or new.role = 'owner' then
      return new;
    end if;
    select count(*) into remaining_owners
      from public.memberships
      where org_id = old.org_id and role = 'owner' and id <> old.id;
  end if;

  if remaining_owners = 0 then
    raise exception 'an organisation must keep at least one owner'
      using errcode = '23514';
  end if;

  return coalesce(new, old);
end;
$$;

drop trigger if exists memberships_keep_one_owner_trigger on public.memberships;
create trigger memberships_keep_one_owner_trigger
  before update or delete on public.memberships
  for each row execute function public.memberships_keep_one_owner();
