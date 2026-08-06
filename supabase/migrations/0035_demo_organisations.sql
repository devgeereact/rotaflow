-- =====================================================================
-- 0035. A demo tenant says so in the database
--
-- `platform_seed.sql` attaches invoices, support cases, incidents and
-- integrations to whatever organisations exist when it runs. Today every
-- account in this deployment belongs to the owner, so that is useful rather
-- than dangerous. The day a real customer signs up it becomes fabricated
-- billing history against their name, and the only thing standing between
-- those two states is somebody remembering.
--
-- This replaces the remembering with a column.
--
-- ## Why a flag rather than running the teardown
--
-- The teardown removes the data. It does not stop the seed attaching to a real
-- tenant on the next run, and it throws away a console that currently
-- demonstrates the product. A flag keeps the demo working and makes the
-- dangerous case impossible: the seed can only ever write to organisations
-- that admit they are demonstrations, and a real signup lands with the default.
--
-- ## Why the default is false
--
-- So that the failure mode is a demo tenant that looks real, not a real tenant
-- that gets seeded. The first is a cosmetic annoyance somebody notices; the
-- second is a customer reading invented invoices.
-- =====================================================================

alter table public.organisations
  add column if not exists is_demo boolean not null default false;

comment on column public.organisations.is_demo is
  'This organisation exists to demonstrate the product. platform_seed.sql writes only to these, the console badges them, and a real signup gets the default of false.';

-- Every organisation in this deployment today is the owner's own: the accounts
-- are gakinz101@gmail.com, its +demo aliases, and two personal addresses.
-- Backfilled on that basis, and deliberately not by a rule that would catch a
-- future customer.
update public.organisations set is_demo = true;

create index if not exists organisations_demo_idx
  on public.organisations (is_demo)
  where is_demo;
