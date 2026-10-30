# Row-level security to PHP checks

Status: **PARTIAL.** The Supabase back end is being replaced (`docs/MERGE-TARGET.md`). Row-level security has no
MariaDB equivalent, so every policy becomes an explicit check in `backend/`, and this table is the proof that none
was lost. The target is every one of the 119 final policies (113 on public tables, 6 on `storage.objects`)
accounted for here. **13 are mapped so far (slice S2).** A row is not DONE until the test named in it passes.

How to read it. The Postgres rule is the final-state policy after all migrations (replayed, not the first
definition). The PHP check names the code that now enforces it. Tests are in `backend/tests/suites/`.
The access sweep (`099-access-sweep.php`) reads the route table and calls every route as nobody, a stranger and a
user with no organisation, so it covers a new endpoint without anyone remembering to add a test.

Two things change shape rather than move. Where a policy let a platform administrator read tenant data, the
check arrives with the platform console (S8). Where a policy only existed to let a client insert directly
(`profiles_insert_own`), the row is now created by the server, so there is nothing to guard.

## S2: identity and tenancy

| Table | Policy | Postgres rule (final) | PHP check | Test | Status |
| ----- | ------ | --------------------- | --------- | ---- | ------ |
| profiles (now `users`) | `profiles_select_own` | Own row, or platform operational | `GET /me` returns only the caller's row (`Orgs::me`). Platform read: S8 | 030 first request, same Clerk id | DONE (own); PLANNED S8 (platform) |
| profiles | `profiles_insert_own` | Own row | `Users::resolve` creates the row server-side from verified claims; no client write exists | 030 resolve, link by email | DONE |
| profiles | `profiles_update_own` | Own row | Profile edit endpoint arrives with staff profiles (S3). `Users::resolve` keeps the email in step with Clerk | 030 email lower-cased | PLANNED S3 |
| organisations | `organisations_insert` | `created_by = auth.uid()` | `Orgs::createOrg` sets `created_by` from the verified user; 5 per hour per user; creation is one transaction with the owner membership | 030 create, clash, sixth is 429 | DONE |
| organisations | `organisations_update` | Owner | `Orgs::updateOrg`: `Scope::require(['owner'])` and `requireWritable` | 030 rename, non-member 404, suspended refuses | DONE |
| organisations | `organisations_select` | Member, platform admin, or creator before any membership exists | `Scope::membership` (active member of a non-archived org, else 404). The creator exception is gone because creation is atomic. Platform read: S8 | 030 tenancy block | DONE (member); PLANNED S8 (platform) |
| memberships | `memberships_select` | Member, own row, or platform operational | `Orgs::listMembers` (member only; managers see email and name, staff do not). `Orgs::me` for own rows. Platform read: S8 | 040 listing | DONE; PLANNED S8 |
| memberships | `memberships_write` | Owner; `role='owner'` only by a direct owner | `Orgs::setRole`, `setStatus`, `transferOwnership`: `Scope::requireReal(['owner'])`; owner role can only move by transfer | 040 roles, suspend, transfer | DONE |
| invites | `invites_select` | Owner/manager, or platform owner/admin for an owner invite in an org with no members | `Invites::list`: `Scope::require(MANAGERS)`. First-owner bootstrap: S8 | 050 list, staff 403 | DONE; PLANNED S8 |
| invites | `invites_write` | Owner, or manager for a non-owner role | `Invites::create` and `revoke`: `Scope::require(MANAGERS)`; the API refuses `owner` | 050 create, revoke | DONE |
| platform_admins | `platform_admins_select` | Platform admin, or own row | `Scope::platformRole` reads only the caller's row for `/me`. Console reads: S8 | 030 platform role | DONE (own); PLANNED S8 |
| role_delegations | `role_delegations_select` | Member | `Orgs::listDelegations`: any active member, live cover only | 040 | DONE |
| audit_logs | `audit_logs_select` | Platform operational, or (not platform-only, has an org, and owner or the actor) | **No read endpoint yet** (audit view arrives with settings, S3). Writing is `Audit::log` only; nothing updates or deletes a row | 030 audit trigger tests | PLANNED S3 (read); DONE (append-only) |

## S2: functions and triggers that carried a rule

| Postgres | Rule | PHP | Test | Status |
| -------- | ---- | --- | ---- | ------ |
| `memberships_keep_one_owner` (trigger) | An organisation always keeps an owner | Owners can only change through `transferOwnership`, which promotes before it demotes inside one transaction; `setRole` and `setStatus` refuse an owner | 040 transfer, exactly one owner | DONE |
| `transfer_ownership` | Owner only; target an active member and not self; outgoing owner becomes manager | `Orgs::transferOwnership` | 040 | DONE |
| `limit_org_creation` | 5 organisations per hour per user | `RateLimiter` in `Orgs::createOrg` | 030 | DONE |
| `delegate_role` | Real owner or manager only; target an active member; ends in the future; one live delegation per pair; cannot be passed on | `Orgs::delegate` (reads the real role). **ASSUMPTION:** a 90-day ceiling is new, because the Postgres function only required "in the future" | 040 | DONE |
| `revoke_delegation` | The lender, or a real owner or manager; never a delegate | `Orgs::revokeDelegation` | 040 | DONE |
| `has_org_role` delegation branch | A live delegation confers manager, never owner, while its lender is still an owner or manager | `Scope::membership` effective role | 040 expiry, lender demoted, restored | DONE |
| `create_invite` | Owner or manager; 60 per hour per org; no second pending invite for an address | `Invites::create` plus the `invites_pending` unique key. A per-address daily cap of three is new, carried from SiteRelay | 050 | DONE |
| `preview_invite` | Anyone holding the token | `Invites::preview` (public route, 30 per minute per address); one uniform 404 for every failure | 050 | DONE |
| `accept_invite` | Token valid; signed-in email equals the invited email; creates the membership | `Invites::accept` in a transaction with the invite row locked. Linking the staff record: S3 | 050 | DONE (membership); PLANNED S3 (staff record) |
| `audit_logs_immutable` (trigger) | No update or delete | MariaDB triggers in migration 003. Needs the TRIGGER privilege for the migration user | 030 | DONE locally; live: needs that privilege |
| `handle_new_org` (trigger) | The creator also gets a staff record | `Orgs::createOrg` marks the place | none yet | PLANNED S3 |
| `enforce_org_not_read_only`, plan limits | Trial, grace and read-only rules | `Scope::requireWritable` covers only suspended and archived. Billing state: S7 | 030 suspended refuses | PARTIAL |
