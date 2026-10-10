# 01. Evidence, current state and drift

Review date: 10 October 2026. Branch `docs/gee-os-blueprint-layout`, HEAD `d82a2ef`. The only untracked path was this folder.

## 1. What was checked, and how

| Check                                   | Result     | Evidence                                                                                                                                                                                                                                                                                    |
| --------------------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run typecheck`                     | PASS       | exit 0                                                                                                                                                                                                                                                                                      |
| `npm run lint` (zero warnings)          | PASS       | exit 0                                                                                                                                                                                                                                                                                      |
| `npm run format:check`                  | PASS       | exit 0                                                                                                                                                                                                                                                                                      |
| `npm test`                              | PASS       | 79 files, 1,240 tests                                                                                                                                                                                                                                                                       |
| `npm run check:docs`                    | PASS       | "Documented counts match the tree", 151 migrations                                                                                                                                                                                                                                          |
| `npm run check:migrations`              | PASS       | exit 0                                                                                                                                                                                                                                                                                      |
| `npm run check:export`                  | PASS       | exit 0                                                                                                                                                                                                                                                                                      |
| `npm run build`, `check:bundle`         | NOT TESTED | Not run in this review                                                                                                                                                                                                                                                                      |
| Playwright (public, authenticated, PWA) | NOT TESTED | The first revision reported 93 passing tests. No artifact exists in the repo to confirm that                                                                                                                                                                                                |
| pgTAP (`supabase test db`)              | NOT TESTED | Needs Docker                                                                                                                                                                                                                                                                                |
| Edge typecheck (Deno 2.9.5)             | NOT TESTED | Runs in CI only                                                                                                                                                                                                                                                                             |
| `backup.yml` run history                | PASS       | Nightly success, most recently 2026-10-09 09:35 UTC (`gh run list`)                                                                                                                                                                                                                         |
| `auth-config.yml` run history           | **FAIL**   | Failed on 14, 21 and 28 Sep and 5 Oct. Run 37336823167: `401 Unauthorized`. Last success 7 Sep                                                                                                                                                                                              |
| `plan-drift-audit.yml` run history      | **FAIL**   | Failed on 21 and 28 Sep and 5 Oct. The drift log's last entry is 2026-08-31                                                                                                                                                                                                                 |
| Live site `https://rotaflow.space/`     | PARTIAL    | HTML has title, description, og and twitter tags. The body is an empty `#root` until JavaScript runs                                                                                                                                                                                        |
| Source audits                           | Done       | Seven read-only audits (org app, platform and billing, website, design system, security, governance, drift), each with file and line evidence. Their highest-impact claims were re-checked by hand. One claim, that the live site has no meta description, turned out wrong and was dropped |

Not inspected: production database contents, the live `platform_settings` values, Supabase dashboard settings, the Stripe dashboard, the cPanel host, DNS and mail. All of these are **UNKNOWN** until an authorised read.

## 2. Corrections to the first revision of this pack

| First revision said                                                  | Reality                                                                                                                                  | Evidence                                       |
| -------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| Backups and auth checks have both succeeded since (treated as fixed) | Backup is green. **Auth-config has been red for four weeks**                                                                             | `gh run list --workflow=auth-config.yml`       |
| GAP-111 has "a newer trigger implementation" in `0148`               | `0148` changes the `reply_to_support_case` RPC to queue an outbox row. It is not a trigger, and delivery has never been watched arriving | `0148` header                                  |
| GAP-112 (support self-promotion) "needs an explicit policy decision" | `0148` already took it: a support session may act as an owner but may not create one. The SAAS row is stale                              | `0148:37-48`, `:168`, `:210`                   |
| "Remove unsupported SMS choices"                                     | No SMS choice exists. The page already says SMS is not available                                                                         | `SettingsNotificationsPage.tsx:215-218`        |
| Staff documents use an "ImageKit URL helper"                         | Documents are pasted links. `buildImageKitUrl` has no callers, so it is dead code                                                        | `documentService.ts:30`, `src/lib/imagekit.ts` |
| Sessions page may call local sign-out "sign out everywhere"          | It uses the `global` scope, which revokes refresh tokens server-side. Already correct                                                    | `SessionsPage.tsx:120-132`                     |
| Tokens page may imply a public API                                   | It says "RotaFlow has no public API yet". Already honest                                                                                 | `TokensPage.tsx:40`                            |

Everything else in the first revision checked out: the "Even offline" hero, "Nothing is lost", three queued write paths, the inert `workingWeek`, the `0149` credit ledger, the PWA spec skipping without fixtures, the mailto contact form, the Requests tab landing on Leave, and so on.

## 3. Drift to reconcile after approval

Each row is a place where a document says something the code or run history contradicts. "Fix" means a document edit in the consolidation step ([10](10-GOVERNANCE-ALIGNMENT.md)). None of them is an application change.

### 3.1 Operational status (highest priority)

| Document says                                                                                    | Reality                                                                                   | Fix                                                                                                 |
| ------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `CLAUDE.md:229` and `PWA-RELEASE-GATES.md:70,181`: backup and auth-config "have never succeeded" | Backup green nightly since 5 Sep. Auth-config green on 5 and 7 Sep only, red since 14 Sep | State each workflow's real status. Link to `gh run list` rather than restating it                   |
| SAAS GAP-036 (`SAAS.md:1139`): "Both checks are ARMED and GREEN as of 2026-09-07"                | Auth-config red since 14 Sep with `401`                                                   | Reopen GAP-036 as P0. The `SUPABASE_ACCESS_TOKEN` secret probably expired or was revoked (INFERRED) |
| `CLAUDE.md:222` lists two scheduled checks                                                       | There are four: backup, auth-config, `plan-drift-audit.yml` (red) and `codeql.yml`        | List all four with an owner each                                                                    |
| `CLAUDE.md:136` says the fourth cron job (`0093`) covers "leave expiry and missed clock-in"      | `0093` covers **document expiry** and missed clock-in                                     | Correct the sentence                                                                                |

### 3.2 Capability register (SAAS.md)

| Row               | Stale text                                  | Reality                                                                                                                                                                          |
| ----------------- | ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| §2 headline       | "There is no customer and no data" (31 Aug) | The 7 Sep rehearsal saw 1 organisation, 311 shifts and 8 clock events. Still no paying customer (`marketing.ts:25`). Keep it as dated history and remove it as a current verdict |
| BUG-014 (`:1085`) | "Still open"                                | Closed by `0150` (`staff_profiles_visible`), already recorded as GAP-117 closed                                                                                                  |
| GAP-112           | Decision "to take"                          | Taken in `0148`                                                                                                                                                                  |
| GAP-050           | "Nothing tests the service worker"          | `e2e/pwa-cache-teardown.spec.ts` exists, skips without a service key, and CI never runs it (`ci.yml:305`)                                                                        |
| GAP-037           | jsdom 27 to 30 pending                      | jsdom `^30.0.1` already in `package.json:60`                                                                                                                                     |
| GAP-080           | "No credit-note table, no RPC"              | `0149` adds `invoice_credits` and `credit_invoice()`, tested in pgTAP. No UI calls it                                                                                            |
| GAP-009           | Struck through, still 🟡                    | Make strike-through and status agree                                                                                                                                             |
| CAP-036           | "Blocked on `STRIPE_TEST_SECRET_KEY`"       | GAP-073 says test keys were set on 7 Sep and signature and duplicate handling were proven                                                                                        |
| CAP-074           | "four role-narrowed routes"                 | About 14 `RequirePlatformRole` routes in `App.tsx`                                                                                                                               |
| CAP-049           | MFA 🟢                                      | Enrolment works, but no sign-in challenge exists, so `require_mfa` cannot be switched on (see [05](05-SECURITY-PRIVACY-AND-OPERATIONS.md) S5)                                    |
| CAP-044           | Support access is customer-approved         | It is a standing org flag that defaults to **true** (`0017:39`), plus a self-granted 15-minute to 24-hour session                                                                |

### 3.3 Product documents

| Document                          | Stale text                                                                               | Reality                                                                                                                             |
| --------------------------------- | ---------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| PRD §5 item 13 (`PRD.md:95-96`)   | Offline rota and announcement reading                                                    | Only clock-in, leave and swap queue offline (`OFFLINE-SPEC.md:22-26`). PRD §3 already says "not met", so the PRD contradicts itself |
| PRD §8 (`PRD.md:104`)             | "Phase 2. Intelligence, enterprise & billing"                                            | Billing shipped                                                                                                                     |
| `OFFLINE-SPEC.md` line references | `LeavePage.tsx:312-316`, `SwapsPage.tsx:209-213`                                         | The `enqueue` calls are at `LeavePage.tsx:341` and `SwapsPage.tsx:220`                                                              |
| `SCREENS.md`                      | No row for `/app/setup`. §4 says "all 7 built", while the count at `:344` says "All six" | Add the row and fix the count                                                                                                       |
| `README.md:70`                    | Node >= 20                                                                               | `package.json` engines `>=22.0.0`                                                                                                   |

### 3.4 In-app and website copy that contradicts the product

| Where                                                           | Copy                                                            | Reality                                                            |
| --------------------------------------------------------------- | --------------------------------------------------------------- | ------------------------------------------------------------------ |
| `AdminOrganisationDetailPage.tsx:963-965`                       | "No plan in the schema carries a seat, location or shift limit" | `0070` triggers enforce seat and site limits                       |
| `AdminOrganisationDetailPage.tsx:937`                           | "MRR above is real, from Stripe billing"                        | Computed from `subscription_mrr_pence`, not from Stripe            |
| `AdminSubscriptionsPage.tsx:471-480`                            | "Change plan" button                                            | Links to a page with no plan control. A dead end                   |
| `SettingsBillingPage.tsx:147`                                   | Shows "trialing" when there is no subscription                  | No trial exists                                                    |
| `SettingsBillingPage.tsx:267`, `AdminSubscriptionsPage.tsx:564` | "canceled"                                                      | British spelling is "cancelled"                                    |
| `brand.ts:23`                                                   | `hasLiveBilling: false`                                         | Billing is live                                                    |
| `AboutPage.tsx:33`                                              | "the pricing page says billing is not live"                     | The pricing FAQ (`PricingPage.tsx:22`) says you pay through Stripe |
| `ResourcesPage.tsx:98`                                          | "Built and in use today" includes documents and offline PWA     | No customers yet. The same page lists document upload as not built |
| `PricingPage.tsx:88`                                            | "Most popular" badge                                            | No customers, so no basis for popularity                           |
| `marketing.ts:86`                                               | "Even offline."                                                 | Three write paths only                                             |
| `marketing.ts:308-309`, `SolutionsPage.tsx:128`                 | "takes minutes", "about ten minutes"                            | Never measured. `BRAND.md:41` forbids unmeasured time claims       |
| `MobileTabBar.tsx:44-48` comment                                | Leave "links the swap queue beside it"                          | Nothing on the Leave page links to swaps                           |

### 3.5 Governance documents

See [10](10-GOVERNANCE-ALIGNMENT.md) §2 for the 23 contradictions between `CLAUDE.md`, `AGENTS.md`, `CODEX.md`, `README.md`, `RULES.md`, `GEE-OS.md`, `.agent/*` and `.claude/agents/*`.

## 4. What this review can and cannot conclude

It can say what the source does, what the local gates prove, what CI has done recently, and what the public site serves. It cannot say what is deployed in the Supabase project, what the live settings are, whether any email reaches an inbox, or how the app behaves on a real phone with no signal. Those need the authorised checks in [08](08-DELIVERY-AND-GOVERNANCE.md), phase 0.

The first revision's rule still stands. For every uncertain feature, record four separate facts: the source exists, a local test passed, the deployed version is confirmed, and a customer journey was observed. That stops the team rebuilding features that work, and stops it selling features that do not.
