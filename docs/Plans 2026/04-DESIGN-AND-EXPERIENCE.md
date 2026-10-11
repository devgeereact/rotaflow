# 04. One design guide for app, console, website and content editor

This is a proposed amendment to [DESIGN-SYSTEM.md](../DESIGN-SYSTEM.md) (today `docs/DESIGN.md` plus `docs/BRAND.md`, which the GEE OS Standard layout merges), not a second design system. That document stays the enforced source of truth, and its tokens live in the `@theme` block of `src/index.css` since the Tailwind 4 migration (#330; `tailwind.config.ts` no longer exists). After approval, these rules move into it and this file is deleted.

Re-verified on 11 Oct 2026 against `chore/docs-standard-layout` (main at 78f3a4d). Line references to the design guide below are to `docs/DESIGN.md` as it stands on that tree.

## 1. Where the product stands (VERIFIED, design audit of 305 non-test `.tsx` files, counts re-measured 11 Oct 2026)

The foundation is strong. There are **zero** stock Tailwind palette classes anywhere, one icon set (Lucide), `en-GB` dates throughout (no `en-US`), dark mode in 260 of 277 styled files, and no "Successfully" or "Oops" copy.

The inconsistency comes from primitives that exist but are not used:

| Rule in DESIGN.md                                            | Reality                                                                                                                                           | Worst places                                                                                                                  |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Status backgrounds use `*-wash`, never `success/10` (L80-99) | 78 alpha washes, plus 61 `bg-primary/NN` (unchanged)                                                                                              | `ToastContext.tsx:91-92` (every toast), `ConfirmContext.tsx:88-89`, `leaveStatus.ts:31-33`, `RotaBuilderPage.tsx:2467-2496`   |
| Status text uses `-ink` with its `-ink-dark` pair (L265-269) | 570 `text-*-ink` against 317 `-ink-dark`, so about 250 still lack the pair                                                                        | `NotificationsPage`, `ResourcesPage`, `TrustPage`, `SettingsBillingPage`                                                      |
| Icon-only controls use `IconButton` at 44px (L284-315)       | `IconButton` has 7 consumers (was 2; #317 adopted it in the sidebar, onboarding, team rows, `Modal` and the rota). 129 raw `<button>` in 70 files | `RotaBuilderPage` (11), `AdminShell` (7), `NotificationBell.tsx:46` still 34px                                                |
| Forms use `Field` (label, hint, error)                       | `Field` has 5 consumers; about 45 files wire `Label` and `Input` by hand                                                                          | Most settings and modals                                                                                                      |
| Tables use `DataTable`                                       | 9 consumers, all admin. About 11 bespoke tables in the org app                                                                                    | Leave, Timesheets, Overtime, Availability, Reports                                                                            |
| One status chip                                              | 7 overlapping badge components, 5 with no dark styles                                                                                             | `LeaveStatusPill`, `LeaveTypeChip`, `AttendanceStatusBadge`, `SiteStatusBadge`, `ReportChip`, `JobTitleBadge`, `LanguagePill` |
| Type scale: page title, section heading, card heading        | 35 distinct sizes, 23 of them arbitrary (`text-[10px]`, down to 8px)                                                                              | `swaps/*`, `reports/*`, `StatTile`, `ProductPreview`                                                                          |
| Dialogs use `Modal`                                          | Four drawers and overlays built by hand                                                                                                           | `GlobalSearch.tsx:169-180`, `AdminShell.tsx:410-420`, `Sidebar.tsx:218-228`, `PublicNav.tsx:134-145`                          |
| One header contract (`HeaderBar`)                            | Bespoke `<h1>` in Dashboard, Reports, Notifications, Staff profile                                                                                | See [02](02-ORGANISATION-AND-STAFF.md) §5                                                                                     |
| Tokens only, no hex                                          | Chart colours hand-copied as hex                                                                                                                  | `AdminBillingPage`, `AdminOverviewPage`, `AdminPlatformHealthPage`, `Sidebar.tsx:87`, `ProductPreview.tsx:28`                 |

**The fix is adoption, not invention.** No new component library and no redesign.

## 2. Shared foundation, different density

| Layer          | Organisation app and staff             | Platform console                           | Website                                                           | Content editor (console)                 |
| -------------- | -------------------------------------- | ------------------------------------------ | ----------------------------------------------------------------- | ---------------------------------------- |
| Identity       | `BrandMark` plus the organisation name | `BrandMark` plus a clear "Platform" label  | `BrandMark`, company name                                         | Same as console                          |
| Type           | Inter, token scale, semibold           | Same                                       | Inter 400 and 500 throughout, large and light (decision D10, §2a) | Same as console                          |
| Density        | Calm, compact rota grid                | Readable directories                       | Generous spacing, editorial                                       | Form-first                               |
| Primary action | One per screen                         | Explicit, scoped, confirmed if destructive | One per section                                                   | Save draft, Publish                      |
| States         | Saved, queued, published, delivered    | Provider, tenant and permission state      | n/a                                                               | Draft, In review, Published, Unpublished |

On D10: the first recommendation was a second display face for website headings. The owner took a different decision on 10 Oct 2026, recorded in §2a: the site keeps Inter (already self-hosted, `src/index.css:446-447` defines `--font-sans` and `--font-display` as Inter), and changes character through weight, scale, space and restraint instead. No second face, so no added bundle cost.

### 2a. Visual language: owner decision, 10 October 2026 (decision D10)

The owner chose a Tesla-inspired visual language: quiet, flat, large type, very few calls to action. It is a reference for the design rules only. The name, the logo and any Tesla asset never appear in public copy, in the product or in metadata.

**How the reference is brought in.** Run `npx getdesign@latest add tesla --out <scratch path>` into a scratch directory outside the tree (never a root `DESIGN.md`), read what it produces, and merge the parts that fit into `docs/DESIGN-SYSTEM.md` by hand, as amendments to the existing sections, not as a second document. The generated file is then deleted. The template's colours are not adopted where RotaFlow already has a token.

**Website (full adoption).**

| Rule            | Value                                                                                                                                                                                                                                 |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Surfaces        | Flat. No resting shadows. Elevation only where something genuinely floats (menu, dialog)                                                                                                                                              |
| Radius          | 4px on controls (buttons, inputs, chips). 12px on media cards (screenshots, device frames)                                                                                                                                            |
| Type            | Inter 400 and 500 as the substitute for the template's Universal Sans. No bold display weights                                                                                                                                        |
| Motion          | Colour transitions at 0.33s. Nothing else moves at rest                                                                                                                                                                               |
| Calls to action | At most two per screen: one primary, one secondary                                                                                                                                                                                    |
| Layout          | Full-height sections, one idea each                                                                                                                                                                                                   |
| Navigation      | Sticky, frosted (translucent background with a backdrop blur), with a solid fallback where `backdrop-filter` is unsupported                                                                                                           |
| Brand colour    | Stays `#3B6FE0` (`--color-primary`, `src/index.css:41`). The template's `#3E6AE1` is visually the same, so nothing changes                                                                                                            |
| Hero animation  | CSS keyframes (one already exists: `fade-up`, `src/index.css:566-568`) plus one small `IntersectionObserver` hook (none exists yet). Entrance only, never looping, removed entirely under `prefers-reduced-motion`. No new dependency |
| Hero visuals    | Real product screenshots, captured by Playwright from the DEV preview routes (`App.tsx:446-604`), shown in CSS device frames. No hand-drawn mock-ups, no stock imagery                                                                |

**App and platform console (token adoption only).** They take the new tokens (radius, type weights, transition timing, flat resting surfaces) and keep everything that makes a dense work tool usable: the status colours and their wash and ink pairs, dark mode, 44px targets (`docs/DESIGN.md` L284-315), dense tables and the compact rota grid. Two conflicts to settle when the tokens change, not before: today one 8px radius covers the whole product (`src/index.css:533-553`), and `shadow-sm`, `shadow` and `shadow-lg` are overridden there (`:560-564`). The change is reviewed on the three representative surfaces in §9 before it rolls out.

**Order.** Tokens first, then the website, then the app and console ([08](08-DELIVERY-AND-GOVERNANCE.md), phase 3).

## 3. Component rules

| Element               | Rule                                                                                                                                                                                                                                                                                                                                                               |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Page header           | `HeaderBar` (or `WorkspaceHeader` / `PageHeader` that wrap it). Title, one line of purpose, one primary action. On phones the primary action stacks first                                                                                                                                                                                                          |
| Forms                 | Always `Field`: label, control, hint, error. Required and optional both visible. On failure, focus the first invalid field and keep what was typed                                                                                                                                                                                                                 |
| Buttons               | `Button` with a verb and an object: "Publish rota", "Add staff". A loading state blocks double submission. A disabled button says why                                                                                                                                                                                                                              |
| Icon buttons          | Always `IconButton`, always an `aria-label`. `sm` (36px) only in the two places `docs/DESIGN.md` §5 now allows (a dense table row, or a dense horizontal group such as a tab strip; added by #317)                                                                                                                                                                 |
| Tables                | `DataTable` plus `Pagination`, filters through `useFilterState` and `FilterBar`. On phones, labelled stacked rows or a contained `ScrollRegion`                                                                                                                                                                                                                    |
| Status                | One status chip that takes a tone (neutral, info, success, warning, danger) and a label. The 7 badge variants become thin wrappers or are deleted. Always text plus colour, never colour alone. The name `StatusPill` is already taken by the online indicator on the splash and boot screens (`ui/StatusPill.tsx`), so pick another name or rename that one first |
| Washes                | `bg-{tone}-wash dark:bg-{tone}-wash-dark`. No alpha fills                                                                                                                                                                                                                                                                                                          |
| Dialogs               | `Modal` for every dialog, drawer and overlay. One Close control, Escape, focus trap, scroll lock, focus returns on close                                                                                                                                                                                                                                           |
| Empty, loading, error | `EmptyState` with one of four kinds (no records yet, no results for filters, not allowed, failed to load), each with a next action. `LoadingState` with skeletons that match the content                                                                                                                                                                           |
| Destructive actions   | Name the exact record, state what is kept and what is lost, then confirm. Routine saves never ask for confirmation                                                                                                                                                                                                                                                 |
| Charts                | Colours only from `chartPalette`, which reads tokens                                                                                                                                                                                                                                                                                                               |

## 4. Enforcement, so this does not drift again

Rules in a document drift. Three cheap checks stop that:

1. An ESLint rule (`no-restricted-syntax`) that flags `bg-(success|warning|danger|info|primary)/[0-9]` and `text-\[` in class strings, with an allowlist for chart files.
2. A test that fails when a file under `src/` contains a hex colour outside the palette files.
3. A test that counts raw `<button>` and fails if the count rises above today's number (a ratchet). Lower the number as screens are fixed.

These follow the existing pattern of `moduleBoundaries.test.ts`: one concrete invariant per check.

## 5. Dates, times, money and numbers

There is no central formatter today (still true on 11 Oct 2026; `src/lib/timeRange.ts` now owns time ranges after #317, and the new module should re-export it), so about 17 date patterns are spread across `date-fns` and `Intl` calls. Add one module, `src/lib/format.ts`, with five functions: `formatDate` (14 Oct 2026), `formatDateLong` (Tuesday 14 October 2026), `formatTime` (09:30), `formatDateTime` (14 Oct 2026, 09:30), and `formatMoney` (re-exported from `lib/money.ts`). Every function takes the organisation time zone. Migrate screens as they are touched, not in one sweep.

## 6. Navigation

Keep current routes and redirects. Group the manager sidebar under four quiet headings, with no new routes:

- **Today:** Dashboard, Attendance, Approvals
- **Planning:** Rota, Schedule, Availability, Open shifts
- **People:** Team, Leave, Swaps, Overtime, Locations
- **Records:** Timesheets, Reports, Announcements

Staff see: My rota, Clock in, Requests (Leave, Swaps, Overtime), Timesheets, Announcements. Settings, My account and Help sit at the bottom for everyone. Phone tab bar: see [02](02-ORGANISATION-AND-STAFF.md) O4 and the rota row in §5. Test the grouping with two managers before shipping it.

## 7. Accessibility and responsiveness

- 44px targets for every standalone control. WCAG 2.2 AA sets its own minimum. Do not describe the 44px product rule as the WCAG requirement.
- Pages reflow at 320px with no sideways scroll. Dense grids use a labelled contained scroll, with a non-drag way to do every action.
- Text readable at 200% zoom. Focus never hidden behind sticky headers, the tab bar or the cookie notice.
- Screen readers hear labels, errors and "Saved" or "Queued" announcements, never every background refresh.
- Reduced motion removes movement as well as duration. No auto-playing video. No animated counters.
- Light and dark both checked, with long names, empty data and errors, not only tidy fixtures.

Automated axe scans are basic evidence, not WCAG conformance. Reference: [WCAG 2.2 quick reference](https://www.w3.org/WAI/WCAG22/quickref/).

## 8. Words

British English, sentence case, no exclamation marks, no em dashes in UI copy.

| One term            | Not                                                 |
| ------------------- | --------------------------------------------------- |
| Rota                | Schedule (as a noun for the plan)                   |
| My rota             | My schedule                                         |
| Staff               | Employees, workers                                  |
| Organisation        | Company, account, tenant                            |
| Site                | Location (in copy; the route can stay `/locations`) |
| Clock in, Clock out | Clock In, Punch in                                  |
| Swap request        | Shift swap request, swap                            |
| Leave               | Time off, holiday (except "bank holiday")           |
| Publish             | Release, send                                       |
| Cancelled           | Canceled                                            |

| Avoid                      | Use                                                                    |
| -------------------------- | ---------------------------------------------------------------------- |
| Something went wrong       | We couldn't load this week's rota. Check your connection and try again |
| You're all set!            | Your organisation is ready                                             |
| Offline-first everywhere   | Clock-ins can wait on this phone until you're back online              |
| GDPR compliant             | Name the specific control and link to the policy                       |
| Guaranteed cover           | See gaps before you publish                                            |
| AI has scheduled your team | Review the suggested rota before applying it                           |

Fixed state wording stays as `docs/DESIGN.md` §8 (L497-512) defines it: "Saving…", "Changes saved", "Draft · not visible to staff".

## 9. Order of work

1. Status pill and washes (fixes every toast and confirmation at once).
2. `Field` and `IconButton` adoption on the five most-used forms and toolbars.
3. `DataTable` and `useFilterState` on Leave, Timesheets and Overtime.
4. Headers on the four bespoke pages.
5. Dialogs moved onto `Modal`.
6. Arbitrary text sizes mapped to the scale.

Review three representative surfaces first, side by side at phone and desktop width, in both themes: staff My rota and Clock in, manager Rota and Approvals, and the website home page. Once approved, roll the same component fixes across the rest. Record screen status in `UX-SPEC.md` and dated screenshots as evidence, never as a new style guide. The Tesla-inspired tokens (§2a) come before step 1 for the website and before the app roll-out; the component fixes above do not wait for them.
