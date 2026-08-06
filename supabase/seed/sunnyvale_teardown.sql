-- =====================================================================
-- sunnyvale_teardown.sql. Remove the Sunnyvale Care Group demo org
--
-- Drops the organisation (everything cascades on org_id) and the two
-- Sunnyvale demo accounts. It does NOT touch:
--   - the five orgs built by demo_seed.sql (different id namespace)
--   - gakinz101@gmail.com, or its platform-admin flag
--   - any organisation created through the app
--
-- Docs: supabase/seed/README.md
-- =====================================================================

delete from public.organisations
where id = md5('rotaflow-sunnyvale-v1:org')::uuid;

-- The accounts go after the org: a membership FKs the user, and deleting
-- the user first would either fail or orphan the row depending on the
-- cascade, which is not a difference worth relying on.
delete from auth.users
where lower(email) in (
  'gakinz101+sunnyvale.owner@gmail.com',
  'gakinz101+sunnyvale.manager@gmail.com'
);

-- Should return no rows.
select o.id, o.name
from public.organisations o
where o.id = md5('rotaflow-sunnyvale-v1:org')::uuid;
