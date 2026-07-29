# Supabase PostgreSQL Schema & Security — RotaFlow

The canonical, runnable source is `supabase/migrations/`. `0001_init.sql` ships the
built-in `profiles` + `app_settings` and conventions; **`0002_rotaflow.sql`** adds the
RotaFlow domain; **`0003_fix_organisations_select_rls.sql`** fixes an org-creation
RLS bootstrap bug (see §4); **`0004_rotas_draft_unique.sql`** adds partial unique
indexes so concurrent callers can't create duplicate draft rotas; **`0005_narrow_organisations_select_rls.sql`**
closes the permanent creator-read bypass `0003` left open (see §4). Apply via the
Supabase SQL editor or `supabase db push`.

RotaFlow is **multi-tenant on a single database**: every domain table carries an
`org_id`, and Row Level Security isolates tenants. RLS is the last line of defence —
the client also scopes every query, but the database guarantees no cross-tenant leak.

## 1. Tenancy & roles model
```text
auth.users ──1:1──> public.profiles
                        │  (is_platform_admin flag = Super Admin)
                        ▼
                  public.memberships ──> role: owner | manager | staff
                        │  (user_id, org_id, role, optional location scope)
                        ▼
                  public.organisations  (the tenant root)
                        ├── locations ── departments
                        ├── staff_profiles (may exist before an auth user; user_id nullable)
                        ├── shift_types ── shift_templates
                        ├── rotas ── shifts
                        ├── availability · leave_requests · overtime_requests · shift_swaps
                        ├── clock_events · timesheets
                        ├── emergency_contacts · documents
                        ├── announcements · notifications
                        ├── subscriptions (billing seam)
                        └── audit_logs
```

- **Super Admin** = `profiles.is_platform_admin = true` (platform-wide; not an org
  membership).
- **Owner / Manager / Staff** = a row in `memberships` for that `org_id`.
- A person can belong to multiple organisations (each with its own role).

## 2. Built-in tables (from `0001_init.sql`)

### `profiles`
| Column       | Type          | Notes                                   |
| ------------ | ------------- | --------------------------------------- |
| `id`         | `uuid` PK     | FK → `auth.users.id`, cascade on delete |
| `email`      | `text`        | unique, not null                        |
| `full_name`  | `text`        | nullable                                |
| `avatar_url` | `text`        | nullable (often an ImageKit URL)        |
| `created_at` | `timestamptz` | default `now()`                         |
| `updated_at` | `timestamptz` | default `now()`, bumped by trigger      |

`0002` adds **`is_platform_admin boolean not null default false`** (Super Admin flag).

### `app_settings`
Per-user preferences (`theme`, `notifications_enabled`) — unchanged. `theme` values
`dark`/`light`; the app also honours the device preference by default.

## 3. RotaFlow tables (from `0002_rotaflow.sql`)
Every table below has `id uuid PK`, `org_id uuid` (FK → `organisations`, except
`organisations` itself), `created_at`, `updated_at`, RLS enabled, and a
`set_updated_at()` trigger.

| Table | Key columns | Purpose |
| ----- | ----------- | ------- |
| `organisations` | `name`, `slug` (unique), `plan`, `settings jsonb`, `created_by` | Tenant root. |
| `memberships` | `org_id`, `user_id`→profiles, `role` (`owner`\|`manager`\|`staff`), `status` | Who belongs to an org and as what. |
| `locations` | `org_id`, `name`, `address`, `latitude`, `longitude`, `timezone`, `geofence_radius_m` | Sites; clock-in geofencing. |
| `departments` | `org_id`, `location_id?`, `name` | Kitchen, Nursing, Reception… |
| `staff_profiles` | `org_id`, `user_id?`, `first_name`, `last_name`, `job_title`, `department_id?`, `contract_type`, `weekly_hours`, `holiday_allowance`, `skills text[]`, `payroll_id`, `start_date`, `phone`, `photo_url`, `active` | Employee record; `user_id` null until invited person signs up. |
| `shift_types` | `org_id`, `name`, `colour`, `default_start`, `default_end`, `is_paid`, `category` | Morning/Late/Night/On-Call… |
| `shift_templates` | `org_id`, `name`, `shift_type_id?`, `location_id?`, `department_id?`, `start_time`, `end_time`, `break_minutes`, `required_skills text[]` | Reusable shift presets. |
| `rotas` | `org_id`, `location_id`, `name`, `period_start`, `period_end`, `status` (`draft`\|`published`), `published_at` | A schedule for a period/location. |
| `shifts` | `org_id`, `rota_id?`, `location_id`, `department_id?`, `staff_profile_id?`, `shift_type_id?`, `starts_at`, `ends_at`, `break_minutes`, `status` (`open`\|`assigned`\|`confirmed`\|`cancelled`), `colour`, `notes` | The atomic scheduled unit. `staff_profile_id` null = open shift. |
| `availability` | `org_id`, `staff_profile_id`, `weekday?`, `date?`, `start_time`, `end_time`, `status` (`available`\|`unavailable`\|`preferred`), `recurring` | Recurring or one-off availability. |
| `leave_requests` | `org_id`, `staff_profile_id`, `type`, `start_date`, `end_date`, `status` (`pending`\|`approved`\|`rejected`), `reason`, `reviewed_by?`, `reviewed_at?` | Holiday/sick/unpaid requests. |
| `overtime_requests` | `org_id`, `staff_profile_id`, `date`, `hours`, `status`, `note` | Staff offer / manager allocate overtime. |
| `shift_swaps` | `org_id`, `shift_id`, `requested_by`, `target_staff_profile_id?`, `status` (`pending`\|`accepted`\|`approved`\|`rejected`), `note` | Swap workflow. |
| `clock_events` | `org_id`, `staff_profile_id`, `shift_id?`, `type` (`in`\|`out`\|`break_start`\|`break_end`), `event_at`, `latitude?`, `longitude?`, `accuracy?`, `method` (`gps`\|`qr`\|`manual`), `location_name?`, `synced` | Attendance; offline-created then synced. |
| `timesheets` | `org_id`, `staff_profile_id`, `period_start`, `period_end`, `total_minutes`, `status` | Summarised hours for payroll export. |
| `emergency_contacts` | `org_id`, `staff_profile_id`, `name`, `relationship`, `phone`, `secondary_phone?`, `medical_notes?` | Per-employee. |
| `documents` | `org_id`, `staff_profile_id`, `type`, `name`, `file_url`, `issued_at?`, `expires_at?` | Contracts, DBS, RTW, visas; expiry surfaced in Phase 2. |
| `announcements` | `org_id`, `author_user_id`, `scope` (`org`\|`location`\|`department`), `location_id?`, `department_id?`, `title`, `body`, `urgent`, `published_at` | Communication centre. |
| `notifications` | `org_id`, `user_id`, `type`, `title`, `body`, `channel` (`push`\|`email`\|`sms`), `read_at?` | In-app + delivery record. **`sms` is a reserved channel value — not delivered in V1.** |
| `subscriptions` | `org_id`, `plan` (`starter`\|`professional`\|`business`), `status`, `provider`, `provider_ref?`, `current_period_end?` | Billing seam. Provider is pluggable (Apple Pay / Google Pay / PayPal); charging is built last. |
| `audit_logs` | `org_id`, `actor_user_id?`, `action`, `entity_type`, `entity_id?`, `metadata jsonb`, `created_at` | GDPR + compliance trail (append-only). |

## 4. Row Level Security
RLS is **enabled on every table**. Policies use `security definer` helper functions
(defined in `0002`) so membership checks don't recurse:

| Function | Returns | Meaning |
| -------- | ------- | ------- |
| `public.is_platform_admin()` | bool | current user is a Super Admin |
| `public.is_org_member(org uuid)` | bool | current user belongs to `org` (any role) |
| `public.has_org_role(org uuid, roles text[])` | bool | current user's role in `org` ∈ `roles` |
| `public.my_staff_profile_id(org uuid)` | uuid | the caller's own `staff_profiles.id` in `org` |

Baseline policy shape:

| Scope | Read | Write |
| ----- | ---- | ----- |
| Shared scheduling data (`organisations`, `locations`, `departments`, `shift_types`, `shift_templates`, `rotas`, `shifts`, `announcements`) | `is_org_member(org_id)` | `has_org_role(org_id, ['owner','manager'])` |
| Personal data (`availability`, `leave_requests`, `overtime_requests`, `clock_events`, `emergency_contacts`, `documents`) | own row (`staff_profile_id = my_staff_profile_id(org_id)`) **or** manager/owner in org | staff may write their **own** rows; managers/owners may write any in org |
| `memberships` | `is_org_member(org_id)` | `has_org_role(org_id, ['owner'])` (owners manage the team) |
| `notifications` | `user_id = auth.uid()` | insert by service/Edge Function; user updates `read_at` on own rows |
| `subscriptions`, `audit_logs` | `has_org_role(org_id, ['owner'])` (+ platform admin) | Edge Functions / owners only |
| Anything | Super Admin (`is_platform_admin()`) may read for support | writes still audited |

There is **no** blanket public-read policy. Unauthenticated requests return nothing.
These policies are a solid, working baseline — tighten per feature as flows land.

**`organisations` read is a deliberate exception** to the table above:
`is_org_member(id) OR (created_by = auth.uid() AND no membership row exists yet for
that org)` (`0003_fix_organisations_select_rls.sql`, narrowed by
`0005_narrow_organisations_select_rls.sql`). Without the `created_by` clause,
`insert(...).select().single()` fails RLS for the very first org a user creates —
Postgres checks the new row against the SELECT policy for `RETURNING` *before* the
`on_org_created` trigger has inserted their membership row, so `is_org_member` alone
can't see it yet. `0003`'s original fix left that clause unconditional, which let the
creator read the org forever, even after their membership was removed or suspended.
`0005` scopes it to the genuine bootstrap window only — the instant `on_org_created`
inserts the owner's membership row (same transaction), the `not exists` check flips
and only `is_org_member()` governs access, same as every other tenant table.

## 5. Automation
- **`handle_new_user()`** (from `0001`): creates `profiles` + `app_settings` on sign-up.
- **`set_updated_at()`**: keeps `updated_at` accurate on every table.
- **Conflict/summary logic** (rota conflict detection, timesheet rollups): computed in
  the client for V1; heavier/scheduled jobs move to **Supabase Edge Functions +
  `pg_cron`** and are dispatched via **Inngest** (never on cPanel).

## 6. Generating TypeScript types
Keep `src/types/database.types.ts` in sync once the DB exists:
```bash
supabase gen types typescript --project-id <ref> --schema public \
  > src/types/database.types.ts
```
The Supabase client is `createClient<Database>(…)`, so every query is fully typed.
`src/types/index.ts` exposes row aliases (`Organisation`, `Shift`, `LeaveRequest`, …)
— add them there as tables are generated.

## 7. Migration policy
- One numbered file per change (`0002_rotaflow.sql`, `0003_…`). Additive & idempotent
  (`if not exists`). **Never edit an applied migration** — add a new one.
- Every new table: `org_id`, RLS enabled, membership-scoped policies, `set_updated_at`.
