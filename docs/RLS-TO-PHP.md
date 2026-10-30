# Row-level security to PHP checks

Status: **PARTIAL.** The Supabase back end is being replaced (`docs/MERGE-TARGET.md`). Row-level security has no
MariaDB equivalent, so every policy becomes an explicit check in `backend/`, and this table is the proof that none
was lost. The target is every one of the 119 final policies (113 on public tables, 6 on `storage.objects`)
accounted for here. **69 are mapped so far (slices S2 to S6).** A row is not DONE until the test named in it passes.

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
| organisations | `organisations_insert` | `created_by = auth.uid()` | **New, decided 2026-10-30: organisations are by invitation.** `Orgs::createOrg` refuses with `org_creation_closed` unless `org_creation` is `open` or the caller is a platform owner or admin; it sets `created_by` from the verified user; 5 per hour per user; creation is one transaction with the owner membership | 030 create, clash, sixth is 429; 060 closed by default | DONE |
| organisations | `organisations_update` | Owner | `Orgs::updateOrg`: `Scope::require(['owner'])` and `requireWritable` | 030 rename, non-member 404, suspended refuses | DONE |
| organisations | `organisations_select` | Member, platform admin, or creator before any membership exists | `Scope::membership` (active member of a non-archived org, else 404). The creator exception is gone because creation is atomic. Platform read: S8 | 030 tenancy block | DONE (member); PLANNED S8 (platform) |
| memberships | `memberships_select` | Member, own row, or platform operational | `Orgs::listMembers` (member only; managers see email and name, staff do not). `Orgs::me` for own rows. Platform read: S8 | 040 listing | DONE; PLANNED S8 |
| memberships | `memberships_write` | Owner; `role='owner'` only by a direct owner | `Orgs::setRole`, `setStatus`, `transferOwnership`: `Scope::requireReal(['owner'])`; owner role can only move by transfer | 040 roles, suspend, transfer | DONE |
| invites | `invites_select` | Owner/manager, or platform owner/admin for an owner invite in an org with no members | `Invites::list`: `Scope::require(MANAGERS)`. First-owner bootstrap is `Platform::createOrg` and `inviteOwner`, platform owner or admin only | 050 list, staff 403; 060 | DONE |
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
| first-owner bootstrap (platform admin invites an owner into an organisation with no members) | Only a platform owner or admin; only while the org has no members; never an owner-role invite through the normal route | `Platform::createOrg`, `inviteOwner`; `Invites::accept` refuses an owner invite into an org that has an owner | 060 | DONE |
| `create_invite` | Owner or manager; 60 per hour per org; no second pending invite for an address | `Invites::create` plus the `invites_pending` unique key. A per-address daily cap of three is new, carried from SiteRelay | 050 | DONE |
| `preview_invite` | Anyone holding the token | `Invites::preview` (public route, 30 per minute per address); one uniform 404 for every failure | 050 | DONE |
| `accept_invite` | Token valid; signed-in email equals the invited email; creates the membership | `Invites::accept` in a transaction with the invite row locked. Linking the staff record: S3 | 050 | DONE (membership); PLANNED S3 (staff record) |
| `audit_logs_immutable` (trigger) | No update or delete | MariaDB triggers in migration 003. Needs the TRIGGER privilege for the migration user | 030 | DONE locally; live: needs that privilege |
| `handle_new_org` (trigger) | The creator also gets a staff record | `Orgs::createOrg` marks the place | none yet | PLANNED S3 |
| `enforce_org_not_read_only`, plan limits | Trial, grace and read-only rules | `Scope::requireWritable` covers only suspended and archived. Billing state: S7 | 030 suspended refuses | PARTIAL |

## S3: people and places

The dynamic policy loops in `0002` (`<table>_select` for members, `<table>_write` for owner and manager) cover
`locations`, `departments` and `staff_profiles`; `emergency_contacts` uses the personal-table loop (own record or
owner and manager). The replay below is of the final state.

| Table | Policy | Postgres rule (final) | PHP check | Test | Status |
| ----- | ------ | --------------------- | --------- | ---- | ------ |
| locations | `locations_select` | Member | `Places::listLocations`: `Scope::membership` | 070 | DONE |
| locations | `locations_write` | Owner or manager | `Places::saveLocation`, `deleteLocation`: `Scope::require(MANAGERS)` and `requireWritable`; timezone, coordinates, type, status and radius validated | 070 | DONE |
| departments | `departments_select` | Member | `Places::listDepartments` | 070 | DONE |
| departments | `departments_write` | Owner or manager | `Places::saveDepartment`, `deleteDepartment`; the location must be in the organisation (also the composite key) | 070 | DONE |
| staff_profiles | `staff_profiles_select` + column grants + `staff_profiles_visible` (0150, 0162) | Member reads the record; payroll id, start date, phone, email and holiday allowance only for owner or manager and the person themselves | `Staff::present`: the column rule, applied to every read; the private `photo_path` is never returned | 080 colleague view, manager view, mutation of the rule | DONE |
| staff_profiles | `staff_profiles_write` | Owner or manager | `Staff::createStaff`, `updateStaff`: `Scope::require(MANAGERS)` | 080 | DONE |
| staff_profiles | `staff_profiles_self_write` + trigger `restrict_self_edit` | A person updates only their own row, and only phone and photo | `Staff::updateStaff`: the record's `user_id` must be the caller; any other field that differs is `self_edit_restricted` 403 | 080 name, hours, payroll id, active; unchanged values allowed; mutation of the rule | DONE |
| staff_profiles | trigger `lock_payroll_id` | Once set, the payroll id never changes (erasure excepted) | `payroll_id_locked` 409 in `updateStaff`. Erasure: S8 | 080 | DONE; erasure PLANNED S8 |
| staff_profiles | unique `(org, payroll_id)`, `(org, user_id)` | One payroll id, one login | Unique keys; `payroll_id_taken`, `account_linked` 409 | 080 | DONE |
| staff_profiles | trigger `job_title_same_org`, `department` checks | A title or department belongs to the same organisation | Checked in `Staff::fields`, and the composite foreign keys refuse it in the database | 080 incl. direct SQL | DONE |
| staff_profiles | trigger `auto_link_account` (0053, 0055) | A record whose email matches a member's login is linked to it | `Staff::createStaff` (`linkableUser`), `Staff::linkOnAccept`, `Staff::ensureForOwner` | 080, 060 | DONE |
| staff_profiles | trigger `enforce_seat_limit` (0070) | Plan staff limit | Billing state and plan limits: S7 | none yet | PLANNED S7 |
| staff_locations | `staff_locations_select` | Member | Returned as `location_ids` on every staff read | 080 | DONE |
| staff_locations | `staff_locations_write` | Owner or manager; both parents in the same organisation | `Staff::setLocations` (replace the set in one transaction); composite keys | 080 incl. direct SQL | DONE |
| staff_pay_rates | `staff_pay_rates_select` | Owner or manager, or the person | `Staff::listRates` via `managerOrSelf` | 080 | DONE |
| staff_pay_rates | `staff_pay_rates_write` | Owner or manager | `Staff::addRate`; a history, never overwritten (`rate_exists` 409); audited as a warning | 080 | DONE |
| job_titles | `job_titles_select` | Member | `Staff::listTitles` | 080 | DONE |
| job_titles | `job_titles_write` via `can_manage_job_titles` | Owner; a manager only if the organisation's `job_titles_managed_by` is `managers` | `Staff::titleManager`, `saveTitle`, `deleteTitle`; name and colour uniqueness by generated-column keys | 080 | DONE |
| emergency_contacts | `emergency_contacts_select` and `_write` | The person, or owner and manager | `Staff::managerOrSelf` on list, save and delete; a contact must belong to the staff id in the path | 080 | DONE |
| app_settings | `app_settings_all_own` | Own row | `Account::getSettings`, `saveSettings` keyed by the caller | 085 | DONE |

| Postgres function or trigger | Rule | PHP | Test | Status |
| ---------------------------- | ---- | --- | ---- | ------ |
| `complete_onboarding` | Owner only, idempotent, the only writer of the timestamp | `Account::completeOnboarding` | 085 | DONE |
| `handle_new_org` (staff part) | The founder gets a staff record | `Staff::ensureForOwner` from `Orgs::createOrg`, and from `Invites::accept` for an owner invitation | 080, 060 | DONE |
| `accept_invite` (staff part) | Link an HR record by email; apply the invited department and site | `Staff::linkOnAccept` | 080 | DONE |
| `audit_logs_select` | Owner reads the trail; anyone else only their own acts; platform-only rows hidden | `Account::audit` | 085 | DONE (organisation view); platform view PLANNED S8 |
| `current_pay_rates`, `labour_cost` | Cost without exposing rates | With the rota and reports, S4 and later | none yet | PLANNED |

## S4: the rota

`rotas` and `shifts` lost their single write policy in `0161` and gained separate insert, update and delete policies;
`shift_types` follows the org-shared loop (member reads, owner and manager write) and `availability` the personal loop.
Readability of a rota is `my_readable_rota_ids()`: the caller is a member and the rota is published or archived, or the
caller is an owner or manager.

| Table | Policy | Postgres rule (final) | PHP check | Test | Status |
| ----- | ------ | --------------------- | --------- | ---- | ------ |
| rotas | `rotas_select` | A rota the caller may read | `Rotas::list`: staff get published and archived only; owner and manager (including a delegate) get drafts too | 090 | DONE |
| rotas | `rotas_insert`, `rotas_update`, `rotas_delete` | Owner or manager | `Rotas::create`, `rename`, `publish`, `unpublish`, `beginRevision`, `discardRevision`, `repeat`: `Scope::require(MANAGERS)`. No delete endpoint exists; only an amendment is discarded | 090 | DONE |
| rotas | trigger `rotas_guard_status_change` | A status changes only through publish, unpublish, amend or discard, never by writing the column | The API has no way to write `status`. Transitions are the five functions above, each under the rota's row lock | 090 | DONE |
| shifts | `shifts_select` | Member, and a loose shift or one in a readable rota | `Shifts::list`: loose shifts and published or archived rotas for staff; drafts too for owner and manager | 095 | DONE |
| shifts | `shifts_insert`, `shifts_update`, `shifts_delete` | Owner or manager | `Shifts::write`, `update`, `delete`: `Scope::require(MANAGERS)` and `requireWritable`; every reference must belong to the organisation (and the composite keys back it) | 095 incl. direct SQL | DONE |
| shifts | trigger `shifts_guard_immutable_rota` | Shifts of a published rota (ROTA1) or an archived one (ROTA2) never change | `Shifts::lockRotas`: `rota_published` 409, `rota_archived` 409, taken under the rota's row lock so it queues behind a publish. Covers insert, update (the old and the new rota) and delete | 090, 095; mutation of the rule | DONE |
| shift_types | `shift_types_select`, `_write` | Member reads; owner and manager write | `Planning::listTypes`, `saveType`, `deleteType`. Deleting a type still in use is refused (`shift_type_in_use`): the old foreign key would have tried to blank it on published history | 095 | DONE |
| availability | `availability_select`, `_write` | The person, or owner and manager | `Planning::listAvailability`, `addAvailability`, `deleteAvailability`: own record, or owner and manager for anyone | 095 | DONE |
| minimum_cover_rules | `minimum_cover_rules_select`, `_write` | Member reads; owner and manager write | `Planning::listCover`, `setCover` (one rule per site per weekday) | 095 | DONE |

| Postgres function | Rule | PHP | Test | Status |
| ----------------- | ---- | --- | ---- | ------ |
| `publish_rota` | Owner or manager; a draft only; refuse while a future day is below its site's minimum (ROTA7); archive the superseded rota first; stamp who and when | `Rotas::publish` with the pure `MinimumCover::firstShortfall` | 089 (16 cases incl. time zones, past days, ordering), 090 | DONE |
| `begin_rota_revision` | Published rotas only; resume an open amendment; else adopt a draft for the same week; else create one; copy the non-cancelled shifts if it has none | `Rotas::beginRevision` | 090 | DONE |
| `discard_rota_revision` | An open amendment only; delete its shifts and itself; return the source | `Rotas::discardRevision` | 090 | DONE |
| `unpublish_rota` | Published to draft, unless an amendment is open | `Rotas::unpublish` | 090 | DONE |
| `repeat_rota_weeks` | 1 to 26 weeks; skip a published week or one with shifts; keep local hours across clock changes | `Rotas::repeat`, `Time::plusLocalDays` | 090 incl. the March 2030 clock change | DONE |
| one draft and one published rota per site and period (partial unique indexes) | Uniqueness among drafts, and among published rotas | Unique keys over generated `is_draft` and `is_published` columns plus a `site_key`; `rota_exists` 409 | 090 | DONE |
| `rota_amendment_changes`, `enqueue_rota_published_notification` | What changed for each person; notify on publish | Notifications: S6 | none yet | PLANNED S6 |
| `open_shifts`, `claim_open_shift` | Open shifts and the first-claim-wins rule | S5 | none yet | PLANNED S5 |
| `enforce_org_not_read_only` on rotas and shifts | Read-only organisations cannot publish or edit | Billing state: S7 | none yet | PLANNED S7 |
| Realtime on `shifts`, `rotas`, `availability`, `shift_types` | A signal to refetch | `useRealtimeRefresh` now polls | `src/hooks/useRealtimeRefresh.test.ts` | DONE |
| `FK ... ON DELETE SET NULL` on shifts (location, department, shift type) | The reference is blanked when its target is deleted | Deleting a location, department or shift type that shifts use is refused (`location_in_use`, `department_in_use`, `shift_type_in_use`). **Deliberate change:** the old behaviour would have rewritten published history | 095 | DONE |

## S5: time and requests

Policies replayed to their final state (`0037`, `0044`, `0128`, `0136`, `0146`). Where the old policy let a person write a
status directly, the API exposes named actions instead, so the rule cannot be bypassed by a crafted write.

| Table | Policy | Postgres rule (final) | PHP check | Test | Status |
| ----- | ------ | --------------------- | --------- | ---- | ------ |
| clock_events | `clock_events_select` | Owner and manager read all; a person reads their own | `Clock::list`: a member's query is forced to their own staff record | 100 | DONE |
| clock_events | `clock_events_insert` | The person for themselves, or owner and manager for anyone | `Clock::record`: own staff record, or `Scope::MANAGERS` for anyone in this organisation | 100 | DONE |
| clock_events | `clock_events_delete` | Owner and manager | `Clock::delete` | 100 | DONE |
| clock_event_corrections | `clock_event_corrections_select` | Owner and manager | `Clock::corrections`; table is append-only (triggers) | 100 incl. direct SQL | DONE |
| leave_requests | `leave_requests_select` | The person, or owner and manager | `Leave::listLeave` forces a member's query to their own | 105 | DONE |
| leave_requests | `leave_requests_write` | The person may write `pending` or `cancelled` on their own; owner and manager anything | `createLeave` (own, or any person for owner and manager), `reviewLeave` (owner and manager, a pending request once), `cancelLeave` (the person or owner and manager, from pending or approved). **Tightened:** the old policy let a person set an approved request back to pending | 105 | DONE |
| overtime_requests | `overtime_requests_select`, `_write` | As leave; the person may only write `pending` | `Leave::listOvertime`, `createOvertime`, `reviewOvertime`, `cancelOvertime` (pending only) | 105 | DONE |
| timesheets | `timesheets_select` | The person, or owner and manager | `Timesheets::list` | 115 | DONE |
| timesheets | `timesheets_write` | The person may write `open` or `submitted`; owner and manager anything | `submit` (the person, own, not once approved or exported), `approve` and `reopen` (owner and manager) | 115 | DONE |
| shift_swaps | `shift_swaps_select` | Requester, target, or owner and manager | `Swaps::list` | 110 | DONE |
| shift_swaps | `shift_swaps_select_open_board` | Any member sees a pending swap with no target | `Swaps::list` includes the open board for every member | 110 | DONE |
| shift_swaps | `shift_swaps_write` (0146) | The requester manages their own pending or cancelled request; owner and manager manage any swap **except approving it** | `Swaps::create`, `cancel` (requester or manager, before a decision). Approval only through `decide` | 110 | DONE |
| shift_swaps | `shift_swaps_target_respond` | The target moves a pending swap to accepted or rejected | `Swaps::respond` | 110 | DONE |
| shift_swaps | `shift_swaps_claim_open` | A member (not the requester) takes a pending swap with no target: they become the target and it is accepted | `Swaps::claim`, one atomic conditional update; the second claim loses (`swap_unavailable`) | 110 | DONE |
| shift_swaps | `shift_swaps_requester_finalize` | The requester rejects their own accepted swap | `Swaps::decide` (rejected), allowed to the requester once the colleague accepted | 110 | DONE |

| Postgres function or trigger | Rule | PHP | Test | Status |
| ---------------------------- | ---- | --- | ---- | ------ |
| `clock_events_guard_event_at` | For a person (not owner or manager) an event time more than 5 minutes ahead or 72 hours behind is replaced by the server time; the claim is kept as `event_at_reported` | `Clock::record` | 100; mutation of the rule | DONE |
| `clock_events_guard_sequence` | A person cannot clock in when the previous event within five minutes was also "in"; a replay of an event that already exists is exempt (CLK01) | `Clock::record` (`already_clocked_in` 409) | 100; mutation | DONE |
| `correct_clock_event` | Owner and manager; a reason of 3 to 500 characters; optimistic concurrency; keeps before and after; flags approved or exported timesheets that cover the old or new day | `Clock::correct` | 100, 115 | DONE |
| `client_event_id` unique indexes on clock, leave, swaps | A replayed offline write must not duplicate | A lookup before insert; a replay answers 200 `already_applied`, a different person's key 409 `client_event_conflict`. The browser no longer parses an index name | 100, 105, 110 | DONE |
| `leave_requests_no_live_overlap` (exclusion constraint) | One person, one live booking per day, whatever the type | `Leave::createLeave`: a lock on the person's staff record, then an overlap query, in one transaction (`leave_overlap` 409) | 105; mutation | DONE |
| `leave_days` | Calendar days with half days at either end; never zero | `Leave::presentLeave` (`days`) | 105 | DONE |
| `decide_shift_swap` | Owner and manager decide a pending or accepted swap; the requester finalises an accepted one; approving moves the shift in one transaction; already decided answers harmlessly | `Swaps::decide` | 110 | DONE |
| `apply_swap_reassignment` | Only an approved swap with a target that has not yet moved; the shift must still be the requester's, its rota not archived, the new holder active; audited | `Swaps::applyReassignment`, `reassign`. Writes into a published rota on purpose | 110; mutation | DONE |
| `open_shifts`, `claim_open_shift` | Future, unassigned, open shifts on a published rota; claiming checks started, overlap and who got there first | `Swaps::openShifts`, `claimOpenShift` | 110 | DONE |
| `approve_timesheets` | Owner and manager; an array; a batch is one transaction; replaces the figure and bumps the version | `Timesheets::approve` (all or nothing; clears the recalculation flag) | 115 | DONE |
| `overtime_evidence` | Scheduled minutes less breaks, worked minutes from paired in and out, forgotten clock-outs | `Leave::evidence`. **Tightened:** the old function answered any member about anyone; it is now owner, manager or the person | 105 | DONE |
| Realtime badges (`useNavBadgeCounts`) | Counts of requests waiting | `GET /orgs/{o}/attention` (owner and manager) | 105, 110 | DONE |
| Review notification triggers (leave, swap, rota) | A message to the person | Notifications: S6 | none yet | PLANNED S6 |
| `enforce_org_not_read_only` on these tables | Read-only organisations cannot write | Billing state: S7 | none yet | PLANNED S7 |

## S6: communication

| Table | Policy | Postgres rule (final) | PHP check | Test | Status |
| ----- | ------ | --------------------- | --------- | ---- | ------ |
| notifications | `notifications_select` / `_write` | The person reads and updates their own; **no client insert** | `Notifications::list`, `markRead` are keyed to the caller; only the Dispatcher inserts (no route can) | 120 incl. cross-user mark | DONE |
| notification_outbox | RLS on, no client policy | Written by triggers and the service role only | No endpoint reads or writes it; `Notify::enqueue` is called from server code | 120 | DONE |
| notification_deliveries | RLS on, no client policy | Service role only | Written by the Dispatcher; no endpoint | 120 | DONE |
| notification_templates | `notification_templates_select` and `_write` | Read by members (org or platform rows); written by platform admins | Read by the Dispatcher only; the write path arrives with the platform console | 120 (resolution) | DONE (read); PLANNED S8 (write) |
| push_subscriptions | `push_subscriptions_*` | The person's own rows | `Notifications::subscribe`, `unsubscribe` act only on the caller's rows; the endpoint's hash is unique, so a second person on a device takes it over | 120 | DONE |
| org_smtp_settings | `org_smtp_settings_*` + column grant withholding `smtp_pass` + `org_smtp_settings_safe` | Owner only; the password is never readable | `OrgSettings::getSmtp` (owner; returns `has_password`, never the password or ciphertext), `saveSmtp`, `testSmtp` (mails only the owner's own address), `deleteSmtp`. **Tightened:** the password is encrypted at rest (it was plaintext) | 125; mutation | DONE |
| calendar_feed_tokens | `calendar_feed_tokens_*` + `issue_calendar_feed_token`, `calendar_feed_shifts` | The person's own token; a bad token yields nothing; 90 days idle revokes; 120 reads an hour | `CalendarFeed::issue`, `revoke`, `status`, and the public `feed`: only the token's SHA-256 is stored, a new token revokes the old, a bad token is a bare 404, misses are rate limited | 125 | DONE |
| announcements | `announcements_select`, `announcements_write` | Member reads; owner and manager write | `Announcements::list`, `save`, `publish`, `delete`: owner and manager write. **Tightened:** staff read only published notices (the old policy let any member read drafts) | 125; mutation | DONE |
| announcement_reads | `announcement_reads_*` | The person's own receipts; managers read all | `Announcements::read` (own staff record), `reads` (owner and manager) | 125 | DONE |

| Postgres function or trigger | Rule | PHP | Test | Status |
| ---------------------------- | ---- | --- | ---- | ------ |
| `enqueue_rota_published_notification`, `rota_amendment_changes` | Tell everyone with a shift on a first publish; on an amendment tell each person only what changed for them | `Rotas::notifyPublished`, the pure `RotaDiff::messages` | 120 | DONE |
| `enqueue_leave_reviewed_notification` | Tell the requester of an approval or rejection, unless they made it | `Leave::tellRequester` | 120 | DONE |
| `enqueue_swap_reviewed_notification` | Tell the requester of an approval or rejection, unless they made it | `Swaps::tell` (also when the colleague declines) | 120 | DONE |
| `enqueue_announcement_notification`, `announcement_audience` | Tell the audience once, on first publish | `Announcements::doPublish`, `audience` | 125 | DONE |
| `remind_announcement_unread` | Owner and manager; remind those in the audience who have not read it | `Announcements::remind` (rate limited 6 an hour) | 125 | DONE |
| `enqueue_scheduled_alerts` (missed clock-in) | One alert per shift to owners and managers, 30 minutes to 12 hours after the start, none if clocked in | `Notifications::scheduledAlerts` with a dedupe key | 120 | DONE |
| `enqueue_scheduled_alerts` (free trial ending, `0157`) | Owners of an active organisation whose own trial ends within three days and which has not chosen a plan, once per trial end | `Notifications::trialEndingAlerts`, dedupe `trial_ending:<org>:<end>` | 140 | DONE |
| `enqueue_scheduled_alerts` (document expiry) | Alert owners and managers | Documents (S8, S10) | none yet | PLANNED |
| `dispatch_notification_outbox`, `verify_notification_secret`, vault | Shared-secret HTTP hop to an Edge Function | Gone: the Dispatcher runs inside the cron process, so there is nothing to authenticate | n/a | DONE (removed) |
| `send-notification` matrix and mute | Org matrix 5 x 3, person's mute for email and push only, permissive defaults | `Dispatcher::deliver`, `matrix` | 120; mutations | DONE |
| `send-invite` | Email the invitation | `Invites::email`, `resend` | 125 | DONE |
| `test-smtp` | Test an organisation's account | `OrgSettings::testSmtp` | 125 | DONE |

## S7: billing (Stripe, test mode)

Stripe stays in **test mode** until the owner sets `stripe.mode` to `live` in private config. A subscription row records the mode that created it,
and no code path crosses modes: a test event never touches a live row, and a live key in test mode (or the reverse) is refused before any request.

| Table | Policy | Postgres rule (final) | PHP check | Test | Status |
| ----- | ------ | --------------------- | --------- | ---- | ------ |
| plans | `plans_select` | Any signed-in user reads the price list; no client write | `Mod\Billing::plans` (signed in; the Stripe price ids are never returned). Written by migration only | 140 | DONE |
| subscriptions | `subscriptions_select` | Owner, or platform billing roles, read; **no client write** | `Billing::account` and `stateRoute` (owner / any member); the table is written only by the webhook (`Billing::applySubscription`). No route accepts a subscription from a client | 140; 099 | DONE (owner read); platform read arrives with the console (S8) |
| invoices | `invoices_select` | Owner, or platform billing roles, read; no client write | `Billing::account` (owner), `invoiceLinks` (owner, by our own invoice id, scoped to the organisation); written only by the webhook | 140 | DONE (owner read); platform read in S8 |
| billing_events | RLS on, no policy | Service role only | No route reads it; `StripeWebhook::receive` writes it. Unique per provider, mode and event id | 140 | DONE |

| Postgres function or trigger | Rule | PHP | Test | Status |
| ---------------------------- | ---- | --- | ---- | ------ |
| `org_billing_state`, `my_org_billing_state` | active / trialing / grace / trial / read_only | `Billing::stateOf`, `state`; `GET /orgs/{o}/billing/state` for any member | 140 incl. the edges | DONE |
| `org_is_read_only`, `enforce_org_not_read_only` | Read-only blocks building rotas and shifts and inviting; never clocking in, leave or swaps | `Billing::requireNotReadOnly` in `Rotas` (all writes), `Shifts` (create, batch, edit, delete), `Planning` (minimum cover, revision), `Invites` (create, resend, accept) | 140 (each blocked, and leave and clock still allowed); mutation | DONE |
| `org_has_feature` | The plan's features, unless read-only | `Billing::hasFeature` (used by the AI assistant and reports in S8) | 140 | DONE |
| `enforce_seat_limit` | Active staff may not exceed the plan; reactivating counts | `Billing::requireSeat` in `Staff::createStaff` and on reactivation, inside the transaction, with the organisation row locked so two requests cannot take the last seat | 140; mutation | DONE |
| `enforce_location_limit` | Locations may not exceed the plan | `Billing::requireLocationRoom` in `Places::saveLocation`, same locking | 140 | DONE |
| `sync_org_plan_from_subscription` | `organisations.plan` follows the subscription while it entitles, else `professional` during the organisation's own trial | `Billing::syncPlan`, called from `applySubscription` | 140 | DONE |
| `subscriptions_track_grace_window` | 14 days from the first move to past due; a further failure does not extend it; any other status clears it | `Billing::applySubscription` | 140; mutation | DONE |
| `set_org_status` | Suspend or reinstate with a reason, audited | `Billing::setOrgStatus` (the webhook suspends; reinstating is a platform act, S8) | 140 | DONE (suspend); reinstate PLANNED |
| `claim_billing_event`, `complete_billing_event`, `fail_billing_event` | One row per event; a redelivery of a processed event does nothing; a failure is kept and the event retried | `StripeWebhook::receive` | 140; mutation | DONE |
| `create-checkout-session` | Owner only; plan with a price for the mode; refuse a second live subscription; carry the remaining trial if over 49 hours | `Billing::checkout`, `BillingRules::checkoutAllowed`, `checkoutTrialEnd` | 140 | DONE. **Tightened:** return URLs come from the configured `app_url`, not the browser's Origin header |
| `create-portal-session` | Owner only; the organisation's own customer, in this mode | `Billing::portal` | 140 | DONE |
| `billing-account` | Owner only; sync the contact email to Stripe; fresh invoice links | `Billing::syncContact`, `invoiceLinks` | 140 | DONE |
| `stripe-webhook` | Signature; mode isolation; idempotent; fresh subscription retrieval; pinned to one subscription | `StripeWebhook` and `BillingRules::verifySignature`, `subscriptionScope`, `freshestSubscription`, `suspendOnDeleted` | 140; 099 (anonymous refusal); mutations | DONE |

Not tested against Stripe itself: every Stripe call is answered by a fake transport, so **NOT TESTED** against the real API until a test-mode
checkout is run end to end with the owner's test keys and a Stripe CLI or dashboard webhook endpoint.

